/**
 * 三态契约与离线探针的测试。
 *
 * 重点不在「happy path 能跑」，而在**那些容易静默撒谎的地方**：
 *
 *   1. `located_only` 不许偷偷带 `offsetMs`（带了调用方就会直接用）；
 *   2. `validateResult` 必须挡住「matched 但 offset 是 NaN」这类半成品；
 *   3. `indexAt` 的语义必须是「最后一条起点不晚于 t」—— 不是「最近的一条」；
 *   4. 探针在锚点不足时必须说 `inconclusive`，**不许**给一个看起来很确定的结论。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALIGNMENT_STATE, REFUSAL,
  matched, locatedOnly, refused, validateResult,
  indexAt, resolveAt,
} from '../packages/dsh-zhiyun-core-playback/src/alignment.js';
import {
  probeDelta, findPageTurnCues, suggestAnchors, tagSuspicion, PROBE_DEFAULTS,
} from '../packages/dsh-zhiyun-core-playback/src/probe.js';

// ── 三态契约 ─────────────────────────────────────────────

test('matched 需要有限 offset；NaN 直接抛，而不是产出坏结果', () => {
  const ok = matched(1200, { score: 0.9 });
  assert.equal(ok.state, ALIGNMENT_STATE.MATCHED);
  assert.equal(ok.offsetMs, 1200);
  assert.equal(ok.evidence.score, 0.9);
  assert.ok(Object.isFrozen(ok), '结果应冻结，防止下游就地改成"看起来对"的值');

  assert.throws(() => matched(Number.NaN), TypeError);
  assert.throws(() => matched(undefined), TypeError);
  assert.throws(() => matched(Infinity), TypeError);
});

test('located_only 必须给 locatedAt，且不得携带 offsetMs', () => {
  const result = locatedOnly(
    { text: '电荷信号再根据后面的', score: 0.88 },
    { text: '它的秩是三' },
  );
  assert.equal(result.state, ALIGNMENT_STATE.LOCATED_ONLY);
  assert.equal(result.offsetMs, undefined, '定位到时绝不能顺手给一个 offset');
  assert.equal(result.locatedAt.text, '电荷信号再根据后面的');
  assert.equal(result.awaiting.text, '它的秩是三');

  assert.throws(() => locatedOnly(null), TypeError, '没有定位结果就该用 refused');
});

test('refused 需要非空 reason；内置原因用常量而非自由字符串', () => {
  const result = refused(REFUSAL.AMBIGUOUS);
  assert.equal(result.state, ALIGNMENT_STATE.REFUSED);
  assert.equal(result.reason, 'ambiguous');
  assert.throws(() => refused(''), TypeError);
  assert.throws(() => refused(null), TypeError);
});

test('validateResult 挡住三种"看起来能跑"的坏结果', () => {
  assert.equal(validateResult(matched(0)), null);

  // 1. matched 但 offset 是 NaN —— 最重要的一条：它会让下游算出全 NaN 的行号
  const brokenMatched = { state: ALIGNMENT_STATE.MATCHED, offsetMs: Number.NaN };
  assert.match(validateResult(brokenMatched), /offsetMs/);

  // 2. located_only 夹带 offsetMs —— 调用方会顺手应用一个未经验证的数
  const leaky = {
    state: ALIGNMENT_STATE.LOCATED_ONLY,
    locatedAt: { text: 'x' },
    offsetMs: 300,
  };
  assert.match(validateResult(leaky), /不得携带 offsetMs/);

  // 3. 未知 state
  assert.match(validateResult({ state: 'maybe' }), /未知 state/);
  assert.match(validateResult(null), /必须是对象/);
});

test('三种状态的 validateResult 全绿（穷尽）', () => {
  const all = [matched(1500), locatedOnly({ text: 'x' }), refused(REFUSAL.NO_SIMILAR_TEXT)];
  assert.deepEqual(all.map((item) => validateResult(item)), [null, null, null]);
  // state 常量本身也覆盖齐了
  assert.deepEqual(Object.values(ALIGNMENT_STATE).sort(), ['located_only', 'matched', 'refused']);
});

// ── 投影 ─────────────────────────────────────────────────

const lines = [
  { startMs: 0, text: '第一句' },
  { startMs: 10_000, text: '第二句' },
  { startMs: 20_000, text: '第三句' },
];

test('indexAt 取「最后一条起点不晚于 t」，不是「最近的一条」', () => {
  // 这条语义是 video-panel 文件头故意定的：跳到 10:00 要看到 10:00 正在讲的那句，
  // 不是 10:05 的下一句。写成"最近的一条"会让字幕看起来永远领先一句。
  assert.equal(indexAt(lines, 0), 0);
  assert.equal(indexAt(lines, 9_999), 0);
  assert.equal(indexAt(lines, 10_000), 1);
  assert.equal(indexAt(lines, 14_999), 1, '离 20s 更近，但仍应是第二条');
  assert.equal(indexAt(lines, 20_000), 2);
  assert.equal(indexAt(lines, 99_999), 2, '越过末条就停在末条');
});

test('indexAt 在第一条之前给 -1（"还没开始"），不硬套第 0 条', () => {
  assert.equal(indexAt(lines, -1), -1);
  assert.equal(indexAt([], 1000), -1);
  assert.equal(indexAt(null, 1000), -1);
  assert.equal(indexAt(lines, Number.NaN), -1);
});

test('resolveAt 的偏移加在轴（查表时刻）上，符号为正即"字幕显得滞后"', () => {
  // offset = +3000：字幕时间戳超前 3 秒 → 要看到正确的那句，得往大方向找。
  const late = resolveAt(lines, 7_000, 3_000);
  assert.equal(late.axisMs, 10_000);
  assert.equal(late.index, 1, '滞后 3 秒时，7 秒处应显示 10 秒那条');
  assert.equal(late.item.text, '第二句');

  // 反向：offset = -3000，7 秒处相当于轴上的 4 秒
  const early = resolveAt(lines, 7_000, -3_000);
  assert.equal(early.axisMs, 4_000);
  assert.equal(early.index, 0);

  // 缺省与非法值都退化为 0，不抛 —— 投影层要能在数据脏的时候继续画
  assert.equal(resolveAt(lines, 12_000).index, 1);
  assert.equal(resolveAt(lines, 12_000, Number.NaN).axisMs, 12_000);
  assert.equal(resolveAt(lines, Number.NaN).axisMs, 0);
});

test('resolveAt 早于第一条时 item 为 null，不返回 lines[0]', () => {
  const result = resolveAt(lines, 0, -5_000);
  assert.equal(result.index, -1);
  assert.equal(result.item, null, '还没开始就不该有"当前这一句"');
});

// ── 离线探针 ─────────────────────────────────────────────

/** 造一组锚点：每条 slideSec 处，对应的字幕时间戳是 slideSec*1000 + delta。 */
const anchorsWith = (deltaMs, count = PROBE_DEFAULTS.minAnchors) =>
  Array.from({ length: count }, (_, index) => ({
    slideSec: 100 * (index + 1),
    subtitleMs: 100 * (index + 1) * 1000 + deltaMs,
    label: `第 ${index + 1} 个锚点`,
  }));

