/**
 * 预计看完时间的测试。
 *
 * 这个功能的所有错误都表现为"数字看起来合理但是错的"，很难靠肉眼发现。
 * 尤其这几条：
 *   1. 已播过的支线被重复扣（宣称能退回过去的时间）
 *   2. 忘了除以倍率（2 倍速下估成同样的时长）
 *   3. 倍率为 0/NaN 时算出 Infinity
 *   4. 预估精确到秒（假精度）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  remainingPlayMs, estimateRemainingMs, formatEta, formatSaved,
} from '../packages/dsh-zhiyun-page-study/src/eta.js';

/** 60 分钟的一节课。 */
const AXIS = 60 * 60_000;
const MIN = 60_000;

/** 造分段：参数是分钟。 */
const seg = (fromMin, toMin, role = 'main') => ({
  from: fromMin / 60,
  to: toMin / 60,
  role,
});

// ── remainingPlayMs ──────────────────────────────────────

test('不跳支线时，剩余就是总长减当前位置', () => {
  const r = remainingPlayMs(AXIS, 20 * MIN, [seg(10, 15, 'branch')], false);
  assert.equal(r.remainingMs, 40 * MIN);
  assert.equal(r.skippedMs, 0);
});

test('跳支线时扣掉当前位置之后的支线', () => {
  // 当前位置 0，支线 10–15 分钟（5 分钟）在之后 → 扣 5
  const r = remainingPlayMs(AXIS, 0, [seg(0, 20, 'main'), seg(20, 25, 'branch')], true);
  assert.equal(r.remainingMs, 60 * MIN - 5 * MIN);
  assert.equal(r.skippedMs, 5 * MIN);
});

test('坑 1：已经播过的支线不能重复扣', () => {
  // 当前位置 30 分钟，支线在 10–15（已播过）和 40–45（还没到）
  const segments = [seg(10, 15, 'branch'), seg(40, 45, 'branch')];
  const r = remainingPlayMs(AXIS, 30 * MIN, segments, true);
  // 剩余 30 分钟，只扣 40–45 那 5 分钟
  assert.equal(r.skippedMs, 5 * MIN, '只该扣还没播到的那段');
  assert.equal(r.remainingMs, 25 * MIN);
});

test('坑 1：跨越当前位置的支线只扣后半截', () => {
  // 支线 20–40，当前在 30 → 只剩 30–40 那 10 分钟能被跳过
  const r = remainingPlayMs(AXIS, 30 * MIN, [seg(20, 40, 'branch')], true);
  assert.equal(r.skippedMs, 10 * MIN);
  assert.equal(r.remainingMs, 30 * MIN - 10 * MIN);
});

test('主线不扣；未标注（none）也不扣', () => {
  const r = remainingPlayMs(AXIS, 0, [seg(0, 10, 'main'), seg(10, 20, 'none')], true);
  assert.equal(r.skippedMs, 0);
  assert.equal(r.remainingMs, AXIS);
});

test('站在结尾时剩余为 0，不出现负数', () => {
  const r = remainingPlayMs(AXIS, AXIS, [seg(0, 30, 'branch')], true);
  assert.equal(r.remainingMs, 0);
  assert.equal(r.skippedMs, 0, '结尾之后的支线不存在');
});

test('坏输入不产生 NaN/负值', () => {
  assert.deepEqual(remainingPlayMs(0, 0, [], true), { remainingMs: 0, skippedMs: 0 });
  assert.deepEqual(remainingPlayMs(Number.NaN, 0, [], true), { remainingMs: 0, skippedMs: 0 });
  // 位置越界 → 夹进范围
  assert.equal(remainingPlayMs(AXIS, -1000, [], false).remainingMs, AXIS);
  assert.equal(remainingPlayMs(AXIS, AXIS * 99, [], false).remainingMs, 0);
});

test('支线全片覆盖也不会算出负数', () => {
  const r = remainingPlayMs(AXIS, 0, [seg(0, 60, 'branch')], true);
  assert.equal(r.remainingMs, 0);
  assert.equal(r.skippedMs, AXIS);
});

