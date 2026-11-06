/**
 * `dsh-zhiyun-core-question` —— 出题流水线本体。
 *
 * 上游对应：`agents/question/{pipeline,capability,coordinator,history}.py`、
 * `agents/_shared/{capability_result,json_output}.py` 的出题相关部分。
 *
 * # 对外只有一个入口
 *
 * ```js
 * import { runDeepQuestion } from 'dsh-zhiyun-core-question';
 * const { questions } = await runDeepQuestion({
 *   lecture, count, type, difficulty, llm, tools, onEvent, signal,
 * });
 * ```
 *
 * 返回的 `questions[]` 与产品 `tutor.runs.result().questions` 逐字段兼容
 * （`stem` / `answer` / `choices` / `type` …），因此
 * `packages/dsh-zhiyun-core-study/src/quiz-engine-runtime.js` 一行不用改。
 * 同时保留 `summary` / `response` / `mode` 这套上游信封，
 * 便于和旧实现对照（`summary.results[].qa_pair` 是同一份数据）。
 *
 * # 四个阶段
 *
 * ```
 * explore  读讲义 + 调工具 → FINISH 前言（逐字上屏）+ 探索轨迹
 * plan     轨迹 → 模板列表（每题一个考点角度）；空模板 = 硬失败
 * quiz     按模板逐题生成，带工具循环；题目串行，工具并发
 * repair   校验不合格时单轮修复；修不好照常出题（占位）
 * ```
 */

export { runDeepQuestion, buildUserMessage, modelCallBudget, useNativeTools, renderToolList, canonicalTypeName } from './pipeline.js';

/**
 * core-tool 的预算函数（`10 + 2 + 9N`）原样转发。
 *
 * 本包的 `modelCallBudget` 与它是同一个公式：集成层对账时用哪个都行，
 * 但**只有一个实现**（`src/deps.js` 直接 import core-tool 的那个），
 * 所以不会出现「测试按一个数、运行期按另一个数」的漂移。
 */
export { pipelineModelCallBudget } from './deps.js';

export {
  SOURCE,
  FEATURE,
  STAGE_EXPLORING,
  STAGE_PLANNING,
  STAGE_QUIZZING,
  LABEL_THINK,
  LABEL_TOOL,
  LABEL_FINISH,
  LABEL_PLAN,
  PROTOCOL_EXPLORE,
  PROTOCOL_PLAN,
  PROTOCOL_QUIZ,
  PROTOCOL_REPAIR,
  DEFAULT_MAX_EXPLORE_ITERATIONS,
  DEFAULT_MAX_QUIZ_ITERATIONS_PER_QUESTION,
  FINALIZATION_REPAIR_ATTEMPTS,
  DEFAULT_QUESTION_PARAMS,
  ModelBudgetExceededError,
} from './pipeline.js';

export {
  QuestionType,
  VALID_QUESTION_TYPES,
  VALID_DIFFICULTIES,
  CHOICE_KEYS,
  FILL_IN_BLANK_TOKEN,
  CONCEPT_ANSWERS,
  normalizeTypeList,
  normalizePerTypeCounts,
  formatAllowedTypes,
  formatPerTypeCounts,
} from './types.js';

export {
  createTranslator,
  pythonFormat,
  parseLanguage,
  normalizeLanguage,
  languageLabel,
  languageDirective,
  appendLanguageDirective,
  loadPrompts,
} from './i18n.js';

export { parsePlan, pickFallbackType } from './plan.js';

export {
  normalizeQuizPayload,
  collectQuizIssues,
  payloadToQaPair,
  pythonTruthy,
  qaPairToDict,
  templateToDict,
} from './quiz-payload.js';

export { parseJsonResponse, parseQuizPayload, decodeLongestJsonValue, repairJsonText } from './json.js';

export {
  renderExplorationTrace,
  renderQuestionMarkdown,
  renderSummaryMarkdown,
  renderPlanSummary,
  renderPreviousQuestions,
  renderReferenceBlock,
  renderQuizHistory,
  renderAttachmentsSummary,
  stripProtocolLabel,
  correctnessLabel,
} from './render.js';

export { toProductQuestion, toProductQuestions, TYPE_MAP, JUDGE_ANSWER } from './product-questions.js';

export {
  classifyLabel,
  findInlineLabels,
  stripLabelProbePrefix,
  runLabeledStep,
  LABEL_UNKNOWN,
  LABEL_PROBE_MAX_CHARS,
} from './labeled-step.js';
