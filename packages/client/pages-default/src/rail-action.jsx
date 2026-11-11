/**
 * 把原生「收起侧边栏」按钮收进导轨顶部那只鲸鱼里 —— **只在 home 页**。
 *
 * # 为什么是「按页注册槽位」而不是改 DOM
 *
 * 页面壳把导轨顶部那格声明为 `page.rail-action`，**keyed 槽，key 就是当前页 id**
 * （见 `@lybx-leyw/dsh-pages` 的 `page-shell.jsx`）。keyed 槽的语义是「每个 key 一格，
 * 没注册的 key 走 fallback」。所以：
 *
 *   - 这里**只**注册 `home` 这一个 key；
 *   - 「插件管理」等其余页面**不注册**，自动落到页面壳原本的 fallback（纯鲸鱼图标，
 *     不可点），折叠按钮仍在原生侧栏头部 —— 也就是用户说的「默认路径」；
 *   - 将来哪一页想要自己的动作，加一个同形状的组件到 `RAIL_ACTIONS` 即可，
 *     不必动本文件的其余部分。
 *
 * # 交互照抄宿主自己的收起态
 *
 * 宿主侧栏在收起态本来就是「常态显示鲸鱼 / hover 换成面板图标」（`SidebarRoot` 的
 * `railMark` + `panelIcon` + CSS 的 `:hover` 切换）。这里复刻同一套观感，用户不用
 * 重新学：常态是鲸鱼，hover 变面板图标，点击折叠。
 *
 * # 原生那个按钮怎么让位
 *
 * 它不在本包的槽位里（那是宿主 `ui-sidebar` 自己的 `logoRow`），所以只能从外部处理。
 * 选择「藏起来」而不是「移除」：移除 DOM 会让宿主的 React 下一次渲染时对不上节点。
 * 藏的方式是加一个属性 + 由本包的样式表接管，卸载时属性一撤，按钮原样回来。
 *
 * **收起态同样隐藏**：用户明确要求收起后也只留鲸鱼。展开入口于是只剩两条 ——
 * home 页那只鲸鱼，以及快捷键 `Control+Alt+B`（宿主自己注册的全局快捷键，未受影响）。
 *
 * # 收起 = 整列消失，不是窄轨
 *
 * 宿主在 Web 端把收起做成一条 **56px 图标轨**（`collapsedWidth` 只有 macOS / Windows
 * 标题栏下才是 0），产品要的是「收起就直接消失」。所以收起后额外把布局网格的第一列
 * 压成 0 —— 详见 {@link collapseSidebarColumn}。
 */

import React from 'react';
import { WhaleIcon } from './icons.jsx';

/** 本包在原生折叠按钮上打的标记，用来让样式精准命中它、也用来在卸载时只还原自己改的。 */
const NATIVE_TOGGLE_MARK = 'data-zju-native-toggle';

/**
 * 原生折叠按钮选择器：**声明了同一个快捷键、但不是本包那个**。
 *
 * ⚠️ 不能只用 `button[aria-keyshortcuts="Control+Alt+B"]` —— 本包自己的替代按钮也声明
 * 同一个快捷键（那是对的：快捷键本来就该写在按钮上，屏幕阅读器与 tooltip 都靠它）。
 * 只用快捷键选，等于把自己也选中、然后被自己的样式藏掉。真机踩过：按钮尺寸 0、
 * 鲸鱼整个消失，而日志里什么都没有。
 *
 * 也不用宿主的哈希类名（`hHd-Xa_toggle`）：前缀每次构建都变，宿主一升级这里就静默失效。
 * 用 `:not()` 排除本包自己的标记，剩下的就只可能是原生那一个，且对版本变化免疫。
 */
export const NATIVE_TOGGLE_SELECTOR = 'button[aria-keyshortcuts="Control+Alt+B"]:not([data-zju-rail-collapse])';

