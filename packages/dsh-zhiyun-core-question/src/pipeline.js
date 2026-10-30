/**
 * 出题流水线本体：explore → plan → quiz → repair。
 *
 * 上游对应：`agents/question/pipeline.py`（2309 行）。四个阶段的顺序、
 * 提示词注入点、失败分支逐条对照 SPEC（`.verify-scratch/PIPELINE-SPEC.md`）。
 *
 * # 为什么四阶段不能换、不能并行
 *
 * - **explore 先于 plan**：plan 的提示词里要读 `exploration_trace`（阶段 1 的推理 +
 *   工具轨迹）。先规划再探索，planner 只能凭标题瞎猜考点。
 * - **plan 先于 quiz**：class 里的 template 是「本题考什么、什么题型、什么难度」的
 *   唯一来源，quiz 阶段的 `question_type` 会被 template **无条件覆盖**（T8）。
 * - **quiz 串行**：第 N 题的提示词里带 `previous_questions`（前 N-1 题题面），
 *   保证不重复。`Promise.all` 会让 15 道题互相看不见，去重全靠运气。
 * - **repair 跟在单题之后**：它吃的是这一题归一化后的 payload 与 issues 码表。
 *
 * # 三处最容易实现错的地方（实现里都留了注释）
 *
 * 1. `if repaired` 是 **Python 真值**判断：`{}`（解析失败）不算修复成功。
 * 2. repair 修复失败**仍然出题**，用 `[Generation failed] {topic}` / `"N/A"` 占位。
 * 3. explore 的 `streamBodyLive` 为 true（前言逐字上屏）、quiz 为 false（裸 JSON 绝不刷屏）。
 */

import { createTranslator, appendLanguageDirective, loadPrompts, parseLanguage } from './i18n.js';
import {
  collectQuizIssues,
  normalizeQuizPayload,
  payloadToQaPair,
  pythonTruthy,
  qaPairToDict,
  templateToDict,
} from './quiz-payload.js';
import { parsePlan } from './plan.js';
import { parseQuizPayload } from './json.js';
import {
  renderAttachmentsSummary,
  renderExplorationTrace,
  renderPlanSummary,
  renderPreviousQuestions,
  renderQuestionMarkdown,
  renderQuizHistory,
  renderReferenceBlock,
  renderSummaryMarkdown,
} from './render.js';
import {
  formatAllowedTypes,
  formatPerTypeCounts,
  normalizePerTypeCounts,
  normalizeTypeList,
  QuestionType,
  VALID_QUESTION_TYPES,
} from './types.js';
import {
  assistantMessage,
  coreLlmRunLabeledStep,
  createStreamBus,
  findInlineLabels,
  runAgenticLoop,
} from './deps.js';
import { runLabeledStep as localRunLabeledStep } from './labeled-step.js';
import { toProductQuestions } from './product-questions.js';

export const SOURCE = 'deep_question';
export const FEATURE = 'deep_question';

export const STAGE_EXPLORING = 'exploring';
export const STAGE_PLANNING = 'planning';
export const STAGE_QUIZZING = 'quizzing';

export const LABEL_THINK = 'THINK';
export const LABEL_TOOL = 'TOOL';
export const LABEL_FINISH = 'FINISH';
export const LABEL_PLAN = 'PLAN';

export const DEFAULT_MAX_EXPLORE_ITERATIONS = 8;
export const DEFAULT_MAX_QUIZ_ITERATIONS_PER_QUESTION = 5;
export const FINALIZATION_REPAIR_ATTEMPTS = 2;
export const RETRY_REASONING_EFFORT = 'low';
export const QUESTION_TEMPERATURE = 0.4;
export const TOOL_SUMMARIZER_TEMPERATURE = 0.2;

/** 上游 `DEFAULT_QUESTION_PARAMS`（loader.py:314-320）：逐阶段 token 预算。 */
export const DEFAULT_QUESTION_PARAMS = Object.freeze({
  answering: { max_tokens: 4000 },
  planning: { max_tokens: 6000 },
  quiz_finish: { max_tokens: 3000 },
  repair: { max_tokens: 2500 },
  tool_summarizer: { max_tokens: 800 },
});

/** 四套协议（pipeline.py:110-137）。`allowed` 的顺序决定标签探测优先序。 */
export const PROTOCOL_EXPLORE = Object.freeze({
  allowed: [LABEL_THINK, LABEL_TOOL, LABEL_FINISH],
  terminal: [LABEL_FINISH],
  intermediate: [LABEL_THINK],
  final: [LABEL_FINISH],
  toolLabel: LABEL_TOOL,
});

/**
 * plan 协议：`final` 为空是**有意的**。
 * plan 文本从不以流式正文出现，只作为返回值解析（labeled_step 在 finalMeta=null
 * 时本来就 buffer）。若把它塞进 final，会在“还没有模板”的时候先往气泡里推一段
 * 带着 `{"templates": ...}` 的 JSON。
 */
export const PROTOCOL_PLAN = Object.freeze({
  allowed: [LABEL_PLAN],
  terminal: [LABEL_PLAN],
  intermediate: [],
  final: [],
  toolLabel: null,
});

export const PROTOCOL_QUIZ = Object.freeze({
  allowed: [LABEL_THINK, LABEL_TOOL, LABEL_FINISH],
  terminal: [LABEL_FINISH],
  intermediate: [LABEL_THINK],
  final: [LABEL_FINISH],
  toolLabel: LABEL_TOOL,
});

export const PROTOCOL_REPAIR = Object.freeze({
  allowed: [LABEL_FINISH],
  terminal: [LABEL_FINISH],
  intermediate: [],
  final: [LABEL_FINISH],
  toolLabel: null,
});

/** 模型调用预算被击穿。**只在主链**计数（不含 Tool Summarizer，见 SPEC §5.3）。 */
export class ModelBudgetExceededError extends Error {
  constructor(limit, used) {
    super(`模型调用次数已达上限 ${limit}（已用 ${used}），停止继续出题`);
    this.name = 'ModelBudgetExceededError';
    this.code = 'MODEL_BUDGET_EXCEEDED';
    this.limit = limit;
    this.used = used;
  }
}

