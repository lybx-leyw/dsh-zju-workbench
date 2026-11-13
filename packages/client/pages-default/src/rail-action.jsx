/**
 * 把「收起 / 展开侧栏」收进导轨顶部那只鲸鱼里 —— **每一页**。
 *
 * # 为什么是「按页注册槽位」而不是改 DOM
 *
 * 页面壳把导轨顶部那格声明为 `page.rail-action`，**keyed 槽，key 就是当前页 id**
 * （见 `@lybx-leyw/dsh-pages` 的 `page-shell.jsx`）。keyed 槽的语义是「每个 key 一格，
 * 没注册的 key 走 fallback」。
 *
 * # 两种「侧栏」，同一个位置
 *
 * 顶层导航左边那条导轨（页面壳的）与各页**自己的**侧栏（论文库 / 笔记文件树 /
 * 文档目录 / 课程目录）是两列不同的东西，但收起它们的动作都该落在这只鲸鱼上 ——
 * 用户看到的是同一个位置，不该「home 能点、别的页不能点」。
 *
 * 所以这一格按页给出不同的动作：
 *
 *   - `home` —— 收起**原生**侧栏（`ctx.layout.toggleSidebar`）。那是宿主自己的
 *     展开/收起，与产品页无关。
 *   - 其他页 —— 该页**自己**的侧栏。页面通过 `ui-shared` 的
 *     `useRegisterPageSidebar(pageId, …)` 把自己的开关登记进来（见该文件顶部为什么
 *     必须是单向契约）；这里只按 `pageId` 取用，**不认识任何具体页面**。
 *   - 没登记（这一页没有侧栏，或者还没挂载完）—— 渲染纯鲸鱼，与加这个功能之前
 *     完全一致。**不登记就是默认路径**。
 *
 * # 交互照抄宿主自己的收起态
 *
 * 宿主侧栏在收起态本来就是「常态显示鲸鱼 / hover 换成面板图标」（`SidebarRoot` 的
 * `railMark` + `panelIcon` + CSS 的 `:hover` 切换）。这里复刻同一套观感，用户不用
 * 重新学：常态是鲸鱼，hover 变面板图标，点击切换。
 *
 * # 原生那个按钮怎么让位
 *
 * 它不在本包的槽位里（那是宿主 `ui-sidebar` 自己的 `logoRow`），所以只能从外部处理。
 * 选择「藏起来」而不是「移除」：移除 DOM 会让宿主的 React 下一次渲染时对不上节点。
 * 藏的方式是加一个属性 + 由本包的样式表接管，卸载时属性一撤，按钮原样回来。
 *
 * **收起态同样隐藏**：用户明确要求收起后也只留鲸鱼。展开入口于是只剩两条 ——
 * 导轨那只鲸鱼，以及快捷键 `Control+Alt+B`（宿主自己注册的全局快捷键，未受影响）。
 *
 * # 收起 = 整列消失，不是窄轨
 *
 * 宿主在 Web 端把收起做成一条 **56px 图标轨**（`collapsedWidth` 只有 macOS / Windows
 * 标题栏下才是 0），产品要的是「收起就直接消失」。所以收起后额外把布局网格的第一列
 * 压成 0 —— 详见 {@link collapseSidebarColumn}。
 */

import React from 'react';
import { WhaleIcon } from './icons.jsx';
import { usePageSidebar } from '@lybx-leyw/dsh-zju-ui-shared';

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
 * 导轨顶部那一格的动作按钮：常态鲸鱼 / 悬停面板图标，点击切换侧栏。
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
 * 表现是「带动作的那一页鲸鱼比别的页低一截、顶栏也更高」。真机踩过。
 *
 * 所以按钮**尺寸只取图标本身**（23 × 17.04/23.16 ≈ 17px 高），也不乘 scale ——
 * fallback 的 svg 就没乘，乘了反而两边又不一致。
 *
 * @param root0 - 按钮属性。
 * @param root0.label - 无障碍名（也是 tooltip），必须说清「点一下会发生什么」。
 * @param root0.onClick - 点击动作。
 * @param root0.shortcut - 若有，写进 `aria-keyshortcuts`（读屏会念出来）。
 * @returns 动作按钮。
 */
