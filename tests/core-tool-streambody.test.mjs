/**
 * streamBodyLive 的推流方向 —— 上游 loop.py:257 的逐字对照。
 *
 * 这条测试存在的理由：这个 bug 不抛错、不报错，现有测试全绿也发现不了。
 * 上游语义是 `final_meta if stream_body_live else None`，而「final_meta 非 null
 * 才逐 chunk 推流」。写反的结果是 explore 阶段正文一个字都不推，用户盯着空白。
 *
 * 修过一次（2026-10-30），所以这里双向都要钉住：
 *   streamBodyLive=true  → 正文必须推，且 emitFinal 不能再补一遍（否则重复）
 *   streamBodyLive=false → 正文不能推，必须留给 emitFinal 统一发（否则裸 JSON 刷屏）
 *
 * 用法：node tests/core-tool-streambody.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgenticLoop } from '../packages/dsh-zhiyun-core-tool/src/loop.js';

const protocol = {
  allowed: new Set(['FINISH', 'TOOL', 'THINK']),
  terminal: new Set(['FINISH']),
  intermediate: new Set(['THINK']),
  final: new Set(['FINISH']),
  toolLabel: 'TOOL',
};

/** 造一个能记录推送行为的 harness。 */
function harness({ bodyText = '正文内容' } = {}) {
  const pushed = [];       // 逐 chunk 推送的内容
  const finalized = [];    // emitFinal 发出的内容
  let seenFinalMeta;

  const stream = {
    content: (text) => { pushed.push(text); },
    progress: () => {},
    error: () => {},
  };

  // 假 runLabeledStep：严格按上游语义——finalMeta 非 null 才推流。
  const runLabeledStep = async ({ finalMeta }) => {
    seenFinalMeta = finalMeta;
    if (finalMeta !== null && finalMeta !== undefined && finalMeta !== false) {
      stream.content(bodyText);
    }
    return { label: 'FINISH', text: bodyText, toolCalls: [], reasoningContent: '', thinkingBlocks: [] };
  };

  const host = {
    buildMessages: () => [],
    buildIterationTraceMeta: () => [{}, { trace_kind: 'llm_chunk' }],
    buildSimpleTraceMeta: () => ({}),
    emitFinal: async (text) => { finalized.push(text); },
  };

  return { pushed, finalized, host, stream, runLabeledStep, seen: () => seenFinalMeta };
}

const run = (streamBodyLive, h) => runAgenticLoop({
  runLabeledStep: h.runLabeledStep,
  stream: h.stream,
  source: 'src',
  stage: 'exercise',
  protocol,
  streamBodyLive,
  messages: [],
  maxIterations: 3,
  host: h.host,
});

test('streamBodyLive=true：正文必须逐 chunk 推送（explore 场景）', async () => {
  const h = harness();
  await run(true, h);
  assert.notEqual(h.seen(), null, 'streamBodyLive=true 时 finalMeta 不能是 null');
  assert.deepEqual(h.pushed, ['正文内容'], '正文应当恰好推送一次');
});

test('streamBodyLive=true：不能再用 emitFinal 补一遍（否则重复）', async () => {
  const h = harness();
  await run(true, h);
  assert.deepEqual(h.finalized, [], '正文已经推流，emitFinal 不该再发');
});

test('streamBodyLive=false：正文不能推，要留给 emitFinal（quiz 场景防裸 JSON 刷屏）', async () => {
  const h = harness({ bodyText: '{"question_type": "choice"}' });
  await run(false, h);
  assert.equal(h.seen(), null, 'streamBodyLive=false 时 finalMeta 必须是 null');
  assert.deepEqual(h.pushed, [], '缓冲态不该逐 chunk 推送裸 JSON');
  assert.deepEqual(h.finalized, ['{"question_type": "choice"}'], '缓冲态由 emitFinal 统一发');
});

test('两个方向正好互补：正文总出现次数恒为 1，不多不少', async () => {
  for (const live of [true, false]) {
    const h = harness();
    await run(live, h);
    const total = h.pushed.length + h.finalized.length;
    assert.equal(total, 1, `streamBodyLive=${live} 时正文总出现次数应为 1，实际 ${total}`);
  }
});
