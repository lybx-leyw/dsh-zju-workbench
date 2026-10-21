/**
 * 日历视图的**分格逻辑**。
 *
 * 日历是纯呈现，但它有一个容易错的地方：**哪些条目不进日历**。这条规则背后是
 * 一个产品承诺 —— 不给用户编造他没写过的截止时间。所以这里钉三件事：
 *
 *   1. 没有 `due` 的条目**绝不**出现在任何格子里；
 *   2. 有 `due` 的按**上海时区**归日（与列表视图的 `dayKey` 同一口径）；
 *   3. 窗口外的日期不丢，单独报出来。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, looksLikeSeconds, buildWeekCalendar } from '../packages/dsh-zhiyun-page-planning/src/time.js';

/**
 * 与页面**共用**同一份实现（`time.js` 的 `buildWeekCalendar`）。
 *
 * 这里曾经复刻了 `client.jsx` 里的那段逻辑（"JSX 里的 useMemo 解析不了"），
 * 结果就是：页面按周对齐了，这份测试还在断言"连续 34 格" —— 两边各写一份
 * 就一定会漂，而这次改周历恰好就漂了。所以删掉复刻，直接调共享实现。
 *
 * 返回形状做了一层适配（`days` 展平），让既有的断言（归日口径、排序、
 * 窗口外不丢、单位护栏）原样有效，不必重写。
 */
function buildCalendar(rows, now) {
  const result = buildWeekCalendar(rows, { now });
  return {
    days: result.weeks.flatMap((week) => week.days),
    weeks: result.weeks,
    outside: result.outside,
    undated: result.undated,
    total: result.total,
  };
}

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
  const all = cal.days.flatMap((day) => day.rows.map((row) => row.id));
  assert.deepEqual(all, ['d'], '只有带 due 的那条进格子');
  assert.equal(cal.undated, 3, '没日期的三条要单独报出来');
});

test('坏日期串同样不进格子（不是"猜一个最近的日期"）', () => {
  const cal = buildCalendar([
    { id: 'bad', due: '不是日期' },
    { id: 'ok', due: '2026-10-20T15:59:00.000Z' },
  ], NOW);
  const all = cal.days.flatMap((day) => day.rows.map((row) => row.id));
  assert.deepEqual(all, ['ok']);
});

/* ────────────────────────────────────── 归日口径 */

test('按上海时区归日：UTC 与上海跨日的那几小时不能落错格', () => {
  // 北京时间 2026-10-20 01:00 == UTC 2026-10-19 17:00。
  // 用 UTC 归日会落进 10-19，而用户在上海，那天是 10-20。
  const cal = buildCalendar([{ id: 'late-night', due: '2026-10-19T17:00:00.000Z' }], NOW);
  const cell = cal.days.find((day) => day.rows.length > 0);
  assert.equal(cell.key, '2026-10-20', '北京时间的凌晨属于第二天（上海口径）');
});

test('同一天的多条按时刻先后排', () => {
  const cal = buildCalendar([
    { id: '晚', due: '2026-10-21T23:00:00+08:00' },
    { id: '早', due: '2026-10-21T09:00:00+08:00' },
    { id: '中', due: '2026-10-21T15:00:00+08:00' },
  ], NOW);
  const cell = cal.days.find((day) => day.key === '2026-10-21');
  assert.deepEqual(cell.rows.map((row) => row.id), ['早', '中', '晚']);
});

/* ────────────────────────────────────── 窗口 */

test('窗口按周对齐：6 周、每周 7 格，第一格是周一', () => {
  const cal = buildCalendar([], NOW);
  assert.equal(cal.weeks.length, 6, '回看一周 + 本周 + 往后四周');
  for (const week of cal.weeks) assert.equal(week.days.length, 7, '每周正好 7 格');

  // 每一周的第一天必须是周一（dayKey 到上海时区，2026-10-12 是周一）
  assert.equal(cal.weeks[0].days[0].key, '2026-10-12', '第一周从上周一开始');
  assert.equal(cal.weeks[1].days[0].key, '2026-10-19', '本周从周一 10-19 开始');
  const today = cal.days.find((day) => day.key === dayKey(NOW / 1000));
  assert.ok(today, '今天必须在窗口里');
  assert.equal(today.isToday, true);
});

