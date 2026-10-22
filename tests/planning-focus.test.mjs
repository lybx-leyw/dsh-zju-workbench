/**
 * 「规划」页的**学生视角**分档与摘要。
 *
 * # 为什么单独一堆测试
 *
 * 分组是这个页面的骨架：一条 8 点截止的作业被分到「今天之内」还是「24 小时内」，
 * 决定用户今晚要不要动手。而分档是纯算术 —— 算错了不会有异常，只会安静地把
 * 最该看见的事藏到不显眼的位置。所以它必须被钉死。
 *
 * 另一件要钉的事：**勾掉的条目不该出现在任何提醒里**。摘要里的数字必须只统计
 * 未完成项，否则"我明明做完了却还提示过期"会比不提醒更烦人。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  focusOf, focusSummary, isNewArrival, FOCUS_ORDER, FOCUS_LABEL,
  atShanghai, nextWeekday, quickTimes,
} from '../packages/dsh-zhiyun-page-planning/src/time.js';

const HOUR = 3600 * 1000;
/** 固定"现在"，避免真实时间让断言漂移。 */
const NOW = Date.parse('2026-10-21T12:00:00+08:00');

/** 造一个相对 NOW 偏移的 ISO 串。 */
const at = (offsetMs) => new Date(NOW + offsetMs).toISOString();

/* ────────────────────────────── 分档 */

test('过期：只按"已经过了"判，不看差多久', () => {
  assert.equal(focusOf(at(-1), NOW), 'overdue', '差 1 毫秒也算过期');
  assert.equal(focusOf(at(-30 * 24 * HOUR), NOW), 'overdue', '过期一个月仍是过期');
});

test('24 小时内单独成档（今晚 vs 明天，学生感受完全不同）', () => {
  assert.equal(focusOf(at(1 * HOUR), NOW), 'soon', '一小时后');
  assert.equal(focusOf(at(23 * HOUR), NOW), 'soon', '明早 11 点');
  assert.equal(focusOf(at(24 * HOUR), NOW), 'soon', '正好 24 小时算边界内');
  assert.equal(focusOf(at(24 * HOUR + 1), NOW), 'today', '超过 24 小时立刻换档');
});

test('今天之内 / 一周内 / 更晚 的边界', () => {
  assert.equal(focusOf(at(25 * HOUR), NOW), 'today');
  assert.equal(focusOf(at(3 * 24 * HOUR), NOW), 'today', '3 天算 today 的上界');
  assert.equal(focusOf(at(3 * 24 * HOUR + 1), NOW), 'week');
  assert.equal(focusOf(at(7 * 24 * HOUR), NOW), 'week');
  assert.equal(focusOf(at(7 * 24 * HOUR + 1), NOW), 'later');
});

test('没有截止时间 / 非法时间 都归 none（不编造紧迫度）', () => {
  assert.equal(focusOf(null, NOW), 'none');
  assert.equal(focusOf('', NOW), 'none');
  assert.equal(focusOf(undefined, NOW), 'none');
  assert.equal(focusOf('这不是时间', NOW), 'none');
});

test('FOCUS_ORDER 把过期排在最先（最需要补救的必须最显眼）', () => {
  assert.equal(FOCUS_ORDER[0], 'overdue');
  assert.equal(FOCUS_ORDER[1], 'soon');
  // 每一档都要有标题，否则页面上会出现空标题分组
  for (const key of FOCUS_ORDER) {
    assert.equal(typeof FOCUS_LABEL[key], 'string');
    assert.ok(FOCUS_LABEL[key].length > 0, `${key} 缺标题`);
  }
});

/* ────────────────────────────── 新到的网关条目 */

test('新到：48 小时内入库的才算', () => {
  const seconds = (offsetMs) => Math.floor((NOW + offsetMs) / 1000);
  assert.equal(isNewArrival(seconds(-1 * HOUR), NOW), true, '一小时前入库');
  assert.equal(isNewArrival(seconds(-47 * HOUR), NOW), true, '47 小时前');
  assert.equal(isNewArrival(seconds(-49 * HOUR), NOW), false, '49 小时前不算新');
});

test('新到：缺失或非法的 cachedAt 一律不算（不误报）', () => {
  // 老数据没有 cachedAt，把它当"新到"会让用户看到一堆假提醒
  assert.equal(isNewArrival(undefined, NOW), false);
  assert.equal(isNewArrival(null, NOW), false);
  assert.equal(isNewArrival(0, NOW), false);
  assert.equal(isNewArrival('abc', NOW), false);
});

