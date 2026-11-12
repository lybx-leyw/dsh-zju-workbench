/**
 * 本地音视频转写（对应上游 `zhiyun trans audio`）。
 *
 * # 上游是怎么做的
 *
 * `core/zju/lib/zhiyun/asr.ts` + `local.ts`：**本地跑** SenseVoiceSmall（ONNX int8，
 * CPU），运行库是 `sherpa-onnx-node`，模型从 HuggingFace / hf-mirror 下到
 * `<DSH_HOME>/speech-to-text/sensevoice/models`（约 240 MB，校验 SHA-256 后才启用）。
 * 全流程是：FFmpeg 抽 16 kHz 单声道 WAV → VAD 断句 → 逐块识别 → 写
 * `segments.json` / `transcript.txt` / `raw.json` / `metadata.json` / `transcript.md`。
 *
 * # 本仓为什么只给「可注入的转写器」
 *
 * 三条硬约束，都不是能绕开的：
 *
 *   1. `sherpa-onnx-node` 与那个宿主语音包**都不在本仓的依赖里**（`package.json`
 *      只声明 tough-cookie / undici / source-login）。要用就得加依赖并
 *      `npm install` —— 本任务明确禁止。
 *   2. 模型 240 MB 的下载与校验是**首次安装**行为，属于宿主安装层，不是数据源读。
 *   3. 上游借的是**宿主应用自带**的运行库（`@deepseek-ai/dsh-experimental-speech-to-text-sensevoice`）。
 *      本仓在纯 Node 下跑（`docs`/测试都不在应用目录里），那个包解析不到。
 *
 * 所以这里把「编排」与「识别内核」拆开：**编排归本包**（落盘、分页切片、
 * 超时、取消、结果形状），识别通过 `transcriber` 注入。没注入时**明确报错**，
 * 不静默返回空文本 —— 那会让「转写失败」看起来像「这段音频没人说话」。
 *
 * 落盘归本包（D17：写自己的数据目录不算写上游），与课件缓存同理。
 */

import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rm, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ClassroomError } from './errors.js';

/**
 * 转写默认超时。
 *
 * 上游实测：148 分钟的录播在 CPU 上跑几分钟。取 30 分钟作上限 —— 明显超出这个
 * 数值说明不是慢，是卡住了（模型加载失败、被 VAD 死循环之类），应当报错而不是
 * 让调用方无限等。
 */
export const DEFAULT_TRANSCRIBE_TIMEOUT_MS = 30 * 60 * 1000;

/** 每段的默认最大字符数：喂给上下文时一节课几千段会撑爆，按需切片。 */
export const DEFAULT_MAX_CHARACTERS = 16000;

const clock = (ms) => {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

/**
 * `Promise.race` + 定时器实现的超时。
 *
 * `sharedFetch` **不读** `timeoutMs`（只有 `Transport` 读），而这里的
 * `transcriber` 是调用方注入的任意异步函数，连 `Transport` 都不经过 ——
 * 所以超时必须自己在外面兜。（同样写法见 `packages/source/ebook/src/ebook.js`
 * 的 `withTimeout`。）
 *
 * 计时器必须 `clearTimeout`，否则一次成功的转写会把进程多留 30 分钟。
 *
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {() => void} onTimeout - 超时后调 `abort()`，让内核真正停下来。
 * @returns {Promise<T>}
 * @template T
 */
export function withTimeout(promise, ms, onTimeout) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* abort 失败不再改变错误语义 */ }
      reject(new ClassroomError('TIMEOUT', `转写超过 ${Math.round(ms / 60000)} 分钟仍未完成`, { timeoutMs: ms }));
    }, ms);
    // 定时器不该拖住宿主退出：超时本身是错误路径，不需要它把进程留住。
    timer.unref?.();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * 校验并规范化调用方给的转写器。
 *
 * 只认 `(input) => Promise<{segments}>` 这一个形状。**拒绝静默降级**：
 * 有人传了个对象但形状不对时，明确报 `DEPENDENCY_MISSING`，
 * 而不是等到转写开始时才 `undefined is not a function`。
 *
 * @param {unknown} transcriber
 */
