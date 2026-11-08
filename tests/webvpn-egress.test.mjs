import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 出口策略层的守卫。
 *
 * 这一层是从 `@lybx-leyw/dsh-zju-source-campus` 的 `egress.js` 抽出来的。抽出来之前，
 * `cc98` / `zdbk` 想走校园网只能借 campus 的 `zhiyunEgress` —— 一个数据包的
 * 能力被另一个业务包绑架。这些断言锁住「策略层不认识任何业务包」这件事。
 */

const webvpn = await import('../packages/source/webvpn/src/index.js');
const campusEgress = await import('../packages/source/campus/src/egress.js');

test('校园域名判定要求点边界（evilzju.edu.cn 不是浙大）', () => {
  assert.equal(webvpn.isCampusHost('courses.zju.edu.cn'), true);
  assert.equal(webvpn.isCampusHost('zju.edu.cn'), true);
  assert.equal(webvpn.isCampusHost('evilzju.edu.cn'), false);
  assert.equal(webvpn.isCampusHost('zju.edu.cn.evil.com'), false);
});

test('网关自己永远不需要「再走一次校园网」（防无限套娃）', () => {
  assert.equal(webvpn.needsCampusNetwork('webvpn.zju.edu.cn'), false);
});

test('登录域是公网服务，与是否在校园网无关', () => {
  for (const host of webvpn.PUBLIC_AUTH_HOSTS) {
    assert.ok(host.endsWith('.zju.edu.cn'), `${host} 应当仍是校园域`);
  }
  // 它们在 zju.edu.cn 下，但 routeFor 在 auto 模式下必须直接判 direct
  assert.ok(webvpn.PUBLIC_AUTH_HOSTS.includes('zjuam.zju.edu.cn'));
  assert.ok(webvpn.PUBLIC_AUTH_HOSTS.includes('identity.zju.edu.cn'));
});

test('业务侧用 directSuffixes 注入公网站点，共享层不认识具体业务', async () => {
  // 共享层默认不认识拼题A
  assert.equal(webvpn.isPublicHost('pintia.cn', []), false);
  // 传进去才认识
  assert.equal(webvpn.isPublicHost('pintia.cn', ['pintia.cn']), true);
  assert.equal(webvpn.isPublicHost('api.pintia.cn', ['pintia.cn']), true);
  // 点边界同样成立
  assert.equal(webvpn.isPublicHost('eviltpintia.cn', ['pintia.cn']), false);
});

test('campus 的判定 = 共享策略 + 它的业务配置（行为不得漂移）', () => {
  for (const host of ['courses.zju.edu.cn', 'zdbk.zju.edu.cn', 'webvpn.zju.edu.cn', 'api.cc98.org', 'evilzju.edu.cn']) {
    const fromCampus = campusEgress.needsCampusNetwork(host);
    const fromShared = webvpn.needsCampusNetwork(host, { directSuffixes: ['pintia.cn'] });
    assert.equal(fromCampus, fromShared, `${host} 两处判定必须一致`);
  }
});

test('拼题A 在 campus 里仍然判定为直连', () => {
  assert.equal(campusEgress.isPintiaHost('pintia.cn'), true);
  assert.equal(campusEgress.needsCampusNetwork('pintia.cn'), false);
  assert.equal(campusEgress.needsCampusNetwork('api.pintia.cn'), false);
});

test('三种模式的路由结果', async () => {
  const direct = webvpn.createEgress({ mode: 'direct', log: () => {} });
  const forced = webvpn.createEgress({ mode: 'webvpn', directSuffixes: ['pintia.cn'], log: () => {} });

  assert.equal(await direct.routeFor('https://courses.zju.edu.cn/x'), 'direct');
  assert.equal(await forced.routeFor('https://courses.zju.edu.cn/x'), 'webvpn');
  // 公网站点即使在 webvpn 模式下也不绕
  assert.equal(await forced.routeFor('https://pintia.cn/x'), 'direct');
  // 网关自己在任何模式下都不改写
  assert.equal(await forced.routeFor('https://webvpn.zju.edu.cn/login'), 'direct');
});

test('未知出口模式直接抛错，不静默降级', () => {
  assert.throws(() => webvpn.createEgress({ mode: 'bogus' }), (error) => {
    assert.equal(error.name, 'WebvpnError');
    assert.equal(error.code, 'EGRESS');
    return true;
  });
});

test('undici 缺失时 state().degraded 如实标记', () => {
  const egress = webvpn.createEgress({ mode: 'direct', undici: null, log: () => {} });
  assert.equal(egress.state().degraded, true);
  assert.equal(egress.state().campus, 'unknown');
});

test('策略层不 import 任何业务包（独立性的硬约束）', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../packages/source/webvpn/src/egress.js', import.meta.url), 'utf8');
  const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1]);
  for (const specifier of specifiers) {
    assert.ok(
      specifier.startsWith('./') || specifier.startsWith('node:'),
      `策略层不得依赖外部包，发现 ${specifier}`,
    );
  }
});
