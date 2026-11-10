/**
 * W5–W8：登录协议补全、会话探测与导入、网关二次确认、网络诊断。
 *
 * # 这一组测试要守什么
 *
 * 前四项（W1–W4）是**选路**，错的表现是「慢」或「某站打不开」。
 * 这四项是**登录与诊断**，错的表现是「怎么都登不上」和「说不清哪里坏了」——
 * 后者要靠人反复试，代价高得多。
 *
 * 所以断言分成三组：
 *   1. 密码加密的 key/iv 从登录页来的，且回退路径可用；
 *   2. `NEED_CONFIRM` 会真的再提交一次，并且**留下回调**（踢设备要能追溯）；
 *   3. 会话探测与 ticket 导入的判据，用真实响应形状驱动。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  webvpnPassword, parseWebvpnLoginPage, wrdDecrypt, wrdEncrypt,
  webvpnLogin, probeWebvpnSession, importWebvpnTicket,
  WEBVPN_DO_LOGIN_URL, WEBVPN_CONFIRM_LOGIN_URL, WEBVPN_TICKET_COOKIE,
  doctor, CAMPUS_PROBE_HOST,
} = await import('../packages/source/webvpn/src/index.js');

const WEBVPN_HOST = 'webvpn.zju.edu.cn';
const PASSWORD_FALLBACK_KEY = 'wrdvpnisawesome!';

/**
 * 造一个假装是网关的 transport。
 *
 * `responses` 是 URL → 响应的表；`jar` 用最简实现记录写入的 cookie。
 *
 * @param responses - `{ [url]: (init) => response }` 或静态对象。
 * @returns `{ transport, calls, jarValues }`。
 */
function fakeTransport(responses) {
  const calls = [];
  const jarValues = new Map();
  const transport = {
    session: {
      jar: {
        async getCookies(url) {
          return [...jarValues.entries()]
            .filter(([name]) => name.startsWith(WEBVPN_TICKET_COOKIE) || name === 'route')
            .map(([name, value]) => ({ name, value }));
        },
        async setCookie(cookie) {
          const [pair] = String(cookie).split(';');
          const [name, ...rest] = pair.split('=');
          jarValues.set(name.trim(), rest.join('=').trim());
          return true;
        },
      },
    },
    async request(url, init = {}) {
      calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
      const handler = responses[String(url)];
      if (typeof handler === 'function') return handler(init);
      if (handler) return handler;
      return { status: 404, text: '', isRedirect: false, location: null };
    },
  };
  return { transport, calls, jarValues };
}

/** 一个登录页：带 csrf、captcha_id、以及一对非默认的 key/iv。 */
const LOGIN_PAGE_WITH_KV = `
<html><body>
<form>
<input type="hidden" name="_csrf" value="csrf-abc">
<input type="hidden" name="captcha_id" value="cap-xyz">
<script>encrypt(password.value, "abcdefghijklmnop", "ponmlkjihgfedcba")</script>
</form></body></html>`;

/* ────────────────────────────── W5：动态 key/iv ── */

test('W5：从登录页挖出 _csrf / captcha_id / key / iv', () => {
  const parsed = parseWebvpnLoginPage(LOGIN_PAGE_WITH_KV);
  assert.equal(parsed.csrf, 'csrf-abc');
  assert.equal(parsed.captchaId, 'cap-xyz');
  assert.equal(parsed.key, 'abcdefghijklmnop', '16 位的 key 要挖出来');
  assert.equal(parsed.iv, 'ponmlkjihgfedcba');
});

test('W5：挖不到 key/iv 时返回空串，不抛错（与上游的偏离，故意的）', () => {
  // 上游 `client.ts:103` 是「缺一个就抛 BadResponse」。这里不抛：
  // 页面结构变了不该等价于「完全不能登录」，先试一次内置常量更好。
  const parsed = parseWebvpnLoginPage('<html><input type="hidden" name="_csrf" value="c"></html>');
  assert.equal(parsed.csrf, 'c');
  assert.equal(parsed.key, '');
  assert.equal(parsed.iv, '');
});

test('W5：给了合法 key/iv 就用它们加密，形状是 hex(iv) + 密文', () => {
  const key = 'abcdefghijklmnop';
  const iv = 'ponmlkjihgfedcba';
  const encoded = webvpnPassword('secret', { key, iv });

  assert.ok(encoded.startsWith(Buffer.from(iv, 'utf8').toString('hex')), 'iv 必须前置');
  // key 与 iv 不同时，结果不能等于用兜底钥匙算出来的那个。
  assert.notEqual(encoded, webvpnPassword('secret'));
});

