/**
 * 把课表折成今天页能直接画的三段。
 *
 * `complete !== true` 时不交出任何节次：没确认收全的列表不能被画成「今天就这些」。
 * 时间一律用条目上的毫秒，调用方传入「现在」。
 */

export function clock(sec) {
  if (!Number.isFinite(sec)) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(sec * 1000));
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("hour")}:${pick("minute")}`;
}

export function projectAgenda(items, meta, nowMs) {
  if (!meta || meta.complete !== true) return { kind: "incomplete", entries: [], current: null, upcoming: [], finished: [] };
  const entries = [];
  for (const day of items ?? []) {
    for (const course of day?.courses ?? []) entries.push({ ...course, day: day.day });
  }
  const timed = entries.every((item) => Number.isFinite(item.startMs) && Number.isFinite(item.endMs) && item.endMs >= item.startMs);
  if (!timed) return { kind: "incomplete", entries: [], current: null, upcoming: [], finished: [] };
  entries.sort((a, b) => a.startMs - b.startMs || String(a.courseTitle).localeCompare(String(b.courseTitle), "zh"));
  const current = entries.find((item) => item.startMs <= nowMs && nowMs < item.endMs) ?? null;
  const upcoming = entries.filter((item) => item.startMs > nowMs);
  const finished = entries.filter((item) => item.endMs <= nowMs);
  return { kind: entries.length ? "day" : "empty", entries, current, upcoming, finished };
}