export function assertTranscriber(transcriber) {
  if (typeof transcriber === 'function') return transcriber;
  if (transcriber !== null && typeof transcriber === 'object' && typeof transcriber.transcribe === 'function') {
    return (input) => transcriber.transcribe(input);
  }
  throw new ClassroomError(
    'DEPENDENCY_MISSING',
    '本地转写尚未接入识别内核：本包不含 sherpa-onnx 运行库与 SenseVoice 模型',
    { hint: '宿主需通过 config.asr / setTranscriber 注入转写器；模型与运行库的安装不属于数据源层' },
  );
}

/** 一段 16 kHz 单声道 16-bit PCM WAV 的头部字节数（含 `data` 块头）。 */
const WAVE_HEADER_BYTES = 44;

/**
 * 用 FFmpeg 把任意音视频抽成转写要求的 16 kHz 单声道 WAV。
 *
 * # 为什么必须抽
 *
 * 上游 `media.ts:16-17` 与 `asr.ts:138-141` 是同一件事的两半：SenseVoice 只吃
 * **16 kHz / 单声道 / 16-bit PCM** 的 WAV，而用户手上的输入是 `.m4a` / `.mp4` /
 * 带视频的 HLS。少了这一步，内核收到的是一段它读不了的字节 —— 而报错会出现在
 * **识别内核内部**，用户看到的是「模型加载失败」，与本因无关。
 *
 * # 参数逐个说明
 *
 * - `-nostdin`：不抢调用方的标准输入（宿主是长驻进程，少了它 FFmpeg 可能挂住）；
 * - `-y`：目标是本方法自己在 `directory` 里新建的临时文件，不存在覆盖用户的文件；
 * - `-vn`：丢掉视频轨，一节课的视频有几百 MB，转写只需要音频；
 * - `-ac 1 -ar 16000 -c:a pcm_s16le`：SenseVoice 的唯一可接受格式。
 *
 * @param {string} executable - FFmpeg 可执行文件的绝对路径或 PATH 里的名字。
 * @param {string} input
 * @param {string} output
 * @param {{signal?: AbortSignal, spawn?: Function}} [options] - `spawn` 只为测试注入，
 *   与 `diagnostics.js` 的 `probeFfmpeg` 同一套做法：真实路径必须能跑一次真程序，
 *   但测试不该依赖本机装没装 FFmpeg。
 * @returns {Promise<number>} 产物的字节数（`<= 44` 视为没抽到声音）。
 */
