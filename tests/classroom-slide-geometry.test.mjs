// 幻灯片几何回归测试：study 页导出 PPTX 文本重叠的根因与修复。
//
// # 这个测试锁的是什么
//
// 三件事，缺一件文本重叠就会回来：
//   1. prompt 必须要求**行内** font-size（顶层 fontSize 导出层不读）
//   2. prompt 必须带 Height Lookup Table，且与代码里的表同源
//   3. `reconcileSlideGeometry` 必须把"框太小装不下字"和"元素互相压住"确定性纠正掉
//
// 与上游对齐依据：vendor/openmaic/packages/@openmaic/generation/templates/
// slide-content/system.md 的 "Text Height Lookup Table" 与 Design Rules 1-6。

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SLIDE_CANVAS_HEIGHT,
  SLIDE_CANVAS_WIDTH,
  SLIDE_MARGIN,
  TEXT_HEIGHT_TABLE,
  buildScenePrompt,
  renderHeightTable,
} from '../packages/dsh-zhiyun-core-classroom-generate/src/prompts.js';
import {
  estimateTextLines,
  heightFor,
  measureTextContent,
  parseSceneResponse,
  reconcileSlideGeometry,
} from '../packages/dsh-zhiyun-core-classroom-generate/src/scene.js';

// ── 1. 高度查表必须与上游逐值一致 ──────────────────────────────────────────

test('height table matches upstream slide-content spec', () => {
  // 上游 system.md:454-463 的原文数值。
  assert.deepEqual(TEXT_HEIGHT_TABLE[14], [43, 64, 85, 106, 127]);
  assert.deepEqual(TEXT_HEIGHT_TABLE[16], [46, 70, 94, 118, 142]);
  assert.deepEqual(TEXT_HEIGHT_TABLE[18], [49, 76, 103, 130, 157]);
  assert.deepEqual(TEXT_HEIGHT_TABLE[20], [52, 82, 112, 142, 172]);
  assert.deepEqual(TEXT_HEIGHT_TABLE[24], [58, 94, 130, 166, 202]);
  assert.deepEqual(TEXT_HEIGHT_TABLE[28], [64, 106, 148, 190, 232]);
  assert.deepEqual(TEXT_HEIGHT_TABLE[32], [70, 118, 166, 214, 262]);
  assert.deepEqual(TEXT_HEIGHT_TABLE[36], [76, 130, 184, 238, 292]);
});

test('heightFor picks the nearest size at or above the request', () => {
  assert.equal(heightFor(24, 1), 58);
  assert.equal(heightFor(24, 3), 130);
  // 表里没有 22 → 用 24 那一档（宁可框大一点）
  assert.equal(heightFor(22, 1), 58);
  // 超出表的最大字号 → 落到最大档
  assert.equal(heightFor(48, 1), 76);
  // 超出 5 行 → 按字号 1.5 倍外推
  assert.equal(heightFor(18, 6), 157 + Math.round(18 * 1.5));
});

// ── 2. prompt 必须带查表与行内字号规则 ────────────────────────────────────

test('slide prompt embeds the height table verbatim', () => {
  const { system } = buildScenePrompt({ type: 'slide', title: 'T', keyPoints: [] }, { index: 0, total: 1 });
  assert.match(system, /高度查表/);
  assert.ok(renderHeightTable().includes('| 24px |'));
  // 表头与关键档位必须真的出现在 prompt 里
  assert.ok(system.includes('| 字号 | 1 行 | 2 行 | 3 行 | 4 行 | 5 行 |'));
  assert.ok(system.includes('| 24px | 58 | 94 | 130 | 166 | 202 |'));
  assert.ok(system.includes('| 36px | 76 | 130 | 184 | 238 | 292 |'));
});

test('slide prompt demands inline font-size and forbids top-level fontSize', () => {
  const { system } = buildScenePrompt({ type: 'slide', title: 'T', keyPoints: [] }, { index: 0, total: 1 });
  // 正确写法要出现
  assert.ok(system.includes('font-size: 24px;') || system.includes('font-size:24px'));
  // 必须明确警告顶层字段不生效
  assert.match(system, /fontSize/);
  assert.match(system, /不会被读取|不生效/);
});

