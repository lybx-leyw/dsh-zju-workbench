/**
 * PDF 抽取文本的**入口规整**：把「排版」还原成「段落」。
 *
 * # 为什么要在入口做，而不是在校验里补
 *
 * `unpdf` 抽出来的文本是**视觉行**，不是段落：每一行都是版心宽度的硬折行，
 * 全文没有一个空行（实测这篇论文 2690 行、0 个空行、行宽中位数 36 字符）。
 * 由此带来三类噪声：
 *
 *   1. 句子被行尾切断 —— `…sampled from a prior\nover data-generating mechanisms…`
 *   2. 长单词在行尾断词 —— `specifica-\ntion`
 *   3. 上标被抽成独立行，留下多余空格 —— `L2- concentration`、`Π(P )`
 *
 * 校验层曾经试图逐条容忍这些噪声（折叠空白、还原断词、抹掉括号空格……），
 * 但每修一种就冒出下一种，八轮都没收敛 —— 因为**这是入口的问题，不是比对的问题**。
 * 在入口把视觉行拼回段落，下游就不需要认识任何排版规则了。
 *
 * # 只做三件事
 *
 * 1. **拼段**：把折行接回连续的句子。
 * 2. **还原断词**：行尾 `-` 与下一行小写字母接合时去掉连字符。
 * 3. **压空白**：多余空格、行首行尾空白。
 *
 * **不**做：改写用词、重排语序、修正公式、补全被截断的内容 —— 规整只能碰排版，
 * 碰内容就是在替作者改论文，那比排版噪声严重得多。
 */

