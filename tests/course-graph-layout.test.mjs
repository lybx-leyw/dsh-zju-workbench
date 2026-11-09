import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutCourseGraph, fitCourseGraph, zoomCourseGraph } from '../packages/client/page-study/src/course-graph-layout.js';

const items = Array.from({ length: 24 }, (_, index) => ({ lesson: { subId: String(index) }, chapters: Array.from({ length: 3 + index % 4 }, () => ({ title: '章节', topics: Array.from({ length: 6 }, () => ({ title: '知识点' })) })) }));

test('course atlas packs ordered lessons into multiple non-overlapping columns', () => {
  const layout = layoutCourseGraph(items);
  assert.ok(layout.columns > 1);
  assert.deepEqual(layout.nodes.map(node => node.index), items.map((_, index) => index));
  for (const node of layout.nodes) {
    assert.ok(node.x >= 0 && node.y >= 140);
    assert.ok(node.x + node.width <= layout.width);
    assert.ok(node.y + node.height <= layout.height);
    for (const other of layout.nodes) if (node !== other) assert.ok(node.x + node.width <= other.x || other.x + other.width <= node.x || node.y + node.height <= other.y || other.y + other.height <= node.y);
  }
});

test('expansion reserves space for every point; collapse restores compact lesson height', () => {
  const single = [items[0]];
  const base = layoutCourseGraph(single).nodes[0].height;
  const expanded = layoutCourseGraph(single, new Set(['0:0'])).nodes[0].height;
  assert.equal(expanded - base, 6 * 30 + 6);
  assert.equal(layoutCourseGraph(single, new Set(['0:0']), new Set([0])).nodes[0].height, 70);
});

test('fit keeps the complete map inside desktop and narrow viewports', () => {
  for (const viewport of [{ width: 1100, height: 650 }, { width: 360, height: 440 }]) {
    const layout = layoutCourseGraph(items, new Set(['0:0', '4:1']), new Set(), viewport);
    const camera = fitCourseGraph(layout, viewport);
    assert.ok(camera.x >= 0 && camera.y >= 0);
    assert.ok(camera.x + layout.width * camera.scale <= viewport.width);
    assert.ok(camera.y + layout.height * camera.scale <= viewport.height);
  }
});

test('zoom preserves the world point under the cursor and enforces limits', () => {
  const camera = { x: 30, y: 40, scale: 0.5 }, point = { x: 300, y: 240 };
  const next = zoomCourseGraph(camera, 1.2, point);
  assert.equal((point.x - camera.x) / camera.scale, (point.x - next.x) / next.scale);
  assert.equal((point.y - camera.y) / camera.scale, (point.y - next.y) / next.scale);
  assert.equal(zoomCourseGraph(camera, 100, point).scale, 2.5);
  assert.equal(zoomCourseGraph(camera, 0.0001, point).scale, 0.02);
  assert.equal(layoutCourseGraph([]).nodes.length, 0);
});
