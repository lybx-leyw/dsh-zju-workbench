/**
 * 「浙大一卡通」凭据：智云课堂与学在浙大**共用**的唯一来源。
 *
 * 这一层的关键不是"能存取"，而是三条边界：
 *
 *   1. **密码永不回显明文** —— 读状态只给打码值。同源页面被 XSS 时也拿不到密码；
 *   2. **打码值 = 不改** —— 用户只改账号时不必重输密码；
 *   3. **两道写闸** —— 自定义头（跨站发不出）+ 回环 Host（防 DNS rebinding）。
 *
 * 另外还有一条语义边界值得钉：这里的「一卡通」是**浙大统一身份认证账号密码**
 * （学号 + 密码），不是校园卡消费密码。将来接消费记录要用**另一个记录 id**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARD_RECORD_KEY, MASK, ROUTE_PATH, WEBVPN_LABEL, WEBVPN_RECORD_KEY, WRITE_HEADER,
  CC98_LABEL, CC98_RECORD_KEY, readCc98, writeCc98, clearCc98, cc98Status,
  cardStatus, clearCard, clearWebvpn, createHandler, fillCardIfEmpty, normalizePassword,
  normalizeUsername, readCard, readWebvpn, webvpnStatus, writeCard, writeWebvpn,
} from '../packages/dsh-zhiyun-source-card/src/index.js';

/** 内存版宿主凭据服务，模拟 `ctx.credentials`。 */
function memoryCtx() {
  const store = new Map();
  const service = {
    async readRecord(key) { return store.get(key) ?? null; },
    async modifyRecord(key, fn) {
      store.set(key, fn(store.get(key) ?? null));
      return store.get(key);
    },
    async deleteRecord(key) { store.delete(key); },
  };
  return { get: (name) => (name === 'credentials' ? service : null), store };
}

/** 没有凭据服务的 ctx。 */
const bareCtx = { get: () => null };

const call = (handler, method, url, body, headers = {}) => new Promise((resolve) => {
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1:43120', [WRITE_HEADER]: '1', ...headers },
    [Symbol.asyncIterator]: async function* iterator() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    },
  };
  const res = {
    writeHead(status) { this.status = status; },
    end(chunk) { resolve({ status: this.status, body: JSON.parse(chunk) }); },
  };
  handler(req, res);
});

/* ────────────────────────────────────── 语义边界 */

test('记录 id 沿用旧值（换 id 会让已有用户丢凭据）', () => {
  // 这条不是美观问题：id 变了，所有已登录用户的凭据读不到，会被迫重登一次。
  assert.equal(CARD_RECORD_KEY, 'zhiyun-classroom/account');
});

test('服务不可用时读写都安全返回，不抛', async () => {
  assert.equal(await readCard(bareCtx), null);
  assert.equal(await writeCard(bareCtx, { username: 'u', password: 'p' }), false);
  assert.equal(await clearCard(bareCtx), false);
  assert.deepEqual(await cardStatus(bareCtx), { configured: false, username: '' });
});

test('写入后能被两个包分别读到（这就是"共用"的含义）', async () => {
  const ctx = memoryCtx();
  assert.equal(await writeCard(ctx, { username: '3200100000', password: 'pw' }), true);

  // 模拟两个包各自读一次
  const forClassroom = await readCard(ctx);
  const forCampus = await readCard(ctx);
  assert.deepEqual(forClassroom, { username: '3200100000', password: 'pw' });
  assert.deepEqual(forCampus, forClassroom);
});

test('写入带 label，便于在宿主凭据列表里认出用途', async () => {
  const ctx = memoryCtx();
  await writeCard(ctx, { username: 'u', password: 'p' });
  const record = ctx.store.get(CARD_RECORD_KEY);
  assert.equal(record.kind, 'grant');
  // ⚠️ `label` 在 **payload 里**，不在顶层（宿主白名单只收 kind / payload）
  assert.equal(record.payload.label, '浙大一卡通');
});

