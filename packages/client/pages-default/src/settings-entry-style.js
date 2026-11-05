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
 * 类名是 CSS module 生成的；稳定锚点 `data-slot="settings.trigger"` 在它内部，
 * 所以必须用类名才能选中容器。退化行为：藏不住原生入口（多一个入口），但功能仍在。
 */
const AREA = '.hHd-Xa_settingsArea';

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
 *   - 原生设置区：藏起来（入口由我们自己的按钮承担）；
 *   - 我们的按钮：位置尺寸全部走 `pages` 服务算出的变量。
 *
 * 因为按钮挂在 `body` 下，它不在任何带 `opacity`/`transform` 过渡的侧栏子树里，
 * 所以收起侧栏时它**不会跟着淡出** —— 这正是这一版要解决的问题。
 */
export const SETTINGS_ENTRY_CSS = `
/* 原生入口藏掉：位置与外观由我们自己的按钮接管，避免出现两个设置。 */
${AREA}{
  display:none !important;
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
  color:var(--dsw-alias-label-info,var(--zy-brand,#94bdf4)) !important;
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

/* 我们自己的设置按钮：fixed 相对视口，挂在 body 下，不受侧栏透明度影响。 */
[${OWN_MARK}]{
  position:fixed;
  left:var(${VARS.left},0);
  right:var(${VARS.right},auto);
  top:var(${VARS.top},auto);
  bottom:var(${VARS.bottom},50px);
  width:var(${VARS.button},37px);
  height:var(${VARS.button},37px);
  padding:0;
  margin:0;
  box-sizing:border-box;
  display:grid;
  place-items:center;
  border:none;
  background:transparent;
  border-radius:var(${VARS.radius},7px);
  color:var(--dsw-alias-label-primary,#101318);
  cursor:pointer;
  z-index:45;
}
[${OWN_MARK}]:hover{
  background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));
}
[${OWN_MARK}]:focus-visible{
  outline:2px solid var(--dsw-alias-border-info,var(--zy-accent,#94bdf4));
  outline-offset:2px;
}
[${OWN_MARK}] svg{
  width:var(${VARS.icon},18px);
  height:var(${VARS.icon},18px);
  /* 视觉描边与导轨其它页面图标统一，具体值由 settingsGeometry 反算后写入
     （见 strokeWidthFor）。不在这里用 calc 除以带单位的变量：那样兼容性差，
     也没法在纯函数里测。 */
  stroke-width:var(${VARS.stroke},1.15px);
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
const GEAR = Object.freeze({
  viewBox: '0 0 16 16',
  size: 16,
  strokeWidth: 1.3,
  paths: Object.freeze([
    'M8 9.75012C8.9665 9.75012 9.75 8.96662 9.75 8.00012C9.75 7.03362 8.9665 6.25012 8 6.25012C7.0335 6.25012 6.25 7.03362 6.25 8.00012C6.25 8.96662 7.0335 9.75012 8 9.75012Z',
    'M13.0107 7.79377C12.9505 7.89401 12.9205 7.94413 12.9205 7.99951C12.9205 8.0549 12.9505 8.10502 13.0106 8.20528L13.9849 9.83006C14.045 9.93029 14.0751 9.9804 14.0751 10.0358C14.0751 10.0911 14.045 10.1413 13.9849 10.2415L13.0037 11.8777C12.9468 11.9726 12.9184 12.0201 12.8725 12.0461C12.8267 12.072 12.7713 12.072 12.6607 12.072H10.6704C10.5598 12.072 10.5045 12.072 10.4586 12.098C10.4128 12.1239 10.3843 12.1714 10.3274 12.2662L9.33825 13.9142C9.28133 14.009 9.25287 14.0564 9.20703 14.0823C9.16118 14.1083 9.10588 14.1083 8.99529 14.1083H7.00486C6.89426 14.1083 6.83896 14.1083 6.79312 14.0823C6.74727 14.0564 6.71881 14.009 6.6619 13.9142L5.67273 12.2662C5.61581 12.1714 5.58735 12.1239 5.54151 12.098C5.49566 12.072 5.44036 12.072 5.32977 12.072H3.33945C3.2288 12.072 3.17347 12.072 3.12761 12.0461C3.08176 12.0201 3.0533 11.9726 2.9964 11.8777L2.0152 10.2415C1.9551 10.1413 1.92505 10.0911 1.92505 10.0358C1.92505 9.9804 1.9551 9.93029 2.0152 9.83006L2.98951 8.20528C3.04963 8.10502 3.07969 8.0549 3.07969 7.99951C3.07968 7.94413 3.04961 7.89401 2.98946 7.79377L2.01529 6.17011C1.95514 6.06987 1.92507 6.01975 1.92507 5.96437C1.92506 5.90899 1.95512 5.85886 2.01524 5.7586L2.9964 4.1224C3.0533 4.0275 3.08176 3.98005 3.12761 3.95408C3.17347 3.92811 3.2288 3.92811 3.33945 3.92811H5.32977C5.44036 3.92811 5.49566 3.92811 5.54151 3.90216C5.58735 3.87621 5.61581 3.82879 5.67273 3.73397L6.6619 2.08599C6.71881 1.99116 6.74727 1.94375 6.79312 1.9178C6.83896 1.89185 6.89426 1.89185 7.00486 1.89185H8.99529C9.10588 1.89185 9.16118 1.89185 9.20703 1.9178C9.25287 1.94375 9.28133 1.99116 9.33825 2.08599L10.3274 3.73397C10.3843 3.82879 10.4128 3.87621 10.4586 3.90216C10.5045 3.92811 10.5598 3.92811 10.6704 3.92811H12.6607C12.7713 3.92811 12.8267 3.92811 12.8725 3.95408C12.9184 3.98005 12.9468 4.0275 13.0037 4.1224L13.9849 5.7586C14.045 5.85886 14.0751 5.90899 14.0751 5.96437C14.0751 6.01975 14.045 6.06987 13.9849 6.17011L13.0107 7.79377Z',
  ]),
});

/**
 * 造我们自己的设置按钮。
 *
 * 图标原样复用原生那一份（见 {@link GEAR}），只按导轨尺寸等比缩放；不手绘，
 * 否则形状与宿主对不上（第一版画成了花瓣齿轮）。
 *
 * @param doc - 文档对象。
 * @returns 按钮元素。
 */
function createOwnButton(doc) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.setAttribute(OWN_MARK, '');
  button.setAttribute('aria-label', '设置');
  button.setAttribute('title', '设置');
  button.setAttribute('aria-haspopup', 'dialog');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  // 与原生完全相同的属性：同一个 viewBox、同一套描边，缩放交给 CSS。
  svg.setAttribute('width', String(GEAR.size));
  svg.setAttribute('height', String(GEAR.size));
  svg.setAttribute('viewBox', GEAR.viewBox);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(GEAR.strokeWidth));
  svg.setAttribute('aria-hidden', 'true');
  for (const d of GEAR.paths) {
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  button.append(svg);
  return button;
}

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
   * 把按钮挂到 `body`，**不是** `head` 或侧栏里。
   *
   * 挂在 `body` 直属层的意义：它不在 `.hHd-Xa_footArea` 之内，所以侧栏收起时
   * 那个 `opacity: 1 → 0 → 1` 的过渡不会作用到它 —— 这正是「闪一帧」的根治点。
   */
  const button = createOwnButton(doc);
  button.addEventListener('click', event => {
    event.preventDefault();
    // 每次点击现查原生触发器：它可能已经被 React 重建过实例。
    doc.querySelector('[data-slot="settings.trigger"]')?.closest?.('button')?.click?.();
  });
  (doc.body ?? doc.documentElement).append(button);

  return () => {
    off?.();
    removeAll();
    for (const [name, value] of previous) {
      if (value === '') root?.style?.removeProperty?.(name);
      else root?.style?.setProperty?.(name, value);
    }
  };
}
