import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptPoolTransport } from '../packages/core/classroom-generate/src/llm-pool.js';

/** 最小可用的池子端口，形状与 core-parser 的 WorkerPoolLlm 一致。 */
function fakePool({ concurrency = 3 } = {}) {
  const state = { active: 0, peak: 0, routes: [] };
  return {
    state,
    concurrency,
    async execute(work, { signal } = {}) {
      state.active++; state.peak = Math.max(state.peak, state.active);
      try {
        await new Promise(resolve => setTimeout(resolve, 5));
        const route = { provider: 'p' + state.routes.length, model: 'm' };
        state.routes.push(route);
        return await work(route);
      } finally { state.active--; }
    },
  };
}

test('pool concurrency becomes the chapter concurrency budget', async () => {
  const pool = fakePool({ concurrency: 6 });
  const transport = adaptPoolTransport(pool, async request => `echo:${request.provider}`);
  assert.equal(transport.concurrency, 6, '总并发 = Σ workers，由池子给出');
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => transport.call({ stage: 'html', messages: [], chapterId: 'c' + i })));
  assert.equal(results.length, 6);
  assert.ok(results.every(text => text.startsWith('echo:p')));
});

test('pool-assigned route overrides the caller default provider/model', async () => {
  const pool = fakePool();
  const seen = [];
  const transport = adaptPoolTransport(pool, async request => { seen.push({ provider: request.provider, model: request.model }); return 'ok'; });
  await transport.call({ stage: 'html', messages: [], provider: 'caller-default', model: 'caller-model' });
  assert.notEqual(seen[0].provider, 'caller-default', '池子分配的 provider 必须优先');
  assert.equal(seen[0].model, 'm');
});

test('transport rejects a missing pool or channel instead of running unbounded', () => {
  assert.throws(() => adaptPoolTransport(null, async () => ''), /execute/);
  assert.throws(() => adaptPoolTransport({}, async () => ''), /execute/);
  assert.throws(() => adaptPoolTransport(fakePool(), null), /宿主通道/);
});

test('pool concurrency falls back to one when the pool does not report it', () => {
  const transport = adaptPoolTransport({ async execute(work) { return work({ provider: 'p', model: 'm' }); } }, async () => 'x');
  assert.equal(transport.concurrency, 1, 'never invent a larger budget than the pool reports');
});

test('aborted requests never reach the transport', async () => {
  const pool = fakePool();
  let calls = 0;
  const transport = adaptPoolTransport(pool, async () => { calls++; return 'x'; });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(transport.call({ stage: 'html', messages: [], signal: controller.signal }), /已取消/);
  assert.equal(calls, 0);
});
