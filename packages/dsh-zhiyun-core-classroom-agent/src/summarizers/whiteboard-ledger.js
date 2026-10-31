// 源：ref/OpenMAIC/lib/orchestration/summarizers/whiteboard-ledger.ts:1-316
/**
 * 虚拟白板台账：把本轮的白板动作重放到请求起始快照上，产出给下一个智能体看的
 * 「板上现在有什么」。逐字搬运。
 *
 * 源：ref/OpenMAIC/lib/orchestration/summarizers/whiteboard-ledger.ts:1-316
 */

import { createCodeRenderBudget, renderCodeLines } from './code-line-budget.js';

function getRecordElementId(record) {
  const elementId = record.params.elementId;
  return typeof elementId === 'string' && elementId ? elementId : undefined;
}

function summarizeCodeElement(element) {
  const lines = element.codeLines ?? [];
  const fileName = element.codeFileName ? ` "${element.codeFileName}"` : '';
  return `code block${fileName} (${element.codeLanguage || 'text'}, ${lines.length} lines)`;
}

function getInitialWhiteboardElements(storeState) {
  const whiteboards = storeState.stage?.whiteboard;
  const latestWhiteboard = Array.isArray(whiteboards) ? whiteboards.at(-1) : null;
  const source = latestWhiteboard?.elements;
  if (!Array.isArray(source)) return [];

  return source.flatMap((element) => {
    if (!element || typeof element !== 'object') return [];
    const candidate = element;
    if (typeof candidate.id !== 'string' || !candidate.id) return [];
    if (candidate.type !== 'code') {
      return [
        {
          agentName: 'Before this round',
          elementId: candidate.id,
          summary: `existing ${String(candidate.type || 'element')} [id:${candidate.id}]`,
          lastTouchedSequence: null,
        },
      ];
    }

    const virtual = {
      agentName: 'Before this round',
      elementId: candidate.id,
      summary: '',
      lastTouchedSequence: null,
      codeLines: Array.isArray(candidate.lines)
        ? candidate.lines.flatMap((line) => {
            if (!line || typeof line !== 'object') return [];
            const value = line;
            return typeof value.id === 'string'
              ? [{ id: value.id, content: String(value.content ?? '') }]
              : [];
          })
        : [],
      codeLanguage: typeof candidate.language === 'string' ? candidate.language : 'text',
      codeFileName: typeof candidate.fileName === 'string' ? candidate.fileName : undefined,
    };
    virtual.summary = summarizeCodeElement(virtual);
    return [virtual];
  });
}

function applyCodeEdit(target, record, sequence) {
  if (!target.codeLines) return;
  const operation = record.params.operation;
  const contentLines = String(record.params.content ?? '').split('\n');
  const targetIds = Array.isArray(record.params.lineIds) ? record.params.lineIds.map(String) : [];
  const newLineIds = Array.isArray(record.params.newLineIds)
    ? record.params.newLineIds.map(String)
    : [];

  if (operation === 'insert_after' || operation === 'insert_before') {
    const lineId = String(record.params.lineId || '');
    const index = target.codeLines.findIndex((line) => line.id === lineId);
    if (index >= 0) {
      target.codeLines.splice(
        operation === 'insert_after' ? index + 1 : index,
        0,
        ...contentLines.map((content, offset) => ({
          id: newLineIds[offset] ?? `${lineId}-${operation}-${offset + 1}`,
          content,
        })),
      );
    }
  } else if (operation === 'delete_lines') {
    const deleteIds = new Set(targetIds);
    target.codeLines = target.codeLines.filter((line) => !deleteIds.has(line.id));
  } else if (operation === 'replace_lines') {
    const firstIndex = target.codeLines.findIndex((line) => line.id === targetIds[0]);
    if (firstIndex >= 0) {
      const replaceIds = new Set(targetIds);
      target.codeLines = target.codeLines.filter((line) => !replaceIds.has(line.id));
      target.codeLines.splice(
        firstIndex,
        0,
        ...contentLines.map((content, index) => ({
          id: newLineIds[index] ?? targetIds[index] ?? `${targetIds[0]}-replacement-${index + 1}`,
          content,
        })),
      );
    }
  }

  target.agentName = record.agentName;
  target.lastTouchedSequence = sequence;
  target.summary = `${summarizeCodeElement(target)}; edited (${String(operation || 'edit')})`;
}

