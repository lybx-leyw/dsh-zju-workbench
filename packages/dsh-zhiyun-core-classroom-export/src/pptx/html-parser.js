/**
 * 极简 HTML → AST 解析器（富文本 → pptxgenjs 切片的唯一入口）。
 *
 * 源：ref/OpenMAIC/lib/export/html-parser/types.ts:1-75
 *     ref/OpenMAIC/lib/export/html-parser/tags.ts:1-50
 *     ref/OpenMAIC/lib/export/html-parser/lexer.ts:1-274
 *     ref/OpenMAIC/lib/export/html-parser/parser.ts:1-136
 *     ref/OpenMAIC/lib/export/html-parser/format.ts:1-47
 *     ref/OpenMAIC/lib/export/html-parser/stringify.ts:1-30
 *     ref/OpenMAIC/lib/export/html-parser/index.ts:1-15
 *
 * 上游来自 himalaya 的 TypeScript 重写。这里只做"手改 TS→JS 的语法层"：
 * 类型标注去掉，逻辑逐行保留（包括 `closingTagAncestorBreakers` 这类
 * 自动闭合规则），因为 PPTX 的富文本切片完全依赖它的树形与属性解析。
 */

/** 源：tags.ts:1 — 内容按纯文本读到闭合标签，内部不再递归解析。 */
export const childlessTags = ['style', 'script', 'template'];

/** 源：tags.ts:3-19 */
export const closingTags = [
  'html',
  'head',
  'body',
  'p',
  'dt',
  'dd',
  'li',
  'option',
  'thead',
  'th',
  'tbody',
  'tr',
  'td',
  'tfoot',
  'colgroup',
];

/** 源：tags.ts:21-30 */
export const closingTagAncestorBreakers = {
  li: ['ul', 'ol', 'menu'],
  dt: ['dl'],
  dd: ['dl'],
  tbody: ['table'],
  thead: ['table'],
  tfoot: ['table'],
  tr: ['table'],
  td: ['table'],
};

/** 源：tags.ts:32-50 */
export const voidTags = [
  '!doctype',
  'area',
  'base',
  'br',
  'col',
  'command',
  'embed',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
];

// ── lexer ────────────────────────────────────────────────────────────────────

/** 源：lexer.ts:10-17 */
function jumpPosition(state, end) {
  state.position += end - state.position;
}

function movePosition(state, length) {
  state.position += length;
}

/** 源：lexer.ts:19-33 */
function findTextEnd(str, index) {
  for (;;) {
    const textEnd = str.indexOf('<', index);
    if (textEnd === -1) return textEnd;
    const char = str.charAt(textEnd + 1);
    if (char === '/' || char === '!' || /[A-Za-z0-9]/.test(char)) return textEnd;
    index = textEnd + 1;
  }
}

/** 源：lexer.ts:35-50 */
function lexText(state) {
  const { str } = state;
  let textEnd = findTextEnd(str, state.position);
  if (textEnd === state.position) return;
  if (textEnd === -1) textEnd = str.length;
  const content = str.slice(state.position, textEnd);
  jumpPosition(state, textEnd);
  state.tokens.push({ type: 'text', content });
}

/** 源：lexer.ts:52-69 */
function lexComment(state) {
  const { str } = state;
  movePosition(state, 4);
  let contentEnd = str.indexOf('-->', state.position);
  let commentEnd = contentEnd + 3;
  if (contentEnd === -1) contentEnd = commentEnd = str.length;
  const content = str.slice(state.position, contentEnd);
  jumpPosition(state, commentEnd);
  state.tokens.push({ type: 'comment', content });
}

/** 源：lexer.ts:71-98 */
function lexTagName(state) {
  const { str } = state;
  const len = str.length;
  let start = state.position;
  while (start < len) {
    const char = str.charAt(start);
    if (!(/\s/.test(char) || char === '/' || char === '>')) break;
    start++;
  }
  let end = start + 1;
  while (end < len) {
    const char = str.charAt(end);
    if (/\s/.test(char) || char === '/' || char === '>') break;
    end++;
  }
  jumpPosition(state, end);
  const tagName = str.slice(start, end);
  state.tokens.push({ type: 'tag', content: tagName });
  return tagName;
}

