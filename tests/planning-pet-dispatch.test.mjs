/**
 * `pet-chat` 的**路由分发**测试。
 *
 * # 为什么必须有这一套
 *
 * 之前 `planning-pet-route.test.mjs` 直调 `service.mine.pet()` —— 走的是服务层，
 * **绕过了 HTTP 路由的分发**。于是两个真实 bug 全部漏网：
 *
 *   1. `pet-chat` 分支被写在 `if (action.startsWith('local-'))` 内部，
 *      而它不以 `local-` 开头 → 请求一路落到「未知动作 pet-chat」；
 *   2. 路由里直接引用 `petChat`，但那是 `apply()` 的闭包，
 *      `createHandler` 的作用域里根本没有这个名字 → `ReferenceError`。
 *
 * 两个都很典型：**单元测试全绿、界面全坏**。所以这一套只做一件事 ——
 * 像浏览器那样发一个 POST，看路由到底认不认这个动作。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandler, WRITE_HEADER } from '../packages/dsh-zhiyun-page-planning/src/index.js';

/** 造一个最小的 req/res，行为与宿主一致（读 JSON body、回 JSON）。 */
function call(handler, method, url, body) {
  return new Promise((resolve) => {
    const req = {
      method,
      url,
      headers: { host: '127.0.0.1:43120', [WRITE_HEADER]: '1' },
      [Symbol.asyncIterator]: async function* iterator() {
        if (body !== undefined) yield Buffer.from(JSON.stringify(body));
      },
    };
    const res = {
      status: 0,
      writeHead(status) { this.status = status; },
      end(chunk) {
        resolve({ status: this.status, body: JSON.parse(chunk) });
      },
    };
    handler(req, res).catch((error) => resolve({ status: 500, body: { error: String(error?.message ?? error) } }));
  });
}

/** 一个只关心 pet 的 handler；其余依赖给最小桩。 */
function makeHandler({ petChat, local = null } = {}) {
  return createHandler({
    getConfig: () => ({ endpoint: '', readKey: '' }),
    saveConfig: () => {},
    store: { entries: [], list: () => [], absorb: () => ({ added: [], skipped: 0 }) },
    local: local ?? {
      list: () => [], find: () => null, create: () => ({}),
      update: () => null, setDone: () => null, remove: () => false, split: () => {},
    },
    tickStore: null,
    fetchRemote: async () => ({ ok: false, code: 'NOT_CONFIGURED', message: '没配' }),
    loadTodos: async () => ({ xzzd: { ok: true, rows: [], error: null }, pta: { ok: true, rows: [], error: null } }),
    savePtaCookie: async () => ({}),
    ptaStatus: async () => ({ configured: false }),
    plan: null,
    petChat,
  });
}

test('**路由认得 pet-chat** —— 它不能被 local- 的前缀判断挡住', async () => {
  const seen = [];
  const handler = makeHandler({
    petChat: async (text, { history }) => {
      seen.push({ text, history });
      return { say: '记下了', action: 'chat', draft: null, notes: [], model: 'fake' };
    },
  });

  const result = await call(handler, 'POST', '/?pet-chat', { text: '明天交作业' });

  assert.equal(result.status, 200, `路由应当认这个动作，实际回的是：${JSON.stringify(result.body)}`);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.say, '记下了');
  assert.equal(result.body.action, 'chat');
  // 参数要真的传到了实现里
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, '明天交作业');
});

test('历史会原样转给实现（多轮靠它）', async () => {
  const seen = [];
  const handler = makeHandler({
    petChat: async (text, { history }) => {
      seen.push({ text, history });
      return { say: '嗯', action: 'chat', draft: null, notes: [] };
    },
  });
  const history = [
    { role: 'user', text: '下周有个作业' },
    { role: 'assistant', text: '什么作业？' },
  ];

  await call(handler, 'POST', '/?pet-chat', { text: '第三章', history });

  assert.deepEqual(seen[0].history, history);
});

test('**没接线时回可读的 400，而不是 ReferenceError**', async () => {
  const handler = makeHandler({ petChat: null });
  const result = await call(handler, 'POST', '/?pet-chat', { text: '你好' });

  assert.equal(result.status, 400);
  // 不能是 "petChat is not defined" 这类内部错误
  assert.match(String(result.body.error), /没有接线|未注入/);
});

test('模型不可用时回 200 + 可读错误（引导去配置，不是 500）', async () => {
  const handler = makeHandler({
    petChat: async () => {
      throw Object.assign(new Error('还没有可用的模型'), { code: 'NO_LLM' });
    },
  });

  const result = await call(handler, 'POST', '/?pet-chat', { text: '你好' });

  assert.equal(result.status, 200, '配置问题不该当服务器故障');
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error.code, 'NO_LLM');
  assert.match(result.body.error.message, /模型/);
});

test('实现抛普通错误时回 400 并带上原因（不吞掉）', async () => {
  const handler = makeHandler({
    petChat: async () => { throw new Error('模型回包不是 JSON'); },
  });

  const result = await call(handler, 'POST', '/?pet-chat', { text: '你好' });

  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.match(result.body.error.message, /JSON/);
});

test('没有请求体时回 400，且不调用实现', async () => {
  let called = false;
  const handler = makeHandler({ petChat: async () => { called = true; return {}; } });

  const result = await call(handler, 'POST', '/?pet-chat');

  assert.equal(result.status, 400);
  assert.equal(called, false);
});

test('**pet-chat 绝不写库**（路由层面也不许碰 local）', async () => {
  let created = false;
  const local = {
    list: () => [], find: () => null,
    create: () => { created = true; return {}; },
    update: () => null, setDone: () => null, remove: () => false, split: () => {},
  };
  const handler = makeHandler({
    local,
    // 模型明确要求创建，但路由只把它当"草案"回给前端
    petChat: async () => ({
      say: '记下了', action: 'create',
      draft: { title: '交作业', detail: '', due: null, repeat: null },
      notes: [],
    }),
  });

  const result = await call(handler, 'POST', '/?pet-chat', { text: '交作业' });

  assert.equal(result.status, 200);
  assert.equal(result.body.action, 'create');
  assert.ok(result.body.draft, '草案要回给前端让用户确认');
  assert.equal(created, false, 'chat 期间绝不能落库 —— 必须等用户点「好」');
});
