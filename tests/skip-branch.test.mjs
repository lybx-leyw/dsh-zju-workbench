/**
 * 「跳过支线」判定的测试。
 *
 * 这个功能的失败形态很具体，测试就盯这几个：
 *
 *   1. **无限跳**：目标不大于当前时刻 → 写回同一个 `currentTime` → `timeupdate`
 *      再触发 → 死循环。必须返回 `null`。
 *   2. **把用户手拖的位置弹走**：判定只回答"要不要跳"，**不判断是否正在播放**；
 *      播放态由调用方把关（暂停时手拖到支线应该能看）。
 *   3. **短支线抖动**：几百毫秒的支线跳过去只会让画面抖一下。
 *   4. **`none` 被当成支线**：没标注 ≠ 不重要，跳掉等于替用户做决定。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEGMENT_ROLE, SKIP_DEFAULTS, segmentAt, skipTargetMs, branchRanges,
} from '../packages/dsh-zhiyun-page-study/src/skip-branch.js';

/** 造一段轨道：10 分钟（600_000ms），段用比例表示。 */
const AXIS = 600_000;
const seg = (fromRatio, toRatio, role, summary = '') => ({ from: fromRatio, to: toRatio, role, summary });

/** 主线 0–30%，支线 30–50%，主线 50–100%。 */
const SEGMENTS = [
  seg(0, 0.3, SEGMENT_ROLE.MAIN, '主线一'),
  seg(0.3, 0.5, SEGMENT_ROLE.BRANCH, '支线一'),
  seg(0.5, 1, SEGMENT_ROLE.MAIN, '主线二'),
];

// ── segmentAt 的边界 ─────────────────────────────────────

test('segmentAt 左闭右开：边界点只属于后一段', () => {
  // 30% = 180_000ms，正是主线一与支线一的分界
  assert.equal(segmentAt(SEGMENTS, AXIS, 179_999)?.summary, '主线一');
  assert.equal(segmentAt(SEGMENTS, AXIS, 180_000)?.summary, '支线一', '边界点属于后一段');
  assert.equal(segmentAt(SEGMENTS, AXIS, 299_999)?.summary, '支线一');
  assert.equal(segmentAt(SEGMENTS, AXIS, 300_000)?.summary, '主线二');
});

test('segmentAt 对坏输入返回 null，不抛', () => {
  assert.equal(segmentAt(null, AXIS, 1000), null);
  assert.equal(segmentAt(SEGMENTS, 0, 1000), null);
  assert.equal(segmentAt(SEGMENTS, AXIS, Number.NaN), null);
  assert.equal(segmentAt([{ from: Number.NaN, to: 1, role: 'main' }], AXIS, 1000), null);
});

// ── skipTargetMs ─────────────────────────────────────────

test('落在支线上时给支线末尾（+1ms）', () => {
  const target = skipTargetMs(SEGMENTS, AXIS, 200_000);   // 33%，在支线里
  assert.equal(target, 300_000);
});

test('落在主线上不跳', () => {
  assert.equal(skipTargetMs(SEGMENTS, AXIS, 100_000), null);
  assert.equal(skipTargetMs(SEGMENTS, AXIS, 400_000), null);
});

test('none 不等于支线 —— 没标注的片段不跳', () => {
  const withNone = [seg(0, 0.5, SEGMENT_ROLE.NONE), seg(0.5, 1, SEGMENT_ROLE.MAIN)];
  assert.equal(skipTargetMs(withNone, AXIS, 100_000), null, '替用户决定"这段不重要"是不对的');
});

test('坑 1：目标必须严格大于当前时刻，否则返回 null（防死循环）', () => {
  // 段结束点恰好等于当前时刻附近：target 不会大于 atMs
  const tiny = [seg(0.3, 0.3, SEGMENT_ROLE.BRANCH)];   // to == from，非法段
  assert.equal(skipTargetMs(tiny, AXIS, 180_000), null);

  // 已经站在支线末尾（浮点边界）：不能返回 <= atMs 的目标
  const atEnd = 300_000;
  const target = skipTargetMs(SEGMENTS, AXIS, atEnd);
  assert.equal(target, null, '300000 已是主线二，不该跳；即使跳也必须 > atMs');
});

