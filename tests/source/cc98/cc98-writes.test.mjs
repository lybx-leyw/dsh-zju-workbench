/**
 * CC98 写操作的测试。
 *
 * # 测什么
 *
 * `writes.js` 的 **Prepare / Execute 两段式契约**，以及每个动作算出的 body
 * 与说明对不对。全部离线（假 `client`），不联网、不需要令牌。
 *
 * # 为什么 Prepare 与 Execute 要分开测
 *
 * 这是整个写链路的安全边界：**Prepare 绝不能发写请求**。若它偷偷发了，
 * 审批就成了摆设 —— 用户还没看到对话框，帖子已经发出去了。
 * 所以每个动作都断言「Prepare 阶段一次写请求都没有」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCc98Writes } from '../../../packages/source/cc98/src/writes.js';

/** 造一个假 client，记录每次请求。 */
function fakeClient(routes = {}) {
  const calls = [];
  return {
    calls,
    async request(method, path, options = {}) {
      calls.push({ method, path, body: options.body });
      for (const [match, reply] of Object.entries(routes)) {
        if (path.includes(match)) return typeof reply === 'function' ? reply(options) : reply;
      }
      return undefined;
    },
  };
}

/** 只统计写请求（非 GET）。 */
const writes = (calls) => calls.filter((call) => call.method !== 'GET');
const reads = (calls) => calls.filter((call) => call.method === 'GET');

test('两段式：Prepare 不发写请求，Execute 才发', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });

  const summary = await api.likeFloor.prepare({ post: 123 });
  assert.match(summary, /点赞/);
  assert.equal(writes(client.calls).length, 0, '**Prepare 阶段绝不能发写请求**');

  await api.likeFloor.execute();
  assert.equal(writes(client.calls).length, 1, 'Execute 才发');
  assert.equal(writes(client.calls)[0].method, 'PUT');
  assert.equal(writes(client.calls)[0].path, 'post/123/like');
});

test('两段式：没 Prepare 直接 Execute 要报 NEED_PREPARE', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });
  await assert.rejects(() => api.likeFloor.execute(), (error) => {
    assert.equal(error.code, 'NEED_PREPARE');
    return true;
  });
  assert.equal(writes(client.calls).length, 0, '没有参数就不许发');
});

test('两段式：一次 Prepare 只能执行一次（执行后清空）', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });
  await api.likeFloor.prepare({ post: 7 });
  await api.likeFloor.execute();
  await assert.rejects(() => api.likeFloor.execute(), (error) => {
    assert.equal(error.code, 'NEED_PREPARE', '执行过的会话要清空，避免重放');
    return true;
  });
  assert.equal(writes(client.calls).length, 1);
});

test('两段式：同一个动作并发 Prepare 会被拒（防止 A 批准 B 执行）', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });
  await api.likeFloor.prepare({ post: 1 });
  await assert.rejects(() => api.likeFloor.prepare({ post: 2 }), (error) => {
    assert.equal(error.code, 'WRITE_BUSY');
    return true;
  });
});

test('likeFloor：state 决定赞、踩、取消 —— 赞错了要撤得回', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });

  assert.match(await api.likeFloor.prepare({ post: 5 }), /点赞/);
  await api.likeFloor.execute();

  assert.match(await api.likeFloor.prepare({ post: 5, state: 'down' }), /点踩/);
  await api.likeFloor.execute();

  // 平台的口径是「再发一次当前状态即取消」，等价于发 0。
  // 原先只认 1 / 2，于是赞错了撤不回 —— 那是没有回退路径，不是少个选项。
  assert.match(await api.likeFloor.prepare({ post: 5, state: 'none' }), /取消/);
  await api.likeFloor.execute();
  assert.match(await api.likeFloor.prepare({ post: 5, state: 0 }), /取消/);
  await api.likeFloor.execute();

  const bodies = writes(client.calls).map((call) => call.body);
  assert.deepEqual(bodies, ['1', '2', '0', '0'], '赞发 1、踩发 2、取消发 0，且 body 是字符串不是 JSON');
});

test('rateFloor：分值符号决定 type，绝对值进 value', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });

  assert.match(await api.rateFloor.prepare({ post: 9, value: 3, reason: 1 }), /\+3 分/);
  await api.rateFloor.execute();

  assert.match(await api.rateFloor.prepare({ post: 9, value: -2, reason: 1 }), /-2 分/);
  await api.rateFloor.execute();

  // `rateFloor` 给的是 **body 对象**（JSON 序列化在 client 的 `send` 里做），
  // 不是字符串 —— 所以这里直接读对象，不要 JSON.parse。
  const [up, down] = writes(client.calls).map((call) => call.body);
  assert.equal(up.type, 1, '正分是 type 1');
  assert.equal(up.value, 3, 'value 取绝对值');
  assert.equal(down.type, 2, '负分是 type 2');
  assert.equal(down.value, 2);
});

