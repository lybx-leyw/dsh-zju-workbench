import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StudyWorkbench } from '../packages/core/study/src/workbench.js';
import { createGenerateService } from '../packages/core/classroom-generate/src/index.js';

const slide = { title: '一页', points: ['短词'], summary: '总结', visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">关系</text></svg>', formulas: [], explanation: '画布外讲解。' };
const lecture = n => ({ chapters: Array.from({ length: n }, (_, i) => ({ title: `第 ${i + 1} 章`, topics: [{ title: '点', blocks: [{ text: '条件决定结论。' }] }] })) });

/** 池子替身：并发 2，第二段分镜故意放慢，让三步骤都能被观察到。 */
function pool(concurrency = 2) {
  return {
    concurrency,
    async execute(work) { return work({ provider: 'p', model: 'm' }); },
  };
}

test('running snapshot lists every chapter, including ones not started yet', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let gated = 0;
  const service = createGenerateService({ studio: null, log: { warn() {} }, ports: {
    now: Date.now,
    validateHtml: async () => { gated++; await held; return { ok: true }; },
    media: { image() { throw new Error('no media'); } },
    vault: { runs: { async put() {}, async putStep() {}, async steps() { return []; } } },
  }, llm: { async call(r) {
    if (r.stage === 'html-understanding') return JSON.stringify({ obstacles: [{ hypothesis: '易混', sourceQuote: '条件' }] });
    if (r.stage === 'html-storyboard') return JSON.stringify({ scenes: [{ title: '甲', explanation: '讲解', visual: '图' }] });
    return JSON.stringify({ slides: [slide] });
  } } });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teach-stages-'));
  const workbench = Object.assign(Object.create(StudyWorkbench.prototype), {
    directory, ready: Promise.resolve(), closed: false, controllers: new Set(),
    classroom: { getCurrentUser: async () => ({ id: 'account' }) },
    effectiveWorkers: () => [{ provider: 'p', model: 'm', workers: 1 }],
    parser: { createRun: () => ({ llm: pool(1), concurrency: 1 }) },
    atomic: async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); },
    result: async () => ({ lecture: lecture(3), knowledgeTree: null }),
  });
  workbench.generateOf = () => service;
  try {
    const { runId } = await workbench.invoke('teach-generate', { courseId: '1', subId: '2' });
    for (let i = 0; i < 500 && !gated; i++) await new Promise(r => setTimeout(r, 5));
    const live = await workbench.invoke('teach-poll', { runId });
    assert.equal(live.status, 'running');
    assert.equal(live.outputFormat, 'html');
    assert.equal(live.chapterTotal, 3);
    assert.equal(live.chapterProgress.length, 3, '未开始的章也要列出来，界面才画得出完整清单');
    assert.deepEqual(live.chapterProgress.map(c => c.status), ['running', 'pending', 'pending']);
    assert.equal(live.chapterProgress[0].stage, 'html-layout-review');
    assert.equal(live.chapterProgress[1].title, '第 2 章', '未开始的章也要有标题');
    assert.equal(typeof live.startedAt, 'number', '已用时间要有一个可信起点');

    release();
    for (let i = 0; i < 800; i++) {
      const poll = await workbench.invoke('teach-poll', { runId });
      if (poll.status === 'done') break;
      await new Promise(r => setTimeout(r, 5));
    }
    const final = service.get(runId);
    assert.equal(final.status, 'done');
    assert.equal(final.chapterProgress.length, 3);
    assert.ok(final.chapterProgress.every(c => c.status === 'done'));
  } finally { service.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('stage names come from the pipeline, not invented by the client', async () => {
  const seen = new Set();
  const service = createGenerateService({ studio: null, log: { warn() {} }, ports: {
    now: Date.now,
    validateHtml: async () => ({ ok: true }),
    media: { image() { throw new Error('no media'); } },
    vault: { runs: { async put() {}, async putStep() {}, async steps() { return []; } } },
  }, llm: { async call(r) {
    if (r.stage === 'html-understanding') return JSON.stringify({ obstacles: [{ hypothesis: '易混', sourceQuote: '条件' }] });
    if (r.stage === 'html-storyboard') return JSON.stringify({ scenes: [{ title: '甲', explanation: '讲解', visual: '图' }] });
    return JSON.stringify({ slides: [slide] });
  } } });
  try {
    const { runId } = service.start({ requirement: '讲解', outputFormat: 'html', chapterConcurrency: 1,
      chapters: [{ id: 'c1', title: '第一章', sourceText: '条件决定结论。' }] });
    for await (const event of service.stream(runId)) {
      if (event.kind === 'phase-progress' && event.payload?.stage) seen.add(event.payload.stage);
    }
    assert.ok(seen.has('html-understanding'));
    assert.ok(seen.has('html-storyboard'));
    assert.ok(seen.has('html'));
    assert.ok(seen.has('html-scene-complete'), '逐页完成也要有事件，否则进度看不出在推进');
  } finally { service.dispose(); }
});
