/**
 * 上游出题结果 → 智云 core-quiz 候选题目 的**唯一适配层**。
 *
 * # 为什么需要这一层
 *
 * 上游 `deep_question` 的主流水线有自己的题型枚举、自己的答案规范化规则、自己的
 * 结果信封（题目藏在 `summary.results[].qa_pair` 里）。`dsh-zhiyun-core-quiz` 那边
 * 有一套完全不同的落盘词表，两侧不能互相 import（core-quiz 零依赖，且要能脱离宿主
 * 单测）。所以题型映射、字段改名、答案规范化全部收口在这个文件里，谁改上游枚举
 * 就只改这里。
 *
 * # 最重要的一条：上游 `concept` 是**判断题**，不是"概念填空"
 *
 * 上游 `vendor/deeptutor/deeptutor/agents/question/pipeline.py:156` 的
 * `class QuestionType(StrEnum)` 只有 6 个值：
 * `choice` / `concept` / `fill_in_blank` / `short_answer` / `written` / `coding`。
 * 其中 `concept` 的正确答案在流水线里被**规范成字符串 `"true"` / `"false"`**
 * （`pipeline.py:1436-1445`：接受 true/t/对/正确/yes/y/1 与 false/f/错/错误/no/n/0），
 * 并且同时把 `options` 置为 `None`，再用两条校验兜底
 * （`pipeline.py:1471-1475`）：`concept_must_not_have_options`、
 * `concept_correct_answer_must_be_true_or_false`。
 * 出题提示词里也写着（`tools/question/question_extractor.py:158`）：
 * `"concept": a true/false proposition the learner judges`。
 *
 * **所以 `concept` 必须映射成判断题 `trueFalse`。把它当成"概念填空题"会让整批题
 * 的答案语义错位** —— 填空题判答案是文本等价，判断题判的是真假，两者质检判据不同，
 * 用错判据比不判更糟：它会给出一份"看起来通过了质检"的结果。
 *
 * # 两套题型词表，值域必须写清楚
 *
 * 本适配器输出的 `type` 值域是 `core-quiz/src/strategies.js` 的 `QUESTION_TYPES`
 * （`cloze` / `mcq` / `trueFalse` / `shortAnswer`，`points.js:90` 与 `points.js:373`
 * 按这套校验），**不是** `core-quiz/src/model.js` 的 `QUIZ_TYPES`
 * （`cloze` / `shortAnswer` / `mcq` / `case`；`caseStudy` 成员名的落盘代号是 `case`）。
 *
 * ⚠️ 已知缺口（有意不在这里修）：`trueFalse` 在 `QUIZ_TYPES` 里**没有对应项**，
 * 因此 `quizTypeFromCode('trueFalse')` 会返回 `null`。把候选题目推进 `model.js`
 * 那条落盘路径前，需要先补 `QUIZ_TYPES.trueFalse` —— 那涉及 Dart 侧代号一致性，
 * 属于独立决策，不在本适配器范围内。本适配器只负责产出 `typeVocabulary: 'strategies'`
 * 的候选，并把这个值域标记原样带出去，让下游一眼看出该走哪套校验。
 *
 * # 两套上游题型，登记时必须注明来源
 *
 * - **主流水线**（`agents/question/pipeline.py`）：`choice` / `concept` /
 *   `fill_in_blank` / `short_answer` / `written` / `coding`。本适配器的主服务对象。
 * - **刷题导入流水线**（`services/practice/importing.py:27 TYPES`）：`single_choice` /
 *   `multi_choice` / `true_false` / `fill_blank` / `short_answer`。这是**另一条独立
 *   流水线**（题库导入，不是出题），这里一并登记并逐条标来源，避免有人以为两套枚举
 *   是同一件事的两个版本。
 *
 * 未知题型一律落 `unknown` 并进 `diagnostics`，绝不静默丢题、也绝不"猜一个最像的"。
 */

/** 智云侧落盘词表（= `core-quiz/src/strategies.js#QUESTION_TYPES` 的键）。 */
export const ZHIYUN_QUESTION_TYPES = Object.freeze(['cloze', 'mcq', 'trueFalse', 'shortAnswer']);

/** 判断题在本适配器输出里的唯一代号。不要改成 `'judge'`：下游只认 `trueFalse`。 */
export const JUDGE_TYPE = 'trueFalse';