/** 源：lexer.ts:100-181 */
function lexTagAttributes(state) {
  const { str, tokens } = state;
  let cursor = state.position;
  let quote = null;
  let wordBegin = cursor;
  const words = [];
  const len = str.length;
  while (cursor < len) {
    const char = str.charAt(cursor);
    if (quote) {
      if (char === quote) quote = null;
      cursor++;
      continue;
    }
    if (char === '/' || char === '>') {
      if (cursor !== wordBegin) words.push(str.slice(wordBegin, cursor));
      break;
    }
    if (/\s/.test(char)) {
      if (cursor !== wordBegin) words.push(str.slice(wordBegin, cursor));
      wordBegin = cursor + 1;
      cursor++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      cursor++;
      continue;
    }
    cursor++;
  }
  jumpPosition(state, cursor);

  const type = 'attribute';
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const isNotPair = word.indexOf('=') === -1;
    if (isNotPair) {
      const secondWord = words[i + 1];
      if (secondWord && secondWord.startsWith('=')) {
        if (secondWord.length > 1) {
          tokens.push({ type, content: word + secondWord });
          i += 1;
          continue;
        }
        const thirdWord = words[i + 2];
        i += 1;
        if (thirdWord) {
          tokens.push({ type, content: `${word}=${thirdWord}` });
          i += 1;
          continue;
        }
      }
    }
    if (word.endsWith('=')) {
      const secondWord = words[i + 1];
      if (secondWord && secondWord.indexOf('=') === -1) {
        tokens.push({ type, content: word + secondWord });
        i += 1;
        continue;
      }
      tokens.push({ type, content: word.slice(0, -1) });
      continue;
    }
    tokens.push({ type, content: word });
  }
}

/** 源：lexer.ts:183-221 */
function lexSkipTag(tagName, state) {
  const { str, tokens } = state;
  const safeTagName = tagName.toLowerCase();
  const len = str.length;
  let index = state.position;

  while (index < len) {
    const nextTag = str.indexOf('</', index);
    if (nextTag === -1) {
      lexText(state);
      break;
    }
    const tagState = { str, position: state.position, tokens: [] };
    jumpPosition(tagState, nextTag);
    const name = lexTag(tagState);
    if (safeTagName !== name.toLowerCase()) {
      index = tagState.position;
      continue;
    }
    if (nextTag !== state.position) {
      const textStart = state.position;
      jumpPosition(state, nextTag);
      tokens.push({ type: 'text', content: str.slice(textStart, nextTag) });
    }
    tokens.push(...tagState.tokens);
    jumpPosition(state, tagState.position);
    break;
  }
}

/** 源：lexer.ts:223-244 */
function lexTag(state) {
  const { str } = state;
  const secondChar = str.charAt(state.position + 1);
  const tagStartClose = secondChar === '/';
  movePosition(state, tagStartClose ? 2 : 1);
  state.tokens.push({ type: 'tag-start', close: tagStartClose });

  const tagName = lexTagName(state);
  lexTagAttributes(state);

  const firstChar = str.charAt(state.position);
  const tagEndClose = firstChar === '/';
  movePosition(state, tagEndClose ? 2 : 1);
  state.tokens.push({ type: 'tag-end', close: tagEndClose });
  return tagName;
}

/** 源：lexer.ts:246-264 */
function lex(state) {
  const { str } = state;
  const len = str.length;
  while (state.position < len) {
    const start = state.position;
    lexText(state);
    if (state.position === start) {
      if (str.startsWith('!--', start + 1)) {
        lexComment(state);
      } else {
        const tagName = lexTag(state);
        if (childlessTags.includes(tagName.toLowerCase())) lexSkipTag(tagName, state);
      }
    }
  }
}

/** 源：lexer.ts:266-274 */
export function lexer(str) {
  const state = { str, position: 0, tokens: [] };
  lex(state);
  return state.tokens;
}

// ── parser ───────────────────────────────────────────────────────────────────

/** 源：parser.ts:30-42 */
export function hasTerminalParent(tagName, stack) {
  const tagParents = closingTagAncestorBreakers[tagName];
  if (tagParents) {
    let currentIndex = stack.length - 1;
    while (currentIndex >= 0) {
      const parentTagName = stack[currentIndex].tagName;
      if (parentTagName === tagName) break;
      if (parentTagName && tagParents.includes(parentTagName)) return true;
      currentIndex--;
    }
  }
  return false;
}

/** 源：parser.ts:44-46 */
export function rewindStack(stack, newLength) {
  stack.splice(newLength);
}

