/**
 * 学在浙大下载的**接线**：`apply()` → `zhiyunXuezai.xzzdDownload` → 路由。
 *
 * # 为什么单开一份而不是并进 `downloads.test.mjs`
 *
 * 那份测的是**下载器本身**（断点续传、文件名、不覆盖），输入是假的 reader
 * 与假的传输层。而这里测的是「装进插件之后还能不能用」，两者的失败方式不同：
 *
 *   - 下载器错了 → 文件内容不对；
 *   - 接线错了 → **文件根本下不下来**，而且错得很隐蔽。本仓已经踩过两次：
 *     `session: { jar: null }` 让真实请求发不出去、`setCredentialProvider`
 *     全仓没有调用方 —— 两种情况下纯函数测试都是全绿的。
 *
 * 所以这里必须走真的 `apply()`、真的服务面、真的路由 handler。
 *
 * # 一条口径
 *
 * 下载根目录**由装配层决定**，调用方传不进路径。这条是安全边界（平台给的
 * 文件名不该决定写到哪），所以用例里专门断言「配置了 `downloadDir` 就落那儿」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * 装配出一个可用的 `zhiyunXuezai` 服务面。
 *
 * `apply()` 要 `profileContext.dir`（会话文件落盘）与凭据读取；两者都给最小替身。
 * 下载动作会先 `xzzdClient()` → 会话检查 → 可能走 CAS，所以这里让 `fetch`
 * 在**登录以外**的路径上回一个极小的响应，并把 `config.fetch` 记下来 ——
 * 参数校验类的用例据此断言「非法参数一个请求都没发」。
 *
 * @param options.downloadDir - 下载根（不给就用默认 `<dataDir>/downloads`）。
 * @param options.fetch - 覆盖假 fetch。
 * @returns `{ service, dispose, sent, dataDir }`。
 */
async function mount({ downloadDir, fetch: fetcher, dataDir } = {}) {
  const dir = dataDir ?? await mkdtemp(path.join(tmpdir(), 'xuezai-download-wiring-'));
  const services = new Map();
  const ctx = {
    profileContext: { dir },
    logger: { info() {} },
    effect: (fn) => fn() ?? (() => {}),
    provide: (name, value) => { services.set(name, value); return () => {}; },
    get: (name) => services.get(name),
    inject: () => {},
  };
  const calls = [];
  const { apply } = await import('../../../packages/source/xuezai/src/index.js');
  const dispose = await apply(ctx, {
    ...(downloadDir ? { downloadDir } : {}),
    fetch: fetcher ?? (async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers ?? {} });
      throw new Error('测试不该发真实请求');
    }),
  });
  return {
    service: services.get('zhiyunXuezai'),
    dispose,
    sent: calls,
    dataDir: dir,
  };
}

test('服务面暴露 xzzdDownload 与 downloadDir，且下载**不在** writeMethods 里', async () => {
  const { service, dispose } = await mount();
  try {
    assert.equal(typeof service.xzzdDownload, 'function', 'zhiyunXuezai 没有 xzzdDownload —— 下载能力装不上');
    assert.equal(typeof service.downloadDir, 'function', '页面要知道文件去哪了，所以要有 downloadDir');
    // 判据：会不会改变**平台**状态。下载一个字节都没改，所以不在写方法表里。
    for (const name of service.writeMethods) {
      assert.equal(/download/i.test(name), false, `${name} 不该出现在 writeMethods 里`);
    }
  } finally { await dispose?.(); }
});

test('未知下载动作报 INVALID_INPUT 并列出可选值（且不去取会话）', async () => {
  const { service, dispose, sent } = await mount();
  try {
    const message = await service.xzzdDownload({ action: 'nope' }).then(
      () => assert.fail('非法 action 应当抛'),
      (error) => {
        assert.equal(error.code, 'INVALID_INPUT');
        return error.message;
      },
    );
    assert.match(message, /materials/);
    assert.match(message, /homework/);
    assert.equal(sent.length, 0, '参数错误是调用方的错，不该触发登录或任何请求');
  } finally { await dispose?.(); }
});

test('materials 的 courseId 非法时，在取会话之前就拦住', async () => {
  const { service, dispose, sent } = await mount();
  try {
    for (const bad of [undefined, null, 'abc', 0, -1, 1.5]) {
      await assert.rejects(
        () => service.xzzdDownload({ action: 'materials', courseId: bad, all: true }),
        (error) => {
          assert.equal(error.code, 'INVALID_INPUT', `courseId=${String(bad)} 应当报 INVALID_INPUT`);
          return true;
        },
      );
    }
    assert.equal(sent.length, 0);
  } finally { await dispose?.(); }
});

test('homework 的 activityId 非法时同样在取会话之前拦住', async () => {
  const { service, dispose, sent } = await mount();
  try {
    for (const bad of [undefined, 'abc', 0, -3]) {
      await assert.rejects(
        () => service.xzzdDownload({ action: 'homework', activityId: bad }),
        (error) => error.code === 'INVALID_INPUT',
      );
    }
    assert.equal(sent.length, 0);
  } finally { await dispose?.(); }
});

