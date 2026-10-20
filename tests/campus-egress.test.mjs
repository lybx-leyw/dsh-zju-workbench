/**
 * 出口策略（`dsh-zhiyun-campus/src/egress.js`）与 WebVPN 协议层。
 *
 * 这些断言全部来自**真机实测**，不是"看起来合理"：
 *
 *   - 校园域名交给本机代理会 ECONNRESET，直连 0.1 秒 200 —— 所以本包自己管出口；
 *   - 逐请求 `dispatcher` 能真的绕开全局 dispatcher（全局指到死端口时仍 200）；
 *   - `auto` 模式下探不到网络时先试直连，失败才升级到 WebVPN。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isCampusHost, isPintiaHost, needsCampusNetwork, interpretCampusProbe,
  createEgress, MODES, CAMPUS_PROBE_URL,
} from '../packages/dsh-zhiyun-campus/src/egress.js';
import {
  toWebvpnUrl, fromWebvpnUrl, isWebvpnLoginUrl, wrdEncrypt, wrdDecrypt,
  parseWebvpnLoginPage, describeWebvpnFailure, WEBVPN_ORIGIN,
} from '../packages/dsh-zhiyun-campus/src/webvpn/protocol.js';

/* ────────────────────────────────────── 域名分域 */

test('校园域名判定必须要求点边界，evilzju.edu.cn 不能算校园站点', () => {
  // 朴素 endsWith('zju.edu.cn') 会让 evilzju.edu.cn 命中 ——
  // 那等于把任意域名当成校园站点去发 cookie。
  assert.equal(isCampusHost('zju.edu.cn'), true);
  assert.equal(isCampusHost('courses.zju.edu.cn'), true);
  assert.equal(isCampusHost('zjuam.zju.edu.cn'), true);
  assert.equal(isCampusHost('deep.yjapi.cmc.zju.edu.cn'), true);

  assert.equal(isCampusHost('evilzju.edu.cn'), false);
  assert.equal(isCampusHost('zju.edu.cn.attacker.com'), false);
  assert.equal(isCampusHost('zjuedu.cn'), false);
  assert.equal(isCampusHost(''), false);
  assert.equal(isCampusHost(null), false);

  // 大小写与末尾的点都要归一化
  assert.equal(isCampusHost('COURSES.ZJU.EDU.CN'), true);
  assert.equal(isCampusHost('courses.zju.edu.cn.'), true);
});

test('拼题A 走公网，不该被当成校园站点', () => {
  assert.equal(isPintiaHost('pintia.cn'), true);
  assert.equal(isPintiaHost('passport.pintia.cn'), true);
  assert.equal(isPintiaHost('evilpintia.cn'), false);

  // 它是"公开可达"的，所以 needsCampusNetwork 必须说不需要
  assert.equal(needsCampusNetwork('pintia.cn'), false);
  assert.equal(needsCampusNetwork('passport.pintia.cn'), false);
});

test('WebVPN 网关自己不算"需要校园网" —— 否则会无限套网关', () => {
  assert.equal(needsCampusNetwork('webvpn.zju.edu.cn'), false);
  assert.equal(needsCampusNetwork('courses.zju.edu.cn'), true);
  assert.equal(needsCampusNetwork('zjuam.zju.edu.cn'), true);
});

test('校园网探测的返回值只认 1 / 2', () => {
  assert.equal(interpretCampusProbe('1'), true);
  assert.equal(interpretCampusProbe(' 2 '), true);
  // 真机在校内拿到的是 "1"（带尾随空白）
  assert.equal(interpretCampusProbe('1\n'), true);

  assert.equal(interpretCampusProbe('0'), false);
  assert.equal(interpretCampusProbe(''), false);
  assert.equal(interpretCampusProbe('true'), false);
  assert.equal(interpretCampusProbe(null), false);
});

/* ────────────────────────────────────── WebVPN 地址编码 */

