/**
 * 题库题面形状：一条 `QuizPair` → 产品 `questions[]` 的一项。
 *
 * # 为什么需要这一层，且形状必须是这两个字段名
 *
 * 产品侧 `quiz-engine-runtime.js` 的 `normalizeUpstreamQuestion(candidate)` 只认
 * `candidate.stem` / `candidate.answer` / `candidate.options|choices` / `candidate.type`。
 * 给它一个 `{question, correct_answer}` 形状，它会得到 `stem=undefined`，随后
 * `validateNativeQuestion` 抛 `UPSTREAM_FORMAT` —— 整批题被拒，而且报错信息
 * 会指向"DeepTutor 返回了空题目"，让人往完全错误的方向查。
 *
 * # 题型词表是**智云**的，不是上游的
 *
 * `type` 必须落在 `cloze / mcq / trueFalse / shortAnswer` 里（`core-quiz` 的
 * `QUESTION_TYPES`）。上游 6 个值怎么映射见 `host-deeptutor/src/adapters/quiz.js`
 * 的 `QUESTION_TYPE_MAP`：`choice→mcq`、`concept→trueFalse`、`fill_in_blank→cloze`、
 * `short_answer/written/coding→shortAnswer`。
 *
 * **`concept` 是判断题，不是概念填空。** 它的答案被流水线规范成 `"true"`/`"false"`，
 * 而智云判断题只接受「正确」/「错误」。映射错了会让质检用"文本等价"的判据去判一道
 * 真假题——比不判更糟，因为它会给出一份看起来通过了的结果。
 */

/** 上游题型 → 智云题型（与 host 适配器同一张表；两张表漂移等于两套口径）。 */
export const TYPE_MAP = Object.freeze({
  choice: 'mcq',
  concept: 'trueFalse',
  fill_in_blank: 'cloze',
  short_answer: 'shortAnswer',
  written: 'shortAnswer',
  coding: 'shortAnswer',
});

/** 判断题答案的两端：上游 `"true"`/`"false"` → 智云 `正确`/`错误`。 */
export const JUDGE_ANSWER = Object.freeze({ true: '正确', false: '错误' });

/**
 * 一条 `QuizPair` → 产品题。
 *
 * `answer` 一律输出**字符串**：`validateNativeQuestion` 要求
 * `typeof question.answer === 'string' && answer.trim()`，给布尔或数组都会在
 * 产品侧被当成格式错误。
 */
export function toProductQuestion(qa) {
  const type = TYPE_MAP[qa.question_type] ?? 'shortAnswer';
  const rawAnswer = String(qa.correct_answer ?? '').trim();
  let answer = rawAnswer;
  if (type === 'trueFalse') {
    // 只认归一化后的字面量；未命中的（例如模型给了"部分正确"）**原样透传**，
    // 让下游 `toJudgeAnswer` 明确拒收并记一条可读 diagnostic，而不是在这里
    // 悄悄猜一个真假值。
    answer = JUDGE_ANSWER[rawAnswer.toLowerCase()] ?? rawAnswer;
  }
  const choices = type === 'mcq' && qa.options && typeof qa.options === 'object'
    ? ['A', 'B', 'C', 'D']
      .filter((key) => Object.hasOwn(qa.options, key))
      .map((key) => ({ label: key, text: String(qa.options[key] ?? '') }))
    : [];

  return {
    type,
    stem: qa.question,
    // `options` 与 `choices` 都带：上游适配器读 options，`validateNativeQuestion`
    // 读 choices。只给一个，另一条路径就会拿到空数组。
    options: type === 'mcq' && qa.options ? { ...qa.options } : null,
    choices,
    answer,
    explanation: qa.explanation,
    topic: qa.topic ?? '',
    difficulty: qa.difficulty ?? '',
    questionId: qa.question_id,
    /** 上游是否自报缺陷（`metadata.issues`）。产品质检可据此决定是否复核。 */
    issues: qa.metadata?.issues ?? null,
  };
}

/** 整卷映射。 */
export function toProductQuestions(qaPairs) {
  return (qaPairs ?? []).map(toProductQuestion);
}
