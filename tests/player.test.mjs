/**
 * 播放统计的契约测试。
 *
 * 移植自 `zhiyun-pro` 的 `lib/fusion/stats.dart`（同作者项目）。测试重点在
 * **那些"看起来对、其实在撒谎"的地方** —— 上游文件头专门用一张表列了出来，
 * 这里逐条钉住：
 *
 *   1. 不可估一律 `null`，**不是 0**（0 会被读成"老师一句话没说"）；
 *   2. 合并相邻块时用**已合并段的最后一块**算间隔（用起点会把连续讲述拆开）；
 *   3. 字符数按**码点**数（`[...s].length`），否则 emoji 的语速分母是错的；
 *   4. 越界夹到 `[0,1]`（终稿时间轴与视频总时长可能不等）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSectionStats, buildContentSegments, buildSpeedBuckets,
  countKnowledgePoints, countChars, toSeekBar, STATS_MERGE_GAP_SEC,
} from '../packages/dsh-zhiyun-player/src/stats.js';

/** 造一个块。startMs/endMs 是毫秒。 */
const block = (startSec, endSec, text, role = 'main', facets = []) => ({
  startMs: startSec * 1000,
  endMs: endSec * 1000,
  text,
  role,
  facets,
});

test('字符数按码点算，不是 UTF-16 码元', () => {
  assert.equal(countChars('abc'), 3);
  assert.equal(countChars('中文'), 2);
  // emoji 是代理对：.length 给 2，码点数是 1。语速的分母不能错。
  assert.equal(countChars('😀'), 1, 'emoji 应算一个字');
  assert.equal('😀'.length, 2, '（对照：原生 length 是 2）');
  assert.equal(countChars(''), 0);
  assert.equal(countChars(null), 0, '非字符串给 0 而不是崩');
  assert.equal(countChars(undefined), 0);
});

test('语速 = Δ文本数 ÷ Δ时间戳，单位字/秒', () => {
  const stats = computeSectionStats([
    block(0, 10, '甲'.repeat(10)),
    block(10, 20, '乙'.repeat(40)),
  ]);
  assert.equal(stats.speedBuckets.length, 1, '两块 → 一个桶（没有"相邻"就没有估计）');
  const b = stats.speedBuckets[0];
  // 第 2 块 40 字，起始差 10 秒 → 4 字/秒
  assert.equal(b.charsPerSecond, 4);
  assert.equal(b.charsPerMinute, 240);
  assert.equal(b.chars, 40);
});

test('单块不产生热力桶（没有 Δ 就不编造）', () => {
  const stats = computeSectionStats([block(0, 10, '只有一块')]);
  assert.deepEqual(stats.speedBuckets, [], '单块无桶');
  assert.equal(stats.durationMs, 0, '覆盖时长 = 首末**起点**之差；单块就是 0');
  // 覆盖时长为 0 → 平均语速不可得，给 null 而不是 0。
  // （写这条时我自己先算错过一次：以为分母是块时长 10 秒。实际分母是
  //   「首末起点之差」，单块恒为 0 —— 所以正确答案只能是 null。）
  assert.equal(stats.averageCharsPerSecond, null, '覆盖 0 秒 → null，不编造');
  assert.equal(stats.averageCharsPerMinute, null);
  assert.equal(stats.mainlineRatio, null, '同理：占比也不可得');
});

test('不可估的语速是 null，**不是 0**（这是最重要的一条）', () => {
  // 情况 1：文本数差为 0（纯过渡语 / 空块）
  const zeroChars = computeSectionStats([
    block(0, 10, '甲'.repeat(10)),
    block(10, 20, '', 'branch'), // 这一块没有正文
  ]);
  assert.equal(zeroChars.speedBuckets[0].charsPerSecond, null, '空块 → null，不是 0');
  assert.equal(zeroChars.speedBuckets[0].charsPerMinute, null);

  // 情况 2：时间戳没往前走（同一毫秒两块）
  const sameMs = computeSectionStats([
    block(5, 10, '甲'.repeat(10)),
    block(5, 10, '乙'.repeat(10)),
  ]);
  assert.equal(sameMs.speedBuckets[0].charsPerSecond, null, 'Δt=0 → null，避免 Infinity');

  // 情况 3：时间戳倒退（数据坏了）
  const backwards = computeSectionStats([
    block(20, 30, '甲'.repeat(10)),
    block(10, 20, '乙'.repeat(10)),
  ]);
  assert.equal(backwards.speedBuckets[0].charsPerSecond, null, 'Δt<0 → null，避免负语速');
});

