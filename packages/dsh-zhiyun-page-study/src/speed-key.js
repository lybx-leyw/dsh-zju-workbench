/**
 * 长按连发：把「按住 Q/S 持续变速」的时序抽成纯状态机。
 *
 * # 为什么不能只靠 `keydown` 重复
 *
 * 浏览器的按键重复（`event.repeat`）有三件事不可控：
 *
 * 1. **首次重复延迟由系统设置决定**（常见 250–500ms，用户能改）；
 * 2. **重复间隔由系统设置决定**（常见 30–50ms，用户能改）；
 * 3. **按住不放时速度会一路跑到边界**，因为重复频率远高于人手的控制力。
 *
 * 三个都不该由我们"猜"，但完全自己计时又会和系统的初始延迟打架。
 * 所以这套逻辑的取舍是：
 *
 * - **第一下立即生效**（不等延迟，短按就是 ±0.1）；
 * - 之后**忽略系统重复**，改用我们自己的计时：先等 `holdDelayMs`（让人有机会只按一下），
 *   再按 `repeatMs` 连续走 —— 这个节奏比系统重复慢、比人手快，是"持续快速变化"
 *   但不至于一按就冲到 4x。
 *
 * # 为什么是纯函数 + 显式时间戳
 *
 * 长按逻辑里最容易错的是"松手后还继续跑"和"快速点两下变成一次长按"。
 * 把时间作为参数传进来，就能在 node 里精确构造这些时序，不必真的按住键盘等。
 */

/** 长按时序。 */
export const HOLD_DEFAULTS = Object.freeze({
  /** 按住多久之后开始连续变速。低于这个时长的按压算"点一下"。 */
  holdDelayMs: 420,
  /** 连续变速的间隔。约 12 档/秒 —— 从 1.0 到 2.0 只需不到一秒。 */
  repeatMs: 80,
});

/**
 * 计算按住期间**应该已经走了几档**。
 *
 * @param heldMs - 从按下到现在经过的毫秒。
 * @param options - 覆盖 `HOLD_DEFAULTS`。
 * @returns 应累计的档数（0 表示还没到连发时机）。
 *
 * 语义：`heldMs < holdDelayMs` → 0；之后每过 `repeatMs` 加一档。
 * 第 0 档由调用方在 `keydown` 时立即执行，所以这里的返回值**不含**那一下。
 */
export function heldSteps(heldMs, options = {}) {
  const { holdDelayMs, repeatMs } = { ...HOLD_DEFAULTS, ...(options ?? {}) };
  const held = Number(heldMs);
  if (!Number.isFinite(held) || held < holdDelayMs) return 0;
  if (!(repeatMs > 0)) return 0;
  return Math.floor((held - holdDelayMs) / repeatMs) + 1;
}

/**
 * 从"已走档数"换成"还差多少档要补"。
 *
 * 为什么需要它：定时器不一定准（后台标签页会被节流到 1s），所以不能假设
 * 每次都恰好过了一个 `repeatMs`。用「应该走几档 − 已经走了几档」来做补偿，
 * 即使定时器被推迟，速度也会追平，不会"按住半天才动两格"。
 *
 * @param heldMs - 按住时长。
 * @param appliedSteps - 已经执行过的档数（不含 keydown 那一下）。
 * @returns 本次应该补执行的档数（≥ 0）。
 */
export function pendingSteps(heldMs, appliedSteps, options = {}) {
  const target = heldSteps(heldMs, options);
  const applied = Number.isFinite(Number(appliedSteps)) ? Number(appliedSteps) : 0;
  return Math.max(0, target - applied);
}

/**
 * 这个按键应不应该当成"变速键"。
 *
 * 只认 Q/S，**按助记而不是按左右位置**：
 * - `Q` = **quick**（加速）
 * - `S` = **slow**（减速）
 *
 * 两键都在键盘左侧，相邻位置也顺手；但命名对齐的是语义，不是"左减右加"的直觉 ——
 * 用户记的是字母含义，不是我在代码里怎么排。
 *
 * - 不区分大小写：`event.key` 在按住 Shift 时是 `'Q'`，在中文输入法下可能是
 *   全角或别的字符，所以同时看 `event.code`（`KeyQ` / `KeyS` 与输入法无关）。
 *
 * @returns `'faster'`（Q，quick） | `'slower'`（S，slow） | `null`（不是变速键）。
 */
export function speedKeyAction(event) {
  if (!event) return null;
  // `code` 优先：它与键盘物理位置、输入法、Shift 状态都无关。
  const code = typeof event.code === 'string' ? event.code : '';
  if (code === 'KeyQ') return 'faster';
  if (code === 'KeyS') return 'slower';
  // 兜底：某些环境（合成事件、测试）没有 `code`，退回到 `key`。
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  if (key === 'q') return 'faster';
  if (key === 's') return 'slower';
  return null;
}

/**
 * 该不该拦下这个按键、不让它继续冒泡/走默认行为。
 *
 * 下面这些情况**必须放行**，否则会抢用户的输入：
 *
 * | 情况 | 为什么 |
 * |---|---|
 * | 焦点在输入框 / 文本域 / contenteditable | 用户正在打字，`q` `s` 是普通字符 |
 * | 按着 Ctrl / Alt / Meta | 那是浏览器或系统快捷键（⌘S 保存之类） |
 * | 带 Shift | 输入法或选择文本的常见组合 |
 *
 * @param event - 键盘事件。
 * @param active - 当前聚焦的元素（`document.activeElement`）。
 * @returns `true` 表示可以接管这个按键。
 */
export function shouldHandleSpeedKey(event, active) {
  if (!event) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.shiftKey) return false;
  return !isTypingTarget(active);
}

/**
 * 焦点是不是落在"正在输入"的元素上。
 *
 * `isContentEditable` 覆盖富文本编辑器（讲义正文、笔记），
 * `tagName` 覆盖表单控件。两样都要查 —— 只查 tagName 会漏掉 contenteditable 的 `div`。
 */
export function isTypingTarget(active) {
  if (!active || typeof active !== 'object') return false;
  if (active.isContentEditable === true) return true;
  const tag = typeof active.tagName === 'string' ? active.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
