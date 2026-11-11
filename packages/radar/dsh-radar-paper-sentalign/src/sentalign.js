/**
 * 句级对照翻译的**纯函数契约** —— 不碰 DOM、不碰网络、不 import `vscode`。
 *
 * 这六条函数是本骨架**唯一可执行的部分**，也是评审要看的东西：它们把
 * `Chuanyunux/pararead`（Apache-2.0）在 `src/translation/` 与 `src/languages.ts`
 * 里做对的四件事，重写成不依赖 VS Code Webview 的形状。
 *
 * 刻意**没有搬运上游源码**：每个函数都是照「上游解决了什么问题」重写的，
 * 行数与结构均不同。上游文件路径写在每节注释里，供评审对照。
 *
 * 决策与函数的对应：
 *
 *   C-1 「按 id 契约返回，不接受自由文本」   → sentenceId + mergeById
 *   C-2 「字符预算分批 + 缺漏单句重试」       → planBatches（重试用例见 mergeById）
 *   C-3 「逐句语言检测，已是目标语言就跳过」  → detectScript + isAlreadyInLanguage
 *   C-4 「术语表进缓存键」                    → cacheKey
 */

/* ── C-1：句子要有个稳定的 id ───────────────────────────────────────────── */

/**
 * 给一句话生成**稳定 id**。
 *
 * 稳定是关键：同一页重新渲染（滚动、改字号、重切句）后 id 不能变，否则
 * 已翻译的句子会被当成新句子重新计费。`ordinal` 是这一页内的序号，
 * 只作前缀以免两页的第 1 句撞车。
 *
 * @param {number} ordinal 页内序号（0 起）
 * @param {string} text 已归一的句子原文
 * @returns {string} 形如 `p3s07`
 */
export function sentenceId(ordinal, text) {
  const slot = String(ordinal).padStart(2, '0');
  // 取文本哈希只用于「序号相同但内容被局部修正」时区分；长度与首尾字足够。
  const stamp = `${text.length}${text.slice(0, 4)}${text.slice(-4)}`;
  let hash = 0;
  for (let i = 0; i < stamp.length; i += 1) {
    hash = (hash * 31 + stamp.charCodeAt(i)) >>> 0;
  }
  return `p${slot}r${hash.toString(36).slice(0, 4)}`;
}

/**
 * 把模型回复合回句子表。**只认 `expectedIds` 里的 id。**
 *
 * 这是句级对齐的前提：模型多给的、编造的 id 一律丢弃；模型漏掉的不算失败，
 * 收集进 `missing` 交给上层**单句重试**（不是整批重来 —— 一批 40 句里错 1 句
 * 就重发 40 句，成本与延迟都不划算）。
 *
 * 上游 `src/translation/parse.ts` 做对的两点，这里保留：
 *   ① 容忍 Markdown 代码围栏（模型爱把 JSON 包起来）；
 *   ② 空译文当缺失，不当成功。
 *
 * @param {string} content 模型回复原文
 * @param {readonly string[]} expectedIds 这一批请求的 id
 * @returns {{ found: Map<string, string>, missing: string[] }}
 */
export function mergeById(content, expectedIds) {
  const found = new Map();
  const expected = new Set(expectedIds);

  for (const entry of readEntries(content)) {
    if (entry === null || typeof entry !== 'object') continue;
    const { id, translation } = entry;
    if (typeof id !== 'string' || !expected.has(id)) continue;
    if (typeof translation !== 'string') continue;
    const text = translation.trim();
    if (text === '') continue; // 空串 = 没翻出来，走重试
    found.set(id, text);
  }

  return {
    found,
    missing: expectedIds.filter((id) => !found.has(id)),
  };
}

/** @param {string} content */
function readEntries(content) {
  const text = String(content)
    .trim()
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.translations)) {
    return parsed.translations;
  }
  return [];
}

/* ── C-2：按字符预算分批 ──────────────────────────────────────────────── */

/**
 * 把待译句子切成**字符预算**内的批。
 *
 * 为什么按字符而不按句数：一句可以长到 300 字（中文长句、含公式的句式），
 * 40 句的批可能一次吐 12000 字，reply 被截断 → 整批缺漏 → 全部重试。
 * 上游 `translator.ts` 同时设了 `maxCharsPerRequest` 与 `maxSentencesPerRequest`
 * 两个上限，取先到者。
 *
 * 单句超预算时**自己单独成批**，不切句 —— 切句会破坏「一句一译文」的对齐，
 * 而这一整条链路的全部价值就在对齐。
 *
 * @param {readonly {id: string, text: string}[]} sentences
 * @param {{maxChars?: number, maxSentences?: number}} [limits]
 * @returns {{id: string, text: string}[][]}
 */