/** 主链预算：`10 + 2 + 9N`。转发 core-tool 的公式，不在这里另写一份。 */
export function modelCallBudget(questionCount) {
  const n = Math.max(0, Number(questionCount) || 0);
  return 10 + 2 + 9 * n;
}

/** 空值安全的文本化。 */
function text(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * 把智云词表的题型名折回上游词表。
 *
 * 契约里 `type` 是上游名（`choice` / `fill_in_blank` / `concept` / `short_answer`），
 * 但产品侧有一处会传智云名（`nativeQuizContract` 的映射表就在产品里，将来它若
 * 直接把 `task.type` 透传过来，这里不该静默丢弃全部题型）。两种词表都收：
 *
 * `mcq → choice`、`trueFalse → concept`、`cloze → fill_in_blank`、
 * `shortAnswer → short_answer`。
 *
 * ⚠️ `trueFalse → concept` 是**判断题**的方向，不是"概念填空"——见 NOTES §7.1。
 */
export function canonicalTypeName(raw) {
  const value = text(raw).trim().toLowerCase();
  const aliases = {
    mcq: 'choice',
    choice: 'choice',
    truefalse: 'concept',
    judge: 'concept',
    concept: 'concept',
    cloze: 'fill_in_blank',
    fill_in_blank: 'fill_in_blank',
    shortanswer: 'short_answer',
    short_answer: 'short_answer',
    written: 'written',
    coding: 'coding',
  };
  return aliases[value] ?? value;
}

/** `per_type_counts` 的键也允许智云名。 */
function canonicalizeCountKeys(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(raw)) out[canonicalTypeName(key)] = value;
  return out;
}

/**
 * 从讲义树拼一句「用户请求」。
 *
 * 上游的 `user_message` 来自 `context.user_message`（产品侧拼的主题串）。
 * 本包签名里没有它，于是从 `lecture` 的结构推出一个等价物：先列章节，
 * 再点明题型/难度/题数——plan 与 explore 的提示词都会读到这段。
 */
export function buildUserMessage(lecture, { count, type, difficulty }) {
  const chapters = Array.isArray(lecture?.chapters) ? lecture.chapters : [];
  const titles = [];
  for (const chapter of chapters) {
    const chapterTitle = text(chapter?.title).trim();
    const topics = Array.isArray(chapter?.topics) ? chapter.topics : [];
    const topicTitles = topics.map((topic) => text(topic?.title).trim()).filter(Boolean);
    if (chapterTitle && topicTitles.length) titles.push(`${chapterTitle}（${topicTitles.join('、')}）`);
    else if (chapterTitle) titles.push(chapterTitle);
    else titles.push(...topicTitles);
  }
  const scope = titles.length ? titles.join('；') : '所附讲义';
  const typeHint = type ? `题型：${type}；` : '';
  const difficultyHint = difficulty ? `难度：${difficulty}；` : '';
  return `请依据所附讲义出 ${count} 道题。${typeHint}${difficultyHint}覆盖范围：${scope}。只使用讲义内的知识，不要引入外部资料。`;
}

/** 工具清单的提示词渲染（上游 `_tool_list_text`，1714-1720）。 */
export function renderToolList(schemas, language) {
  if (!Array.isArray(schemas) || !schemas.length) {
    return String(parseLanguage(language)).toLowerCase().startsWith('zh') ? '- 无' : '- none';
  }
  const lines = [];
  for (const schema of schemas) {
    const fn = schema?.function ?? schema;
    if (!fn?.name) continue;
    const description = text(fn.description).trim();
    lines.push(description ? `- \`${fn.name}\` — ${description}` : `- \`${fn.name}\``);
  }
  return lines.length
    ? lines.join('\n')
    : String(parseLanguage(language)).toLowerCase().startsWith('zh') ? '- 无' : '- none';
}

/**
 * 是否走原生工具调用（上游 `_use_native_tools`，1616-1623）。
 *
 * 上游注释写得很清楚：**返回 True 但没有工具**会让模型在正文里编造文本式
 * "tool calls"，所以必须两者都满足。
 *
 * 反向的坑来自 provider 能力表：严格表会把 SiliconFlow / Gemini / Zhipu 等
 * 「已注册的 OpenAI 兼容云 provider」判成不支持工具，于是 explore 退化成散文、
 * 工具链根本不跑。上游 `can_use_native_tool_calling` 对这类 provider 乐观一档，
 * 这里复刻同样的乐观：只有**明确本地**的 provider 才相信严格表的否定结论。
 */
export function useNativeTools({ llm, toolSchemas, modelInfo } = {}) {
  if (!Array.isArray(toolSchemas) || toolSchemas.length === 0) return false;
  const info = modelInfo ?? llm?.info ?? null;
  const declared = info?.capabilities?.tools;
  if (declared === true) return true;
  if (declared === false) {
    // 严格表判否。上游只对「明确本地」的 provider 相信这个否定结论；
    // 已注册的云端 OpenAI 兼容网关（SiliconFlow / Gemini / Zhipu / Qianfan /
    // NVIDIA NIM / Volc-BytePlus …）一律乐观放行，否则它们的 explore 会退化成散文。
    const provider = String(info?.provider ?? llm?.provider ?? '').toLowerCase();
    const localOnly = ['ollama', 'lmstudio', 'llamacpp', 'llama_cpp', 'local', 'vllm'];
    return !localOnly.includes(provider);
  }
  // 没有能力表：有工具就用。宁可让模型试一次被拒，也不要静默退化。
  return true;
}

