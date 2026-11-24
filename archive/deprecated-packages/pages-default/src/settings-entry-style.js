/**
 * 把原生「设置」入口搬进智云导轨底部。
 *
 * # 为什么不能原地改样式（这一版的关键修正）
 *
 * 最初的实现只给原生 `.hHd-Xa_settingsArea` 换位置和尺寸。尺寸与坐标都能由
 * `pages` 服务算准，但**收起侧栏时会闪一帧**：
 *
 *   原生侧栏的 `.hHd-Xa_footArea`（设置区就在它子树里）在收起动画里
 *   `opacity: 1 → 0 → 1`。实测逐帧：`0.97 → 0.54 → 0.03 → 0 → 0.03 → 0.99`。
 *
 * `opacity` 是**渲染树继承**的 —— 一个元素再怎么 `position: fixed` 脱离文档流，
 * 只要它还是 `footArea` 的后代，就会跟着祖先一起淡出再淡入。这就是那「消失又出现」的一帧，
 * 靠调整 `bottom`/`height` 之类的几何参数永远修不掉。
 *
 * # 所以：复制一份，挂到 body 下
 *
 * 唯一能让设置图标不受 `footArea` 透明度影响的办法，就是**让它不再是 `footArea` 的后代**。
 * 于是：
 *
 *   1. 原生触发器的点击意图由我们自己转发（`click()`），不依赖它的可见性；
 *   2. 我们自己造一个按钮节点，挂到 `document.body`（不在任何侧栏子树里），
 *      位置由 `pages` 服务的几何决定 —— 钉在智云导轨底部；
 *   3. 原生 `settingsArea` 继续用 CSS 藏起来，避免出现两个设置入口。
 *
 * 这比「镜像原生节点」轻：不搬 DOM、不复制内部结构，只借原生触发器的一个 `click()`。
 */

/**
 * 原生设置区的容器选择器。
 *
 * 类名是 CSS module 生成的；稳定锚点（槽名）在它内部，
 * 所以必须用类名才能选中容器。退化行为：藏不住原生入口（多一个入口），但功能仍在。
 */
const AREA = '.hHd-Xa_settingsArea';

/**
 * 原生设置触发器的槽名 —— **只针对 0.2.2-rc.1**。
 *
 * # 为什么是 `settings.launcher` 而不是 `settings.trigger`
 *
 * 实测：`0.2.0-rc.2` / `0.2.1-alpha.1` 用 `settings.trigger`，
 * `0.2.2-rc.1` 用 **`settings.launcher`**。写错槽名时，自制按钮的 click
 * 转发会拿到 `null` —— **点击静默失败、控制台一个字都不报**（真机踩过：
 * 设置按钮点不开）。这类失败最难查，因为所有可见的样式与几何都是对的。
 *
 * # 为什么不按文案找
 *
 * 0.2.2 那个入口的 `aria-label` 是 **`Account menu`**（英文）。按文案匹配
 * 会被本地化改动打穿，也会误中别的按钮。
 *
 * 本仓当前**只支持这一个宿主版本**（见 `runtime.lock.json`）；要扩版本时
 * 先核实这个槽名在目标版本里是否仍然成立。
 */
export const NATIVE_TRIGGER_SLOT = 'settings.launcher';


/** 我们自己那个按钮的标记属性。 */
export const OWN_MARK = 'data-zju-settings-trigger';



/** 页面壳的基准尺寸：所有尺寸都是 `基准 × (railWidth / 64)`（见 page-shell.jsx）。 */
const BASE = Object.freeze({
  rail: 64,
  button: 46,
  radius: 9,
  icon: 23,
  gap: 8,
  padding: 8,
});

/** 变量名集中表：CSS 与 JS 共用同一份拼写。 */
export const VARS = Object.freeze({
  width: '--zju-rail-width',
  button: '--zju-rail-button',
  icon: '--zju-rail-icon',
  radius: '--zju-rail-radius',
  gap: '--zju-rail-gap',
  stroke: '--zju-rail-stroke',
  scale: '--zju-rail-scale',
  bottom: '--zju-settings-bottom',
  left: '--zju-settings-left',
  right: '--zju-settings-right',
  top: '--zju-settings-top',
});

/**
 * 图标源文件的网格尺寸。
 *
 * 我们的设置图标取自原生触发器，是 **16** 网格；而页面壳的页面图标是 **24** 网格。
 * 两者显示在同一行时，`stroke-width` 的**绝对数值不可比** —— 必须换算成有效视觉描边：
 *
 *   有效 = stroke × (显示尺寸 / viewBox 尺寸)
 */
