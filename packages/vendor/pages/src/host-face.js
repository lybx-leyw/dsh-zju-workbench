/**
 * @param {number} railWidth - current rail width in px.
 * @param {string} railPosition - one of left/right/top/bottom.
 * @returns {string} the layout stylesheet.
 */

/**
 * 宿主抽象层：页面访问宿主 UI 的**唯一**入口。
 *
 * # 要解决的问题
 *
 * 页面想做布局，只能自己去 `document.querySelector('[data-rightbar-col]')`、
 * 读 `getComputedStyle(...).gridTemplateColumns`、给宿主节点加属性 —— 真机审计出
 * 16 处这样的耦合，全在论文阅读插件里。后果：
 *
 *   - 宿主的 class / data 属性一改，页面静默失效；
 *   - 页面直接改宿主样式，**影响了 home**（那是这一轮要根除的）。
 *
 * # 为什么是抽象层，不是文档
 *
 * 文档只能「建议」别碰 DOM。抽象层让页面**没有理由**去碰 —— 它要的东西这里都有，
 * 而且形状稳定（宿主内部怎么实现是宿主的事）。
 *
 * # 优先级：服务 > DOM
 *
 * 宿主有正式的服务面（`ctx.layout.openRightbar` / `closeRightbar` /
 * `toggleSidebar` / `panelInfo`）。能用服务就不该读 DOM —— 服务是契约，
 * DOM 属性是实现细节。只有**几何测量**（「这块区域现在多宽」）服务给不了，
 * 才回落到 DOM，而且回落路径集中在这一个文件里。
 *
 * # 边界：只管 UI
 *
 * 这里只暴露 UI 相关的读与少量写。不涉及 cordis 服务注册、数据栈、功能插件 ——
 * 那些归各自的栈管。
 */

/** 宿主 UI 的面。页面拿到的 `props.host` 就是它。 */
export class HostFace {
  /**
   * @param {object} options
   * @param {() => object | undefined} options.getLayout - 惰性取 `ctx.layout`。
   * @param {() => Document | undefined} options.getDocument - 惰性取 document（测试可注入）。
   */
  constructor({ getLayout, getDocument }) {
    this._getLayout = getLayout;
    this._getDocument = getDocument;
  }

  /** 当前文档；SSR/测试环境下为 undefined。 */
  get document() {
    return this._getDocument();
  }

  // ── 右栏 ────────────────────────────────────────────────

  /**
   * 右栏当前是否展开。
   *
   * 优先读服务（`panelInfo` 的 observable）；服务缺席时回落到 DOM 标记。
   * @returns {boolean}
   */
  rightbarOpen() {
    const layout = this._getLayout();
    const info = layout?.panelInfo;
    if (info !== undefined && typeof info.getSnapshot === 'function') {
      try {
        const snapshot = info.getSnapshot();
        // `rightbar` 是轨道宽度：0 表示收起。
        if (typeof snapshot?.cols?.rightbar === 'number') return snapshot.cols.rightbar > 0;
      } catch { /* 服务未就绪，走 DOM */ }
    }
    const doc = this.document;
    if (doc === undefined) return false;
    return doc.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') !== null;
  }

  /**
   * 展开右栏。
   * @param {{ track?: boolean, fullscreen?: boolean }} options - 见 `ILayout.openRightbar`。
   * @returns {boolean} 是否成功（服务缺席时为 false，调用方据此决定要不要回退）。
   */
  openRightbar({ track = true, fullscreen = false } = {}) {
    const layout = this._getLayout();
    if (typeof layout?.openRightbar !== 'function') return false;
    try { layout.openRightbar(track, fullscreen); return true; } catch { return false; }
  }

  /** 收起右栏。@returns {boolean} 是否成功。 */
  closeRightbar() {
    const layout = this._getLayout();
    if (typeof layout?.closeRightbar !== 'function') return false;
    try { layout.closeRightbar(); return true; } catch { return false; }
  }

  /**
   * 右栏面板的**内容区矩形**（用于把浮层对齐到它）。
   *
   * 这是唯一必须读 DOM 的几何：服务只报轨道宽度，不报面板滚到哪里、
   * 被 dockkit 的列偏移了多少。
   *
   * @returns {DOMRect | null} 未展开或文档缺席时为 null。
   */
  rightbarRect() {
    const doc = this.document;
    if (doc === undefined) return null;
    const panel = doc.querySelector('[data-sidebar-right-panel]');
    if (panel === null) return null;
    const rect = panel.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  /**
   * 宿主三栏框架的当前轨道宽度（`grid-template-columns`）。
   *
   * 同样只有 DOM 能给。返回值按需解析失败时为空数组。
   * @returns {number[]}
   */
  frameTracks() {
    const doc = this.document;
    if (doc === undefined) return [];
    const col = doc.querySelector('[data-rightbar-col]');
    const frame = col?.parentElement;
    if (frame === undefined || frame === null) return [];
    try {
      return getComputedStyle(frame).gridTemplateColumns.split(' ').map(parseFloat).filter(Number.isFinite);
    } catch { return []; }
  }

  // ── 左栏 ────────────────────────────────────────────────

  /** 切换左栏（服务面）。@returns {boolean} */
  toggleSidebar() {
    const layout = this._getLayout();
    if (typeof layout?.toggleSidebar !== 'function') return false;
    try { layout.toggleSidebar(); return true; } catch { return false; }
  }

  // ── 主题 ────────────────────────────────────────────────

  /**
   * 宿主当前是否深色，与具体主题服务解耦。
   *
   * 读的是渲染后的事实（根元素的 `data-theme` / 背景），不是服务的内部状态 ——
   * 页面只关心「我现在该用哪套颜色」。
   * @returns {'dark' | 'light'}
   */
  colorScheme() {
    const doc = this.document;
    if (doc === undefined) return 'light';
    const root = doc.documentElement;
    const declared = root.getAttribute('data-theme') ?? root.getAttribute('data-color-scheme');
    if (declared === 'dark' || declared === 'light') return declared;
    try {
      return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true ? 'dark' : 'light';
    } catch { return 'light'; }
  }
}

/**
 * 造一个宿主面。
 *
 * @param ctx - cordis client context（需要 `layout` 可选注入）。
 * @param options.getDocument - 覆盖文档来源（测试用）。
 * @returns {HostFace}
 */
export function createHostFace(ctx, options = {}) {
  const getDocument = options.getDocument
    ?? (() => (typeof document === 'undefined' ? undefined : document));
  return new HostFace({
    // 惰性取：`layout` 是可选的，缺席时 `HostFace` 自动回落到 DOM 读。
    getLayout: () => {
      try { return ctx.get('layout'); } catch { return undefined; }
    },
    getDocument,
  });
}