test('WebVPN 地址编码可往返，且前缀是 key 的 hex', () => {
  const key = 'wrdvpnisthebest!';
  const encoded = wrdEncrypt(key, 'courses.zju.edu.cn');

  // 前缀必须是 key 的 ascii hex（网关靠它识别版本）
  assert.ok(encoded.startsWith(Buffer.from(key, 'ascii').toString('hex')));
  assert.equal(wrdDecrypt(key, encoded), 'courses.zju.edu.cn');
});

test('逻辑地址 → 网关地址：路径与查询串必须原样保留', () => {
  const physical = toWebvpnUrl(new URL('https://courses.zju.edu.cn/api/my-semesters?fields=id,name'));

  assert.equal(physical.origin, WEBVPN_ORIGIN);
  assert.ok(physical.pathname.startsWith('/https/'));
  assert.equal(physical.search, '?fields=id,name', '查询串里的逗号与等号不能被改写');

  // 往返回到逻辑地址
  const logical = fromWebvpnUrl(physical);
  assert.equal(logical.href, 'https://courses.zju.edu.cn/api/my-semesters?fields=id,name');
});

test('带端口的地址要写成 https-8443 这种 scheme 段', () => {
  const physical = toWebvpnUrl(new URL('https://courses.zju.edu.cn:8443/api/x'));
  assert.ok(physical.pathname.startsWith('/https-8443/'));
  assert.equal(fromWebvpnUrl(physical).href, 'https://courses.zju.edu.cn:8443/api/x');
});

test('网关自己的地址不被二次改写（否则是网关的网关）', () => {
  const login = new URL(`${WEBVPN_ORIGIN}/login`);
  assert.equal(toWebvpnUrl(login).href, login.href);
});

test('非 HTTP(S) 一律拒绝转发', () => {
  assert.throws(() => toWebvpnUrl(new URL('ftp://courses.zju.edu.cn/x')), { code: 'WEBVPN_URL' });
  assert.throws(() => toWebvpnUrl(new URL('ws://courses.zju.edu.cn/x')), { code: 'WEBVPN_URL' });
});

test('坏掉的网关地址要抛错，不能静默当成根路径', () => {
  assert.throws(() => wrdDecrypt('wrdvpnisthebest!', 'not-the-right-prefix'), { code: 'WEBVPN_URL' });
  assert.throws(() => wrdDecrypt('wrdvpnisthebest!', '77726476706e69737468656265737421zz'), { code: 'WEBVPN_URL' });
});

test('被踢回网关登录页要能被认出来 —— 这是网关会话过期的唯一可靠信号', () => {
  assert.equal(isWebvpnLoginUrl(new URL(`${WEBVPN_ORIGIN}/login`)), true);
  assert.equal(isWebvpnLoginUrl(new URL(`${WEBVPN_ORIGIN}/do-login`)), true);
  assert.equal(isWebvpnLoginUrl(new URL(`${WEBVPN_ORIGIN}/portal/1`)), true);

  // 业务页面不是登录页
  assert.equal(isWebvpnLoginUrl(new URL(`${WEBVPN_ORIGIN}/https/abc/api/x`)), false);
  // 别的域名更不是
  assert.equal(isWebvpnLoginUrl(new URL('https://courses.zju.edu.cn/login')), false);
});

/* ────────────────────────────────────── 登录页解析 */

test('登录页解析按 name 精确取字段', () => {
  // 真机登录页的字段（截取相关部分）
  const html = `<form>
    <input type="hidden" name="_csrf" value="CSRF-TOKEN">
    <input name="username" value="">
    <input name="password" type="password">
    <input type="hidden" name="captcha_id" value="CAP-1">
    <input name="captcha">
  </form>`;
  const parsed = parseWebvpnLoginPage(html);
  assert.equal(parsed.csrf, 'CSRF-TOKEN');
  assert.equal(parsed.captchaId, 'CAP-1');
});