const ICON_VIEWBOX = 16;

/**
 * 视觉描边的基准值 —— 由页面壳的页面图标实测反推。
 *
 * 页面图标：24 网格、stroke 1.65、显示约 15.1px ⇒ 有效 ≈ 1.04。
 * 我们统一到这个值，导轨里所有图标看起来才一样粗。
 */
export const TARGET_VISUAL_STROKE = 1.04;

/**
 * 按目标视觉描边反算 `stroke-width`。
 *
 * 图标会随导轨宽度缩放，所以描边必须跟着变 —— 写死像素会在别的宽度下又变粗/变细
 * （这正是一开始「有的边粗有的细」的成因）。
 *
 * @param displaySize - 图标显示边长（px）。
 * @returns 应写入的 `stroke-width`（px，保留两位小数）。
 */
export function strokeWidthFor(displaySize) {
  if (!Number.isFinite(displaySize) || displaySize <= 0) return TARGET_VISUAL_STROKE * ICON_VIEWBOX;
  return Math.round(TARGET_VISUAL_STROKE * ICON_VIEWBOX / displaySize * 100) / 100;
}

/**
 * 样式表。
 *
 * 两块：
 *   - 原生账号入口：搬进导轨底部（抽屉态除外，见 {@link ONLY_PINNED}）；
 *   - 尺寸与描边：全部走 `pages` 服务算出的变量。
 *
 * 搬移的前提是「侧栏是一个常驻列」。抽屉态下侧栏是绝对定位浮层，宿主还会给它
 * `transform` 做开合动画 —— 那会成为 `position: fixed` 的包含块，`left: 6px`
 * 于是相对浮层再左移。实测 390×844 下原生入口 rect 是 `[-223, 757, 37, 37]`：
 * 账号 / 设置入口整个落在视口外，手机上调不出来。抽屉态就留在抽屉底部不动。
 */

/** 抽屉态 frame 的标记属性（宿主在手机 / 移动端插件接管侧栏时写它）。 */
const DRAWER = '[data-sidebar-drawer]';

/**
 * 只在「侧栏不是抽屉」时生效的前缀。
 *
 * 挂 `html:not(:has(...))` 而不是给每条规则加 `:not()`：
 *   - 抽屉属性写在宿主最外层 AppFrame 上，是「整页布局形态」而不是某个元素的状态；
 *   - 一套前缀改一处，六个选择器不会各漏一个。
 *
 * 与 `rail-action.jsx` 的 `sidebarWidthCss()` 用的是**同一条判据**：那边也是
 * `:not([data-sidebar-drawer])`。两处必须一致，否则会出现「侧栏不占列了、
 * 但账号入口还按常驻列摆」这种半对齐。
 */
const ONLY_PINNED = `html:not(:has(${DRAWER})) `;

