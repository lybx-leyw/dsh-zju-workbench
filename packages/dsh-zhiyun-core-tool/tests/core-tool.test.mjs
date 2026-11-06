/**
 * dsh-zhiyun-core-tool 契约测试。
 *
 * 覆盖任务书要求的四类：工具调用循环（多轮）、参数非法时的回灌、未知工具的处理、
 * 流事件顺序。全部用假工具 + 假模型步，**不真调模型**。
 *
 * 运行：node tests/core-tool.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createToolRegistry,
  createStreamBus,
  StreamEventType,
  dispatchToolCalls,
  executeToolCall,
  MAX_PARALLEL_TOOL_CALLS,
  PAUSE_LAST_TOOLS,
  runAgenticLoop,
  classifyLabel,
  findInlineLabels,
  protocolViolation,
  missingArgsMessage,
  unsatisfiedRequiredArgs,
  requiredArgs,
  toOpenAISchema,
  parameterSchema,
  parseToolArguments,
  parseToolArgumentsObject,
  buildTraceMetadata,
  deriveTraceMetadata,
  mergeTraceMetadata,
  newCallId,
  coalesceEvents,
  assistantMessageWithToolCalls,
  withTransientModelMessages,
  extendTransientModelMessages,
  validateDeepQuestionRequestConfig,
  validateCapabilityConfig,
  CapabilityPrerequisiteError,
  CapabilityCatalog,
  createUnifiedContext,
  pipelineModelCallBudget,
  TOOL_EVENT_PROJECTION,
  ToolEventProjection,
} from '../src/index.js';

// ---------------------------------------------------------------- 测试工具

/** 收集总线上的事件类型序列，做顺序断言用。 */
function recorder() {
  const bus = createStreamBus({ assignSeq: true });
  const seen = [];
  bus.onEvent((event) => {
    seen.push({
      type: event.type,
      content: event.content,
      seq: event.seq,
      call_id: event.metadata?.call_id ?? '',
      tool_name: event.metadata?.tool_name ?? '',
      call_state: event.metadata?.call_state ?? '',
      trace_kind: event.metadata?.trace_kind ?? '',
    });
  });
  return { bus, seen };
}

/** 一个会记录自己被调了几次的假工具。 */
function fakeTool(name, overrides = {}) {
  const calls = [];
  return {
    name,
    description: `${name} description`,
    parameters: [{ name: 'query', type: 'string', description: 'the query', required: true }],
    handler: async (args) => {
      calls.push(args);
      return { content: `${name}:${args.query}` };
    },
    calls,
    ...overrides,
  };
}

/** 造一次模型步的结果（runAgenticLoop 的 runLabeledStep 返回值形状）。 */
function step({ label, text = '', toolCalls = [], reasoningContent = null, thinkingBlocks = null }) {
  return { label, text, toolCalls, reasoningContent, thinkingBlocks };
}

// ---------------------------------------------------------------- 1. schema

test('parameterSchema mirrors upstream ToolParameter.to_schema field names', () => {
  // 上游：description 总是输出，即使是空串
  assert.deepEqual(parameterSchema({ name: 'q', type: 'string' }), {
    type: 'string',
    description: '',
  });
});

test('nullable expands into a two-element type array like upstream', () => {
  assert.equal(parameterSchema({ name: 'q', type: 'string', nullable: true }).type.length, 2);
  assert.deepEqual(parameterSchema({ name: 'q', type: 'string', nullable: true }).type, [
    'string',
    'null',
  ]);
  // 非 nullable 保持单值（string，不是 ["string"]）
  assert.equal(parameterSchema({ name: 'q', type: 'string' }).type, 'string');
});

test('array parameters always carry an items schema (Gemini rejects without it)', () => {
  const noItems = parameterSchema({ name: 'tags', type: 'array' });
  assert.deepEqual(noItems.items, { type: 'string' });

  const withItems = parameterSchema({
    name: 'tags',
    type: 'array',
    items: { type: 'integer' },
  });
  assert.deepEqual(withItems.items, { type: 'integer' });
});

test('numeric and length bounds are emitted verbatim', () => {
  const schema = parameterSchema({
    name: 'n',
    type: 'integer',
    minimum: 1,
    maximum: 50,
  });
  assert.equal(schema.minimum, 1);
  assert.equal(schema.maximum, 50);

  const list = parameterSchema({ name: 'l', type: 'array', minItems: 2, maxItems: 5 });
  assert.equal(list.minItems, 2);
  assert.equal(list.maxItems, 5);

  // 未设置时不写字段（不是 undefined 键）
  assert.equal('minimum' in parameterSchema({ name: 'x', type: 'number' }), false);
});

test('enum is copied, never aliased to the caller array', () => {
  const values = ['a', 'b'];
  const schema = parameterSchema({ name: 'e', type: 'string', enum: values });
  assert.deepEqual(schema.enum, ['a', 'b']);
  values.push('c');
  assert.deepEqual(schema.enum, ['a', 'b']);
});

test('toOpenAISchema matches the OpenAI function shape exactly', () => {
  const schema = toOpenAISchema({
    name: 'read_source',
    description: 'Read one source.',
    parameters: [
      { name: 'source_id', type: 'string', description: 'id' },
      { name: 'query', type: 'string', description: 'q', required: false },
    ],
  });
  assert.equal(schema.type, 'function');
  assert.deepEqual(Object.keys(schema.function).sort(), ['description', 'name', 'parameters']);
  assert.equal(schema.function.name, 'read_source');
  assert.deepEqual(schema.function.parameters, {
    type: 'object',
    properties: {
      source_id: { type: 'string', description: 'id' },
      query: { type: 'string', description: 'q' },
    },
    // 上游 to_openai_schema 的 required 只看 required 标记，**不看** default
    required: ['source_id'],
  });
});

