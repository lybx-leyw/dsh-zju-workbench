/**
 * 知识树基准台的**桥接底座**。
 *
 * # 为什么是桥，不是直接 import 内部类
 *
 * 与 `scripts/source_bridge/_base.mjs` 同一条理由：直接 `new LectureParser(...)`
 * 或直接调 `buildTree()` 验证的**不是产品** —— 它绕过了 `apply()` 的装配
 * （服务注入、路由注册、配置归一）。于是"基准台跑通"与"产品跑通"会变成
 * 两件不相干的事，而基准台的全部价值就是**它测的是真东西**。
 *
 * 所以这里只做三件事：
 *   1. 造一个最小 Cordis 上下文（`provide` / `get` / `inject` 都真的接上）；
 *   2. `apply()` 真的包，拿它**自己注册**的服务与路由；
 *   3. 把服务上的功能函数按原样暴露出来（`apiOf`），供基准用例调用。
 *
 * # 壳的功能函数为什么也要桥
 *
 * 「壳」不是界面装饰：`NAV` / `RAIL_DEFAULT` / `FULL_BLEED_PAGES` /
 * `hiddenPageIds` / `activePage` / `matchingPages` 这些是**版式与路由契约**，
 * 它们决定"知识树落在哪一页、哪一页整幅铺开、哪些页该藏起来"。
 * 基准台要判断"这棵树该在界面上长什么样"，就必须用**产品自己那套判断**，
 * 而不是在基准里再写一份（写第二份的结局是半年后两边不一致）。
 *
 * ⚠️ 这些壳函数是**纯函数**（不碰 ctx、不碰 DOM），所以可以直接 import 模块
 *    取用；这不是"绕开装配"——它们本来就不经过装配。
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 仓库根（调用方以 `--root` 传入，或从本文件位置推）。 */
let ROOT = null;

/**
 * 设定仓库根。所有包路径都相对它解析。
 * @param root - 绝对路径，**以分隔符结尾**。
 */
export function setRoot(root) {
  ROOT = root;
}

/** 仓库根（已归一成以分隔符结尾）。 */
export function rootDir() {
  if (!ROOT) throw new Error('knowledge_tree_bench: 还没有 setRoot()');
  return ROOT;
}

/** 某个包某个源文件的 file URL。 */
export function urlOf(name, file = 'src/index.js') {
  return pathToFileURL(path.join(rootDir(), 'packages', name, file)).href;
}

/** 包入口的 file URL。 */
export function entryOf(name) {
  return urlOf(name, 'src/index.js');
}

/**
 * 造一个最小上下文。
 *
 * 与 source_bridge 的同名函数是同构的（`provide`/`get` 共表、`inject` 给
 * `connection` / `webServer`），但**多出这一层需要的东西**：
 *
 *   · `llm`：解析器与讲义都要它。基准台不调真模型，所以由调用方注入一个
 *     **可编程的桩**（`stubLlm`）—— 这样基准跑得快、结果确定，而且能精确
 *     构造"模型返回了什么"这种条件。
 *   · `attachments`：视觉阶段的图片落盘。桩成一个返回假 id 的对象。
 *   · `agentDefaultModel`：路由解析。桩成固定 provider/model。
 *
 * @param options.dataDir - 本域的落盘目录。
 * @param options.fetchImpl - 默认出网口。
 * @param options.llm - 可选的 llm 桩（不给就造一个默认的）。
 * @param options.services - 预置服务（会先于包自己的 `provide` 放进表里）。
 * @returns `{ ctx, routes, services, warnings }`。
 */
export function makeContext({ dataDir, fetchImpl = globalThis.fetch, llm, services: preset } = {}) {
  const services = new Map(Object.entries(preset ?? {}));
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
      register(spec) {
        routes.push({ kind: 'webServer', path: spec.path ?? null, handler: spec.handler,
          async call(pathAndQuery = spec.path ?? '/', init = {}) {
            return callWebServer(spec.handler, pathAndQuery, init);
          } });
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
    // —— 这一层多出来的宿主面 ——
    llm: llm ?? services.get('llm') ?? stubLlm(),
    /* ⚠️ `saveImage` **必须把字节带回来**。
     *
     * 产品 `HarnessLlm.image()` 的返回值会被原样塞进消息内容块，下游（如
     * OpenAI 兼容适配）靠 `attachment.data` 才能把图发出去。只回一个 id
     * 会让请求退化成"纯文本"，表现是「模型调用成功但页面文字是空的」——
     * 极易被误判成模型不听话。
     *
     * 真实宿主会把字节落盘再返回引用；基准不落盘（图本来就在磁盘上、
     * 已读进内存），直接透传 Buffer。
     */
    attachments: {
      async saveImage({ data, mediaType, name } = {}) {
        return { data, mediaType, name: name ?? 'bench-image' };
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'bench', model: 'bench' }) },
    credentials: services.get('credentials'),
  };

  // 宿主里服务既可 `ctx.get(name)` 也可 `ctx.<name>`（例如 lecture 包直接读
  // `ctx.zhiyunParser?.llm`）。基准必须同样两种都给，否则"产品能跑、基准跑不了"
  // 就变成基准自己的 bug。这里用 Proxy 把服务表接到属性读取上。
  const proxied = new Proxy(ctx, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop === 'string' && services.has(prop)) return services.get(prop);
      return undefined;
    },
    has(target, prop) { return prop in target || (typeof prop === 'string' && services.has(prop)); },
  });

  return { ctx: proxied, routes, services, warnings };
}

