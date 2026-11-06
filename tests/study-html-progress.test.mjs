import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StudyWorkbench } from '../packages/dsh-zhiyun-core-study/src/workbench.js';
import { createGenerateService } from '../packages/dsh-zhiyun-core-classroom-generate/src/index.js';

const slide = { title: '一页', points: ['短词'], summary: '总结', visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">关系</text></svg>', formulas: [], explanation: '画布外讲解。' };

test('study poll keeps per-chapter page counts so the panel can show generation pages', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'study-progress-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let gated = false;
  const service = createGenerateService({ studio: null, log: { warn() {} }, ports: {
    now: Date.now,
    validateHtml: async () => { gated = true; await held; return { ok: true }; },
    media: { image() { throw new Error('no media'); } },
    vault: { runs: { async put() {}, async putStep() {}, async steps() { return []; } } },
  }, llm: { async call(r) {
    if (r.stage === 'html-understanding') return JSON.stringify({ obstacles: [{ hypothesis: '易混', sourceQuote: '条件' }] });
    if (r.stage === 'html-storyboard') return JSON.stringify({ scenes: [{ title: '甲', explanation: '讲解', visual: '图' }, { title: '乙', explanation: '讲解', visual: '图' }] });
    return JSON.stringify({ slides: [slide] });
  } } });
  const workbench = Object.assign(Object.create(StudyWorkbench.prototype), {
    directory, ready: Promise.resolve(), closed: false, controllers: new Set(),
    classroom: { getCurrentUser: async () => ({ id: 'account' }) },
    effectiveWorkers: () => [{ provider: 'p', model: 'm' }],
    atomic: async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); },
    result: async () => ({ lecture: { chapters: [{ title: '概率', topics: [{ title: '加法', blocks: [{ text: '条件决定结论。' }] }] }] }, knowledgeTree: null }),
  });
  workbench.generateOf = () => service;
  try {
    const { runId } = await workbench.invoke('teach-generate', { courseId: '1', subId: '2' });
    for (let i = 0; i < 400 && !gated; i++) await new Promise(r => setTimeout(r, 5));
    const live = await workbench.invoke('teach-poll', { runId });
    assert.equal(live.status, 'running');
    assert.equal(live.outputFormat, 'html');
    assert.equal(live.chapterTotal, 1);
    assert.equal(live.chapterProgress.length, 1);
    const chapter = live.chapterProgress[0];
    assert.equal(chapter.title, '概率');
    assert.equal(chapter.status, 'running');
    assert.equal(chapter.scenesTotal, 2);
    assert.equal(typeof chapter.slidesDone, 'number');
    assert.equal(typeof live.slidesDone, 'number');
    release();
    for (let i = 0; i < 600; i++) {
      const poll = await workbench.invoke('teach-poll', { runId });
      if (poll.status === 'done') break;
      await new Promise(r => setTimeout(r, 5));
    }
  } finally { service.dispose(); }
});