test('a raw JSON Schema in parameters is passed through verbatim (raw_parameters wins)', () => {
  const raw = {
    type: 'object',
    properties: { arbitrary: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
    required: ['arbitrary'],
  };
  const schema = toOpenAISchema({ name: 'mcp_tool', description: 'd', parameters: raw });
  assert.deepEqual(schema.function.parameters, raw);
});

test('raw schema gets type/properties defaults when absent', () => {
  const schema = toOpenAISchema({ name: 't', description: 'd', parameters: { required: [] } });
  assert.equal(schema.function.parameters.type, 'object');
  assert.deepEqual(schema.function.parameters.properties, {});
});

// ---------------------------------------------------------------- 2. 参数守卫

test('requiredArgs excludes parameters that carry a default', () => {
  const args = requiredArgs({
    name: 't',
    description: 'd',
    parameters: [
      { name: 'a', type: 'string' }, // required defaults to true
      { name: 'b', type: 'string', required: false },
      { name: 'c', type: 'string', default: 'x' }, // has default → satisfiable
    ],
  });
  assert.deepEqual(args.map((arg) => arg.name), ['a']);
});

test('requiredArgs honours raw schema required list and skips defaults', () => {
  const args = requiredArgs({
    name: 't',
    description: 'd',
    parameters: {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string', default: 'y' } },
      required: ['a', 'b'],
    },
  });
  assert.deepEqual(args.map((arg) => arg.name), ['a']);
});

test('unsatisfiedRequiredArgs splits absent from present-but-blank', () => {
  const definition = {
    name: 't',
    description: 'd',
    parameters: [
      { name: 'absent', type: 'string' },
      { name: 'blank', type: 'string' },
      { name: 'filled', type: 'string' },
    ],
  };
  const { absent, blank } = unsatisfiedRequiredArgs(definition, { blank: '   ', filled: 'ok' });
  assert.deepEqual(absent.map((arg) => arg.name), ['absent']);
  assert.deepEqual(blank.map((arg) => arg.name), ['blank']);
});

test('explicit null counts as absent unless the property schema allows null', () => {
  const plain = {
    name: 't',
    description: 'd',
    parameters: [{ name: 'x', type: 'string' }],
  };
  assert.deepEqual(unsatisfiedRequiredArgs(plain, { x: null }).absent.map((a) => a.name), ['x']);

  const nullable = {
    name: 't',
    description: 'd',
    parameters: [{ name: 'x', type: 'string', nullable: true }],
  };
  assert.deepEqual(unsatisfiedRequiredArgs(nullable, { x: null }).absent, []);
});

test('empty collections are NOT treated as missing (a deliberate [] must run)', () => {
  const definition = {
    name: 't',
    description: 'd',
    parameters: [{ name: 'items', type: 'array' }],
  };
  const { absent, blank } = unsatisfiedRequiredArgs(definition, { items: [] });
  assert.deepEqual(absent, []);
  assert.deepEqual(blank, []);
});

test('missing args message names the argument, its shape, and warns against verbatim retry', () => {
  const message = missingArgsMessage(
    'write_note',
    [requiredArgs({ name: 't', description: 'd', parameters: [{ name: 'mode', type: 'string', enum: ['create'] }] })[0]],
  );
  assert.match(message, /`write_note` was called without its required argument/);
  assert.match(message, /`mode`/);
  assert.match(message, /one of: create/);
  assert.match(message, /will be\s+rejected again without running/);
});

test('blank wording differs from missing wording (thinking models pass "" on purpose)', () => {
  const arg = requiredArgs({ name: 't', description: 'd', parameters: [{ name: 'body', type: 'string' }] })[0];
  const blankMessage = missingArgsMessage('write_note', [], { empty: [arg] });
  const absentMessage = missingArgsMessage('write_note', [arg]);
  assert.doesNotMatch(blankMessage, /without its required argument/);
  assert.match(blankMessage, /empty value/);
  assert.match(blankMessage, /do not re-emit the same empty string/);
  assert.notEqual(blankMessage, absentMessage);
});

// ---------------------------------------------------------------- 3. 注册表契约

test('register / resolve / schemas follow the documented contract', () => {
  const registry = createToolRegistry();
  const tool = fakeTool('read_source');
  registry.register(tool);

  const resolved = registry.resolve(['read_source']);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].name, 'read_source');

  const schemas = registry.schemas(['read_source']);
  assert.equal(schemas.length, 1);
  assert.equal(schemas[0].function.name, 'read_source');
});

test('resolve skips unknown names and de-duplicates aliases onto one tool', () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('read_source'));
  // pdf 是 read_source 的别名：两个名字只能拿到一份 schema
  const resolved = registry.resolve(['read_source', 'pdf', 'no_such_tool']);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].name, 'read_source');

  const schemas = registry.schemas(['read_source', 'pdf']);
  assert.equal(schemas.length, 1);
});

test('schemas preserves the caller name order (prompt order matters)', () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('a'));
  registry.register(fakeTool('b'));
  registry.register(fakeTool('c'));
  assert.deepEqual(
    registry.schemas(['c', 'a', 'b']).map((schema) => schema.function.name),
    ['c', 'a', 'b'],
  );
});

test('schema decorator can narrow enums and forbid extra properties like the pipeline does', () => {
  const registry = createToolRegistry({
    decorateSchema: (schema) => {
      const functionSchema = schema.function;
      for (const property of Object.values(functionSchema.parameters.properties ?? {})) {
        if (property.type === 'string') property.minLength = 1;
      }
      functionSchema.parameters.additionalProperties = false;
      return schema;
    },
  });
  registry.register(fakeTool('rag'));
  const [schema] = registry.schemas(['rag']);
  assert.equal(schema.function.parameters.properties.query.minLength, 1);
  assert.equal(schema.function.parameters.additionalProperties, false);
});

test('alias defaults are applied but explicit model args win', () => {
  const registry = createToolRegistry();
  const tool = fakeTool('rag');
  registry.register(tool);

  const [canonical, args] = registry.resolveRequest('rag_hybrid', { query: 'q' });
  assert.equal(canonical, 'rag');
  assert.deepEqual(args, { mode: 'hybrid', query: 'q' });

  // 模型显式给了 mode，不能被别名默认值盖回去
  const [, overridden] = registry.resolveRequest('rag_hybrid', { mode: 'naive', query: 'q' });
  assert.equal(overridden.mode, 'naive');
});

test('deferred tools are listed separately from normal ones', () => {
  const registry = createToolRegistry();
  registry.register({ ...fakeTool('eager'), deferred: false });
  registry.register({ ...fakeTool('lazy'), deferred: true });
  assert.deepEqual(registry.deferredTools().map((tool) => tool.name), ['lazy']);
});

// ---------------------------------------------------------------- 4. dispatch 契约

test('dispatch returns {ok:true, result} on success', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));

  const outcome = await registry.dispatch({ id: 'c1', name: 'lookup', arguments: { query: 'hi' } });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.content, 'lookup:hi');
  assert.equal(outcome.result.tool, 'lookup');
});

test('dispatch accepts model-supplied raw argument strings', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));

  const outcome = await registry.dispatch({
    id: 'c1',
    name: 'lookup',
    arguments: '```json\n{"query": "from-fence"}\n```',
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.result.content, 'lookup:from-fence');
});

test('unknown tool yields ok:false with unknown_tool and the known tool list', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));

  const outcome = await registry.dispatch({ id: 'c1', name: 'does_not_exist', arguments: {} });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, 'unknown_tool');
  assert.match(outcome.error.message, /Unknown tool: does_not_exist/);
  assert.match(outcome.error.message, /do not call it again/);
  assert.deepEqual(outcome.error.known_tools, ['lookup']);
});

test('a tool that raises comes back as a readable tool message, not a thrown error', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'boom',
    description: 'd',
    parameters: [{ name: 'query', type: 'string', description: 'q' }],
    handler: async () => {
      throw new Error('disk on fire');
    },
  });

  const outcome = await registry.dispatch({ id: 'c1', name: 'boom', arguments: { query: 'x' } });
  assert.equal(outcome.ok, true, 'dispatch itself succeeds; the failure rides in the content');
  assert.match(outcome.result.content, /boom failed: disk on fire/);
});

// ---------------------------------------------------------------- 5. 非法参数回灌

test('missing required args are rejected before dispatch and fed back to the model', async () => {
  const registry = createToolRegistry();
  let ran = false;
  registry.register({
    name: 'write_note',
    description: 'd',
    parameters: [{ name: 'body', type: 'string', description: 'note body' }],
    handler: async () => {
      ran = true;
      return { content: 'ok' };
    },
  });

  const { bus, seen } = recorder();
  const outcome = await registry.dispatch(
    { id: 'c1', name: 'write_note', arguments: {} },
    { stream: bus },
  );

  assert.equal(ran, false, 'the tool must never run with missing required args');
  assert.equal(outcome.ok, true);
  assert.match(outcome.result.content, /tool call not dispatched/);
  // 回灌正文必须点名缺的参数与形状
  assert.match(outcome.result.content, /`body`/);
  assert.match(outcome.result.content, /\(string\)/);
  // 子 trace 必须收终态，不能留一行看起来还在跑
  const terminal = seen.filter((event) => event.call_state === 'error');
  assert.equal(terminal.length, 1);
  assert.equal(terminal[0].type, StreamEventType.PROGRESS);
});

