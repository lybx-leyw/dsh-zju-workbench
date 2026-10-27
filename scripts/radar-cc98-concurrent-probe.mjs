/**
 * 回归检查：CC98 令牌在服务端被判废时，并发读取只换一次令牌。
 *
 * # 为什么有这条检查
 *
 * 2026-10-27（r81）曾怀疑这里有个缺陷：「页面同时拉三个接口 → 三个 401 →
 * 各刷一次 → refresh_token（一次性）被消耗 N 次 → 回落密码模式」。
 * 实测**证伪**：`TokenStore.token()` 的 `pending` 合并本来就挡住了这个竞态，
 * 3 路、8 路并发都只换 1 次。这条检查是把当时的探针留下来，让这个结论
 * 以后被改坏时能立刻发现 —— 而不是每次都要重新怀疑一遍。
 *
 * # 它钉住的三件事
 *
 * 1. 并发 N 个 401 → 令牌只换 1 次（`refresh + password === 1`）；
 * 2. 不误触密码模式（`password === 0`：本地有可用 refresh_token 时不该重新登录）；
 * 3. 每个请求都重试且只重试一次（`apiCalls === 2N`）。
 *
 * # 环境
 *
 * 用共享层真实的 `SessionStore`（不传 `file` → 纯内存），不碰 DPAPI、不联网。
 * ⚠ 不要自己手写一个假 store：第一版探针就是手写的，`save()` 是空实现，
 * 结果 `read()` 读不到刚写入的令牌 → 凭空造出「3 次密码模式」的假缺陷。
 *
 * 用法：node scripts/radar-cc98-concurrent-probe.mjs
 * 退出码：0 = 通过；1 = 断言失败（可直接放进 CI）
 */

import { SessionStore } from 'dsh-zhiyun-source-campus/http';
import { TokenStore } from '../packages/dsh-zhiyun-source-cc98/src/token.js';
import { Cc98Client } from '../packages/dsh-zhiyun-source-cc98/src/client.js';

const CONCURRENCY = 3;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const counters = { refresh: 0, password: 0 };

// 假 openid.cc98.org：refresh_token 一次性（用过即作废），密码模式永远可用
let validRefresh = 'rt-0';
let serial = 0;
const fakeOpenid = async (_url, init) => {
  const form = new URLSearchParams(String(init?.body ?? ''));
  // 让并发刷新真的能交错，才可能暴露竞态
  await new Promise(resolve => setTimeout(resolve, 5));
  if (form.get('grant_type') === 'refresh_token') {
    counters.refresh += 1;
    if (form.get('refresh_token') !== validRefresh) {
      return new Response('invalid_grant', { status: 400 });
    }
    serial += 1;
    validRefresh = `rt-${serial}`;
    return json({ access_token: `at-${serial}`, refresh_token: validRefresh, expires_in: 3600 });
  }
  counters.password += 1;
  serial += 1;
  validRefresh = `rt-${serial}`;
  return json({ access_token: `at-${serial}`, refresh_token: validRefresh, expires_in: 3600 });
};

// 预置一份「本地没过期、服务端已判废」的令牌
const store = new SessionStore({});
await store.load();
const tokens = new TokenStore({
  store,
  fetch: fakeOpenid,
  account: async () => ({ username: 'u', password: 'p' }),
  now: () => 1_000_000,
});
await tokens.write({ access_token: 'at-0', refresh_token: 'rt-0', expires_at: 9_999_999 }, 'u');
counters.refresh = 0;
counters.password = 0; // 预置不计入

// 假 api.cc98.org：一律 401（令牌已在服务端作废）
let apiCalls = 0;
const transport = {
  async request() {
    apiCalls += 1;
    return { status: 401, text: '' };
  },
};

const client = new Cc98Client({ tokens, transport });
const paths = ['/topic/hot-today', '/notification/reply', '/me/unread-count'].slice(0, CONCURRENCY);
const results = await Promise.allSettled(paths.map(path => client.get(path)));

const failures = [];
const check = (ok, label, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` —— ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

console.log(`并发 ${CONCURRENCY} 个请求，令牌在服务端已判废：\n`);
check(results.every(r => r.status === 'rejected' && r.reason?.code === 'LOGIN_REQUIRED'),
  '全部以 LOGIN_REQUIRED 结束', `${results.filter(r => r.status === 'rejected').length}/${results.length}`);
check(counters.refresh + counters.password === 1,
  '令牌只换 1 次', `实际 ${counters.refresh + counters.password} 次（refresh ${counters.refresh} / 密码 ${counters.password}）`);
check(counters.password === 0,
  '未误触密码模式', `密码模式 ${counters.password} 次`);
check(apiCalls === CONCURRENCY * 2,
  '每个请求都重试且只重试一次', `api 调用 ${apiCalls} 次，期望 ${CONCURRENCY * 2}`);

console.log('');
if (failures.length) {
  console.log(`结论：${failures.length} 项不达标 —— ${failures.join('；')}`);
  process.exitCode = 1;
} else {
  console.log('结论：并发 401 只换一次令牌，未放大成重新登录 ✅');
}
