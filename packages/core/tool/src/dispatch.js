/**
 * 并行工具调度 —— 上游 `runtime/agentic/tool_dispatch.py` 的 JS 对位。
 *
 * # 一次 assistant 消息里的工具调用，走的是四段有序流程
 *
 * ```
 *   prepare（绑定执行参数，保留模型原始参数）
 *     ↓
 *   去重（同一批里重复的调用短路成 stub，保住 tool_call / tool_message 配对）
 *     ↓
 *   为每个调用分配子 trace 卡（call_id），先发全部 tool_call 事件
 *     ↓
 *   三阶段执行：rebinding（串行）→ ordinary（并发）→ pausing（串行，先重绑）
 *     ↓
 *   collect（按原顺序发 tool_result、拼 role=tool 消息、聚合 sources、定 pause/terminate）
 * ```
 *
 * # 为什么阶段顺序不能换
 *
 * 一轮里每个调用的参数都在**任何**调用执行之前就绑好了。于是"改变这一轮作用对象"
 * 的工具（掌握度路径、工作区）必须先跑，跑完让受影响的调用**重绑**，否则它们还
 * 指着这一轮开始时的状态。暂停类工具（`ask_user`、`workspace_export`）最后跑，
 * 并且要再重绑一次：它们的职责就是把这一轮的状态展示给用户，而那个状态在它们
 * 之前根本不存在。
 *
 * # 为什么失败的调用**不回** stream ERROR
 *
 * 抛错的工具用它自己的子 trace 收一条**终态 progress** 事件，不是 ERROR。
 * 前端只靠 `call_state` 判定终态；而 ERROR 事件对别的消费者意味着"这个回合出问题了"
 * —— 合作方回合会收集它们并在备用模型上**重跑整个回合**，那会把一次失败的调用
 * 变成对 exec / 文件写入 / notebook 写入的重复执行。检索路径保留 ERROR 事件：
 * 那条路径早于本约定且没有副作用可重复。
 */

import { createHash } from 'node:crypto';
import { parseToolArgumentsObject } from './json.js';
import {
  buildTraceMetadata,
  deriveTraceMetadata,
  mergeTraceMetadata,
  newCallId,
} from './trace.js';
import { missingArgsMessage, unsatisfiedRequiredArgs } from './arg-guard.js';
import { providerIdentity, sensitiveArgNames } from './schema.js';

/**
 * 每条 assistant 消息的执行预算，**不是**整回合的工具预算。
 * 超出的调用不执行，但仍必须给每个 id 一条 role=tool 回复（见文件末尾）。
 */
export const MAX_PARALLEL_TOOL_CALLS = 15;

/**
 * 会暂停回合并给用户看东西的工具。它们在**同类调用的其余部分跑完之后**才跑，
 * 并且要按那些调用落定的状态重绑参数：模型在同一轮里既提问又显示卡片时，
 * 卡片否则会在问题还不存在的时候就绑好，于是带不上它的持久化版本。
 */
export const PAUSE_LAST_TOOLS = Object.freeze(['ask_user', 'workspace_export']);

/** 提示词包里的失败通知键。一个键、一种措辞、五个调用点。 */
export const TOOL_ERROR_NOTICE_KEY = 'notices.tool_error';

/** 服务端私有的公开投影键（`ToolEventProjection`）。 */
export const TOOL_EVENT_PROJECTION = '_tool_event_projection';

/**
 * 服务端持有的公开调用详情，与执行参数分开。
 *
 * 运行时**只**接受这种类型的值；模型自己给出的 JSON 对象不能改变 trace 可见性。
 * 能力层把它和私有 kwargs 一起注入。
 */
export class ToolEventProjection {
  constructor({ arguments: args = {}, retrievalQuery = '' } = {}) {
    this.arguments = args && typeof args === 'object' ? args : {};
    this.retrievalQuery = String(retrievalQuery ?? '');
  }
}

/**
 * 一次调度的聚合结果。
 *
 * - `terminate`：某个工具要求这一轮之后结束；它的 content 成为终态助手产物。
 * - `pause`（如 `ask_user`）：回合活着；调用方等用户回复、把它替换进对应的
 *   `role=tool` 消息，再继续迭代。**第一个**请求暂停的工具胜出，其余并行工具照常
 *   执行、结果一并带回。
 */
