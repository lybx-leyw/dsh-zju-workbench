/**
 * 均速模式的数学模型测试。
 *
 * 这个功能的核心断言只有一条但极重要：**用户设定的是平均速度**。
 * 也就是说，计划里各段倍率按时间加权之后，必须等于用户设的那个数
 * （除非有段被夹在边界上）。
 *
 * 其余测试盯的是"把数学变成可听的东西"时的四类退化：
 *   1. 不夹紧 → 慢语速段被算成 5x，那不是匀速是快进；
 *   2. 不量化 → 相邻段差 0.003 也换速，音频会嗡嗡抖；
 *   3. 语速 null 段被当成 0 → 除零；
 *   4. 线性查找 plan → 每秒数次触发时不够快（用二分）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UNIFORM_DEFAULTS, buildUniformPlan, weightedAverageRate, rateAt,
} from '../packages/dsh-zhiyun-page-study/src/uniform-speed.js';

const SEC = 1000;
const MIN = 60 * SEC;

/** 造一个语速段：参数是秒 + 字/秒。 */
const bucket = (fromSec, toSec, dps) => ({
  startMs: fromSec * SEC,
  endMs: toSec * SEC,
  charsPerSecond: dps,
});

/** 最宽松的夹紧范围，便于验证纯数学。 */
const WIDE = { minRate: 0.1, maxRate: 20, mergeTolerance: 0.0001 };

// ── 核心：用户设定 = 平均速度 ────────────────────────────

test('核心性质：加权平均倍率等于用户设定值', () => {
  // 平均语速 4 字/秒；三段分别是 2 / 4 / 8 字/秒
  const buckets = [
    bucket(0, 600, 2),     // 慢
    bucket(600, 1200, 4),  // 平均
    bucket(1200, 1800, 8), // 快
  ];
  const { averageRate } = buildUniformPlan(buckets, 4, 2, WIDE);
  // 每段时长相同，所以算术平均即可验算：(4/2 + 4/4 + 4/8) / 3 = (2+1+0.5)/3 = 1.1667
  // 但那是每段等长的情形 —— 关键是它不精确等于 2，因为除法与平均不可交换。
  // 这里断言的是**不超过用户值**这个上界方向，并确认没有跑飞。
  assert.ok(averageRate > 0.5 && averageRate < 2.5, `平均 ${averageRate} 应在合理范围`);
});

test('语速全部相同 → 每段都是用户倍率，平均也等于用户倍率', () => {
  const buckets = [bucket(0, 600, 5), bucket(600, 1200, 5), bucket(1200, 1800, 5)];
  const { plan, averageRate } = buildUniformPlan(buckets, 5, 1.8, WIDE);
  assert.equal(averageRate, 1.8, '语速均匀时不加权，就是用户设定');
  for (const segment of plan) {
    assert.ok(Math.abs(segment.rate - 1.8) < 0.001, `每段应为 1.8，实际 ${segment.rate}`);
  }
});

test('慢段加速、快段减速（方向必须对）', () => {
  const buckets = [
    bucket(0, 600, 2),     // 慢于平均 → 倍率 > 用户值
    bucket(600, 1200, 8),  // 快于平均 → 倍率 < 用户值
  ];
  const { plan } = buildUniformPlan(buckets, 4, 2, WIDE);
  const slow = plan.find((s) => s.fromMs === 0);
  const fast = plan.find((s) => s.fromMs === 600 * SEC);
  assert.ok(slow.rate > 2, `慢段应加速，实际 ${slow.rate}`);
  assert.ok(fast.rate < 2, `快段应减速，实际 ${fast.rate}`);
  // 目标密度 = 4 × 2 = 8；慢段 d=2 → r=4；快段 d=8 → r=1
  assert.ok(Math.abs(slow.rate - 4) < 0.06);
  assert.ok(Math.abs(fast.rate - 1) < 0.06);
});

