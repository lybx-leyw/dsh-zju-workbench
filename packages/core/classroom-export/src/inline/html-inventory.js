/**
 * 极简 HTML 词法层：把文档切成"标签 / 文本 / 注释 / raw-text 内容"，
 * 并给出每个标签内属性的偏移，供内联时原地改写。
 *
 * 源：ref/OpenMAIC/lib/export/html-asset-inventory.ts:1-335（资源盘点与补丁）
 *     ref/OpenMAIC/lib/export/inline-assets.ts:1-858（写回路径）
 *
 * 上游用 `html-parser`（himalaya 风格）建树，再按 `attributeRange` 打补丁。
 * 它的树不带偏移，所以补丁表另建了一套 range。这里不建树：内联只需要"每个
 * 资源属性的值区间"，一个带偏移的标签级扫描就够，也避免为了改一个 `src` 而
 * 把整份文档重新序列化（那样会改掉作者写法的引号、实体与空白）。
 */

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/**
 * 把 HTML 切成段。
 * @param {string} html
 * @returns {{kind:'text'|'comment'|'tag'|'raw', start:number, end:number, name?:string, text?:string, closing?:boolean, attributes?:{name:string,value:string,start:number,end:number,quote:string}[]}[]}
 */
export function scanHtml(html) {
  const segments = [];
  let index = 0;
  const length = html.length;
  let textStart = 0;

  const flushText = (end) => {
    if (end > textStart) segments.push({ kind: 'text', start: textStart, end, text: html.slice(textStart, end) });
  };

  while (index < length) {
    const open = html.indexOf('<', index);
    if (open === -1) break;
    // 注释
    if (html.startsWith('<!--', open)) {
      flushText(open);
      const close = html.indexOf('-->', open + 4);
      const end = close === -1 ? length : close + 3;
      segments.push({ kind: 'comment', start: open, end, text: html.slice(open, end) });
      index = textStart = end;
      continue;
    }
    // 不是标签：`<` 当文本
    if (!/[a-zA-Z/!]/.test(html[open + 1] ?? '')) {
      index = open + 1;
      continue;
    }
    const close = findTagEnd(html, open);
    if (close === -1) break;
    flushText(open);
    const raw = html.slice(open, close + 1);
    const closing = /^<\s*\//.test(raw);
    const name = (raw.match(/^<\s*\/?\s*([a-zA-Z][\w:-]*)/)?.[1] ?? '').toLowerCase();
    const selfClosing = /\/\s*>$/.test(raw);
    const tag = {
      kind: 'tag',
      start: open,
      end: close + 1,
      name,
      closing,
      selfClosing,
      text: raw,
      attributes: closing ? [] : parseAttributes(raw, open),
    };
    segments.push(tag);
    index = textStart = close + 1;

    if (!closing && !selfClosing && RAW_TEXT_TAGS.has(name)) {
      const lower = html.toLowerCase();
      const closeIndex = lower.indexOf(`</${name}`, index);
      const rawEnd = closeIndex === -1 ? length : closeIndex;
      if (rawEnd > index) {
        segments.push({ kind: 'raw', start: index, end: rawEnd, name, text: html.slice(index, rawEnd) });
      }
      index = textStart = rawEnd;
    }
  }
  flushText(length);
  return segments;
}

/** 找到标签结束的 `>`，尊重引号内的 `>`。 */
function findTagEnd(html, start) {
  let quote = null;
  for (let index = start + 1; index < html.length; index++) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return index;
  }
  return -1;
}

/** 解析一个开始标签的属性，`start/end` 是属性值（不含引号）在整份文档里的区间。 */
export function parseAttributes(tagText, tagStart) {
  const attributes = [];
  const length = tagText.length;
  let index = 1;
  // 跳过标签名
  while (index < length && !/[\s/>]/.test(tagText[index])) index++;

  while (index < length) {
    while (index < length && /[\s/]/.test(tagText[index])) index++;
    if (index >= length || tagText[index] === '>') break;

    const nameStart = index;
    while (index < length && !/[\s=/>]/.test(tagText[index])) index++;
    const name = tagText.slice(nameStart, index);
    if (!name) {
      index++;
      continue;
    }

    while (index < length && /\s/.test(tagText[index])) index++;
    if (tagText[index] !== '=') {
      attributes.push({ name: name.toLowerCase(), value: '', start: tagStart + index, end: tagStart + index, quote: '' });
      continue;
    }
    index++;
    while (index < length && /\s/.test(tagText[index])) index++;

    const quote = tagText[index] === '"' || tagText[index] === "'" ? tagText[index] : '';
    if (quote) index++;
    const valueStart = index;
    if (quote) {
      while (index < length && tagText[index] !== quote) index++;
      attributes.push({
        name: name.toLowerCase(),
        value: tagText.slice(valueStart, index),
        start: tagStart + valueStart,
        end: tagStart + index,
        quote,
      });
      index++;
    } else {
      while (index < length && !/[\s>]/.test(tagText[index])) index++;
      attributes.push({
        name: name.toLowerCase(),
        value: tagText.slice(valueStart, index),
        start: tagStart + valueStart,
        end: tagStart + index,
        quote: '',
      });
    }
  }
  return attributes;
}

/**
 * 按区间替换（同一批补丁按起点降序应用，避免偏移互相干扰）。
 * @param {string} html
 * @param {{start:number,end:number,replacement:string}[]} patches
 */
export function applyPatches(html, patches) {
  const ordered = [...patches].sort((a, b) => b.start - a.start);
  let result = html;
  for (const patch of ordered) {
    result = result.slice(0, patch.start) + patch.replacement + result.slice(patch.end);
  }
  return result;
}

/** 带引号的值（内联 data URI 里可能有引号，按出现情况选分隔符）。 */
export function quoteAttributeValue(value) {
  const quote = value.includes('"') && !value.includes("'") ? "'" : '"';
  const escaped = quote === '"' ? value.replace(/"/g, '&quot;') : value.replace(/'/g, '&#39;');
  return `${quote}${escaped}${quote}`;
}
