/**
 * 数据源探测（「重新检测」）的**判定口径**。
 *
 * # 用户报的现象
 *
 * ```
 * 学在浙大     可用
 * 智云课堂     登录失败
 * 教务         登录失败
 * 学在浙大会话 可用
 * 二课         可用
 * ```
 *
 * 一份 CAS 凭据，学在浙大通、智云课堂和教务不通。这不该是「密码错了」——
 * 同一份凭据不可能只对某些站点有效。三个真实问题：
 *
 * | # | 问题 | 症状 |
 * | --- | --- | --- |
 * | 1 | `probeClassroom` 只 `restoreSession()`，**不拿凭据登录** | 刚填完密码就点检测，必然「会话已失效」 |
 * | 2 | `probeZdbk` 把 `NEED_LOGIN` 一律译成「还没配」 | CAS 拒绝/网络失败看起来像没填凭据 |
 * | 3 | 前端 `sourceRow` **丢掉 `detail`** | 只显示「登录失败」四个字，真实原因看不到 |
 *
 * 第 3 条尤其恶劣：它让前两条的错误分类变得不可观测 —— 分类再准，不显示也等于没有。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const HOST = new URL('../../../packages/source/login/src/index.js', import.meta.url);
const CLIENT = new URL('../../../packages/source/login/src/client.jsx', import.meta.url);

const host = await readFile(HOST, 'utf8');
const client = await readFile(CLIENT, 'utf8');

/** 取出某个 `const probeXxx = async (ctx) => { ... }` 函数体（按大括号配对）。 */
function probeBody(name) {
  const start = host.indexOf(`const ${name} = async (ctx) => {`);
  assert.ok(start >= 0, `找不到 ${name}`);
  let depth = 0;
  let i = host.indexOf('{', start);
  const from = i;
  for (; i < host.length; i++) {
    if (host[i] === '{') depth += 1;
    else if (host[i] === '}') { depth -= 1; if (depth === 0) return host.slice(from, i + 1); }
  }
  throw new Error(`${name} 的函数体没有闭合`);
}

/* ────────────────── 1. 智云课堂：必须真的登录 ────────────────── */

test('probeClassroom：会话失效时要拿凭据真登一次，不能只说「需重新登录」', () => {
  const body = probeBody('probeClassroom');
  assert.match(body, /restoreSession/, '先试现成会话是对的');
  // 关键：会话不可用后必须继续往下走，而不是直接返回 NEEDS_LOGIN。
  assert.match(body, /classroom\.login\(/, '会话不可用时必须用存着的凭据登录');
  // 直接返回「需重新登录」而不尝试登录，正是原来的 bug。
  assert.ok(
    !/return \{ ok: false, code: 'NEEDS_LOGIN', detail: '会话已失效，需重新登录' \};/.test(body),
    '不能在没有尝试登录的情况下就断定失败',
  );
});

test('probeClassroom 必须用 readCard 取密码 —— cardStatus 刻意不带密码', () => {
  const body = probeBody('probeClassroom');
  // `cardStatus()` 是给界面看的，只回 `{ configured, username }`，没有 password。
  // 拿它去登录 → password 是 undefined → authenticate 抛
  // 「请先填入学号与密码」，用户明明填了却被告知没填。
  assert.match(body, /readCard\(ctx\)/, '登录要读全文凭据');
  assert.ok(!/card\.password/.test(body), '不能从 cardStatus 上取 password（它没有这个字段）');
  assert.match(body, /full\.password/, '要用 readCard 回来的密码');
});

/* ────────────────── 2. 教务：不能把登录失败说成没配 ────────────────── */

test('probeZdbk：NEED_LOGIN 不等于「还没配凭据」', () => {
  const body = probeBody('probeZdbk');
  // 原代码把 NEED_LOGIN 与 CREDENTIALS 一起归到 NEEDS_CREDENTIAL。
  assert.ok(
    !/code === 'NEED_LOGIN' \|\| code === 'CREDENTIALS'/.test(body),
    'NEED_LOGIN 是 CAS 拒绝/网络失败，不能说成没配凭据',
  );
  assert.match(body, /code === 'NEED_CREDENTIAL'/, '只有明确的 NEED_CREDENTIAL 才报「还没配」');
  assert.match(body, /error\?\.message/, '要把站点的原话带出去');
});

test('probeClassroom 也不该把登录失败一律说成没配', () => {
  const body = probeBody('probeClassroom');
  assert.ok(
    !/code === 'NEED_LOGIN' \|\| code === 'CREDENTIALS'/.test(body),
    'classroom 同样不能用 NEED_LOGIN 判「没配」',
  );
});

/* ────────────────── 3. 前端：detail 必须显示出来 ────────────────── */

test('sourceRow 要把 detail 显示出来 —— 否则分类再准也看不到', () => {
  assert.match(client, /const sourceRow = \(all, name\) =>/, '找得到 sourceRow');

  // 取 sourceRow 的函数体
  const start = client.indexOf('const sourceRow = (all, name) => {');
  let depth = 0;
  let i = client.indexOf('{', start);
  const from = i;
  for (; i < client.length; i++) {
    if (client[i] === '{') depth += 1;
    else if (client[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  const body = client.slice(from, i + 1);

  assert.match(body, /state\.detail/, '要读后端给的 detail');
  assert.match(body, /value: `\$\{label\} · \$\{short\}`/, '要把 label 与 detail 拼起来给用户看');
  assert.match(body, /slice\(0, 90\)/, '长文要截断，否则挤爆一行');
});

test('detail 为空时退回纯 label，不出现「登录失败 · 」这种尾巴', () => {
  const start = client.indexOf('const sourceRow = (all, name) => {');
  let depth = 0;
  let i = client.indexOf('{', start);
  const from = i;
  for (; i < client.length; i++) {
    if (client[i] === '{') depth += 1;
    else if (client[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  const body = client.slice(from, i + 1);
  assert.match(body, /if \(!detail\) return \{ value: label, tone: 'warn' \}/, '空 detail 要早退');
});