test('W5：key/iv 不合法（长度不为 16）时回退到内置常量', () => {
  const short = webvpnPassword('secret', { key: 'tooshort', iv: 'alsoshort' });
  const fallback = webvpnPassword('secret');
  assert.equal(short, fallback, '长度不对的 key/iv 必须整体回退');
});

test('W5：回退路径的加密结果与历史行为一致（iv = key 时退化）', () => {
  // 历史实现是 wrdEncrypt(PASSWORD_KEY, password)，形状同样是 hex(key)+密文。
  // key 与 iv 相同时，新实现必须给出同一个值 —— 这保证老用户不受影响。
  assert.equal(
    webvpnPassword('secret'),
    wrdEncrypt(PASSWORD_FALLBACK_KEY, 'secret'),
    '回退路径必须与旧实现逐字节一致',
  );
});

test('W5：登录时把登录页里的 key/iv 真的用上（不是只用默认值）', async () => {
  const { transport, calls, jarValues } = fakeTransport({
    'https://webvpn.zju.edu.cn/login': { status: 200, headers: {}, text: LOGIN_PAGE_WITH_KV },
    'https://webvpn.zju.edu.cn/do-login': (init) => {
      // 真实网关登录成功后会在响应里下发 ticket cookie。假 transport 不解析
      // Set-Cookie，所以这里显式写进 jar，模拟「登录成功且会话已建立」。
      jarValues.set(WEBVPN_TICKET_COOKIE, 'ticket-after-login');
      return { status: 200, headers: {}, text: JSON.stringify({ success: true }) };
    },
  });

  await webvpnLogin(transport, { username: 'u', password: 'p' }, {
    onConfirm: () => {},
  });

  const submit = calls.find(c => c.url === WEBVPN_DO_LOGIN_URL);
  assert.ok(submit, '必须提交到 do-login');
  const params = new URLSearchParams(submit.body);
  assert.equal(params.get('_csrf'), 'csrf-abc');
  assert.equal(params.get('captcha_id'), 'cap-xyz');
  // 关键：密码字段用页面的 iv 打头，不是兜底常量。
  assert.ok(
    String(params.get('password')).startsWith(Buffer.from('ponmlkjihgfedcba', 'utf8').toString('hex')),
    '必须用登录页给的 iv（W5 的核心）',
  );
});

/* ────────────────────────────── W6：二次确认 ── */

test('W6：NEED_CONFIRM 会再提交一次 /do-confirm-login，并触发回调', async () => {
  let confirmed = 0;
  let doConfirmHits = 0;
  const { transport, calls, jarValues } = fakeTransport({
    'https://webvpn.zju.edu.cn/login': { status: 200, headers: {}, text: LOGIN_PAGE_WITH_KV },
    'https://webvpn.zju.edu.cn/do-login': { status: 200, headers: {}, text: JSON.stringify({ error: 'NEED_CONFIRM' }) },
    [WEBVPN_CONFIRM_LOGIN_URL]: () => {
      doConfirmHits += 1;
      jarValues.set(WEBVPN_TICKET_COOKIE, 'ticket-after-confirm');
      return { status: 200, headers: {}, text: JSON.stringify({ success: true }) };
    },
  });

  await webvpnLogin(transport, { username: 'u', password: 'p' }, {
    onConfirm: () => { confirmed += 1; },
  });

  assert.equal(doConfirmHits, 1, '必须真的再提交一次');
  assert.equal(confirmed, 1, '踢掉别处设备这件事必须有机会留痕');
  assert.ok(calls.some(c => c.url === WEBVPN_CONFIRM_LOGIN_URL));
});

test('W6：二次确认后仍失败，照实抛错（不吞掉第二次的错误）', async () => {
  const { transport } = fakeTransport({
    'https://webvpn.zju.edu.cn/login': { status: 200, headers: {}, text: LOGIN_PAGE_WITH_KV },
    'https://webvpn.zju.edu.cn/do-login': { status: 200, headers: {}, text: JSON.stringify({ error: 'NEED_CONFIRM' }) },
    [WEBVPN_CONFIRM_LOGIN_URL]: { status: 200, headers: {}, text: JSON.stringify({ error: 'TOO_MANY_ATTEMPTS' }) },
  });

  await assert.rejects(
    () => webvpnLogin(transport, { username: 'u', password: 'p' }, { onConfirm: () => {} }),
    (error) => {
      assert.equal(error.code, 'WEBVPN_BLOCKED');
      return true;
    },
  );
});

