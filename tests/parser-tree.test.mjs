/**
 * 解析器的新建树链路（`docs/show/zhiyun-pipeline.html` 第 03–06 段的实现）。
 *
 * 这里钉住的是**算法语义**，不是实现细节：
 *   ① 筛支线：支线与元信息不进树（去大黑板）
 *   ② 挂账：依附块不进宿主正文的 pending —— 这是"例题不会被压没"的根
 *   ③ 正交审查：只合并直接连叶的同名标题
 *   ④ 合并：超斩杀线才长叶树；切分是长尾的（不是均分），所以能长到 2 层以上
 *   ⑤ 拆叶：每层小标题作废；依附叶一并摊平，内容不丢
 *   ⑥ 重聚：段数 ≠ 知识点数，一节课的知识点远少于内容段
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FACET, facetRole, sieveBlocks, stashBlocks, orthogonalize, mergeLeaf,
  zipfRanges, leafTreeDepth, flattenLeaves, regroupLeaves, aggregate, buildTreeFromBlocks,
  kDefaultSplitLine,
} from '../packages/dsh-zhiyun-core-parser/src/tree.js';
import { tokensOf, formatTokens } from '../packages/dsh-zhiyun-core-parser/src/tokenize.js';

const block = (index, page, text, role = '主线', facets = ['概念']) =>
  ({ index, page, text, tag: { role, facets, summary: `S${index}` }, startMs: index * 1000 });
const LONG = '随机试验指结果事先不能确定、但所有可能结果已知的试验。'.repeat(40);

test('① 筛支线：支线进大黑板，元信息（教学安排/作业）即使标主线也进大黑板', () => {
  const blocks = [
    block(1, 1, '上课铃响，师生问好。', '支线', ['教学安排']),
    block(2, 2, LONG, '主线', ['概念']),
    block(3, 3, '今天作业：习题一 1-5。', '主线', ['作业']),
    block(4, 4, '抛硬币例题。', '主线', ['例题']),
  ];
  const { main, board, stats } = sieveBlocks(blocks);
  assert.equal(main.length, 2, '只有概念与例题进树');
  assert.equal(board.length, 2);
  assert.deepEqual(board.map((b) => b.why).sort(), ['元信息', '支线']);
  assert.equal(stats.side, 1);
  assert.equal(stats.meta, 1);
});

test('② 挂账：依附块单列，不进宿主正文 pending', () => {
  const leaves = stashBlocks([
    block(1, 2, '概念正文一二三四五。', '主线', ['概念']),
    block(2, 2, '例题：写出样本空间。', '主线', ['例题']),
  ]);
  assert.equal(leaves.length, 1, '同一页只挂一片叶');
  assert.equal(leaves[0].pendingB, 1, '正文只算概念那一块');
  assert.equal(leaves[0].attach.length, 1, '例题走 attach 通道');
  assert.ok(leaves[0].attach[0].tok > 0);
  // 例题没有被算进正文 token —— 这正是"不会被压没"的根据
  assert.ok(leaves[0].pendingTok > 0 && leaves[0].pendingTok < tokensOf(LONG) + 1);
});

test('③ 正交审查：只合并直接连叶的同名标题，保留第一份', () => {
  const merges = orthogonalize([
    { id: 'a', title: '随机试验', pendingTok: 100, pendingB: 2 },
    { id: 'b', title: '随机试验 ', pendingTok: 50, pendingB: 1 },   // 空白不同也算同名
    { id: 'c', title: '条件概率', pendingTok: 30, pendingB: 1 },
  ]);
  assert.equal(merges.length, 1);
  assert.equal(merges[0].keepId, 'a');
  assert.deepEqual(merges[0].dropIds, ['b']);
  assert.equal(merges[0].absorbedTokens, 50);
  assert.equal(merges[0].absorbedBlocks, 1);
});

test('④ 合并：不超线不长树；超线才长，且层数可以 > 1', () => {
  const small = { kind: 'leaf', blocks: [block(1, 1, '短正文。')], pendingTok: 20, pendingB: 1, attach: [] };
  assert.equal(mergeLeaf(small, { splitLine: 1200 }).split, false);

  const big = { kind: 'leaf', id: 'p2', blocks: Array.from({ length: 40 }, (_, i) => block(i + 1, 2, LONG)), pendingTok: tokensOf(LONG) * 40, pendingB: 40, attach: [] };
  const result = mergeLeaf(big, { splitLine: 600 });
  assert.equal(result.split, true);
  assert.ok(result.parts >= 2 && result.parts <= 4, `一个叶只拟 2–4 个小标题，实际 ${result.parts}`);
  assert.ok(leafTreeDepth(big) >= 1);
  assert.equal(big.pendingTok, 0, '合并后正文 pending 归零');
});

test('④b 切分是**长尾**的（不是均分）—— 第一支明显大于末支', () => {
  const ranges = zipfRanges(40, 4);
  const sizes = ranges.map(([a, b]) => b - a + 1);
  assert.equal(sizes.reduce((x, y) => x + y, 0), 40, '块数不能多也不能少');
  assert.ok(sizes[0] > sizes.at(-1) * 1.8, `长尾切分：${sizes.join('/')}`);
});

test('⑤ 拆叶：小标题作废、依附叶一并摊平且内容不丢', () => {
  const host = {
    kind: 'leaf', id: 'p2', blocks: [block(1, 2, LONG), block(2, 2, LONG)], pendingTok: tokensOf(LONG) * 2, pendingB: 2, attach: [],
  };
  mergeLeaf(host, { splitLine: 300 });
  host.children.push({ kind: 'leaf', blocks: [block(9, 2, '例题正文。')], tok: 10, fromAttach: true, attachFacet: '例题', children: [] });

  /* ⚠️ 切分的**那一刻**内容就下放给子叶了，宿主 `blocks` 必须已清空。
   *
   * 图里的叶只记"块数"（数字），内容不重复持有。如果宿主切分后仍留着自己那批块，
   * 父子就同时握着同一段正文 —— 摊平做内容守恒时同一段字会被数多层。
   * 所以这里断言宿主已清空，且守恒判据用**子叶里的块总数**。 */
  assert.equal(host.blocks.length, 0, '切分后宿主不得再持有正文块');

  const { flat, stats } = flattenLeaves([host]);
  assert.ok(stats.treeCount >= 1);
  assert.ok(flat.length >= 2, `摊平后应有多个内容段，实际 ${flat.length}`);
  assert.ok(flat.every((l) => l.subTitles === null && l.children.length === 0), '小标题全部作废');
  assert.ok(flat.some((l) => l.fromAttach), '依附叶被一并摊平（内容没丢）');

  /* 判据用**字符量**，不是块数。
   *
   * 按字切分（`splitByChars`）会把一个长块切成 N 段，每段都是一个新块对象 ——
   * 块数必然增加，这是切分本身，不是重复。
   *
   * ★ 这里可以用字符量断言，因为本例走的是**纯切分**（构造的块已经成型，
   * `buildTreeFromBlocks` 内部不调模型、不做清洗）。整条链路不能这么断言：
   * mix 洗口语、merge 重排语义，本来就要改字。见文件顶部的分层说明。
   */
  const charsOf = (leaf) => leaf.blocks.reduce(
    (a, b) => a + String(b.text ?? (b.sentences ?? []).map((x) => x.text).join('')).length, 0);

  const bodyChars = flat.filter((l) => !l.fromAttach).reduce((a, l) => a + charsOf(l), 0);
  const attachChars = flat.filter((l) => l.fromAttach).reduce((a, l) => a + charsOf(l), 0);

  const expectedBody = String(LONG).length * 2;
  assert.equal(bodyChars, expectedBody, `切分（分段）不增删字符，期望 ${expectedBody}，实际 ${bodyChars}`);
  assert.equal(attachChars, '例题正文。'.length, '例题必须还在，且只出现一次');

  /* 例题只能出现一次：摊平结果里 fromAttach 的叶必须恰好 1 片。 */
  assert.equal(flat.filter((l) => l.fromAttach).length, 1, '例题只允许出现一次');
});

