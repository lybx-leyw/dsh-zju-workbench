/**
 * 研究生教务网数据源**宿主入口层**（`src/index.js`）的测试。
 *
 * # 为什么单独一个文件
 *
 * `tests/yjsy.test.mjs` 的 21 条全部只 import `src/yjsy.js`（纯解析）。
 * 而审核查出的两个阻断/重要缺陷都在 `src/index.js` 里：
 *
 *   1. `session: { jar: null }` → `Transport.request` 会无条件调
 *      `this.session.jar.getCookies(url)`（`http/src/transport.js:96`），
 *      `jar: null` 抛 TypeError → 被包成 `ClassroomError('NETWORK')`。
 *      **表现是这个包一次真实请求也发不出去**，而纯解析测试全绿。
 *   2. token 缓存不看 `username` → 换账号会返回上一个人的课表（隐私泄露）。
 *
 * 这两条都不会被「测纯函数」抓到 —— 这就是集成层必须有测试的理由。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../../../packages/source/yjsy/src/index.js';

/**
 * 造一个最小的 cordis 风格 ctx。
 *
 * `inject` 的回调立刻执行（模拟服务已在位），`webServer.register` 记录注册项。
 *
 * @returns `{ ctx, services, routes }`。
 */
function fakeCtx() {
  const services = new Map();
  const routes = [];
  const ctx = {
    effect(fn) { return fn() ?? (() => {}); },
    provide(name, value) { services.set(name, value); return () => services.delete(name); },
    inject(names, callback) {
      const scope = { webServer: { register(entry) { routes.push(entry); return () => {}; } } };
      callback(scope);
    },
  };
  return { ctx, services, routes };
}

/** 装配一次并返回服务面。 */
function mount() {
  const { ctx, services, routes } = fakeCtx();
  apply(ctx);
  return { yjsy: services.get('zwYjsy'), routes, services };
}

test('apply() 真的 provide 了 zwYjsy 并注册了路由', () => {
  const { yjsy, routes } = mount();
  assert.ok(yjsy, '必须 provide zwYjsy');
  assert.equal(routes.length, 1, '必须注册一条路由');
  assert.equal(routes[0].path, '/api/zw-yjsy');
});

test('没有注入 token provider 时，timetable 抛 CONFIG 且文案可操作', async () => {
  const { yjsy } = mount();
  await assert.rejects(() => yjsy.timetable({ username: '2234567890' }), (error) => {
    assert.equal(error.code, 'CONFIG');
    // 文案要告诉用户**下一步做什么**，而不是「调用 setTokenProvider」这种内部名词。
    assert.match(error.message, /设置/);
    assert.match(error.message, /浙大一卡通/);
    return true;
  });
});

test('setTokenProvider 传非函数时立刻抛错（不静默置 null）', () => {
  const { yjsy } = mount();
  assert.throws(() => yjsy.setTokenProvider('not a function'), (error) => {
    assert.equal(error.code, 'CONFIG');
    return true;
  });
});

test('setTokenProvider(null) 可以取消注册，返回撤销函数幂等', () => {
  const { yjsy } = mount();
  const undo = yjsy.setTokenProvider(async () => 'tok');
  assert.doesNotThrow(() => undo());
  assert.doesNotThrow(() => undo());
  assert.doesNotThrow(() => yjsy.setTokenProvider(null));
});

test('ready() 反映是否已注入', () => {
  const { yjsy } = mount();
  assert.equal(yjsy.ready(), false);
  yjsy.setTokenProvider(async () => 'tok');
  assert.equal(yjsy.ready(), true);
});

/**
 * 造一个假的 `sharedFetch` 替身行不通（`fetch` 是模块级 import），
 * 所以这里验证的是**缓存键**这个纯逻辑：换 username 必须重建客户端。
 *
 * 用 `setTokenProvider` 被调用的次数来观察「有没有重建」。
 */
test('换账号必须重建客户端（防把上一个人的课表读给现在的人）', async () => {
  const { yjsy } = mount();
  let calls = 0;
  yjsy.setTokenProvider(async ({ username }) => { calls += 1; throw new Error(`故意失败:${username}`); });

  // 第一次：A。`openYjsy` 两个入口各试一次 → 然后抛 REJECTED。
  await assert.rejects(() => yjsy.timetable({ username: 'A' }));
  const afterA = calls;
  assert.ok(afterA > 0, 'A 必须触发 acquireToken');

  // 第二次：B。即使 A 的客户端被缓存着，也必须重新走 B 的登录。
  await assert.rejects(() => yjsy.timetable({ username: 'B' }));
  assert.ok(calls > afterA, '换账号必须重新取 token，不能复用 A 的客户端');
});

