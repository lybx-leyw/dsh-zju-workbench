// 课堂生成管线的端到端测试：四段推进、取消、续跑、缺模型。
//
// 这里**不碰真模型、不碰真磁盘**：假 studio 提供 provider 清单，假 llm 按
// `params.stage` 回固定 JSON，假 vault 只把 checkpoint 记在内存里。测的是
// 管线自己的编排语义（顺序、落盘时机、取消边界），不是上游产物的语义。

import test from 'node:test';
import assert from 'node:assert/strict';

import { apply, createGenerateService } from '../packages/dsh-zhiyun-core-classroom-generate/src/index.js';

// ── 测试替身 ────────────────────────────────────────────────────────────────

function fakeStudio() {
  return {
    providers: {
      async list() {
        return {
          httpStatus: 200,
          body: { success: true, providers: { openai: { models: ['gpt-4o'] } } },
        };
      },
    },
  };
}

/** 假模型：outline 段回 4 条大纲，scene 段按类型回最小合法内容。 */
function fakeLlm(calls = []) {
  return {
    providerId: 'openai',
    model: 'gpt-4o',
    async call(params) {
      calls.push(params.stage);
      if (params.stage === 'outline') {
        return JSON.stringify({
          courseTitle: '二叉树入门',
          outlines: [
            { id: 'o1', type: 'slide', title: '导入', description: '为什么需要树', keyPoints: ['层级结构'] },
            { id: 'o2', type: 'slide', title: '定义', description: '递归定义', keyPoints: ['左右子树'] },
            { id: 'o3', type: 'quiz', title: '随堂检测', description: '', keyPoints: ['遍历'] },
            { id: 'o4', type: 'interactive', title: '动手画', description: '', keyPoints: ['构造'] },
          ],
        });
      }
      if (params.sceneType === 'quiz') {
        return JSON.stringify({
          speech: '做两道题',
          questions: [
            { id: 'q1', prompt: '中序遍历的顺序？', options: ['左根右', '根左右'], answer: 0 },
          ],
        });
      }
      if (params.sceneType === 'interactive') {
        return JSON.stringify({ speech: '试试看', html: '<div class="demo">二叉树</div>' });
      }
      return JSON.stringify({
        speech: `讲${params.sceneId ?? ''}`,
        elements: [
          { type: 'text', x: 0, y: 0, width: 100, height: 40, content: '标题' },
        ],
      });
    },
  };
}

/** 假 vault：runs.putStep/steps 是 checkpoint 的落点，classroom.save 收尾。 */
function fakeVault() {
  const steps = [];
  const saved = [];
  return {
    steps,
    saved,
    runs: {
      async putStep(runId, stepId, output) {
        steps.push({ runId, id: stepId, output });
      },
      async steps(runId) {
        return steps.filter((row) => row.runId === runId);
      },
    },
    assets: {
      async put(input) {
        return { id: `asset-${input.meta?.elementId ?? 'x'}`, mime: input.mime };
      },
    },
    classroom: {
      async save(stageId, doc) {
        saved.push({ stageId, doc });
        return doc;
      },
    },
  };
}

