/**
 * 真机探针的**桥接底座**：装配一个最小 Cordis 上下文，把包 `apply()` 起来，
 * 再通过它自己注册的 `connection` 数据路由（或 `provide` 的服务）取数。
 *
 * # 为什么必须是桥，不能直接 import 包的内部类
 *
 * 直接 `new PtaApi(transport)` 那种写法验证的**不是产品**：它绕过了 `apply()`
 * 的装配（服务注入、egress 接线、路由注册），绕过了页面/AI 真正走的那条
 * `connection` 路由。于是「探针能跑通」与「产品能跑通」成了两件不相干的事。
 *
 * 这个教训是踩出来的：早先的探针手工建 Transport、手工种 Cookie，与产品侧
 * `savePtaCookie()` 的写法不一致（少了 `Secure`、值含 `=` 时重组方式不同），
 * 报出的 `FORBIDDEN` 被当成账号问题，而实际上是探针自建了一条路。
 *
 * # 装配顺序是有讲究的
 *
 * 必须**先** `apply()` `dsh-zhiyun-source-campus`：它 `provide('zhiyunEgress')`，
 * 其余包经 `sharedFetch(ctx)` → `ctx.get('zhiyunEgress')` 才拿得到共享出口。
 * 顺序反了不会报错，只会静默退化成 `globalThis.fetch`（走宿主给 LLM 配的
 * 全局代理，国内站点基本必失败）。
 */

import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';

/** 仓库根（调用方以 `--root` 传入，或从本文件位置推）。 */
let ROOT = null;

/**
 * 设定仓库根。所有包路径都相对它解析。
 *
 * @param root - 绝对路径，**以分隔符结尾**。
 */
export function setRoot(root) {
  ROOT = root;
}

/** 包入口的 file URL。 */
export function entryOf(name) {
  if (!ROOT) throw new Error('source_bridge: 还没有 setRoot()');
  return pathToFileURL(`${ROOT}packages/${name}/src/index.js`).href;
}

/**
 * 造一个最小上下文。
 *
 * `provide` / `get` 共用一张表，包之间的服务依赖因此能真的接上；
 * `inject` 给 `connection` / `webServer`，与宿主的形状一致到「够用」为止。
 *
 * @param options.dataDir - 本平台的落盘目录（会话文件会写在这里）。
 * @param options.fetchImpl - 默认出网口（包若用 `ctx.fetch`）。
 * @returns `{ ctx, routes, services, warnings }`。
 */
export function makeContext({ dataDir, fetchImpl }) {
  const services = new Map();
  const routes = [];
  const warnings = [];

  const scopeOf = () => ({
    connection: {
      fetch: {
        register(spec) {
          routes.push({ kind: 'connection', path: spec.path, methods: spec.methods ?? [], fetch: spec.fetch });
          return () => {};
        },
      },
    },
    webServer: {
      /**
       * 注册一个**原生 Node HTTP handler**。
       *
       * 这正是宿主的形状：`campus` 与 `classroom` 传进来的 handler 接收
       * `(req, res)` 并自己 `res.writeHead(...)` —— 不是 fetch 的
       * Request/Response。早先这里只记了个 `path` 就返回，于是那些路由
       * 「注册成功但根本调不到」，报告却看不出来。
       *
       * 现在真的挂到一个本地 HTTP 服务器上：`route.call(path, init)` 打过去的
       * 就是一次真实的网络请求，与页面走同一条路。
       */
      register(spec) {
        routes.push({
          kind: 'webServer',
          path: spec.path ?? null,
          handler: spec.handler,
          // 直接对这条路由发一次请求
          async call(pathAndQuery = spec.path ?? '/', init = {}) {
            return callWebServer(spec.handler, pathAndQuery, init);
          },
        });
        return () => {};
      },
    },
    storageDomain: services.get('storageDomain'),
    llm: services.get('llm'),
    effect(fn) {
      try { return fn(); } catch (error) { warnings.push(String(error?.message ?? error)); return undefined; }
    },
    on() { return () => {}; },
  });

  const ctx = {
    logger: {
      info: () => {},
      debug: () => {},
      warn: (message) => warnings.push(String(message)),
      error: (message) => warnings.push(String(message)),
    },
    profileContext: { dir: dataDir },
    get: (name) => services.get(name),
    provide(name, value) {
      services.set(name, value);
      return () => services.delete(name);
    },
    on() { return () => {}; },
    effect(fn) {
      try { return fn(); } catch (error) { warnings.push(String(error?.message ?? error)); return undefined; }
    },
    inject(_deps, register) {
      try { return register(scopeOf()); } catch (error) { warnings.push(String(error?.message ?? error)); }
    },
    fetch: fetchImpl,
  };

  return { ctx, routes, services, warnings };
}

