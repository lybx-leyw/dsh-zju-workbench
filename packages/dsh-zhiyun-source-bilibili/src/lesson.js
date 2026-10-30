/**
 * **编排入口**：一条 BV 号 → `ctx.zhiyunParser.parse()` 能直接吃的载荷。
 *
 * ```text
 * BVID
 *  ├→ view              元数据（aid / cid / 标题 / 时长）
 *  ├→ 字幕通道           subtitles[]（需登录态；无则 NO_CREDENTIAL）
 *  ├→ playurl           mp4 直链（fnval=1，单文件）
 *  ├→ framesFromUrl     下载 + 抽帧                    ┐
 *  ├→ triage.analyze    判型（不是 slides 就停）        ├ 画面这一半
 *  └→ segment           归并成 slides[]                ┘
 *       └→ { slides, subtitles }  ← 交给 parse()
 * ```
 *
 * # 为什么这里要「部分成功」
 *
 * 字幕和画面是**两条独立的路**，任何一条失败都不该让整条链路失败：
 *
 * | 情况 | 结果 |
 * | --- | --- |
 * | 字幕 ✅ 画面 ✅ | 完整（有课件锚点） |
 * | 字幕 ✅ 画面 ❌（判型不是 slides / 没有 ffmpeg） | **照常出讲义**，`slides: []` → 走 `transcript-only` 通道 |
 * | 字幕 ❌ 画面 ✅ | 有 slides 没字幕 —— `parse()` 能跑（`validateInput` 允许 `subtitles` 为空），但**没有正文** |
 * | 字幕 ❌ 画面 ❌ | 真的失败 |
 *
 * 所以本函数**不抛「画面失败」**，而是把它记进 `warnings` 并在返回值里如实说明。
 * 只有「两样都没有」才抛。
 *
 * # 为什么 `slides: []` 是合法的
 *
 * `dsh-zhiyun-core-parser` 的 `parse()` 对 `slides` 为空有专门分支：
 * `anchor()` 返回全部字幕进 `unassigned`，走 `transcriptWindows()` 按
 * 5500 字 / 160 行 / 15 秒停顿切卷，`evidenceKind: 'transcript-only'`。
 * 也就是说**纯口播视频本来就有出路**，不需要伪造页面依据。
 */

import path from 'node:path';

import { BilibiliError, ERROR_CODE } from './errors.js';
import { resolveLesson } from './subtitle-channel.js';
import { fetchPlayUrl } from './playurl.js';
import { framesFromUrl } from './frames.js';
import { analyze } from './triage.js';
import { slidesFromFrames, validateSlides } from './segment.js';

/** 默认采样间隔（秒）。实测 5 秒对 20 分钟的课产出 239 帧，判型与归并都够用。 */
export const DEFAULT_SAMPLE_SEC = 5;

/**
 * 一条 B 站视频 → `parse()` 的输入。
 *
 * @param options.bvid - BV 号。
 * @param options.credential - 登录凭证（字幕需要；360P 抽帧不需要）。
 * @param options.workDir - 抽帧工作目录（**由调用方给**，本包不猜路径）。
 * @param options.sampleSec - 采样间隔（默认 5）。
 * @param options.withFrames - 是否抽帧（默认 `true`；`false` 时只取字幕，用于快速验证）。
 * @param options.quality - 播放清晰度（默认 16 = 360P）。
 * @param options.spawnImpl / ffmpeg - 透传给 `frames.js`（测试注入用）。
 * @param options.signal - 中止信号。
 * @param options.onProgress - `({ phase, ... })`。
 * @returns `{ slides, subtitles, meta, picture, warnings }`。
 */
