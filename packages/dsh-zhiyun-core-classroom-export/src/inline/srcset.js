/**
 * `srcset` 解析 / 序列化。
 *
 * 源：ref/OpenMAIC/lib/export/parse-srcset.d.ts:1-10（声明）
 *     ref/OpenMAIC/lib/export/inline-assets.ts 里对 `parse-srcset` 的用法
 *     （`parseSrcset(srcset).map((candidate) => candidate.url)`）
 *
 * 上游用 npm 包 `parse-srcset`（仓库没有，也不新增依赖）。这里按 HTML 规范
 * §"Parsing a srcset attribute" 实现最小可用版本：按逗号切候选、URL 与描述符
 * 分离、URL 里允许成对的括号（`data:` 常见），描述符原样保留 —— 内联需要
 * 的只是"每个候选的 url"，回写时需要"url + 原描述符"。
 */

/**
 * @param {string} input
 * @returns {{url: string, descriptor: string}[]}
 */
export function parseSrcset(input) {
  const candidates = [];
  const text = String(input ?? '');
  let index = 0;

  const isSpace = (char) => char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';

  while (index < text.length) {
    // 跳过前导空白与逗号
    while (index < text.length && (isSpace(text[index]) || text[index] === ',')) index++;
    if (index >= text.length) break;

    let url = '';
    let depth = 0;
    // URL 一直读到空白（括号内的空白不算），逗号在括号外终止候选
    while (index < text.length) {
      const char = text[index];
      if (isSpace(char) && depth === 0) break;
      if (char === '(') depth++;
      if (char === ')') depth = Math.max(0, depth - 1);
      if (char === ',' && depth === 0) break;
      url += char;
      index++;
    }

    let descriptor = '';
    let inParens = false;
    while (index < text.length) {
      const char = text[index];
      if (char === '(') inParens = true;
      if (char === ')') inParens = false;
      if (char === ',' && !inParens) break;
      descriptor += char;
      index++;
    }
    index++; // 吃掉分隔用的逗号

    if (!url) continue;
    candidates.push({ url, descriptor: descriptor.trim() });
  }

  return candidates;
}

/** 源：inline-assets.ts 回写 srcset 时保持"url 描述符"的顺序与形态。 */
export function stringifySrcset(candidates) {
  return candidates
    .map(({ url, descriptor }) => (descriptor ? `${url} ${descriptor}` : url))
    .join(', ');
}

/** 每个候选的 URL（上游 `parseSrcset(...).map((c) => c.url)` 的等价物）。 */
export function srcsetUrls(input) {
  return parseSrcset(input).map((candidate) => candidate.url);
}
