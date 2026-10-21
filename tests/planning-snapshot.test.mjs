/**
 * 快照的**降级**：一个来源读不到，不该让整页拿不到任何数据。
 *
 * # 这个文件守的是真实故障
 *
 * 第一版 `snapshot()` 用 `Promise.all`，注释还写着"各链路内部都把异常收成了 error，
 * 所以 all 不会被 reject"。这句话是错的：`loadTodos` 在校园数据包缺席时**会** reject
 * （当年那个包叫 `zhiyunOmni`，现已按平台拆分删除；但这条降级约束不变）。
 *
 * 后果不是"某一区块缺失"，而是：
 *
 *   1. `snapshot()` 抛出去 → handler 没有 try，异常冒到宿主 Web 层；
 *   2. 宿主捕到未处理异常后回的是**空 body 的 `400`**；
 *   3. 页面把它翻译成「设置接口返回 400 / 宿主侧没起来，重启一次工作台再试」。
 *
 * 于是"学在浙大没登录"这个**正常状态**，被显示成"宿主坏了"。
 * 用户会去重启，而重启当然没用。
 *
 * 所以这里钉三件事：
 *   1. 任一链路抛错时，GET 仍回 200；
 *   2. 错误落到**它自己那个区块**，不冒充全局失败；
 *   3. 其它来源（自己的规划、勾选、映射）照常返回 —— 它们根本不依赖网络。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../packages/dsh-zhiyun-page-planning/src/index.js';

/** 起一个 handler；每个依赖都可以单独注入"抛错"。 */
function makeHandler(overrides = {}) {
  return createHandler({
    getConfig: () => ({ endpoint: '', readKey: '' }),
    saveConfig: () => {},
    store: { entries: [], list() { return []; }, absorb() { return { added: [], skipped: 0 }; } },
    local: { list: () => [], find: () => null },
    tickStore: null,
    fetchRemote: async () => ({ ok: false, code: 'NOT_CONFIGURED', message: '没配' }),
    loadTodos: async () => ({
      xzzd: { ok: true, rows: [], error: null },
      pta: { ok: true, rows: [], error: null },
    }),
    savePtaCookie: async () => ({}),
    ptaStatus: async () => ({ configured: false }),
    plan: null,
    ...overrides,
  });
}

function get(handler) {
  return new Promise((resolve) => {
    const req = {
      method: 'GET',
      url: '/',
      headers: { host: '127.0.0.1:43120' },
      [Symbol.asyncIterator]: async function* iterator() {},
    };
    const res = {
      status: 0,
      writeHead(status) { this.status = status; },
      end(chunk) { resolve({ status: this.status, body: JSON.parse(chunk) }); },
    };
    // handler 若抛出，让它 reject 出来 —— 这正是要防的情况
    handler(req, res).catch((error) => resolve({ status: 'threw', error }));
  });
}

/* ────────────────────────────────────── 单条链路抛错 */

test('待办读不到（未登录）时，GET 仍回 200 而不是空 body 的 400', async () => {
  const handler = makeHandler({
    loadTodos: async () => {
      const error = new Error('还没登录浙大账号');
      error.code = 'LOGIN_REQUIRED';
      throw error;
    },
  });
  const { status, body, error } = await get(handler);

  assert.notEqual(status, 'threw', `handler 不该抛出：${error?.message}`);
  assert.notEqual(status, 400, '400 会让页面显示"宿主侧没起来"，而宿主好好的');
  assert.equal(status, 200);
  assert.ok(body, '必须回一个 JSON body');
});

test('错误落在它自己的区块，不冒充全局失败', async () => {
  const handler = makeHandler({
    loadTodos: async () => { throw new Error('还没登录浙大账号'); },
  });
  const { body } = await get(handler);

  assert.equal(body.todos.xzzd.ok, false, '学在浙大该标成失败');
  assert.match(body.todos.xzzd.error.message, /还没登录/);
  assert.equal(body.todos.xzzd.error.code, 'XZZD_FAILED', '要带一个确定的 code 给页面用');
  // 关键：不是"整页级"错误。`remote` 是页面唯一当全局错误看的那一项。
  assert.equal(body.remote.error, null, '中转站没配是 NOT_CONFIGURED，不是这次的故障');
});

