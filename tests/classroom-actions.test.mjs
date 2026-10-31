// actions 段的回归测试。
//
// 这一段是本仓与上游最大的一处差距：上游 `content → actions → narration` 三步，
// actions 产出**交织的动作序列**；本仓原先压成"一次调用只吐一条 speech"。
//
// 下游四处消费方（舞台账本认 21 种动作、渲染器画 spotlight、导出器重放 8 种、
// 视频时间轴排 play_video/discussion）全都按完整序列写好了 —— 本文件锁的就是
// "生成侧真的产出了它们"。
//
// 上游依据：
//   - templates/slide-actions/system.md（spotlight/laser/play_video/discussion）
//   - src/action-parser.ts:132-159（discussion 最后、slide-only 剥离、白名单）
//   - src/scene-generator.ts:2003-2031（elementId / agentId 回退）

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractActionArray,
  generateDefaults,
  normalizeActions,
  parseSceneActions,
} from '../packages/dsh-zhiyun-core-classroom-generate/src/actions.js';
import { buildActionsPrompt } from '../packages/dsh-zhiyun-core-classroom-generate/src/prompts.js';
import { buildScene } from '../packages/dsh-zhiyun-core-classroom-generate/src/scene.js';

// ── 解析：三级容错 ────────────────────────────────────────────────────────

test('parses a bare JSON array', () => {
  const items = extractActionArray('[{"type":"text","content":"你好"}]');
  assert.equal(items.length, 1);
});

test('strips markdown fences', () => {
  const items = extractActionArray('```json\n[{"type":"text","content":"甲"}]\n```');
  assert.equal(items.length, 1);
  assert.equal(items[0].content, '甲');
});

test('locates the array inside surrounding prose', () => {
  const items = extractActionArray('好的，下面是动作序列：\n[{"type":"text","content":"乙"}]\n希望有帮助');
  assert.equal(items.length, 1);
  assert.equal(items[0].content, '乙');
});

test('repairs trailing commas', () => {
  const items = extractActionArray('[{"type":"text","content":"丙"},]');
  assert.equal(items.length, 1);
});

test('returns null for unparseable output', () => {
  assert.equal(extractActionArray('完全不是 JSON'), null);
  assert.equal(extractActionArray(''), null);
  assert.equal(extractActionArray(null), null);
});

// ── 归一：动作类型与结构 ──────────────────────────────────────────────────

test('interleaves spotlight and text in order (point first, then speak)', () => {
  const { actions } = normalizeActions([
    { type: 'action', name: 'spotlight', params: { elementId: 'text_1' } },
    { type: 'text', content: '先看这个公式' },
    { type: 'action', name: 'laser', params: { elementId: 'text_2' } },
    { type: 'text', content: '再看这个数值' },
  ], { sceneId: 'scene-1', sceneType: 'slide', elementIds: ['text_1', 'text_2'] });

  assert.deepEqual(actions.map((a) => a.type), ['spotlight', 'speech', 'laser', 'speech']);
  assert.equal(actions[0].elementId, 'text_1');
  assert.equal(actions[1].text, '先看这个公式');
});

test('every action gets a unique id', () => {
  const { actions } = normalizeActions([
    { type: 'text', content: 'a' },
    { type: 'text', content: 'b' },
    { type: 'action', name: 'spotlight', params: { elementId: 'e' } },
  ], { sceneId: 's1', sceneType: 'slide', elementIds: ['e'] });
  const ids = actions.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, `id 必须唯一：${ids.join(',')}`);
});

test('slide-only actions are stripped from non-slide scenes', () => {
  const { actions, issues } = normalizeActions([
    { type: 'action', name: 'spotlight', params: { elementId: 'e' } },
    { type: 'action', name: 'laser', params: { elementId: 'e' } },
    { type: 'text', content: '测验前的话' },
  ], { sceneId: 's', sceneType: 'quiz', elementIds: ['e'] });

  assert.deepEqual(actions.map((a) => a.type), ['speech'], 'quiz 页不该有聚光灯');
  assert.ok(issues.some((i) => i.code === 'ACTION_NOT_ALLOWED_ON_SCENE'));
});

