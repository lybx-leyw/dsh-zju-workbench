/**
 * `campus_activity` 的工具层测试 —— **走过审批链**，不是直接调 source。
 *
 * # 为什么这一层必须单独测一遍
 *
 * 本仓有过一次沉痛教训（coverage-gaps 的 Y-13）：source 层的测试全绿，而
 * 工具层传给 source 的参数在实机上一个都走不通。两层各测各的，中间的缝没人测。
 * 所以这里刻意**从 `apply()` 注册出来的宿主工具**进入，装配真的 source
 * （`createSztzWrites`）+ 假的 `Sztz` 客户端 + 假的审批服务。
 *
 * # 这一组钉住的三件事
 *
 * 1. **Prepare 不发写请求**：审批框弹出来时，平台状态必须还是原样。
 * 2. **审批被拒之后能立刻重试**：`cancel` 段缺了或没接上，那个动作会永久
 *    `WRITE_BUSY`（Z-1 曾经就是这个缺陷）。这条只能从工具层测 ——
 *    撤销是注册器调的，source 自己不会调自己。
 * 3. **审批拒绝的错误码是 `WRITE_NOT_APPROVED` 而不是 `WRITE_BUSY`**：
 *    用户看到「永久不可用」会以为工具坏了，而其实只是他刚拒了一次。
 *
 * 全部离线：客户端是假的，审批是假的，没有网络。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../../../packages/tool/sztz/src/index.js';
import { createSztzWrites } from '../../../packages/source/sztz/src/writes.js';

/**
 * 造一个假的 `Sztz` 客户端。
 *
 * 形状照真实现：`myList(action)` 给**原始记录**（带 id），`myActivities()`
 * 给视图（没有 id），`write()` 是不重发的写入口，`call()` 是可重发的通用入口。
 *
 * @param overrides - 覆盖默认值。
 * @returns 假客户端（`calls` 记录每一次网络动作）。
 */
function fakeClient(overrides = {}) {
  const calls = [];
  const lists = { 0: [], 1: [], 2: [] };
  const base = {
    lists,
    async myList(action) {
      return lists[action] ?? [];
    },
    async myActivities() {
      return {
        signedUp: lists[0].map((row) => ({ name: row.mc })),
        favorites: lists[1].map((row) => ({ name: row.mc })),
        recognized: [],
        counts: { signedUp: lists[0].length, favorites: lists[1].length, recognized: 0 },
      };
    },
    async unfinished() {
      return [
        { id: 11, mc: '志愿服务一小时', bmfs: { label: '平台报名' } },
        { id: 12, mc: '线下讲座', bmfs: { label: '线下报名' }, jtbmfs: '到紫金港小剧场门口签到' },
      ];
    },
    async call(method, path, params) {
      calls.push({ kind: 'call', method, path, params });
      return { code: 0, msg: '' };
    },
    async write(path, params) {
      calls.push({ kind: 'write', path, params });
      return { code: 0, msg: '' };
    },
  };
  return { ...base, ...overrides, calls };
}

/**
 * 装配一份工具：真 source 写工厂 + 假客户端，挂到最小 ctx 上。
 *
 * @param options.client - 假客户端。
 * @param options.outcome - 审批结果（`allowed-once` / `rejected` / …）。
 * @returns `{ tool, approval, client, asked }`。
 */
function harness({ client = fakeClient(), outcome = 'allowed-once' } = {}) {
  const sztz = createSztzWrites(client);
  /** 把写工厂的三个方法按服务面命名挂上去 —— 与 `source/sztz/src/index.js` 同形。 */
  const service = {};
  for (const [prefix, action] of [
    ['signupActivity', 'signupActivity'],
    ['cancelActivity', 'cancelActivity'],
    ['favoriteActivity', 'favoriteActivity'],
    ['unfavoriteActivity', 'unfavoriteActivity'],
  ]) {
    service[`${prefix}Prepare`] = (input) => sztz[action].prepare(input);
    service[`${prefix}Execute`] = (signal) => sztz[action].execute(signal);
    service[`${prefix}Cancel`] = () => sztz[action].cancel();
  }

  const asked = [];
  const approval = {
    async request(request) {
      asked.push(request);
      return outcome;
    },
  };

  const registered = [];
  const ctx = {
    get: (key) => (key === 'zhiyunSztz' ? service : undefined),
    tools: { register: (tool) => { registered.push(tool); return () => {}; } },
    approval,
    effect: (fn) => fn(),
  };
  apply(ctx);
  const tool = registered.find((item) => item.name === 'campus_activity');
  return { tool, approval, client, asked, service };
}