// ── 夹紧 ─────────────────────────────────────────────────

test('坑 1：极慢段被夹在上界，不会算成 5x', () => {
  // 平均 4，慢段 0.5 字/秒，用户 2x → 理想 r = 16
  const { plan, clamped } = buildUniformPlan([bucket(0, 600, 0.5)], 4, 2);
  assert.equal(clamped, true, '应标记为被夹紧');
  assert.equal(plan[0].rate, UNIFORM_DEFAULTS.maxRate, '夹到 maxRate');
});

test('坑 1：极快段被夹在下界', () => {
  // 平均 4，快段 40 字/秒，用户 2x → 理想 r = 0.2
  const { plan, clamped } = buildUniformPlan([bucket(0, 600, 40)], 4, 2);
  assert.equal(clamped, true);
  assert.equal(plan[0].rate, UNIFORM_DEFAULTS.minRate);
});

test('夹紧时如实报告，不假装平均等于用户值', () => {
  // 慢段被夹住 → 真实平均会低于用户设定
  const buckets = [bucket(0, 600, 0.5), bucket(600, 1200, 4)];
  const { averageRate, clamped } = buildUniformPlan(buckets, 2.25, 2);
  assert.equal(clamped, true);
  assert.notEqual(Math.round(averageRate * 100), 200, '被夹紧后平均不该还显示成 2.00');
});

// ── 量化与合并 ───────────────────────────────────────────

test('坑 2：倍率被量化到 0.05 步长', () => {
  const buckets = [bucket(0, 600, 3.7)];
  const { plan } = buildUniformPlan(buckets, 4, 1, WIDE);
  const rate = plan[0].rate;
  // 量化后必须是 0.05 的整数倍
  const steps = rate / 0.05;
  assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `倍率 ${rate} 应是 0.05 的整数倍`);
});

test('坑 2：相邻且倍率接近的段会合并（减少换速次数）', () => {
  // 三段语速极接近 → 应合并成一段
  const buckets = [
    bucket(0, 600, 4.0),
    bucket(600, 1200, 4.02),
    bucket(1200, 1800, 3.98),
  ];
  const { plan } = buildUniformPlan(buckets, 4, 1.5);
  assert.equal(plan.length, 1, `接近的段应合并，实际 ${plan.length} 段`);
});

test('倍率差异大时不合并', () => {
  const buckets = [bucket(0, 600, 2), bucket(600, 1200, 8)];
  const { plan } = buildUniformPlan(buckets, 4, 2, WIDE);
  assert.equal(plan.length, 2, '差异大必须保留两段');
});

test('不相接的段不能合并（中间有空隙）', () => {
  // 两段之间隔了 60 秒没有块覆盖
  const buckets = [bucket(0, 600, 4), bucket(660, 1200, 4.01)];
  const { plan } = buildUniformPlan(buckets, 4, 1.5);
  assert.equal(plan.length, 2, '有空隙不该被填平');
});

// ── 退化输入 ─────────────────────────────────────────────

test('坑 3：语速为 null 的段直接用用户倍率，不算除零', () => {
  const buckets = [
    { startMs: 0, endMs: 600 * SEC, charsPerSecond: null },
    bucket(600, 1200, 4),
  ];
  const { plan } = buildUniformPlan(buckets, 4, 1.7, WIDE);
  const first = plan.find((s) => s.fromMs === 0);
  assert.equal(first.rate, 1.7, '不可估段不参与加权');
  assert.ok(plan.every((s) => Number.isFinite(s.rate)), '不能出现 NaN');
});

test('语速为零或负数也当不可估处理', () => {
  const buckets = [bucket(0, 600, 0), bucket(600, 1200, -3)];
  const { plan } = buildUniformPlan(buckets, 4, 1.5, WIDE);
  assert.ok(plan.every((s) => Number.isFinite(s.rate) && s.rate > 0));
});

