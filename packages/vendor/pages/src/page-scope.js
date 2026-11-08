/**
 * 页面生命周期与作用域。
 *
 * # 要解决的问题
 *
 * 页面壳目前只保证「切页时 React 卸载组件」。但页面做的事往往**不在 React 树里**：
 *
 *   - 往 `document.head` 插样式
 *   - 给宿主/别处的节点加属性或内联样式
 *   - 注册全局事件监听、定时器、`postMessage`
 *   - 调宿主的服务（打开右侧栏、改布局）
 *
 * 这些在 React 卸载时**不会自动撤销**。真机踩过：论文阅读插件的阅读器 iframe
 * 是 `createPortal(..., document.body)` + `position: fixed`，切回 home 后它还在，
 * 于是「page 层影响了 home」。
 *
 * 光靠约定「页面作者记得清」不够 —— 漏一处就残留。
 *
 * # 这里的做法
 *
 * 页面在 `registerPage` 时提供 `onActivate` / `onDeactivate`。壳在切页时**保证**：
 *
 *   1. 旧页 `onDeactivate()` 先执行；
 *   2. 之后才挂新页的 `onActivate()`；
 *   3. 即使 `onDeactivate` 抛错，也要继续切（不把一个页面的 bug 变成导航故障）；
 *   4. 页面作用域内产生的副作用，壳兜底清理一次。
 *
 * # 作用域
 *
 * 每个页面拿到一个 `PageScope`：
 *
 *   - `scope.element` —— 该页内容的根节点；页面查 DOM 只应从这里开始；
 *   - `scope.own(fn)` —— 注册一个「切页时自动执行」的清理函数；
 *   - `scope.ownStyles(css)` —— 注入一段只作用于本页的样式（自动加作用域前缀）。
 *
 * `own()` 是可嵌套的：`onActivate` 里登记的东西，`onDeactivate` 后由壳统一执行，
 * 页面作者忘记清理也只是**多执行一次空函数**，不会残留。
 */

/** 一个页面的作用域句柄。 */
export class PageScope {
  /**
   * @param {string} pageId - 页面 id。
   * @param {() => HTMLElement | null} getElement - 取本页内容根节点（可能尚未挂载）。
   */
  constructor(pageId, getElement) {
    this.pageId = pageId;
    this._getElement = getElement;
    /** @type {Array<() => void>} */
    this._own = [];
    /** @type {Array<HTMLStyleElement>} */
    this._styles = [];
    this._disposed = false;
  }

  /** 本页内容的根节点；未挂载时为 null。 */
  get element() {
    return this._getElement();
  }

  /**
   * 登记一个清理函数，切页时由壳统一执行（后进先出）。
   *
   * 幂等：页面自己先清过也不要紧，`off()` 只会执行一次。
   *
   * @param {() => void} undo - 撤销副作用的动作。
   * @returns {() => void} 提前执行并注销。
   */
  own(undo) {
    if (typeof undo !== 'function') return () => {};
    let done = false;
    const wrapped = () => {
      if (done) return;
      done = true;
      try { undo(); } catch (error) {
        console.warn(`[dsh-pages] 页面 ${this.pageId} 的清理函数抛错：`, error);
      }
    };
    if (this._disposed) { wrapped(); return () => {}; }
    this._own.push(wrapped);
    return wrapped;
  }

  /**
   * 注入一段只作用于本页的样式。
   *
   * 自动给每条顶层规则加 `[data-page-scope="<id>"]` 前缀 —— 页面作者不必
   * 自己记得加，也就不会写出影响其它页的选择器。
   *
   * 局限：`@media` / `@supports` 内部的规则不递归加前缀（压缩后难以安全解析）。
   * 需要主题级覆盖时，用 `:where()` 降低特异性或在选择器里显式写作用域属性。
   *
   * @param {string} css - 样式文本。
   * @returns {() => void} 提前移除。
   */
  ownStyles(css) {
    if (typeof css !== 'string' || css.trim() === '' || typeof document === 'undefined') {
      return () => {};
    }
    const scoped = scopeCss(css, this.pageId);
    const style = document.createElement('style');
    style.setAttribute('data-dsh-pages-scope', this.pageId);
    style.textContent = scoped;
    document.head.appendChild(style);
    this._styles.push(style);
    return this.own(() => {
      style.remove();
      const at = this._styles.indexOf(style);
      if (at !== -1) this._styles.splice(at, 1);
    });
  }

  /** 由壳调用：执行全部清理（后进先出）。 */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const fn of this._own.splice(0).reverse()) fn();
    for (const style of this._styles.splice(0)) style.remove();
  }
}

/**
 * 给一段 CSS 的每条顶层规则加作用域前缀。
 *
 * 用大括号深度判断「顶层」，避免碰到 `@media` 内部。压缩产物的规则通常是
 * 单行，所以这个简单扫描够用；复杂嵌套（如 `@container`）会被保守跳过
 * （原样保留，靠作者自己保证）。
 *
 * @param {string} css - 原样式。
 * @param {string} pageId - 页面 id。
 * @returns {string} 加过前缀的样式。
 */
export function scopeCss(css, pageId) {
  const prefix = `[data-page-scope="${pageId}"]`;
  let out = '';
  let index = 0;
  let depth = 0;
  let selectorStart = 0;

  while (index < css.length) {
    const ch = css[index];
    if (ch === '{') {
      if (depth === 0) {
        const selector = css.slice(selectorStart, index).trim();
        // 顶层的 at-rule（@media/@supports/@keyframes）不递归加前缀：
        // 它们的子规则选择器在深度 1，简单扫描够不着，原样输出更安全。
        if (selector.startsWith('@')) out += `${selector}{`;
        else out += `${prefix} ${scopeSelector(selector)}{`;
        selectorStart = index + 1;
      } else {
        out += ch;
      }
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        out += '}';
        selectorStart = index + 1;
      } else {
        out += ch;
      }
    } else if (depth > 0) {
      out += ch;
    }
    index += 1;
  }
  // 尾部剩余（如空行）原样保留。
  if (selectorStart < css.length && depth === 0) out += css.slice(selectorStart);
  return out;
}

/**
 * 处理一个选择器列表：每段都加前缀，并给 `:root` / `html` / `body` 换成作用域根。
 *
 * `:root` 这类选择器在作用域内没有意义（根是全文档的），直接替换成作用域属性
 * 选择器，页面作者的意图（「作用于我的根」）才能保住。
 *
 * @param {string} selector - 逗号分隔的选择器列表。
 * @returns {string} 处理后的列表。
 */
function scopeSelector(selector) {
  return selector
    .split(',')
    .map(part => {
      const trimmed = part.trim();
      if (trimmed === '') return part;
      return trimmed.replace(/^(:root|html|body)\b/, '').trim() === ''
        ? '[data-page-scope]'
        : trimmed;
    })
    .join(', ');
}