/**
 * 面板图标：形状逐字取自宿主 `@deepseek-ai/dsh-client-ui-primitives` 的
 * `IconPanelLeftOutlineRegular`（MIT，Copyright (c) 2026 DeepSeek），同一 16×16 网格。
 *
 * 为什么抄而不 import：那是宿主的浏览器种子模块，import 它会把本包绑死在某个宿主
 * 版本的导出名上 —— 宿主删一个导出，图标整块消失且没有编译错误。
 *
 * @param root0 - 图标属性。
 * @param root0.size - 边长（px）。
 * @returns 图标 svg。
 */
export function PanelIcon({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true"
    strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.5 1.5H2.5C1.94772 1.5 1.5 1.94772 1.5 2.5V13.5C1.5 14.0523 1.94772 14.5 2.5 14.5H13.5C14.0523 14.5 14.5 14.0523 14.5 13.5V2.5C14.5 1.94772 14.0523 1.5 13.5 1.5Z" stroke="currentColor"/>
    <path d="M5.5 1.5V14.5" stroke="currentColor"/>
  </svg>;
}

/**
 * home 页的导轨动作：鲸鱼 / 悬停面板图标，点击折叠侧栏。
 *
 * 按钮自身的样式全部内联，因为页面壳给这一格的颜色是 secondary 灰，且它会缩放整格
 * （`transform: scale(railWidth / 64)`）—— 内联样式不必和任何哈希类名竞争。
 *
 * # 尺寸必须与「不注册动作的页面」一致
 *
 * 页面壳给这一格的是 `minHeight: 24 * scale` + `paddingBottom: 20 * scale`，而没注册
 * 动作的页面落进去的是**裸 svg**（鲸鱼约 23×17，**不经缩放**），所以那一格量出来约 35px。
 *
 * 这里如果把按钮做成导轨按钮那种 46 * scale 的方块，它比格子高，格子就被撑到 53px ——
 * 表现是「home 页的鲸鱼比别的页低一截、顶栏也更高」。真机踩过。
 *
 * 所以按钮**尺寸只取图标本身**（23 × 17.04/23.16 ≈ 17px 高），也不乘 scale ——
 * fallback 的 svg 就没乘，乘了反而两边又不一致。这样两种页面量出来一样高，
 * 只是 home 页多一个可点区域。
 *
 * @param root0 - 槽位传入的属性。
 * @param root0.layout - 布局服务（`ctx.layout`），提供 `toggleSidebar`。
 * @param root0.railWidth - 当前导轨宽度（保留入参，本组件不再据此缩放）。
 * @param root0.t - 文案函数。
 * @returns 动作按钮。
 */
function CollapseIntoWhale({ layout, t }) {
  const [hover, setHover] = React.useState(false);
  const label = t?.('toggle.collapse') ?? '收起侧边栏';
  /** 鲸图的宽高比（23.16 : 17.04），高度据此推出，避免压扁。 */
  const WHALE_WIDTH = 23;
  const WHALE_HEIGHT = (WHALE_WIDTH * 17.04) / 23.16;
  return (
    <button type="button" data-zju-rail-collapse=""
      title={label} aria-label={label} aria-keyshortcuts="Control+Alt+B"
      onClick={() => layout?.toggleSidebar?.()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        display: 'grid', placeItems: 'center', padding: 0, margin: 0, border: 'none',
        background: 'transparent', cursor: 'pointer',
        color: 'var(--dsw-alias-label-primary, #101318)', lineHeight: 0,
        width: WHALE_WIDTH, height: WHALE_HEIGHT, borderRadius: 4,
      }}>
      {hover ? <PanelIcon size={17}/> : <WhaleIcon size={WHALE_WIDTH}/>}
    </button>
  );
}

/**
 * 「哪一页用什么动作」的登记表。**没登记的页面走页面壳的默认 fallback。**
 *
 * 加新页时只加一行；不想给某页做动作就什么都不要写 —— 这正是「默认路径」的表达方式。
 */
const RAIL_ACTIONS = Object.freeze({
  home: CollapseIntoWhale,
});

