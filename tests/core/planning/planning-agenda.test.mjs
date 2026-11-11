import test from 'node:test';
import assert from 'node:assert/strict';
import { taskKeyFor, toShanghaiLocal, fromShanghaiLocal, weekStart, groupWeek, overlaps, overlappingIds, isAfterDue } from '../../../packages/core/planning/src/agenda.js';
const slot = (id, start, end) => ({ id, taskKey: 'local:1', title: '示例任务', start: fromShanghaiLocal(start), end: fromShanghaiLocal(end) });
test('stable keys match mine, actual planCards prefix/index and external sources', () => {
  assert.equal(taskKeyFor({ source: 'mine', id: 'abc' }), 'local:abc');
  assert.equal(taskKeyFor({ source: 'plan', prefix: 'demo', index: 0, id: 'demo#0' }), 'plan:demo:0');
  assert.equal(taskKeyFor({ source: 'xxt', id: 'abc' }), 'xxt:abc');
});
test('Shanghai wall clock converts independently of machine timezone', () => {
  assert.equal(fromShanghaiLocal('2026-11-02T00:30'), '2026-11-01T16:30:00.000Z');
  assert.equal(toShanghaiLocal('2026-11-01T16:30:00Z'), '2026-11-02T00:30');
  assert.equal(toShanghaiLocal('2026-11-01T08:30:00-08:00'), '2026-11-02T00:30');
  assert.equal(fromShanghaiLocal('2026-02-30T12:00'), null);
  assert.equal(fromShanghaiLocal('nonsense'), null);
  assert.equal(toShanghaiLocal('invalid'), '');
});
test('weeks begin Monday including Shanghai Sunday and UTC boundary', () => {
  assert.equal(weekStart('2026-11-01T15:59:00Z'), '2026-10-26');
  assert.equal(weekStart('2026-11-01T16:00:00Z'), '2026-11-02');
});
test('cross-day splitting uses half-open intervals and stable execution ordering', () => {
  const a = slot('a', '2026-11-02T23:00', '2026-11-04T00:00');
  const b = slot('b', '2026-11-03T09:00', '2026-11-03T10:00');
  const days = groupWeek([b, a], '2026-11-03T12:00:00+08:00');
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((day) => day.entries.length), [1, 2, 0, 0, 0, 0, 0]);
  assert.deepEqual(days[1].entries.map((entry) => entry.id), ['a', 'b']);
  assert.equal(days[0].entries[0].continuesAfter, true);
  assert.equal(days[1].entries[0].continuesBefore, true);
  assert.equal(toShanghaiLocal(days[1].entries[0].segmentStart), '2026-11-03T00:00');
});
test('slots spanning week boundaries are clipped, invalid or zero-length ignored', () => {
  const a = slot('a', '2026-11-01T23:00', '2026-11-10T01:00');
  const days = groupWeek([a, { id: 'bad', start: 'invalid', end: 'invalid' }, slot('zero', '2026-11-02T12:00', '2026-11-02T12:00')], '2026-11-02T12:00:00+08:00');
  assert.ok(days.every((day) => day.entries.length === 1));
  assert.equal(days[0].entries[0].continuesBefore, true);
  assert.equal(days[6].entries[0].continuesAfter, true);
});
test('overlap warning excludes touching endpoints, includes same-task and nested slots', () => {
  const a = slot('a', '2026-11-02T09:00', '2026-11-02T10:00');
  const b = slot('b', '2026-11-02T10:00', '2026-11-02T11:00');
  const c = slot('c', '2026-11-02T09:30', '2026-11-02T09:45');
  assert.equal(overlaps(a, b), false);
  assert.equal(overlaps(a, c), true);
  assert.deepEqual([...overlappingIds([a, b, c])].sort(), ['a', 'c']);
});
test('deadline warning does not mutate tasks or slots; date-only due includes its Shanghai day', () => {
  const a = slot('a', '2026-11-02T09:00', '2026-11-02T10:00');
  const task = Object.freeze({ due: '2026-11-02T09:30:00+08:00' });
  assert.equal(isAfterDue(Object.freeze(a), task), true);
  assert.equal(isAfterDue(a, { due: '2026-11-02' }), false);
  assert.equal(isAfterDue(a, { due: '2026-11-02T10:00' }), false);
  assert.equal(isAfterDue(a, undefined), false);
});
