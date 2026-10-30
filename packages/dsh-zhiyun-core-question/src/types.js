/**
 * 题型词表与提示词文案渲染。
 *
 * 上游对应：`agents/question/pipeline.py:156-306`。
 *
 * # 为什么这个文件里**只有一套**实现
 *
 * 上游 `pipeline.py` 把 `_normalize_type_list` / `_normalize_per_type_counts` /
 * `_format_allowed_types` / `_format_per_type_counts` 各定义了**两遍**（187-246 与
 * 249-306）。Python 后定义覆盖前定义，所以生效的是第二份；两份注入提示词的**文案
 * 不同**（空列表 `"auto"` vs `"any (planner picks per question)"`，非空
 * `choice, x` vs `` ``choice``, ``x`` ``）。
 *
 * 移植时只搬第二份。这里的注释里保留第一份的文案，是为了让后来人看到「为什么不是
 * 那个更顺眼的 auto」时能立刻明白：那是死代码。搬错这一处不会报任何错，只会让
 * plan 阶段看到的话术变掉（见 PIPELINE-SPEC §6 T1）。
 */

/** 上游 `QuestionType`（pipeline.py:156-165）。 */
export const QuestionType = Object.freeze({
  CHOICE: 'choice',
  CONCEPT: 'concept',
  FILL_IN_BLANK: 'fill_in_blank',
  SHORT_ANSWER: 'short_answer',
  WRITTEN: 'written',
  CODING: 'coding',
});

/** `_VALID_QUESTION_TYPES`（168）：全集。 */
export const VALID_QUESTION_TYPES = Object.freeze([
  QuestionType.CHOICE,
  QuestionType.CONCEPT,
  QuestionType.FILL_IN_BLANK,
  QuestionType.SHORT_ANSWER,
  QuestionType.WRITTEN,
  QuestionType.CODING,
]);

/** `_VALID_DIFFICULTIES`（170）。顺序即合法性顺序，不要改成对象。 */
export const VALID_DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

/** `_CHOICE_KEYS`（171）：**恰好** A/B/C/D 四个，少一个多一个都算不合格。 */
export const CHOICE_KEYS = Object.freeze(['A', 'B', 'C', 'D']);

/** `_FILL_IN_BLANK_TOKEN`（172）：四个下划线。 */
export const FILL_IN_BLANK_TOKEN = '____';

/** `_CONCEPT_ANSWERS`（173）：concept 题的合法答案字面量。 */
export const CONCEPT_ANSWERS = Object.freeze(['true', 'false']);

/** concept 归一化时接受的「真」变体（pipeline.py:1442）。 */
export const CONCEPT_TRUE_TOKENS = Object.freeze(['true', 't', '对', '正确', 'yes', 'y', '1']);

/** concept 归一化时接受的「假」变体（pipeline.py:1444）。 */
export const CONCEPT_FALSE_TOKENS = Object.freeze(['false', 'f', '错', '错误', 'no', 'n', '0']);

/**
 * 上游 `_normalize_type_list`（生效版，249-264）。
 *
 * 未知值静默丢弃；重复折叠；保留首次出现顺序。空列表 = 任何题型都可以。
 * 上游用 `str(item or "")`，所以 `null` / `undefined` / `0` / `false` 都会变成空串
 * 再被丢弃 —— 这里保留同样的宽容度，不因为传了个 0 就抛错。
 */
export function normalizeTypeList(raw) {
  if (!raw || !raw.length) return [];
  const valid = new Set(VALID_QUESTION_TYPES);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const value = String(item ?? '').trim().toLowerCase();
    if (valid.has(value) && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/**
 * 上游 `_normalize_per_type_counts`（生效版，267-292）。
 *
 * 过滤基准是**已归一化后的** allowed_types：调用方先归一题型，再用它筛配比。
 * 非正整数（含非数值）直接丢弃，不是夹到 0 —— 上游 `if count > 0`。
 */
export function normalizePerTypeCounts(raw, allowedTypes) {
  if (!raw || typeof raw !== 'object') return {};
  const accepted = new Set(
    Array.isArray(allowedTypes) && allowedTypes.length ? allowedTypes : VALID_QUESTION_TYPES,
  );
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const canonical = String(key ?? '').trim().toLowerCase();
    if (!accepted.has(canonical)) continue;
    const count = Number(value);
    // Python `int(value)` 会截断浮点、对 "3" 也成立；NaN/非数值进不了 >0 分支。
    if (!Number.isFinite(count)) continue;
    const truncated = Math.trunc(count);
    if (truncated > 0) out[canonical] = truncated;
  }
  return out;
}

/**
 * 上游 `_format_allowed_types`（**生效版**，295-299）。
 *
 * 空 → `"any (planner picks per question)"`（不是 `"auto"`，那是死代码的文案）；
 * 非空 → 每项用**双反引号**包裹、逗号分隔：``"``choice``, ``concept``"``。
 */
export function formatAllowedTypes(allowedTypes) {
  if (!allowedTypes || !allowedTypes.length) return 'any (planner picks per question)';
  return allowedTypes.map((t) => `\`\`${t}\`\``).join(', ');
}

/**
 * 上游 `_format_per_type_counts`（**生效版**，302-306）。
 *
 * 空 → `"no per-type targets (planner distributes freely)"`；非空 → `choice=3, short_answer=2`。
 */
export function formatPerTypeCounts(perTypeCounts) {
  if (!perTypeCounts || !Object.keys(perTypeCounts).length) {
    return 'no per-type targets (planner distributes freely)';
  }
  return Object.entries(perTypeCounts)
    .map(([type, n]) => `${type}=${n}`)
    .join(', ');
}