/** 源：parser.ts:48-136 */
export function parse(state) {
  const { stack, tokens } = state;
  let { cursor } = state;
  let nodes = stack[stack.length - 1].children;
  const len = tokens.length;

  while (cursor < len) {
    const token = tokens[cursor];
    if (token.type !== 'tag-start') {
      nodes.push(token);
      cursor++;
      continue;
    }

    const tagToken = tokens[++cursor];
    cursor++;
    const tagName = tagToken.content.toLowerCase();
    if (token.close) {
      let index = stack.length;
      let shouldRewind = false;
      while (--index > -1) {
        if (stack[index].tagName === tagName) {
          shouldRewind = true;
          break;
        }
      }
      while (cursor < len) {
        if (tokens[cursor].type !== 'tag-end') break;
        cursor++;
      }
      if (shouldRewind) {
        rewindStack(stack, index);
        break;
      }
      continue;
    }

    const isClosingTag = closingTags.includes(tagName);
    let shouldRewindToAutoClose = isClosingTag;
    if (shouldRewindToAutoClose) shouldRewindToAutoClose = !hasTerminalParent(tagName, stack);

    if (shouldRewindToAutoClose) {
      let currentIndex = stack.length - 1;
      while (currentIndex > 0) {
        if (tagName === stack[currentIndex].tagName) {
          rewindStack(stack, currentIndex);
          const previousIndex = currentIndex - 1;
          nodes = stack[previousIndex].children;
          break;
        }
        currentIndex -= 1;
      }
    }

    const attributes = [];
    let tagEndToken;
    while (cursor < len) {
      const next = tokens[cursor];
      if (next.type === 'tag-end') {
        tagEndToken = next;
        break;
      }
      attributes.push(next.content);
      cursor++;
    }
    if (!tagEndToken) break;
    cursor++;

    const children = [];
    nodes.push({ type: 'element', tagName: tagToken.content, attributes, children });

    const hasChildren = !(tagEndToken.close || voidTags.includes(tagName));
    if (hasChildren) {
      stack.push({ tagName, children });
      const innerState = { tokens, cursor, stack };
      parse(innerState);
      cursor = innerState.cursor;
    }
  }
  state.cursor = cursor;
}

/** 源：parser.ts:23-28 */
export function parser(tokens) {
  const root = { tagName: null, children: [] };
  const state = { tokens, cursor: 0, stack: [root] };
  parse(state);
  return root.children;
}

// ── format ───────────────────────────────────────────────────────────────────

/** 源：format.ts:3-7 */
function splitHead(str, sep) {
  const idx = str.indexOf(sep);
  if (idx === -1) return [str];
  return [str.slice(0, idx), str.slice(idx + sep.length)];
}

/** 源：format.ts:9-17 */
function unquote(str) {
  const car = str.charAt(0);
  const end = str.length - 1;
  const isQuoteStart = car === '"' || car === "'";
  if (isQuoteStart && car === str.charAt(end)) return str.slice(1, end);
  return str;
}

/** 源：format.ts:19-26 */
function formatAttributes(attributes) {
  return attributes.map((attribute) => {
    const parts = splitHead(attribute.trim(), '=');
    const key = parts[0];
    const value = typeof parts[1] === 'string' ? unquote(parts[1]) : null;
    return { key, value };
  });
}

/** 源：format.ts:28-47 */
export function format(nodes) {
  return nodes.map((node) => {
    if (node.type === 'element') {
      return {
        type: 'element',
        tagName: node.tagName.toLowerCase(),
        attributes: formatAttributes(node.attributes),
        children: format(node.children),
      };
    }
    return { type: node.type, content: node.content };
  });
}

/** 源：format.ts:28 — `toAST` = lexer → parser → format（index.ts:9-13）。 */
export function toAST(str) {
  return format(parser(lexer(str)));
}

// ── stringify ────────────────────────────────────────────────────────────────

/** 源：stringify.ts:4-16 */
export function formatAttributesToString(attributes) {
  return attributes.reduce((attrs, attribute) => {
    const { key, value } = attribute;
    if (value === null) return `${attrs} ${key}`;
    // 空的 style 属性直接省掉，但已累积的属性必须保留（这是 reduce）。
    if (key === 'style' && !value) return attrs;
    const quote = value.indexOf("'") !== -1 ? '"' : "'";
    return `${attrs} ${key}=${quote}${value}${quote}`;
  }, '');
}

/** 源：stringify.ts:18-30 */
export function toHTML(tree) {
  return tree
    .map((node) => {
      if (node.type === 'text') return node.content;
      if (node.type === 'comment') return `<!--${node.content}-->`;
      const { tagName, attributes, children } = node;
      const selfClosing = voidTags.includes(tagName.toLowerCase());
      if (selfClosing) return `<${tagName}${formatAttributesToString(attributes)}>`;
      return `<${tagName}${formatAttributesToString(attributes)}>${toHTML(children)}</${tagName}>`;
    })
    .join('');
}
