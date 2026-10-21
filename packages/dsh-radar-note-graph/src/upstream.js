// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 上游封装占位。
// B 类（其他 JS 项目）只做「能力提取 + 封装」，因此这里做两件事：
//   1. 把锁版凭据收在一处（单一真源）；
//   2. 把「怎么把 vault 的图数据翻译成 cytoscape 的 elements」写成纯函数的形状说明，
//      **但不实现**（实现留到评审通过之后）。
//
// ⚠ 本文件**不得**成为第二份数据来源：节点/边一律取自 `vault.invoke('graph')`。
//   任何「自己再解析一遍 .md 得到更全的图」的想法都要驳回 ——
//   那会与 vault 的 resolver 语义（精确路径 → 同目录 → 全库唯一 basename）分叉，
//   出现「反链里有一篇、图谱里没有」的错位。

export const LOCK = Object.freeze({
  // 与 package.json 的 dependencies 必须逐字一致（不用 ^）。
  cytoscape: '3.34.4',
  'cytoscape-fcose': '2.2.0',
});

/**
 * 主依赖（cytoscape）的包名与版本 —— 供 `src/index.js` 与测试断言「声明、实际安装、
 * 代码预期」三者一致。多依赖的形状见上面的 `LOCK`（单一真源仍是 `LOCK`）。
 */
export const UPSTREAM_PACKAGE = 'cytoscape';
export const UPSTREAM_VERSION = '3.34.4';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/cytoscape/cytoscape.js';


/** 上游许可证（三源核对结论见 README「许可证」表）。 */
export const LICENSES = Object.freeze({
  cytoscape: 'MIT',
  'cytoscape-fcose': 'MIT',
});

/**
 * 「笔记」页目前**没有**任何图谱渲染器 —— 这是本候选存在的全部理由。
 *
 * 判据 ③（底层多调了更优质实现）因此**不成立**：这里是把「无」补成「有」。
 * 保留这个常量是为了让评审一眼看到定性依据，而不是埋在正文里。
 */
export const BASELINE_HAS_GRAPH_RENDERER = false;

/**
 * TODO · 纯函数形状（**未实现**）
 *
 *   toElements(graph) -> cytoscape.ElementDefinition[]
 *     入：vault 的 `{ nodes: [{id,title,inDegree,outDegree,tags}], edges: [{from,to}] }`
 *     出：`[{ data: { id, label, inDegree, outDegree, tags } }, { data: { id:`${from}->${to}`, source, target } }]`
 *     约束：
 *       - 边 id 必须确定（同输入同输出），否则每次重绘都会重新触发布局；
 *       - **不包含**指向未解析目标的边（vault 已把它们放进 `unresolved`）；
 *       - 不做节点去重（vault 的 path 本身唯一）。
 *
 *   layoutOptions(nodeCount) -> object
 *     - nodeCount <= 800 → fcose（`randomize: false` 以求稳定）；
 *     - nodeCount  > 800 → preset（等用户点「布图」再算）。
 *
 * 为什么先写形状而不写实现：骨架的价值是**让评审看到接缝在哪**，
 * 而不是提前交付一份没人复核过的布局参数。
 */
export function toElements(/* graph */) {
  throw new Error('[dsh-radar-note-graph] 占位：尚未实现（候选骨架）');
}

export function layoutOptions(/* nodeCount */) {
  throw new Error('[dsh-radar-note-graph] 占位：尚未实现（候选骨架）');
}