/**
 * 把 `stubLlm` **包成宿主的 `ctx.llm` 形状**。
 *
 * # 为什么要多这一层
 *
 * 解析器不直接调 `ctx.llm.call` —— 中间隔着一层 `HarnessLlm`（那是产品为了
 * 统一"路由解析 + 档位 + 超时"写的适配器）。适配器要求宿主 llm 提供
 * `prepareCall` / `resolveModelInfo` / 流式 `stream`。
 *
 * 基准要测的是**产品那条路**（含适配器），所以不能跳过它去调内部类；
 * 正确做法是把"模型回什么"这个可变点做成桩，其余照产品的形状给。
 *
 * @param respond - `(request) => string | {text}`，与 `stubLlm` 同签名。
 * @returns 宿主形状的 llm（带 `calls` 供基准核对）。
 */
export function hostLlm(respond) {
  const calls = [];
  const streamOnce = async function* (options) {
    const request = { stage: options?.stage ?? null, ...options };
    calls.push({ request, options });
    if (typeof respond !== 'function') {
      throw Object.assign(new Error('基准用例没有为这次调用提供回包'), { code: 'NOT_CONFIGURED' });
    }
    const out = await respond(request);
    const text = typeof out === 'string' ? out : String(out?.text ?? '');
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'usage', usage: (typeof out === 'object' && out?.usage) || null };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
  return {
    calls,
    async resolveModelInfo() { return { inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'off' }] } }; },
    async prepareCall(config) { return { config, inputModalities: ['text', 'image'], stream: streamOnce }; },
  };
}

/**
 * 一个**可编程的 llm 桩**。
 *
 * 默认什么都不回（抛 `NOT_CONFIGURED`），因为基准用例一定要显式说明
 * "这一步模型返回什么" —— 给一个"看起来能跑"的默认回包会让基准在
 * 没有真正验证的情况下通过。
 *
 * @param respond - `(request) => string | {text}`；决定每个请求的回包。
 */
export function stubLlm(respond) {
  const calls = [];
  return {
    calls,
    acceptsAccel: false,
    async resolve() { return { vision: { provider: 'bench', model: 'bench' }, text: { provider: 'bench', model: 'bench' } }; },
    async image() { return { attachmentId: 'bench-image' }; },
    async call(request) {
      calls.push(request);
      if (typeof respond !== 'function') {
        throw Object.assign(new Error('基准用例没有为这次调用提供回包'), { code: 'NOT_CONFIGURED', stage: request?.stage });
      }
      const out = await respond(request);
      return typeof out === 'string' ? { text: out, usage: null } : { text: '', usage: null, ...out };
    },
  };
}

/**
 * 把一条 `webServer` 路由真的跑起来（临时起服务器托管原生 handler）。
 *
 * 与 source_bridge 同做法：handler 会用 `req.headers.host`、`req.url`、
 * `for await (const chunk of req)`、`res.writeHead` —— 手搓桩等于再实现一遍
 * Node 的 HTTP 语义，桩一有偏差基准就会报出产品根本不存在的问题。
 */
async function callWebServer(handler, pathAndQuery, init = {}) {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { code: 'HANDLER_CRASH', message: String(error?.message ?? error) } }));
      } else res.end();
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathAndQuery}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, headers: response.headers, data };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * 内存版宿主凭据服务（包读账号走它自己的 `readCard(ctx)`，只要求这几个方法）。
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
 * @param options.llm - llm 桩。
 * @param options.services - 预置服务。
 * @param options.config - 原样透传给包的 `apply(ctx, config)`。
 *   基准要改 `splitLine` / `concurrency` 这类参数，必须走**产品自己的配置入口**，
 *   而不是跑起来之后去改内部字段（改了也不经过归一，测的就不是产品行为）。
 * @returns `{ ctx, routes, services, warnings, dispose, mod }`。
 */
