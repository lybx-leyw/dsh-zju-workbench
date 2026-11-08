// 生成链路的「工程护栏」回归测试。
//
// 这些护栏共同的性质是：**上游有、本仓原先没有，且缺失会导致静默出错**。
// 每一条都对应一次真实故障模式，不是形式主义。
//
// 上游依据：
//   - `outline-media.ts:5-19`            uniquifyMediaElementIds
//   - `outline-generator.ts:208-235`     applyOutlineFallbacks
//   - `snippets/speech-tts-readability.md` TTS 可读性
//   - `templates/quiz-actions/system.md:36-54` 答案安全

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScenePrompt } from '../packages/core/classroom-generate/src/prompts.js';
import {
  applyOutlineFallbacks,
  parseOutlineResponse,
  uniquifyMediaElementIds,
} from '../packages/core/classroom-generate/src/scene.js';

// ── mediaGenerations 的 id 必须全局唯一 ────────────────────────────────────

test('media elementIds are made globally unique across scenes', () => {
  const outlines = [
    { order: 1, mediaGenerations: [{ type: 'image', elementId: 'img_1', prompt: 'A' }] },
    { order: 2, mediaGenerations: [{ type: 'image', elementId: 'img_1', prompt: 'B' }] },
    { order: 3, mediaGenerations: [{ type: 'video', elementId: 'img_1', prompt: 'C' }] },
  ];
  const result = uniquifyMediaElementIds(outlines);
  const ids = result.flatMap((o) => o.mediaGenerations.map((m) => m.elementId));
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3, `id 必须互不相同，实际 ${ids.join(',')}`);
  // 第一个保留原名（可读），后两个派生
  assert.equal(ids[0], 'img_1');
  assert.notEqual(ids[1], 'img_1');
  assert.match(ids[2], /^gen_vid_/);
});

test('uniquify keeps distinct ids untouched', () => {
  const outlines = [
    { order: 1, mediaGenerations: [{ type: 'image', elementId: 'a', prompt: 'A' }] },
    { order: 2, mediaGenerations: [{ type: 'image', elementId: 'b', prompt: 'B' }] },
  ];
  const ids = uniquifyMediaElementIds(outlines).flatMap((o) => o.mediaGenerations.map((m) => m.elementId));
  assert.deepEqual(ids, ['a', 'b'], '本来就不冲突的 id 不该被改写');
});

test('uniquify is idempotent and does not mutate input', () => {
  const input = [{ order: 1, mediaGenerations: [{ type: 'image', elementId: 'x', prompt: 'p' }] }];
  const once = uniquifyMediaElementIds(input);
  const twice = uniquifyMediaElementIds(once);
  assert.equal(once[0].mediaGenerations[0].elementId, twice[0].mediaGenerations[0].elementId);
  assert.equal(input[0].mediaGenerations[0].elementId, 'x', '不得就地修改入参');
});

test('parseOutlineResponse applies id uniquification end to end', () => {
  const raw = JSON.stringify({
    languageDirective: '中文',
    courseTitle: 'T',
    outlines: [
      { id: 'scene_1', type: 'slide', title: 'A', keyPoints: ['a'], order: 1, mediaGenerations: [{ type: 'image', elementId: 'dup', prompt: 'x' }] },
      { id: 'scene_2', type: 'slide', title: 'B', keyPoints: ['b'], order: 2, mediaGenerations: [{ type: 'image', elementId: 'dup', prompt: 'y' }] },
    ],
  });
  const parsed = parseOutlineResponse(raw, {});
  const ids = parsed.outlines.flatMap((o) => o.mediaGenerations.map((m) => m.elementId));
  assert.equal(new Set(ids).size, 2, '跨场景撞号必须被消除（否则第二张图会被去重吞掉）');
});

// ── 缺配置降级 ─────────────────────────────────────────────────────────────

