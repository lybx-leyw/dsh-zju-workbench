/**
 * plan 阶段：把 PLAN 标签下的 JSON 解析成 `QuizPlan`。
 *
 * 上游对应：`agents/question/pipeline.py:808-871`。
 *
 * # 这个阶段的四个不成文规矩
 *
 * 1. **用强解析器**（`parseJsonResponse`），不是 quiz 那套弱的。plan 的回复里常
 *    带一段 JSON 示例当前言，弱解析器会先命中示例（T9）。
 * 2. **`question_id` 由这里重编号**（`q_1..q_n`），模型给的 id 一律丢弃（T14）。
 * 3. **topic 小写去重**；重复或空 topic 直接跳过，**不占位**——所以最终题数可能
 *    少于请求数。数量不足只警告，不失败（T5 的另一半）。
 * 4. **难度以用户指定为准**：`diff = target_difficulty or diff_raw`，
 *    再校验合法性，非法一律回落 `medium`。
 */

import { parseJsonResponse } from './json.js';
import { QuestionType, VALID_DIFFICULTIES, VALID_QUESTION_TYPES } from './types.js';

/**
 * 选出「模型给了非法题型时」的兜底类型。
 *
 * 上游（839-841）是 `next(iter(frozenset))`，顺序取决于 Python 字符串哈希——
 * 同进程内稳定、跨进程可能不同。JS 无法复刻，于是固定成**用户传入顺序的第一个**。
 * 这是 SPEC §7-1 那条待确认项的选择：可复现 > 逐字节等价，
 * 且只有在「allowed_types 非空且不含 short_answer 且模型给了非法类型」时才有差别。
 */
export function pickFallbackType(allowedTypes) {
  const allowed = Array.isArray(allowedTypes) && allowedTypes.length
    ? allowedTypes
    : VALID_QUESTION_TYPES;
  if (allowed.includes(QuestionType.SHORT_ANSWER)) return QuestionType.SHORT_ANSWER;
  if (allowed.length) return allowed[0];
  return QuestionType.WRITTEN;
}

/**
 * 上游 `_parse_plan`（808-871）。
 *
 * @param {string} raw            PLAN 标签之后的正文
 * @param {object} options
 * @param {number} options.requested      请求题数（截断上限）
 * @param {string[]} options.allowedTypes 已归一的允许题型（空 = 全集）
 * @param {string} options.targetDifficulty 用户指定难度（空 = 让模型自己定）
 * @returns {{analysis: string, templates: object[]}}
 */
export function parsePlan(raw, { requested = 1, allowedTypes = [], targetDifficulty = '' } = {}) {
  const data = parseJsonResponse(raw, { fallback: {} });
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { analysis: '', templates: [] };
  }
  if (Object.keys(data).length === 0) return { analysis: '', templates: [] };

  const analysis = data.analysis === null || data.analysis === undefined ? '' : String(data.analysis);

  let rawItems = [];
  if (Array.isArray(data.templates)) rawItems = [...data.templates];
  else if (Array.isArray(data.ideas)) rawItems = [...data.ideas];

  const allowedSet = new Set(
    Array.isArray(allowedTypes) && allowedTypes.length ? allowedTypes : VALID_QUESTION_TYPES,
  );
  const fallbackType = pickFallbackType(allowedTypes);

  const templates = [];
  const seenTopics = new Set();
  for (const item of rawItems) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const topic = String(item.topic || item.concentration || '').trim();
    if (!topic) continue;
    if (seenTopics.has(topic.toLowerCase())) continue;
    seenTopics.add(topic.toLowerCase());

    const qtypeRaw = String(item.question_type ?? '').trim().toLowerCase();
    const qtype = allowedSet.has(qtypeRaw) ? qtypeRaw : fallbackType;

    const diffRaw = String(item.difficulty ?? '').trim().toLowerCase();
    let diff = targetDifficulty || diffRaw;
    if (!VALID_DIFFICULTIES.includes(diff)) diff = 'medium';

    templates.push({
      question_id: `q_${templates.length + 1}`,
      topic,
      question_type: qtype,
      difficulty: diff,
      source: 'custom',
      reference_question: null,
      reference_answer: null,
    });
    if (templates.length >= requested) break;
  }
  return { analysis, templates };
}
