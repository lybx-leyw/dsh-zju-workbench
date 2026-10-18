/**
 * 课堂账号写进**宿主凭据服务**、omni 从那里读。
 *
 * 这替代了原先"各自存一份 DPAPI"的设计：那套设计下用户登录了课堂，规划页仍说
 * 「未配置账号，去终端跑 configure」—— 同一个浙大账号被要两次，其中一次还要开终端。
 *
 * 断言集中在四件事：
 *   1. 记录键是 `zhiyun-classroom/account`，形状是 `{kind:'grant', payload}`（宿主认的形状）；
 *   2. 宿主没装凭据服务时**全部降级**，不抛错 —— 课堂必须照常能用；
 *   3. 空用户名/空密码不写（半个凭据比没有更糟）；
 *   4. omni 侧读到的是同一份，且宿主凭据优先于它自己的 DPAPI。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_ID,
  RECORD_SCOPE,
  XZZD_SESSION_ID,
  credentialsOf,
  deleteRecord,
  readAccount,
  readRecord,
  readXzzdSession,
  recordKey,
  writeAccount,
  writeRecord,
  writeXzzdSession,
} from '../packages/dsh-zhiyun-classroom/src/host-credentials.js';

/** 造一个内存版宿主凭据服务，行为对齐 `dsh-credentials-local`。 */
function fakeCredentials() {
  const store = new Map();
  return {
    store,
    async readRecord(key) { return store.get(key); },
    async modifyRecord(key, mutate) {
      const next = await mutate(store.get(key));
      if (next === undefined) return store.get(key);
      store.set(key, next);
      return next;
    },
    async deleteRecord(key) { store.delete(key); },
  };
}

const ctxWith = (service) => ({ get: (name) => (name === 'credentials' ? service : undefined) });

/* ───────────────────────────────────────── 记录键与形状 */

test('记录键是 <scope>/<id>，与写入方约定一致', () => {
  assert.equal(RECORD_SCOPE, 'zhiyun-classroom');
  assert.equal(ACCOUNT_ID, 'account');
  assert.equal(recordKey(ACCOUNT_ID), 'zhiyun-classroom/account');
  assert.equal(recordKey(XZZD_SESSION_ID), 'zhiyun-classroom/xzzd-session');
});

test('写入形状是宿主认的 grant 记录', async () => {
  const service = fakeCredentials();
  const ok = await writeAccount(ctxWith(service), { username: 'u', password: 'p' });
  assert.equal(ok, true);
  const stored = service.store.get('zhiyun-classroom/account');
  assert.equal(stored.kind, 'grant', 'api-key 的形状塞不下结构化数据，必须用 grant');
  assert.deepEqual(stored.payload, { username: 'u', password: 'p' });
});

test('写入后可读回同一份', async () => {
  const service = fakeCredentials();
  await writeAccount(ctxWith(service), { username: 'alice', password: 'secret' });
  assert.deepEqual(await readAccount(ctxWith(service)), { username: 'alice', password: 'secret' });
});

/* ───────────────────────────────────────── 降级：没有凭据服务 */

test('宿主没装凭据服务时，读是 null、写是 false，不抛错', async () => {
  const bare = { get: () => undefined };
  assert.equal(credentialsOf(bare), null);
  assert.equal(await readAccount(bare), null);
  assert.equal(await writeAccount(bare, { username: 'u', password: 'p' }), false);
  assert.equal(await deleteRecord(bare, ACCOUNT_ID), false);
});

test('服务缺方法（只有 readRecord）也算不可用 —— 只读不能写会变成"配了改不了"', () => {
  const half = { get: () => ({ readRecord: async () => null }) };
  assert.equal(credentialsOf(half), null);
});

test('读记录抛错 → 当作没配，不把异常传给课堂', async () => {
  const broken = {
    get: () => ({
      readRecord: async () => { throw new Error('disk gone'); },
      modifyRecord: async () => { throw new Error('disk gone'); },
    }),
  };
  assert.equal(await readAccount(broken), null);
  assert.equal(await writeAccount(broken, { username: 'u', password: 'p' }), false);
});

/* ───────────────────────────────────────── 输入校验 */

test('空用户名或空密码不写 —— 半个凭据比没有更糟', async () => {
  const service = fakeCredentials();
  assert.equal(await writeAccount(ctxWith(service), { username: '', password: 'p' }), false);
  assert.equal(await writeAccount(ctxWith(service), { username: 'u', password: '' }), false);
  assert.equal(service.store.size, 0);
});