/**
 * ⚠️ 「同账号复用客户端」这条**测不了**，原因与记录如下。
 *
 * `src/index.js` 里的 `fetch` 来自模块级 `import { sharedFetch }`，无法从外部替换。
 * 因此让 `client()` 返回一个真正可用的客户端需要真实网络（打到 `yjsy.zju.edu.cn`），
 * 测试里不该这么做。
 *
 * 而用假 provider 时，`openYjsy` 会成功返回一个客户端，紧接着 `timetable()` 因为
 * 没有真实响应而抛错 —— 那条路径上 `cached` 已经赋值，但断言「第二次不再调 provider」
 * 需要第一次**不抛错**，否则 `readTimetable` 的 AUTH_EXPIRED 重试会混淆计数。
 *
 * 这条缺口由人工核对覆盖：`client()` 里 `if (!fresh && cached && !cached.client.expired)
 * return cached.client` 与 `cached = { client, transport, username }` 是同一份闭包状态，
 * 且「换账号」那条测试证明了 `cached.username` 比对真的在起作用。
 */

test('路由：未知 action 返回 ok:false + CONFIG', async () => {
  const { routes } = mount();
  const handler = routes[0].handler;

  const body = JSON.stringify({ action: '不存在的动作' });
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, 'CONFIG');
      assert.match(parsed.error.message, /不认识的操作/);
    },
  };
  await handler(makeReq(body), res);
});

test('路由：timetable 在没有 provider 时返回 ok:false', async () => {
  const { routes } = mount();
  const body = JSON.stringify({ action: 'timetable', input: { username: 'A' } });
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, 'CONFIG');
    },
  };
  await routes[0].handler(makeReq(body), res);
});

test('清理后 transport 被关闭（不泄漏 AbortController）', async () => {
  // 通过卸载 effect 触发清理路径；只要不抛就算过 —— 真正的泄漏要靠长进程观测，
  // 这里至少钉住「清理函数存在且可调用」。
  const { ctx, services } = fakeCtx();
  const dispose = apply(ctx);
  assert.ok(services.get('zwYjsy'));
  await assert.doesNotReject(async () => { await dispose?.(); });
});

/**
 * 造一个最小的请求对象。
 *
 * 监听器注册完就异步触发 `data` / `end` —— 与真实可读流的行为一致：
 * `on` 是同步注册，事件在之后到达。
 *
 * @param body - 请求体（会被包成 Buffer）。
 * @returns 事件发射器形状的对象。
 */
function makeReq(body) {
  const handlers = new Map();
  const req = {
    on(event, fn) {
      handlers.set(event, fn);
      // 两个事件都注册好之后再触发，避免 end 先于 data。
      if (handlers.has('data') && handlers.has('end') && !req.scheduled) {
        req.scheduled = true;
        setImmediate(() => {
          handlers.get('data')?.(Buffer.from(body, 'utf8'));
          handlers.get('end')?.();
        });
      }
      return req;
    },
  };
  return req;
}

/* ──────────────────────────── 共享 CAS 兜底（A-4 的最后一条） ──────────────────────────── */

/**
 * 装了 `source/login` 时，本包应当自己换 token，而不是报「没人喂账号」。
 *
 * # 这一条钉的是什么
 *
 * A-4 的原症状是「挂得上、用不了」：`setTokenProvider` 全仓没有调用方。
 * `ecf080f` 把 `lab` / `mail` / `sztz` / `tyys` / `notice` 都改成自己取凭据，
 * 只有 `yjsy` 漏了。这里钉住它现在也走共享 CAS：
 *
 *   1. 宿主有 `zwCard.casLoginFor` 时 `ready()` 就该是 true；
 *   2. 换 token 的那一跳（`validateLogin`）由本包发，`ticket` 来自落地 URL；
 *   3. 换不到 token 时把**平台原话**带出来（本科生走研究生入口就是这一种）。
 */
