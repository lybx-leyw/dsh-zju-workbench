/**
 * W3：会话内降级与「无权访问」页识别。
 *
 * # 要守的语义
 *
 * 1. 某主机**直连失败、升级成功**之后，本次会话里**不再先试直连**；
 * 2. 直连拿到「无权访问」页（HTTP 200 但地址是 `nopermit_zjusub.jsp`）也算降级；
 * 3. 降级只对「需要校园网」的主机生效 —— 公网站失败是它自己的事，不该被记成
 *    「要走网关」；
 * 4. `forget()` 同时清探测缓存与降级集合 —— 否则用户回到校园网了还在绕网关；
 * 5. 绝不重放凭据提交（POST）—— 这条是既有保护，W3 不得破坏。
 *
 * # 为什么这些断言重要
 *
 * 降级状态是**内存里的隐式状态**，写错了不会报错：只会表现为「某个站点莫名其妙
 * 一直走网关」或「换了网络之后还是不直连」。这类问题很难靠人工发现。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { createEgress, CAMPUS_PROBE_URL } = await import('../packages/source/webvpn/src/index.js');

const WEBVPN_ORIGIN = 'https://webvpn.zju.edu.cn';

/** 只在校内的站点（表里明确判 campus），用来触发降级路径。 */
const CAMPUS_URL = 'https://sztz.zju.edu.cn/api/a';
/** 公网站点，不该被降级。 */
const PUBLIC_URL = 'https://pintia.cn/api/a';

/**
 * 假 undici：按 URL 子串路由，并记录每次请求。
 *
 * @param routes - `[match, reply]` 列表，按顺序匹配。
 * @returns `{ calls, module }`。
 */
function fakeUndici(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const target = String(url);
    calls.push({ url: target, method: init?.method ?? 'GET' });
    for (const [match, reply] of routes) {
      if (target.includes(match)) return reply(target, init);
    }
    return new Response('{}', { status: 200 });
  };
  return { calls, module: { Agent: class { async close() {} }, fetch: fetchImpl } };
}

/** 造一个「直连失败、网关成功」的世界。 */
function directDownWorld() {
  return fakeUndici([
    [CAMPUS_PROBE_URL, () => new Response('0', { status: 200 })],
    [WEBVPN_ORIGIN, () => new Response('via-webvpn', { status: 200 })],
    ['sztz.zju.edu.cn', () => { throw Object.assign(new Error('direct down'), { code: 'ECONNRESET' }); }],
  ]);
}

test('直连失败并升级成功后，同一主机第二次请求直接走网关（不再先试直连）', async () => {
  const fake = directDownWorld();
  const egress = createEgress({ mode: 'auto', undici: fake.module, log: () => {}, onWebvpnRequired: () => true });

  const first = await egress.fetch(CAMPUS_URL);
  assert.equal(await first.text(), 'via-webvpn');
  assert.deepEqual(egress.downgradedHosts(), ['sztz.zju.edu.cn'], '升级成功后要记住这个主机');

  // 第二次：必须**直接**打网关，不再出现一次失败的直连。
  const before = fake.calls.length;
  const second = await egress.fetch(CAMPUS_URL);
  assert.equal(await second.text(), 'via-webvpn');

  const secondRun = fake.calls.slice(before);
  assert.equal(secondRun.length, 1, '第二次只该有一个请求');
  assert.ok(secondRun[0].url.startsWith(WEBVPN_ORIGIN), '第二次就该直接走网关');
});

test('降级对路由可见：routeFor 直接返回 webvpn', async () => {
  const fake = directDownWorld();
  const egress = createEgress({ mode: 'auto', undici: fake.module, log: () => {}, onWebvpnRequired: () => true });

  assert.equal(await egress.routeFor(CAMPUS_URL), 'direct', '降级前按探测结果直连');
  await egress.fetch(CAMPUS_URL);
  assert.equal(await egress.routeFor(CAMPUS_URL), 'webvpn', '降级后直接判网关');
});

test('直连拿到「无权访问」页也降级（HTTP 200 也要识别）', async () => {
  // 网站群对只给校内看的页面会以 200 返回拒绝页，地址落在 nopermit_zjusub.jsp。
  // 只看状态码发现不了 —— 这是降级逻辑存在的第二个理由。
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => new Response('0', { status: 200 })],
    [WEBVPN_ORIGIN, () => new Response('via-webvpn', { status: 200 })],
    ['sztz.zju.edu.cn', () => Object.assign(new Response('denied', { status: 200 }), {
      url: 'https://sztz.zju.edu.cn/nopermit_zjusub.jsp?parentUrl=x',
    })],
  ]);
  const egress = createEgress({ mode: 'auto', undici: fake.module, log: () => {}, onWebvpnRequired: () => true });

  const response = await egress.fetch(CAMPUS_URL);
  assert.equal(await response.text(), 'via-webvpn', '无权访问页要触发改走网关');
  assert.deepEqual(egress.downgradedHosts(), ['sztz.zju.edu.cn']);
});