// ── estimateRemainingMs ──────────────────────────────────

test('坑 2：必须除以倍率', () => {
  // 剩 40 分钟，2 倍速 → 实际只要 20 分钟
  const r = estimateRemainingMs(AXIS, 20 * MIN, 2, [], false);
  assert.equal(r.remainingMs, 40 * MIN);
  assert.equal(r.estimateMs, 20 * MIN, '2 倍速下 40 分钟的视频只需 20 分钟');
});

test('倍率 1 时估计等于剩余时长', () => {
  assert.equal(estimateRemainingMs(AXIS, 0, 1, [], false).estimateMs, AXIS);
});

test('0.5 倍速时时间翻倍', () => {
  const r = estimateRemainingMs(AXIS, 0, 0.5, [], false);
  assert.equal(r.estimateMs, AXIS * 2);
});

test('跳支线与倍率同时生效', () => {
  // 60 分钟课，0 位置，支线 5 分钟，2 倍速
  const r = estimateRemainingMs(AXIS, 0, 2, [seg(10, 15, 'branch')], true);
  assert.equal(r.remainingMs, 55 * MIN, '先扣支线');
  assert.equal(r.estimateMs, 27.5 * MIN, '再除以倍率');
  assert.equal(r.skippedMs, 5 * MIN);
});

test('坑 3：倍率为 0 / 负数 / NaN 时退回 1，不产生 Infinity', () => {
  for (const bad of [0, -2, Number.NaN, undefined, null]) {
    const r = estimateRemainingMs(AXIS, 0, bad, [], false);
    assert.equal(r.estimateMs, AXIS, `倍率 ${String(bad)} 应退回 1`);
    assert.ok(Number.isFinite(r.estimateMs));
  }
});

test('0.1 倍速（最慢档）时间放大十倍', () => {
  const r = estimateRemainingMs(10 * MIN, 0, 0.1, [], false);
  assert.equal(r.estimateMs, 100 * MIN);
});

test('4 倍速（最快档）时间缩到四分之一', () => {
  const r = estimateRemainingMs(40 * MIN, 0, 4, [], false);
  assert.equal(r.estimateMs, 10 * MIN);
});

// ── formatEta ────────────────────────────────────────────

test('坑 4：粗粒度，不显示秒', () => {
  assert.equal(formatEta(23 * MIN + 27_000), '23 分钟', '秒被抹掉，不留假精度');
});

test('小于 1 分钟给固定文案', () => {
  assert.equal(formatEta(0), '不到 1 分钟');
  assert.equal(formatEta(30_000), '不到 1 分钟');
  assert.equal(formatEta(-100), '不到 1 分钟');
  assert.equal(formatEta(Number.NaN), '不到 1 分钟');
});

test('超过 1 小时给"X 小时 Y 分"', () => {
  assert.equal(formatEta(83 * MIN), '1 小时 23 分');
  assert.equal(formatEta(125 * MIN), '2 小时 5 分');
});

test('整小时省掉"0 分"', () => {
  assert.equal(formatEta(120 * MIN), '2 小时');
  assert.equal(formatEta(60 * MIN), '1 小时');
});

test('59.6 分钟会进位成 1 小时（round 而非截断）', () => {
  assert.equal(formatEta(59.6 * MIN), '1 小时');
});

// ── formatSaved ──────────────────────────────────────────

test('没省到 1 分钟就不显示（避免"省 0 分钟"这种噪声）', () => {
  assert.equal(formatSaved(0), null);
  assert.equal(formatSaved(30_000), null);
  assert.equal(formatSaved(59_999), null);
  assert.equal(formatSaved(Number.NaN), null);
});

test('省下时间够长才显示', () => {
  assert.equal(formatSaved(5 * MIN), '省 5 分钟');
  assert.equal(formatSaved(75 * MIN), '省 1 小时 15 分');
});
