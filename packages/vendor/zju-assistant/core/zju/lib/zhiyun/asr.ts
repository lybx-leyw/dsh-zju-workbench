/**
 * 本地转写：SenseVoiceSmall（ONNX，int8）在 CPU 上跑，不需要 Python。
 * 运行库（sherpa-onnx-node）和模型文件都是应用里「语音输入」用的那一份：运行库随应用打包；模型在
 * <DSH_HOME>/speech-to-text/sensevoice/models，两边谁先用谁下载，地址、大小和 SHA-256 读语音包自带的清单。
 * 语音包自己的接口转不了整节课：一段录音限 4 MB，只给一整段文字、没有时间。所以这里只借运行库和模型。
 */
import fs from "node:fs/promises";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { BadResponse, ConfigError, TransportError, ZjuError } from "../core/errors.ts";
import { profileDir } from "../core/paths.ts";
import { fileSize, log } from "../core/output.ts";
import { writeJson } from "../core/fsjson.ts";
import { sha256 } from "./cache.ts";
import { Transfer, downloadFile, exists } from "./download.ts";

export interface AsrOptions { signal?: AbortSignal }
export interface AsrInfo { engine: "sensevoice"; runtime: "sherpa-onnx"; device: "cpu"; model: string; signature: string; versions: Record<string, string> }
export interface Segment { start: number | null; end: number | null; text: string }

const PROVIDER = "@deepseek-ai/dsh-experimental-speech-to-text-sensevoice";
const ORIGINS = ["https://huggingface.co", "https://hf-mirror.com"];
const RATE = 16000, WINDOW = 512;
/**
 * 断句和识别的做法，改了要把 version 加一（转写缓存按它失效）。
 * 2026-10-09 拿一节 148 分钟的录播实测：照语音输入的设置（阈值 0.5，断出来的每一段单独识别）会丢句首句尾的字，
 * 「对吧」399 次只剩 300 次；把相邻的段并成不超过 15 秒的一块、两头各留 0.3 秒、阈值放到 0.3 之后，
 * 和原来的 PyTorch 版只差同音字。int8 和 fp32 权重在同样设置下没有差别。
 */
const RECIPE = { version: 1, mergeSeconds: 15, padSeconds: 0.3, threshold: 0.3, minSilenceSeconds: 0.5, minSpeechSeconds: 0.1, maxSpeechSeconds: 30 } as const;

interface Asset { name: string; url: string; bytes: number; sha256: string }
interface Detector { acceptWaveform(samples: Float32Array): void; isEmpty(): boolean; front(external: boolean): { start: number; samples: Float32Array }; pop(): void; flush(): void }
interface Stream { acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void }
interface Decoded { text: string; lang?: string; emotion?: string; event?: string; tokens?: string[]; timestamps?: number[] }
interface Recognizer { createStream(): Stream; decode(stream: Stream): void; getResult(stream: Stream): Decoded }
interface Sherpa { OfflineRecognizer: new (config: object) => Recognizer; Vad: new (config: object, bufferSeconds: number) => Detector }
interface Ready { info: AsrInfo; sherpa: Sherpa; model: string; tokens: string; vad: string }

