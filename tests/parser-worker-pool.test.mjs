import test from 'node:test';
import assert from 'node:assert/strict';
import { LectureParser } from '../packages/dsh-zhiyun-core-parser/src/parser.js';
import { createLectureService } from '../packages/dsh-zhiyun-core-lecture/src/index.js';
import { WorkerPoolLlm, normalizeWorkers } from '../packages/dsh-zhiyun-core-parser/src/worker-pool.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(entries, visual = ['a']) {
  const pending = [], calls = [], active = {}, peaks = {};
  const base = {
    acceptsAccel: true, image: async value => value,
    llm: { resolveModelInfo: async provider => ({ inputModalities: visual.includes(provider) ? ['text', 'image'] : ['text'] }) },
    resolve: async (_signal, { selection, vision }) => ({ text: selection, ...(vision ? { vision: selection } : {}) }),
    call: async request => {
      const provider = request.route.provider;
      calls.push(request); active[provider] = (active[provider] ?? 0) + 1;
      peaks[provider] = Math.max(peaks[provider] ?? 0, active[provider]);
      try {
        return await new Promise((resolve, reject) => {
          const cancel = () => reject(request.signal.reason);
          request.signal?.addEventListener('abort', cancel, { once: true });
          pending.push(() => { request.signal?.removeEventListener('abort', cancel); resolve({ text: 'ok' }); });
        });
      } finally { active[provider]--; }
    },
  };
  return { pool: new WorkerPoolLlm({ base, entries }), calls, pending, peaks };
}
const entries = [{ provider: 'a', model: 'image', workers: 2 }, { provider: 'b', model: 'text', workers: 1 }];

test('provider quotas sum to total capacity, share text/vision slots, and preserve request budgets', async () => {
  const f = fixture(entries);
  const routes = await f.pool.resolve();
  assert.equal(f.pool.concurrency, 3);
  const requests = Array.from({ length: 9 }, (_, i) => f.pool.call({ stage: i < 3 ? 'faithful' : 'lecture-polish',
    image: i < 3 ? {} : undefined, route: { ...routes.text, maxTokens: 32768 }, variable: String(i) }));
  await tick();
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.pool.snapshot.map(e => e.active), [2, 1]);
  for (let i = 0; i < 9; i++) { f.pending.splice(0).forEach(release => release()); await tick(); }
  await Promise.all(requests);
  assert.deepEqual(f.peaks, { a: 2, b: 1 });
  assert.ok(f.calls.filter(request => request.image).every(request => request.route.provider === 'a'));
  assert.ok(f.calls.every(request => request.route.maxTokens === 32768));
  assert.equal(new Set(f.calls.map(request => request.variable)).size, 9);
  assert.equal(f.pool.snapshot.reduce((n, e) => n + e.completed, 0), 9);
});

test('a queued image request cannot block an idle text-only provider', async () => {
  const f = fixture(entries.map(e => ({ ...e, workers: 1 })));
  const jobs = [f.pool.call({ image: {}, variable: 'image-1' }), f.pool.call({ image: {}, variable: 'image-2' }), f.pool.call({ variable: 'text' })];
  await tick();
  assert.deepEqual(f.calls.map(call => call.variable), ['image-1', 'text']);
  f.pending.splice(0).forEach(release => release()); await tick();
  f.pending.splice(0).forEach(release => release()); await Promise.all(jobs);
});

test('cancelling a queued request removes it without using another provider or issuing a call', async () => {
  const f = fixture([entries[0]].map(e => ({ ...e, workers: 1 })));
  const first = f.pool.call({ variable: 'first' }); await tick();
  const controller = new AbortController();
  const queued = f.pool.call({ variable: 'cancelled', signal: controller.signal });
  const rejected = assert.rejects(queued, { name: 'AbortError' });
  await tick(); controller.abort(); await rejected;
  f.pending.splice(0).forEach(release => release()); await first; await tick();
  assert.equal(f.calls.length, 1); assert.equal(f.pool.snapshot[0].active, 0);
});

test('vision capability is checked before inference; cache identity tracks the chosen models and quotas', async () => {
  const textOnly = fixture([entries[1]], []);
  await assert.rejects(textOnly.pool.resolve(), { code: 'VISION_MODEL' });
  assert.equal(textOnly.calls.length, 0);
  const a = await fixture(entries).pool.resolve();
  const b = await fixture([{ ...entries[0], workers: 3 }, entries[1]]).pool.resolve();
  assert.notDeepEqual(a.text, b.text);
  assert.equal(a.vision.workerPool.length, 1);
});

test('configuration keeps only identifiers and integer quotas; duplicate providers and invalid counts are rejected', () => {
  assert.deepEqual(normalizeWorkers([{ ...entries[0], apiKey: 'PRIVATE', cookie: 'PRIVATE' }]), [entries[0]]);
  for (const invalid of [[], [entries[0], entries[0]], [{ ...entries[0], workers: 0 }], [{ ...entries[0], workers: 33 }], [{ ...entries[0], workers: 1.5 }]]) {
    assert.throws(() => normalizeWorkers(invalid), { code: 'INPUT' });
  }
});


test('summed quotas are not clipped by the old single-provider concurrency limit',()=>{
 const {pool}=fixture(entries.map(e=>({...e,workers:20})));
 const parser=new LectureParser({llm:pool,concurrency:pool.concurrency});
 const lecture=createLectureService({llm:pool,concurrency:pool.concurrency});
 try{assert.equal(parser.concurrency,40);assert.equal(lecture.concurrency,40);}finally{parser.dispose();lecture.dispose();}
});