test('empty string for a required arg is rejected as "empty", not "missing"', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'write_note',
    description: 'd',
    parameters: [{ name: 'body', type: 'string', description: 'note body' }],
    handler: async () => ({ content: 'should not run' }),
  });

  const outcome = await registry.dispatch({
    id: 'c1',
    name: 'write_note',
    arguments: { body: '' },
  });
  assert.match(outcome.result.content, /empty value/);
  assert.doesNotMatch(outcome.result.content, /without its required argument/);
});

test('wrong arg TYPES are not policed by the guard — they reach the tool', async () => {
  const registry = createToolRegistry();
  let received = null;
  registry.register({
    name: 'counter',
    description: 'd',
    parameters: [{ name: 'count', type: 'integer', description: 'n' }],
    handler: async (args) => {
      received = args;
      return { content: 'ran' };
    },
  });

  const outcome = await registry.dispatch({
    id: 'c1',
    name: 'counter',
    arguments: { count: 'five' },
  });
  assert.equal(outcome.result.content, 'ran');
  assert.deepEqual(received, { count: 'five' }, 'the guard coerces nothing and rejects nothing');
});

// ---------------------------------------------------------------- 6. 工具调用循环（多轮）

test('runToolLoop drives multiple rounds and stops when the model sends no tool calls', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));
  registry.register(fakeTool('read_source'));

  const rounds = [
    { text: '', toolCalls: [{ id: 'c1', name: 'lookup', arguments: { query: 'a' } }] },
    { text: '', toolCalls: [{ id: 'c2', name: 'read_source', arguments: { query: 'b' } }] },
    { text: 'final answer', toolCalls: [] },
  ];
  let calls = 0;

  const result = await registry.runToolLoop({
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
    ],
    callModel: async () => rounds[calls++],
    maxRounds: 8,
  });

  assert.equal(result.completed, true);
  assert.equal(result.rounds, 3);
  assert.equal(result.finalText, 'final answer');
  // 两轮工具调用 + 一轮收尾
  assert.equal(calls, 3);
  // 历史里 assistant/tool 必须严格配对
  const messages = result.messages;
  const assistantToolCalls = messages.filter((m) => m.role === 'assistant' && m.tool_calls);
  const toolMessages = messages.filter((m) => m.role === 'tool');
  assert.equal(assistantToolCalls.length, 2);
  assert.equal(toolMessages.length, 2);
  assert.deepEqual(
    toolMessages.map((m) => m.tool_call_id),
    ['c1', 'c2'],
  );
  assert.deepEqual(
    assistantToolCalls.map((m) => m.tool_calls[0].id),
    ['c1', 'c2'],
  );
});

test('runToolLoop surfaces a tool result back to the model as the next tool message', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));
  const seenMessages = [];

  await registry.runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    maxRounds: 4,
    callModel: async ({ messages }) => {
      seenMessages.push(messages.map((m) => `${m.role}:${m.content ?? ''}`));
      if (seenMessages.length === 1) {
        return { text: 'thinking', toolCalls: [{ id: 'c1', name: 'lookup', arguments: { query: 'x' } }] };
      }
      return { text: 'done', toolCalls: [] };
    },
  });

  const secondRound = seenMessages[1];
  assert.ok(secondRound.some((line) => line === 'tool:lookup:x'), `got ${JSON.stringify(secondRound)}`);
});

test('runToolLoop respects maxRounds and reports completed=false without forceFinalize', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));

  const result = await registry.runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    maxRounds: 3,
    callModel: async ({ round }) => ({
      text: `round-${round}`,
      toolCalls: [{ id: `c${round}`, name: 'lookup', arguments: { query: String(round) } }],
    }),
  });
  assert.equal(result.rounds, 3);
  assert.equal(result.completed, false);
});

test('runToolLoop handles the whole question-pipeline budget (10 + 2 + 9N calls)', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));

  // N = 5 题 → 预算 57 次调用；让循环跑到 20 轮仍然正常
  const budget = pipelineModelCallBudget(5);
  assert.equal(budget, 10 + 2 + 9 * 5);

  const result = await registry.runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    maxRounds: 20,
    callModel: async ({ round }) =>
      round < 19
        ? { text: '', toolCalls: [{ id: `c${round}`, name: 'lookup', arguments: { query: String(round) } }] }
        : { text: 'finished', toolCalls: [] },
  });
  assert.equal(result.completed, true);
  assert.equal(result.rounds, 20);
  assert.equal(result.finalText, 'finished');
  assert.ok(result.rounds < budget, 'a single question phase fits comfortably inside the budget');
});

test('runToolLoop honours terminate: false on pause when no resolvePause is wired', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'ask_user',
    description: 'pause',
    parameters: [{ name: 'query', type: 'string', description: 'q', required: false }],
    handler: async () => ({
      content: 'question card',
      pauseForUser: { question: 'pick one' },
    }),
  });

  const result = await registry.runToolLoop({
    messages: [{ role: 'user', content: 'go' }],
    maxRounds: 5,
    callModel: async () => ({
      text: '',
      toolCalls: [{ id: 'c1', name: 'ask_user', arguments: { query: 'q' } }],
    }),
  });
  // 没有暂停通道 = 用户不可能回答 → 结束，且 completed=false
  assert.equal(result.completed, false);
  assert.equal(result.rounds, 1);
});

// ---------------------------------------------------------------- 7. 并行调度

test('dispatchToolCalls executes a round in parallel and keeps the original tool order', async () => {
  const registry = createToolRegistry();
  const order = [];
  for (const name of ['slow', 'fast']) {
    registry.register({
      name,
      description: name,
      parameters: [{ name: 'query', type: 'string', description: 'q' }],
      handler: async () => {
        // slow 故意等更久；结果顺序仍要按请求顺序回填
        await new Promise((resolve) => setTimeout(resolve, name === 'slow' ? 20 : 1));
        order.push(name);
        return { content: `${name}-result` };
      },
    });
  }

  const { bus } = recorder();
  const outcome = await dispatchToolCalls({
    toolCalls: [
      { id: 'c1', name: 'slow', arguments: { query: 'a' } },
      { id: 'c2', name: 'fast', arguments: { query: 'b' } },
    ],
    context: { session_id: 's1' },
    stream: bus,
    source: 'quiz',
    stage: 'quizzing',
    registry,
  });

  assert.deepEqual(order, ['fast', 'slow'], 'they really ran concurrently (fast finished first)');
  assert.deepEqual(
    outcome.toolMessages.map((m) => m.content),
    ['slow-result', 'fast-result'],
    'role=tool messages follow the assistant tool_calls order, not the completion order',
  );
  assert.deepEqual(
    outcome.toolMessages.map((m) => m.tool_call_id),
    ['c1', 'c2'],
  );
});

test('a duplicate parallel call short-circuits to a stub and only the primary runs', async () => {
  const registry = createToolRegistry();
  let runs = 0;
  registry.register({
    name: 'lookup',
    description: 'd',
    parameters: [{ name: 'query', type: 'string', description: 'q' }],
    handler: async () => {
      runs += 1;
      return { content: 'real result' };
    },
  });

  const { bus } = recorder();
  const outcome = await dispatchToolCalls({
    toolCalls: [
      { id: 'c1', name: 'lookup', arguments: { query: 'same' } },
      { id: 'c2', name: 'lookup', arguments: { query: 'same' } },
    ],
    context: {},
    stream: bus,
    registry,
  });

  assert.equal(runs, 1, 'the identical second call must not execute');
  assert.equal(outcome.toolMessages.length, 2, 'every tool_call id still gets a reply');
  assert.equal(outcome.toolMessages[0].content, 'real result');
  assert.match(outcome.toolMessages[1].content, /duplicate parallel tool_call — skipped/);
  assert.match(outcome.toolMessages[1].content, /Do NOT emit two identical tool_calls/);
});

