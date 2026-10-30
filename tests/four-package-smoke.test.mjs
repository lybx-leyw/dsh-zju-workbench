/**
 * 四包集成冒烟：question-stream + core-tool + core-lecture-tools 能否拼成一条能跑的链。
 *
 * 只验证「接口对得上、事件流走通、工具能被调用」，不验证出题质量
 * （那需要真模型，见后续评分对照）。
 *
 * 用法：node tests/four-package-smoke.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLabeledStep } from '../packages/dsh-zhiyun-core-question-stream/src/index.js';
import { createToolRegistry, runAgenticLoop } from '../packages/dsh-zhiyun-core-tool/src/index.js';
import { createLectureTools, lectureToolSchemas } from '../packages/dsh-zhiyun-core-lecture-tools/src/index.js';

/** 最小讲义：两节，够 read_source / kb_files 用。 */
const lecture = {
  chapters: [{
    title: '随机试验',
    topics: [
      { title: '随机试验的概念与条件', blocks: [{ kind: 'paragraph', text: '随机试验需同时满足三个条件：可在相同条件下重复进行；事先已知所有可能结果的集合；单次试验前不能确定哪个结果会出现。' }] },
      { title: '样本空间的定义', blocks: [{ kind: 'paragraph', text: '样本空间是全部可能结果构成的集合，记作 Ω。' }] },
    ],
  }],
};

const EXPLORE_PROTOCOL = {
  allowed: new Set(['FINISH', 'TOOL', 'THINK']),
  terminal: new Set(['FINISH']),
  intermediate: new Set(['THINK']),
  final: new Set(['FINISH']),
  toolLabel: 'TOOL',
};

/**
 * 造 SSE 流响应。
 *
 * ⚠️ 必须用 ReadableStream，不能用自定义 async iterator：
 * wire.js 走的是 `response.body.getReader()` 那条路，只认标准 Web 流。
 * 用 async iterator 时它读不到任何数据，表现为「只收到 finish、正文全丢」——
 * 看着像 client 的 bug，其实是测试替身的形状不对。
 */
function sseResponse(chunks) {
  const text = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return {
    ok: true,
    status: 200,
    async text() { return ''; },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    }),
  };
}

const delta = content => ({ choices: [{ delta: { content }, index: 0 }] });
const finish = reason => ({ choices: [{ delta: {}, finish_reason: reason, index: 0 }] });

test('四包能拼在一起：工具注册 + schema 生成 + 工具实际执行', async () => {
  const tools = createLectureTools({ lecture });
  const names = tools.map(t => t.name);
  for (const expected of ['rag', 'kb_files', 'read_source', 'question_bank']) {
    assert.ok(names.includes(expected), `缺少工具 ${expected}`);
  }

  const registry = createToolRegistry();
  for (const tool of tools) registry.register(tool);

  const schemas = lectureToolSchemas(tools);
  assert.equal(schemas.length, tools.length);
  for (const schema of schemas) {
    assert.equal(schema.type, 'function', 'schema 必须是 OpenAI function 形状');
    assert.ok(schema.function?.name);
    assert.ok(schema.function?.parameters);
  }

  // 真的派发一次，确认 handler 与 registry 契约对得上
  const read = await registry.dispatch({ id: 'call-1', name: 'kb_files', arguments: '{}' }, {});
  assert.ok(read, 'kb_files 应当有返回');
  assert.equal(typeof read.ok, 'boolean', 'dispatch 必须返回 {ok, ...}');
});

test('question-stream 的 runLabeledStep 产出 core-tool 期望的 step 形状', async () => {
  // 假 client：question-stream 只需要 prepareCall → {stream}，
  // 不关心底下是 HTTP 还是宿主服务。生产环境这个 client 是 pool.base.llm。
  const client = {
    async prepareCall() {
      return {
        async *stream() {
          yield { type: 'text-delta', text: '``FINISH``' };
          yield { type: 'text-delta', text: '这是探索前言。' };
          yield { type: 'usage', usage: { input: 10, output: 5, total: 15 } };
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };

  const pushed = [];
  const stream = { content: t => pushed.push(t), progress: () => {}, error: () => {} };

  const step = await runLabeledStep({
    client,
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: 'hi' }],
    completionKwargs: {},
    toolSchemas: null,
    allowedLabels: ['FINISH', 'TOOL', 'THINK'],
    finalLabels: new Set(['FINISH']),
    toolLabel: 'TOOL',
    stream,
    source: 'test',
    stage: 'explore',
    iterMeta: {},
    finalMeta: { trace_kind: 'llm_chunk' },
  });

  assert.equal(step.label, 'FINISH', '应当识别出 FINISH 标签');
  assert.ok(step.text.includes('探索前言'), '正文应当被剥离标签后保留');
  assert.deepEqual(step.toolCalls, [], '这次回复没有工具调用');
  assert.ok(pushed.length > 0, 'finalMeta 非 null 时必须有推流');
});

test('端到端：循环 → 模型请求工具 → 工具执行 → 再问一次 → FINISH', async () => {
  const tools = createLectureTools({ lecture });
  const registry = createToolRegistry();
  for (const tool of tools) registry.register(tool);

  let round = 0;
  const runLabeledStepFn = async ({ finalMeta }) => {
    round += 1;
    if (round === 1) {
      return {
        label: 'TOOL',
        text: '我先看看讲义清单。',
        toolCalls: [{ id: 'c1', name: 'kb_files', arguments: '{}' }],
        reasoningContent: '', thinkingBlocks: [],
      };
    }
    // 复刻真实 runLabeledStep 的关键行为：finalMeta 非 null 才逐 chunk 推流。
    // 替身里必须实现这一条，否则测不到「streamBodyLive 方向」这个曾经写反过的地方。
    if (finalMeta !== null && finalMeta !== undefined) stream.content('探索完成。');
    return { label: 'FINISH', text: '探索完成。', toolCalls: [], reasoningContent: '', thinkingBlocks: [] };
  };

  const messages = [];
  const dispatched = [];
  const contents = [];
  const stream = { content: t => contents.push(t), progress: () => {}, error: () => {} };

  const result = await runAgenticLoop({
    initialMessages: messages,
    protocol: EXPLORE_PROTOCOL,
    runLabeledStep: runLabeledStepFn,
    stream,
    source: 'test',
    stage: 'explore',
    streamBodyLive: true,
    maxIterations: 5,
    host: {
      buildIterationTraceMeta: () => [{}, { trace_kind: 'llm_chunk' }],
      buildSimpleTraceMeta: () => ({}),
      emitFinal: async () => {},
      dispatchTools: async ({ toolCalls }) => {
        const toolMessages = [];
        for (const call of toolCalls) {
          dispatched.push(call.name);
          const outcome = await registry.dispatch(call, {});
          toolMessages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome) });
        }
        return { toolMessages, sources: [] };
      },
    },
  });

  assert.ok(dispatched.includes('kb_files'), '应当真的派发了 kb_files');
  assert.equal(round, 2, '应当两轮：先工具，后 FINISH');
  assert.ok(contents.includes('探索完成。'), 'streamBodyLive=true 时 FINISH 正文应当推流');
  assert.ok(result, '循环应当有返回');
});
