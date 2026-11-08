// 「文档」页的纯函数层：把一份 markdown 变成**可导航的结构**。
//
// 这一层刻意不碰 DOM、不 import React、不 import 宿主渲染器 —— 所以 `tests/docs-page.test.mjs`
// 能在裸 Node 里直接跑它。页面上那些"点目录滚到某一段"的行为，全靠这里算出来的序号。
//
// # 为什么是「按序号」而不是「按锚点」
//
// 两个硬约束叠在一起，把锚点方案否掉了：
//
//   1. 宿主的 `MarkdownText` 渲染标题时**不写 id**（见宿主 lib/index.js:11304：
//      `createElement(\`h${node.depth}\`, { key }, …)`，只有一个内部的 `key`）。
//      也就是说我们无法给标题挂锚点。
//   2. 宿主的链接 allowlist 会拒掉 `#foo` 这种纯 fragment —— 它按"安全协议"判定，
//      fragment 不在名单里，`[跳过去](#foo)` 会被降级成**纯文本**，连 `a` 都不生成。
//
// 于是"点目录跳转"只剩一条路：自己按同样的规则（h2/h3、顺序一致）算出标题序列，
// 点击第 i 项就去正文里取 `querySelectorAll('h2, h3')[i]` 滚动过去。序号对不齐就跳错地方，
// 所以下面那条扫描规则必须和渲染器的行为一致 —— 这是整页最脆的一处，`docs-page.test.mjs`
// 里专门钉了围栏代码块的用例。

/** 只取这两级做页内目录。h1 是页面标题（由页面本身画），h4 往下太碎。 */
export const OUTLINE_DEPTHS = Object.freeze([2, 3]);

/**
 * 去掉行内的 markdown 记号，留下能当目录文字用的纯文本。
 *
 * 只处理标题里真正会出现的几种：加粗/斜体、行内代码、链接、删除线。
 * 表格与图片不会出现在标题里，不处理。
 */
export function plainHeading(text) {
  return String(text)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .trim();
}

/**
 * 扫出一份 markdown 的标题序列。
 *
 * # 为什么要自己扫，而不是用宿主的 `parseGfm`
 *
 * `@deepseek-ai/dsh-client-ui-primitives` 的入口只导出 6 个符号（`MarkdownText`、
 * `CodeBlock`、`JsonBlock`、`MarkdownDelegateProvider`、`extractMarkdownPlainText` 与类型），
 * **`parseGfm` / `parseGfmWithMath` 没有出现在 barrel 里** —— 它们只在宿主内部用。
 * 从包内路径 import 会绕开导出表，属于依赖未承诺的实现细节，所以宁可自己扫。
 *
 * # 必须跳过代码围栏
 *
 * ``` 围栏里的 `## 这不是标题` 会被渲染成代码块里的一行字，不是 `<h2>`。
 * 若扫描器把它算进目录，序号就整体错位一格，之后每一条跳转都落到上一段/下一段。
 *
 * @param markdown - 原始 markdown（可含 BOM、CRLF）。
 * @param depths - 要收集的标题级别；默认 h2/h3。
 * @returns 按正文顺序排列的 `{ depth, text }`。
 */
