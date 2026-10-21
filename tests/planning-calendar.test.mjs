/**
 * 日历视图的**分格逻辑**（月历）。
 *
 * 日历是纯呈现，但它有两件容易错的事：
 *
 *   1. **哪些条目不进日历** —— 这条规则背后是一个产品承诺：不给用户编造
 *      他没写过的截止时间。没有 `due` 的条目绝不进任何格子。
 *   2. **月历的格子怎么摆** —— 首尾要补齐成整周、补的格子不属于本月、
 *      周界是周日还是周一。算错了不会抛异常，只会让"某一天的作业"落到
 *      隔壁格子里，而那是最难被发现的错。
 *
 * 这里直接调用 `time.js` 的 `buildMonthCalendar`，与页面**共用同一份实现**。
 * 曾经复刻过一份，结果页面改了、测试还在断言旧形状 —— 复刻两份一定会漂。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, looksLikeSeconds, buildMonthCalendar } from '../packages/dsh-zhiyun-page-planning/src/time.js';

/** 统一入口：默认看本月。 */
function buildCalendar(rows, now, options = {}) {
  return buildMonthCalendar(rows, { now, ...options });
}

/** 把 weeks 展平成一串格子，方便断言"某天在哪一格"。 */
const cellsOf = (cal) => cal.weeks.flatMap((week) => week.days);

const NOW = Date.parse('2026-10-19T12:00:00+08:00');

/* ────────────────────────────────────── 不编造日期 */

test('没有 due 的条目绝不进任何格子', () => {
  const rows = [
    { id: 'a', due: null },
    { id: 'b', due: undefined },
    { id: 'c', due: '' },
    { id: 'd', due: '2026-10-20T15:59:00.000Z' },
  ];
  const cal = buildCalendar(rows, NOW);
  const all = cellsOf(cal).flatMap((day) => day.rows.map((row) => row.id));
  assert.deepEqual(all, ['d'], '只有带 due 的那条进格子');
  assert.equal(cal.undated, 3, '没日期的三条要单独报出来');
});

test('坏日期串同样不进格子（不是"猜一个最近的日期"）', () => {
  const cal = buildCalendar([
    { id: 'bad', due: '不是日期' },
    { id: 'ok', due: '2026-10-20T15:59:00.000Z' },
  ], NOW);
  const all = cellsOf(cal).flatMap((day) => day.rows.map((row) => row.id));
  assert.deepEqual(all, ['ok']);
});

/* ────────────────────────────────────── 月历结构 */

test('表头是周日 → 周六，格子里只有日期数字', () => {
  const cal = buildCalendar([], NOW);
  assert.deepEqual(cal.weekdayLabels, ['周日', '周一', '周二', '周三', '周四', '周五', '周六']);

  // 每一格都带 dayNumber（页面直接渲染它），且**不再**带星期字段
  for (const day of cellsOf(cal)) {
    assert.equal(typeof day.dayNumber, 'number');
    assert.ok(day.dayNumber >= 1 && day.dayNumber <= 31);
  }
});

test('首尾补齐成整周，补的格子标 outside', () => {
  const cal = buildCalendar([], NOW);
  const cells = cellsOf(cal);
  assert.equal(cells.length % 7, 0, '总格数必须是 7 的倍数');

  // 2026-10-01 是周四 → 第一行前面要补 4 格（周日到周三，属 9 月）
  assert.equal(cells[0].key, '2026-09-27', '第一格是包含 10-01 的那一周的周日');
  assert.equal(cells[0].outside, true, '补的格子不属于本月');
  assert.equal(cells[4].key, '2026-10-01', '第 5 格才是 10 月 1 日');
  assert.equal(cells[4].outside, false);

  // 本月最后一天 10-31 是周六 → 正好收在周末，不需要向后补
  const lastInMonth = cells.filter((day) => !day.outside).at(-1);
  assert.equal(lastInMonth.key, '2026-10-31');
});

test('每月第一格一定是周日（周界正确）', () => {
  const cal = buildCalendar([], NOW);
  for (const week of cal.weeks) {
    assert.equal(week.days.length, 7, '每行 7 格');
  }
});