export function createDispatchOutcome({
  sources = [],
  toolMessages = [],
  modelMessages = [],
  toolMetadataById = {},
  terminate = false,
  terminatePayload = null,
  pause = false,
  pausePayload = null,
  pauseToolCallId = null,
} = {}) {
  return {
    sources,
    toolMessages,
    modelMessages,
    toolMetadataById,
    terminate,
    terminatePayload,
    pause,
    pausePayload,
    pauseToolCallId,
  };
}

/**
 * 能力层本地化的失败通知。
 *
 * `translate` 是该能力的 `_t`。键与英文措辞留在本模块，是为了让五个调用点不能再
 * 各自漂移 —— 一个早于本键的提示词包降级成英文，绝不降级成"哪里出错了"都说不清。
 */
export function toolErrorMessageFactory(translate) {
  return (toolName, error) =>
    translate(TOOL_ERROR_NOTICE_KEY, {
      tool: toolName,
      error,
      default: `${toolName} failed: ${error}`,
    });
}

const DEFAULT_TOOL_ERROR_FACTORY = (toolName, error) => `${toolName} failed: ${error}`;

// ---------------------------------------------------------------- 参数准备

function stableArgsKey(value) {
  return JSON.stringify(sortValue(value), (_key, item) => {
    if (typeof item === 'bigint') return item.toString();
    if (typeof item === 'function') return `[Function ${item.name || 'anonymous'}]`;
    if (typeof item === 'symbol') return item.toString();
    return item;
  });
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    if (value instanceof ToolEventProjection) {
      return { arguments: sortValue(value.arguments), retrievalQuery: value.retrievalQuery };
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

/**
 * 绑定每个调用的执行参数，同时保留模型的原始参数。
 *
 * 原始参数是延迟重绑的起点，所以"重绑"与"第一次绑定"完全一样幂等。
 */
export function prepareToolArgs(toolCalls, context, kwargAugmenter, registry = null) {
  const prepared = [];
  const rawArgs = [];
  for (const toolCall of toolCalls ?? []) {
    const toolName = String(toolCall?.name ?? '').trim();
    const toolCallId = String(toolCall?.id ?? '').trim();
    const parsed = parseToolArgumentsObject(toolCall?.arguments ?? '{}');
    const [canonicalName, resolvedArgs] = resolveToolRequest(registry, toolName, parsed);
    const execArgs =
      kwargAugmenter !== null && kwargAugmenter !== undefined
        ? kwargAugmenter(canonicalName, resolvedArgs, context)
        : resolvedArgs;
    prepared.push([toolCallId, toolName, execArgs]);
    rawArgs.push({ ...parsed });
  }
  return { prepared, rawArgs };
}

/**
 * 在服务端补全之前解析别名及其默认参数。
 *
 * 执行时保留**模型给出的名字**，这样 trace 行忠实于它实际发的调用；
 * 别名只影响"执行什么"。没有别名能力的注册表原样返回。
 */
export function resolveToolRequest(registry, toolName, toolArgs) {
  if (!registry) return [toolName, { ...toolArgs }];
  if (typeof registry.resolveRequest === 'function') {
    try {
      const [resolvedName, resolvedArgs] = registry.resolveRequest(toolName, toolArgs);
      return [String(resolvedName || toolName), { ...resolvedArgs }];
    } catch {
      return [toolName, { ...toolArgs }];
    }
  }
  try {
    const tool = registry.get(toolName);
    return [String(tool?.name || toolName), { ...toolArgs }];
  } catch {
    return [toolName, { ...toolArgs }];
  }
}

// ---------------------------------------------------------------- 去重

/**
 * 重复调用索引 → 主调用索引。
 *
 * 两条调用重复的判据是 `(工具名, JSON 规范化后的参数)` 相同。暂停类工具更严：
 * 这一批里的第一个暂停调用是主调用，**之后任何**暂停调用都映射到它，不管名字和
 * 参数是否相同 —— UI 与暂停/恢复运行时每批只支持一张待处理卡片。
 * 不可序列化的参数退化成 `String()`，好歹给一个确定的键。
 */
export function detectDuplicateCalls(prepared) {
  const duplicateOf = new Map();
  const seen = new Map();
  let firstPauseIndex = null;
  for (let index = 0; index < prepared.length; index += 1) {
    const toolName = prepared[index][1];
    if (PAUSE_LAST_TOOLS.includes(toolName)) {
      if (firstPauseIndex !== null) {
        duplicateOf.set(index, firstPauseIndex);
        continue;
      }
      firstPauseIndex = index;
    }
    let argsKey;
    try {
      argsKey = stableArgsKey(prepared[index][2]);
    } catch {
      argsKey = String(prepared[index][2]);
    }
    const key = `${toolName}\u0000${argsKey}`;
    if (!seen.has(key)) seen.set(key, index);
    else duplicateOf.set(index, seen.get(key));
  }
  return duplicateOf;
}

/**
 * 重复并行调用的合成结果。
 *
 * 不带 `pause_for_user` / `terminate_turn` / `metadata`：只有主调用能驱动
 * 暂停/终止决策，前端也只渲染一张卡。`resultText` 是一条给模型看的指令，
 * 下一轮它读到就明白别在同一批里发一模一样的两条调用。
 */
export function duplicateStubResult({ primaryCallId, toolName }) {
  const resultText = PAUSE_LAST_TOOLS.includes(toolName)
    ? `(additional parallel ${toolName} tool_call — skipped. The earlier ` +
      `pause call with id=${JSON.stringify(primaryCallId)} is the only one that will ` +
      "pause for the user's reply. Request one confirmation card at a time.)"
    : '(duplicate parallel tool_call — skipped. The identical call ' +
      `with id=${JSON.stringify(primaryCallId)} already ran in this batch; ` +
      'see its result. Do NOT emit two identical tool_calls in one ' +
      'assistant message — parallel calls must differ in arguments.)';
  return { resultText, sources: [] };
}

// ---------------------------------------------------------------- 参数守卫

/**
 * 必填参数一个都没到的调用，短路掉。
 *
 * 调用形状完好时返回 `null`（继续派发），否则返回一个合成的失败结果，
 * 正文告诉模型该补哪些参数。
 *
 * 未知工具名与"定义构建失败"都**原样放行**：那是注册表的错误，它掌握本层没有的上下文。
 */
export async function rejectIfArgsMissing({
  registry,
  toolName,
  execArgs,
  stream,
  source,
  stage,
  traceMeta = null,
}) {
  let definition = null;
  try {
    definition = typeof registry.getDefinition === 'function' ? registry.getDefinition(toolName) : null;
  } catch {
    return null;
  }
  if (definition === null || definition === undefined) return null;

  const { absent, blank } = unsatisfiedRequiredArgs(definition, execArgs);
  if (absent.length === 0 && blank.length === 0) return null;

  const message = missingArgsMessage(toolName, absent, { empty: blank });

  if (traceMeta !== null && traceMeta !== undefined && stream) {
    // 与 execute_tool_call 的抛错路径一致：给子 trace 收一条终态，
    // 被拒的调用不能留一行看起来还在跑的记录。用 progress 而不是 error ——
    // 这是可恢复的单调用纠偏，stream ERROR 会让合作方回合整轮重跑。
    const unsatisfied = [...absent, ...blank];
    const reason = blank.length > 0 && absent.length === 0 ? 'empty' : 'missing';
    await stream.progress(
      `${toolName} not dispatched: ${reason} ${unsatisfied.map((arg) => arg.name).join(', ')}`,
      {
        source,
        stage,
        metadata: deriveTraceMetadata(traceMeta, {
          traceKind: 'call_status',
          callState: 'error',
          error: message,
        }),
      },
    );
  }

  return {
    resultText: message,
    success: false,
    sources: [],
    metadata: { error: 'missing_required_arguments' },
    terminateTurn: false,
    pauseForUser: null,
  };
}

// ---------------------------------------------------------------- trace 卡

/**
 * 给每个工具分配一张新的子 trace 卡（`call_id`），前端据此把它渲染成独立一行。
 *
 * `tool_source` / `tool_provider` **不写空值**：内建工具整条字段缺席，
 * 于是"没有这两个字段"明确表示"不是外部 provider"，而不是"外部 provider 没识别出来"。
 */
export function buildPerToolTraceMeta(
  prepared,
  {
    context = null,
    iterationIndex = 0,
    stage = '',
    toolCallLabel = 'Tool call',
    traceIdPrefix = 'iter',
    registry = null,
  } = {},
) {
  const metas = [];
  for (let toolIndex = 0; toolIndex < prepared.length; toolIndex += 1) {
    const [toolCallId, toolName] = prepared[toolIndex];
    const [providerSource, provider] = providerOf(registry, toolName);
    const traceCallId = newCallId(`${traceIdPrefix}-${iterationIndex}-tool-${toolIndex}`);
    const baseMeta = buildTraceMetadata({
      callId: traceCallId,
      phase: stage,
      label: toolCallLabel,
      callKind: 'tool_planning',
      traceId: traceCallId,
      traceRole: 'tool',
      traceGroup: 'tool_call',
    });
    const extra = {
      tool_call_id: toolCallId,
      tool_name: toolName,
      tool_index: toolIndex,
      iteration_index: iterationIndex,
      session_id: context?.session_id ?? '',
      turn_id: String(context?.metadata?.turn_id ?? ''),
    };
    if (providerSource) extra.tool_source = providerSource;
    if (provider) extra.tool_provider = provider;
    metas.push(mergeTraceMetadata(baseMeta, extra));
  }
  return metas;
}

/** 永不抛：注册表解析不出的名字正是模型幻觉调用的常态，那一行 trace 仍要建出来。 */
export function providerOf(registry, toolName) {
  if (!registry) return ['', ''];
  try {
    const tool = registry.get(toolName);
    return tool ? providerIdentity(tool) : ['', ''];
  } catch {
    return ['', ''];
  }
}

/** 检索用途参数：有公开投影就用投影，否则用执行参数。 */
export function publicInvocationArgs(args) {
  const projection = args?.[TOOL_EVENT_PROJECTION];
  if (projection instanceof ToolEventProjection) {
    return { ...projection.arguments, query: projection.retrievalQuery };
  }
  return args;
}

/**
 * trace 事件里要显示的调用参数。
 *
 * 剥掉服务端注入的私有 kwargs（`_sandbox_mounts` 之类）：它们是执行管道，
 * 不是显示参数，而且可能不可 JSON 序列化。标了 `sensitive` 的参数也剥掉 ——
 * trace 是给工具所服务的那个人看的，一个 quiz 的 `expected_answer` 只要隔着
 * 一个折叠三角就能看到，这道题就废了。
 */
export function displayArgsFor(registry, toolName, execArgs) {
  let withheld = new Set();
  try {
    const tool = registry?.get(toolName);
    withheld = sensitiveArgNames(tool) ?? new Set();
  } catch {
    withheld = new Set();
  }
  const projection = execArgs?.[TOOL_EVENT_PROJECTION];
  const source =
    projection instanceof ToolEventProjection ? projection.arguments : (execArgs ?? {});
  const display = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('_')) continue;
    if (withheld.has(key)) continue;
    display[key] = value;
  }
  return display;
}