/**
 * 把内容包进页面壳要求的形状里，并接上布局服务。
 *
 * @param Action - 该页要渲染的组件。
 * @param layout - 布局服务。
 * @returns 可直接交给 `slots.register` 的组件。
 */
function wrap(Action, layout) {
  return function RailAction(props) {
    return <Action {...props} layout={layout}/>;
  };
}

/**
 * 收起态下让原生侧栏**整列消失**。
 *
 * # 为什么宿主自己的收起不够
 *
 * 宿主在 Web 端把「收起」实现成一条 **56px 宽的图标轨**：`computeColumns` 里
 * `sidebar === 0 ? collapsedWidth : ...`，而 `collapsedWidth` 只有 macOS 或 Windows
 * 标题栏下才是 0（见 `ui-layout`）。Web 端固定 56，于是收起后左侧仍留着一条窄轨和
 * 一堆图标。产品要的是「收起就直接消失」。
 *
 * # 为什么只改网格列，绝不动 `display`
 *
 * 列宽是 React 写进 frame 的内联 `grid-template-columns: "<侧栏>px <中>px <右>px"`，
 * 那条声明是**整条**的，CSS 里没法只替换第一段，所以第一段归零交给运行时精确改写
 * （见 {@link collapseSidebarColumn}）。
 *
 * ⚠️ 反过来做 ——— 给侧栏列加 `display:none` ——— 会把整页做掉：frame 的子元素按
 * **网格自动放置**逐列填格，侧栏列一旦不生成盒子，后面的列整体左移一格，中间那列就
 * 落到第 1 列上，而第 1 列已被压成 0px。真机踩过：收起之后整个 DSH 页面一起消失。
 * 保持侧栏列在流里、只让它所在轨道宽 0 就够了 —— 宿主自己的 `.sidebarCol` 带
 * `overflow:hidden`，内容会被裁掉，不需要我们再加任何隐藏规则。
 */

/** 隐藏原生折叠按钮的样式：只认本包打的标记，绝不泛化到别的按钮。 */
const CSS = `
[${NATIVE_TOGGLE_MARK}]{display:none !important}
`;

/**
 * 本包注入的那份样式表文本。
 *
 * 单独导出是为了让测试能直接断言「样式里没有别的隐藏规则」—— 这一条曾经出过事：
 * 给侧栏列加 `display:none` 把整个页面做掉了（见文件头的说明）。
 *
 * @returns 样式表文本。
 */
export function injectedCss() {
  return CSS;
}

/**
 * 找出所有 AppFrame 根元素。
 *
 * # 为什么不能用 `[data-sidebar-collapsed]`
 *
 * 宿主写的是 `data-sidebar-collapsed={sidebarCollapsed || undefined}`
 * —— 展开态那一位是 `undefined`，React **不渲染这个属性**。所以展开态下
 * `querySelectorAll('[data-sidebar-collapsed]')` 一个都匹配不到。
 *
 * 改用「三段的 `grid-template-columns`」这个特征：frame 是唯一一个把
 * `<侧栏>px <中>px <右>px` 三段写进内联样式的元素，与属性无关。
 *
 * @param doc - 文档对象。
 * @returns frame 元素数组。
 */
function frames(doc) {
  const out = [];
  for (const node of doc.querySelectorAll('*') ?? []) {
    const grid = node.style?.gridTemplateColumns;
    if (grid === undefined || grid === '') continue;
    const parts = grid.trim().split(/\s+(?![^(]*\))/);
    if (parts.length < 3) continue;
    if (!/^[\d.]+px$/.test(parts[0])) continue;
    out.push(node);
  }
  return out;
}

/**
 * 把 frame 的网格第一列在收起态压成 0，展开态原样还原。
 *
 * 只动第一段，其余段逐字保留 —— 右侧栏开合、窗口缩放都照常。
 *
 * @param doc - 文档对象。
 * @returns 还原函数。
 */
