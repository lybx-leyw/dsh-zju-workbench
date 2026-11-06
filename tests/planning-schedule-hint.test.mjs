import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyController } from '../packages/dsh-zhiyun-core-study/src/model.js';
import { hintWindow, scheduleHint, shiftDate } from '../packages/dsh-zhiyun-page-planning/src/schedule-hint.js';

const context = {
  from: '2026-10-17',
  to: '2026-11-16',
  complete: true,
  items: [{ day: '2026-10-24', courses: [{}, {}] }],
};

test('a class hint only speaks for a confirmed day inside the window', () => {
  assert.equal(scheduleHint(context, '2026-10-24T23:30'), '这天有 2 节课。');
  assert.equal(scheduleHint(context, '2026-10-18T09:00'), '这天没有课。');
  assert.equal(scheduleHint(context, '2026-12-01T09:00'), '');
  assert.equal(scheduleHint({ ...context, complete: false }, '2026-10-18T09:00'), '');
  assert.equal(scheduleHint(null, '2026-10-24T09:00'), '');
  assert.equal(scheduleHint(context, ''), '');
});

test('the hint window stays inside the classroom limit', () => {
  const window = hintWindow(Date.parse('2026-10-24T04:00:00.000Z'));
  assert.equal(window.from, '2026-10-17');
  assert.equal(window.to, '2026-11-16');
  const span = (Date.parse(window.to) - Date.parse(window.from)) / 86400000;
  assert.ok(span < 31);
  assert.equal(shiftDate('2026-10-24', -7), '2026-10-17');
});

test('reading a wider timetable does not replace the today page schedule', async () => {
  const controller = createStudyController(async (method, payload) => {
    if (method === 'state') return { user: { id: '1' }, jobs: [] };
    if (method === 'schedule') {
      return {
        items: [{ day: payload.start || '2026-10-24', courses: [{ courseTitle: payload.start ? '窗口' : '今天' }] }],
        meta: { complete: true },
      };
    }
    return null;
  }, { navigate() {} });
  try {
    assert.equal(await controller.readScheduleWindow('2026-10-17', '2026-11-16'), null);
    await controller.refresh();
    await controller.loadSchedule();
    const today = controller.getSnapshot().schedule;
    assert.equal(today[0].courses[0].courseTitle, '今天');
    const wider = await controller.readScheduleWindow('2026-10-17', '2026-11-16');
    assert.equal(wider.items[0].day, '2026-10-17');
    assert.equal(controller.getSnapshot().schedule, today);
  } finally {
    controller.dispose();
  }
});
