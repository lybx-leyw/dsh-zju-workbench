/**
 * 工具注册表 —— 上游 `runtime/registry/tool_registry.py` 的 JS 对位，
 * 加上本包对外承诺的 `createToolRegistry()` 契约。
 *
 * # 与上游的差别（以及为什么）
 *
 * 上游 registry 是"单例 + 惰性导入内建类 + entry-point 插件发现"。JS 版没有
 * Python 类导入这一层，工具就是普通对象 `{name, description, parameters, handler}`，所以：
 * - 去掉 `load_builtins` / `load_plugins`（那是 Python 打包体系的产物），
 *   保留 `register` / `unregister` / `listTools` / `deferredTools` 的语义。
 * - 别名机制**逐字保留**（`TOOL_ALIASES`）：别名只在执行时生效，模型给的名字
 *   仍原样留在 trace 里 —— 否则复盘时看到的工具名和模型说的对不上。
 * - `resolve` / `schemas` / `dispatch` 是本包对外的三条主契约。
 *
 * # 为什么 resolve 要按解析后的名字去重
 *
 * 上游 `get_enabled` 用 `seen` 集合按**解析后的工具名**去重：同一批入参里同时给了
 * 别名和本名（`pdf` 与 `read_source`），只能出现一次。否则模型会看到两份同名函数
 * 描述，第二份的默认参数还会覆盖第一份。
 *
 * # 一个工具对象长什么样
 *
 * ```js
 * {
 *   name: 'read_source',
 *   description: 'Read one attached source by id.',
 *   parameters: [                       // 参数行写法（等价上游 list[ToolParameter]）
 *     {name: 'source_id', type: 'string', description: '...', required: true},
 *     {name: 'query', type: 'string', description: '...', required: false},
 *   ],
 *   // 或 parameters: {完整 JSON Schema}（等价上游 raw_parameters，优先）
 *   handler: async (args, ctx) => ({content: '...', sources: []}),
 * }
 * ```
 *
 * handler 的返回值可以是字符串、`{content}`、或上游 `ToolResult` 的完整形状
 * （`{content, success, sources, metadata, terminateTurn, pauseForUser}`）；
 * 缺的字段由 {@link normalizeHandlerResult} 补齐。
 */

import { toOpenAISchema, normalizeDefinition, isPlainObject } from './schema.js';
import {
  dispatchToolCalls,
  executeToolCall,
  createDispatchOutcome,
  buildPerToolTraceMeta,
  MAX_PARALLEL_TOOL_CALLS,
  PAUSE_LAST_TOOLS,
} from './dispatch.js';
import { runAgenticLoop } from './loop.js';
import {
  assistantMessageWithToolCalls,
  extendTransientModelMessages,
  withTransientModelMessages,
} from './messages.js';

/**
 * 别名表：`名字 → [规范名, 默认参数]`。
 *
 * 与上游 `tools/builtin_specs.py` 的 `TOOL_ALIASES` 逐字一致。别名存在的理由：
 * 提示词里教模型用的是 `rag_hybrid` 这种带模式的说法，而实现只有一个 `rag`。
 * 默认参数**先**铺底、模型给的参数**覆盖**它 —— 模型显式说 `mode:"naive"`
 * 时不能被别名的默认值盖回去（上游 `{**default_kwargs, **kwargs}` 的次序）。
 */
export const DEFAULT_TOOL_ALIASES = Object.freeze({
  pdf: ['read_source', {}],
  rag_hybrid: ['rag', { mode: 'hybrid' }],
  rag_naive: ['rag', { mode: 'naive' }],
  rag_search: ['rag', {}],
});

/** 原生工具循环的默认轮数上限。只是兜底，调用方应按阶段显式给。 */
export const DEFAULT_MAX_ROUNDS = 32;

function cloneDefaults(defaults) {
  return isPlainObject(defaults) ? { ...defaults } : {};
}

/**
 * 建一个工具注册表。
 *
 * @param {object} [options]
 * @param {Array<object>} [options.tools] 初始工具
 * @param {object} [options.aliases] 别名表，默认 {@link DEFAULT_TOOL_ALIASES}
 * @param {(name:string)=>object|null} [options.loader]
 *        惰性装载器。上游也是"先注册描述符、用的时候再实例化内建类"——
 *        创建工具可能很贵（要连 MCP、要建索引），不该在注册表构造时就付。
 * @param {(schema:object, tool:object)=>object} [options.decorateSchema]
 *        给每个 schema 补一刀的机会。出题流水线就是这么给 `rag.query` 补
 *        `minLength:1`、把 `kb_name` 收窄成当前知识库的 enum、并给所有
 *        parameters 补 `additionalProperties:false`（见 NOTES.md）。
 * @returns {object} 注册表
 */