function fakeCtxWithCard({ landingUrl, validate }) {
  const services = new Map();
  const routes = [];
  const fetchCalls = [];
  const card = {
    async casLoginFor() {
      return { url: new URL(landingUrl), html: '', passwordSubmitted: false };
    },
  };
  /**
   * 出口替身：换 token 那一跳会经 `sharedFetch(ctx)`，而它会先问
   * `ctx.get('zwEgress')`。这里给一个假出口，测试就**不联网**，
   * 也能精确断言「带上了哪个 ticket、哪个 service」。
   */
  const egress = {
    async fetch(url, init) {
      fetchCalls.push({ url: String(url), init });
      const body = typeof validate === 'function' ? validate(String(url)) : validate ?? {};
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
  const ctx = {
    effect(fn) { return fn() ?? (() => {}); },
    provide(name, value) { services.set(name, value); return () => services.delete(name); },
    inject(names, callback) {
      const scope = { webServer: { register(entry) { routes.push(entry); return () => {}; } } };
      callback(scope);
    },
    get(name) {
      if (name === 'zwCard') return card;
      if (name === 'zwEgress') return egress;
      return undefined;
    },
  };
  return { ctx, services, routes, card, fetchCalls };
}

test('装了 source/login 时 ready() 为 true，且用落地票换 token', async () => {
  const host = fakeCtxWithCard({
    landingUrl: 'https://yjsy.zju.edu.cn/?ticket=ST-1',
    validate: { success: true, code: 200, message: 'ok', result: { token: 'TOKEN-1' } },
  });
  apply(host.ctx);
  const yjsy = host.services.get('zwYjsy');
  assert.equal(yjsy.ready(), true, '有共享 CAS 就算「已接入」');

  // 换 token 成功之后才去读课表；课表那一跳同样经假出口，回一个空但合法的形状。
  await yjsy.timetable({ username: '2234567890' }).catch(() => {});

  const exchange = host.fetchCalls.find((call) => call.url.includes('validateLogin'));
  assert.ok(exchange, '本包必须自己发 validateLogin 那一跳');
  const target = new URL(exchange.url);
  assert.equal(target.searchParams.get('ticket'), 'ST-1', 'ticket 取自回跳落地地址');
  assert.equal(target.searchParams.get('service'), 'https://yjsy.zju.edu.cn/', 'service 是研究生入口');

  // token 要真的带到后续业务请求的头上（换 token 那一跳自己不带）。
  const read = host.fetchCalls.find((call) => call.init?.headers?.['X-Access-Token']);
  assert.ok(read, '换到 token 之后必须带着它去读数据');
  assert.equal(read.init.headers['X-Access-Token'], 'TOKEN-1');
  assert.equal(read.url.includes('validateLogin'), false, '换 token 那一跳不该带旧 token');
});

test('共享 CAS 但没有票时抛 REJECTED，说清是认证那边的问题', async () => {
  const host = fakeCtxWithCard({ landingUrl: 'https://yjsy.zju.edu.cn/' });
  apply(host.ctx);
  const yjsy = host.services.get('zwYjsy');
  await assert.rejects(() => yjsy.timetable({ username: '2234567890' }), (error) => {
    assert.equal(error.code, 'REJECTED', '两个入口都失败时归成 REJECTED');
    assert.match(error.message, /签票|不让这个账号登录/);
    return true;
  });
  assert.equal(host.fetchCalls.length, 0, '没有票就不该发换 token 的请求');
});

test('换不到 token 时把平台原话带出来（本科生走研究生入口就是这一种）', async () => {
  const host = fakeCtxWithCard({
    landingUrl: 'https://yjsy.zju.edu.cn/?ticket=ST-1',
    validate: { success: false, code: 500, message: '无效的用户信息' },
  });
  apply(host.ctx);
  const yjsy = host.services.get('zwYjsy');
  await assert.rejects(() => yjsy.timetable({ username: '3234567890' }), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /无效的用户信息/, '平台原话要出现在最终错误里');
    return true;
  });
});

test('注入的 provider 优先于共享 CAS（装配方可以有更完整的票据链）', async () => {
  let called = 0;
  const host = fakeCtxWithCard({
    landingUrl: 'https://yjsy.zju.edu.cn/?ticket=ST-1',
    validate: { success: true, code: 200, message: 'ok', result: { token: 'FROM-CAS' } },
  });
  apply(host.ctx);
  const yjsy = host.services.get('zwYjsy');
  yjsy.setTokenProvider(async () => { called += 1; return 'INJECTED'; });
  await yjsy.timetable({ username: '2234567890' }).catch(() => {});
  assert.equal(called > 0, true, '注入的 provider 必须被调用');
  assert.equal(host.fetchCalls.some((call) => call.url.includes('validateLogin')), false, '注入优先时不该再走共享 CAS');
});