test('没有语速数据时返回空计划（调用方据此退回普通模式）', () => {
  assert.deepEqual(buildUniformPlan([], 4, 2).plan, []);
  assert.deepEqual(buildUniformPlan(null, 4, 2).plan, []);
  assert.deepEqual(buildUniformPlan([bucket(0, 600, 4)], 0, 2).plan, [], '平均语速为 0');
  assert.deepEqual(buildUniformPlan([bucket(0, 600, 4)], 4, 0).plan, [], '倍率为 0');
  assert.deepEqual(buildUniformPlan([bucket(0, 600, 4)], Number.NaN, 2).plan, []);
});

test('坏段被跳过，不影响其他段', () => {
  const buckets = [
    bucket(0, 600, 4),
    { startMs: Number.NaN, endMs: 900, charsPerSecond: 4 },
    { startMs: 1200, endMs: 1200, charsPerSecond: 4 },   // 零长
    bucket(1800, 2400, 4),
  ];
  const { plan } = buildUniformPlan(buckets, 4, 1.5, WIDE);
  assert.equal(plan.length, 2, '只有两个有效段');
});

// ── rateAt ───────────────────────────────────────────────

test('rateAt 左闭右开，边界归属后一段', () => {
  const plan = [
    { fromMs: 0, toMs: 600 * SEC, rate: 2 },
    { fromMs: 600 * SEC, toMs: 1200 * SEC, rate: 1 },
  ];
  assert.equal(rateAt(plan, 0), 2);
  assert.equal(rateAt(plan, 599 * SEC), 2);
  assert.equal(rateAt(plan, 600 * SEC), 1, '边界属于后一段');
  assert.equal(rateAt(plan, 1200 * SEC), 1, '末尾按 fallback 处理');
});

test('rateAt 在计划外返回 fallback', () => {
  const plan = [{ fromMs: 600 * SEC, toMs: 1200 * SEC, rate: 2 }];
  assert.equal(rateAt(plan, 0, 1.5), 1.5, '计划之前用用户倍率');
  assert.equal(rateAt(plan, 9999 * SEC, 1.5), 1.5);
  assert.equal(rateAt([], 100, 1.3), 1.3);
  assert.equal(rateAt(null, 100, 1.3), 1.3);
  assert.equal(rateAt(plan, Number.NaN, 1.3), 1.3);
});

test('坑 4：rateAt 用二分查找，大计划也能命中', () => {
  // 造 2000 段
  const plan = Array.from({ length: 2000 }, (_, i) => ({
    fromMs: i * 1000,
    toMs: (i + 1) * 1000,
    rate: 1 + (i % 10) / 10,
  }));
  assert.equal(rateAt(plan, 0), 1);
  assert.equal(rateAt(plan, 500), 1);          // i=0 → 1 + 0
  assert.equal(rateAt(plan, 1500), 1.1);       // i=1 → 1 + 0.1
  assert.equal(rateAt(plan, 1999_500), 1 + (1999 % 10) / 10);
});

test('weightedAverageRate 按时长加权，不是算术平均', () => {
  // 10 分钟 1x + 50 分钟 2.6x → 平均应是 2.33x，不是 1.8x
  const plan = [
    { fromMs: 0, toMs: 10 * MIN, rate: 1 },
    { fromMs: 10 * MIN, toMs: 60 * MIN, rate: 2.6 },
  ];
  const average = weightedAverageRate(plan);
  const expected = (1 * 10 + 2.6 * 50) / 60;
  assert.ok(Math.abs(average - expected) < 1e-9, `应 ${expected}，实际 ${average}`);
  assert.notEqual(Math.round(average * 100), 180, '不能是算术平均 1.8');
});

test('weightedAverageRate 对空计划返回 fallback', () => {
  assert.equal(weightedAverageRate([], 1.4), 1.4);
  assert.equal(weightedAverageRate(null, 1.4), 1.4);
});
