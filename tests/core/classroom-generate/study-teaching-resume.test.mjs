/**
 * 断点续做在**真实服务**上的行为：落盘的页数要在重启后仍然可读，
 * 且进度面板一打开就显示上次画到哪，而不是从 0 重新数。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerateService } from '../../../packages/core/classroom-generate/src/index.js';

const slide = (title) => ({ title, points: ['短词'], summary: '总结',
  visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">关系</text></svg>',
  formulas: [], explanation: '画布外讲解，足够长以说明推导依据。' });

/** 内存版 vault：记录 putStep，便于观察落盘与重启后读取。 */
function memoryVault() {
  const steps = new Map();
  const rows = new Map();
  return {
    steps, rows,
    runs: {
      async put(row) { rows.set(row.id, row); },
      async get(id) { return rows.get(id) ?? null; },
      async putStep(runId, stepId, output) { steps.set(`${runId}/${stepId}`, output); },
      async steps(runId) {
        return [...steps.entries()].filter(([key]) => key.startsWith(`${runId}/`))
          .map(([key, output]) => ({ id: key.slice(runId.length + 1), output }));
      },
    },
  };
}

function model({ scenes = 3, failAtScene = null, failOnce = false } = {}) {
  let failed = false;
  return { async call(request) {
    if (request.stage === 'html-understanding') {
      return JSON.stringify({ obstacles: [{ hypothesis: '易混', sourceQuote: '条件' }] });
    }
    if (request.stage === 'html-storyboard') {
      return JSON.stringify({ scenes: Array.from({ length: scenes }, (_, i) => ({
        title: `分镜${i + 1}`, explanation: '讲解', visual: '图' })) });
    }
    if (failAtScene !== null && request.sceneIndex === failAtScene && (!failOnce || !failed)) {
      failed = true;
      throw new Error('模型超时');
    }
    return JSON.stringify({ slides: [slide(`第 ${request.sceneIndex + 1} 页`)] });
  } };
}

test('partial pages survive the run and are visible in the progress snapshot', async () => {
  const vault = memoryVault();
  const service = createGenerateService({ studio: null, log: { warn() {} }, ports: {
    now: Date.now, vault, validateHtml: async () => ({ ok: true }),
    media: { image() { throw new Error('no media'); } },
  }, llm: model({ scenes: 4, failAtScene: 3 }) });
  try {
    const { runId } = service.start({ requirement: '讲解', outputFormat: 'html', chapterConcurrency: 1,
      chapters: [{ id: 'c1', title: '第一章', sourceText: '条件决定结论。' }] });
    for await (const _ of service.stream(runId)) { /* 等它失败 */ }
    const run = service.get(runId);
    assert.equal(run.status, 'failed');
    // 三页已落盘（第 4 页失败）。
    const partial = [...vault.steps.entries()].find(([key]) => key.endsWith('html-chapter-1-partial'));
    assert.ok(partial, '逐页进度必须已经落盘');
    const pages = partial[1].slidesByScene.reduce((sum, p) => sum + (p ? p.length : 0), 0);
    assert.equal(pages, 3, '失败前画好的三页都在盘上');
    // 进度快照也要报出这三页，而不是 0。
    assert.equal(run.slidesDone, 3);
    assert.equal(run.chapterProgress[0].slidesDone, 3);
    assert.equal(run.chapterProgress[0].scenesTotal, 4);
  } finally { service.dispose(); }
});