test('calls beyond MAX_PARALLEL_TOOL_CALLS are skipped but still get a role=tool reply', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));

  const toolCalls = [];
  for (let index = 0; index < MAX_PARALLEL_TOOL_CALLS + 3; index += 1) {
    toolCalls.push({ id: `c${index}`, name: 'lookup', arguments: { query: `q${index}` } });
  }

  const { bus, seen } = recorder();
  const outcome = await dispatchToolCalls({
    toolCalls,
    context: {},
    stream: bus,
    registry,
    tooManyToolCallsMessage: 'too many',
  });

  assert.equal(outcome.toolMessages.length, toolCalls.length, 'pairing must stay intact');
  const skipped = outcome.toolMessages.slice(MAX_PARALLEL_TOOL_CALLS);
  for (const message of skipped) {
    assert.match(message.content, /Tool call not executed: this round is limited to 15/);
  }
  assert.ok(seen.some((event) => event.content === 'too many'));
});

test('first terminate wins and pause/terminate are mutually exclusive', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'finisher',
    description: 'd',
    parameters: [{ name: 'query', type: 'string', description: 'q', required: false }],
    handler: async () => ({ content: 'terminal content', terminateTurn: true }),
  });

  const { bus } = recorder();
  const outcome = await dispatchToolCalls({
    toolCalls: [{ id: 'c1', name: 'finisher', arguments: { query: 'x' } }],
    context: {},
    stream: bus,
    registry,
  });
  assert.equal(outcome.terminate, true);
  assert.equal(outcome.terminatePayload.content, 'terminal content');
  assert.equal(outcome.pause, false);
});

test('pause tools run last and only the first pause call drives the pause', async () => {
  const registry = createToolRegistry();
  const order = [];
  registry.register({
    name: 'ask_user',
    description: 'pause',
    parameters: [{ name: 'query', type: 'string', description: 'q', required: false }],
    handler: async () => {
      order.push('ask_user');
      return { content: 'card', pauseForUser: { question: 'q' } };
    },
  });
  registry.register({
    name: 'lookup',
    description: 'd',
    parameters: [{ name: 'query', type: 'string', description: 'q' }],
    handler: async () => {
      order.push('lookup');
      return { content: 'result' };
    },
  });

  const { bus } = recorder();
  const outcome = await dispatchToolCalls({
    toolCalls: [
      { id: 'c1', name: 'ask_user', arguments: { query: 'a' } },
      { id: 'c2', name: 'lookup', arguments: { query: 'b' } },
      { id: 'c3', name: 'ask_user', arguments: { query: 'c' } },
    ],
    context: {},
    stream: bus,
    registry,
  });

  assert.deepEqual(order, ['lookup', 'ask_user'], 'ordinary work runs before the pause tools');
  assert.equal(outcome.pause, true);
  assert.equal(outcome.pauseToolCallId, 'c1');
  assert.equal(outcome.toolMessages.length, 3);
  // 第二个暂停调用被当成重复，短路掉
  assert.match(outcome.toolMessages[2].content, /additional parallel ask_user tool_call — skipped/);
});

test('PAUSE_LAST_TOOLS matches the upstream set', () => {
  assert.deepEqual([...PAUSE_LAST_TOOLS], ['ask_user', 'workspace_export']);
});

// ---------------------------------------------------------------- 8. 流事件顺序

test('stream order: all tool_call events precede every tool_result', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('first'));
  registry.register(fakeTool('second'));

  const { bus, seen } = recorder();
  await dispatchToolCalls({
    toolCalls: [
      { id: 'c1', name: 'first', arguments: { query: '1' } },
      { id: 'c2', name: 'second', arguments: { query: '2' } },
    ],
    context: {},
    stream: bus,
    source: 'quiz',
    stage: 'quizzing',
    registry,
  });

  const types = seen.map((event) => event.type);
  const firstResult = types.indexOf(StreamEventType.TOOL_RESULT);
  const lastCall = types.lastIndexOf(StreamEventType.TOOL_CALL);
  assert.ok(firstResult > lastCall, `tool_call events must all come first, got ${types.join(',')}`);

  // 每个工具各自一条 tool_call + 一条 tool_result
  assert.equal(types.filter((t) => t === StreamEventType.TOOL_CALL).length, 2);
  assert.equal(types.filter((t) => t === StreamEventType.TOOL_RESULT).length, 2);
});

test('seq is assigned monotonically from 1 on an assignSeq bus', async () => {
  const { bus, seen } = recorder();
  bus.assignSeq = true;
  await bus.content('a');
  await bus.content('b');
  await bus.toolCall('t', {});
  assert.deepEqual(seen.map((event) => event.seq), [1, 2, 3]);
  assert.equal(bus.latestSeq, 3);
});

test('without assignSeq every event keeps seq 0 (direct callers must stay at zero)', async () => {
  const bus = createStreamBus();
  const events = [];
  bus.onEvent((event) => events.push(event));
  await bus.content('a');
  await bus.content('b');
  assert.deepEqual(events.map((event) => event.seq), [0, 0]);
  assert.equal(bus.latestSeq, 0);
});

test('each tool call opens (running) and closes (complete) its own sub-trace', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));

  const { bus, seen } = recorder();
  await dispatchToolCalls({
    toolCalls: [{ id: 'c1', name: 'lookup', arguments: { query: 'x' } }],
    context: {},
    stream: bus,
    registry,
  });

  const statuses = seen.filter((event) => event.trace_kind === 'call_status');
  // 普通工具调用用空消息开关子 trace：状态装在 metadata 里
  assert.deepEqual(statuses.map((event) => event.call_state), ['running', 'complete']);
  const callIds = new Set(statuses.map((event) => event.call_id));
  assert.equal(callIds.size, 1, 'both status events belong to the same sub-trace card');
});

test('a tool reporting success:false closes its sub-trace with call_state=error, not complete', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'soft_fail',
    description: 'd',
    parameters: [{ name: 'query', type: 'string', description: 'q' }],
    handler: async () => ({ content: 'could not read', success: false }),
  });

  const { bus, seen } = recorder();
  await dispatchToolCalls({
    toolCalls: [{ id: 'c1', name: 'soft_fail', arguments: { query: 'x' } }],
    context: {},
    stream: bus,
    registry,
  });

  const statuses = seen.filter((event) => event.trace_kind === 'call_status');
  assert.deepEqual(statuses.map((event) => event.call_state), ['running', 'error']);
});

test('a raising tool closes with progress(call_state=error), never with a stream ERROR event', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'boom',
    description: 'd',
    parameters: [{ name: 'query', type: 'string', description: 'q' }],
    handler: async () => {
      throw new Error('kaboom');
    },
  });

  const { bus, seen } = recorder();
  await dispatchToolCalls({
    toolCalls: [{ id: 'c1', name: 'boom', arguments: { query: 'x' } }],
    context: {},
    stream: bus,
    registry,
  });

  assert.equal(
    seen.filter((event) => event.type === StreamEventType.ERROR).length,
    0,
    'a stream ERROR makes a partner turn re-run the whole turn on its backup model',
  );
  const statuses = seen.filter((event) => event.trace_kind === 'call_status');
  assert.equal(statuses[statuses.length - 1].call_state, 'error');
  assert.match(statuses[statuses.length - 1].content, /boom failed: kaboom/);
});

