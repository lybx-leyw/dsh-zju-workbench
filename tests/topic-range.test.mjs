/**
 * 知识点 → 时间区间反映射的测试。
 *
 * 这条链路的错误形态都很安静：
 *   - 空隙被算给上一个知识点 → 停顿期间也显示"正在讲 XX"
 *   - 用下一块起点当终点 → 区间首尾相接，永远查不到 null
 *   - 重叠块被两个知识点共享 → 时间轴翻倍
 *   - 没讲到的知识点混进来 → 时间戳 0 的假知识点
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TOPIC_RANGE_DEFAULTS, buildTopicRanges, topicAt, topicList,
} from '../packages/dsh-zhiyun-page-study/src/topic-range.js';

const SEC = 1000;

/** 造块：参数是 序号, 起(秒), 止(秒)。 */
const block = (index, fromSec, toSec) => ({
  index,
  startMs: fromSec * SEC,
  endMs: toSec * SEC,
});

/** 造讲义：chapters[].topics[] 带 blockIndexes。 */
const lecture = (chapters) => ({ chapters });

const ch = (title, topics, no) => ({ title, no, topics });
const tp = (title, blockIndexes) => ({ title, blockIndexes });

// ── 基本映射 ─────────────────────────────────────────────

test('知识点映射到它覆盖的块的时间跨度', () => {
  const blocks = [block(0, 0, 60), block(1, 60, 120), block(2, 120, 180)];
  const tree = lecture([ch('第一章', [
    tp('知识点甲', [0, 1]),   // 0–120 秒
    tp('知识点乙', [2]),      // 120–180 秒
  ])]);

  const { ranges } = buildTopicRanges(tree, blocks);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].title, '知识点甲');
  assert.equal(ranges[0].fromMs, 0);
  assert.equal(ranges[0].toMs, 120 * SEC, '终点取块 endMs，不是下一块起点');
  assert.equal(ranges[1].fromMs, 120 * SEC);
  assert.equal(ranges[1].toMs, 180 * SEC);
});

test('区间用每块自己的 endMs，空隙不属于任何知识点', () => {
  // 块 0 只到 50 秒，块 1 从 80 秒开始 —— 中间 30 秒空隙
  const blocks = [block(0, 0, 50), block(1, 80, 140)];
  const tree = lecture([ch('第一章', [
    tp('甲', [0]),
    tp('乙', [1]),
  ])]);

  const { ranges } = buildTopicRanges(tree, blocks);
  assert.equal(ranges[0].toMs, 50 * SEC, '甲的终点是块自己的 endMs（50s）');
  assert.equal(ranges[1].fromMs, 80 * SEC);
});

test('查空档返回 null（不拿上一个知识点顶上）', () => {
  const blocks = [block(0, 0, 50), block(1, 80, 140)];
  const tree = lecture([ch('第一章', [tp('甲', [0]), tp('乙', [1])])]);
  const { ranges } = buildTopicRanges(tree, blocks);

  assert.equal(topicAt(ranges, 0)?.title, '甲');
  assert.equal(topicAt(ranges, 49 * SEC)?.title, '甲');
  assert.equal(topicAt(ranges, 60 * SEC), null, '空隙里没有知识点');
  assert.equal(topicAt(ranges, 79 * SEC), null);
  assert.equal(topicAt(ranges, 80 * SEC)?.title, '乙');
});

test('边界左闭右开：终点时刻属于下一段', () => {
  const blocks = [block(0, 0, 60), block(1, 60, 120)];
  const tree = lecture([ch('第一章', [tp('甲', [0]), tp('乙', [1])])]);
  const { ranges } = buildTopicRanges(tree, blocks);

  assert.equal(topicAt(ranges, 60 * SEC - 1)?.title, '甲');
  assert.equal(topicAt(ranges, 60 * SEC)?.title, '乙');
});

// ── 章与序号的传递 ───────────────────────────────────────

test('区间带上章标题与序号（UI 要显示层级）', () => {
  const blocks = [block(0, 0, 60), block(1, 60, 120)];
  const tree = lecture([
    ch('第三章', [tp('甲', [0])], 3),
    ch('第四章', [tp('乙', [1])], 4),
  ]);
  const { ranges } = buildTopicRanges(tree, blocks);

  assert.equal(ranges[0].chapterTitle, '第三章');
  assert.equal(ranges[0].chapterNo, 3);
  assert.equal(ranges[1].chapterTitle, '第四章');
  assert.equal(ranges[1].chapterNo, 4);
});

// ── 重叠与跳过 ───────────────────────────────────────────

test('一块被两个知识点引用：归第一个，第二个标 overlap 且不重复算时间', () => {
  const blocks = [block(0, 0, 60), block(1, 60, 120)];
  const tree = lecture([ch('第一章', [
    tp('甲', [0, 1]),    // 占了 0 和 1
    tp('乙', [1]),       // 只有 1，已被占
  ])]);

  const { ranges, skipped } = buildTopicRanges(tree, blocks);
  assert.equal(ranges.length, 1, '乙没有独立时间，被跳过');
  assert.equal(ranges[0].title, '甲');
  assert.equal(skipped, 1);
});

test('部分重叠：第二个知识点拿到剩下的块', () => {
  const blocks = [block(0, 0, 60), block(1, 60, 120), block(2, 120, 180)];
  const tree = lecture([ch('第一章', [
    tp('甲', [0, 1]),
    tp('乙', [1, 2]),   // 1 被占，只剩 2
  ])]);

  const { ranges } = buildTopicRanges(tree, blocks);
  assert.equal(ranges.length, 2);
  assert.deepEqual(ranges[1].blockIndexes, [2]);
  assert.equal(ranges[1].fromMs, 120 * SEC);
});