export function scanHeadings(markdown, depths = OUTLINE_DEPTHS) {
  const wanted = new Set(depths);
  const headings = [];
  if (typeof markdown !== 'string') return headings;

  let fence = null; // 当前所在的围栏：'```' 或 '~~~'，含长度
  for (const raw of markdown.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw;

    // 围栏开合。注意缩进列表里的围栏（`   ```）也要认，所以允许前导空白。
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence === null) {
      if (fenceMatch !== null) {
        // ``` 后面紧跟语言名是"开"；但四个反引号里如果不是纯语言名也无所谓 —— 开就是开。
        fence = fenceMatch[1];
        continue;
      }
    } else {
      // 关围栏：同字符、长度不小于开围栏、且后面没有别的内容。
      if (fenceMatch !== null && fenceMatch[1][0] === fence[0]
        && fenceMatch[1].length >= fence.length && fenceMatch[2].trim() === '') {
        fence = null;
      }
      continue;
    }

    // ATX 标题：最多 3 个前导空格，1–6 个 #，后接空格或行尾。
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(line);
    if (atx === null) continue;
    const depth = atx[1].length;
    if (!wanted.has(depth)) continue;
    // 结尾的一串 # 是装饰（`## 标题 ##`），去掉。
    const text = plainHeading((atx[2] ?? '').replace(/[ \t]+#+[ \t]*$/, ''));
    // 空标题不参与：它没有可读的文字，列进目录只会留一行空白。
    if (text === '') continue;
    headings.push({ depth, text });
  }
  return headings;
}

/**
 * 去掉正文开头的那一级标题。
 *
 * # 为什么 md 文件里仍然写 `# 标题`
 *
 * 一是这些文件要能单独用编辑器打开、也被人直接读；二是"复制 Markdown"丢出去的东西
 * 应该自带标题。页面自己画标题栏（标题 + 一句摘要），所以渲染前把开头那个 h1 摘掉，
 * 否则同一屏会出现两遍同样的字。
 *
 * 只摘**开头第一个**非空行的 h1；正文中间出现的 h1 原样保留（那是作者的分节意图）。
 */
export function stripHeading1(markdown) {
  if (typeof markdown !== 'string') return '';
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && /^ {0,3}#[ \t]+/.test(lines[i])) {
    i++;
    // 连带吃掉标题后紧跟的空行，免得正文顶部多出一段空气。
    while (i < lines.length && lines[i].trim() === '') i++;
  }
  return lines.slice(i).join('\n').replace(/\s+$/, '');
}

/**
 * 把「分区 → 页」的清单摊平成一维顺序，并给每页标上所属分区。
 *
 * 页自己的字段（`summary`、`file`）原样带上 —— 摊平只是加 `section*` 与 `index`，
 * 不该顺手丢掉别的字段。曾经这里只挑 `id`/`title` 三个字段重建对象，结果页面上的
 * 摘要全是空白、测试里按 `file` 读文档也全部拿到 undefined。
 *
 * @param sections - `[{ id, label, pages: [{ id, title, summary?, file? }] }]`
 * @returns `[{ ...page, sectionId, sectionLabel, index }]`
 */
export function flattenPages(sections) {
  const out = [];
  for (const section of sections) {
    for (const page of section.pages) {
      out.push({
        ...page,
        sectionId: section.id,
        sectionLabel: section.label,
        index: out.length,
      });
    }
  }
  return out;
}

/**
 * 当前页的上一篇 / 下一篇。
 *
 * 翻页是**跨分区**连着走的（与真实文档站一致）：读到「协作」最后一篇的下一篇就是
 * 「参考」第一篇，而不是停在本分区末尾。这样"从头读到尾"是一条连续的路。
 *
 * @param flat - `flattenPages` 的结果。
 * @param id - 当前页 id。
 * @returns `{ prev, next, index }`；`prev`/`next` 在首/末页为 null，`index` 找不到时为 -1。
 */
export function neighbors(flat, id) {
  const index = flat.findIndex(page => page.id === id);
  if (index < 0) return { prev: null, next: null, index: -1 };
  return {
    prev: index > 0 ? flat[index - 1] : null,
    next: index < flat.length - 1 ? flat[index + 1] : null,
    index,
  };
}

/**
 * 在目录里按关键词过滤页面。
 *
 * 匹配 label 与 summary：文档页的标题往往很短（「测试与验证」），真正区分它们的是
 * 那句摘要，只按标题搜会把一半的结果漏掉。
 *
 * @param query - 关键词；空串返回全部。
 * @param flat - `flattenPages` 的结果（可带 `summary`）。
 * @returns 命中的页。
 */
export function filterPages(query, flat) {
  const keyword = String(query ?? '').trim().toLocaleLowerCase();
  if (keyword === '') return flat;
  return flat.filter(page => `${page.title} ${page.summary ?? ''}`.toLocaleLowerCase().includes(keyword));
}
