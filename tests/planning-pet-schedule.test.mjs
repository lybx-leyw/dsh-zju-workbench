import test from 'node:test';
import assert from 'node:assert/strict';
import { createPetPrompt, normalizeReply, resolveScheduleReply, readPetResponse, createStreamParser } from '../packages/dsh-zhiyun-page-planning/src/pet.js';

const draft = { taskKey: 'local\u0000opaque', start: '2026-11-02T09:00:00+08:00', end: '2026-11-02T10:00:00+08:00' };
const reply = (patch = {}) => ({ say: '执行时间草案，尚未保存。', action: 'schedule', draft: { ...draft, ...patch } });
const task = { taskKey: draft.taskKey, title: '真实任务', due: '2026-11-02T09:30:00+08:00', done: false };

test('schedule accepts opaque keys and whitelists draft fields', () => {
  const result = normalizeReply(reply({ title: '伪造标题', due: 'ignored', extra: true }));
  assert.equal(result.action, 'schedule');
  assert.deepEqual(result.draft, draft);
  assert.equal(normalizeReply(reply({ start: '2026-11-02T01:00Z', end: '2026-11-02T02:00Z' })).action, 'schedule');
});

test('invalid shape, missing times, calendar rollover and implicit zones ask without saving', () => {
  const invalid = [null, [], 'bad', { ...draft, start: undefined }, { ...draft, end: undefined },
    { ...draft, start: '2026-02-30T09:00:00+08:00' }, { ...draft, start: '2025-02-29T09:00:00Z' },
    { ...draft, start: '2026-11-02T24:00:00+08:00' }, { ...draft, start: '2026-11-02T09:00:00' },
    { ...draft, end: draft.start }, { ...draft, taskKey: '' }, { ...draft, taskKey: 'x'.repeat(513) },
    { ...draft, id: '' }, { ...draft, id: null }, { ...draft, id: 'x'.repeat(129) }];
  for (const candidate of invalid) {
    const result = normalizeReply({ ...reply(), draft: candidate });
    assert.equal(result.action, 'ask', JSON.stringify(candidate));
    assert.equal(result.draft, null);
    assert.match(result.say, /未保存/);
  }
  assert.throws(() => normalizeReply([]), { code: 'BAD_SHAPE' });
});

test('resolver rejects unknown, ambiguous, done tasks and unknown or foreign ids', () => {
  for (const [tasks, slots, patch] of [
    [[], [], {}], [[task, task], [], {}], [[{ ...task, done: true }], [], {}],
    [[task], [], { id: 'missing' }], [[task], [{ id: 'foreign', taskKey: 'other' }], { id: 'foreign' }],
  ]) {
    const result = resolveScheduleReply(normalizeReply(reply(patch)), { tasks, slots });
    assert.equal(result.action, 'ask');
    assert.equal(result.draft, null);
    assert.match(result.say, /未保存/);
  }
});

test('resolver is readonly, adds real title and overlap/DDL warnings, excludes own slot', () => {
  const slot = Object.freeze({ id: 'self', ...draft, title: '旧标题' });
  const tasks = Object.freeze([Object.freeze({ ...task })]);
  const slots = Object.freeze([slot]);
  const input = Object.freeze(normalizeReply(reply()));
  const result = resolveScheduleReply(input, { tasks, slots });
  assert.equal(result.draft.title, task.title);
  assert.equal(result.warnings.length, 2);
  assert.equal(tasks[0].due, task.due);
  assert.equal(input.draft.title, undefined);
  assert.equal(resolveScheduleReply(normalizeReply(reply({ id: 'self' })), { tasks, slots }).warnings.length, 1);
  const adjacent = [{ ...slot, start: draft.end, end: '2026-11-02T11:00:00+08:00' }];
  assert.equal(resolveScheduleReply(input, { tasks, slots: adjacent }).warnings.length, 1);
});

test('legacy JSON, fenced responses and streamed payloads share schedule normalization', () => {
  const raw = reply();
  const fenced = `${raw.say}\n\u0060\u0060\u0060json\n${JSON.stringify({ action: raw.action, draft: raw.draft })}\n\u0060\u0060\u0060`;
  assert.deepEqual(readPetResponse(JSON.stringify(raw)), normalizeReply(raw));
  assert.deepEqual(readPetResponse(fenced), normalizeReply(raw));
  const parser = createStreamParser();
  for (const char of fenced) parser.push(char);
  const { say, payload } = parser.finish();
  assert.deepEqual(normalizeReply({ say, ...payload }), normalizeReply(raw));
  for (const action of ['ask', 'chat']) assert.equal(normalizeReply({ say: '继续聊', action }).action, action);
  assert.equal(normalizeReply({ say: '确认', action: 'create', draft: { title: '新任务' } }).action, 'create');
});

test('prompt includes bounded untrusted schedule context and confirmation rules', () => {
  const prompt = createPetPrompt({ today: '2026-11-01', weekday: '周日', pending: Array.from({ length: 100 }, () => ({ ...task, title: 'x'.repeat(10000) })), slots: [{ id: 'slot', ...draft }], now: '2026-11-01T12:00:00+08:00' });
  for (const phrase of ['schedule', 'taskKey', 'slots', '不可执行', '用户确认后保存', '不改 due', '缺少起止', '标题匹配猜测']) assert.ok(prompt.includes(phrase), phrase);
  assert.ok(prompt.length < 20000);
  assert.ok(prompt.includes('local\\u0000opaque'));
});
