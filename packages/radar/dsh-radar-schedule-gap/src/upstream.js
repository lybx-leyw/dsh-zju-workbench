/**
 * 上游封装占位 —— `Kozmosa/MySCUT`（MIT，**B 类源码级借鉴**）。
 *
 * 上游是 `private: true` 的 React + Capacitor 应用工程，**不作为库发布到 npm**，
 * 因此本包**不引依赖、不复制源码**，只借它的**行为规格**与**失败形态**。
 * 全部导出恒 `throw`，评审通过前不得被调用。
 *
 * 借什么 / 不借什么：
 *   ✅ `intersection.ts::isIntervalOverlapped`  —— 半开区间判据 `a.start < b.end && b.start < a.end`
 *   ✅ `intersection.ts::resolveLessonInterval` —— 两级取时：显式时刻优先，缺失才回落节次表
 *   ✅ `intersection.ts::isWeekMatched`         —— `(week - startWeek) % step === 0`
 *   ❌ `timeSlotTrim.ts::trimRedundantTimeSlots` —— **实测在本仓数据上裁剪量为 0**，见 U-1
 */

const NOT_IMPLEMENTED = '上游封装占位：未评审、未实现。';

/**
 * 把 `'HH:mm'` 转成当天的分钟数。
 *
 * @param {unknown} value - 形如 `'10:00'` 的字符串。
 * @returns {never} 恒抛错。
 */
export function parseTimeToMinutes(value) {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * 两段半开区间 `[start, end)` 是否重叠。
 *
 * TODO(评审通过后)：`return left.start < right.end && right.start < left.end;`
 * **半开**是上游的关键口径 —— 9:35 下课、9:35 上课**不算撞**。
 * 本仓节次表里 1→2 节间隔 5 分钟、3 节起 10:00 上课，用闭区间会把「课间 5 分钟」
 * 误判成重叠。
 *
 * @returns {never} 恒抛错。
 */
export function isIntervalOverlapped() {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * 取一节课的实际区间：**显式时刻优先，坏了才回落节次表**。
 *
 * TODO(评审通过后)：
 *   1. `startTime` / `endTime` 都可解析且 `end > start` → 直接用；
 *   2. 否则用 `startNode` / `endNode` 去节次表查；
 *   3. 都拿不到 → `null`（**不要**回落 0，见 U-1 的上游同族缺陷：`timeToMinutes(undefined) → 0`
 *      会让「不知道」变成「从 0 点开始」）。
 *
 * @returns {never} 恒抛错。
 */
export function resolveLessonInterval() {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * 周次是否命中单双周步长。
 *
 * TODO(评审通过后)：`week >= startWeek && week <= endWeek && (week - startWeek) % Math.max(1, step) === 0`
 *
 * ⚠ 本仓 `weeks` 是 `'all'|'odd'|'even'` 三态，**不是**上游的 `startWeek/endWeek/step` 三元组。
 * 移植时必须先做一次口径转换，否则「单周课」会被当成 `step=1` 全周都上。
 *
 * @returns {never} 恒抛错。
 */
export function isWeekMatched() {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * ❌ 上游 `trimRedundantTimeSlots()` —— **本仓不借**。
 *
 * 实测（2026-11-06，逐字移植后喂本仓 `PERIOD_TIMES`）：
 *   - 上游判据是「相邻两节 `endTime` 相差正好 **10 分钟** 就截断，只留到前一个」；
 *   - 本仓 13 节的真实间隔为 **5 / 25 / 60** 分钟，**没有任何一对是 10**；
 *   - 结果：函数原样返回全部 13 节，**裁剪量 0** —— 在本仓数据上永远不做任何事。
 *
 * 因此本包**不提供该函数**，也不得在评审后补进来。
 */
export const TRIMMED_UPSTREAM_FUNCTION = 'trimRedundantTimeSlots';
