/**
 * 平台待办上的**本机勾选**（`ticks.json`）。
 *
 * 这个功能有一个必须钉死的语义边界：**勾选是本机标记，不是平台的完成状态。**
 * 勾一下不会让学在浙大认为作业交过了，也不会让拼题A 关闭题集。所以这里的断言分四类：
 *
 *   1. 键的形状：必须带 source（两个平台的 id 都是小整数，`xzzd:12` ≠ `pta:12`）；
 *   2. 没有稳定身份就不能勾（勾了也会在下次同步时凭空消失）；
 *   3. 只存"勾了哪些"，取消即删除 —— 不存"没勾哪些"，否则文件会无限增长；
 *   4. prune 的**保护条件**：一边读取失败时绝不能清空（一次网络抖动就清掉
 *      用户一学期的标记，是灾难）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TickStore, tickKey } from '../packages/dsh-zhiyun-page-planning/src/ticks.js';
import { normalizeTicks } from '../packages/dsh-zhiyun-page-planning/src/ticks.js';
import { createHandler } from '../packages/dsh-zhiyun-page-planning/src/index.js';

/* ────────────────────────────────────── 键的形状 */

test('键必须带来源：两个平台的小整数 id 会撞', () => {
  assert.equal(tickKey('xzzd', 12), 'xzzd:12');
  assert.equal(tickKey('pta', 12), 'pta:12');
  assert.notEqual(tickKey('xzzd', 12), tickKey('pta', 12), '只按 id 存会互相覆盖');
  // 数字与字符串 id 归一
  assert.equal(tickKey('xzzd', 12), tickKey('xzzd', '12'));
  assert.equal(tickKey('xzzd', ' 12 '), 'xzzd:12');
});

test('没有稳定身份就不能勾', () => {
  // 空 id 的条目勾了也会在下次同步时凭空消失 —— 比不能勾更糟
  for (const bad of ['', '   ', null, undefined]) {
    assert.equal(tickKey('xzzd', bad), null, `${JSON.stringify(bad)} 不该能勾`);
  }
  // 不认识的来源也不收：中转站条目与自己的规划各有各的存储
  for (const bad of ['mine', 'plan', 'other', '', null]) {
    assert.equal(tickKey(bad, 1), null);
  }
});

/* ────────────────────────────────────── 基本读写 */

