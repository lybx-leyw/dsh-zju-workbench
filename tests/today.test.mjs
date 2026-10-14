import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StudyWorkbench } from '../packages/dsh-zhiyun-study-core/src/workbench.js';
import { createStudyController } from '../packages/dsh-zhiyun-study-core/src/model.js';
import { mountKnowledge } from './fixtures/study-storage.mjs';
import { clock, projectAgenda } from '../packages/dsh-zhiyun-page-today/src/agenda.js';

const eight = Date.parse('2026-10-14T00:00:00Z');
const entry = (title, startMs, endMs) => ({
  courseId: '10', subId: '20', sourceId: `${title}:${startMs}`, courseTitle: title,
  roomName: '东1', teacherName: '甲', startAt: startMs / 1000, endAt: endMs / 1000, startMs, endMs,
});

test('today agenda keeps an unconfirmed timetable off the page and classifies a full day', () => {
  assert.equal(clock(eight / 1000), '08:00');
  const hidden = projectAgenda([{ day: '2026-10-14', courses: [entry('线代', eight, eight + 5400000)] }], { complete: false }, eight);
  assert.equal(hidden.kind, 'incomplete');
  assert.equal(hidden.entries.length, 0);
  const broken = projectAgenda([{ day: '2026-10-14', courses: [{ courseTitle: '线代' }] }], { complete: true }, eight);
  assert.equal(broken.kind, 'incomplete');
  const day = projectAgenda([{
    day: '2026-10-14',
    courses: [entry('线代', eight, eight + 5400000), entry('写作', eight + 7200000, eight + 10800000)],
  }], { complete: true }, eight + 60000);
  assert.equal(day.kind, 'day');
  assert.equal(day.current.courseTitle, '线代');
  assert.equal(day.upcoming[0].courseTitle, '写作');
  assert.equal(day.finished.length, 0);
  const done = projectAgenda([{ day: '2026-10-14', courses: [entry('线代', eight, eight + 1000)] }], { complete: true }, eight + 1000);
  assert.equal(done.current, null);
  assert.equal(done.finished.length, 1);
  assert.equal(projectAgenda([], { complete: true }, eight).kind, 'empty');
});

test('schedule is read-only for the signed-in account and a bad date is rejected before the source', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-today-'));
  const host = await mountKnowledge(dir);
  let user = { id: '1' };
  let seen = null;
  const service = new StudyWorkbench({
    directory: dir,
    knowledge: host.service,
    llm: { listProviders: () => [], resolveModelInfo: async () => ({}) },
    classroom: {
      getCurrentUser: async () => user,
      getSchedule: async (options) => { seen = options; return { items: [{ day: '2026-10-14', courses: [] }], meta: { complete: true, reason: 'single-response' } }; },
    },
    parser: { llm: { routes: {} }, parseClassroom: async () => ({}) },
  });
  try {
    const data = await service.invoke('schedule', {});
    assert.equal(data.meta.complete, true);
    assert.equal(seen.start, undefined);
    assert.equal(data.items[0].day, '2026-10-14');
    await assert.rejects(service.invoke('schedule', { start: 1 }), { code: 'INPUT' });
    service.classroom.getSchedule = async () => { throw new TypeError('结束日期早于开始日期'); };
    await assert.rejects(service.invoke('schedule', { start: '2026-10-15', end: '2026-10-14' }), { code: 'INPUT' });
    user = null;
    await assert.rejects(service.invoke('schedule', {}), { code: 'SESSION_EXPIRED' });
  } finally {
    await service.dispose();
    await host.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the today page load keeps a schedule failure off the study error banner', async () => {
  const controller = createStudyController(async (method) => {
    if (method === 'state') return { user: { id: '1' }, jobs: [] };
    if (method === 'courses') return { items: [{ id: '10', title: '线代' }], meta: { complete: true } };
    if (method === 'schedule') throw Object.assign(new Error('课堂服务暂时无法连接，请稍后重试。'), { code: 'NETWORK' });
    return { items: [], meta: { complete: true } };
  }, { navigate() {} });
  try {
    await controller.refresh();
    await controller.loadSchedule();
    assert.equal(controller.getSnapshot().error, null);
    assert.match(controller.getSnapshot().scheduleError, /无法连接/);
    assert.equal(controller.getSnapshot().schedule, null);
  } finally {
    controller.dispose();
  }
});