test('grant 记录只能有 kind 与 payload 两个字段（多一个字段会让工作台起不来）', async () => {
  // 真实故障：把 `label` 放在记录**顶层**时，宿主 `dsh-credentials-local` 的
  // `parseRecord` 白名单校验会抛 `has unknown field "label"`。
  //
  // 关键在抛的**时机**：那是启动加载 `.credentials.yaml` 时（`loadInitial`），
  // 不是写入时。所以后果不是"这次保存失败"，而是**整个工作台启动失败**，
  // 而报错指向 yaml 解析，看不出是哪段代码写的。
  const ctx = memoryCtx();
  await writeCard(ctx, { username: 'u', password: 'p' });
  const viaWrite = ctx.store.get(CARD_RECORD_KEY);
  assert.deepEqual(Object.keys(viaWrite).sort(), ['kind', 'payload'], `实际字段：${Object.keys(viaWrite)}`);

  const ctx2 = memoryCtx();
  await fillCardIfEmpty(ctx2, { username: 'u', password: 'p' });
  const viaFill = ctx2.store.get(CARD_RECORD_KEY);
  assert.deepEqual(Object.keys(viaFill).sort(), ['kind', 'payload'], '回填路径也必须守同一条规则');
});

/* ────────────────────────────────────── 覆盖 vs 补空（两条明确分开的入口） */

/**
 * 这一组守的是**真实竞态**，不是假想。
 *
 * 凭据有两个写入方：设置里的「保存」（`writeCard`，以用户为准）与登录成功后的
 * 回填（`fillCardIfEmpty`，只补空缺）。回填曾经写成"先 readCard 再 writeCard"——
 * 两步之间用户完全可能在设置里点了保存，于是用户刚配的账号被回填静默覆盖。
 * 宿主 `modifyRecord` 的语义是 read-decide-replace under one lock，判空必须和
 * 写入在**同一个回调**里，这正是下面第一条断言在钉的。
 */
test('fillCardIfEmpty：已有凭据时**不得覆盖**（回填竞态的回归守卫）', async () => {
  const ctx = memoryCtx();
  // 用户在设置里配了 A
  assert.equal(await writeCard(ctx, { username: 'A', password: 'pa' }), true);

  // 随后某条代码路径用 B 登录成功，回填
  const filled = await fillCardIfEmpty(ctx, { username: 'B', password: 'pb' });

  assert.equal(filled, false, '已有凭据时回填必须什么都不做');
  assert.deepEqual(await readCard(ctx), { username: 'A', password: 'pa' }, '用户配的那份不能被改掉');
});

test('fillCardIfEmpty：没有凭据时写下去，形状与 writeCard 一致', async () => {
  const ctx = memoryCtx();
  assert.equal(await fillCardIfEmpty(ctx, { username: 'B', password: 'pb' }), true);

  const record = ctx.store.get(CARD_RECORD_KEY);
  assert.equal(record.kind, 'grant');
  // label 在 payload 里（宿主白名单只收 kind / payload，放顶层会让工作台起不来）
  assert.equal(record.payload.label, '浙大一卡通', '回填也必须带用途说明，否则凭据列表里那条看不出用途');
  assert.deepEqual(await readCard(ctx), { username: 'B', password: 'pb' });
});

test('fillCardIfEmpty：判空与写入在同一个 modify 回调里（不是先读后写）', async () => {
  // 用一个"读一次就报错"的服务：先 readCard 再 write 的实现会在这里失败，
  // 而原子实现根本不需要那次额外的读。
  const store = new Map();
  let reads = 0;
  const service = {
    async readRecord() { reads += 1; throw new Error('不该走单独读'); },
    async modifyRecord(key, fn) { store.set(key, fn(store.get(key) ?? null)); return store.get(key); },
    async deleteRecord(key) { store.delete(key); },
  };
  const ctx = { get: (name) => (name === 'credentials' ? service : null) };

  assert.equal(await fillCardIfEmpty(ctx, { username: 'B', password: 'pb' }), true);
  assert.equal(reads, 0, '判空必须发生在 modify 回调内，不能额外读一次');
  assert.deepEqual(await readCard(ctx).catch(() => null), null, '（此桩的 readRecord 恒抛，读不可用是预期的）');
  assert.equal(store.get(CARD_RECORD_KEY).payload.username, 'B', '写入仍然成功');
});