/**
 * 把一条 `webServer` 路由**真的跑起来**：临时起一个 HTTP 服务器托管那个
 * 原生 handler，打一次请求，再把服务器关掉。
 *
 * # 为什么不在内存里伪造 req/res
 *
 * handler 里会用到 `req.headers.host`（回环检查）、`req.url`（取 `?action=`）、
 * `for await (const chunk of req)`（读 body）、`res.writeHead` / `res.end`。
 * 手搓一个桩要覆盖这些细节，等于再实现一遍 Node 的 HTTP 语义 —— 而桩一旦
 * 与真语义有偏差，探针就会报出产品根本不存在的问题。真的起一个服务器最省事，
 * 也最接近宿主里的实际行为。
 *
 * @param handler - `(req, res) => void | Promise<void>`。
 * @param pathAndQuery - 形如 `/api/zhiyun-campus?pta-cookie`。
 * @param init - fetch 的 init（method / headers / body）。
 * @returns `{ status, headers, data }`（data 是解出的 JSON，解不出就是原文）。
 */
async function callWebServer(handler, pathAndQuery, init = {}) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { code: 'HANDLER_CRASH', message: String(error?.message ?? error) } }));
      } else {
        res.end();
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathAndQuery}`, {
      // Host 头由 fetch 按 URL 自动给，handler 的回环检查因此能过
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, headers: response.headers, data };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * 内存版宿主凭据服务。
 *
 * 包读账号走的是它自己的 `readCard(ctx)` / `readCc98(ctx)` —— 那两个函数只要求
 * `ctx.get('credentials')` 提供 `readRecord` / `modifyRecord` / `deleteRecord`。
 * 用一个 Map 顶上，就能让「探针塞进去的账号」经**产品的读取路径**被取出来。
 *
 * @returns `{ store, service }`。
 */
export function memoryCredentials() {
  const store = new Map();
  return {
    store,
    service: {
      async readRecord(key) { return store.get(key) ?? null; },
      async modifyRecord(key, fn) { store.set(key, fn(store.get(key))); },
      async deleteRecord(key) { store.delete(key); },
    },
  };
}

/**
 * 装配一个包。
 *
 * @param name - 包目录名（`packages/<name>`）。
 * @param options.dataDir - 落盘目录。
 * @param options.fetchImpl - 默认出网口。
 * @param options.credentials - 可选的凭据服务。
 * @returns `{ ctx, routes, services, warnings, dispose, mod }`。
 */
export async function mount(name, { dataDir, fetchImpl = globalThis.fetch, credentials } = {}) {
  const mod = await import(entryOf(name));
  const { ctx, routes, services, warnings } = makeContext({ dataDir, fetchImpl });
  if (credentials) ctx.provide('credentials', credentials);
  const dispose = typeof mod.apply === 'function' ? await mod.apply(ctx, {}) : undefined;
  return { ctx, routes, services, warnings, dispose, mod };
}

/**
 * 先装 campus。
 *
 * 它是唯一 `provide('zhiyunEgress')` 的包，其余 `source-*` 的 `sharedFetch(ctx)`
 * 都指向那个服务。所以任何真机链路都要先过这一手。
 *
 * @param options.dataDir - campus 自己的落盘目录（与会话文件放一起）。
 * @param options.credentials - 凭据服务。
 * @returns 装配结果。
 */
export async function mountCampus({ dataDir, credentials, fetchImpl = globalThis.fetch }) {
  return mount('dsh-zhiyun-source-campus', { dataDir, credentials, fetchImpl });
}

/**
 * 从一组 routes 里取路由。
 *
 * @param routes - `makeContext` 收集到的数组。
 * @param path - 期望路径（不传就取该 kind 的第一条）。
 * @param kind - `'connection'`（默认，信封协议）或 `'webServer'`（原生 handler）。
 */
export function routeOf(routes, path, kind = 'connection') {
  const route = routes.find((item) => item.kind === kind && (!path || item.path === path));
  if (!route) {
    const known = routes.filter((r) => r.kind === kind).map((r) => r.path);
    throw Object.assign(
      new Error(`没有找到 ${kind} 路由${path ? `（${path}）` : ''}；已注册：${known.join(', ') || '无'}`),
      { code: 'NO_ROUTE' },
    );
  }
  return route;
}

/* ── 三种路由协议 ───────────────────────────────────────────────────── */

/**
 * 信封协议 A（`cc98` / `zdbk`）：
 * `{ type:'client-request', rpcId, method, payload }`
 * → `{ type:'server-response', rpcId, result:{ ok, value|error } }`
 */
export async function rpcEnvelope(route, method, payload = {}) {
  const response = await route.fetch(new Request(`http://127.0.0.1${route.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'verify-live', method, payload }),
  }));
  const body = await response.json();
  if (body?.type !== 'server-response') {
    throw Object.assign(new Error('路由回的不是 server-response 信封'), { code: 'ENVELOPE' });
  }
  if (body.result?.ok === false) {
    const error = body.result.error ?? {};
    throw Object.assign(new Error(String(error.message ?? 'RPC 失败')), { code: error.code ?? 'RPC', details: error.details });
  }
  return body.result?.value;
}