test('coalesceEvents merges only consecutive same-trace deltas', () => {
  const base = { source: 's', stage: 'g' };
  const events = [
    { ...base, type: StreamEventType.CONTENT, content: 'Hel', metadata: { call_id: 'c1' } },
    { ...base, type: StreamEventType.CONTENT, content: 'lo', metadata: { call_id: 'c1' } },
    { ...base, type: StreamEventType.TOOL_CALL, content: 'tool', metadata: { call_id: 'c1' } },
    { ...base, type: StreamEventType.CONTENT, content: 'after', metadata: { call_id: 'c1' } },
  ];
  const merged = coalesceEvents(events);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].content, 'Hello');
  assert.equal(merged[1].type, StreamEventType.TOOL_CALL);
  assert.equal(merged[2].content, 'after', 'a tool_call breaks the merge run');

  // 不同 call_id 不是同一条增量，不能合并
  const other = coalesceEvents([
    { ...base, type: StreamEventType.CONTENT, content: 'a', metadata: { call_id: 'c1' } },
    { ...base, type: StreamEventType.CONTENT, content: 'b', metadata: { call_id: 'c2' } },
  ]);
  assert.equal(other.length, 2);
});

test('subscribe replays history exactly once and stops at close', async () => {
  const bus = createStreamBus({ assignSeq: true });
  await bus.content('one');
  await bus.content('two');

  const collected = [];
  const consumer = (async () => {
    for await (const event of bus.subscribe()) {
      collected.push(event.content);
      if (collected.length === 3) {
        await bus.close();
      }
    }
  })();

  await bus.content('three');
  await consumer;
  assert.deepEqual(collected, ['one', 'two', 'three']);
});

test('subscribe({afterSeq}) resumes past the given sequence', async () => {
  const bus = createStreamBus({ assignSeq: true });
  await bus.content('one');
  await bus.content('two');

  const collected = [];
  const consumer = (async () => {
    for await (const event of bus.subscribe({ afterSeq: 1 })) {
      collected.push(event.content);
      if (collected.length === 1) await bus.close();
    }
  })();
  await consumer;
  assert.deepEqual(collected, ['two']);
});

// ---------------------------------------------------------------- 9. 标签协议

test('classifyLabel accepts wrapped labels and strips the separator', () => {
  assert.deepEqual(classifyLabel('``FINISH``\nhello', { allowedLabels: ['FINISH'] }), [
    'FINISH',
    'hello',
  ]);
  // 标签紧贴正文（Markdown 行内代码在视觉上已经分隔开了）
  assert.deepEqual(classifyLabel('``FINISH``你好', { allowedLabels: ['FINISH'] }), ['FINISH', '你好']);
});

test('classifyLabel tolerates the bare-label form with a separator', () => {
  assert.deepEqual(classifyLabel('TOOL: {"a":1}', { allowedLabels: ['TOOL', 'FINISH'] }), [
    'TOOL',
    '{"a":1}',
  ]);
  // FINISHED 不能被当成 FINISH
  assert.equal(classifyLabel('FINISHED all done', { allowedLabels: ['FINISH'] }), null);
});

test('classifyLabel rejects an over-closed wrapper while streaming', () => {
  assert.equal(classifyLabel('``FINISH```', { allowedLabels: ['FINISH'] }), null);
});

test('findInlineLabels flags a second label at line start but not inline prose', () => {
  assert.deepEqual(findInlineLabels('body\n``TOOL``\nmore', { allowedLabels: ['TOOL'] }), ['TOOL']);
  assert.deepEqual(findInlineLabels('next I should use ``TOOL`` here', { allowedLabels: ['TOOL'] }), []);
});

test('protocolViolation classifies each upstream violation key', () => {
  const protocol = {
    allowed: ['THINK', 'TOOL', 'FINISH'],
    terminal: new Set(['FINISH']),
    intermediate: new Set(['THINK']),
    final: new Set(['FINISH']),
    toolLabel: 'TOOL',
  };
  assert.equal(protocolViolation(step({ label: 'UNKNOWN' }), protocol), 'missing_label');
  assert.equal(
    protocolViolation(step({ label: 'FINISH', text: '\n``TOOL``\n' }), protocol),
    'multiple_labels',
  );
  assert.equal(protocolViolation(step({ label: 'TOOL', toolCalls: [] }), protocol), 'tool_without_calls');
  assert.equal(
    protocolViolation(
      step({ label: 'FINISH', toolCalls: [{ id: 'c', name: 't', arguments: {} }] }),
      protocol,
    ),
    'finish_with_tools',
  );
  assert.equal(protocolViolation(step({ label: 'FINISH', text: 'ok' }), protocol), null);
});

test('runAgenticLoop terminates on the protocol-specific terminal label, not a hardcoded one', async () => {
  const registry = createToolRegistry();
  // PLAN 协议：只有一个 allowed 标签 PLAN，它既是 terminal 也是 final 之外的东西
  const calls = [];
  const outcome = await runAgenticLoop({
    initialMessages: [{ role: 'user', content: 'plan please' }],
    protocol: {
      allowed: ['PLAN'],
      terminal: ['PLAN'],
      intermediate: [],
      final: [], // plan 文本从不以流式正文出现
      toolLabel: null,
    },
    maxIterations: 4,
    host: {
      buildIterationTraceMeta: () => [{}, {}],
      dispatchTools: async () => {
        throw new Error('PLAN protocol must never dispatch tools');
      },
      protocolRetryNotice: () => 'retry',
      protocolRepairMessage: (violation) => `repair ${violation}`,
      forceFinalize: async () => ['fallback', false, 0],
      emitFinal: async (text) => calls.push(text),
    },
    runLabeledStep: async () => step({ label: 'PLAN', text: '{"templates":[]}' }),
  });

  assert.equal(outcome.completed, true);
  assert.equal(outcome.finalLabel, 'PLAN');
  assert.equal(outcome.finalText, '{"templates":[]}');
  assert.deepEqual(calls, [], 'PLAN has an empty final set, so emitFinal must not fire');
});

test('runAgenticLoop skips emitFinal when streamBodyLive is on (avoid double-push)', async () => {
  const emitted = [];
  const outcome = await runAgenticLoop({
    initialMessages: [{ role: 'user', content: 'explore' }],
    protocol: {
      allowed: ['FINISH'],
      terminal: ['FINISH'],
      intermediate: [],
      final: ['FINISH'],
      toolLabel: null,
    },
    maxIterations: 2,
    streamBodyLive: true,
    host: {
      buildIterationTraceMeta: () => [{}, {}],
      dispatchTools: async () => ({}),
      protocolRetryNotice: () => 'retry',
      protocolRepairMessage: (violation) => `repair ${violation}`,
      forceFinalize: async () => ['fallback', false, 0],
      emitFinal: async (text) => emitted.push(text),
    },
    runLabeledStep: async () => step({ label: 'FINISH', text: 'streamed live' }),
  });
  assert.equal(outcome.completed, true);
  assert.equal(outcome.finalText, 'streamed live');
  assert.deepEqual(emitted, [], 'the text is already on the wire');
});

