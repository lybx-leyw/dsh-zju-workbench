import test from 'node:test';
import assert from 'node:assert/strict';
import { pollGeneration } from '../packages/core/study/src/ai-teaching-generate.js';
import { createGenerateService } from '../packages/core/classroom-generate/src/index.js';

const slide = { title: '一页关系', points: ['短关键词'], summary: '核心总结', visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">关系</text></svg>', formulas: [], explanation: '画布外的完整讲解，足够长以说明推导依据。' };

test('running HTML run exposes per-chapter page progress through the snapshot', async () => {
  const gates = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const service = createGenerateService({ studio: null, log: { warn() {} }, ports: {
    now: Date.now,
    // Hold the run mid-way so the snapshot is observed while it is still running.
    validateHtml: async () => { gates.push(true); await held; return { ok: true }; },
    media: { image() { throw new Error('no media'); } },
    vault: { runs: { async put() {}, async putStep() {}, async steps() { return []; } } },
  }, llm: { async call(r) {
    if (r.stage === 'html-understanding') return JSON.stringify({ obstacles: [{ hypothesis: '易混', sourceQuote: '条件' }] });
    if (r.stage === 'html-storyboard') return JSON.stringify({ scenes: [{ title: '甲', explanation: '讲解', visual: '图' }, { title: '乙', explanation: '讲解', visual: '图' }] });
    return JSON.stringify({ slides: [slide] });
  } } });
  try {
    const { runId } = service.start({ requirement: '讲解', outputFormat: 'html', chapterConcurrency: 1,
      chapters: [{ id: 'c1', title: '第一章', sourceText: '条件决定结论。' }] });
    for (let i = 0; i < 400 && !gates.length; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(gates.length, 1, 'run should be blocked inside the first page gate');
    const live = service.get(runId);
    assert.equal(live.status, 'running');
    assert.equal(live.outputFormat, 'html');
    assert.equal(live.chapterTotal, 1);
    assert.equal(live.chaptersDone, 0);
    assert.equal(live.slidesDone, 0);
    assert.equal(Array.isArray(live.chapterProgress), true);
    const first = live.chapterProgress[0];
    assert.equal(first.chapterIndex, 0);
    assert.equal(first.title, '第一章');
    assert.equal(first.status, 'running');
    assert.equal(first.scenesTotal, 2, 'storyboard page count is known before pages are drawn');
    assert.equal(first.sceneIndex, 0);
    assert.equal(first.slidesDone, 0);

    // The study page reads exactly this shape through pollGeneration.
    const polled = await pollGeneration({ generate: service, runId });
    assert.equal(polled.status, 'running');
    assert.equal(polled.slidesDone, 0);
    assert.equal(polled.chapterProgress[0].scenesTotal, 2);

    release();
    for (let i = 0; i < 600 && service.get(runId).status === 'running'; i++) await new Promise(r => setTimeout(r, 5));
    const done = await pollGeneration({ generate: service, runId });
    assert.equal(done.status, 'done');
    assert.equal(done.pages.length, 1);
  } finally { service.dispose(); }
});

test('completed chapters report final page counts and advance during generation', async () => {
  const seen = [];
  const service = createGenerateService({ studio: null, log: { warn() {} }, ports: {
    now: Date.now,
    validateHtml: async () => ({ ok: true }),
    media: { image() { throw new Error('no media'); } },
    vault: { runs: { async put() {}, async putStep() {}, async steps() { return []; } } },
  }, llm: { async call(r) {
    await new Promise(resolve => setTimeout(resolve, 15));
    if (r.stage === 'html-understanding') return JSON.stringify({ obstacles: [{ hypothesis: '易混', sourceQuote: '条件' }] });
    if (r.stage === 'html-storyboard') return JSON.stringify({ scenes: [{ title: '甲', explanation: '讲解', visual: '图' }, { title: '乙', explanation: '讲解', visual: '图' }, { title: '丙', explanation: '讲解', visual: '图' }] });
    return JSON.stringify({ slides: [slide] });
  } } });
  try {
    const { runId } = service.start({ requirement: '讲解', outputFormat: 'html', chapterConcurrency: 1,
      chapters: [{ id: 'c1', title: '第一章', sourceText: '条件决定结论。' }] });
    for (let i = 0; i < 600; i++) {
      const run = service.get(runId);
      const chapter = run.chapterProgress?.[0];
      if (chapter) seen.push(`${chapter.status}:${chapter.slidesDone}/${chapter.sceneTotal ?? chapter.scenesTotal ?? '?'}:${chapter.sceneIndex ?? ''}`);
      if (run.status !== 'running') break;
      await new Promise(r => setTimeout(r, 5));
    }
    const final = service.get(runId);
    assert.equal(final.status, 'done');
    assert.equal(final.slidesDone, 3, 'slides done accumulates across the chapter');
    assert.equal(final.chapterProgress[0].status, 'done');
    assert.equal(final.chapterProgress[0].slidesDone, 3);
    assert.ok(seen.some(entry => entry.startsWith('running')), 'progress is observable before completion');
  } finally { service.dispose(); }
});