test('拼题A 状态查询抛错时，也只影响它自己那块', async () => {
  const handler = makeHandler({
    ptaStatus: async () => { throw new Error('校园数据包未启用'); },
  });
  const { status, body } = await get(handler);
  assert.equal(status, 200);
  assert.equal(body.pta.configured, false);
  assert.match(body.pta.error, /校园数据包未启用/);
  assert.equal(body.todos.xzzd.ok, true, '学在浙大不该被连累');
});

test('中转站同步抛错时，remote 带错误但其它照常', async () => {
  // ⚠️ 必须给一个**已配置**的 endpoint：`sync()` 在没配时直接短路返回
  // `{ error: null }`，根本不会调用 `fetchRemote` —— 那样测的就不是这里要测的东西。
  const handler = makeHandler({
    getConfig: () => ({ endpoint: 'https://a-b.ms.show', readKey: 'read-key-1234' }),
    fetchRemote: async () => { throw new Error('ECONNRESET'); },
  });
  const { status, body } = await get(handler);
  assert.equal(status, 200);
  assert.equal(body.remote.synced, false);
  assert.match(body.remote.error.message, /ECONNRESET/);
  assert.equal(body.todos.xzzd.ok, true);
});

/* ────────────────────────────────────── 全部失败也要能开页 */

test('三个来源**同时**失败，页面仍拿到它自己的数据', async () => {
  const handler = makeHandler({
    loadTodos: async () => { throw new Error('学在浙大挂了'); },
    ptaStatus: async () => { throw new Error('拼题A 挂了'); },
    fetchRemote: async () => { throw new Error('中转站挂了'); },
    local: { list: () => [{ id: 'p1', title: '我自己写的一条' }], find: () => null },
    tickStore: { all: () => ({ 'xzzd:1': { doneAt: 1 } }) },
    plan: { run: async () => ({}), list: () => ({ k: { cards: [] } }), plannedKeys: () => ['k'], forget() {} },
  });
  const { status, body } = await get(handler);

  assert.equal(status, 200, '三个来源全挂也不该让页面打不开');
  // 本地那几份根本不依赖网络，必须照常返回
  assert.deepEqual(body.local.map((item) => item.title), ['我自己写的一条']);
  assert.deepEqual(body.ticks, { 'xzzd:1': { doneAt: 1 } });
  assert.deepEqual(body.plannedKeys, ['k']);
  // 三个来源各自带错
  assert.equal(body.todos.xzzd.ok, false);
  assert.equal(body.todos.pta.ok, false);
  assert.equal(body.remote.synced, false);
});

/* ────────────────────────────────────── 兜底 */

test('连 store.list() 都炸（磁盘问题）时，回 500 + 可读错误，而不是让宿主回空 400', async () => {
  const handler = makeHandler({
    store: {
      entries: [],
      list() { throw new Error('磁盘写满了'); },
      absorb() { return { added: [], skipped: 0 }; },
    },
  });
  const { status, body, error } = await get(handler);

  assert.notEqual(status, 'threw', `handler 不该抛出：${error?.message}`);
  assert.equal(status, 500);
  assert.equal(body.error.code, 'SNAPSHOT_FAILED');
  assert.match(body.error.message, /磁盘写满了/);
});

test('正常路径不受影响：所有区块都在且都是 ok', async () => {
  const handler = makeHandler({
    local: { list: () => [{ id: 'p1', title: '一条' }], find: () => null },
    tickStore: { all: () => ({}) },
    plan: { run: async () => ({}), list: () => ({}), plannedKeys: () => [], forget() {} },
  });
  const { status, body } = await get(handler);

  assert.equal(status, 200);
  for (const key of ['config', 'entries', 'remote', 'todos', 'pta', 'plans', 'plannedKeys', 'local', 'ticks']) {
    assert.ok(key in body, `快照缺少 ${key}`);
  }
  assert.equal(body.todos.xzzd.ok, true);
  assert.equal(body.todos.pta.ok, true);
});
