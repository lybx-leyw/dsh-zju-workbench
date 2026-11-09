// 源：ref/OpenMAIC/lib/orchestration/summarizers/state-context.ts:1-271
/**
 * 课堂状态上下文：把 storeState（舞台/场景/白板/测验作答）压成 prompt 可见的文本。
 *
 * 源：ref/OpenMAIC/lib/orchestration/summarizers/state-context.ts:1-271
 */

import { buildWhiteboardConflicts } from './whiteboard-conflicts.js';
import { createCodeRenderBudget, renderCodeLines } from './code-line-budget.js';

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

function extractCodeLines(el) {
  return (el.lines || []).map((l) => ({
    id: String(l.id ?? ''),
    content: String(l.content ?? ''),
  }));
}

/**
 * Summarize a single PPT element into a one-line description.
 * For code elements, `codeText` is the already-budget-rendered line block.
 */
function summarizeElement(el, codeText) {
  const id = el.id ? `[id:${el.id}]` : '';
  const pos = `at (${Math.round(el.left)},${Math.round(el.top)})`;
  const size =
    el.width != null && el.height != null
      ? ` size ${Math.round(el.width)}×${Math.round(el.height)}`
      : el.width != null
        ? ` w=${Math.round(el.width)}`
        : '';

  switch (el.type) {
    case 'text': {
      const text = stripHtml(el.content || '').slice(0, 60);
      const suffix = text.length >= 60 ? '...' : '';
      return `${id} text${el.textType ? `[${el.textType}]` : ''}: "${text}${suffix}" ${pos}${size}`;
    }
    case 'image': {
      const src = el.src?.startsWith('data:') ? '[embedded]' : el.src?.slice(0, 50) || 'unknown';
      return `${id} image: ${src} ${pos}${size}`;
    }
    case 'shape': {
      const shapeText = el.text?.content ? stripHtml(el.text.content).slice(0, 40) : '';
      return `${id} shape${shapeText ? `: "${shapeText}"` : ''} ${pos}${size}`;
    }
    case 'chart':
      return `${id} chart[${el.chartType}]: labels=[${(el.data?.labels || []).slice(0, 4).join(',')}] ${pos}${size}`;
    case 'table': {
      const rows = el.data?.length || 0;
      const cols = el.data?.[0]?.length || 0;
      return `${id} table: ${rows}x${cols} ${pos}${size}`;
    }
    case 'latex':
      return `${id} latex: "${(el.latex || '').slice(0, 40)}" ${pos}${size}`;
    case 'line': {
      const lx = Math.round(el.left ?? 0);
      const ly = Math.round(el.top ?? 0);
      const sx = el.start?.[0] ?? 0;
      const sy = el.start?.[1] ?? 0;
      const ex = el.end?.[0] ?? 0;
      const ey = el.end?.[1] ?? 0;
      return `${id} line: (${lx + sx},${ly + sy}) → (${lx + ex},${ly + ey})`;
    }
    case 'code': {
      const lang = el.language || 'unknown';
      const lineCount = el.lines?.length || 0;
      const codeFn = el.fileName ? ` "${el.fileName}"` : '';
      const header = `${id} code${codeFn} (${lang}, ${lineCount} lines) ${pos}${size}`;
      return codeText ? `${header}\n${codeText}` : header;
    }
    case 'video':
      return `${id} video ${pos}${size}`;
    case 'audio':
      return `${id} audio ${pos}${size}`;
    default:
      return `${id} ${el.type || 'unknown'} ${pos}${size}`;
  }
}

/**
 * Summarize an array of elements into line descriptions. Code blocks share a
 * single render budget across the whole array.
 *
 * @param {Array<Record<string, unknown>>} elements
 * @param {'source'|'newest-first'} [budgetOrder]
 */
export function summarizeElements(elements, budgetOrder = 'source') {
  if (elements.length === 0) return '  (empty)';

  const order = elements.map((_, i) => i);
  if (budgetOrder === 'newest-first') order.reverse();

  let budget = createCodeRenderBudget();
  const renderedCodeByIndex = new Map();
  for (const i of order) {
    if (elements[i]?.type !== 'code') continue;
    const codeLines = extractCodeLines(elements[i]);
    if (codeLines.length === 0) continue;
    const { text, budget: next } = renderCodeLines(codeLines, budget);
    budget = next;
    renderedCodeByIndex.set(i, text);
  }

  const lines = elements.map(
    (el, i) => `  ${i + 1}. ${summarizeElement(el, renderedCodeByIndex.get(i))}`,
  );

  return lines.join('\n');
}

