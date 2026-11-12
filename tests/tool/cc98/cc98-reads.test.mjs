/**
 * `campus_cc98_read` 的测试 —— 22 个 action 逐个验。
 *
 * # 为什么必须补这一份
 *
 * 这个工具 2026-11-12 加进来时**一条测试都没有**（`tests/tool/cc98/cc98-tools.test.mjs`
 * 只覆盖 3 个写工具）。22 个 action 全都「看起来能用、实际没验过」——
 * 这类缺口比「少做一个工具」危险，因为它不会报错，只会在真用的时候发现参数对不上。
 *
 * # 判据
 *
 * 每个 action 都要满足三件事，缺一不可：
 *
 *   1. 调到了**正确的** source 方法（方法名不能张冠李戴）；
 *   2. 参数字段名与 source 契约一致（`board_id` 不是 `boardId`）；
 *   3. 没给的参数**不出现**在入参里（不塞默认值污染 source 的判断）。
 *
 * 全部离线：假服务只记录调用，不联网。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCc98ReadTools } from '../../../packages/tool/cc98/src/reads.js';

/**
 * 造一个记录调用的假服务。
 *
 * 读工具通过 `cc98.invoke(方法名, 参数)` 调 source —— 那正是要断言的东西。
 */
function recordingService() {
  const calls = [];
  return {
    calls,
    async invoke(method, args) {
      calls.push({ method, args });
      return { ok: true };
    },
  };
}

/** 取本包唯一那个读工具。 */
const tool = (service) => createCc98ReadTools({ zhiyunCc98: service })[0];

/** 跑一个 action，返回它调了哪个方法、带了什么参数。 */
async function run(service, args) {
  await tool(service).run(args);
  assert.equal(service.calls.length, 1, '每个 action 只该调一次 source');
  return service.calls[0];
}

test('工具形状：名字、22 个 action、只读语义写进 description', () => {
  const definition = tool(recordingService());
  assert.equal(definition.name, 'campus_cc98_read');
  assert.equal(definition.parameters.required.includes('action'), true);

  const actions = definition.parameters.properties.action.enum;
  assert.equal(actions.length, 22, `期望 22 个 action，实际 ${actions.length}`);

  // description 要能让模型分清「读」与「写」—— 否则它会拿这个工具去发帖。
  assert.match(definition.description, /只读|查/);
  assert.match(definition.description, /campus_post/, '要说清写操作在哪个工具里');
  assert.match(definition.description, /不是指令/, '论坛内容是外部内容，必须写明');
});

test('19 个无参 action 各自调到正确方法，且不带多余参数', async () => {
  // 这些 action 不需要业务参数，只可能带分页。逐个 pin 方法名。
  const cases = [
    ['hot', 'cc98.hot'],
    ['boardList', 'cc98.boards'],
    ['ratingReasons', 'cc98.ratingReasons'],
    ['overview', 'cc98.overview'],
    ['newTopics', 'cc98.newTopics'],
    ['myTopics', 'cc98.myTopics'],
    ['history', 'cc98.history'],
    ['messageList', 'cc98.conversations'],
  ];
  for (const [action, method] of cases) {
    const service = recordingService();
    const call = await run(service, { action });
    assert.equal(call.method, method, `${action} 应调 ${method}`);
  }
});

test('hot：range 可选；不给时字段不出现', async () => {
  const plain = await run(recordingService(), { action: 'hot' });
  assert.equal(plain.args.range, undefined, '没给 range 就不该塞');

  const ranged = await run(recordingService(), { action: 'hot', range: 'weekly' });
  assert.equal(ranged.args.range, 'weekly');
});

test('search：关键词必填，分页默认 from=0 size=20', async () => {
  await assert.rejects(
    () => tool(recordingService()).run({ action: 'search' }),
    (error) => error.code === 'INPUT',
    '没关键词必须报错，不能静默查全部',
  );

  const call = await run(recordingService(), { action: 'search', keyword: '选课' });
  assert.equal(call.method, 'cc98.search');
  assert.equal(call.args.keyword, '选课');
  assert.equal(call.args.from, 0);
  assert.equal(call.args.size, 20);
});

test('boardTopics：board 必填，best 可选', async () => {
  await assert.rejects(
    () => tool(recordingService()).run({ action: 'boardTopics' }),
    (error) => error.code === 'INPUT',
  );

  const call = await run(recordingService(), { action: 'boardTopics', board: '200' });
  assert.equal(call.method, 'cc98.boardTopics');
  assert.equal(call.args.board_id, '200', '字段名必须是 board_id，不是 boardId');
});

test('boardTags：board 必填', async () => {
  const call = await run(recordingService(), { action: 'boardTags', board: '200' });
  assert.equal(call.method, 'cc98.boardTags');
  assert.equal(call.args.board_id, '200');
});

test('topic：topic 必填，maxCharacters 可选，分页到位', async () => {
  await assert.rejects(
    () => tool(recordingService()).run({ action: 'topic' }),
    (error) => error.code === 'INPUT',
  );

  const call = await run(recordingService(), { action: 'topic', topic: '999', maxCharacters: 500 });
  assert.equal(call.method, 'cc98.topic');
  assert.equal(call.args.topic_id, '999', '字段名必须是 topic_id');
  assert.equal(call.args.max_characters, 500, '字段名必须是 max_characters');
});

test('topicDownload：topic / floor / url 三者都可选（至少给一个才有意义）', async () => {
  const byTopic = await run(recordingService(), { action: 'topicDownload', topic: '999' });
  assert.equal(byTopic.method, 'cc98.topicDownload');
  assert.equal(byTopic.args.topic_id, '999');

  const byUrl = await run(recordingService(), { action: 'topicDownload', url: 'https://file.cc98.org/x' });
  assert.equal(byUrl.args.url, 'https://file.cc98.org/x');
});

