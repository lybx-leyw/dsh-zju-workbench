/**
 * 离线 Δ 探针：**不采音、不调模型、不联网**，只用两列已经存在的数字回答
 * 一个前置问题 —— 智云的字幕时间轴与 PPT 时间轴，和播放器时钟之间到底
 * 有没有一个偏差？
 *
 * # 为什么这个探针值得先写
 *
 * `临时计划.md` 的 H-1：如果 Δ 稳定存在，一次全局偏移就够，**永远不需要
 * ASR、不需要额度、不需要登录**；如果随课程漂移，才需要分段锚点；如果为 0，
 * 整个功能不做。这三条路差着两个数量级的成本，而探针本身是一封脚本。
 *
 * 用 ASR 去解决「两列数字相减」就能回答的问题，是把成本从 0 抬到
 * 「每节课 12 秒语音 + 一个自建网关」。所以先问，再花钱。
 *
 * # 它是**诊断**，不是生产链路
 *
 * 本文件没有任何自动纠偏逻辑，也不产出可以直接应用的 offset。它的产出是
 * 一份**结论**（`verdict`）+ 支撑它的数字。要不要据此做偏移层，是人的决定。
 *
 * # 三种结论，以及为什么必须允许「证据不足」
 *
 * | verdict | 含义 |
 * |---|---|
 * | `none` | Δ 在容差内为 0 → 没有这个问题 |
 * | `constant` | Δ 稳定非零 → 全局常数即可 |
 * | `drift` | Δ 随课程推进单调变化 → 需要分段锚点 |
 * | `inconclusive` | 锚点太少 / 互相矛盾 → **不要据此决策** |
 *
 * 第四态是刻意留的。上游那条教训值得记：把「三轮都失败」一概断言成「接口
 * 超时」，是因为结果类型没有表达力，错误只能被塞进最近的筐里。探针同理 ——
 * 两三个锚点算出来的「稳定」是假稳定，它必须能说「我不知道」。
 */

/** 判定阈值。**未标定** —— 换数据源后要重新量，别当定理。 */
export const PROBE_DEFAULTS = Object.freeze({
  /** 少于这么多锚点 → `inconclusive`（3 个点连直线都能完美拟合）。 */
  minAnchors: 5,
  /** |Δ| 小于它就当作 0。600ms 是「人眼在连续视频里察觉不同步」的经验起点。 */
  zeroToleranceMs: 600,
  /** 相邻锚点 Δ 之差超过它，就不再算「稳定」。 */
  stabilityToleranceMs: 1500,
  /** 漂移判定：首尾差超过它，且中间单调。 */
  driftToleranceMs: 2000,
});

/**
 * 找出「老师正在换页」的那些字幕行。
 *
 * 保守到近乎笨：只认**明确指向下一页/下面这张**的说法，不做语义推断。
 * 宁可漏（少几个锚点），不可错 —— 一个错的锚点会把 `constant` 判成 `drift`，
 * 而这个结论会决定要不要建一整套分段锚点。
 *
 * @param subtitles - `{ startMs, text }[]`，已按 `startMs` 升序。
 * @returns `{ startMs, text, match }[]`，`match` 是命中的那条短语。
 */
export function findPageTurnCues(subtitles) {
  if (!Array.isArray(subtitles)) return [];
  // 顺序无所谓，但都要求"指向下一个对象"，不认"我们回到刚才那页"这类回看。
  const patterns = [
    '我们看下一页', '看下一页', '下一页', '下面这一页', '下面这张',
    '看这张', '看下面', '接下来看', '下一个知识点', '翻到',
  ];
  const found = [];
  for (const line of subtitles) {
    const text = typeof line?.text === 'string' ? line.text : '';
    if (text === '' || !Number.isFinite(line?.startMs)) continue;
    const match = patterns.find((pattern) => text.includes(pattern));
    if (match !== undefined) found.push({ startMs: line.startMs, text, match });
  }
  return found;
}

/**
 * 把一组人工标注的锚点算成结论。
 *
 * 每个锚点是一对「同一件事在两个时钟上的读数」：
 * `slideSec` 是 PPT 的 `createdSec`（秒），`subtitleMs` 是字幕的 `startMs`（毫秒）。
 * 两者描述**同一时刻**，差值就是那一处的 Δ。
 *
 * ```
 * delta(i) = subtitleMs(i) − slideSec(i)×1000
 * ```
 *
 * 符号与 `alignment.js` 的 `offsetMs` 一致：正值表示字幕时间戳比 PPT 观测点超前。
 *
 * @param anchors - `{ slideSec, subtitleMs, label? }[]`；至少给两个才能谈变化。
 * @param options - 覆盖 `PROBE_DEFAULTS` 里的阈值。
 */
