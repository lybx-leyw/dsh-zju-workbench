/**
 * `src/probe.js` 与 `src/reach.js` 的守卫。
 *
 * # 这两个模块为什么必须被测住
 *
 * 它们判的是**网络事实**，判错的后果不是崩，是「校外用户被绕道」或
 * 「只给校内看的站被判成公网可达」。而且它们默认要联网 —— 一旦只能靠联网
 * 验证，就永远不会被跑。所以这里的每一条都注入替身：
 *
 *   - DoH 解析走假 fetch；
 *   - 直连探测走假 probe；
 *   - 网卡表由参数传入；
 *   - 时间由 `now()` 传入（测 TTL）。
 *
 * 只有真正不能替身的东西（`probeByAddress` 建连）才不测成功路径，
 * 而是测**它拿到的参数对不对**（Host / SNI / 忽略证书）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOH_RESOLVERS,
  PROBE_TIMEOUT_MS,
  isPrivateAddress,
  probeHost,
  probeWithRedirects,
  resolvePublic,
  tunInterfaces,
} from '../../../packages/source/webvpn/src/probe.js';

import {
  REACH_HINTS,
  REACH_TTL_MS,
  checkReachable,
  probeReach,
  requireReachable,
} from '../../../packages/source/webvpn/src/reach.js';

/* ────────────────────────────── probe：纯函数 ── */

test('私网段判定覆盖 RFC1918 与保留段', () => {
  for (const ip of ['10.203.16.55', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '100.64.0.1']) {
    assert.equal(isPrivateAddress(ip), true, `${ip} 应判私网`);
  }
  for (const ip of ['203.0.113.9', '8.8.8.8', '172.32.0.1', '100.128.0.1']) {
    assert.equal(isPrivateAddress(ip), false, `${ip} 应判公网`);
  }
  // 边界：172.15 与 172.32 都不在私网段里。差一位就漏判，是这类正则最容易错的地方。
  assert.equal(isPrivateAddress('172.15.0.1'), false);
  assert.equal(isPrivateAddress('172.32.0.1'), false);
});

test('TUN 接口能识别各家代理软件，普通网卡不误报', () => {
  assert.deepEqual(
    tunInterfaces({ Clash: [{}], WLAN: [{}], 'Tailscale': [{}], Ethernet: [{}] }),
    ['Clash', 'Tailscale'],
  );
  assert.deepEqual(tunInterfaces({ WLAN: [{}], Ethernet: [{}], lo: [{}] }), []);
  assert.deepEqual(tunInterfaces({}), []);
});

/* ────────────────────────────── probe：DoH ── */

test('DoH 问第一个能答的解析器，拿 A 记录', async () => {
  const asked = [];
  const result = await resolvePublic('zdbk.zju.edu.cn', {
    fetch: async (url) => {
      asked.push(String(url));
      return {
        json: async () => ({
          Answer: [
            { type: 5, data: 'cname' },
            { type: 1, data: '203.0.113.7' },
          ],
        }),
      };
    },
  });
  assert.equal(result.resolver, 'alidns');
  assert.deepEqual(result.addresses, ['203.0.113.7'], '只取 A 记录，丢掉 CNAME');
  assert.equal(asked.length, 1, '第一个解析器答出来就不问第二个');
});

test('第一个解析器挂掉时换下一个；全挂返回 none 而不抛错', async () => {
  const seen = [];
  const second = await resolvePublic('x.zju.edu.cn', {
    fetch: async (url) => {
      seen.push(String(url).includes('223.5.5.5') ? 'ali' : 'dnspod');
      if (String(url).includes('223.5.5.5')) throw new Error('timeout');
      return { json: async () => ({ Answer: [{ type: 1, data: '203.0.113.8' }] }) };
    },
  });
  assert.equal(second.resolver, 'dnspod');
  assert.deepEqual(seen, ['ali', 'dnspod']);

  const none = await resolvePublic('only-internal.zju.edu.cn', {
    fetch: async () => ({ json: async () => ({ Answer: [] }) }),
  });
  assert.equal(none.resolver, 'none');
  assert.deepEqual(none.addresses, [], '没有 A 记录不该抛错 —— 那本身就是结论');
});