/**
 * 信封协议 B（`xxt`）：method 在 `payload.method`，参数在 `payload.args`。
 */
export async function rpcXxt(route, method, args = {}) {
  const response = await route.fetch(new Request(`http://127.0.0.1${route.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'verify-live', payload: { method, args } }),
  }));
  const body = await response.json();
  if (body?.type !== 'server-response') {
    throw Object.assign(new Error('路由回的不是 server-response 信封'), { code: 'ENVELOPE' });
  }
  if (body.result?.ok === false) {
    const error = body.result.error ?? {};
    throw Object.assign(new Error(String(error.message ?? 'RPC 失败')), { code: error.code ?? 'RPC', details: error.details });
  }
  return body.result?.value;
}

/**
 * `campus` 的路由是**原生 webServer handler**：
 * `POST /api/zhiyun-campus?<action>` + 头 `x-zhiyun-campus: 1` + JSON body。
 *
 * `route` 必须是从 `routeOf(routes, path, 'webServer')` 取的那条 ——
 * 它带 `call()`，会真的起服务器跑 handler。
 */
export async function campusAction(route, action, body = {}) {
  const { status, data } = await route.call(`${route.path}?${action}`, {
    method: 'POST',
    headers: { 'x-zhiyun-campus': '1' },
    body: JSON.stringify(body),
  });
  if (status >= 400) {
    const error = data?.error ?? {};
    throw Object.assign(
      new Error(String(error.message ?? `HTTP ${status}`)),
      { code: error.code ?? 'HTTP', status },
    );
  }
  return data;
}

/** `campus` 的 GET：回 `{ todos, pta, egress }`（规划页用的那条）。 */
export async function campusGet(route) {
  const { status, data } = await route.call(route.path, { method: 'GET' });
  if (status >= 400) {
    const error = data?.error ?? {};
    throw Object.assign(new Error(String(error.message ?? `HTTP ${status}`)), { code: error.code ?? 'HTTP', status });
  }
  return data;
}

/** 把错误收成可序列化的形状（凭证已在 Python 侧擦除，这里只留 code/message）。 */
export function fail(error) {
  return {
    ok: false,
    code: error?.code ?? error?.name ?? 'ERROR',
    message: String(error?.message ?? error).slice(0, 400),
  };
}
