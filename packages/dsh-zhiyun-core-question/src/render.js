/**
 * 提示词里那些「插值片段」的渲染器。
 *
 * 上游对应：`agents/question/pipeline.py:1857-1950`。
 *
 * 这些函数的输出会**逐字进入提示词**，所以每一处措辞、每一条分隔符、每个截断长度
 * 都是行为的一部分，不是格式偏好。特别是：
 * - `_render_previous_questions` **不截断**（题面很长时提示词线性膨胀，上游知道并接受）；
 * - `_render_quiz_history` 截 160 / 80 字符（吃历史记录时数据量不可控）；
 * - `_render_exploration_trace` 主动**丢弃** user 消息（T11）。
 */

import { CHOICE_KEYS } from './types.js';

/** `_render_attachments_summary`（1857-1865）。 */
export function renderAttachmentsSummary(t, attachments) {
  if (!attachments || !attachments.length) return t('empty.no_attachments');
  return attachments
    .map((att) => {
      const name = att?.filename || att?.type || 'attachment';
      const kind = att?.type ?? '';
      return `- ${name} (${kind})`;
    })
    .join('\n');
}

/** `_correctness_label`（1885-1890）：`None` = 未作答，不是"做错"。 */
export function correctnessLabel(isCorrect, language) {
  const zh = String(language ?? '').toLowerCase().startsWith('zh');
  if (isCorrect === true) return zh ? '做对' : 'correct';
  if (isCorrect === false) return zh ? '做错' : 'incorrect';
  return zh ? '未知' : 'unknown';
}

/** `_render_quiz_history`（1867-1883）。 */
export function renderQuizHistory(t, history, language) {
  if (!history || !history.length) return t('empty.no_quiz_history');
  return history
    .map((entry) => {
      const turnId = entry.turn_id || '?';
      const label = correctnessLabel(entry.is_correct, language);
      const question = String(entry.question ?? '').slice(0, 160);
      let line = `- (${turnId}) [${label}] ${question}`;
      if (entry.user_answer || entry.correct_answer) {
        const userAnswer = String(entry.user_answer ?? '').slice(0, 80);
        const reference = String(entry.correct_answer ?? '').slice(0, 80);
        line += ` — learner answer: ${userAnswer}; reference: ${reference}`;
      }
      return line;
    })
    .join('\n');
}

/** `_render_plan_summary`（1892-1903）。 */
export function renderPlanSummary(plan) {
  if (!plan?.templates?.length) return '(empty plan)';
  const lines = [];
  if (plan.analysis) lines.push(`Analysis: ${plan.analysis}`);
  for (const template of plan.templates) {
    lines.push(
      `  - [${template.question_id}] (${template.question_type}/${template.difficulty}) ${template.topic}`,
    );
  }
  return lines.join('\n');
}

/** `_render_previous_questions`（1905-1908）：**不截断**。 */
export function renderPreviousQuestions(t, qaPairs) {
  if (!qaPairs || !qaPairs.length) return t('empty.no_previous_questions');
  return qaPairs.map((qa, index) => `${index + 1}. ${qa.question}`).join('\n');
}

/**
 * `_render_reference_block`（1910-1930）。
 *
 * 只有 `source === 'mimic'` 的模板才渲染参考素材；两字段都空时也是空标记。
 */
export function renderReferenceBlock(t, template) {
  if (template?.source !== 'mimic') return t('empty.no_reference');
  const referenceQ = String(template.reference_question ?? '').trim();
  const referenceA = String(template.reference_answer ?? '').trim();
  if (!referenceQ && !referenceA) return t('empty.no_reference');
  const lines = [];
  if (referenceQ) lines.push(`Reference question:\n${referenceQ}`);
  if (referenceA) lines.push(`Reference answer:\n${referenceA}`);
  return lines.join('\n\n');
}

/** `_strip_protocol_label`（1277-1285）：只剥**开头**那一个标签。 */
export function stripProtocolLabel(text) {
  let stripped = String(text ?? '').replace(/^\s+/, '');
  for (const label of ['``THINK``', '``TOOL``', '``FINISH``']) {
    if (stripped.startsWith(label)) {
      return stripped.slice(label.length).replace(/^\n+/, '').replace(/^\s+/, '');
    }
  }
  return text;
}