function runtime(): { sherpa: Sherpa; version: string; files: { asset: Asset; file: string }[] } {
  const here = createRequire(import.meta.url);
  let provider: string;
  try { provider = here.resolve(`${PROVIDER}/package.json`); }
  catch (cause) { throw new ZjuError("DEPENDENCY_MISSING", "找不到应用自带的语音识别运行库", { hint: "转写用的是校园智能体应用里「语音输入」的运行库，ZJU Core 要在应用目录里运行", cause }); }
  const lock = JSON.parse(readFileSync(path.join(path.dirname(provider), "runtime", "assets.json"), "utf8")) as { models: { int8: Asset }; tokens: Asset; vad: Asset };
  const scoped = createRequire(provider);
  let sherpa: Sherpa;
  try { sherpa = scoped("sherpa-onnx-node") as Sherpa; }
  catch (cause) { throw new ZjuError("DEPENDENCY_MISSING", `语音识别运行库在这台机器上加载不了（${process.platform}-${process.arch}）`, { cause }); }
  const home = process.env["DSH_HOME"]?.trim() || path.join(path.dirname(profileDir()), "home");
  const root = path.join(home, "speech-to-text", "sensevoice", "models");
  return { sherpa, version: (scoped("sherpa-onnx-node/package.json") as { version: string }).version, files: [
    { asset: lock.models.int8, file: path.join(root, "sensevoice-onnx", lock.models.int8.name) },
    { asset: lock.tokens, file: path.join(root, "sensevoice-onnx", lock.tokens.name) },
    { asset: lock.vad, file: path.join(root, "silero", lock.vad.name) },
  ] };
}
async function matches(file: string, asset: Asset): Promise<boolean> {
  try { return (await fs.stat(file)).size === asset.bytes && await sha256(file) === asset.sha256; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw e; }
}
/** 先回应的来源排前面；都不回应就按原顺序试。 */
async function ordered(urls: string[], signal?: AbortSignal): Promise<string[]> {
  const probing = AbortSignal.any([AbortSignal.timeout(3000), ...(signal ? [signal] : [])]);
  const first = await Promise.any(urls.map(async url => {
    const response = await fetch(url, { method: "HEAD", signal: probing });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return url;
  })).catch(() => undefined);
  signal?.throwIfAborted();
  return first ? [first, ...urls.filter(url => url !== first)] : urls;
}
/** 下到旁边的临时文件，校验通过才换成正式名字；语音输入那边读到的要么没有、要么是完整的。 */
async function fetchAsset(asset: Asset, destination: string, signal?: AbortSignal): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const partial = `${destination}.zju.part`;
  const place = async () => { if (await matches(destination, asset)) await fs.rm(partial, { force: true }); else await fs.rename(partial, destination); };
  if (await matches(partial, asset)) return place();
  await fs.rm(partial, { force: true });
  const pathname = new URL(asset.url).pathname, urls = await ordered(ORIGINS.map(origin => new URL(pathname, origin).href), signal);
  const transfer = new Transfer({ threads: 4, retries: 2, timeoutMs: 120_000, ...(signal ? { signal } : {}) });
  let failure: unknown;
  for (const url of urls) {
    log(`下载转写模型 ${asset.name}（${fileSize(asset.bytes)}），来源 ${new URL(url).host}`);
    try {
      await downloadFile(transfer, url, { out: partial });
      if (!await matches(partial, asset)) throw new BadResponse(`${asset.name} 下载后校验不符`);
      return await place();
    } catch (error) {
      if (signal?.aborted) throw error;
      failure = error; await fs.rm(partial, { force: true });
    }
  }
  throw new TransportError(`转写模型 ${asset.name} 下载失败`, { sources: urls.map(url => new URL(url).host), reason: failure instanceof Error ? failure.message : String(failure) }, failure);
}

let verified: Promise<Ready> | undefined;
/** 模型齐了并且校验通过才算就绪；download 为真时缺的现下。同一进程里只校验一次。 */
function ready(download: boolean, signal?: AbortSignal): Promise<Ready & { downloaded: string[] }> {
  const attempt = (async () => {
    const { sherpa, version, files } = runtime(), downloaded: string[] = [];
    for (const { asset, file } of files) {
      if (await matches(file, asset)) continue;
      if (!download) throw new ZjuError("DEPENDENCY_MISSING", `转写模型还没有下载（缺 ${asset.name}，全部约 ${fileSize(files.reduce((sum, f) => sum + f.asset.bytes, 0))}）`, { hint: "zju zhiyun trans audio 第一次转写时会自己下载；只想先备好，运行 zju zhiyun setup --component asr" });
      await fetchAsset(asset, file, signal); downloaded.push(asset.name);
    }
    const [model, tokens, vad] = files as [typeof files[number], typeof files[number], typeof files[number]];
    const versions = { "sherpa-onnx-node": version };
    const signature = createHash("sha256").update(JSON.stringify({ engine: "sensevoice-onnx", versions, weights: files.map(f => f.asset.sha256), recipe: RECIPE })).digest("hex");
    return { info: { engine: "sensevoice", runtime: "sherpa-onnx", device: "cpu", model: model.asset.name, signature, versions } as AsrInfo,
      sherpa, model: model.file, tokens: tokens.file, vad: vad.file, downloaded };
  })();
  verified = attempt; attempt.catch(() => { if (verified === attempt) verified = undefined; });
  return attempt;
}
/** 只看不下：模型不齐时报缺依赖。 */
export async function checkAsr(): Promise<AsrInfo> { return (await (verified ?? ready(false))).info; }
/** 缺的模型现下，返回就绪的环境和这一次下了哪些文件。 */
export async function prepareAsr(opts: AsrOptions = {}): Promise<AsrInfo & { downloaded: string[] }> {
  const state = await ready(true, opts.signal);
  return { ...state.info, downloaded: state.downloaded };
}

