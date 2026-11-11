/**
 * 主机归属表（`src/hosts.js`）的守卫。
 *
 * # 这份测试要守什么
 *
 * 表本身是数据，改错了不会让进程崩，只会让用户「莫名多绕一次网关」或
 * 「校外打不开」。所以断言必须钉住三类事实：
 *
 * 1. **public / campus 的分界**：几类已知站点的归属，改一行就该红；
 * 2. **点边界**：`evilzju.edu.cn` 不许命中 `zju.edu.cn`（这条是本仓既有
 *    `isCampusHost` 的同一要求，表实现不能把它丢掉）；
 * 3. **unknown 的存在**：表里没有的主机必须能返回 `unknown`，否则调用方
 *    没有回退路径，新站点会被静默判成某一侧。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const hosts = await import('../packages/source/webvpn/src/hosts.js');

test('公网可达的站点判为 public（原先被后缀规则误判为 campus）', () => {
  // 这五个是「本仓现行单后缀规则会判错」的典型：它们都在 zju.edu.cn 下，
  // 但实测从校外能直连。改成主机表之后必须判 public，否则会退回粗粒度。
  for (const host of [
    'zdbk.zju.edu.cn',
    'courses.zju.edu.cn',
    'classroom.zju.edu.cn',
    'tyys.zju.edu.cn',
    'yjsy.zju.edu.cn',
  ]) {
    assert.equal(hosts.classifyHost(host), 'public', `${host} 应判 public`);
  }
});

test('只在校内可达的站点判为 campus（含非 zju 域与私网 IP）', () => {
  // 这三条是「现行后缀规则覆盖不到」的漏判点：cc98.org 不在 zju.edu.cn 下，
  // 实验平台是私网 IP。它们在改动前会被判直连，校外必然失败。
  assert.equal(hosts.classifyHost('cc98.org'), 'campus', 'CC98 只在校内可达');
  assert.equal(hosts.classifyHost('10.203.16.55'), 'campus', '实验选课平台是私网 IP');
  assert.equal(hosts.classifyHost('sztz.zju.edu.cn'), 'campus', '二课平台只在校内');

  // 知网靠校内 IP 登录；电子书两个平台只在校内授权。
  assert.equal(hosts.classifyHost('cnki.net'), 'campus');
  assert.equal(hosts.classifyHost('sslibrary.com'), 'campus');
});

test('表里没有的主机返回 unknown，由调用方回退后缀规则', () => {
  // D5 的裁决：未知主机回退后缀规则，所以这里必须是 unknown 而不是任何一侧。
  assert.equal(hosts.classifyHost('some-new-college.zju.edu.cn'), 'unknown');
  assert.equal(hosts.classifyHost('example.com'), 'unknown');
  assert.equal(hosts.classifyHost(''), 'unknown');
  assert.equal(hosts.classifyHost(undefined), 'unknown');
});

test('点边界成立：后缀匹配不许越界', () => {
  // 朴素 endsWith('zju.edu.cn') 会让 evilzju.edu.cn 命中，等于把任意域名
  // 当校内站去发凭据。名单实现必须要求点边界。
  assert.equal(hosts.classifyHost('evilzju.edu.cn'), 'unknown');
  assert.equal(hosts.classifyHost('zju.edu.cn.evil.com'), 'unknown');
  // 但真正的子域要命中。
  assert.equal(hosts.classifyHost('office.cas.zju.edu.cn'), 'campus');
  assert.equal(hosts.classifyHost('sub.cc98.org'), 'campus');
});

test('大小写与尾点不敏感', () => {
  assert.equal(hosts.classifyHost('ZDBK.ZJU.EDU.CN'), 'public');
  assert.equal(hosts.classifyHost('zdbk.zju.edu.cn.'), 'public');
  assert.equal(hosts.classifyHost('CC98.ORG'), 'campus');
});

test('带端口的主机名忽略端口', () => {
  // 实验平台两个端口（86 静态页 / 8098 API），归属与端口无关。
  assert.equal(hosts.classifyHost('10.203.16.55:8098'), 'campus');
  assert.equal(hosts.classifyHost('10.203.16.55:86'), 'campus');
});

test('网关自己与统一身份认证是 public', () => {
  // 网关必须直连，否则就是「网关的网关」；CAS 是公网服务，与校园网身份无关。
  assert.equal(hosts.classifyHost('webvpn.zju.edu.cn'), 'public');
  assert.equal(hosts.classifyHost('zjuam.zju.edu.cn'), 'public');
  assert.equal(hosts.classifyHost('identity.zju.edu.cn'), 'public');
});

test('CAS 名单只用于诊断，不参与选路', () => {
  assert.equal(hosts.needsCas('zdbk.zju.edu.cn'), true);
  assert.equal(hosts.needsCas('courses.zju.edu.cn'), true);
  assert.equal(hosts.needsCas('cc98.org'), false, 'CC98 是自有账号，不走 CAS');
  assert.equal(hosts.needsCas('example.com'), false);
});

test('表是冻结的，调用方改不动内部状态', () => {
  assert.ok(Object.isFrozen(hosts.HOSTS));
  assert.ok(Object.isFrozen(hosts.HOSTS.campus));
  assert.ok(Object.isFrozen(hosts.HOSTS.public));
  assert.throws(() => { hosts.HOSTS.campus.push('evil.com'); }, TypeError);
});

test('表带生成时间与生成方式，便于判断是否过期', () => {
  assert.equal(typeof hosts.HOSTS_GENERATED_AT, 'string');
  assert.match(hosts.HOSTS_GENERATED_AT, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(['server', 'module'].includes(hosts.HOSTS_VIA));
});

test('hosts.js 不 import 任何东西（纯数据 + 纯函数）', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../packages/source/webvpn/src/hosts.js', import.meta.url), 'utf8');
  // 它必须能被任何包安全 import —— 不碰网络、不读环境变量、不依赖 cordis。
  const specifiers = [...source.matchAll(/^\s*import\s+.*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert.deepEqual(specifiers, [], `hosts.js 不得 import，发现 ${specifiers.join(', ')}`);
});
