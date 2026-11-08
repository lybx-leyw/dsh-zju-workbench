export const GRAPH_CARD_WIDTH = 316;
export const chapterKey = (lessonIndex, chapterIndex) => `${lessonIndex}:${chapterIndex}`;

const heightOf = (item, index, expanded, collapsed) => 62 + (collapsed.has(index) ? 0 : (item.chapters ?? []).reduce((height, chapter, ci) => height + 34 + (expanded.has(chapterKey(index, ci)) ? (chapter.topics?.length ?? 0) * 30 + 6 : 0), 0)) + 8;

/** Choose the column count that gives the largest readable fit, preserving lesson order. */
export function layoutCourseGraph(items, expanded = new Set(), collapsed = new Set(), viewport = { width: 1000, height: 600 }) {
  let best;
  for (let columns = 1; columns <= Math.min(6, Math.max(1, items.length)); columns++) {
    const perColumn = Math.ceil(items.length / columns), heights = Array(columns).fill(144);
    const nodes = items.map((item, index) => {
      const column = Math.floor(index / perColumn), height = heightOf(item, index, expanded, collapsed);
      const node = { index, column, x: 32 + column * (GRAPH_CARD_WIDTH + 36), y: heights[column], width: GRAPH_CARD_WIDTH, height };
      heights[column] += height + 16;
      return node;
    });
    const width = Math.max(380, columns * (GRAPH_CARD_WIDTH + 36) + 16);
    const height = Math.max(240, ...heights);
    const score = Math.min((viewport.width - 40) / width, (viewport.height - 40) / height);
    if (!best || score > best.score) best = { nodes, width, height, columns, score };
  }
  return best;
}

export function fitCourseGraph(layout, viewport) {
  const scale = Math.max(0.02, Math.min(1, (viewport.width - 32) / layout.width, (viewport.height - 32) / layout.height));
  return { scale, x: (viewport.width - layout.width * scale) / 2, y: (viewport.height - layout.height * scale) / 2 };
}

export function zoomCourseGraph(camera, factor, point) {
  const scale = Math.max(0.02, Math.min(2.5, camera.scale * factor));
  return { scale, x: point.x - (point.x - camera.x) * scale / camera.scale, y: point.y - (point.y - camera.y) * scale / camera.scale };
}