test('runAgenticLoop executes tool rounds and feeds results back until FINISH', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));
  const { bus } = recorder();
  const steps = [
    step({ label: 'THINK', text: 'thinking about it' }),
    step({
      label: 'TOOL',
      toolCalls: [{ id: 'c1', name: 'lookup', arguments: { query: 'q' } }],
    }),
    step({ label: 'FINISH', text: 'done' }),
  ];
  let index = 0;

  const outcome = await runAgenticLoop({
    initialMessages: [{ role: 'user', content: 'go' }],
    protocol: {
      allowed: ['THINK', 'TOOL', 'FINISH'],
      terminal: ['FINISH'],
      intermediate: ['THINK'],
      final: ['FINISH'],
      toolLabel: 'TOOL',
    },
    maxIterations: 6,
    stream: bus,
    streamBodyLive: true,
    host: {
      buildIterationTraceMeta: () => [{}, {}],
      dispatchTools: async ({ toolCalls }) =>
        dispatchToolCalls({ toolCalls, context: {}, stream: bus, registry }),
      protocolRetryNotice: () => 'retry',
      protocolRepairMessage: (violation) => `repair ${violation}`,
      forceFinalize: async () => ['fallback', false, 0],
    },
    runLabeledStep: async () => steps[index++],
  });

  assert.equal(outcome.completed, true);
  assert.equal(outcome.finalText, 'done');
  assert.equal(outcome.iterations, 3);
  // THINK 的正文留作 assistant 上下文
  assert.ok(outcome.messages.some((m) => m.role === 'assistant' && m.content === 'thinking about it'));
  // TOOL 轮之后紧跟 role=tool
  const toolMessage = outcome.messages.find((m) => m.role === 'tool');
  assert.equal(toolMessage.tool_call_id, 'c1');
  assert.equal(toolMessage.content, 'lookup:q');
});

test('a protocol violation repairs and continues instead of ending the loop', async () => {
  const steps = [
    step({ label: 'UNKNOWN', text: 'draft without a label' }),
    step({ label: 'FINISH', text: 'proper answer' }),
  ];
  let index = 0;
  const notices = [];

  const outcome = await runAgenticLoop({
    initialMessages: [{ role: 'user', content: 'go' }],
    protocol: {
      allowed: ['THINK', 'TOOL', 'FINISH'],
      terminal: ['FINISH'],
      intermediate: ['THINK'],
      final: ['FINISH'],
      toolLabel: 'TOOL',
    },
    maxIterations: 5,
    host: {
      buildIterationTraceMeta: () => [{}, {}],
      dispatchTools: async () => ({}),
      protocolRetryNotice: () => 'violated the protocol',
      protocolRepairMessage: (violation) => `repair:${violation}`,
      forceFinalize: async () => ['fallback', false, 0],
      emitFinal: async (text) => notices.push(text),
    },
    runLabeledStep: async () => steps[index++],
  });

  assert.equal(outcome.completed, true);
  assert.equal(outcome.finalText, 'proper answer');
  assert.equal(outcome.iterations, 2);
  // 草稿留作 assistant，纠正提示作为 user 追加
  assert.ok(outcome.messages.some((m) => m.role === 'assistant' && m.content === 'draft without a label'));
  assert.ok(outcome.messages.some((m) => m.role === 'user' && m.content === 'repair:missing_label'));
});

test('exhausting maxIterations calls forceFinalize and reports its completion verdict', async () => {
  let forced = null;
  const outcome = await runAgenticLoop({
    initialMessages: [{ role: 'user', content: 'go' }],
    protocol: {
      allowed: ['THINK', 'FINISH'],
      terminal: ['FINISH'],
      intermediate: ['THINK'],
      final: ['FINISH'],
      toolLabel: null,
    },
    maxIterations: 2,
    host: {
      buildIterationTraceMeta: () => [{}, {}],
      dispatchTools: async () => ({}),
      protocolRetryNotice: () => 'retry',
      protocolRepairMessage: (violation) => `repair ${violation}`,
      forceFinalize: async ({ messages, startIteration }) => {
        forced = { count: messages.length, startIteration };
        return ['forced answer', true, 2];
      },
    },
    runLabeledStep: async () => step({ label: 'THINK', text: 'still thinking' }),
  });

  assert.ok(forced !== null, 'forceFinalize must be reached');
  assert.equal(forced.startIteration, 2);
  assert.equal(outcome.finalText, 'forced answer');
  assert.equal(outcome.completed, true);
  assert.equal(outcome.iterations, 4, '2 loop iterations + 2 finalization calls');
});

test('pause with resolvePause=false ends the loop with completed=false', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'ask_user',
    description: 'pause',
    parameters: [{ name: 'query', type: 'string', description: 'q', required: false }],
    handler: async () => ({ content: 'card', pauseForUser: { question: 'q' } }),
  });

  const outcome = await runAgenticLoop({
    initialMessages: [{ role: 'user', content: 'go' }],
    protocol: {
      allowed: ['TOOL', 'FINISH'],
      terminal: ['FINISH'],
      intermediate: [],
      final: ['FINISH'],
      toolLabel: 'TOOL',
    },
    maxIterations: 4,
    host: {
      buildIterationTraceMeta: () => [{}, {}],
      dispatchTools: async ({ toolCalls }) =>
        dispatchToolCalls({ toolCalls, context: {}, registry }),
      resolvePause: async () => false,
      protocolRetryNotice: () => 'retry',
      protocolRepairMessage: (violation) => `repair ${violation}`,
      forceFinalize: async () => ['fallback', false, 0],
    },
    runLabeledStep: async () =>
      step({ label: 'TOOL', toolCalls: [{ id: 'c1', name: 'ask_user', arguments: {} }] }),
  });

  assert.equal(outcome.completed, false);
  assert.equal(outcome.iterations, 1);
});

// ---------------------------------------------------------------- 10. 消息形状

test('assistantMessageWithToolCalls matches the provider wire shape', () => {
  const message = assistantMessageWithToolCalls('text', [{ id: 'c1', name: 'lookup', arguments: '{}' }], {
    reasoningContent: 'why',
    thinkingBlocks: [{ type: 'thinking', signature: 'sig' }],
  });
  assert.equal(message.role, 'assistant');
  assert.equal(message.content, 'text');
  assert.equal(message.tool_calls[0].type, 'function');
  assert.equal(message.tool_calls[0].function.name, 'lookup');
  assert.equal(message.reasoning_content, 'why');
  assert.deepEqual(message.thinking_blocks, [{ type: 'thinking', signature: 'sig' }]);
});

test('an empty assistant content becomes null on a tool-call turn', () => {
  const message = assistantMessageWithToolCalls('', [{ id: 'c1', name: 't', arguments: '' }]);
  assert.equal(message.content, null);
  assert.equal(message.tool_calls[0].function.arguments, '{}');
});

test('transient model messages are anchored after the whole tool batch', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [] },
    { role: 'tool', tool_call_id: 'c1', content: 'a' },
    { role: 'tool', tool_call_id: 'c2', content: 'b' },
    { role: 'assistant', content: 'next' },
  ];
  const transient = [{ role: 'user', content: [{ type: 'image_url' }], _after_tool_call_id: 'c1' }];
  const request = withTransientModelMessages(messages, transient);
  assert.equal(request.length, 5);
  // 图片挂在 c2 之后（整批 tool 消息之后），不是 c1 之后
  assert.deepEqual(request[3].content, [{ type: 'image_url' }]);
  assert.equal(request[4].content, 'next');
});

test('transient image budget keeps at most two across rounds', () => {
  const transient = [];
  const part = (id) => ({ _after_tool_call_id: id, content: [{ type: 'image_url' }] });
  extendTransientModelMessages(transient, [part('a'), part('b')]);
  assert.equal(transient.length, 2);
  extendTransientModelMessages(transient, [part('c')]);
  assert.equal(transient.length, 2);
  assert.equal(transient[1]._after_tool_call_id, 'c', 'the oldest image is dropped');
});

// ---------------------------------------------------------------- 11. trace / 参数解析

test('trace metadata builders keep the unspecified fields out entirely', () => {
  const base = buildTraceMetadata({ callId: 'c1', phase: 'p', label: 'l', callKind: 'k' });
  assert.deepEqual(Object.keys(base).sort(), ['call_id', 'call_kind', 'label', 'phase']);
  assert.equal('trace_role' in base, false);
});

