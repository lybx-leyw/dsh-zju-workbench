import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerateService } from '../../../packages/core/classroom-generate/src/index.js';

const fragment = JSON.stringify({ slides: [{ title: '先看变化', points: ['平均变化率'], summary: '从两点到一点', visualHtml: '<svg viewBox="0 0 800 560"><line x1="80" y1="400" x2="700" y2="100" stroke="#0f766e"/></svg>', formulas: [{ html: 'Δs / Δt' }], explanation: '从平均变化理解瞬时变化，再把过程写成公式。这段长解释始终在画布外。' }] });
function setup() {
  const calls = [], writes = new Map();
  const service = createGenerateService({ studio: null, log: { warn() {} }, ports: {
    now: Date.now,
    media: new Proxy({}, { get() { throw new Error('HTML path must never access media'); } }),
    vault: { runs: { async put() {}, async putStep(id, key, value) { writes.set(key, value); }, async steps() { return [...writes].map(([id, output]) => ({ id, output })); } } },
    }, llm: { async call(r) {
      calls.push(r.stage);
      if (r.stage === 'html-understanding') return JSON.stringify({ obstacles: [{ hypothesis: '符号可能抽象', sourceQuote: '平均变化率' }] });
      if (r.stage === 'html-storyboard') return JSON.stringify({ scenes: [{ explanation: '看割线变切线', visual: '两点逐步靠近' }] });
      if (r.stage === 'html') return fragment;
      throw new Error(`unexpected ${r.stage}`);
    } },
  });
  return { service, calls, writes };
}
test('HTML service bypasses canvas/media and exposes durable ordered chapters', async () => {
  const { service, calls, writes } = setup();
  try {
    const { runId } = service.start({ requirement: '理解导数', outputFormat: 'html', chapterConcurrency: 2,
      chapters: [{ id: 'c1', title: '割线', sourceText: '平均变化率' }, { id: 'c2', title: '切线', sourceText: '平均变化率的极限' }] });
    const events = [];
    for await (const event of service.stream(runId)) events.push(event);
    const run = service.get(runId);
    assert.equal(run.status, 'done');
    assert.equal(run.outputFormat, 'html');
    assert.equal(run.chaptersDone, 2);
    assert.deepEqual(run.htmlChapters.map(c => c.chapterId), ['c1', 'c2']);
    assert.equal(run.htmlChapters.length, 2);
    assert.ok(run.htmlChapters.every(c => c.html.includes('Content-Security-Policy')));
    assert.equal(calls.length, 6);
    assert.ok(calls.every(stage => stage.startsWith('html')));
    assert.ok(writes.has('html'));
    assert.ok(writes.has('html-chapter-1'));
    assert.equal(writes.has('media'), false);
    assert.equal(writes.has('scenes'), false);
    assert.equal(events.at(-1).kind, 'run-done');
    await service.resume(runId);
    for await (const _ of service.stream(runId)) {}
    assert.equal(calls.length, 6, 'resuming complete HTML run makes no model calls');
  } finally { service.dispose(); }
});
test('HTML single-source service normalizes fallback chapter and never produces fake success on no source', async () => {
  const { service, calls } = setup();
  try {
    const { runId } = service.start({ requirement: '理解导数', outputFormat: 'html', sourceText: '' });
    for await (const _ of service.stream(runId)) {}
    assert.equal(service.get(runId).status, 'failed');
    assert.equal(calls.length, 0);
    assert.deepEqual(service.get(runId).htmlChapters, []);
  } finally { service.dispose(); }
});
