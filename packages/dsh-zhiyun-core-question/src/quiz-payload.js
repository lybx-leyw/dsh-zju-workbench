/**
 * 一道题的「模型原文 → 结构化题」全链：归一化、校验、占位兜底。
 *
 * 上游对应：`agents/question/pipeline.py:1406-1508`。
 *
 * # 三条不能动的
 *
 * 1. **`question_type` 以 template 为准**（1412）。模型的自我声明被无条件覆盖：
 *    校验永远针对计划好的题型，repair 提示词里给的也是 template 的值。
 *    "顺手"信任模型返回值会让一道 short_answer 被按 choice 的规则判，或者反过来。
 * 2. **校验不合格不丢题**（1488-1508）。题面空 → `[Generation failed] {topic}`，
 *    答案/解析空 → `"N/A"`。少题会让 `summary.completed/failed` 语义全变。
 * 3. **`options` 只有 choice 可能非空**，concept / fill_in_blank / 其他一律 `null`。
 *    但 choice 的 options 必须**恰好** A/B/C/D 四个非空——三个也算错（T12）。
 */

import {
  CHOICE_KEYS,
  CONCEPT_ANSWERS,
  CONCEPT_FALSE_TOKENS,
  CONCEPT_TRUE_TOKENS,
  FILL_IN_BLANK_TOKEN,
  QuestionType,
} from './types.js';

/** 空值安全的 `str(x or "").strip()`。 */
function str(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * 上游 `_normalize_quiz_payload`（1406-1448）。
 *
 * 顺序有讲究：
 *   1. 浅拷贝（不改调用方对象）；
 *   2. 覆盖 `question_type`；
 *   3. 三个文本字段统一 `str(... or "").strip()`；
 *   4. 按**模板题型**分流处理 `options` 与 `correct_answer`。
 */
export function normalizeQuizPayload(template, payload) {
  const normalized = { ...(payload ?? {}) };
  const expectedType = template.question_type;
  normalized.question_type = expectedType;
  normalized.question = str(normalized.question);
  normalized.correct_answer = str(normalized.correct_answer);
  normalized.explanation = str(normalized.explanation);

  const rawOptions = normalized.options;
  if (expectedType === QuestionType.CHOICE) {
    const clean = {};
    if (rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)) {
      for (const [key, value] of Object.entries(rawOptions)) {
        // 只取首字符再大写：模型常写 "A." / "a)" / "B、"。
        const k = str(key).toUpperCase().slice(0, 1);
        const v = str(value);
        if (CHOICE_KEYS.includes(k) && v) clean[k] = v;
      }
    }
    normalized.options = Object.keys(clean).length ? clean : null;
    if (normalized.options && normalized.correct_answer) {
      const ans = normalized.correct_answer.toUpperCase().trim();
      if (Object.hasOwn(clean, ans)) {
        normalized.correct_answer = ans;
      } else {
        // 线性找「值等于答案」的选项：命中就把答案换成键。
        // 这是**第一个命中**，依赖对象插入顺序（上游 dict 同序）。
        for (const [key, value] of Object.entries(clean)) {
          if (normalized.correct_answer.toLowerCase() === value.toLowerCase()) {
            normalized.correct_answer = key;
            break;
          }
        }
        // 找不到就保持原文——后续 `_collect_quiz_issues` 会判 issue 并走 repair。
      }
    }
  } else if (expectedType === QuestionType.CONCEPT) {
    normalized.options = null;
    const rawAns = normalized.correct_answer.toLowerCase();
    if (CONCEPT_TRUE_TOKENS.includes(rawAns)) normalized.correct_answer = 'true';
    else if (CONCEPT_FALSE_TOKENS.includes(rawAns)) normalized.correct_answer = 'false';
    // 未命中就**原样保留**（随后判 concept_correct_answer_must_be_true_or_false）。
  } else {
    normalized.options = null;
  }
  return normalized;
}

function nonEmptyOptions(options) {
  return options !== null && typeof options === 'object' && !Array.isArray(options)
    && Object.keys(options).length > 0;
}

/**
 * 上游 `_collect_quiz_issues`（1450-1486）。
 *
 * 返回的是**字符串码列表**，不是布尔——repair 提示词里要把它 JSON 化后原样告诉模型
 * （`["missing_explanation"]`），所以码名就是对外契约的一部分。
 */
