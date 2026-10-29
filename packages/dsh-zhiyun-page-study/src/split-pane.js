/**
 * 分屏分隔条的拖动逻辑。
 *
 * # 它管什么
 *
 * 全屏分屏时，左（视频）右（PPT + 知识点）之间有一条可拖的分隔线。
 * 这个文件只算**比例**：给定指针位置和容器宽度，返回夹紧后的左栏占比。
 *
 * # 为什么夹紧范围是 45%–72%
 *
 * | 边界 | 理由 |
 * |---|---|
 * | ≥45% | 再窄视频就成了竖条。16:9 画面在 45% 宽度下已经是"能看但吃力"的下限 |
 * | ≤72% | 再宽右栏 <28%，PPT 上的公式与代码开始糊。用户拖到这里说明他想让视频独占，那该直接退出分屏 |
 *
 * 这只是**拖动**的边界。初值是 65%（见 `SPLIT_DEFAULTS.ratio`）。
 *
 * # 为什么不用百分比字符串
 *
 * `grid-template-columns: 65% 1fr` 在拖动态下会让浏览器每帧重算布局。
 * 用 0–1 的数字、由调用方拼成 `minmax(0, 65fr) minmax(0, 35fr)` 更稳，
 * 而且夹紧逻辑能脱离 DOM 单测。
 */

/** 默认参数。 */
export const SPLIT_DEFAULTS = Object.freeze({
  /** 初始左栏占比。用户反馈"PPT 太小"之后定的 65/35。 */
  ratio: 0.65,
  /** 左栏最窄（视频不能再窄了）。 */
  min: 0.45,
  /** 左栏最宽（右栏不能窄到看不清 PPT）。 */
  max: 0.72,
  /**
   * 知识点自动隐藏的阈值（像素）。
   *
   * 为什么是像素而不是比例：**"够不够高"是绝对量**，和窗口高度无关。
   * 100px 在任何屏幕上都是"只能看见两行字"，按比例算则会在小窗口上
   * 误判成"还有空间"。
   */
  minTopicPx: 120,
});

/**
 * 把指针位置换算成左栏占比。
 *
 * @param clientX - 指针的 `clientX`。
 * @param rect - 容器的 `getBoundingClientRect()`（至少要有 `left` / `width`）。
 * @param options - 覆盖 `SPLIT_DEFAULTS` 的 `min` / `max`。
 * @returns 夹紧后的比例（0–1）；容器宽度无效时返回 `null`（调用方跳过这一帧）。
 */
export function ratioFromPointer(clientX, rect, options = {}) {
  const { min, max } = { ...SPLIT_DEFAULTS, ...(options ?? {}) };
  const width = Number(rect?.width);
  const left = Number(rect?.left);
  const x = Number(clientX);
  if (!Number.isFinite(width) || width <= 0) return null;
  if (!Number.isFinite(left) || !Number.isFinite(x)) return null;
  const raw = (x - left) / width;
  return clampRatio(raw, { min, max });
}

/**
 * 把任意比例夹进 `[min, max]`。
 *
 * 单独导出是因为**键盘拖动**（方向键微调）不需要指针位置，只需要这一步。
 */
export function clampRatio(ratio, options = {}) {
  const { min, max } = { ...SPLIT_DEFAULTS, ...(options ?? {}) };
  const value = Number(ratio);
  if (!Number.isFinite(value)) return SPLIT_DEFAULTS.ratio;
  // 上下界本身可能是脏的（比如 min > max），先各自夹进 0–1 再排序。
  const low = Math.min(1, Math.max(0, Math.min(min, max)));
  const high = Math.min(1, Math.max(0, Math.max(min, max)));
  return Math.min(high, Math.max(low, value));
}

/**
 * 把比例换成 CSS 的 `grid-template-columns` 值。
 *
 * 用 `fr` 而不是 `%`：`%` 加上 `gap` 会超过 100% 造成溢出；
 * `fr` 是"剩余空间按份数分"，`gap` 自动被扣掉。
 *
 * 例：`ratio = 0.65` → `minmax(0, 65fr) minmax(0, 35fr)`。
 * `minmax(0, …)` 是必须的：没有它，内容的最小尺寸会让两列都撑破容器
 * （知识点列表里一条长标题就能把右栏顶宽）。
 */
export function splitColumns(ratio) {
  const value = clampRatio(ratio);
  // 取整到 0.1 位，避免 `32.499999999999996fr` 这种输出。
  const right = Math.round((1 - value) * 1000) / 10;
  const leftRatio = Math.round(value * 1000) / 10;
  return `minmax(0, ${leftRatio}fr) minmax(0, ${right}fr)`;
}

/**
 * 知识点面板在给定高度下该不该显示。
 *
 * @param availablePx - 右栏扣除 PPT 之后剩下的高度。
 * @param options - 覆盖 `minTopicPx`。
 * @returns `true` 表示还能显示，`false` 表示该隐藏。
 *
 * ⚠️ 不足时**隐藏而不是缩到很小**：一行 18px 的列表在 30px 里只会露出
 * 一个半截的标题，看起来像渲染坏了。整块藏掉，用户仍能从顶部画面上的
 * 「当前知识点」条看到自己在哪。
 */
export function topicFits(availablePx, options = {}) {
  const { minTopicPx } = { ...SPLIT_DEFAULTS, ...(options ?? {}) };
  // ⚠️ 先排掉 `null` / `''` / `false`：`Number(null)` 是 0，会被当成"高度为零"
  // 从而把知识点藏掉。而量不到高度时**宁可显示** —— 藏一块能看的列表，
  // 比让它占着位置更糟（用户会以为"这节课没有知识点"）。
  if (typeof availablePx !== 'number' && typeof availablePx !== 'string') return true;
  const px = Number(availablePx);
  if (!Number.isFinite(px)) return true;
  return px >= minTopicPx;
}
