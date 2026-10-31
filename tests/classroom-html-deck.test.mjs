import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHtmlChapters, validateHtmlChapter, validateSlideDeck } from '../packages/dsh-zhiyun-core-classroom-generate/src/html-deck.js';

const visualHtml = '<svg viewBox="0 0 800 560" aria-label="条件与结论"><rect x="100" y="140" width="240" height="160" fill="#edf5f1"/><text x="140" y="230" font-size="32">假设 → 结论</text></svg>';
const deck = { slides: [{ title: '从假设到结论', points: ['先检查条件'], summary: '条件决定结论的适用范围', visualHtml,
  formulas: [{ html: '<math><mi>x</mi><mo>=</mo><mn>1</mn></math>', label: '代入' }, { html: 'x + 1 = 2', label: '求和' }],
  explanation: '假设和结论不能互换。先检查原文要求的条件是否成立，再使用结论。新增示例仅用于说明条件关系，不改变原文结论。' }] };
const chapters = Array.from({ length: 7 }, (_, i) => ({ chapterId: `c${i}`, title: `章 ${i}`, sourceText: `完整材料 ${i}：假设成立则结论成立。` }));
function response(request) {
  if (request.stage === 'html-understanding') return JSON.stringify({ obstacles: [{ hypothesis: '可能混淆条件', sourceQuote: '假设成立则结论成立' }], conclusions: [], assumptions: [] });
  if (request.stage === 'html-storyboard') return JSON.stringify({ scenes: [{ explanation: '解释条件关系', visual: '图连接条件和结论', formulaPlan: '只展开两行公式' }] });
  return JSON.stringify(deck);
}

