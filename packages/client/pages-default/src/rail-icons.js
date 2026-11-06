/**
 * 用「CSS 隐藏原字形 + 内联矢量 SVG」替换页面壳内建页的兜底字形（`⌂` / `▦`）。
 *
 * # 为什么不能只用 CSS 画
 *
 * 试过两种纯 CSS 写法，都会糊：
 *   - `mask` + 背景色：蒙版在合成阶段按位图处理，格子外层还有
 *     `transform: scale(railWidth/64)`，缩放后边缘发虚；
 *   - `content: url("data:image/svg+xml,...")`：先按内在尺寸（16px）栅格化，
 *     再被格子缩放 0.8~1.5 倍，同样是大题小做 —— 位图缩放必然不清晰。
 *
 * 页面壳原来渲染的是**内联** `<svg stroke="currentColor">`：矢量元素由浏览器在最终
 * 分辨率上重新光栅化，缩放多少倍都锐利。要做到「与原版一致」，就只能也是内联 svg，
 * 所以这里由产品层插入真正的 `<svg>` 节点。
 *
 * # 分工
 *
 * - **CSS** 只负责隐藏原字形：`[data-dsh-pages-rail-icon]>span{display:none}`，
 *   按 `aria-label` 限定到那两个内建页，不碰插件页自己声明的图标。
 * - **JS** 负责把内联 svg 放进格子里，并在页面壳重渲染后补回去。
 *
 * 形状取自宿主 `@deepseek-ai/dsh-client-ui-primitives` 的
 * `IconWorkspaceTreeOutline` / `IconSlidersTwoOutline`（MIT，Copyright (c) 2026
 * DeepSeek），同一 16×16 网格；`stroke="currentColor"` 让选中/悬停跟原版一样变色。
 */

/** 内联 svg 的创建者标记：既用于去重，也用于「这是我们的节点」的判定。 */
const MARK = 'data-zju-rail-art';

/**
 * 描边图形的规格 —— **必须与页面插件自己声明的图标一致**。
 *
 * 实测仓库里 11 个页面插件（今天/论文/学习/课堂/题库/规划/笔记/插件/文档/反馈…）
 * 全部是这一套：`viewBox="0 0 24 24"`、渲染 19×19、`stroke-width: 1.65`、`fill: none`。
 * 本包原先用的是 16 网格 + 23px + 1.35，摆在它们旁边会明显「更大、更细」——
 * 九个图标里两个不一样，整条导轨就显得没对齐。
 *
 * 所以这里统一向主流看齐；图形沿用同一批形状，只是把 16 网格的坐标按 1.5 倍映射到
 * 24 网格（16 × 1.5 = 24），比例与相对位置完全保持。
 *
 * `RAIL_STROKE_WIDTH` 同时用于导轨与管理页，保证两处粗细一致。
 */
const ICON_VIEWBOX = '0 0 24 24';
const ICON_SIZE = 19;
const RAIL_STROKE_WIDTH = 1.65;
/** 16→24 的坐标放大系数。 */
const GRID_SCALE = 1.5;

/**
 * 把 16 网格的路径数据按 1.5 倍映射到 24 网格。
 *
 * 只处理本项目这套图形里出现的命令（M / L / H / V / C / Z 及其小写形式），
 * 逐个数字乘系数。写成转换函数而不是手工重算坐标，是为了让上面那份图形描述保持
 * 「与宿主原图同源」——出问题时能一眼对照。
 *
 * @param d - 16 网格上的路径数据。
 * @returns 24 网格上的路径数据。
 */
function scalePath(d) {
  return d.replace(/-?\d*\.?\d+/g, number => {
    const scaled = Number(number) * GRID_SCALE;
    // 去掉浮点尾巴（1.4500000000000002 这类），最多保留 4 位
    return String(Math.round(scaled * 1e4) / 1e4);
  });
}

/**
 * 24×24 网格上的描边图形（由上面的 16 网格形状等比映射而来）。
 */
const ARTWORK = Object.freeze({
  workspace: [
    { d: scalePath('M14 12.05c0 .8-.65 1.45-1.46 1.45H3.46C2.65 13.5 2 12.85 2 12.05v-8.1c0-.8.65-1.45 1.46-1.45h2.4c.49 0 .94.24 1.21.65l.5.73c.27.4.73.65 1.21.65h3.76c.8 0 1.46.65 1.46 1.45v6.02Z') },
    { d: scalePath('M8.7 8.1v3M11.2 8.1v3') },
  ],
  sliders: [
    { d: scalePath('M2.3 5h5.85M12.05 5h1.65') },
    { circle: { cx: 9.95 * GRID_SCALE, cy: 5 * GRID_SCALE, r: 1.45 * GRID_SCALE } },
    { d: scalePath('M2.3 11h1.65M7.85 11h5.85') },
    { circle: { cx: 5.75 * GRID_SCALE, cy: 11 * GRID_SCALE, r: 1.45 * GRID_SCALE } },
  ],
});

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * CSS 属性选择器里的字符串转义。
 *
 * 标签由产品配置给出，理论上可能含引号或反斜杠；不转义会让整条规则语法错误，
 * 于是整段映射静默失效。
 *
 * @param value - 标签文本。
 * @returns 转义后的选择器片段。
 */
