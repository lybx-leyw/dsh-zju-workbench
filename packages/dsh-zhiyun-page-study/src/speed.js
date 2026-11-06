/**
 * 自由速度模式的取值逻辑。
 *
 * 只有三件事：**对齐一位小数**、**夹在范围内**、**算出下一步**。
 * 抽成纯函数是因为它有一个很隐蔽的坑：浮点累加。
 *
 * ```
 * 1 + 0.1 + 0.1        // 1.2000000000000002
 * 连点十几次后          // 1.9000000000000004
 * ```
 *
 * 攒出来的脏值有三个后果：
 * 1. 写回 `video.playbackRate` 的是个非人所愿的数；
 * 2. `rate >= RATE_MAX` 这类边界判断会失准（差一个 1e-16 永远不到）；
 * 3. 如果以后要显示数值，会出现 `1.9000000000000004x`。
 */

/** 下界：再低就只剩逐帧慢放的意义，那该用 `<video>` 自己的帧步进。 */
export const RATE_MIN = 0.2;
/** 上界：Chromium 在 `playbackRate > 4` 时可能直接静音，4 是音频能跟上的边界。 */
export const RATE_MAX = 4;
/** 步长：0.1 一档，满足"更精细"的要求。 */
export const RATE_STEP = 0.1;

/**
 * 对齐到一位小数。
 *
 * 用 `Math.round(x * 10) / 10` 而不是 `toFixed(1)`：后者返回**字符串**，
 * 每次都得多包一层 `Number()`，而且 `toFixed` 在 .5 边界上会做银行家舍入的
 * 变体，行为不如整数 round 直观。
 */
export function roundRate(value) {
  return Math.round(Number(value) * 10) / 10;
}

/**
 * 算下一步速度。
 *
 * @param current - 当前 `playbackRate`。非有限数按 1 处理（媒体还没就绪时常见）。
 * @param delta - 步长增量，通常 `±RATE_STEP`。
 * @returns 对齐并夹紧后的新值；**若与当前值相同说明已到边界**，
 *   调用方据此决定要不要写回（写回同值也会触发 `ratechange`）。
 */
export function nextRate(current, delta) {
  const from = roundRate(Number.isFinite(Number(current)) ? current : 1);
  const moved = from + (Number.isFinite(Number(delta)) ? Number(delta) : 0);
  return roundRate(Math.min(RATE_MAX, Math.max(RATE_MIN, moved)));
}

/**
 * 是否已经在边界上（含浮点余量）。
 *
 * @param current - 当前速度。
 * @param which - `'min'` 或 `'max'`。
 */
export function atRateBound(current, which) {
  const value = roundRate(current);
  const bound = which === 'min' ? RATE_MIN : RATE_MAX;
  // 余量取 1e-9：roundRate 已经把值对齐到 0.1，任何超过这个量级的差都是真差。
  return which === 'min' ? value <= bound + 1e-9 : value >= bound - 1e-9;
}