export const SETTINGS_ENTRY_CSS = `
/* 原生账号入口：**搬过来、正常显示**，不再自绘一个替代品。
 *
 * # 为什么不再自绘（真机看到的事实）
 *
 * 宿主登录后，原生按钮里是**真实头像 + 昵称**：
 *
 *   <span class="yHnPSG_avatar" data-avatar-status="ready">
 *     <img src="https://static.deepseek.com/user-avatar/…">
 *   </span>
 *   <span class="yHnPSG_label">绿意不息</span>
 *
 * 自绘的是一张写死的人形 SVG —— 永远不会有真实头像，因为头像来自宿主的
 * 登录状态与远端资源，客户端插件无从得知。用户看到的就是「登录了但头像没了」。
 *
 * # 这个包的边界
 *
 * 负责**位置与外观**（导轨底部、随宽度缩放、不跟着侧栏淡出），
 * **内容**（头像 / 昵称 / 菜单）归宿主。所以这里只做定位与尺寸；
 * 点击也直接落在原生按钮上 —— 不需要转发。
 *
 * # 为什么之前用 display:none 是错的
 *
 * 原生菜单锚在触发器的 getBoundingClientRect 上。display:none 会让 rect 变成
 * (0,0,0,0)，菜单就跑到视口左上角。保留它并定位，rect 才对，菜单才贴着它弹。
 *
 * # 抽屉态（手机 / 移动端插件接管侧栏）：**不要搬**
 *
 * 抽屉态下侧栏是绝对定位浮层，宿主给它 \`transform: translateX(-280px)\` 做开合
 * 动画；\`transform\` 会让祖先成为 \`position: fixed\` 的**包含块**，于是
 * \`left: 6px\` 变成「相对那条 −280 的浮层再左移」。实测 390×844 下原生入口的
 * rect 是 \`[-223, 757, 37, 37]\` —— 账号 / 设置入口整个落在视口外面，手机上根本
 * 调不出来。抽屉态本来就有正确位置（抽屉底部），所以搬移只在没有抽屉时生效。 */
${ONLY_PINNED}${AREA}{
  position:fixed !important;
  /* 与目标位置**逐变量对齐**：同一组 --zju-settings-* 决定位置，
     所以原生触发器的 rect 就是菜单要锚的那个 rect。
     只写 left/bottom 会在导轨贴右侧或顶部时错位（VARS 里还有 right/top）。 */
  left:var(${VARS.left},0) !important;
  right:var(${VARS.right},auto) !important;
  top:var(${VARS.top},auto) !important;
  bottom:var(${VARS.bottom},50px) !important;
  width:var(${VARS.button},37px) !important;
  height:var(${VARS.button},37px) !important;
  margin:0 !important;
  padding:0 !important;
  overflow:visible !important;
  z-index:40 !important;
  /* 侧栏收起时原生 footArea 会 opacity 1→0→1。本元素已 fixed 脱离文档流的
     定位语境，但仍显式钉住不透明度，避免继承到祖先的过渡值。 */
  opacity:1 !important;
}
/* 原生入口内部：收成「一个圆头像」。
   - 隐藏昵称文字：导轨只有图标，名字靠悬停提示；
   - 头像铺满按钮并圆形裁切；
   - 去掉原生那层的 padding / 背景。 */
${ONLY_PINNED}${AREA} .yHnPSG_label{
  display:none !important;
}
${ONLY_PINNED}${AREA} .yHnPSG_trigger{
  width:100% !important;
  height:100% !important;
  padding:0 !important;
  border:none !important;
  background:transparent !important;
  display:grid !important;
  place-items:center !important;
  border-radius:var(${VARS.radius},7px) !important;
  cursor:pointer;
}
${ONLY_PINNED}${AREA} .yHnPSG_avatar{
  width:calc(var(${VARS.button},37px) * 0.78) !important;
  height:calc(var(${VARS.button},37px) * 0.78) !important;
  border-radius:999px !important;
  overflow:hidden !important;
  display:grid !important;
  place-items:center !important;
}
${ONLY_PINNED}${AREA} .yHnPSG_avatar img{
  width:100% !important;
  height:100% !important;
  object-fit:cover !important;
  border-radius:999px !important;
}
${ONLY_PINNED}${AREA} :is(button, [role="button"]):focus-visible{
  outline:2px solid var(${VARS.stroke}, currentColor);
  outline-offset:2px;
}
/* ---- 「更多页面」图标的尺寸对齐 ----
   它是页面壳自己的按钮（button[data-dsh-pages-more]），图标内部写死 width="23"，
   而普通页面图标写的是 16 —— 同一个缩放容器里，于是它渲染成 18.3px、别的 15.1px，
   大了 21%，一眼看着「这个图标怎么这么大」。

   纯 CSS 覆盖即可，不必改 dsh-pages（它是锁版本的上游依赖）：
   把内部 svg 压到与普通图标相同的视觉尺寸。

   ⚠️ 不要在 svg 上直接写 \`width/height\` 数值去覆盖 23：外层容器是靠
   \`transform: scale(railWidth/64)\` 缩放的，svg 的 width/height 是**属性**，
   CSS 改它等于同时改了缩放前的尺寸，换算容易算错。用 \`transform\` 按比例缩更稳。

   系数按实测反推：未改前渲染 18.3px，普通页面图标 15.1px ⇒ 15.1/18.3 ≈ 0.82。
   （试过 0.72，缩成 13.2px 反而偏小。） */
button[data-dsh-pages-more] svg{
  transform:scale(0.82);
  transform-origin:center;
}
/* ---- 「更多页面」下拉面板里的图标也要跟随导轨缩放 ----
   页面壳的导轨按钮用 RailIcon(width=railWidth) 包住图标，里面是
   transform: scale(railWidth / 64)，所以按钮图标会跟着导轨变。
   但下拉面板（data-dsh-pages-more-panel）里是**直接**渲染图标组件，
   外层只有一个写死的 20×20 容器 —— 图标于是恒定 19px，导轨调宽调窄都不动。
   这是「调整导轨大小不影响更多页面里的图标」的原因。

   纯 CSS 补上同一套缩放：面板里的图标容器按 railWidth/64 缩放。
   --zju-rail-scale 由 settingsGeometry 写入（= railWidth / 64）。 */
[data-dsh-pages-more-panel] [data-dsh-pages-more-row] > button > span{
  transform:scale(var(--zju-rail-scale,0.796875));
  transform-origin:center;
}
/* 面板本身的行高/内边距也跟着缩放，否则图标变大后会挤在 36px 的行里。 */
[data-dsh-pages-more-panel] [data-dsh-pages-more-row] > button{
  min-height:calc(36px * var(--zju-rail-scale,0.796875) / 0.796875);
}

/* ---- 图钉按钮的「已固定 / 未固定」状态区分 ----
   页面壳给图钉按钮同一枚图标、同一个颜色（color: secondary 写死），
   aria-pressed 只用于无障碍语义，**没有任何样式跟着它变**。实测确认过：
   pin 与 unpin 两态的 path、fill、color、opacity、transform 全部相同，
   用户看不出这一页是否已经固定。

   页面壳把状态暴露成了稳定的 aria-pressed，可以纯 CSS 接上：
     - 已固定：用强调色，并常亮底；
     - 未固定：维持次要色，悬停才给底。
   这样不碰 dsh-pages，也让「当前是否固定」一眼可辨。 */
[data-dsh-pages-more-panel] button[data-dsh-pages-pin][aria-pressed="true"]{
  color:var(--dsw-alias-label-info,var(--zw-brand,#94bdf4)) !important;
  background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06)) !important;
}
/* 已固定时把图钉转 45°，形成「钉住」与「待钉」的形状差异 ——
   只靠颜色区分对色觉障碍不友好，形状差异是更好的第二条线索。 */
[data-dsh-pages-more-panel] button[data-dsh-pages-pin][aria-pressed="true"] svg{
  transform:rotate(-45deg);
  transform-origin:center;
}
[data-dsh-pages-more-panel] button[data-dsh-pages-pin][aria-pressed="false"]:hover{
  background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));
}

/* 自绘按钮的样式已删除 —— 现在直接复用原生账号入口。
 * 只保留一条：清理**上一版安装留下的**自绘节点（热更新时 DOM 可能还在）。 */
[${OWN_MARK}]{
  display:none !important;
}
`;

