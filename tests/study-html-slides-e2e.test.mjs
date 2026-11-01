import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StudyWorkbench } from '../packages/dsh-zhiyun-core-study/src/workbench.js';
import { briefFromLecture } from '../packages/dsh-zhiyun-core-study/src/ai-teaching-generate.js';
import { createGenerateService } from '../packages/dsh-zhiyun-core-classroom-generate/src/index.js';

const deck = { slides: [{ title: '从条件到结论', points: ['先检查条件'], summary: '条件决定结论', visualHtml: '<svg viewBox="0 0 800 560"><text x="80" y="200" font-size="32">条件 → 结论</text></svg>', formulas: [{ html: '<math><mi>P</mi></math>', label: '起点' }], explanation: '这一段完整讲解位于画布之外，公式逐步显示不会隐藏它。' }] };

test('study page end-to-end reaches the HTML slide engine through the real generate service', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'study-html-e2e-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stages = [];
  const service = createGenerateService({ studio: null, log: { warn() {} }, ports: {
    now: Date.now,
    validateHtml: async () => ({ ok: true }),
    media: { image() { throw new Error('media must not run'); }, speech() { throw new Error('media must not run'); } },
    vault: { runs: { async put() {}, async putStep() {}, async steps() { return []; } } },
  }, llm: { async call(r) {
      stages.push(r.stage);
      if (r.stage === 'html-understanding') return JSON.stringify({ obstacles: [{ hypothesis: '条件易忽略', sourceQuote: '条件' }] });
      if (r.stage === 'html-storyboard') return JSON.stringify({ scenes: [{ title: '条件关系', explanation: '讲解', visual: '箭头图' }] });
      return JSON.stringify(deck);
    } },
  });
  const workbench = Object.assign(Object.create(StudyWorkbench.prototype), {
    directory, ready: Promise.resolve(), closed: false, controllers: new Set(),
    classroom: { getCurrentUser: async () => ({ id: 'account' }) },
    effectiveWorkers: () => [{ provider: 'p', model: 'm' }],
    atomic: async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); },
  });
  workbench.generateOf = () => service;
  const lecture = { chapters: [{ title: '概率', topics: [{ title: '加法公式', blocks: [{ text: '条件决定结论的完整讲义正文。' }] }] }] };
  // Exactly what the study page sends: the brief built from the finalized lecture.
  assert.equal(briefFromLecture(lecture).outputFormat, 'html');
  workbench.result = async () => ({ lecture, knowledgeTree: null });
  const started = await workbench.invoke('teach-generate', { courseId: '1', subId: '2' });
  assert.ok(started.runId);
  let poll;
  for (let i = 0; i < 100; i++) {
    poll = await workbench.invoke('teach-poll', { runId: started.runId });
    if (poll.status === 'done' || poll.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(poll.status, 'done', JSON.stringify(service.get(started.runId)?.error));
  assert.equal(poll.pages.length, 1);
  assert.match(poll.pages[0].html, /class="slide" data-slide-index="0"/);
  assert.match(poll.pages[0].html, /class="explanation-panel"/);
  assert.deepEqual(stages, ['html-understanding', 'html-storyboard', 'html']);
  service.dispose();
});