// ---------------------------------------------------------------- 超时 / 重试

class ToolTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolTimeoutError';
  }
}

function isRetryableFailure(error) {
  if (!error) return false;
  if (error.name === 'ToolTimeoutError') return true;
  const code = String(error.code ?? '');
  if (['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND'].includes(code)) {
    return true;
  }
  return error instanceof TypeError && /fetch failed|network/i.test(String(error.message ?? ''));
}

function withTimeout(promise, seconds) {
  if (seconds === null || seconds === undefined) return promise;
  const ms = Math.max(0, Number(seconds) * 1000);
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new ToolTimeoutError('timed out')), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------- 单个调用执行

/**
 * 跑一个工具，把它的状态（以及中间进度）投进它自己的子 trace。
 *
 * `traceMeta` 是那片子 trace（调度器的 `per_tool_trace_meta` 行）；`retrieveMeta`
 * 是可选的 retrieve 变体。状态跟着变体走（有变体时），否则跟原卡走 ——
 * 变体只决定**标签**，绝不决定前端能不能拿到 `call_state`。
 * 两者都没有时（调度器之外的裸调用）没有 `call_id` 可归组，状态保持静默。
 */
export async function executeToolCall({
  registry,
  toolName,
  toolArgs,
  stream,
  source = '',
  stage = '',
  retrieveMeta = null,
  traceMeta = null,
  emptyToolResultMessage = '',
  startRetrievalMessage = 'Starting retrieval',
  retrieveLabel = 'Retrieve',
  toolErrorMessageFactory: errorFactory = null,
  toolTimeout = null,
  toolMaxRetries = 0,
  context = null,
}) {
  const statusMeta = retrieveMeta !== null && retrieveMeta !== undefined ? retrieveMeta : traceMeta;

  const eventSink = async (eventType, message = '', metadata = null) => {
    if (statusMeta === null || statusMeta === undefined || !message || !stream) return;
    await stream.progress(message, {
      source,
      stage,
      metadata: deriveTraceMetadata(statusMeta, {
        traceKind: String(eventType || 'tool_log'),
        ...(metadata ?? {}),
      }),
    });
  };

  // 检索保留它自己的旁白；普通工具调用用**空消息**开关子 trace：
  // 状态装在 metadata 里，Web 端从不渲染 call_status 文本，而 CLI 渲染器
  // 已经从 tool_call 事件拿到了表头。
  if (statusMeta !== null && statusMeta !== undefined && stream) {
    let runningMessage = '';
    if (retrieveMeta !== null && retrieveMeta !== undefined) {
      const projection = toolArgs?.[TOOL_EVENT_PROJECTION];
      const query =
        projection instanceof ToolEventProjection
          ? projection.retrievalQuery
          : String(retrieveMeta?.query ?? toolArgs?.query ?? '').trim();
      runningMessage = query ? `Query: ${query}` : startRetrievalMessage;
    }
    await stream.progress(runningMessage, {
      source,
      stage,
      metadata: deriveTraceMetadata(statusMeta, { traceKind: 'call_status', callState: 'running' }),
    });
  }

  const executeWithPolicy = async () => {
    const attempts = Math.max(1, Number(toolMaxRetries) + 1);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const invocation = registry.execute(toolName, toolArgs, {
          context,
          // 没有地方发布时不传 sink：工具会靠 sink 是否存在来决定要不要真干活
          // （rag 会为它装一个日志捕获 handler），给一个什么都不做的 sink
          // 严格比不给更糟。
          eventSink: statusMeta !== null && statusMeta !== undefined ? eventSink : null,
        });
        return await withTimeout(invocation, toolTimeout);
      } catch (error) {
        if (attempt >= attempts || !isRetryableFailure(error)) {
          if (error?.name === 'ToolTimeoutError' && toolTimeout !== null && toolTimeout !== undefined) {
            throw new ToolTimeoutError(`${toolName} timed out after ${toolTimeout} seconds`);
          }
          throw error;
        }
        const retryReason = error?.name === 'ToolTimeoutError' ? 'timed out' : String(error?.message ?? error);
        await eventSink('tool_log', `${toolName} ${retryReason}; retrying attempt ${attempt + 1}/${attempts}`, {
          retry_attempt: attempt + 1,
          max_attempts: attempts,
        });
      }
    }
    throw new Error('unreachable');
  };

  try {
    let result;
    try {
      result = await executeWithPolicy();
    } catch (error) {
      // 未知工具名也走这里（注册表抛错），所以每一种失败模式都会给子 trace 收终态，
      // 而不是留一行看起来完成的记录。
      if (statusMeta !== null && statusMeta !== undefined && stream) {
        // 抛错的工具收**终态 progress**，不是 stream ERROR（原因见文件头）。
        const emitRetrieve = retrieveMeta !== null && retrieveMeta !== undefined;
        const message = emitRetrieve ? `Retrieve failed: ${errorMessage(error)}` : `${toolName} failed: ${errorMessage(error)}`;
        const metadata = deriveTraceMetadata(statusMeta, {
          traceKind: 'call_status',
          callState: 'error',
          error: errorMessage(error),
        });
        if (emitRetrieve && typeof stream.error === 'function') {
          await stream.error(message, { source, stage, metadata });
        } else {
          await stream.progress(message, { source, stage, metadata });
        }
      }
      throw error;
    }

    if (statusMeta !== null && statusMeta !== undefined && stream) {
      await stream.progress(
        retrieveMeta !== null && retrieveMeta !== undefined
          ? `Retrieve complete (${String(result.content ?? '').length} chars)`
          : '',
        {
          source,
          stage,
          metadata: deriveTraceMetadata(statusMeta, {
            traceKind: 'call_status',
            // 在结果里报告失败才是本仓最常见的失败惯用法（远多于抛错），
            // 所以终态必须读它。给一次失败的 read_file 标"完成"会让元数据
            // 恰好在最被依赖的地方理直气壮地错。
            callState: result.success === false ? 'error' : 'complete',
          }),
        },
      );
    }

    return {
      resultText: result.content ? result.content : emptyToolResultMessage,
      success: result.success !== false,
      sources: result.sources ?? [],
      metadata: result.metadata ?? {},
      terminateTurn: result.terminateTurn === true || result.terminate_turn === true,
      pauseForUser: result.pauseForUser ?? result.pause_for_user ?? null,
      modelMessage: result.modelMessage ?? result.model_message ?? null,
      publicResult: result.publicResult ?? result.public_result ?? null,
    };
  } catch (error) {
    const cause = errorMessage(error) || error?.name || 'Error';
    const failureMessage =
      typeof errorFactory === 'function'
        ? errorFactory(toolName, cause)
        : `Error executing ${toolName}: ${cause}`;
    return {
      resultText: failureMessage,
      success: false,
      sources: [],
      metadata: { error: errorMessage(error) },
      terminateTurn: false,
      pauseForUser: null,
    };
  }
}