test('公网站点失败不被降级（它的失败与校园网无关）', async () => {
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => new Response('0', { status: 200 })],
    ['pintia.cn', () => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); }],
  ]);
  const egress = createEgress({ mode: 'auto', undici: fake.module, log: () => {}, onWebvpnRequired: () => true });

  await assert.rejects(() => egress.fetch(PUBLIC_URL), { code: 'ECONNRESET' });
  assert.deepEqual(egress.downgradedHosts(), [], '公网站不该被记成要绕网关');
});

test('forget() 同时清掉探测缓存与降级集合', async () => {
  const fake = directDownWorld();
  const egress = createEgress({ mode: 'auto', undici: fake.module, log: () => {}, onWebvpnRequired: () => true });

  await egress.fetch(CAMPUS_URL);
  assert.deepEqual(egress.downgradedHosts(), ['sztz.zju.edu.cn']);
  assert.equal(egress.state().campus, 'outside', '已经探过');

  egress.forget();

  assert.deepEqual(egress.downgradedHosts(), [], '降级集合要清空');
  assert.equal(egress.state().campus, 'unknown', '探测缓存要清空');

  // 注意：`forget()` 只清「缓存」，不清「本次运行已用过网关」这个事实
  // （`usingWebvpn`）。所以这里重新探测后会再次判 webvpn —— 那是正确行为：
  // 人还在校外。要验的是**降级集合确实不再起作用**，即 routeFor 会重新探测。
  let probes = 0;
  const counting = createEgress({
    mode: 'auto', onWebvpnRequired: () => true,
    log: () => {},
    undici: {
      Agent: class { async close() {} },
      fetch: async (url, init) => {
        if (String(url).includes(CAMPUS_PROBE_URL)) { probes += 1; return new Response('0', { status: 200 }); }
        return new Response('{}', { status: 200 });
      },
    },
  });
  await counting.routeFor(CAMPUS_URL);
  assert.equal(probes, 1, '首次要探测');
  await counting.routeFor(CAMPUS_URL);
  assert.equal(probes, 1, '探测结果被缓存，不重复探');
  counting.forget();
  await counting.routeFor(CAMPUS_URL);
  assert.equal(probes, 2, 'forget() 之后必须重新探测 —— 说明缓存真的清了');
});

test('state() 暴露降级主机，便于诊断面板显示', async () => {
  const fake = directDownWorld();
  const egress = createEgress({ mode: 'auto', undici: fake.module, log: () => {}, onWebvpnRequired: () => true });

  assert.deepEqual(egress.state().downgraded, []);
  await egress.fetch(CAMPUS_URL);
  assert.deepEqual(egress.state().downgraded, ['sztz.zju.edu.cn']);
  assert.equal(egress.state().viaWebvpn, true);
});

test('已确认在校园网内时，直连失败仍不降级（避免把人赶去配用不到的网关）', async () => {
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => new Response('1', { status: 200 })],
    ['sztz.zju.edu.cn', () => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); }],
    [WEBVPN_ORIGIN, () => new Response('via-webvpn', { status: 200 })],
  ]);
  const egress = createEgress({ mode: 'auto', undici: fake.module, log: () => {}, onWebvpnRequired: () => true });

  await assert.rejects(() => egress.fetch(CAMPUS_URL), { code: 'ECONNRESET' });
  assert.deepEqual(egress.downgradedHosts(), [], '在校园网内不该降级');
});

test('POST 失败绝不重放，也不降级（凭据提交不能试第二次）', async () => {
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => new Response('0', { status: 200 })],
    [WEBVPN_ORIGIN, () => new Response('via-webvpn', { status: 200 })],
    ['sztz.zju.edu.cn', () => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); }],
  ]);
  const egress = createEgress({ mode: 'auto', undici: fake.module, log: () => {}, onWebvpnRequired: () => true });

  await assert.rejects(
    () => egress.fetch(CAMPUS_URL, { method: 'POST', body: 'password=x' }),
    { code: 'ECONNRESET' },
  );
  const attempts = fake.calls.filter(c => c.url.includes('sztz.zju.edu.cn'));
  assert.equal(attempts.length, 1, 'POST 只许尝试一次');
  assert.equal(fake.calls.some(c => c.url.startsWith(WEBVPN_ORIGIN)), false, '不重放也不升级');
});

