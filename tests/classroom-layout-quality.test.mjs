// 布局质量的回归测试：间距、并排、同行对齐。
//
// 背景：PPTX 坐标换算经诊断证明是**零偏差**的（见 scripts/diagnose-pptx-geometry.mjs），
// 所以"对齐糟糕"只能来自生成侧几何。上一版自检只保证"不相交"，
// 于是两类问题漏网：
//   1. 元素紧贴（间距 0）—— 不相交，但视觉上挤成一团
//   2. 三栏布局被"推到下一行"—— 相交处理选错了维度，毁掉并排语义
//
// 这三个用例来自真实模型输出形态（scripts/diagnose-geometry-coverage.mjs）。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SLIDE_CANVAS_HEIGHT,
  SLIDE_CANVAS_WIDTH,
  SLIDE_MARGIN,
} from '../packages/core/classroom-generate/src/prompts.js';
import { parseSceneResponse, reconcileSlideGeometry } from '../packages/core/classroom-generate/src/scene.js';

const MIN_GAP = 16;
const maxBottom = SLIDE_CANVAS_HEIGHT - SLIDE_MARGIN;
const maxRight = SLIDE_CANVAS_WIDTH - SLIDE_MARGIN;

function box(el) {
  return {
    left: el.left,
    top: el.top,
    right: el.left + el.width,
    bottom: el.top + el.height,
  };
}

/** 两个矩形是否相交。 */
function intersects(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0;
}

// ── 1. 最小间距 ────────────────────────────────────────────────────────────

test('vertically adjacent elements get a visible gap', () => {
  const { elements, issues } = reconcileSlideGeometry([
    { id: 'title', type: 'text', left: 60, top: 60, width: 880, height: 76, content: '<p style="font-size: 32px;">标题</p>' },
    // 正好贴住标题底边（136 = 60 + 76）
    { id: 'body', type: 'text', left: 60, top: 136, width: 880, height: 130, content: '<p style="font-size: 18px;">正文</p>' },
  ]);

  const title = elements.find((e) => e.id === 'title');
  const body = elements.find((e) => e.id === 'body');
  const gap = body.top - (title.top + title.height);
  assert.ok(
    gap >= MIN_GAP - 1,
    `标题与正文之间必须有 ≥${MIN_GAP}px 间距，实际 ${gap}px（这就是"看起来对齐糟糕"的来源）`,
  );
  assert.ok(issues.length > 0, '应记录一次纠正');
});

test('three stacked text blocks all keep the minimum gap', () => {
  const { elements } = reconcileSlideGeometry([
    { id: 'a', type: 'text', left: 60, top: 60, width: 880, height: 76, content: '<p style="font-size: 24px;">甲</p>' },
    { id: 'b', type: 'text', left: 60, top: 136, width: 880, height: 76, content: '<p style="font-size: 24px;">乙</p>' },
    { id: 'c', type: 'text', left: 60, top: 212, width: 880, height: 76, content: '<p style="font-size: 24px;">丙</p>' },
  ]);
  const sorted = [...elements].sort((x, y) => x.top - y.top);
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i].top - (sorted[i - 1].top + sorted[i - 1].height);
    assert.ok(gap >= MIN_GAP - 1, `${sorted[i - 1].id}→${sorted[i].id} 间距 ${gap}px 不足`);
  }
});

// ── 2. 并排保持 ────────────────────────────────────────────────────────────

test('overflowing three-column row stays side by side (no vertical stacking)', () => {
  // 总宽 60+340+340+340 = 1080 > 可用 900，必然溢出
  const { elements } = reconcileSlideGeometry([
    { id: 'c1', type: 'text', left: 60, top: 200, width: 340, height: 130, content: '<p style="font-size: 18px;">栏一</p>' },
    { id: 'c2', type: 'text', left: 380, top: 200, width: 340, height: 130, content: '<p style="font-size: 18px;">栏二</p>' },
    { id: 'c3', type: 'text', left: 700, top: 200, width: 340, height: 130, content: '<p style="font-size: 18px;">栏三</p>' },
  ]);

  assert.equal(elements.length, 3);
  const tops = elements.map((e) => e.top);
  assert.equal(new Set(tops).size, 1, `三栏必须仍在同一行，实际 top 为 ${tops.join(',')}`);

  // 水平方向依次排列、互不相交、不超右边界
  const sorted = [...elements].sort((a, b) => a.left - b.left);
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(
      sorted[i].left >= sorted[i - 1].left + sorted[i - 1].width,
      `${sorted[i - 1].id} 与 ${sorted[i].id} 水平方向仍然重叠`,
    );
  }
  for (const el of elements) {
    assert.ok(el.left + el.width <= maxRight + 1, `${el.id} 右边界越界`);
  }
});

