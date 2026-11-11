import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHandler as createPlanningHandler, ScheduleStore } from '../../../packages/core/planning/src/index.js';

const block = { taskKey: 'plan:fake-prefix:2', title: '保留的标题', start: '2026-11-01T09:00:00Z', end: '2026-11-01T10:00:00Z' };
function harness(t, { cached = false, enabled = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'schedule-route-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'schedule.json');
  const store = new ScheduleStore(file);
  const snapshotFile = cached ? path.join(dir, 'snapshot.json') : null;
  if (cached) writeFileSync(snapshotFile, JSON.stringify({ at: Date.now(), value: { schedule: [{ id: 'stale' }] } }));
  let network = 0;
  const handler = createPlanningHandler({
    getConfig: () => ({}), saveConfig: () => {},
    store: { list: () => [], absorb: () => ({ added: [], skipped: 0 }) },
    scheduleStore: enabled ? store : undefined, snapshotFile,
    fetchRemote: async () => { network++; return { ok: false, code: 'NOT_CONFIGURED' }; },
    loadTodos: async () => { network++; return { xzzd: { ok: true, rows: [] }, pta: { ok: true, rows: [] } }; },
    ptaStatus: async () => ({ configured: false }),
  });
  async function call(action = '', body, headers = {}, method = 'POST') {
    const req = { method, url: `/?${action}`, headers: { host: '127.0.0.1', 'x-zhiyun-planning': '1', ...headers },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } };
    let status, result;
    await handler(req, { writeHead(value) { status = value; }, end(value) { result = JSON.parse(value); } });
    // Let the fake cached-snapshot refresh finish before fixture cleanup.
    await new Promise((resolve) => setImmediate(resolve));
    return { status, body: result };
  }
  return { store, file, call, network: () => network };
}

test('save/update/remove are local-only, return all slots, and survive restart', async (t) => {
  const h = harness(t);
  const result = await h.call('schedule-save', block);
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body).sort(), ['ok', 'schedule']);
  const slot = result.body.schedule[0];
  await h.call('schedule-save', { ...block, taskKey: 'local:fake' });
  const updated = await h.call('schedule-save', { ...slot, title: '新标题' });
  assert.equal(updated.body.schedule.length, 2);
  assert.equal(updated.body.schedule[0].title, '新标题');
  assert.deepEqual(new ScheduleStore(h.file).all(), updated.body.schedule);
  const removed = await h.call('schedule-remove', { id: slot.id });
  assert.equal(removed.body.schedule.length, 1);
  assert.deepEqual(new ScheduleStore(h.file).all(), removed.body.schedule);
  assert.equal(h.network(), 0);
});

test('write header, loopback, body validation, optional store', async (t) => {
  const h = harness(t);
  for (const action of ['schedule-save', 'schedule-remove']) {
    assert.equal((await h.call(action, block, { 'x-zhiyun-planning': '' })).status, 403);
    assert.equal((await h.call(action, block, { host: 'evil.example' })).status, 403);
    assert.equal((await h.call(action, null)).status, 400);
    assert.equal((await h.call(action, {})).status, 400);
  }
  assert.equal((await h.call('schedule-save', { ...block, end: block.start })).status, 400);
  assert.equal((await h.call('schedule-save', { ...block, start: undefined, due: block.start })).status, 400);
  assert.deepEqual(h.store.all(), []);
  assert.equal((await harness(t, { enabled: false }).call('schedule-save', block)).status, 400);
});

test('storage failures never expose internal paths or database details', async t => {
  const h = harness(t);
  h.store.save = () => { throw Object.assign(new Error('private storage detail'), { code: 'EACCES' }); };
  const response = await h.call('schedule-save', block);
  assert.equal(response.status, 500);
  assert.ok(!JSON.stringify(response.body).includes('private storage detail'));
});

for (const cached of [false, true]) test(`snapshot schedule is current for ${cached ? 'cached' : 'fresh'} reads`, async (t) => {
  const h = harness(t, { cached });
  const slot = h.store.save(block);
  const snapshot = await h.call('', undefined, {}, 'GET');
  assert.equal(snapshot.status, 200);
  assert.deepEqual(snapshot.body.schedule, [slot]);
  h.store.remove(slot.id);
  assert.deepEqual((await h.call('', undefined, {}, 'GET')).body.schedule, []);
  h.store.save(block);
  assert.deepEqual((await h.call('refresh', {})).body.schedule, h.store.all());
});

test('snapshot without optional scheduleStore always includes empty array', async (t) => {
  const h = harness(t, { enabled: false });
  assert.deepEqual((await h.call('', undefined, {}, 'GET')).body.schedule, []);
});
