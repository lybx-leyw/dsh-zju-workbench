/**
 * 幻灯片富文本的持久化边界清洗（服务端版）。
 *
 * 源：ref/OpenMAIC/lib/sanitize/scene-content.ts:1-260
 *     （PROSE_ALLOWED_TAGS / PROSE_ATTRIBUTES / STYLE_PROPERTIES / SAFE_CSS_VALUE /
 *       sanitizeProseHtml / LATEX_ALLOWED_TAGS）
 *     ref/OpenMAIC/lib/export/standalone-html/rich-text.ts:1-212
 *
 * 上游用 `sanitize-html`（它自己不带 DOM）。仓库里没有这个包，也不新增依赖，
 * 所以这里按**同一份白名单**在 `html-parser` 的 AST 上实现：允许的标签重建、
 * 不允许的标签丢弃（保留其文本，`script`/`style`/`textarea`/`option` 的内容整段
 * 丢弃）、属性按 tag 白名单保留、`style` 按属性名白名单 + 值正则过滤。
 *
 * 这条路径是必要的而不是"顺手加的安全网"：导出层读的是**未经持久化**的工作态，
 * 而播放器把它当 HTML 注入自己的文档（`dangerouslySetInnerHTML` 的位置），
 * 一旦导出层不清洗，PPTX/HTML 都成了 XSS 的出口。差别只在实现手段：上游靠
 * sanitize-html，本包靠 AST 过滤 —— 白名单本身逐条照抄。
 */

import { toAST } from '../pptx/html-parser.js';

/** 源：scene-content.ts:153-181 */
const PROSE_ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'blockquote', 'ol', 'ul', 'li', 'a', 'span', 'strong', 'em', 'b', 'i', 'u',
  's', 'strike', 'sub', 'sup', 'code', 'mark', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td',
  'th', 'caption', 'colgroup', 'col',
]);

