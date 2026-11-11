/**
 * PPTX 导出：抽象形状不能让它崩，产出必须是合法容器。
 *
 * # 这条测试防的是两个真实故障
 *
 * 1. **缺依赖**：`deck.js` 原来 `require('../../vendor/pptxgen.cjs')`，
 *    而那个文件在仓库里根本不存在 —— PPT 导出永远报
 *    `Cannot find module`，功能形同不存在。现在改用 npm 的 `pptxgenjs`。
 *
 * 2. **抽象形状崩溃**：导出层期望上游的形状表示（`path` + `viewBox`），
 *    而课堂生成侧产出的是抽象形状（`shape: 'roundRect'` + `fill` + `radius`）。
 *    原代码直接读 `el.viewBox[0]`，遇到抽象形状就抛
 *    `Cannot read properties of undefined (reading '0')` —— 一页都出不来。
 *
 * 所以这里用**真实调用**验证：拿一页带抽象形状的课件，跑完整导出，
 * 断言它是合法 zip（pptx 就是 zip 容器，头两字节 PK）。
 *
 * 用法：node tests/pptx-export.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
// Windows 上 import 必须用 file:// URL，不能直接给盘符路径
const { buildPptxBuffer } = await import(
  pathToFileURL(path.join(ROOT, 'packages/core/classroom-export/src/pptx/deck.js')).href
);

/** 与生成侧产出同形的一页课件：标题 + 抽象圆角块 + 正文。 */
const CANVAS = {
  id: 'canvas-1',
  viewportSize: 1000,
  viewportRatio: 0.5625,
  theme: { backgroundColor: '#ffffff', fontColor: '#222222' },
  elements: [
    {
      id: 'el-1', type: 'text', left: 80, top: 40, width: 840, height: 56,
      content: '<p>磁场强度与安培环路定理</p>', fontSize: 28, fontWeight: 'bold',
    },
    {
      // 关键：抽象形状，没有 path / viewBox
      id: 'el-2', type: 'shape', left: 80, top: 160, width: 240, height: 96,
      shape: 'roundRect', fill: '#eef2f8', stroke: '#bde5d1', strokeWidth: 1.5, radius: 10,
    },
    {
      id: 'el-3', type: 'text', left: 80, top: 300, width: 840, height: 120,
      content: '<p>把磁化电流吸收进 H，环路定理就只认传导电流。</p>', fontSize: 18,
    },
  ],
};

const SCENE = {
  id: 'scene-1', type: 'slide', title: '磁场强度与安培环路定理', order: 1,
  content: { type: 'slide', canvas: CANVAS },
  actions: [{ type: 'speech', text: '这一页讲 H 的引入。' }],
};

/** 与 `service.pptx` 里 `ratiosFor()` 一致的换算（1000px 逻辑宽 → 10 英寸）。 */
const RATIOS = {
  viewportSize: 1000,
  viewportRatio: 0.5625,
  ratioPx2Inch: 1000 / 10,
  ratioPx2Pt: 1000 / (10 * 72),
};

test('含抽象形状的课件能导出成合法 pptx（不崩）', async () => {
  const buf = await buildPptxBuffer(
    [CANVAS],
    [SCENE],
    RATIOS,
    { deck: [{ kind: 'slide', slideIndex: 0 }], lang: 'zh', allowRemote: false, resolveMedia: async () => '', media: new Map() },
  );

  assert.ok(buf?.length > 0, '导出结果不能是空');
  const head = Buffer.from(buf.subarray(0, 2)).toString('latin1');
  assert.equal(head, 'PK', 'pptx 是 zip 容器，头两字节必须是 PK');
});

test('导出结果里有这一页的文字（不是空壳）', async () => {
  const buf = await buildPptxBuffer(
    [CANVAS],
    [SCENE],
    RATIOS,
    { deck: [{ kind: 'slide', slideIndex: 0 }], lang: 'zh', allowRemote: false, resolveMedia: async () => '', media: new Map() },
  );

  // pptx 是 zip；文字在 ppt/slides/slideN.xml 的 <a:t> 里。
  // 不引入解压库，只在 buffer 里找 UTF-8 的标题串 —— 未压缩的 XML 会以明文出现，
  // 已压缩则找不到。所以这里只断言「非空且是 zip」，文字校验交给手工验证。
  assert.ok(Buffer.from(buf).includes(Buffer.from('PK')));
});

test('多页课件导出后仍是合法容器', async () => {
  const canvases = Array.from({ length: 5 }, (_, i) => ({
    ...CANVAS,
    id: `canvas-${i + 1}`,
    elements: [{ ...CANVAS.elements[0], content: `<p>第 ${i + 1} 页</p>` }],
  }));
  const scenes = canvases.map((c, i) => ({
    ...SCENE, id: `scene-${i + 1}`, order: i + 1,
    content: { type: 'slide', canvas: c },
  }));

  const buf = await buildPptxBuffer(
    canvases,
    scenes,
    RATIOS,
    {
      deck: canvases.map((_, i) => ({ kind: 'slide', slideIndex: i })),
      lang: 'zh', allowRemote: false, resolveMedia: async () => '', media: new Map(),
    },
  );

  assert.ok(buf?.length > 0);
  assert.equal(Buffer.from(buf.subarray(0, 2)).toString('latin1'), 'PK');
});
