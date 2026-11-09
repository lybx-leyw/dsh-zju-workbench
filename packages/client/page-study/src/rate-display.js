/**
 * 「倍率是否显示」这个偏好的读写。
 *
 * # 为什么要存
 *
 * 用户点一下把倍率藏起来，是有意识的选择（"别让我盯着数字凑速度"）。
 * 刷新一次就变回来，等于每次都要求他重新表达一遍。
 *
 * # 为什么用 localStorage 而不是设置面板
 *
 * 同一个仓库里已经有先例：论文页的抽屉宽度就记在 `localStorage`
 * （`AssistantDrawer.jsx`）。这是"某个控件自己的显示偏好"，不是需要跨设备
 * 同步的领域设置 —— 塞进设置页反而要用户多走两层才能关掉一个标签。
 *
 * # 三条原则
 *
 * 1. **读写都 try 包住**：隐私模式 / 禁用存储 / 配额满都会抛，而"记不住偏好"
 *    绝不该让播放器崩掉。
 * 2. **只认明确的值**：存的是 `'shown'` / `'hidden'`，其它任何内容（旧版本、
 *    被手改、别的脚本写脏）一律当默认 —— **默认显示**。
 * 3. **默认显示**：不显示数值是这次新加的能力，默认态应该是最容易被发现的那一边；
 *    隐藏要用户主动点。
 */

/** 存储键。带包名前缀，避免和宿主或别的插件的键撞。 */
export const RATE_VISIBLE_KEY = 'dsh-zhiyun:playback:rate-visible';

/** 默认显示倍率。 */
export const RATE_VISIBLE_DEFAULT = true;

/**
 * 读偏好。
 *
 * @param storage - 可注入，便于测试；默认 `globalThis.localStorage`。
 * @returns `true` 表示显示倍率，`false` 表示隐藏。
 */
export function readRateVisible(storage) {
  const store = storage ?? safeStorage();
  if (!store) return RATE_VISIBLE_DEFAULT;
  try {
    const raw = store.getItem(RATE_VISIBLE_KEY);
    if (raw === 'hidden') return false;
    if (raw === 'shown') return true;
    // 没存过、或者存了看不懂的东西 —— 都回默认，不猜。
    return RATE_VISIBLE_DEFAULT;
  } catch {
    return RATE_VISIBLE_DEFAULT;
  }
}

/**
 * 写偏好。**吞掉所有异常** —— 记不住偏好不是错误，不该冒泡到 React。
 *
 * @returns 是否真的写成功（便于测试断言，生产不依赖它）。
 */
export function writeRateVisible(visible, storage) {
  const store = storage ?? safeStorage();
  if (!store) return false;
  try {
    store.setItem(RATE_VISIBLE_KEY, visible ? 'shown' : 'hidden');
    return true;
  } catch {
    return false;
  }
}

/**
 * 倍率文本：**一位小数**，整数省掉 `.0`。
 *
 * 用户在自由速度模式下按 0.1 调节，所以必须显示小数；但 1.0 写成 `1x`
 * 比 `1.0x` 干净。四舍五入到一位，避免浮点尾巴（`1.2000000000000002`）。
 *
 * @param rate - `playbackRate`。
 * @returns 形如 `'1x'` / `'1.3x'`。
 */
export function formatRate(rate) {
  // ⚠️ 必须先排掉 `null` / `''` / `false` 这些"能转成 0"的值。
  // `Number(null) === 0`，直接算下去会显示 `0x` —— 而 0 倍速是不存在的，
  // 用户只会以为是坏掉了。用 `typeof` 卡住类型，而不是靠 `Number.isFinite`。
  if (typeof rate !== 'number' && typeof rate !== 'string') return '1x';
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0) return '1x';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}x` : `${rounded.toFixed(1)}x`;
}

/** 取 `localStorage`；不存在（SSR / 测试）或访问即抛时返回 `null`。 */
function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // 某些浏览器的隐私模式下，**访问** `localStorage` 本身就会抛。
    return null;
  }
}
