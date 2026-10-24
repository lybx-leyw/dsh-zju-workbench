/**
 * 这条测试钉住**判据本身不能错**：整条链路允许改字。
 *
 * 背景：我早先把「逐字守恒」当成整条链路的验收标准 —— 那是概念错误。
 * 真实链路里：
 *   · `mix` 会把口语转写清洗成书面语（去"嗯/啊"、改错字、合并重复）；
 *   · `merge` 会语义重排（去口语成分、重组句子）；
 *   · 讲义再补理解（扩写、举例）。
 * 这三步**本来就要改字**。如果测试要求字符相等，一旦这些步骤真接上模型，
 * 正确行为会被判成错误。
 *
 * 所以这里正面验证：**内容被清洗/重排后，块身份判据仍然通过**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTreeFromBlocks, leavesOf } from '../packages/dsh-zhiyun-core-parser/src/tree.js';

function block(index, page, sentences, { role = '主线', facet = '概念' } = {}) {
  return { index, page, sentences: sentences.map((text) => ({ text })), tag: { role, facets: [facet], summary: '' } };
}

/** 块身份判据：每一块都要有归属，且不重复计数。 */
function blockKeys(tree) {
  const seen = new Map();
  for (const leaf of leavesOf(tree.tree)) {
    for (const b of leaf.blocks ?? []) {
      const key = b.index ?? b._splitFrom;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  return seen;
}

test('整条链路**允许**改字：清洗后的文本更短，但块不丢', () => {
  /* 模拟 mix 清洗后的结果：口语被压成书面语（字数明显变少）。 */
  const raw = block(1, 1, ['嗯，这个，这个我们来看一个例子啊，就是说', '那个，随机试验呢，它是指']);
  const cleaned = block(2, 1, ['我们看一个例子：随机试验是指']);

  const tree = buildTreeFromBlocks([raw, cleaned], { splitLine: 100000 });

  /* 块身份：两块都在。 */
  const keys = blockKeys(tree);
  assert.equal(keys.size, 2, `两块都要有归属，实际 ${keys.size}`);

  /* 字数**不相等**是正常的（清洗掉了口语成分）。这里不去断言相等。 */
  const outChars = leavesOf(tree.tree)
    .flatMap((l) => l.blocks ?? [])
    .map((b) => String(b.text ?? (b.sentences ?? []).map((s) => s.text).join('')))
    .join('').length;
  const inChars = raw.sentences.concat(cleaned.sentences).map((s) => s.text).join('').length;
  assert.ok(outChars <= inChars, '清洗后不该变长（这条只是量级检查，不是守恒断言）');
});

test('语义重排（句子顺序变了、措辞变了）不影响块身份', () => {
  /* 同一块的内容被 merge 重排：句子顺序调换、措辞改过。 */
  const reordered = block(7, 3, ['先说结论：样本空间是全部可能结果的集合。', '然后才是定义。']);
  const tree = buildTreeFromBlocks([reordered], { splitLine: 5000 });

  const keys = blockKeys(tree);
  assert.equal(keys.size, 1);
  assert.equal(keys.get(7), 1, '同一块只能出现一次（不许重复计数）');
});

test('判据分层：切分这一层仍然不许改字', () => {
  /* 纯切分：输入一个成型长块，字数必须一模一样。
   * 这与上面两条不矛盾 —— 切分不调模型，只分段。 */
  const long = '机械切分不会改变文字本身。'.repeat(500);
  const tree = buildTreeFromBlocks([block(1, 1, [long])], { splitLine: 500 });
  const outChars = leavesOf(tree.tree)
    .flatMap((l) => l.blocks ?? [])
    .map((b) => String(b.text ?? (b.sentences ?? []).map((s) => s.text).join('')))
    .join('').length;
  assert.equal(outChars, long.length, '切分（分段）必须一字不改');
});

test('重复计入会被判据抓住（这是真正要防的错）', () => {
  /* 人为造一块被两片叶同时持有 —— 判据应当报出重复。 */
  const b = block(1, 1, ['同一块内容']);
  const tree = buildTreeFromBlocks([b], { splitLine: 100000 });
  /* 正常情况：只出现一次。 */
  assert.equal(blockKeys(tree).get(1), 1);

  /* 模拟 bug：把块塞进另一片叶。 */
  const leaves = leavesOf(tree.tree);
  if (leaves.length) {
    leaves[0].blocks = [...(leaves[0].blocks ?? []), b];
    const keys = blockKeys(tree);
    assert.equal(keys.get(1), 2, '判据必须能发现同一块被计两次');
  }
});