/** Replay this round's ledger on top of the request-start whiteboard snapshot. */
export function buildVirtualWhiteboardContext(storeState, ledger) {
  if (!ledger || ledger.length === 0) return '';

  const elements = getInitialWhiteboardElements(storeState);
  let hasContentMutation = false;
  // Monotonic counter incremented on each wb_draw_code / successful wb_edit_code.
  let touchSequence = 0;

  for (const record of ledger) {
    const elementId = getRecordElementId(record);
    switch (record.actionName) {
      case 'wb_clear':
        hasContentMutation = true;
        elements.length = 0;
        break;
      case 'wb_delete':
        hasContentMutation = true;
        for (let index = elements.length - 1; index >= 0; index -= 1) {
          if (elements[index].elementId === elementId) elements.splice(index, 1);
        }
        break;
      case 'wb_draw_text': {
        hasContentMutation = true;
        const content = String(record.params.content || '').slice(0, 40);
        elements.push({
          agentName: record.agentName,
          elementId,
          lastTouchedSequence: null,
          summary: `text: "${content}${content.length >= 40 ? '...' : ''}" at (${record.params.x ?? '?'},${record.params.y ?? '?'}), size ~${record.params.width ?? 400}x${record.params.height ?? 100}`,
        });
        break;
      }
      case 'wb_draw_shape':
        hasContentMutation = true;
        elements.push({
          agentName: record.agentName,
          elementId,
          lastTouchedSequence: null,
          summary: `shape(${record.params.type || record.params.shape || 'rectangle'}) at (${record.params.x ?? '?'},${record.params.y ?? '?'}), size ${record.params.width ?? 100}x${record.params.height ?? 100}`,
        });
        break;
      case 'wb_draw_chart': {
        hasContentMutation = true;
        const labels = Array.isArray(record.params.labels)
          ? record.params.labels
          : record.params.data?.labels;
        elements.push({
          agentName: record.agentName,
          elementId,
          lastTouchedSequence: null,
          summary: `chart(${record.params.chartType || record.params.type || 'bar'})${labels ? `: labels=[${labels.slice(0, 4).join(',')}]` : ''} at (${record.params.x ?? '?'},${record.params.y ?? '?'}), size ${record.params.width ?? 350}x${record.params.height ?? 250}`,
        });
        break;
      }
      case 'wb_draw_latex': {
        hasContentMutation = true;
        const latex = String(record.params.latex || '').slice(0, 40);
        elements.push({
          agentName: record.agentName,
          elementId,
          lastTouchedSequence: null,
          summary: `latex: "${latex}${latex.length >= 40 ? '...' : ''}" at (${record.params.x ?? '?'},${record.params.y ?? '?'}), size ~${record.params.width ?? 400}x${record.params.height ?? 80}`,
        });
        break;
      }
      case 'wb_draw_table': {
        hasContentMutation = true;
        const data = record.params.data;
        const rows = data?.length || 0;
        const cols = data?.[0]?.length || 0;
        elements.push({
          agentName: record.agentName,
          elementId,
          lastTouchedSequence: null,
          summary: `table(${rows}×${cols}) at (${record.params.x ?? '?'},${record.params.y ?? '?'}), size ${record.params.width ?? 400}x${record.params.height ?? rows * 40 + 20}`,
        });
        break;
      }
      case 'wb_draw_line':
        hasContentMutation = true;
        elements.push({
          agentName: record.agentName,
          elementId,
          lastTouchedSequence: null,
          summary: `line${record.params.points?.includes('arrow') ? ' (arrow)' : ''}: (${record.params.startX ?? '?'},${record.params.startY ?? '?'}) → (${record.params.endX ?? '?'},${record.params.endY ?? '?'})`,
        });
        break;
      case 'wb_draw_code': {
        hasContentMutation = true;
        const code = String(record.params.code || '');
        const suppliedIds = Array.isArray(record.params.lineIds)
          ? record.params.lineIds.map(String)
          : [];
        const virtual = {
          agentName: record.agentName,
          elementId,
          summary: '',
          lastTouchedSequence: (touchSequence += 1),
          codeLines: code
            .split('\n')
            .map((content, index) => ({ id: suppliedIds[index] ?? `L${index + 1}`, content })),
          codeLanguage: String(record.params.language || 'text'),
          codeFileName: record.params.fileName ? String(record.params.fileName) : undefined,
        };
        virtual.summary = `${summarizeCodeElement(virtual)} at (${record.params.x ?? '?'},${record.params.y ?? '?'}), size ${record.params.width ?? 500}x${record.params.height ?? 300}`;
        elements.push(virtual);
        break;
      }
      case 'wb_edit_code': {
        hasContentMutation = true;
        const target = elements.find((element) => element.elementId === elementId);
        if (target) applyCodeEdit(target, record, (touchSequence += 1));
        break;
      }
      default:
        break;
    }
  }

  if (!hasContentMutation) return '';
  if (elements.length === 0) {
    return `
## Whiteboard Changes This Round (IMPORTANT)
The whiteboard is now empty after changes made during this discussion round.
`;
  }

  // Code-line budget is shared across all elements so the whole section is
  // bounded; allocation order is priority (this round's code first, most recent
  // first), display order stays board order.
  let codeBudget = createCodeRenderBudget();
  const renderedCodeByIndex = new Map();
  const budgetOrder = elements
    .map((_, index) => index)
    .sort((a, b) => {
      const sa = elements[a].lastTouchedSequence;
      const sb = elements[b].lastTouchedSequence;
      if (sa === null && sb === null) return 0;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sb - sa;
    });
  for (const index of budgetOrder) {
    const codeLines = elements[index].codeLines ?? [];
    if (codeLines.length === 0) continue;
    const { text, budget } = renderCodeLines(codeLines, codeBudget);
    codeBudget = budget;
    renderedCodeByIndex.set(index, text);
  }
  const elementLines = elements
    .map((element, index) => {
      const idTag = element.elementId ? ` (id: ${element.elementId})` : '';
      const header = `  ${index + 1}. [by ${element.agentName}]${idTag} ${element.summary}`;
      const codeText = renderedCodeByIndex.get(index);
      return codeText ? `${header}\n${codeText}` : header;
    })
    .join('\n');
  return `
## Whiteboard Changes This Round (IMPORTANT)
Other agents have modified the whiteboard during this discussion round.
Current whiteboard elements (${elements.length}):
${elementLines}

DO NOT redraw content that already exists. Check positions above before adding new elements.
`;
}