test('a two-column layout keeps both columns aligned on top', () => {
  const { elements } = reconcileSlideGeometry([
    { id: 'l', type: 'text', left: 60, top: 200, width: 420, height: 130, content: '<p style="font-size: 18px;">左</p>' },
    { id: 'r', type: 'text', left: 500, top: 210, width: 420, height: 130, content: '<p style="font-size: 18px;">右</p>' },
  ]);
  const l = elements.find((e) => e.id === 'l');
  const r = elements.find((e) => e.id === 'r');
  assert.equal(l.top, r.top, '并排的两栏必须基线一致');
});

test('side-by-side elements are not merged into one row when they fully overlap', () => {
  // 完全重合是复制粘贴错误，不是并排 —— 必须纵向拆开
  const { elements } = reconcileSlideGeometry([
    { id: 'a', type: 'text', left: 60, top: 200, width: 880, height: 76, content: '<p style="font-size: 24px;">甲</p>' },
    { id: 'b', type: 'text', left: 60, top: 200, width: 880, height: 76, content: '<p style="font-size: 24px;">乙</p>' },
  ]);
  const a = elements.find((e) => e.id === 'a');
  const b = elements.find((e) => e.id === 'b');
  assert.ok(!intersects(box(a), box(b)), '不得相交');
  assert.notEqual(a.top, b.top, '完全重合应纵向拆开，而不是左右等分');
  assert.equal(a.width, b.width, '宽度不该被改动（那不是并排）');
});

// ── 3. 综合：不越界、不相交 ────────────────────────────────────────────────

test('a messy real-world slide ends up inside margins with no overlap', () => {
  const raw = JSON.stringify({
    elements: [
      { id: 't', type: 'text', left: 60, top: 60, width: 880, height: 40, content: `<p style="font-size: 32px;">${'很长的标题'.repeat(6)}</p>` },
      { id: 'p1', type: 'text', left: 60, top: 90, width: 880, height: 60, content: '<p style="font-size: 18px;">紧贴标题</p>' },
      { id: 'p2', type: 'text', left: 20, top: 900, width: 1200, height: 80, content: '<p style="font-size: 18px;">越界且很宽</p>' },
    ],
    speech: 'x',
  });
  const parsed = parseSceneResponse(raw, { id: 'o', type: 'slide', title: 'T', keyPoints: [] }, { sceneIndex: 0, stageId: 's' });
  const els = parsed.content.canvas.elements;

  for (const el of els) {
    assert.ok(el.left >= SLIDE_MARGIN - 1, `${el.id} 左边距`);
    assert.ok(el.top >= SLIDE_MARGIN - 1, `${el.id} 上边距`);
    assert.ok(el.left + el.width <= maxRight + 1, `${el.id} 右边界`);
    assert.ok(el.top + el.height <= maxBottom + 1, `${el.id} 底边`);
  }
  for (let i = 0; i < els.length; i += 1) {
    for (let j = i + 1; j < els.length; j += 1) {
      assert.ok(!intersects(box(els[i]), box(els[j])), `${els[i].id} 与 ${els[j].id} 相交`);
    }
  }
});

test('deliberate text-inside-card nesting survives the new row logic', () => {
  const { elements } = reconcileSlideGeometry([
    { id: 'bg', type: 'shape', left: 60, top: 150, width: 400, height: 120, path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z', viewBox: [1, 1], fill: '#e8f4fd' },
    { id: 'label', type: 'text', left: 80, top: 172, width: 360, height: 76, content: '<p style="font-size: 18px;">卡片文字</p>' },
  ]);
  const bg = elements.find((e) => e.id === 'bg');
  const label = elements.find((e) => e.id === 'label');
  assert.ok(bg && label, '嵌套的两块都必须在');
  assert.ok(
    label.left >= bg.left && label.top >= bg.top
    && label.left + label.width <= bg.left + bg.width + 1
    && label.top + label.height <= bg.top + bg.height + 1,
    '文字仍应完整落在色块内（有意嵌套不该被拆开）',
  );
});