test('记录形状不是 grant 时不认（避免把 api-key 记录误读成账号）', async () => {
  const service = fakeCredentials();
  service.store.set('zhiyun-classroom/account', { kind: 'api-key', key: 'x' });
  assert.equal(await readAccount(ctxWith(service)), null);
  assert.equal(await readRecord(ctxWith(service), ACCOUNT_ID), null);
});

/* ───────────────────────────────────────── 学在浙大会话记录 */

test('会话记录：空数组不写，非空可读回', async () => {
  const service = fakeCredentials();
  const ctx = ctxWith(service);
  assert.equal(await writeXzzdSession(ctx, []), false);
  assert.equal(service.store.size, 0);

  const cookies = [{ name: 'session', value: 'x', domain: '.zju.edu.cn', path: '/', expires: -1 }];
  assert.equal(await writeXzzdSession(ctx, cookies), true);
  assert.deepEqual(await readXzzdSession(ctx), cookies);

  // 形状坏掉时读成 null，而不是把半个对象交给调用方
  service.store.set('zhiyun-classroom/xzzd-session', { kind: 'grant', payload: { cookies: 'nope' } });
  assert.equal(await readXzzdSession(ctx), null);
});

/* ───────────────────────────────────────── 端到端：写进去 → 读出来 */

test('课堂写、omni 读：同一个键，同一份账号', async () => {
  const service = fakeCredentials();
  const ctx = ctxWith(service);

  // 课堂登录时写
  await writeAccount(ctx, { username: 'alice', password: 'pw' });

  // omni 侧的读取器（host.js 里那个）读同一个键
  const record = await service.readRecord('zhiyun-classroom/account');
  assert.equal(record.kind, 'grant');
  assert.equal(record.payload.username, 'alice');
  assert.equal(record.payload.password, 'pw');
});

test('源码里不出现"去终端 configure"这类把成本转嫁给用户的文案', async () => {
  const { readFile } = await import('node:fs/promises');
  const client = await readFile(
    new URL('../packages/dsh-zhiyun-page-planning/src/client.jsx', import.meta.url), 'utf8',
  );
  // 只查**命令**写法，不查 `configured` 这个标识符（它包含 configure 子串）
  assert.equal(/npm run/.test(client), false, '规划页不该让用户去终端跑命令');
  assert.equal(/dsh-zhiyun-omni configure/.test(client), false, '规划页不该出现 configure 命令');
});

/**
 * 「还没登录」与「读取失败」必须分开呈现。
 *
 * 踩过的坑：宿主侧把错误码翻译成 `NEED_LOGIN`，页面却还在判旧码
 * （`LOGIN_REQUIRED` / `NO_SESSION`），于是状态条显示「读取失败」——
 * 用户会以为功能坏了，其实只是还没登录一次。
 */
test('页面识别 NEED_LOGIN 并显示成"待登录"，而非"读取失败"', async () => {
  const { readFile: rf } = await import('node:fs/promises');
  const client = await rf(
    new URL('../packages/dsh-zhiyun-page-planning/src/client.jsx', import.meta.url), 'utf8',
  );
  assert.match(client, /NEED_LOGIN/, '页面必须认得宿主翻译后的码');
  // 三个码都要在判定列表里，否则某一处改动就会退化成"读取失败"
  assert.match(client, /\[\s*'NEED_LOGIN'[\s\S]{0,80}'LOGIN_REQUIRED'/, '旧码要作为兼容保留');
  // 状态条里「待登录」的文案不能与「读取失败」共用一个分支
  const statusBlock = client.slice(client.indexOf('function SourceBar'), client.indexOf('function SourceItem'));
  assert.match(statusBlock, /登录/, '待登录文案必须出现');
  assert.match(statusBlock, /读取失败/, '真正的读取失败仍要能显示');
  assert.match(statusBlock, /needLogin/, '两者必须由不同分支决定');
});

test('宿主侧把 LOGIN_REQUIRED 翻译成 NEED_LOGIN', async () => {
  const { readFile: rf } = await import('node:fs/promises');
  const host = await rf(
    new URL('../packages/dsh-zhiyun-page-planning/src/index.js', import.meta.url), 'utf8',
  );
  assert.match(host, /code: 'NEED_LOGIN'/, '宿主侧必须产出统一码');
  assert.equal(host.includes("npm run"), false, '宿主侧不该让用户去终端跑命令');
});
