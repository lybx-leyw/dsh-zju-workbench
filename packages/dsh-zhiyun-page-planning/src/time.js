/**
 * 「规划」页的时间口径：分组、标签、紧迫度。
 *
 * # 为什么单独一个文件
 *
 * 这些函数原先写在 `client.jsx` 里，而那份文件是 JSX（还要 `import css`），
 * 测试无法直接导入 —— 于是**时区错配那类 bug 没有任何守卫**。实际就发生过一次：
 * 分组键取 UTC 日期、标签取上海时区，凌晨写下的条目分成两个同名组。
 *
 * 纯函数搬到这里之后，两边共用同一份实现（本文件不 import React，也不认识 JSX），
 * 宿主与页面都能引，测试也能直接钉死。
 */

/** 上海时区是这一页唯一的时区口径：用户在浙大，随手写的时间都按北京时间读。 */
export const ZONE = 'Asia/Shanghai';

/**
 * 紧迫度分档。
 *
 * 与宿主 `src/index.js` 的 `URGENCY` **必须同值**：宿主用它决定待办怎么归一，
 * 页面用它决定分组标题。两边各写一份字面量就会漂。
 */
export const URGENCY = {
  overdue: 'overdue',
  today: 'today',
  week: 'week',
  later: 'later',
  none: 'none',
};

/** 分组标题。 */
export const URGENCY_LABEL = {
  overdue: '已过期',
  today: '今天截止',
  week: '一周内',
  later: '更晚',
  none: '没有截止时间',
};

/**
 * 判紧迫度：先看什么，由"还剩多久"决定，不是"哪天真"。
 *
 * @param due - ISO 时间串或 null。
 * @param now - 当前毫秒时间戳（注入以便测试）。
 * @returns `overdue` / `today`（24h 内）/ `week`（7 天内）/ `later` / `none`。
 */
export function urgencyOf(due, now = Date.now()) {
  if (!due) return URGENCY.none;
  const at = Date.parse(due);
  if (Number.isNaN(at)) return URGENCY.none;
  if (at < now) return URGENCY.overdue;
  if (at - now <= 24 * 3600 * 1000) return URGENCY.today;
  if (at - now <= 7 * 24 * 3600 * 1000) return URGENCY.week;
  return URGENCY.later;
}

/**
 * 分组键的格式化器。
 *
 * `en-CA` 的短日期格式恰好就是 `YYYY-MM-DD`，且不受运行环境 locale 影响 ——
 * 比手拼 `getFullYear`/`getMonth` 可靠（那种写法在非 UTC 的 `Date` 上极易漏时区，
 * 而这正是本文件要解决的 bug）。
 */
const DAY_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

const DAY_LABEL = new Intl.DateTimeFormat('zh-CN', {
  timeZone: ZONE, month: 'long', day: 'numeric', weekday: 'long',
});

/**
 * 条目分组的**日期键**：`YYYY-MM-DD`，按上海时区取。
 *
 * ⚠️ 必须与 `dayLabel` 同一时区。曾经用 `new Date(...).toISOString().slice(0,10)`
 * （UTC），而标签是上海时区 —— 北京时间 00:00–08:00 的条目落进前一个 UTC 日，
 * 结果是**两天各一个组、标题却都写「10月19日」**。凌晨写的日记全部中招。
 *
 * @param seconds - 秒级时间戳。
 * @returns `YYYY-MM-DD` 或 `'unknown'`。
 */
export function dayKey(seconds) {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return DAY_KEY.format(date);
}

/**
 * 分组标题：待办用紧迫度，条目用日期。
 *
 * @param seconds - 秒级时间戳。
 * @returns 可读日期，如「10月19日星期一」。
 */
export function dayLabel(seconds) {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return DAY_LABEL.format(date);
}

/**
 * 单位护栏：`dayKey` / `dayLabel` 收的是**秒**。
 *
 * 把它们喂成毫秒是这个文件里最容易犯的错，而且**不会报错** —— 只会安静地算出一个
 * 五万年后的日期，整个日历一格都对不上（实际发生过一次：`dayKey(Date.now())`）。
 * 所以这里给一个显式的判断函数，让调用点与测试都能一眼验证口径。
 *
 * 判据是"年代是否合理"而不是精确范围：只要落在 2001–2099 之间就算秒级时间戳。
 * 毫秒级的当前时间会落到 5 万年之后，一测就露。
 *
 * @param value - 待检查的秒级时间戳。
 * @returns 看起来是不是一个合理的**秒**级时间戳。
 */
export function looksLikeSeconds(value) {
  if (!Number.isFinite(value)) return false;
  const year = new Date(value * 1000).getUTCFullYear();
  return year >= 2001 && year <= 2099;
}

