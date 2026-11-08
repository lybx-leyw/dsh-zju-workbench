import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePdfText } from '../packages/core/classroom-media/src/pdf/normalize-text.js';

// 真实样本：从这篇论文 PDF 抽出来的原始行，每行都是版心硬折行，全文没有空行。
const RAW = [
  '3 PRELIMINARIES',
  'Notation. Let Z ∈ Z ⊆ Rd denote a random variable with probability distribution P = P (Z) ∈',
  'P(Z), where P(Z) is a class of probability distributions defined on Z. With a slight abuse of',
  'notation, we also denote the density/probability mass function of observing Z = z as P (z). For',
  'P ∈ P(Z), we observe an i.i.d. dataset Dn = (Z1, . . . , Zn) ∼ P ⊗n. Similarly, we denote processes',
  '(distributions in the infinite-dimensional/functional spaces) with Π: e. g., Π(P ) is a prior process',
  'and Π(P | Dn) is a posterior process over the distributions of Z.',
  'the statistical properties of PFN-based ABI are mainly guided by (a) the specifica-',
  'tion of the prior process Π (which, in turn, specifies the prior Π(P )) and (b) the',
  'amortization errors due to limited expressivity of the PFN.',
].join('\n');

test('visual lines are joined back into paragraphs', () => {
  const { text } = normalizePdfText(RAW);
  assert.ok(text.includes('probability distribution P = P (Z) ∈ P(Z), where P(Z) is a class'), '折行应接回句子');
  assert.doesNotMatch(text, /∈\nP\(Z\)/, '句中不应保留换行');
});

test('line-break hyphenation is undone', () => {
  const { text, dehyphenated } = normalizePdfText(RAW);
  assert.ok(text.includes('specification of the prior process'), 'specifica- + tion 应接成 specification');
  assert.ok(dehyphenated >= 1);
});

test('compound words keep their hyphen when the document proves they are compounds', () => {
  // `user-specified` 在文中别处以完整形式出现过 → 是复合词，行尾的 `-` 必须保留。
  const raw = [
    'For a user-',
    'specified weight w, the result holds. Later we again write user-specified here.',
  ].join('\n');
  const { text } = normalizePdfText(raw);
  assert.ok(text.includes('user-specified'), '复合词的连字符不能被吞掉');
  assert.doesNotMatch(text, /userspecified/);
});

test('spacing inside brackets is preserved verbatim', () => {
  // 严格口径：原文 `Π(P )` 有空格，规整就保留空格 —— 让我们自己改掉就等于在改原文。
  const { text } = normalizePdfText(RAW);
  assert.ok(text.includes('Π(P )'), '括号内的空格属于原文，不该被抹掉');
});

test('operator spacing is preserved verbatim', () => {
  const { text } = normalizePdfText('For a weight w ≥ 0 and x ∈ X, the claim holds.');
  assert.ok(text.includes('w ≥ 0'), '运算符两侧空格属于原文');
  assert.ok(text.includes('x ∈ X'));
});

test('headings stay on their own line', () => {
  const { text } = normalizePdfText(RAW);
  assert.match(text, /^3 PRELIMINARIES$/m, '章节标题不能被并进正文');
});

test('a sentence ending with a period starts a new paragraph', () => {
  const { text } = normalizePdfText('First sentence is complete here.\nSecond paragraph begins here.');
  assert.match(text, /complete here\.\n\nSecond paragraph/, '句末标点后应分段');
});

test('abbreviations do not end a sentence', () => {
  const { text } = normalizePdfText('see e. g., the prior Π(P ) is a process\nthat we use below.');
  assert.ok(!/\n\n/.test(text), 'e. g. 之后的折行应接回去，不该分段');
});

test('content is never rewritten: only layout is touched', () => {
  const raw = 'the target L2-\nconcentration error can linearly depend on the rate';
  const { text } = normalizePdfText(raw);
  // 文中没有 `L2-concentration` 的完整形式证据，所以按断词处理 → `L2concentration`。
  // 无论哪种，都只允许增删连字符，**字母序列必须与原文完全一致**。
  const letters = t => t.replace(/[^A-Za-z]/g, '');
  assert.equal(letters(text), letters(raw), '规整只能动排版符号，不能改字');
  assert.ok(text.includes('error can linearly depend on the rate'), '句子内容必须原样保留');
});

test('empty and whitespace-only input is handled', () => {
  assert.equal(normalizePdfText('').text, '');
  assert.equal(normalizePdfText('   \n\n  \n').text, '');
  assert.equal(normalizePdfText(null).text, '');
});

test('no line is silently dropped', () => {
  const { text } = normalizePdfText(RAW);
  for (const marker of ['Notation', 'P(Z)', 'i.i.d.', 'functional', 'posterior', 'amortization']) {
    assert.ok(text.includes(marker), `丢了内容：${marker}`);
  }
});
