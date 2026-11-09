/**
 * 助手回答里的页码引用。
 *
 * 上游 Agent 的提示词要求「回答注明页码」，实测模型写出来的是**散文里的引用**：
 * `（第 1 页）`、`（第 1、9、12 页）`、`（第 12 页）`。这些引用不该只是一段文字 ——
 * 点一下应该跳到那一页。
 *
 * # 为什么是「转成链接」而不是「自己切 DOM」
 *
 * 回答现在由宿主的 `MarkdownText` 渲染（见 `AssistantDrawer.jsx`），我们拿不到它的
 * 内部节点，硬切字符串会把 Markdown 结构切坏（一个段落被拦腰截断就变成两个段落，
 * 列表项错位）。所以这里走宿主**公开的**那条路：把引用改写成 Markdown 链接，
 * 交给渲染器产出 `<a>`，再由 `MarkdownDelegateProvider.openExternalLink` 拦下来跳页。
 *
 * 链接目标用 RFC 2606 保留域 `.invalid`：即使哪天拦截失效、浏览器真的去打开，
 * 也只会得到一个必然解析失败的地址，不会误连到任何真实站点。
 *
 * 渲染器只放行 http/https/mailto（`render.tsx` 的 `sanitizeUrl`），自定义协议会被
 * 当成不安全目标剥成纯文本，所以这里必须借 http(s) 的壳。
 */

/** 保留域，永不解析；只作为「这一页」的载体。 */
const PAGE_LINK_ORIGIN = 'https://zhiyun.invalid';
const PAGE_LINK_PREFIX = `${PAGE_LINK_ORIGIN}/paper/page/`;

/** 页码引用 → 跳转地址。 */
export function pageLink(page) {
  return `${PAGE_LINK_PREFIX}${page}`;
}

/** 跳转地址 → 页码；不是本模块产的地址就返回 null（交给默认的外部链接行为）。 */
export function pageFromLink(href) {
  if (typeof href !== 'string' || !href.startsWith(PAGE_LINK_PREFIX)) return null;
  const page = Number(href.slice(PAGE_LINK_PREFIX.length));
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

/**
 * 引用正文：`N` 或 `A-B` 的原子，用顿号/逗号/斜杠/「和」「及」相连。
 * `第 1、9、12 页`、`第 1-3 页`、`第 12 页` 都吃。
 */
const CITATION = /第\s*(\d{1,4}(?:\s*[-–—~]\s*\d{1,4})?(?:\s*[、,，/和及]\s*\d{1,4}(?:\s*[-–—~]\s*\d{1,4})?)*)\s*页|\[(\d{1,4})\](?![(:[])/g;

/** 引用之间的分隔符（保留原样，避免把 `1、9` 写成 `1，9`）。 */
const SEPARATOR = /(\s*[、,，/和及]\s*)/;
/** 连字符区间。 */
const RANGE = /^(\d{1,4})\s*[-–—~]\s*(\d{1,4})$/;
/** 区间最多展开成这么多页，再多就原样留着（可能是误匹配，也可能真是一大段）。 */
const MAX_RANGE = 20;

/**
 * 把 `第 1、9、12 页` 里的页码拆出来，连区间一起展开。
 * @returns 页码数组；无法安全解析时返回 null（调用方原样保留这段文字）。
 */
function pagesOf(body) {
  const atoms = body.split(SEPARATOR);
  const pages = [];
  for (const atom of atoms) {
    if (atom === '' || SEPARATOR.test(atom)) continue;
    const range = RANGE.exec(atom);
    if (range === null) {
      const page = Number(atom);
      if (!Number.isSafeInteger(page) || page < 1) return null;
      pages.push(page);
      continue;
    }
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from) return null;
    if (to - from + 1 > MAX_RANGE) return null;
    for (let page = from; page <= to; page += 1) pages.push(page);
  }
  return pages.length === 0 ? null : pages;
}

/** 把一段引用文字换成 Markdown 链接；返回 null 表示「这段不动」。 */
function linkCitation(raw, bracket) {
  if (bracket !== undefined) return `[第 ${bracket} 页](${pageLink(Number(bracket))})`;
  const pages = pagesOf(raw);
  if (pages === null) return null;
  if (pages.length === 1) return `[第 ${pages[0]} 页](${pageLink(pages[0])})`;
  // 多页时把页码本身做成链接，`第` / `页` 留在外面 —— 读起来和原文一样，点哪个跳哪个。
  return `第 ${pages.map((page) => `[${page}](${pageLink(page)})`).join('、')} 页`;
}

/** 行内需要原样保留的区间：反引号代码段、已有的 Markdown 链接/图片。 */
function protectedRanges(line) {
  const ranges = [];
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== '`') continue;
    const run = /^`+/.exec(line.slice(i))[0];
    const end = line.indexOf(run, i + run.length);
    if (end === -1) break;
    ranges.push([i, end + run.length]);
    i = end + run.length - 1;
  }
  const link = /!?\[[^\]]*\]\([^)]*\)/g;
  for (let match = link.exec(line); match !== null; match = link.exec(line)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

const isProtected = (ranges, index) => ranges.some(([start, end]) => index >= start && index < end);

/** 处理一行（不含围栏行）。 */
function linkLine(line) {
  const ranges = protectedRanges(line);
  CITATION.lastIndex = 0;
  let out = '';
  let cursor = 0;
  for (let match = CITATION.exec(line); match !== null; match = CITATION.exec(line)) {
    if (isProtected(ranges, match.index)) continue;
    const replacement = linkCitation(match[1], match[2]);
    if (replacement === null) continue;
    out += line.slice(cursor, match.index) + replacement;
    cursor = match.index + match[0].length;
  }
  return out + line.slice(cursor);
}

/**
 * 把助手回答里的页码引用改写成可点的 Markdown 链接。
 *
 * 代码块（``` / ~~~ 围栏）整段跳过；行内的反引号代码段与已有链接内部也不动 ——
 * 我们把这段源码交给宿主的 Markdown 渲染器，动错一处就会渲染出走样的结构。
 */
export function linkCitations(text) {
  if (typeof text !== 'string' || text === '') return '';
  const out = [];
  let fence = null;
  for (const line of text.split('\n')) {
    const marker = /^\s*(```+|~~~+)/.exec(line);
    if (fence === null) {
      if (marker !== null) fence = marker[1][0];
      out.push(fence === null ? linkLine(line) : line);
      continue;
    }
    out.push(line);
    if (marker !== null && marker[1][0] === fence) fence = null;
  }
  return out.join('\n');
}