test('降级是 per-egress 实例的，不跨实例污染', async () => {
  // 降级状态必须挂在 createEgress 的闭包里，不能放到模块级 —— 否则同一进程里
  // 另一个 profile / 另一张网络会继承前一个实例的失败记录。
  const a = directDownWorld();
  const b = directDownWorld();
  const first = createEgress({ mode: 'auto', undici: a.module, log: () => {}, onWebvpnRequired: () => true });
  const second = createEgress({ mode: 'auto', undici: b.module, log: () => {}, onWebvpnRequired: () => true });

  await first.fetch(CAMPUS_URL);
  assert.deepEqual(first.downgradedHosts(), ['sztz.zju.edu.cn']);
  assert.deepEqual(second.downgradedHosts(), [], '另一个实例不该继承降级状态');
});

test('降级必须逐主机：一个站失败不许牵连别的站', async () => {
  // 历史实现用 `usingWebvpn` 当全局闩锁：任意一个主机降级之后，所有需要
  // 校园网的主机都跟着改道。实测后果是「sztz 失败一次，另一个本来能直连的
  // 站点也被推去网关」。这条测试把那个行为钉死。
  const seen = [];
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => new Response('0', { status: 200 })],
    [WEBVPN_ORIGIN, () => new Response('via-webvpn', { status: 200 })],
    ['sztz.zju.edu.cn', () => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); }],
    ['other', () => new Response('ok-direct', { status: 200 })],
  ]);
  // 包一层记录，看清第二个站走了哪条路。
  const original = fake.module.fetch;
  fake.module.fetch = async (url, init) => { seen.push(String(url)); return original(url, init); };

  const egress = createEgress({ mode: 'auto', undici: fake.module, log: () => {}, onWebvpnRequired: () => true });
  await egress.fetch(CAMPUS_URL);
  assert.deepEqual(egress.downgradedHosts(), ['sztz.zju.edu.cn'], '只有失败的那个站进集合');

  seen.length = 0;
  // 表里没有的 *.zju.edu.cn 会回退后缀规则 → 需要校园网 → 但它是**另一个站**。
  const response = await egress.fetch('https://another-college.zju.edu.cn/x');
  assert.equal(await response.text(), 'ok-direct', '无关站点仍该直连');
  assert.equal(seen.some(u => u.startsWith(WEBVPN_ORIGIN)), false, '不该被前者牵连去走网关');
});

test('没传 onWebvpnRequired 时不得静默改写，必须抛 WEBVPN_REQUIRED', async () => {
  // 历史缺陷：条件写成 `typeof onWebvpnRequired === 'function' && ...`，
  // 没传回调时整体为 false → 直接改写并发出去。而 source/http 建共享出口时
  // 恰好没传它，于是校外 + 直连失败会拿到**网关登录页**（HTTP 200），
  // 各数据源把登录页当业务数据解析，报出一堆莫名其妙的字段缺失。
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => new Response('0', { status: 200 })],
    [WEBVPN_ORIGIN, () => new Response('should-not-reach-here', { status: 200 })],
    ['sztz.zju.edu.cn', () => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); }],
  ]);
  // 注意：这里**故意不传** onWebvpnRequired。
  const egress = createEgress({ mode: 'auto', undici: fake.module, log: () => {} });

  await assert.rejects(
    () => egress.fetch(CAMPUS_URL),
    (error) => {
      assert.equal(error.code, 'WEBVPN_REQUIRED');
      assert.match(error.message, /上网账号/, '错误里要说清下一步做什么');
      return true;
    },
  );
  assert.equal(
    fake.calls.some(c => c.url.startsWith(WEBVPN_ORIGIN)),
    false,
    '没有会话来源时，一个网关请求都不该发出去',
  );
});

test('onWebvpnRequired 返回 false 时也不改写', async () => {
  const fake = fakeUndici([
    [CAMPUS_PROBE_URL, () => new Response('0', { status: 200 })],
    [WEBVPN_ORIGIN, () => new Response('should-not-reach-here', { status: 200 })],
    ['sztz.zju.edu.cn', () => { throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); }],
  ]);
  const egress = createEgress({
    mode: 'auto', undici: fake.module, log: () => {},
    onWebvpnRequired: () => false,
  });

  await assert.rejects(() => egress.fetch(CAMPUS_URL), { code: 'WEBVPN_REQUIRED' });
  assert.equal(fake.calls.some(c => c.url.startsWith(WEBVPN_ORIGIN)), false);
});
