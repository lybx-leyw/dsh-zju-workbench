/**
 * `dsh-zhiyun-core-tool` —— 工具协议与调度层。
 *
 * 上游对应：`core/{tool_protocol,context,trace,stream,capability_protocol}.py`、
 * `runtime/registry/tool_registry.py`、`runtime/agentic/{tool_dispatch,tool_arg_guard,loop,labels,messages}.py`、
 * `runtime/{stream_bus,capability_catalog,request_contracts,home}.py`、`utils/json_parser.py`。
 *
 * # 对外主契约
 *
 * ```js
 * import { createToolRegistry } from 'dsh-zhiyun-core-tool';
 * const registry = createToolRegistry();
 * registry.register(tool);       // tool: {name, description, parameters, handler}
 * registry.resolve(names, ctx);  // → tool[]
 * await registry.dispatch(call, ctx); // call: {id, name, arguments} → {ok, result} | {ok:false, error}
 * registry.schemas(names);       // → JSON Schema[]，可直接塞进 OpenAI tools 参数
 * ```
 *
 * # 三套循环，别混
 *
 * 1. `runAgenticLoop`（loop.js）—— **标签协议**驱动的循环。谁终止由 `protocol`
 *    参数决定（EXPLORE 的 FINISH、PLAN 的 PLAN、QUIZ 的 FINISH…），不是硬编码。
 *    `streamBodyLive` 决定终止标签的正文明珠是逐 chunk 推流，还是只作返回值。
 * 2. `registry.runToolLoop` —— **原生函数调用**驱动的循环。一轮带 tool_calls 就是
 *    工具轮，不带就是收尾轮，不问模型要标签。
 * 3. `registry.dispatchRound` —— 只做一轮。集成层自己掌握模型客户端时用。
 *
 * 三者的共同底座都是 `dispatchToolCalls`。
 */

export {
  createToolRegistry,
  normalizeHandlerResult,
  DEFAULT_TOOL_ALIASES,
  DEFAULT_MAX_ROUNDS,
} from './registry.js';

export {
  // 参数行 → JSON Schema
  parameterSchema,
  parametersObjectSchema,
  toOpenAISchema,
  normalizeDefinition,
  providerIdentity,
  sensitiveArgNames,
  PARAMETER_TYPES,
  isPlainObject,
} from './schema.js';

export {
  // trace 元数据
  ANSWER_BEARING_CALL_KINDS,
  isAnswerBearingCallKind,
  newCallId,
  buildTraceMetadata,
  deriveTraceMetadata,
  mergeTraceMetadata,
} from './trace.js';

export {
  // 流事件协议
  StreamEventType,
  isStreamEventType,
  createStreamEvent,
  eventToDict,
  eventToJson,
} from './stream.js';

export {
  // 流总线
  StreamBus,
  createStreamBus,
  coalesceEvents,
  isCoalescableEventType,
  COALESCABLE_EVENT_TYPES,
  registerBus,
  unregisterBus,
  getBus,
} from './stream-bus.js';

export {
  // 参数守卫
  RequiredArg,
  isSupplied,
  allowsNull,
  requiredArgs,
  unsatisfiedRequiredArgs,
  missingRequiredArgs,
  missingArgsMessage,
} from './arg-guard.js';

export {
  // 调度
  MAX_PARALLEL_TOOL_CALLS,
  PAUSE_LAST_TOOLS,
  TOOL_ERROR_NOTICE_KEY,
  TOOL_EVENT_PROJECTION,
  ToolEventProjection,
  createDispatchOutcome,
  toolErrorMessageFactory,
  prepareToolArgs,
  resolveToolRequest,
  detectDuplicateCalls,
  duplicateStubResult,
  rejectIfArgsMissing,
  buildPerToolTraceMeta,
  providerOf,
  publicInvocationArgs,
  displayArgsFor,
  executeToolCall,
  collectOutcome,
  dispatchToolCalls,
  callDigest,
} from './dispatch.js';

export {
  // 标签驱动循环
  LABEL_UNKNOWN,
  LABEL_PROBE_MAX_CHARS,
  REPAIR_PREVIEW_CHARS,
  TRUNCATION_MARKER,
  DEFAULT_MAX_ITERATIONS,
  pipelineModelCallBudget,
  classifyLabel,
  findInlineLabels,
  protocolViolation,
  appendRepairMessages,
  createLoopOutcome,
  runAgenticLoop,
} from './loop.js';

export {
  // 会话消息
  assistantMessage,
  assistantMessageWithToolCalls,
  withTransientModelMessages,
  extendTransientModelMessages,
} from './messages.js';

export {
  // 上下文
  createAttachment,
  createWorkspaceRuntimeContext,
  createTurnRuntimeContext,
  createInteractionState,
  createCapabilityOutput,
  createUnifiedContext,
} from './context.js';

export {
  // 能力层
  CapabilityPrerequisiteError,
  CapabilityCatalog,
  TurnCapability,
  createCapabilityManifest,
  getCapabilityCatalog,
  setCapabilityCatalog,
} from './capability.js';

export {
  // 请求契约
  DEEP_QUESTION_FIELDS,
  CAPABILITY_CONFIG_VALIDATORS,
  CAPABILITY_REQUEST_SCHEMAS,
  validateDeepQuestionRequestConfig,
  validateVisualizeRequestConfig,
  validateCapabilityConfig,
  getCapabilityRequestSchema,
  cleanPublicConfig,
} from './request-contracts.js';

export {
  // 参数解析
  parseToolArguments,
  parseToolArgumentsObject,
} from './json.js';

export {
  // 运行时 home
  DEEPTUTOR_HOME_ENV,
  getPackageRoot,
  setPackageRoot,
  getRuntimeHome,
  getRuntimeDataRoot,
  validateRuntimeHome,
} from './home.js';