export async function buildLesson({
  bvid,
  credential = null,
  workDir = null,
  sampleSec = DEFAULT_SAMPLE_SEC,
  withFrames = true,
  quality = 16,
  spawnImpl,
  ffmpeg = 'ffmpeg',
  signal,
  onProgress,
  now,
} = {}) {
  const warnings = [];

  // ── ① 元数据（必须成功：没有 aid/cid 后面全都做不了）──────────
  onProgress?.({ phase: 'meta' });
  const lesson = await resolveLesson({ bvid, credential, signal, now });
  const meta = {
    bvid: lesson.bvid,
    aid: lesson.aid,
    cid: lesson.cid,
    title: lesson.title,
    owner: lesson.owner,
    durationSec: lesson.durationSec,
    lan: lesson.lan,
  };
  // ⚠️ `resolveLesson` 把字幕失败**降级**成 warning + subtitleError（元数据仍然成功）。
  // 那份警告与错误必须**原样透传**上来 —— 早先这里只取了 7 个字段，
  // 于是 `subtitleError` 与「字幕需要登录」那条 warning 全被吞掉，
  // 调用方看到的是「0 条字幕 + 没有任何解释」，无法判断是「没登录」还是「这视频没字幕」。
  if (Array.isArray(lesson.warnings)) warnings.push(...lesson.warnings);
  const subtitleError = lesson.subtitleError ?? null;

  // ── ② 画面（可失败，失败只记 warning）────────────────────────
  let picture = { extracted: false, pages: 0, frames: 0, verdict: null, reason: '未启用抽帧', dropped: 0 };
  let slides = [];

  if (withFrames) {
    if (!workDir) {
      // 这不是「画面失败」，是我们拿不到落盘位置 —— 要说清楚，别让它看起来像视频的问题。
      warnings.push('未提供 workDir，跳过抽帧：无法决定帧图落在哪里');
      picture.reason = '未提供 workDir';
    } else {
      try {
        onProgress?.({ phase: 'playurl' });
        const play = await fetchPlayUrl({
          aid: lesson.aid, cid: lesson.cid, bvid: lesson.bvid, quality, credential, signal,
        });
        onProgress?.({ phase: 'frames', quality: play.quality, bytes: play.lengthBytes });

        const { frames } = await framesFromUrl({
          url: play.url,
          workDir,
          everySec: sampleSec,
          spawnImpl,
          ffmpeg,
          signal,
          onProgress: (event) => onProgress?.({ ...event, stage: 'frames' }),
        });
        if (frames.length === 0) {
          warnings.push('抽帧返回 0 张图（视频可能极短，或 ffmpeg 静默失败）');
          picture.reason = '抽帧得到 0 张图';
        } else {
          // 判型要看**签名距离**，这里只喂「帧位置」还不够 —— 但 `analyze` 需要签名。
          // 所以本入口把判型交给调用方在拿到签名后再做；这里只做「有没有帧」的判断。
          // ⚠️ 之所以不在本文件算签名：那需要 sharp/图像解码，属于调用方的能力面。
          picture = {
            extracted: false, pages: 0, frames: frames.length, verdict: null, dropped: 0,
            reason: '等待判型（需要帧签名）',
            // 把帧交出去，由调用方「算签名 → 判型 → 归并」。
            frames,
            playUrl: { quality: play.quality, segments: play.segments, bytes: play.lengthBytes },
          };
        }
      } catch (error) {
        if (error?.code === ERROR_CODE.CANCELLED) throw error;
        // 画面失败**不抛**：字幕还能用，讲义还能出（只是没有课件锚点）。
        warnings.push(`抽帧未完成：${error?.message ?? error}`);
        picture = { extracted: false, pages: 0, frames: 0, verdict: null, dropped: 0, reason: error?.message ?? String(error) };
      }
    }
  }

  return { slides, subtitles: lesson.subtitles, meta, picture, warnings, subtitleError: lesson.subtitleError ?? null };
}

/**
 * 把 `buildLesson` 交出来的帧接着做完：算签名 → 判型 → 归并。
 *
 * **单独一步**是因为它需要图像解码能力（`sharp` 或 canvas），
 * 而本包**不把 `sharp` 写进 dependencies** —— 那会让包变重，
 * 且工作台的客户端侧根本没有 sharp。由调用方注入 `signOf`。
 *
 * @param options.frames - `[{ index, timeSec, path }]`。
 * @param options.signOf - `(framePath) => Promise<Uint8Array>`，算签名（96×54 灰度）。
 * @param options.sampleSec - 采样间隔（用于校验帧的 timeSec 是否对得上）。
 * @returns `{ slides, pages, picture, warnings }`。
 */
export async function finishFrames({ frames, signOf, sampleSec = DEFAULT_SAMPLE_SEC } = {}) {
  const warnings = [];
  const list = Array.isArray(frames) ? frames : [];
  if (list.length === 0) {
    return { slides: [], pages: [], picture: { extracted: false, verdict: null, reason: '没有帧' }, warnings: ['没有帧可处理'] };
  }
  if (typeof signOf !== 'function') {
    throw new BilibiliError(ERROR_CODE.INPUT, 'finishFrames 需要 signOf（帧 → 96×54 灰度签名）', { field: 'signOf' });
  }

  // 算签名：逐帧解码。**这一层可能慢**（239 帧约 3 秒），所以放外面由调用方驱动。
  const signed = [];
  for (const frame of list) {
    signed.push({ timeSec: frame.timeSec, path: frame.path, signature: await signOf(frame.path) });
  }

  const { profile, verdict } = analyze(signed.map((frame) => frame.signature));
  const result = slidesFromFrames(signed, verdict, { threshold: 6 });
  const check = result.extracted ? validateSlides(result.slides) : { ok: true, issues: [] };
  if (!check.ok) {
    // 契约自检失败是**我们自己的 bug**，必须响亮地报出来，不能把坏产物交下去。
    throw new BilibiliError(ERROR_CODE.API_SHAPE,
      `「帧 → 页」产物未通过契约自检：${check.issues.slice(0, 3).join('；')}`, { stage: 'segment' });
  }
  return {
    slides: result.slides,
    pages: result.pages,
    picture: {
      extracted: result.extracted,
      pages: result.slides.length,
      frames: signed.length,
      verdict,
      profile,
      dropped: result.dropped,
      reason: result.reason,
      sampleSec,
    },
    warnings,
  };
}