export function createToolRegistry(options = {}) {
  const tools = new Map();
  const aliases = new Map();
  const loader = typeof options.loader === 'function' ? options.loader : null;
  const decorateSchema =
    typeof options.decorateSchema === 'function' ? options.decorateSchema : null;

  for (const [name, value] of Object.entries(options.aliases ?? DEFAULT_TOOL_ALIASES)) {
    aliases.set(String(name), [String(value[0]), cloneDefaults(value[1])]);
  }

  function register(tool) {
    const definition = normalizeDefinition(tool);
    const entry = {
      name: definition.name,
      get description() {
        return definition.description;
      },
      get parameters() {
        return definition.parameters;
      },
      definition,
      tool: definition.tool,
      deferred: definition.deferred,
      get schema() {
        return toOpenAISchema(definition);
      },
      get promptHints() {
        return { short_description: definition.description };
      },
    };
    tools.set(definition.name, entry);
    return entry;
  }

  for (const tool of options.tools ?? []) register(tool);

  const unregister = (name) => {
    tools.delete(String(name));
  };

  /**
   * 解析别名 → `[规范名, 合并后的参数]`。
   *
   * 模型给的是别名时，默认参数铺底、模型参数覆盖；不是别名就原样返回。
   */
  function resolveRequest(name, args = {}) {
    const key = String(name ?? '');
    if (tools.has(key)) return [key, { ...(args ?? {}) }];
    const alias = aliases.get(key);
    if (alias === undefined) return [key, { ...(args ?? {}) }];
    const [canonical, defaults] = alias;
    return [canonical, { ...cloneDefaults(defaults), ...(args ?? {}) }];
  }

  function get(name) {
    const [canonical] = resolveRequest(name);
    const existing = tools.get(canonical);
    if (existing) return existing;
    if (loader !== null) {
      const loaded = loader(canonical);
      if (loaded && typeof loaded === 'object') return register(loaded);
    }
    return null;
  }

  const getDefinition = (name) => {
    const tool = get(name);
    return tool ? tool.definition : null;
  };

  const listTools = () => [...tools.keys()];

  function asNameList(names) {
    if (names === null || names === undefined) return null;
    if (Array.isArray(names)) return names.map((name) => String(name));
    return [String(names)];
  }

  /**
   * 返回给定名字对应的工具数组（跳过未知的、按解析后名字去重）。
   *
   * `names` 传 `null`/`undefined` 表示全部。`ctx` 目前不参与筛选，但留在签名上：
   * 集成层要按会话过滤工具面（某个用户没开检索），过滤不该改签名。
   *
   * 顺序跟着 `names` 走，不重排 —— 提示词里的工具清单顺序与 schema 顺序一致，
   * 模型的选择会受顺序影响。
   */
  function resolve(names = null, ctx = undefined) {
    void ctx;
    const wanted = asNameList(names);
    const source = wanted === null ? listTools() : wanted;
    const enabled = [];
    const seen = new Set();
    for (const name of source) {
      let tool;
      try {
        tool = get(name);
      } catch {
        tool = null;
      }
      if (!tool || seen.has(tool.name)) continue;
      enabled.push(tool);
      seen.add(tool.name);
    }
    return enabled;
  }

  /**
   * 生成可直接塞进 OpenAI `tools` 参数的 JSON Schema 数组。
   *
   * 不认识的名字**静默跳过**（与上游 `get_enabled` 一致）：模型幻觉出来的名字不该
   * 让整轮构 schema 失败。
   */
  function schemas(names = null) {
    const out = [];
    for (const tool of resolve(names)) {
      const schema = toOpenAISchema(tool.definition);
      out.push(decorateSchema ? decorateSchema(schema, tool) : schema);
    }
    return out;
  }

  /**
   * 执行一个工具（单次，不经过并行调度层）。
   *
   * @param {string} name
   * @param {object} args
   * @param {{context?:object, eventSink?:Function, stream?:object, source?:string, stage?:string, toolCallId?:string}} [execOptions]
   * @returns {Promise<object>} 归一化后的结果（见 {@link normalizeHandlerResult}）
   */
  async function execute(name, args = {}, execOptions = {}) {
    const [canonicalName, resolvedArgs] = resolveRequest(name, args);
    const tool = get(canonicalName);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    if (typeof tool.definition.handler !== 'function') {
      throw new Error(`Tool ${canonicalName} has no handler`);
    }
    const ctx = {
      context: execOptions.context ?? {},
      stream: execOptions.stream ?? null,
      source: execOptions.source ?? '',
      stage: execOptions.stage ?? '',
      toolCallId: execOptions.toolCallId ?? '',
      // 没有地方发布时不传 sink：工具会靠 sink 是否存在决定要不要真干活
      // （rag 会为它装日志捕获），给一个什么都不做的 sink 严格比不给更糟。
      eventSink: execOptions.eventSink ?? null,
    };
    const raw = await tool.definition.handler(resolvedArgs, ctx);
    return normalizeHandlerResult(raw);
  }

  /** 给调度层用的只读视图（不含 register / unregister）。 */
  const registryView = { get, getDefinition, resolveRequest, execute };

  function buildDispatchOptions(ctx = {}) {
    const context = ctx.context ?? ctx;
    // augmentArgs 允许挂在两处：调度选项上（ctx）或上下文对象上（context）。
    // 上游是能力对象的方法，跟着 context 走；但集成层更自然的是把它当调度选项传。
    // 两处都收，免得调用方传错位置后表现为"服务端参数没注入"这种静默故障。
    const augmenter =
      typeof ctx.augmentArgs === 'function'
        ? ctx.augmentArgs
        : typeof context?.augmentArgs === 'function'
          ? context.augmentArgs
          : null;
    return {
      registry: registryView,
      context,
      stream: ctx.stream ?? null,
      source: String(ctx.source ?? ''),
      stage: String(ctx.stage ?? ''),
      kwargAugmenter: augmenter,
      toolCallLabel: ctx.toolCallLabel ?? 'Tool call',
      retrieveMetaFactory: ctx.retrieveMetaFactory ?? null,
      emptyToolResultMessage: ctx.emptyToolResultMessage ?? '',
      tooManyToolCallsMessage: ctx.tooManyToolCallsMessage ?? null,
      toolErrorMessageFactory: ctx.toolErrorFactory ?? null,
      traceIdPrefix: ctx.traceIdPrefix ?? 'iter',
      toolTimeout: ctx.toolTimeout ?? null,
      toolMaxRetries: ctx.toolMaxRetries ?? 0,
      rebindingTools: ctx.rebindingTools ?? [],
    };
  }

  /**
   * 执行一个工具调用。
   *
   * `call` 形状：`{id, name, arguments}`；`arguments` 可以是对象，也可以是模型给的
   * 原始字符串（会被容错解析，见 json.js）。
   *
   * @returns {Promise<{ok:true, result:object} | {ok:false, error:object}>}
   *
   * **为什么失败不抛**：调用方是"模型调工具"这个循环，失败必须变成下一轮可读的
   * `role=tool` 文本，而不是把整轮打断 —— 那正是上游 arg guard 存在的全部理由。
   * 只有"注册表自己坏了"（工具没有 handler）才会抛。
   */
  async function dispatch(call, ctx = {}) {
    if (!call || typeof call !== 'object') {
      return {
        ok: false,
        error: { code: 'invalid_call', message: 'tool call must be an object' },
      };
    }
    const toolName = String(call.name ?? '').trim();
    const callId = String(call.id ?? '').trim() || `call-${toolName}`;
    if (toolName === '') {
      return { ok: false, error: { code: 'missing_tool_name', message: 'tool call has no name' } };
    }

    const tool = get(toolName);
    if (!tool) {
      // 未知工具：明确说"这个工具不存在、不要再调"，而不是让模型以为是自己
      // 参数写错了、于是换个参数再试一遍。
      return {
        ok: false,
        error: {
          code: 'unknown_tool',
          tool: toolName,
          message: `Unknown tool: ${toolName}. It is not registered; do not call it again.`,
          known_tools: listTools(),
        },
      };
    }

    const outcome = await dispatchToolCalls({
      ...buildDispatchOptions(ctx),
      toolCalls: [{ id: callId, name: toolName, arguments: call.arguments ?? {} }],
      iterationIndex: Number(ctx.iterationIndex ?? 0),
    });

    const message = outcome.toolMessages[0];
    if (message === undefined) {
      return {
        ok: false,
        error: { code: 'no_result', tool: toolName, message: 'tool produced no result' },
      };
    }
    return {
      ok: true,
      result: {
        tool: toolName,
        content: message.content,
        sources: outcome.sources,
        metadata: outcome.toolMetadataById?.[callId] ?? {},
        terminateTurn: outcome.terminate,
        terminatePayload: outcome.terminatePayload,
        pauseForUser: outcome.pause ? outcome.pausePayload : null,
        message,
      },
    };
  }

  /**
   * 一次"原生工具调用"轮：执行这一轮的 tool_calls，返回该追加到历史里的消息。
   *
   * 与 {@link runToolLoop} 的区别是它只做一轮。集成层自己掌握模型客户端、
   * 要复用自己那套流式解析时用这个。
   */
  async function dispatchRound({
    toolCalls = [],
    assistantText = '',
    reasoningContent = null,
    thinkingBlocks = null,
    context = {},
    appendAssistantMessage = true,
    ...rest
  } = {}) {
    const outcome = await dispatchToolCalls({
      ...buildDispatchOptions({ ...rest, context }),
      toolCalls,
      iterationIndex: Number(rest.iterationIndex ?? 0),
    });
    const assistantMessages = [];
    if (appendAssistantMessage) {
      assistantMessages.push(
        assistantMessageWithToolCalls(assistantText, toolCalls, {
          reasoningContent,
          thinkingBlocks,
        }),
      );
    }
    assistantMessages.push(...outcome.toolMessages);
    return { ...outcome, assistantMessages };
  }

  /**
   * 原生工具调用循环：模型发起调用 → 执行 → 结果回灌 → 继续，直到模型不再发
   * 工具调用或用尽轮数。
   *
   * # 这是"没有协议标签"的那套形态
   *
   * 上游 chat 循环就是这样：一轮带 `tool_calls` 就是工具轮，不带就是收尾轮，
   * 从不问模型要标签。出题链的 QUIZ/REPAIR 阶段也是裸 JSON，不走标签协议。
   * 有标签协议的形态见 `runAgenticLoop` —— 那边"谁终止"由 `protocol` 参数决定，
   * **不是**硬编码成一种。
   *
   * # 终止条件（按优先级）
   *
   * 1. `outcome.pause` 且 `resolvePause` 返回 false → 结束，`completed=false`
   *    （调用方没有接 resolvePause 时同样结束：没有暂停通道就等于用户不可能回答）
   * 2. `outcome.terminate` → 用 `terminatePayload.content` 当最终文本，`completed=true`
   * 3. 这一轮没有 tool_calls → 用这一轮的文本，`completed=true`
   * 4. 跑满 `maxRounds` → 有 `forceFinalize` 就交给它（它决定 `completed`），
   *    否则返回最后一条文本、`completed=false`
   *
   * # 预算
   *
   * 整卷出题的模型调用量级是 `10 + 2 + 9N`（N = 题数），单题约 9 次。所以
   * `maxRounds` 不能写死成很小的数 —— 那会让第 4 题往后全部走强制收尾。
   */
  async function runToolLoop({
    messages = [],
    callModel,
    context = {},
    stream = null,
    source = '',
    stage = '',
    maxRounds = DEFAULT_MAX_ROUNDS,
    toolNames = null,
    onRound = null,
    forceFinalize = null,
    resolvePause = null,
    emitTerminator = null,
    emitFinal = null,
    streamBodyLive = false,
    tools: explicitTools = null,
  } = {}) {
    if (typeof callModel !== 'function') {
      throw new Error('runToolLoop requires a callModel function');
    }
    const toolSchemas = explicitTools ?? schemas(toolNames);
    const transcript = messages;
    const aggregatedSources = [];
    const transient = [];
    let finalText = '';
    let completed = false;
    let rounds = 0;
    const maxIter = Math.max(1, Math.trunc(Number(maxRounds) || 0));
    let exhausted = true;

    for (let round = 0; round < maxIter; round += 1) {
      const step = await callModel({
        messages: withTransient(transcript, transient),
        tools: toolSchemas,
        round,
        maxRounds: maxIter,
      });
      rounds += 1;
      const toolCalls = step?.toolCalls ?? [];

      if (toolCalls.length === 0) {
        // 没有工具调用就是收尾轮。正文由调用方决定要不要推流：
        // `streamBodyLive=true` 表示 callModel 已经逐 chunk 推过了，
        // 这里再 emitFinal 就是推第二遍。
        const text = String(step?.text ?? '');
        if (!streamBodyLive && typeof emitFinal === 'function' && text) {
          await emitFinal(text);
        }
        transcript.push({ role: 'assistant', content: text });
        finalText = text;
        completed = true;
        exhausted = false;
        break;
      }

      transcript.push(
        assistantMessageWithToolCalls(step.text ?? '', toolCalls, {
          reasoningContent: step?.reasoningContent ?? null,
          thinkingBlocks: step?.thinkingBlocks ?? null,
        }),
      );
      const outcome = await dispatchToolCalls({
        ...buildDispatchOptions({ ...context, stream, source, stage }),
        toolCalls,
        iterationIndex: round,
      });
      aggregatedSources.push(...outcome.sources);
      transcript.push(...outcome.toolMessages);
      extendTransientModelMessages(transient, outcome.modelMessages);
      if (typeof onRound === 'function') {
        await onRound({ round, outcome, step, messages: transcript });
      }

      if (outcome.pause) {
        const resumed = typeof resolvePause === 'function' ? await resolvePause(outcome) : false;
        if (!resumed) {
          completed = false;
          exhausted = false;
          break;
        }
        continue;
      }
      if (outcome.terminate) {
        if (typeof emitTerminator === 'function') await emitTerminator(outcome.terminatePayload);
        finalText = String(outcome.terminatePayload?.content ?? '');
        completed = true;
        exhausted = false;
        break;
      }
    }

    if (exhausted) {
      if (typeof forceFinalize === 'function') {
        const [finishText, didFinish, extraRounds] = await forceFinalize({
          messages: transcript,
          startRound: maxIter,
        });
        rounds += Number(extraRounds) || 0;
        finalText = String(finishText ?? '');
        completed = Boolean(didFinish);
      } else {
        const last = transcript[transcript.length - 1];
        finalText = typeof last?.content === 'string' ? last.content : '';
        completed = false;
      }
    }

    return { finalText, completed, rounds, sources: aggregatedSources, messages: transcript };
  }

  return {
    // ---- 契约（四个方法，顺序与任务书一致）----
    register,
    resolve,
    dispatch,
    schemas,
    // ---- 集成层需要的额外能力 ----
    unregister,
    get,
    getDefinition,
    resolveRequest,
    listTools,
    definitions: (names = null) => resolve(names),
    deferredTools: () => [...tools.values()].filter((tool) => tool.deferred === true),
    execute,
    executeCall: executeToolCall,
    dispatchRound,
    dispatchToolCalls,
    runToolLoop,
    runAgenticLoop,
    get aliases() {
      return new Map(aliases);
    },
  };
}