export function collectQuizIssues(template, payload) {
  const issues = [];
  const question = str(payload?.question);
  const correct = str(payload?.correct_answer);
  const explanation = str(payload?.explanation);
  const options = payload?.options;
  const isDictOptions = options !== null && typeof options === 'object' && !Array.isArray(options);

  if (!question) issues.push('missing_question');
  if (!correct) issues.push('missing_correct_answer');
  if (!explanation) issues.push('missing_explanation');

  const qtype = template.question_type;
  if (qtype === QuestionType.CHOICE) {
    const keys = isDictOptions ? Object.keys(options) : [];
    const sameSet = keys.length === CHOICE_KEYS.length && CHOICE_KEYS.every((k) => keys.includes(k));
    if (!isDictOptions || !sameSet) issues.push('choice_options_must_be_a_to_d');
    if (!CHOICE_KEYS.includes(correct.toUpperCase())) {
      issues.push('choice_correct_answer_must_be_option_key');
    }
  } else if (qtype === QuestionType.CONCEPT) {
    if (nonEmptyOptions(options)) issues.push('concept_must_not_have_options');
    if (!CONCEPT_ANSWERS.includes(correct.toLowerCase())) {
      issues.push('concept_correct_answer_must_be_true_or_false');
    }
  } else if (qtype === QuestionType.FILL_IN_BLANK) {
    if (nonEmptyOptions(options)) issues.push('fill_in_blank_must_not_have_options');
    // 上游只检「是否存在」，不检「恰好一处」——与提示词要求不一致，但照搬。
    if (question && !question.includes(FILL_IN_BLANK_TOKEN)) {
      issues.push('fill_in_blank_question_must_contain_blank_token');
    }
  } else {
    if (nonEmptyOptions(options)) issues.push('non_choice_must_not_have_options');
    // 故意的启发式：单个 A/B/C/D 字符被判成「像选项键」。
    // 它会把 short_answer 里合法答案 "A" 误判——上游保留了这个误判，别"修"（T13）。
    if (CHOICE_KEYS.includes(correct.toUpperCase()) && correct.length === 1) {
      issues.push('non_choice_correct_answer_looks_like_option_key');
    }
  }
  return issues;
}

/**
 * 上游 `_payload_to_qa_pair`（1488-1508）—— **永不失败**。
 *
 * `topic` / `difficulty` 来自 template（不是模型返回值）；`metadata.issues` 是
 * `summary.success/failed` 的唯一判据（T18），所以这里只能放 `{issues}` 或 `{}`，
 * 不能塞别的键。
 */
export function payloadToQaPair(template, payload, { issues = [] } = {}) {
  let question = str(payload?.question);
  if (!question) question = `[Generation failed] ${template.topic}`;
  const options = payload?.options;
  return {
    question_id: template.question_id,
    question,
    question_type: template.question_type,
    correct_answer: str(payload?.correct_answer) || 'N/A',
    explanation: str(payload?.explanation) || 'N/A',
    options: options !== null && typeof options === 'object' && !Array.isArray(options) ? options : null,
    topic: template.topic,
    difficulty: template.difficulty,
    metadata: issues.length ? { issues } : {},
  };
}

/**
 * Python 真值语义：`{}` / `[]` / `""` / `0` / `null` 都为假。
 *
 * 单独抽出来是因为 `if repaired:` 是**这个包最容易搬错的一行**（T7）：
 * JS 的 `{}` 是 truthy，照抄 `if (repaired)` 会把一次失败的 repair（返回 `{}`）
 * 当成成功，用空对象覆盖掉原本只差一个 explanation 的题面。
 */
export function pythonTruthy(value) {
  if (value === null || value === undefined || value === false) return false;
  if (value === true) return true;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** `_qa_pair_to_dict`（1952-1963）：topic 以 **`concentration`** 暴露，兼容旧 QAPair。 */
export function qaPairToDict(qa) {
  return {
    question_id: qa.question_id,
    question: qa.question,
    question_type: qa.question_type,
    options: qa.options,
    correct_answer: qa.correct_answer,
    explanation: qa.explanation,
    difficulty: qa.difficulty,
    concentration: qa.topic,
  };
}

/** `_template_to_dict`（1965-1975）：这里键名才是 `topic`（与上面刻意不同）。 */
export function templateToDict(template) {
  return {
    question_id: template.question_id,
    topic: template.topic,
    question_type: template.question_type,
    difficulty: template.difficulty,
    source: template.source,
    reference_question: template.reference_question,
    reference_answer: template.reference_answer,
  };
}