test('⑥ 重聚：段数 ≠ 知识点数，知识点带着块且不超斩杀线', () => {
  // 每段很短（≈5 token），斩杀线 40 → 一定要多段并成一叶才划算。
  const short = '这是很短的一段正文内容。';   // ≈10 token
  const flat = Array.from({ length: 12 }, (_, i) => ({ kind: 'leaf', blocks: [block(i + 1, 1, short)], tok: tokensOf(short) }));
  assert.ok(tokensOf(short) * 12 > 40, '构造前提：12 段总量应当超过斩杀线');
  const points = regroupLeaves(flat, { splitLine: 40 });
  assert.ok(points.length < flat.length, `${points.length} 知识点 < ${flat.length} 段`);
  assert.ok(points.every((p) => p.blocks.length > 0), '没有空壳知识点');
  // 块总数不变（重聚只分组、不造块）
  assert.equal(points.reduce((a, p) => a + p.blocks.length, 0), 12);
  // 单段就超线时**必须切开**（不能因为"要合并"而丢内容，也不能留一片超线的叶）
  // ⚠️ 斩杀线用现实量级（1200）：切分目标有个 300 token 的下限（不让内容被切得过碎），
  //    所以拿 40 这种极小值测会得到"每片 262"——那是下限在起作用，不是切分失败。
  const bigLine = 1200;
  // 每段 ~4k token（真的超过斩杀线，才会触发切开）
  const huge = '随机试验指结果事先不能确定、但所有可能结果已知的试验。'.repeat(160);
  assert.ok(tokensOf(huge) > bigLine * 2, `构造前提：单段要真的超线（${tokensOf(huge)} tok）`);
  const heavy = Array.from({ length: 3 }, (_, i) => ({ kind: 'leaf', blocks: [block(i + 1, 1, huge)], tok: tokensOf(huge) }));
  const heavyPoints = regroupLeaves(heavy, { splitLine: bigLine });
  assert.ok(heavyPoints.length > 3, `超线段各自被切开：${heavyPoints.length} 片 > 3 段`);
  // 切开不增删内容 —— 用**字符总量**核（块数会因切分而变多）
  const chars = (list) => list.reduce((a, b) => a + String(b.text ?? '').length, 0);
  assert.equal(chars(heavyPoints.flatMap((p) => p.blocks)), chars(heavy.flatMap((l) => l.blocks)), '切开后字符总量不变');
  // 切开后每片都应当不超过斩杀线
  assert.ok(heavyPoints.every((p) => p.tok <= bigLine), `每片不超线：${heavyPoints.map((p) => p.tok).join(',')}`);
});

