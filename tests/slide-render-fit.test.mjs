/**
 * 课件渲染器：文本与公式不能因「格子高度」被裁掉。
 *
 * # 这条测试防的是什么
 *
 * 模型生成课件时会把每个元素放进一个**估计的格子**：`{left, top, width, height}`。
 * 实测它经常把 `height` 估成 `fontSize × 1.5` —— 例如标题 `fontSize:28 / height:42`，
 * 28 × 1.5 = 42，**零余量**。而真实行高由字体度量（ascent/descent）决定，
 * 中文粗体、字体回退、加粗都会让它略大于 1.5em。
 *
 * 一旦渲染器把 `height` 当硬约束并配 `overflow:hidden`，表现就是
 * **标题被齐刷刷裁掉上半截** —— 元素坐标完全正确，看不出是高度问题。
 * 用户的实际反馈就是「AI 教学出的 ppt 标题渲染不清晰」。
 *
 * KaTeX 公式同理且更严重：多行公式（矩阵、分段函数、长分式）的实际高度
 * 可以是格子的两倍。
 *
 * # 所以钉住三条契约
 *
 *   1. text / latex 用 `minHeight`（高度是下限，内容长了允许撑开）
 *   2. text / latex **不设** `overflow:hidden`
 *   3. shape / image 仍用固定 `height`（它们的尺寸就是图形本身）
 *
 * 真实渲染验证见 `.verify-scratch/check-text-clip.py`（扫全部 12 页，无裁切）。
 *
 * 用法：node tests/slide-render-fit.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = fs.readFileSync(
  path.join(ROOT, 'packages/core/classroom-renderer/src/view/slide.jsx'),
  'utf8',
);
const CSS = fs.readFileSync(
  path.join(ROOT, 'packages/core/classroom-renderer/src/style.css'),
  'utf8',
);

/**
 * 取出单个函数的源码（从 `marker` 到该函数收尾的顶层 `}`）。
 *
 * 仓库文件是 CRLF：按 `lines[n] === '}'` 收尾永远不成立（实际行尾多一个回车），
 * 必须 `trimEnd()`。这一条踩过一次 —— 取到的块多出 100 行，
 * 把后面 renderShape 的 `height:'100%'` 也算进来，测试就误报了。
 */
function blockOf(marker) {
  const i = SRC.indexOf(marker);
  assert.ok(i >= 0, `找不到 ${marker}`);
  const lines = SRC.slice(i).split('\n');
  const out = [lines[0]];
  for (let n = 1; n < lines.length; n += 1) {
    out.push(lines[n]);
    if (lines[n].trimEnd() === '}') break;
  }
  return out.join('\n');
}

test('文本渲染用 minHeight，不把模型估的 height 当硬约束', () => {
  const block = blockOf('function renderText(element)');
  assert.match(block, /minHeight:\s*'100%'/, 'text 必须用 minHeight');
  assert.ok(
    !/^\s*height:\s*'100%'/m.test(block),
    'text 不能用 height:100% —— 那是把格子高度当硬上限',
  );
});

test('文本渲染不设 overflow:hidden（否则超出部分被裁头）', () => {
  const block = blockOf('function renderText(element)');
  assert.ok(
    !/overflow:\s*'hidden'/.test(block),
    'text 不能 overflow:hidden —— 宁可压到下一行，也不能让标题断头',
  );
});

test('公式渲染同样不被裁', () => {
  const block = blockOf('function renderLatex(element)');
  assert.match(block, /minHeight:\s*'100%'/, 'latex 必须用 minHeight');
  assert.ok(
    !/overflow:\s*'hidden'/.test(block),
    'latex 不能 overflow:hidden —— 多行公式的高度可以是格子的两倍',
  );
});

test('shape 与 image 仍用固定 height（它们的尺寸就是图形本身）', () => {
  assert.match(
    SRC,
    /element\.type === 'text' \|\| element\.type === 'latex'/,
    '找不到 minHeight 分支条件',
  );
  assert.match(SRC, /minHeight:\s*Math\.max\(1, num\(element\.height\) \* scale\)/);
  assert.match(
    SRC,
    /height:\s*Math\.max\(1, num\(element\.height\) \* scale\)/,
    'shape/image 仍要有固定 height 分支',
  );
});

test('行高默认值低于 1.5（给字体度量留余量）', () => {
  const block = blockOf('function renderText(element)');
  const m = block.match(/lineHeight:\s*element\.lineHeight \?\?\s*([\d.]+)/);
  assert.ok(m, '找不到行高默认值');
  const lh = Number(m[1]);
  assert.ok(lh < 1.5, `行高 ${lh} 不小于 1.5 —— 与「height = font×1.5」的格子叠加会卡死`);
  assert.ok(lh >= 1.2, `行高 ${lh} 太小，中文会挤在一起`);
});

test('段落默认 margin 被压掉（否则首行被顶出格子）', () => {
  assert.match(CSS, /\.zyc-slide p\s*\{\s*margin:\s*0;/, '必须压掉 <p> 的默认 margin');
});

test('文本保留换行与长词折行', () => {
  const block = blockOf('function renderText(element)');
  assert.match(block, /whiteSpace:\s*'pre-wrap'/);
  assert.match(block, /overflowWrap:\s*'break-word'/);
});
