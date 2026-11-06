/**
 * 字幕轨的契约测试。
 *
 * 重点在**真实数据里出现过的那些坑**：
 *
 *   1. 一节课 915 条原始碎片（"行。""是。""嗯。"）必须**优先让位**给清洗后的句子；
 *   2. 清洗句子可能存在，也可能不存在 —— 两条路都要能走，且必须**如实标出来**；
 *   3. 最后一条跨 39.7 分钟的尾噪条（`{6965000, 9345000, '对。'}`）不能抢高亮、
 *      不能进时间轴，但**不能删**（删了等于篡改数据）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRACK_KIND, resolveTrack, buildCues, activeIndex, burnLine, speechBands,
  isTailNoise, noiseStats,
} from '../packages/dsh-zhiyun-core-playback/src/transcript.js';

// ── 碎片合并（真实截图里的形状） ─────────────────────────
//
// 2026-10-28 的实际截图：右栏标着「清洗后」，内容却是
//   00:17 嗯，三，第二个。嗯，对。行行行。嗯嗯嗯嗯，你就可以。
//   00:26 不行，说。你说那个情况下，都高速还是还对的。这个，这。
//   00:28 哎。
// 因为 core-parser 的 sentences 是**逐行纠错**（rawLines.map），不合并。

test('buildCues 把相邻碎片合并成一句', () => {
  const cues = buildCues([
    { startMs: 17_000, endMs: 19_000, text: '嗯，三，第二个。', state: 'matched' },
    { startMs: 19_000, endMs: 21_000, text: '嗯，对。', state: 'matched' },
    { startMs: 21_000, endMs: 23_000, text: '行行行。', state: 'matched' },
    { startMs: 23_000, endMs: 26_000, text: '嗯嗯嗯嗯，你就可以。', state: 'matched' },
  ]);
  // 第一条以句号收尾且够长 → 不并；后面三条并起来
  assert.ok(cues.length < 4, '应该发生合并');
  assert.ok(cues.every((cue) => cue.text.length <= 34), '合并后不能超长');
  // 首尾时间必须覆盖原区间，不能因为合并把时间弄丢
  assert.equal(cues[0].startMs, 17_000);
  assert.equal(cues.at(-1).endMs, 26_000);
});

test('buildCues 不跨大停顿合并（0.8 秒以上算两句）', () => {
  const cues = buildCues([
    { startMs: 0, endMs: 5_000, text: '第一句话。', state: 'matched' },
    { startMs: 9_000, endMs: 12_000, text: '第二句话。', state: 'matched' },
  ]);
  assert.equal(cues.length, 2, '停顿 4 秒是两句话，并起来会读错语气');
});

test('buildCues 不合并时间不可信的条目', () => {
  const cues = buildCues([
    { startMs: 0, endMs: 5_000, text: '正常一句。', state: 'matched' },
    { startMs: 5_000, endMs: 9_000, text: '时间不可信的一句。', state: 'located_only' },
    { startMs: 9_000, endMs: 12_000, text: '又一正常句。', state: 'matched' },
  ]);
  // located_only 自成一条，既不吸收别人也不被吸收
  const located = cues.filter((cue) => cue.state === 'located_only');
  assert.equal(located.length, 1);
  assert.equal(located[0].text, '时间不可信的一句。');
});

test('buildCues 短尾回并，且只并一次（不能一路吞到开头）', () => {
  const cues = buildCues([
    { startMs: 0, endMs: 5_000, text: '这是一句正常长度的话。', state: 'matched' },
    { startMs: 5_000, endMs: 8_000, text: '又一句正常的话。', state: 'matched' },
    { startMs: 8_000, endMs: 9_000, text: '嗯。', state: 'matched' },
  ]);
  assert.equal(cues.length, 2, '末尾的"嗯。"应该并回上一条');
  assert.ok(cues.at(-1).text.endsWith('嗯。'));
});

test('buildCues 单条超长不合并', () => {
  const long = '这是一句已经很长很长很长很长很长很长的话。';   // 23 字
  const cues = buildCues([
    { startMs: 0, endMs: 5_000, text: long, state: 'matched' },
    { startMs: 5_000, endMs: 9_000, text: long, state: 'matched' },
  ]);
  assert.equal(cues.length, 2, '两条 23 字并起来 46 字，超过 34 字上限');
});

test('buildCues 空输入与坏输入不崩', () => {
  assert.deepEqual(buildCues([]), []);
  assert.deepEqual(buildCues(null), []);
  assert.deepEqual(buildCues([{ text: '' }]), [], '空文本跳过');
});

test('resolveTrack 的产物已经合并过（这是截图上那个 bug 的修复）', () => {
  const sentences = [
    { startMs: 17_000, endMs: 19_000, text: '嗯，三，第二个。' },
    { startMs: 19_000, endMs: 21_000, text: '嗯，对。' },
    { startMs: 21_000, endMs: 23_000, text: '行行行。' },
    { startMs: 23_000, endMs: 26_000, text: '嗯嗯嗯嗯，你就可以。' },
  ];
  const track = resolveTrack(sentences, []);
  assert.equal(track.kind, TRACK_KIND.CLEANED);
  assert.ok(track.lines.length < sentences.length, '标着"清洗后"就必须真的合并过');
});

// ── 真实数据的形状 ───────────────────────────────────────

/** 真实一节课的原始碎片开头（course 86582 / sub 1979657）。 */
const rawFragments = [
  { startMs: 5_000, endMs: 24_000, text: '行。' },
  { startMs: 24_000, endMs: 34_000, text: '是。' },
  { startMs: 34_000, endMs: 56_000, text: '嗯。' },
  { startMs: 56_000, endMs: 82_000, text: '是嗯。' },
];

