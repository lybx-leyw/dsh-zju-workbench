// 实跑验证：actions 段接入后，场景里真的有完整动作序列（不再只有一条 speech）。
//
// 验的是**端到端产物**：假模型 → produceScenes → buildScene → 场景 actions，
// 然后检查：
//   1. spotlight / laser / discussion 是否真的进了 actions
//   2. 旁白是否是多条（上游 5-10 段节拍）
//   3. discussion 是否在最后
//   4. 配音项是否覆盖**每一条** speech（原先 .find 只取第一条）
//
// 这直接对应"下游四处消费方终于有东西可播"。

import assert from 'node:assert/strict';
import { produceScenes } from '../packages/core/classroom-generate/src/phases/scenes.js';
import { collectMediaItems } from '../packages/core/classroom-generate/src/phases/media.js';

/** 假模型：outline 不在这里用；scene 段回 content，scene-actions 段回动作序列。 */
function fakeLlm() {
  return {
    providerId: 'test',
    model: 'test-model',
    async call(params) {
      if (params.stage === 'scene') {
        return JSON.stringify({
          elements: [
            { id: 'title', type: 'text', content: '<p style="font-size: 36px;">二叉搜索树</p>', left: 60, top: 60, width: 880, height: 76 },
            { id: 'body', type: 'text', content: '<p style="font-size: 18px;">左小右大</p>', left: 60, top: 200, width: 880, height: 58 },
          ],
          background: { type: 'solid', color: '#ffffff' },
          speech: 'content 阶段的兜底旁白',
        });
      }
      if (params.stage === 'scene-actions') {
        // 典型的上游产物形状：动作与旁白交织，discussion 收尾
        return JSON.stringify([
          { type: 'action', name: 'spotlight', params: { elementId: 'title' } },
          { type: 'text', content: '我们今天就讲这个结构。' },
          { type: 'action', name: 'laser', params: { elementId: 'body' } },
          { type: 'text', content: '注意这条性质：左边都小，右边都大。' },
          { type: 'text', content: '想一想，为什么查找能到 O(log n)？' },
          { type: 'action', name: 'discussion', params: { topic: '为什么能 O(log n)' } },
        ]);
      }
      throw new Error(`unexpected stage ${params.stage}`);
    },
  };
}

const outline = {
  id: 'o1',
  type: 'slide',
  title: '二叉搜索树',
  order: 1,
  description: '引入 BST 的核心性质',
  keyPoints: ['左子树都小', '右子树都大', '查找 O(log n)'],
};

const result = await produceScenes({
  outlines: [outline],
  brief: { topic: 'BST', requirement: '讲 BST', languageDirective: '', goals: [] },
  llm: fakeLlm(),
  pbl: null,
  stageId: 'stage-1',
  emit: () => {},
  now: () => 1,
});

assert.equal(result.scenes.length, 1, '应产出一个场景');
const scene = result.scenes[0];

console.log('── 场景动作序列 ──');
for (const action of scene.actions) {
  const detail = action.type === 'speech'
    ? `"${action.text.slice(0, 30)}"`
    : (action.elementId ?? action.topic ?? '');
  console.log(`  ${action.type.padEnd(12)} ${detail}`);
}

const types = scene.actions.map((a) => a.type);

// 1. 动作序列存在，且不止一条 speech
assert.ok(scene.actions.length >= 4, `动作数应 ≥4，实际 ${scene.actions.length}`);
assert.ok(types.includes('spotlight'), '必须产出 spotlight（上游最核心的聚焦动作）');
assert.ok(types.includes('laser'), '必须产出 laser');
assert.ok(types.includes('discussion'), '必须产出 discussion');

// 2. 旁白是多条（节拍），不是一整段
const speeches = scene.actions.filter((a) => a.type === 'speech');
assert.ok(speeches.length >= 2, `旁白应有多条节拍，实际 ${speeches.length}`);
assert.ok(
  !speeches.some((s) => s.text === 'content 阶段的兜底旁白'),
  'actions 段成功时不应回退到 content 的兜底旁白',
);

// 3. discussion 在最后
assert.equal(types[types.length - 1], 'discussion', 'discussion 必须是最后一项');

// 4. spotlight 在对应 text 之前（先指再讲）
const spotlightAt = types.indexOf('spotlight');
assert.ok(spotlightAt < types.indexOf('speech'), 'spotlight 应在旁白之前');

// 5. 配音项覆盖每一条 speech
const items = collectMediaItems([outline], result.scenes);
const audioItems = items.filter((i) => i.mediaType === 'audio');
assert.equal(
  audioItems.length,
  speeches.length,
  `配音项应覆盖每条旁白（旁白 ${speeches.length} 条，配音项 ${audioItems.length} 条）`,
);
for (const item of audioItems) {
  assert.ok(
    speeches.some((s) => s.id === item.elementId),
    `配音项的 elementId ${item.elementId} 必须能对上真实的 action.id`,
  );
}

console.log('\n── 配音项 ──');
for (const item of audioItems) console.log(`  ${item.elementId}  "${String(item.text).slice(0, 24)}"`);

console.log(`\n✅ actions 段生效：${scene.actions.length} 个动作（${speeches.length} 段旁白 + ${scene.actions.length - speeches.length} 个动作），配音覆盖完整。`);