/**
 * `_render_exploration_trace`（1176-1275）。
 *
 * 三条刻在注释里的规矩：
 * - `role=user` **跳过**：循环内注入的都是协议修复/强制收尾提示，属于噪声（T11）；
 * - `role=tool` 用 `tool_call_id → name` 反查名字，且 content 此时**已被 summarizer
 *   替换**（这个渲染器不需要、也不该再压缩一次）；
 * - 纯文本 assistant 视为 THINK 迭代，剥掉开头标签再输出。
 *
 * @param {object[]} loopMessages explore 循环里**初始消息之后**的那些消息
 * @param {string} finishText     FINISH 正文（同时展示给用户那段）
 */
export function renderExplorationTrace(t, loopMessages, finishText = '') {
  const messages = loopMessages ?? [];
  const finish = String(finishText ?? '').trim();
  if (messages.length === 0 && !finish) return t('empty.no_exploration_trace');

  const blocks = [];
  let iteration = 0;
  const toolCallNames = new Map();

  for (const message of messages) {
    const role = message?.role;
    const content = String(message?.content ?? '').trim();

    if (role === 'assistant') {
      const toolCalls = message?.tool_calls ?? [];
      if (toolCalls.length) {
        iteration += 1;
        for (const tc of toolCalls) {
          const fn = tc?.function ?? {};
          const name = fn.name || 'tool';
          const tcId = tc?.id || '';
          if (tcId) toolCallNames.set(tcId, name);
          const rawArgs = fn.arguments || '{}';
          let argsDisplay;
          try {
            argsDisplay = JSON.stringify(JSON.parse(rawArgs), null, 2);
          } catch {
            argsDisplay = String(rawArgs);
          }
          const header = t('trace.iteration_tool_call', `Iteration ${iteration} — Tool call: ${name}`, {
            n: iteration,
            tool: name,
          });
          const bodyParts = [];
          if (content) bodyParts.push(content);
          bodyParts.push(`Arguments:\n\`\`\`json\n${argsDisplay}\n\`\`\``);
          blocks.push(`### ${header}\n\n${bodyParts.join('\n\n')}`);
        }
        continue;
      }
      if (!content) continue;
      iteration += 1;
      const stripped = stripProtocolLabel(content);
      const header = t('trace.iteration_thought', `Iteration ${iteration} — Thought`, {
        n: iteration,
      });
      blocks.push(`### ${header}\n\n${stripped}`);
      continue;
    }

    if (role === 'tool') {
      const tcId = message?.tool_call_id || '';
      const name = toolCallNames.get(tcId) ?? 'tool';
      const header = t(
        'trace.iteration_tool_result',
        `Iteration ${iteration} — Tool result (summarized): ${name}`,
        { n: iteration, tool: name },
      );
      blocks.push(`### ${header}\n\n${content || '(empty)'}`);
      continue;
    }

    // role === 'user' 及任何其它角色：跳过（见函数头注释）。
  }

  if (finish) {
    const finishLabel = t(
      'trace.finish_note',
      'Final exploration preface (also shown to the user)',
    );
    blocks.push(`### ${finishLabel}\n\n${finish}`);
  }

  return blocks.length ? blocks.join('\n\n') : t('empty.no_exploration_trace');
}

/**
 * `_render_question_markdown`（1932-1945）。
 *
 * 答案与解析**始终**输出（即使是 `"N/A"`）——用户看到「答案：N/A」能理解成
 * 「这题出坏了」，而整个区块消失只会让人以为界面漏了渲染。
 */
export function renderQuestionMarkdown(qa, ordinal, language) {
  const zh = String(language ?? '').toLowerCase().startsWith('zh');
  const header = zh ? '题目' : 'Question';
  const lines = [`### ${header} ${ordinal}\n`, qa.question];
  if (qa.options && typeof qa.options === 'object' && !Array.isArray(qa.options)
    && Object.keys(qa.options).length) {
    for (const key of CHOICE_KEYS) {
      if (Object.hasOwn(qa.options, key)) lines.push(`- ${key}. ${qa.options[key]}`);
    }
  }
  const answerLabel = zh ? '答案' : 'Answer';
  const explLabel = zh ? '解析' : 'Explanation';
  if (qa.correct_answer) lines.push(`\n**${answerLabel}:** ${qa.correct_answer}`);
  if (qa.explanation) lines.push(`\n**${explLabel}:** ${qa.explanation}`);
  return lines.join('\n').trim();
}

/** `_render_summary_markdown`（1947-1950）。 */
export function renderSummaryMarkdown(qaPairs, language) {
  return (qaPairs ?? [])
    .map((qa, index) => renderQuestionMarkdown(qa, index + 1, language))
    .join('\n\n');
}
