/**
 * 网关登录的真实链路守卫。
 *
 * # 这个文件存在的唯一原因
 *
 * 2026-11-10 实测发现：`packages/source/campus/src/hosts.js` 的 `CAMPUS_HOSTS`
 * **不含 `webvpn.zju.edu.cn`**，而 `webvpnLogin()` 用的正是 campus 建的
 * `Transport`，`Transport` 只对白名单主机存 `Set-Cookie`
 * （`packages/source/http/src/transport.js:102`）。
 *
 * 后果是**网关登录在生产路径上根本不可能成功**：`do-login` 回了 200 和 ticket，
 * cookie 被静默丢弃，`hasWebvpnSession()` 恒为 false，最后抛
 * `WEBVPN_NO_SESSION`（"说登录成功，但没有返回会话 cookie"）。
 *
 * 这个 bug 不报错、不打日志、只在真正登录时才发作，靠人肉 review 抓不住。
 * 所以这里用**真实的 tough-cookie jar + 真实的 Transport** 跑一遍，
 * 断言 cookie 真的落进了 jar。
 *
 * # 为什么不用假 jar
 *
 * 假 jar 会掩盖「Transport 不调 setCookie」这个事实 —— 那正是本 bug 的机制。
 * 必须让 `Transport` 自己决定要不要存，才能验证白名单这一环。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CookieJar } from 'tough-cookie';

import { Transport } from '../packages/source/http/src/index.js';
import { webvpnLogin, hasWebvpnSession, probeWebvpnSession, WEBVPN_ORIGIN, WEBVPN_TICKET_COOKIE } from '../packages/source/webvpn/src/index.js';
import { CAMPUS_HOSTS, WEBVPN_HOSTS, WEBVPN_HOST } from '../packages/source/campus/src/hosts.js';

/** 登录页：给足 _csrf / captcha_id，让登录能走到提交那一步。 */
const LOGIN_PAGE = '<input type="hidden" name="_csrf" value="c"><input type="hidden" name="captcha_id" value="k">';

/**
 * 一个假网关出口：登录页 200，do-login 回 success 并下发 ticket cookie。
 *
 * @returns `fetch` 签名一致的函数。
 */
function gatewayFetch() {
  return async (url) => {
    const target = String(url);
    if (target.endsWith('/login')) {
      return new Response(LOGIN_PAGE, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (target.endsWith('/do-login')) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': `${WEBVPN_TICKET_COOKIE}=TICKET-VALUE; Path=/; Secure`,
        },
      });
    }
    return new Response('', { status: 200 });
  };
}

/**
 * 照 campus 的方式造一个 Transport（同一个 hosts 白名单、同一个 referer）。
 *
 * @param hosts - 主机白名单。
 * @returns `{ transport, jar }`。
 */
function makeTransport(hosts) {
  const jar = new CookieJar();
  const session = { jar, epoch: 0, save: async () => {} };
  const transport = new Transport({
    session,
    fetch: gatewayFetch(),
    timeoutMs: 5000,
    hosts,
    referer: `${WEBVPN_ORIGIN}/login`,
  });
  return { transport, jar };
}

test('CAMPUS_HOSTS 必须含网关 —— 否则 ticket 会被静默丢弃', () => {
  // 这条断言是「一句话就能看懂」的那种：网关登录用的 Transport 白名单里
  // 必须有网关自己。少了它，登录永远失败且不报根因。
  assert.equal(CAMPUS_HOSTS.has(WEBVPN_HOST), true, `CAMPUS_HOSTS 缺少 ${WEBVPN_HOST}`);
});

test('网关登录真的把 ticket 落进 jar（用真实 Transport + 真实 CookieJar）', async () => {
  const { transport, jar } = makeTransport(CAMPUS_HOSTS);

  await webvpnLogin(transport, { username: 'u', password: 'p' });

  const cookies = await jar.getCookies(`${WEBVPN_ORIGIN}/`);
  const ticket = cookies.find(c => c.key === WEBVPN_TICKET_COOKIE);
  assert.ok(ticket, 'ticket cookie 必须落在 jar 里');
  assert.equal(ticket.value, 'TICKET-VALUE');
});

test('登录后 hasWebvpnSession 立刻为真（闭环验证）', async () => {
  // 这两步必须一起成立才有意义：cookie 落了但判据看不见，等于没落。
  const { transport } = makeTransport(CAMPUS_HOSTS);
  assert.equal(await hasWebvpnSession(transport.session), false, '登录前没有会话');

  await webvpnLogin(transport, { username: 'u', password: 'p' });

  assert.equal(await hasWebvpnSession(transport.session), true, '登录后必须能看到会话');
});