test('登录页解析不能被相似字段名骗到', () => {
  // `captcha_id` 与 `captcha` 都在，取到的必须是前者；`_csrf` 不能被 `xcsrf` 命中
  const html = `<input name="xcsrf" value="WRONG">
    <input name="captcha" value="WRONG-TOO">
    <input name="captcha_id" value="RIGHT-CAPTCHA">
    <input name="_csrf" value="RIGHT-CSRF">`;
  const parsed = parseWebvpnLoginPage(html);
  assert.equal(parsed.csrf, 'RIGHT-CSRF');
  assert.equal(parsed.captchaId, 'RIGHT-CAPTCHA');
});

test('没有字段时回空串，不抛错', () => {
  assert.deepEqual(parseWebvpnLoginPage('<html></html>'), { csrf: '', captchaId: '' });
  assert.deepEqual(parseWebvpnLoginPage(null), { csrf: '', captchaId: '' });
});

/* ────────────────────────────────────── 登录失败的归因 */

test('WebVPN 的失败归因：每一种都说清下一步，且不混成"密码错"', () => {
  // 已在别处登录 —— 不是密码错，而是要去那边退出
  const confirm = describeWebvpnFailure('NEED_CONFIRM');
  assert.equal(confirm.code, 'WEBVPN_CONFIRM_REQUIRED');
  assert.match(confirm.message, /别的设备|其他设备/);
  assert.doesNotMatch(confirm.message, /密码.*(不对|错)/);

  // 验证码 —— 脚本过不去，要去浏览器
  for (const code of ['CAPTCHA_FAILED', 'NEED_CAPTCHA', 'NEED_TWO_STEP_SMS', 'WECHAT_BINDING']) {
    const failure = describeWebvpnFailure(code);
    assert.equal(failure.code, 'WEBVPN_CHALLENGE_REQUIRED', code);
    assert.match(failure.message, /浏览器/, code);
  }

  // 被限流 / IP 受限 / 弱密码 —— 都不是"密码错"
  for (const code of ['TOO_MANY_ATTEMPTS', 'IP_FORBIDDEN', 'WEEK_PASSWORD_FORBID']) {
    assert.equal(describeWebvpnFailure(code).code, 'WEBVPN_BLOCKED', code);
  }

  // 兜底必须点明"上网账号 ≠ 统一认证"
  const unknown = describeWebvpnFailure('WHATEVER');
  assert.equal(unknown.code, 'WEBVPN_REJECTED');
  assert.match(unknown.message, /上网账号/);
  assert.match(unknown.message, /两套系统/);
});

/* ────────────────────────────────────── 出口策略（注入假 undici） */