/**
 * 跑一次出题。
 *
 * @param {object} options
 * @param {{chapters:Array}} options.lecture       讲义树（同时也是工具能读到的素材）
 * @param {number} options.count                   题数（`0` / 负数 / 缺省都按 1，不是 0 题）
 * @param {string} [options.type]                  指定题型；给定时等价于「allowed 只有它」
 * @param {string} [options.difficulty]            easy / medium / hard
 * @param {object} options.llm                     core-llm 实例（`prepareCall` 必需）
 * @param {object} [options.tools]                 core-tool 注册表（`schemas` / `dispatch`）
 * @param {(event:{stage:string})=>void} [options.onEvent]
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.config]                {language, perTypeCounts, kbName, quizHistory,
 *                                                  templatesOverride, budgets, stream}
 * @returns {Promise<{questions:object[], mode:string, response:string, summary:object, usage:object}>}
 */
export async function runDeepQuestion({
  lecture,
  count,
  type,
  difficulty,
  llm,
  tools,
  onEvent,
  signal,
  config = {},
} = {}) {
  if (!llm || typeof llm.prepareCall !== 'function') {
    throw new Error('runDeepQuestion 需要 llm.prepareCall(config) → {stream()})');
  }
  signal?.throwIfAborted?.();

  // ---- 参数归一化：顺序照抄上游 run()（483-506）----
  // `num_questions=0` → 1。产品传 0 是"没填"，不是"别出题"。
  const requested = Math.max(1, Math.trunc(Number(count) || 1));
  const language = parseLanguage(config.language ?? 'zh');
  const typeList = normalizeTypeList(
    type ? [canonicalTypeName(type)] : (config.questionTypes ?? []).map(canonicalTypeName),
  );
  const perTypeCounts = normalizePerTypeCounts(canonicalizeCountKeys(config.perTypeCounts), typeList);
  const normalizedDifficulty = text(difficulty).trim().toLowerCase();
  const templatesOverride = Array.isArray(config.templatesOverride) && config.templatesOverride.length
    ? config.templatesOverride
    : null;
  const quizHistory = Array.isArray(config.quizHistory) ? config.quizHistory : [];
  const attachments = Array.isArray(config.attachments) ? config.attachments : [];

  const prompts = config.prompts ?? loadPrompts(language);
  const t = createTranslator(prompts);
  const budgets = mergeBudgets(config.budgets);

  const stream = config.stream ?? createStreamBus({ assignSeq: false });
  const emitStage = (stage) => {
    try {
      onEvent?.({ stage });
    } catch {
      // 观察者自己的异常不能打断出题
    }
  };

  // ---- 预算 ----
  const limit = Number(config.maxModelCalls) > 0
    ? Math.trunc(Number(config.maxModelCalls))
    : modelCallBudget(requested);
  const budget = { limit, used: 0 };

  // ---- 工具面 ----
  const toolSchemas = collectToolSchemas(tools, config.toolNames);
  const modelInfo = typeof llm.resolveModelInfo === 'function'
    ? await llm.resolveModelInfo(llm.provider, llm.model).catch(() => null)
    : llm.info ?? null;
  const nativeTools = useNativeTools({ llm, toolSchemas, modelInfo });
  const activeSchemas = nativeTools ? toolSchemas : null;
  const toolListText = renderToolList(toolSchemas, language);

  const step = makeStepRunner({
    llm, stream, language, budgets, budget, temperature: QUESTION_TEMPERATURE, signal,
  });

  const userMessage = config.userMessage ?? buildUserMessage(lecture, {
    count: requested, type: typeList.join('/') || type, difficulty: normalizedDifficulty,
  });

  // Tool Summarizer：explore 专用（quiz 不挂）。默认开启，与上游一致
  // （`self.tool_summarizer_enabled = bool(summarizer_cfg.get("enabled", True))`）。
  const summarizerEnabled = config.toolSummarizer?.enabled !== false;
  const toolSummarizer = summarizerEnabled
    ? {
      run: ({ toolName, toolResult, iteration }) => summarizeToolResult({
        t, step, language, toolName, toolResult, iteration, stream,
        maxTokens: config.toolSummarizer?.max_tokens
          ?? budgets.tool_summarizer.max_tokens,
      }),
    }
    : null;

  const ctx = {
    t, stream, language, llm, tools, signal, budgets, budget,
    activeSchemas, toolListText, lecture, config,
    perTypeCounts, normalizedDifficulty, requested,
    toolSummarizer,
    // 工具 handler 拿到的 ctx：讲义原文 + 语言 + 知识库名。
    // 工具不认识这些字段时会忽略，认识的那几个（读讲义 / 检索）靠它干活。
    toolContext: {
      lecture,
      language,
      kbName: config.kbName ?? null,
      history: quizHistory,
      signal,
    },
  };

  // ---- 阶段编排（_run_inner，515-614）----
  const isMimic = templatesOverride !== null;
  let finishText = '';
  let explorationTrace;
  let plan;

  if (isMimic) {
    // mimic 模式：没有探索阶段，但轨迹要留**非空**的标记串（T15）。
    explorationTrace = t('empty.no_exploration_trace');
    plan = { analysis: '', templates: templatesOverride.map(normalizeTemplate) };
    // `map` 会把 (value, index, array) 一起传给 normalizeTemplate，正好用上位置补 id。
  } else {
    emitStage(STAGE_EXPLORING);
    const explored = await explore({
      ...ctx,
      step,
      userMessage,
      numQuestions: requested,
      allowedTypes: typeList,
      conversationContext: text(config.conversationContext).trim(),
      quizHistory,
      attachments,
    });
    finishText = explored.finishText;
    explorationTrace = explored.explorationTrace;

    emitStage(STAGE_PLANNING);
    plan = await makePlan({
      ...ctx,
      step,
      userMessage,
      explorationTrace,
      numQuestions: requested,
      allowedTypes: typeList,
    });
  }

  emitStage(STAGE_QUIZZING);
  const qaPairs = [];
  for (let index = 0; index < plan.templates.length; index += 1) {
    signal?.throwIfAborted?.();
    const template = plan.templates[index];
    let qaPair;
    try {
      qaPair = await quizOne({
        ...ctx,
        step,
        template,
        questionNumber: index + 1,
        totalQuestions: plan.templates.length,
        explorationTrace,
        plan,
        previousPairs: qaPairs,
      });
    } catch (error) {
      if (error?.code !== 'MODEL_BUDGET_EXCEEDED') throw error;
      // 预算击穿：**停**，但已经计划好的题目仍占位，题数不变（与修复失败同一条语义）。
      qaPair = payloadToQaPair(template, {}, { issues: ['model_budget_exceeded'] });
    }
    // 逐题即刻上屏：emit 在 append **之前**（T20）。
    await emitQuizQuestion({ t, stream, qaPair, index, total: plan.templates.length, language });
    qaPairs.push(qaPair);
  }

  const payload = buildResultPayload({ t, plan, qaPairs, isMimic, finishText, language });
  payload.usage = { modelCalls: budget.used, modelCallLimit: budget.limit };
  payload.questions = toProductQuestions(qaPairs);

  // 终态 RESULT 事件（对位上游 `emit_capability_result`）。
  //
  // ⚠️ 事件的 payload **不能**带 `questions`：宿主的 `extractRawQuestions`
  // 既会遍历 `summary.results[].qa_pair`（上游形状），也会遍历顶层 `questions`
  // 数组（产品形状）。两者同时存在时同一道题会被收两次，题数直接翻倍。
  // 所以这里发一份去掉 `questions` 的副本；返回值仍带 `questions`。
  if (typeof stream.result === 'function') {
    const { questions: _omit, ...envelope } = payload;
    await stream.result(envelope, { source: SOURCE });
  }

  // 收尾：内部总线自己关；调用方传入的总线由调用方负责。
  if (typeof stream.close === 'function' && config.closeStream !== false && !config.stream) {
    await stream.close();
  }
  return payload;
}