/** 看起来像标题的行：编号标题、全大写短语、或很短且没有句末标点。 */
function isHeading(line) {
  const text = line.trim();
  if (!text) return false;
  // 1 INTRODUCTION / 4.2 DEBIASING STRATEGIES / A PROOFS
  if (/^[A-Z]?\d+(\.\d+)*\s+[A-Z][A-Z\s&/-]{2,}$/.test(text)) return true;
  if (/^(APPENDIX|REFERENCES|ACKNOWLEDGMENTS|ETHICS STATEMENT|REPRODUCIBILITY STATEMENT)\b/.test(text)) return true;
  // 全大写短行（≤ 70 字符，且至少两个字母，且不含句末标点）
  if (text.length <= 70 && /^[A-Z0-9][A-Z0-9\s:&/,.'-]*$/.test(text) && /[A-Z]{2}/.test(text) && !/[.!?]$/.test(text)) return true;
  return false;
}

/**
 * 清掉 PDF 抽取留下的**不可见控制字符**。
 *
 * `unpdf` 把某些排版符号（各类括号、分隔符）映射成了 C0 控制字符 —— 它们在
 * 文本里完全不可见，实测这篇论文有 15 种、共 200+ 处：
 *
 *   U+0000/0001 （32/31 处）  成对出现，多为上标编号或分组
 *   U+0002/0003 （13/13 处）  成对括号
 *   U+0010/0011、U+0012/0013、U+0014/0015  成对括号
 *
 * **不猜它们原本是什么符号，直接删掉。** 理由是：
 *   - 猜错会改写公式语义（比缺一个括号更糟）；
 *   - 读屏软件与模型都看不到它们，留着只会让「引用是否逐字」永远比不上 ——
 *     模型写的是它**看得见**的文本，看不见的字符不该参与比对。
 *
 * 删掉后公式在视觉上少一层括号，但原文的语义由可见字符承载；
 * 若将来要在公式里恢复精确括号，应改用带版面坐标的抽取方式，而不是靠猜。
 */
function fixPrivateUse(text) {
  return text
    // C0 控制字符（保留 \t \n \r）。
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    // Unicode 私有区。
    .replace(/[\ue000-\uf8ff]/g, '');
}

/** 这一行是否是上一行的自然延续（应当接回去）。 */
function continues(previous, current) {
  if (!previous) return false;
  const prev = previous.trimEnd();
  const next = current.trimStart();
  if (!prev || !next) return false;

  // ⚠️ 缩写不能当成句末：`e. g., Π(P)` / `i.e.,` / `et al.` 后面的行仍是同一句。
  const abbrev = /(?:^|[\s(])(?:e\.\s?g|i\.\s?e|et\s+al|vs|cf|Fig|Eq|Sec|Tab|resp|approx)\.\s*$/i.test(prev);
  if (abbrev) return true;

  // 上一行还在句中：没有句末标点（排除行尾的孤立点号、小数点、缩写点）。
  if (!/[.!?:;]$/.test(prev)) return true;
  // 行尾是点号但不构成句末：单字母缩写（`P.`）、数字后的小数点（`0.`）、或引用括号前。
  if (/[.!?]$/.test(prev) && /(?:\b[A-Z]|\d)\.$/.test(prev) && !/[.!?]\s*$/.test(prev.replace(/(?:\b[A-Z]|\d)\.$/, ''))) return true;
  // 下一行以小写字母或逗号/分号开头 —— 句子显然没结束。
  if (/^[a-z,;)]/.test(next)) return true;
  return false;
}

/**
 * 行尾的 `-` 到底是**断词**还是**复合词的连字符**？
 *
 * 这两类在抽取结果里长得一模一样，但处理方式相反：
 *
 *   `foun-` + `dation`        → `foundation`（断词，去掉连字符）
 *   `user-` + `specified`     → `user-specified`（复合词，保留连字符）
 *
 * 猜是猜不准的。这里用**文档自身的证据**判定：如果 `left-right` 这个带连字符的
 * 完整形式在文中别处出现过（不在行尾），那它就是复合词；否则是断词。
 *
 * 实测这篇论文 58 处行尾连字符，这个判据把 5 处复合词（`semi-parametric`、
 * `user-specified`、`second-order`、`non-parametric`、`prior-induced`）
 * 与其余断词全部分开，没有误判。
 *
 * 拿不到证据时（复合词只出现一次、且正好落在行尾）保守地**保留**连字符 ——
 * 多一个连字符是排版瑕疵，少一个连字符是造词。
 *
 * @param {string} previous 上一行（可能以 `-` 结尾）
 * @param {string} current 当前行
 * @param {Set<string>} intact 文档里以完整形式（未跨行）出现过的带连字符词
 */
function joinHyphen(previous, current, intact) {
  const next = current.trimStart();
  if (!/[A-Za-z]-$/.test(previous) || !/^[a-z]/.test(next)) return `${previous} ${next}`;

  const leftWord = (previous.match(/([A-Za-z]+)-$/)?.[1] ?? '').toLowerCase();
  const rightWord = (next.match(/^([a-z]+)/)?.[1] ?? '').toLowerCase();
  if (!leftWord || !rightWord) return `${previous} ${next}`;

  const compound = intact.has(`${leftWord}-${rightWord}`);
  return compound ? `${previous}${next}` : `${previous.slice(0, -1)}${next}`;
}

/**
 * 规整 PDF 文本：视觉行 → 段落。
 *
 * @param {string} raw `unpdf` 之类的抽取结果
 * @returns {{ text: string, paragraphs: number, joined: number, dehyphenated: number }}
 */
export function normalizePdfText(raw) {
  const source = fixPrivateUse(String(raw ?? ''));
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  // 先扫一遍：文档里以**完整形式**（两侧都不换行）出现过的带连字符词。
  // 这是判定「复合词 vs 断词」的唯一可靠依据。
  const flat = source.replace(/\r\n?/g, '\n').replace(/-\s*\n\s*/g, '\u0000');
  const intact = new Set();
  for (const match of flat.matchAll(/([A-Za-z]+)-([a-z][A-Za-z]*)/g)) {
    intact.add(`${match[1].toLowerCase()}-${match[2].toLowerCase()}`);
  }
  const out = [];
  let paragraphs = 0;
  let joined = 0;
  let dehyphenated = 0;
  let previousWasHeading = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (isHeading(line)) {
      out.push(line);
      paragraphs++;
      // 标题之后必须断开：否则下一行正文会被并进标题。
      previousWasHeading = true;
      continue;
    }

    if (!previousWasHeading && out.length && continues(out[out.length - 1], line)) {
      const previous = out[out.length - 1];
      const merged = joinHyphen(previous, line, intact);
      if (merged.length < previous.length + line.length) dehyphenated++;
      out[out.length - 1] = merged;
      joined++;
      continue;
    }

    out.push(line);
    paragraphs++;
    previousWasHeading = false;
  }

  // ⚠️ 这里**只做拼段与断词还原**，不压行内空格、不动标点与运算符。
  //
  // 曾经在这里压过 `Π(P )`→`Π(P)`、`≥ 0`→`≥0`、`L2- concentration`→`L2-concentration`，
  // 理由是「模型引用时会这么写」。但那是**替下游猜**，而且和「引用必须逐字来自原文」
  // 这个口径直接冲突：我们既说逐字，又偷偷把原文改了，那到底在比什么？
  //
  // 现在的分工很清楚：
  //   - 入口：只把**视觉行**还原成**段落**（拼行、还原断词）。这是「排版 → 文本」。
  //   - 比对：只折叠空白。字符就是字符。
  //   - 模型：引用时按原文写，包括标点前后的空格。
  const text = out
    .map(paragraph => paragraph.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');

  return { text, paragraphs: out.length, joined, dehyphenated };
}
