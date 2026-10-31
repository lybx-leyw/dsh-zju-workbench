// 诊断：几何自检对**真实模型输出**的覆盖度。
//
// 前一个诊断证明了导出换算零偏差，所以"对齐糟糕"只可能来自
//   (a) 模型给的坐标本身重叠 → 我的 reconcileSlideGeometry 该拦住
//   (b) 自检没覆盖到的重叠形态 → 这就是漏网之鱼
//
// 本脚本枚举几类**真实模型常犯**的布局错误，看自检是否都能修正。

import { parseSceneResponse } from '../packages/dsh-zhiyun-core-classroom-generate/src/scene.js';

const outline = { id: 'o1', type: 'slide', title: '诊断页', keyPoints: [] };

/** 富文本：真实模型爱用 <p> 嵌套 + 内联样式，高度难以预估。 */
function mk(elements) {
  return JSON.stringify({ elements, speech: 'x' });
}

const cases = [
  {
    name: 'A. 标题框太矮（3 行字塞进 1 行高度）',
    elements: [
      { id: 't1', type: 'text', left: 60, top: 60, width: 880, height: 40, content: `<p style="font-size: 28px;">${'这是一个需要折行显示的很长的标题'.repeat(3)}</p>` },
    ],
  },
  {
    name: 'B. 正文与标题上下相接（无间距）',
    elements: [
      { id: 't1', type: 'text', left: 60, top: 60, width: 880, height: 76, content: '<p style="font-size: 32px;">标题</p>' },
      { id: 't2', type: 'text', left: 60, top: 136, width: 880, height: 130, content: '<p style="font-size: 18px;">正文紧贴着标题底边</p>' },
    ],
  },
  {
    name: 'C. 三栏但宽度算错（总宽溢出画布）',
    elements: [
      { id: 'c1', type: 'text', left: 60, top: 200, width: 340, height: 130, content: '<p style="font-size: 18px;">栏一</p>' },
      { id: 'c2', type: 'text', left: 380, top: 200, width: 340, height: 130, content: '<p style="font-size: 18px;">栏二</p>' },
      { id: 'c3', type: 'text', left: 700, top: 200, width: 340, height: 130, content: '<p style="font-size: 18px;">栏三</p>' },
    ],
  },
  {
    name: 'D. 文字压在色块上（有意嵌套，不该被拆开）',
    elements: [
      { id: 'bg', type: 'shape', left: 60, top: 150, width: 400, height: 120, path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z', viewBox: [1, 1], fill: '#e8f4fd' },
      { id: 'lb', type: 'text', left: 80, top: 172, width: 360, height: 76, content: '<p style="font-size: 18px;">卡片文字</p>' },
    ],
  },
  {
    name: 'E. 多段 <p> 但高度只按一段给（真实高频）',
    elements: [
      { id: 't1', type: 'text', left: 60, top: 200, width: 880, height: 58, content: '<p style="font-size: 18px;">第一段内容</p><p style="font-size: 18px;">第二段内容</p><p style="font-size: 18px;">第三段内容</p>' },
    ],
  },
  {
    name: 'F. 元素完全重合（模型复制粘贴错误）',
    elements: [
      { id: 't1', type: 'text', left: 60, top: 200, width: 880, height: 76, content: '<p style="font-size: 24px;">甲</p>' },
      { id: 't2', type: 'text', left: 60, top: 200, width: 880, height: 76, content: '<p style="font-size: 24px;">乙</p>' },
    ],
  },
  {
    name: 'G. 高度远超画布（内容过多）',
    elements: [
      { id: 't1', type: 'text', left: 60, top: 60, width: 880, height: 200, content: `<p style="font-size: 18px;">${'很长的一段话'.repeat(30)}</p>` },
      { id: 't2', type: 'text', left: 60, top: 500, width: 880, height: 200, content: '<p style="font-size: 18px;">底部内容</p>' },
    ],
  },
];

const MAX_BOTTOM = 562.5 - 50;

let failures = 0;
for (const c of cases) {
  const parsed = parseSceneResponse(mk(c.elements), outline, { sceneIndex: 0, stageId: 's' });
  const els = parsed.content.canvas.elements;
  const issues = parsed.geometryIssues ?? [];

  console.log(`\n【${c.name}】`);
  console.log(`  纠正记录: ${issues.length ? issues.map((i) => i.code).join(', ') : '（无）'}`);
  for (const el of els) {
    console.log(`    ${el.id.padEnd(4)} l=${String(el.left).padStart(4)} t=${String(Math.round(el.top)).padStart(4)} w=${String(el.width).padStart(4)} h=${String(Math.round(el.height)).padStart(4)} bottom=${Math.round(el.top + el.height)}`);
  }

  // 逐项检查
  const problems = [];
  for (const el of els) {
    if (el.left < 50) problems.push(`${el.id} 左边距 ${el.left} < 50`);
    if (el.left + el.width > 1000 - 50 + 1) problems.push(`${el.id} 右边界 ${el.left + el.width} 越界`);
    if (el.top < 50) problems.push(`${el.id} 上边距 ${el.top} < 50`);
    if (el.top + el.height > MAX_BOTTOM + 1) problems.push(`${el.id} 底边 ${Math.round(el.top + el.height)} 越界`);
  }
  // 非嵌套相交
  for (let i = 0; i < els.length; i += 1) {
    for (let j = i + 1; j < els.length; j += 1) {
      const a = els[i], b = els[j];
      const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
      const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
      if (w > 0 && h > 0) {
        const nested = a.type !== 'text' && (b.left >= a.left && b.top >= a.top && b.left + b.width <= a.left + a.width && b.top + b.height <= a.top + a.height);
        const nested2 = b.type !== 'text' && (a.left >= b.left && a.top >= b.top && a.left + a.width <= b.left + b.width && a.top + a.height <= b.top + b.height);
        if (!nested && !nested2) problems.push(`${a.id} 与 ${b.id} 相交 (${w.toFixed(0)}×${h.toFixed(0)})`);
      }
    }
  }

  if (problems.length) {
    failures += 1;
    console.log(`  ❌ ${problems.join('；')}`);
  } else {
    console.log('  ✅ 通过');
  }
}

console.log(`\n${failures === 0 ? '✅ 全部用例通过' : `❌ ${failures} 个用例仍有问题`}`);
