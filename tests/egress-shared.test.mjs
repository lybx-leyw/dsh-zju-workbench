/**
 * 共享出口：让所有 `source-*` 包都走同一套自动网络策略。
 *
 * # 这套东西要守的三件事
 *
 * 1. **只有一份出口**。WebVPN 是网关会话，各包各自登录会互相作废（与 CAS
 *    双登录同一类事故）；undici Agent 与校园网探测结果同样只该有一份。
 * 2. **惰性解析**。profile 里包装配顺序不保证 campus 在前，`apply()` 阶段
 *    取服务一定拿不到 —— 那次取到的 `undefined` 一旦被缓存，就永久退化成直连。
 * 3. **缺了 campus 也要活**。拿不到服务时退回宿主 fetch（直连），
 *    不能把「没装 campus」变成启动错误。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { sharedFetch } from '../packages/dsh-zhiyun-source-campus/src/cas/http.js';

/** 一个假的 ctx：`get` 返回给定服务表里的东西。 */
function fakeCtx(services = {}) {
  return {
    get(name) {
      return services[name];
    },
  };
}

const URL_UNDER_TEST = 'https://courses.zju.edu.cn/api/todos';

/* ────────────────────────────────────── 服务接入 */

test('sharedFetch：有出口服务时，请求走 egress（而不是宿主 fetch）', async () => {
  const seen = [];
  const egress = {
    fetch: async (url, init) => { seen.push(['egress', url, init?.method]); return 'from-egress'; },
  };
  const hostFetch = async () => { seen.push(['host']); return 'from-host'; };

  const fetch = sharedFetch(fakeCtx({ zhiyunEgress: egress }), { fallback: hostFetch });
  const result = await fetch(URL_UNDER_TEST, { method: 'GET' });

  assert.equal(result, 'from-egress');
  assert.deepEqual(seen, [['egress', URL_UNDER_TEST, 'GET']], '不该碰宿主 fetch');
});

test('sharedFetch：没有出口服务时退回宿主 fetch（缺 campus 仍可用）', async () => {
  const hostFetch = async () => 'from-host';
  const fetch = sharedFetch(fakeCtx({}), { fallback: hostFetch });
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');
});

test('sharedFetch：服务没有 fetch 方法时也要退回（半残服务不能把请求打死）', async () => {
  const hostFetch = async () => 'from-host';
  const fetch = sharedFetch(fakeCtx({ zhiyunEgress: { state: () => ({}) } }), { fallback: hostFetch });
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');
});

test('sharedFetch：ctx.get 抛错时退回，而不是让请求变成异常', async () => {
  const ctx = { get() { throw new Error('scope 已销毁'); } };
  const hostFetch = async () => 'from-host';
  const fetch = sharedFetch(ctx, { fallback: hostFetch });
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');
});

test('sharedFetch：没有 ctx 时也能用（退回宿主 fetch）', async () => {
  const hostFetch = async () => 'from-host';
  const fetch = sharedFetch(undefined, { fallback: hostFetch });
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');
});

/* ────────────────────────────────────── 惰性：这条最容易写错 */

test('sharedFetch：**惰性**解析 —— 服务晚于调用方就绪也能用上', async () => {
  // 模拟真实时序：包先 apply（此时 campus 还没 provide），之后服务才出现。
  const services = {};
  const ctx = { get: (name) => services[name] };
  const hostFetch = async () => 'from-host';
  const fetch = sharedFetch(ctx, { fallback: hostFetch });

  // 服务还没出现：走宿主
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');

  // 服务出现之后：必须立刻切换过去（如果实现把结果缓存在闭包里，这里会失败）
  services.zhiyunEgress = { fetch: async () => 'from-egress' };
  assert.equal(await fetch(URL_UNDER_TEST), 'from-egress');

  // 服务消失（卸载）：退回宿主
  delete services.zhiyunEgress;
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');
});

/* ────────────────────────────────────── campus 是否真的提供了服务 */

test('campus 通过 ctx.provide 暴露 zhiyunEgress，且带齐必要方法', async () => {
  const src = await readFile(
    new URL('../packages/dsh-zhiyun-source-campus/src/index.js', import.meta.url), 'utf8',
  );
  assert.match(src, /ctx\.provide\('zhiyunEgress'/, 'campus 必须 provide 这个服务名');
  for (const key of ['mode', 'fetch', 'send', 'toPhysical', 'state', 'probeCampus', 'forget']) {
    assert.match(src, new RegExp(`${key}\\s*:`), `zhiyunEgress 缺成员 ${key}`);
  }
});

test('各 source 包都接了 sharedFetch（不许再直接用 globalThis.fetch）', async () => {
  const targets = [
    ['dsh-zhiyun-source-zdbk', 'index.js'],
    ['dsh-zhiyun-source-cc98', 'index.js'],
    ['dsh-zhiyun-source-xxt', 'index.js'],
  ];
  for (const [pkg, file] of targets) {
    const src = await readFile(new URL(`../packages/${pkg}/src/${file}`, import.meta.url), 'utf8');
    assert.match(src, /sharedFetch\(ctx\)/, `${pkg} 应当用 sharedFetch(ctx)`);
    assert.doesNotMatch(
      src,
      /(?:config\.fetch \?\? |: )globalThis\.fetch\b(?!\s*\))/,
      `${pkg} 仍在直接用 globalThis.fetch 当生产出口`,
    );
  }
});

test('classroom 也优先用共享出口，并保留自己的本地兜底', async () => {
  const src = await readFile(
    new URL('../packages/dsh-zhiyun-source-classroom/src/index.js', import.meta.url), 'utf8',
  );
  assert.match(src, /zhiyunEgress/, 'classroom 应当优先取共享出口');
  assert.match(src, /localNet/, '拿不到共享出口时要有本地兜底');
  // 顺序要求：先试共享出口，再退回本地
  assert.ok(
    src.indexOf('zhiyunEgress') < src.indexOf('localNet.fetch'),
    '必须先查共享出口，再退回本地网络',
  );
});
