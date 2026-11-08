import { normalizeLectureTree } from './tree.js';

export const GENERATION_VERSION = 'architecture-v4';

/** Shared bench/App orchestration. The parser owns structure; this only projects it. */
export async function generateLecture({ service, record, title = record.title ?? record.sourceId ?? '', signal, onProgress, onAssembled }) {
  if (record.tree?.kind !== 'title') throw Object.assign(new Error('请重新生成：解析结果缺少 v4 重构树'), { code: 'INPUT' });
  const meta = new Set(['教学安排', '作业', '元信息', '通知']);
  const blocks = record.blocks.filter(b => b.lectureEligible ?? (b.tag?.role === '主线' && b.cleanStatus !== 'incomplete'
    && !(b.tag?.facets ?? []).some(f => meta.has(f)))).map(b => ({
    index: b.index, page: b.page,
    text: b.text ?? (b.sentences ?? []).map(s => s.text ?? '').join(''),
    summary: b.tag?.summary ?? '', startMs: b.startMs ?? null,
  }));
  const tree = normalizeLectureTree(record.tree);
  onProgress?.({ phase: 'lecture', done: 0, total: tree.chapters.reduce((n, c) => n + c.topics.length, 0) });
  const assembled = await service.assemble({ tree, blocks, context: title, signal, onProgress });
  if (!assembled.chapters.length) throw Object.assign(new Error('没有可用讲义知识点'), { code: 'NO_TOPICS' });
  await onAssembled?.(assembled);
  onProgress?.({ phase: 'polish', done: 0, total: assembled.chapters.reduce((n, c) => n + c.topics.length, 0) });
  const polished = await service.polish({ lecture: { schema: 1, title, chapters: assembled.chapters },
    record: { blocks: record.blocks, outline: record.outline ?? [] }, sectionId: 'bench', signal, onProgress });
  return { assembled, polished, lecture: { ...polished.lecture, generationVersion: GENERATION_VERSION,
    warnings: [...(assembled.warnings ?? []), ...(polished.warnings ?? [])], failures: assembled.failures ?? [],
    polish: { complete: polished.complete !== false, failures: polished.failures ?? [], warnings: polished.warnings ?? [],
      changes: polished.changes ?? [], unchanged: polished.unchanged, cached: Boolean(polished.cached) } } };
}
