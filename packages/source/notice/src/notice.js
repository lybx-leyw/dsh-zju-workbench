/**
 * 校内通知公告：各单位公开发布的通知，按来源表读取、合并、去重。
 *
 * # 这个文件是什么
 *
 * 纯逻辑。**不 import cordis**，只收注入的 `request`（`(url, init) => { status, headers, text }`），
 * 所以它的每一条分支都能用假 `request` 测。插件入口（provide 服务 + 同源路由）在 `index.js`。
 *
 * # 分层（D17）
 *
 * 纯只读：没有任何写操作，`writes: false`。上游的 `notice new` 会**写**已读记录，
 * 但那是写本地文件；本仓的持久化由调用方注入（`setSeenStore({ load, save })`），
 * 本文件只负责算出「新出现的是哪些」并返回更新后的记录。
 *
 * # 来源与适配器
 *
 * 三个适配器，分派依据各不相同，务必分清（这是本文件最容易读错的地方）：
 *
 * | 适配器 | 管什么 | 靠什么分派 |
 * | --- | --- | --- |
 * | `webplus` | 网站群站点的**列表页** | `sources.js` 来源表里的 `adapter: 'webplus'` 字段 |
 * | `zdbk` | 教务网的**列表页** | 同一个字段取 `'zdbk'` |
 * | `kyjs` | 竞赛管理系统的**正文** | **不是**来源，按 URL 特征：`kyjs.zju.edu.cn` + `newsId` 参数 |
 *
 * `kyjs` 之所以不在来源表里，是因为它没有自己的「通知列表」—— 本科生院实践交流栏的
 * 学科竞赛、大创条目**外链**到那里。它只在取正文（`detailOf`）时参与分派。
 *
 * # 「两套列表适配器」为什么必须是两套
 *
 * 不是因为列表页长得不一样（虽然确实不一样），而是**取数通道完全不同**：
 *
 * - `webplus`：`GET /<栏目号>/list.htm`，纯 HTML + `#wp_paging_w<n>` 分页条；
 * - `zdbk`：`POST /jwglxt/xtgl/xwgl_cxXwListAlltzgg.html?doType=query`，jqGrid 的 JSON
 *   （表单体传条件，`queryModel.*` 传分页），且**必须带 CAS 会话**。
 *
 * 一套是「解析 HTML」，一套是「带会话 POST 拿 JSON」。硬合成一套只会让两边都变形。
 *
 * # 来源
 *
 * 移植自 `packages/vendor/zju-assistant/core/zju/lib/notice/`（GPL-3.0-only，
 * 见本包 `ATTRIBUTION.md`）。上游用 `parse5` 建 DOM，本仓**没有** `parse5` 依赖，
 * 所以自带一个容错的 HTML 解析器（见 `parseHtml`）—— 这是与上游最大的一处实现差异，
 * 已在 README 的「已知限制」里写明。
 */

import { readFileSync } from 'node:fs';

/* ────────────────────────────── 站点常量 ── */

/** 教务网主机。 */
export const ZDBK_HOST = 'zdbk.zju.edu.cn';
/** 教务系统业务根（正方把模块路径都挂在 `/jwglxt` 之后）。 */
export const ZDBK_BASE = `https://${ZDBK_HOST}/jwglxt`;
/** 竞赛管理系统主机：本科生院实践交流栏的学科竞赛、大创条目外链到这里。 */
export const KYJS_HOST = 'kyjs.zju.edu.cn';
/** 统一身份认证主机：落到它的登录页说明该栏目要登录。 */
export const CAS_HOST = 'zjuam.zju.edu.cn';

/**
 * 前两次请求只等这么久。
 *
 * 上游 `read.ts` 的实测记录：从校外进校内的新连接有几个百分点会一直不回应
 * （学校的 WebVPN 网关和 VPN 节点都有），等满默认的 10 秒才重发，一次列表
 * 查询就要 12 秒；正常请求从发出到收完不到 1 秒。
 */
export const QUICK_MS = 3500;

/** 第三次（也是最后一次）用的超时，照顾对面真的慢的时候。上游注释写的「默认 10 秒」。 */
export const SLOW_MS = 10_000;

/** 跟跳转的上限。链路上正常只有 3~5 跳，留足余量但绝不无限跟。 */
const MAX_HOPS = 10;

/** 一次查多个站点时的并发上限。 */
const TASK_CONCURRENCY = 8;
/** 取正文的并发。上游 `withDetails` 用 4。 */
const DETAIL_CONCURRENCY = 4;
/** 补全教务网截断标题的并发。上游 `withFullTitles` 用 6。 */
const TITLE_CONCURRENCY = 6;

/** 一个栏目最多往回读的页数（给了起始日期时）。 */
const SINCE_PAGES = 40;
/** 只给关键词时少读一些。 */
const KEYWORD_PAGES = 12;
/** 「列表顺序不代表时间」的栏目读这么多页。 */
const UNORDERED_PAGES = 10;
/** 只给关键词时往回找多少天。 */
const KEYWORD_DAYS = 365;
/** 栏目内并行取页数。上游 `BATCH`。 */
const PAGE_BATCH = 4;

/** 教务网增量扫描：第一次给最近几天 / 每次回看的重叠天数 / 最多回看 / 已读保留天数 / 一次最多列这么多条。 */
const FIRST_DAYS = 7;
const OVERLAP_DAYS = 7;
const MAX_DAYS = 45;
const KEEP_DAYS = 60;
const PAGE = 100;
/** 教务网「用完整标题本地再比一遍」时取多少条最近记录。 */
const RECENT_ROWS = 100;

/* ────────────────────────────── 错误 ── */

/**
 * 本包的统一错误形状。
 *
 * `code` 是稳定的：调用方按码分支，不要按 message 分支（文案会改）。
 *
 * | code | 含义 | 用户能做什么 |
 * | --- | --- | --- |
 * | `CONFIG` | 参数不合法 | 改参数 |
 * | `SHAPE` | 响应不是预期结构 | 报 issue（站点可能改版） |
 * | `DRIFT` | **页面说有条目但一条也没解析出来** | 报 issue，不要当成「没有通知」 |
 * | `HTTP` | 非 200 | 稍后重试 |
 * | `TIMEOUT` | 超过预算没响应 | 稍后重试 / 换网络 |
 * | `NETWORK` | 传输层失败 | 检查网络或 WebVPN |
 * | `AUTH_REQUIRED` | 页面要统一身份认证 | 到设置里登录 |
 * | `NEEDS_USER` | 需要用户明确目标（多条候选 / 没有匹配） | 看候选，写清标题或链接 |
 * | `UNREADABLE` | 链接指向校内内网地址，读不到 | 无（如实说明） |
 * | `CANCELLED` | 已取消 | 无 |
 */
export class NoticeError extends Error {
  /**
   * @param code - 稳定错误码。
   * @param message - 给人看的一句话（可直接上屏）。
   * @param details - 附加信息（不含凭证）。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'NoticeError';
    this.code = code;
    this.details = details;
  }
}

/* ────────────────────────────── HTML 实体与文本 ── */

/** 常见命名实体。HTML4 全集里通知页面会用到的那些。 */
const NAMED = Object.freeze({
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ldquo: '\u201C', rdquo: '\u201D', lsquo: '\u2018', rsquo: '\u2019',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', middot: '\u00B7',
  ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', bull: '\u2022',
  copy: '\u00A9', reg: '\u00AE', trade: '\u2122', deg: '\u00B0',
  times: '\u00D7', divide: '\u00F7', plusmn: '\u00B1', frac12: '\u00BD',
  laquo: '\u00AB', raquo: '\u00BB', sbquo: '\u201A', bdquo: '\u201E',
});

/**
 * 解 HTML 实体：命名实体 + 十进制 + 十六进制数字引用。
 *
 * `&amp;` 必须**先**换成哨兵：否则 `&amp;lt;b&amp;gt;` 会被后面的 `&lt;` 规则
 * 解成 `<b>`（双重解码）。顺序是「占位 → 解其它 → 还原」。
 *
 * @param input - 含实体的字符串。
 * @returns 解码后的字符串。
 */
export function decodeEntities(input) {
  const GUARD = '\u0000AMP\u0000';
  return String(input ?? '')
    .replace(/&amp;/gi, GUARD)
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => codePoint(parseInt(hex, 16), match))
    .replace(/&#(\d+);/g, (match, dec) => codePoint(Number(dec), match))
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name) => NAMED[name.toLowerCase()] ?? match)
    .replaceAll(GUARD, '&');
}

/**
 * 码点转字符；越界或非法时原样返回（不吞掉它，让用户看见问题）。
 *
 * @param value - 码点。
 * @param fallback - 原样返回的字符串。
 * @returns 字符或 fallback。
 */
function codePoint(value, fallback) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

/** 空白（含零宽空格与不换行空格）压成一个空格。上游 webplus 的 `clean`。 */
const SPACE = new RegExp(`[\\s${String.fromCharCode(0x200b, 0xa0)}]+`, 'g');
const clean = (value) => String(value ?? '').replace(SPACE, ' ').trim();

/* ────────────────────────────── 容错的 HTML 解析器 ── */

/**
 * 自带的最小 HTML 解析器：建一棵够用的元素树。
 *
 * # 为什么不用现成的
 *
 * 上游用 `parse5`（完整的 HTML5 树构建算法）。本仓没有这个依赖，且**不允许**
 * 为一个数据源新拉一个大依赖去跑一棵树。而本包真正要的是三件事：
 *
 * 1. **祖先/兄弟关系** —— 「从最后一个链接往上找，第一层同名兄弟数不少于本页条数的就是条目」，
 *    这条判据是 `parseList` 的核心，扁平的正则做不到；
 * 2. **属性** —— `class` / `id` / `href` / `title` / `portletmode` / `pdfsrc`；
 * 3. **文档顺序** —— 「分页条之前的链接」「正文容器之前的标题」。
 *
 * 所以这里实现一个**容错**的解析器：不追求 HTML5 的完整树构建规则，只保证
 * 「标签、属性、文本、父子关系」这四件事对常见页面成立。未闭合标签、乱序属性、
 * 单引号属性值、注释、`<script>` 里的 `<` 都不会让它崩。
 *
 * ⚠️ 它与 `parse5` 的差别会体现在**畸形 HTML** 上（例如 `<p>` 里嵌 `<div>` 的隐式闭合规则）。
 * 正常网页群模板产出的是规整 HTML，这类差别不影响结果；但这一点必须写进 README 的
 * 已知限制 —— 不能假装它等价于 parse5。
 */

/** 自闭合标签：没有子节点。 */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** 内容不当 HTML 解析的标签：整段收成一个文本节点。 */
const RAW_TEXT = new Set(['script', 'style']);

/** 这些标签出现时隐含关闭同级的哪些标签（HTML 里最常见的几种）。 */
const AUTO_CLOSE = {
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  tr: ['tr'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  p: ['p'],
  option: ['option'],
  thead: ['thead', 'tbody', 'tfoot'],
  tbody: ['thead', 'tbody', 'tfoot'],
  tfoot: ['thead', 'tbody', 'tfoot'],
};

/** 正文转纯文本时算「块级」的标签（与上游 core/html.ts 的 BLOCK 一致）。 */
const BLOCK = new Set(['p', 'div', 'br', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol', 'section', 'article', 'blockquote', 'pre', 'hr']);

/** 造一个元素节点。 */
const elementNode = (tag, attrs) => ({ type: 'element', tag, attrs, children: [], parent: null });
/** 造一个文本节点。 */
const textNode = (value) => ({ type: 'text', value, children: [], parent: null });

/**
 * 解析 HTML 成元素树。
 *
 * @param html - 页面 HTML。
 * @returns 根节点 `{ type: 'root', children }`。
 */
export function parseHtml(html) {
  const root = { type: 'root', tag: '#root', attrs: {}, children: [], parent: null };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const pushText = (value) => {
    if (!value) return;
    const node = textNode(value);
    node.parent = top();
    top().children.push(node);
  };

  const src = String(html ?? '');
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      pushText(src.slice(i));
      break;
    }
    if (lt > i) pushText(src.slice(i, lt));

    // 注释与 doctype：整段跳过。
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }

    const closing = src[lt + 1] === '/';
    let j = lt + (closing ? 2 : 1);
    const nameMatch = /^[a-zA-Z][\w:.-]*/.exec(src.slice(j, j + 64));
    if (nameMatch === null) {
      // 不是标签（裸 `<`），当文本。
      pushText('<');
      i = lt + 1;
      continue;
    }
    const tag = nameMatch[0].toLowerCase();
    j += nameMatch[0].length;

    const attrs = {};
    let selfClosed = false;
    for (;;) {
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (j >= src.length) break;
      if (src[j] === '>') {
        j += 1;
        break;
      }
      if (src[j] === '/' && src[j + 1] === '>') {
        selfClosed = true;
        j += 2;
        break;
      }
      if (src[j] === '/') {
        j += 1;
        continue;
      }
      const nameAt = /^[^\s=/>]+/.exec(src.slice(j, j + 200));
      if (nameAt === null) {
        j += 1;
        continue;
      }
      const attrName = nameAt[0].toLowerCase();
      j += nameAt[0].length;
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (src[j] !== '=') {
        attrs[attrName] = '';
        continue;
      }
      j += 1;
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (src[j] === '"' || src[j] === "'") {
        const quote = src[j];
        const end = src.indexOf(quote, j + 1);
        const stop = end < 0 ? src.length : end;
        attrs[attrName] = decodeEntities(src.slice(j + 1, stop));
        j = stop + 1;
      } else {
        const valueAt = /^[^\s>]*/.exec(src.slice(j, j + 4096));
        const value = valueAt === null ? '' : valueAt[0];
        attrs[attrName] = decodeEntities(value);
        j += value.length;
      }
    }
    i = j;

    if (closing) {
      // 关到最近的同名元素为止；找不到就忽略这一跳（容错）。
      for (let k = stack.length - 1; k > 0; k -= 1) {
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      }
      continue;
    }

    const autoClose = AUTO_CLOSE[tag];
    if (autoClose !== undefined) {
      while (top().type === 'element' && autoClose.includes(top().tag)) stack.pop();
    }

    const node = elementNode(tag, attrs);
    node.parent = top();
    top().children.push(node);

    if (VOID.has(tag) || selfClosed) continue;
    if (RAW_TEXT.has(tag)) {
      const close = src.toLowerCase().indexOf(`</${tag}`, i);
      const stop = close < 0 ? src.length : close;
      if (stop > i) {
        const text = textNode(src.slice(i, stop));
        text.parent = node;
        node.children.push(text);
      }
      const gt = close < 0 ? -1 : src.indexOf('>', close);
      i = gt < 0 ? src.length : gt + 1;
      continue;
    }
    stack.push(node);
  }
  return root;
}

