/**
 * Obsidian 式笔记的**链接与标签解析**（纯逻辑：零 IO / 零 UI）。
 *
 * # 为什么单独一个包，而不塞进 `dsh-zhiyun-notes`
 *
 * `dsh-zhiyun-notes` 是**每节一份**的课程笔记（键是 `课程/节次`，链接是
 * `zy://section/...` 这种"跳回播放位置"的内链）。那是「课程笔记」的模型：
 * 笔记从属于一节课，没有"笔记之间互相引用"这回事。
 *
 * 本包是另一套模型 —— **库（vault）**：一堆平级的笔记，靠双向链接连成网络。
 * 两者不是替代关系：同一段正文可以既带 `zy://section` 内链（跳回课程），
 * 又带 `[[另一篇笔记]]`（连到知识网）。所以做成两个包，互不 import。
 *
 * # 语法按 Obsidian 的真实语义实现（这是本包的价值所在）
 *
 * 朴素的 `\[\[(.+?)\]\]` 正则会错在这些地方，而它们恰好是用户天天用的：
 *
 * | 语法 | 含义 | 朴素正则的错法 |
 * |---|---|---|
 * | `[[笔记\|别名]]` | 显示别名，链接到「笔记」 | 把 `笔记\|别名` 整体当成目标，解析不到 |
 * | `[[笔记#小节]]` | 指向某篇的某个标题 | 同上，目标里混进 `#小节` |
 * | `[[笔记#^abc123]]` | 指向某个块 | 同上 |
 * | `[[#小节]]` | **本文内**跳转（空目标是合法的） | 把空目标当错误丢掉 |
 * | `![[图片.png]]` | 嵌入（不是引用） | 当成普通链接，图谱里多一堆伪节点 |
 * | `#标签` | 行内标签 | 把 Markdown 标题 `# 标题` 也当成标签 |
 * | URL 里的 `#` | `https://x.com/a#b` | 从锚点里切出一个假标签 |
 * | 代码块里的 `[[x]]` | 只是示例文本 | 抽出假链接，图谱被污染 |
 *
 * 这些正是"看起来能用、越用越脏"的地方，所以本文件按语义写、并逐条钉测试。
 *
 * # 与 Obsidian 的两处刻意不同
 *
 * 1. **不做块引用 `^blockid` 的生成**：那是编辑器书签功能，属于 UI 层。
 *    本层只**解析**已有的 `#^id` 指向。
 * 2. **不自动改文件名**：Obsidian 重命名时全库改链接。那需要写盘，
 *    而本包零 IO（落盘交给宿主存储栈，与本仓其他包一致）。
 *    本层只提供 `renameLinks()` 这个**纯函数**，由调用方决定何时落盘。
 */

/** 行内链接：`[[目标]]`、`[[目标|别名]]`、`[[目标#小节]]`、`[[目标#^块]]`。 */
const WIKILINK_RE = /(!?)\[\[([^\]\n]*?)\]\]/g;

/**
 * 代码围栏 / 行内代码 / 行内数学：这些区域里的一切都不参与解析。
 *
 * 为什么必须排除：笔记里写「用 `[[双链]]` 这样写」是**极常见**的说明文字，
 * 把它当真实链接会让图谱里冒出一堆不存在的节点；代码块里贴的 JSON/YAML
 * 更是重灾区。Obsidian 自己也是这么做的。
 */
const CODE_FENCE_RE = /(^|\n)(```|~~~)[^\n]*\n[\s\S]*?(?:\n\2[^\n]*|$)/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const INLINE_MATH_RE = /\$[^$\n]*\$/g;

/** Markdown 标题行：`# 标题` —— 它不是标签，要在抽标签前排除。 */
const ATX_HEADING_RE = /^ {0,3}#{1,6}(?:\s|$)/;

/**
 * URL：`http(s)://…` 或 `www.…`。行内标签必须避开它们，
 * 否则 `https://example.com/page#section` 会切出一个假的 `#section`。
 */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]]+/gi;

/** 行内标签：`#标签`，支持 `#父/子` 嵌套与中文、连字符、下划线。 */
const TAG_RE = /(^|[\s(【（「,，、;；:：!！?？"'“”‘’])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu;

/**
 * 把正文里"不该被解析"的区间挖出来（代码块 / 行内代码 / 行内数学 / URL）。
 *
 * 返回**保留位置信息**的区间表，而不是先把正文替换成占位符再解析：
 * 替换会改变长度，之后算出的 `start`/`end` 就不再对应原文，
 * 而那些下标是要用来在编辑器里定位/高亮的 —— 错位会让跳转跳到别处。
 */
export function excludedRanges(markdown) {
  const ranges = [];
  const push = (re) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(markdown)) !== null) {
      ranges.push([m.index, m.index + m[0].length]);
      // 零宽匹配保护：某些正则在特定输入下可能不前进，会死循环。
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  };
  push(new RegExp(CODE_FENCE_RE.source, 'gm'));
  push(new RegExp(INLINE_CODE_RE.source, 'g'));
  push(new RegExp(INLINE_MATH_RE.source, 'g'));
  push(new RegExp(URL_RE.source, 'gi'));
  return mergeRanges(ranges);
}

function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1]) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push(sorted[i]);
  }
  return out;
}

