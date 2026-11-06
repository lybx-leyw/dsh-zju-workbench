import { assembleMixPage, markingRetryHint } from './mix.js';
import { templates, parseBlockDrafts, coverage, correctionRetryHint, coverageRetryHint, sections } from './core.js';
import { hash } from './cache.js';

/** 超限只退回那一句。块覆盖和标记已经通过时，这一页可以缓存，不能整页重洗。 */
export function blockCleanStatus(sentences) {
  return sentences.every(s => s.cleanStatus === 'reviewed' || s.cleanStatus === 'reverted') ? 'reviewed' : 'incomplete';
}

/** A mix work item is a transcript interval; a slide is optional evidence. */
export function transcriptWindows(lines, { maxChars = 5500, maxLines = 160, gapMs = 15000 } = {}) {
  const groups = []; let group = [], chars = 0;
  for (const line of lines) {
    if (group.length && (group.length >= maxLines || chars + line.text.length > maxChars || line.startMs - group.at(-1).endMs > gapMs)) {
      groups.push(group); group = []; chars = 0;
    }
    group.push(line); chars += line.text.length;
  }
  if (group.length) groups.push(group);
  return groups.map(lines => ({ id: `transcript:${lines[0].sourceIndex}-${lines.at(-1).sourceIndex}`, lines,
    fromMs: lines[0].startMs, toMs: Math.max(...lines.map(l => l.endMs)), evidenceKind: 'transcript-only' }));
}

export async function runMixUnit({ lines, page = null, unitId, parts, route, llm, cache, limiter,
  vocabulary, signal, events, maxRounds = 3, legacyCache = false, legacyParts }) {
  const key = cache.key('mix', [route, parts, lines.map(l => [l.startMs, l.endMs, l.text])]);
  // 限额拒绝的是某一句的改写，不是这一页。覆盖和标记通过就可以缓存。
  const sound = value => value.coverage.ok && value.marking.ok;
  const read = raw => assembleMixPage(lines, page, raw, vocabulary);
  let raw = '', failure = null;
  try {
    const saved = await cache.get(key) ?? (legacyParts ? await cache.get(cache.key('mix', [route,legacyParts,lines.map(l=>[l.startMs,l.endMs,l.text])])) : null) ?? (legacyCache ? await cache.get(cache.key('mix',
      [route, { ...parts, constant: templates.mix }, lines.map(l => [l.startMs, l.endMs, l.text])])) : null);
    if (saved?.raw?.trim() && sound(read(saved.raw))) {
      raw = saved.raw; events.push({ stage: 'mix', unitId, cached: true });
      if (saved.key !== key) await cache.put(key, raw);
    } else {
      let previous;
      for (let attempt = 0; attempt <= maxRounds; attempt++) {
        signal?.throwIfAborted();
        const current = read(raw);
        const hints = [correctionRetryHint(current.rejected, attempt), coverageRetryHint(current.coverage, lines.length, attempt),
          markingRetryHint(current, lines.length)].filter(Boolean);
        const variable = attempt ? `${parts.variable}\n\n上一轮完整输出：\n${raw}\n\n请修复后返回完整结果：\n${hints.join('\n')}` : parts.variable;
        const response = await limiter.run(() => llm.call({ stage: 'mix', route, constant: parts.constant, variable, signal }), signal);
        events.push({ stage: 'mix', unitId, cached: false, retry: attempt || undefined, usage: response.usage ?? null });
        raw = response.text;
        const assembled = read(raw);
        // 超限的句子已退回原文。不再为此另发修复：实跑里那一次调用返回的是空修正。
        if (sound(assembled)) { await cache.put(key, raw); break; }
        const signature = hash([assembled.rejected, assembled.drafts, assembled.marking.ok, raw]);
        if (signature === previous) break;
        previous = signature;
      }
    }
  } catch (error) {
    if (signal?.aborted || error.code === 'CANCELLED') throw error;
    failure = error.code ?? 'LLM_FAILED';
  }
  const mixed = read(raw);
  const structureComplete=mixed.coverage.ok && mixed.marking.ok;
  const complete = structureComplete && !failure;
  const rejectedIndexes=new Set(mixed.rejected.map(r=>r.index));
  if (!mixed.marking.ok) failure ??= 'MIX_TAG_COVERAGE';
  if (!mixed.coverage.ok) {
    failure ??= 'BLOCK_COVERAGE';
    mixed.drafts = parseBlockDrafts('', lines.length, mixed.bridges);
    mixed.coverage = coverage(mixed.drafts, lines.length);
  }
  mixed.sentences = mixed.sentences.map((s, i) => ({ ...s, sourceIndex: lines[i].sourceIndex,
    rawText: lines[i].text, cleanStatus: !structureComplete ? 'incomplete' : rejectedIndexes.has(i) ? 'reverted' : 'reviewed' }));
  let correctionHistory=null;
  try{correctionHistory=JSON.parse(sections(raw)['清洗校验记录']);}catch{}
  return { ...mixed, raw, failure, cleanComplete: complete, correctionHistory, unitId };
}
