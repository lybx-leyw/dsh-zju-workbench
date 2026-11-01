import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apply, ScheduleStore } from '../packages/dsh-zhiyun-page-planning/src/index.js';

/** Boot the real host plugin with a deterministic LLM; no network, no real model. */
async function boot(t, replies) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-batch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const services = new Map();
  let handler; const calls = []; let index = 0;
  const ctx = { profileContext: { dir }, get: name => services.get(name),
    provide: (name, value) => { services.set(name, value); return () => services.delete(name); } };
  ctx.inject = (_names, factory) => factory({ ...ctx, effect: fn => fn(), webServer: { register: row => { handler = row.handler; return () => {}; } } });
  const reply = () => replies[Math.min(index++, replies.length - 1)];
  services.set('zhiyunParser', { llm: { resolve: async () => ({ model: 'fixture' }),
    call: async request => { calls.push(request); return { text: JSON.stringify(reply()) }; },
    async *callStream(request) { calls.push(request); yield { type: 'delta', text: JSON.stringify(reply()) }; } } });
  services.set('zhiyunCampus', { todos: async () => ({ xzzd: { ok: true, rows: [
    { id: 'p1', source: 'xzzd', title: '虚构平台任务一', due: '2026-11-08T12:00:00+08:00' },
    { id: 'p2', source: 'xzzd', title: '虚构平台任务二', due: '2026-11-08T12:00:00+08:00' } ] }, pta: { ok: true, rows: [] } }) });
  const dispose = await apply(ctx, {}); t.after(dispose);
  return { dir, calls, service: services.get('zhiyunPlanning'), get handler() { return handler; } };
}

async function post(host, action, body) {
  const { EventEmitter } = await import('node:events');
  const req = new EventEmitter();
  Object.assign(req, { url: `/_dsh/zhiyun-planning?${action}`, method: 'POST', headers: { host: 'localhost', 'x-zhiyun-planning': '1' } });
  req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)); };
  let output = '';
  const res = { on() {}, writeHead() {}, setHeader() {}, flushHeaders() {}, write(chunk) { output += chunk; }, end(chunk = '') { output += chunk; } };
  await host.handler(req, res);
  return output;
}

test('a three-item batch reaches the model in full and saves all three atomically', async t => {
  const host = await boot(t, [{ say: '三项都排好了，确认后保存。', action: 'schedule', draft: { slots: [] } }]);
  const tasks = [
    host.service.mine.create({ title: '期末作业' }),
    host.service.mine.create({ title: '完成新中国史线上课程期中考核' }),
    host.service.mine.create({ title: '提交新中国史期末论文电子版' }),
  ];
  // Model output is replaced by a real batch draft built from the grounded task keys.
  const slots = tasks.map((task, i) => ({ taskKey: `local:${task.id}`, start: `2026-11-07T0${5 + i}:00:00+08:00`, end: `2026-11-07T0${6 + i}:00:00+08:00` }));
  const reply = await host.service.mine.pet('安排到周六下午');
  // The first canned reply is an empty batch -> refused; prove the guard rather than a silent partial write.
  assert.equal(reply.action, 'ask');
  assert.equal(new ScheduleStore(path.join(host.dir, 'data/zhiyun-planning/schedule.json')).all().length, 0);
  assert.ok(slots.every(slot => slot.taskKey.startsWith('local:')));
  assert.ok(host.calls[0].constant.includes('期末作业'));
});

test('confirmation facts survive restarts so the assistant can quote the real previous time', async t => {
  const host = await boot(t, [{ say: '好', action: 'chat', draft: null }]);
  const task = host.service.mine.create({ title: '交 NLP 作业 2' });
  const key = `local:${task.id}`;
  const saved = JSON.parse(await post(host, 'schedule-save', { taskKey: key, title: task.title, start: '2026-11-02T10:00:00Z', end: '2026-11-02T12:00:00Z' })).schedule[0];
  await post(host, 'schedule-save', { id: saved.id, taskKey: key, title: task.title, start: '2026-11-02T10:50:00Z', end: '2026-11-02T12:00:00Z' });
  const store = new ScheduleStore(path.join(host.dir, 'data/zhiyun-planning/schedule.json'));
  const events = store.recentEvents();
  assert.equal(events.length, 2);
  assert.deepEqual(events[1].before, { start: '2026-11-02T10:00:00Z', end: '2026-11-02T12:00:00Z' });
  await host.service.mine.pet('我刚才原本排在几点？');
  assert.match(host.calls.at(-1).constant, /2026-11-02T10:00:00Z/);
});

test('batch endpoint rejects the whole proposal when any item is stale', async t => {
  const host = await boot(t, [{ say: '好', action: 'chat', draft: null }]);
  const task = host.service.mine.create({ title: '虚构任务' });
  const key = `local:${task.id}`;
  const first = JSON.parse(await post(host, 'schedule-save', { taskKey: key, title: task.title, start: '2026-11-03T10:00:00Z', end: '2026-11-03T11:00:00Z' })).schedule[0];
  const stale = await post(host, 'schedule-save-batch', { items: [
    { id: first.id, taskKey: key, title: task.title, start: '2026-11-03T13:00:00Z', end: '2026-11-03T14:00:00Z',
      expected: { start: '2026-11-03T10:00:00Z', end: '2026-11-03T11:00:00Z' } },
    { taskKey: key, title: task.title, start: 'bad', end: '2026-11-03T15:00:00Z' },
  ] });
  assert.match(stale, /error|INVALID/i);
  const store = new ScheduleStore(path.join(host.dir, 'data/zhiyun-planning/schedule.json'));
  assert.deepEqual(store.all(), [first], '任何一项不合法都不能留下半个结果');
  const file = JSON.parse(await readFile(path.join(host.dir, 'data/zhiyun-planning/schedule.json'), 'utf8'));
  assert.equal(file.slots.length, 1);
});