test('热力归一用全局最大值；null 桶保持 null（不画成"最冷"）', () => {
  const stats = computeSectionStats([
    block(0, 10, '甲'.repeat(10)),          // →
    block(10, 20, '乙'.repeat(40)),         // 4 字/秒（最大）
    block(20, 30, '', 'branch'),            // null（空块）
    block(30, 40, '丙'.repeat(10)),         // 1 字/秒
  ]);
  assert.equal(stats.maxCharsPerSecond, 4, '全局最大值');

  const bar = toSeekBar(stats, 40000);
  assert.equal(bar.heat[0].heat, 1, '最大的桶归一为 1');
  assert.equal(bar.heat[1].heat, null, 'null 桶必须保持 null，不能被画成 0（最冷）');
  assert.equal(bar.heat[2].heat, 0.25, '1/4 = 0.25');
});

test('合并相邻块：角色或维度不同就断开', () => {
  const same = computeSectionStats([
    block(0, 10, '一', 'main', ['概念']),
    block(10, 20, '二', 'main', ['概念']),
  ]);
  assert.equal(same.segments.length, 1, '同角色同维度 → 合成一段');
  assert.equal(same.segments[0].blockIndexes.length, 2);

  const diffRole = computeSectionStats([
    block(0, 10, '一', 'main', ['概念']),
    block(10, 20, '二', 'branch', ['概念']),
  ]);
  assert.equal(diffRole.segments.length, 2, '角色不同必须断开（颜色不同）');

  const diffFacets = computeSectionStats([
    block(0, 10, '一', 'main', ['概念']),
    block(10, 20, '二', 'main', ['例题']),
  ]);
  assert.equal(diffFacets.segments.length, 2, '维度不同必须断开（要换标签）');
});

test('合并的间隔判据用「已合并段的最后一块」，不是段起点', () => {
  // 三块连续、每块间隔 10 秒（< 15 秒阈值）→ 应合成一段。
  // 若错用"段起点"比：第三块距第一块 20 秒 > 15 → 会被错误拆成两段。
  const stats = computeSectionStats([
    block(0, 10, '一', 'main', ['概念']),
    block(10, 20, '二', 'main', ['概念']),
    block(20, 30, '三', 'main', ['概念']),
  ]);
  assert.equal(stats.segments.length, 1, '连续三块应合成一段（这正是那个坑）');
  assert.equal(stats.segments[0].blockIndexes.length, 3);

  // 超过阈值就该断
  const gapped = computeSectionStats([
    block(0, 10, '一', 'main', ['概念']),
    block(10 + STATS_MERGE_GAP_SEC + 5, 40, '二', 'main', ['概念']),
  ]);
  assert.equal(gapped.segments.length, 2, '间隔超阈值应断开');
});

test('知识点数 = 合并后的段数，不是块数', () => {
  // ASR 把一段讲述切成三句 → 逐块数会得到虚高的 3，合并后应是 1
  const records = [
    block(0, 5, '这是一个很长的讲述的第一句', 'main', ['法则']),
    block(5, 10, '第二句继续说同一件事', 'main', ['法则']),
    block(10, 15, '第三句收尾', 'main', ['法则']),
  ];
  const stats = computeSectionStats(records);
  assert.equal(stats.records.length, 3, '块数仍是 3');
  assert.equal(stats.knowledgePointCount, 1, '知识点数应是合并后的 1');
  assert.equal(countKnowledgePoints(stats.records), 1);
});

test('汇总口径：平均语速 / 主线占比 / 例题数', () => {
  const stats = computeSectionStats([
    block(0, 10, '甲'.repeat(10), 'main', []),
    block(10, 30, '乙'.repeat(10), 'branch', ['例题']),
  ]);
  // 覆盖 0→10 秒（首末**起点**之差）= 10 秒；总字数 20 → 2 字/秒
  assert.equal(stats.durationMs, 10000);
  assert.equal(stats.totalChars, 20);
  assert.equal(stats.averageCharsPerSecond, 2);
  assert.equal(stats.averageCharsPerMinute, 120);

  // 主线时长 = 第 1 块 10 秒；覆盖 10 秒 → 占比 1
  assert.equal(stats.mainlineRatio, 1);
  assert.equal(stats.exampleCount, 1, 'facets 含「例题」的块数');
});