test('unknown action names are dropped', () => {
  const { actions, issues } = normalizeActions([
    { type: 'action', name: 'teleport', params: {} },
    { type: 'text', content: 'ok' },
  ], { sceneId: 's', sceneType: 'slide' });
  assert.deepEqual(actions.map((a) => a.type), ['speech']);
  assert.ok(issues.some((i) => i.code === 'ACTION_UNKNOWN'));
});

test('invalid elementId falls back to the first real element', () => {
  const { actions, issues } = normalizeActions([
    { type: 'action', name: 'spotlight', params: { elementId: 'not_exist' } },
  ], { sceneId: 's', sceneType: 'slide', elementIds: ['text_1', 'text_2'] });
  assert.equal(actions[0].elementId, 'text_1');
  assert.ok(issues.some((i) => i.code === 'ELEMENT_ID_FALLBACK'));
});

test('spotlight with no available element is dropped', () => {
  const { actions, issues } = normalizeActions([
    { type: 'action', name: 'spotlight', params: { elementId: 'x' } },
    { type: 'text', content: '只有旁白' },
  ], { sceneId: 's', sceneType: 'slide', elementIds: [] });
  assert.deepEqual(actions.map((a) => a.type), ['speech'], '没有可指的元素就该丢掉这个动作');
  assert.ok(issues.some((i) => i.code === 'ACTION_DROPPED_NO_TARGET'));
});

test('discussion is moved to the end', () => {
  const { actions, issues } = normalizeActions([
    { type: 'action', name: 'discussion', params: { topic: '你怎么看' } },
    { type: 'text', content: '这句本该在后面' },
  ], { sceneId: 's', sceneType: 'slide' });

  assert.equal(actions[actions.length - 1].type, 'discussion', 'discussion 必须在最后');
  assert.ok(issues.some((i) => i.code === 'DISCUSSION_MOVED_TO_END'));
});

test('discussion without a topic is dropped', () => {
  const { actions } = normalizeActions([
    { type: 'action', name: 'discussion', params: {} },
  ], { sceneId: 's', sceneType: 'slide' });
  assert.equal(actions.length, 0);
});

test('play_video keeps its elementId', () => {
  const { actions } = normalizeActions([
    { type: 'text', content: '先看一段演示' },
    { type: 'action', name: 'play_video', params: { elementId: 'video_1' } },
  ], { sceneId: 's', sceneType: 'slide', elementIds: ['video_1'] });
  assert.equal(actions[1].type, 'play_video');
  assert.equal(actions[1].elementId, 'video_1');
});

test('widget_setState defaults a missing state to {}', () => {
  const { actions, issues } = normalizeActions([
    { type: 'action', name: 'widget_setState', params: { target: '#slider' } },
  ], { sceneId: 's', sceneType: 'interactive' });
  assert.deepEqual(actions[0].state, {});
  assert.ok(issues.some((i) => i.code === 'WIDGET_STATE_DEFAULTED'));
});

test('widget_* survives on interactive scenes', () => {
  const { actions } = normalizeActions([
    { type: 'action', name: 'widget_highlight', params: { target: '.chart', content: '看这里' } },
    { type: 'text', content: '拖动滑块观察' },
  ], { sceneId: 's', sceneType: 'interactive' });
  assert.deepEqual(actions.map((a) => a.type), ['widget_highlight', 'speech']);
});

test('parseSceneActions returns null (not empty) when unparseable', () => {
  assert.equal(parseSceneActions('这不是 JSON'), null);
  assert.deepEqual(parseSceneActions('[]'), { actions: [], issues: [] });
});

// ── 降级兜底 ──────────────────────────────────────────────────────────────

test('generateDefaults gives a deterministic speech when the actions step is unavailable', () => {
  const actions = generateDefaults({ sceneId: 'scene-3', speech: '这一页我们讲三点' });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'speech');
  assert.equal(actions[0].text, '这一页我们讲三点');
});

test('generateDefaults returns empty when there is no speech to fall back to', () => {
  assert.deepEqual(generateDefaults({ sceneId: 's', speech: '' }), []);
});

// ── buildScene 集成 ───────────────────────────────────────────────────────