test('bounded chapter concurrency, strictly serial internal stages and input ordering', async () => {
  let active = 0, peak = 0; const stages = new Map(), completed = new Map(), writes = [];
  const result = await generateHtmlChapters({ chapters, concurrency: 99, completed, llm: { async call(r) {
    active++; peak = Math.max(peak, active);
    const list = stages.get(r.chapterId) ?? []; list.push(r.stage); stages.set(r.chapterId, list);
    await new Promise(resolve => setImmediate(resolve)); active--;
    assert.ok(r.messages[0].content.includes(chapters.find(c => c.chapterId === r.chapterId).sourceText));
    assert.ok(r.messages.every(m => m.role === 'user'));
    return response(r);
  } }, checkpoint: async (key, value) => { assert.equal(completed.has(key), false); writes.push([key, value]); } });
  // 无人工上限：并发数由章节数本身封顶（7 章 → 最多 7 个 worker）。
  assert.equal(peak, 7);
  assert.deepEqual(result.map(c => c.chapterId), chapters.map(c => c.chapterId));
  for (const s of stages.values()) assert.deepEqual(s, ['html-understanding', 'html-storyboard', 'html']);
  assert.equal(writes.length, 7); assert.equal(completed.size, 7);
  assert.ok(result.every(c => c.deckVersion === 2 && c.slides.length === 1));
  assert.equal(validateHtmlChapter(result[0].html), result[0].html);
  const resumed = await generateHtmlChapters({ chapters, completed, llm: { call() { throw Error('must not call'); } } });
  assert.deepEqual(resumed, result);
});
test('complete source is retained in every prompt and zero concurrency clamps to one', async () => {
  const sourceText = '假设成立则结论成立。' + '长材料'.repeat(20000) + '尾部标记'; let active = 0, peak = 0;
  await generateHtmlChapters({ chapters: [{ ...chapters[0], sourceText }, chapters[1]], concurrency: 0, llm: { async call(r) {
    active++; peak = Math.max(peak, active); await new Promise(resolve => setImmediate(resolve)); active--;
    if (r.chapterId === 'c0') assert.ok(r.messages[0].content.includes(sourceText));
    return response(r);
  } } }); assert.equal(peak, 1);
});
test('planning JSON repairs use fresh user messages, no synthetic assistant replay', async () => {
  const counts = {};
  const result = await generateHtmlChapters({ chapters: [chapters[0]], llm: { async call(r) {
    counts[r.stage] = (counts[r.stage] ?? 0) + 1;
    assert.ok(r.messages.every(m => m.role === 'user'));
    return r.stage !== 'html' && counts[r.stage] === 1 ? '{broken' : response(r);
  } } });
  assert.equal(result.length, 1);
  assert.deepEqual(counts, { 'html-understanding': 2, 'html-storyboard': 2, html: 1 });
});
test('browser overflow rejection triggers bounded repair before checkpointing', async () => {
  let audits = 0, writes = 0, htmlCalls = 0;
  const result = await generateHtmlChapters({ chapters: [chapters[0]], llm: { async call(r) { if (r.stage === 'html') htmlCalls++; return response(r); } },
    validateOutput: async () => { if (++audits === 1) throw Error('slide 1 formula exceeds width'); return { ok: true }; },
    checkpoint: async () => { writes++; assert.equal(audits, 2); } });
  assert.equal(htmlCalls, 2); assert.equal(writes, 1); assert.deepEqual(result[0].layoutAudit, { ok: true });
});
test('unsafe output never executes or checkpoints, retries are bounded', async () => {
  let htmlCalls = 0, writes = 0;
  await assert.rejects(generateHtmlChapters({ chapters: [chapters[0]], llm: { async call(r) {
    if (r.stage !== 'html') return response(r);
    htmlCalls++; return JSON.stringify({ slides: [{ ...deck.slides[0], visualHtml: '<svg><script>globalThis.pwned=true</script></svg>' }] });
  } }, checkpoint: async () => { writes++; } }));
  assert.equal(htmlCalls, 3); assert.equal(writes, 0); assert.equal(globalThis.pwned, undefined);
});
test('aborting transport suppresses later stages, validation and checkpoint', async () => {
  const controller = new AbortController(); let calls = 0, writes = 0;
  await assert.rejects(generateHtmlChapters({ chapters, signal: controller.signal, concurrency: 1,
    llm: { async call(r) { calls++; controller.abort(); return response(r); } }, checkpoint: async () => { writes++; } }), { code: 'E_CANCELLED' });
  assert.equal(calls, 1); assert.equal(writes, 0);
});
test('source changes invalidate a completed chapter rather than reusing stale explanations', async () => {
  const completed = new Map();
  await generateHtmlChapters({ chapters: [chapters[0]], completed, llm: { async call(r) { return response(r); } } });
  let calls = 0;
  await generateHtmlChapters({ chapters: [{ ...chapters[0], sourceText: chapters[0].sourceText + '补充条件。' }], completed,
    llm: { async call(r) { calls++; return response(r); } } });
  assert.equal(calls, 3);
});
test('within a chapter, per-scene content calls and audits remain serial', async () => {
  let active = 0, peak = 0; const contentIndices = []; let writes = 0;
  const result = await generateHtmlChapters({ chapters: [chapters[0]], llm: { async call(r) {
    active++; peak = Math.max(peak, active); await new Promise(resolve => setImmediate(resolve)); active--;
    if (r.stage === 'html-storyboard') return JSON.stringify({ scenes: [1, 2, 3].map(i => ({ title: `关系${i}`, explanation: '详细讲解', visual: '关系图' })) });
    if (r.stage === 'html') contentIndices.push(r.sceneIndex);
    return response(r);
  } }, validateOutput: async () => { assert.equal(active, 0); return { ok: true }; }, checkpoint: async () => { writes++; } });
  assert.equal(peak, 1); assert.deepEqual(contentIndices, [0, 1, 2]); assert.equal(result[0].slides.length, 3); assert.equal(writes, 1);
});

test('slide budget is structural, explanations are separate data', () => {
  assert.equal(validateSlideDeck(deck), deck);
  assert.throws(() => validateSlideDeck({ slides: [{ ...deck.slides[0], title: '过长'.repeat(30) }] }));
  assert.throws(() => validateSlideDeck({ slides: [{ ...deck.slides[0], formulas: Array(5).fill({ html: 'x=1' }) }] }));
});
