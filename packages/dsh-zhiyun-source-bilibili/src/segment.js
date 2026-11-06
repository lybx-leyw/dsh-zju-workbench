/**
 * **「帧 → 页」归并**（纯函数，零 IO）。
 *
 * # 它解决什么
 *
 * 抽帧产出的是一串**等间隔**的图（比如每 5 秒一张）。但 `dsh-zhiyun-core-parser`
 * 的 `validateInput()` 要求：
 *
 * ```js
 * if (!Number.isInteger(slide.page) || slide.page < 1 || pages.has(slide.page))
 *   throw new ParserError('INPUT', '课件页码重复或无效');
 * ```
 *
 * 同一页停留 10 分钟会产出几十张几乎一样的图 —— **直接喂进去就是重复页码**，
 * 整节课 `INPUT` 错。所以必须先把帧归并成「页」。
 *
 * # 判据：双条件（实测标定，见 README）
 *
 * ```text
 * step  = d(f[i-1], f[i])     相邻差
 * drift = d(runStart, f[i])   与本段首帧的累积差
 * step < T && drift < T  →  留在当前段
 * 否则                   →  开新段
 * ```
 *
 * **两条各防什么（实测，不是读代码猜的）**：
 *
 * | 场景 | 只用 `step` | 只用 `drift` | 双条件 |
 * | --- | ---: | ---: | ---: |
 * | 缓慢平移，每帧差 0.5 | **1 段** ❌ | 20 段 | 4 段 ✅ |
 * | 页内动画，每帧差 1 | **1 段** ❌ | 10 段 | 4 段 ✅ |
 * | 硬切页（10 → 200） | 2 段 ✅ | 2 段 ✅ | 2 段 ✅ |
 *
 * `step` 防「硬切漏检」，`drift` 防「整段被吞成一页」。
 *
 * # 阈值 T 的取值：**[6, 8]，不是上游的 3.0**
 *
 * 实测（青教赛 239 帧）：T=3 把 2 页的视频切成 **85 段**（过切 40 倍）。
 * T ∈ [6,8] 在 5/10/15/20 秒四种采样间隔下给出**完全相同**的段数 —— 这是稳定区间。
 *
 * # 为什么「段末出图、段首计时」
 *
 * | 取错 | 症状 |
 * | --- | --- |
 * | 段末帧 + 段末时间 | `anchor()` 会把这一页本该接住的字幕分给下一页 —— 整体错位一页 |
 * | 段首帧 + 段首时间 | 图可能是淡入中间态、代码打到一半 |
 *
 * `anchor()`（`core-parser/src/core.js`）用 `createdSec` 把字幕分进各页时间窗，
 * 且**要求严格递增**（否则报「存在重复时间锚点」）。
 */

import { JUMP_FLOOR, KIND } from './triage.js';

/**
 * 默认的段内阈值。
 *
 * 取 **6**：实测扫描中，T=6 与 T=8 在四种采样间隔下给出相同段数；
 * 6 是这一稳定区间的下沿，对「轻微渐变」更敏感一点。
 */
export const DEFAULT_THRESHOLD = 6;

/** 阈值允许的上界（超过它开始吃掉采样间隔这个无关变量，实测在 T=12 出现）。 */
export const MAX_THRESHOLD = 12;

/** 每页最短时长（秒）。短于它的段多半是转场半帧，不值得单独成页。 */
export const MIN_PAGE_SECONDS = 3;

/**
 * 把帧序列切成「页」。
 *
 * @param frames - `[{ timeSec, signature }]`，**按 timeSec 升序**（调用方保证）。
 * @param options.threshold - 段内阈值 T（默认 6）。
 * @param options.minPageSeconds - 每页最短时长，短于此的段会被并入**前一段**
 *        （默认 3）。并入时**不改变前一段选中的帧** —— 见下方说明。
 * @returns `{ pages }`，每页 `{ index, fromSec, toSec, frameFrom, frameTo, pickFrame }`。
 *          **注意：这里只给「页的时间区间与帧下标」，不产出 `page` / `createdSec`** ——
 *          那两步要等收集完所有页才能做（见 `buildSlides`）。
 *
 * # 为什么并入时不能改前一段的 `pickFrame`
 *
 * `pickFrame` 是**交付图**（段末那张）。曾有实现把过短段的帧也算进
 * 前一段的区间，于是 `pickFrame` 变成「转场半帧」—— 交付给 vision 的是
 * 一张淡入到一半的图，而 `createdSec` 还是对的，**不报错也看不出来**。
 *
 * 所以并入只延伸 `toSec` / `frameTo`（**溯源区间**），
 * `pickFrame` 保持原值（**交付图**）。两者分开是刻意的。
 */
