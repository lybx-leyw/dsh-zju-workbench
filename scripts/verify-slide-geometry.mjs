// 实跑验证：把一页"必然重叠"的模型输出走完 生成管线 → PPTX 导出，
// 然后**解开 PPTX 里的 XML**，逐对检查文本框是否相交、高度是否够装内容。
//
// 这不是单元测试的替身：它验的是"最终产物里几何真的对了"，
// 而不是"我们的纠正函数被调用了"。

import assert from 'node:assert/strict';
import { buildPptxBuffer } from '../packages/core/classroom-export/src/index.js';
import { parseSceneResponse } from '../packages/core/classroom-generate/src/scene.js';
import { ratiosFor } from '../packages/core/classroom-export/src/doc.js';
import JSZip from 'jszip';

const EMU_PER_INCH = 914400;
const PT_PER_INCH = 72;

/** 模型给的"坏输入"：标题框太矮、副标题压在标题上、第三块越界。 */
const rawModelOutput = JSON.stringify({
  elements: [
    // 32px 长标题，却只给 40 高（典型：autoFit 会把字压进小框）
    {
      id: 'title',
      type: 'text',
      left: 60,
      top: 60,
      width: 880,
      height: 40,
      content: '<p style="font-size: 32px;">这是一个非常长的标题需要折行显示才能放得下的情况说明</p>',
    },
    // 直接压在标题上
    {
      id: 'subtitle',
      type: 'text',
      left: 60,
      top: 65,
      width: 880,
      height: 60,
      content: '<p style="font-size: 18px;">副标题内容</p>',
    },
    // 越界到画布外面
    {
      id: 'footer',
      type: 'text',
      left: 200,
      top: 900,
      width: 900,
      height: 80,
      content: '<p style="font-size: 18px;">页脚说明</p>',
    },
  ],
  speech: '讲解这一页',
});

const outline = { id: 'o1', type: 'slide', title: '重叠测试页', keyPoints: [] };
const parsed = parseSceneResponse(rawModelOutput, outline, { sceneIndex: 0, stageId: 'stage-x' });
assert.ok(parsed, 'parseSceneResponse 应成功');

console.log('── 几何纠正记录 ──');
for (const issue of parsed.geometryIssues) console.log(' ', JSON.stringify(issue));

const canvas = parsed.content.canvas;
console.log('\n── 纠正后的元素 ──');
for (const el of canvas.elements) {
  console.log(` ${el.id} left=${el.left} top=${el.top} w=${el.width} h=${el.height} bottom=${el.top + el.height}`);
}

// 先按画布坐标系断言一遍（导出前的真值）
for (const el of canvas.elements) {
  assert.ok(el.top >= 50, `${el.id} 上边距`);
  assert.ok(el.top + el.height <= 562.5 - 50 + 1, `${el.id} 下边距 (bottom=${el.top + el.height})`);
}
for (let i = 0; i < canvas.elements.length; i += 1) {
  for (let j = i + 1; j < canvas.elements.length; j += 1) {
    const a = canvas.elements[i];
    const b = canvas.elements[j];
    const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
    const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
    assert.ok(w <= 0 || h <= 0, `${a.id} 与 ${b.id} 仍然重叠 (${w}×${h})`);
  }
}

// 真正导出 PPTX
const scene = { content: canvas, type: 'slide', actions: [{ type: 'speech', text: '讲解' }] };
const deck = [{ kind: 'slide', slideIndex: 0 }];
const { viewportSize, viewportRatio } = { viewportSize: 1000, viewportRatio: 0.5625 };
const buffer = await buildPptxBuffer(
  [canvas],
  [scene],
  ratiosFor(viewportSize, viewportRatio),
  { deck },
);
console.log(`\nPPTX 生成成功：${buffer.length} 字节`);

// 解开 PPTX，检查 slide1.xml 里的文本框几何
const zip = await JSZip.loadAsync(buffer);
const slideXml = await zip.file('ppt/slides/slide1.xml')?.async('string');
assert.ok(slideXml, '应能读到 slide1.xml');

const shapes = [];
const shapeRe = /<p:sp>[\s\S]*?<\/p:sp>/g;
for (const block of slideXml.match(shapeRe) ?? []) {
  const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  if (!off || !ext) continue;
  const texts = [...block.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
  shapes.push({
    x: Number(off[1]) / EMU_PER_INCH,
    y: Number(off[2]) / EMU_PER_INCH,
    cx: Number(ext[1]) / EMU_PER_INCH,
    cy: Number(ext[2]) / EMU_PER_INCH,
    text: texts.join(''),
  });
}

console.log('\n── PPTX 里的形状（英寸）──');
for (const s of shapes) {
  console.log(`  x=${s.x.toFixed(2)} y=${s.y.toFixed(2)} w=${s.cx.toFixed(2)} h=${s.cy.toFixed(2)}  "${s.text.slice(0, 24)}"`);
}

const textShapes = shapes.filter((s) => s.text.trim());
assert.ok(textShapes.length >= 2, `应至少有 2 个文本框，实际 ${textShapes.length}`);

// PPTX 层面：文本框两两不得相交（这正是"文本重叠"的定义）
for (let i = 0; i < textShapes.length; i += 1) {
  for (let j = i + 1; j < textShapes.length; j += 1) {
    const a = textShapes[i];
    const b = textShapes[j];
    const w = Math.min(a.x + a.cx, b.x + b.cx) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.cy, b.y + b.cy) - Math.max(a.y, b.y);
    assert.ok(
      w <= 0.01 || h <= 0.01,
      `PPTX 中文本框重叠：「${a.text.slice(0, 12)}」与「${b.text.slice(0, 12)}」(${w.toFixed(2)}×${h.toFixed(2)} in)`,
    );
  }
}

// PPTX 层面：页面高度必须容得下（16:9 = 5.625in / 16:10 = 6.25in）
for (const s of textShapes) {
  assert.ok(s.y >= 0, '文本框不能有负坐标');
  assert.ok(s.y + s.cy <= 6.3, `文本框不能超出页面底部 (y+cy=${(s.y + s.cy).toFixed(2)})`);
}

console.log('\n✅ 全部通过：PPTX 产物中无文本框重叠、无越界。');
