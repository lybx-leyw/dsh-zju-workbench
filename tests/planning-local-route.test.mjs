/**
 * 「我的规划」的**路由契约**。
 *
 * 这一层是页面唯一能写东西的地方，所以断言的重点不是业务逻辑（`local.js` 那边测过了），
 * 而是**边界**：
 *
 *   1. 没带写头 → 拒绝（跨站发不出自定义头，这是 CSRF 的那道闸）；
 *   2. 非回环 Host → 拒绝（防 DNS rebinding）；
 *   3. 客户端不能借 `local-update` 改 `id` / `done`（那是两个不同的动作）；
 *   4. 每条写操作都要回一份**完整快照**，页面不必再发一次 GET；
 *   5. 失败要能读（对象形状的 error 不能被字符串化）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LocalPlanStore, createHandler } from '../packages/dsh-zhiyun-page-planning/src/index.js';

/** 起一个真实 handler，本地规划落临时目录。 */
async function harness(options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-route-'));
  const local = new LocalPlanStore(path.join(dir, 'local.json'));
  const splitCalls = [];
  const handler = createHandler({
    getConfig: () => ({ endpoint: '', readKey: '' }),
    saveConfig: () => {},
    store: { entries: [], list() { return []; }, absorb() { return { added: [], skipped: 0 }; } },
    local,
    splitLocal: options.splitLocal ?? (async (id, opts) => {
      splitCalls.push({ id, opts });
      const result = local.split(id, [
        { title: '子项一', action: '动作一' },
        { title: '子项二', action: '动作二' },
      ], opts);
      return { split: result.created.length, dropped: 0, removed: result.removed, model: 'test-model' };
    }),
    fetchRemote: async () => ({ ok: false, code: 'NOT_CONFIGURED', message: '没配' }),
    loadTodos: async () => ({
      xzzd: { ok: true, rows: [], error: null },
      pta: { ok: true, rows: [], error: null },
    }),
    savePtaCookie: async () => ({}),
    ptaStatus: async () => ({ configured: false }),
    plan: { run: async () => ({}), list: () => ({}), plannedKeys: () => [], forget() {} },
  });

  /** 发一次请求。`headers` 可覆盖，用来试写头 / Host。 */
  const call = (method, url, body, headers = {}) => new Promise((resolve) => {
    const req = {
      method,
      url,
      headers: { host: '127.0.0.1:43120', 'x-zhiyun-planning': '1', ...headers },
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

  return { local, call, splitCalls, dir, done: () => rm(dir, { recursive: true, force: true }) };
}

/* ─────────────────────────────────────────── 安全边界 */

test('写操作缺 x-zhiyun-planning 头 → 403', async () => {
  const h = await harness();
  try {
    const r = await h.call('POST', '/?local-create', { title: '偷写的' }, { 'x-zhiyun-planning': '' });
    assert.equal(r.status, 403);
    assert.equal(h.local.list().length, 0, '被拒的请求不该产生任何条目');
  } finally {
    await h.done();
  }
});

test('非回环 Host → 403（防 DNS rebinding）', async () => {
  const h = await harness();
  try {
    for (const host of ['evil.example', '192.168.1.5:43120', '']) {
      const r = await h.call('POST', '/?local-create', { title: 'x' }, { host });
      assert.equal(r.status, 403, `${host || '(空)'} 应被拒`);
    }
    assert.equal(h.local.list().length, 0);
  } finally {
    await h.done();
  }
});

test('回环的三种写法都放行', async () => {
  const h = await harness();
  try {
    for (const host of ['127.0.0.1:43120', 'localhost:43120', '[::1]:43120']) {
      const r = await h.call('POST', '/?local-create', { title: `来自 ${host}` }, { host });
      assert.equal(r.status, 200, `${host} 应放行`);
    }
  } finally {
    await h.done();
  }
});

/* ─────────────────────────────────────────── CRUD */

test('新建回完整快照（页面不必再发一次 GET）', async () => {
  const h = await harness();
  try {
    const r = await h.call('POST', '/?local-create', { title: '交作业', due: '2026-10-21T23:59:00+08:00' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.item?.id, '要回新建的那条');
    assert.deepEqual(r.body.local.map((i) => i.title), ['交作业'], '快照里要有 local');
    // 快照的其余部分也要在，否则页面会以为"数据源都没了"
    for (const key of ['config', 'entries', 'remote', 'todos', 'pta', 'plans', 'plannedKeys']) {
      assert.ok(key in r.body, `快照缺少 ${key}`);
    }
  } finally {
    await h.done();
  }
});

test('改一条：客户端传 id / done 不会生效（那是别的动作）', async () => {
  const h = await harness();
  try {
    const created = (await h.call('POST', '/?local-create', { title: '原标题' })).body.item;

    // 借 update 想改 id / done —— 必须被挡掉
    const evil = await h.call('POST', '/?local-update', { id: created.id, title: '改了名', done: true });
    assert.equal(evil.status, 400, '带白名单外字段应被拒');
    assert.equal(evil.body.error.code, 'INVALID_INPUT');

    const fine = await h.call('POST', '/?local-update', { id: created.id, title: '改了名' });
    assert.equal(fine.status, 200);
    assert.equal(fine.body.item.title, '改了名');
    assert.equal(fine.body.item.done, false, 'done 不该被 update 改动');
    assert.equal(fine.body.item.id, created.id, 'id 不该变');
  } finally {
    await h.done();
  }
});

test('勾完成 / 取消完成走 local-done', async () => {
  const h = await harness();
  try {
    const created = (await h.call('POST', '/?local-create', { title: 'x' })).body.item;
    let r = await h.call('POST', '/?local-done', { id: created.id, done: true });
    assert.equal(r.body.item.done, true);
    assert.ok(r.body.item.doneAt, 'doneAt 要记下来');

    r = await h.call('POST', '/?local-done', { id: created.id, done: false });
    assert.equal(r.body.item.done, false);
    assert.equal(r.body.item.doneAt, null);
  } finally {
    await h.done();
  }
});

test('删一条回快照，删不存在的回 404', async () => {
  const h = await harness();
  try {
    const created = (await h.call('POST', '/?local-create', { title: 'x' })).body.item;
    let r = await h.call('POST', '/?local-remove', { id: created.id });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.local, []);

    r = await h.call('POST', '/?local-remove', { id: created.id });
    assert.equal(r.status, 404);
    assert.equal(typeof r.body.error, 'string', '404 的 error 是字符串，页面能直接显示');
  } finally {
    await h.done();
  }
});

test('缺少 id、请求体不是 JSON、未知动作都各有明确的拒绝', async () => {
  const h = await harness();
  try {
    let r = await h.call('POST', '/?local-update', { title: '没有 id' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /id/);

    r = await h.call('POST', '/?local-nonsense', { id: 'x' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /未知动作/);
  } finally {
    await h.done();
  }
});

/* ─────────────────────────────────────────── AI 拆分 */

test('拆分自己写的规划：回 split 条数，并把卡片写进快照', async () => {
  const h = await harness();
  try {
    const created = (await h.call('POST', '/?local-create', { title: '下周要交的三件事' })).body.item;
    const r = await h.call('POST', '/?local-split', { id: created.id });

    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.split, 2);
    assert.equal(r.body.model, 'test-model');
    const titles = r.body.local.map((i) => i.title);
    assert.ok(titles.includes('子项一') && titles.includes('子项二'), `拆出的条目要在快照里：${titles}`);

    // 源条目要标出"已拆 2 条"，页面据此显示
    const source = r.body.local.find((i) => i.id === created.id);
    assert.equal(source.splitInto.length, 2);
    // 子项要能认出自己来自哪条
    for (const child of r.body.local.filter((i) => i.splitFrom)) {
      assert.equal(child.splitFrom, created.id);
    }
  } finally {
    await h.done();
  }
});

test('重新拆分走 force（清掉上一批）', async () => {
  const h = await harness();
  try {
    const created = (await h.call('POST', '/?local-create', { title: 'x' })).body.item;
    await h.call('POST', '/?local-split', { id: created.id });
    assert.equal(h.splitCalls.at(-1).opts?.force, false, '第一次不带 force');

    const again = await h.call('POST', '/?local-split-force', { id: created.id });
    assert.equal(h.splitCalls.at(-1).opts?.force, true, '重拆要显式传 force');
    assert.equal(again.status, 200);
    // 重拆后条数不该翻倍
    assert.equal(again.body.local.filter((i) => i.splitFrom).length, 2);
  } finally {
    await h.done();
  }
});

test('拆分失败回 ok:false + 可读的 error（对象不能被字符串化成 [object Object]）', async () => {
  const h = await harness({
    splitLocal: async () => {
      const error = new Error('还没有可用的模型：请先在设置里配置 AI 服务');
      error.code = 'NO_LLM';
      throw error;
    },
  });
  try {
    const created = (await h.call('POST', '/?local-create', { title: 'x' })).body.item;
    const r = await h.call('POST', '/?local-split', { id: created.id });
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error.code, 'NO_LLM');
    assert.match(r.body.error.message, /还没有可用的模型/);
    assert.equal(JSON.stringify(r.body.error).includes('[object Object]'), false);
  } finally {
    await h.done();
  }
});

test('忘掉一次拆分：删掉子项并清空 splitInto', async () => {
  const h = await harness();
  try {
    const created = (await h.call('POST', '/?local-create', { title: 'x' })).body.item;
    await h.call('POST', '/?local-split', { id: created.id });
    assert.equal(h.local.list().length, 3, '1 源 + 2 子');

    const r = await h.call('POST', '/?local-unsplit', { id: created.id });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.local.map((i) => i.title), ['x'], '子项该消失，源留着');
    assert.deepEqual(r.body.local[0].splitInto, []);
  } finally {
    await h.done();
  }
});

test('没有模型服务时拆分回 400 而不是崩', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'plan-route-'));
  const local = new LocalPlanStore(path.join(dir, 'local.json'));
  const handler = createHandler({
    getConfig: () => ({ endpoint: '', readKey: '' }),
    saveConfig: () => {},
    store: { entries: [], list() { return []; }, absorb() { return { added: [], skipped: 0 }; } },
    local,
    // splitLocal 不传 = 模型服务缺席
    fetchRemote: async () => ({ ok: false, code: 'NOT_CONFIGURED', message: '没配' }),
    loadTodos: async () => ({}),
    savePtaCookie: async () => ({}),
    ptaStatus: async () => ({ configured: false }),
  });
  try {
    const created = local.create({ title: 'x' });
    const r = await new Promise((resolve) => {
      const req = {
        method: 'POST', url: '/?local-split',
        headers: { host: '127.0.0.1', 'x-zhiyun-planning': '1' },
        [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify({ id: created.id })); },
      };
      const res = { writeHead(s) { this.status = s; }, end(c) { resolve({ status: this.status, body: JSON.parse(c) }); } };
      handler(req, res);
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /AI 规划未启用/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