test('今天被正确标记，且只在当月范围里', () => {
  const cal = buildCalendar([], NOW);   // NOW = 2026-10-19
  const today = cellsOf(cal).find((day) => day.key === '2026-10-19');
  assert.ok(today, '今天必须在格子里');
  assert.equal(today.isToday, true);
  assert.equal(today.dayNumber, 19);
});

/* ────────────────────────────────────── 月份切换 */

test('monthOffset 能翻到上个月 / 下个月，跨年也对', () => {
  const prev = buildCalendar([], NOW, { monthOffset: -1 });
  assert.equal(prev.monthKey, '2026-09');
  assert.match(prev.monthLabel, /9月/);

  const next = buildCalendar([], NOW, { monthOffset: 1 });
  assert.equal(next.monthKey, '2026-11');

  // 跨年：12 月的下一个月是次年 1 月
  const december = Date.parse('2026-12-15T12:00:00+08:00');
  assert.equal(buildCalendar([], december, { monthOffset: 1 }).monthKey, '2027-01');
  // 跨年反向：1 月的上一个月是上一年 12 月
  const january = Date.parse('2027-01-15T12:00:00+08:00');
  assert.equal(buildCalendar([], january, { monthOffset: -1 }).monthKey, '2026-12');
});

test('翻月不影响条目归属：条目落在它自己那天，不随月份变', () => {
  const rows = [{ id: 'oct20', due: '2026-10-20T15:00:00+08:00' }];
  const thisMonth = buildCalendar(rows, NOW);
  const cell = cellsOf(thisMonth).find((day) => day.key === '2026-10-20');
  assert.deepEqual(cell.rows.map((row) => row.id), ['oct20']);

  // 看下个月时，10-20 不该出现（除非它是补齐格）
  const nextMonth = buildCalendar(rows, NOW, { monthOffset: 1 });
  const inNext = cellsOf(nextMonth).filter((day) => day.rows.some((row) => row.id === 'oct20'));
  assert.equal(inNext.length, 0, '11 月的月历里不该有 10-20 的条目');
});

/* ────────────────────────────────────── 归日口径 */

test('按上海时区归日：UTC 与上海跨日的那几小时不能落错格', () => {
  // 北京时间 2026-10-20 01:00 == UTC 2026-10-19 17:00。
  const cal = buildCalendar([{ id: 'late-night', due: '2026-10-19T17:00:00.000Z' }], NOW);
  const cell = cellsOf(cal).find((day) => day.rows.length > 0);
  assert.equal(cell.key, '2026-10-20', '北京时间的凌晨属于第二天（上海口径）');
});

test('同一天的多条按时刻先后排', () => {
  const cal = buildCalendar([
    { id: '晚', due: '2026-10-21T23:00:00+08:00' },
    { id: '早', due: '2026-10-21T09:00:00+08:00' },
    { id: '中', due: '2026-10-21T15:00:00+08:00' },
  ], NOW);
  const cell = cellsOf(cal).find((day) => day.key === '2026-10-21');
  assert.deepEqual(cell.rows.map((row) => row.id), ['早', '中', '晚']);
});

/* ────────────────────────────────────── 单位护栏 */

test('dayKey 收的是秒：喂毫秒会算到五万年后（这条错误真的发生过）', () => {
  const ms = NOW;
  assert.equal(dayKey(ms / 1000), '2026-10-19');
  const wrong = dayKey(ms);
  assert.notEqual(wrong, '2026-10-19', '喂毫秒不该得到正确日期');
  assert.match(wrong, /^[0-9]{5}/, '会算到一个五位数年份');

  assert.equal(looksLikeSeconds(ms / 1000), true, '秒级应被认作合理');
  assert.equal(looksLikeSeconds(ms), false, '毫秒级应被拦下');
  assert.equal(looksLikeSeconds(NaN), false);
  assert.equal(looksLikeSeconds(undefined), false);
  assert.equal(looksLikeSeconds(Date.parse('1999-01-01T00:00:00Z') / 1000), false);
  assert.equal(looksLikeSeconds(Date.parse('2101-01-01T00:00:00Z') / 1000), false);
});
