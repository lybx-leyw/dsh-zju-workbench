import { sections, buildCleanSentences, parseBlockDrafts, coverage, parseTags, parseJsonObject } from './core.js';

function tagComplete(tag) {
  return Boolean(tag?.role && tag.facets !== null && tag.summary);
}
export function assembleMixPage(lines, page, raw, vocabulary) {
  const clean = buildCleanSentences(lines.map(line => ({ ...line, page })), raw);
  const card = sections(raw)['块标记'] ?? '';
  const root = card.trim() ? parseJsonObject(card) : null;
  const entries = Array.isArray(root?.tags) ? root.tags : [];
  // A single block record owns its range and its marking; no positional join.
  const atomic = entries.some(t => t && ('from' in t || 'to' in t));
  const drafts = atomic ? entries.map(t => ({sentenceFrom:t?.from,sentenceTo:t?.to,bridge:''}))
    : parseBlockDrafts(raw, lines.length, clean.bridges, { fallback: false });
  const parsed = card.trim() && root ? parseTags(card, structuredClone(vocabulary)) : null;
  const tags = parsed?.tags ?? [];
  const grouped = new Map();
  for (const tag of tags) {
    if (!grouped.has(tag.index)) grouped.set(tag.index, []);
    grouped.get(tag.index).push(tag);
  }
  const missing = [], duplicate = [];
  for (let index = 1; index <= drafts.length; index++) {
    const found = grouped.get(index) ?? [];
    if (found.length > 1) duplicate.push(index);
    if (found.length !== 1 || !tagComplete(found[0])) missing.push(index);
  }
  // 多出来的标记不覆盖句子，也不能把已经对上的块整页作废。
  // 缺号不能按序号硬套：模型常把相邻两块合成一条概述，后面的序号会整体错位。
  const extra = [...grouped.keys()].filter(index => index < 1 || index > drafts.length);
  const orderOk = !atomic || entries.every((t, i) => Number(t?.index) === i + 1);
  const valid = orderOk && missing.length === 0 && duplicate.length === 0;
  for (const [i, draft] of drafts.entries()) {
    const found = grouped.get(i + 1) ?? [];
    if (found.length === 1 && tagComplete(found[0])) draft.tag = found[0];
  }
  return { ...clean, drafts, coverage: coverage(drafts, lines.length),
    marking: { ok: valid, missing, duplicate, extra, parseError: Boolean(card.trim()) && !root,
      vocabulary: parsed?.vocabulary ?? vocabulary } };
}
export function markingRetryHint(assembled, sentenceCount) {
  const marking = assembled?.marking ?? {};
  if (marking.ok) return '';
  const lines = ['上一轮的块标记没有通过校验。'];
  if (marking.parseError) lines.push('「## 块标记」不是合法 JSON。公式里的反斜杠写成 \\\\，引号写成 \\"。');
  const ranges = (assembled?.drafts ?? []).map((draft, index) => `块 ${index + 1}：第 ${draft.sentenceFrom}–${draft.sentenceTo} 句`);
  if (ranges.length) lines.push(`按「块 起-止」读到 ${ranges.length} 个块：${ranges.join('；')}。`);
  if (marking.missing?.length) lines.push(`这些 index 没有唯一且完整的 role、facets、summary：${marking.missing.join('、')}。`);
  if (marking.duplicate?.length) lines.push(`这些 index 重复了：${marking.duplicate.join('、')}。`);
  if (marking.extra?.length) lines.push(`这些 index 超出块数：${marking.extra.join('、')}。`);
  lines.push(`不要再另写一份「块 起-止」。改为原子记录，每条同时给出 index、from、to、role、facets、summary。index 从 1 起按数组顺序连续编号；from/to 是句号，不重叠，恰好覆盖 1–${sentenceCount}。`);
  lines.push('已经写在「逐块标注」里的句子不要改写，也不要另换一套纠错。重试必须返回完整逐块标注和完整块标记。');
  return lines.join('\n');
}

export function mixTaggingPrompt(vocabulary, { atomic = false } = {}) {
  if (atomic) return `\nfacets词表：${vocabulary.map(t=>t.name).join('、')}。新增类型须用“新增:类型名”。区间和标记只在同一个tags记录中返回，不另写重复的块边界。`;
  return `\n\n【同一次 mix 必须完成块标记】
完成逐句纠错与分块后，追加独立的「## 块标记」章节，只写一个 JSON 对象：
{"tags":[{"index":1,"role":"主线","facets":["概念"],"summary":"准确的本块知识概述"}]}
index 是本页块区间按出现顺序从1开始的序号，不是句号。每个块恰好一条，不重复、不遗漏。
role 只能为主线或支线。facets 从以下词表选择：${vocabulary.map(t => t.name).join('、')}。
新类型写成「新增:类型名」。summary 必须具体，不能用“本页内容”等占位语。
调设备、闲聊和纯课堂事务须标支线；教学安排、作业同时标对应facet，不能混成知识正文。
这是同一次请求的一部分，不要留给后续请求。清洗稿仍是逐句对应的转录稿，正式语言组织由后面的merge完成。
无语音、无块时返回 {"tags":[]}。重试也必须返回完整逐块标注和完整块标记。
`;
}
