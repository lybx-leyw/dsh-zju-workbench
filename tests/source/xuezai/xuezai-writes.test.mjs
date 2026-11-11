/**
 * 学在浙大写操作的测试。
 *
 * # 这个文件补的是「工具与 source 的契约断裂」
 *
 * 批次 A 审计发现三处**参数名错位**，它们让写操作在实机上必抛：
 *
 * | 工具传的 | source 那时读的 | 症状 |
 * | --- | --- | --- |
 * | `content` | `comment` | 正文被**静默丢弃** → 报「交白卷」 |
 * | `{course, code}` | `{rollcall, latitude, longitude}` | 恒失败 |
 *
 * 两处都改了契约（source 同时接受两种叫法 / 自己按参考点试坐标）。
 * 这组测试钉住新契约。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createXuezaiWrites } from '../../../packages/source/xuezai/src/writes.js';

/**
 * 造一个假 reader。
 *
 * @param overrides - 覆盖默认方法。
 * @returns 假 reader（记录 `json` 与 `transport.request`）。
 */
function fakeReader(overrides = {}) {
  const calls = [];
  const base = {
    async todos() {
      return { xzzd: { rows: [
        { id: 101, title: '第三次作业', course_name: '机器学习' },
        { id: 202, title: '第 3 次点名', course_name: '机器学习' },
      ] } };
    },
    async activitySubmission(activity) {
      const id = Number(activity?.id ?? activity);
      if (id !== 101) return { latestSubmission: null };
      // 提交前后要给出不同结果 —— 回查的意义就在「提交之后能看到新内容」。
      // 若这里永远返回同一条旧记录，`matchSubmission` 会正确地报「没确认」，
      // 那是实现对的、夹具错的。
      const submitted = calls.some((c) => c.kind === 'json' && c.url.includes('/submissions'));
      return submitted
        ? { latestSubmission: { id: 'sub-2', is_draft: false, comment: '我的答案', uploads: [] } }
        : { latestSubmission: { id: 'sub-1', is_draft: false, comment: '旧内容', uploads: [] } };
    },
    async json(url, options) {
      calls.push({ kind: 'json', url, method: options?.method, body: options?.body });
      return { id: 5, upload_url: 'https://upload.example.com/put' };
    },
    transport: {
      async request(url, options) {
        calls.push({ kind: 'net', url, method: options?.method, body: options?.body });
        // 参考点第一个就签上
        return { status: 200, async text() { return JSON.stringify({ status: 'on_call' }); } };
      },
    },
  };
  return { ...base, ...overrides, calls };
}

test('提交作业：工具传 content 也能收到（先前会被静默丢弃）', async () => {
  const reader = fakeReader();
  const api = createXuezaiWrites(reader);

  // 工具层传的是 `content`，source 以前只读 `comment` → 报「交白卷」
  const summary = await api.submitHomework.prepare({ homework: 101, comment: '我的答案' });
  assert.match(summary, /交作业/);
  assert.match(summary, /4 字正文/, '正文不能丢');

  await api.submitHomework.execute();
  const post = reader.calls.find((c) => c.kind === 'json' && c.url.includes('/submissions'));
  assert.equal(post.body.comment, '我的答案', '正文要原样进 comment 字段');
  assert.equal(post.body.is_draft, false);
});

test('提交作业：content 这个叫法也认', async () => {
  const reader = fakeReader();
  const api = createXuezaiWrites(reader);
  const summary = await api.submitHomework.prepare({ homework: 101, content: '用 content 传的' });
  assert.match(summary, /\d+ 字正文/, 'content 也要当成正文');
});

test('提交作业：既没文件也没正文要拒', async () => {
  const reader = fakeReader();
  const api = createXuezaiWrites(reader);
  await assert.rejects(
    () => api.submitHomework.prepare({ homework: 101 }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /至少要有一个文件或一段正文/);
      return true;
    },
  );
});

test('提交作业：小组作业要拒（接口只支持个人）', async () => {
  const reader = fakeReader({
    async todos() {
      return { xzzd: { rows: [{ id: 303, title: '小组作业', group_set_id: 7 }] } };
    },
  });
  const api = createXuezaiWrites(reader);
  await assert.rejects(
    () => api.submitHomework.prepare({ homework: 303, comment: 'x' }),
    (error) => {
      assert.equal(error.code, 'UNSUPPORTED');
      assert.match(error.message, /小组作业/);
      return true;
    },
  );
});

