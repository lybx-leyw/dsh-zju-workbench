/**
 * 只让掉侧栏品牌行里**重复的那只鲸鱼**，字标交还宿主。
 *
 * # bug1 的根因
 *
 * 上一版用 `priority: -1` 的影子注册把 `sidebar.brand.mark` 与 `sidebar.brand.name`
 * **两个槽都**渲染成 `null`。身份区确实空了，但宿主那一行不是由内容撑高的 ——
 * `dsh-client-ui-sidebar` 写死 `.logoRow{height:60px}`、身份按钮 `.brand` 又是 `flex:1`。
 * 内容清空后，那一行仍占 60px、仍撑满宽度，里面什么都没有：**顶部空出一块**。
 *
 * # 为什么不是「两个都还回去」
 *
 * 导轨顶上已经有一只鲸鱼。两个槽都还回去，侧栏就是鲸鱼 + 字标，而导轨上还有一只鲸鱼 ——
 * 两只同样的鲸鱼并排。让掉品牌行这件事本身没错，错的是把**两个槽一起**让空了。
 *
 * # 所以：只让 mark，name 留给宿主
 *
 * 一个完整字标由「图标 + 名字」两半组成。图标那一半已经由导轨顶部那只鲸鱼承担，
 * 侧栏这边只需要名字：
 *
 *   - `sidebar.brand.mark` —— 影子注册，渲染 `null`，重复的鲸鱼不再出现；
 *   - `sidebar.brand.name` —— **完全不碰**，宿主的 `OfficialBrandName` 照常渲染字标。
 *
 * 这一版**不画任何自有图形**：用的是宿主自己的字标，本包只决定「哪一半不要」。
 * 顶部从「60px 空带」变成「一行字标」，留白问题消失，也不需要碰任何构建期哈希类名。
 *
 * # 为什么 mark 可以让空
 *
 * 收起态下宿主会把 `sidebar.brand.mark` 渲染进折叠按钮的 `railMark`。看上去让空它
 * 会连收起态的鲸鱼一起做掉 —— 但本包的 `rail-action.jsx` 已经把原生折叠按钮藏起来了
 * （产品要的是「折叠收进导轨鲸鱼」），那一格平时根本不存在。只有 `slots` / `pages` /
 * `layout` 三者缺一、`rail-action` 主动放弃接管时，原生按钮才会露出来；那种情况下
 * 按钮上仍有悬停显形的面板图标，不是一个没有任何提示的空白格。
 *
 * `sidebar.brand.name` 不涉及收起态 —— 那个槽只在宽态渲染（收起态的字标位置被折叠
 * 按钮的 `railMark` 取代），保留它不会在收起时漏出半截文字。
 *
 * # 为什么还要注入一段样式
 *
 * 让掉鲸鱼之后，行里只剩一个「空了标记的身份按钮 + 字标」。宿主的两条布局规则这时会
 * 把字标推离左沿：
 *
 *   - `.logoRow{justify-content:flex-end}` —— 内容整体靠右；
 *   - `.brand{flex:1}` —— 身份按钮撑满整行，字标被它顶到最右。
 *
 * 结果是**左端空着、字标贴在右边**。产品布局的其余部分（导轨、页头、列表）都是左对齐，
 * 这一行也必须左对齐，否则顶部就像少了左边一截。
 *
 * 所以补三条 CSS：整行左对齐、身份按钮只占内容宽、左边距与下方第一个按钮对齐。
 * 这是在**已有布局上做减法后的对齐修正**，不引入任何新图形。
 *
 * # 抓手：不用构建期哈希类名
 *
 * 宿主类名是 CSS Module 生成的（`.GgXflG_logoRow`），换一次构建就变，CSS 方案会静默失效。
 * 这里改用两个稳定锚点：
 *
 *   1. `data-window-drag` —— 宿主写死在品牌行上的语义属性（Web 端只有这一行带）；
 *   2. `[data-zju-brand-slot]` —— **我们自己**在标记槽里渲染的定位标记（一个空 span，
 *      `aria-hidden`，零视觉），只给 `:has()` 当判据。
 *
 * 宽态与收起态的层级不同（宽态 `button > span > span > span[marker]`，收起态
 * `button > span > span[marker]`），所以下面的选择器**只命中宽态**，不会误伤收起态
 * 那颗已经 36px 的折叠按钮。
 *
 * 宿主若改了 DOM 层级，选择器失配：退化成原来的右对齐，**不崩、不白屏** ——
 * 一个只管外观的包不该有连坐能力。
 *
 * # 为什么仍然走槽位影子注册，而不是 CSS
 *
 * 原生注册（`@deepseek-ai/dsh-client-ui-brand-official`，priority 0）必须留着：本包一卸载，
 * 它立刻恢复渲染。也不碰 `.GgXflG_brandMark` 这类构建期哈希过的类名 —— 宿主一升级哈希就变，
 * CSS 方案会静默失效（图标回来了、日志里什么都没有）。槽位名是公开契约。
 *
 * 只认这一个槽名。宿主换槽名或换 kind 时静默不做事（见 {@link suppressBrandMark} 的守卫），
 * 不会让侧栏起不来 —— 一个只管外观的包不该有这种连坐能力。
 *
 * @module
 */

import { createElement } from 'react';

/**
 * 要接管的原生品牌槽。
 *
 * **只有 mark**。name 必须留着 —— 把两个槽一起让空正是 bug1 的成因。
 */
