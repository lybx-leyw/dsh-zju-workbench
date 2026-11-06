/**
 * 「笔记」页的链接图谱。
 *
 * # 这个文件从哪来
 *
 * 移植自生态雷达候选 `packages/radar/dsh-radar-note-graph`（B 类，纯库，MIT：
 * `cytoscape@3.34.4` + `cytoscape-fcose@2.2.0`）。候选判据写得很坦白 ——
 * 「判据 ③ **不成立**，本仓没有任何图谱渲染器，这是『无 → 有』」，
 * 因此它是**全新能力**，不是强化，移植时整包搬进来。
 *
 * # 为什么落在这个包，而不是单开一个包
 *
 * 图的数据来自 `dsh-zhiyun-core-vault`（`graph: { nodes, edges }` 已算好
 * `inDegree` / `outDegree`），落点就是「笔记」页右栏。单独成包只会多一层
 * 打包边界，拿不到任何好处：页面与它是**一对一**的，没有第二个消费者。
 *
 * # 入度/出度不在 cytoscape 里
 *
 * 候选 README 特意纠过一个易错认知：cytoscape 不算度，`vault` 已经算好随节点下发。
 * 本文件只做**映射**，不重算 —— 重算就会出现两套口径。
 */

/**
 * 把 vault 的 `{nodes, edges}` 折成 cytoscape 的 elements。
 *
 * 只做纯映射，不在这里做布局、不碰 DOM —— 这样能脱离浏览器测。
 *
 * @param {{nodes?: object[], edges?: object[]}} graph - `vault` 的 `graph` 方法原样返回。
 * @param {{current?: string}} [options] - `current` 用于标记当前打开的笔记。
 * @returns {{nodes: object[], edges: object[]}}
 */
export function toElements(graph, options = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const current = options.current ?? '';

  return {
    nodes: nodes.map((n) => ({
      data: {
        id: String(n.id ?? ''),
        label: String(n.title ?? n.id ?? ''),
        // 度数是**已有事实**，直接搬；缺失时给 0，不要回填成猜测值。
        inDegree: Number(n.inDegree) || 0,
        outDegree: Number(n.outDegree) || 0,
        tags: Array.isArray(n.tags) ? n.tags : [],
        current: String(n.id ?? '') === current,
        // 孤立节点单独成态：Obsidian 用户要找的就是这些「没连上的想法」。
        orphan: (Number(n.inDegree) || 0) + (Number(n.outDegree) || 0) === 0,
      },
    })),
    edges: edges.filter((e) => e && e.from != null && e.to != null).map((e) => ({
      data: {
        id: `${e.from}->${e.to}:${e.kind ?? 'link'}`,
        source: String(e.from),
        target: String(e.to),
        // `embed` 与 `link` 是两种关系，画法必须不同（虚线/实线）。
        kind: e.kind === 'embed' ? 'embed' : 'link',
        // 重边已由 vault 折叠，`weight` 是「写了多少遍」，只用来定线宽。
        weight: Math.max(1, Number(e.weight) || 1),
      },
    })),
  };
}

/**
 * 挑一个规模合适的布局。
 *
 * fcose 在几千节点上是**秒级且阻塞主线程**的（候选 README 的第 2 条风险）。
 * 因此超过阈值就退到 `preset` —— 节点按圆周摆一圈，至少能看见结构，
 * 且不会把页面卡住。阈值取 800 是候选的建议值，**要用真实笔记库校准**。
 *
 * @param {number} nodeCount - 节点数。
 * @returns {{name: string, animate: boolean, [key: string]: unknown}}
 */
export function layoutFor(nodeCount) {
  if (nodeCount > GRAPH_LAYOUT_LIMIT) {
    return { name: 'preset', animate: false, fit: true, padding: 24 };
  }
  return {
    name: 'fcose',
    animate: false,
    // 下面几项是 fcose 的经验值：小图上 `nodeRepulsion` 过大会把节点推到画布外。
    quality: 'default',
    randomize: false,
    fit: true,
    padding: 24,
    nodeSeparation: 90,
    idealEdgeLength: 90,
  };
}

/** 超过这个节点数就不再跑力导向布局。 */
export const GRAPH_LAYOUT_LIMIT = 800;

/**
 * 给超阈值的情况算一圈预设坐标。
 *
 * `preset` 布局要求节点自带 `position`，否则全部堆在原点。
 * 圆周排布是能一眼看出「有多少个、谁连着谁」的最省事形态。
 *
 * @param {object[]} nodes - `toElements().nodes`。
 * @returns {object[]} 带 `position` 的副本。
 */
export function ringPositions(nodes) {
  const n = nodes.length || 1;
  const radius = Math.max(120, n * 6);
  const cx = radius + 24;
  const cy = radius + 24;
  return nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return {
      ...node,
      position: { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) },
    };
  });
}

/**
 * 图谱的样式表。
 *
 * 颜色全部走壳的 `--zy-*` 变量（候选 README 明确要求「不得写死色值」），
 * 否则明暗主题切换时图会变成一块孤岛。
 *
 * @returns {object[]} cytoscape style 数组。
 */
export function graphStyles() {
  return [
    { selector: 'node', style: {
      'background-color': 'var(--zy-surface, #fff)',
      'border-color': 'var(--zy-border, #d0d0d0)',
      'border-width': 1.5,
      label: 'data(label)',
      color: 'var(--zy-text, #222)',
      'font-size': 10,
      'text-valign': 'bottom',
      'text-margin-y': 4,
      'text-max-width': '90px',
      'text-wrap': 'ellipsis',
      width: 'mapData(inDegree, 0, 8, 18, 40)',
      height: 'mapData(inDegree, 0, 8, 18, 40)',
    } },
    { selector: 'node[current]', style: {
      'background-color': 'var(--zy-accent, #4a7cff)',
      color: 'var(--zy-accent, #4a7cff)',
      'border-color': 'var(--zy-accent, #4a7cff)',
    } },
    { selector: 'node[orphan]', style: {
      'border-style': 'dashed',
      'border-color': 'var(--zy-muted, #999)',
    } },
    { selector: 'edge', style: {
      width: 'mapData(weight, 1, 4, 1, 2.5)',
      'line-color': 'var(--zy-border, #ccc)',
      'target-arrow-color': 'var(--zy-border, #ccc)',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'arrow-scale': 0.7,
    } },
    { selector: 'edge[kind = "embed"]', style: {
      // 嵌入与引用画法必须不同，否则用户分不清「搬过来」与「指向它」。
      'line-style': 'dashed',
    } },
  ];
}
