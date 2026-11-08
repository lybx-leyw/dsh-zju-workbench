import { readFileSync } from 'node:fs';
import { correctionComparison, correctionPolicy } from './correction-policy.js';
export const templates = JSON.parse(readFileSync(new URL('../assets/prompts.json', import.meta.url), 'utf8'));
export function stripFences(raw) { return String(raw).replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim().replace(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/, '$1').trim(); }
export function sections(raw) {
  const out = {}; let title = null, lines = [];
  const flush = () => { if (title) out[title] = lines.join('\n').trim(); };
  for (const line of stripFences(raw).split('\n')) {
    const match = line.match(/^#{1,3}\s*(.+?)\s*$/);
    if (match) { flush(); title = match[1].trim(); lines = []; } else lines.push(line);
  }
  flush(); return out;
}
export function faithful(raw) {
  raw = stripFences(raw); const s = sections(raw);
  return { raw, pageText: s['页面文字'] ?? '', pageVisual: s['页面画面'] ?? s['页面画面与图形'] ?? s['版面与图形'] ?? '', listedTerms: s['术语'] ?? '' };
}
export function pageGate(transcription) {
  if (!transcription?.pageVisual?.trim() || transcription.pageText.trim().length >= 200) return { filtered: false, hits: [] };
  const hits = templates.screenshotHints.filter(hint => transcription.pageVisual.includes(hint));
  return { filtered: hits.length > 0, hits };
}
export function formatMs(ms) { const sec = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; }
export function mixSection(raw) { const s = sections(raw); return s['逐块标注'] ?? s['逐句标注'] ?? stripFences(raw); }
export function field(text, name) {
  const m = new RegExp(`${name}\\s*[:：]\\s*`).exec(text); if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  let end = rest.length;
  for (const other of ['正文', '衔接', '概述', '角色', '标签']) {
    if (other === name) continue; const next = new RegExp(`${other}\\s*[:：]`).exec(rest); if (next) end = Math.min(end, next.index);
  }
  return rest.slice(0, end).trim();
}
export function parseCleanLines(raw) {
  const out = new Map();
  for (const line of mixSection(raw).split('\n')) {
    const m = line.trim().match(/^(\d+)\s*[.、)．]\s*(.*)$/); if (!m || +m[1] < 1) continue;
    const rest = m[2].replace(/^\[\d{1,3}:\d{2}\]\s*/, '').replace(/^<[^>]*>\s*/, '').trim();
    const body = field(rest, '正文'), bridge = field(rest, '衔接');
    out.set(+m[1], { correctedText: body || (body === null && bridge === null ? rest || null : null), bridge: bridge || null });
  }
  return out;
}
export function editDistance(a, b, limit = Infinity) {
  // Dart uses UTF-16 code units; JS indexing preserves the same contract.
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...row) > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length];
}
/** 模型常把句号或「原文→改写」写进正文。先剥掉这层外壳，再量编辑限额。 */
export function peelCorrectionAnnotation(original, attempted, sentenceNumber) {
  let text = String(attempted ?? '').trim();
  text = text.replace(/^第\d+句\s*[:：]\s*/u, '');
  const numbered = text.match(/^(\d{1,3})\s*[.、．]\s+(\S[\s\S]*)$/u);
  if (numbered && Number(numbered[1]) === sentenceNumber) text = numbered[2].trim();
  const aside = value => correctionComparison(value).replace(/[，,]/gu, '');
  const arrow = text.split(/\s*(?:→|->|=>)\s/u);
  if (arrow.length === 2 && aside(arrow[0]) === aside(original)) text = arrow[1].trim();
  const colon = text.split(/[:：]/u);
  if (colon.length === 2 && aside(colon[0]) === aside(original)) text = colon[1].trim();
  return text || String(attempted ?? '').trim();
}
export function buildCleanSentences(rawLines, response) {
  const edits = parseCleanLines(response), rejected = [], bridges = [];
  const sentences = rawLines.map((line, index) => {
    const edit = edits.get(index + 1); bridges.push(edit?.bridge ?? '');
    let text = line.text, correctionDistance = 0;
    if (edit?.correctedText != null) {
      const peeled = peelCorrectionAnnotation(line.text, edit.correctedText, index + 1);
      const original = correctionComparison(line.text), attempted = correctionComparison(peeled);
      const limit = Math.min(correctionPolicy.maxEditDistance, Math.max(1, Math.floor(original.length * correctionPolicy.maxEditRatio)));
      const distance = editDistance(original, attempted, limit);
      if (distance <= limit) { text = peeled; correctionDistance = distance; }
      else {
        // 退回提示要说清「改了多少字」，所以这里记**未截断**的真实距离
        // （上面的 distance 提前退出，超过上限就停）。
        rejected.push({
          index, original: line.text, attempted: peeled, limit,
          editDistance: editDistance(original, attempted),
          rawEditDistance: editDistance(line.text, edit.correctedText),
          reason: `排除格式差异后改动超过本句上限 ${limit} 字（原文 ${original.length} 字 × ${correctionPolicy.maxEditRatio * 100}%，最多 ${correctionPolicy.maxEditDistance} 字）`,
        });
      }
    }
    return { startMs: line.startMs, endMs: line.endMs, page: line.page, text, correctionDistance };
  });
  return { sentences, rejected, bridges };
}
export function parseBlockDrafts(raw, sentenceCount, bridges = [], { fallback = true } = {}) {
  if (!sentenceCount) return [];
  const drafts = [];
  for (const line of mixSection(raw).split('\n')) {
    const trimmed = line.trim();
    const m = trimmed.match(/^块\s*(\d+)(?:\s*[-–—~至]\s*(\d+))?(?=\s|$|衔接)/);
    if (m) drafts.push({ sentenceFrom: +m[1], sentenceTo: +(m[2] ?? m[1]), bridge: field(trimmed.slice(m[0].length), '衔接') ?? '' });
  }
  if (!drafts.length && fallback) drafts.push({ sentenceFrom: 1, sentenceTo: sentenceCount, bridge: '' });
  return drafts.map(d => ({ ...d, bridge: d.bridge.trim() || bridges[d.sentenceTo - 1]?.trim() || '' }));
}
export function coverage(drafts, count) {
  let expected = 1; const issues = [];
  for (const d of drafts) {
    if (d.sentenceFrom !== expected || d.sentenceTo < d.sentenceFrom || d.sentenceFrom < 1 || d.sentenceTo > count) issues.push({ expected, from: d.sentenceFrom, to: d.sentenceTo });
    expected = d.sentenceTo + 1;
  }
  if (expected !== count + 1) issues.push({ expected, count });
  return { ok: issues.length === 0, issues };
}
/**
 * 把字幕按**页时间锚点**分配进各页窗口。
 *
 * # 为什么最后一页的窗口必须有上限
 *
 * 早先的实现里，`ends[i]` 取"下一个锚点"，而**最后一页没有下一个锚点**，
 * 于是它的窗口一路开到课末。这在"每页都翻"的课上没问题，但真课里有另一种
 * 结构极端的课型 —— **前面放几页 PPT，后面讲两小时不看屏**：
 *
 * ```
 * 0 ────── 334 秒 ─────────────────────────── 2.5 小时
 *   [8 页 PPT，32 句]        [纯讲授，3235 句，占 99%]
 * ```
 *
 * 这时最后一页的窗口会把整节 99% 的讲话吞进去，然后：
 *   ① **语义错位**：拿一页 883 字的页面转述去"纠正"144 分钟的讲话 ——
 *      参照物跟内容毫无关系，比不纠正更糟，会引入臆造；
 *   ② **必然失败**：3200 句塞进一次 mix 调用，超出上下文或输出预算。
 *
 * 所以给"没有下一个锚点"的页设窗口上限 `maxWindowMs`（默认 10 分钟）：超出
 * 上限的字幕**不归属任何页**，进 `unassigned`。而产品对 `unassigned` 的既定
 * 语义正好就是这里需要的 ——
 *
 *   「老师真说过的话，进句子层原样保留，但**不造块、不清洗**，
 *     因为没有图可以对照纠错。」
 *
 * 换句话说：**没有 PPT 的段落，本来就不该走 vision 与 mix。** 这个上限不是
 * 在"猜时间"，而是把"一页 PPT 撑不起两小时"这个常识写进规则。
 *
 * ⚠️ 只对 `ends[i] === null` 的页生效。中间那些页的窗口由下一页锚点界定，
 *    多长都是真实的（老师确实在这一页停了那么久），不裁剪。
 *
 * @param {object} [options]
 * @param {number} [options.maxWindowMs] 单页时间窗上限，默认 10 分钟；传 0 关闭上限。
 */