/** 一次成功的调用要带 agent（没有 agent 等于没有可审计主体，会 fail closed）。 */
const EXEC = { agent: { session: { id: 'session-fixture' } }, callId: 'call-1' };

/* ─────────────────────── 报名（回归，改过的路径） ─────────────────────── */

test('signup：Prepare 不发写请求，审批通过后才发', async () => {
  const { tool, client, asked } = harness();
  await tool.execute({ action: 'signup', activity: '志愿服务一小时' }, EXEC);

  assert.equal(asked.length, 1, '要问一次审批');
  assert.match(asked[0].reason, /报名二课活动：志愿服务一小时/, '审批框要说清做什么');
  const [call] = client.calls;
  assert.equal(call.kind, 'call');
  assert.equal(call.path, 'student/home/hdbm');
  assert.equal(call.params.id, 11);
});

/* ─────────────────────── 收藏：这次新加的两个 action ─────────────────────── */

test('favorite：Prepare 阶段一个写请求都不发（审批框弹出时平台状态还是原样）', async () => {
  const { tool, client } = harness();
  // 审批直接拒绝 —— 这样「只有 Prepare 跑过」的状态可以单独观察：
  // 若 Prepare 偷偷发了写请求，下面的 calls 就不会是空。
  const rejecting = harness({ client, outcome: 'rejected' });
  await assert.rejects(
    () => rejecting.tool.execute({ action: 'favorite', activity: '志愿服务一小时' }, EXEC),
    (error) => {
      assert.equal(error.code, 'WRITE_NOT_APPROVED');
      return true;
    },
  );
  assert.equal(client.calls.length, 0, '**Prepare 绝不发写请求**，审批被拒时更要如此');
  assert.equal(tool.name, 'campus_activity');
});

test('favorite：审批通过后走 hdsc，且用不重发的写入口', async () => {
  const { tool, client } = harness();
  const result = await tool.execute({ action: 'favorite', activity: '志愿服务一小时' }, EXEC);
  assert.equal(result.ok, true);
  assert.deepEqual(result.result, { ok: true, favorite: true, id: 11 });

  const [call] = client.calls;
  assert.equal(call.kind, 'write', '收藏是开关，不能走可重发的 call()');
  assert.equal(call.path, 'student/home/hdsc');
  assert.equal(call.params.id, 11);
});

test('unfavorite：审批通过后走 hdsc（同一个开关接口）', async () => {
  const client = fakeClient();
  client.lists[1] = [{ id: 11, mc: '志愿服务一小时' }];
  const { tool } = harness({ client });

  const result = await tool.execute({ action: 'unfavorite', activity: '志愿服务一小时' }, EXEC);
  assert.deepEqual(result.result, { ok: true, favorite: false, id: 11 });
  assert.equal(client.calls.at(-1).path, 'student/home/hdsc');
});

test('favorite：已经收藏过时**不发请求**，但仍然问一次审批', async () => {
  // 为什么仍然问：用户在请求一个动作，工具应当如实回报「这个动作不需要做」，
  // 而不是静默地当作已经完成 —— 但也绝不能真发出去（那是反向操作）。
  const client = fakeClient();
  client.lists[1] = [{ id: 11, mc: '志愿服务一小时' }];
  const { tool, asked } = harness({ client });

  const result = await tool.execute({ action: 'favorite', activity: '志愿服务一小时' }, EXEC);
  assert.equal(result.result.skipped, true);
  assert.equal(client.calls.length, 0, '状态已符合时一个写请求都不许发');
  assert.equal(asked.length, 1);
  assert.match(asked[0].reason, /没有提交/, '审批框要说明这次不会改平台状态');
});

/* ─────────────────────── 审批被拒之后能立刻重试 ─────────────────────── */

