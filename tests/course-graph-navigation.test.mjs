import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyController } from '../packages/core/study/src/model.js';

const course = { id: '7', title: 'Course' };
const lesson = { id: '20', subId: '20', title: 'Lesson' };
const entry = { kind: 'point', chapter: 1, topic: 2 };
function fixture(resultCall = async () => ({ result: { status: 'ready' }, job: null })) {
  return createStudyController(async (method, payload) => {
    if (method === 'result') return resultCall(payload);
    return {};
  }, { navigate() {} });
}

test('course graph jumps to the original lesson and exact chapter/topic, including repeated jumps', async () => {
  const controller = fixture();
  try {
    assert.equal(await controller.openCourseGraphEntry(course, lesson, entry), true);
    const state = controller.getSnapshot();
    assert.equal(state.lesson, lesson);
    assert.equal(state.course, course);
    assert.deepEqual(state.focusTab.entry, entry);
    assert.equal(state.focusTab.tab, '课程图谱定位');
    const focus = state.focusTab;
    assert.equal(await controller.openCourseGraphEntry(course, lesson, entry), true);
    assert.notEqual(controller.getSnapshot().focusTab, focus);
  } finally { controller.dispose(); }
});

test('a stale graph jump cannot overwrite navigation to a different lesson', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const controller = fixture(payload => payload.subId === '20' ? pending : Promise.resolve({ result: { status: 'ready' } }));
  try {
    const jump = controller.openCourseGraphEntry(course, lesson, entry);
    await controller.selectLesson({ id: '30', subId: '30' }, course);
    release({ result: { status: 'ready' } });
    assert.equal(await jump, false);
    assert.equal(controller.getSnapshot().lesson.subId, '30');
    assert.notEqual(controller.getSnapshot().focusTab?.tab, '课程图谱定位');
  } finally { controller.dispose(); }
});