test('interactive without widget config degrades to slide', () => {
  const { outlines, fallbacks } = applyOutlineFallbacks([
    { id: 's1', type: 'interactive', title: '缺配置的交互页' },
  ]);
  assert.equal(outlines[0].type, 'slide');
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0].from, 'interactive');
  assert.match(fallbacks[0].reason, /widgetType/);
});

test('interactive with complete widget config is kept', () => {
  const { outlines, fallbacks } = applyOutlineFallbacks([
    { id: 's1', type: 'interactive', title: 'ok', widgetType: 'simulation', widgetOutline: { concept: 'x' } },
  ]);
  assert.equal(outlines[0].type, 'interactive');
  assert.equal(fallbacks.length, 0);
});

test('pbl without pblConfig degrades to slide', () => {
  const { outlines, fallbacks } = applyOutlineFallbacks([
    { id: 's1', type: 'pbl', title: '缺 pblConfig' },
  ]);
  assert.equal(outlines[0].type, 'slide');
  assert.match(fallbacks[0].reason, /pblConfig/);
});

test('pbl degrades when no pbl service is available', () => {
  const { outlines, fallbacks } = applyOutlineFallbacks(
    [{ id: 's1', type: 'pbl', title: '有配置但没服务', pblConfig: { projectTopic: 'x' } }],
    { hasPblService: false },
  );
  assert.equal(outlines[0].type, 'slide');
  assert.match(fallbacks[0].reason, /no pbl service/);
});

test('slide and quiz outlines are never touched by fallbacks', () => {
  const { outlines, fallbacks } = applyOutlineFallbacks([
    { id: 's1', type: 'slide', title: 'A' },
    { id: 's2', type: 'quiz', title: 'B' },
  ]);
  assert.deepEqual(outlines.map((o) => o.type), ['slide', 'quiz']);
  assert.equal(fallbacks.length, 0);
});

// ── TTS 可读性 ─────────────────────────────────────────────────────────────

test('slide prompt carries all six TTS readability rules', () => {
  const { system } = buildScenePrompt({ type: 'slide', title: 'T', keyPoints: [] }, { index: 0, total: 1 });
  assert.match(system, /能读出来/);
  // 规则 1：禁公式
  assert.match(system, /绝不.*公式|公式.*LaTeX/);
  assert.match(system, /\\frac/);
  // 规则 3：运算符念法
  assert.match(system, /大于等于/);
  assert.match(system, /米每二次方秒/);
  // 规则 5：希腊字母必须是符号不是谐音（上游原文就举了"负派"）
  assert.match(system, /负派/);
  assert.match(system, /从负π到正π/);
  // 规则 6：必须是能读出来的词
  assert.match(system, /能读出来的词/);
});

test('quiz prompt carries TTS readability too', () => {
  const { system } = buildScenePrompt({ type: 'quiz', title: 'T', keyPoints: [] }, { index: 0, total: 1 });
  assert.match(system, /能读出来/);
});

// ── quiz 答案安全 ──────────────────────────────────────────────────────────

test('quiz prompt declares answer safety as overriding everything', () => {
  const { system } = buildScenePrompt({ type: 'quiz', title: 'T', keyPoints: [] }, { index: 0, total: 1 });
  assert.match(system, /答案安全规则/);
  assert.match(system, /优先于本提示里其它一切规则/);
  // 五条禁令
  assert.match(system, /绝不.*泄露或暗示/);
  assert.match(system, /绝不.*预告、转述或分析/);
  assert.match(system, /绝不.*详细讲解知识点/);
  assert.match(system, /绝不.*引导性的反问/);
  assert.match(system, /元层面/);
});

test('quiz prompt gives a safe and an unsafe example', () => {
  const { system } = buildScenePrompt({ type: 'quiz', title: 'T', keyPoints: [] }, { index: 0, total: 1 });
  assert.match(system, /可以这样说/);
  assert.match(system, /不安全/);
});