test('deriveTraceMetadata keeps the base fields (sub-trace status rides on them)', () => {
  const base = buildTraceMetadata({ callId: 'c1', phase: 'p', label: 'l', callKind: 'k' });
  const derived = deriveTraceMetadata(base, { traceKind: 'call_status', callState: 'running' });
  assert.equal(derived.call_id, 'c1');
  assert.equal(derived.label, 'l');
  assert.equal(derived.call_state, 'running');
  // 不写 undefined 覆盖已有值
  const kept = deriveTraceMetadata({ a: 1 }, { callId: undefined });
  assert.deepEqual(kept, { a: 1 });
});

test('mergeTraceMetadata overlays extra onto base', () => {
  assert.deepEqual(mergeTraceMetadata({ a: 1, b: 2 }, { b: 3 }), { a: 1, b: 3 });
});

test('newCallId prefixes and stays short', () => {
  const id = newCallId('iter-0-tool-1');
  assert.match(id, /^iter-0-tool-1-[0-9a-f]{10}$/);
  assert.notEqual(newCallId('x'), newCallId('x'));
});

test('parseToolArguments walks the whole upstream degradation chain', () => {
  assert.deepEqual(parseToolArguments('{"a":1}'), { a: 1 });
  assert.deepEqual(parseToolArguments('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseToolArguments('```\n{"a":1}\n```'), { a: 1 });
  // 推理前言
  assert.deepEqual(parseToolArguments('<think>hmm {"fake":1}</think>\n{"real":2}'), { real: 2 });
  // 散文里夹载荷：取能解析的最长值，不是第一个
  assert.deepEqual(parseToolArguments('here: {"fake":1} and the payload {"real":true}'), { real: true });
  // 尾随逗号
  assert.deepEqual(parseToolArguments('{"a":1,}'), { a: 1 });
  // 全空、纯推理、纯散文都返回 fallback
  assert.deepEqual(parseToolArguments(''), {});
  assert.deepEqual(parseToolArguments('<think>only reasoning</think>'), {});
  assert.deepEqual(parseToolArguments('no json here at all'), {});
});

test('parseToolArgumentsObject forces an object (arrays/strings become {})', () => {
  assert.deepEqual(parseToolArgumentsObject('[1,2,3]'), {});
  assert.deepEqual(parseToolArgumentsObject('"str"'), {});
  assert.deepEqual(parseToolArgumentsObject('null'), {});
  assert.deepEqual(parseToolArgumentsObject('{"a":1}'), { a: 1 });
  assert.deepEqual(parseToolArgumentsObject({ b: 2 }), { b: 2 });
});

// ---------------------------------------------------------------- 12. 敏感参数 / 公开投影

test('sensitive params never reach the tool_call trace event', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'check_answer',
    description: 'd',
    parameters: [
      { name: 'question', type: 'string', description: 'q' },
      { name: 'expected_answer', type: 'string', description: 'a', sensitive: true },
    ],
    handler: async () => ({ content: 'correct' }),
  });

  const { bus, seen } = recorder();
  await dispatchToolCalls({
    toolCalls: [
      { id: 'c1', name: 'check_answer', arguments: { question: 'q?', expected_answer: 'SECRET' } },
    ],
    context: {},
    stream: bus,
    registry,
  });

  const callEvent = seen.find((event) => event.type === StreamEventType.TOOL_CALL);
  assert.ok(callEvent);
  // 事件内容断言：从总线上把 args 取回来
  const events = bus.events.filter((event) => event.type === StreamEventType.TOOL_CALL);
  const args = events[0].metadata.args;
  assert.equal(args.question, 'q?');
  assert.equal('expected_answer' in args, false, 'the answer is one disclosure triangle away');
});

test('server-injected private kwargs are stripped from the display args', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));
  const { bus } = recorder();
  await dispatchToolCalls({
    toolCalls: [{ id: 'c1', name: 'lookup', arguments: { query: 'x' } }],
    context: {},
    stream: bus,
    registry,
    kwargAugmenter: (name, args) => ({ ...args, _sandbox_mounts: { secret: true } }),
  });
  const callEvent = bus.events.find((event) => event.type === StreamEventType.TOOL_CALL);
  assert.equal('_sandbox_mounts' in callEvent.metadata.args, false);
});

test('a ToolEventProjection replaces the display args without touching execution args', async () => {
  const registry = createToolRegistry();
  let executed = null;
  registry.register({
    name: 'lookup',
    description: 'd',
    parameters: [{ name: 'query', type: 'string', description: 'q' }],
    handler: async (args) => {
      executed = args;
      return { content: 'ok' };
    },
  });

  const { bus } = recorder();
  await dispatchToolCalls({
    toolCalls: [{ id: 'c1', name: 'lookup', arguments: { query: 'real' } }],
    context: {},
    stream: bus,
    registry,
    kwargAugmenter: (name, args) => ({
      ...args,
      [TOOL_EVENT_PROJECTION]: new ToolEventProjection({
        arguments: { query: 'public view' },
        retrievalQuery: 'public view',
      }),
    }),
  });

  const callEvent = bus.events.find((event) => event.type === StreamEventType.TOOL_CALL);
  assert.deepEqual(callEvent.metadata.args, { query: 'public view' });
  assert.equal(executed.query, 'real', 'execution still uses the private args');
});

// ---------------------------------------------------------------- 13. 上下文 / 契约

test('enabled_tools keeps the three-state distinction (null vs [])', () => {
  const notSpecified = createUnifiedContext({});
  assert.equal(notSpecified.enabled_tools, null);
  const disabled = createUnifiedContext({ enabledTools: [] });
  assert.deepEqual(disabled.enabled_tools, []);
});

test('context.extension hands out an isolated mutable namespace and rejects empty names', () => {
  const context = createUnifiedContext({});
  const namespace = context.extension('quiz');
  namespace.count = 1;
  assert.equal(context.extension('quiz').count, 1);
  assert.throws(() => context.extension('  '), /must not be empty/);
});

test('deep question request config validates bounds and forbids unknown fields', () => {
  assert.deepEqual(validateDeepQuestionRequestConfig(null), {
    mode: 'custom',
    topic: '',
    num_questions: 1,
    difficulty: '',
    question_types: [],
    per_type_counts: {},
    paper_path: '',
    max_questions: 10,
  });

  assert.throws(() => validateDeepQuestionRequestConfig({ nope: 1 }), /Unexpected field/);
  assert.throws(() => validateDeepQuestionRequestConfig({ num_questions: 0 }), /greater than or equal to 1/);
  assert.throws(() => validateDeepQuestionRequestConfig({ num_questions: 51 }), /less than or equal to 50/);
  assert.throws(() => validateDeepQuestionRequestConfig({ mode: 'other' }), /should be custom or mimic/);
  assert.throws(() => validateDeepQuestionRequestConfig('nope'), /must be an object/);
});

test('validated config omits undeclared fields rather than inventing nulls', () => {
  const config = validateCapabilityConfig('deep_question', { num_questions: 3 });
  assert.equal(config.num_questions, 3);
  assert.equal(config.max_questions, 10);
  assert.equal('paper_path' in config, true);
});

test('unknown capabilities pass through validation untouched (plugins define their own)', () => {
  assert.deepEqual(validateCapabilityConfig('my_plugin', { anything: 1 }), { anything: 1 });
});

test('prerequisite errors are a distinct type so callers never force-finish past them', () => {
  const error = new CapabilityPrerequisiteError('no lecture loaded');
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'CapabilityPrerequisiteError');
});