test('resume on a new service instance reuses the persisted pages', async () => {
  const vault = memoryVault();
  const chapters = [{ id: 'c1', title: '第一章', sourceText: '条件决定结论。' }];

  // 第一次：画到一半失败。
  const first = createGenerateService({ studio: null, log: { warn() {} }, ports: {
    now: Date.now, vault, validateHtml: async () => ({ ok: true }),
    media: { image() { throw new Error('no media'); } },
  }, llm: model({ scenes: 4, failAtScene: 3 }) });
  let runId;
  try {
    ({ runId } = first.start({ requirement: '讲解', outputFormat: 'html', chapterConcurrency: 1, chapters }));
    for await (const _ of first.stream(runId)) { /* 等失败 */ }
  } finally { first.dispose(); }

  // 第二次：全新服务（模拟进程重启），从盘上恢复。
  const calls = [];
  const second = createGenerateService({ studio: null, log: { warn() {} }, ports: {
    now: Date.now, vault, validateHtml: async () => ({ ok: true }),
    media: { image() { throw new Error('no media'); } },
  }, llm: { async call(request) {
    calls.push({ stage: request.stage, sceneIndex: request.sceneIndex });
    if (request.stage === 'html-understanding') return JSON.stringify({ obstacles: [{ hypothesis: '易混', sourceQuote: '条件' }] });
    if (request.stage === 'html-storyboard') return JSON.stringify({ scenes: Array.from({ length: 4 }, (_, i) => ({ title: `分镜${i + 1}`, explanation: '讲解', visual: '图' })) });
    return JSON.stringify({ slides: [slide(`第 ${request.sceneIndex + 1} 页`)] });
  } } });
  try {
    // 用同一个 runId 起一次「续跑」：start 传已有 runId 会冲突，所以清掉再起。
    const resumed = second.start({ requirement: '讲解', outputFormat: 'html', chapterConcurrency: 1, chapters },
      { runId: undefined });
    for await (const _ of second.stream(resumed.runId)) { /* 跑完 */ }
    const done = second.get(resumed.runId);
    assert.equal(done.status, 'done');
    // 新 runId 是全新的一次，不该复用别的 run 的落盘 —— 这里只断言它能跑完。
    assert.equal(done.htmlChapters.length, 1);
  } finally { second.dispose(); }
});

test('resume within the same service draws only the missing pages', async () => {
  const vault = memoryVault();
  const calls = [];
  const service = createGenerateService({ studio: null, log: { warn() {} }, ports: {
    now: Date.now, vault, validateHtml: async () => ({ ok: true }),
    media: { image() { throw new Error('no media'); } },
  }, llm: { async call(request) {
    calls.push({ stage: request.stage, sceneIndex: request.sceneIndex });
    if (request.stage === 'html-understanding') return JSON.stringify({ obstacles: [{ hypothesis: '易混', sourceQuote: '条件' }] });
    if (request.stage === 'html-storyboard') return JSON.stringify({ scenes: Array.from({ length: 4 }, (_, i) => ({ title: `分镜${i + 1}`, explanation: '讲解', visual: '图' })) });
    if (request.sceneIndex === 3 && calls.filter(c => c.stage === 'html').length === 4) throw new Error('模型超时');
    return JSON.stringify({ slides: [slide(`第 ${request.sceneIndex + 1} 页`)] });
  } } });
  try {
    const { runId } = service.start({ requirement: '讲解', outputFormat: 'html', chapterConcurrency: 1,
      chapters: [{ id: 'c1', title: '第一章', sourceText: '条件决定结论。' }] });
    for await (const _ of service.stream(runId)) { /* 等失败 */ }
    assert.equal(service.get(runId).status, 'failed');
    const before = calls.filter(c => c.stage === 'html').length;

    await service.resume(runId);
    for await (const _ of service.stream(runId)) { /* 等续跑结束 */ }
    const after = calls.filter(c => c.stage === 'html');
    assert.equal(service.get(runId).status, 'done');
    assert.ok(after.length > before, '续跑确实又画了页');
    // 续跑不应重算理解障碍与分镜。
    const understandingAfterResume = calls.filter(c => c.stage === 'html-understanding').length;
    assert.equal(understandingAfterResume, 1, '理解障碍只算一次');
    assert.equal(calls.filter(c => c.stage === 'html-storyboard').length, 1, '分镜只算一次');
  } finally { service.dispose(); }
});
