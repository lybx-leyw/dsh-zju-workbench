/**
 * 把知识库的跨课命中折成目录上的一行。
 * 一节一行，只取第一段原文，避免一条终稿把目录撑满。
 */

export function corpusRows(hits, courses, { limit = 20 } = {}) {
  const rows = [];
  for (const hit of hits ?? []) {
    const course = (courses ?? []).find((item) => String(item.id) === String(hit.courseId));
    const match = hit.matches?.[0];
    const text = typeof match?.text === "string" ? match.text.replace(/\s+/g, " ").trim() : "";
    rows.push({
      courseId: String(hit.courseId),
      subId: String(hit.subId),
      title: course?.title || `课程 ${hit.courseId}`,
      snippet: text.length > 80 ? `${text.slice(0, 80)}…` : text,
    });
    if (rows.length >= limit) break;
  }
  return { rows, truncated: (hits?.length ?? 0) > rows.length };
}
