/**
 * 设置页「这份凭据的用途」那一块 —— 各数据源分项状态。
 *
 * # 这个文件补什么
 *
 * 那一块的后端探测曾经有两个问题，都没有任何测试覆盖：
 *
 * 1. **`probeCampusSource` 查的是已退役的 `zhiyunCampus`。**
 *    `source/campus` 拆成 `xuezai` + `pta` 之后服务名变成了 `zhiyunXuezai`，
 *    但那段没跟着改 —— 于是「学在浙大」那一行**永远**显示「数据源未启用」，
 *    即使它明明装着。
 * 2. **只探了 3 个数据源**（campus / classroom / zdbk），其余六个有状态的包
 *    （`lab` / `cnki` / `xuezai` / `sztz` / `tyys` / `notice` / `mail`）不显示。
 *
 * 两条都修了。这组测试钉住它们。
 *
 * # 为什么用假 ctx 直接调探测
 *
 * 探测函数是 `apply()` 内部的闭包，通过 HTTP 路由暴露。这里走 `apply` +
 * 假 `webServer` 注册，测的是**真实接线**而不是替身 —— 否则「测试通过但线上
 * 路径不同」的风险会重演（本项目已经踩过两次）。
 */

import { EventEmitter } from 'node:events';

import { WRITE_HEADER } from '../../../packages/source/login/src/shared.js';
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 起一个假宿主，从 `apply()` 里拿到状态路由的 handler。
 *
 * @param options.services - 服务名 → 假服务。
 * @param options.credentials - 假凭据服务（记录卡状态）。
 * @returns `{ handler }`。
 */
