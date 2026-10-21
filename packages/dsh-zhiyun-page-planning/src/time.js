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

/* ══════════════════════════════════════════ 紧迫度（学生视角重排） */

/**
 * 学生打开「规划」时真正想先看到的东西，按这个顺序：
 *
 *   1. `overdue`  **过期了还没勾** —— 最需要"想办法补救"的，必须最显眼；
 *   2. `soon`     **24 小时内到期** —— 今晚/明早就得干的事；
 *   3. `today`    **今天余下** —— 今天之内、但还不算火烧眉毛；
 *   4. `week`     一周内；
 *   5. `later`    更晚；
 *   6. `none`     没填时间。
 *
 * 与旧的 `URGENCY` 相比只多了一档 `soon`：旧口径把"24 小时内"和"今天之内"
 * 混成 `today`，于是**明早 8 点截止**和**今晚 23:59 截止**排在同一组 ——
 * 而这两件事在学生的紧迫感里差得很远。
 */
export const FOCUS_ORDER = ['overdue', 'soon', 'today', 'week', 'later', 'none'];

/** 各档标题。`soon` 单独成档，文案要写清是"24 小时内"。 */
export const FOCUS_LABEL = {
  overdue: '已过期',
  soon: '24 小时内',
  today: '今天之内',
  week: '一周内',
  later: '更晚',
  none: '没有截止时间',
};

/**
 * 按**学生视角**分档。
 *
 * 与 `urgencyOf` 的区别：
 *   - 多一档 `soon`（24 小时内），把"今晚 vs 明早"分开；
 *   - `today` 的含义收窄为"今天结束之前，但超过 24 小时"（跨天时才会出现）。
 *
 * @param due - ISO 时间串或 null。
 * @param now - 当前毫秒时间戳。
 * @returns `overdue` / `soon` / `today` / `week` / `later` / `none`。
 */
export function focusOf(due, now = Date.now()) {
  if (!due) return 'none';
  const at = Date.parse(due);
  if (Number.isNaN(at)) return 'none';
  if (at < now) return 'overdue';

  const left = at - now;
  if (left <= 24 * 3600 * 1000) return 'soon';
  if (left <= 3 * 24 * 3600 * 1000) return 'today';
  if (left <= 7 * 24 * 3600 * 1000) return 'week';
  return 'later';
}

/**
 * 一条网关条目算不算"新到的"（用户可能还不知道）。
 *
 * 判据是**入库时刻** `cachedAt`：它记录这条第一次被 `absorb` 写进本地的秒数。
 * 不用"已读"状态，是因为那需要新增一份可变的阅读记录，而用户真正在意的
 * 只是"最近有没有我不知道的东西进来"。
 *
 * @param cachedAt - 条目入库的秒级时间戳。
 * @param now - 当前毫秒时间戳。
 * @param windowHours - 多久之内算新，默认 48 小时（跨一个工作日 + 一晚）。
 * @returns 是不是新到的。
 */
export function isNewArrival(cachedAt, now = Date.now(), windowHours = 48) {
  const at = Number(cachedAt);
  if (!Number.isFinite(at) || at <= 0) return false;
  return now - at * 1000 <= windowHours * 3600 * 1000;
}

/**
 * 顶部摘要条要显示的数字。
 *
 * 只统计**没做**的条目 —— 勾掉的已完成内容不该进任何提醒。
 *
 * @param options.openTodos - 未完成的待办行（含 `due`）。
 * @param options.newArrivals - 新到的网关条目数。
 * @param options.now - 当前毫秒时间戳。
 * @returns `{ overdue, soon, today, newArrivals }`，都是数字。
 */
export function focusSummary({ openTodos = [], newArrivals = 0, now = Date.now() } = {}) {
  const counts = { overdue: 0, soon: 0, today: 0 };
  for (const row of openTodos) {
    const key = focusOf(row?.due, now);
    if (key in counts) counts[key] += 1;
  }
  return { ...counts, newArrivals };
}

/* ══════════════════════════════════════════ 快捷时间（像调闹钟一样） */

/**
 * 把「现在」对齐到上海时区的某个整点/整分。
 *
 * 为什么不用 `new Date()` 直接加减：用户想的是"今天晚上 22:00"，而不是
 * "现在 + 10 小时"。所以一律**先定到当天的某个时刻**再加天数。
 *
 * 上海是 UTC+8 且无夏令时 —— 按 UTC 构造再减 8 小时即可，不依赖宿主机时区。
 *
 * @param now - 当前毫秒时间戳。
 * @param options.dayOffset - 相对今天的天数偏移。
 * @param options.hour - 目标小时（上海时区）。
 * @param options.minute - 目标分钟。
 * @returns 目标时刻的毫秒时间戳。
 */
export function atShanghai(now, { dayOffset = 0, hour = 9, minute = 0 } = {}) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now));
  const grab = (type) => Number(parts.find((p) => p.type === type)?.value);
  const midnightUtc = Date.UTC(grab('year'), grab('month') - 1, grab('day'));
  const targetUtc = midnightUtc
    + dayOffset * 24 * 3600 * 1000
    + hour * 3600 * 1000
    + minute * 60 * 1000;
  return targetUtc - 8 * 3600 * 1000;
}

/**
 * 下一个指定星期几的 09:00（上海时区）。
 *
 * @param now - 当前毫秒时间戳。
 * @param weekday - 1=周一 … 7=周日。
 * @returns 目标时刻（毫秒）。若今天正好是那天，取**下**一周。
 */
export function nextWeekday(now, weekday = 1) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short' });
  const map = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const todayDow = map[fmt.format(new Date(now))] ?? 1;
  let delta = (weekday - todayDow + 7) % 7;
  if (delta === 0) delta = 7;
  return atShanghai(now, { dayOffset: delta, hour: 9 });
}

/**
 * 快捷时间片：学生最常用的几个「什么时候」。
 *
 * 全部返回**确定的时刻**，不做自然语言猜测 —— 把"周三"猜成这周还是下周的
 * 代价太高（猜错了用户会以为工具坏了，而不是以为自己写错了）。
 *
 * 只返回**还没过去**的项：给出一个过去的时间等于让用户建一条立刻过期的待办。
 *
 * @param now - 当前毫秒时间戳。
 * @returns `[{ key, label, due }]`，`due` 是毫秒时间戳。
 */
export function quickTimes(now = Date.now()) {
  /** 今晚 22:00；若已经过了，就顺延到明晚。 */
  const tonight = atShanghai(now, { hour: 22 });
  const tonightDue = tonight > now ? tonight : atShanghai(now, { dayOffset: 1, hour: 22 });

  return [
    { key: 'today18', label: '今天 18:00', due: atShanghai(now, { hour: 18 }) },
    { key: 'tonight', label: '今晚 22:00', due: tonightDue },
    { key: 'tomorrow', label: '明天 09:00', due: atShanghai(now, { dayOffset: 1, hour: 9 }) },
    { key: 'nextweek', label: '下周一 09:00', due: nextWeekday(now, 1) },
  ].filter((item) => item.due > now);
}

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

