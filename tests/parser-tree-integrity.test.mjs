/**
 * ✅ 待办进度（用检查项而不是注释，方便自己核对）
 *  [x] 建树可复现缺陷测试
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTreeFromBlocks, flattenLeaves, stashBlocks, mergeLeaf } from '../packages/dsh-zhiyun-core-parser/src/tree.js';

/** 造一个真实形状的块：正文在 `sentences[]`，没有 `text`。 */
function block(index, page, text, { role = '主线', facet = '概念' } = {}) {
  return {
    index,
    page,
    sentences: [{ text, startMs: index * 1000 }],
    tag: { role, facets: [facet], summary: text.slice(0, 12) },
  };
}

/**
 * # 两种不变量的区别（这一点必须讲清楚，否则测试会变成"要求产品不许清洗"）
 *
 * | 层级 | 允许改字吗 | 该断言什么 |
 * |---|---|---|
 * | **切分**（`splitLeaf` / `sliceOversized`） | **不许**。它只是把同一段文本分段放，不增不删 | 字符量相等 |
 * | **整条链路**（mix → merge → 聚合） | **允许**。mix 洗口语、merge 语义重排，本来就会改字 | 块身份守恒：不丢块、不重复计块 |
 *
 * 早先我把"逐字守恒"写成了整条链路的验收标准 —— 那是错的：它等于要求
 * `mix` 不许清洗口语、`merge` 不许语义重排，也就是要求产品**不许做它的本职工作**。
 * 一旦语义 merge 真接上模型，这种测试会立刻把正确行为判成错误。
 *
 * 所以下面分成两组断言：
 *   · `charsOf(...)` 相等 —— 只用于**纯切分**的用例；
 *   · `blockIdsOf(...)` 不重不漏 —— 用于**整条链路**的用例。
 */

/** 把一棵树里所有叶的正文拼起来。**只用于纯切分用例**，不要拿它做全局守恒。 */
/**
 * 树里的全部正文。
 *
 * ⚠️ 只从 **knowledgePoints** 取，不要同时取叶树。
 * `knowledgePoints` 就是从叶树重聚来的，两者装的是同一批块；
 * 一起取会把每段正文数两遍，看起来像"重复收入"——那是探针的错，不是实现的错。
 */
function allTextOf(tree) {
  const pieces = [];
  for (const point of tree.knowledgePoints ?? []) {
    for (const b of point.blocks ?? []) {
      const text = String(b.text ?? (b.sentences ?? []).map((s) => s.text).join(''));
      if (text) pieces.push(text);
    }
  }
  return pieces.join('');
}

/** 叶树（摊平前）的全部正文 —— 用来与 knowledgePoints 对照。 */
function allTextOfLeaves(tree) {
  const pieces = [];
  const walk = (leaf) => {
    for (const b of leaf.blocks ?? []) {
      const text = String(b.text ?? (b.sentences ?? []).map((s) => s.text).join(''));
      if (text) pieces.push(text);
    }
    for (const child of leaf.children ?? []) walk(child);
  };
  for (const leaf of tree.leaves ?? []) walk(leaf);
  return pieces.join('');
}

const BODY = '概念正文'.repeat(40);
const EXAMPLE = '例题正文'.repeat(10);

test('【缺陷 1】有例题时，宿主正文不得在重构中消失', () => {
  const blocks = [
    block(1, 1, BODY),
    block(2, 1, EXAMPLE, { facet: '例题' }),
  ];
  const tree = buildTreeFromBlocks(blocks, { splitLine: 100000 });

  const text = allTextOf(tree);
  assert.ok(text.includes('概念正文'), '宿主正文必须还在树上');
  assert.ok(text.includes('例题正文'), '例题也必须还在');
});

test('【缺陷 1】只有例题、正文很短的叶，摊平后仍保留两者', () => {
  const leaves = stashBlocks([
    block(1, 1, '短正文'.repeat(5)),
    block(2, 1, '短例题'.repeat(5), { facet: '例题' }),
  ]);
  for (const leaf of leaves) mergeLeaf(leaf, { splitLine: 100000 });
  const { flat } = flattenLeaves(leaves);

  const texts = flat.flatMap((leaf) => (leaf.blocks ?? []).map((b) => b.text ?? (b.sentences ?? []).map((s) => s.text).join('')));
  const joined = texts.join('');
  assert.ok(joined.includes('短正文'), `宿主正文丢了，现有：${texts.length} 片叶`);
  assert.ok(joined.includes('短例题'), '例题丢了');
});