function cssString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * 一个页面所有可能的标签（字符串或 LocalizedText 的每个语言变体）。
 *
 * 按 `aria-label` 选而不是按 DOM 顺序：顺序会随用户拖动页面变化，标签才是那一页的
 * 身份。标签来自产品配置，可能被改名、也可能是 LocalizedText，所以运行期从配置取值，
 * 并把所有语言变体都写进选择器 —— 切换语言后不需要重新生成。
 *
 * @param label - 配置里的标签。
 * @returns 去重后的标签数组。
 */
function labelsOf(label) {
  if (typeof label === 'string') return label.length > 0 ? [label] : [];
  if (label !== null && typeof label === 'object') {
    return [...new Set(Object.values(label).filter(value => typeof value === 'string' && value.length > 0))];
  }
  return [];
}

/**
 * 需要替换的内建页及其图形。
 *
 * 除了标签们（用于导轨按钮的 `aria-label` 匹配），还带上**页面 id** —— 页面管理页里的
 * 每一行没有 `aria-label` 可用，它的稳定身份是 `id`（`pm-id` 那一段文本）。
 *
 * @param pages - dsh-pages 服务。
 * @returns `{ labels, id, artwork }` 数组。
 */
function targetsOf(pages) {
  const config = pages?.config;
  if (!config) return [];
  return [
    { labels: labelsOf(config.homeLabel), id: config.homePage, artwork: ARTWORK.workspace },
    { labels: labelsOf(config.managerLabel), id: config.managerPage, artwork: ARTWORK.sliders },
  ].filter(target => target.labels.length > 0 || typeof target.id === 'string');
}

/**
 * 只隐藏原字形的样式表。
 *
 * 不在这里画图形：任何 CSS 画法都是位图，缩放后不清晰（见文件头）。
 *
 * @param pages - dsh-pages 服务。
 * @returns 样式表文本。
 */
export function railIconCss(pages) {
  return targetsOf(pages)
    .map(({ labels }) => {
      const buttons = labels
        .map(label => `[data-dsh-pages-rail] button[aria-label=${cssString(label)}]`)
        .join(',');
      const art = `${buttons} [data-dsh-pages-rail-icon]>svg[${MARK}]`;
      // 颜色显式给足：页面壳给未选中页的是 `--dsw-alias-label-secondary`，
      // 在浅色主题下约 `rgb(97,102,107)`，一列图标连起来看就是「糊成一片灰」。
      // 这里改用主色 + 透明度区分选中态：形状与原生同源，但对比够。
      return [
        `${buttons} [data-dsh-pages-rail-icon]>span{display:none!important}`,
        `${art}{color:var(--dsw-alias-label-primary,#101318);opacity:.72}`,
        `${buttons}[aria-current="page"] ${art}{color:var(--dsw-alias-brand-primary,#2f6fed);opacity:1}`,
        `${buttons}:hover ${art}{opacity:1}`,
      ].join('\n');
    })
    .join('\n');
}

/**
 * 造一个内联 svg 元素，规格与页面插件自己声明的图标**完全一致**：24 网格、19px、
 * 1.65 描边（见文件头的 `ICON_*` 说明）。
 *
 * @param doc - 文档对象。
 * @param artwork - `ARTWORK` 里的图形描述。
 * @param size - 可选：覆盖渲染尺寸（管理页的行比导轨小一档时用）。
 * @returns 孤立的 `<svg>` 元素。
 */
export function createArtwork(doc, artwork, size = ICON_SIZE) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttributeNS(null, MARK, '');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', ICON_VIEWBOX);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(RAIL_STROKE_WIDTH));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const shape of artwork) {
    const node = doc.createElementNS(SVG_NS, shape.circle === undefined ? 'path' : 'circle');
    if (shape.circle === undefined) {
      node.setAttribute('d', shape.d);
    } else {
      for (const [key, value] of Object.entries(shape.circle)) node.setAttribute(key, value);
    }
    svg.append(node);
  }
  return svg;
}

/**
 * 把图形塞进两格，并在页面壳重渲染后补回去。
 *
 * 为什么需要观察者：页面壳是受控渲染，切页/拖动/改宽度都会重跑 render。它只认识自己
 * 那个 `<span>`，我们插进去的 `<svg>` 属于「外部节点」，多数重渲染会保留；但一旦被
 * 换掉（例如 key 变化），图标就悄悄变回字形。所以这里盯着导轨，缺了就补。
 *
 * @param pages - dsh-pages 服务。
 * @param doc - 文档对象，默认 `globalThis.document`。
 * @returns 卸载函数。
 */