export function extractAudio(executable, input, output, { signal, spawn: spawner = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let child;
    try {
      child = spawner(executable, [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-i', input,
        '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
        output,
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      reject(new ClassroomError('DEPENDENCY_MISSING', `无法启动 FFmpeg：${error?.message ?? error}`, {
        hint: '设置 FFMPEG_PATH，或用 check("media") 看是否已装；本包不执行 npm install',
      }));
      return;
    }
    // stderr 只留尾部：FFmpeg 在失败时会打几百行，全留没有用，全丢又没法定位。
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.once('error', (error) => reject(new ClassroomError(
      'DEPENDENCY_MISSING',
      error?.code === 'ENOENT' ? '音频提取需要 FFmpeg，但找不到可执行文件' : `FFmpeg 启动失败：${error?.message ?? error}`,
      { hint: '设置 FFMPEG_PATH 指向已有的 ffmpeg；没有 FFmpeg 时转写无法进行（本包不做 mp3/m4a 解码）' },
    )));
    child.once('close', async (code) => {
      if (code !== 0) {
        reject(new ClassroomError('MEDIA_FAILED', `FFmpeg 抽取音频失败（退出码 ${code}）`, { stderr: stderr.trim().slice(-600) }));
        return;
      }
      try {
        const bytes = (await stat(output)).size;
        // 空壳 WAV（只有 44 字节头）说明这段媒体里没有音轨。
        if (bytes <= WAVE_HEADER_BYTES) {
          reject(new ClassroomError('NO_AUDIO', '输入里没有可转写的音轨', { bytes }));
          return;
        }
        resolve(bytes);
      } catch (error) { reject(error); }
    });
    signal?.addEventListener('abort', () => {
      try { child.kill(); } catch { /* 已经退出 */ }
    }, { once: true });
  });
}

/**
 * 从宿主的 `speechToText` 服务造一个转写器。
 *
 * # 这是「漏-4：ASR 没有装配方」的那个装配方
 *
 * 调查结论（见交付报告）：本仓**不需要**装 `sherpa-onnx-node`，也**不需要**下模型 ——
 * 宿主 DeepSeek Harness 自带的语音包
 * `@deepseek-ai/dsh-experimental-speech-to-text-sensevoice` 已经把两件事都做了：
 * 它注册一个 `speechToText` provider，运行库与权重由它自己管、模型按需自下。
 * 缺的只是**没人把那个服务接到本包的 `transcriber` 接口上**。
 *
 * 所以这个适配器做三件事，全都是本包自己该做的编排：
 *
 *   1. **抽音频**（FFmpeg，本包已有的诊断找可执行文件）；
 *   2. **按内核窗口切片**：宿主 provider 一条请求最多 4 MB（约 2 分钟 16 kHz
 *      单声道），所以按时间轴切成若干块分别送，再按偏移量把时间戳拼回去；
 *   3. **拼句段**：provider 只回一整段文字、**没有时间戳**。这正好对应
 *      `normalizeSegments` 允许的 `start: null` —— 我们给的是「块级」时间
 *      （块起点与终点），并在 `engine` 里写明 `chunked`，**不伪造成逐句时间**。
 *
 * # 为什么切片而不是整段送
 *
 * 一节课 90 分钟的 16 kHz WAV 约 173 MB，远超 4 MB 上限；整段送会被 provider
 * 直接拒（`SpeechInputError`）。切片后每块约 3 MB，且损失只是「块内没有句级
 * 时间戳」—— 而这本来就没有。
 *
 * @param {object} options
 * @param {object} options.speechToText - 宿主服务（`resolve` + `transcribe`）。
 * @param {string} options.executable - FFmpeg 可执行文件。
 * @param {string} [options.providerId] - 指定 provider；省略用宿主的默认。
 * @param {string} [options.language] - 语言提示，默认 `zh`（课堂是中文课）。
 * @param {number} [options.chunkSeconds] - 每块多少秒，默认 120（约 3.8 MB）。
 * @param {number} [options.maxAudioBytes] - provider 的单次字节上限，默认 4 MB。
 * @returns {(input: {file: string, directory: string, signal?: AbortSignal}) => Promise<object>}
 */
export function createHostTranscriber({
  speechToText, executable, providerId, language = 'zh', chunkSeconds = 120, maxAudioBytes = 4 * 1024 * 1024,
  extract = extractAudio,
} = {}) {
  if (!speechToText || typeof speechToText.transcribe !== 'function' || typeof speechToText.resolve !== 'function') {
    throw new ClassroomError('DEPENDENCY_MISSING', '宿主没有提供可用的 speechToText 服务', {
      hint: '需要在 profile 里启用 @deepseek-ai/dsh-experimental-speech-to-text 与对应的 provider 包',
    });
  }
  if (!executable) throw new ClassroomError('INVALID_INPUT', '转写适配器需要 FFmpeg 可执行文件路径');
  if (!Number.isFinite(chunkSeconds) || chunkSeconds <= 0) throw new ClassroomError('INVALID_INPUT', 'chunkSeconds 须为正数');

  const engine = `host-speech-to-text:${providerId ?? 'default'}:chunked`;

  /**
   * 单个 WAV 里能装多少采样。
   *
   * 按字节上限反推，而不是写死秒数：provider 的上限是**字节**，采样率与位深
   * 一旦变化（比如以后改成 8 kHz），写死的秒数会算出一个超限的块。
   */
  const bytesPerSecond = 16000 * 2;
  const limitSeconds = Math.max(1, Math.min(chunkSeconds, Math.floor((maxAudioBytes - WAVE_HEADER_BYTES) / bytesPerSecond)));

  return async function transcribe({ file, directory, signal }) {
    const work = path.join(directory, `.asr-${process.pid}-${Date.now().toString(36)}`);
    await mkdir(work, { recursive: true });
    try {
      // 1) 抽音频：整节先落成一份 WAV，再按块切（切一份 173 MB 的文件比重新抽 N 次快得多）。
      const wave = path.join(work, 'audio.wav');
      const bytes = await extract(executable, file, wave, { signal });
      signal?.throwIfAborted();

      /**
       * 读文件头，定位音频负载的起点。
       *
       * 读 8 KB 而不是 44 字节：FFmpeg 常在 `fmt ` 与 `data` 之间塞一个 `LIST`
       * 块（编码器元数据），`data` 因此可能落在 100 字节之后。只读 44 字节时
       * `findDataChunk` 找不到就退回 44 —— 那会把元数据当音频送进去，
       * 症状是「能跑，但识别出来全是乱码」。
       */
      const handle = await open(wave, 'r');
      let prologue;
      let dataOffset;
      try {
        const head = Buffer.alloc(Math.min(8192, bytes));
        const read = await handle.read(head, 0, head.length, 0);
        prologue = head.subarray(0, read.bytesRead);
        dataOffset = findDataChunk(prologue);
        if (dataOffset === null) {
          throw new ClassroomError('MEDIA_FAILED', 'FFmpeg 抽出的音频不是可识别的 WAV（找不到 data 块）', {
            hint: '这通常说明输入文件损坏或不是音视频；先用 check("media") 确认 FFmpeg 可用',
          });
        }
        if (prologue.length < dataOffset) {
          throw new ClassroomError('MEDIA_FAILED', 'WAV 头不完整，无法按块切分');
        }
        prologue = prologue.subarray(0, dataOffset);

        // 2) 按块送识别。块边界来自整段 WAV 的长度，不依赖 provider 的分段行为 ——
        //    我们要的时间戳是「这段话在整节课的第几分钟」，只有自己切才拿得到。
        const payloadBytes = bytes - dataOffset;
        if (payloadBytes <= 0) throw new ClassroomError('NO_AUDIO', '输入里没有可转写的音轨', { bytes });
        const durationSeconds = payloadBytes / bytesPerSecond;
        const segments = [];
        for (let start = 0; start < durationSeconds; start += limitSeconds) {
          signal?.throwIfAborted();
          const length = Math.min(limitSeconds, durationSeconds - start);
          const payloadLength = Math.min(payloadBytes, Math.round(length * bytesPerSecond));
          // 复用整段的前缀（RIFF/fmt/data 头），只把 `data` 的长度改成本块长度：
          // provider 会拿头里的长度校验输入，长度对不上直接判无效。
          const slice = Buffer.alloc(prologue.length + payloadLength);
          prologue.copy(slice, 0);
          slice.writeUInt32LE(payloadLength, dataOffset - 4);
          await handle.read(slice, prologue.length, payloadLength, dataOffset + Math.round(start * bytesPerSecond));
          const spec = speechToText.resolve({ audio: slice, ...(providerId ? { providerId } : {}), language });
          const result = await speechToText.transcribe(spec, signal);
          const text = String(result?.text ?? '').trim();
          if (text) {
            segments.push({
              // 块级时间：含这一段话的区间，不是逐句时间戳（provider 不提供）。
              start, end: start + payloadLength / bytesPerSecond, text,
            });
          }
        }
        return { segments, engine, audioBytes: bytes, chunkSeconds: limitSeconds };
      } finally { await handle.close(); }
    } finally {
      // 中间 WAV 一节课近 200 MB，用完就删（与 transcribeFile 的 finally 同一理由）。
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  };
}

/**
 * 在 RIFF 头里找 `data` 块的位置。
 *
 * FFmpeg 抽出的 WAV 常在 `fmt ` 与 `data` 之间插一个 `LIST`（元数据），
 * 这时音频起始不在第 44 字节。写死 44 会让整段偏移 30 来个字节 —— 结果是
 * **能跑但全是杂音**，比直接失败难查得多。
 *
 * @param {Buffer} header - 文件开头若干字节（至少覆盖前几块）。
 * @returns {number|null} `data` 块负载的起始偏移；找不到返回 null。
 */
export function findDataChunk(header) {
  if (!Buffer.isBuffer(header) || header.length < 12) return null;
  if (header.toString('latin1', 0, 4) !== 'RIFF' || header.toString('latin1', 8, 12) !== 'WAVE') return null;
  for (let offset = 12; offset + 8 <= header.length;) {
    const id = header.toString('latin1', offset, offset + 4);
    const size = header.readUInt32LE(offset + 4);
    if (id === 'data') return offset + 8;
    // 块按 2 字节对齐；`size` 是奇数字节时后面有一个填充字节。
    offset += 8 + size + (size % 2);
    if (!Number.isFinite(offset) || offset < 0) return null;
  }
  return null;
}

/**
 * 句段规范化：只接受有限、单调、非负的时间戳；文字必须是非空字符串。 */
export function normalizeSegments(value) {
  if (!Array.isArray(value)) throw new ClassroomError('API_SHAPE', '转写器返回的 segments 不是数组');
  const rows = [];
  for (const [index, raw] of value.entries()) {
    if (raw === null || typeof raw !== 'object') throw new ClassroomError('API_SHAPE', `转写器返回的 segments[${index}] 不是对象`);
    const { start, end, text } = raw;
    if (typeof text !== 'string') throw new ClassroomError('API_SHAPE', `转写器返回的 segments[${index}].text 不是字符串`);
    const hasStart = start !== null && start !== undefined;
    const hasEnd = end !== null && end !== undefined;
    if (hasStart !== hasEnd) throw new ClassroomError('API_SHAPE', `转写器返回的 segments[${index}] 时间戳不完整`);
    let startMs = null, endMs = null;
    if (hasStart) {
      const a = Math.round(Number(start) * 1000), b = Math.round(Number(end) * 1000);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < a) {
        throw new ClassroomError('API_SHAPE', `转写器返回的 segments[${index}] 时间戳无效`);
      }
      startMs = a; endMs = b;
    }
    const line = text.trim();
    if (!line) continue; // 上游同样丢掉没有任何字符的段
    rows.push({ startMs, endMs, text: line });
  }
  return rows;
}

/**
 * 把句段拼成可翻页的纯文本。
 *
 * 与 `getTranscript` 同口径（`[mm:ss] 正文`，`timestampEverySec` 可聚合），
 * 这样「官方字幕」与「本地转写」两条来源的输出能直接互相替换。
 */
export function renderTranscript(segments, { withTimestamps = true, timestampEverySec = 0 } = {}) {
  if (!segments.length) return '';
  if (timestampEverySec > 0) {
    const blocks = [];
    let block = -1;
    for (const segment of segments) {
      const index = Math.floor((segment.startMs ?? 0) / (timestampEverySec * 1000));
      if (index !== block) {
        block = index;
        blocks.push(withTimestamps ? `[${clock(segment.startMs ?? 0)}] ${segment.text}` : segment.text);
      } else {
        blocks[blocks.length - 1] += ` ${segment.text}`;
      }
    }
    return blocks.join('\n');
  }
  return segments.map((s) => (withTimestamps ? `[${clock(s.startMs ?? 0)}] ${s.text}` : s.text)).join('\n');
}

/** Markdown 粗稿：与上游 `local.ts` 的 `transcript.md` 同格式（显式声明「未做总结」）。 */
export function renderMarkdown(segments) {
  const body = segments.map((s) => (s.startMs === null
    ? `[时间未知] ${s.text}`
    : `[${clock(s.startMs)}–${clock(s.endMs)}] ${s.text}`));
  return [
    '# 音频转写粗稿',
    '',
    '本地识别模型的输出，未做总结；公式、数字和作业要求需结合课件核对。',
    '',
    ...body.flatMap((line) => [line, '']),
  ].join('\n');
}

/**
 * 校验输入文件存在且是普通文件。
 *
 * 只做 stat，不读内容：一节 90 分钟的 WAV 近 300 MB，读进来只是为了检查很浪费。
 */
async function requireFile(file) {
  let stats;
  try { stats = await stat(file); } catch (error) {
    if (error.code === 'ENOENT') throw new ClassroomError('INVALID_INPUT', `音频文件不存在：${path.basename(file)}`);
    throw error;
  }
  if (!stats.isFile()) throw new ClassroomError('INVALID_INPUT', `转写输入不是普通文件：${path.basename(file)}`);
  if (stats.size === 0) throw new ClassroomError('INVALID_INPUT', `转写输入是空文件：${path.basename(file)}`);
  return stats.size;
}

/**
 * 转写一个本地音视频文件，结果落盘到 `directory`。
 *
 * ## 返回形状
 *
 * ```js
 * {
 *   directory, markdown,                                   // 落盘位置
 *   segments: [{ startMs, endMs, text }],                   // 结构化句段
 *   text, totalCharacters, durationMs,                      // 便于直接读
 *   engine, reused, bytes,
 * }
 * ```
 *
 * `reused` 为真表示命中缓存（同一文件 + 同一内核签名），没有再跑一遍识别 ——
 * 一节课几分钟，重跑一次的代价用户能直接感觉到。
 *
 * ## 超时与磁盘
 *
 * - 超时由 `withTimeout` 兜（默认 30 分钟），超时会 `abort` 让内核收手；
 * - 落盘是**原子**的：先写 `<dir>/.transcript-<random>.tmp/`，齐了再 `rename`
 *   成目标目录。半份结果比没有结果更难辨别；
 * - 中间 WAV / 临时目录在 `finally` 里删除：一节课近 300 MB。
 */
export async function transcribeFile(transcriber, {
  file, directory, signal, timeoutMs = DEFAULT_TRANSCRIBE_TIMEOUT_MS, engine = null,
} = {}) {
  if (!path.isAbsolute(file ?? '')) throw new ClassroomError('INVALID_INPUT', '转写输入须为绝对路径');
  if (!path.isAbsolute(directory ?? '')) throw new ClassroomError('INVALID_INPUT', '转写输出目录须为绝对路径');
  const transcribe = assertTranscriber(transcriber);
  const input = path.resolve(file), target = path.resolve(directory);
  const bytes = await requireFile(input);
  signal?.throwIfAborted();

  await mkdir(target, { recursive: true });
  const cacheFile = path.join(target, 'transcribe.json');
  let cached = null;
  try { cached = JSON.parse(await readFile(cacheFile, 'utf8')); } catch { /* 没有缓存或已损坏：重新转 */ }
  if (cached?.file === input && cached?.bytes === bytes && (engine === null || cached?.engine === engine)) {
    return { ...cached.result, directory: target, reused: true, bytes };
  }

  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const stage = path.join(target, `.transcript-${process.pid}-${Date.now().toString(36)}.tmp`);
  await mkdir(stage, { recursive: true });
  try {
    const output = await withTimeout(
      Promise.resolve().then(() => transcribe({ file: input, directory: stage, signal: combined })),
      timeoutMs,
      () => controller.abort(),
    );
    combined.throwIfAborted();
    const segments = normalizeSegments(output?.segments);
    if (!segments.length) throw new ClassroomError('NO_TEXT', '没有识别到有效文本，请确认音频里有声音');

    const text = segments.map((s) => s.text).join('\n');
    const last = segments[segments.length - 1];
    const value = {
      directory: target,
      markdown: path.join(target, 'transcript.md'),
      segments,
      text,
      totalCharacters: text.length,
      durationMs: last?.endMs ?? null,
      engine: output?.engine ?? engine ?? null,
      reused: false,
      bytes,
    };
    // 先写阶段目录，齐了再换正式名；中途失败时 target 里不会留下半份结果。
    await writeFile(path.join(stage, 'segments.json'), `${JSON.stringify(segments, null, 2)}\n`, { mode: 0o600 });
    await writeFile(path.join(stage, 'transcript.txt'), `${text}\n`, { mode: 0o600 });
    await writeFile(path.join(stage, 'transcript.md'), renderMarkdown(segments), { mode: 0o600 });
    await writeFile(path.join(stage, 'transcribe.json'), `${JSON.stringify({
      file: input, bytes, engine: value.engine, result: { ...value, directory: undefined, markdown: undefined },
    }, null, 2)}\n`, { mode: 0o600 });
    await moveIntoPlace(stage, target);
    return value;
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * 把阶段目录里的四个文件搬进目标目录。
 *
 * 逐文件 `rename` 而不是整目录 `rename`：目标目录**已经存在**（缓存文件在里面），
 * `rename` 一个目录到已存在的目录会 `ENOTEMPTY`。逐文件移也没问题 ——
 * 它们同在一个目录里，`transcribe.json` 最后落，所以「看到缓存文件」等于
 * 「其余三个都已就位」。
 */
async function moveIntoPlace(stage, target) {
  for (const name of ['segments.json', 'transcript.txt', 'transcript.md', 'transcribe.json']) {
    await rename(path.join(stage, name), path.join(target, name)).catch(async (error) => {
      // Windows 上目标已存在时 rename 会失败；先删再搬（缓存语义本来就是要覆盖）。
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      await rm(path.join(target, name), { force: true });
      await rename(path.join(stage, name), path.join(target, name));
    });
  }
}