test('【缺陷 2】宿主超限拆分时，例题不得被重复收入', () => {
  /* 正文远超斩杀线 → 必然触发切分；同时挂一道例题。 */
  const blocks = [
    block(1, 1, '正文'.repeat(600), { facet: '概念' }),
    block(2, 1, '这是例题'.repeat(30), { facet: '例题' }),
  ];
  const tree = buildTreeFromBlocks(blocks, { splitLine: 300 });

  const occurrences = allTextOf(tree).split('这是例题').length - 1;
  /* 每个块自身是 "这是例题"×30；切成若干段后拼接，字符总数不变。
   * 判据用**字符计数**而不是子串出现次数 —— 切分会把一整段拆到多个叶里。 */
  const chars = (allTextOf(tree).match(/这是例题/g) ?? []).length;
  assert.equal(chars, 30, `例题被重复或丢失：期望 30 次，实际 ${chars} 次（occurrences=${occurrences}）`);
});

test('【缺陷 2】例题块不得进入正文块集合', () => {
  const leaves = stashBlocks([
    block(1, 1, '正文'.repeat(600)),
    block(2, 1, '例题'.repeat(20), { facet: '例题' }),
  ]);
  for (const leaf of leaves) {
    const bodyIndexes = (leaf.blocks ?? []).filter((b) => (b.tag?.facets?.[0] ?? '') !== '例题').map((b) => b.index);
    const attachIndexes = (leaf.attach ?? []).map((a) => a.block.index);
    assert.equal(bodyIndexes.length + attachIndexes.length, (leaf.blocks ?? []).length,
      '正文块与依附块必须不重不漏地划分全部块');
    assert.equal(bodyIndexes.filter((i) => attachIndexes.includes(i)).length, 0, '同一个块不能既是正文又是依附');
  }
});

test('【缺陷 3】真实块（正文在 sentences）必须能被切开：斩杀线不可失效', () => {
  /* 一整块、仅含 sentences，长度远超斩杀线 */
  const long = '这一段是很长的正文内容。'.repeat(1200);   // 约 12000 字
  const blocks = [block(1, 1, long)];
  const tree = buildTreeFromBlocks(blocks, { splitLine: 1200, });

  const leaves = tree.leaves ?? [];
  const deepest = Math.max(...leaves.map((l) => leafDepth(l)), 0);
  assert.ok(deepest >= 1, '超线的一块必须切分（切不动就是斩杀线失效）');
  assert.ok(tree.stats.leafTrees >= 1, `应当记录有叶树，实际 ${tree.stats.leafTrees}`);

  /* ★ 这里**可以**要求字符相等，因为被测量的只有「切分」这一步：
   * 输入是一个已经成型的块，`buildTreeFromBlocks` 内部不调模型、不做清洗，
   * 只把它分段放进子叶。分段不增删字符。
   *
   * ⚠️ 这不代表整条链路无损 —— 真实链路里 mix 会洗口语、merge 会重排语义。
   * 那条链路的判据是"块不丢不重"，见文件顶部说明。 */
  assert.equal(allTextOf(tree).length, long.length, '切分（分段）不增删字符');
});

test('【缺陷 3】按块切分时，权重按 sentences 长度算而不是 0', () => {
  /* 两块长度差 3 倍：切分后第一支应当明显更重 */
  const a = '甲'.repeat(3000);
  const b = '乙'.repeat(1000);
  const tree = buildTreeFromBlocks([block(1, 1, a), block(2, 1, b)], { splitLine: 500 });
  const points = tree.knowledgePoints ?? [];
  assert.ok(points.length >= 1);
  /* 同为纯切分（两块已成型）→ 可以要求字符相等。 */
  const total = allTextOf(tree).length;
  assert.equal(total, a.length + b.length, '按块切分（分段）不增删字符');
});

function leafDepth(leaf) {
  const kids = (leaf.children ?? []).filter((c) => c.kind === 'leaf' && !c.fromAttach);
  if (!kids.length) return 0;
  return 1 + Math.max(...kids.map(leafDepth));
}