test('窗口外的日期不丢，单独报出来', () => {
  const cal = buildCalendar([
    { id: '远未来', due: '2027-03-01T12:00:00+08:00' },
    { id: '很久以前', due: '2025-01-01T12:00:00+08:00' },
    { id: '窗口内', due: '2026-10-20T12:00:00+08:00' },
  ], NOW);
  const inWindow = cal.days.flatMap((day) => day.rows.map((row) => row.id));
  assert.deepEqual(inWindow, ['窗口内']);
  const outIds = cal.outside.flatMap((group) => group.rows.map((row) => row.id)).sort();
  assert.deepEqual(outIds, ['很久以前', '远未来'], '窗口外的要能被看到，不能静默消失');
});

test('每一天的格子都存在（空格子也画，因为"这天没安排"是信息）', () => {
  const cal = buildCalendar([], NOW);
  for (const day of cal.days) assert.deepEqual(day.rows, [], '没有安排的日子也要有格子');
});

/* ────────────────────────────────────── 边界日期 */

test('窗口两端正好落在边界上的条目要算进窗口', () => {
  // 窗口：从本周一往前一周开始，往后 5 周。两端要用**周界**算，不是 ±6/27 天。
  const cal = buildCalendar([], NOW);
  const first = cal.weeks[0].days[0].key;
  const last = cal.weeks.at(-1).days.at(-1).key;
  const withEdges = buildCalendar([
    { id: 'edge-first', due: `${first}T00:01:00+08:00` },
    { id: 'edge-last', due: `${last}T23:59:00+08:00` },
  ], NOW);
  const inWindow = withEdges.days.flatMap((day) => day.rows.map((row) => row.id));
  assert.deepEqual(inWindow.sort(), ['edge-first', 'edge-last']);
  assert.equal(withEdges.outside.length, 0, '两端都在窗口内');
});

test('周日的条目落在同一周的最后一格，不是下一周的第一格', () => {
  // 2026-10-25 是周日（本周是 10-19 ~ 10-25）。按周对齐后它必须还在本周的末尾。
  const cal = buildCalendar([{ id: 'sunday', due: '2026-10-25T15:00:00+08:00' }], NOW);
  const week = cal.weeks.find((w) => w.days.some((day) => day.key === '2026-10-19'));
  assert.ok(week, '本周的格子要存在');
  assert.equal(week.days[6].key, '2026-10-25', '最后一格是周日');
  assert.equal(week.days[6].rows[0]?.id, 'sunday', '周日的事落在本周末尾');
});

/* ────────────────────────────────────── 单位护栏 */

test('dayKey 收的是秒：喂毫秒会算到五万年后（这条错误真的发生过）', () => {
  const ms = NOW;
  // 正确的用法
  assert.equal(dayKey(ms / 1000), '2026-10-19');
  // 错误用法不会抛错，只会算出荒唐的结果 —— 所以必须有护栏能识别
  const wrong = dayKey(ms);
  assert.notEqual(wrong, '2026-10-19', '喂毫秒不该得到正确日期');
  assert.match(wrong, /^[0-9]{5}/, '会算到一个五位数年份');

  // 护栏本身：秒级时间戳的年代合理，毫秒级不合理
  assert.equal(looksLikeSeconds(ms / 1000), true, '秒级应被认作合理');
  assert.equal(looksLikeSeconds(ms), false, '毫秒级应被拦下');
  assert.equal(looksLikeSeconds(NaN), false);
  assert.equal(looksLikeSeconds(undefined), false);
  // 边界：2000 年之前 / 2100 年之后都算不合理（这一页只服务于当下）
  assert.equal(looksLikeSeconds(Date.parse('1999-01-01T00:00:00Z') / 1000), false);
  assert.equal(looksLikeSeconds(Date.parse('2101-01-01T00:00:00Z') / 1000), false);
});