test('勾选 / 取消 / 落盘读回', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-ticks-'));
  const file = path.join(dir, 'ticks.json');
  try {
    const store = new TickStore(file);
    assert.equal(store.isDone('xzzd', 101), false, '默认未勾');

    const result = store.setDone('xzzd', 101, true);
    assert.deepEqual(result, { key: 'xzzd:101', done: true });
    assert.equal(store.isDone('xzzd', 101), true);
    assert.equal(store.isDone('pta', 101), false, '不同来源互不影响');

    // 落盘后重新打开仍在
    const reopened = new TickStore(file);
    assert.equal(reopened.isDone('xzzd', 101), true);
    assert.ok(reopened.all()['xzzd:101'].doneAt, 'doneAt 要记下时间');

    // 取消 = 删除键，不是存一个 false
    reopened.setDone('xzzd', 101, false);
    assert.equal(reopened.isDone('xzzd', 101), false);
    assert.deepEqual(Object.keys(reopened.all()), [], '取消后不该留下 false 记录');
    assert.deepEqual(Object.keys(new TickStore(file).all()), [], '磁盘上也要真的删掉');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('没有身份的条目：setDone 返回 null，不抛错也不留下垃圾', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-ticks-'));
  try {
    const store = new TickStore(path.join(dir, 'ticks.json'));
    assert.equal(store.setDone('xzzd', '', true), null);
    assert.equal(store.setDone('unknown', 1, true), null);
    assert.deepEqual(Object.keys(store.all()), []);
    assert.equal(store.isDone('xzzd', ''), false, '无身份的查询也安全');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('坏文件退回空表而不是抛错', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-ticks-'));
  const file = path.join(dir, 'ticks.json');
  try {
    await writeFile(file, 'not json', 'utf8');
    assert.deepEqual(new TickStore(file).all(), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('脏记录被过滤，不影响其它勾选', () => {
  const clean = normalizeTicks({
    'xzzd:1': { doneAt: 1792320965 },
    'pta:2': { doneAt: 1792320966 },
    // 下面这些都不该留下
    'unknown:3': { doneAt: 1 },
    'xzzd:': { doneAt: 1 },
    'nokey': { doneAt: 1 },
    'xzzd:4': null,
    'xzzd:5': { doneAt: '不是数字' },
  });
  assert.deepEqual(Object.keys(clean).sort(), ['pta:2', 'xzzd:1', 'xzzd:5']);
  assert.equal(clean['xzzd:1'].doneAt, 1792320965);
  // doneAt 坏了不算错，但要归一成 null 而不是留个字符串
  assert.equal(clean['xzzd:5'].doneAt, null);
});

test('非对象输入一律退回空表', () => {
  for (const bad of [null, undefined, [], 'x', 42]) {
    assert.deepEqual(normalizeTicks(bad), {});
  }
});

/* ────────────────────────────────────── prune */

test('prune 清掉平台侧已不存在的条目', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-ticks-'));
  try {
    const store = new TickStore(path.join(dir, 'ticks.json'));
    store.setDone('xzzd', 1, true);
    store.setDone('xzzd', 2, true);
    store.setDone('pta', 3, true);

    const removed = store.prune(['xzzd:1', 'pta:3']);
    assert.equal(removed, 1, '只清掉 xzzd:2');
    assert.deepEqual(Object.keys(store.all()).sort(), ['pta:3', 'xzzd:1']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prune 不删还有效的勾选，且没有可删时不写盘', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-ticks-'));
  const file = path.join(dir, 'ticks.json');
  try {
    const store = new TickStore(file);
    store.setDone('xzzd', 1, true);
    const before = await readFile(file, 'utf8');
    assert.equal(store.prune(['xzzd:1']), 0);
    assert.equal(await readFile(file, 'utf8'), before, '没变化就不该重写文件');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * 复刻 `index.js` 里 `loadTodos` 末尾那段 prune 条件。
 *
 * 这是本文件最重要的一条：**只有两边都读到才清**。某一边读取失败时 `rows` 是空的，
 * 按空表去 prune 会把用户所有现有勾选一次性删光 —— 一次网络抖动就清掉一学期的标记。
 */
function pruneAfterLoad(store, xzzdResult, ptaResult) {
  const live = [];
  if (xzzdResult.ok) for (const row of xzzdResult.rows) live.push(tickKey('xzzd', row.id));
  if (ptaResult.ok) for (const row of ptaResult.rows) live.push(tickKey('pta', row.id));
  if (xzzdResult.ok && ptaResult.ok) return store.prune(live.filter(Boolean));
  return -1; // 跳过这一轮
}

test('有一边读取失败时，绝不能清掉勾选（一次抖动 = 一学期的标记）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-ticks-'));
  try {
    const store = new TickStore(path.join(dir, 'ticks.json'));
    store.setDone('xzzd', 101, true);
    store.setDone('xzzd', 102, true);

    // 拼题A 挂了，它的 rows 是空的
    const skipped = pruneAfterLoad(
      store,
      { ok: true, rows: [{ id: '101' }] },
      { ok: false, rows: [] },
    );
    assert.equal(skipped, -1, '该跳过 prune');
    assert.deepEqual(Object.keys(store.all()).sort(), ['xzzd:101', 'xzzd:102'], '勾选必须全部保留');

    // 学在浙大挂了也一样
    pruneAfterLoad(store, { ok: false, rows: [] }, { ok: true, rows: [] });
    assert.equal(Object.keys(store.all()).length, 2, '另一边挂了同样跳过');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('两边都读到之后，才清掉真正消失的那些', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-ticks-'));
  try {
    const store = new TickStore(path.join(dir, 'ticks.json'));
    store.setDone('xzzd', 101, true);
    store.setDone('xzzd', 102, true);
    store.setDone('pta', 201, true);

    // 102 在平台侧消失了，201 还在
    const removed = pruneAfterLoad(
      store,
      { ok: true, rows: [{ id: '101' }] },
      { ok: true, rows: [{ id: '201' }] },
    );
    assert.equal(removed, 1);
    assert.deepEqual(Object.keys(store.all()).sort(), ['pta:201', 'xzzd:101']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('两边的同名 id 互不牵连', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-ticks-'));
  try {
    const store = new TickStore(path.join(dir, 'ticks.json'));
    store.setDone('xzzd', 7, true);
    store.setDone('pta', 7, true);

    // 只保留 pta:7 —— xzzd:7 该被清，pta:7 该留
    pruneAfterLoad(store, { ok: true, rows: [] }, { ok: true, rows: [{ id: '7' }] });
    assert.deepEqual(Object.keys(store.all()), ['pta:7']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ────────────────────────────────────── 路由 */

/** 起一个 handler，`loadTodos` 用注入的假数据（不碰网络）。 */
function makeHandler({ tickStore, todos }) {
  return createHandler({
    getConfig: () => ({ endpoint: '', readKey: '' }),
    saveConfig: () => {},
    store: { entries: [], list() { return []; }, absorb() { return { added: [], skipped: 0 }; } },
    local: { list: () => [], find: () => null },
    tickStore,
    fetchRemote: async () => ({ ok: false, code: 'NOT_CONFIGURED', message: '没配' }),
    loadTodos: async () => todos,
    savePtaCookie: async () => ({}),
    ptaStatus: async () => ({ configured: false }),
    plan: { run: async () => ({}), list: () => ({}), plannedKeys: () => [], forget() {}, setCardDone: () => null },
  });
}

function call(handler, method, url, body) {
  return new Promise((resolve) => {
    const req = {
      method,
      url,
      headers: { host: '127.0.0.1:43120', 'x-zhiyun-planning': '1' },
      [Symbol.asyncIterator]: async function* iterator() {
        if (body !== undefined) yield Buffer.from(JSON.stringify(body));
      },
    };
    const res = {
      status: 0,
      writeHead(status) { this.status = status; },
      end(chunk) { resolve({ status: this.status, body: JSON.parse(chunk) }); },
    };
    handler(req, res);
  });
}

const EMPTY_TODOS = {
  xzzd: { ok: true, rows: [{ source: 'xzzd', id: '101', title: '交作业' }], error: null },
  pta: { ok: true, rows: [{ source: 'pta', id: '101', title: '题集' }], error: null },
};

test('路由能勾平台待办，并把 ticks 放进快照', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-ticks-'));
  try {
    const store = new TickStore(path.join(dir, 'ticks.json'));
    const handler = makeHandler({ tickStore: store, todos: EMPTY_TODOS });

    const r = await call(handler, 'POST', '/?todo-done', { source: 'xzzd', id: '101', done: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.ticks['xzzd:101'] !== undefined, true);
    assert.equal(r.body.ticks['pta:101'], undefined, '同名 id 的另一边不该被连带勾上');

    /**
     * ⚠️ 这里**刻意不再要求**响应里带整份快照。
     *
     * 勾选是**纯本端状态**：网关只传待办内容，不传状态，所以写盘完成即最终结果。
     * 旧实现把 `...await snapshot()` 拼进响应，等于每勾一下都要重算并序列化几十 KB
     * （本地副本也要读盘、算 mask、拼 todos）—— 而前端已经乐观更新过，拿了也用不上。
     *
     * 现在的契约是「只回这一次改动」：`{ ok, key, done, ticks: { <key>: … } }`。
     * 页面靠自己的 `state.ticks` 渲染，下一次快照自然会带上完整表。
     */
    assert.equal(r.body.todos, undefined, '勾选不该回整份快照（那是纯本端状态）');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('缺身份 / 缺存储都各有明确拒绝', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-ticks-'));
  try {
    const store = new TickStore(path.join(dir, 'ticks.json'));
    const handler = makeHandler({ tickStore: store, todos: EMPTY_TODOS });

    let r = await call(handler, 'POST', '/?todo-done', { source: 'xzzd', id: '', done: true });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /没有可用的身份/);

    r = await call(handler, 'POST', '/?todo-done', { source: 'other', id: '1', done: true });
    assert.equal(r.status, 400);

    // tickStore 缺席（极简装配）时不该崩
    const bare = makeHandler({ tickStore: undefined, todos: EMPTY_TODOS });
    r = await call(bare, 'POST', '/?todo-done', { source: 'xzzd', id: '101', done: true });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /未启用/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('勾选不需要模型服务（纯粹是本机写）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-ticks-'));
  try {
    const store = new TickStore(path.join(dir, 'ticks.json'));
    // 这个 handler 的 plan 是个空壳，没有 AI 也能勾
    const handler = makeHandler({ tickStore: store, todos: EMPTY_TODOS });
    const r = await call(handler, 'POST', '/?todo-done', { source: 'pta', id: '101', done: true });
    assert.equal(r.status, 200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


/* ────────────────────────────── 打勾只回本次改动（不回整份快照） */

/**
 * 需求（OWNER）：网关只传待办内容，**不传状态**；所有状态都在本端。
 * 所以「勾一下」必须是本端立刻生效的纯本地写，不该顺带重算远端数据。
 *
 * 这组测试钉两件事：
 *   1. 响应只含**这一次**改动（不含整份 todos / entries）；
 *   2. 重复勾同一键是幂等的，且不产生额外记录。
 */

test('打勾的响应只含本次改动，不含整份快照', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-tick-shape-'));
  try {
    const store = new TickStore(path.join(dir, 'ticks.json'));
    const handler = makeHandler({ tickStore: store, todos: EMPTY_TODOS });

    const r = await call(handler, 'POST', '/?todo-done', { source: 'xzzd', id: '7', done: true });

    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.key, 'xzzd:7');
    assert.equal(r.body.done, true);
    // 只带这一个键
    assert.deepEqual(Object.keys(r.body.ticks), ['xzzd:7']);
    // 整份数据一律不出现
    for (const banned of ['todos', 'entries', 'remote', 'pta', 'plans', 'local']) {
      assert.equal(r.body[banned], undefined, `不该回 ${banned}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('取消勾选回空 ticks（表示这一键已删除）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-tick-del-'));
  try {
    const store = new TickStore(path.join(dir, 'ticks.json'));
    const handler = makeHandler({ tickStore: store, todos: EMPTY_TODOS });

    await call(handler, 'POST', '/?todo-done', { source: 'xzzd', id: '7', done: true });
    const r = await call(handler, 'POST', '/?todo-done', { source: 'xzzd', id: '7', done: false });

    assert.equal(r.body.ok, true);
    assert.equal(r.body.done, false);
    assert.deepEqual(r.body.ticks, {});
    // 存储里也真的删了，否则下次快照会把它带回"已勾"
    assert.equal(store.isDone('xzzd', '7'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('反复勾同一个键不会让 ticks 文件膨胀', async () => {
  // 乐观更新会连续发好几次（用户快速点），存储必须是幂等的
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-tick-idem-'));
  try {
    const store = new TickStore(path.join(dir, 'ticks.json'));
    const handler = makeHandler({ tickStore: store, todos: EMPTY_TODOS });

    for (let i = 0; i < 5; i += 1) {
      await call(handler, 'POST', '/?todo-done', { source: 'xzzd', id: '9', done: true });
    }
    assert.equal(Object.keys(store.all()).length, 1, '重复勾只该留一条');
    assert.equal(store.isDone('xzzd', '9'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