function makeService(overrides = {}) {
  return createGenerateService({
    studio: overrides.studio === undefined ? fakeStudio() : overrides.studio,
    ports: {
      agent: overrides.agent ?? null,
      pbl: overrides.pbl ?? null,
      media: overrides.media ?? null,
      vault: overrides.vault ?? fakeVault(),
      now: () => 1_700_000_000_000,
    },
    llm: overrides.llm === undefined ? fakeLlm() : overrides.llm,
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
}

async function collect(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

// ── 用例 ────────────────────────────────────────────────────────────────────

test('apply() 在没有任何宿主服务时也不抛，服务仍可注册', () => {
  const provided = new Map();
  const ctx = {
    provide: (serviceName, service) => {
      provided.set(serviceName, service);
      return () => provided.delete(serviceName);
    },
    on: () => {},
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };

  const dispose = apply(ctx, {});
  assert.equal(typeof dispose, 'function');
  assert.ok(provided.has('zhiyunClassroomGenerate'));
  dispose();
  assert.equal(provided.size, 0);
});

test('四段顺序推进，每段产出都落到 vault 的 checkpoint', async () => {
  const vault = fakeVault();
  const service = makeService({ vault });
  const { runId, stageId } = service.start('讲一下二叉树');

  const events = await collect(service.stream(runId));
  const kinds = events.map((event) => event.kind);
  const phaseStarts = events.filter((e) => e.kind === 'phase-start').map((e) => e.phase);
  const phaseDones = events.filter((e) => e.kind === 'phase-done').map((e) => e.phase);

  assert.deepEqual(phaseStarts, ['outline', 'scenes', 'media', 'finalize']);
  assert.deepEqual(phaseDones, ['outline', 'scenes', 'media', 'finalize']);
  assert.equal(kinds.at(-1), 'run-done');

  const done = events.at(-1);
  assert.equal(done.payload.stageId, stageId);
  assert.equal(done.payload.sceneCount, 4);

  // 四段各一条 checkpoint，且写的就是该段的产物。
  assert.deepEqual(vault.steps.map((row) => row.id), ['outline', 'scenes', 'media', 'finalize']);
  assert.equal(vault.saved.length, 1, 'finalize 段应该整份写一次 classroom');

  assert.equal(service.get(runId).status, 'done');
});

test('取消后事件流以 run-error 结束，且被取消的段不落盘', async () => {
  const vault = fakeVault();
  // 每段都卡在模型调用上，方便在 outline 中途取消。
  const slowLlm = {
    providerId: 'openai',
    model: 'gpt-4o',
    call: () => new Promise(() => {}),
  };
  const service = makeService({ vault, llm: slowLlm });

  const { runId } = service.start('讲一下二叉树');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(service.cancel(runId), true);
  assert.equal(service.cancel(runId), false, '重复取消是幂等的');

  const events = await collect(service.stream(runId));
  assert.equal(events.at(-1).kind, 'run-error');
  assert.equal(events.at(-1).payload.code, 'E_CANCELLED');
  assert.equal(vault.steps.length, 0, '取消的那一段不该写 checkpoint');
  assert.equal(service.get(runId).status, 'cancelled');
});

test('resume() 从 checkpoint 重建，跳过已完成段', async () => {
  const vault = fakeVault();
  const calls = [];
  const service = makeService({ vault, llm: fakeLlm(calls) });

  const { runId } = service.start('讲一下二叉树');
  await collect(service.stream(runId));
  assert.equal(vault.steps.length, 4);

  // 人为抹掉「媒体段」的 checkpoint，模拟「进程在 media 之后、finalize 之前挂了」。
  vault.steps.length = 0;
  for (const phase of ['outline', 'scenes']) {
    vault.steps.push({ runId, id: phase, output: { phase } });
  }
  vault.saved.length = 0;
  calls.length = 0;

  await service.resume(runId);
  const events = await collect(service.stream(runId));

  const phaseStarts = events.filter((e) => e.kind === 'phase-start').map((e) => e.phase);
  assert.deepEqual(phaseStarts, ['media', 'finalize'], '已完成段不能再跑一次');
  assert.equal(vault.saved.length, 1, 'finalize 段补写了一次 classroom');
  // outline/scenes 不重跑，所以只有 finalize 之外没有模型调用（media 段无素材请求）。
  assert.equal(calls.length, 0, '续跑不该重新调模型生成已完成段的内容');
  assert.equal(service.get(runId).status, 'done');
});

test('没有可用模型时，run 以 run-error（E_MISSING_SERVICE）结束而不是崩掉进程', async () => {
  const service = makeService({ studio: null, llm: null });
  const { runId } = service.start('讲一下二叉树');

  const events = await collect(service.stream(runId));
  assert.equal(events.at(-1).kind, 'run-error');
  assert.equal(events.at(-1).payload.code, 'E_MISSING_SERVICE');
  assert.equal(service.get(runId).status, 'failed');
});

test('brief 不合法时 start() 抛领域错误', () => {
  const service = makeService();
  assert.throws(() => service.start(''), (error) => error.code === 'E_INVALID_INPUT');
  assert.throws(() => service.start({ topic: '' }), (error) => error.code === 'E_INVALID_INPUT');
});