/** 同一节课清洗后的句子（core-parser 的产出形状）。 */
const cleanedSentences = [
  { startMs: 5_000, endMs: 24_000, text: '行，那我们开始讲今天的内容。' },
  { startMs: 24_000, endMs: 82_000, text: '这节课主要讨论二叉堆的合并操作。' },
];

// ── 轨的选择 ─────────────────────────────────────────────

test('有清洗句子就用清洗句子 —— 顺序不能反', () => {
  const track = resolveTrack(cleanedSentences, rawFragments);
  assert.equal(track.kind, TRACK_KIND.CLEANED);
  assert.equal(track.lines.length, 2);
  assert.equal(track.lines[0].text, '行，那我们开始讲今天的内容。');
  // 原始碎片里那四条"行。""是。""嗯。""是嗯。"不能出现在结果里
  assert.ok(!track.lines.some((line) => line.text === '嗯。'), '碎片不该混进清洗轨');
});

test('没有清洗句子就退回原始碎片，并**如实说明**是哪一条轨', () => {
  const track = resolveTrack(undefined, rawFragments);
  assert.equal(track.kind, TRACK_KIND.RAW);
  assert.equal(track.reason, 'no-sentences');
  // 碎片会被 buildCues 合并（这里末尾两条短碎片并成了一条），
  // 所以条数少于输入条数 —— 但"这不是清洗结果"这件事由 kind 表达。
  assert.ok(track.lines.length <= rawFragments.length, '可以合并，但不能凭空变多');
  assert.ok(track.lines.every((line) => line.state === 'matched'));
  assert.ok(track.kind === TRACK_KIND.RAW, '合并过也仍然是原始碎片，不能标成清洗后');
});

test('空终稿（解析跑了但没产出句子）也退回原始碎片', () => {
  const track = resolveTrack([], rawFragments);
  assert.equal(track.kind, TRACK_KIND.RAW, '空数组不该被当成"有清洗结果"');
});

test('两边都空时给空轨，不崩', () => {
  const track = resolveTrack(undefined, undefined);
  assert.equal(track.kind, TRACK_KIND.RAW);
  assert.deepEqual(track.lines, []);
  assert.equal(track.reason, 'empty');
});

test('清洗句子时间不可用时降级为 located_only，但**文字保留**', () => {
  // parser.js 拆句时会插值；插值失败的句子没有有效时间，但文字是清洗成果，不能丢
  const track = resolveTrack([
    { startMs: 5_000, endMs: 24_000, text: '有时间的句子。' },
    { startMs: null, endMs: null, text: '没时间的句子，但文字还在。' },
  ], rawFragments);
  assert.equal(track.kind, TRACK_KIND.CLEANED);
  assert.equal(track.lines.length, 2, '时间不可用不等于删除');
  assert.equal(track.lines[1].state, 'located_only');
  assert.equal(track.lines[1].text, '没时间的句子，但文字还在。');
});

// ── 尾噪条 ───────────────────────────────────────────────

test('真实那条跨 39.7 分钟的尾巴被判为尾噪', () => {
  // course 86582 / sub 1979657 的最后一条：6965s → 9345s，内容"对。"
  const tail = { startMs: 6_965_000, endMs: 9_345_000, text: '对。' };
  const normal = { startMs: 6_000, endMs: 20_000, text: '正常的一句。' };
  assert.equal(isTailNoise(tail), true);
  assert.equal(isTailNoise(normal), false);
});

test('尾噪条降级而不删除 —— 它仍然出现在字幕列表里', () => {
  const lines = [
    ...rawFragments,
    { startMs: 6_965_000, endMs: 9_345_000, text: '对。' },
  ];
  const track = resolveTrack(undefined, lines);
  const tail = track.lines.at(-1);
  assert.equal(track.lines.length, 5, '尾噪条不能被删掉');
  assert.equal(tail.text, '对。');
  assert.equal(tail.state, 'located_only', '但要降级：不参与高亮');
  assert.equal(tail.noisy, true);
});

test('尾噪条不抢高亮 —— 播到 8000 秒时不该高亮那条"对。"', () => {
  const lines = resolveTrack(undefined, [
    ...rawFragments,
    { startMs: 6_965_000, endMs: 9_345_000, text: '对。' },
  ]).lines;
  // 8000 秒落在尾噪条区间内，但它不该成为"正在讲的这一句"
  const index = activeIndex(lines, 8_000_000);
  assert.equal(lines[index]?.text, '是嗯。', '应停在最后一条正常字幕上');
});

