/**
 * 讲义 ⇄ Markdown 的编解码。
 *
 * # 为什么需要一层编码
 *
 * 讲义在知识库里是**结构化**的（`chapters[].topics[].blocks[]`，块有类型、
 * 有题干与解答两段），而笔记库里它必须是一份**用户能用任何编辑器打开的 .md**。
 * 两边形状不同，中间就得有人翻译，而且**必须能翻译回来** —— 学习页的讲义阅读器
 * 与 PDF 导出都按 `kind` 决定怎么渲染（例题要拆成题干 / 解答两块，见
 * `dsh-zhiyun-page-study/src/lecture-content.jsx`），解不回来就只剩一大段纯文本。
 *
 * # 结构锁定的直接后果：md 里只放内容，不放 metadata
 *
 * 用户不允许改结构（章 / 知识点 / 块的层级与顺序由 AI 定），因此
 * **块的身份就是它的位置**：第 ci 章、第 ti 个知识点、第 bi 个块。
 * 于是页码、时间锚点、`blockIndexes` 这些都不必写进 md —— 它们由当前版本的
 * 基线按位置join 回去（`record.lecture.chapters[ci].topics[ti]`）。
 * md 因此保持干净：只有标题、类型、正文。这不是省事，是让用户不必看见、也不必保全
 * 一堆自己不会用的机器字段。
 *
 * # 唯一新造的语法：例题的解答分隔
 *
 * 例题有两个正文段（题干、解答），其余四种块只有一段。分隔用一行
 * `##### 解答`（五级标题），因为：
 *   - 五级标题是标准 Markdown，任何渲染器都认得；
 *   - 它比正文里的 `---` 安全：`---` 会被当成水平线甚至 setext 标题；
 *   - 它只对 `例题` 生效，其他块里出现这行就是普通正文。
 *
 * # 转义：正文里以 `#` 开头的行
 *
 * 正文若有一行以 `#` 开头，解码时会被当成结构标题，往返就坏了。所以编码时把
 * 正文行首的 `#` 写成 `\#` —— 这是 Markdown 自身的转义写法，渲染出来仍是 `#`，
 * 不引入私有记号。解码时把行首 `\#` 还原。
 *
 * ⚠️ 用户手写的 `## 某某` 仍会被当作章标题：结构锁定是**约定**，文件系统层面
 * 无法强制。这一条在方案里是已知后果，不在这里假装能拦住。
 *
 * # 未知块类型不抛错
 *
 * `parseBlockKind` 对表外类型（「补充」「讨论」「注意」）返回 `null`，而终审那边
 * 必须拒收它们。**这里不同**：md 可能已经被人改过，为了一个认不出的块类型让整份
 * 讲义读不出来，是拿用户的正文去惩罚一个排版失误。所以降级成「讲解」并留一条
 * warning，正文一个字都不丢。
 */

/** 讲义块的闭集；与 `dsh-zhiyun-core-lecture` 的 `BLOCK_KINDS` 逐一对应。 */
export const BLOCK_KINDS = Object.freeze([
  { wire: 'elaboration', label: '讲解' },
  { wire: 'definition', label: '定义' },
  { wire: 'procedure', label: '步骤' },
  { wire: 'example', label: '例题' },
  { wire: 'note', label: '说明' },
]);

export const BLOCK_KIND_LABELS = Object.freeze(BLOCK_KINDS.map((k) => k.label));

/** 例题的解答分隔行（五级标题）。 */
export const SOLUTION_MARKER = '##### 解答';

const FALLBACK_KIND = BLOCK_KINDS[0];

/** `{wire,label}`、`wire`、`label`、undefined 四种形状都认，认不出给 null。 */
export function resolveBlockKind(raw) {
  if (raw && typeof raw === 'object' && typeof raw.wire === 'string') {
    const hit = BLOCK_KINDS.find((k) => k.wire === raw.wire);
    if (hit) return hit;
    // 对象上带着 label 时再看一眼 label（历史数据里出现过 wire 名与 App 不一致的）
    return BLOCK_KINDS.find((k) => k.label === raw.label) ?? null;
  }
  const text = String(raw ?? '').trim();
  if (!text) return null;
  return BLOCK_KINDS.find((k) => k.wire === text || k.label === text) ?? null;
}