test('反证：白名单漏掉网关时，登录必然抛 WEBVPN_NO_SESSION', async () => {
  // 这条用**故意错误的白名单**跑一遍，把 bug 的机制钉死。
  // 它能防止将来有人「优化」掉 hosts.js 里那一行而不自知。
  const withoutGateway = new Set([...CAMPUS_HOSTS].filter(h => h !== WEBVPN_HOST));
  assert.equal(withoutGateway.has(WEBVPN_HOST), false, '前提：这份白名单确实不含网关');

  const { transport, jar } = makeTransport(withoutGateway);

  await assert.rejects(
    () => webvpnLogin(transport, { username: 'u', password: 'p' }),
    (error) => {
      assert.equal(error.code, 'WEBVPN_NO_SESSION');
      return true;
    },
  );
  const cookies = await jar.getCookies(`${WEBVPN_ORIGIN}/`);
  assert.equal(cookies.length, 0, 'ticket 被丢弃是这条缺陷的直接证据');
});

/* ────────────────────────────── 会话探测：必须是真实响应形状 ── */

/**
 * 照 campus 的方式造 Transport，但出口可定制。
 *
 * @param fetchImpl - 出口函数。
 * @param hosts - 主机白名单，默认 `CAMPUS_HOSTS`。
 * @returns `{ transport, jar }`。
 */
function transportWith(fetchImpl, hosts = CAMPUS_HOSTS) {
  const jar = new CookieJar();
  const session = { jar, epoch: 0, save: async () => {} };
  const transport = new Transport({
    session, fetch: fetchImpl, timeoutMs: 5000, hosts, referer: `${WEBVPN_ORIGIN}/login`,
  });
  return { transport, jar };
}

test('会话探测读的是 Transport 真实响应形状（headers.location，不是顶层 location）', async () => {
  // ⚠️ 这条测试存在的原因：`Transport.request()` 返回 `{ status, headers, text }`，
  // **没有** `isRedirect` / `location`（那是上游 HttpClient 的形状）。
  // 之前的实现照上游抄了 `response.isRedirect`，拿到永远是 undefined，
  // 3xx 分支成了死代码；而测试夹具也用 `isRedirect`，把缺陷藏住了。
  // 这里用**真实 Transport** 跑，让形状由 Transport 自己决定。
  const { transport } = transportWith(async (url) => {
    const target = String(url);
    if (target.endsWith('/')) return new Response('', { status: 302, headers: { location: '/login' } });
    return new Response('', { status: 200 });
  });
  await transport.session.jar.setCookie(`${WEBVPN_TICKET_COOKIE}=t; Domain=${WEBVPN_HOST}; Path=/; Secure`, `${WEBVPN_ORIGIN}/`);

  assert.equal(
    await probeWebvpnSession(transport),
    false,
    '跳去 /login 说明会话已失效 —— 这条断言依赖 headers.location 被真的读到',
  );
});

test('会话探测：3xx 跳去非登录页 → 有效', async () => {
  const { transport } = transportWith(async (url) => {
    const target = String(url);
    if (target.endsWith('/')) return new Response('', { status: 302, headers: { location: '/portal/x' } });
    return new Response('', { status: 200 });
  });
  await transport.session.jar.setCookie(`${WEBVPN_TICKET_COOKIE}=t; Domain=${WEBVPN_HOST}; Path=/; Secure`, `${WEBVPN_ORIGIN}/`);

  assert.equal(await probeWebvpnSession(transport), true);
});

/* ────────────────────────── 主机白名单分档 ── */

test('WEBVPN_HOSTS 含网关，业务用的 CAMPUS_HOSTS 也含（冗余是刻意的）', () => {
  // 网关登录用 WEBVPN_HOSTS，业务请求用 CAMPUS_HOSTS。
  // 两份都含网关，是因为「漏一个主机」这个错误不报错、不打日志、只在登录时发作 ——
  // 冗余一份的成本远低于再踩一次的代价。
  assert.equal(WEBVPN_HOSTS.has(WEBVPN_HOST), true);
  assert.equal(CAMPUS_HOSTS.has(WEBVPN_HOST), true);
  // 分档的意义在于：网关那份是显式的，业务那份不含「只给网关用」的东西。
  assert.ok(WEBVPN_HOSTS.size >= CAMPUS_HOSTS.size);
});

test('网关登录走 WEBVPN_HOSTS 时能收到 ticket（业务白名单也能，但登录显式用前者）', async () => {
  // 这条锁住「登录路径用的是哪一份」。两份都含网关时行为相同，
  // 但将来若有人把 CAMPUS_HOSTS 收窄（例如按域拆开业务用途），
  // 登录路径必须仍能工作 —— 它用的是 WEBVPN_HOSTS。
  const jar = new CookieJar();
  const session = { jar, epoch: 0, save: async () => {} };
  const transport = new Transport({
    session, fetch: gatewayFetch(), timeoutMs: 5000, hosts: WEBVPN_HOSTS, referer: `${WEBVPN_ORIGIN}/login`,
  });

  await webvpnLogin(transport, { username: 'u', password: 'p' });

  const cookies = await jar.getCookies(`${WEBVPN_ORIGIN}/`);
  assert.ok(cookies.some(c => c.key === WEBVPN_TICKET_COOKIE), 'ticket 必须落进 jar');
});