test('⑦ 分级聚合：只做机械分组，收敛层数由上层决定', () => {
  const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, kind: 'leaf', blocks: [block(i + 1, 1, 'x')] }));
  const round1 = aggregate(nodes, { target: 4, round: 1 });
  assert.equal(round1.length, 4);
  assert.ok(round1.every((g) => g.kind === 'title' && g.children.length > 0));
  assert.equal(round1.reduce((a, g) => a + g.children.length, 0), 10, '聚合不丢节点');
});

test('⑧ 端到端：块 → 树，支线上黑板、知识点数合理、统计如实', () => {
  const blocks = [
    block(1, 1, '开场寒暄。', '支线', ['教学安排']),
    block(2, 2, LONG),
    block(3, 3, '抛硬币例题：写出样本空间。', '主线', ['例题']),
    block(4, 4, LONG),
    block(5, 5, LONG),
  ];
  const built = buildTreeFromBlocks(blocks, { splitLine: 300 });
  assert.equal(built.board.length, 1);
  assert.ok(built.knowledgePoints.length >= 1);
  assert.equal(built.stats.total, 5);
  assert.equal(built.stats.main, 4);
  assert.equal(built.stats.knowledgePoints, built.knowledgePoints.length);
  // ★ 本例是纯切分路径（无模型参与），所以可以用**字符总量**核对。
  //   切分后"块数"会变多（一段被切成几段），块数不是守恒量。
  //   ⚠️ 整条链路不能这么核 —— mix 清洗、merge 重排都会改字。
  const charsOf = (list) => list.reduce((a, b) => a + String(b.text ?? '').length, 0);
  const mainChars = blocks.filter((b) => b.tag.role === '主线').reduce((a, b) => a + b.text.length, 0);
  assert.equal(charsOf(built.knowledgePoints.flatMap((p) => p.blocks)), mainChars, '主线内容字符总量不变');
});

test('⑨ facetRole 判据顺序：混合事务标签不得删除学科知识，纯事务仍剔除', () => {
  assert.equal(facetRole({ tag: { facets: ['概念', '教学安排'] } }), 'host');
  assert.equal(facetRole({ tag: { facets: ['例题', '作业'] } }), 'attach');
  assert.equal(facetRole({ tag: { facets: ['概念'] } }), 'host');
  assert.equal(facetRole({ tag: { facets: ['故事'] } }), 'attach');
  assert.equal(facetRole({ tag: { facets: [] } }), 'none');
  assert.deepEqual(FACET.META, ['教学安排', '作业']);
});

test('⑩ token 估算：中文按字、空文本为 0、格式人可读', () => {
  assert.equal(tokensOf(''), 0);
  assert.equal(tokensOf('随机试验'), 4);
  assert.ok(tokensOf('abcd') < tokensOf('随机试验'), 'ASCII 比同长度中文便宜');
  assert.equal(formatTokens(320), '320');
  assert.equal(formatTokens(1200), '1.2k');
  assert.equal(formatTokens(12000), '12k');
  assert.ok(kDefaultSplitLine >= 800 && kDefaultSplitLine <= 2000, '默认斩杀线在一屏正文的量级');
});
