/**
 * 知识点轨道的测试。
 *
 * 失败形态：
 *   1. 空档时整条轨道消失 → 用户看不到"接下来是什么"
 *   2. 空档时把"下一个"标成"现在" → 用户以为老师已经在讲了
 *   3. 折叠计数算错 → 「还有 N 个」显示成负数或永远 0
 *   4. 跳转目标落在上一段（左闭右开 + 浮点误差）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRACK_DEFAULTS, buildTrack, currentState, seekTargetMs, stateLabel, trackNote,
} from '../packages/dsh-zhiyun-page-study/src/topic-track.js';

const SEC = 1000;
const MIN = 60 * SEC;

/** 造区间：参数是 秒范围 + 标题。 */
const range = (fromSec, toSec, title, chapterTitle = '') => ({
  fromMs: fromSec * SEC,
  toMs: toSec * SEC,
  title,
  chapterTitle,
});

/** 10 个知识点，每个 10 分钟，第 6 分钟到第 7 分钟之间留 1 分钟空档。 */
const RANGES = [
  range(0, 600, '甲'),        // 0–10 min
  range(600, 1200, '乙'),
  range(1260, 1800, '丙'),    // 中间 1200–1260 是空档
  range(1800, 2400, '丁'),
  range(2400, 3000, '戊'),
  range(3000, 3600, '己'),
  range(3600, 4200, '庚'),
  range(4200, 4800, '辛'),
  range(4800, 5400, '壬'),
  range(5400, 6000, '癸'),
];

// ── 基本轨道 ─────────────────────────────────────────────

test('在第一个知识点里：前面没有可折叠的，后面显示 3 个', () => {
  const track = buildTrack(RANGES, 60 * SEC);
  assert.equal(track.currentIndex, 0);
  assert.equal(track.beforeHidden, 0);
  assert.equal(track.items.length, 1 + TRACK_DEFAULTS.after, '只有当前 + 后面 3 个');
  assert.equal(track.items[0].state, 'current');
  assert.deepEqual(track.items.slice(1).map((i) => i.state), ['next', 'next', 'next']);
  assert.equal(track.afterHidden, 10 - 4);
});

test('在中间：前后各显示若干', () => {
  // 3060 秒落在「己」（3000–3600），它是第 6 个，索引 5
  const track = buildTrack(RANGES, 3000 * SEC + 60 * SEC);
  assert.equal(track.currentIndex, 5);
  assert.equal(track.items.length, TRACK_DEFAULTS.before + 1 + TRACK_DEFAULTS.after);
  assert.equal(track.beforeHidden, 5 - TRACK_DEFAULTS.before);
  assert.equal(track.afterHidden, 10 - 1 - 5 - TRACK_DEFAULTS.after);
});

test('在最后一个：后面没有可折叠的', () => {
  const track = buildTrack(RANGES, 5500 * SEC);
  assert.equal(track.currentIndex, 9);
  assert.equal(track.afterHidden, 0);
  assert.equal(track.items.at(-1).state, 'current');
});

// ── 空档 ─────────────────────────────────────────────────

test('坑 1：空档里轨道不消失，而是指向下一个知识点', () => {
  // 1200–1260 秒是空档（乙结束后、丙开始前）
  const track = buildTrack(RANGES, 1230 * SEC);
  assert.ok(track.items.length > 0, '轨道必须仍然可见');
  assert.equal(track.currentIndex, 2, '指向下一个（丙）');
  assert.equal(track.items.find((i) => i.state === 'current')?.title, '丙');
});

test('坑 2：currentState 能区分"真的在这段里"与"还没开始"', () => {
  assert.equal(currentState(RANGES, 60 * SEC), 'inside', '甲里面');
  assert.equal(currentState(RANGES, 1230 * SEC), 'gap', '上一段讲完、下一段没开始 —— 是 gap');
  assert.equal(currentState(RANGES, 9999 * SEC), 'after', '全讲完了');
});

test('开头之前的空档：指向第一个', () => {
  const shifted = RANGES.map((r) => ({ ...r, fromMs: r.fromMs + 120 * SEC, toMs: r.toMs + 120 * SEC }));
  const track = buildTrack(shifted, 10 * SEC);
  assert.equal(track.currentIndex, 0);
});

// ── 折叠计数 ─────────────────────────────────────────────