/** Build context string from store state. */
export function buildStateContext(storeState) {
  const { stage, scenes, currentSceneId, mode, whiteboardOpen, quizResults } = storeState;

  const lines = [];

  // Mode
  lines.push(`Mode: ${mode}`);

  // Whiteboard status
  lines.push(
    `Whiteboard: ${whiteboardOpen ? 'OPEN (slide canvas is hidden)' : 'closed (slide canvas is visible)'}`,
  );

  // Stage info
  if (stage) {
    lines.push(
      `Course: ${stage.name || 'Untitled'}${stage.description ? ` - ${stage.description}` : ''}`,
    );
  }

  // Scenes summary
  lines.push(`Total scenes: ${scenes.length}`);

  if (currentSceneId) {
    const currentScene = scenes.find((s) => s.id === currentSceneId);
    if (currentScene) {
      lines.push(
        `Current scene: "${currentScene.title}" (${currentScene.type}, id: ${currentSceneId})`,
      );

      // Slide scene: include element details
      if (currentScene.content.type === 'slide') {
        const elements = currentScene.content.canvas.elements;
        lines.push(`Current slide elements (${elements.length}):\n${summarizeElements(elements)}`);
      }

      // Quiz scene: question summary, or post-submit results when finished.
      if (currentScene.content.type === 'quiz') {
        const questions = currentScene.content.questions;
        const hasGradedResults =
          !!quizResults && quizResults.sceneId === currentSceneId && quizResults.results.length > 0;

        if (hasGradedResults && quizResults) {
          const resultsById = new Map(quizResults.results.map((r) => [r.questionId, r]));
          const answersById = quizResults.answers;
          const lineEntries = questions.map((q, i) => {
            const r = resultsById.get(q.id);
            const ans = answersById?.[q.id];
            const studentAnswer = Array.isArray(ans) ? ans.join(', ') : (ans ?? '');
            const correctAnswer =
              Array.isArray(q.answer) && q.answer.length > 0 ? q.answer.join(', ') : '(open-ended)';
            const verdict = r ? r.status.toUpperCase() : 'UNGRADED';
            const points = q.points ?? 1;
            const earned = r?.earned ?? 0;
            const entry = [
              `  ${i + 1}. [${q.type}] ${q.question}`,
              `     Student answer: ${studentAnswer || '(empty)'}`,
              `     Correct answer: ${correctAnswer}`,
              `     Verdict: ${verdict} (${earned}/${points} pts)`,
            ];
            if (q.analysis) entry.push(`     Reference analysis: ${q.analysis}`);
            if (r?.aiComment) entry.push(`     AI grader comment: ${r.aiComment}`);
            return entry.join('\n');
          });
          const score = quizResults.results.reduce((acc, r) => acc + (r.earned ?? 0), 0);
          const total = questions.reduce((acc, q) => acc + (q.points ?? 1), 0);
          lines.push(
            `Quiz results — the student JUST submitted (${score}/${total} pts). Use these to address THIS student's specific mistakes; do not re-teach what they already got right. Walk through wrong answers, acknowledge correct ones briefly, and tie feedback back to the underlying concept.\n${lineEntries.join('\n')}`,
          );
        } else {
          const qSummary = questions
            .map((q, i) => {
              const optionsPart =
                q.options && q.options.length > 0
                  ? `\n     Options: ${q.options.map((o) => `${o.value}. ${o.label}`).join(' | ')}`
                  : '';
              return `  ${i + 1}. [${q.type}] ${q.question}${optionsPart}`;
            })
            .join('\n');
          lines.push(
            [
              `Quiz scene — the student has NOT submitted yet. ${questions.length} question(s) below. You have this so you can clarify when the student asks about a specific item — NOT so you can teach them through it preemptively.`,
              'Strict rules while the quiz is unsubmitted (override everything else):',
              '- Do NOT proactively list, recite, paraphrase, summarise, or walk through the questions. Mentioning them at all on your own initiative is a leak.',
              '- Do NOT reveal the correct answer, eliminate options, or hint strongly enough that the answer is obvious. Even a leading phrase like "think about whether x is really an integer" is too much when it points at the answer.',
              '- Do NOT teach the underlying concept end-to-end here. The concepts were already taught earlier; re-teaching them now is equivalent to giving the answers.',
              '- If the student claims to be done but no submitted results have arrived in this context, treat the absence of `Quiz results` above as authoritative — they have NOT submitted. Point them at the Submit button on the right-hand panel; do not start grading or summarising from memory.',
              '- If the student asks for help on a SPECIFIC question (by number, by option, or by quoting the stem), you MAY ask a single Socratic question or clarify a concept WITHOUT naming the correct option. Otherwise stay encouraging and meta ("看不懂哪一题？" / "Take it one question at a time").',
              '- You MAY answer how-the-quiz-works questions (how to submit, how many questions, what types) and offer encouragement.',
            ].join('\n') + `\n${qSummary}`,
          );
        }
      }
    }
  } else if (scenes.length > 0) {
    lines.push('No scene currently selected');
  }

  // List first few scenes
  if (scenes.length > 0) {
    const sceneSummary = scenes
      .slice(0, 5)
      .map((s, i) => `  ${i + 1}. ${s.title} (${s.type}, id: ${s.id})`)
      .join('\n');
    lines.push(
      `Scenes:\n${sceneSummary}${scenes.length > 5 ? `\n  ... and ${scenes.length - 5} more` : ''}`,
    );
  }

  // Whiteboard content (last whiteboard in the stage)
  if (stage?.whiteboard && stage.whiteboard.length > 0) {
    const lastWb = stage.whiteboard[stage.whiteboard.length - 1];
    const wbElements = lastWb.elements || [];
    lines.push(
      `Whiteboard (last of ${stage.whiteboard.length}, ${wbElements.length} elements):\n${summarizeElements(wbElements, 'newest-first')}`,
    );
    const conflictsText = buildWhiteboardConflicts(wbElements);
    if (conflictsText) lines.push(conflictsText);
  }

  return lines.join('\n');
}
