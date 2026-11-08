import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StudyWorkbench } from '../packages/core/study/src/workbench.js';
import { createGenerateService } from '../packages/core/classroom-generate/src/index.js';

const slide = { title: '一页', points: ['短词'], summary: '总结', visualHtml: '<svg viewBox="0 0 800 560"><text x="60" y="120" font-size="32">关系</text></svg>', formulas: [], explanation: '画布外讲解。' };
const lecture = n => ({ chapters: Array.from({ length: n }, (_, i) => ({ title: `第 ${i + 1} 章`, topics: [{ title: '点', blocks: [{ text: '条件决定结论。' }] }] })) });

/** 池子替身：总并发 = Σ workers，并记录真正同时在跑的模型调用数。 */
function poolWith(concurrency) {
  const state = { active: 0, peak: 0, calls: 0 };
  return {
    state,
    concurrency,
    async execute(work) {
      state.active++; state.peak = Math.max(state.peak, state.active); state.calls++;
      try {
        await new Promise(resolve => setTimeout(resolve, 4));
        return await work({ provider: 'pooled', model: 'pooled-model' });
      } finally { state.active--; }
    },
  };
}

async function run({ workers, chapters }) {
  const pool = poolWith(workers.reduce((sum, row) => sum + row.workers, 0));
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
  const directory = await mkdtemp(path.join(os.tmpdir(), 'teach-pool-'));
  const workbench = Object.assign(Object.create(StudyWorkbench.prototype), {
    directory, ready: Promise.resolve(), closed: false, controllers: new Set(),
    classroom: { getCurrentUser: async () => ({ id: 'account' }) },
    effectiveWorkers: purpose => (purpose === 'teaching' ? workers : []),
    parser: { createRun: ({ workers: rows }) => ({ llm: pool, concurrency: pool.concurrency }) },
    atomic: async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); },
    result: async () => ({ lecture: lecture(chapters), knowledgeTree: null }),
  });
  workbench.generateOf = () => service;
  try {
    const started = await workbench.invoke('teach-generate', { courseId: '1', subId: '2' });
    let final = null;
    for (let i = 0; i < 900; i++) {
      const poll = await workbench.invoke('teach-poll', { runId: started.runId });
      if (poll.status === 'done') { final = poll; break; }
      await new Promise(r => setTimeout(r, 4));
    }
    return { pool, final, run: service.get(started.runId) };
  } finally { service.dispose(); await rm(directory, { recursive: true, force: true }); }
}

test('chapter concurrency comes from the provider pool, not a separate number', async () => {
  // 两个供应商各 2 路 → 总并发 4；4 章应该同时开跑。
  const { pool, final } = await run({ workers: [{ provider: 'a', model: 'm', workers: 2 }, { provider: 'b', model: 'm', workers: 2 }], chapters: 4 });
  assert.equal(pool.concurrency, 4);
  assert.equal(pool.state.peak, 4, 'Σ workers 就是同时能跑几章');
  assert.equal(final.pages.length, 4);
});

test('a single provider with one worker serializes chapters', async () => {
  const { pool, final } = await run({ workers: [{ provider: 'a', model: 'm', workers: 1 }], chapters: 3 });
  assert.equal(pool.state.peak, 1, '一路 worker 只能串行');
  assert.equal(final.pages.length, 3);
});

test('raising the provider quota raises real parallelism without any other setting', async () => {
  const { pool } = await run({ workers: [{ provider: 'a', model: 'm', workers: 8 }], chapters: 5 });
  assert.equal(pool.state.peak, 5, '5 章 < 8 路：受章节数封顶，不会凭空多开');
  assert.equal(pool.concurrency, 8);
});
