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
import { dayKey, looksLikeSeconds } from '../packages/dsh-zhiyun-page-planning/src/time.js';

/**
 * 复刻 `client.jsx` 里 `calendar` 那段纯逻辑（JSX 里的 useMemo 解析不了，
 * 所以把规则本身固化成一份可测的实现）。
 *
 * @param rows - 候选条目（`{ id, due, source, done }`）。
 * @param now - 当前毫秒时间戳。
 * @returns `{ days, outside, undated, total }`。
 */
function buildCalendar(rows, now) {
  const dated = rows.filter((row) => {
    if (!row.due) return false;
    return !Number.isNaN(Date.parse(row.due));
  });

  const byDay = new Map();
  for (const row of dated) {
    const key = dayKey(Math.floor(Date.parse(row.due) / 1000));
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(row);
  }

  // `dayKey` 收**秒**；`now` 是毫秒。少除一次 1000 会把"今天"算到五万年后。
  const base = Date.parse(dayKey(Math.floor(now / 1000)) + 'T00:00:00+08:00');
  const days = [];
  for (let offset = -6; offset < 28; offset += 1) {
    const at = base + offset * 86400000;
    const key = dayKey(at / 1000);
    days.push({
      key,
      offset,
      rows: (byDay.get(key) ?? []).sort((a, b) => Date.parse(a.due) - Date.parse(b.due)),
    });
  }

  const outside = [...byDay.entries()]
    .filter(([key]) => !days.some((day) => day.key === key))
    .map(([key, list]) => ({ key, rows: list }));

  return { days, outside, undated: rows.filter((row) => !row.due).length, total: dated.length };
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

test('窗口是"回看 6 天 + 往后 27 天"共 34 格，含今天', () => {
  const cal = buildCalendar([], NOW);
  assert.equal(cal.days.length, 34);
  assert.equal(cal.days[0].offset, -6);
  assert.equal(cal.days.at(-1).offset, 27);
  const today = cal.days.find((day) => day.key === dayKey(NOW / 1000));
  assert.ok(today, '今天必须在窗口里');
  assert.equal(today.offset, 0);
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
  // ⚠️ 减法要在**毫秒**上做（NOW 是毫秒）。写成 `dayKey(NOW / 1000 - 6 * 86400)`
  // 会把"6 天"当成 6 秒，测出来的边界根本不在窗口边缘。
  const first = dayKey((NOW - 6 * 86400000) / 1000);
  const last = dayKey((NOW + 27 * 86400000) / 1000);
  const cal = buildCalendar([
    { id: 'edge-first', due: `${first}T00:01:00+08:00` },
    { id: 'edge-last', due: `${last}T23:59:00+08:00` },
  ], NOW);
  const inWindow = cal.days.flatMap((day) => day.rows.map((row) => row.id));
  assert.deepEqual(inWindow.sort(), ['edge-first', 'edge-last']);
  assert.equal(cal.outside.length, 0, '两端都在窗口内');
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
