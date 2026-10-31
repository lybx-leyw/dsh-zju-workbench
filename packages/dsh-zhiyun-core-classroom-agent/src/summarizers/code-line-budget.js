// 源：ref/OpenMAIC/lib/orchestration/summarizers/code-line-budget.ts:1-83
/**
 * 白板代码块的有界渲染。逐字搬运。
 *
 * 源：ref/OpenMAIC/lib/orchestration/summarizers/code-line-budget.ts:1-83
 *
 * 两级字符预算（带内容的行 → 只列 id），两处摘要器共用同一个预算对象，
 * 否则截断规则会各写一份、各漂各的。
 */

export const MAX_LINE_CONTENT_CHARS = 80;
export const MAX_CODE_CONTENT_CHARS = 1200;
export const MAX_CODE_IDLIST_CHARS = 400;

export function createCodeRenderBudget() {
  return { content: MAX_CODE_CONTENT_CHARS, idList: MAX_CODE_IDLIST_CHARS };
}

export function truncateLineContent(content) {
  return content.length > MAX_LINE_CONTENT_CHARS
    ? `${content.slice(0, MAX_LINE_CONTENT_CHARS)}…`
    : content;
}

/**
 * Render code lines against a shared budget, returning the text and the
 * remaining budget so the caller can thread it across multiple code blocks.
 *
 * @param {Array<{id: string, content: string}>} codeLines
 * @param {{content: number, idList: number}} budget
 * @param {string} [indent]
 */
export function renderCodeLines(codeLines, budget, indent = '     ') {
  const out = [];
  let { content, idList } = budget;
  let i = 0;

  // Tier 1: lines shown with (truncated) content.
  for (; i < codeLines.length; i += 1) {
    const rendered = `${indent}${codeLines[i].id}: ${truncateLineContent(codeLines[i].content)}`;
    if (rendered.length > content) break;
    out.push(rendered);
    content -= rendered.length;
  }

  // Tier 2: remaining lines listed as bare ids.
  const idOnly = [];
  for (; i < codeLines.length; i += 1) {
    const piece = idOnly.length === 0 ? codeLines[i].id : `, ${codeLines[i].id}`;
    if (piece.length > idList) break;
    idOnly.push(codeLines[i].id);
    idList -= piece.length;
  }
  if (idOnly.length > 0) {
    out.push(`${indent}(ids only: ${idOnly.join(', ')})`);
  }

  // Anything still unrendered is reported as a count.
  const omitted = codeLines.length - i;
  if (omitted > 0) {
    out.push(`${indent}(… ${omitted} more line(s) omitted)`);
  }

  return { text: out.join('\n'), budget: { content, idList } };
}