test('中位数用中位数不用均值 —— 一条离群值不该拉垮判定基数', () => {
  const stats = noiseStats([
    { startMs: 0, endMs: 10_000 },       // 10s
    { startMs: 10_000, endMs: 20_000 },  // 10s
    { startMs: 20_000, endMs: 30_000 },  // 10s
    { startMs: 30_000, endMs: 2_400_000 }, // 39.5 分钟离群值
  ]);
  assert.equal(stats.medianDurationMs, 10_000, '均值会被拉到 600 秒，中位数不受影响');
});

test('长但合理的条目不算尾噪（宁可漏，不误杀）', () => {
  // 5 分钟内的一整段独白是可能的，不该被当成噪声
  assert.equal(isTailNoise({ startMs: 0, endMs: 240_000 }), false);
  // 但 6 分钟就超过默认安全线
  assert.equal(isTailNoise({ startMs: 0, endMs: 360_000 }), true);
});

// ── 烧进播放器 ───────────────────────────────────────────

test('burnLine 在第一条之前是 hidden，而不是显示第一条', () => {
  const lines = resolveTrack(cleanedSentences, rawFragments).lines;
  const burn = burnLine(lines, 1_000);   // 1 秒，早于第一条的 5 秒
  assert.equal(burn.hidden, true);
  assert.equal(burn.line, null, '提前显示会剧透，也让"还没开始"看起来像"已经讲到"');
  assert.equal(burn.index, -1);
});

test('burnLine 取当时正在讲的那一句', () => {
  const lines = resolveTrack(cleanedSentences, rawFragments).lines;
  assert.equal(burnLine(lines, 10_000).line.text, '行，那我们开始讲今天的内容。');
  assert.equal(burnLine(lines, 30_000).line.text, '这节课主要讨论二叉堆的合并操作。');
});

test('句子说完、下一句没开始时继续挂着上一句，并标出 gap', () => {
  const lines = [
    { startMs: 0, endMs: 10_000, text: '第一句。', state: 'matched' },
    { startMs: 20_000, endMs: 30_000, text: '第二句。', state: 'matched' },
  ];
  const gap = burnLine(lines, 15_000);   // 10–20 秒之间是空档
  assert.equal(gap.line.text, '第一句。', '空档期闪成空白会让用户以为字幕坏了');
  assert.equal(gap.leadMs, 5_000, '距离下一句还有 5 秒');
  assert.equal(gap.hidden, false);

  const speaking = burnLine(lines, 5_000);
  assert.equal(speaking.leadMs, null, '正在讲的时候没有 lead');
});

test('burnLine 支持偏移，且符号与 alignment.js 一致', () => {
  const lines = [{ startMs: 10_000, endMs: 20_000, text: 'x', state: 'matched' }];
  // 正偏移 = 字幕显得滞后，要往大方向找
  assert.equal(burnLine(lines, 7_000, 3_000).line?.text, 'x');
  assert.equal(burnLine(lines, 7_000, 0).hidden, true);
});

// ── 说话带 ───────────────────────────────────────────────

test('speechBands 把句子划成 0–1 比例，并合并相邻同状态段', () => {
  const lines = [
    { startMs: 0, endMs: 10_000, state: 'matched' },
    { startMs: 10_000, endMs: 20_000, state: 'matched' },   // 与上一条相接 → 合并
    { startMs: 40_000, endMs: 50_000, state: 'matched' },   // 中间空档 20 秒
  ];
  const bands = speechBands(lines, 100_000);   // 横轴 100 秒
  assert.equal(bands.length, 2, '相接的两段应合并成一段');
  assert.equal(bands[0].from, 0);
  assert.equal(bands[0].to, 0.2);
  assert.equal(bands[1].from, 0.4);
  assert.equal(bands[1].to, 0.5);
});

test('speechBands 夹紧越界、忽略无效轴', () => {
  const lines = [{ startMs: 0, endMs: 200_000, state: 'matched' }];
  const bands = speechBands(lines, 100_000);   // 句子超出横轴
  assert.equal(bands[0].to, 1, '越界夹到 1，不能溢出条外');
  assert.deepEqual(speechBands(lines, 0), []);
  assert.deepEqual(speechBands(lines, Number.NaN), []);
  assert.deepEqual(speechBands(null, 1000), []);
});

test('speechBands 保留 located_only 状态（尾噪段画淡）', () => {
  const lines = [
    { startMs: 0, endMs: 10_000, state: 'matched' },
    { startMs: 10_000, endMs: 50_000, state: 'located_only', noisy: true },
  ];
  const bands = speechBands(lines, 100_000);
  assert.equal(bands.length, 2, '不同状态不能合并');
  assert.equal(bands[1].state, 'located_only');
  assert.equal(bands[1].noisy, true);
});
