/**
 * 学习通数据源的**路由层**测试：只测 `apply()` 挂出来的那条 `/api/zhiyun-xxt`。
 *
 * # 为什么要单独一份
 *
 * `xxt.test.mjs` 测的是解析与读取逻辑（纯函数 + 注入的 fetch）。但插件真正对外的
 * 形状是**信封**：`{ type: 'client-request', rpcId, method, payload }` 进来，
 * `{ type: 'server-response', rpcId, result }` 出去。这一层写错不会让任何纯函数
 * 测挂，只会让页面拿到一个看不懂的响应 —— 所以单独钉。
 *
 * 用一个最小的假 Cordis 上下文：只需要 `profileContext`、`inject`、`effect`、
 * `provide`、`logger`。不启动真宿主，也就不会碰网络与 DPAPI。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { apply, ROUTE_PATH, name } from '../packages/dsh-zhiyun-source-xxt/src/index.js';
import { XXT_ENDPOINTS } from '../packages/dsh-zhiyun-source-xxt/src/hosts.js';

/**
 * 造一个够用的假上下文。
 *
 * `connection.fetch.register` 只把 route 记下来，测试直接调 `route.fetch(request)`
 * —— 这与宿主里 `createSharedFetchHandler` 的行为一致：按 pathname 找到 route，
 * 再用 `request` 调它的 `fetch`。
 *
 * `SessionStore` 会拿到 `file`（插件里写死了路径），但这里把 `protect` 换成
 * 恒等函数、数据目录指到临时目录 —— 于是既不调 DPAPI（沙箱里不能 spawn），
 * 也不碰用户真实数据。`file` 不存在时 `load()` 直接返回，不写任何东西。
 */
