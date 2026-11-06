/**
 * 均速模式：按每段实际语速自动加权，让整节课的**信息密度**保持恒定。
 *
 * # 模型
 *
 * 设某段的实际语速是 `d`（字/秒，来自 `core-player` 的 `speedBuckets`），
 * 播放倍率是 `r`。用户感知到的信息密度是 `d × r`。
 *
 * 要让感知密度恒定，就令 `d × r = 目标密度`，于是：
 *
 * ```
 * r = 目标密度 ÷ d
 * ```
 *
 * 目标密度取「全片平均语速 × 用户设定的倍率」：
 *
 * ```
 * r = (平均语速 × userSpeed) ÷ d
 * ```
 *
 * 这个式子有两个好性质：
 *
 * 1. **当 d 等于平均语速时，r 恰好等于 userSpeed**；
 * 2. **整段的平均倍率就是 userSpeed**（因为平均语速 ÷ 平均语速 = 1）。
 *
 * 所以"用户调的速度是平均速度"不是额外约定，而是这个公式的自然结果 ——
 * 只要用户把速度设成 2x，整节课**总体上**就是 2 倍速，只是慢的地方快一点、
 * 密的地方慢一点。
 *
 * # 三个必须夹紧的地方
 *
 * ## 1. 倍率上下界
 *
 * 某段语速只有平均值的 1/5 时，`r` 会算出 5 × userSpeed。那不叫"匀速"，
 * 那叫"跳过"。所以夹在 `[minRate, maxRate]`。
 *
 * **夹紧是有代价的**：夹住之后那一段的平均值就不再精确等于 userSpeed 了。
 * 这不是 bug，是"匀速"与"不失真"之间的必然取舍 —— 宁可整体略慢/略快，
 * 也不要听不清。
 *
 * ## 2. 语速不可估的段
 *
 * `speedBuckets` 里 `charsPerSecond` 可能是 `null`（纯过渡语、空块）。
 * 那些段**不参与加权**，直接用 userSpeed —— 没有信息就没有"密度"可言。
 *
 * ## 3. 相邻段的合并
 *
 * 相邻块的语速差一点点就换一次速，会让音频听起来像在"抖"。所以相差
 * 小于 `mergeTolerance` 的相邻段合并成一段，用它们的加权平均。
 */

/** 默认参数。 */
export const UNIFORM_DEFAULTS = Object.freeze({
  /** 最低倍率。再低会让语音拖到听不清（且部分浏览器 < 0.5 会静音）。 */
  minRate: 1,
  /** 最高倍率。再高会削掉爆破音、听不清字。 */
  maxRate: 2.6,
  /** 相邻段倍率差小于它就不换速（避免音频抖）。 */
  mergeTolerance: 0.08,
  /** 倍率量化步长：对齐到它，减少无意义的频繁切换。 */
  quantize: 0.05,
});

/**
 * 构建变速计划。
 *
 * @param buckets - `stats.speedBuckets`：`[{ startMs, endMs, chars, charsPerSecond }]`。
 *   `charsPerSecond` 为 `null` 的段不参与加权。
 * @param averageCharsPerSecond - 全片平均语速（`stats.averageCharsPerSecond`）。
 * @param userSpeed - 用户设定的**平均**倍率。
 * @param options - 覆盖 `UNIFORM_DEFAULTS`。
 * @returns `{ plan: [{ fromMs, toMs, rate }], clamped: boolean, averageRate }`。
 *   - `plan` 已按时间升序、相邻不重叠；
 *   - `clamped` 表示有段被夹到边界（此时平均倍率会偏离 userSpeed）；
 *   - `averageRate` 是按**时长加权**的实际平均倍率，供 UI 如实显示。
 */
export function buildUniformPlan(buckets, averageCharsPerSecond, userSpeed, options = {}) {
  const config = { ...UNIFORM_DEFAULTS, ...(options ?? {}) };
  const speed = Number(userSpeed);
  const avg = Number(averageCharsPerSecond);
  // 语速或倍率不可用时给不出计划 —— 调用方据此退回普通模式。
  if (!Number.isFinite(speed) || speed <= 0) return { plan: [], clamped: false, averageRate: speed };
  if (!Number.isFinite(avg) || avg <= 0) return { plan: [], clamped: false, averageRate: speed };
  if (!Array.isArray(buckets) || buckets.length === 0) return { plan: [], clamped: false, averageRate: speed };

  const targetDensity = avg * speed;
  const raw = [];
  let clamped = false;

  for (const bucket of buckets) {
    const fromMs = Number(bucket?.startMs);
    const toMs = Number(bucket?.endMs);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) continue;
    const density = Number(bucket?.charsPerSecond);

    let rate;
    if (!Number.isFinite(density) || density <= 0) {
      // 不可估段：不参与加权，直接用用户倍率。
      rate = speed;
    } else {
      const ideal = targetDensity / density;
      const bounded = Math.min(config.maxRate, Math.max(config.minRate, ideal));
      if (Math.abs(bounded - ideal) > 1e-9) clamped = true;
      rate = bounded;
    }
    raw.push({ fromMs, toMs, rate: quantizeRate(rate, config.quantize) });
  }

  if (raw.length === 0) return { plan: [], clamped: false, averageRate: speed };

  const plan = mergeAdjacent(raw, config.mergeTolerance);
  return { plan, clamped, averageRate: weightedAverageRate(plan, speed) };
}