test('slide prompt carries margins, padding and the no-overlap rule', () => {
  const { system } = buildScenePrompt({ type: 'slide', title: 'T', keyPoints: [] }, { index: 0, total: 1 });
  assert.ok(system.includes(String(SLIDE_CANVAS_WIDTH)));
  assert.ok(system.includes(String(SLIDE_CANVAS_HEIGHT)));
  assert.ok(system.includes(`≥ ${SLIDE_MARGIN}`), '四边边距必须落在 prompt 里');
  assert.match(system, /内边距/);
  assert.match(system, /禁止重叠/);
  // Rule 1/2 的两个公式
  assert.match(system, /characters_per_line/);
  assert.match(system, /total_lines/);
});

test('slide prompt example itself uses inline font-size', () => {
  const { system } = buildScenePrompt({ type: 'slide', title: 'T', keyPoints: [] }, { index: 0, total: 1 });
  // 示例 JSON 里不该再出现 `"fontSize": 36` 这种导出层读不到的写法
  assert.ok(!/"fontSize"\s*:/.test(system), '示例里不能示范顶层 fontSize');
  assert.match(system, /style=\\"font-size: 24px;\\"/);
});

// ── 3. 文本度量 ────────────────────────────────────────────────────────────

test('measureTextContent reads inline font-size and counts paragraphs', () => {
  const m = measureTextContent('<p style="font-size: 24px;">标题</p>');
  assert.equal(m.fontSize, 24);
  assert.equal(m.paragraphCount, 1);
  assert.equal(m.charCount, 2);

  const two = measureTextContent('<p style="font-size: 18px;">第一段</p><p style="font-size: 18px;">第二段</p>');
  assert.equal(two.paragraphCount, 2);
});

test('measureTextContent treats <br> as a paragraph break', () => {
  const m = measureTextContent('<p style="font-size: 18px;">甲<br>乙</p>');
  assert.equal(m.paragraphCount, 2);
});

test('estimateTextLines grows with text volume', () => {
  const short = estimateTextLines(measureTextContent('<p style="font-size: 18px;">短</p>'), 400);
  const long = estimateTextLines(
    measureTextContent(`<p style="font-size: 18px;">${'字'.repeat(120)}</p>`),
    400,
  );
  assert.ok(long > short, `长文本应需要更多行：${long} vs ${short}`);
});

// ── 4. 几何纠正：这是修 bug 的主体 ────────────────────────────────────────

test('a text box too short for its content is raised to the table height', () => {
  const { elements, issues } = reconcileSlideGeometry([
    {
      id: 't1',
      type: 'text',
      left: 60,
      top: 80,
      width: 880,
      // 3 行 24px 文字却只给 40 高 → 导出时会被压扁
      height: 40,
      content: `<p style="font-size: 24px;">${'这是一段需要折行的说明文字'.repeat(6)}</p>`,
    },
  ]);
  assert.equal(elements.length, 1);
  const raised = issues.find((issue) => issue.code === 'TEXT_HEIGHT_RAISED');
  assert.ok(raised, '必须记录抬高的动作');
  assert.ok(elements[0].height >= raised.to);
  assert.ok(elements[0].height > 40, '高度必须真的变大');
});

test('overlapping siblings are pushed apart instead of stacked', () => {
  const { elements, issues } = reconcileSlideGeometry([
    { id: 'a', type: 'text', left: 60, top: 100, width: 400, height: 120, content: '<p style="font-size: 18px;">A</p>' },
    // 完全压在 a 上
    { id: 'b', type: 'text', left: 60, top: 110, width: 400, height: 120, content: '<p style="font-size: 18px;">B</p>' },
  ]);
  assert.ok(issues.some((issue) => issue.code === 'OVERLAP_RESOLVED'));
  const a = elements.find((el) => el.id === 'a');
  const b = elements.find((el) => el.id === 'b');
  const overlap = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  assert.ok(overlap <= 0, `两个元素不得相交，实际纵向重叠 ${overlap}px`);
  assert.ok(b.top > a.top, '后者应被推到下方');
});

test('deliberate nesting (text inside a background card) is not treated as overlap', () => {
  const { elements, issues } = reconcileSlideGeometry([
    { id: 'card', type: 'shape', left: 60, top: 150, width: 400, height: 120, path: 'M 0 0 L 1 0 L 1 1 L 0 1 Z', viewBox: [1, 1], fill: '#e8f4fd' },
    { id: 'label', type: 'text', left: 80, top: 172, width: 360, height: 76, content: '<p style="font-size: 18px;">卡片文字</p>' },
  ]);
  assert.equal(issues.filter((issue) => issue.code === 'OVERLAP_RESOLVED').length, 0, '有意嵌套不该被拆开');
  assert.equal(elements.length, 2);
});

