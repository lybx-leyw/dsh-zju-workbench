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

import { mkdir, readFile, rm, rename, stat, writeFile } from 'node:fs/promises';
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

/** 句段规范化：只接受有限、单调、非负的时间戳；文字必须是非空字符串。 */
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