const inRanges = (ranges, index) => ranges.some(([s, e]) => index >= s && index < e);

/**
 * 拆解一个 `[[…]]` 的**内部**文本。
 *
 * 语法：`目标#锚点|别名`，其中目标可以为空（`[[#小节]]` = 本文内跳转）。
 * 别名里允许出现 `|`（取第一个分隔符），锚点里允许出现 `|`（`#` 先切）。
 *
 * @returns {{target: string, heading: string|null, blockId: string|null, alias: string|null}}
 */
export function splitWikilink(inner) {
  const raw = String(inner ?? '');
  // 先按第一个 `|` 切别名：`[[a#b|c]]` 里 `|` 之后全是别名。
  const pipe = raw.indexOf('|');
  const beforeAlias = pipe === -1 ? raw : raw.slice(0, pipe);
  const alias = pipe === -1 ? null : raw.slice(pipe + 1);

  // 再按第一个 `#` 切锚点：`[[a#b]]` 里 `a` 是目标、`b` 是标题。
  const hash = beforeAlias.indexOf('#');
  const target = (hash === -1 ? beforeAlias : beforeAlias.slice(0, hash)).trim();
  const anchor = hash === -1 ? null : beforeAlias.slice(hash + 1).trim();

  let heading = null;
  let blockId = null;
  if (anchor) {
    if (anchor.startsWith('^')) blockId = anchor.slice(1).trim();
    else heading = anchor;
  }
  return {
    target,
    heading: heading || null,
    blockId: blockId || null,
    alias: alias === null ? null : alias.trim(),
  };
}

/**
 * 解析正文里的全部链接与标签。
 *
 * @param {string} markdown - 笔记正文。
 * @param {{withPositions?: boolean}} [options] - `withPositions: false` 时略过下标计算（批量索引时更快）。
 * @returns {{wikilinks: object[], embeds: object[], tags: object[]}}
 */
export function parseNoteLinks(markdown, options = {}) {
  const text = typeof markdown === 'string' ? markdown : '';
  const withPositions = options.withPositions !== false;
  if (text === '') return { wikilinks: [], embeds: [], tags: [] };

  const excluded = excludedRanges(text);
  const wikilinks = [];
  const embeds = [];

  WIKILINK_RE.lastIndex = 0;
  let m;
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    if (m.index === WIKILINK_RE.lastIndex) WIKILINK_RE.lastIndex += 1;
    if (inRanges(excluded, m.index)) continue;

    const isEmbed = m[1] === '!';
    const link = { ...splitWikilink(m[2]), embed: isEmbed };
    if (withPositions) {
      link.start = m.index;
      link.end = m.index + m[0].length;
      link.raw = m[0];
    }
    // 嵌入单独收集：图谱只连"引用关系"，嵌入是"内容搬运"，混在一起会让
    // 「谁引用了谁」的读数被图片嵌入污染。
    (isEmbed ? embeds : wikilinks).push(link);
  }

  const tags = [];
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) {
    if (m.index === TAG_RE.lastIndex) TAG_RE.lastIndex += 1;
    // 标签的 `#` 在 m[0] 里偏移 m[1].length
    const hashAt = m.index + m[1].length;
    if (inRanges(excluded, hashAt)) continue;
    // 标题行（行首的 `#`）不是标签
    const lineStart = text.lastIndexOf('\n', hashAt - 1) + 1;
    const lineHead = text.slice(lineStart, hashAt);
    if (lineHead.trim() === '' && ATX_HEADING_RE.test(text.slice(lineStart))) continue;

    const tag = { tag: m[2] };
    if (withPositions) {
      tag.start = hashAt;
      tag.end = hashAt + 1 + m[2].length;
      tag.raw = `#${m[2]}`;
    }
    tags.push(tag);
  }

  return { wikilinks, embeds, tags };
}

/**
 * 把链接目标规范化成"用于比对的键"。
 *
 * Obsidian 的解析是**大小写不敏感**、并且允许只写文件名（不写路径）。
 * 所以 `[[MyNote]]`、`[[mynote]]`、`[[folder/mynote]]` 都可能指向同一篇。
 * 本函数的产物是**候选键**里最宽松的那一个（basename，小写，去 `.md`），
 * 真正的解析交给 `resolveTarget()` 按「同目录 → 全库 basename」的顺序找。
 */
export function normalizeTarget(target) {
  let t = String(target ?? '').trim();
  if (t === '') return '';
  // 允许写 `[[笔记.md]]`（Obsidian 接受），统一去掉扩展名再比对。
  if (/\.md$/i.test(t)) t = t.slice(0, -3);
  // 反斜杠路径（Windows 用户手写时会出现）统一成正斜杠。
  t = t.replace(/\\/g, '/');
  return t.toLowerCase();
}

/** 取 basename（`a/b/c` → `c`），同样规范化。 */
export function basenameOf(target) {
  const norm = normalizeTarget(target);
  const slash = norm.lastIndexOf('/');
  return slash === -1 ? norm : norm.slice(slash + 1);
}
