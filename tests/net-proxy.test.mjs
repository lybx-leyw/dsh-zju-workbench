/**
 * 网络代理包的形态与行为契约。
 *
 * 这个包最怕的失效是**静默走错出口**：配置读进去了、页面也显示正常，但流量
 * 从错误的代理出去（或者该直连的绕了海外代理 —— 这正是本包要修的那个 bug）。
 * 所以测试的重点不是「函数能跑」，而是**路由判定必须可解释、可预期**：
 *
 *   - 域名匹配的四种写法各自命中什么、不命中什么；
 *   - 规则顺序决定优先级（先命中先用）；
 *   - 坏配置**必须报错**，而不是猜一个默认值继续跑；
 *   - 中继真的按路由表把连接送到对应的出口（用一个假代理实测，不是读代码）。
 *
 * 最后一类是这里最有价值的一条：它用一条真实的 TCP 连接证明「分域」这件事
 * 真的发生了，而不是只在配置层看起来对。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

import { defaults, matchesHost, normalize, resolveRoute, withInheritedDirect, DIRECT, isLoopback } from '../packages/dsh-zhiyun-net-proxy/src/config.js';
import { directHosts } from '../packages/dsh-zhiyun-net-proxy/src/egress.js';

test('设置路由：密码绝不外泄，写操作必须有自定义头，坏配置必须被拒', async () => {
  const { createSettingsHandler } = await import('../packages/dsh-zhiyun-net-proxy/src/settings.js');

  const SECRET = 'SUPER-SECRET-PASSWORD-123';
  const config = normalize({
    enabled: true,
    proxies: [{ id: 'p1', label: 'x', protocol: 'http', host: '127.0.0.1', port: 1, username: 'u', password: SECRET }],
    rules: [{ match: 'a.test', target: 'p1' }],
    fallback: 'direct',
  });
  const status = { file: '/tmp/x', relay: { port: 1, listening: true }, active: true, verified: true, egressVia: 'relay', errors: [] };
  const handler = createSettingsHandler({
    getConfig: () => config,
    // 真实宿主侧走 saveConfig → normalize。测试里必须复现这一步，否则「坏配置是否被拒」
    // 断言的是一个恒真桩函数，等于没测。
    save: async (next) => normalize(next),
    reload: async () => config,
    status: () => ({ ...status }),
  });

  const req = ({ method = 'GET', headers = {}, body } = {}) => {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    return {
      method,
      headers: { host: '127.0.0.1:3092', ...headers },
      async *[Symbol.asyncIterator]() { for (const c of chunks) yield c; },
    };
  };
  const res = () => {
    const out = { code: 0, body: '' };
    return { writeHead(code) { out.code = code; }, end(text) { out.body = text ?? ''; }, get result() { return out; } };
  };
  const write = (body) => req({ method: 'POST', headers: { 'x-zhiyun-net-proxy': '1' }, body });

  // 三条返回路径都必须打码 —— 漏掉任何一条，同源页面就能读走代理凭据。
  for (const [label, request] of [
    ['GET 读配置', req()],
    ['POST save', write({ action: 'save', config })],
    ['POST reload', write({ action: 'reload' })],
  ]) {
    const response = res();
    await handler(request, response);
    assert.equal(response.result.code, 200, label);
    assert.equal(response.result.body.includes(SECRET), false, `${label} 不得回传明文密码`);
    assert.match(response.result.body, /"password":"\*\*\*"/, `${label} 应回传打码值`);
  }

  // CSRF：跨站的简单请求带不了自定义头，因此缺头一律拒绝写。
  const noHeader = res();
  await handler(req({ method: 'POST', body: { action: 'save', config } }), noHeader);
  assert.equal(noHeader.result.code, 403);

  // DNS rebinding：非回环 Host 不得读到凭据。
  const badHost = res();
  await handler(req({ headers: { host: 'evil.example.com' } }), badHost);
  assert.equal(badHost.result.code, 403);

  // 坏配置必须被拒，并把**原因**回传（用户需要知道是哪一条写错了）。
  const bad = res();
  await handler(write({ action: 'save', config: { proxies: [{ id: 'p', host: 'h', port: 'nope' }] } }), bad);
  assert.equal(bad.result.code, 400);
  assert.match(JSON.parse(bad.result.body).error.message, /端口无效/);

  // 打码值回传 = 密码未改动，必须保留原密码（否则用户改个端口就把密码弄丢了）。
  const resaved = res();
  await handler(write({
    action: 'save',
    config: { ...config, proxies: [{ ...config.proxies[0], password: '***', port: 2 }] },
  }), resaved);
  assert.equal(resaved.result.code, 200);
  assert.equal(resaved.result.body.includes(SECRET), false, '保存响应同样不得回传明文');
});

test('继承来的直连域名必须保留：接管不能丢掉「api.deepseek.com 直连」', () => {
  // ⚠️ 这条钉的是真机上踩出来的故障：用户终端里写着
  //    NO_PROXY=api.deepseek.com,localhost,127.0.0.1,::1
  //    （DeepSeek 接口在国内通常可直连，绕道海外代理只会更慢）。
  //    接管时若把它覆盖成「只剩回环」，LLM 流量（选中翻译、问一问）就会落到
  //    默认策略上 —— 默认策略若是不可用的代理，请求会一直挂到超时。真机日志：
  //    tunnel api.deepseek.com: 连接 127.0.0.1:7993 失败：connect ECONNREFUSED
  const env = { NO_PROXY: 'api.deepseek.com,localhost,127.0.0.1,::1' };
  const hosts = directHosts(env);
  assert.ok(hosts.includes('api.deepseek.com'), '用户原有的直连域名必须还在');
  assert.ok(hosts.includes('127.0.0.1'), '回环条目要保留');
  assert.ok(hosts.includes('::1'));
  // 回环是内建的，即使用户一个都没写也要有。
  assert.deepEqual(directHosts({}).sort(), ['::1', '127.0.0.1', 'localhost', '[::1]'].sort());
  // 大小写两种写法都认。
  assert.ok(directHosts({ no_proxy: 'example.com' }).includes('example.com'));
  // 去重：用户写过回环时不该出现两份。
  assert.equal(directHosts({ NO_PROXY: '127.0.0.1,127.0.0.1' }).filter((h) => h === '127.0.0.1').length, 1);

  // 合并进配置后：继承的域名走直连，且**排在用户显式规则之后**（顺序即优先级）。
  const config = normalize({
    enabled: true,
    proxies: [{ id: 'oversea', host: '127.0.0.1', port: 7993 }],
    rules: [{ match: 'zju.edu.cn', target: 'direct' }],
    fallback: 'oversea',
  });
  const merged = withInheritedDirect(config, hosts);
  assert.equal(resolveRoute(merged, 'api.deepseek.com').kind, DIRECT, '继承的域名必须直连，即使默认策略是代理');
  assert.equal(resolveRoute(merged, 'unknown.test').proxy.id, 'oversea', '没被继承命中的仍走默认策略');
  assert.equal(resolveRoute(merged, 'zju.edu.cn').matched, 'zju.edu.cn', '显式规则优先');

  // 用户显式写了 `*` 时，继承条目**不该**把它拆掉：他此刻看得见的意图优先。
  const star = normalize({ enabled: true, proxies: [{ id: 'p', host: 'h', port: 1 }], rules: [{ match: '*', target: 'p' }], fallback: 'direct' });
  const starMerged = withInheritedDirect(star, hosts);
  assert.equal(resolveRoute(starMerged, 'api.deepseek.com').proxy.id, 'p', '显式 * 规则在继承条目之前生效');

  // 已有同名规则时不重复追加。
  const dup = normalize({ enabled: true, proxies: [], rules: [{ match: 'api.deepseek.com', target: 'direct' }], fallback: 'direct' });
  assert.equal(withInheritedDirect(dup, hosts).rules.length, dup.rules.length, '同名规则不该被追加第二遍');
  // 回环不写进规则（策略层与中继都不会把回环送进来，写进去只是噪音）。
  assert.equal(withInheritedDirect(config, ['127.0.0.1', 'localhost']).rules.length, config.rules.length);
});

test('域名匹配：本域、子域、前缀、通配四种写法', () => {
  // 本域 + 全部子域：这是最常用的写法（用户填 zju.edu.cn 就该覆盖所有后端）。
  assert.equal(matchesHost('zju.edu.cn', 'zju.edu.cn'), true);
  assert.equal(matchesHost('yjapi.cmc.zju.edu.cn', 'zju.edu.cn'), true);
  assert.equal(matchesHost('deep.zju.edu.cn', 'zju.edu.cn'), true);
  // 不能误伤后缀相似的别的域 —— 这是「本域匹配」最容易写错的地方：
  // 朴素 endsWith('zju.edu.cn') 会让 evilzju.edu.cn 命中。
  assert.equal(matchesHost('evilzju.edu.cn', 'zju.edu.cn'), false);
  assert.equal(matchesHost('zju.edu.cn.attacker.com', 'zju.edu.cn'), false);

  // 前导点与 *. 前缀等价。
  assert.equal(matchesHost('api.example.com', '.example.com'), true);
  assert.equal(matchesHost('api.example.com', '*.example.com'), true);

  // 以点结尾 = 前缀匹配，对 IP 段友好（等价 Windows 的 192.168.*）。
  assert.equal(matchesHost('192.168.1.10', '192.168.'), true);
  assert.equal(matchesHost('192.169.1.10', '192.168.'), false);

  // 通配与非匹配。
  assert.equal(matchesHost('anything.example', '*'), true);
  assert.equal(matchesHost('example.com', 'other.com'), false);
  // 大小写与结尾点：用户从浏览器复制来的域名常带结尾点。
  assert.equal(matchesHost('API.Example.COM', 'example.com'), true);
  assert.equal(matchesHost('example.com.', 'example.com'), true);
});

test('路由解析：规则顺序决定优先级，先命中先用', () => {
  const config = normalize({
    enabled: true,
    proxies: [
      { id: 'oversea', host: '127.0.0.1', port: 7993 },
      { id: 'campus', host: '127.0.0.1', port: 8080, protocol: 'socks5' },
    ],
    rules: [
      { match: 'zju.edu.cn', target: 'direct' },
      { match: 'github.com', target: 'oversea' },
      { match: 'example.com', target: 'campus' },
    ],
    fallback: 'direct',
  });

  assert.deepEqual(
    { kind: resolveRoute(config, 'yjapi.cmc.zju.edu.cn').kind, matched: resolveRoute(config, 'yjapi.cmc.zju.edu.cn').matched },
    { kind: DIRECT, matched: 'zju.edu.cn' },
  );
  assert.equal(resolveRoute(config, 'github.com').proxy.id, 'oversea');
  assert.equal(resolveRoute(config, 'api.github.com').proxy.id, 'oversea');
  assert.equal(resolveRoute(config, 'example.com').proxy.protocol, 'socks5');
  // 全不命中 → 默认策略。
  assert.equal(resolveRoute(config, 'unknown.test').kind, DIRECT);
  assert.equal(resolveRoute(config, 'unknown.test').matched, null);

  // 顺序敏感：把更宽的规则放前面，它就赢。这条钉的是「先命中先用」这个语义，
  // 而不是某种隐式的具体度排序 —— 后者会让用户无法预测结果。
  const wide = normalize({
    enabled: true,
    proxies: [{ id: 'a', host: '127.0.0.1', port: 1 }],
    rules: [{ match: '*', target: 'a' }, { match: 'zju.edu.cn', target: 'direct' }],
    fallback: 'direct',
  });
  assert.equal(resolveRoute(wide, 'zju.edu.cn').proxy.id, 'a', '宽规则在前就该赢');
});

test('坏配置必须报错，不许猜默认值继续跑', () => {
  const bad = (input, pattern) => assert.throws(() => normalize(input), pattern);

  bad({ proxies: [{ id: 'a', host: 'h', port: 'abc' }] }, /端口无效/);
  bad({ proxies: [{ id: 'a', host: 'h', port: 70000 }] }, /端口无效/);
  bad({ proxies: [{ id: 'a', host: '', port: 1 }] }, /缺少地址/);
  bad({ proxies: [{ id: 'a', host: 'h', port: 1, protocol: 'socks4' }] }, /协议不支持/);
  bad({ proxies: [{ id: 'a', host: 'h', port: 1 }, { id: 'a', host: 'h', port: 2 }] }, /id 重复/);
  // 指向不存在的代理是最危险的一种：看着配好了，实际去向未定义。
  bad({ proxies: [], rules: [{ match: 'x.com', target: 'nope' }] }, /不存在的代理/);
  bad({ proxies: [], fallback: 'nope' }, /不存在的代理/);
  // 规则缺域名。
  bad({ rules: [{ match: '', target: 'direct' }] }, /缺少匹配的域名/);

  // 合法的最小配置。
  assert.deepEqual(normalize({}), defaults());
  assert.equal(normalize({ enabled: true }).enabled, true);
});

test('回环判定：本地服务不该被送进中继', () => {
  for (const host of ['localhost', '127.0.0.1', '127.9.9.9', '::1', '[::1]', '0.0.0.0']) {
    assert.equal(isLoopback(host), true, `${host} 应视为回环`);
  }
  for (const host of ['example.com', '10.0.0.1', '192.168.1.1']) {
    assert.equal(isLoopback(host), false, `${host} 不是回环`);
  }
});

test('中间件协议行为：假代理实测「分域」真的发生', async () => {
  const { createRelay } = await import('../packages/dsh-zhiyun-net-proxy/src/relay.js');

  // 两个假上游代理，各自记下「谁被访问过」——这是判断分流是否真的生效的唯一证据。
  const hits = { alpha: 0, beta: 0 };
  const makeFakeProxy = (label) => net.createServer((socket) => {
    socket.once('data', (chunk) => {
      const line = chunk.toString('latin1').split('\r\n')[0];
      if (/^CONNECT/i.test(line)) {
        hits[label] += 1;
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        socket.end();
      }
    });
    socket.on('error', () => {});
  });

  const alpha = makeFakeProxy('alpha');
  const beta = makeFakeProxy('beta');
  const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const alphaPort = await listen(alpha);
  const betaPort = await listen(beta);

  let config = normalize({
    enabled: true,
    proxies: [
      { id: 'alpha', host: '127.0.0.1', port: alphaPort },
      { id: 'beta', host: '127.0.0.1', port: betaPort },
    ],
    rules: [
      { match: 'alpha.test', target: 'alpha' },
      { match: 'beta.test', target: 'beta' },
    ],
    fallback: 'direct',
  });

  const entries = [];
  const relay = createRelay({ getConfig: () => config, log: (entry) => entries.push(entry) });
  const relayPort = await relay.start();

  /** 从本机向中继发一次 CONNECT，取响应首行。 */
  const viaRelay = (target) => new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: relayPort });
    let buffer = '';
    socket.on('connect', () => socket.write(`CONNECT ${target}:443 HTTP/1.1\r\nHost: ${target}:443\r\n\r\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      if (buffer.includes('\r\n\r\n') || /^HTTP\/1\.1 \d{3}/.test(buffer)) {
        resolve(buffer.split('\r\n')[0]);
        socket.destroy();
      }
    });
    socket.on('error', reject);
    socket.setTimeout(8000, () => { socket.destroy(); reject(new Error('中继响应超时')); });
  });

  try {
    assert.match(await viaRelay('alpha.test'), /200/, 'alpha.test 应经 alpha 出口成功建立隧道');
    assert.match(await viaRelay('beta.test'), /200/, 'beta.test 应经 beta 出口成功建立隧道');
    assert.equal(hits.alpha, 1, 'alpha 假代理应被访问恰好一次');
    assert.equal(hits.beta, 1, 'beta 假代理应被访问恰好一次');

    // 日志必须能解释去向：这是排查「到底从哪个出口出去」的唯一线索。
    const alphaLog = entries.find((entry) => entry.host === 'alpha.test');
    assert.equal(alphaLog.via, 'alpha');
    assert.equal(alphaLog.matched, 'alpha.test');

    // 配置热更后无需重启中继：把 alpha.test 改指 beta，下一次连接就该走 beta。
    config = normalize({
      enabled: true,
      proxies: [
        { id: 'alpha', host: '127.0.0.1', port: alphaPort },
        { id: 'beta', host: '127.0.0.1', port: betaPort },
      ],
      rules: [{ match: 'alpha.test', target: 'beta' }],
      fallback: 'direct',
    });
    assert.match(await viaRelay('alpha.test'), /200/);
    assert.equal(hits.alpha, 1, '改指向后 alpha 不该再被访问');
    assert.equal(hits.beta, 2, 'alpha.test 现在应走 beta');
  } finally {
    relay.stop();
    await new Promise((resolve) => alpha.close(resolve));
    await new Promise((resolve) => beta.close(resolve));
  }
});