/**
 * 由 pages 服务的快照算出设置入口应有的几何。
 *
 * 纯函数：不读 DOM、不依赖渲染时机，因此可以单独测试。
 *
 * @param snapshot - `pages.getSnapshot()` 的结果。
 * @returns 要写入的 CSS 变量表（`{ 变量名: 值 }`）；快照不可用时返回空对象。
 */
export function settingsGeometry(snapshot) {
  const width = snapshot?.railWidth;
  if (!Number.isInteger(width) || width <= 0) return {};
  const scale = width / BASE.rail;
  const button = Math.round(BASE.button * scale);
  const gap = BASE.gap * scale;
  const padding = BASE.padding * scale;
  const pageList = Array.isArray(snapshot?.pages) ? snapshot.pages : [];
  const bottomCount = pageList.filter(page => page?.region === 'bottom').length;
  const position = snapshot?.railPosition;
  const icon = Math.max(14, Math.round(BASE.icon * scale));
  const vars = {
    [VARS.width]: `${button}px`,
    [VARS.button]: `${button}px`,
    [VARS.radius]: `${Math.round(BASE.radius * scale)}px`,
    [VARS.icon]: `${icon}px`,
    [VARS.gap]: `${gap}px`,
    // 描边按显示尺寸反算，保证导轨里所有图标的**视觉**粗细一致。
    [VARS.stroke]: `${strokeWidthFor(icon)}px`,
    /**
     * 导轨的缩放系数（与页面壳的 `RailIcon` 同一套：`railWidth / 64`）。
     *
     * 「更多页面」下拉面板里的图标由页面壳直接渲染、外层没有缩放容器，所以它不随
     * 导轨变化。把这个系数暴露成变量，面板那几条 CSS 才能跟着一起缩放。
     */
    [VARS.scale]: String(Math.round(scale * 10000) / 10000),
  };
  /**
   * 位置：由页面壳的布局常量推出（`page-shell.jsx` 的 `railInset` 与 flex 结构）。
   *
   *   底距 = 底 padding + bottom 组高度 + 一个 gap
   *   bottom 组高度 = 项数 × 按钮 + (项数 − 1) × gap
   *
   * 导轨本身贴边（left/right 纵向拉满、top/bottom 横向拉满），所以视口坐标在
   * 贴边方向与导轨坐标一致，不需要知道原生侧栏宽度这类外部信息。
   */
  const bottomHeight = bottomCount === 0 ? 0 : bottomCount * button + (bottomCount - 1) * gap;
  const offset = Math.round(padding + bottomHeight + gap);
  // 横向起点让开导轨 padding，与页面壳按钮同一条竖轴（贴死 0 会左偏 7px）。
  const crossStart = Math.round(padding);
  if (position === 'right') {
    vars[VARS.right] = `${crossStart}px`;
    vars[VARS.left] = 'auto';
    vars[VARS.top] = 'auto';
    vars[VARS.bottom] = `${offset}px`;
  } else if (position === 'top') {
    vars[VARS.top] = `${crossStart}px`;
    vars[VARS.bottom] = 'auto';
    vars[VARS.left] = 'auto';
    vars[VARS.right] = `${offset}px`;
  } else if (position === 'bottom') {
    vars[VARS.bottom] = `${crossStart}px`;
    vars[VARS.top] = 'auto';
    vars[VARS.left] = 'auto';
    vars[VARS.right] = `${offset}px`;
  } else {
    vars[VARS.left] = `${crossStart}px`;
    vars[VARS.top] = 'auto';
    vars[VARS.right] = 'auto';
    vars[VARS.bottom] = `${offset}px`;
  }
  return vars;
}