export function installRailIconArtwork(pages, doc = globalThis.document) {
  const targets = targetsOf(pages);
  if (targets.length === 0 || !doc?.querySelectorAll) return () => {};

  const styles = doc.createElement?.('style');
  if (styles !== undefined && doc.head !== undefined) {
    styles.dataset.zjuRailIcons = '';
    styles.textContent = railIconCss(pages);
    doc.head.append(styles);
  }

  let applying = false;
  // 被移除的原生字形：卸载时放回去，页面壳的 DOM 结构完整如初。
  const removed = [];
  // 页面管理页被替换掉的原文本（`⌂` / `▦`），卸载时按原样写回。
  const removedText = [];
  /**
   * 页面管理页里的同一批内建页：那一行没有 `aria-label`，身份靠 `pm-id` 文本。
   *
   * 与导轨不同的是，这里的字形是 `.pm-icon` 的**裸文本节点** —— CSS 无法只隐藏文本节点
   * 而保留别的子元素，所以只能换成真正的 `<svg>` 元素（与导轨同一套图形）。
   *
   * @param doc - 文档对象。
   */
  const applyManagerIcons = () => {
    const rows = doc.querySelectorAll?.('[data-pages-manager] li') ?? [];
    for (const row of rows) {
      const id = row.querySelector?.('.pm-id')?.textContent?.trim();
      const target = targets.find(item => typeof item.id === 'string' && item.id === id);
      if (target === undefined) continue;
      const cell = row.querySelector?.('.pm-icon');
      if (cell === null || cell === undefined) continue;
      // 已经有我们的图形就跳过 —— 否则每次观察者回调都会重写一遍，形成改动循环。
      if (cell.querySelector(`[${MARK}]`) !== null) continue;
      if (String(cell.textContent ?? '').trim().length === 0) continue;
      removedText.push({ cell, text: cell.textContent });
      cell.textContent = '';
      // 管理页的行图标与导轨同一规格（19px），不再是另一套尺寸。
      cell.append(createArtwork(doc, target.artwork));
    }
  };
  const apply = () => {
    if (applying) return;
    applying = true;
    try {
      applyManagerIcons();
      for (const { labels, artwork } of targets) {
        for (const label of labels) {
          let button;
          try {
            button = doc.querySelector(`[data-dsh-pages-rail] button[aria-label=${cssString(label)}]`);
          } catch {
            continue; // 标签里有意料之外的字符时跳过，不影响其它页
          }
          const cell = button?.querySelector('[data-dsh-pages-rail-icon]');
          if (cell === null || cell === undefined) continue;
          // 物理移走原生字形（`⌂` / `▦`），不是只 display:none：要求是「原版商标隐藏」，
          // 留在 DOM 里既可能被别的样式重新显出来，也让「已替换」这件事无法自证。
          for (const glyph of [...cell.children]) {
            if (glyph.tagName?.toLowerCase() !== 'span') continue;
            removed.push({ cell, glyph, next: glyph.nextSibling ?? null });
            glyph.remove();
          }
          if (cell.querySelector(`[${MARK}]`) !== null) continue;
          cell.append(createArtwork(doc, artwork));
        }
      }
    } finally {
      applying = false;
    }
  };

  apply();

  // 观察整棵文档，而不是只观察导轨：本包可能在页面壳之前 apply，那时导轨还不存在，
  // 只盯它会「什么都没盯上」，之后页面壳重渲染也就再没有触发点（真机踩过：
  // 样式生效、字形被隐藏，但 svg 一直没插进去 —— 结果是格子全空）。
  // `documentElement` 从 apply 起就一定在，所以用它是唯一稳定的锚点。
  const root = doc.documentElement ?? doc.body ?? doc.querySelector?.('[data-dsh-pages-rail]');
  const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  let observer;
  if (root !== null && root !== undefined && typeof Observer === 'function') {
    observer = new Observer(() => {
      if (applying) return;
      apply();
    });
    observer.observe(root, { childList: true, subtree: true });
  } else if (typeof doc.defaultView?.requestAnimationFrame === 'function') {
    // 没有 MutationObserver 时的退路：下一帧再试一次，至少覆盖「晚于本包挂载」的常见情形。
    doc.defaultView.requestAnimationFrame(() => apply());
  }

  return () => {
    observer?.disconnect();
    styles?.remove?.();
    // 先摘掉自己插进去的图形，再把原生字形按原顺序放回去 —— 卸载后页面壳的 DOM
    // 与它自己渲染出来的一模一样。
    for (const node of doc.querySelectorAll?.(`[${MARK}]`) ?? []) {
      if (typeof node.remove === 'function') node.remove();
    }
    for (const { cell, glyph, next } of removed.splice(0).reverse()) {
      if (next !== null && next.parentNode === cell) cell.insertBefore(glyph, next);
      else cell.append(glyph);
    }
    // 页面管理页里我们清空过的文本格子，把原字符写回去。
    for (const { cell, text } of removedText.splice(0)) {
      if (cell.isConnected === false) continue;
      cell.textContent = text;
    }
  };
}