test('fillCardIfEmpty：空账号或没有凭据服务时安全返回 false', async () => {
  const ctx = memoryCtx();
  assert.equal(await fillCardIfEmpty(ctx, { username: '', password: 'p' }), false);
  assert.equal(await fillCardIfEmpty(ctx, { username: 'u', password: '' }), false);
  assert.equal(ctx.store.has(CARD_RECORD_KEY), false, '不该留下半条记录');
  assert.equal(await fillCardIfEmpty(bareCtx, { username: 'u', password: 'p' }), false);
});

test('两条入口的语义不得合流：writeCard 覆盖，fillCardIfEmpty 不覆盖', async () => {
  const ctx = memoryCtx();
  await writeCard(ctx, { username: 'A', password: 'pa' });

  // 设置里再保存一次 = 用户明确要换，必须覆盖
  assert.equal(await writeCard(ctx, { username: 'C', password: 'pc' }), true);
  assert.deepEqual(await readCard(ctx), { username: 'C', password: 'pc' });

  // 回填不覆盖
  assert.equal(await fillCardIfEmpty(ctx, { username: 'D', password: 'pd' }), false);
  assert.deepEqual(await readCard(ctx), { username: 'C', password: 'pc' });
});

/* ────────────────────────────────────── 校验 */

test('账号校验：非空、无空白、不过长', () => {
  assert.equal(normalizeUsername('  3200100000  '), '3200100000', '首尾空白要裁掉');
  assert.equal(normalizeUsername('a b'), null, '中间有空格不接受');
  assert.equal(normalizeUsername(''), null);
  assert.equal(normalizeUsername('x'.repeat(65)), null);
  assert.equal(normalizeUsername('x'.repeat(64)), 'x'.repeat(64), '刚好 64 字要收');
});

test('密码不 trim（空格是密码的一部分）', () => {
  // 裁掉空格会把一个合法密码改坏，用户永远登不上
  assert.equal(normalizePassword('  p@ss  '), '  p@ss  ');
  assert.equal(normalizePassword(''), null);
  assert.equal(normalizePassword('x'.repeat(257)), null);
});

test('写入门槛：账号或密码不合法就不落盘', async () => {
  const ctx = memoryCtx();
  assert.equal(await writeCard(ctx, { username: '', password: 'p' }), false);
  assert.equal(await writeCard(ctx, { username: 'u', password: '' }), false);
  assert.equal(ctx.store.has(CARD_RECORD_KEY), false, '不该留下半条记录');
});

/* ────────────────────────────────────── 路由：密码不回显 */

test('读状态只给打码值，绝不含明文', async () => {
  const ctx = memoryCtx();
  await writeCard(ctx, { username: '3200100000', password: 'TOP-SECRET' });
  const handler = createHandler({ ctx });

  const r = await call(handler, 'GET', '/');
  assert.equal(r.status, 200);
  assert.equal(r.body.card.configured, true);
  assert.equal(r.body.card.username, '3200100000', '账号名可以回显');
  assert.equal(r.body.card.password, MASK);
  assert.equal(JSON.stringify(r.body).includes('TOP-SECRET'), false, '响应里不得出现明文密码');
});

test('未配置时不回任何密码', async () => {
  const r = await call(createHandler({ ctx: memoryCtx() }), 'GET', '/');
  assert.deepEqual(r.body.card, { configured: false, username: '', password: '' });
});

test('密码传打码值表示不改：只改账号时不用重输密码', async () => {
  const ctx = memoryCtx();
  await writeCard(ctx, { username: 'old', password: 'KEEP-ME' });
  const handler = createHandler({ ctx });

  const r = await call(handler, 'POST', '/?save', { username: 'new', password: MASK });
  assert.equal(r.status, 200);
  const stored = await readCard(ctx);
  assert.equal(stored.username, 'new');
  assert.equal(stored.password, 'KEEP-ME', '密码应原样保留');
});