test('W6：不传 onConfirm 也能登录（回调是可选的）', async () => {
  const { transport, jarValues } = fakeTransport({
    'https://webvpn.zju.edu.cn/login': { status: 200, headers: {}, text: LOGIN_PAGE_WITH_KV },
    'https://webvpn.zju.edu.cn/do-login': { status: 200, headers: {}, text: JSON.stringify({ error: 'NEED_CONFIRM' }) },
    [WEBVPN_CONFIRM_LOGIN_URL]: () => {
      jarValues.set(WEBVPN_TICKET_COOKIE, 'ticket-after-confirm');
      return { status: 200, headers: {}, text: JSON.stringify({ success: true }) };
    },
  });
  await webvpnLogin(transport, { username: 'u', password: 'p' });
});

/* ────────────────────────────── W7：会话探测与导入 ── */

test('W7：没有 cookie 时会话探测直接 false（不发请求）', async () => {
  const { transport, calls } = fakeTransport({});
  assert.equal(await probeWebvpnSession(transport), false);
  assert.equal(calls.length, 0, '连 cookie 都没有就不该发请求');
});

test('W7：GET / 返回 200 且页面没有 csrf → 会话有效', async () => {
  const { transport } = fakeTransport({
    'https://webvpn.zju.edu.cn/': { status: 200, headers: {}, text: '<html>门户</html>' },
  });
  await transport.session.jar.setCookie(`${WEBVPN_TICKET_COOKIE}=t; Domain=${WEBVPN_HOST}; Path=/`, 'https://webvpn.zju.edu.cn/');
  assert.equal(await probeWebvpnSession(transport), true);
});

test('W7：GET / 返回登录页（含 _csrf）→ 会话已失效', async () => {
  const { transport } = fakeTransport({
    'https://webvpn.zju.edu.cn/': { status: 200, headers: {}, text: '<input name="_csrf" value="x">' },
  });
  await transport.session.jar.setCookie(`${WEBVPN_TICKET_COOKIE}=t; Domain=${WEBVPN_HOST}; Path=/`, 'https://webvpn.zju.edu.cn/');
  assert.equal(await probeWebvpnSession(transport), false);
});

test('W7：3xx 跳去 /login → 失效；跳去别处 → 有效', async () => {
  // ⚠️ 响应形状必须是 Transport 的真实形状 `{ status, headers, text }`。
  // 之前这里用 `isRedirect` / `location` 顶层字段（那是上游 HttpClient 的形状），
  // 假响应「配合」了错误的实现，把缺陷藏住了：真实 Transport 没有那两个字段。
  const toLogin = fakeTransport({
    'https://webvpn.zju.edu.cn/': { status: 302, headers: { location: '/login' }, text: '' },
  });
  await toLogin.transport.session.jar.setCookie(`${WEBVPN_TICKET_COOKIE}=t; Domain=${WEBVPN_HOST}; Path=/`, 'https://webvpn.zju.edu.cn/');
  assert.equal(await probeWebvpnSession(toLogin.transport), false);

  const elsewhere = fakeTransport({
    'https://webvpn.zju.edu.cn/': { status: 302, headers: { location: '/portal' }, text: '' },
  });
  await elsewhere.transport.session.jar.setCookie(`${WEBVPN_TICKET_COOKIE}=t; Domain=${WEBVPN_HOST}; Path=/`, 'https://webvpn.zju.edu.cn/');
  assert.equal(await probeWebvpnSession(elsewhere.transport), true);
});

test('W7：3xx 但响应头里没有 Location → 保守判无效', async () => {
  // 拿不到地址就是「不知道」，不能猜成有效 —— 猜错的代价是带着无效会话去请求业务站。
  const { transport } = fakeTransport({
    'https://webvpn.zju.edu.cn/': { status: 302, headers: {}, text: '' },
  });
  await transport.session.jar.setCookie(`${WEBVPN_TICKET_COOKIE}=t; Domain=${WEBVPN_HOST}; Path=/`, 'https://webvpn.zju.edu.cn/');
  assert.equal(await probeWebvpnSession(transport), false);
});