export async function mount(name, { dataDir, fetchImpl = globalThis.fetch, llm, services, config = {} } = {}) {
  const mod = await import(entryOf(name));
  const made = makeContext({ dataDir, fetchImpl, llm, services });
  const dispose = typeof mod.apply === 'function' ? await mod.apply(made.ctx, config) : undefined;
  return { ...made, dispose, mod, name };
}

/**
 * 取一个服务；没有就**有名字地**失败。
 *
 * @param mounted - `mount()` 的返回值。
 * @param service - 服务名（如 `zhiyunParser`）。
 */
export function serviceOf(mounted, service) {
  const value = mounted.services.get(service);
  if (!value) {
    const known = [...mounted.services.keys()];
    throw Object.assign(
      new Error(`${mounted.name} 没有 provide ${service}；已提供：${known.join(', ') || '无'}`),
      { code: 'NO_SERVICE' },
    );
  }
  return value;
}

/**
 * 把一个服务对象上的**功能函数**取出来。
 *
 * 基准台要调的是"产品提供的那些动作"，而不是服务对象的每一个字段 ——
 * 所以这里只挑函数与函数型的 getter，并且**保持名字原样**（改名会让
 * 基准与产品对不上，排查时最费时间的正是这种"同一个东西两个名字"）。
 *
 * @param service - 服务对象。
 * @param options.only - 只取这些名字（不给就取全部函数）。
 * @returns `{ functions: {name: fn}, getters: {name: value} }`。
 */
export function apiOf(service, { only } = {}) {
  const functions = {}, getters = {};
  const target = service ?? {};
  if (!only) {
    // 类实例的方法挂在 prototype 上，`Object.keys` 看不到 —— 所以这里
    // 沿原型链把**所有**名字收齐（到 Object.prototype 为止）。
    const names = new Set();
    for (let proto = target; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
    }
    only = [...names];
  }
  for (const name of only) {
    if (name === 'constructor') continue;
    const descriptor = findDescriptor(target, name);
    if (!descriptor) continue;
    if (typeof descriptor.value === 'function') { functions[name] = descriptor.value.bind(target); continue; }
    if (descriptor.get) {
      // getter 可能是函数也可能是值（`get concurrency()` vs `get reviewQueue()`），
      // 两种都收：调用方用 `apiOf` 就是为了"拿到服务真实暴露的东西"。
      try { getters[name] = descriptor.get.call(target); } catch { /* 读不出来的 getter 跳过 */ }
    }
  }
  return { functions, getters };
}

/** 沿原型链找一个属性描述符。 */
function findDescriptor(target, name) {
  for (let proto = target; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (descriptor) return descriptor;
  }
  return null;
}

/**
 * 先装 `dsh-zhiyun-source-campus`。
 *
 * 它是唯一 `provide('zhiyunEgress')` 的包，其余 `source-*` 的 `sharedFetch(ctx)`
 * 都指向那个服务。所以任何**要出网**的链路都要先过这一手 —— 否则不会报错，
 * 只会静默退化成 `globalThis.fetch`（走宿主给 LLM 配的全局代理，国内站点基本必失败）。
 *
 * ⚠️ 基准的核心（建树 / 重构 / 讲义）**不出网**，所以只有 `fetch-raw.mjs`
 *    这条"回源头拉原稿"的链路需要它。别在别的域里顺手调 —— 那会让基准意外联网。
 */
export async function mountCampus({ dataDir, credentials, fetchImpl = globalThis.fetch } = {}) {
  return mount('dsh-zhiyun-source-campus', { dataDir, credentials, fetchImpl });
}

/** 把错误收成可序列化的形状（凭据在外面擦除，这里只留 code/message）。 */
export function fail(error) {
  return {
    ok: false,
    code: error?.code ?? error?.name ?? 'ERROR',
    message: String(error?.message ?? error).slice(0, 400),
    ...(error?.stage ? { stage: error.stage } : {}),
  };
}

/* ── 壳（版式与路由契约）───────────────────────────────────────────── */

/**
 * 「壳的功能函数」：`dsh-zhiyun-shell-workbench/src/model.js` 里的**纯函数**。
 *
 * 它们没有 ctx、没有 DOM，所以不需要装配 —— 直接 import 模块取用。
 * 但**必须**取用产品那一份：基准要回答"这棵树该长在哪一页、哪些页整幅铺开"，
 * 用的就得是产品自己的判断。
 *
 * @returns 那份模块的全部导出。
 */
export async function shell() {
  return import(urlOf('dsh-zhiyun-shell-workbench', 'src/model.js'));
}

/** `dsh-zhiyun-shell-ui` 的 UI 原语（客户端模块，基准里只核对它们存在）。 */
export async function shellUi() {
  return import(urlOf('dsh-zhiyun-shell-ui', 'src/index.js'));
}
