// Execution times are independent from task deadlines. All calendar days use Shanghai.
const DAY = 86400000;
const OFFSET = 8 * 3600000;
export function taskKeyFor(row) {
  if (row.source === 'mine') return `local:${row.id}`;
  if (row.source === 'plan') return `plan:${row.prefix}:${row.index}`;
  return `${row.source}:${row.id}`;
}
export function toShanghaiLocal(value) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms + OFFSET).toISOString().slice(0, 16) : '';
}
export function fromShanghaiLocal(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value || '')) return null;
  const ms = Date.parse(`${value}+08:00`);
  if (!Number.isFinite(ms) || toShanghaiLocal(msToIso(ms)) !== value.slice(0, 16)) return null;
  return msToIso(ms);
}
function msToIso(ms) { return new Date(ms).toISOString(); }
export function shanghaiDate(value = new Date()) { return toShanghaiLocal(value).slice(0, 10); }
export function addDays(date, count) {
  const ms = Date.parse(`${date}T00:00:00+08:00`);
  return Number.isFinite(ms) ? shanghaiDate(msToIso(ms + count * DAY)) : '';
}
export function weekStart(value = new Date()) {
  const date = shanghaiDate(value);
  if (!date) return '';
  const weekday = new Date(`${date}T00:00:00+08:00`).getUTCDay();
  // UTC date is the preceding day at Shanghai midnight.
  return addDays(date, -weekday);
}
export function overlaps(a, b) {
  const [as, ae, bs, be] = [a.start, a.end, b.start, b.end].map(Date.parse);
  return as < ae && bs < be && as < be && bs < ae;
}
export function overlappingIds(slots = []) {
  const ids = new Set();
  slots.forEach((a, i) => slots.slice(i + 1).forEach((b) => {
    if (overlaps(a, b)) { ids.add(a.id); ids.add(b.id); }
  }));
  return ids;
}
export function isAfterDue(slot, task) {
  const due = task?.due;
  if (!due) return false;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(due)
    ? `${addDays(due, 1)}T00:00:00+08:00`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(due) ? fromShanghaiLocal(due) : due;
  return Date.parse(slot.end) > Date.parse(normalized);
}
export function groupWeek(slots = [], anchor = new Date()) {
  const monday = weekStart(anchor);
  if (!monday) return [];
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    const start = Date.parse(`${date}T00:00:00+08:00`);
    const end = start + DAY;
    const entries = slots.filter((slot) => overlaps(slot, { start: msToIso(start), end: msToIso(end) }))
      .map((slot) => ({ ...slot, segmentStart: msToIso(Math.max(start, Date.parse(slot.start))),
        segmentEnd: msToIso(Math.min(end, Date.parse(slot.end))),
        continuesBefore: Date.parse(slot.start) < start, continuesAfter: Date.parse(slot.end) > end }))
      .sort((a, b) => Date.parse(a.segmentStart) - Date.parse(b.segmentStart) || Date.parse(a.segmentEnd) - Date.parse(b.segmentEnd) || String(a.id).localeCompare(String(b.id)));
    return { date, entries };
  });
}