/** 造一个假的 undici：记录每次请求的 URL 与 dispatcher。 */
function fakeUndici(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const target = String(url);
    calls.push({ url: target, dispatcher: init?.dispatcher ?? null, init });
    for (const [match, reply] of routes) {
      if (target.includes(match)) return reply(target, init);
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return {
    calls,
    module: { Agent: class { async close() {} }, fetch: fetchImpl },
  };
}

test('direct 模式下任何域名都直连，且每个请求都带上自己的 dispatcher', async () => {
  const fake = fakeUndici([['*', () => new Response('ok', { status: 200 })]]);
  const egress = createEgress({ mode: 'direct', undici: fake.module });

  await egress.fetch('https://courses.zju.edu.cn/api/x');
  await egress.fetch('https://pintia.cn/api/y');

  assert.equal(fake.calls.length, 2);
  for (const call of fake.calls) {
    assert.ok(call.dispatcher, '每个请求都要显式带 dispatcher，否则会落到全局代理上');
    assert.ok(call.url.startsWith('https://courses') || call.url.startsWith('https://pintia'), 'direct 模式不该改写地址');
  }
});

test('webvpn 模式：校园域名改写，公开站点不动', async () => {
  const fake = fakeUndici([['*', () => new Response('ok', { status: 200 })]]);
  const egress = createEgress({ mode: 'webvpn', undici: fake.module });

  await egress.fetch('https://courses.zju.edu.cn/api/x');
  await egress.fetch('https://pintia.cn/api/y');

  assert.ok(fake.calls[0].url.startsWith(WEBVPN_ORIGIN), '校园域名要走网关');
  assert.ok(fake.calls[0].url.includes('/https/'), '要被改写成网关编码路径');
  assert.equal(fake.calls[1].url, 'https://pintia.cn/api/y', '拼题A 走公网，不该绕网关');
});

test('auto 模式：探到在校园网内 → 直连，且只探一次', async () => {
  let probes = 0;
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => { probes += 1; return new Response('1', { status: 200 }); }],
    ['*', () => new Response('ok', { status: 200 })],
  ]);
  const egress = createEgress({ mode: 'auto', undici: fake.module });

  await egress.fetch('https://courses.zju.edu.cn/api/a');
  await egress.fetch('https://courses.zju.edu.cn/api/b');

  assert.equal(probes, 1, '探测结果要缓存：每次请求都探一遍会把延迟翻倍');
  assert.equal(fake.calls.filter((c) => !c.url.includes(CAMPUS_PROBE_URL)).length, 2);
  for (const call of fake.calls) {
    assert.equal(call.url.includes(WEBVPN_ORIGIN), false, '在校园网内就该直连');
  }
});

test('auto 模式：探到在校外但业务站点可直连 → 保持直连', async () => {
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => new Response('0', { status: 200 })],
    ['*', () => new Response('ok', { status: 200 })],
  ]);
  const egress = createEgress({ mode: 'auto', undici: fake.module });

  await egress.fetch('https://courses.zju.edu.cn/api/a');

  const apiCall = fake.calls.find((c) => !c.url.includes(CAMPUS_PROBE_URL));
  assert.ok(apiCall.url.startsWith('https://courses.zju.edu.cn/'), '校园探测不能否定业务站点的直连能力');
});

test('auto 模式：探不到网络时先试直连，直连失败才升级', async () => {
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => { throw Object.assign(new Error('probe down'), { code: 'ECONNREFUSED' }); }],
    [WEBVPN_ORIGIN, () => new Response('via-webvpn', { status: 200 })],
    ['courses.zju.edu.cn', () => { throw Object.assign(new Error('direct down'), { code: 'ECONNRESET' }); }],
  ]);
  const egress = createEgress({ mode: 'auto', undici: fake.module });

  const response = await egress.fetch('https://courses.zju.edu.cn/api/a');
  assert.equal(await response.text(), 'via-webvpn', '直连失败后要升级到 WebVPN');

  // 顺序必须是「先直连、再网关」—— 校园网里直连永远是对的
  const order = fake.calls.map((c) => c.url);
  assert.ok(order[1].startsWith('https://courses.zju.edu.cn'));
  assert.ok(order[2].startsWith(WEBVPN_ORIGIN));
});

test('auto 模式：已确认在校园网内时直连失败不升级', async () => {
  // 这一点很要紧：在校园网里直连失败，说明是站点或自身的问题，
  // 这时把人赶去配一个根本用不到的网关账号，比如实报错更糟。
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => new Response('1', { status: 200 })],
    ['courses.zju.edu.cn', () => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); }],
    [WEBVPN_ORIGIN, () => new Response('via-webvpn', { status: 200 })],
  ]);
  const egress = createEgress({ mode: 'auto', undici: fake.module });

  await assert.rejects(() => egress.fetch('https://courses.zju.edu.cn/api/a'), { code: 'ECONNRESET' });
  assert.equal(
    fake.calls.some((c) => c.url.startsWith(WEBVPN_ORIGIN)), false,
    '在校园网内不该因为直连失败就去配 WebVPN',
  );
});

