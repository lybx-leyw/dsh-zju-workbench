// 「文档」页的键盘滚动：四个键、两种步长。
//
// 这一层是**纯函数**，与 `outline.js` 同一个理由：判据本身（哪个键、滚多少、
// 该不该走平滑动画）不碰 DOM，就能在裸 Node 里直接测。`client.jsx` 只负责把
// 量出来的视口高度与行高喂进来，再把结果交给 `scrollBy`。
//
// # 照「笔记」页做的那一套，但有一处不同
//
// 笔记页的四个键按**焦点上下文**分派：注意力在文件树上时 ↑/↓ 移游标。
// 文档页没有照抄这一条，原因写在 `client.jsx` 的 `handleScrollKeys` 里
// （点左侧目录 / 右侧页内目录都是"我要读这一篇"，四个键应当一视同仁地滚正文）。
// 步长、连续按键的处理、输入区豁免这三条则是原样沿用 —— 它们与页面版式无关。

/**
 * 一次翻页滚掉视口的多少。
 *
 * `PageDown` 的语义是"翻一页但要保留衔接"：整屏滚会丢掉上一页最后一行，
 * 读者失去位置感；少滚一行又像没翻动。85% 与笔记页、与常见阅读器一致。
 */
export const PAGE_RATIO = 0.85;

/**
 * ↑/↓ 一次滚几行。
 *
 * 按"行高 × 3"而不是固定像素：文档正文的字号与行高是 `style.css` 定的
 * （13.5px / 1.85），换字号时固定像素会立刻不跟手。三行是"一次小挪动"的
 * 手感下限 —— 一行滚完肉眼几乎看不出动，读者会以为键没生效。
 */
export const LINE_FACTOR = 3;

/**
 * 两次同向按键间隔小于这个值就算「连续操作」，走 `instant` 而不是 `smooth`。
 *
 * 为什么需要这道判据（笔记页真机实测的结论，这里照用）：`smooth` 会起一个约
 * 300ms 的缓动动画，而键盘重复约 30 次/秒。每次新的 `scrollBy` 都从当前位置
 * 重新起动画，于是按住不放反而几乎不动 —— 用户观感是"长按变缓了"。
 * 350ms 比一次缓动略长，刚好覆盖"上一段动画还没结束就来了下一次"。
 */
export const REPEAT_WINDOW_MS = 350;

/** 量不到行高时的兜底（`line-height: normal` 会让 `parseFloat` 得到 NaN）。 */
export const FALLBACK_LINE_HEIGHT = 24;

/**
 * 四个键 → 步长模式与方向。
 *
 * 用**冻结的常量对象**而不是每次现造字面量：`scrollIntent` 会把同一个对象
 * 返回给调用方，冻结之后就没人能顺手改掉它的 `direction`。
 */
export const SCROLL_KEYS = Object.freeze({
  PageDown: Object.freeze({ mode: 'page', direction: 1 }),
  PageUp: Object.freeze({ mode: 'page', direction: -1 }),
  ArrowDown: Object.freeze({ mode: 'line', direction: 1 }),
  ArrowUp: Object.freeze({ mode: 'line', direction: -1 }),
});

/**
 * 这次按键该不该由本页接管。
 *
 * # 三条不接管
 *
 * 1. **带修饰键**：`Ctrl/⌘+PageDown` 是浏览器切标签页，`Shift+PageUp` 是选中，
 *    `Alt+←/→` 是后退前进。这些组合的归属权不在页面手上，抢过来只会让用户
 *    少掉一个本来能用的键。
 * 2. **正在输入法合成**（`isComposing`）：此时 ↑/↓ 是在选候选词。合成通常只
 *    发生在输入区（已在组件里豁免），但拼音上屏前的 `keydown` 也可能落到别处。
 * 3. **不是这四个键**。
 *
 * # 为什么用 `Object.hasOwn` 而不是直接取下标
 *
 * `SCROLL_KEYS[key]` 对 `"toString"`、`"constructor"` 这类原型链上的名字会
 * 返回一个函数（真值），于是按下一个名字恰好是这些的键就会被误判成滚动键。
 * 实际按键里不会有，但这种"取下标顺便把原型也读了"的写法不该留在判据里。
 *
 * @param key - `KeyboardEvent.key`。
 * @param modifiers - 修饰键与合成状态。
 * @returns `SCROLL_KEYS` 里的那一项，或 `null`（不接管）。
 */
export function scrollIntent(
  key,
  { ctrl = false, meta = false, alt = false, shift = false, composing = false } = {},
) {
  if (ctrl || meta || alt || shift) return null;
  if (composing) return null;
  if (typeof key !== 'string') return null;
  if (!Object.hasOwn(SCROLL_KEYS, key)) return null;
  return SCROLL_KEYS[key];
}

/**
 * 这一次按键要滚多少像素（带方向，正数向下）。
 *
 * 量不到视口高度时返回 0，让调用方**不做任何事**：在没有高度的容器上
 * `scrollBy` 也是 0，但返回 0 能让"这次按键有没有生效"在测试里可断言，
 * 也避免调用方顺手 `preventDefault` 掉一个其实什么都不会发生的键。
 *
 * 行高可能是 `NaN`（`line-height: normal`）或 0，两者都退回
 * `FALLBACK_LINE_HEIGHT` —— 一次按键滚 0 像素等于静默失效。
 *
 * @param intent - `scrollIntent` 的返回值。
 * @param metrics - `{ height, lineHeight }`：量出来的视口高度与正文行高。
 * @returns 带符号的像素数；不该滚时为 0。
 */
export function scrollAmount(intent, { height = 0, lineHeight = FALLBACK_LINE_HEIGHT } = {}) {
  if (intent === null || intent === undefined) return 0;
  const direction = intent.direction;

  if (intent.mode === 'page') {
    const viewport = Number(height);
    if (!Number.isFinite(viewport) || viewport <= 0) return 0;
    // 只夹下界、不夹上界：容器比一屏再高，翻页就该跟着更高。
    return Math.max(1, Math.round(viewport * PAGE_RATIO)) * direction;
  }

  const line = Number(lineHeight);
  const safe = Number.isFinite(line) && line > 0 ? line : FALLBACK_LINE_HEIGHT;
  return Math.max(1, Math.round(safe * LINE_FACTOR)) * direction;
}

/**
 * 这一次按键该用 `instant` 还是 `smooth`。
 *
 * 两条判据，任一条成立就 `instant`：
 *   1. `event.repeat`：浏览器对"这是长按自动重复"的权威回答；
 *   2. 同方向的上一个滚动键发生在 `REPEAT_WINDOW_MS` 内：连敲（每次 `repeat`
 *      都是 `false`）同样会互相取消动画 —— 判据 1 盖不住这种情况。
 *
 * 单次点按仍走 `smooth`，保留"轻轻一按、平滑一屏"的手感。
 *
 * @param previous - 上一次滚动键的 `{ key, at }`；没有传 `null`。
 * @param key - 这次的键名。
 * @param now - 现在的时间戳（毫秒）。由调用方传入，测试才能控制时钟。
 * @param repeat - `KeyboardEvent.repeat`。
 * @returns 是否应当立刻跳过去。
 */
export function isInstantScroll(previous, key, now, repeat = false) {
  if (repeat === true) return true;
  if (previous === null || previous === undefined) return false;
  if (previous.key !== key) return false;
  const at = Number(previous.at);
  if (!Number.isFinite(at)) return false;
  return Math.abs(Number(now) - at) <= REPEAT_WINDOW_MS;
}