test('两个解析器的地址都是 IP 直连，不是域名', () => {
  // 走 DoH 的意义就在于绕开本机 DNS 与 hosts 改写。写域名就白做了。
  for (const resolver of DOH_RESOLVERS) {
    const url = new URL(resolver.url('example.com'));
    assert.match(url.hostname, /^\d+\.\d+\.\d+\.\d+$/, `${resolver.name} 必须用 IP 直连`);
  }
});

/* ────────────────────────────── probe：跳转 ── */

test('跳转链：同站跟到底，跨站即停', async () => {
  const calls = [];
  const script = [
    { status: 302, location: '/a' },
    { status: 200 },
  ];
  const send = async (host, ip, options) => {
    calls.push(options.path);
    return script.shift();
  };

  const same = await probeWithRedirects('zdbk.zju.edu.cn', '203.0.113.7', { send });
  assert.equal(same.status, 200);
  assert.equal(same.final, 'https://zdbk.zju.edu.cn/a');
  assert.deepEqual(calls, ['/', '/a']);

  // 跨站：第一跳就跳去 CAS，立刻停。
  calls.length = 0;
  script.push({ status: 302, location: 'https://zjuam.zju.edu.cn/cas/login?service=x' });
  const cross = await probeWithRedirects('itc.zju.edu.cn', '203.0.113.9', { send });
  assert.equal(cross.final, 'https://zjuam.zju.edu.cn/cas/login?service=x');
  assert.deepEqual(calls, ['/'], '跨站之后不再请求');
});

test('跳转次数有上限，绕圈不会无限跟', async () => {
  let calls = 0;
  const send = async () => {
    calls += 1;
    return { status: 302, location: '/loop' };
  };
  const result = await probeWithRedirects('loop.zju.edu.cn', '203.0.113.7', { send, maxRedirects: 3 });
  assert.equal(calls, 4, 'hop 从 0 到 3，共 4 次');
  assert.equal(result.status, 0, '跟不完就不给状态码 —— 别假装通了');
});

/* ────────────────────────────── probe：整份报告 ── */

test('公网可达 → public；私网 → campus 且说明原因', async () => {
  const publicReport = await probeHost('zdbk.zju.edu.cn', {
    fetch: async () => ({ json: async () => ({ Answer: [{ type: 1, data: '203.0.113.7' }] }) }),
    probe: async () => ({ status: 200, final: 'https://zdbk.zju.edu.cn/' }),
    interfaces: {},
  });
  assert.equal(publicReport.suggested.network, 'public');
  assert.equal(publicReport.privateAddress, false);
  assert.equal(publicReport.direct.reachable, true);

  const privateReport = await probeHost('10.203.16.55', {
    fetch: async () => ({ json: async () => ({ Answer: [{ type: 1, data: '10.203.16.55' }] }) }),
    interfaces: {},
  });
  assert.equal(privateReport.suggested.network, 'campus');
  assert.equal(privateReport.privateAddress, true);
  assert.match(privateReport.direct.error, /私网/);
});

test('停在统一身份认证 → public + cas，并带出 service', async () => {
  const report = await probeHost('itc.zju.edu.cn', {
    fetch: async () => ({ json: async () => ({ Answer: [{ type: 1, data: '203.0.113.9' }] }) }),
    probe: async () => ({
      status: 302,
      final: 'https://zjuam.zju.edu.cn/cas/login?service=https%3A%2F%2Fitc.zju.edu.cn%2F',
    }),
    interfaces: {},
  });
  assert.equal(report.suggested.network, 'public');
  assert.equal(report.suggested.auth, 'cas');
  assert.equal(report.suggested.casService, 'https://itc.zju.edu.cn/');
});

test('被挡到「无权访问」页时判 campus —— 状态码是 200 也照样判', async () => {
  // 这是最容易漏的一条：网站群对校外读者返回 200 + nopermit_zjusub.jsp，
  // 只看状态码会把它判成「公网可达」。
  const report = await probeHost('office.cas.zju.edu.cn', {
    fetch: async () => ({ json: async () => ({ Answer: [{ type: 1, data: '203.0.113.10' }] }) }),
    probe: async () => ({
      status: 200,
      final: 'https://office.cas.zju.edu.cn/nopermit_zjusub.jsp?parentUrl=x',
    }),
    interfaces: {},
  });
  assert.equal(report.suggested.network, 'campus');
  assert.equal(report.direct.reachable, false);
  assert.match(report.direct.error, /无权访问/);
});