function errorMessage(error) {
  if (error === null || error === undefined) return '';
  return String(error.message ?? error);
}

// ---------------------------------------------------------------- 汇总

/**
 * 走一遍工具结果：发 `tool_result` 事件并组装 outcome。
 *
 * 第一个终止的工具胜出；第一个暂停的工具**独立地**胜出。
 * 暂停与终止在循环层面互斥 —— 暂停会跳过终止事件的发射，因为用户回复后
 * 回合会继续，最终答案是那时候才产生的真答案。
 */
export async function collectOutcome({
  prepared,
  results,
  perToolTraceMeta,
  suppressUiIndices = null,
  stream,
  source = '',
  stage = '',
}) {
  const aggregatedSources = [];
  const toolMessages = [];
  const modelMessages = [];
  let modelImageCount = 0;
  const toolMetadataById = {};
  let terminate = false;
  let terminatePayload = null;
  let pause = false;
  let pausePayload = null;
  let pauseToolCallId = null;
  const suppressed = suppressUiIndices ?? new Set();

  const count = Math.min(prepared.length, results.length);
  for (let toolIndex = 0; toolIndex < count; toolIndex += 1) {
    const [toolCallId, toolName] = prepared[toolIndex];
    const result = results[toolIndex] ?? { resultText: '' };
    const resultText = String(result.resultText ?? '');
    const toolMeta = perToolTraceMeta[toolIndex];
    const toolExtraMeta = typeof result.metadata === 'object' ? result.metadata : null;
    const publicResult = result.publicResult;
    const projected = publicResult !== null && publicResult !== undefined && typeof publicResult === 'object';
    const publicText = projected ? String(publicResult.content ?? '') : resultText;
    const publicMeta = projected ? publicResult.metadata : toolExtraMeta;

    let resultEventMeta = mergeTraceMetadata(toolMeta, { trace_kind: 'tool_result' });
    if (publicMeta && typeof publicMeta === 'object' && Object.keys(publicMeta).length > 0) {
      resultEventMeta = mergeTraceMetadata(resultEventMeta, { tool_metadata: { ...publicMeta } });
    }
    if (!suppressed.has(toolIndex) && stream) {
      await stream.toolResult(toolName, publicText, { source, stage, metadata: resultEventMeta });
    }

    const sourceCarrier = projected ? publicResult : result;
    aggregatedSources.push(...(sourceCarrier?.sources ?? []));

    // 每条 id 都要有一条回复，哪怕它被跳过或失败 —— 下一轮的 API 调用要求配对。
    toolMessages.push({ role: 'tool', tool_call_id: toolCallId, name: toolName, content: resultText });

    const privateMessage = result.modelMessage;
    if (privateMessage && typeof privateMessage === 'object' && privateMessage.role === 'user') {
      const content = privateMessage.content;
      if (Array.isArray(content)) {
        const imageCount = content.filter(
          (part) => part && typeof part === 'object' && part.type === 'image_url',
        ).length;
        if (imageCount > 0 && modelImageCount + imageCount <= 2) {
          modelMessages.push({ ...privateMessage, _after_tool_call_id: toolCallId });
          modelImageCount += imageCount;
        }
      }
    }

    if (toolExtraMeta && Object.keys(toolExtraMeta).length > 0) {
      toolMetadataById[toolCallId] = { ...toolExtraMeta };
    }

    if (result.terminateTurn === true && !terminate) {
      terminate = true;
      terminatePayload = {
        tool_name: toolName,
        content: resultText,
        metadata: toolExtraMeta ? { ...toolExtraMeta } : {},
      };
    }

    const pauseRequest = result.pauseForUser;
    if (pauseRequest && !pause) {
      pause = true;
      pausePayload = { tool_name: toolName, ask_user: pauseRequest };
      pauseToolCallId = toolCallId;
    }
  }

  return createDispatchOutcome({
    sources: aggregatedSources,
    toolMessages,
    modelMessages,
    toolMetadataById,
    terminate,
    terminatePayload,
    pause,
    pausePayload,
    pauseToolCallId,
  });
}

