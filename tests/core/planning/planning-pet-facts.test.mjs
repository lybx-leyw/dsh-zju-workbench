import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanningFacts, answerScheduleStatus } from '../../../packages/core/planning/src/pet-context.js';
import { createPetPrompt } from '../../../packages/core/planning/src/pet.js';

const now = Date.parse('2026-11-01T12:00:00+08:00');

test('the real failure: scheduled tasks are never reported as unscheduled, and the list is complete', () => {
  const tasks = [];
  // More than the old 20-task / 40-slot cutoffs, with the known scheduled tail items included.
  for (let i = 0; i < 45; i += 1) tasks.push({ taskKey: `local:${i}`, title: `虚构任务${i}`, due: '2026-11-05T12:00:00+08:00', done: false });
  tasks.push({ taskKey: 'local:nlp', title: '交 NLP 作业 2', due: '2026-11-02T23:59:00+08:00', done: false });
  tasks.push({ taskKey: 'local:physics', title: '参加物理小测', due: '2026-11-05T12:00:00+08:00', done: false });
  tasks.push({ taskKey: 'local:no-due', title: '回看直播', due: null, done: false });
  const slots = [
    { id: 's1', taskKey: 'local:nlp', start: '2026-11-02T10:00:00Z', end: '2026-11-02T12:00:00Z' },
    { id: 's2', taskKey: 'local:physics', start: '2026-11-04T10:00:00Z', end: '2026-11-04T14:00:00Z' },
  ];
  const facts = buildPlanningFacts({ tasks, slots, now, events: [
    { id: 's1', at: '2026-11-01T03:00:00Z', action: 'updated', taskKey: 'local:nlp', title: '交 NLP 作业 2',
      before: { start: '2026-11-02T10:00:00Z', end: '2026-11-02T12:00:00Z' }, after: { start: '2026-11-02T10:50:00Z', end: '2026-11-02T12:00:00Z' } },
  ] });
  assert.equal(facts.tasks.length, 48);
  const unscheduled = facts.unscheduledWithDue.map(item => item.taskKey);
  assert.ok(!unscheduled.includes('local:nlp'), '已排任务不能出现在未排清单');
  assert.ok(!unscheduled.includes('local:physics'));
  assert.ok(!unscheduled.includes('local:no-due'), '没有截止时间的不进有 DDL 未排清单');
  assert.equal(unscheduled.length, 45);
  assert.ok(facts.events.some(event => event.type === 'schedule-updated' && event.beforeStart === '2026-11-02T10:00:00Z'),
    '确认过的修改要带原时间，模型才有依据恢复');
  const reply = answerScheduleStatus('我指的是有DDL却没日程的', facts);
  assert.match(reply.say, /45 项/);
  assert.ok(!reply.say.includes('NLP 作业 2'), '已排的 NLP 作业不能被列为未排');
  assert.match(reply.say, /虚构任务44/);
  // Unrelated scheduling requests are not intercepted.
  assert.equal(answerScheduleStatus('把高数作业安排到明晚7到9点', facts), null);
});

test('failed sources are disclosed instead of claiming completeness', () => {
  const facts = buildPlanningFacts({ tasks: [{ taskKey: 'local:1', title: '虚构', due: '2026-11-05T12:00:00+08:00' }], slots: [], now,
    sources: { local: { ok: true }, plans: { ok: true }, xzzd: { ok: false } } });
  assert.equal(facts.coverage.complete, false);
  assert.deepEqual(facts.coverage.failedSources, ['xzzd']);
  assert.match(answerScheduleStatus('有截止时间但还没安排的', facts).say, /不能覆盖未读来源/);
});

test('prompt carries full facts and a short set of rules instead of long prohibitions', () => {
  const tasks = Array.from({ length: 60 }, (_, i) => ({ taskKey: `k${i}`, title: `任务${i}`, due: '2026-11-05T12:00:00+08:00' }));
  const facts = buildPlanningFacts({ tasks, slots: [], now, sources: { local: { ok: true }, plans: { ok: true }, xzzd: { ok: true }, pta: { ok: true } } });
  const prompt = createPetPrompt({ today: '2026-11-01', weekday: '周日', facts, pending: tasks });
  assert.ok(prompt.includes('任务59'), '全量事实不能被截断');
  assert.ok(prompt.includes('unscheduledWithDue'));
  // 约束部分要短；长出来的只能是事实数据本身。
  const rules = prompt.replace(JSON.stringify(facts), '');
  assert.ok(rules.length < 2000, `指令部分过长：${rules.length}`);
});