test('连不上判 campus；5xx 也算「够不着」', async () => {
  const report = await probeHost('unknown.zju.edu.cn', {
    fetch: async () => ({ json: async () => ({ Answer: [{ type: 1, data: '203.0.113.11' }] }) }),
    probe: async () => {
      throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    },
    interfaces: {},
  });
  assert.equal(report.suggested.network, 'campus');
  assert.equal(report.direct.error, 'ECONNREFUSED');

  const serverError = await probeHost('broken.zju.edu.cn', {
    fetch: async () => ({ json: async () => ({ Answer: [{ type: 1, data: '203.0.113.12' }] }) }),
    probe: async () => ({ status: 503, final: 'https://broken.zju.edu.cn/' }),
    interfaces: {},
  });
  assert.equal(serverError.suggested.network, 'campus', '5xx 不能算「公网可达」');
});

test('本机有 TUN 时在 caveats 里明说结果不可信', async () => {
  const report = await probeHost('zdbk.zju.edu.cn', {
    fetch: async () => ({ json: async () => ({ Answer: [{ type: 1, data: '203.0.113.7' }] }) }),
    probe: async () => ({ status: 200, final: 'https://zdbk.zju.edu.cn/' }),
    interfaces: { Clash: [{}], WLAN: [{}] },
  });
  assert.ok(
    report.caveats.some((note) => /隧道接口/.test(note) && /不可信/.test(note)),
    '有 TUN 而不警告，等于把可疑结论当结论',
  );
});

test('无 casRedirect 时明确说 auth 需人工确认', async () => {
  const report = await probeHost('zdbk.zju.edu.cn', {
    fetch: async () => ({ json: async () => ({ Answer: [{ type: 1, data: '203.0.113.7' }] }) }),
    probe: async () => ({ status: 200, final: 'https://zdbk.zju.edu.cn/' }),
    interfaces: {},
  });
  assert.equal(report.suggested.auth, 'unknown');
  assert.ok(report.caveats.some((note) => /人工确认/.test(note)));
});

test('给出 via 时用外部主机实测，不再本机探测', async () => {
  let localCalled = false;
  const report = await probeHost('cc98.org', {
    via: 'my-server',
    fetch: async () => ({ json: async () => ({ Answer: [] }) }),
    probe: async () => {
      localCalled = true;
      return { status: 200, final: 'https://cc98.org/' };
    },
    viaRunner: async (host, target) => {
      assert.equal(host, 'cc98.org');
      assert.equal(target, 'my-server');
      return { ip: '203.0.113.20', status: 200 };
    },
    interfaces: { Clash: [{}] },
  });
  assert.equal(localCalled, false, '有 via 就不该本机探测 —— 本机结论本来就不信');
  assert.equal(report.via, 'my-server');
  assert.equal(report.suggested.network, 'public');
});

test('探测轮次：主机名不合法就拒，不拼进 shell', async () => {
  for (const bad of ['', 'a b', 'host;rm -rf /', 'https://x/', 'host\nother']) {
    await assert.rejects(() => probeHost(bad), /主机名/);
  }
});

/* ────────────────────────────── reach ── */

test('checkReachable：通的就是通，不过的带错误码', async () => {
  const results = await checkReachable(['ok.example', 'down.example'], {
    fetch: async (url) => {
      if (String(url).includes('down')) throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' });
      return { status: 200 };
    },
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].host, 'ok.example');
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error, 'ENOTFOUND');
});

test('checkReachable：结果顺序与入参一致', async () => {
  // 并发探测的完成顺序是随机的。返回顺序必须稳定，否则调用方按位置取值会错位。
  const results = await checkReachable(['c.example', 'a.example', 'b.example'], {
    fetch: async (url) => {
      const name = String(url).split('//')[1].replace('/', '');
      // 故意让后面的先返回
      await new Promise((resolve) => setTimeout(resolve, name === 'c.example' ? 20 : 1));
      return { status: 200 };
    },
  });
  assert.deepEqual(results.map((r) => r.host), ['c.example', 'a.example', 'b.example']);
});

