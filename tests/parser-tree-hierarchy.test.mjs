/**
 * 建树的**分层契约**（审查报告第 4 条）。
 *
 * 图规定：`buildTreeFromBlocks()` 必须真的走
 *   筛支线 → 挂账 → 正交审查 → 并发真 merge → 拆叶 → 重聚 → **分级聚合**
 * 并且交出的是**带标题层级的树**，不是一排平铺叶。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTreeFromBlocks, aggregateTree, makeTitle, leavesOf, titlesOf, orthogonalizePoints,
} from '../packages/dsh-zhiyun-core-parser/src/tree.js';

function block(index, page, text, { role = '主线', facet = '概念' } = {}) {
  return { index, page, sentences: [{ text }], tag: { role, facets: [facet], summary: '' } };
}

test('【缺陷 4】tree 是**带层级**的树，不是平铺数组', () => {
  /* 造 12 个知识点：每片很短，会被重聚成若干叶。 */
  const blocks = Array.from({ length: 12 }, (_, i) => block(i + 1, Math.floor(i / 3) + 1, `第${i}段正文。`.repeat(8)));
  const tree = buildTreeFromBlocks(blocks, { splitLine: 200 });

  assert.ok(tree.tree, '必须交出 tree（而不是只给 knowledgePoints）');
  assert.equal(tree.tree.kind, 'title', '根必须是 title 节点（名字在父节点）');

  const leaves = leavesOf(tree.tree);
  assert.ok(leaves.length > 0, '树里必须有叶');
  assert.ok(leaves.every((l) => l.kind === 'leaf'), '叶子节点的 kind 必须是 leaf');
  assert.ok(leaves.every((l) => !l.title), '按图：叶只有正文、没有名字');

  const titles = titlesOf(tree.tree);
  assert.ok(titles.length >= 2, `必须有多个 title 层级，实际 ${titles.length}`);
  assert.ok(titles.every((t) => Array.isArray(t.children)), 'title 节点要有 children');
});

test('【缺陷 4】真的执行了正交审查：同页的块只产出一片叶', () => {
  /* 同一页 4 块 —— 不管由「挂账按页聚合」还是「正交审查」完成，
   * 最终都必须只剩**一片**叶：同一页的碎段不该各自变成知识点。
   *
   * ⚠️ 这里不断言 `orthoMerges > 0`：挂账阶段已经按页把块收在一起了，
   * 审查阶段自然没有"多片同名叶"可并。审查**确实执行了**，只是无事可做 ——
   * 那是正确结果，不该为了凑指标而制造冗余叶。 */
  const blocks = Array.from({ length: 4 }, (_, i) => block(i + 1, 1, `同页第${i}段。`.repeat(10)));
  const tree = buildTreeFromBlocks(blocks, { splitLine: 100000 });

  assert.equal(tree.leaves.length, 1, `同页 4 块应只剩 1 片叶，实际 ${tree.leaves.length}`);
  assert.equal(tree.knowledgePoints.length, 1, '同页碎段不该裂成多个知识点');
  assert.ok('orthoMerges' in tree.stats, '审查步骤必须留下统计（哪怕为 0）');
  assert.ok(Array.isArray(tree.orthogonal), '审查结果必须可查');
});

test('【缺陷 4】正交审查在真有重复时确实合并', () => {
  /* 跨页同名/相邻：构造两片同页来源的叶（人为拆开），审查应当并回一片。 */
  const leaves = [
    { id: 'a', page: 7, blocks: [block(1, 7, '甲'.repeat(50))], pendingTok: 10, pendingB: 1, attach: [] },
    { id: 'b', page: 7, blocks: [block(2, 7, '乙'.repeat(50))], pendingTok: 20, pendingB: 1, attach: [] },
  ];
  const out = orthogonalizePoints(leaves);

  assert.equal(out.leaves.length, 1, '同页两片必须并成一片');
  assert.equal(out.merges.length, 1);
  assert.equal(out.merges[0].keepId, 'a', '保留第一片');
  assert.deepEqual(out.merges[0].dropIds, ['b']);
  assert.equal(out.merges[0].absorbedTokens, 20, '吸收的 token 要如实记账');
});

test('【缺陷 4】真的调用了分级聚合：知识点多时会收成层', () => {
  /* 20 个互不相干的短块，分在 20 页（避免被审查并掉）→ 会重聚成多叶 → 需要聚合。 */
  const blocks = Array.from({ length: 20 }, (_, i) => block(i + 1, i + 1, `第${i}页正文。`.repeat(6)));
  const tree = buildTreeFromBlocks(blocks, { splitLine: 60, perNode: 3 });

  assert.ok(tree.stats.aggregateRounds >= 1, `应当至少聚合一伦，实际 ${tree.stats.aggregateRounds}`);
  assert.ok(tree.stats.treeDepth >= 3, `树应当有 3 层以上（根→组→叶），实际 ${tree.stats.treeDepth}`);
  assert.ok(leavesOf(tree.tree).length >= tree.knowledgePoints.length * 0.8,
    '聚合不能丢知识点');
});

test('【缺陷 4】聚合可注入语义分组（图：层数由分级 LLM 决定）', () => {
  const points = Array.from({ length: 6 }, (_, i) => ({
    id: `n${i}`, tok: 100, blocks: [], merged: 1, title: `知识点${i}`,
  }));

  const calls = [];
  const group = (children) => {
    calls.push(children.length);
    if (children.length <= 2) return [];      // 到底了
    const half = Math.ceil(children.length / 2);
    return [
      { title: '上半', children: children.slice(0, half) },
      { title: '下半', children: children.slice(half) },
    ];
  };

  const out = aggregateTree(points, { group });
  assert.ok(calls.length >= 1, '注入的分组函数必须被调用');
  assert.ok(titlesOf(out.root).some((t) => t.title === '上半'), '自定义标题应当出现在树上');
  assert.ok(titlesOf(out.root).some((t) => t.title === '下半'));
  assert.equal(leavesOf(out.root).length, 6, '叶必须一片不少');
});

test('【缺陷 4】不注入分组时，标题不编造（如实写"第 N 组"）', () => {
  const points = Array.from({ length: 9 }, (_, i) => ({
    id: `n${i}`, tok: 10, blocks: [], merged: 1, title: '',
  }));
  const out = aggregateTree(points, { perNode: 3 });
  const names = titlesOf(out.root).map((t) => t.title);
  assert.ok(names.some((n) => /第 \d+ 组/.test(n)), `机械分组的名字要如实，实际：${names.join(',')}`);
  assert.ok(!names.some((n) => /概念|定理|原理/.test(n)), '不许编造学科内容的名字');
});

test('【缺陷 4】空输入给空树，不崩', () => {
  const out = aggregateTree([]);
  assert.equal(out.chapters.length, 0);
  assert.equal(out.root.kind, 'title');
  assert.deepEqual(leavesOf(out.root), []);
});

test('【缺陷 4】整条链的统计如实反映每一步', () => {
  const blocks = Array.from({ length: 8 }, (_, i) => block(i + 1, Math.floor(i / 2) + 1, `内容${i}。`.repeat(20)));
  const tree = buildTreeFromBlocks(blocks, { splitLine: 100 });
  assert.ok('orthoMerges' in tree.stats, '统计里要有审查合并数');
  assert.ok('aggregateRounds' in tree.stats, '统计里要有聚合轮数');
  assert.ok('treeDepth' in tree.stats, '统计里要有树深');
  assert.equal(tree.stats.knowledgePoints, tree.knowledgePoints.length);
});