test('rateFloor：缺 reason 或 value 非法要报 INVALID_ARGUMENT', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });
  await assert.rejects(() => api.rateFloor.prepare({ post: 1, value: 3 }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => api.rateFloor.prepare({ post: 1, value: 0, reason: 1 }), (e) => e.code === 'INVALID_ARGUMENT');
  assert.equal(writes(client.calls).length, 0);
});

test('favoriteTopic：默认收藏用 PUT，on:false 用 DELETE', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });

  assert.match(await api.favoriteTopic.prepare({ topic: 3 }), /收藏帖子 3/);
  await api.favoriteTopic.execute();

  assert.match(await api.favoriteTopic.prepare({ topic: 3, on: false }), /取消收藏/);
  await api.favoriteTopic.execute();

  const calls = writes(client.calls);
  assert.equal(calls[0].method, 'PUT');
  assert.match(calls[0].path, /groupid=0/, '收藏要带 groupid');
  assert.equal(calls[1].method, 'DELETE');
});

test('postTopic：标题缺省取正文前 30 字，body 是 form', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });

  const summary = await api.postTopic.prepare({ board: 12, content: '这是一段很长的正文内容用来测试标题缺省行为是否正确处理' });
  assert.match(summary, /版面 12 发帖/);
  await api.postTopic.execute();

  const [call] = writes(client.calls);
  assert.equal(call.method, 'POST');
  assert.equal(call.path, 'topic/12');
  const form = new URLSearchParams(call.body);
  assert.equal(form.get('content'), '这是一段很长的正文内容用来测试标题缺省行为是否正确处理');
  assert.ok(form.get('title').length <= 30, '标题缺省不该超过 30 字');
});

test('postTopic：正文超 8000 字要拒，不静默截断', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });
  await assert.rejects(
    () => api.postTopic.prepare({ board: 1, content: 'x'.repeat(8001) }),
    (e) => e.code === 'INVALID_ARGUMENT',
  );
  assert.equal(writes(client.calls).length, 0);
});

test('replyTopic：匿名与 Markdown 是参数，不是写死的常量', async () => {
  // 原先这两项被写死成 `contentType:'0'` / `anonymous:'false'`，等于
  // **用户选了匿名也发不出去**。所以「不传 = 平台默认」和「传了 = 照传」
  // 两种都要锁住。
  const client = fakeClient();
  const api = createCc98Writes({ client });
  await api.replyTopic.prepare({ topic: 4, content: '同意' });
  await api.replyTopic.execute();

  const plain = new URLSearchParams(writes(client.calls)[0].body);
  assert.equal(plain.get('content'), '同意');
  assert.equal(plain.has('anonymous'), false, '没要求匿名就不该塞这个字段');
  assert.equal(plain.get('contentType'), '0');

  await api.replyTopic.prepare({ topic: 5, content: '匿名说一句', anonymous: true, contentType: 1 });
  await api.replyTopic.execute();
  const anon = new URLSearchParams(writes(client.calls)[1].body);
  assert.equal(anon.get('anonymous'), 'true');
  assert.equal(anon.get('contentType'), '1');
});

test('replyTopic：quote 传楼层号，notifyAll 单独可开关', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });
  await api.replyTopic.prepare({ topic: 9, content: '回应楼上', quote: 12, notifyAll: true });
  await api.replyTopic.execute();

  const form = new URLSearchParams(writes(client.calls)[0].body);
  assert.equal(form.get('quoteId'), '12');
  assert.equal(form.get('notifyAll'), 'true');
  // 说明里要让人看得出这条回复带了什么，审批时才有意义。
  assert.match(await api.replyTopic.prepare({ topic: 9, content: 'x', quote: 12 }), /引用/);
});

test('postTopic：标签能传下去 —— 有必选标签的版面才发得出去', async () => {
  // 原先写死 `tag1: ''`，平台回「请选择标签」，用户却在浏览器里明明能选。
  const client = fakeClient();
  const api = createCc98Writes({ client });
  const summary = await api.postTopic.prepare({ board: 3, content: '出二手', tag1: '交易', tag2: '数码' });
  await api.postTopic.execute();

  const form = new URLSearchParams(writes(client.calls)[0].body);
  assert.equal(form.get('tag1'), '交易');
  assert.equal(form.get('tag2'), '数码');
  assert.match(summary, /标签 交易\/数码/, '审批说明里要显示标签，用户才知道选了什么');
});

