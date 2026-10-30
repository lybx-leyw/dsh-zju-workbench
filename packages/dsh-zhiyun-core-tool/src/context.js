/**
 * 统一上下文 —— 上游 `core/context.py` 的 JS 对位。
 *
 * 只保留出题链实际用到的字段，但**形状与命名逐字对齐**（`session_id`、
 * `capability_output`、`extension_state` 等仍是 snake_case）：这是跨包契约，
 * 改名等于让四个包的对接全部错位。
 *
 * # 为什么 `runtime.workspace` 的物理路径不许外流
 *
 * `WorkspaceRuntimeContext.root` / `output_dir` 是宿主机的绝对路径。它们可以喂给
 * 工具，但**绝不能**进模型消息、持久化 metadata 或公开 URL —— 一份公开仓库的
 * 讲义里带着 `C:\Users\...` 就是信息泄露。
 */

/** 用户消息里带的一个文件 / 图片附件。 */
export function createAttachment({
  type = 'file',
  url = '',
  base64 = '',
  filename = '',
  mimeType = '',
  id = '',
  extractedText = '',
} = {}) {
  return {
    type,
    url,
    base64,
    filename,
    mime_type: mimeType,
    id,
    extracted_text: extractedText,
  };
}

/** 一个回合内冻结的内容工作区。物理路径只在运行时用。 */
export function createWorkspaceRuntimeContext({
  workspaceId = '',
  root = '',
  outputDir = '',
  logicalOutputDir = 'outputs',
  securityLevel = 'off',
  instructions = '',
} = {}) {
  return {
    workspace_id: workspaceId,
    root,
    output_dir: outputDir,
    logical_output_dir: logicalOutputDir,
    security_level: securityLevel,
    instructions,
  };
}

/**
 * 运行时拥有的不可序列化执行状态。
 *
 * `min_loop_rounds` 是给"至少跑 N 轮再允许收尾"的能力用的：模型常常第一轮就想
 * FINISH，而探索阶段需要它真的读过东西。0 表示不设下限。
 */
export function createTurnRuntimeContext({ turnId = '', minLoopRounds = 0 } = {}) {
  return {
    turn_id: turnId,
    wait_for_user_reply: null,
    provider_response_state: null,
    model_history: null,
    model_turn: null,
    previous_model_turn: null,
    subagent_consult_budget: null,
    consult_partner_id: null,
    partner_discussion_group_id: null,
    min_loop_rounds: minLoopRounds,
    workspace: null,
  };
}

/** 循环与交互式工具之间交换的可变状态。 */
export function createInteractionState({ endLoop = false, userAnswers = [] } = {}) {
  return { end_loop: endLoop, user_answers: userAnswers };
}

/** 一个回合能力发布的终态结构化输出。 */
export function createCapabilityOutput({
  agentOutput = '',
  eventMetadata = {},
  answerPublished = false,
} = {}) {
  return {
    agent_output: agentOutput,
    event_metadata: eventMetadata,
    answer_published: answerPublished,
  };
}

/**
 * 一次用户回合里，能力与工具需要的全部东西。
 *
 * `enabled_tools` 的三态很重要：`null` = "没指定"，`[]` = "明确关掉所有可选工具"。
 * 把 `[]` 也当成"没指定"会让用户关掉的工具偷偷挂回来。
 */
export function createUnifiedContext({
  sessionId = '',
  userMessage = '',
  conversationHistory = [],
  enabledTools = null,
  allowedBuiltinTools = null,
  activeCapability = null,
  knowledgeBases = [],
  attachments = [],
  configOverrides = {},
  language = 'en',
  memoryContext = '',
  learningJournalContext = '',
  personaContext = '',
  sidebarContext = '',
  skillsManifest = '',
  sourceManifest = '',
  runtime = undefined,
  interaction = undefined,
  capabilityOutput = undefined,
  extensionState = {},
  metadata = {},
} = {}) {
  const context = {
    session_id: sessionId,
    user_message: userMessage,
    conversation_history: conversationHistory,
    enabled_tools: enabledTools,
    allowed_builtin_tools: allowedBuiltinTools,
    active_capability: activeCapability,
    knowledge_bases: knowledgeBases,
    attachments,
    config_overrides: configOverrides,
    language,
    memory_context: memoryContext,
    learning_journal_context: learningJournalContext,
    persona_context: personaContext,
    sidebar_context: sidebarContext,
    skills_manifest: skillsManifest,
    source_manifest: sourceManifest,
    runtime: runtime ?? createTurnRuntimeContext(),
    interaction: interaction ?? createInteractionState(),
    capability_output: capabilityOutput ?? createCapabilityOutput(),
    extension_state: extensionState,
    metadata,
  };
  // 方法挂在实例上而不是原型链上：调用方处处传纯对象，`{...context}` 之后
  // 还得能用，所以扩展命名空间必须能跟着拷贝走（用闭包拿不到拷贝后的那份）。
  context.extension = function extension(namespace) {
    const normalized = String(namespace ?? '').trim();
    if (!normalized) throw new Error('Extension namespace must not be empty');
    if (!context.extension_state[normalized]) context.extension_state[normalized] = {};
    return context.extension_state[normalized];
  };
  return context;
}