test('主线占比：没有覆盖时长时给 null，不是 0', () => {
  const stats = computeSectionStats([block(0, 10, '甲', 'main')]);
  assert.equal(stats.durationMs, 0);
  assert.equal(stats.mainlineRatio, null, '覆盖时长为 0 → null（0 会被读成"没有主线"）');
  assert.equal(stats.averageCharsPerSecond, null, '平均语速同理不可得');
});

test('toSeekBar：越界夹到 [0,1]，且横轴由调用方给定', () => {
  const stats = computeSectionStats([
    block(0, 10, '甲'.repeat(10)),
    block(10, 20, '乙'.repeat(10)),
  ]);
  // 故意给一个比终稿短的横轴：50% 的位置会被夹
  const bar = toSeekBar(stats, 5000);
  for (const s of bar.segments) {
    assert.ok(s.from >= 0 && s.from <= 1, `from 应在 [0,1]，实际 ${s.from}`);
    assert.ok(s.to >= 0 && s.to <= 1, `to 应在 [0,1]，实际 ${s.to}`);
  }
  assert.equal(bar.axisMs, 5000);

  // 横轴未给（0）时退化成统计时长
  const fallback = toSeekBar(stats, 0);
  assert.equal(fallback.axisMs, stats.durationMs);
});

test('toSeekBar 只回数不管颜色（颜色是主题的事）', () => {
  const stats = computeSectionStats([block(0, 10, '甲', 'main', ['概念'])]);
  const bar = toSeekBar(stats, 10000);
  assert.equal(bar.segments[0].role, 'main', '只给 role');
  assert.equal('color' in bar.segments[0], false, '不该有颜色字段');
  assert.deepEqual(bar.segments[0].facets, ['概念'], '第二维原样带出');
});

test('边界：空输入与坏块不抛异常', () => {
  for (const input of [[], null, undefined, [null, undefined, 42, {}]]) {
    const stats = computeSectionStats(input);
    assert.equal(typeof stats, 'object');
    assert.deepEqual(stats.segments, []);
    assert.deepEqual(stats.speedBuckets, []);
    assert.equal(stats.maxCharsPerSecond, 0);
  }
  // 缺 startMs 的块被丢弃（没有时间戳就无法画）
  const stats = computeSectionStats([{ text: '没有 startMs' }, block(0, 10, '有')]);
  assert.equal(stats.records.length, 1);
});

test('端到端：一节课的统计串起来是自洽的', () => {
  const blocks = [
    block(0, 60, '开场介绍这门课要讲什么。'.repeat(3), 'main', ['教学安排']),
    block(60, 180, '首先是极限的定义，注意 ε-δ 的写法。'.repeat(4), 'main', ['概念']),
    block(180, 240, '看一个例子。'.repeat(2), 'branch', ['例题']),
    block(240, 300, '回到主线，讲连续。'.repeat(3), 'main', ['法则']),
  ];
  const stats = computeSectionStats(blocks);

  assert.equal(stats.records.length, 4);
  assert.equal(stats.segments.length, 4, '四块角色/维度各不同 → 四段');
  assert.equal(stats.speedBuckets.length, 3, '四个块 → 三个相邻桶');
  assert.equal(stats.exampleCount, 1);
  assert.equal(stats.durationMs, 240000, '覆盖 0→240 秒（首末起点之差）');
  assert.ok(stats.averageCharsPerSecond > 0);
  assert.ok(stats.mainlineRatio !== null && stats.mainlineRatio > 0 && stats.mainlineRatio <= 1);

  // 每个桶要么是正数，要么是 null —— 绝不出现 0 或负数
  for (const b of stats.speedBuckets) {
    if (b.charsPerSecond !== null) assert.ok(b.charsPerSecond > 0, '有值的桶必须是正数');
  }

  const bar = toSeekBar(stats, 300000); // 视频比终稿长（有片尾）
  assert.equal(bar.axisMs, 300000);
  assert.ok(bar.segments.every((s) => s.to <= 1));
});