export function anchor(slides, subtitles, { maxWindowMs = 10 * 60 * 1000 } = {}) {
  const ordered = subtitles.map((line, sourceIndex) => ({ ...line, sourceIndex })).sort((a, b) => a.startMs - b.startMs || a.sourceIndex - b.sourceIndex);
  if (!slides.length) return { windows: [], unassigned: ordered, warnings: [] };
  const anchors = slides.map(s => s.createdSec > 0 ? s.createdSec * 1000 : null);
  const warnings = [], buckets = slides.map(() => []);
  const lastEnd = lines => lines.length ? Math.max(...lines.map(l => Math.max(l.startMs, l.endMs))) : null;
  if (!anchors.some(a => a !== null)) {
    warnings.push('课件没有时间锚点：字幕按顺序等分，归属可能不准');
    ordered.forEach((line, i) => buckets[Math.min(slides.length - 1, Math.floor(i * slides.length / ordered.length))].push(line));
    return { windows: buckets.map(lines => ({ lines, fromMs: lines[0]?.startMs ?? null, toMs: lastEnd(lines) })), unassigned: [], warnings };
  }
  if (new Set(anchors.filter(a => a !== null)).size < anchors.filter(a => a !== null).length) warnings.push('存在重复时间锚点，部分页时间窗为空');
  const starts = [], ends = [];
  for (let i = 0; i < slides.length; i++) {
    starts[i] = anchors.slice(0, i + 1).findLast(a => a !== null) ?? null;
    ends[i] = anchors.slice(i + 1).find(a => a !== null) ?? null;
    if (anchors[i] === null && ends[i] === null) { starts[i] = null; warnings.push(`第 ${slides[i].page} 页没有可确定的时间窗`); }
  }
  /** 这一页的窗口是否被封顶（只有"没有下一个锚点"的页会）。 */
  const capOf = i => (ends[i] === null && starts[i] !== null && maxWindowMs > 0) ? starts[i] + maxWindowMs : null;
  let cursor = 0;
  for (let i = 0; i < slides.length; i++) {
    const cap = capOf(i);
    while (cursor < ordered.length) {
      const line = ordered[cursor];
      if (line.startMs < (starts[i] ?? -1)) { buckets[i].push(line); cursor++; continue; }
      if (ends[i] !== null && line.startMs >= ends[i]) break;
      if (cap !== null && line.startMs >= cap) break;
      buckets[i].push(line); cursor++;
    }
  }
  const unassigned = ordered.slice(cursor);
  // 分别报"窗口封顶"与"本来就没落页"——它们是两件事，混成一条会看不出原因
  const cappedCount = buckets.length && capOf(buckets.length - 1) !== null ? unassigned.length : 0;
  if (cappedCount) {
    warnings.push(`最后一页之后还有 ${cappedCount} 句超出单页时间窗上限（${Math.round(maxWindowMs / 60000)} 分钟），`
      + '按「没有课件对照」的时间段清洗、分块与标记，保留仅语音转录的依据类型。');
  } else if (unassigned.length) {
    warnings.push(`${unassigned.length} 句字幕未分配，已保留`);
  }
  return { windows: buckets.map((lines, i) => ({ lines, fromMs: starts[i] ?? lines[0]?.startMs ?? null, toMs: starts[i] === null && ends[i] === null ? null : ends[i] ?? lastEnd(lines) })), unassigned, warnings };
}
export function glossary(pages, minCount = 2, fallback = true) {
  const acc = new Map();
  for (const page of pages) {
    const accept = (text, bullets) => {
      let s = text.trim(); if (bullets) s = s.replace(/^[-*•·]+\s*/, '').replace(/^\d+[.、．)]\s*/, '').trim();
      return s.length >= 2 && s.length <= 32 && !/^(\d+|（无）|\(无\)|无)$/.test(s) ? s : null;
    };
    let terms = page.listedTerms.split(/\r?\n/).map(t => accept(t, true)).filter(Boolean);
    if (!terms.length && fallback) terms = page.pageText.split(/[^\u3400-\u9fffA-Za-z0-9]+/).map(t => accept(t, false)).filter(Boolean);
    for (const text of terms) { const term = acc.get(text) ?? { text, count: 0, pages: new Set() }; term.count++; term.pages.add(page.page); acc.set(text, term); }
  }
  const extracted = [...acc.values()].map(t => ({ ...t, pages: [...t.pages].sort((a,b) => a-b) })).sort((a,b) => b.count-a.count || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  return { minCount, extracted, terms: extracted.filter(t => t.count >= minCount && !templates.stopwords.includes(t.text)) };
}
export function role(value) { const v = String(value ?? '').trim().toLowerCase(); return /主线/.test(v) || ['main','mainline'].includes(v) ? '主线' : /支线|旁支/.test(v) || ['branch','side'].includes(v) ? '支线' : null; }
/**
 * 模型常把 LaTeX 直接写进 JSON 字符串（`\sigma`、`\varepsilon`）。
 * 这些不是合法转义，`JSON.parse` 会把整张答题卡丢成 null，
 * 于是本页每一句都被记成无法核验。先按严格 JSON 解析；
 * 只有失败时才把非法转义补成两个反斜杠，合法的 `\"`、`\\`、`\n`、`\uXXXX` 不动。
 */