function WhaleButton({ label, onClick, shortcut }) {
  const [hover, setHover] = React.useState(false);
  /** 鲸图的宽高比（23.16 : 17.04），高度据此推出，避免压扁。 */
  const WHALE_WIDTH = 23;
  const WHALE_HEIGHT = (WHALE_WIDTH * 17.04) / 23.16;
  return (
    <button type="button" data-zju-rail-collapse=""
      title={label} aria-label={label}
      {...(shortcut === undefined ? {} : { 'aria-keyshortcuts': shortcut })}
      onClick={onClick}
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
 * home 页：鲸鱼切换**原生**侧栏（宿主自己的展开 / 收起）。
 *
 * @param root0 - 槽位传入的属性。
 * @param root0.layout - 布局服务（`ctx.layout`），提供 `toggleSidebar`。
 * @param root0.t - 文案函数。
 * @returns 动作按钮。
 */
function CollapseIntoWhale({ layout, t }) {
  const label = t?.('toggle.collapse') ?? '收起侧边栏';
  return <WhaleButton label={label} shortcut="Control+Alt+B"
    onClick={() => layout?.toggleSidebar?.()}/>;
}

/**
 * 其他页：鲸鱼切换**该页自己的**侧栏（论文库 / 笔记文件树 / 文档目录 / 课程目录）。
 *
 * # 两件事都要「按页」而不是「全局」
 *
 *   - **动作**：来自 `usePageSidebar(pageId)` —— 页面通过 `ui-shared` 的
 *     `useRegisterPageSidebar` 登记进来的开关。本组件不认识任何具体页面。
 *   - **文案**：`title` / `aria-label` 必须说清「点一下是收起还是展开」。页面可以给
 *     自己的说法（`label`），没给就按 `expanded` 推出「收起 / 展开侧边栏」。
 *
 * # 没登记的页面渲染什么
 *
 * **裸鲸鱼，与页面壳原本的 fallback 逐个像素相同**。这一页可能只是没有侧栏
 * （插件页 / 页面管理），也可能是页面还没挂载完。两种情况都不该出现一个按了没反应的
 * 按钮 —— 那比不给按钮更糟（用户会以为界面卡住了）。
 *
 * @param root0 - 槽位传入的属性。
 * @param root0.pageId - 当前页 id（页面壳按 keyed 槽传入）。
 * @returns 动作按钮，或与 fallback 一致的裸鲸鱼。
 */
function PageSidebarAction({ pageId }) {
  const control = usePageSidebar(pageId);
  if (control === undefined) return <WhaleIcon/>;
  const label = control.label ?? (control.expanded === false ? '展开侧边栏' : '收起侧边栏');
  return <WhaleButton label={label} onClick={() => control.toggle()}/>;
}

/**
 * 把内容包进页面壳要求的形状里，并接上页面壳给的上下文。
 *
 * @param Action - 该页要渲染的组件。
 * @param extra - 额外注入的 props（`layout`）。
 * @returns 可直接交给 `slots.register` 的组件。
 */
function wrap(Action, extra) {
  return function RailAction(props) {
    return <Action {...props} {...extra}/>;
  };
}

/**
 * 算出当前要给哪些页面 id 注册动作。
 *
 * # 为什么不能写死一张表
 *
 * 「带侧栏的页面」随插件装载而变（用户可以在「插件」页停掉某一页），而 keyed 槽只认
 * 精确的 key —— 没注册的 key 直接走 fallback。所以注册面必须跟着 `pages` 服务的
 * 快照走：快照里有哪几页，就给哪几页挂一个动作。
 *
 * 这个动作对「没有侧栏」的页面是无害的：`PageSidebarAction` 取不到登记就渲染裸鲸鱼，
 * 与 fallback 完全一致。所以不必（也不可能）在注册时就知道哪几页有侧栏。
 *
 * @param pages - 页面服务（`ctx.pages`）。
 * @returns 当前页面 id 数组。
 */
function pageIds(pages) {
  const snapshot = pages?.getSnapshot?.();
  const entries = Array.isArray(snapshot?.pages) ? snapshot.pages : [];
  const ids = entries.map(entry => entry?.id).filter(id => typeof id === 'string' && id !== '');
  // 拿不到快照（服务形状变了、或者宿主换版本）时至少保住 home 那一条：
  // 宁可少几页，也不能让「收起侧边栏」这个主入口整体消失。
  return ids.length > 0 ? ids : [pages?.config?.homePage ?? 'home'];
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

/**
 * 导轨上的触摸命中区。
 *
 * # 为什么只放大**命中区**、不动可见尺寸
 *
 * 导轨宽度 51 是产品口径（`DEFAULT_RAIL_WIDTH`，壳层与页面层的 `--zw-pane-w: 229`
 * 都从它推出来），改它要动一圈。而 51 宽的一列里塞 44 的方块，视觉上也会把图标挤散。
 *
 * WCAG 2.5.8 的判据本来就是**命中区**而不是可见图形。所以这里用一层透明的
 * `::after` 把可点范围撑开，图形一个像素都不变 —— 手指点得准，眼睛看到的
 * 还是原来那条细导轨。
 *
 * # 只在粗指针（手机 / 平板）上生效
 *
 * 鼠标不需要放大：桌面上把每个图标扩开会让相邻两个都够得着，反而误点。
 * `(pointer: coarse)` 是设备能力，不是窗口宽度 —— 桌面把窗口拖窄仍然是鼠标。
 *
 * # 命中区**不许互相重叠**
 *
 * 相邻两格的中心距是 43px（37 按钮 + 6 间隙）。各向外扩 3px 正好把间隙对半分，
 * 再大就有两个按钮抢同一块区域，点下去是哪一个全看谁的层在上面 —— 那比小一点更糟。
 *
 * 所以这里的目标是「把到手的空间用满」而不是硬凑 44：
 *   - 导航项 37 → **50×43**（横向吃满导轨内宽，纵向吃掉半条间隙）；
 *   - 侧栏动作（鲸鱼）23×17 → **44×44**（它上面与左右都有余量，第一个导航项
 *     在 y=54，扩到 44 高仍不碰）。
 *
 * ⚠️ 两条规则的**特异性必须拉开**：鲸鱼按钮本身也在 `[data-dsh-pages-rail]` 里，
 * 若两条都写 `… button::after`，后一条（更具体）会连鲸鱼一起盖掉，鲸鱼只剩 24px。
 * 所以通用那条显式 `:not([data-zju-rail-collapse])`。
 */
const TOUCH_CSS = `
@media (pointer: coarse){
  /* 侧栏动作（鲸鱼 / 面板图标）：23×17 的图形，命中区撑到 44×44。
     上边到视口顶只剩 14px，所以纵向取 −13.5（14 − 13.5 = 0.5，刚好不出屏）。 */
  [data-zju-rail-collapse]{position:relative}
  [data-zju-rail-collapse]::after{
    content:"";position:absolute;inset:-13.5px -10.5px;
  }
  /* 导航项：横向吃满导轨内宽（51 − 两侧 padding ≈ 38 → 再加 12 = 50），
     纵向各扩 3px（正好分掉 6px 间隙，不与相邻项重叠）。 */
  [data-dsh-pages-rail] button:not([data-zju-rail-collapse]){position:relative}
  [data-dsh-pages-rail] button:not([data-zju-rail-collapse])::after{
    content:"";position:absolute;inset:-3px -6px;
  }

  /* ---- 点按反馈 -------------------------------------------------------
   *
   * 触屏没有 hover。整站 1856 条自有规则里只有 **2 条** \`:active\`（宿主那边有 9 条），
   * 于是手机上按下任何按钮都**毫无反馈** —— 手指盖住按钮、又没有任何状态变化，
   * 用户无法判断这一次到底点中没有。ch05：反馈要在 0.1s 内出现。
   *
   * 用背景色（不是 transform 位移，也不是 opacity）：背景色不改变布局，也不会
   * 在快速连点时抖动。取 \`--zw-hover\` 的同源色，明暗两套自动跟随。 */
  [data-dsh-pages-rail] button:active{
    background:var(--zw-hover, rgba(0,0,0,.08)) !important;
  }
  /* 侧栏动作那格本来就是透明底，按下时用一层内阴影压深更清楚 —— 它比导航项小得多。 */
  [data-zju-rail-collapse]:active{
    background:transparent !important;
    box-shadow:inset 0 0 0 999px color-mix(in srgb, currentColor 14%, transparent);
    border-radius:6px;
  }

  /* ---- 点按高亮 -------------------------------------------------------
   *
   * 移动端 WebKit 在每次点击后给元素盖一层半透明蓝（默认
   * \`rgba(51,181,229,.4)\`）约 300ms。它与我们自己的 \`:active\` 反馈**叠加**，
   * 表现为「按一下闪一下蓝」—— 暗色主题下尤其突兀，而且这个蓝不属于产品色板。
   *
   * 关掉它、改用上面那条 \`:active\`：颜色归产品，时长归我们。 */
  [data-dsh-pages-rail] button,
  [data-zju-rail-collapse]{
    -webkit-tap-highlight-color:transparent;
  }
}
/* ---- 安全区：手机底部 / 刘海 -----------------------------------------
 *
 * 宿主把 viewport 写成 \`viewport-fit=cover\`（实测 meta 就是这一串），意思是
 * 「画到屏幕物理边缘，刘海与 home indicator 盖住的地方也归你」。
 * 于是**必须**自己把内容让开那块区域 —— 否则 iPhone 的 home indicator 会压在
 * 导轨最底下那一项上。实测 390×844：导轨最后一项「页面管理」底边 831，
 * 而 home indicator 占底部 34px（844 − 34 = 810）—— 重叠 21px，那一项有一半
 * 在指示条底下，点它容易误触系统手势。
 *
 * \`env()\` 在非刘海设备与不支持它的浏览器上取到 0，所以对桌面与普通安卓机
 * 是空操作。用 \`max()\` 而不是直接相加：没有安全区时不要凭空多出内边距。 */
@supports (inset: env(safe-area-inset-bottom)){
  [data-dsh-pages-rail]{
    padding-bottom:max(12.75px, env(safe-area-inset-bottom)) !important;
    /* 导轨自己也是一层可滚容器（十项在矮视口下会超出）。它划到底时不该把
       剩下的滑动传给外面 —— 那会让整页跟着动，而用户以为自己在滚导轨。
       写在同一条规则里而不是另起一条：同一个元素同一块属性，合并写更清楚，
       也不会和别处的 padding 规则争特异性。 */
    overscroll-behavior-y:contain;
  }
  /* 规划页那只宠物气泡贴右下角，同样会压到指示条。 */
  [class*="zwpg-pet-fab"]{
    bottom:max(14px, env(safe-area-inset-bottom)) !important;
  }
}
/* ---- 横屏（矮视口）：导轨装不下十项 -----------------------------------
 *
 * 实测 844×390：导轨内容 454px、可视 390px —— 溢出 64px，最后两项
 * 「学习」「插件」要先把导轨滚一下才够得着，而那条 51px 宽、没有滚动条的细列
 * 完全看不出「这里还能滚」。
 *
 * 缩的是**间距**，不是命中区（上一条已经把命中区撑到 43 高、彼此相接，
 * 再压会重叠）。导轨用自己的 padding + gap 换出这 64px：
 *   上下 padding 12.75 → 6（省 13.5）
 *   间距 6.375 → 2（九个间隙省 39.4）
 *   动作格的下内边距 15.9 → 4（省 11.9）
 * 合计约 65px，正好把 454 收回 390 以内，且每一项的可点范围一个像素不减。
 *
 * 只在「视口又矮又是触屏」时生效：桌面窗口拖成 844×390 同样是矮视口，
 * 但鼠标不需要为手指留出的那点余量，而把间距压掉会让它看起来挤。 */
@media (pointer: coarse) and (max-height: 460px){
  [data-dsh-pages-rail]{
    padding-top:6px !important;
    padding-bottom:6px !important;
    gap:2px !important;
  }
  [data-dsh-pages-rail-action]{
    padding-bottom:4px !important;
  }
}
`;
/** 隐藏原生折叠按钮的样式：只认本包打的标记，绝不泛化到别的按钮。 */
const CSS = `
[${NATIVE_TOGGLE_MARK}]{display:none !important}
${TOUCH_CSS}
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
  /**
   * 「侧栏是绝对定位抽屉」的那种 frame —— 手机上（视口 < 768）与第三方
   * 移动端插件（`dsh-pocket` 等）接管时就是它，宿主会写 `data-sidebar-drawer`。
   *
   * ⚠️ 抽屉态**必须**把下面那三条「让出 51px」的规则排除掉。抽屉里侧栏是
   * 浮层，网格第一列不该再被钉成 229：真机实测（390px 宽 + dsh-pocket）点开
   * 侧栏后，网格被锁成 `229px 110px 0`，主内容只剩 110px 宽的一条。
   */
  const drawer = '[data-sidebar-drawer]';
  /** 收起态。收起时第一列由 `collapseSidebarColumn` 压成 0，这里不该插手。 */
  const collapsed = '[data-sidebar-collapsed="true"]';
  return [
    // ⚠️ **只在展开态生效**（`:not([data-sidebar-collapsed="true"])`）。
    //
    // 少了这个限定，收起后网格仍被 `!important` 锁在 229 —— 真机踩过：
    // 宿主把内联写成 56px（收起轨），计算值却还是 229，**侧栏根本收不起来**。
    // 收起态交给 `collapseSidebarColumn`（它把第一列压成 0）。
    `[data-slot="root"] > *:not(${collapsed}):not(${drawer}){grid-template-columns:var(${SIDEBAR_WIDTH_VAR}) minmax(0px,1fr) minmax(0px,0px) !important}`,
    `[data-slot="root"]:not(:has(${collapsed})):not(:has(${drawer})) [data-slot="sidebar"] > *{width:var(${SIDEBAR_WIDTH_VAR}) !important;max-width:var(${SIDEBAR_WIDTH_VAR}) !important}`,
    // 拖拽手柄用内联 `left` 定位（`<DragHandle left={cols.sidebar}>`），
    // 收窄网格后它还停在旧位置 —— 用户看到的是一条离侧栏 51px 的拖拽线。
    // 同样只在展开态改写；`margin-left:-4px` 是宿主自己的居中补偿，保留。
    `[data-slot="root"] > *:not(${collapsed}):not(${drawer}) > [class*="handle"]{left:var(${SIDEBAR_WIDTH_VAR}) !important}`,
    // 抽屉态：主内容列**钉死在整行**。
    //
    // # 这条挡的是什么
    //
    // 手机（< 768）上宿主把侧栏做成绝对定位的抽屉，网格列由它自己与第三方移动端
    // 插件（`dsh-pocket` 等）反复用 `!important` 改写。只要有人把网格压成
    // `1fr 0 0`，而主内容列又落在第 2 轨（宿主给 `centerCol` 写的 `grid-area:1/2`），
    // 主内容就是 0 宽 —— 真机看到的是「整页只剩背景色」（暗色主题下就是黑屏）。
    //
    // # 为什么用 `:has([data-slot="main"])` 认列，而不是 `:nth-child(2)`
    //
    // 抽屉态会在侧栏**前面**插一个遮罩，于是从第 2 个子元素起序号整体错位：
    // 按序号取列会取到侧栏而不是主内容（`dsh-pocket` 2.12.0 就是这么写的，真机复现）。
    // `data-slot` 是宿主插槽服务写的语义锚点，不受 DOM 顺序影响。
    `[data-slot="root"] > ${drawer} > *:has([data-slot="main"]){grid-column:1/-1 !important;grid-row:1 !important;min-width:0 !important}`,
  ].join('\n');
}

/**
 * 把「收起 / 展开」挂进导轨顶部那一格 —— **每一页**。
 *
 * # 注册面跟着 `pages` 快照走
 *
 * keyed 槽只认精确的 key：快照里有哪几页，就得给哪几页各注册一份。页面可以晚到
 * （插件按需装载）、也可能被用户从「页面管理」里回收 —— 所以这里订阅快照，
 * 集合变了就重挂一次。**不重挂**的后果是新装的页面上那一格退回纯鲸鱼，
 * 而用户刚从「插件」页把它打开。
 *
 * # 顺序是有讲究的
 *
 * **先挂替身，成功了才藏原生按钮**。反过来做过，结果是槽位服务形状不对时
 * 「原生按钮已经被藏、替身没挂上」—— 用户既没有鲸鱼也没有原生入口，只能靠快捷键。
 * 测试抓到了这个顺序错误。
 *
 * # 原生按钮为什么在所有页都藏
 *
 * 它长在宿主侧栏的 `logoRow` 里，而产品把那个位置的入口统一收到了导轨鲸鱼上。
 * 留着它，同一屏就有两个「收起侧边栏」。藏是可逆的（属性 + 样式表，卸载即撤）。
 *
 * @param root0 - 依赖。
 * @param root0.slots - 槽位服务。
 * @param root0.pages - 页面服务（`ctx.pages`）。
 * @param root0.layout - 布局服务（`ctx.layout`）。
 * @param root0.doc - 文档对象（测试可注入）。
 * @returns 撤销函数。
 */
export function installCollapseIntoWhale({ slots, pages, layout, doc = globalThis.document }) {
  if (slots?.inject === undefined || slots?.register === undefined) return () => {};
  const slot = pages?.config?.railActionSlot ?? 'page.rail-action';
  /** 已注册的 pageId → disposer。重挂时按差集增删，不是整批推倒。 */
  const registered = new Map();
  /** 已挂上的槽位注入 scope。 */
  const scopes = [];
  let failed = false;

  /**
   * 该页要渲染的组件：home 是原生侧栏，其他页是该页自己的侧栏。
   *
   * `pageId` **由这里绑死**，不依赖槽位传进来的同名 prop。两者现在一定相等
   * （keyed 槽的 key 就是 activePage），但把「我注册的是哪一页」焊在闭包里，
   * 就不会因为页面壳将来改传参而静默拿到另一页的侧栏开关。
   */
  const componentFor = pageId => (pageId === (pages?.config?.homePage ?? 'home')
    ? wrap(CollapseIntoWhale, { layout })
    : wrap(PageSidebarAction, { pageId }));

  const sync = () => {
    if (failed) return;
    const wanted = new Set(pageIds(pages));
    // 先摘掉已经不存在的页。
    for (const [pageId, dispose] of [...registered]) {
      if (wanted.has(pageId)) continue;
      registered.delete(pageId);
      try { dispose?.(); } catch { /* 撤销失败没有补救手段 */ }
    }
    // 再补上新出现的页。
    for (const pageId of wanted) {
      if (registered.has(pageId)) continue;
      try {
        const component = componentFor(pageId);
        const dispose = slots.inject(slot, () => slots.register({ name: slot, key: pageId }, component));
        registered.set(pageId, dispose);
        scopes.push(dispose);
      } catch {
        // 槽位形状不对（宿主换版本）：把已经挂上的撤掉，**不动 DOM**（还没动过）。
        failed = true;
        for (const dispose of scopes.splice(0)) {
          try { dispose?.(); } catch { /* 同上 */ }
        }
        registered.clear();
        return;
      }
    }
  };

  sync();
  // 快照变化（晚到的页面 / 回收 / 重新排序）都要重算注册面。
  const unsubscribe = typeof pages?.subscribe === 'function' ? pages.subscribe(sync) : undefined;
  const undoDom = hideNativeToggle(doc);
  const undoColumn = collapseSidebarColumn(doc);
  return () => {
    unsubscribe?.();
    for (const dispose of scopes.splice(0)) {
      try { dispose?.(); } catch { /* 同上 */ }
    }
    registered.clear();
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