export function probeDelta(anchors, options = {}) {
  const config = { ...PROBE_DEFAULTS, ...(options ?? {}) };
  if (!Array.isArray(anchors)) {
    return { verdict: 'inconclusive', reason: 'invalid_input', deltas: [], anchors: 0 };
  }

  const usable = [];
  for (const anchor of anchors) {
    const slideMs = Number(anchor?.slideSec) * 1000;
    const subtitleMs = Number(anchor?.subtitleMs);
    if (!Number.isFinite(slideMs) || !Number.isFinite(subtitleMs)) continue;
    usable.push({
      slideMs,
      subtitleMs,
      label: typeof anchor?.label === 'string' ? anchor.label : undefined,
      deltaMs: subtitleMs - slideMs,
    });
  }
  // 按课程推进排序：Δ 的"漂移"只有在时间顺序上才有意义。
  usable.sort((a, b) => a.slideMs - b.slideMs);

  if (usable.length < config.minAnchors) {
    return {
      verdict: 'inconclusive',
      reason: 'too_few_anchors',
      deltas: usable.map((item) => item.deltaMs),
      anchors: usable.length,
      required: config.minAnchors,
      message: `${usable.length} 个锚点不足以判断趋势；${config.minAnchors} 个以上才有意义（3 个点连直线必然完美拟合）。`,
    };
  }

  const deltas = usable.map((item) => item.deltaMs);
  const median = medianOf(deltas);
  const spreadMs = Math.max(...deltas) - Math.min(...deltas);

  // 「稳定」= 所有点都落在中位数附近；「漂移」= 首尾差大且单调。
  const stable = deltas.every((delta) => Math.abs(delta - median) <= config.stabilityToleranceMs);
  const first = deltas[0];
  const last = deltas[deltas.length - 1];
  const endToEnd = last - first;
  const monotonic = isMonotonic(deltas, config.zeroToleranceMs);

  const base = {
    anchors: usable.length,
    deltas,
    medianMs: median,
    spreadMs,
    endToEndMs: endToEnd,
    points: usable,
  };

  if (Math.abs(median) <= config.zeroToleranceMs && stable) {
    return { ...base, verdict: 'none', message: 'Δ 在容差内为 0：字幕与 PPT 没有共同偏差，本功能不必做。' };
  }
  if (Math.abs(endToEnd) >= config.driftToleranceMs && monotonic) {
    return {
      ...base,
      verdict: 'drift',
      message: `Δ 首尾相差 ${Math.round(endToEnd / 1000)}s 且单调变化：需要分段锚点，单一偏移会越到后面越不准。`,
    };
  }
  if (stable) {
    return {
      ...base,
      verdict: 'constant',
      message: `Δ 稳定在 ${median}ms（跨度 ${spreadMs}ms）：一次全局偏移即可，不需要语音校准。`,
    };
  }
  return {
    ...base,
    verdict: 'inconclusive',
    reason: 'unstable',
    message: `Δ 既不稳定（跨度 ${spreadMs}ms）也不单调（首尾差 ${Math.round(endToEnd / 1000)}s）：锚点可能标错，或课程中途换过机位/跳过片段。先复核锚点，不要据此决策。`,
  };
}

/**
 * 把「自动找出的换页话 + 最近的 PPT 页」配成候选锚点。
 *
 * ⚠️ 这是**提示**，不是锚点。推论是「老师说了『我们看下一页』→ 紧接着的
 * 那次 `createdSec` 变化就是那一刻」，但换页可能在话说完之后才发生，也可能
 * 老师说完又讲了两句才翻。所以产出的每一项都带 `confidence: 'hint'`，
 * 必须人工确认后才能进 `probeDelta`。
 *
 * @param slides - `{ page, createdSec }[]`，若已带 `startMs` 则优先用它。
 * @param subtitles - `{ startMs, text }[]`。
 * @param toleranceMs - 话与换页之间的最大容许间隔；默认 8 秒（说完就翻）。
 */
export function suggestAnchors(slides, subtitles, toleranceMs = 8000) {
  const cues = findPageTurnCues(subtitles);
  if (cues.length === 0 || !Array.isArray(slides) || slides.length === 0) return [];

  const slidePoints = slides
    .map((slide) => ({
      page: slide?.page,
      slideMs: Number.isFinite(slide?.startMs) ? slide.startMs : Number(slide?.createdSec) * 1000,
    }))
    .filter((point) => Number.isFinite(point.slideMs))
    .sort((a, b) => a.slideMs - b.slideMs);

  const hints = [];
  for (const cue of cues) {
    // 取「话说完之后最近的那次换页」：换页通常紧随其后。
    const next = slidePoints.find((point) => point.slideMs >= cue.startMs
      && point.slideMs - cue.startMs <= toleranceMs);
    if (next === undefined) continue;
    hints.push({
      slideSec: next.slideMs / 1000,
      subtitleMs: cue.startMs,
      label: `第 ${next.page ?? '?'} 页 ← 「${cue.match}」`,
      confidence: 'hint',
    });
  }
  return hints;
}

/** 中位数；偶数个取中间两个的均值。空数组返回 `NaN`（由调用方拦）。 */
function medianOf(values) {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 是否单调（允许容差内的抖动）。
 *
 * 容差存在的理由：真实锚点不会完美单调，Δ 里总有一点噪声。要求严格单调会
 * 让真正的漂移被判成 `inconclusive`。
 */
function isMonotonic(values, tolerance) {
  if (values.length < 3) return true;
  const direction = Math.sign(values[values.length - 1] - values[0]);
  if (direction === 0) return true;
  for (let i = 1; i < values.length; i += 1) {
    const step = values[i] - values[i - 1];
    if (step !== 0 && Math.sign(step) !== direction && Math.abs(step) > tolerance) return false;
  }
  return true;
}

/**
 * 判定某条字幕/课件的时间戳是否落在「可疑」区间 —— **不修改它，只标记**。
 *
 * 用途：把探针结论落进 UI 时，能在不改数据的前提下显示"这一条可能有偏移"。
 * 刻意返回新对象而不是就地改，避免下游把诊断结果当成修正值。
 */
export function tagSuspicion(items, offsetMs, toleranceMs = 600, key = 'startMs') {
  if (!Array.isArray(items)) return [];
  const safeOffset = Number.isFinite(offsetMs) ? offsetMs : 0;
  return items.map((item) => ({
    ...item,
    suspicion: Math.abs(safeOffset) > toleranceMs
      ? { offsetMs: safeOffset, note: '该条时间戳可能整体偏移，仅供诊断' }
      : undefined,
    // `startMs` 保持原值：诊断不得悄悄当修正。
    [key]: item?.[key],
  }));
}
