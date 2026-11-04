/**
 * 把原生侧栏顶部的**品牌行**让出来：隐藏原生鲸鱼标记与 deepseek 字标。
 *
 * # 为什么用槽位影子注册，而不是 CSS
 *
 * 宿主侧栏把这两块分别渲染在 `sidebar.brand.mark` / `sidebar.brand.name` 两个
 * `single` 槽里（见 `@deepseek-ai/dsh-client-ui-sidebar` 的 SidebarRoot）。`single`
 * 槽的规则是：**同 priority 只允许一个占用者，不同 priority 可以并存，priority 升序
 * 渲染、最低者生效**。所以这里用 `priority: -1` 注册一个返回 `null` 的组件，就能在
 * 不动原生注册、不改 class 名、不碰 DOM 的前提下把它遮住：
 *
 *   - 原生那份注册（`@deepseek-ai/dsh-client-ui-brand-official`，priority 0）还在，
 *     我们的条目一旦卸载，它立刻恢复渲染 —— 停用本包即可回到原样；
 *   - 不依赖 `.hHd-Xa_brandMark` 这类**构建期哈希过的 class 名**。侧栏一升级，
 *     哈希就变，CSS 方案会静默失效（图标回来了、日志里什么都没有），而槽位名是公开契约。
 *
 * # 为什么不连整行一起删
 *
 * 品牌行（`logoRow`）里除了这两块，还有**折叠按钮**（`!darwinDesktop && toggle`）。
 * 整行隐藏会把折叠入口一起做掉，那属于导航功能，不在「品牌外观」的范围里。所以这里
 * 只清空身份区，折叠按钮与「新会话」热区都保持原样 —— 视觉上头部留白。
 *
 * # 边界
 *
 * 只认这两个槽名。宿主换槽名或换 kind 时这里静默不做事（见 {@link suppressNativeBrand}
 * 的守卫），不会让侧栏起不来 —— 一个只管外观的包不该有这种连坐能力。
 */

/** 要清空的两个原生品牌槽。顺序只影响注册顺序，不影响渲染。 */
export const NATIVE_BRAND_SLOTS = Object.freeze(['sidebar.brand.mark', 'sidebar.brand.name']);

/**
 * 影子注册的优先级。
 *
 * `single` 槽按 priority 升序取第一个存活条目，原生那份是默认的 0，所以负值即可压过它
 * 且不必知道原生用的是哪一档（现在是 0，将来改成正数也仍然压得住）。
 */
export const SHADOW_PRIORITY = -1;

/**
 * 顶替原生品牌的两个槽所用的空组件。
 *
 * 返回 `null` 是合法的 React 组件返回值：槽位渲染器照常渲染 `<EmptyBrandMark/>`，
 * 只是产出空内容。不返回空 `<svg>` 之类，是因为「什么都没有」比「一个看不见的元素」
 * 更不容易被别的选择器或布局规则捞出可见性。
 *
 * @returns 空内容。
 */
export function EmptyBrandMark() {
  return null;
}

/**
 * 遮住原生品牌行。
 *
 * @param slots - 客户端的槽位服务（`ctx.slots`）。缺失或形状不对时静默不做事。
 * @returns 撤销函数：卸载后原生品牌立刻恢复渲染。
 */
export function suppressNativeBrand(slots) {
  if (slots === null || slots === undefined
    || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return () => {};
  const disposers = [];
  try {
    for (const name of NATIVE_BRAND_SLOTS) {
      disposers.push(slots.inject(name, () => slots.register({ name, priority: SHADOW_PRIORITY }, EmptyBrandMark)));
    }
  } catch {
    // 槽位还没声明（或宿主换了形状）：把已经挂上的撤掉，保持「要么全遮、要么不动」。
    for (const dispose of disposers.splice(0)) {
      try { dispose?.(); } catch { /* 撤销本身失败没有可做的补救 */ }
    }
    return () => {};
  }
  return () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose?.(); } catch { /* 同上 */ }
    }
  };
}
