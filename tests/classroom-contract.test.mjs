// 跨包契约测试：**生成管线产出的事件** 喂给 **页面的归约器**，看页面能不能走到完成。
//
// 为什么单独一个文件：单包测试各自都对，接起来是错的。这个文件就是那次事故的
// 回归用例 —— 生成包发 `{ kind: 'run-done', payload }`，页面读 `event.type` 与
// `event.data`，两条链路各自绿，接起来页面永远停在 `idle`（事件在传输层没丢，
// 是字段名与命名风格对不上）。
//
// 断言对象只有一条：**页面看到的事件流最终落在 done，且场景数与生成结果一致。**

import test from 'node:test';
import assert from 'node:assert/strict';

import { createGenerateService } from '../packages/dsh-zhiyun-core-classroom-generate/src/index.js';
import { initialState, reduce, PHASE } from '../packages/dsh-zhiyun-page-classroom-build/src/progress.js';

function fakeStudio() {
  return {
    providers: {
      async list() {
        return { httpStatus: 200, body: { success: true, providers: { openai: { models: ['gpt-4o'] } } } };
      },
    },
  };
}

function fakeLlm() {
  return {
    providerId: 'openai',
    model: 'gpt-4o',
    async call(params) {
      if (params.stage === 'outline') {
        return JSON.stringify({
          courseTitle: '二叉树入门',
          outlines: [
            { id: 'o1', type: 'slide', title: '导入', description: '', keyPoints: ['层级'] },
            { id: 'o2', type: 'slide', title: '定义', description: '', keyPoints: ['递归'] },
            { id: 'o3', type: 'quiz', title: '随堂检测', description: '', keyPoints: ['遍历'] },
            { id: 'o4', type: 'interactive', title: '动手画', description: '', keyPoints: ['构造'] },
          ],
        });
      }
      if (params.sceneType === 'quiz') {
        return JSON.stringify({
          speech: '做题',
          questions: [{ id: 'q1', prompt: '中序？', options: ['左根右', '根左右'], answer: 0 }],
        });
      }
      if (params.sceneType === 'interactive') {
        return JSON.stringify({ speech: '试试', html: '<div>demo</div>' });
      }
      return JSON.stringify({
        speech: '讲',
        elements: [{ type: 'text', x: 0, y: 0, width: 100, height: 40, content: '标题' }],
      });
    },
  };
}

function fakeVault() {
  return {
    runs: { async putStep() {}, async steps() { return []; }, async put() {}, async appendEvent() {} },
    assets: { async put(input) { return { id: `a-${input.meta?.elementId ?? 'x'}`, mime: input.mime }; } },
    classroom: { async save(_id, doc) { return doc; } },
  };
}

function makeService() {
  return createGenerateService({
    studio: fakeStudio(),
    ports: { agent: null, pbl: null, media: null, vault: fakeVault(), now: () => 1_700_000_000_000 },
    llm: fakeLlm(),
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
}

test('生成管线的事件形状能被页面归约器吃下去，并走到 done', async () => {
  const service = makeService();
  const { runId } = service.start('讲一下二叉树');

  let state = initialState();
  for await (const event of service.stream(runId)) {
    state = reduce(state, event);
  }

  assert.equal(state.phase, PHASE.done, '页面必须看到终局，不能停在 idle');
  assert.equal(state.done, true);
  assert.equal(state.error, null);
  assert.ok(state.scenes.length >= 4, `页面应至少列出四行场景，实际 ${state.scenes.length}`);
  assert.ok(
    state.scenes.every((scene) => scene.status === 'done'),
    '所有场景都应是完成态，不能有卡在 running 的',
  );
});

test('取消事件同样被页面识别，落成 cancelled 而不是 done', async () => {
  const slow = {
    providerId: 'openai',
    model: 'gpt-4o',
    call: () => new Promise(() => {}),
  };
  const service = createGenerateService({
    studio: fakeStudio(),
    ports: { agent: null, pbl: null, media: null, vault: fakeVault(), now: () => 1_700_000_000_000 },
    llm: slow,
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });

  const { runId } = service.start('讲一下二叉树');
  await new Promise((resolve) => setTimeout(resolve, 10));
  service.cancel(runId);

  let state = initialState();
  for await (const event of service.stream(runId)) {
    state = reduce(state, event);
  }

  assert.equal(state.done, true);
  assert.equal(state.phase, PHASE.cancelled, '主动取消不能被画成失败');
  assert.equal(state.error, null, '取消不是错误，页面不该弹重试');
});

test('事件同时带 type 与 kind，且 type 是 snake_case', async () => {
  const service = makeService();
  const { runId } = service.start('讲一下二叉树');
  const events = [];
  for await (const event of service.stream(runId)) events.push(event);

  for (const event of events) {
    assert.equal(typeof event.type, 'string', '页面按 type 分发，缺了就是死链路');
    assert.equal(event.type, event.kind.replace(/-/g, '_'));
  }
  assert.ok(events.some((e) => e.type === 'run_done'));
  assert.ok(events.some((e) => e.type === 'scene_ready'));
});