/** 取块的显示类型；认不出给「讲解」。 */
export function kindOf(block) {
  return resolveBlockKind(block?.kind) ?? FALLBACK_KIND;
}

/**
 * 块的实际正文段。
 *
 * 例题给 `stem` / `solution` 两段，其余给 `text`。没有 `blocks` 只有
 * `passages` 的旧数据按 `lecture-content.jsx` 的同一套退化规则处理。
 */
export function blockParts(block) {
  const kind = kindOf(block);
  if (kind.wire === 'example') {
    return { stem: String(block?.stem ?? '').trim(), solution: String(block?.solution ?? '').trim() };
  }
  return { text: String(block?.text ?? block?.displayText ?? '').trim() };
}

/** 知识点实际要渲染的块表；`blocks` 缺席时用 `passages` 退化（与阅读器同一条规则）。 */
export function effectiveBlocks(topic) {
  if (Array.isArray(topic?.blocks) && topic.blocks.length) return topic.blocks;
  return (topic?.passages ?? []).map((p) => ({
    kind: resolveBlockKind(p?.label) ?? FALLBACK_KIND,
    title: '',
    text: String(p?.text ?? ''),
  }));
}

/* ────────────────────────────── 转义 ────────────────────────────── */

/** 正文 → md：行首 `#` 转义成 `\#`，统一换行，去掉首尾空行。 */
function escapeBody(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.startsWith('#') ? `\\${line}` : line))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** md → 正文：行首 `\#` 还原成 `#`。 */
function unescapeBody(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => (line.startsWith('\\#') ? line.slice(1) : line))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** 标题行；空标题写成不带尾随空格的形式（`##`），解码时也认这个形状。 */
function heading(level, title) {
  const text = String(title ?? '').trim();
  return text === '' ? '#'.repeat(level) : `${'#'.repeat(level)} ${text}`;
}

/* ────────────────────────────── 编码 ────────────────────────────── */

/**
 * 基线 → Markdown。
 *
 * 只写内容（标题 / 类型 / 正文），不写页码、时间锚点、块序号 —— 那些由当前版本的
 * 基线按位置 join 回来（见文件头「结构锁定」那一段）。
 *
 * @param {Array} chapters - `record.lecture.chapters`。
 * @param {string} [title] - 讲义标题（写在一级标题上）。
 * @returns {string} 一份完整的 md。
 */
