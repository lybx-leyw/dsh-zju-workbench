/**
 * 素质拓展平台**收藏 / 取消收藏**的测试（上游 `sztz activity favorite`，W-3）。
 *
 * # 为什么这一组要单独一个文件
 *
 * 收藏不只是「又多一个写动作」。`student/home/hdsc` 是**开关**接口：同一个 id
 * 再发一次，收藏就变回未收藏。于是有三条别的写动作不需要的判据：
 *
 * 1. **状态已经符合时一个请求都不发**。否则「已经收藏过」会被真正发出去，
 *    结果是把用户的收藏**取消**掉 —— 那不是没做成，是反着做了。
 * 2. **写请求不重发**。断线重发等于第二次翻转，用户以为只点了一次。
 * 3. **收藏与取消收藏是两个独立的写会话**。共用一个会让「准备收藏」被
 *    「准备取消收藏」撞成 `WRITE_BUSY`，而那是两件事。
 *
 * 另外两条与其它写动作共同的铁律也在这里钉一下：Prepare 不发写请求、
 * 审批被拒后能立刻重试（这一条在 `tests/tool/sztz/` 里从工具层验）。
 *
 * 全部离线：假 client，记录每一次 `call` / `write`。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSztzWrites } from '../../../packages/source/sztz/src/writes.js';

/**
 * 造一个假客户端。
 *
 * # 为什么带 `myList`
 *
 * 真 `Sztz` 有 `myList(action)`（返回**平台原始记录**，带 `id`），而
 * `myActivities()` 返回的是 `{ signedUp, favorites, recognized, … }` 的
 * **视图**，细项里**没有 `id`**。写动作需要 id，所以只能读 `myList`。
 * 假替身必须跟真形状一致，否则测的是「假客户端的形状」而不是实现。
 *
 * @param overrides - 覆盖默认值。
 * @returns 假客户端（`calls` 记录所有网络动作）。
 */
function fakeClient(overrides = {}) {
  const calls = [];
  const lists = { 0: [], 1: [], 2: [] };
  const base = {
    lists,
    async myList(action) {
      return lists[action] ?? [];
    },
    async myActivities() {
      // 真实现的形状：对象 + 视图细项（**没有 id**）。
      const view = (rows) => rows.map((row) => ({ name: row.mc, status: '报名中' }));
      return {
        signedUp: view(lists[0]),
        favorites: view(lists[1]),
        recognized: view(lists[2]),
        counts: { signedUp: lists[0].length, favorites: lists[1].length, recognized: lists[2].length },
      };
    },
    async unfinished() {
      return [
        { id: 11, mc: '志愿服务一小时' },
        { id: 12, mc: '线下讲座' },
        { id: 13, mc: '同名活动' },
        { id: 14, mc: '同名活动' },
      ];
    },
    async call(method, path, params) {
      calls.push({ kind: 'call', method, path, params });
      return { code: 0 };
    },
    async write(path, params) {
      calls.push({ kind: 'write', path, params });
      return { code: 0, msg: '' };
    },
  };
  return { ...base, ...overrides, calls };
}

/** 网络动作数（写请求都在这里）。 */
const writesOf = (client) => client.calls;

/* ─────────────────────────── 收藏 ─────────────────────────── */

test('收藏：Prepare 只查询，Execute 才发请求，且走不重发的 write()', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);

  const summary = await api.favoriteActivity.prepare({ activity: '志愿服务一小时' });
  assert.match(summary, /收藏二课活动：志愿服务一小时/);
  assert.equal(writesOf(client).length, 0, '**Prepare 阶段绝不能发写请求**');

  await api.favoriteActivity.execute();
  const [call] = writesOf(client);
  assert.equal(call.kind, 'write', '收藏是开关，必须走不重发的 write()，不能走 call()');
  assert.equal(call.path, 'student/home/hdsc');
  assert.equal(call.params.id, 11);
});