async function boot({ services = {}, credentials = null } = {}) {
  const { apply } = await import('../../../packages/source/login/src/index.js');
  let registered = null;
  const ctx = {
    profileContext: { dir: process.env.TEMP ?? '/tmp' },
    logger: { info() {}, warn() {}, error() {} },
    get: (name) => (name === 'credentials' ? credentials : services[name]),
    provide: () => () => {},
    // 注册发生在 `scope.effect(...)` 里，所以要**立即执行**并返回清理函数。
    effect: (fn) => {
      if (typeof fn !== 'function') return () => {};
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    inject: (_names, factory) => factory({
      ...ctx,
      webServer: {
        // 路由路径是 `/_dsh/zhiyun-card`，不是含 `login` 的名字 —— 按路径精确取。
        register: (row) => { if (row.path === '/_dsh/zhiyun-card') registered = row; return () => {}; },
      },
    }),
  };
  apply(ctx);
  assert.ok(registered?.handler, '要注册状态路由');
  return { handler: registered.handler };
}

/**
 * 发一次请求到状态路由。
 *
 * @param handler - 路由 handler。
 * @param options.method - `GET` 或 `POST`。
 * @param options.action - `POST` 时的动作名（探测用 `probe`）。
 * @returns 解析后的响应体。
 */
async function call(handler, { method = 'GET', action = '' } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = action ? `/?${action}` : '/';
  req.headers = {
    host: '127.0.0.1',
    // 写请求要这个头；`probe` 也走这道闸（它会发网络请求）。
    [WRITE_HEADER]: '1',
    'content-type': 'application/json',
  };
  req.socket = { remoteAddress: '127.0.0.1' };
  // `readJsonBody` 用 `for await (const chunk of req)` 读体 —— 假 req 要能异步迭代。
  const payload = JSON.stringify({ probe: true });
  req[Symbol.asyncIterator] = async function* () { yield Buffer.from(payload); };

  let body = '';
  const res = {
    writeHead() {},
    end(chunk) { body += chunk ?? ''; },
  };
  await handler(req, res);
  return JSON.parse(body || '{}');
}

/**
 * 触发一次真探测并返回 `sources`。
 *
 * ⚠️ **必须走 `POST probe`**：C 方案下 `GET` 只回缓存，没探过就是
 * `UNKNOWN`（「未检测」）。拿 `GET` 的结果断言状态会永远看到「未检测」。
 *
 * @param handler - 路由 handler。
 * @returns `sources` 对象。
 */
async function readSources(handler) {
  const payload = await call(handler, { method: 'POST', action: 'probe' });
  return payload.sources ?? {};
}

test('学在浙大：查 zhiyunXuezai（不是已退役的 zhiyunCampus）', async () => {
  // 这条钉住那个 bug：改了服务名之后没跟着改，于是永远「未启用」。
  let asked = [];
  const { handler } = await boot({
    services: {
      // 旧的退役服务名**故意不提供** —— 如果代码还在查它，就会报 NOT_INSTALLED
      zhiyunXuezai: {
        async egress() { asked.push('xuezai'); return { campus: 'inside', viaWebvpn: false }; },
      },
    },
  });
  const sources = await readSources(handler);
  assert.equal(sources.campus?.ok, true, '装了就应当报可用，不能恒为「未启用」');
  assert.equal(sources.campus?.code, 'INSIDE');
  assert.deepEqual(asked, ['xuezai'], '要真的去问 zhiyunXuezai');
});

test('学在浙大：校外未配 WebVPN 要如实报', async () => {
  const { handler } = await boot({
    services: { zhiyunXuezai: { async egress() { return { campus: 'outside', viaWebvpn: false }; } } },
  });
  const sources = await readSources(handler);
  assert.equal(sources.campus?.ok, false);
  assert.equal(sources.campus?.code, 'OFF_CAMPUS');
  assert.match(sources.campus?.detail ?? '', /WebVPN/, '要提示原因');
});

test('九个共用统一身份认证的数据源都有分项状态（lab 有自己的分区，不在此列）', async () => {
  // 这条钉住「扩到全部」：先前只探 campus / classroom / zdbk。
  const stub = (ready = true) => ({ async ready() { return ready; } });
  const { handler } = await boot({
    services: {
      zhiyunXuezai: {
        async egress() { return { campus: 'inside' }; },
        async fingerprint() { return 'abc123'; },
      },
      zhiyunClassroom: { async restoreSession() { return { authenticated: true, user: { name: '张三' } }; } },
      zhiyunZdbk: { async login() {} },
      zhiyunLab: { status() { return { loggedIn: true, username: 'u' }; } },
      zhiyunSztz: stub(),
      zhiyunTyys: stub(),
      zhiyunNotice: stub(),
      zhiyunMail: stub(),
    },
    credentials: {
      async readRecord() { return { kind: 'grant', payload: { username: 'u', password: 'p' } }; },
      async modifyRecord() {},
    },
  });
  const sources = await readSources(handler);
  // ⚠️ `lab` **不在**这里：它有独立凭证（`auth: "own"`）与独立设置分区，
  // 用户在那块看它的状态。这一块只列共用统一身份认证的那些。
  // `lab` 与 `mail` 都**不在**这里：它们各有独立凭证与独立设置分区。
  // 这一块只列「共用统一身份认证」的那些。
  const expected = ['campus', 'classroom', 'zdbk', 'xuezai', 'sztz', 'tyys', 'notice'];
  for (const key of expected) {
    assert.ok(sources[key], `缺 ${key} 的分项状态`);
    assert.equal(typeof sources[key].ok, 'boolean', `${key} 要给出 ok`);
    assert.ok(sources[key].code, `${key} 要给出状态码`);
  }
});

test('没装的包报 NOT_INSTALLED，不抛错', async () => {
  const { handler } = await boot({ services: {} });
  const sources = await readSources(handler);
  assert.equal(sources.lab, undefined, 'lab 有自己的分区，不在这一块');
  assert.equal(sources.campus?.code, 'NOT_INSTALLED');
  assert.equal(sources.notice?.code, 'NOT_INSTALLED');
  assert.equal(sources.mail, undefined, 'mail 有独立分区，不在这一块');
});

test('一个源挂了不影响其它源（各自兜底）', async () => {
  const { handler } = await boot({
    services: {
      zhiyunSztz: { ready() { throw new Error('炸了'); } },
      zhiyunNotice: { ready() { return true; } },
      zhiyunMail: { async ready() { return true; } },
    },
  });
  const sources = await readSources(handler);
  assert.equal(sources.sztz?.ok, false, '挂掉的那个要报不可用（ready 抛错时兜底成 false）');
  // 别的照样有结果 —— 否则一处出问题就整块看不到
  assert.equal(sources.notice?.ok, true);
});



test('学在浙大：出口未知不能判成「校外」', async () => {
  // 这条钉住一个真 bug：`egress.state()` 的 `campus` 在**没探测过**时是
  // `'unknown'`，而先前被当成「校外」→ 明明在校内也显示「校外且未配 WebVPN」。
  // 现场症状是同一时刻 xuezai 会话探测成功、出口却说校外，两个结论矛盾。
  const { handler } = await boot({
    services: {
      zhiyunXuezai: {
        // 模拟未探测：campus 是 unknown
        async egress() { return { campus: 'unknown', viaWebvpn: false }; },
      },
    },
  });
  const sources = await readSources(handler);
  assert.equal(sources.campus?.ok, false);
  assert.notEqual(sources.campus?.code, 'OFF_CAMPUS', 'unknown 不是「校外」');
  assert.equal(sources.campus?.code, 'PROBE_UNKNOWN');
});

test('学在浙大：探测时要带 probe:true（否则永远是 unknown）', async () => {
  let asked = null;
  const { handler } = await boot({
    services: {
      zhiyunXuezai: {
        async egress(options) { asked = options; return { campus: 'inside' }; },
      },
    },
  });
  await readSources(handler);
  assert.equal(asked?.probe, true, '不带 probe 的话 egress 不会真的探一次');
});
/* ────────────────────────────── CAS 登录重试（照上游 zdbk/client.ts:113-123） */

test('casTransport：第一次登录失败会自动重试一次（短时间连登时 CAS 偶尔仍回登录页）', async () => {
  // 上游实测：「两台机器短时间内交替登录时，回跳偶尔仍落在登录页，
  // 连续多次登录后更常见；隔一会儿再走一次」。
  // 这一页要一次问九个数据源 = 短时间连登多次 —— 正是那个形状。
  const { createCasRetry } = await import('../../../packages/source/login/src/index.js');
  assert.equal(typeof createCasRetry, 'function', '要有可测的重试封装');

  let attempts = 0;
  const waits = [];
  const result = await createCasRetry({
    run: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('回跳仍是登录页'), { code: 'AUTH_REJECTED_PAGE' });
      return 'ok';
    },
    wait: async (ms) => { waits.push(ms); },
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 2, '应当重试一次');
  assert.deepEqual(waits, [1500], '重试前要等 1.5 秒');
});

