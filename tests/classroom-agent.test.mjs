// dsh-zhiyun-core-classroom-agent 的装配与契约测试。
//
// 覆盖三件事（对应任务书的验证条款）：
//   1. 用假 ctx apply 一次不抛，并 provide `zhiyunClassroomAgent`；
//   2. 固定 brief → plan() 的场景序列（数量 / 类型 / 顺序）与上游大纲同形；
//   3. run() 是 AsyncIterable、能正常结束，且事件名与 director-loop 一致。
//
// 另外补两条「搬运有没有走样」的断言：
//   - 注入假 llm 后，动作要经过 classroom-actions 的守卫链（归一化 + 台账）；
//   - cancel() 之后事件流必须自己收尾，而不是挂住。
//
// 跑法：`node --test tests/classroom-agent.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const PACKAGE_DIR = new URL('../packages/dsh-zhiyun-core-classroom-agent/', import.meta.url);
const INDEX_URL = pathToFileURL(join(fileURLToPath(PACKAGE_DIR), 'src', 'index.js')).href;
const plugin = await import(INDEX_URL);

const BRIEF = JSON.parse(
  await readFile(new URL('../packages/dsh-zhiyun-core-classroom-agent/fixtures/brief.json', import.meta.url), 'utf8'),
);

// ── 测试装置 ────────────────────────────────────────────────────────────────