/** 无法映射的题型代号。落这个值并进 diagnostics，不丢题。 */
export const UNKNOWN_TYPE = 'unknown';

/**
 * 判断题的别名 → 统一代号。
 *
 * 智云侧 `points.js:90` 只认 `type === 'trueFalse'`，答案只接受「正确」/「错误」。
 * 所以任何"判断/对错/tf/boolean"语义的输入都要归一到这里。
 */
export const JUDGE_ALIASES = Object.freeze({
  judge: JUDGE_TYPE,
  truefalse: JUDGE_TYPE,
  true_false: JUDGE_TYPE,
  'true-false': JUDGE_TYPE,
  tf: JUDGE_TYPE,
  bool: JUDGE_TYPE,
  boolean: JUDGE_TYPE,
  判断: JUDGE_TYPE,
  判断题: JUDGE_TYPE,
});

/**
 * 上游题型 → 智云题型。
 *
 * `null` 到不了这里：无法表示的题型显式写 `UNKNOWN_TYPE`，以保留"上游确实有这种题，
 * 但我们的词表装不下"这个事实，而不是让它看起来像解析失败。
 */
export const QUESTION_TYPE_MAP = Object.freeze({
  // —— 主流水线（agents/question/pipeline.py:156 QuestionType）——
  /** 单选题：上游保证 options 的键正好是 A/B/C/D。 */
  choice: 'mcq',
  /** 判断题：上游把答案规范成 "true"/"false" 且不带 options。**不是概念填空。** */
  concept: JUDGE_TYPE,
  /** 填空题。 */
  fill_in_blank: 'cloze',
  /** 简答题。 */
  short_answer: 'shortAnswer',
  /**
   * 上游的"其它"垃圾桶：`pipeline.py:836-842` 把任何不在允许集合里的题型
   * 统一落 `QuestionType.WRITTEN`，语义上等于开放式作答。我们的词表里最接近
   * 的是简答题（要点齐全即可，不要求逐字等价）。
   */
  written: 'shortAnswer',
  /** 编程题：需要完整参考解答与评分要点，落简答题；题面与答案原样保留在 rawOutput。 */
  coding: 'shortAnswer',

  // —— 刷题导入流水线（services/practice/importing.py:27 TYPES）——
  // 注意：这是另一条独立流水线，名字与主流水线高度相似但**不是**同一套枚举。
  single_choice: 'mcq', // 别名 multiple_choice/mcq/单选/单选题 在下面别名表里
  true_false: JUDGE_TYPE,
  fill_blank: 'cloze',
  essay: 'shortAnswer', // 该流水线 short_answer 的别名
  free_response: 'shortAnswer',
  /**
   * 多选题：智云词表**没有**多选题（`points.js` 的 mcq 判据是"唯一正确选项"、
   * 干扰项明确错误）。硬映射成 mcq 会让质检按单选判据放过一道多选，属于"用错判据"，
   * 比丢题更糟。所以显式落 unknown 并带上说明，让上层决定是丢弃还是另建题型。
   */
  multi_choice: UNKNOWN_TYPE,
});

/** 每个映射项的来源流水线，便于将来上游改名时定位。 */
export const QUESTION_TYPE_SOURCES = Object.freeze({
  choice: 'main-pipeline:agents/question/pipeline.py',
  concept: 'main-pipeline:agents/question/pipeline.py',
  fill_in_blank: 'main-pipeline:agents/question/pipeline.py',
  short_answer: 'main-pipeline:agents/question/pipeline.py',
  written: 'main-pipeline:agents/question/pipeline.py',
  coding: 'main-pipeline:agents/question/pipeline.py',
  single_choice: 'practice-import:services/practice/importing.py',
  multi_choice: 'practice-import:services/practice/importing.py',
  true_false: 'practice-import:services/practice/importing.py',
  fill_blank: 'practice-import:services/practice/importing.py',
  essay: 'practice-import:services/practice/importing.py',
  free_response: 'practice-import:services/practice/importing.py',
});

/** 上游用别名写题型时的兜底别名表（中英文都收）。 */
export const QUESTION_TYPE_ALIASES = Object.freeze({
  multiple_choice: 'mcq',
  mcq: 'mcq',
  单选: 'mcq',
  单选题: 'mcq',
  '单选题（单选）': 'mcq',
  多选: UNKNOWN_TYPE,
  多选题: UNKNOWN_TYPE,
  判断: JUDGE_TYPE,
  判断题: JUDGE_TYPE,
  填空: 'cloze',
  填空题: 'cloze',
  简答: 'shortAnswer',
  简答题: 'shortAnswer',
  short: 'shortAnswer',
  code: 'shortAnswer',
  编程: 'shortAnswer',
  编程题: 'shortAnswer',
});