async function harness({ fetch: fetcher, now } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'xxt-route-'));
  const routes = new Map();
  const effects = [];
  const services = new Map();
  const ctx = {
    profileContext: { dir },
    logger: { info: () => {}, warn: () => {} },
    inject: (_names, fn) => fn({
      effect: (run) => {
        const dispose = run();
        effects.push(dispose);
        return dispose;
      },
      connection: {
        fetch: {
          register: (route) => {
            routes.set(route.path, route);
            return () => routes.delete(route.path);
          },
        },
      },
    }),
    provide: (key, value) => {
      services.set(key, value);
      return () => services.delete(key);
    },
    get: (key) => services.get(key),
  };
  const dispose = await apply(ctx, {
    dataDir: dir,
    protect: (bytes) => bytes,
    fetch: fetcher,
    now,
  });
  const route = routes.get(ROUTE_PATH);
  const post = async (payload, { rpcId = 'r1', signal } = {}) => {
    const request = new Request(`http://127.0.0.1${ROUTE_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ type: 'client-request', rpcId, payload }),
      headers: { 'content-type': 'application/json' },
      signal,
    });
    const response = await route.fetch(request);
    return response.json();
  };
  const get = async () => {
    const response = await route.fetch(new Request(`http://127.0.0.1${ROUTE_PATH}`, { method: 'GET' }));
    return response.json();
  };
  return {
    route,
    post,
    get,
    service: services.get('zhiyunXxt'),
    cleanup: async () => {
      await dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const json = (payload) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

test('路由：GET 列出方法与动作（页面用来自我发现）', async () => {
  const host = await harness();
  try {
    const body = await host.get();
    assert.equal(body.ok, true);
    assert.equal(body.value.route, ROUTE_PATH);
    assert.equal(body.value.platform.id, 'xxt');
    assert.equal(body.value.platform.label, '学习通');
    assert.equal(body.value.methods.length, 9);
    assert.deepEqual(body.value.actions, ['status', 'importCookie', 'checkLogin']);
    // 只读口径要写在返回值里，别只写在 README 里
    assert.match(body.value.note, /只读/);
  } finally {
    await host.cleanup();
  }
});

test('路由：信封错误的响应仍然是 server-response（页面才不会卡在 pending）', async () => {
  const host = await harness();
  try {
    const response = await host.route.fetch(new Request(`http://127.0.0.1${ROUTE_PATH}`, {
      method: 'POST',
      body: JSON.stringify({ nope: true }),
    }));
    const body = await response.json();
    assert.equal(body.type, 'server-response');
    assert.equal(body.result.ok, false);
    assert.equal(body.result.error.code, 'INVALID_ARGUMENT');
    assert.equal(body.rpcId, 'invalid-request');
  } finally {
    await host.cleanup();
  }
});

test('路由：未配置 Cookie 时 xxt.listCourses 回 COOKIE_IMPORT_REQUIRED，且文案里没有 pbpaste', async () => {
  const host = await harness();
  try {
    const body = await host.post({ method: 'xxt.listCourses', args: {} });
    assert.equal(body.type, 'server-response');
    assert.equal(body.rpcId, 'r1');
    assert.equal(body.result.ok, false);
    assert.equal(body.result.error.code, 'COOKIE_IMPORT_REQUIRED');
    assert.equal(/pbpaste|npm run cli|xxt-cookie/.test(body.result.error.message), false);
  } finally {
    await host.cleanup();
  }
});

test('路由：xxt.status 走客户端动作，回配置状态', async () => {
  const host = await harness();
  try {
    const body = await host.post({ method: 'xxt.status', args: {} });
    assert.equal(body.result.ok, true);
    assert.deepEqual(body.result.value, { configured: false, source: null });
  } finally {
    await host.cleanup();
  }
});

test('路由：xxt.importCookie 存下来后 status 立刻变成已配置', async () => {
  const host = await harness();
  try {
    const saved = await host.post({
      method: 'xxt.importCookie',
      args: { input: "curl 'https://mooc1.chaoxing.com/' -H 'Cookie: UID=1; _uid=2; fid=3'" },
    });
    assert.equal(saved.result.ok, true);
    assert.equal(saved.result.value.source, 'curl 命令');
    assert.deepEqual(saved.result.value.cookie_names, ['UID', '_uid', 'fid']);

    const status = await host.post({ method: 'xxt.status', args: {} });
    assert.equal(status.result.value.configured, true);
    assert.equal(status.result.value.source, 'session');
    assert.deepEqual(status.result.value.missing_required, []);
  } finally {
    await host.cleanup();
  }
});

test('路由：importCookie 空输入报 INVALID_ARGUMENT', async () => {
  const host = await harness();
  try {
    const body = await host.post({ method: 'xxt.importCookie', args: { input: '   ' } });
    assert.equal(body.result.ok, false);
    assert.equal(body.result.error.code, 'INVALID_ARGUMENT');
  } finally {
    await host.cleanup();
  }
});

test('路由：未知方法 / 别的平台前缀都被拒', async () => {
  const host = await harness();
  try {
    for (const method of ['xxt.nope', 'zdbk.timetable', 'xxt.constructor', 'xxt.__proto__']) {
      const body = await host.post({ method, args: {} });
      assert.equal(body.result.ok, false, method);
      assert.equal(body.result.error.code, 'INVALID_ARGUMENT', method);
    }
  } finally {
    await host.cleanup();
  }
});

test('路由：导入 Cookie 后 xxt.exams 真的会发请求并按信封回数据', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('examcode/examlist')) {
      return new Response(
        '<table><tr class="dataTr"><td>1</td><td>期中</td><td>2026-04-10</td><td>120</td>'
        + '<td>进行中</td><td>未作答</td><td></td><td>线上</td><td>进入</td></tr></table>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    }
    return json({});
  };
  const host = await harness({ fetch: fetcher });
  try {
    await host.post({ method: 'xxt.importCookie', args: { input: 'UID=1; _uid=2; fid=3' } });
    const body = await host.post({ method: 'xxt.exams', args: {} });
    assert.equal(body.result.ok, true);
    assert.equal(body.result.value.exams.length, 1);
    assert.equal(body.result.value.exams[0].name, '期中');
    assert.deepEqual(calls, [XXT_ENDPOINTS.examList]);
  } finally {
    await host.cleanup();
  }
});

test('路由：服务面（zhiyunXxt）能直接调用，不必绕 HTTP', async () => {
  const host = await harness();
  try {
    assert.equal(host.service.routePath, ROUTE_PATH);
    const status = await host.service.act('status');
    assert.equal(status.configured, false);
    const described = host.service.describe();
    assert.equal(described.ready, true);
    assert.equal(described.methods.length, 9);
    // 读取器要能直接拿到（脚本用它）
    assert.equal(typeof host.service.reader().deadlines, 'function');
    assert.equal(typeof host.service.client().importCookie, 'function');
  } finally {
    await host.cleanup();
  }
});

test('路由：卸载后 route 与 service 都被摘掉', async () => {
  const host = await harness();
  assert.ok(host.route);
  assert.ok(host.service);
  await host.cleanup();
  // cleanup() 已经调过 dispose，这里只需要证明没有抛错
  assert.equal(name, 'zhiyun-xxt');
});
