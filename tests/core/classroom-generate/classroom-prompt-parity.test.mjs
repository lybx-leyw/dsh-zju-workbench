// 生成链路的 prompt 契约测试：锁住"与上游等价"的关键约束。
//
// 上游依据（vendored v1.3.0）：
//   - packages/@openmaic/generation/templates/requirements-to-outlines/system.md
//   - packages/@openmaic/generation/templates/quiz-content/system.md
//   - packages/@openmaic/generation/templates/slide-content/system.md
//
// 这些断言不是"措辞检查"，而是**能力检查**：某条规则消失 = 某个能力退化。
// 删规则前请先读对应上游模板。

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOutlinePrompt, buildScenePrompt } from '../../../packages/core/classroom-generate/src/prompts.js';
import { normalizeOutline, parseSceneResponse } from '../../../packages/core/classroom-generate/src/scene.js';

const brief = {
  requirement: '讲一下二叉搜索树',
  topic: '二叉搜索树',
  description: '',
  goals: ['理解 BST 性质'],
  interactive: false,
  assess: true,
  project: false,
  scenes: [],
};

// ── 大纲 prompt ────────────────────────────────────────────────────────────

test('outline prompt keeps the six language-inference rules', () => {
  const { system } = buildOutlinePrompt(brief, {});
  // 规则 1-6 的判据：显式要求 / 需求语言 / 学外语 / 跨语言材料 / 代他人提问 / 面向儿童
  assert.match(system, /显式语言要求优先/);
  assert.match(system, /需求语言 = 授课语言/);
  assert.match(system, /学外语/);
  assert.match(system, /跨语言 PDF/);
  assert.match(system, /代他人提问/);
  assert.match(system, /面向儿童/);
});

test('outline prompt keeps the courseTitle hard limits', () => {
  const { system } = buildOutlinePrompt(brief, {});
  assert.match(system, /30 字/);
  assert.match(system, /名词短语/);
  // 明确禁止项（上游 "Do NOT include"）
  assert.match(system, /不要.*引号|引号、编号/);
});

test('outline prompt keeps the default-assumption table', () => {
  const { system } = buildOutlinePrompt(brief, {});
  assert.match(system, /15-20 分钟/);
  assert.match(system, /一般学习者/);
  assert.match(system, /互动式/);
});

test('outline prompt keeps every widget type and its required fields', () => {
  const { system } = buildOutlinePrompt(brief, {});
  for (const widget of ['simulation', 'diagram', 'code', 'game', 'visualization3d']) {
    assert.ok(system.includes(`\\\`${widget}\\\``) || system.includes(widget), `缺少 widgetType ${widget}`);
  }
  // 每种 widget 的必填字段
  assert.match(system, /keyVariables/);
  assert.match(system, /diagramType/);
  assert.match(system, /visualizationType/);
});

test('outline prompt states the non-negotiable top-level object rule', () => {
  const { system } = buildOutlinePrompt(brief, {});
  assert.match(system, /绝不能是裸数组/);
  assert.match(system, /languageDirective/);
  assert.match(system, /courseTitle/);
  // keyPoints 数量约束（上游 3-5）
  assert.match(system, /3-5 条/);
});

test('outline prompt forbids inventing interactive/pbl the user did not ask for', () => {
  const { system } = buildOutlinePrompt(brief, {});
  assert.match(system, /没要求互动\/项目就不要造/);
});

test('outline prompt embeds the material when given, and omits the block when empty', () => {
  const withMaterial = buildOutlinePrompt(brief, { materialText: '第一章 绪论' });
  assert.match(withMaterial.prompt, /## 讲义/);
  assert.ok(withMaterial.prompt.includes('第一章 绪论'));

  const withoutMaterial = buildOutlinePrompt(brief, { materialText: '   ' });
  assert.ok(!withoutMaterial.prompt.includes('## 讲义'), '空讲义的 prompt 应与无讲义完全一致');
});

// ── quiz prompt + 解析 ──────────────────────────────────────────────────────

test('quiz prompt requires analysis, points and commentPrompt', () => {
  const { system } = buildScenePrompt({ type: 'quiz', title: '检测', keyPoints: [] }, { index: 0, total: 1 });
  // 上游 quiz-content 的三条硬要求
  assert.match(system, /analysis/);
  assert.match(system, /points/);
  assert.match(system, /commentPrompt/);
  // 按难度给分的具体档位
  assert.match(system, /简单 5|5、中等 10|10、较难 15/);
});

test('quiz questions carry analysis, points and commentPrompt through parsing', () => {
  const raw = JSON.stringify({
    questions: [
      {
        id: 'q-1',
        type: 'text',
        question: '什么是 BST？',
        options: [],
        answer: null,
        analysis: '按左小右大组织',
        points: 15,
        commentPrompt: '答出左右子树关系得满分；只答"一种树"得一半',
      },
    ],
    speech: '开始做题',
  });
  const parsed = parseSceneResponse(raw, { type: 'quiz', title: 'q', keyPoints: [] }, { sceneIndex: 0, stageId: 's' });
  const q = parsed.content.questions[0];
  assert.equal(q.analysis, '按左小右大组织');
  assert.equal(q.points, 15);
  assert.match(q.commentPrompt, /左右子树/);
  // 兼容字段：课堂渲染侧读 explanation
  assert.equal(q.explanation, q.analysis, 'explanation 必须与 analysis 同步，供渲染侧使用');
});

test('legacy explanation-only questions still parse (checkpoint compatibility)', () => {
  const raw = JSON.stringify({
    questions: [{ id: 'q-1', type: 'single', question: 'x', options: [{ id: 'a', text: 'A' }], answer: 'a', explanation: '旧字段' }],
    speech: '',
  });
  const parsed = parseSceneResponse(raw, { type: 'quiz', title: 'q', keyPoints: [] }, { sceneIndex: 0, stageId: 's' });
  const q = parsed.content.questions[0];
  assert.equal(q.analysis, '旧字段');
  assert.equal(q.explanation, '旧字段');
  // 没有 points 时给默认值，而不是 undefined（判分依赖它）
  assert.equal(q.points, 10);
});

// ── 大纲归一 ───────────────────────────────────────────────────────────────

test('normalizeOutline keeps upstream id/order semantics', () => {
  const normalized = normalizeOutline({ type: 'slide', title: '导入', keyPoints: ['a'] }, 0);
  assert.equal(normalized.id, 'outline-1');
  assert.equal(normalized.order, 1);
  assert.equal(normalized.type, 'slide');
});

test('normalizeOutline downgrades unknown types to slide', () => {
  const normalized = normalizeOutline({ type: 'video-lecture', title: 'T' }, 0);
  assert.equal(normalized.type, 'slide', '未知类型必须降级成 slide，否则下游画不出来');
});