test('收藏：已经收藏过的**一个请求都不发**（开关再发一次就是取消收藏）', async () => {
  const client = fakeClient();
  client.lists[1] = [{ id: 11, mc: '志愿服务一小时' }];
  const api = createSztzWrites(client);

  const summary = await api.favoriteActivity.prepare({ activity: '志愿服务一小时' });
  assert.match(summary, /已经收藏过/, '要如实说已经收藏');
  assert.match(summary, /没有提交/, '要让用户知道这次不会动平台状态');

  const result = await api.favoriteActivity.execute();
  assert.equal(result.skipped, true);
  assert.equal(result.favorite, true);
  assert.equal(writesOf(client).length, 0, '状态已符合时发出去就是反向操作');
});

test('收藏：平台回 code 非 0 时如实转述原因，不吞掉', async () => {
  const client = fakeClient({
    async write(path, params) {
      client.calls.push({ kind: 'write', path, params });
      return { code: 500, msg: '活动已下架' };
    },
  });
  const api = createSztzWrites(client);
  await api.favoriteActivity.prepare({ activity: '志愿服务一小时' });
  await assert.rejects(
    () => api.favoriteActivity.execute(),
    (error) => {
      assert.equal(error.code, 'REJECTED');
      assert.match(error.message, /活动已下架/, '要转述平台给的原因');
      assert.equal(error.details.id, 11);
      return true;
    },
  );
});

/* ─────────────────────────── 取消收藏 ─────────────────────────── */

test('取消收藏：从**收藏列表**里找，走 hdsc', async () => {
  const client = fakeClient();
  client.lists[1] = [{ id: 11, mc: '志愿服务一小时' }];
  const api = createSztzWrites(client);

  const summary = await api.unfavoriteActivity.prepare({ activity: '志愿服务一小时' });
  assert.match(summary, /取消收藏：志愿服务一小时/);
  assert.equal(writesOf(client).length, 0);

  await api.unfavoriteActivity.execute();
  const [call] = writesOf(client);
  assert.equal(call.kind, 'write');
  assert.equal(call.path, 'student/home/hdsc');
  assert.equal(call.params.id, 11);
});

test('取消收藏：不在收藏里时不许提交，也不许去「未结束活动」里找', async () => {
  // 两个集合不重叠：活动 11 还在活动中心里，但用户并没有收藏它。
  // 若取消收藏走 `unfinished()` 去找，就会误以为「找到了」并发出一次翻转。
  const client = fakeClient();
  const api = createSztzWrites(client);

  await assert.rejects(
    () => api.unfavoriteActivity.prepare({ activity: '志愿服务一小时' }),
    (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /不在你的收藏里/);
      assert.match(error.message, /myActivities/, '要指出用哪个方法看已收藏');
      return true;
    },
  );
  assert.equal(writesOf(client).length, 0);
});

/* ─────────────────────────── 三段契约 ─────────────────────────── */

test('三段契约：两个收藏方向都能在审批被拒后**立刻**重试（不 WRITE_BUSY）', async () => {
  // `cancel()` 是「审批被拒 / 超时 / 中止」时的撤销入口。缺了它或者没接上，
  // 下一次 `prepare` 会撞 WRITE_BUSY —— 这个动作此后一直不能用，直到重启进程。
  for (const [name, api] of [
    ['favoriteActivity', (client) => createSztzWrites(client).favoriteActivity],
    ['unfavoriteActivity', (client) => createSztzWrites(client).unfavoriteActivity],
  ]) {
    const client = fakeClient();
    client.lists[1] = [{ id: 11, mc: '志愿服务一小时' }];
    const action = api(client);

    await action.prepare({ activity: '志愿服务一小时' });
    await action.cancel(); // 模拟审批被拒：工具层调 cancel 撤销会话
    const summary = await action.prepare({ activity: '志愿服务一小时' });
    assert.ok(typeof summary === 'string', `${name} 撤销后必须能立刻重新准备`);
    assert.equal(writesOf(client).length, 0, '两次 Prepare 都不许发写请求');
  }
});