/**
 * 齿轮图标的路径数据 —— **原样取自原生设置触发器**（`[data-slot="settings.trigger"] svg`）。
 *
 * 之前这版是手绘的，画出来是个花瓣似的怪齿轮（用户指出过）。原生图标是 16 网格上的
 * 「中心圆 + 齿形轮廓」两条路径，直接抄过来才能与宿主视觉一致。
 */



/**
 * 安装「设置入口搬进导轨」。
 *
 * @param root0 - 依赖。
 * @param root0.pages - pages 服务（提供 `getSnapshot` / `subscribe`）。
 * @param root0.doc - 文档对象，默认 `globalThis.document`。
 * @returns 还原函数。
 */
export function installSettingsRailEntry({ pages, doc = globalThis.document } = {}) {
  if (doc?.createElement === undefined || doc.head === undefined) return () => {};
  /**
   * 幂等 + 可重入：先清掉我们之前注入的任何一份，再挂新的。
   *
   * ⚠️ 撤销时**按属性重新查**，不能闭包捕获这一个 style 节点 —— 重复安装会把节点换掉，
   * 老的撤销函数就指向一个已经不在文档里的孤儿，卸载看起来「没生效」。测试抓到过。
   */
  const removeAll = () => {
    for (const existing of doc.querySelectorAll('style[data-zju-settings-entry]') ?? []) {
      existing.remove?.();
    }
    for (const existing of doc.querySelectorAll(`[${OWN_MARK}]`) ?? []) existing.remove?.();
  };
  removeAll();
  const style = doc.createElement('style');
  style.dataset.zjuSettingsEntry = '';
  style.textContent = SETTINGS_ENTRY_CSS;
  doc.head.append(style);

  const root = doc.documentElement;
  const names = Object.values(VARS);
  /** 记下我们改过根变量之前的值，卸载时逐项还原。 */
  const previous = new Map(names.map(name => [name, root?.style?.getPropertyValue?.(name) ?? '']));

  const write = () => {
    if (root?.style === undefined) return;
    const vars = settingsGeometry(pages?.getSnapshot?.());
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  };
  write();

  const off = typeof pages?.subscribe === 'function' ? pages.subscribe(write) : undefined;

  /**
   * **不挂自绘按钮**。
   *
   * 这个入口的内容（真实头像、昵称、设置/反馈/登录菜单）全部归宿主。
   * 我们只通过上面的 CSS 把它搬到导轨底部并收成圆形头像 —— 于是：
   *
   *   - 登录后自动显示真实头像（自绘的永远做不到）；
   *   - 点击直接落在原生按钮上，菜单锚点就是它自己的 rect，位置天然正确；
   *   - 宿主改头像/菜单样式，我们自动跟随。
   *
   * 之前那版自绘 + 转发 + `opacity:0` 藏原生的做法，代价是「头像永远是通用人形」，
   * 而这正是用户报的问题。
   */
  return () => {
    off?.();
    removeAll();
    for (const [name, value] of previous) {
      if (value === '') root?.style?.removeProperty?.(name);
      else root?.style?.setProperty?.(name, value);
    }
  };
}
