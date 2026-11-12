import { GENERATION_VERSION } from '@lybx-leyw/dsh-zju-core-lecture';

const list = value => Array.isArray(value) ? value : [];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const locationKeys = ['page', 'fromPage', 'toPage', 'startMs', 'endMs', 'tSec', 'startTime', 'endTime', 'anchor'];
const privateKey = /^(accountId|.*(?:localPath|filePath|directory|storagePath|absolutePath))$/i;
const redact = text => text.replace(/(?:[a-z]:[\\/]|\\\\)[^\s"<>]+|file:\/\/[^\s"<>]+|\/(?:Users|home|tmp|var|private|mnt)\/[^\s"<>]+/gi, '[本地路径]');

// Copy JSON-shaped material only; never forward record identity or storage metadata.
function safe(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(safe);
  if (object(value)) return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => !privateKey.test(key) && !/^(path|file|filename)$/i.test(key) && typeof item !== 'function')
    .map(([key, item]) => [key, safe(item)]));
  return value;
}

function provenance(value, fallbackIndexes = []) {
  const source = {};
  for (const key of locationKeys) if (value[key] !== undefined) source[key] = safe(value[key]);
  for (const key of ['page', 'startMs', 'endMs']) {
    if (source[key] === undefined) {
      const candidates = list(value.sentences).filter(sentence => sentence?.[key] != null);
      const sentence = key === 'endMs' ? candidates.at(-1) : candidates[0];
      if (sentence) source[key] = safe(sentence[key]);
    }
  }
  source.sourceBlockIndexes = [...new Set(list(value.sourceBlockIndexes ?? value.blockIndexes ?? fallbackIndexes)
    .filter(index => Number.isInteger(index) && index >= 0))];
  return source;
}

/** Complete topics, branch boards, then original evidence, in source order. */
export function materialEntries(record) {
  if (!object(record)) return [];
  const entries = [];
  if (record.lecture?.generationVersion === GENERATION_VERSION) {
    list(record.lecture.chapters).forEach((chapter, ci) => {
      list(chapter?.topics).forEach((topic, ti) => {
        if (!object(topic)) return;
        const title = redact(String(topic.title || `主题 ${ti + 1}`));
        entries.push({ id: `lecture:${ci}:${ti}`, kind: 'lecture', title,
          path: [redact(String(chapter.title || `章节 ${ci + 1}`)), title],
          content: safe(topic), source: provenance(topic) });
      });
    });
  }
  list(record.blocks).forEach((block, index) => {
    if (!object(block)) return;
    const title = redact(String(block.title || block.tag?.summary || block.tag?.title || `原始片段 ${index + 1}`));
    const sourceIndexes = [Number.isInteger(block.index) && block.index >= 0 ? block.index : index];
    const content = safe(block), source = provenance(block, sourceIndexes);
    if (block.tag?.role === '支线') entries.push({ id: `branch:${index}`, kind: 'branch', title,
      path: ['支线', title], content: safe(block), source: provenance(block, sourceIndexes) });
    entries.push({ id: `source:${index}`, kind: 'source', title, path: ['原始资料', title], content, source });
  });
  return entries;
}

/** Metadata allowlist: a catalog must not carry any body or private record fields. */
export function catalogEntry(entry) {
  const result = { id: entry.id, kind: entry.kind, title: safe(entry.title),
    path: list(entry.path).map(safe), source: provenance(entry.source ?? {}) };
  for (const key of ['courseId', 'subId']) if (entry[key] !== undefined) result[key] = safe(entry[key]);
  return result;
}

/** Literal AND matching; title hits outrank path hits, then body hits. Stable ties. */
export function searchEntries(entries, query) {
  const tokens = [...new Set(String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean))];
  if (!tokens.length) return [];
  return list(entries).flatMap((entry, index) => {
    const catalog = catalogEntry(entry);
    const title = String(catalog.title ?? '').toLowerCase();
    const path = catalog.path.join(' ').toLowerCase();
    const text = JSON.stringify(safe(entry.content) ?? '').replace(/\s+/g, ' ');
    const lower = text.toLowerCase();
    if (!tokens.every(token => title.includes(token) || path.includes(token) || lower.includes(token))) return [];
    const rank = tokens.reduce((score, token) => score + (title.includes(token) ? 10 : path.includes(token) ? 5 : 1), 0);
    const hit = tokens.map(token => lower.indexOf(token)).filter(position => position >= 0);
    const start = Math.max(0, (hit.length ? Math.min(...hit) : 0) - 60);
    const snippet = (start ? '…' : '') + text.slice(start, start + 236) + (text.length > start + 236 ? '…' : '');
    return [{ ...catalog, rank, snippet, order: index }];
  }).sort((a, b) => b.rank - a.rank || a.order - b.order).map(({ order, ...entry }) => entry);
}