test('三段契约：Execute 之后会话清空，可以马上再来一次', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  await api.favoriteActivity.prepare({ activity: '志愿服务一小时' });
  await api.favoriteActivity.execute();
  // 第二次（状态这次已经收藏 → 不再提交，但 prepare 必须走得通）
  client.lists[1] = [{ id: 11, mc: '志愿服务一小时' }];
  const summary = await api.favoriteActivity.prepare({ activity: '志愿服务一小时' });
  assert.match(summary, /已经收藏过/);
});

test('两段式：没 Prepare 直接 Execute 报 NEED_PREPARE', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  await assert.rejects(
    () => api.favoriteActivity.execute(),
    (error) => {
      assert.equal(error.code, 'NEED_PREPARE');
      return true;
    },
  );
  assert.equal(writesOf(client).length, 0);
});

test('两个收藏方向是**独立的会话**：准备收藏不会让取消收藏撞 WRITE_BUSY', async () => {
  const client = fakeClient();
  // 活动 11 已在收藏里：那样「准备取消收藏」才走得通（它只从收藏列表找）。
  client.lists[1] = [{ id: 11, mc: '志愿服务一小时' }];
  const api = createSztzWrites(client);

  await api.favoriteActivity.prepare({ activity: '志愿服务一小时' });
  // 同一个 client 上另一个方向也能准备 —— 它们是两件事。
  const summary = await api.unfavoriteActivity.prepare({ activity: '志愿服务一小时' });
  assert.match(summary, /取消收藏/);
  assert.equal(writesOf(client).length, 0);
});

test('参数校验：空活动名要拒（两个方向都拒）', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  await assert.rejects(() => api.favoriteActivity.prepare({}), (e) => e.code === 'CONFIG');
  await assert.rejects(() => api.favoriteActivity.prepare({ activity: '  ' }), (e) => e.code === 'CONFIG');
  await assert.rejects(() => api.unfavoriteActivity.prepare({}), (e) => e.code === 'CONFIG');
  await assert.rejects(() => api.unfavoriteActivity.prepare({ activity: '  ' }), (e) => e.code === 'CONFIG');
});

test('收藏：名字匹配到多个要报错并列候选，不许猜', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  await assert.rejects(
    () => api.favoriteActivity.prepare({ activity: '同名活动' }),
    (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /2 个活动/, '要说清匹配到几个');
      return true;
    },
  );
});

test('收藏：找不到要指导下一步（用 listActivities 看真实名字）', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  await assert.rejects(
    () => api.favoriteActivity.prepare({ activity: '根本不存在的活动' }),
    (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /listActivities/);
      return true;
    },
  );
});

test('收藏：可以用活动编号指定', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  const summary = await api.favoriteActivity.prepare({ activity: '13' });
  assert.match(summary, /同名活动/, '按编号也要能定位');
});

/* ────────────────────── 与报名两条的共存 ────────────────────── */

test('已报名的数据来源：报名与取消也从 myList(0) 取，不读没有 id 的视图', async () => {
  // 这条钉住一个曾经的实机缺陷：`myActivities()` 的细项经 `activityView` 转换后
  // **没有 `id`**，而报名 / 取消要按 id 提交。读它会导致每次都当成「没报过」。
  const client = fakeClient();
  client.lists[0] = [{ id: 11, mc: '志愿服务一小时' }];
  const api = createSztzWrites(client);

  const summary = await api.signupActivity.prepare({ activity: '志愿服务一小时' });
  assert.match(summary, /已经报过名/, '要从带 id 的原始记录判断');

  await api.cancelActivity.prepare({ activity: '志愿服务一小时' });
  await api.cancelActivity.execute();
  assert.equal(writesOf(client).at(-1).path, 'student/home/hdqxbm');
  assert.equal(writesOf(client).at(-1).params.id, 11);
});