/** 源：scene-content.ts:183-192 */
const PROSE_ATTRIBUTES = {
  '*': ['class', 'style'],
  a: ['href', 'title', 'target', 'rel', 'name'],
  p: ['align', 'data-indent'],
  ol: ['start'],
  mark: ['data-index'],
  span: ['data-inline-math'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};

/** 源：scene-content.ts:243-247 */
const LATEX_ALLOWED_TAGS = new Set(['span', 'svg', 'path', 'line']);
const LATEX_LAYOUT_TAGS = new Set(['svg', 'path', 'line']);

/** 源：scene-content.ts:57-60 */
const SAFE_CSS_VALUE =
  /^(?!.*(?:url\s*\(|expression\s*\(|@|behavior\s*:|-moz-binding\s*:|vbscript:|javascript:))[^<>{};\\]{0,240}$/i;

/** 源：scene-content.ts:66-137 */
const STYLE_PROPERTIES = new Set([
  'color', 'background-color', 'font-size', 'font-family', 'font-weight', 'font-style',
  'text-align', 'text-indent', 'text-decoration', 'text-decoration-line', 'text-decoration-style',
  'text-transform', 'letter-spacing', 'word-spacing', 'line-height', 'vertical-align',
  'list-style-type', 'word-break', 'word-wrap', 'border', 'border-top', 'border-right',
  'border-bottom', 'border-left', 'border-width', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-style', 'border-top-style',
  'border-right-style', 'border-bottom-style', 'border-left-style', 'border-color',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
]);

/** 源：scene-content.ts:140-141 */
const LAYOUT_STYLE_PROPERTIES = new Set(['top', 'bottom', 'left', 'right', 'position']);

/** 内容整段丢弃的标签（sanitize-html 的 nonTextTags 默认值）。 */
const NON_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'option', 'iframe', 'object', 'embed', 'noscript']);

const INLINE_MATH_ATTRIBUTE = 'data-inline-math';
const TEX_ENCODING = 'application/x-tex';

function escapeText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function textOf(items) {
  return items
    .map((item) => {
      if (item.type === 'text') return escapeText(item.content);
      if (item.type !== 'element') return '';
      return textOf(item.children);
    })
    .join('');
}

function attributeOf(item, key) {
  return item.attributes.find((attr) => attr.key === key)?.value ?? null;
}

/** KaTeX 树里的 TeX annotation（源：inline-math 的 lift 步骤，这里只做源码化）。 */
function findTexAnnotation(items) {
  for (const item of items) {
    if (item.type !== 'element') continue;
    if (item.tagName === 'annotation' && attributeOf(item, 'encoding') === TEX_ENCODING) {
      return textOf(item.children);
    }
    const nested = findTexAnnotation(item.children);
    if (nested !== null) return nested;
  }
  return null;
}

/**
 * 源：inline-math.ts 的 `liftInlineMath` —— 把渲染出来的 KaTeX 树折回
 * `<span data-inline-math="源码">源码</span>`，否则清洗会按标签白名单把公式拍平。
 */
export function liftInlineMath(html) {
  if (!/class\s*=\s*["'][^"']*katex/i.test(html)) return html;
  const tree = toAST(html);
  const lift = (items) =>
    items.map((item) => {
      if (item.type !== 'element') return item;
      const classes = (attributeOf(item, 'class') ?? '').split(/\s+/);
      if (item.tagName === 'span' && classes.includes('katex')) {
        const source = findTexAnnotation(item.children);
        if (source) {
          return {
            type: 'element',
            tagName: 'span',
            attributes: [{ key: INLINE_MATH_ATTRIBUTE, value: source }],
            children: [{ type: 'text', content: source }],
          };
        }
      }
      return { ...item, children: lift(item.children) };
    });
  return serialize(lift(tree));
}

/** AST → HTML（清洗路径自己序列化，属性顺序与转义都是确定的）。 */
function serialize(items) {
  return items
    .map((item) => {
      if (item.type === 'text') return escapeText(item.content);
      if (item.type === 'comment') return '';
      const attributes = item.attributes
        .map((attr) => (attr.value === null ? ` ${attr.key}` : ` ${attr.key}="${escapeAttribute(attr.value)}"`))
        .join('');
      const tag = item.tagName;
      if (tag === 'br' || tag === 'col') return `<${tag}${attributes}>`;
      return `<${tag}${attributes}>${serialize(item.children)}</${tag}>`;
    })
    .join('');
}

function filterStyle(value, properties) {
  const kept = [];
  for (const declaration of String(value ?? '').split(';')) {
    const index = declaration.indexOf(':');
    if (index === -1) continue;
    const property = declaration.slice(0, index).trim().toLowerCase();
    const raw = declaration.slice(index + 1).trim();
    if (!properties.has(property)) continue;
    if (!SAFE_CSS_VALUE.test(raw)) continue;
    kept.push(`${property}: ${raw}`);
  }
  return kept.join('; ');
}

function sanitizeItems(items, options, state) {
  const output = [];
  for (const item of items) {
    if (item.type === 'text') {
      output.push(escapeText(item.content));
      continue;
    }
    if (item.type === 'comment') continue;
    const tag = item.tagName;

    if (NON_TEXT_TAGS.has(tag)) continue;

    const allowed = options.tags.has(tag);
    if (!allowed) {
      // 允许清单外的标签：丢标签、留内容（与 sanitize-html 的 discard 一致）。
      const inner = sanitizeItems(item.children, options, state);
      output.push(inner);
      continue;
    }

    const allowedAttributes = new Set([
      ...(PROSE_ATTRIBUTES['*'] ?? []),
      ...(options.attributes[tag] ?? []),
    ]);
    const attributes = [];
    for (const attr of item.attributes) {
      const key = attr.key;
      if (!allowedAttributes.has(key)) continue;
      if (attr.value === null) {
        attributes.push(` ${key}`);
        continue;
      }
      if (key === 'style') {
        const filtered = filterStyle(attr.value, options.styleProperties);
        if (filtered) attributes.push(` style="${escapeAttribute(filtered)}"`);
        continue;
      }
      if (key === 'href' && /^\s*(?:javascript|vbscript|data:text\/html)/i.test(attr.value)) continue;
      // 资源类属性（src / srcset / poster）在散文里没有白名单位置，这里只记账。
      if (key === 'src' || key === 'srcset' || key === 'poster') state.discarded.add(attr.value);
      attributes.push(` ${key}="${escapeAttribute(attr.value)}"`);
    }

    // 资源引用（style 里的 url()）也记进报告：离线导出展示不出来。
    const styleAttr = item.attributes.find((attr) => attr.key === 'style')?.value ?? '';
    for (const match of styleAttr.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi)) {
      state.discarded.add(match[1]);
    }

    const inner = sanitizeItems(item.children, options, state);
    if (tag === 'br' || tag === 'col') output.push(`<${tag}${attributes.join('')}>`);
    else output.push(`<${tag}${attributes.join('')}>${inner}</${tag}>`);
  }
  return output.join('');
}

/**
 * 源：scene-content.ts:224-231 —— 一条散文（文本内容 / 形状文字 / 单元格文字）。
 * @returns {{html: string, discarded: string[]}}
 */
export function sanitizeProseHtml(html) {
  const source = liftInlineMath(String(html ?? ''));
  const state = { discarded: new Set() };
  const result = sanitizeItems(toAST(source), {
    tags: PROSE_ALLOWED_TAGS,
    attributes: PROSE_ATTRIBUTES,
    styleProperties: STYLE_PROPERTIES,
  }, state);
  return { html: result, discarded: [...state.discarded] };
}

/**
 * 源：scene-content.ts:244-260 —— LaTeX 元素的 KaTeX `html` 快照。
 * 只保留 span / svg / path / line，并允许定位属性（KaTeX 用它们排版）。
 */
export function sanitizeLatexHtml(html) {
  const state = { discarded: new Set() };
  const result = sanitizeItems(toAST(String(html ?? '')), {
    tags: LATEX_ALLOWED_TAGS,
    attributes: {
      span: ['class', 'style', 'aria-hidden'],
      svg: ['class', 'style', 'viewBox', 'viewbox', 'preserveAspectRatio', 'preserveaspectratio', 'width', 'height'],
      path: ['d', 'style'],
      line: ['x1', 'y1', 'x2', 'y2', 'style'],
    },
    styleProperties: new Set([...STYLE_PROPERTIES, ...LAYOUT_STYLE_PROPERTIES]),
  }, state);
  return { html: result, discarded: [...state.discarded] };
}

/** 源：rich-text.ts:184-199 —— 会被当作 HTML 注入的散文字段。 */
function proseFields(content) {
  return (content?.canvas?.elements ?? []).flatMap((element) => {
    if (element.type === 'text' && typeof element.content === 'string') return [element.content];
    if (element.type === 'shape' && typeof element.text?.content === 'string') {
      return [element.text.content];
    }
    if (element.type === 'table' && Array.isArray(element.data)) {
      return element.data.flatMap((row) =>
        Array.isArray(row)
          ? row.flatMap((cell) => (typeof cell?.text === 'string' ? [cell.text] : []))
          : [],
      );
    }
    if (element.type === 'latex' && typeof element.html === 'string') return [element.html];
    return [];
  });
}

/**
 * 源：rich-text.ts:206-212 —— 清洗整张幻灯片的富文本，并报告离线展示不了的资源。
 * @returns {{content: object, discarded: string[]}}
 */
export function sanitizeSlideRichText(content) {
  const discarded = new Set();
  for (const field of proseFields(content)) {
    for (const resource of sanitizeProseHtml(field).discarded) discarded.add(resource);
  }

  const canvas = content.canvas ?? {};
  const elements = (canvas.elements ?? []).map((element) => {
    if (element.type === 'text' && typeof element.content === 'string') {
      return { ...element, content: sanitizeProseHtml(element.content).html };
    }
    if (element.type === 'shape' && typeof element.text?.content === 'string') {
      return { ...element, text: { ...element.text, content: sanitizeProseHtml(element.text.content).html } };
    }
    if (element.type === 'table' && Array.isArray(element.data)) {
      return {
        ...element,
        data: element.data.map((row) =>
          Array.isArray(row)
            ? row.map((cell) =>
                cell && typeof cell.text === 'string'
                  ? { ...cell, text: sanitizeProseHtml(cell.text).html }
                  : cell,
              )
            : row,
        ),
      };
    }
    if (element.type === 'latex' && typeof element.html === 'string') {
      return { ...element, html: sanitizeLatexHtml(element.html).html };
    }
    return element;
  });

  return { content: { ...content, canvas: { ...canvas, elements } }, discarded: [...discarded] };
}