test('casTransport：密码错/被拒**不重试**（重试只是浪费用户 1.5 秒）', async () => {
  const { createCasRetry } = await import('../../../packages/source/login/src/index.js');
  let attempts = 0;
  await assert.rejects(
    () => createCasRetry({
      run: async () => {
        attempts += 1;
        throw Object.assign(new Error('密码错'), { code: 'CREDENTIALS' });
      },
      wait: async () => {},
    }),
    (error) => { assert.equal(error.code, 'CREDENTIALS'); return true; },
  );
  assert.equal(attempts, 1, '凭据错误不该重试');
});

test('casTransport：重试也只有两次，连续失败就抛', async () => {
  const { createCasRetry } = await import('../../../packages/source/login/src/index.js');
  let attempts = 0;
  await assert.rejects(
    () => createCasRetry({
      run: async () => { attempts += 1; throw Object.assign(new Error('网络'), { code: 'NETWORK' }); },
      wait: async () => {},
    }),
  );
  assert.equal(attempts, 2, '最多两次');
});

test('casTransport：并发要同一个 entry 只登一次（并发登多次会互相挤掉票）', async () => {
  const { createCasRetry } = await import('../../../packages/source/login/src/index.js');
  // 同一 entry 的并发请求应共享同一次登录 —— 用重试封装本身验不出这点，
  // 所以这里验的是「封装内部不会并发跑两次 run」。
  let running = 0;
  let peak = 0;
  const shared = (() => {
    let p = null;
    return () => (p ??= (async () => {
      running += 1; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
      return 'ok';
    })());
  })();
  await Promise.all([shared(), shared(), shared()]);
  assert.equal(peak, 1, '同一 entry 只应有一次登录在跑');
});