function withTransient(messages, transient) {
  return withTransientModelMessages(messages, transient);
}

/**
 * 归一化 handler 的返回值。
 *
 * handler 允许直接返回字符串（最省事的写法）或部分字段；这里补齐成调度层要求的
 * 完整形状，免得每个工具都要记得写全 6 个字段 —— 少写一个 `success` 就被当成
 * 失败、或者少写 `sources` 就丢引用的坑，都是这么来的。
 */
export function normalizeHandlerResult(result) {
  const base = {
    content: '',
    success: true,
    sources: [],
    metadata: {},
    terminateTurn: false,
    pauseForUser: null,
    modelMessage: null,
    publicResult: null,
  };
  if (result === null || result === undefined) return base;
  if (typeof result === 'string') return { ...base, content: result };
  if (typeof result !== 'object') return { ...base, content: String(result) };

  const success = result.success === false || result.ok === false ? false : true;
  const content = pickString(result.content, result.result, result.error, result.text);
  return {
    content,
    success,
    sources: Array.isArray(result.sources) ? result.sources : [],
    metadata: isPlainObject(result.metadata) ? result.metadata : {},
    terminateTurn: result.terminateTurn === true || result.terminate_turn === true,
    pauseForUser: result.pauseForUser ?? result.pause_for_user ?? null,
    modelMessage: result.modelMessage ?? result.model_message ?? null,
    publicResult: result.publicResult ?? result.public_result ?? null,
  };
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string') return value;
  }
  for (const value of values) {
    if (value === null || value === undefined) continue;
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return '';
}

export {
  dispatchToolCalls,
  executeToolCall,
  createDispatchOutcome,
  buildPerToolTraceMeta,
  MAX_PARALLEL_TOOL_CALLS,
  PAUSE_LAST_TOOLS,
  runAgenticLoop,
};