export function segmentFrames(frames, { threshold = DEFAULT_THRESHOLD, minPageSeconds = MIN_PAGE_SECONDS } = {}) {
  const list = Array.isArray(frames) ? frames.filter((frame) => frame && Number.isFinite(frame.timeSec)) : [];
  if (list.length === 0) return { pages: [] };
  if (list.length === 1) {
    return {
      pages: [{ index: 0, fromSec: list[0].timeSec, toSec: list[0].timeSec, frameFrom: 0, frameTo: 0, pickFrame: 0 }],
    };
  }
  const limit = Number.isFinite(threshold) ? Math.min(Math.max(threshold, 1), MAX_THRESHOLD) : DEFAULT_THRESHOLD;

  /** 段 = 帧下标的连续区间。 */
  const runs = [[0]];
  for (let index = 1; index < list.length; index += 1) {
    const step = distanceOf(list[index - 1], list[index]);
    const drift = distanceOf(list[runs.at(-1)[0]], list[index]);
    if (step < limit && drift < limit) runs.at(-1).push(index);
    else runs.push([index]);
  }

  // 过短的段并入前一段：转场半帧、淡入中间态会在换页前后各留一帧，
  // 不并的话每次换页都多出两个「只有 1 帧」的假页。
  const merged = [];
  for (const run of runs) {
    const from = list[run[0]].timeSec;
    const to = list[run.at(-1)].timeSec;
    // 「过短」= 时长不够 **且** 帧数很少。两个条件都要 ——
    // 只用时长会误伤「因为采样间隔大，一个正常页只有 2 帧但跨了 20 秒」的情况。
    const tooShort = to - from < minPageSeconds && run.length <= 2;
    if (tooShort && merged.length > 0) {
      const previous = merged.at(-1);
      // 只延伸**溯源区间**，不动 `pickFrame`（交付图）。
      previous.frameTo = run.at(-1);
      previous.toSec = to;
    } else {
      merged.push({
        frameFrom: run[0],
        frameTo: run.at(-1),
        // 段末帧 = 交付图；太短的段即使被并进来，也轮不到它出图。
        pickFrame: run.at(-1),
        fromSec: from,
        toSec: to,
      });
    }
  }

  return {
    pages: merged.map((page, index) => ({
      index,
      fromSec: page.fromSec,
      toSec: page.toSec,
      frameFrom: page.frameFrom,
      frameTo: page.frameTo,
      pickFrame: page.pickFrame,
    })),
  };
}