function mergeBudgets(overrides) {
  const merged = {};
  for (const [stage, value] of Object.entries(DEFAULT_QUESTION_PARAMS)) {
    merged[stage] = { max_tokens: value.max_tokens };
  }
  if (overrides && typeof overrides === 'object') {
    for (const [stage, value] of Object.entries(overrides)) {
      if (!Object.hasOwn(merged, stage)) continue; // 未知阶段丢弃，不偷偷塞进去
      const maxTokens = Number(value?.max_tokens);
      if (Number.isFinite(maxTokens) && maxTokens > 0) merged[stage].max_tokens = Math.trunc(maxTokens);
    }
  }
  return merged;
}

/** 工具注册表 → schema 列表（契约只有 `schemas(names)`）。 */
function collectToolSchemas(tools, names) {
  if (!tools || typeof tools.schemas !== 'function') return [];
  try {
    const schemas = tools.schemas(names ?? null);
    return Array.isArray(schemas) ? schemas.filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * mimic 模式的模板规整。
 *
 * 上游 `QuizPlan(analysis="", templates=list(templates_override))` **不做重编号**
 * （`templates_override` 由 `mimic_source.py` 抽自试卷，已经带 id）。这里只补
 * 缺失字段的默认值。缺 id 时按位置补 `q_{n}`——上游若缺 id 会得到空串，
 * 而空串会让 `summary.results` 里的题分不清彼此，比补一个位置号更糟。
 */
function normalizeTemplate(raw, index = 0) {
  return {
    question_id: text(raw?.question_id) || `q_${index + 1}`,
    topic: text(raw?.topic).trim(),
    question_type: VALID_QUESTION_TYPES.includes(text(raw?.question_type).toLowerCase())
      ? text(raw?.question_type).toLowerCase()
      : QuestionType.SHORT_ANSWER,
    difficulty: ['easy', 'medium', 'hard'].includes(text(raw?.difficulty).toLowerCase())
      ? text(raw?.difficulty).toLowerCase()
      : 'medium',
    source: raw?.source === 'mimic' ? 'mimic' : 'custom',
    reference_question: raw?.reference_question ?? null,
    reference_answer: raw?.reference_answer ?? null,
  };
}

/**
 * 统一的「一次带标签的模型调用」。
 *
 * 三级降级：`llm.runLabeledStep`（集成层注入）→ core-llm 导出的 `runLabeledStep`
 * → 本包 `labeled-step.js` 的兜底实现。三条路都遵守同一个 `finalMeta` 两态语义，
 * 所以换实现不会改变「quiz 的裸 JSON 会不会刷屏」。
 */
function makeStepRunner({ llm, stream, language, budgets, budget, temperature, signal }) {
  return async function step({
    messages,
    protocol,
    stage,
    iterMeta = {},
    finalMeta = null,
    toolSchemas = null,
    maxTokens = null,
    reasoningEffort = null,
    eagerSubTrace = true,
    countBudget = true,
  }) {
    // Tool Summarizer 不计入主链预算：SPEC §5.3 的 `10 + 2 + 9N` 明确不含它
    // （理论上每次工具派发每条 tool message 一次，N=15 时能到 120 次）。
    // 把它算进来会让「预算」把 15 题的正常流水线提前掐断。
    if (countBudget) {
      if (budget.used >= budget.limit) {
        throw new ModelBudgetExceededError(budget.limit, budget.used);
      }
      budget.used += 1;
    }

    const resolvedMaxTokens = maxTokens ?? budgets.answering.max_tokens;
    const completionKwargs = {
      temperature,
      max_tokens: resolvedMaxTokens,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    };
    const args = {
      // core-llm 的 runLabeledStep 形参是 `client`（它自己会调 prepareCall），
      // 而 llm 实例本身就有 prepareCall —— 直接把 llm 当 client 传进去。
      client: llm,
      llm,
      messages,
      allowedLabels: protocol.allowed,
      finalLabels: protocol.final,
      toolLabel: protocol.toolLabel,
      toolSchemas,
      stream,
      source: SOURCE,
      stage,
      iterMeta,
      finalMeta,
      eagerSubTrace,
      signal,
      completionKwargs,
      model: llm.model ?? null,
      binding: llm.provider ?? null,
      reasoningEffort,
    };

    if (typeof llm.runLabeledStep === 'function') return llm.runLabeledStep(args);
    if (coreLlmRunLabeledStep) return coreLlmRunLabeledStep(args);
    return localRunLabeledStep({
      llm,
      config: { temperature, maxTokens: resolvedMaxTokens },
      messages,
      toolSchemas,
      allowedLabels: protocol.allowed,
      finalLabels: protocol.final,
      toolLabel: protocol.toolLabel,
      stream,
      source: SOURCE,
      stage,
      iterMeta,
      finalMeta,
      signal,
    });
  };
}

/**
 * 工具派发（上游 `_BaseLoopHost.dispatch_tools`，2055-2095）。
 *
 * 只依赖契约里的 `tools.dispatch(call, ctx)`。超并行上限（15）**截断并回占位结果**，
 * 而不是报错：一次幻觉出 40 个调用不该让整道题报废（SPEC §5.4）。
 */
async function dispatchTools({ tools, toolCalls, iteration, ctx, t, stream, stage, summarizer }) {
  if (!toolCalls?.length) return { sources: [], toolMessages: [] };
  if (!tools || typeof tools.dispatch !== 'function') {
    return {
      sources: [],
      toolMessages: toolCalls.map((call) => ({
        role: 'tool',
        tool_call_id: call.id,
        content: t('notices.empty_tool_result') || '工具不可用。',
      })),
    };
  }

  const limit = 15;
  const executed = toolCalls.slice(0, limit);
  const skipped = toolCalls.slice(limit);
  if (skipped.length && typeof stream?.progress === 'function') {
    await stream.progress(
      t('notices.too_many_tool_calls', `模型请求了 ${toolCalls.length} 个工具。一次最多并行 ${limit} 个，已截断。`, {
        requested: toolCalls.length,
        limit,
      }),
      { source: SOURCE, stage, metadata: { trace_kind: 'warning' } },
    );
  }

  // 同批重复调用短路成 stub，保持 tool_call / role=tool 配对（SPEC §5.4）。
  const seen = new Map();
  for (const call of executed) {
    const key = `${call.name}\u0000${normalizeArgs(call.arguments)}`;
    if (!seen.has(key)) seen.set(key, call.id);
  }

  const results = await Promise.all(executed.map(async (call) => {
    const key = `${call.name}\u0000${normalizeArgs(call.arguments)}`;
    if (seen.get(key) !== call.id) {
      return { call, content: '（同一轮里重复的调用，已跳过）', sources: [] };
    }
    try {
      const outcome = await tools.dispatch(
        { id: call.id, name: call.name, arguments: parseArgs(call.arguments) },
        { ...ctx, iteration, source: SOURCE, stage },
      );
      if (outcome && outcome.ok === false) {
        const errorText = text(outcome.error?.message ?? outcome.error) || 'unknown error';
        return {
          call,
          content: t('notices.tool_error', `${call.name} 执行失败：${errorText}`, {
            tool: call.name,
            error: errorText,
          }),
          sources: [],
        };
      }
      const result = outcome?.result ?? outcome;
      const content = typeof result?.content === 'string'
        ? result.content
        : typeof result === 'string'
          ? result
          : JSON.stringify(result ?? {}, null, 2);
      return { call, content: content || t('notices.empty_tool_result'), sources: result?.sources ?? [] };
    } catch (error) {
      const errorText = text(error?.message ?? error);
      return {
        call,
        content: t('notices.tool_error', `${call.name} 执行失败：${errorText}`, {
          tool: call.name,
          error: errorText,
        }),
        sources: [],
      };
    }
  }));

  const skippedMessages = skipped.map((call) => ({
    role: 'tool',
    tool_call_id: call.id,
    content: '（超出单轮并行上限，未执行）',
  }));

  let toolMessages = [
    ...results.map((row) => ({ role: 'tool', tool_call_id: row.call.id, content: row.content })),
    ...skippedMessages,
  ];

  // Tool Summarizer：**只**在 explore 阶段挂（quiz 不做，见 SPEC §5.3 末行）。
  // 它把 tool message 的 content 换成本模型压缩过的版本，于是 exploration_trace、
  // 以及 plan/quiz 读到的，永远是压缩版——这是刻意的成本换效果（T10）。
  // 失败保留原文，不重试。
  if (summarizer?.run) {
    const nameById = new Map(toolCalls.map((call) => [call.id, call.name]));
    const summarized = [];
    for (const message of toolMessages) {
      const summary = await summarizer.run({
        toolName: nameById.get(message.tool_call_id) ?? 'tool',
        toolResult: message.content,
        iteration,
      });
      summarized.push(summary ? { ...message, content: summary } : message);
    }
    toolMessages = summarized;
  }

  return {
    sources: results.flatMap((row) => row.sources ?? []),
    toolMessages,
  };
}

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeArgs(raw) {
  const args = parseArgs(raw);
  return JSON.stringify(Object.keys(args).sort().map((key) => [key, args[key]]));
}

// ---------------------------------------------------------------------------
// 阶段 1：explore
// ---------------------------------------------------------------------------

async function explore({
  t, stream, language, step, tools, activeSchemas, toolListText,
  userMessage, numQuestions, allowedTypes, perTypeCounts, normalizedDifficulty,
  conversationContext, quizHistory, attachments, signal, config,
  toolContext, toolSummarizer, budgets,
}) {
  let systemPrompt = t('explore.system', '', {
    kb_note: config.kbNote ?? '',
    tool_list: toolListText,
    num_questions: numQuestions,
  });
  systemPrompt = appendLanguageDirective(systemPrompt, language);
  const userPrompt = t('explore.user_template', '', {
    user_message: userMessage,
    num_questions: numQuestions,
    allowed_types: formatAllowedTypes(allowedTypes),
    per_type_counts: formatPerTypeCounts(perTypeCounts),
    difficulty: normalizedDifficulty || 'auto',
    attachments_summary: renderAttachmentsSummary(t, attachments),
    conversation_context: conversationContext || t('empty.no_conversation'),
    quiz_history: renderQuizHistory(t, quizHistory, language),
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  // 轨迹切片的锚点必须在消息组装**之后**取（T3）。
  const initialMessageCount = messages.length;

  const host = {
    buildIterationTraceMeta: (iteration) => [
      {
        call_id: `quiz-explore-iter-${iteration}`,
        phase: STAGE_EXPLORING,
        label: t('labels.reasoning', 'Reasoning'),
        call_kind: 'llm_reasoning',
        trace_role: 'thought',
        trace_group: 'stage',
      },
      {
        call_id: 'quiz-explore-final',
        phase: STAGE_EXPLORING,
        label: t('labels.explore', 'Explore'),
        call_kind: 'llm_final_response',
        trace_role: 'response',
        trace_group: 'stage',
      },
    ],
    protocolRetryNotice: () => t('notices.protocol_retry', 'The model violated the action-label protocol; retrying.'),
    protocolRepairMessage: (violation) => t(`protocol.${violation}`, `Protocol violation: ${violation}.`),
    async dispatchTools({ iteration, toolCalls }) {
      const outcome = await dispatchTools({
        tools, toolCalls, iteration, ctx: toolContext, t, stream, stage: STAGE_EXPLORING,
        summarizer: toolSummarizer,
      });
      return outcome;
    },
    emitFinal: async (chunk, finalMeta) => {
      if (!chunk || typeof stream?.content !== 'function') return;
      await stream.content(chunk, {
        source: SOURCE, stage: STAGE_EXPLORING, metadata: { ...finalMeta, trace_kind: 'llm_output' },
      });
    },
    resolvePause: () => false,
    async forceFinalize({ messages: loopMessages }) {
      return forceFinish({
        t, step, stream, messages: loopMessages, stage: STAGE_EXPLORING,
        traceRoot: 'quiz-explore', language, streamBodyLive: true, budgets,
      });
    },
  };

  const outcome = await runAgenticLoop({
    initialMessages: messages,
    protocol: PROTOCOL_EXPLORE,
    runLabeledStep: (request) => step({
      ...request,
      stage: STAGE_EXPLORING,
      toolSchemas: activeSchemas,
      maxTokens: budgets.answering.max_tokens,
      eagerSubTrace: true,
    }),
    stream,
    source: SOURCE,
    stage: STAGE_EXPLORING,
    maxIterations: config.maxExploreIterations ?? DEFAULT_MAX_EXPLORE_ITERATIONS,
    host,
    // explore：FINISH 前言逐 chunk 进气泡（T4 的一半）。
    streamBodyLive: true,
    eagerSubTrace: true,
  });

  const finishText = text(outcome.finalText).trim();
  const explorationTrace = renderExplorationTrace(
    t,
    outcome.messages.slice(initialMessageCount),
    finishText,
  );
  return { finishText, explorationTrace };
}

/** `_summarize_tool_result`（1045-1171）：失败保留原文，不重试。 */
async function summarizeToolResult({ t, step, language, toolName, toolResult, iteration, stream, maxTokens }) {
  const raw = text(toolResult).trim();
  if (!raw) return null;
  const systemPrompt = appendLanguageDirective(t('tool_summarizer.system'), language);
  const userPrompt = t('tool_summarizer.user_template', '', { tool_result: raw });
  const iterMeta = {
    call_id: `quiz-reflect-iter-${iteration}-${toolName || 'tool'}`,
    phase: STAGE_EXPLORING,
    label: t('labels.reflecting', 'DeepTutor Reflecting...'),
    call_kind: 'tool_result_reflection',
    trace_role: 'reflection',
    trace_group: 'reflection',
    tool: toolName,
    iteration,
  };
  if (typeof stream?.progress === 'function') {
    // 子 trace 卡片在 LLM 流开始**之前**打开，面板立刻显示"反思中"。
    await stream.progress(iterMeta.label, {
      source: SOURCE,
      stage: STAGE_EXPLORING,
      metadata: { ...iterMeta, trace_kind: 'call_status', call_state: 'running' },
    }).catch(() => {});
  }
  try {
    const result = await step({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      protocol: PROTOCOL_REPAIR,
      stage: STAGE_EXPLORING,
      iterMeta,
      finalMeta: null,
      maxTokens,
      eagerSubTrace: false,
      // 主链预算不含 summarizer（SPEC §5.3）。
      countBudget: false,
    });
    const summary = text(result?.text).trim();
    return summary || null;
  } catch {
    // 概括失败不重试，保留原始结果（1142-1159）。
    return null;
  } finally {
    if (typeof stream?.progress === 'function') {
      await stream.progress('', {
        source: SOURCE,
        stage: STAGE_EXPLORING,
        metadata: { ...iterMeta, trace_kind: 'call_status', call_state: 'complete' },
      }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// 阶段 2：plan
// ---------------------------------------------------------------------------

async function makePlan({
  t, step, stream, language, userMessage, explorationTrace, numQuestions,
  allowedTypes, perTypeCounts, normalizedDifficulty, budgets,
}) {
  let systemPrompt = t('plan.system', '', { num_questions: numQuestions });
  systemPrompt = appendLanguageDirective(systemPrompt, language);
  const userPrompt = t('plan.user_template', '', {
    user_message: userMessage,
    exploration_trace: explorationTrace || t('empty.no_exploration_trace'),
    num_questions: numQuestions,
    allowed_types: formatAllowedTypes(allowedTypes),
    per_type_counts: formatPerTypeCounts(perTypeCounts),
    difficulty: normalizedDifficulty || 'auto',
  });
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const iterMeta = {
    call_id: 'quiz-plan',
    phase: STAGE_PLANNING,
    label: t('labels.plan', 'Plan'),
    call_kind: 'llm_planning',
    trace_role: 'plan',
    trace_group: 'plan',
  };

  let result = await step({
    messages,
    protocol: PROTOCOL_PLAN,
    stage: STAGE_PLANNING,
    iterMeta,
    finalMeta: null,
    maxTokens: budgets.planning.max_tokens,
  });

  if (result?.reasoningOnly) {
    // 整轮预算都花在思考上、没产出方案。**降思考重问一次**（750-779）：
    // 不重问的结果是 `_parse_plan("")` 得到零题计划，phase 3 遍历空列表，
    // 整回合 0 题却没有任何错误痕迹（#1318）。
    await progress(stream, t('notices.plan_reasoning_retry'), STAGE_PLANNING);
    result = await step({
      messages,
      protocol: PROTOCOL_PLAN,
      stage: STAGE_PLANNING,
      iterMeta,
      finalMeta: null,
      maxTokens: budgets.planning.max_tokens,
      reasoningEffort: RETRY_REASONING_EFFORT,
    });
  }

  const plan = parsePlan(result?.text ?? '', {
    requested: numQuestions,
    allowedTypes,
    targetDifficulty: normalizedDifficulty,
  });

  if (!plan.templates.length) {
    // 故意的硬失败（T5）：空计划会静默发出 0 题。在原因还读得懂的地方炸。
    throw new Error(t('notices.plan_unusable') || '出题规划没有产出任何可用的题目模板。');
  }
  if (plan.templates.length < numQuestions) {
    // 数量不足只警告：三道真题好过一场失败。方向与上一条相反，不能统一（T5）。
    await progress(
      stream,
      t('notices.plan_count_mismatch', '', {
        got: plan.templates.length,
        requested: numQuestions,
      }),
      STAGE_PLANNING,
    );
  }
  return plan;
}

// ---------------------------------------------------------------------------
// 阶段 3+4：quiz（含单轮 repair）
// ---------------------------------------------------------------------------

async function quizOne({
  t, stream, language, step, template, questionNumber, totalQuestions,
  explorationTrace, plan, previousPairs, activeSchemas, toolListText, tools, config,
  toolContext, budgets,
}) {
  let systemPrompt = t('quiz_step.system', '', {
    question_number: questionNumber,
    total_questions: totalQuestions,
    kb_note: config.kbNote ?? '',
    tool_list: toolListText,
  });
  systemPrompt = appendLanguageDirective(systemPrompt, language);
  const userPrompt = t('quiz_step.user_template', '', {
    question_id: template.question_id,
    topic: template.topic,
    question_type: template.question_type,
    difficulty: template.difficulty,
    exploration_trace: explorationTrace || t('empty.no_exploration_trace'),
    plan_summary: renderPlanSummary(plan),
    previous_questions: renderPreviousQuestions(t, previousPairs),
    reference_block: renderReferenceBlock(t, template),
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const host = {
    buildIterationTraceMeta: (iteration) => {
      const meta = {
        call_id: `quiz-${template.question_id}-iter-${iteration}`,
        phase: STAGE_QUIZZING,
        label: t('labels.reasoning', 'Reasoning'),
        call_kind: 'llm_reasoning',
        trace_role: 'thought',
        trace_group: 'quiz',
        question_id: template.question_id,
      };
      return [meta, meta];
    },
    protocolRetryNotice: () => t('notices.protocol_retry', 'The model violated the action-label protocol; retrying.'),
    protocolRepairMessage: (violation) => t(`protocol.${violation}`, `Protocol violation: ${violation}.`),
    async dispatchTools({ iteration, toolCalls }) {
      return dispatchTools({
        tools, toolCalls, iteration, ctx: { ...toolContext, template },
        t, stream, stage: STAGE_QUIZZING,
        // quiz 阶段**不**做 Tool Summarizer：只有 explore host 覆写了派发（T10）。
        summarizer: null,
      });
    },
    // **故意的空实现**（T4）：quiz 的 FINISH 是裸 JSON，推给用户等于往脸上刷 JSON。
    emitFinal: async () => {},
    resolvePause: () => false,
    async forceFinalize({ messages: loopMessages }) {
      return forceFinish({
        t, step, stream, messages: loopMessages, stage: STAGE_QUIZZING,
        traceRoot: `quiz-${template.question_id}`, language, streamBodyLive: false, budgets,
      });
    },
  };

  const outcome = await runAgenticLoop({
    initialMessages: messages,
    protocol: PROTOCOL_QUIZ,
    runLabeledStep: (request) => step({
      ...request,
      stage: STAGE_QUIZZING,
      toolSchemas: activeSchemas,
      maxTokens: budgets.quiz_finish.max_tokens,
      eagerSubTrace: true,
    }),
    stream,
    source: SOURCE,
    stage: STAGE_QUIZZING,
    maxIterations: config.maxQuizIterations ?? DEFAULT_MAX_QUIZ_ITERATIONS_PER_QUESTION,
    host,
    // quiz：正文只作返回值（T4 的另一半）。
    streamBodyLive: false,
    eagerSubTrace: true,
  });

  const payload = parseQuizPayload(outcome.finalText);
  let normalized = normalizeQuizPayload(template, payload);
  let issues = collectQuizIssues(template, normalized);

  if (issues.length) {
    await progress(stream, t('notices.repair_attempted'), STAGE_QUIZZING);
    // **单轮**：没有 while（T6）。整段只有这一次调用。
    const repaired = await repairQuizPayload({
      t, step, stream, language, template, payload: normalized, issues, budgets,
    });
    // `if repaired:` 是 Python 真值：`{}` 为假 ⇒ 保留原稿与 issues（T7）。
    if (pythonTruthy(repaired)) {
      normalized = normalizeQuizPayload(template, repaired);
      issues = collectQuizIssues(template, normalized);
    }
    if (issues.length) {
      await progress(stream, t('notices.repair_failed'), STAGE_QUIZZING);
    }
  }

  // 修复失败**仍照常出题**：占位符比丢题更诚实，题数也必须与计划一致（T6/T18）。
  return payloadToQaPair(template, normalized, { issues });
}

async function repairQuizPayload({ t, step, stream, language, template, payload, issues, budgets }) {
  const systemPrompt = appendLanguageDirective(t('repair.system'), language);
  const userPrompt = t('repair.user_template', '', {
    question_id: template.question_id,
    topic: template.topic,
    question_type: template.question_type,
    difficulty: template.difficulty,
    invalid_payload: JSON.stringify(payload ?? {}, null, 2),
    issues: JSON.stringify(issues ?? []),
  });
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const iterMeta = {
    call_id: `quiz-repair-${template.question_id}`,
    phase: STAGE_QUIZZING,
    label: t('labels.repair', 'Repair question format'),
    call_kind: 'llm_reasoning',
    trace_role: 'thought',
    trace_group: 'quiz',
    question_id: template.question_id,
  };

  let result;
  try {
    result = await step({
      messages,
      protocol: PROTOCOL_REPAIR,
      stage: STAGE_QUIZZING,
      iterMeta,
      finalMeta: null,
      maxTokens: budgets.repair.max_tokens,
    });
  } catch (error) {
    if (error?.code === 'MODEL_BUDGET_EXCEEDED') return {};
    throw error;
  }

  if (result?.reasoningOnly) {
    await progress(stream, t('notices.repair_reasoning_retry'), STAGE_QUIZZING);
    result = await step({
      messages,
      protocol: PROTOCOL_REPAIR,
      stage: STAGE_QUIZZING,
      iterMeta,
      finalMeta: null,
      maxTokens: budgets.repair.max_tokens,
      reasoningEffort: RETRY_REASONING_EFFORT,
    });
  }
  // 解析失败 → `{}` → 上层按真值判断**不覆盖**。
  return parseQuizPayload(result?.text ?? '');
}

/**
 * 强制收尾（上游 `_force_finish`，1513-1575）。
 *
 * 最多 2 次；成功条件是 `label === FINISH` **且**正文里不能再出现行首标签——
 * 这比循环内的违规判定多一道检查（T17）。两次都失败返回兜底文案；那段假文本会
 * 作为题目内容进入解析，最终变成 `[Generation failed]`。
 */
async function forceFinish({
  t, step, stream, messages, stage, traceRoot, language, streamBodyLive, budgets,
}) {
  messages.push({ role: 'user', content: t('protocol.force_finish') });
  await progress(stream, t('notices.max_iterations_reached'), stage);

  let calls = 0;
  for (let attempt = 0; attempt < FINALIZATION_REPAIR_ATTEMPTS; attempt += 1) {
    const iterMeta = {
      call_id: `${traceRoot}-force-${attempt}`,
      phase: stage,
      label: t('labels.reasoning', 'Reasoning'),
      call_kind: 'llm_reasoning',
      trace_role: 'thought',
      trace_group: stage === STAGE_QUIZZING ? 'quiz' : 'stage',
    };
    const finalMeta = streamBodyLive
      ? {
        call_id: `${traceRoot}-force-final-${attempt}`,
        phase: stage,
        label: t('labels.explore', 'Explore'),
        call_kind: 'llm_final_response',
        trace_role: 'response',
        trace_group: 'stage',
      }
      : null;

    let result;
    try {
      result = await step({
        messages,
        protocol: PROTOCOL_REPAIR,
        stage,
        iterMeta,
        finalMeta,
        maxTokens: budgets.answering.max_tokens,
      });
    } catch (error) {
      if (error?.code === 'MODEL_BUDGET_EXCEEDED') break;
      throw error;
    }
    calls += 1;
    if (result?.label === LABEL_FINISH
      && findInlineLabels(result.text ?? '', { allowedLabels: PROTOCOL_EXPLORE.allowed }).length === 0) {
      return [result.text, true, calls];
    }
    messages.push(assistantMessage(text(result?.text).slice(0, 500), {
      reasoningContent: result?.reasoningContent || null,
    }));
    messages.push({ role: 'user', content: t('protocol.force_finish_repair') });
  }
  return [t('protocol.fallback_final'), false, calls];
}

// ---------------------------------------------------------------------------
// 逐题上屏 + 结果信封
// ---------------------------------------------------------------------------

async function emitQuizQuestion({ t, stream, qaPair, index, total, language }) {
  if (!stream || typeof stream.content !== 'function') return;
  const meta = {
    call_id: `quiz-question-${index + 1}`,
    phase: STAGE_QUIZZING,
    label: `${t('labels.quiz_step', 'Question')} ${index + 1}`,
    call_kind: 'quiz_question_emitted',
    trace_id: qaPair.question_id,
    trace_role: 'quiz_question',
    trace_group: 'quiz',
    question_index: index,
    total_questions: total,
    qa_pair: qaPairToDict(qaPair),
  };
  await stream.content(renderQuestionMarkdown(qaPair, index + 1, language), {
    source: SOURCE,
    stage: STAGE_QUIZZING,
    metadata: { ...meta, trace_kind: 'llm_output' },
  });
}

/**
 * `_build_result_payload`（1320-1379）。
 *
 * `successful` 的判据是 **`metadata.issues` 为空**（T18）。曾经读过 `error` 字段，
 * 但没有任何地方写它，于是全占位题也报 `success=True / failed=0`。
 */
function buildResultPayload({ t, plan, qaPairs, isMimic, finishText, language }) {
  const successful = qaPairs.filter((qa) => !(qa.metadata?.issues?.length)).length;
  const markdown = renderSummaryMarkdown(qaPairs, language);
  const finishBlock = text(finishText).trim();
  const responseBody = finishBlock
    ? finishBlock
    : markdown || 'No questions generated.';

  return {
    response: responseBody,
    summary: {
      success: successful === qaPairs.length && qaPairs.length > 0,
      source: isMimic ? 'exam' : 'topic',
      requested: plan.templates.length,
      template_count: plan.templates.length,
      completed: successful,
      failed: qaPairs.length - successful,
      templates: plan.templates.map(templateToDict),
      results: qaPairs.map((qaPair) => ({
        qa_pair: qaPairToDict(qaPair),
        metadata: { ...qaPair.metadata },
      })),
      analysis: plan.analysis,
    },
    mode: isMimic ? 'mimic' : 'custom',
  };
}

async function progress(stream, message, stage) {
  if (!message || !stream || typeof stream.progress !== 'function') return;
  try {
    await stream.progress(message, { source: SOURCE, stage, metadata: { trace_kind: 'warning' } });
  } catch {
    // 提示发不出去不该影响出题
  }
}

export default { runDeepQuestion };