export function collapseSidebarColumn(doc = globalThis.document) {
  if (doc?.querySelectorAll === undefined) return () => {};
  /**
   * 收起时宿主算出的那一份原值，仅用于**卸载**时还原。
   *
   * ⚠️ 不要在「展开」分支里写回它：展开是宿主自己重算并覆盖内联样式的，我们若把
   * 收起时的旧值写回去，等于把展开又改回收起。这一点和相邻的 `hideNativeToggle`
   * 不同 —— 那边改的是属性，宿主不会自己重写。
   */
  const original = new WeakMap();
  const apply = () => {
    for (const frame of frames(doc)) {
      // 只处理「已收起」的 frame；展开态一律不碰，交给宿主自己的渲染值。
      if (frame.getAttribute('data-sidebar-collapsed') !== 'true') continue;
      const style = frame.style;
      if (style === undefined) continue;
      const current = style.gridTemplateColumns;
      if (current === undefined || current === '') continue;
      if (original.get(frame) === undefined) original.set(frame, current);
      const parts = current.trim().split(/\s+(?![^(]*\))/);
      // 不足三段说明宿主换了形状，不动它 —— 宁可留着窄轨，也不能把布局改坏。
      if (parts.length < 3 || parts[0] === '0px') continue;
      style.gridTemplateColumns = ['0px', ...parts.slice(1)].join(' ');
    }
  };
  apply();
  /**
   * 首次调用发生在**插件挂载**阶段，那时 React 还没渲染出 AppFrame
   * （真机实测：函数被调到了，但页面里还没有那个元素）。
   *
   * 所以必须挂 observer 等它出现。观察根用 `documentElement`，它比 `body`
   * 更早存在；两者都还没有时退到 `document` 本身。
   *
   * ⚠️ 曾经这里只观察根节点的 `style` 属性变化，但**节点插入**不会触发
   * 属性观察 —— 必须同时开 `childList` + `subtree`。
   */
  const root = doc.documentElement ?? doc.body ?? doc;
  const Observer = globalThis.MutationObserver ?? doc.defaultView?.MutationObserver;
  let observer;
  if (root !== null && root !== undefined && typeof Observer === 'function') {
    observer = new Observer(apply);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }
  /**
   * 兜底：前若干帧再试。
   *
   * # 为什么单靠 MutationObserver 不够（真机实测）
   *
   * 本函数在**插件挂载**阶段被调用，那时 React 还没渲染出 AppFrame
   * （诊断输出：`root=HTML`、`found=0`）。之后节点由 React 插入，
   * 但那条通知**没有让收窄发生** —— 只观察 `style` 属性时，节点插入本身
   * 未必触发回调（不同浏览器的 `attributeFilter` 语义有差异）。
   *
   * 与其和观察器的边界条件纠缠，不如在头几帧主动重试几次：AppFrame 一定
   * 在首次渲染后的很短时间里出现，重试 30 帧（约 0.5 秒）足够覆盖。
   * 之后仍由 observer 负责真正的变化（用户拖拽、窗口缩放）。
   */
  let frame = 0;
  const retry = () => {
    if (frame >= 30) return;
    frame += 1;
    apply();
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(retry);
    }
  };
  if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(retry);
  return () => {
    observer?.disconnect();
    for (const frame of doc.querySelectorAll('[data-sidebar-collapsed]') ?? []) {
      const saved = original.get(frame);
      if (saved !== undefined) frame.style.gridTemplateColumns = saved;
    }
  };
}

/**
 * 找出所有 AppFrame 根元素。
 *
 * # 为什么不能用 `[data-sidebar-collapsed]`
 *
 * 宿主写的是 `data-sidebar-collapsed={sidebarCollapsed || undefined}`
 * （`AppFrame.tsx`）—— 展开态那一位是 `undefined`，React **不渲染这个属性**。
 * 于是展开态下 `querySelectorAll('[data-sidebar-collapsed]')` **一个都匹配不到**，
 * 整段收窄逻辑从未执行过（真机验证：页面上一共有 0 个这样的元素）。
 *
 * 改用「三段的 `grid-template-columns`」这个特征：frame 是唯一一个把
 * `<侧栏>px <中>px <右>px` 三段写进内联样式的元素，与属性无关。
 *
 * @param doc - 文档对象。
 * @returns frame 元素数组。
 */