test('坑 3：太短的支线不跳', () => {
  const axis = 600_000;
  // 支线只有 1 秒（1000ms）< minBranchMs(1500)
  const shorts = [
    seg(0, 0.3, SEGMENT_ROLE.MAIN),
    seg(0.3, 0.3 + 1000 / axis, SEGMENT_ROLE.BRANCH),
    seg(0.3 + 1000 / axis, 1, SEGMENT_ROLE.MAIN),
  ];
  // 180_600ms = 30.1%，落在 30%–30.17% 的短支线里
  assert.equal(skipTargetMs(shorts, axis, 180_600), null, '跳 1 秒只会让画面抖一下');

  // 刚好到阈值（1500ms = 0.25%）就跳
  const exact = [
    seg(0, 0.3, SEGMENT_ROLE.MAIN),
    seg(0.3, 0.3 + SKIP_DEFAULTS.minBranchMs / axis, SEGMENT_ROLE.BRANCH),
    seg(0.3 + SKIP_DEFAULTS.minBranchMs / axis, 1, SEGMENT_ROLE.MAIN),
  ];
  assert.equal(typeof skipTargetMs(exact, axis, 180_600), 'number');
});

test('minBranchMs 可覆盖', () => {
  const axis = 600_000;
  const shorts = [
    seg(0, 0.3, SEGMENT_ROLE.MAIN),
    seg(0.3, 0.3 + 1000 / axis, SEGMENT_ROLE.BRANCH),
    seg(0.3 + 1000 / axis, 1, SEGMENT_ROLE.MAIN),
  ];
  // 阈值降到 500ms，1 秒的支线就该跳；目标 = 支线末尾（比例换算有浮点误差，允许 ±1ms）
  const target = skipTargetMs(shorts, axis, 180_600, { minBranchMs: 500 });
  assert.equal(typeof target, 'number');
  assert.ok(Math.abs(target - 181_000) <= 1, '目标应约等于支线末尾 181000ms，实际 ' + target);
});

test('目标是支线末尾，且夹在轨道总长内', () => {
  const tail = [seg(0, 0.5, SEGMENT_ROLE.MAIN), seg(0.5, 1, SEGMENT_ROLE.BRANCH)];
  const target = skipTargetMs(tail, AXIS, 400_000);
  assert.equal(target, AXIS, '支线一直到结尾时跳到总长，不能超出');
  assert.ok(target <= AXIS);
});

// ── branchRanges（喂给轨道"叉掉"） ───────────────────────

test('branchRanges 只取支线，按起点升序', () => {
  const ranges = branchRanges([
    seg(0.6, 0.8, SEGMENT_ROLE.BRANCH, '后'),
    seg(0, 0.3, SEGMENT_ROLE.MAIN),
    seg(0.3, 0.5, SEGMENT_ROLE.BRANCH, '前'),
  ]);
  assert.equal(ranges.length, 2);
  assert.deepEqual(ranges.map((r) => r.summary), ['前', '后']);
});

test('branchRanges 夹紧越界、丢弃倒挂与零长段', () => {
  const ranges = branchRanges([
    seg(-0.2, 1.4, SEGMENT_ROLE.BRANCH),
    seg(0.5, 0.5, SEGMENT_ROLE.BRANCH),   // 零长
    seg(0.8, 0.2, SEGMENT_ROLE.BRANCH),   // 倒挂
  ]);
  assert.equal(ranges.length, 1);
  assert.deepEqual([ranges[0].from, ranges[0].to], [0, 1]);
});

test('branchRanges 对空/坏输入返回空数组', () => {
  assert.deepEqual(branchRanges(null), []);
  assert.deepEqual(branchRanges([]), []);
  assert.deepEqual(branchRanges([null, {}, { role: 'branch' }]), []);
});

test('没有支线时，跳播永远返回 null', () => {
  const onlyMain = [seg(0, 1, SEGMENT_ROLE.MAIN)];
  for (const at of [0, 100_000, 300_000, 599_999]) {
    assert.equal(skipTargetMs(onlyMain, AXIS, at), null);
  }
});
