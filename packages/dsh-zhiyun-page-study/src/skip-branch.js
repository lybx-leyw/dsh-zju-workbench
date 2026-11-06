/**
 * 「跳过支线」的判定逻辑。
 *
 * 终稿的每个块都带 `tag.role`（主线 / 支线），`core-player` 的 `toSeekBar()`
 * 把它转成了轨道的 `segments[] = { from, to, role, summary, blockIndexes }`，
 * `from/to` 是 0–1 的**比例**而不是毫秒。这个文件只做一件事：
 * 给定「当前播到哪儿」，回答「这里是不是支线、要不要跳、跳到哪」。
 *
 * # 为什么单独成文件、纯函数
 *
 * 自动跳播是最容易写出**无限跳**或**把用户手拖的位置立刻弹走**的一类功能。
 * 把判定抽成纯函数，就能用测试钉住这几种边界，而不是在浏览器里反复试。
 * 它不碰 DOM、不碰 `<video>`、不读时钟。
 *
 * # 三条刻意的克制
 *
 * 1. **太短的支线不跳**。几百毫秒的支线跳过去只会表现为"画面抖一下"，
 *    比不跳更糟（`minBranchMs`）。
 * 2. **只向前跳，且必须真的前进**。目标时刻不大于当前时刻就返回 `null` ——
 *    否则 `currentTime` 写回同一个值会反复触发 `timeupdate`，形成死循环。
 * 3. **只认 `branch`**。`none`（没有标注）不等于支线；把没标注的也跳掉，
 *    等于替用户决定"这段不重要"，而数据并不知道。
 */

/** 角色常量。与 `core-player` 的 `buildContentSegments` 输出一致。 */
export const SEGMENT_ROLE = Object.freeze({
  MAIN: 'main',
  BRANCH: 'branch',
  NONE: 'none',
});

/** 默认参数。`minBranchMs` 是标定值，见文件头第 1 条。 */
export const SKIP_DEFAULTS = Object.freeze({
  /** 短于这个长度的支线不跳（画面会"抖一下"，比不跳更难看）。 */
  minBranchMs: 1500,
});

/**
 * 找出落在 `atMs` 上的那一段。
 *
 * 边界约定：`from <= ratio < to` —— **左闭右开**。右开是必须的：段与段首尾相接，
 * 若右端也闭合，一个边界点会同时属于两段，跳播就会在边界来回横跳。
 *
 * @param segments - `toSeekBar()` 的 `segments`。
 * @param axisMs - 轨道总长（来自 `<video>.duration`）。
 * @param atMs - 当前播放时刻。
 * @returns 命中的段；没有则 `null`。
 */
export function segmentAt(segments, axisMs, atMs) {
  if (!Array.isArray(segments) || !(axisMs > 0) || !Number.isFinite(atMs)) return null;
  const ratio = atMs / axisMs;
  for (const segment of segments) {
    if (!segment) continue;
    const from = Number(segment.from);
    const to = Number(segment.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (ratio >= from && ratio < to) return segment;
  }
  return null;
}

/**
 * 如果此刻该跳过支线，返回应该跳到的毫秒；否则 `null`。
 *
 * @param segments - `toSeekBar()` 的 `segments`。
 * @param axisMs - 轨道总长。
 * @param atMs - 当前播放时刻。
 * @param options - 覆盖 `SKIP_DEFAULTS`。
 * @returns 目标毫秒（**严格大于 `atMs`**），或 `null`（不该跳）。
 */
export function skipTargetMs(segments, axisMs, atMs, options = {}) {
  const { minBranchMs } = { ...SKIP_DEFAULTS, ...(options ?? {}) };
  const segment = segmentAt(segments, axisMs, atMs);
  if (segment === null) return null;
  if (segment.role !== SEGMENT_ROLE.BRANCH) return null;

  const fromMs = Number(segment.from) * axisMs;
  const toMs = Number(segment.to) * axisMs;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;

  // 第 1 条克制：太短不跳。
  if (toMs - fromMs < minBranchMs) return null;

  // 比例 → 毫秒带浮点误差（`0.3 * 600_000` 不一定是整数），而 `currentTime`
  // 只接受秒。向上取整保证落点**严格越过**段尾：若向下取整，落点可能因为误差
  // 仍被判在支线段内，`timeupdate` 再跳一次 —— 就是死循环。
  const target = Math.min(axisMs, Math.ceil(toMs));
  // 第 2 条克制：不前进就不跳。
  if (!(target > atMs)) return null;
  return target;
}

/**
 * 把支线段整理成"要叉掉"的区间，供轨道直接渲染。
 *
 * 只返回 `branch` 段，且过滤掉非法的（比例越界、to <= from）。
 * `from/to` 已是 0–1 比例，调用方直接乘 100% 用作 `left/width`。
 *
 * @returns `{ from, to, summary }[]`，按 `from` 升序。
 */
export function branchRanges(segments) {
  if (!Array.isArray(segments)) return [];
  const out = [];
  for (const segment of segments) {
    if (!segment || segment.role !== SEGMENT_ROLE.BRANCH) continue;
    const from = Number(segment.from);
    const to = Number(segment.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const clampedFrom = Math.min(1, Math.max(0, from));
    const clampedTo = Math.min(1, Math.max(0, to));
    if (clampedTo <= clampedFrom) continue;
    out.push({
      from: clampedFrom,
      to: clampedTo,
      summary: typeof segment.summary === 'string' ? segment.summary : '',
    });
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}
