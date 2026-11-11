/**
 * 素质拓展平台写操作的测试。
 *
 * # 两个要钉住的点
 *
 * 1. **不在平台报名的活动**要如实说去哪报，而不是替用户提交一个必然失败的请求。
 * 2. **按名字找活动时不猜**：匹配到多个就报错并列出候选，因为猜错了会让用户
 *    报错活动 —— 那比报错更糟。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSztzWrites } from '../../../packages/source/sztz/src/writes.js';

/**
 * 造一个假客户端。
 *
 * @param overrides - 覆盖默认值。
 * @returns 假客户端（记录 `call`）。
 */
function fakeClient(overrides = {}) {
  const calls = [];
  const base = {
    async unfinished() {
      return [
        { id: 11, mc: '志愿服务一小时', bmfs: { label: '平台报名' } },
        { id: 12, mc: '线下讲座', bmfs: { label: '线下报名' }, jtbmfs: '到紫金港小剧场门口签到' },
        { id: 13, mc: '同名活动', bmfs: { label: '平台报名' } },
        { id: 14, mc: '同名活动', bmfs: { label: '平台报名' } },
      ];
    },
    async myActivities() {
      return [{ id: 11, mc: '志愿服务一小时' }];
    },
    async call(method, path, params) {
      calls.push({ method, path, params });
      return { code: 0 };
    },
  };
  return { ...base, ...overrides, calls };
}

/** 只统计写请求。 */
const writesOf = (client) => client.calls;


test('两段式：正常报名 —— Prepare 只查询，Execute 才 POST', async () => {
  const client = fakeClient({ async myActivities() { return []; } });
  const api = createSztzWrites(client);

  const summary = await api.signupActivity.prepare({ activity: '志愿服务一小时' });
  assert.match(summary, /报名二课活动：志愿服务一小时/);
  assert.equal(writesOf(client).length, 0, '**Prepare 阶段绝不能发写请求**');

  await api.signupActivity.execute();
  const [call] = writesOf(client);
  assert.equal(call.method, 'POST');
  assert.equal(call.path, 'student/home/hdbm');
  assert.equal(call.params.id, 11);
});

test('两段式：没 Prepare 直接 Execute 报 NEED_PREPARE', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  await assert.rejects(() => api.signupActivity.execute(), (error) => {
    assert.equal(error.code, 'NEED_PREPARE');
    return true;
  });
  assert.equal(writesOf(client).length, 0);
});

test('两段式：并发 Prepare 被拒', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  await api.signupActivity.prepare({ activity: '志愿服务一小时' });
  await assert.rejects(() => api.signupActivity.prepare({ activity: '志愿服务一小时' }), (error) => {
    assert.equal(error.code, 'WRITE_BUSY');
    return true;
  });
});

test('signupActivity：线下报名的活动要如实说去哪报，不提交', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  await assert.rejects(
    () => api.signupActivity.prepare({ activity: '线下讲座' }),
    (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /到紫金港小剧场门口签到/, '要把活动写明的报名方式说出来');
      return true;
    },
  );
  assert.equal(writesOf(client).length, 0, '这种活动不该提交请求');
});

test('signupActivity：已经报过名时说明里要讲清', async () => {
  const client = fakeClient(); // myActivities 默认含 id 11
  const api = createSztzWrites(client);
  const summary = await api.signupActivity.prepare({ activity: '志愿服务一小时' });
  assert.match(summary, /已经报过名/);
});

test('signupActivity：名字匹配到多个要报错并列候选，不许猜', async () => {
  const client = fakeClient({ async myActivities() { return []; } });
  const api = createSztzWrites(client);
  await assert.rejects(
    () => api.signupActivity.prepare({ activity: '同名活动' }),
    (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /2 个活动/, '要说清匹配到几个');
      return true;
    },
  );
});

test('signupActivity：可以用活动编号指定', async () => {
  const client = fakeClient({ async myActivities() { return []; } });
  const api = createSztzWrites(client);
  const summary = await api.signupActivity.prepare({ activity: '13' });
  assert.match(summary, /同名活动/, '按编号也要能定位');
});

test('signupActivity：名字不存在要报错并指出用哪个方法看真实名字', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  await assert.rejects(
    () => api.signupActivity.prepare({ activity: '根本不存在的活动' }),
    (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /listActivities/, '要指导下一步');
      return true;
    },
  );
});

test('cancelActivity：从已报名里找，走 hdqxbm', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);

  const summary = await api.cancelActivity.prepare({ activity: '志愿服务一小时' });
  assert.match(summary, /取消报名/);
  assert.equal(writesOf(client).length, 0);

  await api.cancelActivity.execute();
  const [call] = writesOf(client);
  assert.equal(call.path, 'student/home/hdqxbm');
  assert.equal(call.params.id, 11);
});

test('cancelActivity：没报名的活动要拒（两个集合不重叠）', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  await assert.rejects(
    () => api.cancelActivity.prepare({ activity: '线下讲座' }),
    (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /myActivities/, '要指出用哪个方法看已报名');
      return true;
    },
  );
  assert.equal(writesOf(client).length, 0);
});

test('参数校验：空活动名要拒', async () => {
  const client = fakeClient();
  const api = createSztzWrites(client);
  await assert.rejects(() => api.signupActivity.prepare({}), (e) => e.code === 'CONFIG');
  await assert.rejects(() => api.cancelActivity.prepare({ activity: '  ' }), (e) => e.code === 'CONFIG');
});