test('坑 3：折叠计数不会是负数', () => {
  for (const at of [0, 500 * SEC, 3000 * SEC, 5999 * SEC, 9999 * SEC]) {
    const track = buildTrack(RANGES, at * SEC);
    assert.ok(track.beforeHidden >= 0, `beforeHidden 在 ${at}s 为负`);
    assert.ok(track.afterHidden >= 0, `afterHidden 在 ${at}s 为负`);
  }
});

test('折叠计数之和 + 可见数 = 总数', () => {
  for (const at of [0, 500, 3000, 5500]) {
    const track = buildTrack(RANGES, at * SEC);
    assert.equal(
      track.beforeHidden + track.items.length + track.afterHidden,
      track.total,
      `在 ${at}s 处总账不平`,
    );
  }
});

test('before/after 可覆盖（右栏高度不同）', () => {
  const track = buildTrack(RANGES, 3000 * SEC, { before: 1, after: 1 });
  assert.equal(track.items.length, 3, '前 1 + 当前 + 后 1');
});

// ── 跳转 ─────────────────────────────────────────────────

test('坑 4：跳转到起点 + 余量，避免落在上一段', () => {
  // 丙从 1260 秒开始；直接落 1260 时左闭右开应该属于丙，
  // 但浮点误差可能让它落在乙的末尾。+300ms 更稳。
  const target = seekTargetMs(RANGES[2]);
  assert.equal(target, 1260 * SEC + 300);
});

test('跳转目标不会是负数', () => {
  assert.equal(seekTargetMs({ fromMs: 0 }), 300);
  assert.equal(seekTargetMs({ fromMs: -5000 }), 0);
});

test('跳转目标对坏输入返回 null', () => {
  assert.equal(seekTargetMs(null), null);
  assert.equal(seekTargetMs({}), null);
  assert.equal(seekTargetMs({ fromMs: Number.NaN }), null);
});

// ── 退化输入 ─────────────────────────────────────────────

test('空列表不崩', () => {
  const track = buildTrack([], 1000);
  assert.deepEqual(track.items, []);
  assert.equal(track.currentIndex, -1);
  assert.equal(track.total, 0);
});

test('坏时间不崩，停在最后一个', () => {
  const track = buildTrack(RANGES, Number.NaN);
  assert.equal(track.currentIndex, 9);
  assert.ok(track.items.length > 0);
});

test('currentState 对空表与坏输入返回 null', () => {
  assert.equal(currentState([], 1000), null);
  assert.equal(currentState(null, 1000), null);
  assert.equal(currentState(RANGES, Number.NaN), null);
});

// ── 标签 ─────────────────────────────────────────────────

test('状态标签是中文且覆盖三种状态', () => {
  assert.equal(stateLabel('past'), '已讲');
  assert.equal(stateLabel('current'), '现在');
  assert.equal(stateLabel('next'), '接下来');
  assert.equal(stateLabel('unknown'), '');
});

test('默认显示 前 2 后 3（"要去哪"比"从哪来"更重要）', () => {
  assert.equal(TRACK_DEFAULTS.before, 2);
  assert.equal(TRACK_DEFAULTS.after, 3);
  assert.ok(TRACK_DEFAULTS.after > TRACK_DEFAULTS.before);
});

test('trackNote 为空档/首尾各给人话说明', () => {
  // 空档：当前节点标着「现在」，但老师其实还没讲到它 —— 必须有一句话澄清，
  // 否则用户会以为已经开始讲了。
  assert.match(trackNote('gap'), /还没开始/);
  assert.match(trackNote('before'), /还没讲到第一个/);
  assert.match(trackNote('after'), /都讲完了/);
  assert.equal(trackNote('inside'), '');
  assert.equal(trackNote(undefined), '');
});

test('回归：中间空档不会被误判成"全部讲完"', () => {
  // 这条是 currentState 的原始 bug：只写了 inside/before/after 三态，
  // 中间空档（上一段结束、下一段没开始）被归成 after。
  const phase = currentState(RANGES, 1230 * SEC);
  assert.equal(phase, 'gap');
  assert.notEqual(phase, 'after', '不能显示"都讲完了" —— 后面还有 8 个知识点');
  // 真的讲完了才是 after
  assert.equal(currentState(RANGES, 9999 * SEC), 'after');
});
