/**
 * 上游封装占位 —— **未评审、不可直接使用**。
 *
 * 四件事，都是「把上游的形状接到本仓的形状」：
 *
 *   1. `toMarkdownTree(markdown)`  —— 文本 → mdast。锁版 `remark-parse@11.0.0`。
 *   2. `collectWikilinks(tree)`    —— mdast → `[{ target, heading, blockId, alias, start }]`。
 *      **只遍历 `text` 节点**，因此代码围栏与行内代码天然不参与（F-2）。
 *      语义切分**不**在这里做：别名/小节/块引用仍交给本仓
 *      `dsh-zhiyun-vault/src/parse/links.js` 的 `splitWikilink`。
 *   3. `toGraph(edges)`            —— 边表 → graphology 图。`multi:false` + `mergeEdge`
 *      折叠重边（F-4），并保留 `count` 属性。
 *   4. `cluster(graph)`            —— 社区检测。`graphology-communities-louvain@2.0.2`，
 *      输入必须是**无向**图（TODO-5）。
 *
 * ⚠️ 本文件**不 import 任何上游**（占位阶段连依赖都不拉），只写清签名与约束。
 *    评审通过后按此实现；实现时**不得**把这些上游拷贝进本仓。
 */

/** @typedef {{ target: string, heading: string|null, blockId: string|null, alias: string|null, start: number }} Wikilink */

/**
 * @param {string} _markdown
 * @returns {import('mdast').Root}
 */
export function toMarkdownTree(_markdown) {
  // TODO-1：`unified().use(remarkParse).parse(markdown)`
  throw new Error('候选骨架：未实现（见 src/index.js TODO-1）');
}

/**
 * 只有 `text` 节点里的 `[[…]]` 才算链接。
 *
 * 与旧实现的差别（2026-10-20 实测）：
 *   · `见 [[A]]与 [[B]]` —— 旧实现正则贪婪，只命中 `A]]与 [[B` 一个「链接」，B 消失（F-1）；
 *     本函数会拿到两段 text，**两个都命中**。
 *   · 代码块 / 行内代码里的 `[[x]]` —— 旧实现算链接（F-2）；本函数**不算**。
 *   · `%%注释%%`、`> [!callout]`、frontmatter —— **仍会被算作链接**，这是已知边界。
 *
 * @param {import('mdast').Root} _tree
 * @returns {Wikilink[]}
 */
export function collectWikilinks(_tree) {
  // TODO-2：`visit(tree, 'text', …)`，正则用**非贪婪** `\[\[([^\]\n]*?)\]\]`
  throw new Error('候选骨架：未实现（见 src/index.js TODO-2）');
}

/**
 * @param {Array<{from: string, to: string, kind?: string}>} _edges
 * @returns {import('graphology').default}
 */
export function toGraph(_edges) {
  // TODO-4：`new Graph({ multi: false, type: 'directed' })`；`mergeNode` + `mergeEdge`，
  //         重复边计入 `count` 属性。⚠️ 实测：graphology 的 `addEdge` 在源节点不存在时
  //         抛 `NotFoundGraphError`，必须先 `mergeNode`。
  throw new Error('候选骨架：未实现（见 src/index.js TODO-4）');
}

/**
 * @param {import('graphology').default} _graph
 * @returns {Record<string, number>}
 */
export function cluster(_graph) {
  // TODO-5 / TODO-6：无向化 → `louvain(graph)` → 按最小节点 id 规范化编号。
  throw new Error('候选骨架：未实现（见 src/index.js TODO-5/6）');
}