/** 是否元素节点。 */
const isElement = (node) => node !== null && node !== undefined && node.type === 'element';

/**
 * 深度优先遍历（文档顺序）。
 *
 * @param node - 起点。
 * @param visit - 回调；返回 true 时停止。
 */
function walk(node, visit) {
  for (const child of node.children ?? []) {
    if (visit(child) === true) return true;
    if (walk(child, visit) === true) return true;
  }
  return false;
}

/**
 * 文档顺序的全部元素。
 *
 * @param node - 起点。
 * @returns 元素数组。
 */
export function elementsOf(node) {
  const out = [];
  walk(node, (child) => {
    if (isElement(child)) out.push(child);
    return false;
  });
  return out;
}

/**
 * 找第一个满足条件的元素。
 *
 * @param node - 起点。
 * @param test - 判据。
 * @returns 元素或 undefined。
 */
export function findElement(node, test) {
  let found;
  walk(node, (child) => {
    if (isElement(child) && test(child)) {
      found = child;
      return true;
    }
    return false;
  });
  return found;
}

/** 取属性（小写名）；没有时给空串（与上游 `attr()` 一致，省掉一堆 `?? ''`）。 */
const attr = (node, name) => (isElement(node) ? node.attrs?.[name] ?? '' : '');

/** 元素的 class 里有没有这一项。 */
const hasClass = (node, name) => attr(node, 'class').split(/\s+/).includes(name);

/** 元素的全部后代元素（不含自己）。 */
function descendantsOf(node) {
  const out = [];
  for (const child of node.children ?? []) {
    if (isElement(child)) out.push(child);
    out.push(...descendantsOf(child));
  }
  return out;
}

/** `inner` 是不是 `outer` 自己或它的后代。上游 `inside()`。 */
function within(outer, inner) {
  if (outer === inner) return true;
  for (const child of outer.children ?? []) {
    if (within(child, inner)) return true;
  }
  return false;
}

/**
 * 元素的原始文本（拼接文本节点，跳过 script/style）。
 *
 * 与 `htmlToText` 的区别：**不插块级换行、不折叠行内空白**。
 * 上游 webplus 的 `text()` 就是这个口径，日期判断依赖它（`2026-09-30` 不能被折成两段）。
 *
 * @param node - 元素或根。
 * @returns 文本。
 */
export function rawText(node) {
  if (node?.type === 'text') return decodeEntities(node.value);
  if (!isElement(node) && node?.type !== 'root') return '';
  if (isElement(node) && RAW_TEXT.has(node.tag)) return '';
  let out = '';
  for (const child of node.children ?? []) out += rawText(child);
  return out;
}

/**
 * 富文本转纯文本：块级标签换行、`<br>` 换行、去 script/style、解实体、压空白。
 *
 * 逐条对照上游 `core/html.ts` 的 `htmlToText`：段落之间空行、行内空白折叠、
 * 首尾去空白。正文正文（`NoticeDetail.text`）用它。
 *
 * ⚠️ `<br>` 与块级标签的处理**不一样**：`<br>` 是**一个**换行（行内断行），
 * 块级元素是**前后各一个**换行（于是自然形成空行）。把它们混为一谈会让
 * 「第一段 / 第二段<br>换行」变成两处空行，与上游输出不一致。
 *
 * @param node - 元素或根。
 * @returns 纯文本。
 */