test('buildScene prefers the action sequence over the single fallback speech', () => {
  const scene = buildScene({
    outline: { id: 'o1', type: 'slide', title: 'T', order: 1 },
    content: { type: 'slide', canvas: { elements: [] } },
    speech: 'content 阶段的那条',
    actions: [
      { id: 'a1', type: 'spotlight', elementId: 'e' },
      { id: 'a2', type: 'speech', text: '分段讲解一' },
      { id: 'a3', type: 'speech', text: '分段讲解二' },
    ],
    stageId: 'st',
    sceneId: 'scene-1',
    now: () => 1,
  });
  assert.equal(scene.actions.length, 3);
  assert.deepEqual(scene.actions.map((a) => a.type), ['spotlight', 'speech', 'speech']);
});

test('buildScene falls back to the content speech only when actions are empty', () => {
  const scene = buildScene({
    outline: { id: 'o1', type: 'slide', title: 'T', order: 1 },
    content: { type: 'slide', canvas: { elements: [] } },
    speech: '兜底旁白',
    actions: [],
    stageId: 'st',
    sceneId: 'scene-1',
    now: () => 1,
  });
  assert.equal(scene.actions.length, 1);
  assert.equal(scene.actions[0].text, '兜底旁白');
});

test('buildScene does not duplicate the fallback when actions already carry speech', () => {
  const scene = buildScene({
    outline: { id: 'o1', type: 'slide', title: 'T', order: 1 },
    content: { type: 'slide', canvas: { elements: [] } },
    speech: '不该被塞回来',
    actions: [{ id: 'x', type: 'speech', text: '真正的旁白' }],
    stageId: 'st',
    sceneId: 'scene-1',
    now: () => 1,
  });
  assert.equal(scene.actions.length, 1, '不得出现旁白重复');
  assert.equal(scene.actions[0].text, '真正的旁白');
});

// ── prompt 契约 ───────────────────────────────────────────────────────────

test('slide actions prompt lists the four action types and their params', () => {
  const { system } = buildActionsPrompt(
    { type: 'slide', title: 'T', keyPoints: ['p'] },
    { canvas: { elements: [{ id: 'text_1', type: 'text', content: '标题' }] } },
    { index: 0, total: 3 },
  );
  for (const name of ['spotlight', 'laser', 'play_video', 'discussion']) {
    assert.ok(system.includes(name), `缺少动作 ${name}`);
  }
  // 关键约束
  assert.match(system, /必须.*最后一项|最后.*discussion/);
  assert.match(system, /5-10/);
  assert.match(system, /先指、再讲|spotlight 要出现在对应 text 之前/);
  // TTS 可读性也要在
  assert.match(system, /能读出来/);
});

test('slide actions prompt forbids multi-speaker dialogue', () => {
  const { system } = buildActionsPrompt({ type: 'slide', title: 'T', keyPoints: [] }, {}, { index: 1, total: 3 });
  assert.match(system, /只有一个说话人/);
  assert.match(system, /AI助教/);
});

test('actions prompt includes first/middle/last page tone rules', () => {
  const first = buildActionsPrompt({ type: 'slide', title: 'T', keyPoints: [] }, {}, { index: 0, total: 3 });
  assert.match(first.prompt, /第一页/);
  assert.match(first.prompt, /问候/);

  const middle = buildActionsPrompt({ type: 'slide', title: 'T', keyPoints: [] }, {}, { index: 1, total: 3 });
  assert.match(middle.prompt, /中间页/);
  assert.match(middle.prompt, /不要问候/);

  const last = buildActionsPrompt({ type: 'slide', title: 'T', keyPoints: [] }, {}, { index: 2, total: 3 });
  assert.match(last.prompt, /最后一页/);
});

test('quiz actions prompt forbids any action object and carries answer safety', () => {
  const { system } = buildActionsPrompt({ type: 'quiz', title: 'T', keyPoints: [] }, {}, { index: 1, total: 3 });
  assert.match(system, /只允许.*text/);
  assert.match(system, /不得输出任何.*action/);
  assert.match(system, /答案安全规则/);
});

test('actions prompt lists real element ids so the model can pick valid ones', () => {
  const { prompt } = buildActionsPrompt(
    { type: 'slide', title: 'T', keyPoints: [] },
    { canvas: { elements: [{ id: 'text_abc', type: 'text', content: '公式' }] } },
    { index: 0, total: 1 },
  );
  assert.match(prompt, /text_abc/);
});