test('本次课没讲到的知识点被跳过（blockIndexes 为空）', () => {
  const blocks = [block(0, 0, 60)];
  const tree = lecture([ch('第一章', [
    tp('讲到了', [0]),
    tp('没讲到', []),
  ])]);

  const { ranges, skipped, topicCount } = buildTopicRanges(tree, blocks);
  assert.equal(ranges.length, 1);
  assert.equal(skipped, 1);
  assert.equal(topicCount, 2, '总数仍统计全部知识点');
});

test('块序号不存在的引用被忽略', () => {
  const blocks = [block(0, 0, 60)];
  const tree = lecture([ch('第一章', [tp('甲', [0, 999])])]);
  const { ranges } = buildTopicRanges(tree, blocks);
  assert.equal(ranges.length, 1);
  assert.deepEqual(ranges[0].blockIndexes, [0], '不存在的序号被过滤');
});

// ── 合并 ─────────────────────────────────────────────────

test('默认不合并：首尾相接的知识点必须分开', () => {
  // 甲只到 59s，乙从 60s 开始 —— 空隙 1 秒。
  // 即使这么小的空隙，默认（mergeGapMs = 0）也不合并：知识点是用户要看的层级。
  const blocks = [block(0, 0, 59), block(1, 60, 120)];
  const tree = lecture([ch('第一章', [tp('甲', [0]), tp('乙', [1])])]);
  const { ranges } = buildTopicRanges(tree, blocks);

  assert.equal(ranges.length, 2, '默认阈值 0：两个知识点必须分开');
  assert.equal(ranges[0].title, '甲');
  assert.equal(ranges[1].title, '乙');
});

test('显式给正阈值时才合并', () => {
  const blocks = [block(0, 0, 59), block(1, 60, 120)];
  const tree = lecture([ch('第一章', [tp('甲', [0]), tp('乙', [1])])]);
  const { ranges } = buildTopicRanges(tree, blocks, { mergeGapMs: 2000 });

  assert.equal(ranges.length, 1, '给了 2 秒阈值才合并');
  assert.equal(ranges[0].title, '甲', '保留第一个知识点的标题');
  assert.equal(ranges[0].toMs, 120 * SEC);
});

test('跨章不合并（哪怕时间紧邻）', () => {
  const blocks = [block(0, 0, 60), block(1, 60, 120)];
  const tree = lecture([
    ch('第三章', [tp('甲', [0])], 3),
    ch('第四章', [tp('乙', [1])], 4),
  ]);
  const { ranges } = buildTopicRanges(tree, blocks);
  assert.equal(ranges.length, 2, '不同章必须分段');
});

// ── 退化输入 ─────────────────────────────────────────────

test('没有讲义或没有块时返回空', () => {
  assert.deepEqual(buildTopicRanges(null, [block(0, 0, 60)]).ranges, []);
  assert.deepEqual(buildTopicRanges(lecture([]), [block(0, 0, 60)]).ranges, []);
  assert.deepEqual(buildTopicRanges(lecture([ch('x', [tp('a', [0])])]), null).ranges, []);
  assert.deepEqual(buildTopicRanges(lecture([ch('x', [tp('a', [0])])]), []).ranges, []);
});

test('块缺 startMs 被跳过，不影响其他', () => {
  const blocks = [
    { index: 0, startMs: Number.NaN, endMs: 1000 },
    block(1, 60, 120),
  ];
  const tree = lecture([ch('第一章', [tp('甲', [0]), tp('乙', [1])])]);
  const { ranges } = buildTopicRanges(tree, blocks);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].title, '乙');
});

test('endMs 缺失时退化成点区间，不产生负长度', () => {
  const blocks = [{ index: 0, startMs: 10 * SEC }];
  const tree = lecture([ch('第一章', [tp('甲', [0])])]);
  const { ranges } = buildTopicRanges(tree, blocks);
  assert.equal(ranges[0].fromMs, 10 * SEC);
  assert.ok(ranges[0].toMs >= ranges[0].fromMs, '终点不能早于起点');
});

test('topicAt 对空表与坏输入返回 null', () => {
  assert.equal(topicAt([], 1000), null);
  assert.equal(topicAt(null, 1000), null);
  assert.equal(topicAt([{ fromMs: 0, toMs: 1000, title: 'x' }], Number.NaN), null);
});

// ── topicList ────────────────────────────────────────────

test('topicList 只保留有标题的，按时间顺序', () => {
  const ranges = [
    { fromMs: 0, toMs: 100, title: '甲', chapterTitle: '一' },
    { fromMs: 100, toMs: 200, title: '', chapterTitle: '一' },
    { fromMs: 200, toMs: 300, title: '丙', chapterTitle: '二' },
  ];
  const list = topicList(ranges);
  assert.equal(list.length, 2, '无名知识点不进列表');
  assert.deepEqual(list.map((item) => item.title), ['甲', '丙']);
});

test('topicList 对坏输入返回空数组', () => {
  assert.deepEqual(topicList(null), []);
  assert.deepEqual(topicList([]), []);
});

test('默认合并阈值为 0（不合并）', () => {
  // 为什么默认 0：块与块首尾相接时空隙**恰好是 0**，任何正阈值都会把
  // 整节课的知识点合并成一段 —— 那就毁掉了这个功能的意义。
  assert.equal(TOPIC_RANGE_DEFAULTS.mergeGapMs, 0);
});
