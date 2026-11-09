// 源：ref/OpenMAIC/lib/orchestration/summarizers/whiteboard-conflicts.ts:1-242
/**
 * 白板版式冲突检测（重叠 / 线穿元素 / 出血）。逐字搬运。
 *
 * 源：ref/OpenMAIC/lib/orchestration/summarizers/whiteboard-conflicts.ts:1-242
 */

const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 563;
const OVERLAP_THRESHOLD = 0.3; // intersection / min-area; flag if >= 30%

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

function elementLabel(el) {
  switch (el.type) {
    case 'text': {
      const t = stripHtml(el.content || '').slice(0, 24);
      return `text "${t}${t.length >= 24 ? '…' : ''}"`;
    }
    case 'latex': {
      const t = String(el.latex || '').slice(0, 24);
      return `latex "${t}${t.length >= 24 ? '…' : ''}"`;
    }
    case 'shape': {
      const t = el.text?.content ? stripHtml(el.text.content).slice(0, 16) : '';
      return t ? `shape "${t}"` : 'shape';
    }
    case 'table':
      return `table ${el.data?.length || 0}×${el.data?.[0]?.length || 0}`;
    case 'chart':
      return `chart[${el.chartType || 'unknown'}]`;
    case 'code':
      return `code(${el.language || 'unknown'})`;
    case 'image':
      return 'image';
    case 'line': {
      const pts = el.points;
      const arrow = pts?.includes('arrow') ? 'arrow' : 'line';
      return arrow;
    }
    default:
      return el.type || 'element';
  }
}

function toBBox(el) {
  if (el.type === 'line') return null;
  if (typeof el.left !== 'number' || typeof el.top !== 'number') return null;
  if (typeof el.width !== 'number' || typeof el.height !== 'number') return null;
  return {
    id: el.id || '',
    type: el.type,
    label: elementLabel(el),
    x: el.left,
    y: el.top,
    w: el.width,
    h: el.height,
  };
}

function toLineSeg(el) {
  if (el.type !== 'line') return null;
  const lx = el.left ?? 0;
  const ly = el.top ?? 0;
  const sx = el.start?.[0] ?? 0;
  const sy = el.start?.[1] ?? 0;
  const ex = el.end?.[0] ?? 0;
  const ey = el.end?.[1] ?? 0;
  return {
    id: el.id || '',
    label: elementLabel(el),
    x1: lx + sx,
    y1: ly + sy,
    x2: lx + ex,
    y2: ly + ey,
  };
}

/**
 * Relative overlap = intersection area / min(area_A, area_B).
 * 1.0 means one element is fully covered by the other.
 */
function relativeOverlap(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const minArea = Math.min(a.w * a.h, b.w * b.h);
  return minArea > 0 ? inter / minArea : 0;
}

function pointInRect(px, py, b) {
  return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
}

/** Standard CCW segment-segment intersection (proper crossing only). */
function segmentsIntersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  const ccw = (x1, y1, x2, y2, x3, y3) => (y3 - y1) * (x2 - x1) - (x3 - x1) * (y2 - y1);
  const d1 = ccw(bx1, by1, bx2, by2, ax1, ay1);
  const d2 = ccw(bx1, by1, bx2, by2, ax2, ay2);
  const d3 = ccw(ax1, ay1, ax2, ay2, bx1, by1);
  const d4 = ccw(ax1, ay1, ax2, ay2, bx2, by2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function lineCrossesBBox(line, b) {
  if (pointInRect(line.x1, line.y1, b) || pointInRect(line.x2, line.y2, b)) return true;
  const edges = [
    [b.x, b.y, b.x + b.w, b.y],
    [b.x + b.w, b.y, b.x + b.w, b.y + b.h],
    [b.x + b.w, b.y + b.h, b.x, b.y + b.h],
    [b.x, b.y + b.h, b.x, b.y],
  ];
  for (const [ex1, ey1, ex2, ey2] of edges) {
    if (segmentsIntersect(line.x1, line.y1, line.x2, line.y2, ex1, ey1, ex2, ey2)) return true;
  }
  return false;
}

function shortId(id) {
  return id ? `[${id.slice(0, 8)}]` : '';
}

/**
 * Build a text block listing all detected layout conflicts on the current
 * whiteboard. Returns empty string when there are no conflicts.
 *
 * @param {Array<Record<string, unknown>>} elements
 */
export function buildWhiteboardConflicts(elements) {
  if (!elements || elements.length === 0) return '';

  const bboxes = [];
  const lines = [];

  for (const el of elements) {
    if (el?.type === 'line') {
      const seg = toLineSeg(el);
      if (seg) lines.push(seg);
    } else {
      const b = toBBox(el);
      if (b) bboxes.push(b);
    }
  }

  const conflicts = [];

  // Pairwise overlap between bbox elements
  for (let i = 0; i < bboxes.length; i++) {
    for (let j = i + 1; j < bboxes.length; j++) {
      const ratio = relativeOverlap(bboxes[i], bboxes[j]);
      if (ratio >= OVERLAP_THRESHOLD) {
        conflicts.push(
          `OVERLAP: ${bboxes[i].label}${shortId(bboxes[i].id)} and ${bboxes[j].label}${shortId(bboxes[j].id)} share ${Math.round(ratio * 100)}% of the smaller one's area — they sit on top of each other.`,
        );
      }
    }
  }

  // Lines crossing element bboxes
  for (const line of lines) {
    for (const b of bboxes) {
      if (lineCrossesBBox(line, b)) {
        conflicts.push(
          `LINE CROSSES: ${line.label}${shortId(line.id)} from (${Math.round(line.x1)},${Math.round(line.y1)}) to (${Math.round(line.x2)},${Math.round(line.y2)}) passes through ${b.label}${shortId(b.id)} — the line is drawn over content.`,
        );
      }
    }
  }

  // Edge clipping
  for (const b of bboxes) {
    const out = [];
    if (b.x < 0) out.push(`left edge by ${Math.round(-b.x)}px`);
    if (b.y < 0) out.push(`top edge by ${Math.round(-b.y)}px`);
    if (b.x + b.w > CANVAS_WIDTH)
      out.push(`right edge by ${Math.round(b.x + b.w - CANVAS_WIDTH)}px`);
    if (b.y + b.h > CANVAS_HEIGHT)
      out.push(`bottom edge by ${Math.round(b.y + b.h - CANVAS_HEIGHT)}px`);
    if (out.length > 0) {
      conflicts.push(
        `OUT OF CANVAS: ${b.label}${shortId(b.id)} extends past ${out.join(', ')} — content is clipped.`,
      );
    }
  }

  if (conflicts.length === 0) return '';

  const linesOut = conflicts.map((c) => `  - ${c}`).join('\n');
  return `\n## ⚠ Layout Conflicts Detected (computed from current whiteboard JSON)
The following geometric conflicts exist on the board RIGHT NOW. Each entry is a real visible problem on the current board. You MUST address these before adding new content — either wb_delete one of the conflicting elements, or wb_clear and start fresh:
${linesOut}
`;
}
