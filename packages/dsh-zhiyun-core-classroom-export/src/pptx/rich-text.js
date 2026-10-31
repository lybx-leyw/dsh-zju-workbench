/**
 * 幻灯片散文（富文本 / 表格单元格 / 行内公式）在 PPTX 里的取法。
 *
 * 源：ref/OpenMAIC/lib/export/pptx-rich-text.ts:1-141
 *
 * 两件事，都是上游踩过的坑：
 * 1. 行内公式必须以 **LaTeX 源码** 进 PPTX 的一个 run。走 KaTeX 树的文本会把
 *    MathML 文本、annotation 和每个排版字形连起来（"E=mc2E=mc^2E=mc2"）。
 * 2. 表格单元格只要一个字符串，因此段落 / `<br>` / 换行都要折成 `\n`，
 *    空段落折成空行 —— 与渲染器所见一致。
 */

import { toAST } from './html-parser.js';

const INLINE_MATH_ATTRIBUTE = 'data-inline-math';
const TEX_ENCODING = 'application/x-tex';

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** 源：pptx-rich-text.ts:27-39 */
export function decodeHtmlEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      return code === 0xa0 ? ' ' : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** 源：pptx-rich-text.ts:41-44 */
function attribute(item, key) {
  if (item.type !== 'element') return null;
  return item.attributes.find((attr) => attr.key === key)?.value ?? null;
}

/** 源：pptx-rich-text.ts:46-52 */
function textOf(items) {
  return items
    .map((item) =>
      item.type === 'text' ? item.content : item.type === 'element' ? textOf(item.children) : '',
    )
    .join('');
}

/** 源：pptx-rich-text.ts:54-64 */
function findTexAnnotation(items) {
  for (const item of items) {
    if (item.type !== 'element') continue;
    if (item.tagName === 'annotation' && attribute(item, 'encoding') === TEX_ENCODING) {
      return textOf(item.children);
    }
    const nested = findTexAnnotation(item.children);
    if (nested !== null) return nested;
  }
  return null;
}

/** 源：pptx-rich-text.ts:66-79 */
export function inlineMathSource(item) {
  if (item.type !== 'element' || item.tagName !== 'span') return null;
  const source = attribute(item, INLINE_MATH_ATTRIBUTE);
  if (source !== null) return decodeHtmlEntities(source);
  const classes = (attribute(item, 'class') ?? '').split(/\s+/);
  if (!classes.includes('katex')) return null;
  const annotation = findTexAnnotation(item.children);
  return annotation ? decodeHtmlEntities(annotation) : null;
}

/** 源：pptx-rich-text.ts:81 */
const BLOCK_TAGS = new Set(['p', 'div', 'li']);

/** 源：pptx-rich-text.ts:83-84 — 裸的 `<` / `&` 不算标记。 */
const MARKUP = /<\/?[a-z][^>]*>|<!--/i;

/** 源：pptx-rich-text.ts:86-141 */
export function proseToPlainText(html) {
  if (!MARKUP.test(html)) return html.includes('&') ? decodeHtmlEntities(html) : html;
  const lines = [];
  let line = '';
  const breakLine = () => {
    lines.push(line);
    line = '';
  };
  const walk = (items) => {
    for (const item of items) {
      if (item.type === 'text') {
        const [first, ...rest] = decodeHtmlEntities(item.content).split('\n');
        line += first;
        for (const next of rest) {
          breakLine();
          line += next;
        }
        continue;
      }
      if (item.type !== 'element') continue;
      if (item.tagName === 'br') {
        breakLine();
        continue;
      }
      const source = inlineMathSource(item);
      if (source !== null) {
        line += source;
        continue;
      }
      if (!BLOCK_TAGS.has(item.tagName)) {
        walk(item.children);
        continue;
      }
      if (line) breakLine();
      const linesBefore = lines.length;
      walk(item.children);
      if (line) breakLine();
      else if (lines.length === linesBefore) lines.push('');
    }
  };
  walk(toAST(html));
  if (line) lines.push(line);
  return lines.join('\n');
}
