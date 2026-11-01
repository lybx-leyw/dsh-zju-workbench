// 诊断：PPTX 导出的坐标是否真的有偏差。
//
// 做法：造一页坐标**完全已知**的 slide（三个元素，位置/尺寸都是整数），
// 导出 PPTX，解开 XML，把每个形状的 EMU 反算回 px，与原始坐标逐个比对。
//
// 期望：反算值应精确等于输入坐标（允许微小取整误差）。
// 若发现系统性偏差（尤其纵向），那就是"对齐糟糕"的根因。

import JSZip from 'jszip';
import { buildPptxBuffer } from '../packages/dsh-zhiyun-core-classroom-export/src/index.js';
import { ratiosFor } from '../packages/dsh-zhiyun-core-classroom-export/src/doc.js';

const EMU_PER_INCH = 914400;

// 已知输入：画布 1000 × 562.5（与生成侧完全一致）
const canvas = {
  id: 'canvas-1',
  viewportSize: 1000,
  viewportRatio: 0.5625,
  theme: { backgroundColor: '#ffffff', fontColor: '#333333', fontName: 'Arial' },
  elements: [
    // 标题：左 60，上 60，宽 880，高 76
    { id: 'title', type: 'text', left: 60, top: 60, width: 880, height: 76, content: '<p style="font-size: 32px;">标题</p>' },
    // 正文：左 60，上 200，宽 520，高 130
    { id: 'body', type: 'text', left: 60, top: 200, width: 520, height: 130, content: '<p style="font-size: 18px;">正文</p>' },
    // 右栏：左 620，上 200，宽 320，高 130
    { id: 'side', type: 'text', left: 620, top: 200, width: 320, height: 130, content: '<p style="font-size: 18px;">右栏</p>' },
  ],
};

const scene = { id: 'scene-1', type: 'slide', order: 1, content: canvas, actions: [] };
const buffer = await buildPptxBuffer([canvas], [scene], ratiosFor(1000, 0.5625), { deck: [{ kind: 'slide', slideIndex: 0 }] });

const zip = await JSZip.loadAsync(buffer);
const xml = await zip.file('ppt/slides/slide1.xml').async('string');

// 读实际页面尺寸，判断版式是否与画布比例一致
const pres = await zip.file('ppt/presentation.xml').async('string');
const sz = pres.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
const pageW = Number(sz[1]) / EMU_PER_INCH;
const pageH = Number(sz[2]) / EMU_PER_INCH;

const ratioPx2Inch = 96 * (1000 / 960); // = 100
const canvasW = 1000 / ratioPx2Inch;
const canvasH = 562.5 / ratioPx2Inch;

console.log('── 页面几何 ──');
console.log(`  PPTX 页面:    ${pageW.toFixed(4)} × ${pageH.toFixed(4)} in  (比例 ${(pageW / pageH).toFixed(4)})`);
console.log(`  画布应有:     ${canvasW.toFixed(4)} × ${canvasH.toFixed(4)} in  (比例 ${(canvasW / canvasH).toFixed(4)})`);
const scaleX = pageW / canvasW;
const scaleY = pageH / canvasH;
console.log(`  横向缩放比:   ${scaleX.toFixed(4)}`);
console.log(`  纵向缩放比:   ${scaleY.toFixed(4)}`);
if (Math.abs(scaleX - scaleY) > 0.001) {
  console.log(`  ⚠️ 宽高缩放不一致！纵向被额外拉伸 ${(scaleY / scaleX).toFixed(4)} 倍`);
} else {
  console.log('  ✅ 宽高缩放一致');
}

// 抽出所有形状的 off/ext
const shapes = [];
for (const block of xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []) {
  const off = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = block.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  if (!off || !ext) continue;
  const texts = [...block.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('');
  shapes.push({
    x: Number(off[1]) / EMU_PER_INCH,
    y: Number(off[2]) / EMU_PER_INCH,
    w: Number(ext[1]) / EMU_PER_INCH,
    h: Number(ext[2]) / EMU_PER_INCH,
    text: texts,
  });
}

console.log('\n── 逐个元素比对（英寸）──');
let maxDx = 0, maxDy = 0, maxDw = 0, maxDh = 0;
for (const source of canvas.elements) {
  const expected = {
    x: (source.left / ratioPx2Inch) * scaleX,
    y: (source.top / ratioPx2Inch) * scaleY,
    w: (source.width / ratioPx2Inch) * scaleX,
    h: (source.height / ratioPx2Inch) * scaleY,
  };
  const actual = shapes.find((s) => s.text.includes(source.id === 'title' ? '标题' : source.id === 'body' ? '正文' : '右栏'));
  if (!actual) {
    console.log(`  ${source.id}: 未找到对应形状`);
    continue;
  }
  const dx = actual.x - expected.x;
  const dy = actual.y - expected.y;
  const dw = actual.w - expected.w;
  const dh = actual.h - expected.h;
  maxDx = Math.max(maxDx, Math.abs(dx));
  maxDy = Math.max(maxDy, Math.abs(dy));
  maxDw = Math.max(maxDw, Math.abs(dw));
  maxDh = Math.max(maxDh, Math.abs(dh));
  console.log(
    `  ${source.id.padEnd(6)} 期望(${expected.x.toFixed(3)},${expected.y.toFixed(3)} ${expected.w.toFixed(3)}×${expected.h.toFixed(3)})`
    + ` 实际(${actual.x.toFixed(3)},${actual.y.toFixed(3)} ${actual.w.toFixed(3)}×${actual.h.toFixed(3)})`
    + ` Δ(${dx.toFixed(3)},${dy.toFixed(3)},${dw.toFixed(3)},${dh.toFixed(3)})`,
  );
}

console.log(`\n最大偏差: dx=${maxDx.toFixed(3)} dy=${maxDy.toFixed(3)} dw=${maxDw.toFixed(3)} dh=${maxDh.toFixed(3)} (英寸)`);
console.log(`换算成 px: ${(maxDx * ratioPx2Inch).toFixed(1)} / ${(maxDy * ratioPx2Inch).toFixed(1)} px`);

// 检查相对位置是否被破坏：body 与 side 应左右并排、top 相同
const body = shapes.find((s) => s.text.includes('正文'));
const side = shapes.find((s) => s.text.includes('右栏'));
if (body && side) {
  console.log(`\n── 相对关系 ──`);
  console.log(`  body.top=${body.y.toFixed(3)}  side.top=${side.y.toFixed(3)}  差 ${Math.abs(body.y - side.y).toFixed(4)} in`);
  console.log(`  body.right=${(body.x + body.w).toFixed(3)}  side.left=${side.x.toFixed(3)}  间隙 ${(side.x - (body.x + body.w)).toFixed(3)} in`);
}