test('uploadIds 给了一串全非法时**报错**，不能被静默当成「没指定」', async () => {
  const { service, dispose } = await mount();
  try {
    // 静默变成「全部」是最坏的一种解释：用户以为自己只挑了一个文件。
    await assert.rejects(
      () => service.xzzdDownload({ action: 'materials', courseId: 7, uploadIds: ['abc', '../etc/passwd', ''] }),
      (error) => error.code === 'INVALID_INPUT',
    );
  } finally { await dispose?.(); }
});

test('downloadDir 由装配层决定：配置了就落在那儿，默认在数据目录的 downloads 下', async (t) => {
  const custom = await mkdtemp(path.join(tmpdir(), 'xuezai-download-root-'));
  t.after(() => rm(custom, { recursive: true, force: true }));

  const configured = await mount({ downloadDir: custom });
  try {
    assert.equal(configured.service.downloadDir(), path.resolve(custom));
  } finally { await configured.dispose?.(); }

  const fallback = await mount();
  try {
    // 默认根在**数据目录**之下（`<dataDir>/downloads`），与缓存同理：
    // 它是插件的派生产物，该跟数据目录一起被清理，不混进用户自己的「下载」。
    assert.equal(
      fallback.service.downloadDir(),
      path.resolve(path.join(fallback.dataDir, 'data', 'zhiyun-xuezai', 'downloads')),
    );
  } finally { await fallback.dispose?.(); await rm(fallback.dataDir, { recursive: true, force: true }); }
});

test('路由：xzzd-download 走 POST + 自定义头，缺头是 403', async () => {
  // 与 `xzzd-read` 同一道闸：它带 id 参数、会把文件写到本机。自定义头跨站发不出，
  // 硬带会触发本路由不响应的预检 —— 等于 CSRF 闸。
  const { apply, WRITE_HEADER, ROUTE_PATH } = await import('../../../packages/source/xuezai/src/index.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'xuezai-route-'));
  try {
    let handler = null;
    const ctx = {
      profileContext: { dir },
      logger: { info() {} },
      effect: (fn) => fn() ?? (() => {}),
      provide: () => () => {},
      get: () => undefined,
      inject: (_services, fn) => fn({ webServer: { register: (route) => { handler = route; return () => {}; } }, effect: (fn2) => fn2() }),
    };
    const dispose = await apply(ctx, { fetch: async () => { throw new Error('不该发请求'); } });
    try {
      assert.ok(handler, '路由没注册上');
      assert.equal(handler.path, ROUTE_PATH);

      /** 造一对 req / res，拿回状态码与响应体。 */
      const call = async (headers, body) => {
        const chunks = [Buffer.from(JSON.stringify(body ?? {}))];
        const req = {
          method: 'POST',
          url: `${ROUTE_PATH}?xzzd-download`,
          headers: { host: '127.0.0.1', ...headers },
          async *[Symbol.asyncIterator]() { yield* chunks; },
        };
        let status = 0;
        let payload = '';
        const res = {
          writeHead: (code) => { status = code; },
          end: (text) => { payload = text; },
        };
        await handler.handler(req, res);
        return { status, body: JSON.parse(payload) };
      };

      const denied = await call({}, { action: 'materials', courseId: 7, all: true });
      assert.equal(denied.status, 403, '缺自定义头应当 403');
      assert.match(denied.body.error, new RegExp(WRITE_HEADER));

      // 带上头之后：参数校验先报（这里 courseId 非数字），状态 400。
      const invalid = await call({ [WRITE_HEADER]: '1' }, { action: 'nope' });
      assert.equal(invalid.status, 400, '未知动作应当是 400，不是 500');
      assert.equal(invalid.body.error.code, 'INVALID_INPUT');
    } finally { await dispose?.(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('非回环 Host 一律 403（这条路由能把文件写到本机）', async () => {
  const { apply, ROUTE_PATH, WRITE_HEADER } = await import('../../../packages/source/xuezai/src/index.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'xuezai-route-host-'));
  try {
    let handler = null;
    const ctx = {
      profileContext: { dir },
      logger: { info() {} },
      effect: (fn) => fn() ?? (() => {}),
      provide: () => () => {},
      get: () => undefined,
      inject: (_services, fn) => fn({ webServer: { register: (route) => { handler = route; return () => {}; } }, effect: (fn2) => fn2() }),
    };
    const dispose = await apply(ctx, { fetch: async () => { throw new Error('不该发请求'); } });
    try {
      const req = {
        method: 'POST',
        url: `${ROUTE_PATH}?xzzd-download`,
        headers: { host: 'evil.example.com', [WRITE_HEADER]: '1' },
        async *[Symbol.asyncIterator]() { yield Buffer.from('{}'); },
      };
      let status = 0;
      await handler.handler(req, { writeHead: (code) => { status = code; }, end: () => {} });
      assert.equal(status, 403);
    } finally { await dispose?.(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