export function htmlToText(node) {
  if (isElement(node) && RAW_TEXT.has(node.tag)) return '';
  const pieces = [];
  const visit = (current) => {
    if (current.type === 'text') {
      pieces.push(decodeEntities(current.value).replace(/\u00a0/g, ' '));
      return;
    }
    if (isElement(current) && RAW_TEXT.has(current.tag)) return;
    if (isElement(current) && current.tag === 'br') {
      pieces.push('\n');
      return;
    }
    const block = isElement(current) && BLOCK.has(current.tag);
    if (block) pieces.push('\n');
    for (const child of current.children ?? []) visit(child);
    if (block) pieces.push('\n');
  };
  visit(node);
  return pieces.join('')
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ────────────────────────────── 链接与附件 ── */

/**
 * 这个地址是不是附件（不是网页正文）。
 *
 * 上游 `article.ts` 的原样口径：`file_download.html`、`download(att|file)`、
 * 或常见文档后缀。
 *
 * @param url - 地址。
 * @returns 是否附件。
 */
export function isAttachment(url) {
  return /file_download\.html|download(att|file)|\.(pdf|docx?|xlsx?|pptx?|zip|rar)(\?|$)/i.test(String(url ?? ''));
}

/**
 * 取一个元素里的全部链接（`a[href]` 与 `img[src]`），相对路径按 base 补全。
 *
 * 上游 `extractLinks` 的口径：非法 URL 跳过（单个坏链接不值得让整页失败），
 * 图片记成 `[图片]`。
 *
 * @param node - 起点。
 * @param base - 补全用的地址。
 * @returns `{ url, text }[]`。
 */
export function extractLinks(node, base) {
  const out = [];
  for (const child of elementsOf(node)) {
    const href = child.tag === 'a' ? attr(child, 'href').trim() : '';
    const src = child.tag === 'img' ? attr(child, 'src').trim() : '';
    const target = href || src;
    if (!target || /^(?:javascript:|#|$)/i.test(target)) continue;
    let url;
    try {
      url = new URL(target, base).href;
    } catch {
      continue; // 非法 URL 跳过
    }
    out.push({ url, text: href ? htmlToText(child) : '[图片]' });
  }
  return out;
}

/* ────────────────────────────── 网站群（webplus）适配器 ── */

/**
 * 文章号：网站群的文章号全站群唯一（同一篇挂在几个栏目时栏目号不同、文章号相同）。
 *
 * 外链和附件没有文章号，用链接本身 —— 这样「同一篇文章在几个栏目」不会因为
 * 栏目号不同而重复计入，而外链也不会被误当成校内文章。
 *
 * @param url - 文章地址。
 * @returns `wp-<文章号>` 或链接本身。
 */
export function articleId(url) {
  const id = String(url ?? '').match(/\/c\w+a(\d+)\/page\.(?:htm|psp)/)?.[1];
  return id ? `wp-${id}` : String(url ?? '');
}

/** 拼一个 ISO 日期；月日越界或不可解析时给 undefined。 */
const isoDate = (year, month, day) => {
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const valid = Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31
    && Number.isFinite(Date.parse(date));
  return valid ? date : undefined;
};

/** 北京时间的 `YYYY-MM-DD`，可偏移天数。 */
const beijingDay = (offsetDays = 0, now = Date.now()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
}).format(now + offsetDays * 86_400_000);

/**
 * 条目里的日期。
 *
 * 上游实测过的四种写法都要认：
 *
 * - `2026-09-30` / `2026.09.30` / `2026年9月30日`；
 * - `22-09-05`（两位年）；
 * - 只有 `2026-09`（日从文章地址 `/<年>/<月日>/c…` 里取）；
 * - 年月与日**拆成两个元素**。
 *
 * @param item - 条目元素。
 * @param url - 条目链接（补年月日时用）。
 * @returns `YYYY-MM-DD` 或 undefined。
 */
export function dateOf(item, url) {
  const short = [item, ...descendantsOf(item)]
    .flatMap((node) => [clean(rawText(node)), ...node.children.filter((child) => child.type === 'text').map((child) => clean(rawText(child)))])
    .filter((text) => text && text.length <= 24)
    .map((text) => text.replace(/^[[(（【]\s*|\s*[\])）】]$/g, '').replace(/^(?:发布)?(?:时间|日期)\s*[:：]\s*/, ''));
  const find = (re) => {
    for (const text of short) {
      const match = text.match(re);
      if (match) return match;
    }
    return undefined;
  };

  const full = find(/^(\d{4})[-./年](\d{1,2})[-./月](\d{1,2})日?$/);
  if (full) return isoDate(full[1], full[2], full[3]);
  const twoDigit = find(/^(\d{2})-(\d{2})-(\d{2})$/);
  if (twoDigit) return isoDate(`20${twoDigit[1]}`, twoDigit[2], twoDigit[3]);

  const fromUrl = String(url ?? '').match(/\/(\d{4})\/(\d{2})(\d{2})\/c\w+a\d+\//);
  const yearMonth = find(/^(\d{4})[-./年](\d{1,2})月?$/);
  const monthDay = find(/^(\d{1,2})[-./月](\d{1,2})日?$/);
  if (yearMonth) {
    const sameMonth = fromUrl && fromUrl[1] === yearMonth[1] && Number(fromUrl[2]) === Number(yearMonth[2]);
    const day = short.map((text) => text.match(/^(\d{1,2})日?$/)?.[1])
      .find((value) => value && Number(value) >= 1 && Number(value) <= 31);
    return isoDate(yearMonth[1], yearMonth[2], sameMonth ? fromUrl[3] : day ?? '1');
  }
  if (monthDay) {
    const year = find(/^(20\d{2})年?$/)?.[1] ?? fromUrl?.[1];
    if (year) return isoDate(year, monthDay[1], monthDay[2]);
  }
  return fromUrl ? isoDate(fromUrl[1], fromUrl[2], fromUrl[3]) : undefined;
}

/** 一个列表条目。 */
const usableLink = (node) => node.tag === 'a' && !/^(?:javascript:|#|$)/i.test(attr(node, 'href').trim());

/**
 * 解析一个列表条目。
 *
 * 上游 `parseItem` 口井：标题优先取 `title` 属性（链接上或里面标题元素上），
 * 其次链接里的标题元素/第一段，最后才是链接文字（去掉末尾日期）。
 *
 * @param item - 条目元素。
 * @param pageUrl - 列表页地址（补全相对链接）。
 * @param unwrapUrl - 把网关地址解回逻辑地址。
 * @returns `{ id, title, date, url }`。
 * @throws {NoticeError} 缺标题或日期（`SHAPE`）。
 */
export function parseItem(item, pageUrl, unwrapUrl = (url) => url) {
  const links = [item, ...descendantsOf(item)].filter(usableLink);
  const main = links.find((link) => attr(link, 'title').trim() || clean(rawText(link))) ?? links[0];
  if (main === undefined) {
    throw new NoticeError('SHAPE', '栏目列表条目里没有可用链接', { url: pageUrl });
  }
  const url = unwrapUrl(new URL(attr(main, 'href').trim(), pageUrl).href);
  const date = dateOf(item, url);
  const inside = [main, ...descendantsOf(main)];
  // 标题所在的元素：优先标题标签，其次 class 像标题的（tit / bt），最后段落。
  const block = inside.find((node) => /^h[1-6]$/.test(node.tag))
    ?? inside.find((node) => node !== main && /tit|(?:^|[\s_-])bt/i.test(attr(node, 'class')))
    ?? inside.find((node) => node.tag === 'p');
  const title = clean(inside.map((node) => attr(node, 'title')).find((value) => value.trim())
    || (block ? rawText(block) : clean(rawText(main)).replace(/\s*\d{4}[-./]\d{1,2}[-./]\d{1,2}$/, '')));
  if (!title || !date) {
    throw new NoticeError('SHAPE', '栏目列表条目缺少标题或日期', { url: pageUrl, href: attr(main, 'href') });
  }
  return { id: articleId(url), title, date, url };
}

/**
 * 解析网站群栏目的一页。
 *
 * # 条目是怎么定位的（上游最重要的一段推断）
 *
 * 各站模板不同（`li`、`div`、`tr` 都有），共同点只有一条：**分页条之前紧挨着的
 * 一组同级元素**，每个里面有文章链接和日期。所以：
 *
 * 1. 从分页条前最后一个链接往上找；
 * 2. 第一层「同名兄弟元素不少于本页条数」的就是条目；
 * 3. **条数由分页条自己算出**（`all_pages` / `all_count` / `per_count` / `curr_page`）；
 * 4. 对不上就报错，**绝不**「随便找个容器当条目列表」。
 *
 * @param html - 页面 HTML。
 * @param pageUrl - 页面地址。
 * @param unwrapUrl - 把网关地址解回逻辑地址。
 * @returns `{ items, pages, total }`。
 * @throws {NoticeError} 没有分页信息（`SHAPE`）或条数对不上（`DRIFT`）。
 */
export function parseList(html, pageUrl, unwrapUrl = (url) => url) {
  const root = parseHtml(html);
  const paging = elementsOf(root).filter((node) => /^wp_paging_w\d+$/.test(attr(node, 'id')));
  if (paging.length === 0) {
    // 网站群把不存在或无权查看的栏目渲染成 200 的提示页。这条要单独说，
    // 因为「栏目不存在」与「站点改版」对用户是完全不同的两件事。
    const notice = findElement(root, (node) => hasClass(node, 'wp_error_msg'));
    throw new NoticeError(
      'SHAPE',
      notice
        ? `栏目页面提示：${clean(htmlToText(notice))}`
        : '栏目列表页没有分页信息，无法确认条目范围（站点可能改版）',
      { url: pageUrl, kind: notice ? 'station-notice' : 'no-paging' },
    );
  }

  const countOf = (name) => {
    for (const node of paging) {
      const em = findElement(node, (child) => child.tag === 'em' && hasClass(child, name));
      if (em !== undefined) {
        const value = Number(clean(rawText(em)));
        if (Number.isFinite(value)) return value;
      }
      const byClass = new RegExp(`<em class="${name}">(\\d+)</em>`).exec(String(html));
      if (byClass !== null) return Number(byClass[1]);
    }
    return undefined;
  };

  const pages = countOf('all_pages') || 1;
  const total = countOf('all_count');
  const per = countOf('per_count');
  const current = countOf('curr_page') || 1;
  if (!Number.isFinite(total) || !Number.isFinite(per)) {
    throw new NoticeError('SHAPE', '栏目列表页缺少条数信息（站点可能改版）', { url: pageUrl });
  }
  const expected = current < pages ? per : total - per * (pages - 1);
  if (expected <= 0) return { items: [], pages, total };

  // 按文档顺序收集「分页条之前」的链接；分页条里面的翻页链接不算。
  const before = [];
  let anchors = [];
  const collect = (node) => {
    for (const child of node.children ?? []) {
      if (!isElement(child)) {
        collect(child);
        continue;
      }
      if (/^wp_paging_w\d+$/.test(attr(child, 'id'))) {
        before.push(...anchors);
        anchors = [];
        continue;
      }
      if (usableLink(child)) anchors.push(child);
      collect(child);
    }
  };
  collect(root);

  const last = before[before.length - 1];
  const known = new Set(before);
  const holds = (node) => known.has(node) || descendantsOf(node).some((child) => known.has(child));
  let items;
  for (let node = last; node !== undefined && items === undefined;) {
    const parent = node.parent;
    if (parent === undefined || parent === null) break;
    const siblings = (parent.children ?? []).filter((child) => isElement(child))
      .filter((child) => child.tag === node.tag && holds(child));
    const candidate = siblings[siblings.length - 1] === node && siblings.length >= expected;
    // 链接本身并排时，只有日期写在链接里才是条目（整条通知包在一个链接里的模板）；
    // 本页只有一条时没有兄弟可比，取到能读出日期的那一层。
    if (candidate) {
      const ok = node.tag === 'a' || expected === 1
        ? /^(?:li|tr|dd|dl|article)$/.test(node.tag) || dateOf(node, pageUrl) !== undefined
        : true;
      if (ok) items = siblings.slice(-expected);
    }
    node = isElement(parent) ? parent : undefined;
  }
  if (items === undefined) {
    // ⚠️ 这是本包的**结构漂移**判据：页面自己说了本页有 `expected` 条，
    // 我们却找不到一组符合这个条数的条目。真实场景就是站点改版（模板换了、
    // 条目外面多包了一层），或者 `expected` 的算法与服务端不一致。
    //
    // 绝不能退化成「返回空列表」：那样调用方会以为「这个栏目没有通知」，
    // 恰恰是 ebook 那次事故的形态（页面说有 42 条、返回 0 本，且没有任何解释）。
    throw new NoticeError(
      'DRIFT',
      `栏目列表里找不到与页面标注条数相符的条目：页面说本页 ${expected} 条，`
      + '但一条也没能按列表条目解析出来（站点可能改版）',
      { url: pageUrl, expected },
    );
  }

  return { items: items.map((item) => parseItem(item, pageUrl, unwrapUrl)), pages, total };
}

/**
 * 一个栏目里符合条件的条目，按日期由新到旧。
 *
 * 分两种栏目：
 *
 * - **按时间排列**（绝大多数）：以每页末尾几条的日期判断读到了哪里，够了就停；
 * - **`unordered`**（上游标了「几乎每条都置顶」的本科生院两栏）：顺序不代表时间，
 *   要读完全部页（上限 `UNORDERED_PAGES`）再排序。
 *
 * @param options.get - `(url) => Promise<{ status, text, url }>`，已判过 HTTP 200。
 * @param options.source - 来源。
 * @param options.column - 栏目。
 * @param options.query - 查询条件。
 * @param options.unwrapUrl - 网关地址解回逻辑地址。
 * @param options.now - 当前时间（测试注入）。
 * @returns `{ notices, hasMore, scannedTo? }`。
 */
export async function listColumn({ get, source, column, query, unwrapUrl = (url) => url, now = Date.now() }) {
  const base = column.base ?? source.base;
  const pageOf = async (number) => {
    const url = `${base}/${column.id}/list${number === 1 ? '' : number}.htm`;
    const response = await get(url);
    return parseList(response.text, url, unwrapUrl);
  };
  const match = (item) => (!query.since || item.date >= query.since)
    && (!query.until || item.date <= query.until)
    && (!query.terms.length || query.terms.some((term) => item.title.includes(term)));

  const first = await pageOf(1);
  const rows = [...first.items];
  let read = 1;
  let scannedTo;
  let hasMore = false;

  if (column.unordered) {
    const rest = await Promise.all(Array.from(
      { length: Math.max(0, Math.min(first.pages, UNORDERED_PAGES) - 1) },
      (_, index) => pageOf(index + 2),
    ));
    rows.push(...rest.flatMap((page) => page.items));
  } else {
    const floor = query.since ?? (query.terms.length ? beijingDay(-KEYWORD_DAYS, now) : undefined);
    const cap = query.since ? SINCE_PAGES : KEYWORD_PAGES;
    const tail = () => rows.slice(-3).map((item) => item.date).sort().at(-1) ?? '';
    const enough = () => {
      const dates = rows.filter(match).map((item) => item.date).sort().reverse();
      return dates.length >= query.limit && tail() < dates[query.limit - 1];
    };
    while (read < first.pages) {
      if (floor !== undefined && tail() < floor) break;
      if (enough()) {
        hasMore = true;
        break;
      }
      if (read >= cap) {
        scannedTo = tail();
        hasMore = true;
        break;
      }
      const batch = await Promise.all(Array.from(
        { length: Math.max(0, Math.min(PAGE_BATCH, first.pages - read, cap - read)) },
        (_, index) => pageOf(read + 1 + index),
      ));
      for (const page of batch) rows.push(...page.items);
      read += batch.length;
      if (batch.length === 0) break;
    }
  }

  const seen = new Set();
  const notices = rows
    .filter((item) => match(item) && !seen.has(item.id) && seen.add(item.id))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((item) => ({
      id: item.id,
      title: item.title,
      titleTruncated: false,
      publisher: source.name,
      date: item.date,
      source: `${source.name}·${column.name}`,
      sourceId: source.id,
      pinned: false,
      url: item.url,
    }));
  return {
    notices: notices.slice(0, query.limit),
    hasMore: hasMore || notices.length > query.limit,
    ...(scannedTo !== undefined ? { scannedTo } : {}),
  };
}

/* ────────────────────────────── 正文解析 ── */

/**
 * 教务网通知详情地址。
 *
 * `doType=save` 会把该条标为已读 —— 这是**服务端副作用**，但上游照用：
 * 它同时也是前端点开通知时的地址，不这么做有些条目读不出正文。
 *
 * @param id - 通知编号。
 * @returns 详情地址。
 */
export function detailUrl(id) {
  return `${ZDBK_BASE}/xtgl/xwgl_ckXw.html?xwbh=${encodeURIComponent(String(id))}&doType=save`;
}

/**
 * 列表条目直接指向文件时的正文记录。**不去下载附件**（那是另一个动作）。
 *
 * @param id - 条目 id。
 * @param url - 附件地址。
 * @param title - 标题（可能没有）。
 * @returns 正文记录。
 */
export function attachmentDetail(id, url, title) {
  const item = { url, text: title ?? '通知原始附件' };
  return {
    id,
    title: title ?? '附件通知',
    publisher: '',
    publishedAt: '',
    text: '该通知以附件发布，正文请读取原始附件。',
    url,
    links: [{ ...item, attachment: true }],
    attachments: [item],
    contentStatus: 'attachment-only',
  };
}

/**
 * 解析通知正文页。**不分来源**：教务网详情页、考试中心、网站群和学院 CMS 的正文容器。
 *
 * # 正文容器的识别顺序（上游 `article.ts`）
 *
 * 1. `news_con`（教务网的正文容器）；
 * 2. `wp_articlecontent` / `v_news_content` / `id="vsb_content"`（网站群各模板）；
 * 3. `col-lg-offset-2` + `col-md-offset-1`（某学院模板的排版类）；
 * 4. `<article>`。
 *
 * ⚠️ 第 1 条有个**例外**：信息技术中心（itc）的模板把导航栏也叫 `news_con`。
 * 所以只有「没有 `wp_articlecontent`，或它有嵌套在 `news_con` 里面」时才用 `news_con`
 * —— 否则会把导航栏当正文。
 *
 * # 宁可报错也不猜
 *
 * 认不出正文容器时**不退回「整页文本」**：那会把导航、页脚、相关新闻全塞进正文，
 * 用户会以为那就是通知。此时标 `summary-only`（只有 meta 摘要）或 `unavailable`。
 *
 * @param id - 条目 id。
 * @param html - 页面 HTML。
 * @param url - 跟随重定向后的最终地址（相对链接按它补全）。
 * @param unwrapUrl - 网关地址解回逻辑地址。
 * @returns 正文记录。
 * @throws {NoticeError} 页面是网站群的错误页（`SHAPE`）、或缺少标题（`SHAPE`）。
 */
export function parseArticle(id, html, url, unwrapUrl = (value) => value) {
  const root = parseHtml(html);
  const elements = elementsOf(root);
  const meta = (name) => {
    const found = elements.find((node) => node.tag === 'meta'
      && (attr(node, 'name').toLowerCase() === name.toLowerCase() || attr(node, 'property') === name));
    return found === undefined ? '' : attr(found, 'content');
  };
  const textOf = (node) => (node === undefined ? '' : htmlToText(node));

  const newsCon = elements.find((node) => hasClass(node, 'news_con'));
  const webplus = elements.find((node) => hasClass(node, 'wp_articlecontent'));
  const body = (newsCon !== undefined && (webplus === undefined || within(newsCon, webplus)) ? newsCon : undefined)
    ?? elements.find((node) => hasClass(node, 'wp_articlecontent') || hasClass(node, 'v_news_content') || attr(node, 'id') === 'vsb_content')
    ?? elements.find((node) => hasClass(node, 'col-lg-offset-2') && hasClass(node, 'col-md-offset-1'))
    ?? elements.find((node) => node.tag === 'article');

  const notice = elements.find((node) => hasClass(node, 'wp_error_msg'));
  if (body === undefined && notice !== undefined) {
    throw new NoticeError('SHAPE', `页面提示：${textOf(notice)}`, { id, url });
  }

  // 网站群的文章窗口：标题和「发布者 / 来源 / 时间」一行都排在正文容器之前，各站 class 不同，
  // 所以用 portletmode="simpleArticleAttri" 认窗口，再按**文档顺序**取正文之前的部分。
  // （上游是把 HTML 序列化成字符串后 indexOf 定位正文；这里用树关系，避免序列化差异带来的偏移。）
  const articleWindow = elements.find((node) => attr(node, 'portletmode') === 'simpleArticleAttri');
  const windowHead = articleWindow === undefined ? [] : elementsOf(articleWindow).filter((node) => body !== undefined && !within(node, body));
  const windowTitle = windowHead
    .filter((node) => /^h[1-3]$/.test(node.tag))
    .map((node) => htmlToText(node))
    .find(Boolean) ?? '';

  const title = meta('ArticleTitle')
    || textOf(elements.find((node) => node.tag === 'h3' && hasClass(node, 'text-center')))
    || meta('og:title')
    || textOf(elements.find((node) => hasClass(node, 'arti_title')))
    || windowTitle
    || textOf(elements.find((node) => node.tag === 'title'))
    || textOf(elements.find((node) => node.tag === 'h1'));
  if (!title.replace(/\u200b/g, '').trim()) {
    throw new NoticeError('SHAPE', '通知详情页缺少标题（站点可能改版）', { id, url });
  }

  const headText = textOf(elements.find((node) => hasClass(node, 'news_title1')))
    || textOf(elements.find((node) => hasClass(node, 'info') && /发布日期/.test(htmlToText(node))))
    || textOf(elements.find((node) => hasClass(node, 'article-title') && /时间[:：]/.test(htmlToText(node))))
    || windowHead.map((node) => htmlToText(node)).join('\n');
  const publisher = headText.match(/发布[人者][:：]\s*(.*?)(?=发布(?:时间|日期)|浏览[人次]数|$)/s)?.[1]?.trim()
    || meta('ArticleSource');
  const origin = headText.match(/来源[:：]\s*([^\s:：]+)/)?.[1];
  const time = headText.match(/(?:发布)?(?:时间|日期)[:：]\s*(\d{4}-[\d-]+(?:\s+[\d:]+)?|\d{4}年\d{1,2}月\d{1,2}日)/)?.[1] ?? '';
  const cn = time.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  const publishedAt = (cn ? `${cn[1]}-${String(cn[2]).padStart(2, '0')}-${String(cn[3]).padStart(2, '0')}` : time)
    || meta('PubDate');

  const text = body !== undefined ? htmlToText(body) : clean(meta('description'));
  const links = (body === undefined ? [] : extractLinks(body, url))
    .filter((link) => /^https?:/i.test(link.url))
    .map((link) => ({ ...link, url: unwrapUrl(link.url), attachment: isAttachment(link.url) }));
  // webplus 用 `<div pdfsrc="…">` 内嵌 PDF，没有 `<a>` 链接。
  if (body !== undefined) {
    for (const node of elementsOf(body)) {
      const pdf = attr(node, 'pdfsrc');
      if (!pdf) continue;
      links.push({ url: unwrapUrl(new URL(pdf, url).href), text: 'PDF 附件', attachment: true });
    }
  }
  const attachments = links.filter((link) => link.attachment).map(({ url: link, text: label }) => ({ url: link, text: label }));

  return {
    id,
    title: title.replace(/\u200b/g, '').trim(),
    publisher,
    publishedAt,
    ...(origin ? { origin } : {}),
    text,
    links,
    attachments,
    url,
    contentStatus: body !== undefined && text ? 'full'
      : body !== undefined && attachments.length ? 'attachment-only'
        : body !== undefined && links.length ? 'full'
          : text ? 'summary-only' : 'unavailable',
  };
}

/* ────────────────────────────── 竞赛管理系统（kyjs）适配器 ── */

/**
 * 竞赛管理系统的新闻正文。
 *
 * 本科生院实践交流栏的学科竞赛、大创条目**外链**到这里。页面是前端渲染，
 * 正文取 `GET /prod-api/home/news/detail?newsId=`，免登录，附件在 `files[]`（公网 OSS）。
 *
 * ⚠️ 它**不是**一个来源：没有通知列表，所以不在 `SOURCES` 里，只在取正文时按
 * URL 特征（域名 + `newsId` 参数）参与分派。不是这种链接时返回 `undefined`，
 * 让调用方继续走别的分支。
 *
 * @param get - `(url) => Promise<{ status, text, url }>`。
 * @param url - 通知链接。
 * @param unwrapUrl - 网关地址解回逻辑地址。
 * @returns 正文记录，或 undefined（不是 kyjs 新闻链接）。
 * @throws {NoticeError} JSON 解析失败 / 业务码非 0（`SHAPE`）。
 */
export async function kyjsNotice(get, url, unwrapUrl = (value) => value) {
  const target = new URL(url);
  const newsId = target.searchParams.get('newsId');
  if (target.hostname !== KYJS_HOST || !newsId) return undefined;
  const api = `${target.protocol}//${target.host}/prod-api/home/news/detail?newsId=${encodeURIComponent(newsId)}`;
  const response = await get(api);
  let body;
  try {
    body = JSON.parse(response.text);
  } catch {
    throw new NoticeError('SHAPE', '竞赛管理系统通知详情不是 JSON（站点可能改版）', { url });
  }
  const data = body?.data;
  if (body?.code !== 0 || !data?.title) {
    throw new NoticeError('SHAPE', `竞赛管理系统通知详情读取失败：${body?.msg ?? '无数据'}`, { url });
  }
  const text = htmlToText(parseHtml(String(data.content ?? '')));
  const files = (data.files ?? []).filter((file) => file?.fileUrl)
    .map((file) => ({ url: file.fileUrl, text: file.fileName ?? '附件' }));
  const root = parseHtml(String(data.content ?? ''));
  const links = [
    ...extractLinks(root, url).filter((link) => /^https?:/i.test(link.url))
      .map((link) => ({ ...link, url: unwrapUrl(link.url), attachment: false })),
    ...files.map((file) => ({ ...file, attachment: true })),
  ];
  return {
    id: url,
    title: data.title,
    publisher: data.accountName ?? '',
    publishedAt: data.publishTime ?? '',
    text,
    links,
    attachments: files,
    contentStatus: text ? 'full' : files.length ? 'attachment-only' : 'unavailable',
    url,
  };
}

/* ────────────────────────────── 教务网（zdbk）适配器 ── */

/**
 * 教务网通知列表的路径。
 *
 * `POST …?doType=query&gnmkdm=index`，条件全在**表单体**里：
 * `xwbt`（标题模糊）、`gglb`（类别）。
 *
 * ⚠️ 默认排序是 `sfzd desc, fbsj desc`（置顶优先）。这里一律按 `fbsj` ——
 * 否则一条旧置顶会**永久压住**所有新通知。
 */
const ZDBK_LIST_PATH = '/xtgl/xwgl_cxXwListAlltzgg.html';

/** 教务网通知的一条原始记录。 */
const zdbkTruncated = (title) => /\.{3}$|…$/.test(title);

/**
 * 教务网列表记录 → 本包的 `Notice`。
 *
 * @param row - 原始记录。
 * @returns 列表条目。
 */
function toZdbkNotice(row) {
  const title = decodeEntities(String(row?.xwbt ?? '')).trim();
  const category = String(row?.gglb ?? '');
  const notice = {
    id: String(row?.xwbh ?? ''),
    title,
    titleTruncated: zdbkTruncated(title),
    publisher: String(row?.fbr ?? ''),
    date: String(row?.fbsj ?? ''),
    source: category ? `教务网·${category}` : '教务网',
    sourceId: 'zdbk',
    pinned: String(row?.sfzd) === '1',
    url: detailUrl(String(row?.xwbh ?? '')),
  };
  if (typeof row?.fbdz === 'string' && row.fbdz.trim()) {
    notice.externalUrl = new URL(decodeEntities(row.fbdz.trim()), notice.url).href;
  }
  return notice;
}

/**
 * 读教务网列表的一页。
 *
 * @param post - `(url, form) => Promise<object>`，已判过 HTTP 与 JSON。
 * @param options.keyword - 标题关键词。
 * @param options.category - 类别（空串表示不按类别筛）。
 * @param options.page - 页码（从 1 开始）。
 * @param options.size - 每页条数。
 * @returns `{ notices, total, totalPages }`。
 */
async function zdbkListPage(post, { keyword, category, page, size = 50 }) {
  const data = await post(`${ZDBK_BASE}${ZDBK_LIST_PATH}?doType=query&gnmkdm=index`, {
    xwbt: keyword ?? '',
    gglb: category,
    'queryModel.showCount': String(size),
    'queryModel.currentPage': String(page),
    'queryModel.sortName': 'fbsj',
    'queryModel.sortOrder': 'desc',
    time: '1',
  });
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Number(data?.totalResult ?? 0);
  const totalPages = Number(data?.totalPage ?? data?.totalPages ?? (total > 0 ? Math.ceil(total / size) : 1));
  return { notices: items.map(toZdbkNotice), total, totalPages };
}

/**
 * 逐页扫，直到满足条件。
 *
 * 按 `fbsj` 排序之后，日期单调不增，所以「读到早于 since 的一条」就可以停。
 *
 * @param post - 列表请求。
 * @param options - 类别、关键词、查询条件。
 * @returns `{ notices, hasMore }`。
 * @throws {NoticeError} 分页出现重复/缺标识、提前为空、分页超限（`SHAPE`）。
 */
async function zdbkRows(post, { category, keyword, query }) {
  const found = [];
  const seen = new Set();
  for (let page = 1; page <= 1000; page += 1) {
    const result = await zdbkListPage(post, { ...(keyword ? { keyword } : {}), category, page });
    for (const notice of result.notices) {
      if (!notice.id || seen.has(notice.id)) {
        throw new NoticeError('SHAPE', '通知分页出现重复或缺少标识，不能确认检索完整', { page });
      }
      seen.add(notice.id);
      if (query.until && notice.date.slice(0, 10) > query.until) continue;
      if (query.since && notice.date.slice(0, 10) < query.since) return { notices: found, hasMore: false };
      found.push(notice);
      if (found.length > query.limit) return { notices: found.slice(0, query.limit), hasMore: true };
    }
    if (seen.size >= result.total) return { notices: found, hasMore: false };
    if (result.notices.length === 0) {
      throw new NoticeError('SHAPE', '通知分页提前为空，结果不完整', { page, total: result.total });
    }
  }
  throw new NoticeError('SHAPE', '通知检索分页超限');
}

/**
 * 把截断的标题换成完整标题；取不到的保持原样。
 *
 * 教务网列表里的 `xwbt` 被截断到约 20 字并以 `...` 结尾，完整标题只在详情页。
 *
 * @param notices - 可能含截断标题的条目。
 * @param options.fetchDetail - `(notice) => Promise<NoticeDetail>`。
 * @param options.cache - 标题缓存（`Map`，调用方持有）。
 * @returns 换过标题的条目。
 */
export async function withFullTitles(notices, { fetchDetail, cache = new Map() }) {
  const missing = notices.filter((notice) => notice.titleTruncated && !cache.has(notice.id));
  await mapLimit(missing, TITLE_CONCURRENCY, async (notice) => {
    try {
      const detail = await fetchDetail(notice);
      // 详情页给不出标题的（外链、纯附件）记下截断标题，免得每次重取。
      cache.set(notice.id, detail.contentStatus !== 'unavailable' && detail.title ? detail.title : notice.title);
    } catch {
      // 取不到完整标题的仍按截断标题比对 —— 这是**降级**，不是静默成功：
      // 调用方看到的还是带 `...` 的标题。
    }
  });
  return notices.map((notice) => (cache.has(notice.id) && cache.get(notice.id) !== notice.title
    ? { ...notice, title: cache.get(notice.id), titleTruncated: false }
    : notice));
}

/**
 * 教务网的最近一批通知，用**完整标题**在本地再比一遍。
 *
 * 为什么要多这一步：教务网的标题检索只比对列表里那段被截断的标题（约前 24 字），
 * 「关于…本科课程第三轮选课的通知」搜「选课」**搜不到**。
 *
 * @param post - 列表请求。
 * @param options - 类别、查询条件、取详情、标题缓存。
 * @returns 命中的条目。
 */
async function zdbkRecentByFullTitle(post, { category, query, fetchDetail, cache }) {
  const rows = [];
  for (let page = 1; rows.length < RECENT_ROWS; page += 1) {
    const result = await zdbkListPage(post, { category, page });
    rows.push(...result.notices);
    if (result.notices.length === 0 || page >= result.totalPages) break;
  }
  const inRange = rows.filter((notice) => (!query.since || notice.date.slice(0, 10) >= query.since)
    && (!query.until || notice.date.slice(0, 10) <= query.until));
  const full = await withFullTitles(inRange, { fetchDetail, cache });
  return full.filter((notice) => query.terms.some((term) => notice.title.includes(term)));
}

/**
 * 教务网的通知列表。
 *
 * `categories` 是来源表里选中的类别；两类都选时**不按类别筛**（一次请求取完）。
 *
 * @param options.post - `(url, form) => Promise<object>`。
 * @param options.categories - 选中的类别。
 * @param options.query - 查询条件。
 * @param options.fetchDetail - 取详情（补全标题用）。
 * @param options.cache - 标题缓存。
 * @returns `{ notices, hasMore }`。
 */
export async function listZdbk({ post, categories, query, fetchDetail, cache = new Map() }) {
  const category = categories.length === 1 ? categories[0] : '';
  const [byTerm, recent] = await Promise.all([
    Promise.all((query.terms.length ? query.terms : [undefined]).map((keyword) => zdbkRows(post, { category, keyword, query }))),
    query.terms.length ? zdbkRecentByFullTitle(post, { category, query, fetchDetail, cache }) : [],
  ]);
  const seen = new Set();
  // 本地比对出的条目带完整标题，排在前面以便去重时留下它。
  const found = [...recent, ...byTerm.flatMap((result) => result.notices)]
    .filter((notice) => !seen.has(notice.id) && seen.add(notice.id))
    .sort((a, b) => b.date.slice(0, 10).localeCompare(a.date.slice(0, 10)));
  return {
    notices: found.slice(0, query.limit),
    hasMore: byTerm.some((result) => result.hasMore) || found.length > query.limit,
  };
}

/* ────────────────────────────── 两份数据文件 ── */

/** 数据目录。`files` 里必须包含 `data/`，否则 `npm pack` 出来的包读不到这两份表。 */
const DATA = new URL('../data/', import.meta.url);

/** 缓存（一次进程只读一次盘）。 */
const cache = { hosts: null, colleges: null };

/**
 * 读一份 JSON 数据文件。
 *
 * # 为什么用 `readFileSync` 而不是 `import … with { type: 'json' }`
 *
 * ESM 的 JSON 导入属性支持取决于 Node 版本（`with` 与旧的 `assert` 两种语法在不同
 * 版本上互不兼容），而本包要在 `^22.19 || >=24` 上都能跑。`readFileSync` 没有这个问题。
 *
 * 失败时**不吞错**：一份读不到的表会让「默认来源」和「按学院取」都错，静默降级
 * 比直接报错难查得多。
 *
 * @param name - 文件名。
 * @returns 解析后的对象。
 * @throws {NoticeError} 文件缺失或不是合法 JSON（`CONFIG`）。
 */
function readData(name) {
  let raw;
  try {
    raw = readFileSync(new URL(name, DATA), 'utf8');
  } catch (error) {
    throw new NoticeError(
      'CONFIG',
      `通知来源表 ${name} 读不到（${error?.code ?? error?.message}）：重装本包，或确认 data/ 目录随包发布`,
      { file: name },
    );
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new NoticeError('CONFIG', `通知来源表 ${name} 不是合法 JSON：${error.message}`, { file: name });
  }
}

/**
 * 逐站标注表（`hosts.json`，上游由 `scripts/notice/hosts.ts` 从校外实测生成）。
 *
 * 每一条是「这个网站从校外能不能直接访问」。**表里没有的按只在校园网算** ——
 * 猜成公网会让校外用户拿到一个必然超时的请求。
 *
 * @returns `{ generatedAt, via, hosts }`。
 */
export function hostTable() {
  cache.hosts ??= readData('hosts.json');
  return cache.hosts;
}

/**
 * 一个网站从校外能不能直接访问。
 *
 * @param site - 站点地址（带协议）。
 * @returns `'public'` 或 `'campus'`。
 */
export function networkOf(site) {
  let host;
  try {
    host = new URL(String(site)).hostname;
  } catch {
    return 'campus';
  }
  const entry = hostTable().hosts?.[host];
  return entry?.network === 'public' ? 'public' : 'campus';
}

/**
 * 学院名录（`colleges.json`，上游由 `scripts/notice/colleges.ts` 从学校主页的
 * 学院（系）名录生成）。
 *
 * @returns `{ generatedAt, colleges, skipped }`。
 */
export function collegeCatalog() {
  cache.colleges ??= readData('colleges.json');
  return cache.colleges;
}

/** 名字归一：全半角、空白、大小写都不该影响匹配。 */
const norm = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

/**
 * 简称按字序出现在全名里（计组 → 计算机组成，概统 → 概率论与数理统计）。
 *
 * @param query - 用户写的名字。
 * @param name - 全名。
 * @returns 是否像简称。
 */
export function abbreviates(query, name) {
  const chars = [...norm(query)];
  const full = norm(name);
  let at = 0;
  for (const char of chars) {
    at = full.indexOf(char, at);
    if (at < 0) return false;
    at += char.length;
  }
  return chars.length > 1;
}

/**
 * 名录里的全部学院，每个学院是一个网站群来源。
 *
 * 栏目可能分布在主站和办公网，各带自己的站点地址 —— 所以 `Column.base` 优先于
 * `Source.base`。
 *
 * @returns 来源数组（`id` 前缀 `college-`）。
 */
export function collegeSources() {
  return collegeCatalog().colleges.map((college) => ({
    id: `college-${college.id}`,
    name: college.name,
    adapter: 'webplus',
    base: new URL(college.home).origin,
    columns: college.columns.map((column) => ({
      id: column.id,
      base: column.base,
      name: column.name,
      ...(column.audience === 'all' ? {} : { audience: column.audience }),
    })),
  }));
}

/**
 * 按名字找学院：全称、全称的一部分、简称（计算机学院、信电、公管）都行；可能不止一个。
 *
 * 「可能不止一个」是刻意的：`公管` 同时命中公共管理学院与公共政策研究院时，
 * 猜一个比报错更糟。
 *
 * @param name - 用户写的学院名。
 * @returns 命中的学院来源。
 */
export function findCollege(name) {
  const wanted = norm(name);
  if (wanted.length < 2) return [];
  const all = collegeSources();
  const exact = all.filter((college) => norm(college.name) === wanted);
  if (exact.length) return exact;
  const partial = all.filter((college) => norm(college.name).includes(wanted) || wanted.includes(norm(college.name)));
  return partial.length ? partial : all.filter((college) => abbreviates(wanted, college.name));
}

/**
 * 名录概况（给 `sources` 动作用）。
 *
 * @returns `{ generatedAt, colleges, unsupported }`。
 */
export function catalogInfo() {
  const catalog = collegeCatalog();
  return {
    generatedAt: catalog.generatedAt,
    colleges: catalog.colleges.map((college) => college.name),
    unsupported: (catalog.skipped ?? []).map((entry) => entry.name),
  };
}

/* ────────────────────────────── 来源表 ── */

/**
 * 来源表。加一个网站群站点或栏目只改这里；栏目号取自该栏目列表页地址 `/<栏目>/list.htm`。
 *
 * - 顺序即合并时的优先级：同一条通知在几个来源都有时**留排在前面的**；
 * - `default`：不指名来源时也读；
 * - `feed`：`new` 动作的增量扫描读它；
 * - 两者都没有的栏目只在 `source` 指名时读；
 * - `audience`：只面向本科生或研究生的栏目，默认集和增量集里只给对应的使用者；
 * - `unordered`：列表顺序不代表时间（几乎每条都置顶），要读完全部页再排序。
 *
 * 各学院官网**不在这里**：`colleges.json` 按使用者的学院选（见 `collegeSources`）。
 */
export const SOURCES = Object.freeze([
  {
    id: 'zdbk',
    name: '教务网',
    aliases: ['教务', '教务处', '本科教务'],
    adapter: 'zdbk',
    base: `https://${ZDBK_HOST}`,
    columns: [
      { id: '本科生院通知公告', name: '本科生院通知公告', aliases: ['本科生院'], audience: 'undergrad', default: true, feed: true },
      { id: '各院系通知公告', name: '各院系通知公告', aliases: ['院系', '院系通知', '学院通知'], audience: 'undergrad', default: true, feed: true },
    ],
  },
  // 选课、考试等教学运行通知教务网几乎全有；这两栏的推免与主修确认公示、毕业生信息核对、
  // 竞赛、大创、境外交流等大多只在官网。
  {
    id: 'bksy',
    name: '本科生院',
    aliases: ['本科生院官网'],
    adapter: 'webplus',
    base: 'https://bksy.zju.edu.cn',
    columns: [
      { id: '76425', name: '学籍管理', audience: 'undergrad', default: true, feed: true, unordered: true },
      { id: '76426', name: '实践交流', audience: 'undergrad', default: true, feed: true, unordered: true },
    ],
  },
  // 学工部管本科生，研究生的对应部门是研工部。
  {
    id: 'xgb',
    name: '学工部',
    aliases: ['学工', '学生工作部', '学工门户'],
    adapter: 'webplus',
    base: 'http://www.xgb.zju.edu.cn',
    columns: [
      { id: '53388', name: '最新通知', audience: 'undergrad', default: true, feed: true },
      { id: '53403', name: '重要通知', audience: 'undergrad', default: true, feed: true },
      { id: '53395', name: '评奖评优', aliases: ['奖学金'], audience: 'undergrad', default: true, feed: true },
      { id: '53396', name: '学生资助', aliases: ['资助'], audience: 'undergrad', default: true, feed: true },
      { id: '53405', name: '公示公告', audience: 'undergrad', default: true, feed: true },
    ],
  },
  {
    id: 'ygb',
    name: '研工部',
    aliases: ['研究生工作部'],
    adapter: 'webplus',
    base: 'http://ygb.zju.edu.cn',
    columns: [
      { id: '31555', name: '通知公告', audience: 'grad', default: true, feed: true },
      { id: '31546', name: '奖助事务', audience: 'grad', default: true, feed: true },
    ],
  },
  // 「全部公告」两年十几条；研究生教务系统（yjsy，前端渲染）未接。
  {
    id: 'grs',
    name: '研究生院',
    aliases: ['研院'],
    adapter: 'webplus',
    base: 'http://www.grs.zju.edu.cn',
    columns: [{ id: 'qbgg', name: '全部公告', audience: 'grad', default: true, feed: true }],
  },
  // 二课、志愿服务、社会实践、社团、创新创业的通知。「通知公告」是下面各分类的汇总，
  // 默认只读它；分类栏供指名。团委以前的域名会跳到这个地址。
  {
    id: 'youth',
    name: '团委',
    aliases: ['校团委', '共青团', '二课', '第二课堂'],
    adapter: 'webplus',
    base: 'https://zjutw.zju.edu.cn',
    columns: [
      { id: 'tzgg', name: '通知公告', default: true, feed: true },
      { id: 'shsjhzyz_32442', name: '实践志愿', aliases: ['志愿', '志愿服务', '社会实践'] },
      { id: 'st_49186', name: '素质拓展' },
      { id: 'xskj_32440', name: '创新创业', aliases: ['双创'] },
      { id: 'wt_32438', name: '校园文化' },
      { id: 'st_32443', name: '学生社团', aliases: ['社团'] },
      { id: 'xsh_44064', name: '学生会' },
      { id: 'qmgc', name: '青马工程' },
    ],
  },
  // 「即时更新」是全校各部处通知按时间的流，工作日十条上下，多为教职工事务
  //（基金指南、招聘、经费认领），不进默认集；「教育教学」「重点提示」是它的子集。
  {
    id: 'zhfw',
    name: '综合服务网',
    aliases: ['综合服务', '全校通知', '学校通知'],
    adapter: 'webplus',
    base: 'http://zhfw.zju.edu.cn',
    columns: [
      { id: 'zhfw_jyjx', name: '教育教学', default: true },
      { id: 'zhfw_zdts', name: '重点提示', default: true },
      { id: 'zhfw_jsgx', name: '即时更新', aliases: ['全部通知'], feed: true },
    ],
  },
  // 需要统一身份认证，列表日期只到月份。
  {
    id: 'itc',
    name: '信息技术中心',
    aliases: ['信息中心', '网络中心'],
    adapter: 'webplus',
    base: 'https://itc.zju.edu.cn',
    columns: [{ id: '90618', name: '通知公告' }],
  },
  {
    id: 'libweb',
    name: '图书馆',
    adapter: 'webplus',
    base: 'http://libweb.zju.edu.cn',
    columns: [
      { id: '55989', name: '本馆新闻' },
      { id: '55543', name: '资源动态' },
    ],
  },
]);

/* ────────────────────────────── 来源选择 ── */

/** 使用者是谁：本科还是研究生、哪个学院。 */
export const LEVELS = Object.freeze(['undergrad', 'grad']);

/**
 * 把一个使用者约束成一个 `{ level, college }`。
 *
 * 上游的 `levelOf()` / `identity()` 会读个人档案、必要时从教务网课表里读一次学院
 * 并落盘 30 天。**本包不这么做**：个人档案属于宿主，一个有副作用的身份推断不该藏在
 * 数据源里。调用方把 `level` 与 `college`（学院**全称**）直接传进来。
 *
 * @param profile - `{ level?, college? }`。
 * @returns `{ level, college }`；`level` 缺省按本科生。
 */
export function normalizeProfile(profile) {
  const level = LEVELS.includes(profile?.level) ? profile.level : 'undergrad';
  const college = typeof profile?.college === 'string' && profile.college.trim() ? profile.college.trim() : null;
  return { level, college };
}

/** 只面向本科生或研究生的栏目，默认集与增量集按使用者的类别取。 */
const fits = (level) => (column) => !column.audience || column.audience === level;

/** 「学院」「我的学院」指本人学院。 */
const MINE = /^(?:本人|我的|我们|本)?(?:学院|院系)$|^本院$/;

/**
 * 拆一串说法：按 `|`、`、`、`，`、`；`、换行分隔，去重（不分大小写与全半角）。
 *
 * @param raw - 用户写的一串。
 * @returns 说法数组。
 */
export function splitPhrases(raw) {
  const seen = new Set();
  return String(raw ?? '')
    .split(/[|｜、，,；;\n]+/)
    .map((piece) => piece.trim())
    .filter((piece) => piece && !seen.has(norm(piece)) && seen.add(norm(piece)));
}

/** 一组选择：`{ source, columns }[]`，加上解析出的使用者。 */
const groupPicks = (sources, keep) => sources
  .map((source) => ({ source, columns: source.columns.filter(keep) }))
  .filter((pick) => pick.columns.length > 0);

/**
 * 选来源。
 *
 * 不给名字时取**默认集**或**增量集**：来源表里标了的栏目，加本人学院的栏目，
 * 只面向本科生或研究生的按使用者的类别取。
 *
 * 给了名字可以是来源名、栏目名或学院名，先按全名和别名，再按包含。
 * **只点名来源表里的来源时不去识别学院**（那需要一次多余的学院查找）。
 *
 * @param raw - 用户写的来源（可空）。
 * @param profile - `{ level?, college? }`。
 * @param options.scope - `default`（列表）/ `feed`（增量）/ `known`（按标题找）。
 * @returns `{ picks, who }`。
 * @throws {NoticeError} 参数为空（`CONFIG`），或没有这个来源（`CONFIG`，带已接入清单）。
 */
export function selectSources(raw, profile, { scope = 'default' } = {}) {
  const who = normalizeProfile(profile);
  const fit = fits(who.level);
  const college = who.college === null ? null : (findCollege(who.college).length === 1 ? findCollege(who.college)[0] : null);
  const hint = who.college === null ? undefined
    : college === null
      ? `学院名录里没有「${who.college}」，这次不含学院官网的通知；请写专业所在学院的全称`
      : undefined;
  const mine = (keep) => (college === null ? [] : groupPicks([college], keep));

  if (raw === undefined || raw === null || String(raw).trim() === '') {
    if (scope === 'feed') {
      return { who: { ...who, college, ...(hint ? { hint } : {}) }, picks: [...mine(fit), ...groupPicks(SOURCES, (column) => column.feed === true && fit(column))] };
    }
    // 本人学院排最前：学院转发校级通知时会加上院内的安排和截止时间，重复时留学院的那条。
    return { who: { ...who, college, ...(hint ? { hint } : {}) }, picks: [...mine(fit), ...groupPicks(SOURCES, (column) => column.default === true && fit(column))] };
  }

  const phrases = splitPhrases(raw).map(norm);
  if (phrases.length === 0) throw new NoticeError('CONFIG', '需要通知来源名称');
  if (phrases.some((phrase) => phrase === '全部' || phrase === '所有')) {
    return {
      who: { ...who, college, ...(hint ? { hint } : {}) },
      picks: [...groupPicks(SOURCES, () => true), ...mine(() => true)],
    };
  }

  const chosen = new Set();
  const named = [];
  for (const phrase of phrases) {
    // 先按来源名/别名，再按栏目名/别名；都没命中才去学院名录里找。
    const hit = (pool, test) => pool.flatMap((source) => {
      const names = [source.name, source.id, ...(source.aliases ?? [])];
      if (names.some((name) => test(norm(name)))) return source.columns;
      return source.columns.filter((column) => [column.name, ...(column.aliases ?? [])]
        .some((name) => test(norm(name))));
    });
    let found = MINE.test(phrase) ? [] : hit(SOURCES, (name) => name === phrase);
    if (found.length === 0 && !MINE.test(phrase)) found = hit(SOURCES, (name) => name.includes(phrase));
    if (found.length === 0) {
      // 学院：本人学院，或按名字从名录里找；再不行按栏目名在本人学院里找。
      if (MINE.test(phrase) && college === null) {
        throw new NoticeError('CONFIG', hint ?? `没有识别出你的学院：请在「个人档案」里填学院全称，或用 source 写学院名`);
      }
      const colleges = MINE.test(phrase) ? [college] : findCollege(phrase);
      named.push(...colleges);
      found = colleges.flatMap((source) => source.columns.filter(fit));
      if (found.length === 0 && college !== null) {
        named.push(college);
        found = college.columns.filter((column) => norm(column.name) === phrase);
        if (found.length === 0) found = college.columns.filter((column) => norm(column.name).includes(phrase));
      }
    }
    if (found.length === 0) {
      throw new NoticeError(
        'CONFIG',
        `没有叫「${phrase}」的通知来源。已接入：${SOURCES.map((source) => source.name).join('、')}，`
        + '以及各学院官网（写学院名，本人学院写「学院」）；也可以写栏目名',
        { phrase, sources: SOURCES.map((source) => source.name) },
      );
    }
    for (const column of found) chosen.add(column);
  }
  return {
    who: { ...who, college, ...(hint ? { hint } : {}) },
    picks: groupPicks([...SOURCES, ...new Set(named)], (column) => chosen.has(column)),
  };
}

/**
 * 结果里交代读了哪些来源：整个来源只写名字，学院栏目多也只写名字。
 *
 * @param selection - `{ picks, who }`。
 * @returns 来源说明数组。
 */
export function describePicks({ picks, who }) {
  return picks.map((pick) => {
    const name = pick.source.name + (pick.source === who?.college ? '（本人学院）' : '');
    const whole = pick.columns.length === pick.source.columns.length
      || (String(pick.source.id).startsWith('college-') && pick.columns.length > 3);
    return whole ? name : `${name}：${pick.columns.map((column) => column.name).join('、')}`;
  });
}

/**
 * 结果里交代按谁取的默认来源。
 *
 * @param who - 选择结果里的 who。
 * @returns `{ profile }` 或空对象。
 */
export function profileOf(who) {
  if (!who) return {};
  return {
    profile: {
      level: who.level === 'grad' ? '研究生' : '本科生',
      college: who.college?.name ?? null,
      ...(who.hint ? { hint: who.hint } : {}),
    },
  };
}

/* ────────────────────────────── 合并与去重 ── */

/**
 * 标题的归一形式：去尾部省略号、去 `【…】` 前缀、去标点空白、去「本科生院」「浙江大学」前缀。
 *
 * @param title - 原始标题。
 * @returns 归一后的标题。
 */
export function titleKey(title) {
  return String(title ?? '')
    .replace(/(\.{3}|…)$/, '')
    .replace(/^【[^】]*】/, '')
    .replace(/[\s“”"'‘’（）()《》〈〉【】[\]—\-－_:：,，、。.·|｜\u200b]/g, '')
    .replace(/^(本科生院|浙江大学)+/, '');
}

/**
 * 两条通知是不是同一条（跨来源）。
 *
 * 判据（上游实测）：去掉前缀和标点后，**短的标题整段出现在长的里**（教务网列表标题
 * 被截断到约 20 字），且发布日期相差不超过两周。**同一来源内不比标题**，只按编号去重
 * —— 同一栏目里两篇标题不同的通知本来就都该留着。
 *
 * @param a - 通知甲。
 * @param b - 通知乙。
 * @param keys - 可选的 `Notice → titleKey` 缓存（避免重复归一）。
 * @returns 是否同一条。
 */
export function sameNotice(a, b, keys = new Map()) {
  if (a.sourceId === b.sourceId) return false;
  const keyOf = (notice) => {
    if (!keys.has(notice)) keys.set(notice, titleKey(notice.title));
    return keys.get(notice);
  };
  const x = keyOf(a);
  const y = keyOf(b);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 8
    && long.includes(short)
    && Math.abs(Date.parse(a.date.slice(0, 10)) - Date.parse(b.date.slice(0, 10))) <= 14 * 86_400_000;
}

/**
 * 按来源表顺序合并，重复的留先出现的。
 *
 * @param lists - 各组通知（顺序即优先级）。
 * @returns `{ notices, dropped }`，`dropped` 记下被并掉的条目归到了哪一条。
 */
export function mergeNotices(lists) {
  const kept = [];
  const ids = new Set();
  const keys = new Map();
  const dropped = new Map();
  for (const notice of lists.flat()) {
    const twin = ids.has(notice.id)
      ? kept.find((candidate) => candidate.id === notice.id)
      : kept.find((candidate) => sameNotice(candidate, notice, keys));
    if (twin !== undefined) {
      dropped.set(twin, [...(dropped.get(twin) ?? []), notice]);
      continue;
    }
    ids.add(notice.id);
    kept.push(notice);
  }
  return { notices: kept.sort((a, b) => b.date.slice(0, 10).localeCompare(a.date.slice(0, 10))), dropped };
}

/* ────────────────────────────── 查询条件 ── */

/**
 * 标题里通常写全称的校内简称。关键词含简称时同时按全称检索。
 *
 * 上游实测：按「推免」搜不到「推荐免试研究生」，按「大创」搜不到「创新训练」。
 */
const KEYWORD_ALIASES = [['推免', '免试'], ['大创', '创新训练']];

/**
 * 关键词可以一次给几个说法（顿号、逗号、竖线分隔），命中任一个即可；最多 8 个。
 *
 * @param keyword - 用户写的关键词。
 * @returns 检索词数组（含简称展开）。
 * @throws {NoticeError} 全是空说法、或超过 8 个（`CONFIG`）。
 */
export function keywordTerms(keyword) {
  if (!keyword) return [];
  const phrases = splitPhrases(keyword);
  if (phrases.length === 0) throw new NoticeError('CONFIG', '需要通知关键词');
  if (phrases.length > 8) throw new NoticeError('CONFIG', '关键词一次最多 8 个说法');
  return [...new Set(phrases.flatMap((phrase) => [
    phrase,
    ...KEYWORD_ALIASES.filter(([short]) => phrase.includes(short)).map(([short, full]) => phrase.replace(short, full)),
  ]))];
}

/**
 * 把请求参数校验成内部查询条件。
 *
 * @param input - `{ keyword?, since?, until?, limit? }`。
 * @returns `{ terms, since?, until?, limit }`。
 * @throws {NoticeError} 日期不合法、起始晚于结束、条数越界（`CONFIG`）。
 */
export function listQuery(input = {}) {
  for (const date of [input.since, input.until]) {
    if (!date) continue;
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date)
      && Number.isFinite(Date.parse(date))
      && new Date(date).toISOString().slice(0, 10) === date;
    if (!valid) throw new NoticeError('CONFIG', '通知日期应为有效的 YYYY-MM-DD', { date });
  }
  if (input.since && input.until && input.since > input.until) {
    throw new NoticeError('CONFIG', '起始日期不能晚于结束日期', { since: input.since, until: input.until });
  }
  const limit = input.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new NoticeError('CONFIG', '通知数量应在 1–200 之间', { limit });
  }
  return {
    terms: keywordTerms(input.keyword),
    ...(input.since ? { since: input.since } : {}),
    ...(input.until ? { until: input.until } : {}),
    limit,
  };
}

/** 北京时间的 `YYYY-MM-DD HH:mm`。 */
const beijingMinute = (iso) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(iso));

/** 等一会儿。 */
const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/* ────────────────────────────── 超时、重试、并发 ── */

/**
 * 给一次请求套上超时。
 *
 * # 为什么必须自己 race，而不能只靠 `timeoutMs`
 *
 * `sharedFetch` → `egress.fetch` → `undici.fetch` 这条链上**没有任何一层读 `timeoutMs`**
 * （`egress.js` 只透传 `init` 里的 `method` / `signal`）。真正读 `timeoutMs` 的只有
 * `Transport`。而本文件收的 `request` 是**注入**的，它未必是 `Transport` —— 也未必监听
 * signal。
 *
 * 所以这里做两件事：**既传 signal**（让守规矩的实现能提前取消），**也自己 race 一个
 * 定时器**（保证再差的实现也一定会超时）。通知站点数量多、质量参差，这一条尤其重要：
 * 一个挂死的栏目会让整次查询永远不返回，路由连 `res.end()` 都到不了。
 *
 * 与 `source/ebook` 的 `withTimeout` 同一口径。
 *
 * @param request - 注入的请求函数。
 * @param url - 目标地址。
 * @param init - 原请求参数。
 * @param timeoutMs - 预算。
 * @returns 响应。
 * @throws {NoticeError} 超时（`TIMEOUT`）。
 */
export async function withTimeout(request, url, init = {}, timeoutMs = SLOW_MS) {
  const controller = new AbortController();
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
  }

  let timer;
  const timedOut = new Promise((_, fail) => {
    timer = setTimeout(() => {
      controller.abort(new Error('timeout'));
      let host = String(url);
      try {
        host = new URL(String(url)).hostname;
      } catch { /* 地址本身就坏，原文照抄 */ }
      fail(new NoticeError('TIMEOUT', `请求 ${host} 超过 ${timeoutMs}ms 没有响应`, { url: String(url), timeoutMs }));
    }, timeoutMs);
  });
  // 请求正常返回时定时器那一支会迟到拒绝，同样要有人接。
  timedOut.catch(() => {});

  try {
    const pending = request(url, { ...init, signal: controller.signal });
    // race 输掉之后它的迟到拒绝没人接，会变成 unhandledRejection。
    pending.catch(() => {});
    return await Promise.race([pending, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 只读请求最多发三次：前两次用短超时，卡住就换一条连接重发；最后一次用长超时。
 *
 * 上游 `read.ts` 的原样口径。**只能用在重发没有副作用的请求上**：本包唯一有副作用的
 * 是教务网详情页的 `doType=save`（把该条标为已读），它也用这个重试 —— 因为重复标记
 * 已读没有可观察的副作用（与上游一致，已在 README 说明）。
 *
 * @param send - `(options) => Promise<T>`，`options.timeoutMs` 是本跳的预算。
 * @param options.attempts - 总次数。
 * @param options.quickMs - 前几次的短超时。
 * @param options.pauseMs - 传输层错误之间的等待基数。
 * @returns 响应。
 */
export async function patiently(send, { attempts = 3, quickMs = QUICK_MS, pauseMs = 800 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await send(attempt < attempts - 1 ? { timeoutMs: quickMs } : {});
    } catch (error) {
      const last = attempt >= attempts - 1;
      const code = error?.code;
      if (last || (code !== 'TIMEOUT' && code !== 'NETWORK')) throw error;
      // 超时立刻重发（换一条连接）；连接被断开等其他传输错误隔一会儿再发。
      if (code === 'NETWORK') await delay(pauseMs * (attempt + 1));
    }
  }
}

/**
 * 限并发地映射一个数组。
 *
 * 通知的来源可能一次选到几十个栏目（`全部` + 一个学院就有十几个）。同时打出去
 * 会撞上站点的连接上限，也会让每一个都慢。上游的做法是给 WebVPN 上下文设
 * `maxSockets: 8`；这里在**任务层**用同一个上限，效果一致且不依赖出口实现。
 *
 * @param items - 输入。
 * @param limit - 并发上限。
 * @param worker - 处理函数。
 * @returns 与输入同序的结果数组。
 */
export async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const run = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, run));
  return out;
}

/* ────────────────────────────── 数据源本体 ── */

/** 把错误翻成本包口径：注入的 `request` 可能抛 `ClassroomError`。 */
function translateRequestError(error, url) {
  if (error instanceof NoticeError) return error;
  const code = error?.code;
  let host = String(url);
  try {
    host = new URL(String(url)).hostname;
  } catch { /* 保留原文 */ }
  if (code === 'TIMEOUT') return new NoticeError('TIMEOUT', `访问 ${host} 超时`, { url: String(url), cause: code });
  if (code === 'NETWORK') {
    return new NoticeError('NETWORK', `连不上 ${host}。检查网络；校外访问校内站点要经 WebVPN。`, { url: String(url), cause: code });
  }
  if (code === 'CANCELLED' || code === 'DISPOSED') return new NoticeError('CANCELLED', '请求已取消', { url: String(url), cause: code });
  if (code === 'WEBVPN_REQUIRED') {
    return new NoticeError('NETWORK', `访问 ${host} 需要 WebVPN：到「设置 → 浙大一卡通」填上网关账号后重试`, { url: String(url), cause: code });
  }
  return new NoticeError('NETWORK', `访问 ${host} 失败：${error?.message ?? error}`, { url: String(url), cause: code });
}

/**
 * 通知数据源。
 *
 * 只用注入的依赖，不碰 cordis、不读凭据、不落盘：
 *
 * @example
 * const source = new NoticeSource({ request, acquireServiceLogin, unwrapUrl });
 * const result = await source.list({ limit: 10, profile: { level: 'undergrad', college: '计算机科学与技术学院' } });
 */
export class NoticeSource {
  /**
   * @param options.request - `(url, init) => Promise<{ status, headers?, text }>`。
   * @param options.acquireServiceLogin - 可选：`({ service, host }) => Promise<void>`，
   *   把某站点的统一身份认证做完（登录后同一 `request` 就带着会话）。不注入时，
   *   遇到要登录的栏目会抛 `AUTH_REQUIRED`。
   * @param options.unwrapUrl - 把 WebVPN 物理地址解回逻辑地址（默认原样）。
   * @param options.now - 当前时间（测试注入）。
   * @param options.titleCache - 教务网标题缓存（`Map`，调用方持有）。
   */
  constructor({ request, acquireServiceLogin = null, unwrapUrl = (url) => url, now = () => Date.now(), titleCache = new Map() }) {
    if (typeof request !== 'function') throw new NoticeError('CONFIG', 'NoticeSource 需要一个 request 函数');
    this.request = request;
    this.acquireServiceLogin = typeof acquireServiceLogin === 'function' ? acquireServiceLogin : null;
    this.unwrapUrl = unwrapUrl;
    this.now = now;
    this.titleCache = titleCache;
    /** 同一站点的并发委托登录共用一次。 */
    this.logins = new Map();
    /** 教务网详情 memo（同一进程内不重复取）。 */
    this.details = new Map();
  }

  /**
   * 发一次请求（带重试与超时归一）。
   *
   * @param url - 地址。
   * @param options.method - 方法（默认 GET）。
   * @param options.form - 表单体（POST 用）。
   * @param options.headers - 额外请求头。
   * @returns `{ status, headers, text }`。
   */
  async send(url, { method = 'GET', form, headers } = {}) {
    const init = {
      method,
      ...(form === undefined ? {} : { body: new URLSearchParams(form).toString() }),
      headers: {
        ...(form === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }),
        ...headers,
      },
    };
    return patiently(async ({ timeoutMs }) => {
      try {
        return await withTimeout(this.request, url, init, timeoutMs ?? SLOW_MS);
      } catch (error) {
        throw translateRequestError(error, url);
      }
    });
  }

  /**
   * 取一页 HTML（跟随跳转，判 200）。
   *
   * 跳转自己跟，因为注入的 `request` 可能是 `Transport`（它的 `redirect` 是 `manual`）。
   * 跳转目标一律按**逻辑地址**解回：网关会把 `Location` 写成它自己的地址。
   *
   * @param url - 地址。
   * @returns `{ status, text, url }`，`url` 是最终地址。
   * @throws {NoticeError} 非 200（`HTTP`）。
   */
  async fetchFollow(url) {
    let current = String(url);
    for (let hops = 0; hops <= MAX_HOPS; hops += 1) {
      // 已经站在统一认证登录页上：**不要再跟**。跟过去只会拿到它自己的首页，
      // 而真正该做的是「做一次该站点的委托登录」，那是 `get()` 的事。
      if (NoticeSource.serviceOf(current) !== null) {
        return { status: 200, text: '', url: current };
      }
      const response = await this.send(current);
      const status = Number(response?.status ?? 0);
      if (status >= 300 && status < 400) {
        const location = response?.headers?.get?.('location') ?? response?.headers?.location ?? '';
        if (!location) throw new NoticeError('HTTP', `HTTP ${status} 但没有 Location`, { url: current });
        let next;
        try {
          next = new URL(location, current).href;
        } catch {
          throw new NoticeError('HTTP', `跳转地址无法解析：${location}`, { url: current });
        }
        const logical = this.unwrapUrl(next);
        // 落到统一认证：把这一跳**当成终点**返回，由 `get()` 判并处理。
        if (NoticeSource.serviceOf(logical) !== null) {
          return { status: 302, text: '', url: logical };
        }
        current = logical;
        continue;
      }
      if (status !== 200) throw new NoticeError('HTTP', `页面 HTTP ${status}`, { url: current });
      return { status, text: String(response?.text ?? ''), url: current };
    }
    throw new NoticeError('HTTP', `跳转超过 ${MAX_HOPS} 次，已停止`, { url: String(url) });
  }

  /** 这一跳是不是统一认证登录页；是的话给出它要回跳的 `service`。 */
  static serviceOf(url) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      return null;
    }
    if (parsed.hostname !== CAS_HOST || !parsed.pathname.startsWith('/cas/login')) return null;
    return parsed.searchParams.get('service');
  }

  /**
   * 取一个校内页面；落到统一认证登录页时**做一次该站的委托登录后重取**。
   *
   * 上游 `Session.get` 的口径：同一站点的并发请求共用一次委托。
   *
   * @param url - 地址。
   * @returns `{ status, text, url }`。
   * @throws {NoticeError} 完成认证后仍要求登录（`AUTH_REQUIRED`）。
   */
  async get(url) {
    let response = await this.fetchFollow(url);
    let wanted = NoticeSource.serviceOf(response.url);
    if (wanted === null) return response;
    if (this.acquireServiceLogin === null) {
      throw new NoticeError(
        'AUTH_REQUIRED',
        `${safeHost(wanted)} 的通知要统一身份认证：到「设置 → 浙大一卡通」登录后重试`,
        { url: String(url), service: wanted },
      );
    }
    const host = safeHost(wanted);
    // 同一站点的并发请求共用一次委托。
    if (!this.logins.has(host)) {
      const pending = Promise.resolve()
        .then(() => this.acquireServiceLogin({ service: wanted, host }))
        .finally(() => { this.logins.delete(host); });
      this.logins.set(host, pending);
    }
    await this.logins.get(host);
    response = await this.fetchFollow(url);
    wanted = NoticeSource.serviceOf(response.url);
    if (wanted !== null) {
      await this.acquireServiceLogin({ service: wanted, host });
      response = await this.fetchFollow(url);
      if (NoticeSource.serviceOf(response.url) !== null) {
        throw new NoticeError('AUTH_REQUIRED', `${host} 完成统一身份认证后仍要求登录`, { url: String(url) });
      }
    }
    return response;
  }

  /** 教务网列表请求：`(url, form) => Promise<object>`。 */
  async postJson(url, form) {
    const response = await this.send(url, {
      method: 'POST',
      form,
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' },
    });
    const status = Number(response?.status ?? 0);
    if (status === 401 || status === 901 || status === 902) {
      throw new NoticeError('AUTH_REQUIRED', '教务网会话已失效：到「设置 → 浙大一卡通」重新登录', { url, status });
    }
    if (status !== 200) throw new NoticeError('HTTP', `教务网 HTTP ${status}`, { url, status });
    const body = String(response?.text ?? '').trim();
    if (!body.startsWith('{') && !body.startsWith('[')) {
      // 正方在会话过期时不一定回 3xx：有时直接回 200 + 登录页 HTML。
      throw new NoticeError('AUTH_REQUIRED', '教务网返回的不是 JSON（多半是登录页）：到「设置 → 浙大一卡通」重新登录', { url });
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      throw new NoticeError('SHAPE', '教务网返回的 JSON 无法解析（站点可能改版）', { url });
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new NoticeError('SHAPE', '教务网返回的 JSON 形状不对（站点可能改版）', { url });
    }
    return data;
  }

  /**
   * 取一条通知的正文。
   *
   * 分派顺序（每一步都有依据，不是择一尝试）：
   *
   * 1. **竞赛管理系统**：链接是 `kyjs.zju.edu.cn` + `newsId`（外链正文，不在 HTML 里）；
   * 2. **教务网**：来源是 `zdbk`，或链接主机就是教务网；
   * 3. **纯附件**：链接指向 pdf/doc/zip 或下载接口；
   * 4. **校内内网地址**：`10.x` / `127.x` / `192.168.x` / `172.16-31.x`，WebVPN 只代理
   *    声明的域名，读不到 —— 直接说读不到，不去等超时；
   * 5. 其余按通用 HTML 正文解析。
   *
   * @param notice - 列表条目。
   * @returns 正文记录。
   */
  async detailOf(notice) {
    const target = notice.externalUrl ?? notice.url;
    const kyjs = await kyjsNotice((url) => this.get(url), target, this.unwrapUrl);
    if (kyjs !== undefined) {
      return {
        ...kyjs,
        publisher: kyjs.publisher || notice.publisher,
        publishedAt: kyjs.publishedAt || notice.date,
      };
    }
    if (notice.sourceId === 'zdbk' || new URL(target).hostname === ZDBK_HOST) {
      return this.zdbkDetail(notice);
    }
    if (isAttachment(target)) return attachmentDetail(notice.id, target, notice.title || undefined);
    if (isInternalAddress(target)) {
      throw new NoticeError('UNREADABLE', '链接指向校内内网地址，读不到正文', { url: target });
    }
    const response = await this.get(target);
    const detail = parseArticle(notice.id, response.text, this.unwrapUrl(response.url), this.unwrapUrl);
    return {
      ...detail,
      publisher: detail.origin || notice.publisher || detail.publisher,
      publishedAt: detail.publishedAt || notice.date,
    };
  }

  /**
   * 教务网通知正文，或它指向的外站页面。
   *
   * @param notice - 列表条目（`id` 可为空，表示只有链接）。
   * @returns 正文记录。
   */
  async zdbkDetail(notice) {
    const memo = this.details.get(notice.id);
    if (memo !== undefined) return memo;
    const target = notice.externalUrl ?? notice.url;
    if (isAttachment(target)) return attachmentDetail(notice.id, target, notice.title || undefined);
    let response = await this.get(target);
    // 网站群有时把校外的访问挡到「无权访问」页：它带 parentUrl，按它重取一次。
    const denied = new URL(response.url);
    const parent = denied.searchParams.get('parentUrl');
    if (denied.hostname.endsWith('.zju.edu.cn') && denied.pathname === '/nopermit_zjusub.jsp' && parent) {
      const wanted = new URL(parent);
      if (/^https?:$/.test(wanted.protocol) && wanted.hostname === denied.hostname && wanted.pathname !== denied.pathname) {
        response = await this.get(wanted.href);
      }
    }
    const detail = parseArticle(notice.id, response.text, this.unwrapUrl(response.url), this.unwrapUrl);
    // 一部分院系通知的详情页直接跳到学院官网。
    const final = new URL(this.unwrapUrl(response.url));
    if (final.hostname !== ZDBK_HOST || final.pathname !== '/jwglxt/xtgl/xwgl_ckXw.html') {
      detail.external = true;
      detail.externalUrl = final.href;
    }
    if (notice.id) this.details.set(notice.id, detail);
    return detail;
  }

  /** 来源表里每个来源要跑的任务。 */
  static tasksOf(picks) {
    return picks.flatMap(({ source, columns }) => (source.adapter === 'zdbk'
      ? [{
        key: source.id,
        label: source.name,
        run: (query) => ({ adapter: 'zdbk', categories: columns.map((column) => column.id), query }),
      }]
      // 学院的栏目可能分布在主站和办公网，栏目号会重复，键里带上站点。
      : columns.map((column) => ({
        key: [source.id, ...(column.base ? [new URL(column.base).host + new URL(column.base).pathname.replace(/\/$/, '')] : []), column.id].join('/'),
        label: `${source.name}·${column.name}`,
        run: (query) => ({ adapter: 'webplus', source, column, query }),
      }))));
  }

  /**
   * 跑一组任务。一个任务失败不影响其它任务，但**失败会被记下来**（`sourceErrors` / `drift`）。
   *
   * @param tasks - 任务数组。
   * @param query - 查询条件，或 `(task) => 查询条件`（增量扫描要按任务算起始日期）。
   * @returns `{ ok, failed }`。
   */
  async gather(tasks, query) {
    const queryFor = typeof query === 'function' ? query : () => query;
    const results = await mapLimit(tasks, TASK_CONCURRENCY, async (task) => {
      try {
        const spec = task.run(queryFor(task));
        if (spec.adapter === 'zdbk') {
          return {
            task,
            ...(await listZdbk({
              post: (url, form) => this.postJson(url, form),
              categories: spec.categories,
              query: spec.query,
              fetchDetail: (notice) => this.zdbkDetail(notice),
              cache: this.titleCache,
            })),
          };
        }
        return {
          task,
          ...(await listColumn({
            get: (url) => this.get(url),
            source: spec.source,
            column: spec.column,
            query: spec.query,
            unwrapUrl: this.unwrapUrl,
            now: this.now(),
          })),
        };
      } catch (error) {
        return { task, error };
      }
    });
    const ok = results.filter((result) => !('error' in result));
    const failed = results.filter((result) => 'error' in result);
    return {
      ok,
      failed: failed.map((result) => ({
        source: result.task.label,
        code: result.error?.code ?? 'FAILED',
        error: String(result.error?.message ?? result.error),
      })),
    };
  }

  /**
   * 给一批通知补正文（限并发）。
   *
   * @param notices - 列表条目。
   * @returns 带 `detail` 或 `error` 的条目。
   */
  async withDetails(notices) {
    return mapLimit(notices, DETAIL_CONCURRENCY, async (notice) => {
      try {
        const detail = await this.detailOf(notice);
        const title = detail.contentStatus === 'unavailable' ? notice.title || detail.title : detail.title;
        return {
          ...notice,
          title,
          detail,
          ...(detail.contentStatus === 'unavailable' ? { error: `详情页面未提供可读取正文：${detail.title}` } : {}),
        };
      } catch (error) {
        return { ...notice, error: String(error?.message ?? error), errorCode: error?.code ?? 'FAILED' };
      }
    });
  }

  /**
   * 通知列表：合并、去重、补正文（内部形状，带 `detail`）。
   *
   * `list()` 与 `byTitle()` 共用它 —— 前者把结果压成扁平视图，后者要在**原始形状**上
   * 比对标题。早先 `byTitle` 直接调 `list()`，于是它拿到的每一条都没有 `detail`
   * （视图层已经压掉了），「按标题取全文」永远报「正文获取失败」。
   *
   * @param input - 同 `list()`。
   * @returns `{ collected, merged, ok, failed, query, chosen }`。
   */
  async collect(input = {}) {
    const query = listQuery(input);
    const chosen = selectSources(input.source, input.profile, { scope: 'default' });
    const { ok, failed } = await this.gather(NoticeSource.tasksOf(chosen.picks), query);
    const merged = mergeNotices(ok.map((result) => result.notices)).notices;
    const collected = await this.withDetails(merged.slice(0, query.limit));
    return { collected, merged, ok, failed, query, chosen };
  }

  /**
   * 通知列表：合并、去重、补正文。
   *
   * @param input - `{ keyword?, source?, since?, until?, limit?, profile? }`。
   * @returns 结果对象。
   * @throws {NoticeError} 参数不合法（`CONFIG`）。
   */
  async list(input = {}) {
    const { collected, merged, ok, failed, query, chosen } = await this.collect(input);
    const shallow = ok.filter((result) => result.scannedTo !== undefined)
      .map((result) => ({ source: result.task.label, scannedTo: result.scannedTo }));
    const unread = collected.filter((notice) => Boolean(notice.error) || notice.detail?.contentStatus === 'unavailable'
      || notice.detail?.contentStatus === 'summary-only').length;
    const incomplete = unread + failed.length;
    // 结构漂移：某个栏目**说了有条目却一条也没解析出来**。它已经作为一次失败出现在
    // sourceErrors 里（不会被静默吞掉），这里再单列一遍，因为它的语义与「网络失败」不同：
    // 网络失败是「这次没读到」，漂移是「站点改版了，你以为没通知其实是解析不出来」。
    const drift = failed.filter((entry) => entry.code === 'DRIFT')
      .map((entry) => ({ source: entry.source, reason: entry.error }));
    return {
      notices: collected.map(noticeView),
      count: collected.length,
      hasMore: merged.length > query.limit || ok.some((result) => result.hasMore),
      status: incomplete > 0 ? 'partial' : 'complete',
      incomplete,
      filters: {
        sources: describePicks(chosen),
        ...(input.keyword ? { keyword: input.keyword } : {}),
        ...(query.terms.length > 1 ? { searchedKeywords: query.terms } : {}),
        ...(query.since ? { since: query.since } : {}),
        ...(query.until ? { until: query.until } : {}),
        limit: query.limit,
      },
      ...profileOf(chosen.who),
      ...(failed.length ? { sourceErrors: failed.map(({ source, code, error }) => ({ source, code, error })) } : {}),
      ...(shallow.length ? { searchedBackTo: shallow } : {}),
      ...(drift.length ? { drift } : {}),
      note: LIST_NOTE + (drift.length ? 'drift 里的栏目**页面说有内容但一条也没解析出来**，通常是站点改版 —— 那里的「没有通知」不是真的没有。' : ''),
    };
  }

  /**
   * 按链接（可多个）或标题取通知全文。
   *
   * @param input - `{ title?, url?, profile? }`，二者择一。
   * @returns 结果对象。
   * @throws {NoticeError} 参数冲突（`CONFIG`）、找不到或不唯一（`NEEDS_USER`）、
   *   正文取不到（`SHAPE`）。
   */
  async view(input = {}) {
    const hasTitle = Boolean(input.title);
    const hasUrl = Boolean(input.url);
    if (hasTitle === hasUrl) throw new NoticeError('CONFIG', '请提供通知标题或链接其中一种');
    const notices = hasUrl ? await this.byUrl(input.url) : await this.byTitle(input.title);
    const unread = notices.filter((notice) => Boolean(notice.error)
      || notice.detail?.contentStatus === 'unavailable'
      || notice.detail?.contentStatus === 'summary-only').length;
    return {
      notices: notices.map(noticeView),
      count: notices.length,
      status: unread > 0 ? 'partial' : 'complete',
      ...(unread ? { incomplete: unread } : {}),
    };
  }

  /** 按链接取正文。 */
  async byUrl(raw) {
    const links = String(raw ?? '').split(/[|｜\n]+/).map((link) => link.trim()).filter(Boolean);
    if (links.length === 0) throw new NoticeError('CONFIG', '需要通知链接');
    const stubs = links.map((link) => {
      let url;
      try {
        url = new URL(link);
      } catch {
        throw new NoticeError('CONFIG', `通知链接不是有效 URL：${link}`, { link });
      }
      if (!/^https?:$/.test(url.protocol)) throw new NoticeError('CONFIG', '通知链接必须是 HTTP(S)', { link });
      const from = sourceOf(url);
      return {
        id: url.hostname === ZDBK_HOST ? url.searchParams.get('xwbh') ?? '' : articleId(url.href),
        title: '',
        titleTruncated: false,
        publisher: from.source !== undefined && from.source.id !== 'zdbk' ? from.source.name : '',
        date: '',
        source: from.label,
        sourceId: url.hostname === ZDBK_HOST ? 'zdbk' : from.source?.id ?? '',
        pinned: false,
        url: url.href,
      };
    });
    return this.withDetails(stubs);
  }

  /** 按标题找，唯一命中才给正文。 */
  async byTitle(title) {
    // 服务端按标题子串检索，带书名号、括号的完整长标题常搜不到：
    // 先试原标题，再试其中最长的两段连续文字，本地再按标题比对。
    const wanted = titleKey(title);
    const pieces = String(title ?? '')
      .split(/[\s“”"'‘’（）()《》〈〉【】[\]—\-－_:：,，、。.·|｜]+/)
      .filter((piece) => piece.length >= 4)
      .sort((a, b) => b.length - a.length);
    let found = [];
    let seenAny = [];
    let more = false;
    for (const keyword of [...new Set([String(title), ...pieces.slice(0, 2)])]) {
      // ⚠️ 必须用 `collect()`（原始形状，带 `detail`）而不是 `list()`：
      // `list()` 把结果压成扁平视图，`detail` 已经不在了。
      const { collected } = await this.collect({ keyword, limit: 20, profile: this.profile });
      const titles = new Map(collected.map((notice) => [notice, titleKey(notice.title)]));
      const same = collected.filter((notice) => titles.get(notice) === wanted);
      found = same.length > 0
        ? same
        : collected.filter((notice) => titles.get(notice).includes(wanted)
          || (wanted.length >= 8 && wanted.includes(titles.get(notice))));
      seenAny = collected;
      more = same.length === 0 && collected.length >= 20;
      if (found.length > 0) break;
    }
    if (found.length !== 1 || more) {
      const candidates = found.length > 0 ? found : seenAny;
      throw new NoticeError(
        'NEEDS_USER',
        candidates.length > 0 ? '有多条匹配通知，请明确标题或链接' : '未找到匹配通知',
        {
          candidates: candidates.map((notice) => ({
            title: notice.title,
            date: notice.date,
            source: notice.source,
            url: notice.externalUrl ?? notice.url,
          })),
        },
      );
    }
    // 拿不到正文就明确报错，不返回一条空壳。
    const [single] = found;
    if (single.detail === undefined) {
      throw new NoticeError('SHAPE', single.error ?? '通知正文获取失败', { title: String(title) });
    }
    return [single];
  }

  /** 增量扫描的起始日期：上次检查再往前重叠几天（补发、改期的通知），最多回看 `MAX_DAYS` 天。 */
  sinceOf(state, task, now) {
    const previous = state.sources?.[task.key];
    const from = previous
      ? beijingDay(-OVERLAP_DAYS, Date.parse(previous.checkedAt))
      : beijingDay(-FIRST_DAYS, now);
    const floor = beijingDay(-MAX_DAYS, now);
    return from > floor ? from : floor;
  }

  /**
   * 上次查看之后新发布的通知（增量）。**不写盘**：`seen` 交回调用方持久化。
   *
   * @param input - `{ seen?, source?, profile?, reset? }`。
   * @returns `{ notices, count, seen, ... }`。
   */
  async new(input = {}) {
    const state = input.reset === true ? { sources: {} } : (input.seen ?? { sources: {} });
    const chosen = selectSources(input.source, input.profile, { scope: 'feed' });
    const tasks = NoticeSource.tasksOf(chosen.picks);
    const now = this.now();
    const nowIso = new Date(now).toISOString();
    const { ok, failed } = await this.gather(tasks, (task) => ({
      terms: [],
      since: this.sinceOf(state, task, now),
      limit: 1000,
    }));
    const fresh = ok.map((result) => result.notices
      .filter((notice) => state.sources?.[result.task.key]?.seen?.[notice.id] === undefined));
    const merged = mergeNotices(fresh);
    const shown = merged.notices.slice(0, PAGE);
    // 没列出来的留到下次：它们和并到它们名下的重复条目都不记为已读。
    const held = new Set(merged.notices.slice(PAGE).flatMap((notice) => [notice, ...(merged.dropped.get(notice) ?? [])]));
    const zdbk = shown.some((notice) => notice.sourceId === 'zdbk' && notice.titleTruncated)
      ? await withFullTitles(
        shown.filter((notice) => notice.sourceId === 'zdbk'),
        { fetchDetail: (notice) => this.zdbkDetail(notice), cache: this.titleCache },
      )
      : [];
    const titles = new Map(zdbk.map((notice) => [notice.id, notice.title]));
    const horizon = beijingDay(-KEEP_DAYS, now);
    const checked = ok.map((result) => state.sources?.[result.task.key]?.checkedAt)
      .filter((value) => Boolean(value)).sort();
    const nextSeen = { sources: { ...(state.sources ?? {}) } };
    for (const result of ok) {
      // 已读记录只留最近 KEEP_DAYS 天，免得无限长大。
      const seen = Object.fromEntries(Object.entries(state.sources?.[result.task.key]?.seen ?? {})
        .filter(([, date]) => String(date) >= horizon));
      for (const notice of result.notices) if (!held.has(notice)) seen[notice.id] = notice.date.slice(0, 10);
      nextSeen.sources[result.task.key] = { checkedAt: nowIso, seen };
    }
    const remaining = merged.notices.length - shown.length;
    return {
      notices: shown.map((notice) => ({
        title: titles.get(notice.id) ?? notice.title,
        date: notice.date.slice(0, 10),
        source: notice.source,
        url: notice.externalUrl ?? notice.url,
      })),
      count: shown.length,
      seen: nextSeen,
      ...(held.size > 0 ? { remaining } : {}),
      ...(checked.length > 0 ? { lastChecked: beijingMinute(checked[0]) } : {}),
      status: failed.length > 0 ? 'partial' : 'complete',
      sources: describePicks(chosen),
      ...profileOf(chosen.who),
      ...(failed.length ? { sourceErrors: failed } : {}),
      note: (checked.length > 0 ? '上次查看之后新发布的通知' : `第一次查看，给出最近 ${FIRST_DAYS} 天的通知`)
        + '，只有标题；要看全文，把相关条目的 url 用竖线连起来交给 view。'
        + (held.size > 0 ? `还有 ${remaining} 条更早的没有列出，再调用一次继续。` : '')
        + (failed.length > 0 ? 'sourceErrors 里的来源本次没有读到，下次会补上。' : ''),
    };
  }

  /**
   * 已接入的来源、栏目与学院名录。**不联网。**
   *
   * @param input - `{ profile?, seen? }`。
   * @returns 来源清单。
   */
  sources(input = {}) {
    const who = normalizeProfile(input.profile);
    const fit = fits(who.level);
    const found = who.college === null ? [] : findCollege(who.college);
    const myCollege = found.length === 1 ? found[0] : null;
    const catalog = catalogInfo();
    const names = (source, flag) => source.columns.filter(flag).map((column) => column.name);
    const only = (source) => (source.columns.every((column) => column.audience === 'undergrad') ? { only: '本科生' }
      : source.columns.every((column) => column.audience === 'grad') ? { only: '研究生' } : {});
    const checked = Object.values(input.seen?.sources ?? {})
      .map((entry) => entry?.checkedAt).filter(Boolean).sort();
    return {
      ...profileOf({ ...who, college: myCollege }),
      sources: SOURCES.map((source) => ({
        name: source.name,
        site: source.base,
        network: networkOf(source.base),
        ...only(source),
        columns: names(source, () => true),
        default: names(source, (column) => column.default === true && fit(column)),
        new: names(source, (column) => column.feed === true && fit(column)),
      })),
      ...(myCollege === null ? {} : {
        myCollege: {
          name: myCollege.name,
          site: myCollege.base,
          network: networkOf(myCollege.base),
          columns: names(myCollege, fit),
        },
      }),
      colleges: catalog.colleges,
      collegesNotReadable: catalog.unsupported,
      ...(checked.length > 0 ? { lastChecked: beijingMinute(checked[0]) } : {}),
      note: 'default 的栏目是 list 不指名来源时读的，new 的栏目是增量扫描读的，都已按 profile 里的'
        + '本科生或研究生取；本人学院（myCollege）的栏目两者都读。'
        + '其余栏目用 source 写来源名或栏目名才读；colleges 里的其他学院用 source 写学院名。'
        + 'network 是这个网站从校外能不能直接访问：public 的直连，campus 的经 WebVPN，这里自己处理。',
    };
  }

  /** 使用者信息：本包不自带「我是谁」，由调用方设置。 */
  get profile() {
    return this._profile ?? {};
  }

  /**
   * 设置使用者（`{ level, college }`）。`college` 写学院**全称**。
   *
   * @param profile - 使用者信息。
   */
  setProfile(profile) {
    this._profile = normalizeProfile(profile);
  }
}

/** 列表结果的固定说明。 */
const LIST_NOTE = '按发布时间由新到旧；同一条通知在几个来源都有时只留一条。keyword 检索标题（推免、大创同时按免试、创新训练检索），'
  + '正文不截断。attachment-only 的正文在附件中，summary-only 仅有摘要，都不能当作全文。'
  + 'sourceErrors 里的来源本次没有读到；searchedBackTo 里的来源只往回找到所列日期。';

/**
 * 一条通知的扁平视图。
 *
 * 每条一个扁平记录：详情与列表的重复字段只保留一份，附件不再在 `links` 里重复
 * （嵌套结果过长时会被截断，调用方就得重查）。
 *
 * @param notice - 补过正文的条目。
 * @returns 对外记录。
 */
export function noticeView(notice) {
  const detail = notice.detail;
  const links = (detail?.links ?? []).filter((link) => !link.attachment).map(({ url, text }) => ({ url, text }));
  // 按链接取的条目没有列表日期：用正文页的发布时间，再不行用网站群文章地址里的日期。
  const fromUrl = String(notice.url ?? '').match(/\/(\d{4})\/(\d{2})(\d{2})\/c\w+a\d+\//);
  return {
    title: notice.title,
    date: notice.date || detail?.publishedAt?.slice(0, 10) || (fromUrl ? `${fromUrl[1]}-${fromUrl[2]}-${fromUrl[3]}` : ''),
    ...(notice.source ? { source: notice.source } : {}),
    publisher: detail?.publisher || notice.publisher,
    url: notice.externalUrl ?? detail?.externalUrl ?? notice.url,
    ...(notice.pinned ? { pinned: true } : {}),
    ...(detail ? { contentStatus: detail.contentStatus, text: detail.text, attachments: detail.attachments } : {}),
    ...(links.length > 0 ? { links } : {}),
    ...(notice.error ? { error: notice.error } : {}),
  };
}

/**
 * 一个链接属于哪个已接来源；栏目号对得上时带栏目名。
 *
 * @param url - 链接。
 * @returns `{ label, source? }`。
 */
export function sourceOf(url) {
  if (url.hostname === ZDBK_HOST) return { label: '教务网', source: SOURCES.find((source) => source.id === 'zdbk') };
  const source = [...SOURCES, ...collegeSources()].find((candidate) => [candidate.base, ...candidate.columns.map((column) => column.base ?? candidate.base)]
    .some((base) => {
      try {
        return new URL(base).hostname === url.hostname;
      } catch {
        return false;
      }
    }));
  if (source === undefined) return { label: '' };
  const column = source.columns.find((entry) => url.pathname.includes(`/c${entry.id}a`));
  return { label: column ? `${source.name}·${column.name}` : source.name, source };
}

/** 从一个地址里取主机名；地址坏了就原样返回（错误文案里不能因此崩掉）。 */
function safeHost(url) {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return String(url);
  }
}

/**
 * 这个主机是不是校内内网地址。
 *
 * 综合服务网个别条目指向 `10.x` 的内网系统，WebVPN 只代理声明的域名 —— 读不到，
 * 直接说读不到，不去等一次必然的超时。
 *
 * ⚠️ 上游那条正则 `/^(?:10|127|192.168|172.(?:1[6-9]|2d|3[01]))./` 有两个字面缺陷：
 * 点是未转义的（`192x168` 也会命中）、`2d` 是从 `2[0-9]` 打错的（于是
 * `172.20`–`172.29` 全漏）。这里按 RFC 1918 的**正确三段**实现，并保留「`10.` 开头
 * 一律算内网」这条更宽的判断（与上游的实际效果一致）。
 *
 * @param url - 地址。
 * @returns 是否内网地址。
 */
export function isInternalAddress(url) {
  let host;
  try {
    host = new URL(String(url)).hostname;
  } catch {
    return false;
  }
  if (/^10\./.test(host) || /^127\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}