/** 判断题答案的布尔归一表（与上游 pipeline.py:1436-1445 的接受集合对齐）。 */
const TRUE_TOKENS = new Set(['true', 't', 'yes', 'y', '1', '对', '正确', '√', '是', 'ture']);
const FALSE_TOKENS = new Set(['false', 'f', 'no', 'n', '0', '错', '错误', '×', 'x', '否']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 判断一个值是不是"判断题"语义（接受代号与别名）。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isJudgeType(value) {
  const key = text(value).toLowerCase();
  if (key === '') return false;
  return JUDGE_ALIASES[key] === JUDGE_TYPE;
}

/**
 * 上游题型归一。
 *
 * 顺序很重要：先查显式映射（主流水线优先），再查别名，最后才发现输入其实已经是
 * 智云代号，否则 unknown。
 *
 * @param {unknown} rawType 上游原始题型字符串
 * @returns {{type: string, rawType: string, unknown: boolean}}
 */
export function normalizeQuestionType(rawType) {
  const raw = text(rawType);
  const key = raw.toLowerCase();
  if (key === '') return { type: UNKNOWN_TYPE, rawType: raw, unknown: true };
  // 已经是智云代号：原样通过（上游偶尔直接把 core-quiz 的代号回传）。
  if (ZHIYUN_QUESTION_TYPES.includes(raw)) {
    return { type: raw, rawType: raw, unknown: false };
  }
  if (isJudgeType(key)) return { type: JUDGE_TYPE, rawType: raw, unknown: false };
  if (Object.hasOwn(QUESTION_TYPE_MAP, key)) {
    const mapped = QUESTION_TYPE_MAP[key];
    return { type: mapped, rawType: raw, unknown: mapped === UNKNOWN_TYPE };
  }
  if (Object.hasOwn(QUESTION_TYPE_ALIASES, key)) {
    const mapped = QUESTION_TYPE_ALIASES[key];
    return { type: mapped, rawType: raw, unknown: mapped === UNKNOWN_TYPE };
  }
  if (Object.hasOwn(QUESTION_TYPE_ALIASES, raw)) {
    const mapped = QUESTION_TYPE_ALIASES[raw];
    return { type: mapped, rawType: raw, unknown: mapped === UNKNOWN_TYPE };
  }
  return { type: UNKNOWN_TYPE, rawType: raw, unknown: true };
}

/**
 * 判断题答案 → 布尔。
 * @returns {boolean|null} null 表示不是布尔语义（调用方应拒收该题）。
 */
export function toJudgeAnswer(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  const key = text(value).toLowerCase();
  if (key === '') return null;
  if (TRUE_TOKENS.has(key)) return true;
  if (FALSE_TOKENS.has(key)) return false;
  return null;
}

/** 选择题答案归一成大写代号（`a` / `A.` / ` A ` → `A`）。 */
function toChoiceAnswer(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const s = text(raw).toUpperCase();
  const m = /^([A-Z])/.exec(s);
  return m ? m[1] : s;
}

/** 选择题选项归一：上游用 `{A: "..."}`，也见到过 `[{key,text}]`。 */
function toOptions(value) {
  if (Array.isArray(value)) {
    const out = {};
    for (const item of value) {
      if (isRecord(item)) {
        const key = text(item.key ?? item.label ?? item.id).toUpperCase();
        if (key) out[key] = String(item.text ?? item.content ?? item.value ?? '');
      }
    }
    return Object.keys(out).length ? out : null;
  }
  if (isRecord(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[String(key).toUpperCase()] = typeof item === 'string' ? item : String(item?.text ?? '');
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

/**
 * 从上游结果信封里挖出题目列表。
 *
 * 上游 `deep_question` 的结果形状（`pipeline.py:1310-1378 _build_result_payload`）：
 * ```
 * { response, mode:'mimic'|'custom',
 *   summary: { success, requested, completed, failed,
 *              results: [ { qa_pair: {...}, metadata: {...} } ] } }
 * ```
 * 题目**不在顶层 `questions`**，而在 `summary.results[].qa_pair`。followup 分支
 * （`agents/question/capability.py:99-108`）甚至没有 `summary`。所以这里要能吃下
 * 三种形状并且**宽容但不猜**：认不出就返回空，由上层报"没有可识别题目"。
 *
 * @returns {Array<{raw: object, rowMetadata: object|null}>}
 */
export function extractRawQuestions(capabilityResult) {
  const out = [];
  const seen = new Set();

  function visit(node, rowMetadata) {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) visit(item, rowMetadata);
      return;
    }
    // 1) 直接就是单题（上游 qa_pair 本身）
    if (text(node.question) || text(node.stem) || text(node.prompt)) {
      out.push({ raw: node, rowMetadata });
      return;
    }
    // 2) 上游结果信封里的 results[]
    if (Array.isArray(node.results)) {
      for (const row of node.results) {
        if (!isRecord(row)) continue;
        const meta = isRecord(row.metadata) ? row.metadata : null;
        if (isRecord(row.qa_pair)) visit(row.qa_pair, meta);
        else visit(row, meta);
      }
    }
    // 3) 已经是候选题目数组
    if (Array.isArray(node.questions)) {
      for (const item of node.questions) visit(item, rowMetadata);
    }
    // 4) summary 信封
    if (isRecord(node.summary)) visit(node.summary, rowMetadata);
    // 5) 再解一层信封（service 的 ResultEnvelope 或 run.result 通知）
    if (isRecord(node.result) && node.result !== node) visit(node.result, rowMetadata);
    if (isRecord(node.payload) && node.payload !== node) visit(node.payload, rowMetadata);
  }

  visit(capabilityResult, null);
  return out;
}

/**
 * 把上游结果适配成智云候选题目。
 *
 * 只做**映射与校验**，不做质检（难度分布、重复题、干扰项质量都在 core-quiz 那边）。
 * 被拒的题一定带原因进 `diagnostics`，绝不静默少几道 —— 少题和失败的观感差别很大。
 *
 * @param {object} options
 * @param {unknown} options.capabilityResult 上游终态 payload（或已包一层的 run 结果）
 * @param {string} [options.runId] 归属的 run
 * @param {string|null} [options.resourceRevision] 资源版本快照
 * @param {Array} [options.resourceAnchors] 题目引用的资源锚点
 * @returns {{questions: CandidateQuestion[], diagnostics: object[]}}
 */
export function toQuizCandidates({
  capabilityResult,
  runId = null,
  resourceRevision = null,
  resourceAnchors = [],
} = {}) {
  const diagnostics = [];
  const questions = [];
  const anchors = Array.isArray(resourceAnchors) ? resourceAnchors : [];

  const rawList = extractRawQuestions(capabilityResult);
  if (!rawList.length) {
    diagnostics.push({
      kind: 'no-questions',
      severity: 'error',
      runId,
      reason: '上游结果里没有可识别的题目（既没有 summary.results[].qa_pair，也没有 questions 数组）',
      resultMode: isRecord(capabilityResult) ? (capabilityResult.mode ?? null) : null,
    });
    return { questions, diagnostics };
  }

  for (const entry of rawList) {
    const raw = entry.raw ?? {};
    const rowMetadata = entry.rowMetadata ?? null;
    const rawTypeValue = text(raw.question_type ?? raw.type ?? raw.questionType);
    const normalized = normalizeQuestionType(rawTypeValue);

    if (normalized.unknown) {
      diagnostics.push({
        kind: 'rejected',
        severity: 'error',
        runId,
        reason: rawTypeValue
          ? `题型 ${rawTypeValue} 无法映射到智云词表（${ZHIYUN_QUESTION_TYPES.join('/')}）`
            + (QUESTION_TYPE_SOURCES[rawTypeValue.toLowerCase()]
              ? `；来源 ${QUESTION_TYPE_SOURCES[rawTypeValue.toLowerCase()]}`
              : '；该题型未在上游任何流水线登记')
          : '上游题目没有题型字段，无法判断质检判据',
        rawType: rawTypeValue || null,
        questionId: raw.question_id ?? null,
      });
      continue;
    }

    const stem = text(raw.question ?? raw.stem ?? raw.prompt);
    if (stem === '') {
      diagnostics.push({
        kind: 'rejected',
        severity: 'error',
        runId,
        reason: '题目缺题干（上游 `question` 字段为空）',
        rawType: normalized.rawType || null,
        questionId: raw.question_id ?? null,
      });
      continue;
    }

    const result = {
      type: normalized.type,
      /** 值域标记：本候选属于 `strategies.js` 的 QUESTION_TYPES，不是 `model.js` 的 QUIZ_TYPES。 */
      typeVocabulary: 'strategies',
      /** 上游原始题型，永远保留 —— 下游要归因或补映射时只能靠它。 */
      rawType: normalized.rawType,
      runId,
      questionId: raw.question_id ?? null,
      taskId: rowMetadata?.taskId ?? rowMetadata?.task_id ?? raw.task_id ?? null,
      stem,
      options: toOptions(raw.options),
      answer: null,
      explanation: text(raw.explanation) || null,
      difficulty: text(raw.difficulty) || null,
      topic: text(raw.concentration ?? raw.topic) || null,
      /** 上游自报的缺陷标记（`pipeline.py:1351` 用 `metadata.issues` 判"题还可疑"）。 */
      issues: Array.isArray(rowMetadata?.issues) ? rowMetadata.issues : null,
      anchors,
      resourceRevision,
      modelSnapshot: rowMetadata
        ? {
          usage: rowMetadata.usage_summary ?? null,
          cost: rowMetadata.cost_summary ?? null,
        }
        : null,
      /** 上游原样输出，排查时唯一可信的证据。 */
      rawOutput: raw,
    };

    if (normalized.type === JUDGE_TYPE) {
      const answer = toJudgeAnswer(raw.correct_answer ?? raw.answer);
      if (answer === null) {
        diagnostics.push({
          kind: 'rejected',
          severity: 'error',
          runId,
          reason: `判断题的答案是 ${JSON.stringify(raw.correct_answer ?? raw.answer)}，不是 true/false 语义`
            + '（上游 concept 题应被规范化成 "true"/"false"）',
          rawType: normalized.rawType || null,
          questionId: result.questionId,
        });
        continue;
      }
      result.answer = answer;
      // 上游对 concept 题强制 options 为 None；如果这里还有选项，说明上游校验没生效，
      // 记一条 note 但不拒收（选项对判断题无意义，丢弃即可）。
      if (result.options) {
        diagnostics.push({
          kind: 'note',
          severity: 'warning',
          runId,
          reason: '判断题带了 options，已忽略（判断题不带选项，上游应有 concept_must_not_have_options 校验）',
          rawType: normalized.rawType || null,
          questionId: result.questionId,
        });
        result.options = null;
      }
    } else if (normalized.type === 'mcq') {
      result.answer = toChoiceAnswer(raw.correct_answer ?? raw.answer);
      if (result.answer === '') {
        diagnostics.push({
          kind: 'rejected',
          severity: 'error',
          runId,
          reason: '选择题缺正确答案',
          rawType: normalized.rawType || null,
          questionId: result.questionId,
        });
        continue;
      }
      if (!result.options) {
        // 不拒收：core-quiz 的 checkCandidate 也不校验 options，两侧口径必须一致。
        diagnostics.push({
          kind: 'note',
          severity: 'warning',
          runId,
          reason: '选择题没有选项（上游 choice 题应带 options），已按无选项候选保留',
          rawType: normalized.rawType || null,
          questionId: result.questionId,
        });
      }
    } else {
      const answer = raw.correct_answer ?? raw.answer ?? null;
      result.answer = Array.isArray(answer) ? answer.map(String) : (answer === null ? null : String(answer));
      if (result.answer === null || (Array.isArray(result.answer) && result.answer.length === 0) || result.answer === '') {
        diagnostics.push({
          kind: 'note',
          severity: 'warning',
          runId,
          reason: '题目没有标准答案，质检可能无法判定等价性',
          rawType: normalized.rawType || null,
          questionId: result.questionId,
        });
      }
    }

    questions.push(result);
  }

  if (!questions.length) {
    diagnostics.push({
      kind: 'all-rejected',
      severity: 'error',
      runId,
      reason: `上游返回了 ${rawList.length} 道题，但没有一道能进智云词表与题干校验`,
    });
  }

  return { questions, diagnostics };
}

export default { QUESTION_TYPE_MAP, JUDGE_TYPE, JUDGE_ALIASES, isJudgeType, toQuizCandidates };