export function parseJsonObject(text) {
  const body = String(text ?? '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  const slice = body.slice(start, end + 1);
  try { return JSON.parse(slice); } catch { /* 非法转义时再修一次 */ }
  const relaxed = slice.replace(/\\(?:u(?![0-9a-fA-F]{4})|[^"\\/bfnrtu])/g, match => `\\${match}`);
  try { return JSON.parse(relaxed); } catch { return null; }
}
export function parseTags(raw, vocabulary = templates.vocabulary.map(v => ({ ...v }))) {
  const text = stripFences(raw);
  const root = parseJsonObject(text);
  if (!root || typeof root !== 'object' || Array.isArray(root)) return null;
  const added = [], rejected = [], tags = [];
  for (const item of Array.isArray(root.tags) ? root.tags : []) {
    if (!Number.isInteger(Number(item?.index)) || +item.index < 1) continue;
    let facets = null;
    if (Array.isArray(item.facets)) {
      const accepted = new Set(); let invalid = false;
      for (const f of item.facets) {
        if (typeof f !== 'string') continue;
        const value = f.trim();
        const existing = vocabulary.find(t => t.name === value || t.aliases?.includes(value)) ?? templates.vocabulary.find(t => value.includes(t.name));
        if (existing) accepted.add(existing.name);
        else if (/^新增\s*[:：]\s*.+$/.test(value)) {
          const name = value.replace(/^新增\s*[:：]\s*/, '').trim();
          if (!vocabulary.some(t => t.name === name)) { vocabulary.push({ name, aliases: [] }); added.push(name); }
          accepted.add(name);
        } else { invalid = true; rejected.push(value); }
      }
      facets = !accepted.size && invalid ? null : [...accepted];
    }
    const tag = { index: +item.index, role: role(item.role), facets, summary: typeof item.summary === 'string' ? item.summary.trim() || null : null };
    if (tag.role || tag.facets !== null || tag.summary) tags.push(tag);
  }
  const outline = (Array.isArray(root.outline) ? root.outline : []).filter(i => typeof i?.title === 'string' && i.title.trim() && Number.isInteger(Number(i.from)) && Number.isInteger(Number(i.to))).map(i => ({ title: i.title.trim(), from: +i.from, to: +i.to }));
  return { tags, outline, spine: typeof root.spine === 'string' ? root.spine.trim() : '', added, rejected, vocabulary };
}
// ── 退回给模型的提示：把「哪一条被拒」「哪几句没人管」逐条说清 ──────────
//
// 与 Dart 的 `buildRetryHint` / `coverageRetryHint` 同口径：抽象要求（"你错了"）
// 对模型几乎没有作用，点名到具体条目才有。
export function coverageIssueDetail(issue, count) {
  const { expected, from, to } = issue;
  if (from === undefined) return `第 ${expected}–${count} 句没有被任何块覆盖（最后一块必须到第 ${count} 句结束）。`;
  if (to < from) return `块区间 ${from}–${to} 反向：结束句号小于起始句号。`;
  if (from < 1) return `块区间 ${from}–${to} 越界：这一页的句号从 1 起。`;
  if (to > count) return `块区间 ${from}–${to} 越界：这一页只有 ${count} 句。`;
  if (from > expected) return `第 ${expected}–${from - 1} 句没有被任何块覆盖。`;
  return `第 ${from}–${expected - 1} 句被重复覆盖（块 ${from}–${to} 与前一块重叠）。`;
}
export function correctionRetryHint(rejected, round) {
  if (!rejected?.length) return '';
  const lines = [`你上一轮的纠错有 ${rejected.length} 条未通过校验${round == null ? '' : `（第 ${round} 轮）`}：`, ''];
  for (const r of rejected) lines.push(`· 第 ${r.index + 1} 句 原文「${r.original}」→ 你的修改「${r.attempted}」被拒（${r.reason ?? '未通过护栏'}）。`);
  lines.push('', '请返回这一页完整的「逐块标注」结果，包含覆盖全部句子的块区间，以及所有仍需采纳的逐句纠正；本轮会替换上一轮整份结果，不能只返回被拒条目，也不能写「其余不变」。', '依据课件和上下文复核听写、术语和公式；保留原意与句子对应，不要为控制字数而留下有依据可改的错误。', '确实不用改的句子可以不列逐句纠正，但仍须落在完整分块区间内。');
  return lines.join('\n');
}
export function coverageRetryHint(cov, sentenceCount, round) {
  if (!cov || cov.ok) return '';
  const lines = [`你上一轮的分块**没有通过覆盖校验**${round == null ? '' : `（第 ${round} 轮）`}，共有 ${cov.issues.length} 处问题：`];
  for (const issue of cov.issues) lines.push(`· ${coverageIssueDetail(issue, sentenceCount)}`);
  lines.push('', `要求：这一页一共 ${sentenceCount} 句，你的块必须**依次、不重叠、恰好覆盖 1..${sentenceCount}**：`,
    `· 第 1 块必须从第 1 句开始；最后一块必须到第 ${sentenceCount} 句结束；`,
    '· 相邻两块相接（上一块的结束句号 + 1 = 下一块的起始句号）；',
    '· 不许重叠、不许留空、不许少句。', '', '请重新给出**这一页完整**的分块列表，每行严格写成「块 1-12 衔接：……」这样的格式；不要省略「块」字，不要把范围写成逐句条目。');
  return lines.join('\n');
}
/// 整节主线的机械清洗（与 Dart `sanitizeOutline` 同口径）。
///
/// 模型给的区间可能越界、反向、重叠 —— 那三种都能**机械判定为错**，逐条剔除；
/// 剩下的照常给。一条都不剩就干脆不给 outline（spine 仍在，检索不受影响）。
///
/// ⚠️ 不因为「没覆盖满」就整份丢弃：漏一段的主线仍是有用的导读，
///    而丢掉整份会让用户失去全部结构；也不在代码里凭空补一段（那是替模型编内容）。
export function sanitizeOutline(raw, blockCount) {
  if (!raw?.length || blockCount < 1) return { outline: [], warnings: [] };
  const outline = [], warnings = [];
  let lastTo = 0;
  for (const span of raw) {
    if (span.from < 1 || span.to > blockCount || span.from > span.to) {
      warnings.push(`整节主线有一段区间不可信（第 ${span.from}–${span.to} 块，本节的块序号只到 ${blockCount}），已剔除。`);
      continue;
    }
    if (span.from <= lastTo) {
      warnings.push(`整节主线有一段与前文重叠或逆序（第 ${span.from}–${span.to} 块），已剔除。`);
      continue;
    }
    outline.push(span); lastTo = span.to;
  }
  return { outline, warnings };
}