test('审批被拒后能**立刻**重试同一个动作（不 WRITE_BUSY，也不需要重启）', async () => {
  // Z-1 的原始缺陷：`cancel` 段缺了 → prepare 算出的参数一直占着写会话 →
  // 下一次 prepare 撞 WRITE_BUSY → 这个动作此后一直不能用。
  // 所以这里拒绝一次、再批准一次，第二次必须真的发得出去。
  const sztz = createSztzWrites(fakeClient());
  const client = fakeClient();
  const live = createSztzWrites(client);

  const service = {};
  for (const prefix of ['signupActivity', 'cancelActivity', 'favoriteActivity', 'unfavoriteActivity']) {
    service[`${prefix}Prepare`] = (input) => live[prefix].prepare(input);
    service[`${prefix}Execute`] = (signal) => live[prefix].execute(signal);
    service[`${prefix}Cancel`] = () => live[prefix].cancel();
  }

  /** 审批结果按调用次序给出。 */
  let outcome = 'rejected';
  const asked = [];
  const registered = [];
  const ctx = {
    get: (key) => (key === 'zhiyunSztz' ? service : undefined),
    tools: { register: (tool) => { registered.push(tool); return () => {}; } },
    approval: { async request(request) { asked.push(request); return outcome; } },
    effect: (fn) => fn(),
  };
  apply(ctx);
  const tool = registered.find((item) => item.name === 'campus_activity');

  // 第一次：用户拒绝
  await assert.rejects(
    () => tool.execute({ action: 'favorite', activity: '志愿服务一小时' }, EXEC),
    (error) => {
      assert.equal(error.code, 'WRITE_NOT_APPROVED', '拒绝的码必须是「没批准」，不是「忙」');
      return true;
    },
  );
  assert.equal(client.calls.length, 0, '拒绝就不许发');
  assert.equal(sztz.favoriteActivity !== undefined, true);

  // 第二次：用户改主意批准了。**不能**报 WRITE_BUSY。
  outcome = 'allowed-once';
  const result = await tool.execute({ action: 'favorite', activity: '志愿服务一小时' }, EXEC);
  assert.equal(result.ok, true);
  assert.equal(client.calls.length, 1, '第二次必须真的发出去');
  assert.equal(client.calls[0].path, 'student/home/hdsc');
  assert.equal(asked.length, 2);
});

test('审批通道不可用（没有 agent）时不发请求，且会话被撤销（不封锁）', async () => {
  const { tool, client } = harness();
  await assert.rejects(
    () => tool.execute({ action: 'favorite', activity: '志愿服务一小时' }, {}),
    (error) => {
      assert.equal(error.code, 'WRITE_NO_CHANNEL');
      return true;
    },
  );
  assert.equal(client.calls.length, 0);

  // 紧接着带 agent 重来一次：必须走得通（说明上一次的 write 会话已被撤销）。
  const result = await tool.execute({ action: 'favorite', activity: '志愿服务一小时' }, EXEC);
  assert.equal(result.ok, true);
});

/* ─────────────────────── 参数与契约边界 ─────────────────────── */

test('四个 action 都被声明，未知 action 报 INPUT 且先于服务查找', async () => {
  const { tool } = harness();
  assert.deepEqual(
    tool.parameters.properties.action.enum,
    ['signup', 'cancel', 'favorite', 'unfavorite'],
    '参数表是模型唯一能看到的东西，收藏必须在里面',
  );

  // 没有服务时也要先报 INPUT —— 用户写错动作不该收到「包没装」。
  const bare = [];
  apply({
    get: () => undefined,
    tools: { register: (item) => { bare.push(item); return () => {}; } },
    approval: { request: async () => 'rejected' },
    effect: (fn) => fn(),
  });
  await assert.rejects(
    () => bare[0].execute({ action: 'favourite', activity: 'x' }, EXEC),
    (error) => {
      assert.equal(error.code, 'INPUT');
      assert.match(error.message, /favorite/, '要把可用值列出来');
      return true;
    },
  );
});

test('source 缺 Cancel 时立刻报 CONTRACT_MISSING（否则审批被拒后永久不可用）', async () => {
  const registered = [];
  const half = {};
  for (const prefix of ['favoriteActivity', 'unfavoriteActivity']) {
    half[`${prefix}Prepare`] = async () => 'summary';
    half[`${prefix}Execute`] = async () => ({});
    // 故意不给 Cancel
  }
  apply({
    get: (key) => (key === 'zhiyunSztz' ? half : undefined),
    tools: { register: (tool) => { registered.push(tool); return () => {}; } },
    approval: { request: async () => 'allowed-once' },
    effect: (fn) => fn(),
  });
  const tool = registered.find((item) => item.name === 'campus_activity');
  for (const action of ['favorite', 'unfavorite']) {
    await assert.rejects(
      () => tool.execute({ action, activity: 'x' }, EXEC),
      (error) => {
        assert.equal(error.code, 'CONTRACT_MISSING');
        assert.match(error.message, /Cancel/, '错误里要指出缺的是 cancel');
        return true;
      },
    );
  }
});