/**
 * 侧栏宽度的 CSS 变量名。
 *
 * # 为什么用 CSS 变量而不是改写内联样式
 *
 * 宽度是 React 写进元素的**内联** `grid-template-columns` 与内联 `width`，
 * 每次 render 都会重写。用 JS 去改：改完下一帧就被覆盖，只能靠 observer
 * 反复抢 —— 真机实测抢不过（诊断显示函数被调用过、找到了 frame，但宽度纹丝不动）。
 *
 * 而 CSS 的 `!important` **压得住内联样式**（实测：内联仍写着 280px，
 * `getComputedStyle` 与实测宽度都是 229）。所以正确的分工是：
 * **宽度由 CSS 定，JS 只负责把「该多宽」算出来写进这个变量**。
 */
export const SIDEBAR_WIDTH_VAR = '--zju-sidebar-width';

/**
 * 导轨宽度（px）。
 *
 * ⚠️ 与 `client.jsx` 的 `DEFAULT_RAIL_WIDTH` 必须是同一个数。
 *
 * 为什么不在本文件 import 它：`client.jsx` 依赖本文件（取
 * `installCollapseIntoWhale`），反向再 import 会成环。复制一个常量比引入
 * 循环依赖便宜，而且这个数由产品设计固定，不是配置项。
 *
 * 测试会断言两者相等 —— 见 `pages-default-width.test.mjs`。
 */
export const DEFAULT_RAIL_WIDTH = 51;
/**
 * 侧栏的**最小宽度**（px）—— 硬编码，**不由任何量反推**。
 *
 * # 为什么必须硬编码（这条是踩过的坑）
 *
 * 曾经写成 `min(宿主下限, 宿主默认 − 导轨宽)`：导轨一旦做宽到接近 280，
 * `宿主默认 − 导轨宽` 就是 0 或负数，取 min 之后**侧栏直接消失**。
 * 一个「让出空间」的调整不该有能力把整栏做没。
 *
 * 所以 MIN 是一个写死的兜底：`max(MIN, current − railWidth)` 里的 MIN。
 * 无论导轨多宽、宿主算出的 current 多窄，侧栏都不会低于它。
 *
 * 280 − 51 = 229 —— 正好是「让出导轨后」的目标宽度，于是默认情况下
 * `max(229, 280−51)` 与 `max(229, 用户拖的值−51)` 都落在合理位置。
 */
export const MIN_SIDEBAR_WIDTH = 229;

/** 宿主契约里的侧栏默认宽度（`ui-layout` 的 `SIDEBAR_DEFAULT`）。 */
export const HOST_SIDEBAR_DEFAULT = 280;

/**
 * 侧栏该用多宽 = `max(新下限, 当前 − 导轨宽)`。
 *
 * - `current`：宿主这次算出的宽度（用户拖过就是他拖的值，没拖过是 280）；
 * - `railWidth`：导轨占掉的横向空间，侧栏让出来抵消。
 *
 * 以 280 / 229 / 51 代入：`max(229, 229) = 229`。
 *
 * @param options.current - 宿主算出的当前宽度。
 * @param options.floor - 新下限。
 * @param options.railWidth - 导轨宽度。
 * @returns 目标宽度（px）。
 */
export function sidebarTarget({ current, floor = MIN_SIDEBAR_WIDTH, railWidth = DEFAULT_RAIL_WIDTH } = {}) {
  return Math.max(floor, current - railWidth);
}

/**
 * 算出侧栏宽度并写进 CSS 变量，**不碰任何内联样式**。
 *
 * @param options.doc - 文档对象。
 * @param options.railWidth - 导轨宽度。
 * @returns 还原函数。
 */
