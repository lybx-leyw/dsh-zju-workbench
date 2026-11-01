import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ScheduleStore, MAX_SCHEDULE_SLOTS } from '../packages/dsh-zhiyun-page-planning/src/schedule.js';

const block = { taskKey: 'local:fake', title: '示例任务快照', start: '2026-11-01T09:00:00+08:00', end: '2026-11-01T10:00:00+08:00' };
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'schedule-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'schedule.json');
  return { dir, file, store: new ScheduleStore(file) };
}

test('multiple blocks per local/AI/platform task survive restart, update and deletion', (t) => {
  const { file, dir, store } = fixture(t);
  for (const taskKey of ['local:fake', 'plan:kind\u0000标题\u0000fakehash:0', 'xzzd:fake', 'pta:fake']) {
    store.save({ ...block, taskKey });
    store.save({ ...block, taskKey });
  }
  assert.equal(store.all().length, 8);
  const reopened = new ScheduleStore(file);
  assert.deepEqual(reopened.all(), store.all());
  const first = reopened.all()[0];
  reopened.save({ ...first, title: '更新快照', end: '2026-11-01T11:00:00+08:00', due: 'not-an-execution-time' });
  assert.equal(reopened.all().length, 8);
  assert.equal(new ScheduleStore(file).all()[0].title, '更新快照');
  assert.equal('due' in reopened.all()[0], false);
  reopened.remove(first.id);
  assert.equal(new ScheduleStore(file).all().length, 7);
  reopened.remove(first.id); // Idempotent deletion.
  assert.deepEqual(readdirSync(dir), ['schedule.json']);
  assert.equal(JSON.parse(readFileSync(file)).slots.length, 7);
  const copy = reopened.all();
  copy[0].title = 'not persisted';
  assert.notEqual(reopened.all()[0].title, copy[0].title);
});

test('strict zoned ISO dates, interval order, bounded safe text and count', (t) => {
  const { store } = fixture(t);
  const bad = [
    null, [], {}, { ...block, taskKey: 1 }, { ...block, taskKey: '' },
    { ...block, taskKey: 'x'.repeat(513) },
    { ...block, title: ' ' }, { ...block, title: 'x'.repeat(501) },
    { ...block, start: '2026-11-01T09:00:00' }, { ...block, start: '2026-02-30T09:00:00Z' },
    { ...block, start: '2026-11-01T24:00:00Z' }, { ...block, start: '2026-11-01T09:00:00+24:00' },
    { ...block, end: block.start }, { ...block, end: '2026-11-01T00:00:00Z' },
    { ...block, start: undefined, due: block.start }, { ...block, id: 'unknown' }, { ...block, id: '' },
  ];
  for (const input of bad) assert.throws(() => store.save(input));
  assert.deepEqual(store.all(), []);
  assert.throws(() => store.remove(null));
  const slot = store.save({ ...block, start: '2026-02-28T23:00:00.001Z', end: '2026-03-01T00:00:00Z' });
  // Exercise the cap without thousands of disk writes.
  store.slots = Array.from({ length: MAX_SCHEDULE_SLOTS }, (_, i) => ({ ...slot, id: `slot-${i}` }));
  assert.throws(() => store.save(block), /上限/);
  store.save({ ...slot, id: 'slot-0', title: 'at cap update' });
  assert.equal(store.all().length, MAX_SCHEDULE_SLOTS);
});

test('failed atomic replacement preserves memory and existing disk target', (t) => {
  const { store, file, dir } = fixture(t);
  store.save(block);
  const before = store.all();
  const blocked = path.join(dir, 'blocked');
  mkdirSync(blocked);
  store.file = blocked;
  assert.throws(() => store.save(block));
  assert.deepEqual(store.all(), before);
  assert.deepEqual(new ScheduleStore(file).all(), before);
  assert.equal(readdirSync(dir).some((name) => name.endsWith('.tmp')), false);
});
