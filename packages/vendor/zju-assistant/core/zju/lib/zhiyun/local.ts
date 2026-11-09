import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ConfigError } from "../core/errors.ts";
import { paths } from "../core/paths.ts";
import { writeJson, readJson } from "../core/fsjson.ts";
import { prepareAsr, transcribeAudio, parseSegments, type AsrOptions } from "./asr.ts";
import { extractLocalAudio } from "./media.ts";
import { sha256, validStage } from "./cache.ts";
function timestamp(seconds: number): string { const n=Math.floor(seconds);return [Math.floor(n/3600),Math.floor(n/60)%60,n%60].map(v=>String(v).padStart(2,'0')).join(':'); }
import { exists } from "./download.ts";

const key = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
async function audioMarkdown(result: { segments: string }): Promise<string> {
  const output = path.join(path.dirname(result.segments), "transcript.md");
  const segments = parseSegments(JSON.parse(await fs.readFile(result.segments, "utf8")));
  const body = ["# 音频转写粗稿", "", "SenseVoice 本地模型的识别结果，未做总结；公式、数字和作业要求需结合课件核对。", "",
    ...segments.flatMap(s => [`[${s.start === null ? "时间未知" : `${timestamp(s.start)}–${timestamp(s.end!)}`}] ${s.text}`, ""])].join("\n");
  try { await fs.writeFile(output, body, { flag: "wx", mode: 0o600 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; } // Preserve a manually edited rough draft.
  return output;
}
export interface LocalOperations { prepareAsr: typeof prepareAsr; transcribeAudio: typeof transcribeAudio; extractLocalAudio: typeof extractLocalAudio }
export async function localTranscribe(audioFile: string, directory: string, opts: AsrOptions = {}, overrides: Partial<LocalOperations> = {}) {
  const ops = { prepareAsr, transcribeAudio, extractLocalAudio, ...overrides };
  // 模型缺了在这里现下：转写是一条命令做完的事，不让调用方先去装。
  const audio = path.resolve(audioFile), dir = path.resolve(directory), info = await ops.prepareAsr(opts);
  const hash = await sha256(audio), cache = path.join(dir, "transcribe.json");
  await fs.mkdir(dir, { recursive: true });
  const lock = path.join(dir, "transcribe.lock"), handle = await fs.open(lock, "wx", 0o600).catch(() => { throw new ConfigError(`转写目录已锁定：${lock}`); });
  try {
    const old = readJson<{ key: string; files: { path: string; bytes: number; sha256: string }[]; result: unknown }>(cache);
    if (!old && await exists(cache)) throw new ConfigError("transcribe.json 损坏，请使用新目录");
    const signature = key({ audio: hash, signature: info.signature });
    if (await validStage(old, signature)) {
      const result = old!.result as { segments: string };
      return { ...result, markdown: await audioMarkdown(result), reused: true };
    }
    // 转成 16 kHz 单声道的那份音频只是中间产物，一节课近 300 MB；结果放在用户自己的文件夹里，用完就删。
    const normalized = path.join(dir, `audio-${randomUUID().slice(0, 8)}.wav`);
    const output = path.join(dir, `asr-sensevoice-${randomUUID().slice(0, 8)}`);
    let asr: Awaited<ReturnType<typeof transcribeAudio>>;
    try { await ops.extractLocalAudio(audio, normalized, "wav", opts.signal); asr = await ops.transcribeAudio(normalized, output, opts); }
    finally { await fs.unlink(normalized).catch(() => {}); }
    if (asr.signature !== info.signature) throw new ConfigError("ASR 环境在执行中变化，请重试");
    const result = { ...asr, segments: path.join(output, "segments.json"), metadata: path.join(output, "metadata.json"), text: path.join(output, "transcript.txt"), raw: path.join(output, "raw.json"), cache };
    const files = await Promise.all([result.segments, result.metadata, result.text, result.raw].map(async file => ({ path: file, bytes: (await fs.stat(file)).size, sha256: await sha256(file) })));
    writeJson(cache, { key: signature, files, result }); return { ...result, markdown: await audioMarkdown(result), reused: false };
  } finally { await handle.close(); await fs.unlink(lock).catch(() => {}); }
}