test('签到：不给坐标时按校园参考点逐个试（先前恒失败）', async () => {
  const reader = fakeReader();
  const api = createXuezaiWrites(reader);

  // 工具层传的是 { course, code } 之类，**不传坐标**
  const summary = await api.rollcall.prepare({ rollcall: 202 });
  assert.match(summary, /课堂签到/);
  assert.match(summary, /个校园参考点逐个试/, '要说明用的是参考点策略');

  await api.rollcall.execute();
  const puts = reader.calls.filter((c) => c.kind === 'net');
  assert.equal(puts.length, 1, '第一个参考点就签上了，不该继续试');
  assert.match(puts[0].url, /\/api\/rollcall\/202\/answer\?api_version=1\.1\.2/);

  const body = JSON.parse(puts[0].body);
  assert.equal(body.latitude, 30.302331, '首选点是 ZJGD1');
  assert.equal(body.longitude, 120.089136);
  assert.ok(body.deviceId, '要带 deviceId');
});

test('签到：给了坐标就用给的（最准的那一档）', async () => {
  const reader = fakeReader();
  const api = createXuezaiWrites(reader);
  const summary = await api.rollcall.prepare({ rollcall: 202, latitude: 30.3, longitude: 120.1 });
  assert.match(summary, /给定位置/);

  await api.rollcall.execute();
  const body = JSON.parse(reader.calls.find((c) => c.kind === 'net').body);
  assert.equal(body.latitude, 30.3);
  assert.equal(body.longitude, 120.1);
});

test('签到：给了参考点名就用那一个', async () => {
  const reader = fakeReader();
  const api = createXuezaiWrites(reader);
  const summary = await api.rollcall.prepare({ rollcall: 202, point: 'zjgx1' });
  assert.match(summary, /参考点 ZJGX1/, '名字大小写归一');

  await api.rollcall.execute();
  const body = JSON.parse(reader.calls.find((c) => c.kind === 'net').body);
  assert.equal(body.latitude, 30.30173);
});

test('签到：不认识的参考点名要拒并列出可用的', async () => {
  const reader = fakeReader();
  const api = createXuezaiWrites(reader);
  await assert.rejects(
    () => api.rollcall.prepare({ rollcall: 202, point: 'XXX' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /ZJGD1/, '要列出可用的参考点');
      return true;
    },
  );
});

test('签到：全部参考点都失败时如实报试了几次', async () => {
  const reader = fakeReader({
    transport: {
      async request() {
        return { status: 200, async text() { return JSON.stringify({ status: 'not_on_call', distance: 120 }); } };
      },
    },
  });
  const api = createXuezaiWrites(reader);
  await api.rollcall.prepare({ rollcall: 202 });
  await assert.rejects(
    () => api.rollcall.execute(),
    (error) => {
      assert.equal(error.code, 'REJECTED');
      assert.match(error.message, /试了 13 个参考点/, '要如实报次数');
      assert.equal(error.details.tries, 13);
      assert.equal(error.details.distances, 13, '每点都回了距离');
      return true;
    },
  );
});

test('签到：数字口令走另一条接口，不带坐标', async () => {
  const reader = fakeReader({
    transport: {
      async request(url, options) {
        reader.calls.push({ kind: 'net', url, method: options?.method, body: options?.body });
        return { status: 200, async text() { return JSON.stringify({ status: 'on_call_fine' }); } };
      },
    },
  });
  const api = createXuezaiWrites(reader);
  const summary = await api.rollcall.prepare({ rollcall: 202, code: '1234' });
  assert.match(summary, /数字口令 1234/);

  await api.rollcall.execute();
  const call = reader.calls.find((c) => c.kind === 'net');
  assert.match(call.url, /answer_number_rollcall/, '数字点名是另一个端点');
  const body = JSON.parse(call.body);
  assert.equal(body.number, '1234');
  assert.equal(body.latitude, undefined, '数字点名不带坐标');
});

test('撤回：最近一次是草稿时直接返回，不发请求', async () => {
  const reader = fakeReader({
    async activitySubmission() {
      return { latestSubmission: { id: 'draft-1', is_draft: true } };
    },
  });
  const api = createXuezaiWrites(reader);
  const summary = await api.retractHomework.prepare({ homework: 101 });
  assert.match(summary, /已经是草稿/);

  await api.retractHomework.execute();
  assert.equal(reader.calls.filter((c) => c.kind === 'json').length, 0, '草稿不用撤回');
});

test('撤回：没有提交记录要拒', async () => {
  const reader = fakeReader();
  const api = createXuezaiWrites(reader);
  await assert.rejects(
    () => api.retractHomework.prepare({ homework: 202 }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /还没有提交记录/);
      return true;
    },
  );
});

test('并发 Prepare 被拒（防止 A 批准 B 执行）', async () => {
  const reader = fakeReader();
  const api = createXuezaiWrites(reader);
  await api.submitHomework.prepare({ homework: 101, comment: 'a' });
  await assert.rejects(
    () => api.submitHomework.prepare({ homework: 101, comment: 'b' }),
    (error) => {
      assert.equal(error.code, 'WRITE_BUSY');
      return true;
    },
  );
});
