/**
 * Synthetic checks accompanying knowledge-tree-paper.md.
 * Run from the repository root: node docs/knowledge-tree-paper-check.mjs
 * No model calls, private classroom data, or network access.
 */
import assert from 'node:assert/strict';
import {
  buildTreeFromBlocks, leavesOf, sieveBlocks,
} from '../../packages/dsh-zhiyun-core-parser/src/tree.js';
import { parseSemanticPlan } from '../../packages/dsh-zhiyun-core-parser/src/semantic-plan.js';

const initialSeed = 20261030;
let seed = initialSeed;
const rnd = (n) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % n;
};
let cases = 0, totalBlocks = 0, totalFragments = 0, emptyMainCases = 0;
for (let t = 0; t < 240; t++) {
  const N = 1 + rnd(12), tau = [300, 500, 1200][rnd(3)];
  const blocks = Array.from({ length: N }, (_, i) => {
    const text = ('b' + (i + 1) + ':' + '甲乙。🧪').repeat([1, 3, 40, 180, 650][rnd(5)]);
    return {
      index: i + 1, page: 1 + rnd(4), text, sentences: [{ text }],
      tag: {
        role: rnd(7) ? '主线' : '支线',
        facets: [['概念', '公式', '例题', '案例', '教学安排'][rnd(5)]],
      },
    };
  });
  const main = sieveBlocks(blocks).main;
  if (!main.length) { emptyMainCases++; continue; }
  const topics = [];
  for (let i = 1; i <= N;) {
    const end = Math.min(N, i + rnd(4));
    topics.push({ title: 't' + i, from: i, to: end });
    i = end + 1;
  }
  const plan = parseSemanticPlan(
    JSON.stringify({ knowledge: [{ title: '合成章', topics }] }), main, N,
  );
  const expected = new Map(main.map((b) => [b.index, b.text]));
  const tree = buildTreeFromBlocks(blocks, { semanticPlan: plan, splitLine: tau });
  const actual = new Map();
  for (const leaf of leavesOf(tree.tree)) {
    for (const b of leaf.blocks ?? []) {
      actual.set(b.index, (actual.get(b.index) ?? '') + b.text);
    }
  }
  assert.deepEqual(actual, expected, 'Source text differs in case ' + t);
  const F = tree.flat.length;
  const X = tree.flat.reduce((n, leaf) => n + leaf.blocks.length, 0);
  const K = plan.reduce((n, chapter) => n + chapter.topics.length, 0);
  assert.ok(F <= K * 4 ** 4 + main.length);
  assert.ok(X <= main.length + F);
  cases++;
  totalBlocks += main.length;
  totalFragments += X;
}

// The packing threshold does not bound every final group after attachment.
const counterexampleBlocks = [
  { index: 1, page: 1, text: '甲'.repeat(800), tag: { role: '主线', facets: ['概念'] } },
  { index: 2, page: 1, text: '乙'.repeat(800), tag: { role: '主线', facets: ['概念'] } },
  { index: 3, page: 1, text: '丙'.repeat(700), tag: { role: '主线', facets: ['例题'] } },
];
const counterexample = buildTreeFromBlocks(counterexampleBlocks, {
  semanticPlan: [{ title: '合成章', topics: [{ title: '合成主题', from: 1, to: 3 }] }],
  splitLine: 1200,
});
const largestGroup = Math.max(...counterexample.knowledgePoints.map((point) => point.tok));
assert.equal(largestGroup, 1500);
console.log(JSON.stringify({
  initialSeed, generatedCases: 240, cases, emptyMainCases,
  totalBlocks, totalFragments,
  checks: ['per-source exact text reconstruction', 'fragment count bound', 'reference count bound'],
  thresholdCounterexample: { threshold: 1200, largestGroup },
}, null, 2));
