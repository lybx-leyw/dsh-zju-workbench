/**
 * 实验课平台写操作的测试。
 *
 * # 重点
 *
 * `lab` 的写操作比 `cc98` 复杂：选实验要**先查三个 id**（课程、班次、周次段）
 * 才能提交。所以这里除了两段式契约，还要钉住那几条前置校验 ——
 * 周次段必须是班次真的提供的那几个之一，猜一个会被平台拒，
 * 而那种拒绝的文案只说「参数错误」，用户看不出是周次写错了。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createLabWrites } from '../../../packages/source/lab/src/writes.js';

/**
 * 造一个假客户端。
 *
 * @param overrides - 覆盖默认的只读方法。
 * @returns 假客户端（记录 `raw` 调用）。
 */
function fakeClient(overrides = {}) {
  const calls = [];
  const base = {
    auth: { username: 'student-fixture' },
    async termId() { return 7; },
    async myCourses() { return [{ id: 101, courseName: '大学物理实验' }]; },
    async labs() {
      return [{ id: 201, labName: '实验一', weeks: ['1,2', '3,4'] }];
    },
    async mySelections() { return []; },
    async raw(path, data, method) {
      calls.push({ path, data, method });
      return { code: 200 };
    },
  };
  return { ...base, ...overrides, calls };
}

/** 只统计写请求（`raw` 被调用即写）。 */
const writesOf = (client) => client.calls;

test('两段式：Prepare 不发写请求，Execute 才发', async () => {
  const client = fakeClient();
  const api = createLabWrites(client);

  const summary = await api.selectLab.prepare({ course: 101, lab: 201, week: '1,2' });
  assert.match(summary, /选实验：大学物理实验/);
  assert.match(summary, /实验一/);
  assert.equal(writesOf(client).length, 0, '**Prepare 阶段绝不能发写请求**');

  await api.selectLab.execute();
  assert.equal(writesOf(client).length, 1);
  assert.equal(writesOf(client)[0].method, 'POST');
});

test('两段式：没 Prepare 直接 Execute 报 NEED_PREPARE', async () => {
  const client = fakeClient();
  const api = createLabWrites(client);
  await assert.rejects(() => api.selectLab.execute(), (error) => {
    assert.equal(error.code, 'NEED_PREPARE');
    return true;
  });
  assert.equal(writesOf(client).length, 0);
});

test('两段式：并发 Prepare 被拒', async () => {
  const client = fakeClient();
  const api = createLabWrites(client);
  await api.selectLab.prepare({ course: 101, lab: 201, week: '1,2' });
  await assert.rejects(() => api.selectLab.prepare({ course: 101, lab: 201, week: '3,4' }), (error) => {
    assert.equal(error.code, 'WRITE_BUSY');
    return true;
  });
});

test('selectLab：body 带齐五个字段', async () => {
  const client = fakeClient();
  const api = createLabWrites(client);
  await api.selectLab.prepare({ course: 101, lab: 201, week: '1,2' });
  await api.selectLab.execute();

  const [call] = writesOf(client);
  assert.equal(call.path, '/api/course/lab/students');
  assert.deepEqual(call.data, {
    courseId: 101,
    courseLabId: 201,
    uid: 'student-fixture',
    termId: 7,
    selectWeek: '1,2',
  });
});

test('selectLab：周次段不在班次的可选列表里要拒（否则平台只说参数错误）', async () => {
  const client = fakeClient();
  const api = createLabWrites(client);
  await assert.rejects(
    () => api.selectLab.prepare({ course: 101, lab: 201, week: '9,10' }),
    (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /1,2 \/ 3,4/, '要把可选周次列出来');
      return true;
    },
  );
  assert.equal(writesOf(client).length, 0);
});

test('selectLab：课程或班次不存在要拒', async () => {
  const client = fakeClient();
  const api = createLabWrites(client);
  await assert.rejects(() => api.selectLab.prepare({ course: 999, lab: 201, week: '1,2' }), (e) => e.code === 'CONFIG');
  await assert.rejects(() => api.selectLab.prepare({ course: 101, lab: 999, week: '1,2' }), (e) => e.code === 'CONFIG');
});

test('selectLab：已经选过时说明里要讲清', async () => {
  const client = fakeClient({
    async mySelections() { return [{ id: 1, courseLabId: 201, selectWeek: '1,2' }]; },
  });
  const api = createLabWrites(client);
  const summary = await api.selectLab.prepare({ course: 101, lab: 201, week: '1,2' });
  assert.match(summary, /已经选过/, '重复提交平台会拒，说明里先讲清');
});

test('cancelLab：退选走 del/{记录id}', async () => {
  const client = fakeClient({
    async mySelections() { return [{ id: 55, courseLabId: 201, selectWeek: '1,2', labName: '实验一' }]; },
  });
  const api = createLabWrites(client);

  const summary = await api.cancelLab.prepare({ record: 55 });
  assert.match(summary, /退选实验/);
  assert.equal(writesOf(client).length, 0);

  await api.cancelLab.execute();
  const [call] = writesOf(client);
  assert.equal(call.path, '/api/course/lab/students/del/55');
  assert.equal(call.method, 'POST');
});

test('cancelLab：记录编号不存在要拒', async () => {
  const client = fakeClient();
  const api = createLabWrites(client);
  await assert.rejects(() => api.cancelLab.prepare({ record: 999 }), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /mySelections/, '要告诉用户去哪看真实编号');
    return true;
  });
});

test('参数校验：课程、班次必须是正整数', async () => {
  const client = fakeClient();
  const api = createLabWrites(client);
  for (const bad of [0, -1, 'abc', 1.5]) {
    await assert.rejects(() => api.selectLab.prepare({ course: bad, lab: 201, week: '1,2' }), (e) => e.code === 'CONFIG');
    await assert.rejects(() => api.selectLab.prepare({ course: 101, lab: bad, week: '1,2' }), (e) => e.code === 'CONFIG');
  }
});

test('参数校验：缺 week 要拒', async () => {
  const client = fakeClient();
  const api = createLabWrites(client);
  await assert.rejects(() => api.selectLab.prepare({ course: 101, lab: 201 }), (e) => e.code === 'CONFIG');
});
