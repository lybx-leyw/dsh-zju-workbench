const main = block => block.tag?.role === '主线' && block.cleanStatus !== 'incomplete' && block.lectureEligible !== false && !(block.tag?.facets ?? []).some(f=>['教学安排','作业','元信息','通知'].includes(f));
const strings = value => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(strings).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value).filter(([key]) => ['text','stem','solution','content','explanation','definition','formula','statement','passages','blocks'].includes(key)).map(([,part]) => strings(part)).filter(Boolean).join('\n');
};
const indexes = topic => {
  const found = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const key of ['sourceBlockIndexes','blockIndexes']) for (const index of value[key] ?? []) if (Number.isInteger(index)) found.add(index);
    for (const key of ['blocks','passages']) for (const part of value[key] ?? []) visit(part);
  };
  visit(topic); return [...found];
};

/** Stable within one source revision; material and anchors always come from the host record. */
export function knowledgePoints(record) {
  const out = [], revision = record.lecture?.revision ?? record.sourceVersion ?? record.fetchedAt;
  const lecture = record.lecture?.generationVersion === 'architecture-v4' ? record.lecture : null;
  const chapters = record.semanticPlan?.length ? record.semanticPlan : lecture?.chapters ?? [];
  for (const [ci, chapter] of chapters.entries()) for (const [ti, topic] of (chapter.topics ?? []).entries()) {
    const ids = indexes(topic);
    const semantic = (record.semanticPlan ?? []).flatMap(c => c.topics ?? []).find(t => t.title === topic.title);
    const range = Number.isInteger(topic.from) ? topic : semantic;
    const blocks = (record.blocks ?? []).filter(block => main(block) && (ids.length ? ids.includes(block.index) : range && range.from <= block.index && block.index <= range.to));
    const source = blocks.map(block => block.text || (block.sentences ?? []).map(line => line.text ?? '').join('')).join('\n');
    const written = (lecture?.chapters ?? []).flatMap(c=>c.topics ?? []).find(t=>t.title === topic.title);
    const text = strings(topic) || strings(written) || source;
    if (!text.trim()) continue;
    const anchor = blocks[0];
    out.push({ id: `${record.courseId}:${record.subId}:${revision}:${ci}:${ti}`, courseId: record.courseId, subId: record.subId,
      courseTitle: record.courseTitle ?? record.courseId, lessonTitle: record.lessonTitle ?? record.title ?? record.subId,
      chapterIndex:ci,topicIndex:ti,chapterTitle: chapter.title, title: topic.title || `知识点 ${ti + 1}`, revision, blockIndexes: blocks.map(b => b.index),
      page: anchor?.page ?? null, atSec: anchor?.startMs != null ? Math.floor(anchor.startMs / 1000) : null, text });
  }
  return out;
}

/** Both UI cards and the question bank use this projection, including v4 tree-only results. */
export function knowledgeChapters(record) {
  const grouped = new Map();
  for (const point of knowledgePoints(record ?? {})) {
    if (!grouped.has(point.chapterIndex)) grouped.set(point.chapterIndex,{title:point.chapterTitle,topics:[]});
    grouped.get(point.chapterIndex).topics.push({title:point.title,pointId:point.id,blockIndexes:point.blockIndexes,
      from:point.blockIndexes.length?Math.min(...point.blockIndexes):null,to:point.blockIndexes.length?Math.max(...point.blockIndexes):null});
  }
  return [...grouped.values()];
}