/** 最小 Cordis 假 ctx（照 tests/classroom-host.test.mjs 的 stub 写法）。 */
function makeCtx({ services = {}, provideThrows = false } = {}) {
  const provided = new Map(Object.entries(services));
  const disposers = [];
  const logs = [];
  const ctx = {
    logger: {
      debug: (...args) => logs.push(['debug', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    get: (serviceName) => provided.get(serviceName),
    provide: (serviceName, value) => {
      if (provideThrows) throw new Error(`service ${serviceName} already registered`);
      provided.set(serviceName, value);
      return () => provided.delete(serviceName);
    },
    on: (event, handler) => {
      if (event === 'dispose') disposers.push(handler);
    },
  };
  return { ctx, provided, disposers, logs };
}

/** 宿主服务的形状（只实现本包真正调用的两个面）。 */
function makeStudio() {
  return {
    async status() {
      return { state: 'ready', version: '0.1.0', detail: { implemented: {} } };
    },
    runs: { async cancel() {} },
    classroom: {
      async load() {
        throw new Error('not implemented in stub');
      },
    },
  };
}

function mount(config, { services = { zhiyunClassroomStudio: makeStudio() }, provideThrows = false } = {}) {
  const harness = makeCtx({ services, provideThrows });
  const dispose = plugin.apply(harness.ctx, config);
  return { ...harness, dispose, service: harness.provided.get('zhiyunClassroomAgent') };
}

async function collect(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

// ── 1. apply ───────────────────────────────────────────────────────────────

test('apply() 在假 ctx 上不抛，并 provide zhiyunClassroomAgent（plan/run/cancel 齐备）', () => {
  const { service, dispose } = mount();
  assert.equal(typeof dispose, 'function', 'apply() 必须返回 disposer');
  assert.ok(service, 'apply() 必须 provide zhiyunClassroomAgent');
  for (const method of ['plan', 'run', 'cancel', 'status']) {
    assert.equal(typeof service[method], 'function', `缺少 zhiyunClassroomAgent.${method}`);
  }
  assert.equal(typeof service.runs.get, 'function');
});

test('apply() 在宿主服务缺失时不抛，status().state=degraded', async () => {
  const harness = makeCtx();
  assert.doesNotThrow(() => plugin.apply(harness.ctx, {}));
  const service = harness.provided.get('zhiyunClassroomAgent');
  const status = await service.status();
  assert.equal(status.state, 'degraded');
  assert.equal(status.detail.studio, 'missing');
});

test('apply() 在 provide 抛错时不抛，并留 error 日志', () => {
  const harness = makeCtx({ provideThrows: true });
  assert.doesNotThrow(() => plugin.apply(harness.ctx, {}));
  assert.ok(
    harness.logs.some(([level]) => level === 'error'),
    '注册失败必须留 error 日志',
  );
});

// ── 2. plan() ──────────────────────────────────────────────────────────────

test('plan() 的场景序列：数量、类型、顺序与 brief 的推导规则一致', async () => {
  const { service } = mount();
  const plan = await service.plan(BRIEF);

  // 导入 slide + 每个 goal 一节 slide + interactive + quiz（project=false）。
  assert.equal(plan.scenes.length, 6);

  assert.deepEqual(
    plan.scenes.map((scene) => scene.type),
    ['slide', 'slide', 'slide', 'slide', 'interactive', 'quiz'],
  );
  assert.deepEqual(
    plan.scenes.map((scene) => scene.order),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(new Set(plan.scenes.map((scene) => scene.id)).size, plan.scenes.length, 'scene id 必须唯一');

  // 大纲字段与上游 resolveSceneOutline / buildDirectorCourseOutline 同形。
  for (const scene of plan.scenes) {
    assert.equal(typeof scene.id, 'string');
    assert.equal(typeof scene.title, 'string');
    assert.equal(typeof scene.description, 'string');
    assert.ok(Array.isArray(scene.keyPoints));
  }
});

test('plan() 的花名册回退到默认三件套（teacher/assistant/student）', async () => {
  const { service } = mount();
  const plan = await service.plan(BRIEF);

  assert.deepEqual(plan.roster.selectedAgentIds, ['default-1', 'default-2', 'default-3']);
  assert.deepEqual(
    plan.agents.map((agent) => agent.role),
    ['teacher', 'assistant', 'student'],
  );
});

test('plan() 采信 brief.scenes，未知类型直接报错（不静默改写成 slide）', async () => {
  const { service } = mount();
  const plan = await service.plan({
    topic: '测试',
    scenes: [{ type: 'quiz', title: '小测' }, { type: 'pbl', title: '项目' }],
  });
  assert.deepEqual(plan.scenes.map((scene) => scene.type), ['quiz', 'pbl']);
  assert.deepEqual(plan.scenes.map((scene) => scene.order), [0, 1]);

  await assert.rejects(
    () => service.plan({ topic: '测试', scenes: [{ type: 'video', title: 'x' }] }),
    /未知场景类型/,
  );
});

// ── 3. run() ───────────────────────────────────────────────────────────────

test('run() 是 AsyncIterable，事件名与 director-loop 一致，且能正常结束', async () => {
  const { service } = mount();
  const plan = await service.plan(BRIEF);

  const result = service.run(plan, {});
  assert.equal(typeof result[Symbol.asyncIterator], 'function');
  assert.equal(typeof result.runId, 'string');
  assert.equal(typeof result.events[Symbol.asyncIterator], 'function');

  const events = await collect(result);

  assert.ok(events.length > 0);
  assert.equal(events[0].type, 'agent_start');
  assert.ok(events.some((event) => event.type === 'text_delta'));
  assert.ok(events.some((event) => event.type === 'agent_end'));

  const done = events.at(-1);
  assert.equal(done.type, 'done');
  // 字段与 director-loop.ts:271-293 的 done.data 对齐。
  for (const key of [
    'totalActions',
    'totalAgents',
    'agentHadContent',
    'cueUserReceived',
    'sessionClosed',
    'directorToolTrace',
    'directorState',
  ]) {
    assert.ok(key in done.data, `done.data 缺少 ${key}`);
  }
  assert.ok(done.data.totalAgents >= 1);

  // 每节场景至少一位教师，且场景顺序即 plan 顺序。
  const sceneIds = events
    .filter((event) => event.type === 'agent_start')
    .map((event) => event.data.sceneId);
  assert.deepEqual([...new Set(sceneIds)], plan.scenes.map((scene) => scene.id));

  const record = service.runs.get(result.runId);
  assert.equal(record.status, 'done');
});

test('run() 在没有 llm 时走确定性兜底，不产生 action 事件', async () => {
  const { service } = mount();
  const plan = await service.plan(BRIEF);
  const events = await collect(service.run(plan, {}));
  assert.equal(events.filter((event) => event.type === 'action').length, 0);
});

test('run() 注入假 llm 后，动作经守卫链归一化并进入台账', async () => {
  const llm = {
    async call() {
      return JSON.stringify([
        { type: 'text', content: '我们先把光反应写下来。' },
        { type: 'action', name: 'wb_draw_text', params: { content: '光反应', x: 60, y: 80 } },
      ]);
    },
  };
  const { service } = mount({ llm });
  // 单场景 + 单智能体，让「一轮一个动作」可被精确断言。
  const plan = await service.plan({
    ...BRIEF,
    agents: ['default-1'],
    scenes: [{ type: 'slide', title: '单页讲义' }],
  });

  const events = await collect(service.run(plan, {}));
  const actions = events.filter((event) => event.type === 'action');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].data.actionName, 'wb_draw_text');
  // 上游在 execute 里补 elementId（classroom-actions.ts:444-446）。
  assert.equal(typeof actions[0].data.params.elementId, 'string');
  assert.ok(actions[0].data.params.elementId.length > 0);

  const done = events.at(-1);
  assert.equal(done.data.totalActions, 1);
  assert.equal(done.data.directorState.whiteboardLedger.length, 1);
  assert.equal(done.data.directorState.whiteboardLedger[0].actionName, 'wb_draw_text');
});

test('cancel() 之后事件流自行收尾，runs 状态为 cancelled', async () => {
  const { service } = mount();
  const plan = await service.plan(BRIEF);

  const result = service.run(plan, {});
  const cancelled = await service.cancel(result.runId);
  assert.equal(cancelled, true);

  const events = await collect(result);
  // 取消后不再有 done（与上游 signal.aborted 时静默返回一致），但流必须结束。
  assert.ok(!events.some((event) => event.type === 'done'));
  assert.equal(service.runs.get(result.runId).status, 'cancelled');

  // 未知 runId 取消返回 false，不抛。
  assert.equal(await service.cancel('no-such-run'), false);
});