// ---------------------------------------------------------------- 总调度

/**
 * 并行执行工具调用，组装一个 `DispatchOutcome`。
 */
export async function dispatchToolCalls({
  toolCalls,
  context = {},
  stream,
  source = '',
  stage = '',
  iterationIndex = 0,
  registry,
  kwargAugmenter = null,
  rebindingTools = [],
  retrieveMetaFactory = null,
  toolCallLabel = 'Tool call',
  retrieveLabel = 'Retrieve',
  emptyToolResultMessage = '',
  startRetrievalMessage = 'Starting retrieval',
  tooManyToolCallsMessage = null,
  toolErrorMessageFactory: errorFactory = null,
  traceIdPrefix = 'iter',
  toolTimeout = null,
  toolMaxRetries = 0,
} = {}) {
  if (!registry) throw new Error('dispatchToolCalls requires a tool registry');
  const allCalls = [...(toolCalls ?? [])];
  const skippedCalls = allCalls.slice(MAX_PARALLEL_TOOL_CALLS);
  let executedCalls = allCalls;
  if (allCalls.length > MAX_PARALLEL_TOOL_CALLS) {
    if (tooManyToolCallsMessage && stream) {
      await stream.progress(tooManyToolCallsMessage, {
        source,
        stage,
        metadata: { trace_kind: 'warning' },
      });
    }
    executedCalls = allCalls.slice(0, MAX_PARALLEL_TOOL_CALLS);
  }

  const { prepared, rawArgs } = prepareToolArgs(executedCalls, context, kwargAugmenter, registry);
  const duplicateOf = detectDuplicateCalls(prepared);
  const suppressUiIndices = new Set(
    [...duplicateOf.keys()].filter((index) => PAUSE_LAST_TOOLS.includes(prepared[index][1])),
  );
  const perToolTraceMeta = buildPerToolTraceMeta(prepared, {
    context,
    iterationIndex,
    stage,
    toolCallLabel,
    traceIdPrefix,
    registry,
  });

  // 所有调用的参数在任何调用执行前就绑好了（见文件头），因此 tool_call 事件先全发完，
  // 前端才能在一轮开始时就摆出全部卡片，而不是执行到哪个冒哪个。
  for (let toolIndex = 0; toolIndex < prepared.length; toolIndex += 1) {
    if (suppressUiIndices.has(toolIndex)) continue;
    const [, toolName, execArgs] = prepared[toolIndex];
    const displayArgs = displayArgsFor(registry, toolName, execArgs);
    if (stream) {
      await stream.toolCall(toolName, displayArgs, {
        source,
        stage,
        metadata: mergeTraceMetadata(perToolTraceMeta[toolIndex], { trace_kind: 'tool_call' }),
      });
    }
  }

  const runOne = async (toolIndex) => {
    const primaryIndex = duplicateOf.get(toolIndex);
    if (primaryIndex !== undefined) {
      return duplicateStubResult({
        primaryCallId: prepared[primaryIndex][0],
        toolName: prepared[toolIndex][1],
      });
    }
    const [, toolName, execArgs] = prepared[toolIndex];
    const rejection = await rejectIfArgsMissing({
      registry,
      toolName,
      execArgs,
      stream,
      source,
      stage,
      traceMeta: perToolTraceMeta[toolIndex],
    });
    if (rejection !== null) return rejection;

    // 暂停类工具刻意等用户交互，墙钟超时不能取消这个等待。
    const policyExempt =
      PAUSE_LAST_TOOLS.includes(toolName) ||
      (toolName === 'consult_subagent' &&
        execArgs?._subagent &&
        typeof execArgs._subagent === 'object' &&
        execArgs._subagent.kind === 'partner_group');

    return executeToolCall({
      registry,
      toolName,
      toolArgs: execArgs,
      stream,
      source,
      stage,
      traceMeta: perToolTraceMeta[toolIndex],
      retrieveMeta:
        retrieveMetaFactory !== null && retrieveMetaFactory !== undefined
          ? retrieveMetaFactory(
              perToolTraceMeta[toolIndex],
              toolName,
              publicInvocationArgs(execArgs),
            )
          : null,
      emptyToolResultMessage,
      startRetrievalMessage,
      toolErrorMessageFactory: errorFactory ?? DEFAULT_TOOL_ERROR_FACTORY,
      retrieveLabel,
      toolTimeout: policyExempt ? null : toolTimeout,
      toolMaxRetries: policyExempt ? 0 : toolMaxRetries,
      context,
    });
  };

  /**
   * 从模型的原始参数重绑服务端持有的参数。
   *
   * 与第一次绑定一样幂等，所以任何阶段边界都能重绑；重复调用在执行前就短路了，
   * 没有可重绑的东西。
   */
  const rebind = (indices) => {
    if (kwargAugmenter === null || kwargAugmenter === undefined) return;
    for (const index of indices) {
      if (duplicateOf.has(index)) continue;
      const [callId, name] = prepared[index];
      const [canonicalName, resolvedArgs] = resolveToolRequest(registry, name, rawArgs[index]);
      prepared[index] = [callId, name, kwargAugmenter(canonicalName, resolvedArgs, context)];
    }
  };

  const rebinding = [];
  const pausing = [];
  const ordinary = [];
  const rebindingSet = new Set(rebindingTools ?? []);
  for (let index = 0; index < prepared.length; index += 1) {
    const name = prepared[index][1];
    if (rebindingSet.has(name)) rebinding.push(index);
  }
  const rebindingTaken = new Set(rebinding);
  for (let index = 0; index < prepared.length; index += 1) {
    const name = prepared[index][1];
    if (PAUSE_LAST_TOOLS.includes(name) && !rebindingTaken.has(index)) pausing.push(index);
  }
  const pausingTaken = new Set(pausing);
  for (let index = 0; index < prepared.length; index += 1) {
    if (!rebindingTaken.has(index) && !pausingTaken.has(index)) ordinary.push(index);
  }

  const byIndex = new Map();
  if (rebinding.length > 0) {
    for (const index of rebinding) byIndex.set(index, await runOne(index));
    rebind(ordinary);
  }
  if (ordinary.length > 0) {
    const settled = await Promise.all(ordinary.map((index) => runOne(index)));
    ordinary.forEach((index, position) => byIndex.set(index, settled[position]));
  }
  if (pausing.length > 0) {
    rebind(pausing);
    const settled = await Promise.all(pausing.map((index) => runOne(index)));
    pausing.forEach((index, position) => byIndex.set(index, settled[position]));
  }

  // 结果按**原始顺序**回填，不是按执行顺序：role=tool 消息的顺序必须与
  // assistant 消息里 tool_calls 的顺序一致，否则下一轮 provider 会拒。
  const results = prepared.map((_entry, index) =>
    byIndex.has(index) ? byIndex.get(index) : { resultText: '' },
  );

  const outcome = await collectOutcome({
    prepared,
    results,
    perToolTraceMeta,
    suppressUiIndices,
    stream,
    source,
    stage,
  });

  // assistant 消息里仍然包含**每一个**请求过的调用。Chat Completions 与 Responses
  // 都要求每个 id 都有一条输出，哪怕执行上限把它跳过了；否则下一轮与硬收尾都会失败。
  // 这些回复不参与执行 / 参数绑定，也不进"已执行工具"的 trace。
  for (const call of skippedCalls) {
    outcome.toolMessages.push({
      role: 'tool',
      tool_call_id: call.id,
      name: call.name,
      content:
        `Tool call not executed: this round is limited to ${MAX_PARALLEL_TOOL_CALLS} ` +
        'tool calls. Request this call again in a later round if still needed, ' +
        `with at most ${MAX_PARALLEL_TOOL_CALLS} calls per round.`,
    });
  }

  return outcome;
}

/**
 * 给一次调用的名字 + 参数算一个稳定短摘要。测试与幂等判断用；同名同参同值。
 */
export function callDigest(toolName, args) {
  return createHash('sha1').update(`${toolName}\u0000${stableArgsKey(args ?? {})}`).digest('hex').slice(0, 12);
}