test('缓存命中不再发请求；fresh 强制重探', async () => {
  const memory = new Map();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { status: 200 }; };

  await checkReachable(['a.example'], { fetch: fetchImpl, memory });
  assert.equal(calls, 1);

  const cached = await checkReachable(['a.example'], { fetch: fetchImpl, memory });
  assert.equal(calls, 1, 'TTL 内不该再探');
  assert.equal(cached[0].cached, true);

  await checkReachable(['a.example'], { fetch: fetchImpl, memory, fresh: true });
  assert.equal(calls, 2, 'fresh 必须绕过缓存');
});

test('TTL 过期后重探', async () => {
  const memory = new Map();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { status: 200 }; };
  let clock = 1_000_000;

  await checkReachable(['a.example'], { fetch: fetchImpl, memory, now: () => clock });
  assert.equal(calls, 1);

  clock += REACH_TTL_MS - 1;
  await checkReachable(['a.example'], { fetch: fetchImpl, memory, now: () => clock });
  assert.equal(calls, 1, '还差 1 毫秒到期，仍该命中');

  clock += 2;
  await checkReachable(['a.example'], { fetch: fetchImpl, memory, now: () => clock });
  assert.equal(calls, 2, '过了 TTL 就该重探');
});

test('只缓存成功：失败过一次，下次仍然重试', async () => {
  // 一次瞬断被缓存 10 分钟，等于让用户在一次抖动后持续看到「不可达」。
  const memory = new Map();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; throw new Error('blip'); };
  await checkReachable(['a.example'], { fetch: fetchImpl, memory });
  await checkReachable(['a.example'], { fetch: fetchImpl, memory });
  assert.equal(calls, 2);
});

test('requireReachable：全通正常返回，有不通就抛 TRANSPORT 且带 hosts', async () => {
  const ok = await requireReachable(['a.example'], { fetch: async () => ({ status: 200 }) });
  assert.equal(ok.length, 1);

  await assert.rejects(
    () => requireReachable(['webvpn.zju.edu.cn'], {
      fetch: async () => { throw Object.assign(new Error('x'), { code: 'ETIMEDOUT' }); },
    }),
    (error) => {
      assert.equal(error.code, 'TRANSPORT');
      assert.deepEqual(error.details.hosts, ['webvpn.zju.edu.cn']);
      assert.match(error.message, /WebVPN 入口不通/, '已知主机要给出可行动的解释');
      return true;
    },
  );
});

test('已知主机的解释都是「能改变下一步」的话', () => {
  for (const [host, hint] of Object.entries(REACH_HINTS)) {
    assert.ok(hint.length > 8, `${host} 的解释太短，等于没说`);
    assert.ok(!/^不可达$/.test(hint), `${host} 只写了「不可达」，没给方向`);
  }
});

test('probeReach 用 Range 只取响应头，不拉正文', async () => {
  let headers = null;
  await probeReach('a.example', {
    fetch: async (url, init) => {
      headers = init.headers;
      return { status: 200 };
    },
  });
  assert.equal(headers.Range, 'bytes=0-0');
});

/* ────────────────────────────── 结构守卫 ── */

test('probe.js 与 reach.js 都是 tier 0：只许 node: 与相对路径', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['probe.js', 'reach.js']) {
    const source = await readFile(new URL(`../../../packages/source/webvpn/src/${file}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      assert.ok(
        specifier.startsWith('./') || specifier.startsWith('node:'),
        `${file} 不得依赖外部包，发现 ${specifier}`,
      );
    }
  }
});

test('reach.js 落盘是可选的：不传 cacheFile 就不碰文件系统', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../../packages/source/webvpn/src/reach.js', import.meta.url), 'utf8');
  // 写盘只在 writeCacheFile 里，而它的第一行必须是无 file 直接返回。
  assert.match(source, /if \(!file\) return;/, '没有 cacheFile 时必须早退');
  // 并且写盘的调用点必须被 cacheFile 守着。
  assert.match(source, /if \(cacheFile && measured\.length\)/, '写盘必须由 cacheFile 守卫');
});

test('两个默认超时都写死且合理', () => {
  // 别让调用方在不传时拿到 undefined → 立即超时。
  assert.equal(typeof PROBE_TIMEOUT_MS, 'number');
  assert.ok(PROBE_TIMEOUT_MS >= 3000 && PROBE_TIMEOUT_MS <= 15000);
  assert.equal(typeof REACH_TTL_MS, 'number');
  assert.equal(REACH_TTL_MS, 10 * 60 * 1000);
});