test('postTopic：匿名也可传', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });
  await api.postTopic.prepare({ board: 3, content: '匿名帖', anonymous: true });
  await api.postTopic.execute();
  assert.equal(new URLSearchParams(writes(client.calls)[0].body).get('anonymous'), 'true');
});

test('editPost：PUT 到楼层，body 带 content 与 title', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });
  await api.editPost.prepare({ post: 88, content: '改过的内容' });
  await api.editPost.execute();

  const [call] = writes(client.calls);
  assert.equal(call.method, 'PUT');
  assert.equal(call.path, 'post/88');
  const form = new URLSearchParams(call.body);
  assert.equal(form.get('content'), '改过的内容');
});

test('sendMessage：数字 id 直接认', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });
  assert.match(await api.sendMessage.prepare({ recipient: 42, content: '你好' }), /给 42 发私信/);
  await api.sendMessage.execute();

  const [call] = writes(client.calls);
  const form = new URLSearchParams(call.body);
  assert.equal(form.get('toUserId'), '42');
  assert.equal(form.get('content'), '你好');
});

test('signIn：今天签过时说明里要说清，但不阻止执行', async () => {
  const today = new Date().toISOString();
  const client = fakeClient({ me: { lastSignInTime: today } });
  const api = createCc98Writes({ client });

  const summary = await api.signIn.prepare();
  assert.match(summary, /今天已经签到过了/, '重复签到平台不报错，所以说明里要讲清');
  // 说明归说明，不因此抛错 —— 用户可能就是要再点一次。
  await api.signIn.execute();
  assert.equal(writes(client.calls).length, 1);
});

test('signIn：没签过时说明是普通签到', async () => {
  const client = fakeClient({ me: { lastSignInTime: null } });
  const api = createCc98Writes({ client });
  const summary = await api.signIn.prepare();
  assert.equal(summary, 'CC98 每日签到');
});

test('参数校验：id 必须正整数', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });
  for (const bad of [0, -1, 'abc', 1.5, undefined]) {
    await assert.rejects(() => api.likeFloor.prepare({ post: bad }), (e) => e.code === 'INVALID_ARGUMENT');
  }
});

test('sendMessage：给用户名时自己解析成 id（工具层不用去查）', async () => {
  const client = fakeClient();
  const lookups = [];
  const reader = {
    client,
    async user(params) {
      lookups.push(params);
      return { id: 7788, name: '张三' };
    },
  };
  const api = createCc98Writes(reader);

  const summary = await api.sendMessage.prepare({ recipient: '张三', content: '你好' });
  assert.match(summary, /给\s*张三\s*发私信/);
  assert.deepEqual(lookups, [{ name: '张三' }], '要按名字查一次');
  assert.equal(writes(client.calls).length, 0, 'Prepare 阶段不许发写请求');

  await api.sendMessage.execute();
  const form = new URLSearchParams(writes(client.calls)[0].body);
  assert.equal(form.get('toUserId'), '7788', '要用解析出来的 id');
});

test('sendMessage：用户名查不到时要拒，并指出怎么确认', async () => {
  const client = fakeClient();
  const reader = { client, async user() { return { id: null }; } };
  const api = createCc98Writes(reader);
  await assert.rejects(
    () => api.sendMessage.prepare({ recipient: '不存在的人', content: '你好' }),
    (error) => {
      assert.equal(error.code, 'INVALID_ARGUMENT');
      assert.match(error.message, /找不到用户/);
      return true;
    },
  );
  assert.equal(writes(client.calls).length, 0);
});

test('editPost 与 favoriteTopic：topic / post 两种叫法都收（工具层与平台层叫法不同）', async () => {
  const client = fakeClient();
  const api = createCc98Writes({ client });

  await api.editPost.prepare({ post: 88, content: 'x' });
  await api.editPost.execute();
  await api.editPost.prepare({ topic: 99, content: 'y' });
  await api.editPost.execute();

  await api.favoriteTopic.prepare({ topic: 3 });
  await api.favoriteTopic.execute();
  await api.favoriteTopic.prepare({ post: 4 });
  await api.favoriteTopic.execute();

  const paths = writes(client.calls).map((c) => c.path);
  assert.ok(paths.includes('post/88'), 'editPost 用 post');
  assert.ok(paths.includes('post/99'), 'editPost 也认 topic');
  assert.ok(paths.some((p) => p.includes('me/favorite/3')), 'favoriteTopic 用 topic');
  assert.ok(paths.some((p) => p.includes('me/favorite/4')), 'favoriteTopic 也认 post');
});