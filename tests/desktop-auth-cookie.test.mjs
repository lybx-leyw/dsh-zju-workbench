/**
 * 桌面壳：**启动时必须清掉上一次的鉴权 cookie**。
 *
 * # 这条测试守的是一个真实的白屏
 *
 * 宿主的鉴权方式是「一次性 token → 换一个 `dsh-auth-<随机串>` cookie」。
 * 那个 cookie 没有过期时间、也从不回收，而壳每次启动都用**新 token + 新端口**，
 * 于是每启动一次就往同一个 origin 多堆一个 cookie。
 *
 * 实测后果：攒到 70 个（约 15.7 KB）时，请求头超过宿主上限，宿主回
 * **431 Request Header Fields Too Large**，且 body 是空的
 * （`<html><head></head><body></body></html>`）—— 前端一个 script 都加载不了。
 * 用户看到的是"一打开就白屏"，但进程在、端口在、日志也是成功的。
 *
 * 所以 `purgeStaleAuthCookies()` 不是洁癖，是**让白屏不再复发的那一步**。
 *
 * # 测试策略
 *
 * 真跑一遍 Electron 太慢（几十秒），而且"cookie 是否被清掉"完全可以
 * 用纯函数验证。这里用假 session 覆盖三条：
 *   1. 有旧 cookie 时必须清掉（且只清 `dsh-auth-` 前缀）；
 *   2. 没有旧 cookie 时不做任何事（不要每次空转）；
 *   3. 删除失败时**不能拦住启动**（431 是"头太大"，不是致命错误）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/**
 * 把 `main.js` 里那个内部函数取出来测。
 *
 * `purgeStaleAuthCookies` 没有 export（它是 main.js 的私有实现），
 * 而 `main.js` 一 import 就会 `app.whenReady()` —— 不能直接导入。
 * 所以这里用**源码提取 + 动态构造**的方式单独跑它，逻辑与生产同一份代码。
 */
async function loadPurge() {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(path.join(root, 'apps/desktop/src/main.js'), 'utf8');
  const start = source.indexOf('async function purgeStaleAuthCookies()');
  assert.ok(start >= 0, 'main.js 里应当有 purgeStaleAuthCookies');
  // 取到函数结束（下一个顶层 `}` 后跟空行）
  const body = source.slice(start);
  const end = body.indexOf('\n}\n');
  assert.ok(end > 0, '找不到函数结尾');
  const fnSource = body.slice(0, end + 2);

  // 构造一个最小模块：注入 `win` 与 `log`
  const module = `
    let win, log;
    export function __setup(fakeWin, fakeLog) { win = fakeWin; log = fakeLog; }
    ${fnSource}
    export { purgeStaleAuthCookies };
  `;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(module, 'utf8').toString('base64');
  return await import(dataUrl);
}

/** 造一个假 session，记录 remove 的调用。 */
function fakeSession(cookies, { failRemove = false } = {}) {
  const removed = [];
  const win = {
    webContents: {
      session: {
        cookies: {
          get: async () => cookies,
          remove: async (url, name) => {
            if (failRemove) throw new Error('remove failed');
            removed.push({ url, name });
          },
        },
      },
    },
  };
  return { win, removed };
}

test('有旧 cookie 时必须清掉，且只清 dsh-auth- 前缀', async () => {
  const mod = await loadPurge();
  const cookies = [
    { name: 'dsh-auth-abc123', value: 'x', domain: '127.0.0.1', path: '/' },
    { name: 'dsh-auth-def456', value: 'y', domain: '127.0.0.1', path: '/' },
    // 不是鉴权 cookie 的不能被误删
    { name: 'theme', value: 'dark', domain: '127.0.0.1', path: '/' },
  ];
  const { win, removed } = fakeSession(cookies);
  const logged = [];
  mod.__setup(win, (line) => logged.push(line));

  await mod.purgeStaleAuthCookies();

  assert.equal(removed.length, 2, '两个鉴权 cookie 都要删');
  assert.deepEqual(removed.map((r) => r.name).sort(), ['dsh-auth-abc123', 'dsh-auth-def456']);
  assert.equal(removed.some((r) => r.name === 'theme'), false, '非鉴权 cookie 不能动');
  assert.ok(logged.some((line) => /已清理 2 个/.test(line)), `日志要说明清了几个，实际: ${logged}`);
});

test('没有旧 cookie 时不做任何事，也不写噪音日志', async () => {
  const mod = await loadPurge();
  const { win, removed } = fakeSession([{ name: 'theme', value: 'dark', domain: '127.0.0.1', path: '/' }]);
  const logged = [];
  mod.__setup(win, (line) => logged.push(line));

  await mod.purgeStaleAuthCookies();

  assert.equal(removed.length, 0);
  assert.equal(logged.length, 0, '无事可做就不该有日志');
});

test('删除失败不能拦住启动（431 只是头太大，不是致命错误）', async () => {
  const mod = await loadPurge();
  const { win } = fakeSession(
    [{ name: 'dsh-auth-abc', value: 'x', domain: '127.0.0.1', path: '/' }],
    { failRemove: true },
  );
  const logged = [];
  mod.__setup(win, (line) => logged.push(line));

  // 不应抛
  await assert.doesNotReject(() => mod.purgeStaleAuthCookies());
  // 失败要被**如实说出来**，而不是静默吞掉或谎称成功
  assert.ok(
    logged.some((line) => /0\/1 成功/.test(line)),
    `删除失败必须如实记录（不能声称清了），实际: ${logged}`,
  );
  assert.equal(
    logged.some((line) => /已清理 1 个/.test(line)),
    false,
    '没删掉就不能说"已清理 1 个"',
  );
});

test('删除 URL 要拼对（带协议、去前导点）', async () => {
  const mod = await loadPurge();
  const { win, removed } = fakeSession([
    { name: 'dsh-auth-x', value: 'v', domain: '.127.0.0.1', path: '/' },
  ]);
  mod.__setup(win, () => {});

  await mod.purgeStaleAuthCookies();
  assert.equal(removed.length, 1);
  assert.equal(removed[0].url, 'http://127.0.0.1/', `URL 拼错了: ${removed[0].url}`);
});