test('elements are pulled back inside the canvas margins', () => {
  const { elements, issues } = reconcileSlideGeometry([
    { id: 'left-out', type: 'text', left: 5, top: 10, width: 300, height: 60, content: '<p style="font-size: 18px;">x</p>' },
    { id: 'right-out', type: 'text', left: 900, top: 300, width: 500, height: 60, content: '<p style="font-size: 18px;">y</p>' },
  ]);
  for (const el of elements) {
    assert.ok(el.left >= SLIDE_MARGIN, `${el.id} left=${el.left} 应 ≥ ${SLIDE_MARGIN}`);
    assert.ok(el.left + el.width <= SLIDE_CANVAS_WIDTH - SLIDE_MARGIN + 1, `${el.id} 右边界越界`);
    assert.ok(el.top >= SLIDE_MARGIN, `${el.id} top=${el.top} 应 ≥ ${SLIDE_MARGIN}`);
  }
  assert.ok(issues.some((issue) => issue.code === 'LEFT_CLAMPED'));
});

test('no element may extend past the bottom margin after reconciliation', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    id: `t${i}`,
    type: 'text',
    left: 60,
    top: 60 + i * 10, // 全部挤在顶部，必然互相重叠
    width: 880,
    height: 70,
    content: `<p style="font-size: 18px;">第 ${i} 条要点内容</p>`,
  }));
  const { elements, issues } = reconcileSlideGeometry(many);
  assert.ok(issues.length > 0, '这种输入必然产生纠正');
  for (const el of elements) {
    assert.ok(
      el.top + el.height <= SLIDE_CANVAS_HEIGHT - SLIDE_MARGIN + 1,
      `${el.id} 底部 ${el.top + el.height} 超出 ${SLIDE_CANVAS_HEIGHT - SLIDE_MARGIN}`,
    );
  }
  // 逐对检查：不允许残留相交（嵌套除外）
  for (let i = 0; i < elements.length; i += 1) {
    for (let j = i + 1; j < elements.length; j += 1) {
      const a = elements[i];
      const b = elements[j];
      const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
      const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
      assert.ok(w <= 0 || h <= 0, `${a.id} 与 ${b.id} 仍然重叠 (${w}×${h})`);
    }
  }
});

// ── 5. 端到端：parseSceneResponse 必须真的用上纠正 ────────────────────────

test('parseSceneResponse reconciles geometry before returning the slide', () => {
  const outline = { id: 'o1', type: 'slide', title: '标题页', keyPoints: [] };
  const raw = JSON.stringify({
    elements: [
      { id: 'e1', type: 'text', left: 60, top: 80, width: 880, height: 40, content: '<p style="font-size: 32px;">一个很长很长的标题文字需要折行显示出来</p>' },
      { id: 'e2', type: 'text', left: 60, top: 90, width: 880, height: 60, content: '<p style="font-size: 18px;">副标题压在标题上</p>' },
    ],
    speech: '讲解这一页',
  });
  const parsed = parseSceneResponse(raw, outline, { sceneIndex: 0, stageId: 'stage-1' });
  assert.ok(parsed, '应解析成功');
  const elements = parsed.content.canvas.elements;
  assert.ok(Array.isArray(parsed.geometryIssues), '必须把纠正记录带出来');
  assert.ok(parsed.geometryIssues.length > 0, '这组输入必然触发纠正');
  // 标题被抬高，副标题被推开
  const title = elements.find((el) => el.id === 'e1');
  assert.ok(title.height > 40);
  const sub = elements.find((el) => el.id === 'e2');
  assert.ok(sub.top >= title.top + title.height, '副标题必须让到标题下方');
});

test('a clean slide passes through with no issues', () => {
  const outline = { id: 'o1', type: 'slide', title: '干净页', keyPoints: [] };
  const raw = JSON.stringify({
    elements: [
      { id: 'e1', type: 'text', left: 60, top: 80, width: 880, height: 76, content: '<p style="font-size: 36px;">标题</p>' },
      { id: 'e2', type: 'text', left: 60, top: 200, width: 880, height: 58, content: '<p style="font-size: 18px;">正文一行</p>' },
    ],
    speech: 'x',
  });
  const parsed = parseSceneResponse(raw, outline, { sceneIndex: 0, stageId: 's' });
  assert.deepEqual(parsed.geometryIssues, []);
  assert.equal(parsed.content.canvas.elements.length, 2);
});