/* ────────────────────────────── 摘要 */

test('摘要只统计未完成项，勾掉的不进任何提醒', () => {
  const openTodos = [
    { due: at(-2 * HOUR) },   // 过期
    { due: at(2 * HOUR) },    // 24h 内
    { due: at(5 * HOUR) },    // 24h 内
    { due: at(30 * HOUR) },   // 今天之内
    { due: at(5 * 24 * HOUR) }, // 一周内（不计入摘要）
    { due: null },             // 没有时间（不计入）
  ];
  const summary = focusSummary({ openTodos, newArrivals: 3, now: NOW });

  assert.deepEqual(summary, { overdue: 1, soon: 2, today: 1, newArrivals: 3 });
});

test('摘要为空时全是 0（不是 undefined，页面直接渲染数字）', () => {
  const summary = focusSummary({ openTodos: [], newArrivals: 0, now: NOW });
  assert.deepEqual(summary, { overdue: 0, soon: 0, today: 0, newArrivals: 0 });
});

/* ────────────────────────────── 快捷时间片（像调闹钟一样） */

/**
 * 这些函数都在算"上海时区的某个时刻"。它们**不能靠宿主机时区**：
 * 开发机在 UTC 或别的时区时，`new Date().setHours(22)` 会算出北京时间 06:00。
 * 所以断言一律用**上海时区的读法**去反验。
 */

/** 把一个毫秒时间戳读成上海时区的 `YYYY-MM-DD HH:mm`。 */
function shanghaiLabel(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms)).replace(',', '');
}

test('atShanghai 定到上海时区的指定时刻，不受宿主时区影响', () => {
  const now = Date.parse('2026-10-21T12:00:00+08:00');
  assert.equal(shanghaiLabel(atShanghai(now, { hour: 18 })), '2026-10-21 18:00');
  assert.equal(shanghaiLabel(atShanghai(now, { dayOffset: 1, hour: 9 })), '2026-10-22 09:00');
  assert.equal(shanghaiLabel(atShanghai(now, { dayOffset: -1, hour: 22 })), '2026-10-20 22:00');
});

test('atShanghai 跨月跨年也对', () => {
  const endOfMonth = Date.parse('2026-10-31T12:00:00+08:00');
  assert.equal(shanghaiLabel(atShanghai(endOfMonth, { dayOffset: 1, hour: 9 })), '2026-11-01 09:00');

  const endOfYear = Date.parse('2026-12-31T12:00:00+08:00');
  assert.equal(shanghaiLabel(atShanghai(endOfYear, { dayOffset: 1, hour: 9 })), '2027-01-01 09:00');
});

test('nextWeekday：今天正好是那天时取**下**一周', () => {
  // 2026-10-21 是周三
  const wed = Date.parse('2026-10-21T12:00:00+08:00');
  assert.equal(shanghaiLabel(nextWeekday(wed, 3)), '2026-10-28 09:00', '今天周三 → 下周三');
  assert.equal(shanghaiLabel(nextWeekday(wed, 1)), '2026-10-26 09:00', '下一个周一');
  assert.equal(shanghaiLabel(nextWeekday(wed, 7)), '2026-10-25 09:00', '下一个周日');
});

test('quickTimes 只给未来的时刻（不给过去的时间让人建一条立刻过期的待办）', () => {
  for (const stamp of [
    '2026-10-21T08:00:00+08:00',
    '2026-10-21T19:00:00+08:00',
    '2026-10-21T23:30:00+08:00',   // 已过 22 点
  ]) {
    const now = Date.parse(stamp);
    for (const item of quickTimes(now)) {
      assert.ok(item.due > now, `${stamp} 下的「${item.label}」落在了过去：${shanghaiLabel(item.due)}`);
    }
  }
});

test('过了 22 点时「今晚」顺延到明晚', () => {
  const lateNight = Date.parse('2026-10-21T23:30:00+08:00');
  const tonight = quickTimes(lateNight).find((item) => item.key === 'tonight');
  assert.ok(tonight, '仍应给出一个「今晚 22:00」项');
  assert.equal(shanghaiLabel(tonight.due), '2026-10-22 22:00', '顺延到明晚，而不是给一个两小时前的时间');
});

test('quickTimes 的 key 唯一、label 非空（页面直接渲染）', () => {
  const items = quickTimes(Date.parse('2026-10-21T12:00:00+08:00'));
  const keys = items.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length, 'key 不该重复');
  for (const item of items) assert.ok(item.label.length > 0);
});
