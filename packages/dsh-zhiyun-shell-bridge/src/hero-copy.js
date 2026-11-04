/**
 * 原生工作台首页那句口号的智云版本。
 *
 * 原生 hero 的文案来自 `dsh-client-ui-conversation` 的 locale 字典
 * （`hero.headline`），而 `locale.register()` 对已注册过的 namespace+语言是**报错**
 * 而不是覆盖 —— 所以这里不做字典替换，也不重画 hero：
 *
 *   - 只把那一处**文本节点**换成智云的口号，字号、字重、间距等版式仍由原生样式决定；
 *   - 用 `MutationObserver` 兜住重渲染（切工作区/新建会话会重新挂载 hero），
 *   - 卸载时把原文还原，保持「撤掉插件就等于没装过」。
 *
 * 触发范围很窄：只认**完全等于**原始文案、且自身没有子元素的 `<span>`，并跳过我们
 * 自己的导轨子树。这样不会误伤正文里恰好引用这句话的地方。
 */

/**
 * 原始文案 → 智云文案。
 *
 * 只映射中文：换了词的是中文产品文案，英文界面保持原生英文 —— 硬造一句英文翻译
 * 反而会让人以为官方英文名就是它。
 */
export const HERO_COPY = Object.freeze({ '探索未至之境': '海纳江河，启真厚德' });

/** 换过文案的元素标记，便于排查「这句为什么变了」。 */
export const HERO_MARK = 'data-zy-hero-copy';

/** 我们自己的页面壳子树 —— hero 不在其中，但不要冒险改到别的地方。 */
const OWN_SHELL = '[data-dsh-pages-shell]';

/**
 * @param text - 已 trim 的候选文本。
 * @returns 智云文案，没有对应项时返回 undefined。
 */
export function heroCopyFor(text) {
  return HERO_COPY[text];
}

function isCandidate(node) {
  if (node.nodeType !== 1 || node.tagName !== 'SPAN' || node.childElementCount !== 0) return false;
  if (node.hasAttribute(HERO_MARK)) return false;
  if (typeof node.closest === 'function' && node.closest(OWN_SHELL) !== null) return false;
  return heroCopyFor(node.textContent.trim()) !== undefined;
}

/**
 * 把当前 DOM 里符合条件的 hero 文案换掉。
 *
 * 已经换过的节点带标记，会被跳过 —— 因此可以反复调用，而不会来回翻转。
 *
 * @param doc - 提供 `querySelectorAll` 的文档对象。
 * @returns 还原函数；可重复调用，只生效一次。
 */
export function applyHeroCopy(doc) {
  const replaced = [];
  if (typeof doc?.querySelectorAll !== 'function') return () => {};
  const nodes = doc.querySelectorAll('span');
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!isCandidate(node)) continue;
    const original = node.textContent;
    node.setAttribute(HERO_MARK, '');
    node.textContent = heroCopyFor(original.trim());
    replaced.push({ node, original });
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const { node, original } of replaced.reverse()) {
      node.removeAttribute(HERO_MARK);
      node.textContent = original;
    }
  };
}

/**
 * 持续维护这条文案，直到卸载。
 *
 * 观察整棵 body：hero 会随工作区/会话重新挂载，只扫一次会漏。回调里再做一次全量
 * 扫描即可 —— 候选只有 `span`，已换过的带标记直接跳过。
 *
 * 新出现的节点不会进入首次返回的还原闭包，所以回调里把它们的还原函数也记下来，
 * 卸载时一并执行。
 *
 * @param ctx - 客户端上下文（只用 `ctx.effect`）。
 * @param doc - 文档对象；默认全局 `document`。
 */
export function installHeroCopy(ctx, doc = globalThis.document) {
  if (typeof doc?.querySelectorAll !== 'function' || typeof globalThis.MutationObserver !== 'function') return;
  ctx.effect(() => {
    const restores = [applyHeroCopy(doc)];
    const observer = new globalThis.MutationObserver(() => {
      restores.push(applyHeroCopy(doc));
    });
    observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      for (const restore of restores.reverse()) restore();
    };
  }, 'zhiyun: hero copy');
}