test('从没存过密码却传打码值 → 拒绝（不能存个空密码）', async () => {
  const r = await call(createHandler({ ctx: memoryCtx() }), 'POST', '/?save', {
    username: 'u', password: MASK,
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /还没有保存过密码/);
});

test('路径与写头与客户端常量一致（跨端漂移会表现为"保存没反应"）', () => {
  assert.equal(ROUTE_PATH, '/_dsh/zhiyun-card');
  assert.equal(WRITE_HEADER, 'x-zhiyun-card');
  assert.ok(ROUTE_PATH.startsWith('/_dsh/'), '与宿主其它设置路由同前缀');
});

/* ────────────────────────────────────── 路由：安全边界 */

test('缺写头 → 403（跨站发不出自定义头，这是 CSRF 闸）', async () => {
  const ctx = memoryCtx();
  const handler = createHandler({ ctx });
  const r = await call(handler, 'POST', '/?save', { username: 'u', password: 'p' }, { [WRITE_HEADER]: '' });
  assert.equal(r.status, 403);
  assert.equal(ctx.store.has(CARD_RECORD_KEY), false, '被拒的请求不该落盘');
});

test('非回环 Host → 403（防 DNS rebinding）', async () => {
  const handler = createHandler({ ctx: memoryCtx() });
  for (const host of ['evil.example', '192.168.1.9:43120', '']) {
    const r = await call(handler, 'POST', '/?save', { username: 'u', password: 'p' }, { host });
    assert.equal(r.status, 403, `${host || '(空)'} 应被拒`);
  }
});

test('回环的三种写法都放行', async () => {
  const handler = createHandler({ ctx: memoryCtx() });
  for (const host of ['127.0.0.1:43120', 'localhost:43120', '[::1]:43120']) {
    const r = await call(handler, 'POST', '/?save', { username: `u-${host}`, password: 'p' }, { host });
    assert.equal(r.status, 200, `${host} 应放行`);
  }
});

/* ────────────────────────────────────── 路由：其余 */

test('保存 → 清除 → 状态归零', async () => {
  const ctx = memoryCtx();
  const handler = createHandler({ ctx });

  await call(handler, 'POST', '/?save', { username: 'u', password: 'p' });
  assert.equal((await call(handler, 'GET', '/')).body.card.configured, true);

  const cleared = await call(handler, 'POST', '/?clear', {});
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.card.configured, false);
  assert.equal((await call(handler, 'GET', '/')).body.card.configured, false);
});

