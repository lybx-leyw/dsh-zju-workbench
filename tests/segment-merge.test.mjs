/**
 * 进度条分段归并的测试。
 *
 * 核心张力：**"清爽"不能变成"说谎"**。
 *   - 该并的没并 → 一堆碎方块（用户报的 bug）
 *   - 不该并的并了 → 真实空档被填平，看起来像"老师一直在讲"
 *   - 不同角色并了 → 支线的颜色信息丢失
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SEGMENT_MERGE_DEFAULTS, mergeSegments } from '../packages/dsh-zhiyun-page-study/src/segment-merge.js';

const MIN = 60_000;
/** 100 分钟的课。 */
const AXIS = 100 * MIN;

/** 造段：参数是**分钟**，转成比例。 */
const seg = (fromMin, toMin, role = 'main', summary = '') => ({
  from: fromMin / 100,
  to: toMin / 100,
  role,
  summary,
  blockIndexes: [fromMin],
});

// ── 核心：碎段被归并 ─────────────────────────────────────

test('几十个碎块被归并成少数几段（用户报的 bug）', () => {
  // 造 40 个 1 分钟的块，首尾相接 —— 这就是"每个主线都是一个框"
  const segments = Array.from({ length: 40 }, (_, i) => seg(i, i + 1));
  const merged = mergeSegments(segments, AXIS);

  assert.ok(merged.length <= 3, `40 个 1 分钟块应并成 ≤3 段，实际 ${merged.length}`);
  // 但覆盖面不能缩水：首尾必须还是 0 到 40 分钟
  assert.equal(merged[0].from, segments[0].from);
  assert.equal(merged.at(-1).to, segments.at(-1).to);
});

test('归并后段数随块数增长得很慢（清爽的关键）', () => {
  const make = (n) => Array.from({ length: n }, (_, i) => seg(i, i + 1));
  const small = mergeSegments(make(10), AXIS).length;
  const large = mergeSegments(make(100), AXIS).length;
  // 块数涨 10 倍，段数不该跟着涨 10 倍
  assert.ok(large <= small + 2, `10 块→${small} 段，100 块→${large} 段，增长过快`);
});

// ── 不该并的情况 ─────────────────────────────────────────

test('真实空档不被填平（填平等于撒谎）', () => {
  // 两段各 5 分钟，中间隔 10 分钟（老师休息）
  const segments = [seg(0, 5), seg(15, 20)];
  const merged = mergeSegments(segments, AXIS);
  assert.equal(merged.length, 2, '10 分钟空档远超 30 秒阈值，必须分开');
  assert.equal(merged[0].to, 5 / 100);
  assert.equal(merged[1].from, 15 / 100);
});

test('角色不同绝不合并（否则丢掉支线信息）', () => {
  // 主线 5 分钟 → 支线 5 分钟 → 主线 5 分钟，全都首尾相接
  const segments = [seg(0, 5, 'main'), seg(5, 10, 'branch'), seg(10, 15, 'main')];
  const merged = mergeSegments(segments, AXIS);
  assert.equal(merged.length, 3, '不同角色不能并成一段');
  assert.deepEqual(merged.map((s) => s.role), ['main', 'branch', 'main']);
});

test('间隔恰好等于阈值时仍可合并（边界含等号）', () => {
  const minSegment = SEGMENT_MERGE_DEFAULTS.minSegmentMs;
  const gap = SEGMENT_MERGE_DEFAULTS.maxGapMs;
  // 第一段做成够长的（> minSegmentMs），第二段紧邻 gap 毫秒
  const segments = [
    { from: 0, to: 5 * MIN / AXIS, role: 'main', summary: '', blockIndexes: [] },
    { from: (5 * MIN + gap) / AXIS, to: (10 * MIN + gap) / AXIS, role: 'main', summary: '', blockIndexes: [] },
  ];
  const merged = mergeSegments(segments, AXIS);
  assert.equal(merged.length, 1, `间隔等于 ${gap}ms 应可合并`);
  assert.ok(minSegment > 0);
});

test('间隔超出阈值一点点就不合并', () => {
  const gap = SEGMENT_MERGE_DEFAULTS.maxGapMs + 1000;
  const segments = [
    { from: 0, to: 5 * MIN / AXIS, role: 'main', summary: '', blockIndexes: [] },
    { from: (5 * MIN + gap) / AXIS, to: (10 * MIN + gap) / AXIS, role: 'main', summary: '', blockIndexes: [] },
  ];
  assert.equal(mergeSegments(segments, AXIS).length, 2);
});

// ── 摘要保留 ─────────────────────────────────────────────

test('合并后保留**第一段**的摘要', () => {
  const segments = [seg(0, 1, 'main', '引入'), seg(1, 2, 'main', '细节'), seg(2, 3, 'main', '例子')];
  const merged = mergeSegments(segments, AXIS);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].summary, '引入', '标签应指向这一大段的开头，不是中间');
});

test('blockIndexes 全量保留（不丢块）', () => {
  const segments = Array.from({ length: 10 }, (_, i) => ({
    ...seg(i, i + 1),
    blockIndexes: [i * 10, i * 10 + 1],
  }));
  const merged = mergeSegments(segments, AXIS);
  const total = merged.reduce((n, s) => n + s.blockIndexes.length, 0);
  assert.equal(total, 20, '合并不能丢 blockIndexes');
});

// ── 退化输入 ─────────────────────────────────────────────

test('空输入返回空数组', () => {
  assert.deepEqual(mergeSegments([], AXIS), []);
  assert.deepEqual(mergeSegments(null, AXIS), []);
});

test('没有轴长时原样返回（宁可拥挤也不要画错）', () => {
  const segments = [seg(0, 1), seg(1, 2)];
  assert.equal(mergeSegments(segments, 0).length, 2);
  assert.equal(mergeSegments(segments, Number.NaN).length, 2);
});

test('非法段被跳过，不影响其他', () => {
  const segments = [
    seg(0, 5, 'main', 'a'),
    { from: Number.NaN, to: 0.2, role: 'main' },
    { from: 0.3, to: 0.3, role: 'main' },   // 零长
    seg(60, 65, 'main', 'b'),
  ];
  const merged = mergeSegments(segments, AXIS);
  assert.equal(merged.length, 2, '只保留两个合法段');
});

test('单段输入原样返回', () => {
  const merged = mergeSegments([seg(10, 20)], AXIS);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].from, 0.1);
  assert.equal(merged[0].to, 0.2);
});

test('末尾的孤立短段并回上一个', () => {
  // 5 分钟一段 + 紧接着 10 秒的尾巴
  const segments = [
    { from: 0, to: 5 * MIN / AXIS, role: 'main', summary: '', blockIndexes: [] },
    { from: 5 * MIN / AXIS, to: (5 * MIN + 10_000) / AXIS, role: 'main', summary: '', blockIndexes: [] },
  ];
  const merged = mergeSegments(segments, AXIS);
  assert.equal(merged.length, 1, '孤立短尾应并回');
  assert.equal(merged[0].to, (5 * MIN + 10_000) / AXIS);
});

test('默认参数值符合"1.5 分钟 + 30 秒空隙"', () => {
  assert.equal(SEGMENT_MERGE_DEFAULTS.minSegmentMs, 90_000);
  assert.equal(SEGMENT_MERGE_DEFAULTS.maxGapMs, 30_000);
});