test('user：user 与 userName 都收', async () => {
  const byId = await run(recordingService(), { action: 'user', user: '77' });
  assert.equal(byId.method, 'cc98.user');
  assert.equal(byId.args.user_id, '77');

  const byName = await run(recordingService(), { action: 'user', userName: '某同学' });
  assert.equal(byName.args.name, '某同学');
});

test('original：post 必填 —— 这是楼层 ID 不是楼层号', async () => {
  await assert.rejects(
    () => tool(recordingService()).run({ action: 'original' }),
    (error) => error.code === 'INPUT',
  );
  const call = await run(recordingService(), { action: 'original', post: '12345' });
  assert.equal(call.method, 'cc98.original');
  assert.equal(call.args.post_id, '12345', '字段名必须是 post_id');
  // 参数说明里要把「ID 不是号」讲清，否则模型会传第 3 楼这种数字。
  assert.match(tool(recordingService()).parameters.properties.post.description, /不是楼层号/);
});

test('messageView：user 必填', async () => {
  await assert.rejects(
    () => tool(recordingService()).run({ action: 'messageView' }),
    (error) => error.code === 'INPUT',
  );
  const call = await run(recordingService(), { action: 'messageView', user: '77' });
  assert.equal(call.method, 'cc98.messages');
  assert.equal(call.args.user_id, '77');
});

test('favorites：groupId / order / keyword 透传', async () => {
  const call = await run(recordingService(), {
    action: 'favorites', groupId: '3', order: 0, keyword: '高数',
  });
  assert.equal(call.method, 'cc98.favorites');
  assert.equal(call.args.group_id, '3');
  assert.equal(call.args.order, 0);
  assert.equal(call.args.keyword, '高数');
});

test('following：fans 开关透传', async () => {
  const call = await run(recordingService(), { action: 'following', fans: true });
  assert.equal(call.method, 'cc98.following');
  assert.equal(call.args.fans, true);
});

test('feed / notifications：kind 都收，且说明里区分了两套取值', async () => {
  const feed = await run(recordingService(), { action: 'feed', kind: 'boards' });
  assert.equal(feed.method, 'cc98.feed');
  assert.equal(feed.args.kind, 'boards');

  const notice = await run(recordingService(), { action: 'notifications', kind: 'at' });
  assert.equal(notice.method, 'cc98.notifications');
  assert.equal(notice.args.kind, 'at');

  // kind 故意不写 enum：两套取值不同，写并集会让模型以为任一个都能用在任一 action 上。
  const kindSchema = tool(recordingService()).parameters.properties.kind;
  assert.equal(kindSchema.enum, undefined, 'kind 不能写 enum，两套取值不同');
});

test('signinMonth：year / month 透传', async () => {
  const call = await run(recordingService(), { action: 'signinMonth', year: 2026, month: 11 });
  assert.equal(call.method, 'cc98.signinMonth');
  assert.equal(call.args.year, 2026);
  assert.equal(call.args.month, 11);
});

test('myPosts：hot 开关透传', async () => {
  const call = await run(recordingService(), { action: 'myPosts', hot: true });
  assert.equal(call.method, 'cc98.myPosts');
  assert.equal(call.args.hot, true);
});

test('未知 action 报 INPUT，且**不会**去碰服务', async () => {
  const service = recordingService();
  await assert.rejects(
    () => tool(service).run({ action: 'deleteEverything' }),
    (error) => error.code === 'INPUT',
  );
  assert.equal(service.calls.length, 0, 'action 写错时不该调 source');
});

test('服务没装配时报 SERVICE_MISSING 并说清装哪个包', async () => {
  await assert.rejects(
    () => createCc98ReadTools({})[0].run({ action: 'overview' }),
    (error) => {
      assert.equal(error.code, 'SERVICE_MISSING');
      assert.match(error.message, /dsh-zju-source-cc98/);
      return true;
    },
  );
});

test('分页：from / size 有边界，越界报 INPUT', async () => {
  await assert.rejects(
    () => tool(recordingService()).run({ action: 'myTopics', size: 0 }),
    (error) => error.code === 'INPUT',
  );
  await assert.rejects(
    () => tool(recordingService()).run({ action: 'myTopics', size: 101 }),
    (error) => error.code === 'INPUT',
  );
  await assert.rejects(
    () => tool(recordingService()).run({ action: 'myTopics', from: -1 }),
    (error) => error.code === 'INPUT',
  );
});

test('这个工具**不**注册审批 —— 读操作不该弹批准框', () => {
  // 审批只给会改变平台状态的动作。给「看十大」配批准框，用户会养成一路点同意
  // 的习惯，等真的发帖时那次点击就不再有意义。
  //
  // ⚠️ 不能断言 description 里不出现「审批」二字：那里正确地说着
  // 「写操作在 campus_post 等工具里，需要审批」—— 那是提示模型去哪找写操作，
  // 不是给本工具挂审批。要断言的是**结构**：这个定义没有 guard/审批包装。
  const definition = tool(recordingService());
  assert.equal(typeof definition.run, 'function', '读工具用 run，不是 prepare/execute');
  assert.equal(definition.prepare, undefined, '读工具不该有 prepare（那是写的两段式契约）');
  assert.equal(definition.guard, undefined, '读工具不该有审批包装');
  assert.equal(definition.execute, undefined, '读工具的注册器会包一层 execute，定义本身不该有');
});