test('升级也失败时抛最初那个错误，而不是升级后的错误', async () => {
  // 原始错误更接近"到底怎么了"；升级只是我们的一次尝试，不该覆盖证据。
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => { throw Object.assign(new Error('probe down'), { code: 'ECONNREFUSED' }); }],
    ['courses.zju.edu.cn', () => { throw Object.assign(new Error('direct down'), { code: 'ECONNRESET' }); }],
    [WEBVPN_ORIGIN, () => { throw Object.assign(new Error('gateway down'), { code: 'WEBVPN_DOWN' }); }],
  ]);
  const egress = createEgress({ mode: 'auto', undici: fake.module });

  await assert.rejects(() => egress.fetch('https://courses.zju.edu.cn/api/a'), { code: 'ECONNRESET' });
});

test('auto 模式：直连拿到 4xx 不重试 —— 那是业务答复，不是网络故障', async () => {
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); }],
    ['courses.zju.edu.cn', () => new Response('nope', { status: 401 })],
    [WEBVPN_ORIGIN, () => new Response('via-webvpn', { status: 200 })],
  ]);
  const egress = createEgress({ mode: 'auto', undici: fake.module });

  const response = await egress.fetch('https://courses.zju.edu.cn/api/a');
  assert.equal(response.status, 401);
  assert.equal(fake.calls.some((c) => c.url.startsWith(WEBVPN_ORIGIN)), false, '401 不该触发升级');
});

test('显式 direct 模式不升级 —— 用户说直连就是直连', async () => {
  const fake = fakeUndici([
    ['courses.zju.edu.cn', () => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); }],
    [WEBVPN_ORIGIN, () => new Response('via-webvpn', { status: 200 })],
  ]);
  const egress = createEgress({ mode: 'direct', undici: fake.module });

  await assert.rejects(() => egress.fetch('https://courses.zju.edu.cn/api/a'), { code: 'ECONNRESET' });
  assert.equal(fake.calls.some((c) => c.url.startsWith(WEBVPN_ORIGIN)), false);
});

test('没有 undici 时降级到 globalThis.fetch，并且状态如实标注 degraded', async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response('ok', { status: 200 }); };
  try {
    const egress = createEgress({ mode: 'direct', undici: null });
    await egress.fetch('https://courses.zju.edu.cn/api/a');
    assert.equal(seen.length, 1);
    assert.equal(egress.state().degraded, true, '必须如实标注降级，不能让调用方以为已经分域了');
  } finally {
    globalThis.fetch = original;
  }
});

test('出口模式的取值必须是白名单里的', () => {
  assert.deepEqual(MODES, ['auto', 'direct', 'webvpn']);
  assert.throws(() => createEgress({ mode: 'turbo' }), { code: 'EGRESS' });
});

test('物理地址转回逻辑地址：网关地址能还原，别的原样返回', () => {
  const egress = createEgress({ mode: 'direct', undici: null });
  const physical = toWebvpnUrl(new URL('https://courses.zju.edu.cn/api/x?a=1'));
  assert.equal(egress.toLogical(physical).href, 'https://courses.zju.edu.cn/api/x?a=1');
  assert.equal(egress.toLogical('https://pintia.cn/x').href, 'https://pintia.cn/x');
  assert.equal(egress.toLogical(null), null);
});

test('auto never replays a password POST after an ambiguous network failure', async () => {
 const fake=fakeUndici([
  [CAMPUS_PROBE_URL,()=>new Response('0')],
  ['courses.zju.edu.cn',()=>{throw Object.assign(new Error('lost'),{code:'ECONNRESET'});}]
 ]);
 const egress=createEgress({mode:'auto',undici:fake.module});
 await assert.rejects(egress.fetch('https://courses.zju.edu.cn/login',{method:'POST',body:'fake'}),{code:'ECONNRESET'});
 assert.equal(fake.calls.filter(c=>!c.url.includes(CAMPUS_PROBE_URL)).length,1);
 assert.equal(fake.calls.some(c=>c.url.startsWith(WEBVPN_ORIGIN)),false);
});