export const SUPPRESSED_BRAND_SLOTS = Object.freeze(['sidebar.brand.mark']);

/**
 * 影子注册的优先级。
 *
 * `single` 槽按 priority 升序取第一个存活条目（见 `dsh-client-ui-slots` 的 `entriesOfSlot`），
 * 原生那份是默认的 0，所以负值即可压过它，且不必知道原生用的是哪一档。
 */
export const SHADOW_PRIORITY = -1;

/**
 * 定位锚点属性。
 *
 * 一个挂在标记槽里的空 span 上的 data 属性，**不是图标**：没有内容、没有尺寸、
 * `aria-hidden`。它唯一的作用是给下面的 `:has()` 一个「这一行正被产品接管」的判据，
 * 从而不必依赖宿主的构建期哈希类名。
 */
export const SLOT_MARKER = 'data-zju-brand-slot';

/**
 * 宽态品牌行的判据。
 *
 * 宽态层级：`div[data-window-drag] > button.brand > span.brandIdentity > span.brandMark > span[marker]`
 * 收起态层级：`div[data-window-drag] > button.toggle > span.railMark > span[marker]`
 *
 * 宽态在 `button` 之下有**两层** span，收起态只有**一层** —— 所以这条选择器只命中宽态。
 */
export const ROW_SELECTOR = `[data-window-drag]:has(> button > span > span > [${SLOT_MARKER}])`;

/**
 * 对齐样式。
 *
 * 两条，全是"让原本靠右的东西回到左沿"，尺寸全部取宿主自己已有的值：
 *
 *   1. 整行左对齐 —— 宿主是 `justify-content:flex-end`；
 *   2. 身份按钮只占内容宽 —— 宿主是 `flex:1`，会把字标顶到最右。
 *
 * ⚠️ 不能把装锚点的那层 `brandMark` 设成 `display:none`：锚点就在它里面，
 * 一旦不渲染，`ROW_SELECTOR` 立刻失配，整套样式反而永久失效（自己把自己关掉）。
 * 留下的 8px `gap` 改用 `gap:0` 收掉 —— 锚点本身零宽度，不会撑出任何位置。
 */
export const BRAND_ROW_CSS = `
/* 整行左对齐：与导轨、页头、列表的左沿对齐。 */
${ROW_SELECTOR}{
  justify-content:flex-start;
}
/* 身份按钮不再撑满整行：鲸鱼让掉之后，flex:1 只会把字标顶到最右边。 */
${ROW_SELECTOR} > button:first-child{
  flex:0 0 auto;
  width:auto;
  min-width:0;
}
/* 鲸鱼那一格已经变成零宽锚点，宿主 8px 的 gap 会变成字标左边的假留白 —— 收掉。
   注意只改间距，不要隐藏那一格：锚点在里面。 */
${ROW_SELECTOR} > button:first-child > span{
  gap:0;
}
`;

/**
 * 标记槽里的定位锚点。
 *
 * 它**不是图标**：一个没有内容、没有尺寸、`aria-hidden` 的空 span。作用只是让
 * {@link ROW_SELECTOR} 认得出宽态品牌行。卸载后锚点消失，选择器随之失配，
 * 宿主原本的右对齐布局原样回来。
 *
 * @returns 空 span。
 */
export function BrandSlotMarker() {
  return createElement('span', { [SLOT_MARKER]: '', 'aria-hidden': 'true' });
}

/**
 * 让掉重复的鲸鱼，并把这一行左对齐。
 *
 * 两件事各自可撤：锚点随槽位注册注销，样式随返回的撤销函数移除。
 * 样式只在锚点存在时命中，所以两者同时生效、同时失效。
 *
 * @param slots - 客户端的槽位服务（`ctx.slots`）。缺失或形状不对时静默不做事。
 * @param doc - 文档对象，默认 `globalThis.document`。
 * @returns 撤销函数：卸载后原生的鲸鱼与右对齐布局一起恢复。
 */
export function suppressBrandMark(slots, doc = globalThis.document) {
  if (slots === null || slots === undefined
    || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return () => {};
  const disposers = [];
  try {
    for (const name of SUPPRESSED_BRAND_SLOTS) {
      disposers.push(slots.inject(name, () => slots.register(
        { name, priority: SHADOW_PRIORITY },
        BrandSlotMarker,
      )));
    }
  } catch {
    // 槽位还没声明（或宿主换了形状）：把已经挂上的撤掉，保持「要么全让、要么不动」。
    for (const dispose of disposers.splice(0)) {
      try { dispose?.(); } catch { /* 撤销本身失败没有可做的补救 */ }
    }
    return () => {};
  }
  const undoSlots = () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose?.(); } catch { /* 同上 */ }
    }
  };
  let style;
  try {
    style = doc?.createElement?.('style');
    if (style !== undefined && doc.head !== undefined) {
      style.dataset.zjuBrandRow = '';
      style.textContent = BRAND_ROW_CSS;
      doc.head.append(style);
    }
  } catch {
    // 样式挂不上（无 document 等）：撤掉槽位注册，保持"锚点在则样式在"的一致性。
    undoSlots();
    return () => {};
  }
  return () => {
    undoSlots();
    try { style?.remove?.(); } catch { /* 卸载路径不抛 */ }
  };
}