test('非法输入各有明确拒绝', async () => {
  const handler = createHandler({ ctx: memoryCtx() });
  let r = await call(handler, 'POST', '/?save', { username: '', password: 'p' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /账号/);

  r = await call(handler, 'POST', '/?save', { username: 'u', password: '' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /密码/);

  r = await call(handler, 'POST', '/?nonsense', {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /未知动作/);

  r = await call(handler, 'GET', '/', undefined, { host: '127.0.0.1' });
  assert.equal(r.status, 200, 'GET 不需要写头');
});

/* ────────────────────────────────────── WebVPN 上网账号（第二份凭据） */

test('WebVPN 上网账号与一卡通是两份独立记录，互不覆盖', async () => {
  // 这是本模块最要紧的边界：WebVPN 认的是「上网账号」，与统一身份认证
  // **是两套系统**。混成一个键的后果是填了网关账号就把一卡通密码冲掉 ——
  // 而两个密码往往并不相同。
  const ctx = memoryCtx();
  const handler = createHandler({ ctx });

  await call(handler, 'POST', '/?save', { username: '学号A', password: 'CAS密码' });
  await call(handler, 'POST', '/?webvpn-save', { username: '学号B', password: '上网密码' });

  const state = (await call(handler, 'GET', '/')).body;
  assert.equal(state.card.username, '学号A');
  assert.equal(state.webvpn.username, '学号B');

  // 底层记录也必须是两个键
  assert.ok(ctx.store.has(CARD_RECORD_KEY));
  assert.ok(ctx.store.has(WEBVPN_RECORD_KEY));
  assert.equal(ctx.store.get(CARD_RECORD_KEY).payload.password, 'CAS密码');
  assert.equal(ctx.store.get(WEBVPN_RECORD_KEY).payload.password, '上网密码');
});

test('清除其中一份不动另一份', async () => {
  const ctx = memoryCtx();
  const handler = createHandler({ ctx });

  await call(handler, 'POST', '/?save', { username: 'A', password: 'p1' });
  await call(handler, 'POST', '/?webvpn-save', { username: 'B', password: 'p2' });

  const cleared = await call(handler, 'POST', '/?webvpn-clear', {});
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.webvpn.configured, false);

  const state = (await call(handler, 'GET', '/')).body;
  assert.equal(state.webvpn.configured, false, 'WebVPN 已清');
  assert.equal(state.card.configured, true, '一卡通不该被顺手清掉');
  assert.equal(state.card.username, 'A');
});

test('两份凭据的密码都不回显明文', async () => {
  const ctx = memoryCtx();
  const handler = createHandler({ ctx });
  await call(handler, 'POST', '/?save', { username: 'A', password: 'CAS-SECRET' });
  await call(handler, 'POST', '/?webvpn-save', { username: 'B', password: 'VPN-SECRET' });

  const raw = JSON.stringify((await call(handler, 'GET', '/')).body);
  assert.equal(raw.includes('CAS-SECRET'), false);
  assert.equal(raw.includes('VPN-SECRET'), false);
  assert.equal(raw.includes(MASK), true, '配过就给打码值，让页面知道"有个密码"');
});

test('WebVPN 那份也遵守「打码值 = 不改」', async () => {
  const ctx = memoryCtx();
  const handler = createHandler({ ctx });
  await call(handler, 'POST', '/?webvpn-save', { username: 'B', password: 'KEEP-ME' });

  // 只改账号，密码传打码值
  const r = await call(handler, 'POST', '/?webvpn-save', { username: 'B2', password: MASK });
  assert.equal(r.status, 200);
  assert.equal(ctx.store.get(WEBVPN_RECORD_KEY).payload.password, 'KEEP-ME');
  assert.equal(ctx.store.get(WEBVPN_RECORD_KEY).payload.username, 'B2');
});

test('WebVPN 凭据记录的形状也只允许 kind + payload', async () => {
  // 宿主 dsh-credentials-local 对 grant 做白名单校验，多一个顶层字段会让
  // **整个工作台起不来**（校验发生在启动加载时）。这条钉住形状。
  const ctx = memoryCtx();
  await writeWebvpn(ctx, { username: 'B', password: 'p' });
  const record = ctx.store.get(WEBVPN_RECORD_KEY);
  assert.deepEqual(Object.keys(record).sort(), ['kind', 'payload']);
  assert.equal(record.kind, 'grant');
  // 用途说明放在 payload 里（宿主不校验 payload 的键）
  assert.equal(record.payload.label, WEBVPN_LABEL);
});

test('WebVPN 凭据的读写在无凭据服务时安全退化', async () => {
  assert.equal(await readWebvpn(bareCtx), null);
  assert.equal(await writeWebvpn(bareCtx, { username: 'B', password: 'p' }), false);
  assert.equal(await clearWebvpn(bareCtx), false);
  assert.deepEqual(await webvpnStatus(bareCtx), { configured: false, username: '' });
});

/* ────────────────────────────────────── CC98 论坛账号（第三份凭据） */

test('CC98 账号是**第三份**独立记录，与一卡通、WebVPN 都不共用', async () => {
  // CC98 有自己的账号体系（openid.cc98.org 的 OAuth2），不是浙大统一认证。
  // 曾经它借用一卡通那份记录，后果是「只有 CC98 账号的人永远登不进去」，
  // 而失败提示还把人指向改一卡通密码 —— 这条钉住那个缺陷不会回归。
  const ctx = memoryCtx();
  const handler = createHandler({ ctx });

  await call(handler, 'POST', '/?save', { username: '学号A', password: 'CAS密码' });
  await call(handler, 'POST', '/?webvpn-save', { username: '学号B', password: '上网密码' });
  await call(handler, 'POST', '/?cc98-save', { username: '论坛ID', password: 'CC98密码' });

  const state = (await call(handler, 'GET', '/')).body;
  assert.equal(state.card.username, '学号A');
  assert.equal(state.webvpn.username, '学号B');
  assert.equal(state.cc98.username, '论坛ID');

  // 三个键，互不相同
  assert.equal(new Set([CARD_RECORD_KEY, WEBVPN_RECORD_KEY, CC98_RECORD_KEY]).size, 3);
  assert.ok(ctx.store.has(CC98_RECORD_KEY));
  assert.equal(ctx.store.get(CC98_RECORD_KEY).payload.password, 'CC98密码');
  assert.equal(ctx.store.get(CARD_RECORD_KEY).payload.password, 'CAS密码', '一卡通不该被覆盖');
});

test('只有 CC98 账号的人也配置得成（不需要学号）', async () => {
  const ctx = memoryCtx();
  const handler = createHandler({ ctx });

  await call(handler, 'POST', '/?cc98-save', { username: 'only-cc98', password: 'p' });

  const state = (await call(handler, 'GET', '/')).body;
  assert.equal(state.cc98.configured, true);
  assert.equal(state.card.configured, false, '一卡通仍然是空的 —— 两者独立');
  assert.equal(await readCard(ctx), null);
  assert.deepEqual(await readCc98(ctx), { username: 'only-cc98', password: 'p' });
});

test('清除 CC98 不动另外两份', async () => {
  const ctx = memoryCtx();
  const handler = createHandler({ ctx });

  await call(handler, 'POST', '/?save', { username: 'A', password: 'p1' });
  await call(handler, 'POST', '/?webvpn-save', { username: 'B', password: 'p2' });
  await call(handler, 'POST', '/?cc98-save', { username: 'C', password: 'p3' });

  const cleared = await call(handler, 'POST', '/?cc98-clear', {});
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.cc98.configured, false);

  const state = (await call(handler, 'GET', '/')).body;
  assert.equal(state.card.configured, true, '一卡通不该被动');
  assert.equal(state.webvpn.configured, true, 'WebVPN 不该被动');
});

test('CC98 密码不回显明文，留空沿用', async () => {
  const ctx = memoryCtx();
  const handler = createHandler({ ctx });

  await call(handler, 'POST', '/?cc98-save', { username: 'C', password: 'CC98-SECRET' });

  const state = (await call(handler, 'GET', '/')).body;
  assert.equal(state.cc98.password, MASK, '只回打码值');
  assert.equal(JSON.stringify(state).includes('CC98-SECRET'), false, '明文不许出现在响应里');

  // 只改账号、密码留空（传打码值）→ 沿用旧密码
  await call(handler, 'POST', '/?cc98-save', { username: 'C2', password: MASK });
  assert.equal((await readCc98(ctx)).password, 'CC98-SECRET');
  assert.equal((await readCc98(ctx)).username, 'C2');
});

test('CC98 凭据记录的形状也只允许 kind + payload', async () => {
  const ctx = memoryCtx();
  await writeCc98(ctx, { username: 'C', password: 'p' });
  const record = ctx.store.get(CC98_RECORD_KEY);
  assert.deepEqual(Object.keys(record).sort(), ['kind', 'payload']);
  assert.equal(record.kind, 'grant');
  assert.equal(record.payload.label, CC98_LABEL);
});

test('CC98 凭据的读写在无凭据服务时安全退化', async () => {
  assert.equal(await readCc98(bareCtx), null);
  assert.equal(await writeCc98(bareCtx, { username: 'C', password: 'p' }), false);
  assert.equal(await clearCc98(bareCtx), false);
  assert.deepEqual(await cc98Status(bareCtx), { configured: false, username: '' });
});

