import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export const MAX_SCHEDULE_SLOTS = 2000;

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_SCHEDULE';
  throw error;
}

function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    invalid(`${name} 必须是非空、无控制字符且不超过 ${max} 字符的文本`);
  }
  return value;
}

function instant(value, name) {
  // Require an explicit offset and validate calendar fields before Date.parse can normalize them.
  if (typeof value !== 'string' || value.length > 35) invalid(`${name} 必须是带时区的 ISO 时间`);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) invalid(`${name} 必须是带时区的 ISO 时间`);
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const zone = m[8];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59
    || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
    || !Number.isFinite(Date.parse(value))) invalid(`${name} 不是有效 ISO 时间`);
  return value;
}

function slotOf(input, id) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('日程必须是对象');
  // Opaque JSON identity, never a path or object-property key. Existing plan prefixes
  // contain NUL separators, so do not apply the display-text control-character rule.
  const taskKey = input.taskKey;
  if (typeof taskKey !== 'string' || !taskKey.trim() || taskKey.length > 512) invalid('taskKey 必须是 1–512 字符的非空字符串');
  const title = text(input.title, 'title', 500);
  const start = instant(input.start, 'start');
  const end = instant(input.end, 'end');
  if (Date.parse(end) <= Date.parse(start)) invalid('end 必须晚于 start');
  return { id: text(id, 'id', 128), taskKey, title, start, end };
}

/** Independent execution blocks; task deadlines never imply scheduled execution. */
export class ScheduleStore {
  constructor(file) {
    this.file = file;
    this.slots = [];
    this.events = [];
    let parsed;
    try { parsed = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!Array.isArray(parsed?.slots) || parsed.slots.length > MAX_SCHEDULE_SLOTS) invalid('日程文件格式或数量无效');
    const ids = new Set();
    this.slots = parsed.slots.map((input) => {
      const slot = slotOf(input, input?.id);
      if (ids.has(slot.id)) invalid('日程 id 重复');
      ids.add(slot.id);
      return slot;
    });
    this.events = Array.isArray(parsed.events) ? parsed.events.slice(-30).filter(event => event && typeof event.at === 'string' && ['created', 'updated', 'removed'].includes(event.action)) : [];
  }

  all() { return this.slots.map((slot) => ({ ...slot })); }

  recentEvents() { return structuredClone(this.events); }

  commit(slots, events = this.events) {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, `${JSON.stringify({ slots, events: events.slice(-30) }, null, 2)}\n`, 'utf8');
      renameSync(tmp, this.file);
    } finally { rmSync(tmp, { force: true }); }
    // Failed writes must not change the in-memory truth either.
    this.slots = slots;
    this.events = events.slice(-30);
  }

  save(input) { return this.saveMany([input])[0]; }

  /** Validate the entire proposal before one atomic write; no partial multi-task saves. */
  saveMany(inputs, { requireExpected = false } = {}) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 20) invalid('一次确认须包含 1–20 个时间段');
    const next = this.all(), changed = [], events = this.recentEvents(), seen = new Set();
    for (const input of inputs) {
      const id = input?.id === undefined ? randomUUID() : text(input.id, 'id', 128);
      if (seen.has(id)) invalid('同一草案不能重复修改同一时间块');
      seen.add(id);
      const slot = slotOf(input, id);
      const index = next.findIndex(item => item.id === id), before = index < 0 ? null : next[index];
      if (input.id !== undefined && !before) invalid('日程不存在，请重新查询');
      if (before && before.taskKey !== slot.taskKey) invalid('不能把已有时间块改挂到另一任务');
      if (before && (requireExpected || input.expected)) {
        if (!input.expected || input.expected.start !== before.start || input.expected.end !== before.end) invalid('该日程已变化，请重新生成草案后确认');
      }
      if (!before && next.length >= MAX_SCHEDULE_SLOTS) invalid('日程数量已达上限');
      if (index < 0) next.push(slot); else next[index] = slot;
      changed.push({ ...slot });
      events.push({ id: slot.id, at: new Date().toISOString(), action: before ? 'updated' : 'created', taskKey: slot.taskKey, title: slot.title,
        before: before ? { start: before.start, end: before.end } : null, after: { start: slot.start, end: slot.end } });
    }
    this.commit(next, events);
    return changed;
  }

  remove(id) {
    text(id, 'id', 128);
    const next = this.slots.filter((slot) => slot.id !== id);
    if (next.length !== this.slots.length) {
      const before = this.slots.find(slot => slot.id === id);
      this.commit(next, [...this.events, { id, at: new Date().toISOString(), action: 'removed', taskKey: before.taskKey, title: before.title,
        before: { start: before.start, end: before.end }, after: null }]);
    }
  }
}