test('锚点不足时给 inconclusive，**不给**一个看起来很确定的结论', () => {
  // 3 个点连直线必然完美拟合 —— 这就是必须留第四态的理由。
  const result = probeDelta(anchorsWith(2000, 3));
  assert.equal(result.verdict, 'inconclusive');
  assert.equal(result.reason, 'too_few_anchors');
  assert.equal(result.anchors, 3);
  assert.equal(result.required, PROBE_DEFAULTS.minAnchors);
  assert.match(result.message, /不足以判断/);
  assert.equal(result.medianMs, undefined, '没有结论时不该给出中位数，免得被当成结论用');
});

test('Δ 在容差内为 0 → verdict none（本功能不必做）', () => {
  const result = probeDelta(anchorsWith(200));
  assert.equal(result.verdict, 'none');
  assert.equal(result.medianMs, 200);
  assert.match(result.message, /不必做/);
});

test('Δ 稳定非零 → constant（一次全局偏移即可，不需要语音校准）', () => {
  const result = probeDelta(anchorsWith(2400));
  assert.equal(result.verdict, 'constant');
  assert.equal(result.medianMs, 2400);
  assert.equal(result.spreadMs, 0);
  assert.match(result.message, /不需要语音校准/);
});

test('Δ 单调漂移 → drift（单一偏移会越到后面越不准）', () => {
  const anchors = Array.from({ length: 6 }, (_, index) => ({
    slideSec: 300 * (index + 1),
    subtitleMs: 300 * (index + 1) * 1000 + index * 1200,
  }));
  const result = probeDelta(anchors);
  assert.equal(result.verdict, 'drift');
  assert.equal(result.endToEndMs, 6000, '首尾差 5×1200');
  assert.match(result.message, /分段锚点/);
});

