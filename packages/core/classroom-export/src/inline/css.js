/**
 * CSS 里的资源引用：扫描 `url(...)` / `@import`，并原地替换。
 *
 * 源：ref/OpenMAIC/lib/export/css-asset-parser.ts:1-379
 *
 * 上游用 `postcss` + `postcss-value-parser`。两个包仓库里都有，但对"把 CSS 里
 * 的地址换成 data: URI"这件事来说，值级扫描（尊重引号、注释与转义）就够了，
 * 而且坏 CSS（LLM 生成的互动页常见 `-- name: value` 这种写法）不会被 strict
 * parser 整份拒掉 —— 这一点与上游的兜底分支 `collectCssAssetReferencesByRegex`
 * （css-asset-parser.ts:235-352）同一取舍：宁可少扫，不可中断导出。
 */

/** 源：css-asset-parser.ts:96-108 */
export function cssUrlReferences(value) {
  const refs = [];
  const text = String(value ?? '');
  const length = text.length;
  let index = 0;

  while (index < length) {
    // 注释整段跳过（注释里的 url 不是依赖）
    if (text[index] === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? length : end + 2;
      continue;
    }
    if (text[index] === '"' || text[index] === "'") {
      index = skipString(text, index + 1, text[index]);
      continue;
    }
    if (!/[uU]/.test(text[index]) || !/^url\s*\(/i.test(text.slice(index))) {
      index++;
      continue;
    }
    const open = text.indexOf('(', index);
    let cursor = open + 1;
    while (cursor < length && /\s/.test(text[cursor])) cursor++;
    const quote = text[cursor] === '"' || text[cursor] === "'" ? text[cursor] : null;
    if (quote) {
      const end = skipString(text, cursor + 1, quote);
      const raw = text.slice(cursor + 1, end > cursor + 1 ? end - 1 : end);
      const close = text.indexOf(')', end);
      if (close !== -1) refs.push({ raw, start: index, end: close + 1 });
      index = close === -1 ? length : close + 1;
      continue;
    }
    const close = text.indexOf(')', cursor);
    if (close === -1) break;
    const raw = text.slice(cursor, close).trim();
    if (raw) refs.push({ raw, start: index, end: close + 1 });
    index = close + 1;
  }
  return refs;
}

/** 返回字符串结束引号之后的位置（未闭合则返回文本长度）。 */
function skipString(text, start, quote) {
  for (let index = start; index < text.length; index++) {
    if (text[index] === '\\') {
      index++;
      continue;
    }
    if (text[index] === quote) return index + 1;
    if (text[index] === '\n' || text[index] === '\r' || text[index] === '\f') return index;
  }
  return text.length;
}

/** 源：css-asset-parser.ts:96-108 —— 只替换有映射的引用，其余原样保留。 */
export function rewriteCssValue(value, replacementFor) {
  return cssUrlReferences(value)
    .sort((left, right) => right.start - left.start)
    .reduce((rewritten, ref) => {
      const replacement = replacementFor(ref.raw);
      if (replacement === undefined) return rewritten;
      return `${rewritten.slice(0, ref.start)}url(${replacement})${rewritten.slice(ref.end)}`;
    }, value);
}

/** 源：css-asset-parser.ts:110-125 */
export function splitCssCommaList(value) {
  const entries = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '"' || char === "'") {
      index = skipString(value, index + 1, char) - 1;
      continue;
    }
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(value.slice(start).trim());
  return entries;
}

/**
 * `@import` 规则（源：css-asset-parser.ts:175-215 + inline-assets.ts:87-123）。
 * 返回规则区间、URL，以及 `layer()` / `supports()` / media 条件 —— 内联时要按
 * 原条件包一层，否则被导入的样式会跳出它原本的作用域。
 */
export function cssImports(css) {
  const text = String(css ?? '');
  const imports = [];
  const pattern = /@import\s+(?:url\(\s*)?("[^"]*"|'[^']*'|[^'")\s;]+)\s*\)?([^;]*);/gi;
  let match;
  while ((match = pattern.exec(text))) {
    const rawUrl = match[1].replace(/^["']|["']$/g, '');
    imports.push({
      url: rawUrl,
      conditions: match[2].trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return imports;
}

/** 把被导入的 CSS 按 `layer` / `supports` / media 条件包起来（源：110-123）。 */
export function wrapImportedCss(css, conditions) {
  let wrapped = css;
  let rest = conditions.trim();
  let layer;
  if (/^layer\b/i.test(rest)) {
    rest = rest.slice(5).trimStart();
    if (rest.startsWith('(')) {
      const close = rest.indexOf(')');
      layer = close === -1 ? null : rest.slice(1, close).trim();
      rest = close === -1 ? '' : rest.slice(close + 1).trim();
    } else {
      layer = null;
    }
  }
  if (/^supports\s*\(/i.test(rest)) {
    const open = rest.indexOf('(');
    const close = rest.lastIndexOf(')');
    if (close > open) {
      const supports = rest.slice(open + 1, close).trim();
      wrapped = `@supports (${supports}){${wrapped}}`;
      rest = rest.slice(close + 1).trim();
    }
  }
  if (rest) wrapped = `@media ${rest}{${wrapped}}`;
  if (layer !== undefined) wrapped = layer ? `@layer ${layer}{${wrapped}}` : `@layer{${wrapped}}`;
  return wrapped;
}
