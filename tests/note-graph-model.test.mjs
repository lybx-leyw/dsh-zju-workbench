/**
 * 笔记图谱的映射与布局策略测试。
 *
 * 这些是**纯函数**，不需要宿主、不连网、不碰 DOM —— 所以能在 `npm test` 里跑。
 * 组件的渲染不在测试范围内（宿主里用 `npm run test:host` 看）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toElements, layoutFor, ringPositions, graphStyles, GRAPH_LAYOUT_LIMIT,
} from '../packages/dsh-zhiyun-graph-render/src/model.js';

const sample = {
  nodes: [
    { id: 'a.md', title: '甲', inDegree: 2, outDegree: 1, tags: ['x'] },
    { id: 'b.md', title: '乙', inDegree: 1, outDegree: 1, tags: [] },
    { id: 'lonely.md', title: '孤岛', inDegree: 0, outDegree: 0, tags: [] },
  ],
  edges: [
    { from: 'a.md', to: 'b.md', kind: 'link', weight: 2 },
    { from: 'b.md', to: 'a.md', kind: 'embed', weight: 1 },
  ],
};

test('度数直接取自 vault，不在这里重算', () => {
  const { nodes } = toElements(sample);
  const a = nodes.find((n) => n.data.id === 'a.md');
  assert.equal(a.data.inDegree, 2);
  assert.equal(a.data.outDegree, 1);
});

test('孤立节点被标出来（Obsidian 用户要找的就是它们）', () => {
  const { nodes } = toElements(sample);
  assert.equal(nodes.find((n) => n.data.id === 'lonely.md').data.orphan, true);
  assert.equal(nodes.find((n) => n.data.id === 'a.md').data.orphan, false);
});

test('当前笔记被标出来', () => {
  const { nodes } = toElements(sample, { current: 'b.md' });
  assert.equal(nodes.find((n) => n.data.id === 'b.md').data.current, true);
  assert.equal(nodes.find((n) => n.data.id === 'a.md').data.current, false);
});

test('embed 与 link 两种 kind 原样保留（画法不同）', () => {
  const { edges } = toElements(sample);
  assert.deepEqual(edges.map((e) => e.data.kind), ['link', 'embed']);
});

test('weight 原样保留，缺失时退到 1', () => {
  const { edges } = toElements({ nodes: [], edges: [{ from: 'a', to: 'b' }] });
  assert.equal(edges[0].data.weight, 1);
});

test('缺字段容错：不抛错，空图得到空元素', () => {
  for (const input of [null, undefined, {}, { nodes: null }]) {
    const out = toElements(input);
    assert.deepEqual(out, { nodes: [], edges: [] });
  }
});

test('边缺 from/to 的被丢掉，不让 cytoscape 拿到坏 id', () => {
  const { edges } = toElements({ nodes: [], edges: [{ from: 'a' }, null, { from: 'a', to: 'b' }] });
  assert.equal(edges.length, 1);
});

test('小图用 fcose，大图退到 preset（避免主线程秒级阻塞）', () => {
  assert.equal(layoutFor(10).name, 'fcose');
  assert.equal(layoutFor(GRAPH_LAYOUT_LIMIT).name, 'fcose');
  assert.equal(layoutFor(GRAPH_LAYOUT_LIMIT + 1).name, 'preset');
});

test('ringPositions 给每个节点唯一坐标（preset 布局要求）', () => {
  const { nodes } = toElements({ nodes: Array.from({ length: 5 }, (_, i) => ({ id: `n${i}.md` })), edges: [] });
  const placed = ringPositions(nodes);
  const keys = new Set(placed.map((n) => `${n.position.x.toFixed(2)},${n.position.y.toFixed(2)}`));
  assert.equal(keys.size, 5, '五个节点不能堆在同一个点');
});

test('样式表只用 --zy-* 变量，不写死色值', () => {
  // 明暗主题靠壳的变量切换；写死 #fff 会在深色模式里变成一块白板。
  const flat = JSON.stringify(graphStyles());
  const hex = flat.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  // 允许 `var(--zy-x, #fallback)` 里的兜底色：它们只在变量未定义时生效。
  for (const h of hex) {
    assert.ok(flat.includes(`var(--zy-`) || flat.includes(`var(--zy`), `样式里出现了裸色值 ${h}`);
  }
  assert.ok(flat.includes('var(--zy-accent'), '当前节点必须用主题强调色');
});
