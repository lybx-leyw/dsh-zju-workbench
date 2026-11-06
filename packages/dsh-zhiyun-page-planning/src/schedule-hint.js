/**
 * 规划条目旁边的课表一句。
 *
 * 只回答「这天有几节课」，不判断来不来得及。
 * 没收全、没读到的日子一个字都不说 —— 「这天没有课」只在那一天确实在窗口里、
 * 而且课表已确认收全时才出现。否则会把「没去读」说成「没有课」。
 *
 * 截止日期用 `YYYY-MM-DDTHH:mm` 的日期前缀。那是上海墙钟（见 `toLocalInput`），
 * 不能再 `new Date()` 按机器时区解析，否则非 +08 的机器会把日子说错。
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 课堂单次窗口最多 31 天，起止相减必须小于 31。这里取 30 天跨度。 */
export const WINDOW_BACK = 7;
export const WINDOW_FORWARD = 23;

export function shanghaiToday(nowMs = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(nowMs));
}

export function shiftDate(day, delta) {
  if (!DAY.test(day) || !Number.isInteger(delta)) return '';
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date) + delta * 86400000).toISOString().slice(0, 10);
}

/** 以上海今天为中心，回看 7 天、再往后放到接口允许的尽头。 */
export function hintWindow(nowMs = Date.now()) {
  const today = shanghaiToday(nowMs);
  return { from: shiftDate(today, -WINDOW_BACK), to: shiftDate(today, WINDOW_FORWARD) };
}

/**
 * @param context - `{ items, from, to, complete }`，或 null。
 * @param dueLocal - `YYYY-MM-DDTHH:mm`，或空。
 * @returns 提示文案，或空串。
 */
export function scheduleHint(context, dueLocal) {
  if (!context || context.complete !== true) return '';
  if (!DAY.test(context.from) || !DAY.test(context.to)) return '';
  const day = typeof dueLocal === 'string' ? dueLocal.slice(0, 10) : '';
  if (!DAY.test(day) || day < context.from || day > context.to) return '';
  const items = Array.isArray(context.items) ? context.items : [];
  const row = items.find((item) => item?.day === day);
  const count = Array.isArray(row?.courses) ? row.courses.length : 0;
  if (count === 0) return '这天没有课。';
  return `这天有 ${count} 节课。`;
}