/** 找到 data 块：FFmpeg 写的 WAV 在它前面常有 LIST 块，不能假定文件头是 44 字节。 */
function openWave(file: string): { fd: number; offset: number; samples: number } {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(12), chunk = Buffer.alloc(8), format = Buffer.alloc(16);
    if (readSync(fd, head, 0, 12, 0) < 12 || head.toString("latin1", 0, 4) !== "RIFF" || head.toString("latin1", 8, 12) !== "WAVE") throw new ConfigError("转写输入不是 WAV");
    let pcm = false;
    for (let offset = 12; ;) {
      if (readSync(fd, chunk, 0, 8, offset) < 8) throw new ConfigError("WAV 里没有音频数据");
      const id = chunk.toString("latin1", 0, 4), size = chunk.readUInt32LE(4);
      if (id === "fmt ") pcm = readSync(fd, format, 0, 16, offset + 8) === 16 && format.readUInt16LE(0) === 1 && format.readUInt16LE(2) === 1 && format.readUInt32LE(4) === RATE && format.readUInt16LE(14) === 16;
      if (id === "data") {
        if (!pcm) throw new ConfigError("转写输入必须为 16 kHz 单声道 16-bit PCM WAV");
        if (size < 2) throw new ConfigError("音频为空");
        return { fd, offset: offset + 8, samples: Math.floor(size / 2) };
      }
      offset += 8 + size + (size % 2);
    }
  } catch (error) { closeSync(fd); throw error; }
}
function readSamples(wave: { fd: number; offset: number }, from: number, count: number): Float32Array {
  const bytes = Buffer.allocUnsafe(count * 2), got = readSync(wave.fd, bytes, 0, bytes.length, wave.offset + from * 2) >> 1;
  const samples = new Float32Array(got);
  for (let i = 0; i < got; i++) samples[i] = bytes.readInt16LE(i * 2) / 32768;
  return samples;
}
/** 识别是同步的原生调用；每做完一小块让一次步，取消信号才收得到。 */
async function breathe(signal?: AbortSignal): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
  signal?.throwIfAborted();
}