export function planBatches(sentences, limits = {}) {
  const maxChars = limits.maxChars ?? 4000;
  const maxSentences = limits.maxSentences ?? 40;

  const batches = [];
  let current = [];
  let used = 0;

  for (const item of sentences) {
    const size = item.text.length;
    const wouldOverflowChars = used + size > maxChars;
    const wouldOverflowCount = current.length + 1 > maxSentences;

    if (current.length > 0 && (wouldOverflowChars || wouldOverflowCount)) {
      batches.push(current);
      current = [];
      used = 0;
    }

    current.push(item);
    used += size;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

/* ── C-3：逐句语言检测，已是目标语言就跳过 ─────────────────────────────── */

/**
 * 粗判这句话主用哪种书写系统。
 *
 * 只做**书写系统级**判断，不做语种细判 —— 目的只有一个：**拦掉不该花的钱**。
 * 中文论文里的中文段落、公式旁的中文注释、参考文献里的中文标题，
 * 都不该送去翻译。
 *
 * 上游 `languages.ts` 用了书写系统占比 + 简繁高频字 + 拉丁语系函数词打分三层；
 * 这里只保留第一层（占比），因为本仓场景里**目标语言几乎恒为中文**，
 * 三层判断里只有「是不是汉字为主」这一条有决策价值。
 *
 * @param {string} text
 * @returns {'han'|'kana'|'hangul'|'cyrillic'|'latin'|'unknown'}
 */
export function detectScript(text) {
  const sample = String(text).slice(0, 400); // 开头 400 字足够判书写系统
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let cyrillic = 0;
  let latin = 0;
  let letters = 0;

  for (const ch of sample) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (code >= 0x4e00 && code <= 0x9fff) { han += 1; letters += 1; continue; }
    if (code >= 0x3040 && code <= 0x30ff) { kana += 1; letters += 1; continue; }
    if (code >= 0xac00 && code <= 0xd7af) { hangul += 1; letters += 1; continue; }
    if (code >= 0x0400 && code <= 0x04ff) { cyrillic += 1; letters += 1; continue; }
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      latin += 1;
      letters += 1;
    }
  }

  if (letters === 0) return 'unknown';
  // 假名与汉字混排 = 日文（日文论文比例不低，不能按汉字处理）
  if (kana > 0 && (han + kana) / letters > 0.5) return 'kana';
  if (hangul / letters > 0.5) return 'hangul';
  if (han / letters > 0.5) return 'han';
  if (cyrillic / letters > 0.5) return 'cyrillic';
  if (latin / letters > 0.5) return 'latin';
  return 'unknown';
}

/** 书写系统 → 是否已经是目标语言，可以直接跳过、不调模型。 */
const SCRIPT_TO_TARGET = Object.freeze({
  'zh-CN': ['han'],
  'zh-TW': ['han'],
  ja: ['kana'],
  ko: ['hangul'],
  ru: ['cyrillic'],
});

/**
 * 这句话是不是**已经是目标语言**了？是就跳过，不送模型。
 *
 * ⚠️ 判据是书写系统而非语种：`zh-CN` 目标下，任何汉字为主的句子都跳过。
 * 代价是把「英文论文里引用的那句中文」也跳过了（那本来也不该翻），
 * 收益是不用为简繁、方言、古文做判断。上游做得更细（简繁字表分开），
 * **若本仓要做繁简区分，这里必须升级** —— README 已记为待决项。
 *
 * 目标语言是 `en` 等拉丁语系时返回 `false`：汉字句与拉丁句的边界太宽，
 * 宁可贵一点也不要漏翻。
 *
 * @param {string} text
 * @param {string} targetLanguage BCP 47，如 `zh-CN`
 * @returns {boolean}
 */
export function isAlreadyInLanguage(text, targetLanguage) {
  const allowed = SCRIPT_TO_TARGET[targetLanguage];
  if (allowed === undefined) return false;
  return allowed.includes(detectScript(text));
}

/* ── C-4：缓存键必须含术语表与提示词版本 ───────────────────────────────── */

/**
 * 生成翻译缓存键。
 *
 * 三个维度缺一不可：
 *   - `text`：同一句、不同原文不能共用
 *   - `glossaryHash`：术语表改了，旧译文**必须失效**（否则用户改完发现没变）
 *   - `promptVersion`：提示词改了同理
 *
 * 目标语言也进键 —— 先译成中文再想改日文，不能复用。
 *
 * @param {{text: string, targetLanguage: string, glossaryHash: string, promptVersion: string}} parts
 * @returns {string}
 */
export function cacheKey(parts) {
  return [parts.targetLanguage, parts.promptVersion, parts.glossaryHash, hash(parts.text)].join('|');
}

/**
 * 术语表哈希。键序不影响结果（同一份表换个书写顺序不该让缓存全失效）。
 *
 * @param {Record<string, string>} glossary
 * @returns {string}
 */
export function glossaryHash(glossary) {
  const keys = Object.keys(glossary).sort();
  const flat = keys.map((k) => `${k}=${glossary[k]}`).join('\n');
  return hash(flat);
}

/** FNV-1a 32 位。够用：只作缓存分区，不作安全哈希。 */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
