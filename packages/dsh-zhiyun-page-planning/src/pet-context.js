/** Deterministic planning facts. All labels are untrusted data, never instructions. */
const SOURCE_NAMES = ['xzzd', 'pta', 'local', 'plans'];
const EVENT_TYPES = new Set(['task-created', 'task-updated', 'task-completed', 'task-reopened',
  'schedule-saved', 'schedule-deleted', 'schedule-updated', 'local-create', 'local-done', 'schedule-save', 'schedule-delete']);
// The schedule store persists {action, before, after}; project it into the flat event vocabulary.
const ACTION_TYPES = { created: 'schedule-saved', updated: 'schedule-updated', removed: 'schedule-deleted' };
function normalizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  if (EVENT_TYPES.has(event.type)) return event;
  const type = Object.hasOwn(ACTION_TYPES, event.action) ? ACTION_TYPES[event.action] : null;
  if (!type) return null;
  return { type, at: event.at, taskKey: event.taskKey, title: event.title, slotId: event.id,
    start: event.after?.start ?? event.before?.start, end: event.after?.end ?? event.before?.end,
    ...(event.before && event.after ? { beforeStart: event.before.start, beforeEnd: event.before.end } : {}) };
}
const scalar = (value) => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean' || value === null;
const instant = (value) => typeof value === 'number' && Number.isFinite(value) ? value
  : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const hasDue = (value) => Number.isFinite(instant(value));
const slotView = (slot) => ({ id: slot.id ?? null, start: slot.start ?? null, end: slot.end ?? null });

/** No task/slot caps: absence of a schedule is computed across the entire snapshot. */
export function buildPlanningFacts({ tasks = [], slots = [], sources = {}, events = [], now = Date.now() } = {}) {
  const inputTasks = Array.isArray(tasks) ? tasks : [];
  const inputSlots = Array.isArray(slots) ? slots.filter((slot) => slot && typeof slot === 'object') : [];
  const sourceInput = sources && typeof sources === 'object' && !Array.isArray(sources) ? sources : {};
  const sourceFacts = Object.fromEntries([...new Set([...SOURCE_NAMES, ...Object.keys(sourceInput)])].map((name) => {
    const source = sourceInput[name];
    const enabled = source?.enabled !== false;
    return [name, { enabled, ok: source?.ok === true, status: !enabled ? 'disabled' : source?.ok === true ? 'ok' : source?.ok === false ? 'failed' : 'unknown' }];
  }));
  const failedSources = Object.keys(sourceFacts).filter((name) => sourceFacts[name].status === 'failed');
  const unknownSources = Object.keys(sourceFacts).filter((name) => sourceFacts[name].status === 'unknown');
  const allKeys = new Set(inputTasks.filter((task) => typeof task?.taskKey === 'string').map((task) => task.taskKey));
  const byKey = new Map();
  for (const slot of inputSlots) {
    if (!byKey.has(slot.taskKey)) byKey.set(slot.taskKey, []);
    byKey.get(slot.taskKey).push(slotView(slot));
  }
  const taskFacts = inputTasks.filter((task) => task && typeof task.taskKey === 'string' && task.taskKey.trim()
    && typeof task.title === 'string' && task.title.trim() && !task.done).map((task) => {
    const linked = (byKey.get(task.taskKey) ?? []).map((slot) => ({ ...slot }));
    return { taskKey: task.taskKey, title: task.title, due: task.due ?? null, scheduled: linked.length > 0, slots: linked };
  }).sort((a, b) => (hasDue(a.due) ? instant(a.due) : Infinity) - (hasDue(b.due) ? instant(b.due) : Infinity));
  const unscheduledWithDue = taskFacts.filter((task) => hasDue(task.due) && !task.scheduled)
    .map(({ taskKey, title, due }) => ({ taskKey, title, due }));
  const scheduledWithDue = taskFacts.filter((task) => hasDue(task.due) && task.scheduled).map((task) => task.taskKey);
  const orphanSlots = inputSlots.filter((slot) => !allKeys.has(slot.taskKey))
    .map((slot) => ({ taskKey: typeof slot.taskKey === 'string' ? slot.taskKey : null, ...slotView(slot) }));
  // Only server-confirmed event types and scalar facts survive; no message/detail/prompt fields.
  const safeEvents = (Array.isArray(events) ? events : []).map(normalizeEvent).filter((event) => event && EVENT_TYPES.has(event.type)
    && Number.isFinite(instant(event.at)) && instant(event.at) <= now).map((event) => Object.fromEntries(
    ['type', 'at', 'taskKey', 'title', 'due', 'slotId', 'start', 'end', 'beforeStart', 'beforeEnd', 'count', 'done']
      .filter((key) => Object.hasOwn(event, key) && scalar(event[key]))
      .map((key) => [key, typeof event[key] === 'string' ? event[key].slice(0, 1000) : event[key]])))
    .sort((a, b) => instant(b.at) - instant(a.at)).slice(0, 30);
  const counts = { tasks: taskFacts.length, slots: inputSlots.length, withDue: unscheduledWithDue.length + scheduledWithDue.length,
    unscheduledWithDue: unscheduledWithDue.length, scheduledWithDue: scheduledWithDue.length, orphanSlots: orphanSlots.length };
  const complete = failedSources.length === 0 && unknownSources.length === 0 && Array.isArray(tasks) && Array.isArray(slots);
  return { now, timezone: 'Asia/Shanghai', coverage: { complete, counts, sources: sourceFacts, failedSources, unknownSources },
    tasks: taskFacts, unscheduledWithDue, scheduledWithDue, orphanSlots, events: safeEvents };
}

function dateLabel(due) {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant(due)));
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/** Narrow read-only intent route; never interprets task titles or saved event text as commands. */
export function answerScheduleStatus(message, facts) {
  if (typeof message !== 'string' || !facts || !/(?:没(?:有)?安排|未安排|未排|没(?:有)?日程|无日程|没(?:有)?排期)/.test(message)
      || !/(?:ddl|截止|到期|近期|最近|近来)/i.test(message)) return null;
  const items = (Array.isArray(facts.unscheduledWithDue) ? facts.unscheduledWithDue : []).map(({ taskKey, title, due }) => ({ taskKey, title, due }));
  const coverage = facts.coverage;
  const warning = coverage?.complete === true ? '' : '\n注意：部分来源读取失败或尚未确认读取成功；以下仅覆盖已读取数据，不能覆盖未读来源。';
  let say = items.length ? `已读取数据中，有截止时间但尚无日程的未完成任务共 ${items.length} 项（北京时间）：`
    : '已读取数据中，没有发现有截止时间但尚无日程的未完成任务。';
  if (items.length > 100) say += '\n清单超过 100 项，完整结果见报告；未省略报告中的任何任务。';
  else if (items.length) say += '\n' + items.map((item, index) => `${index + 1}. ${JSON.stringify(item.title)} — ${dateLabel(item.due)}`).join('\n');
  return { say: say + warning, action: 'chat', draft: null, notes: [], report: { items, coverage } };
}