export function baselineToMarkdown(chapters, title = '') {
  const lines = [heading(1, title)];
  for (const chapter of Array.isArray(chapters) ? chapters : []) {
    lines.push('', heading(2, chapter?.title));
    for (const topic of chapter?.topics ?? []) {
      lines.push('', heading(3, topic?.title));
      for (const block of effectiveBlocks(topic)) {
        const kind = kindOf(block);
        const blockTitle = String(block?.title ?? '').trim();
        lines.push('', blockTitle === '' ? heading(4, kind.label) : `${heading(4, kind.label)} · ${blockTitle}`);
        if (kind.wire === 'example') {
          const { stem, solution } = blockParts(block);
          if (stem) lines.push('', escapeBody(stem));
          if (solution) lines.push('', SOLUTION_MARKER, '', escapeBody(solution));
        } else {
          const { text } = blockParts(block);
          if (text) lines.push('', escapeBody(text));
        }
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

/* ────────────────────────────── 解码 ────────────────────────────── */

const HEADING_RE = /^(#{1,5})(?: (.*))?$/;

/** 拆 `#### 讲解 · 小标题`：前半是类型，后半是小标题。认不出类型就整行当标题。 */
function parseBlockHeader(rest, warnings, where) {
  const text = String(rest ?? '').trim();
  const dot = text.indexOf(' · ');
  if (dot === -1) {
    const kind = resolveBlockKind(text);
    if (kind) return { kind, title: '' };
    if (text !== '') warnings.push(`${where}认不出的块类型「${text}」，按「讲解」处理`);
    return { kind: FALLBACK_KIND, title: text };
  }
  const head = text.slice(0, dot).trim();
  const tail = text.slice(dot + 3).trim();
  const kind = resolveBlockKind(head);
  if (kind) return { kind, title: tail };
  warnings.push(`${where}认不出的块类型「${head}」，按「讲解」处理`);
  return { kind: FALLBACK_KIND, title: text };
}

/**
 * Markdown → 章节树。
 *
 * 返回 `{ chapters, title, warnings }`。章 / 知识点 / 块的身份**只由位置决定**：
 * 第几章、第几个知识点、第几个块。这与「用户不能改结构」是同一条约定。
 *
 * 认不出的块类型降级成「讲解」并记 warning；结构错乱（例如块出现在没有知识点的
 * 地方）则丢弃该块并记 warning —— 宁可少一块并说出来，也不静默改它的归属。
 *
 * @param {string} markdown - 用户或编码器产出的 md。
 */
export function markdownToChapters(markdown) {
  const warnings = [];
  const chapters = [];
  let title = '';
  let chapter = null;
  let topic = null;
  let block = null;
  let bucket = null; // 'text' | 'stem' | 'solution'
  let lines = [];

  const flush = () => {
    if (!block) return;
    const body = unescapeBody(lines.join('\n'));
    if (bucket === 'solution') block.solution = body;
    else if (bucket === 'stem') block.stem = body;
    else block.text = body;
    block = null;
    bucket = null;
    lines = [];
  };

  for (const raw of String(markdown ?? '').split(/\r?\n/)) {
    const match = HEADING_RE.exec(raw);
    if (match) {
      const level = match[1].length;
      const rest = match[2] ?? '';
      if (level === 1) {
        flush();
        title = rest.trim();
        continue;
      }
      if (level === 2) {
        flush();
        chapter = { title: rest.trim(), topics: [] };
        chapters.push(chapter);
        topic = null;
        continue;
      }
      if (level === 3) {
        flush();
        if (!chapter) {
          warnings.push(`知识点「${rest.trim()}」出现在任何章之前，已跳过`);
          topic = null;
          continue;
        }
        topic = { title: rest.trim(), blocks: [] };
        chapter.topics.push(topic);
        continue;
      }
      if (level === 4) {
        flush();
        if (!topic) {
          warnings.push(`块「${rest.trim()}」出现在任何知识点之前，已跳过`);
          continue;
        }
        const parsed = parseBlockHeader(rest, warnings, `「${topic.title}」里`);
        block = { kind: parsed.kind, title: parsed.title, text: '', stem: '', solution: '' };
        topic.blocks.push(block);
        bucket = parsed.kind.wire === 'example' ? 'stem' : 'text';
        lines = [];
        continue;
      }
      // level === 5
      if (rest.trim() === '解答' && block && block.kind.wire === 'example') {
        flush();
        // flush 已经把 block 置空，这里重挂最后一个块
        const owner = topic.blocks[topic.blocks.length - 1];
        block = owner;
        bucket = 'solution';
        lines = [];
        continue;
      }
      // 其他五级标题在块内就是普通正文
    }
    if (block) lines.push(raw);
  }
  flush();

  for (const [ci, c] of chapters.entries()) {
    c.no = ci + 1;
    for (const [ti, t] of (c.topics ?? []).entries()) t.no = ti + 1;
  }
  return { chapters, title, warnings };
}

/** 往返一次（测试与「隐藏我的更改」都用它）；解回来的章节树按位置对齐基线。 */
export function roundtrip(chapters, title = '') {
  return markdownToChapters(baselineToMarkdown(chapters, title));
}