test('capability catalog keys by (kind, name) and refuses silent replacement', () => {
  const catalog = new CapabilityCatalog();
  const manifest = { name: 'deep_question' };
  catalog.register({ name: 'deep_question', kind: 'turn', manifest, factory: () => ({ kind: 'turn' }) });
  catalog.register({
    name: 'deep_question',
    kind: 'loop_extension',
    manifest,
    factory: () => ({ kind: 'loop' }),
  });
  assert.throws(
    () => catalog.register({ name: 'deep_question', kind: 'turn', manifest, factory: () => ({}) }),
    /already registered/,
  );
  assert.deepEqual(catalog.create('turn', 'deep_question'), { kind: 'turn' });
  assert.deepEqual(catalog.create('loop_extension', 'deep_question'), { kind: 'loop' });
  assert.equal(catalog.create('turn', 'nope'), null);
  assert.equal(catalog.entries('turn').length, 1);
  assert.throws(() => catalog.register({ name: '  ', kind: 'turn', manifest }), /must not be empty/);
});

// ---------------------------------------------------------------- 14. 单个调用直调

test('executeToolCall is usable outside the parallel dispatcher', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));
  const { bus, seen } = recorder();

  const result = await executeToolCall({
    registry: {
      execute: (name, args, options) => registry.execute(name, args, options),
    },
    toolName: 'lookup',
    toolArgs: { query: 'solo' },
    stream: bus,
    source: 's',
    stage: 'g',
    traceMeta: undefined,
  });

  assert.equal(result.resultText, 'lookup:solo');
  assert.equal(result.success, true);
  // 没有 traceMeta → 没有 call_id 可归组 → 状态保持静默
  assert.deepEqual(seen, []);
});

test('executeToolCall returns a readable failure for an unknown tool', async () => {
  const registry = createToolRegistry();
  const result = await executeToolCall({
    registry: { execute: (name) => registry.execute(name, {}) },
    toolName: 'ghost',
    toolArgs: {},
    stream: createStreamBus(),
  });
  assert.equal(result.success, false);
  assert.match(result.resultText, /Error executing ghost: Unknown tool: ghost/);
});

test('tool timeouts are retried and then reported as a timeout', async () => {
  const registry = createToolRegistry();
  let attempts = 0;
  registry.register({
    name: 'hang',
    description: 'd',
    parameters: [{ name: 'query', type: 'string', description: 'q' }],
    handler: async () => {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { content: 'too late' };
    },
  });

  const { bus } = recorder();
  const result = await executeToolCall({
    registry: { execute: (name, args, options) => registry.execute(name, args, options) },
    toolName: 'hang',
    toolArgs: { query: 'x' },
    stream: bus,
    traceMeta: { call_id: 'c1' },
    toolTimeout: 0.01,
    toolMaxRetries: 1,
  });

  assert.equal(result.success, false);
  assert.match(result.resultText, /timed out after 0\.01 seconds/);
  assert.equal(attempts, 2, 'one retry before giving up');
});

// ---------------------------------------------------------------- 15. 集成边界

test('augmentArgs receives the context object (not the dispatch-option wrapper)', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));
  let seenContext = null;

  const context = { session_id: 'sess-1', user_message: 'hi' };
  await registry.dispatch(
    { id: 'c1', name: 'lookup', arguments: { query: 'q' } },
    {
      context,
      source: 'quiz',
      augmentArgs: (name, args, ctx) => {
        seenContext = ctx;
        return { ...args, kb_name: 'kb-from-context' };
      },
    },
  );

  assert.equal(seenContext, context, 'the augmenter must see UnifiedContext, not {context, stream, ...}');
  assert.equal(seenContext.session_id, 'sess-1');
});

test('augmentArgs may also be declared on the context object', async () => {
  const registry = createToolRegistry();
  let augmented = null;
  registry.register({
    name: 'lookup',
    description: 'd',
    parameters: [{ name: 'query', type: 'string', description: 'q' }],
    handler: async (args) => {
      augmented = args;
      return { content: 'ok' };
    },
  });

  await registry.dispatch(
    { id: 'c1', name: 'lookup', arguments: { query: 'q' } },
    {
      context: {
        session_id: 's',
        augmentArgs: (name, args) => ({ ...args, injected: true }),
      },
    },
  );
  assert.equal(augmented.injected, true);
});

test('kwarg augmentation is server-side only: it satisfies the arg guard', async () => {
  const registry = createToolRegistry();
  let ran = false;
  registry.register({
    name: 'read_source',
    description: 'd',
    parameters: [{ name: 'source_index', type: 'object', description: 'server-owned' }],
    handler: async () => {
      ran = true;
      return { content: 'read' };
    },
  });

  // 模型没给 source_index，服务端补全 —— 这必须算"已给"，不能被守卫拒
  const outcome = await registry.dispatch(
    { id: 'c1', name: 'read_source', arguments: {} },
    { augmentArgs: (name, args) => ({ ...args, source_index: { s1: 'file.md' } }) },
  );
  assert.equal(ran, true);
  assert.equal(outcome.result.content, 'read');
});

test('rebinding tools run before the rest and the rest see their committed state', async () => {
  const registry = createToolRegistry();
  const order = [];
  let target = 'start';

  registry.register({
    name: 'switch_workspace',
    description: 'rebinding tool',
    parameters: [{ name: 'query', type: 'string', description: 'q', required: false }],
    handler: async () => {
      order.push('switch');
      target = 'switched';
      return { content: 'switched' };
    },
  });
  registry.register({
    name: 'writer',
    description: 'depends on the workspace',
    parameters: [{ name: 'query', type: 'string', description: 'q' }],
    handler: async () => {
      order.push(`writer:${target}`);
      return { content: `wrote to ${target}` };
    },
  });

  await dispatchToolCalls({
    toolCalls: [
      { id: 'c1', name: 'writer', arguments: { query: 'x' } },
      { id: 'c2', name: 'switch_workspace', arguments: { query: 'y' } },
    ],
    context: {},
    registry,
    rebindingTools: ['switch_workspace'],
    kwargAugmenter: (name, args) => args,
  });

  assert.deepEqual(order, ['switch', 'writer:switched'], 'the writer must be re-bound after the switch');
});

test('a non-JSON arguments string degrades to {} and is caught by the arg guard', async () => {
  const registry = createToolRegistry();
  registry.register({
    name: 'lookup',
    description: 'd',
    parameters: [{ name: 'query', type: 'string', description: 'q' }],
    handler: async () => ({ content: 'should not run' }),
  });

  const outcome = await registry.dispatch({ id: 'c1', name: 'lookup', arguments: 'not json at all' });
  assert.equal(outcome.ok, true);
  assert.match(outcome.result.content, /tool call not dispatched/);
  assert.match(outcome.result.content, /`query`/);
});

test('schemas() with no arguments returns every registered tool', () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('a'));
  registry.register(fakeTool('b'));
  assert.deepEqual(
    registry.schemas().map((schema) => schema.function.name),
    ['a', 'b'],
  );
});

test('dispatch without a name or call object fails cleanly', async () => {
  const registry = createToolRegistry();
  registry.register(fakeTool('lookup'));
  assert.equal((await registry.dispatch(null)).error.code, 'invalid_call');
  assert.equal((await registry.dispatch({ id: 'c1' })).error.code, 'missing_tool_name');
});

test('lazy loader is only consulted for unknown names and registers the result', async () => {
  const registry = createToolRegistry({
    loader: (name) => (name === 'lazy_tool' ? fakeTool('lazy_tool') : null),
  });
  assert.deepEqual(registry.listTools(), []);
  const tool = registry.get('lazy_tool');
  assert.equal(tool.name, 'lazy_tool');
  assert.deepEqual(registry.listTools(), ['lazy_tool']);
  assert.equal(registry.get('never_registered'), null);
});

