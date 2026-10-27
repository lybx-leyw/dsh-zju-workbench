/**
 * CC98 令牌在服务端被判废时，并发读取只换一次令牌。
 *
 * # 这条测的是什么
 *
 * 2026-10-27（r81）曾怀疑这里有个缺陷：「页面同时拉三个接口 → 三个 401 →
 * 各刷一次 → refresh_token（一次性）被消耗 N 次 → 回落密码模式」。
 * 实测**证伪**：`TokenStore.token()` 的 `pending` 合并本来就挡住了这个竞态，
 * 3 路、8 路并发都只换 1 次（见 `scripts/radar-cc98-concurrent-probe.mjs`）。
 *
 * 这条测试把那个结论钉住：以后如果有人把 `pending` 合并删掉，
 * 这里会立刻红，而不是等用户发现「论坛老是让我重新登录」。
 *
 * # 为什么用真实 `SessionStore`
 *
 * 第一版探针手写了一个假 store，`save()` 是空实现，`read()` 读不到刚写入的令牌，
 * 于是凭空造出「3 次密码模式」的假缺陷。这里直接用共享层的 `SessionStore`（不传
 * `file` → 纯内存），不碰 DPAPI、不联网。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from 'dsh-zhiyun-source-campus/http';
import { TokenStore } from '../packages/dsh-zhiyun-source-cc98/src/token.js';
import { Cc98Client } from '../packages/dsh-zhiyun-source-cc98/src/client.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** 造一套「令牌在服务端已判废」的环境，返回 counts 供断言。 */
async function setup(concurrency) {
  const counts = { refresh: 0, password: 0, api: 0 };
  let validRefresh = 'rt-0';
  let serial = 0;

  // 假 openid.cc98.org：refresh_token 一次性（用过即作废），密码模式永远可用
  const openid = async (_url, init) => {
    const form = new URLSearchParams(String(init?.body ?? ''));
    // 让并发刷新能真正交错，否则竞态永远撞不上
    await new Promise(resolve => setTimeout(resolve, 5));
    if (form.get('grant_type') === 'refresh_token') {
      counts.refresh += 1;
      if (form.get('refresh_token') !== validRefresh) {
        return new Response('invalid_grant', { status: 400 });
      }
      serial += 1;
      validRefresh = `rt-${serial}`;
      return json({ access_token: `at-${serial}`, refresh_token: validRefresh, expires_in: 3600 });
    }
    counts.password += 1;
    serial += 1;
    validRefresh = `rt-${serial}`;
    return json({ access_token: `at-${serial}`, refresh_token: validRefresh, expires_in: 3600 });
  };

  const store = new SessionStore({});
  await store.load();
  const tokens = new TokenStore({
    store,
    fetch: openid,
    account: async () => ({ username: 'u', password: 'p' }),
    now: () => 1_000_000,
  });
  // 预置一份「本地没过期、服务端已判废」的令牌
  await tokens.write({ access_token: 'at-0', refresh_token: 'rt-0', expires_at: 9_999_999 }, 'u');
  counts.refresh = 0;
  counts.password = 0;

  const transport = {
    async request() {
      counts.api += 1;
      return { status: 401, text: '' };
    },
  };
  const client = new Cc98Client({ tokens, transport });
  const paths = Array.from({ length: concurrency }, (_, index) => `/probe/${index}`);
  const results = await Promise.allSettled(paths.map(path => client.get(path)));
  return { counts, results, concurrency };
}

for (const concurrency of [3, 8]) {
  test(`cc98: ${concurrency} 路并发 401 只换一次令牌，不放大成重新登录`, async () => {
    const { counts, results, concurrency: n } = await setup(concurrency);
    const total = counts.refresh + counts.password;
    assert.equal(total, 1, `令牌应只换 1 次，实际 ${total} 次（refresh ${counts.refresh} / 密码 ${counts.password}）`);
    assert.equal(counts.password, 0, '本地有可用 refresh_token 时不该回落密码模式');
    assert.equal(counts.api, n * 2, '每个请求都应重试且只重试一次');
    assert.ok(results.every(r => r.status === 'rejected' && r.reason?.code === 'LOGIN_REQUIRED'));
  });
}