export function applySidebarWidth({ doc = globalThis.document, railWidth = DEFAULT_RAIL_WIDTH } = {}) {
  const root = doc?.documentElement;
  if (root?.style === undefined) return () => {};
  /**
   * 读宿主这次算出的侧栏宽度。
   *
   * 不缓存：用户拖拽、窗口缩放、右侧栏开合都会改它，每次重新读才准。
   *
   * @returns 当前宽度（px），找不到返回 `null`。
   */
  /**
   * 读宿主这次算出的侧栏宽度。
   *
   * # 为什么不遍历所有元素
   *
   * 曾经用 `querySelectorAll('*')` 找「内联 grid 有三段」的那个，真机上遍历了
   * 1400+ 个节点**一个都没匹配到**（某些节点访问 `.style` 会抛错，被宿主吞掉）。
   *
   * 改用宿主插槽服务写的语义锚点：`[data-slot="root"]` 的子元素就是 AppFrame，
   * 它的第一段就是侧栏宽。结构比「特征扫描」稳，也快得多。
   *
   * 找不到时回落到宿主默认宽 —— 宁可给默认值，也不要让变量留空
   * （留空的话 `var()` 失效，CSS 规则那条 `!important` 也跟着白写）。
   *
   * @returns 当前宽度（px）。
   */
  const measure = () => {
    const frame = doc.querySelector('[data-slot="root"] > [data-slot="root"]')
      ?? doc.querySelector('[data-slot="root"] > *');
    const grid = frame?.style?.gridTemplateColumns;
    if (grid !== undefined && grid !== '') {
      const first = Number.parseFloat(grid.trim().split(/\s+/)[0]);
      if (Number.isFinite(first) && first > 0) return first;
    }
    return HOST_SIDEBAR_DEFAULT;
  };
  /** 硬编码兜底：无论导轨多宽、宿主算出多窄，侧栏都不低于它。 */
  const floor = MIN_SIDEBAR_WIDTH;
  const sync = () => {
    const current = measure();
    if (current === null) return;
    root.style.setProperty(SIDEBAR_WIDTH_VAR, `${sidebarTarget({ current, floor, railWidth })}px`);
  };
  sync();
  const Observer = globalThis.MutationObserver ?? doc.defaultView?.MutationObserver;
  let observer;
  if (typeof Observer === 'function') {
    observer = new Observer(sync);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }
  return () => {
    observer?.disconnect();
    root.style.removeProperty?.(SIDEBAR_WIDTH_VAR);
  };
}

/**
 * 侧栏宽度的样式表文本。
 *
 * # 两条规则各压一层内联（都实测过 `!important` 压得住）
 *
 * | 目标 | 宿主写的内联 | 不覆盖的后果 |
 * | --- | --- | --- |
 * | frame 的网格第一列 | `grid-template-columns` | 列还是 280 |
 * | `SidebarRoot` 的宽度 | `width` | 元素仍是 280，被列裁掉右端 |
 *
 * # 锚点为什么用 `data-slot`
 *
 * 那是宿主插槽服务写的语义属性（`root` / `sidebar`），比 CSS Module 哈希类名
 * （`pI_x6G_frame`）稳 —— 后者换一次构建就变，规则会静默失效。
 *
 * @returns 样式表文本。
 */
