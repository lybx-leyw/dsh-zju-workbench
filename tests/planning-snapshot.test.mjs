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

/* ────────────────────────────── 中转站 10 分钟缓存 */

/**
 * 需求（OWNER）：中转站与学在浙大/PTA 的数据 **10 分钟内有缓存就走缓存**，
 * 否则重新拉。
 *
 * 为什么：这些来源变化不频繁（老师不会每分钟发一次作业、别人也不会每分钟
 * 往中转站里加一条），而每次刷新规划页都重拉一遍，等于把网络延迟重复加到
 * 首屏。
 *
 * ⚠️ 但**用户自己新增/勾选的条目绝不能进这个缓存** —— 它们存在 `store` /
 * `local` 里，本来就即时生效。缓存只包住"远端那一份"。
 */

/** 用可变时钟起一个 handler，便于把时间推过 TTL。 */
function makeCachedHandler({ ttlMs = 10 * 60 * 1000, entries = [{ text: '来自中转站' }] } = {}) {
  let clock = 1_000_000;
  const pulls = [];
  const handler = createHandler({
    getConfig: () => ({ endpoint: 'https://relay.example/api', readKey: 'k1' }),
    saveConfig: () => {},
    store: { list() { return []; }, absorb() { return { added: entries, skipped: 0 }; } },
    local: { list: () => [], find: () => null },
    tickStore: null,
    fetchRemote: async () => {
      pulls.push(clock);
      return { ok: true, entries, total: entries.length };
    },
    loadTodos: async () => ({
      xzzd: { ok: true, rows: [], error: null },
      pta: { ok: true, rows: [], error: null },
    }),
    savePtaCookie: async () => ({}),
    ptaStatus: async () => ({ configured: false }),
    plan: null,
    remoteCacheTtlMs: ttlMs,
  });
  return { handler, pulls, advance: (ms) => { clock += ms; return clock; } };
}

test('中转站：10 分钟内重复刷新只拉一次', async () => {
  const { handler, pulls } = makeCachedHandler();

  await get(handler);
  await get(handler);
  await get(handler);

  assert.equal(pulls.length, 1, `3 次刷新应只拉 1 次，实际 ${pulls.length} 次`);
});

test('中转站：缓存命中时 remote 标出 cached', async () => {
  const { handler } = makeCachedHandler();
  const first = await get(handler);
  const second = await get(handler);

  assert.equal(first.body.remote.cached, undefined, '第一次是真拉，不该标 cached');
  assert.equal(second.body.remote.cached, true, '第二次应标 cached');
});

test('中转站：换 endpoint 或 readKey 立刻失效，不复用旧缓存', async () => {
  // 这条是正确性边界：沿用 A 站的缓存会把 A 的内容显示成 B 的
  const pulls = [];
  let cfg = { endpoint: 'https://a.example/api', readKey: 'ka' };
  const handler = createHandler({
    getConfig: () => cfg,
    saveConfig: () => {},
    store: { list() { return []; }, absorb() { return { added: [], skipped: 0 }; } },
    local: { list: () => [], find: () => null },
    tickStore: null,
    fetchRemote: async () => {
      pulls.push(cfg.endpoint);
      return { ok: true, entries: [], total: 0 };
    },
    loadTodos: async () => ({ xzzd: { ok: true, rows: [], error: null }, pta: { ok: true, rows: [], error: null } }),
    savePtaCookie: async () => ({}),
    ptaStatus: async () => ({ configured: false }),
    plan: null,
  });

  await get(handler);
  await get(handler);
  assert.deepEqual(pulls, ['https://a.example/api'], '同一配置应复用缓存');

  cfg = { endpoint: 'https://b.example/api', readKey: 'kb' };
  await get(handler);
  assert.deepEqual(pulls, ['https://a.example/api', 'https://b.example/api'], '换站必须重拉');
});

test('中转站：manual clear() 后立刻重拉', async () => {
  const { handler, pulls } = makeCachedHandler();
  await get(handler);
  await get(handler);
  assert.equal(pulls.length, 1);

  handler.remoteCache.clear();
  await get(handler);
  assert.equal(pulls.length, 2, 'clear 后应重拉');
});

test('中转站：拉取失败**不进缓存**，下次照常重试', async () => {
  // 失败缓存 10 分钟 = 用户修好配置后还要等十分钟，那是不可接受的
  let fail = true;
  let calls = 0;
  const handler = createHandler({
    getConfig: () => ({ endpoint: 'https://relay.example/api', readKey: 'k' }),
    saveConfig: () => {},
    store: { list() { return []; }, absorb() { return { added: [], skipped: 0 }; } },
    local: { list: () => [], find: () => null },
    tickStore: null,
    fetchRemote: async () => {
      calls += 1;
      return fail
        ? { ok: false, code: 'ECONNRESET', message: '断了' }
        : { ok: true, entries: [{ text: 'x' }], total: 1 };
    },
    loadTodos: async () => ({ xzzd: { ok: true, rows: [], error: null }, pta: { ok: true, rows: [], error: null } }),
    savePtaCookie: async () => ({}),
    ptaStatus: async () => ({ configured: false }),
    plan: null,
  });

  const bad = await get(handler);
  assert.equal(bad.body.remote.error.code, 'ECONNRESET');

  fail = false;
  const good = await get(handler);
  assert.equal(calls, 2, '失败不该被缓存住');
  assert.equal(good.body.remote.synced, true);
  assert.equal(good.body.remote.error, null);
});

test('用户自己的条目不受远端缓存影响', async () => {
  // 缓存只包住远端那一份。本地新增/勾选必须永远即时可见。
  const localEntries = [{ id: 'mine-1', title: '我自己加的' }];
  const handler = createHandler({
    getConfig: () => ({ endpoint: 'https://relay.example/api', readKey: 'k' }),
    saveConfig: () => {},
    store: { list() { return []; }, absorb() { return { added: [], skipped: 0 }; } },
    local: { list: () => localEntries, find: () => null },
    tickStore: null,
    fetchRemote: async () => ({ ok: true, entries: [], total: 0 }),
    loadTodos: async () => ({ xzzd: { ok: true, rows: [], error: null }, pta: { ok: true, rows: [], error: null } }),
    savePtaCookie: async () => ({}),
    ptaStatus: async () => ({ configured: false }),
    plan: null,
  });

  await get(handler);
  const second = await get(handler);   // 这一次远端走缓存
  assert.equal(second.body.local.length, 1, '本地条目必须照常返回');
  assert.equal(second.body.local[0].title, '我自己加的');
});
