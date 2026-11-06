/**
 * 分屏拖动逻辑的测试。
 *
 * 这类交互的 bug 都很"手感"：
 *   - 拖到边上突然跳一下（夹紧算错）
 *   - 拖到 100% 右栏消失，再也拖不回来
 *   - 窗口缩放后比例算出 NaN，整块布局塌掉
 *   - 知识点被压到 30px 却还在显示，看起来像渲染坏了
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPLIT_DEFAULTS, ratioFromPointer, clampRatio, splitColumns, topicFits,
} from '../packages/dsh-zhiyun-page-study/src/split-pane.js';

/** 造一个 1000px 宽、从 x=100 开始的容器。 */
const rect = (left = 100, width = 1000) => ({ left, width });

// ── ratioFromPointer ─────────────────────────────────────

test('指针在容器正中 → 0.5', () => {
  // 容器 100..1100，正中是 600
  assert.equal(ratioFromPointer(600, rect()), 0.5);
});

test('按比例换算正确', () => {
  assert.equal(ratioFromPointer(100, rect()), SPLIT_DEFAULTS.min, '最左端夹到下限');
  assert.equal(ratioFromPointer(1100, rect()), SPLIT_DEFAULTS.max, '最右端夹到上限');
  // 100 + 650 = 750 → 0.65
  assert.equal(ratioFromPointer(750, rect()), 0.65);
});

test('拖出容器外仍会被夹紧（不产生负数或 >1）', () => {
  assert.equal(ratioFromPointer(-500, rect()), SPLIT_DEFAULTS.min);
  assert.equal(ratioFromPointer(9999, rect()), SPLIT_DEFAULTS.max);
});

test('容器宽度无效时返回 null（调用方跳过这一帧）', () => {
  assert.equal(ratioFromPointer(600, { left: 0, width: 0 }), null);
  assert.equal(ratioFromPointer(600, { left: 0, width: Number.NaN }), null);
  assert.equal(ratioFromPointer(600, null), null);
  assert.equal(ratioFromPointer(Number.NaN, rect()), null);
});

// ── clampRatio ───────────────────────────────────────────

test('默认夹在 45%–72%', () => {
  assert.equal(SPLIT_DEFAULTS.min, 0.45);
  assert.equal(SPLIT_DEFAULTS.max, 0.72);
  assert.equal(clampRatio(0.1), 0.45);
  assert.equal(clampRatio(0.9), 0.72);
  assert.equal(clampRatio(0.6), 0.6);
});

test('坏输入回默认值而不是 NaN', () => {
  assert.equal(clampRatio(Number.NaN), SPLIT_DEFAULTS.ratio);
  assert.equal(clampRatio(undefined), SPLIT_DEFAULTS.ratio);
});

test('min > max 时不会算出负宽度（自己纠正顺序）', () => {
  const ratio = clampRatio(0.5, { min: 0.8, max: 0.3 });
  // 纠正后等价于 min=0.3, max=0.8
  assert.ok(ratio >= 0.3 && ratio <= 0.8, `实际 ${ratio}`);
});

// ── splitColumns ─────────────────────────────────────────

test('65% → 65fr / 35fr', () => {
  assert.equal(splitColumns(0.65), 'minmax(0, 65fr) minmax(0, 35fr)');
});

test('用 fr 不用 %（% 加 gap 会溢出）', () => {
  const value = splitColumns(0.5);
  assert.ok(value.includes('fr'), '必须是 fr');
  assert.ok(!value.includes('%'), '不能是 %');
  assert.ok(value.includes('minmax(0,'), 'minmax(0,…) 防止内容顶破容器');
});

test('不输出浮点尾巴', () => {
  const value = splitColumns(0.3333);
  assert.ok(!/\d{4,}fr/.test(value), `出现了过长的数字：${value}`);
  // 33.3 + 66.7 应恰好 100
  const nums = value.match(/[\d.]+fr/g).map((s) => parseFloat(s));
  assert.ok(Math.abs(nums[0] + nums[1] - 100) < 0.2, `两列之和应约 100，实际 ${nums}`);
});

test('splitColumns 也会夹紧', () => {
  assert.equal(splitColumns(0), splitColumns(SPLIT_DEFAULTS.min));
  assert.equal(splitColumns(5), splitColumns(SPLIT_DEFAULTS.max));
});

// ── topicFits ────────────────────────────────────────────

test('知识点低于 120px 就隐藏', () => {
  assert.equal(topicFits(119), false);
  assert.equal(topicFits(120), true, '刚好 120 应显示');
  assert.equal(topicFits(300), true);
});

test('量不到高度时不乱藏（宁可显示）', () => {
  assert.equal(topicFits(Number.NaN), true);
  assert.equal(topicFits(undefined), true);
  assert.equal(topicFits(null), true);
});

test('阈值是**像素**不是比例（小窗口上不会误判）', () => {
  // 同比例在不同窗高下表现不同，这正是为什么用像素：
  // 800px 高的窗口里 15% = 120px（刚好显示）
  assert.equal(topicFits(800 * 0.15), true);
  // 400px 高的窗口里 15% = 60px（必须隐藏）
  assert.equal(topicFits(400 * 0.15), false);
});

test('默认阈值就是 120px', () => {
  assert.equal(SPLIT_DEFAULTS.minTopicPx, 120);
});

test('默认比例是 65/35', () => {
  assert.equal(SPLIT_DEFAULTS.ratio, 0.65);
});