/** 16 kHz 单声道 WAV → out 目录下的 segments.json、transcript.txt、raw.json、metadata.json。out 已存在时不覆盖。 */
export async function transcribeAudio(audio: string, out: string, opts: AsrOptions = {}): Promise<AsrInfo & { directory: string; durationSeconds: number; segmentCount: number }> {
  const { info, sherpa, model, tokens, vad } = await (verified ?? ready(false));
  const source = path.resolve(audio), target = path.resolve(out);
  if (await exists(target)) throw new ConfigError(`输出已存在，不覆盖：${target}`);
  const wave = openWave(source), duration = wave.samples / RATE, threads = Math.max(1, Math.min(4, os.availableParallelism()));
  const stage = path.join(path.dirname(target), `.${path.basename(target)}.stage-${randomUUID()}`);
  log(`本地转写：${path.basename(source)}（${Math.round(duration / 60)} 分钟）`);
  try {
    const began = performance.now();
    const recognizer = new sherpa.OfflineRecognizer({ featConfig: { sampleRate: RATE, featureDim: 80 },
      modelConfig: { senseVoice: { model, language: "zh", useInverseTextNormalization: 1 }, tokens, numThreads: threads, provider: "cpu", debug: 0 } });
    const detector = new sherpa.Vad({ sileroVad: { model: vad, threshold: RECIPE.threshold, minSilenceDuration: RECIPE.minSilenceSeconds, minSpeechDuration: RECIPE.minSpeechSeconds, maxSpeechDuration: RECIPE.maxSpeechSeconds, windowSize: WINDOW },
      sampleRate: RATE, numThreads: 1, provider: "cpu", debug: 0 }, RECIPE.maxSpeechSeconds + 2);
    const loaded = performance.now();

    // 第一遍只断句：记下每段话的起止，音频不留在内存里。
    const speech: [number, number][] = [];
    const drain = () => { while (!detector.isEmpty()) { const found = detector.front(false); speech.push([found.start, found.start + found.samples.length]); detector.pop(); } };
    for (let done = 0; done < wave.samples;) {
      const samples = readSamples(wave, done, Math.min(WINDOW * 312, wave.samples - done));
      if (!samples.length) break;
      for (let i = 0; i < samples.length; i += WINDOW) { detector.acceptWaveform(samples.subarray(i, i + WINDOW)); drain(); }
      done += samples.length; await breathe(opts.signal);
    }
    detector.flush(); drain();

    // 第二遍：相邻的段并成一块再识别，两头留余量，块与块的余量不重叠。
    const limit = RECIPE.mergeSeconds * RATE, pad = Math.round(RECIPE.padSeconds * RATE), blocks: [number, number][] = [];
    for (const [start, end] of speech) {
      const last = blocks.at(-1);
      if (last && end - last[0] <= limit) last[1] = end; else blocks.push([start, end]);
    }
    const rows: (Decoded & { start: number; end: number })[] = [];
    for (const [index, [start, end]] of blocks.entries()) {
      const from = Math.max(index ? Math.ceil((blocks[index - 1]![1] + start) / 2) : 0, start - pad);
      const to = Math.min(index + 1 < blocks.length ? Math.floor((end + blocks[index + 1]![0]) / 2) : wave.samples, end + pad);
      const stream = recognizer.createStream();
      stream.acceptWaveform({ sampleRate: RATE, samples: readSamples(wave, from, to - from) });
      recognizer.decode(stream);
      const { text, lang, emotion, event, tokens: pieces, timestamps } = recognizer.getResult(stream);
      rows.push({ start: start / RATE, end: end / RATE, text: text.trim(), ...(lang ? { lang } : {}), ...(emotion ? { emotion } : {}), ...(event ? { event } : {}), ...(pieces ? { tokens: pieces } : {}), ...(timestamps ? { timestamps } : {}) });
      if (blocks.length >= 50 && (index + 1) % Math.ceil(blocks.length / 5) === 0 && index + 1 < blocks.length) log(`转写进度 ${Math.round(100 * (index + 1) / blocks.length)}%`);
      await breathe(opts.signal);
    }
    const finished = performance.now();
    // 只去掉没有任何字的段；不总结、不改字。
    const segments: Segment[] = rows.filter(row => /[A-Za-z0-9㐀-鿿]/.test(row.text)).map(({ start, end, text }) => ({ start, end, text }));
    if (!segments.length) throw new BadResponse("没有识别到有效文本");

    const metadata = { ...info, audioSha256: await sha256(source), durationSeconds: duration, loadSeconds: (loaded - began) / 1000, inferenceSeconds: (finished - loaded) / 1000,
      threads, recipe: RECIPE, timestampKind: "merged_vad", cleanup: "segments without any letter, digit or CJK character removed; no summarization or correction" };
    await fs.mkdir(stage, { recursive: true });
    writeJson(path.join(stage, "raw.json"), { speech: speech.map(([start, end]) => [start / RATE, end / RATE]), blocks: rows });
    writeJson(path.join(stage, "segments.json"), segments);
    writeJson(path.join(stage, "metadata.json"), metadata);
    await fs.writeFile(path.join(stage, "transcript.txt"), segments.map(s => s.text).join("\n") + "\n", { mode: 0o600 });
    await fs.rename(stage, target);
    return { ...metadata, directory: target, segmentCount: segments.length };
  } catch (error) {
    // stage 是本次调用在输出目录旁边新建的、带固定前缀和随机后缀的目录。
    await fs.rm(stage, { recursive: true, force: true });
    throw error;
  } finally { closeSync(wave.fd); }
}

export function parseSegments(value: unknown): Segment[] {
  if (!Array.isArray(value) || !value.length) throw new BadResponse("转写结果缺少句段");
  return value.map(row => {
    if (!row || typeof row !== "object" || typeof row.text !== "string") throw new BadResponse("转写句段格式无效");
    const { start, end, text } = row;
    if ((start === null) !== (end === null) || (start !== null && (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start))) throw new BadResponse("转写时间戳无效");
    return { start, end, text };
  });
}
