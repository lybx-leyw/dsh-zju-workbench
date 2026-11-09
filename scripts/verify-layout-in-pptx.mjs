// 端到端验证：布局修复在 **真实 PPTX 产物** 里生效。
//
// 前一个诊断证明坐标换算是零偏差的；本脚本证明"间距/并排"的修复
// 真的落到了导出的 XML 上，而不只是内存里的数据好看。

import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { buildPptxBuffer } from '../packages/core/classroom-export/src/index.js';
import { ratiosFor } from '../packages/core/classroom-export/src/doc.js';
import { parseSceneResponse } from '../packages/core/classroom-generate/src/scene.js';

const EMU = 914400;
const MIN_GAP = 16;
const ratioPx2Inch = 96 * (1000 / 960);

/** 模型给的"糟糕"输入：标题与正文紧贴 + 三栏溢出。 */
const raw = JSON.stringify({
  elements: [
    { id: 'title', type: 'text', left: 60, top: 60, width: 880, height: 76, content: '<p style="font-size: 32px;">二叉搜索树</p>' },
    // 紧贴标题底边（136），无间距
    { id: 'body', type: 'text', left: 60, top: 136, width: 880, height: 130, content: '<p style="font-size: 18px;">正文内容</p>' },
    // 三栏，总宽溢出
    { id: 'c1', type: 'text', left: 60, top: 320, width: 340, height: 120, content: '<p style="font-size: 18px;">左栏</p>' },
    { id: 'c2', type: 'text', left: 380, top: 320, width: 340, height: 120, content: '<p style="font-size: 18px;">中栏</p>' },
    { id: 'c3', type: 'text', left: 700, top: 320, width: 340, height: 120, content: '<p style="font-size: 18px;">右栏</p>' },
  ],
  speech: 'x',
});

const parsed = parseSceneResponse(raw, { id: 'o', type: 'slide', title: 'T', keyPoints: [] }, { sceneIndex: 0, stageId: 's' });
const canvas = parsed.content.canvas;

console.log('── 生成侧纠正记录 ──');
for (const issue of parsed.geometryIssues) console.log(' ', JSON.stringify(issue));
console.log('\n── 纠正后的坐标（px）──');
for (const el of canvas.elements) {
  console.log(`  ${el.id.padEnd(6)} l=${String(el.left).padStart(4)} t=${String(Math.round(el.top)).padStart(4)} w=${String(el.width).padStart(4)} h=${String(Math.round(el.height)).padStart(4)}`);
}

const scene = { id: 's1', type: 'slide', order: 1, content: canvas, actions: [] };
const buffer = await buildPptxBuffer([canvas], [scene], ratiosFor(1000, 0.5625), { deck: [{ kind: 'slide', slideIndex: 0 }] });
const zip = await JSZip.loadAsync(buffer);
const xml = await zip.file('ppt/slides/slide1.xml').async('string');

const shapes = [];
for (const block of xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []) {
  const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  if (!off || !ext) continue;
  const texts = [...block.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('');
  shapes.push({
    key: texts.includes('二叉搜索树') ? 'title'
      : texts.includes('正文') ? 'body'
        : texts.includes('左栏') ? 'c1' : texts.includes('中栏') ? 'c2' : texts.includes('右栏') ? 'c3' : null,
    x: Number(off[1]) / EMU,
    y: Number(off[2]) / EMU,
    w: Number(ext[1]) / EMU,
    h: Number(ext[2]) / EMU,
  });
}

console.log('\n── PPTX 产物（英寸 → px）──');
for (const s of shapes.filter((x) => x.key)) {
  console.log(`  ${s.key.padEnd(6)} l=${(s.x * ratioPx2Inch).toFixed(0).padStart(4)} t=${(s.y * ratioPx2Inch).toFixed(0).padStart(4)} w=${(s.w * ratioPx2Inch).toFixed(0).padStart(4)} h=${(s.h * ratioPx2Inch).toFixed(0).padStart(4)}`);
}

const get = (key) => shapes.find((s) => s.key === key);

// 1) 标题与正文在 PPTX 里必须有间距
const title = get('title');
const body = get('body');
assert.ok(title && body);
const gapPx = (body.y - (title.y + title.h)) * ratioPx2Inch;
console.log(`\n标题↔正文 间距: ${gapPx.toFixed(1)} px`);
assert.ok(gapPx >= MIN_GAP - 1, `PPTX 里标题与正文间距 ${gapPx.toFixed(1)}px 不足 ${MIN_GAP}px`);

// 2) 三栏在 PPTX 里必须同高、水平分离
const cols = ['c1', 'c2', 'c3'].map(get);
assert.ok(cols.every(Boolean), '三栏都要在 PPTX 里');
const colTops = cols.map((c) => c.y);
assert.ok(Math.max(...colTops) - Math.min(...colTops) < 0.01, '三栏必须同一基线');
for (let i = 1; i < cols.length; i += 1) {
  const sep = (cols[i].x - (cols[i - 1].x + cols[i - 1].w)) * ratioPx2Inch;
  assert.ok(sep >= -0.5, `第 ${i} 栏与前一栏水平重叠 ${sep.toFixed(1)}px`);
}

// 3) 不越界
for (const s of shapes.filter((x) => x.key)) {
  assert.ok(s.x >= 0.4, `${s.key} 左越界`);
  assert.ok((s.x + s.w) <= 9.6, `${s.key} 右越界`);
  assert.ok((s.y + s.h) <= 5.2, `${s.key} 底越界`);
}

console.log('\n✅ PPTX 产物验证通过：间距足、三栏并排、无越界。');
