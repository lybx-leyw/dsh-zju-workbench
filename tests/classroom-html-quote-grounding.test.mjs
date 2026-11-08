/**
 * 引用校验：**只容忍空白差异**（用户选定的严格口径）。
 *
 * 背景：论文 PDF 抽出来的是视觉行，硬换行/断词/上标空格曾让正确的引用被判无效，
 * 一度在校验层逐条容忍。但那样既说不清「逐字」是什么，又放过了真正的抄错。
 *
 * 现在分工：
 *   - 入口（`normalizePdfText`）：把视觉行还原成段落（拼行、还原断词）。
 *   - 比对（本文件覆盖）：只折叠空白。字符就是字符。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHtmlChapters } from '../packages/core/classroom-generate/src/html-deck.js';

const slide = { title: '一页', points: ['短词'], summary: '总结',
  visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">关系</text></svg>',
  formulas: [], explanation: '画布外讲解，足够长以说明推导依据。' };

/** 已经过入口规整的正文：连续段落，没有硬折行。 */
const SOURCE = `Hence, a PFN (usually a transformer-based neural network) is trained once on datasets sampled from a prior over data-generating mechanisms, and then, at inference time, it maps a new dataset directly into a target posterior distribution. We call this “amortized” inference, and the prior-induced bias is well-known. The statistical properties of PFN-based ABI are mainly guided by (a) the specification of the prior process Π (which, in turn, specifies the prior Π(P ), the implicit log-likelihood) and (b) the amortization errors due to limited expressivity of the PFN qθ. In the following, we primarily focus on the aspect (a).`;

function run(quote) {
  return generateHtmlChapters({
    chapters: [{ chapterId: 'c1', title: '第一章', sourceText: SOURCE }],
    llm: { async call(request) {
      if (request.stage === 'html-understanding') {
        return JSON.stringify({ obstacles: [{ hypothesis: '易混', sourceQuote: quote }] });
      }
      if (request.stage === 'html-storyboard') {
        return JSON.stringify({ scenes: [{ title: '甲', explanation: '讲解', visual: '图' }] });
      }
      return JSON.stringify({ slides: [slide] });
    } },
  });
}

// ── 允许：空白差异 ──────────────────────────────────────────────

test('a quote spanning what used to be line breaks is accepted (whitespace only)', async () => {
  const quote = 'is trained once on datasets sampled from a prior over data-generating mechanisms';
  assert.equal((await run(quote)).length, 1);
});

test('extra spaces and newlines inside the quote are folded', async () => {
  const quote = 'is trained once on datasets   sampled from a prior\nover data-generating mechanisms';
  assert.equal((await run(quote)).length, 1, '空白折叠是允许的唯一归一化');
});

test('an ellipsis may skip text as long as every remaining part is verbatim', async () => {
  const quote = 'The statistical properties of PFN-based ABI are mainly guided by (a) the specification of the prior process Π ... and (b) the amortization errors due to limited expressivity';
  assert.equal((await run(quote)).length, 1, '用 ... 省略中间是合法引用');
});

// ── 拒绝：任何字符差异 ─────────────────────────────────────────

test('dropping a hyphen is rejected (word form changed)', async () => {
  // 原文 `prior-induced`，写成 `priorinduced` 就是换了词形。
  await assert.rejects(run('the priorinduced bias is wellknown'), /引用必须逐字来自原文/);
});

test('changing spacing around a symbol is rejected under the strict policy', async () => {
  // 原文是 `Π(P )`（有空格），写成 `Π(P)` 在本口径下算字符差异。
  await assert.rejects(run('specifies the prior Π(P), the implicit log-likelihood'), /引用必须逐字来自原文/);
});

test('invented text is rejected', async () => {
  await assert.rejects(run('PFNs are guaranteed to achieve the minimax rate for all smooth function classes'),
    /引用必须逐字来自原文/);
});

test('an inserted word is rejected', async () => {
  await assert.rejects(run('We call this amortized inference, and the prior-induced bias is also well-known'),
    /引用必须逐字来自原文/);
});

test('reordered words are rejected: grounding, not bag-of-words', async () => {
  await assert.rejects(run('maps a new dataset directly into a target posterior distribution, and then, at inference time, it'),
    /引用必须逐字来自原文/);
});

test('an ellipsis cannot hide an inserted word', async () => {
  await assert.rejects(run('In the following, we primarily ... only focus on the aspect (a)'), /引用必须逐字来自原文/);
});

// ── 辨识度门槛 ─────────────────────────────────────────────────

test('a single common word is not grounding', async () => {
  await assert.rejects(run('the'), /引用必须逐字来自原文/);
});

test('short English fragments are rejected, short Chinese fragments are not', async () => {
  await assert.rejects(run('prior'), /引用必须逐字来自原文/);
  const chinese = await generateHtmlChapters({
    chapters: [{ chapterId: 'c1', title: '第一章', sourceText: '条件决定结论。假设成立则结论成立。' }],
    llm: { async call(request) {
      if (request.stage === 'html-understanding') return JSON.stringify({ obstacles: [{ hypothesis: '易混', sourceQuote: '条件' }] });
      if (request.stage === 'html-storyboard') return JSON.stringify({ scenes: [{ title: '甲', explanation: '讲解', visual: '图' }] });
      return JSON.stringify({ slides: [slide] });
    } },
  });
  assert.equal(chinese.length, 1, '两个字的中文引用有辨识度，不该被门槛挡住');
});

// ── 报错可操作 ─────────────────────────────────────────────────

test('the error names the offending quote so the model can fix it', async () => {
  try {
    await run('PFNs are guaranteed to achieve minimax rates for every smoothness class');
    assert.fail('应当拒绝编造的引用');
  } catch (error) {
    assert.match(error.message, /第 1 条/, '必须指出是第几条');
    assert.match(error.message, /PFNs are guaranteed/, '必须回显那条引用');
    assert.match(error.message, /不要改动用词/, '必须说明怎么改');
  }
});