test('W7：导入 ticket 会写进 jar，并立即回报是否有效', async () => {
  const { transport, jarValues } = fakeTransport({
    'https://webvpn.zju.edu.cn/': { status: 200, headers: {}, text: '<html>门户</html>' },
  });

  const result = await importWebvpnTicket(transport, { ticket: 'TICKET-VALUE', route: 'r1' });

  assert.equal(jarValues.get(WEBVPN_TICKET_COOKIE), 'TICKET-VALUE');
  assert.equal(jarValues.get('route'), 'r1');
  assert.equal(result.imported, true);
  assert.equal(result.valid, true, '导入后要当场验证，不能等下次请求才发现过期');
});

test('W7：导入了但服务端不认（跳登录页）→ valid=false，如实回报', async () => {
  const { transport } = fakeTransport({
    'https://webvpn.zju.edu.cn/': { status: 302, isRedirect: true, location: '/login', text: '' },
  });
  const result = await importWebvpnTicket(transport, { ticket: 'EXPIRED' });
  assert.equal(result.imported, true);
  assert.equal(result.valid, false);
});

test('W7：空 ticket 直接抛错，给出可操作的指引', async () => {
  const { transport } = fakeTransport({});
  await assert.rejects(
    () => importWebvpnTicket(transport, { ticket: '   ' }),
    (error) => {
      assert.equal(error.code, 'WEBVPN_TICKET');
      assert.match(error.message, /wengine_vpn_ticketwebvpn_zju_edu_cn/);
      return true;
    },
  );
});

/* ────────────────────────────── W8：诊断 ── */

test('W8：三项探测并行，报告结构齐全', async () => {
  const urls = [];
  const report = await doctor({
    fetch: async (url) => {
      urls.push(String(url));
      return { status: 200 };
    },
    transport: 'webvpn',
    credentials: { username: 'u', password: 'p' },
  });

  assert.equal(urls.length, 3, '公网 / 校园网 / 网关三样各一次');
  assert.equal(report.transport, 'webvpn');
  assert.equal(report.webvpn.credentials, true);
  assert.equal(report.webvpn.reachable, true);
  assert.equal(typeof report.direct.ms, 'number');
  assert.ok(Array.isArray(report.advice));
});

test('W8：校园网探测必须用只在校内的站，不能用教务网', () => {
  // 这是 D4 裁决的同一发现：zdbk / courses / classroom 实测公网可达，
  // 用它们探测校园网会永远成功，把「校外」误判成「校内」。
  assert.equal(CAMPUS_PROBE_HOST, 'api.cc98.org');
});

test('W8：没有凭据时直说，并给出可操作建议', async () => {
  const report = await doctor({
    fetch: async () => ({ status: 200 }),
    transport: 'webvpn',
    credentials: null,
  });
  assert.equal(report.ok, false, '没有凭据时 webvpn 模式不可能 ok');
  assert.ok(report.advice.some(a => /上网账号/.test(a)));
});

test('W8：网关不可达时建议里点出原因', async () => {
  const report = await doctor({
    fetch: async (url) => {
      if (String(url).includes('webvpn.zju.edu.cn')) throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
      return { status: 200 };
    },
    transport: 'webvpn',
    credentials: { username: 'u', password: 'p' },
  });
  assert.equal(report.webvpn.reachable, false);
  assert.equal(report.webvpn.error, 'ECONNREFUSED');
  assert.ok(report.advice.some(a => /不可达/.test(a)));
});

test('W8：auto 模式下校园网可达就算 ok（不必配网关）', async () => {
  const report = await doctor({
    fetch: async () => ({ status: 200 }),
    transport: 'auto',
    credentials: null,
    probeSession: async () => true,
  });
  assert.equal(report.direct.campus, true);
  assert.equal(report.ok, true, '在校内时不需要网关凭据');
});

test('W8：凭据由调用方传入，doctor 自己不读（tier 0 约束）', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../packages/source/webvpn/src/doctor.js', import.meta.url), 'utf8');
  // doctor 不许 import 业务包（那会让 tier 0 依赖 tier 1）。
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    assert.ok(
      specifier.startsWith('./') || specifier.startsWith('node:'),
      `doctor.js 不得依赖外部包，发现 ${specifier}`,
    );
  }
});
