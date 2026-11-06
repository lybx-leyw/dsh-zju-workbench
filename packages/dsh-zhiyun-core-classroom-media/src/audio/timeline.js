// 源：ref/OpenMAIC/lib/audio/narration-tts.ts:262-278（每段音频在入库时测一次时长）
// 源：ref/OpenMAIC/lib/audio/tts-utils.ts:200-229（上游的取舍：长文本切成多段，
//     每段一个独立文件，**不做字节拼接**）
//
// 上游不拼字节是有原因的（一段 mp3 的容器头不能简单首尾相接），本仓保留这条约定：
// `buildTimeline` 只排时间轴，不碰字节；只有"全是同格式 WAV"时才提供 `concatWav`，
// 因为那种情况下 PCM 负载直接相接确实是合法的 WAV。
//
// 导出链路（core-classroom-export）要的是"一条音轨 + 一张时间表"，两者都在这里。

import { MediaError } from '../errors.js';
import { measureAudioDuration } from './duration.js';
import { parseWavHeader, pcmS16leMonoToWav, sniffAudioContainer, wavPcmBytes } from './wav.js';

/**
 * 把多段 WAV 拼成一个。
 *
 * 前置条件：全部是 WAV，且采样率 / 声道 / 位深一致。不一致时**不重采样**
 * （那要引入 DSP 依赖），直接报 `E_INVALID_INPUT`，让调用方先转码。
 *
 * @param {Array<{bytes: Uint8Array|Buffer, text?: string}>} clips
 * @returns {{bytes: Buffer, format: 'wav', durationSeconds: number|null, sampleRate: number}}
 */
export function concatWav(clips) {
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new MediaError('E_INVALID_INPUT', '拼接需要至少一段音频', { field: 'clips' });
  }

  const parts = [];
  for (const clip of clips) {
    const bytes = clip?.bytes ?? clip;
    const parsed = wavPcmBytes(bytes);
    if (!parsed) {
      const sniffed = sniffAudioContainer(bytes);
      throw new MediaError('E_INVALID_INPUT', `第 ${parts.length + 1} 段不是 WAV（识别为 ${sniffed ?? '未知'}）`, {
        field: 'clips',
        format: sniffed ?? null,
      });
    }
    parts.push(parsed);
  }

  const first = parts[0];
  for (const part of parts) {
    if (
      part.sampleRate !== first.sampleRate
      || part.channels !== first.channels
      || part.bitsPerSample !== first.bitsPerSample
    ) {
      throw new MediaError('E_INVALID_INPUT', '各段 WAV 的采样率/声道/位深不一致，需先转码再拼接', {
        field: 'clips',
        expected: {
          sampleRate: first.sampleRate,
          channels: first.channels,
          bitsPerSample: first.bitsPerSample,
        },
      });
    }
  }

  const total = parts.reduce((sum, part) => sum + part.pcm.byteLength, 0);
  const merged = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part.pcm, offset);
    offset += part.pcm.byteLength;
  }

  // 只支持 16-bit mono 的封装器；其它位深/声道数说明上游给了不常见容器，
  // 这时退回"原样拼 PCM + 借用第一段头"是不安全的，直接报错。
  if (first.bitsPerSample !== 16 || first.channels !== 1) {
    throw new MediaError('E_INVALID_INPUT', '目前只支持拼接 16-bit 单声道 WAV', {
      field: 'clips',
      bitsPerSample: first.bitsPerSample,
      channels: first.channels,
    });
  }

  const bytes = Buffer.from(pcmS16leMonoToWav(merged, first.sampleRate));
  return {
    bytes,
    format: 'wav',
    durationSeconds: measureAudioDuration(bytes, 'wav'),
    sampleRate: first.sampleRate,
  };
}

/**
 * 排时间轴。
 *
 * 输入是一组已合成的音频片段（`bytes` 必须有；`text`/`voice` 原样带回，
 * 方便上游按 action 对账）。输出：
 *
 * ```
 * { totalMs, segments: [{ index, startMs, endMs, durationMs, format, text, voice, truncated }] }
 * ```
 *
 * 时长策略（与上游一致）：先按字节测；测不出来（非 WAV/MP3，或容器头损坏）时用
 * `estimatedDurationMs`（调用方按字符数估），两个都没有就记 `null` 并让该段时长为 0 ——
 * **不猜**，因为猜出来的时间轴会让字幕和配音错位，比缺一段更难查。
 *
 * @param {Array<{bytes?: Uint8Array|Buffer, format?: string, text?: string, voice?: string, estimatedDurationMs?: number}>} clips
 * @param {{gapMs?: number}} [options]
 */
export function buildTimeline(clips, options = {}) {
  if (!Array.isArray(clips)) {
    throw new MediaError('E_INVALID_INPUT', 'clips 必须是数组', { field: 'clips' });
  }
  const gapMs = Number.isFinite(options.gapMs) && options.gapMs > 0 ? options.gapMs : 0;

  const segments = [];
  let cursor = 0;
  clips.forEach((clip, index) => {
    const bytes = clip?.bytes;
    const sniffed = bytes ? sniffAudioContainer(bytes) : null;
    const measured = bytes ? measureAudioDuration(bytes, clip?.format ?? sniffed ?? undefined) : null;
    const durationSeconds = Number.isFinite(measured)
      ? measured
      : Number.isFinite(clip?.estimatedDurationMs)
        ? clip.estimatedDurationMs / 1000
        : null;
    const durationMs = durationSeconds === null ? 0 : Math.round(durationSeconds * 1000);
    const startMs = cursor;
    const endMs = startMs + durationMs;
    segments.push({
      index,
      startMs,
      endMs,
      durationMs,
      durationKnown: durationSeconds !== null,
      format: sniffed ?? clip?.format ?? null,
      text: clip?.text ?? '',
      voice: clip?.voice ?? null,
      truncated: durationSeconds === null,
    });
    cursor = endMs + gapMs;
  });

  return {
    totalMs: segments.length > 0 ? segments[segments.length - 1].endMs : 0,
    gapMs,
    segments,
  };
}

/** 拼 + 排时间轴，导出链路的单次调用。 */
export function renderNarrationTrack(clips, options = {}) {
  const timeline = buildTimeline(clips, options);
  const allWav = clips.length > 0 && clips.every((clip) => parseWavHeader(clip?.bytes ?? clip) !== null);
  const track = allWav ? concatWav(clips) : null;
  return {
    timeline,
    track,
    // 非全 WAV 时给出明确说明，而不是返回一条"看起来有音轨"的空 Buffer。
    trackNote: track ? null : '存在非 WAV 片段，未生成单文件音轨（上游同样不拼字节，见 tts-utils.ts:200-205）',
  };
}