export function sidebarWidthCss() {
  return [
    // ⚠️ **只在展开态生效**（`:not([data-sidebar-collapsed="true"])`）。
    //
    // 少了这个限定，收起后网格仍被 `!important` 锁在 229 —— 真机踩过：
    // 宿主把内联写成 56px（收起轨），计算值却还是 229，**侧栏根本收不起来**。
    // 收起态交给 `collapseSidebarColumn`（它把第一列压成 0）。
    `[data-slot="root"] > *:not([data-sidebar-collapsed="true"]){grid-template-columns:var(${SIDEBAR_WIDTH_VAR}) minmax(0px,1fr) minmax(0px,0px) !important}`,
    `[data-slot="root"]:not(:has([data-sidebar-collapsed="true"])) [data-slot="sidebar"] > *{width:var(${SIDEBAR_WIDTH_VAR}) !important;max-width:var(${SIDEBAR_WIDTH_VAR}) !important}`,
    // 拖拽手柄用内联 `left` 定位（`<DragHandle left={cols.sidebar}>`），
    // 收窄网格后它还停在旧位置 —— 用户看到的是一条离侧栏 51px 的拖拽线。
    // 同样只在展开态改写；`margin-left:-4px` 是宿主自己的居中补偿，保留。
    `[data-slot="root"] > *:not([data-sidebar-collapsed="true"]) > [class*="handle"]{left:var(${SIDEBAR_WIDTH_VAR}) !important}`,
  ].join('\n');
}

export function installCollapseIntoWhale({ slots, pages, layout, doc = globalThis.document }) {
  const disposers = [];
  // 顺序是有讲究的：**先挂替身，成功了才藏原生按钮**。
  // 反过来做过，结果是槽位服务形状不对时「原生按钮已经被藏、替身没挂上」——
  // 用户既没有鲸鱼也没有原生入口，只能靠快捷键。测试抓到了这个顺序错误。
  const slot = pages?.config?.railActionSlot ?? 'page.rail-action';
  if (slots?.inject === undefined || slots?.register === undefined) return () => {};
  try {
    for (const [pageId, Action] of Object.entries(RAIL_ACTIONS)) {
      const component = wrap(Action, layout);
      disposers.push(slots.inject(slot, () => slots.register({ name: slot, key: pageId }, component)));
    }
  } catch {
    // 槽位形状不对（宿主换版本）：把已经挂上的撤掉，**不动 DOM**（还没动过）。
    for (const dispose of disposers.splice(0)) {
      try { dispose?.(); } catch { /* 撤销失败没有补救手段 */ }
    }
    return () => {};
  }
  const undoDom = hideNativeToggle(doc);
  const undoColumn = collapseSidebarColumn(doc);
  return () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose?.(); } catch { /* 同上 */ }
    }
    undoDom();
    undoColumn();
  };
}

/**
 * 隐藏原生折叠按钮，返回还原函数。
 *
 * 用「标记属性 + 样式表」而不是直接 `remove()`：宿主是受控渲染，删掉它的节点会让下一次
 * 渲染对不上；改属性则完全可逆。观察者负责后续重渲染出来的新节点（侧栏折叠/展开会换
 * 一棵子树，按钮可能被重建）。
 *
 * @param doc - 文档对象。
 * @returns 还原函数。
 */
export function hideNativeToggle(doc = globalThis.document) {
  if (doc?.querySelectorAll === undefined) return () => {};
  const style = doc.createElement?.('style');
  if (style !== undefined && doc.head !== undefined) {
    style.dataset.zjuNativeToggle = '';
    style.textContent = CSS;
    doc.head.append(style);
  }
  const mark = () => {
    for (const button of doc.querySelectorAll(NATIVE_TOGGLE_SELECTOR) ?? []) {
      button.setAttribute?.(NATIVE_TOGGLE_MARK, '');
    }
  };
  mark();
  // 观察整棵文档：侧栏折叠会整块重渲染，只盯侧栏根节点会跟丢。
  const root = doc.documentElement ?? doc.body;
  const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  let observer;
  if (root !== null && root !== undefined && typeof Observer === 'function') {
    observer = new Observer(mark);
    observer.observe(root, { childList: true, subtree: true });
  }
  return () => {
    observer?.disconnect();
    style?.remove?.();
    // 只撤自己打的标记：别的插件若也标记了同名属性，这里不替它们做决定。
    for (const button of doc.querySelectorAll(`[${NATIVE_TOGGLE_MARK}]`) ?? []) {
      button.removeAttribute?.(NATIVE_TOGGLE_MARK);
    }
  };
}