/** 取两个帧的签名距离；签名缺失时回 0（视为同一页，不制造假页）。 */
function distanceOf(left, right) {
  const a = left?.signature;
  const b = right?.signature;
  if (!a || !b) return 0;
  const length = Math.min(a.length ?? 0, b.length ?? 0);
  if (length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += Math.abs(a[index] - b[index]);
  return sum / length;
}

/**
 * 把页区间落成**解析器要的 `slides[]`**。
 *
 * 这一步解决两个**必须**满足的契约：
 *
 * 1. **`page` 从 1 起、全局唯一** —— `validateInput()` 的硬校验。
 * 2. **`createdSec` 严格递增** —— `anchor()` 的分窗依赖它；重复时报
 *    「存在重复时间锚点，部分页时间窗为空」，那一页的窗口是空的，
 *    字幕全部落到别的页上。
 *
 * `createdSec` 取**段首**、`imagePath` 取**段末帧**（理由见文件头）。
 *
 * @param frames - `[{ timeSec, path, signature }]`。
 * @param pages - `segmentFrames` 的产物。
 * @returns `{ slides, dropped }`。`dropped` 是因 `createdSec` 撞车被合并掉的页数。
 */
export function buildSlides(frames, pages) {
  const list = Array.isArray(frames) ? frames : [];
  const source = Array.isArray(pages) ? pages : [];
  const slides = [];
  let dropped = 0;
  let lastCreated = -1;
  for (const page of source) {
    const first = list[page.frameFrom];
    // **交付图取 `pickFrame`，不取 `frameTo`** —— 见 `segmentFrames` 的说明：
    // 太短的段并入前一段时 `frameTo` 会前进到转场半帧，而 `pickFrame` 不动。
    const picked = list[page.pickFrame ?? page.frameTo];
    if (!first || !picked) { dropped += 1; continue; }
    // `createdSec` 必须是**有限非负数**：负值直接 INPUT 错。
    const createdSec = Math.max(0, Math.floor(first.timeSec));
    // 严格递增：撞车说明两段的段首落在同一秒（采样点重合），它们本来就是同一页。
    if (createdSec <= lastCreated) { dropped += 1; continue; }
    lastCreated = createdSec;
    slides.push({
      page: slides.length + 1,
      createdSec,
      imagePath: picked.path ?? null,
      // 下面两项是**本包的溯源字段**，解析器不认识也不会用；
      // 保留是为了「这一页覆盖了哪段时间」在产物里可查。
      fromSec: Math.max(0, Math.floor(first.timeSec)),
      toSec: Math.max(0, Math.floor(list[page.frameTo]?.timeSec ?? picked.timeSec)),
    });
  }
  return { slides, dropped };
}

/**
 * 一步到位：帧 + 判型结论 → `slides[]`。
 *
 * 判型不在 `slides` 时**直接返回空数组**，不抽 —— 对板书视频硬抽会产出一份
 * 「3 页的讲义」，它看起来像真的，比没有更糟。
 *
 * @param frames - `[{ timeSec, path, signature }]`。
 * @param verdict - `triage.classify` 的产物。
 * @param options.threshold / minPageSeconds - 透传给 `segmentFrames`。
 * @returns `{ slides, pages, dropped, extracted, reason }`。
 */
export function slidesFromFrames(frames, verdict, options = {}) {
  if (verdict?.kind !== KIND.SLIDES) {
    return {
      slides: [], pages: [], dropped: 0, extracted: false,
      reason: `判型为 ${verdict?.kind ?? 'unknown'}，不抽帧成页（宁可只给字幕也不给假页）`,
    };
  }
  const { pages } = segmentFrames(frames, options);
  const { slides, dropped } = buildSlides(frames, pages);
  return {
    slides, pages, dropped, extracted: slides.length > 0,
    reason: slides.length > 0 ? `归并出 ${slides.length} 页` : '帧数不足以构成任何一页',
  };
}

/**
 * 自检：产物是否满足 `validateInput()` 与 `anchor()` 的契约。
 *
 * **单独成一个函数**（而不是散在测试里），因为它要在**每次产出**后跑一遍 ——
 * 一次静默的页码重复会让整节课解析失败，而报错信息在 `INPUT` 那一层
 * 被翻成「输入信息无效」，看不出是哪一页。
 *
 * ⚠️ **空数组是合法的**：判型为 `continuous` / `static` / `unknown` 时
 * 本来就不该有页，`parse()` 也接受 `slides: []`（走 `transcript-only` 通道）。
 * 所以这里对空数组回 `ok: true`，但带一条 `note` 说明「一页都没有」——
 * 让调用方分得清「正常地没有页」和「本该有页却是空的」。
 * 后者由调用方看 `verdict.kind` 判断，不在这里猜。
 *
 * @param slides - `buildSlides` 的产物。
 * @returns `{ ok, issues, note }`。`issues` 是**具体到页**的中文说明。
 */
export function validateSlides(slides) {
  const list = Array.isArray(slides) ? slides : [];
  if (list.length === 0) {
    return { ok: true, issues: [], note: '没有页（判型非 slides 时这是正常结果，parse() 走 transcript-only）' };
  }
  const issues = [];
  const seen = new Set();
  let previous = -1;
  for (const [index, slide] of list.entries()) {
    if (!Number.isInteger(slide?.page) || slide.page < 1) {
      issues.push(`第 ${index + 1} 项 page=${JSON.stringify(slide?.page)} 不是正整数`);
    } else if (seen.has(slide.page)) {
      issues.push(`页码 ${slide.page} 重复`);
    } else {
      seen.add(slide.page);
    }
    const created = slide?.createdSec;
    if (!Number.isFinite(created) || created < 0) {
      issues.push(`页码 ${slide?.page} 的 createdSec=${JSON.stringify(created)} 非法（须为 >= 0 的有限数）`);
    } else if (created <= previous) {
      issues.push(`页码 ${slide?.page} 的 createdSec=${created} 未严格递增（上一页是 ${previous}）`);
    } else {
      previous = created;
    }
    if (typeof slide?.imagePath !== 'string' || slide.imagePath === '') {
      issues.push(`页码 ${slide?.page} 缺 imagePath`);
    }
  }
  return { ok: issues.length === 0, issues, note: '' };
}

/**
 * 估算：按 40 分钟课、给定采样间隔，会抽多少帧。
 *
 * 纯算术，用来在**跑之前**判断参数合不合理（比如 1 秒一帧 = 2400 帧，
 * 签名计算本身就要几十秒）。
 *
 * @param durationSec - 视频时长（秒）。
 * @param everySec - 采样间隔（秒）。
 * @returns `{ frames, bytes }` —— `bytes` 是按 96×54 灰度估算的签名总字节。
 */
export function estimateFrames(durationSec, everySec) {
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  const every = Number.isFinite(everySec) && everySec > 0 ? everySec : 5;
  const frames = Math.max(1, Math.floor(duration / every) + 1);
  return { frames, bytes: frames * 96 * 54 };
}

/** `JUMP_FLOOR` 在这里复述一次，便于调用方只 import 本文件。 */
export { JUMP_FLOOR };