test('Δ 既不稳定也不单调 → inconclusive（可能是锚点标错）', () => {
  const deltas = [0, 5000, 300, 6000, 200];
  const anchors = deltas.map((delta, index) => ({
    slideSec: 200 * (index + 1),
    subtitleMs: 200 * (index + 1) * 1000 + delta,
  }));
  const result = probeDelta(anchors);
  assert.equal(result.verdict, 'inconclusive');
  assert.equal(result.reason, 'unstable');
  assert.match(result.message, /复核锚点/);
});

test('探针跳过坏锚点，但坏到没剩几个时仍是 inconclusive', () => {
  const withJunk = [
    ...anchorsWith(1000),
    { slideSec: Number.NaN, subtitleMs: 5000 },
    { slideSec: 900, subtitleMs: undefined },
  ];
  assert.equal(probeDelta(withJunk).verdict, 'constant', '坏锚点不参与，但好锚点够用');

  const mostlyJunk = [{ slideSec: null, subtitleMs: 1 }, { slideSec: 2, subtitleMs: Number.NaN }];
  assert.equal(probeDelta(mostlyJunk).verdict, 'inconclusive');
  assert.equal(probeDelta(null).reason, 'invalid_input');
});

test('锚点先按课程推进排序，Δ 的"漂移"才有意义', () => {
  // 故意倒序给：排序后应仍判出 drift
  const anchors = Array.from({ length: 6 }, (_, index) => ({
    slideSec: 300 * (index + 1),
    subtitleMs: 300 * (index + 1) * 1000 + index * 1200,
  })).reverse();
  const result = probeDelta(anchors);
  assert.equal(result.verdict, 'drift');
  assert.deepEqual(result.deltas, [0, 1200, 2400, 3600, 4800, 6000], 'deltas 应按时间顺序');
});

// ── 换页话识别与建议锚点 ─────────────────────────────────

test('findPageTurnCues 只认指向"下一页/下面这张"的说法，不认回看', () => {
  const cues = findPageTurnCues([
    { startMs: 1000, text: '我们看下一页' },
    { startMs: 2000, text: '这个公式怎么来的' },
    { startMs: 3000, text: '下面这张图说明什么' },
    { startMs: 4000, text: '我们回到刚才那页' },
  ]);
  assert.equal(cues.length, 2, '回看那句不算锚点');
  assert.deepEqual(cues.map((cue) => cue.startMs), [1000, 3000]);
  assert.equal(findPageTurnCues(null).length, 0);
});

test('suggestAnchors 的产出带 confidence: hint —— 是提示不是锚点', () => {
  const slides = [
    { page: 1, createdSec: 0 },
    { page: 2, createdSec: 62 },
    { page: 3, createdSec: 130 },
  ];
  const subtitles = [
    { startMs: 61_000, text: '我们看下一页' },
    { startMs: 129_500, text: '下面这张' },
  ];
  const hints = suggestAnchors(slides, subtitles);
  assert.equal(hints.length, 2);
  // 换页必须发生在话之后、8 秒内
  assert.equal(hints[0].slideSec, 62);
  assert.equal(hints[1].slideSec, 130);
  for (const hint of hints) {
    assert.equal(hint.confidence, 'hint', '自动配对只是提示，人工确认后才能进 probeDelta');
  }
});

test('suggestAnchors 丢掉"话说完很久才翻页"的配对', () => {
  const slides = [{ page: 1, createdSec: 0 }, { page: 2, createdSec: 100 }];
  const subtitles = [{ startMs: 61_000, text: '我们看下一页' }];
  // 61s 说"看下一页"，但 100s 才换页 → 39 秒，超过 8 秒容差，不配对
  assert.deepEqual(suggestAnchors(slides, subtitles), []);
});

// ── 诊断不得悄悄变成修正 ─────────────────────────────────

test('tagSuspicion 只标记，不改 startMs', () => {
  const tagged = tagSuspicion(lines, 3000);
  assert.equal(tagged.length, 3);
  assert.equal(tagged[0].startMs, 0, '诊断结果不得覆盖原时间戳');
  assert.equal(tagged[0].suspicion.offsetMs, 3000);
  assert.match(tagged[0].suspicion.note, /仅供诊断/);

  // 偏移在容差内就不标记，避免满屏噪音
  const quiet = tagSuspicion(lines, 100);
  assert.equal(quiet[0].suspicion, undefined);
  assert.deepEqual(tagSuspicion(null, 5000), []);
});
