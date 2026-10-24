/**
 * 今天页要扫一眼的到期事项。
 *
 * 只认三处：本机规划、学在浙大待办、拼题 A。截止日期按上海日历的某一天比较，
 * 不用 UTC 的日期切一刀（北京时间凌晨会被切到前一天）。
 *
 * 已勾掉的不进这个列表。本机规划的勾是做完了；平台待办的勾是「不再提醒」，
 * 调用方在传入之前把勾选并进 `done`。这里不解释这两种勾，也不替缺了日期的条目编一个。
 */

const DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

const LABELS = { local: '我的规划', xzzd: '学在浙大', pta: '拼题A' };

/** 上海日历日，形如 `YYYY-MM-DD`。看不懂的时间返回空串。 */
export function shanghaiDay(ms) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return '';
  return DAY.format(date);
}

function detailOf(row) {
  const text = typeof row?.detail === 'string' ? row.detail.trim() : '';
  if (!text || text === '未结束' || text === '已结束') return '';
  return text;
}

/**
 * 从已经读到的三份列表里挑出今天到期、还没勾掉的事。
 *
 * @param local - 本机规划数组。
 * @param todos - `{ xzzd, pta }`，某一侧 `ok !== true` 时那一侧整段不采用。
 * @param ticks - 平台勾选，键是 `source:id`。
 * @param nowMs - 当前毫秒时间戳。
 * @returns `{ items, truncated }`。最多 20 条。
 */
export function collectDue(local, todos, ticks, nowMs) {
  const today = shanghaiDay(nowMs);
  const items = [];
  const push = (row, source) => {
    if (!row || typeof row !== 'object') return;
    if (Array.isArray(row.splitInto) && row.splitInto.length > 0) return;
    const id = String(row.id ?? '').trim();
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!id || !title) return;
    const ticked = source !== 'local' && Boolean(ticks?.[`${source}:${id}`]);
    if (row.done || ticked) return;
    const at = Date.parse(row.due);
    if (!today || Number.isNaN(at) || shanghaiDay(at) !== today) return;
    const label = LABELS[source] || (typeof row.sourceLabel === 'string' ? row.sourceLabel : source);
    items.push({ key: `${source}:${id}`, source, label, title, detail: detailOf(row), at });
  };
  for (const row of local ?? []) push(row, 'local');
  if (todos?.xzzd?.ok === true) for (const row of todos.xzzd.rows ?? []) push(row, 'xzzd');
  if (todos?.pta?.ok === true) for (const row of todos.pta.rows ?? []) push(row, 'pta');
  items.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title, 'zh'));
  return { items: items.slice(0, 20).map(({ at, ...item }) => item), truncated: items.length > 20 };
}