/**
 * 把倍率对齐到量化步长。
 *
 * 为什么量化：`targetDensity / density` 会算出 `1.2734...` 这种值，
 * 而相邻两段可能只差 0.003 —— 每次都设 `playbackRate` 会让音频反复重采样，
 * 听感上是"嗡嗡"的低频抖动。对齐到 0.05 之后这类无意义切换基本消失。
 */
function quantizeRate(rate, step) {
  const size = Number(step);
  if (!Number.isFinite(size) || size <= 0) return roundRate(rate);
  // ⚠️ `Math.round(x/0.05)*0.05` 会带出 `1.7000000000000002` 这类浮点尾巴
  // （0.05 在二进制里不是有限小数）。这些值最终会写进 `video.playbackRate`，
  // 也会显示在倍率标签上，所以必须在源头抹到两位小数。
  return roundRate(Math.round(rate / size) * size);
}

/** 抹到两位小数。量化步长是 0.05，两位足够。 */
function roundRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.round(number * 100) / 100;
}

/**
 * 合并相邻且倍率接近的段。
 *
 * 合并后的倍率取**时长加权平均**：长短不一的段不能简单取算术平均，
 * 否则一个 10 秒段和一个 10 分钟段会被等价对待。
 */
function mergeAdjacent(segments, tolerance) {
  const out = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    const close = last !== undefined && Math.abs(last.rate - segment.rate) <= tolerance;
    // 只有**首尾相接**的才合并；中间有空隙说明那段时间没有块覆盖，不该被填平。
    const contiguous = last !== undefined && Math.abs(last.toMs - segment.fromMs) < 1;
    if (close && contiguous) {
      const lastMs = last.toMs - last.fromMs;
      const thisMs = segment.toMs - segment.fromMs;
      const total = lastMs + thisMs;
      last.rate = total > 0 ? (last.rate * lastMs + segment.rate * thisMs) / total : last.rate;
      last.toMs = segment.toMs;
    } else {
      out.push({ ...segment });
    }
  }
  return out;
}

/**
 * 按**时长加权**的平均倍率。
 *
 * 这是用户该看到的"实际平均速度"：如果计划里有 10 分钟的 1.2x 和 50 分钟的 2.5x，
 * 平均是 2.28x 而不是 1.85x。
 *
 * @param plan - `buildUniformPlan` 的 `plan`。
 * @param fallback - 计划为空时返回的值。
 */
export function weightedAverageRate(plan, fallback = 1) {
  if (!Array.isArray(plan) || plan.length === 0) return fallback;
  let totalMs = 0;
  let weighted = 0;
  for (const segment of plan) {
    const span = Number(segment.toMs) - Number(segment.fromMs);
    if (!Number.isFinite(span) || span <= 0) continue;
    const rate = Number(segment.rate);
    if (!Number.isFinite(rate)) continue;
    totalMs += span;
    weighted += rate * span;
  }
  return totalMs > 0 ? weighted / totalMs : fallback;
}

/**
 * 查某个时刻该用多少倍率。
 *
 * 二分查找：计划可能有几百段，`timeupdate` 每秒触发数次，线性扫不划算。
 *
 * @returns 命中的倍率；没命中（在计划覆盖之外）返回 `fallback`。
 */
export function rateAt(plan, atMs, fallback = 1) {
  const fallbackValue = Number.isFinite(Number(fallback)) ? Number(fallback) : 1;
  if (!Array.isArray(plan) || plan.length === 0) return fallbackValue;
  const at = Number(atMs);
  if (!Number.isFinite(at)) return fallbackValue;

  let low = 0;
  let high = plan.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const segment = plan[mid];
    if (at < segment.fromMs) high = mid - 1;
    else if (at >= segment.toMs) low = mid + 1;
    else return segment.rate;
  }
  return fallbackValue;
}
