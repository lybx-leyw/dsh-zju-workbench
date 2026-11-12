/**
 * `tool/cc98` 的工具定义测试。
 *
 * # 测什么
 *
 * **封装层不许吞掉 source 收的参数**。这是「source 做基础函数、tool 做封装」
 * 这条分工最容易破的地方，而且破了**不会报错**：
 *
 * 曾经的现象是 source 支持标签 / 匿名 / 引用 / 取消赞踩，但 tool 的
 * `parameters` 里根本没声明这些字段，于是模型永远传不进来 ——
 * 能力在 source 里存在、在用户手里不存在。表现是「浏览器里能选的东西，
 * agent 就是做不了」。
 *
 * 所以判据是：**tool 收到的每个字段，都要原样出现在 prepare 的入参里**。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCc98WriteTools } from '../../../packages/tool/cc98/src/index.js';

/** 收集 prepare 入参的假 source。 */
function recordingSource(name) {
  const seen = [];
  const source = {
    [`${name}Prepare`]: async (input) => { seen.push(input); return 'summary'; },
    [`${name}Execute`]: async () => ({ ok: true }),
    [`${name}Cancel`]: async () => {},
  };
  return { source, seen };
}

/** 取出本包的某个工具。 */
const tool = (services, name) => createCc98WriteTools(services).find((item) => item.name === name);

test('三个工具，名唯一，都有 description 与 parameters', () => {
  const tools = createCc98WriteTools({});
  assert.deepEqual(tools.map((item) => item.name).sort(), ['campus_post', 'campus_react', 'campus_signin']);
  for (const definition of tools) {
    assert.ok(definition.description.length > 20, `${definition.name} 的 description 太短，模型选不对`);
    assert.equal(definition.parameters.type, 'object');
    assert.equal(definition.parameters.additionalProperties, false, '不许放未声明的字段进来');
  }
});

test('campus_post 的 post：标签、标题、匿名都要透给 source', async () => {
  const { source, seen } = recordingSource('postTopic');
  await tool({ zhiyunCc98: source }, 'campus_post').prepare({
    action: 'post', board: '12', content: '出二手', title: '出售', tag1: '交易', tag2: '数码', anonymous: true,
  });
  assert.deepEqual(seen[0], {
    board: '12', content: '出二手', title: '出售', tag1: '交易', tag2: '数码', anonymous: true,
  }, '少一个字段 = 用户选不了那个选项');
});

test('campus_post 的 post：没给的字段不许塞默认值', async () => {
  // 塞 `tag1: ''` 之类会覆盖掉 source 的「不传就用平台默认」，
  // 而有必选标签的版面恰恰靠 source 那边的判断。
  const { source, seen } = recordingSource('postTopic');
  await tool({ zhiyunCc98: source }, 'campus_post').prepare({ action: 'post', board: '1', content: 'x' });
  assert.deepEqual(seen[0], { board: '1', content: 'x' });
});

test('campus_post 的 reply：引用、匿名、通知全体都要透给 source', async () => {
  const { source, seen } = recordingSource('replyTopic');
  await tool({ zhiyunCc98: source }, 'campus_post').prepare({
    action: 'reply', topic: '9', content: '同意', quote: '12', anonymous: true, notifyAll: true,
  });
  assert.deepEqual(seen[0], { topic: '9', content: '同意', quote: '12', anonymous: true, notifyAll: true });
});

test('campus_post 的 edit：传的是楼层 post，不是主题 topic', async () => {
  // 多楼帖里 postId ≠ topicId。用 topic 去编辑会改到别的楼 —— 静默改错内容，
  // 比报错严重得多。所以这里要求工具必须收 `post` 并原样传下去。
  const { source, seen } = recordingSource('editPost');
  const post = tool({ zhiyunCc98: source }, 'campus_post');

  await post.prepare({ action: 'edit', post: '88', content: '改一下' });
  assert.equal(seen[0].post, '88');
  assert.equal(seen[0].topic, undefined, '不许把 topic 混进来当楼层');

  // 只给 topic 不给 post，必须报错而不是猜。
  await assert.rejects(
    () => post.prepare({ action: 'edit', topic: '88', content: '改一下' }),
    (error) => error.code === 'INPUT',
  );
});

test('campus_post 的 message：用户名原样交给 source 去解析', async () => {
  // 名字→id 是数据源的知识（要知道去哪个接口查），不该让工具层抄一遍。
  const { source, seen } = recordingSource('sendMessage');
  await tool({ zhiyunCc98: source }, 'campus_post').prepare({
    action: 'message', recipient: '某用户', content: 'hi',
  });
  assert.equal(seen[0].recipient, '某用户', '工具层不做解析，只透传');
  assert.equal(seen[0].content, 'hi');
});

test('campus_react：赞、踩、取消三种状态都到得了 source', async () => {
  const { source, seen } = recordingSource('likeFloor');
  const react = tool({ zhiyunCc98: source }, 'campus_react');
  await react.prepare({ action: 'like', post: '5' });
  await react.prepare({ action: 'down', post: '5' });
  await react.prepare({ action: 'unlike', post: '5' });
  assert.deepEqual(seen.map((item) => item.state), [1, 2, 'none']);
});

test('campus_react：favorite 与 unfavorite 都到得了 source', async () => {
  const { source, seen } = recordingSource('favoriteTopic');
  const react = tool({ zhiyunCc98: source }, 'campus_react');
  await react.prepare({ action: 'favorite', post: '3' });
  await react.prepare({ action: 'unfavorite', post: '3' });
  assert.deepEqual(seen.map((item) => item.on), [true, false]);
});

test('campus_react：rate 缺 reason 时在封装层就说清去哪查', async () => {
  // 让 source 抛的话，用户看到的是一句「评分需要 reason（理由编号）」，
  // 但他不知道编号从哪来。封装层该替他补上这句话。
  const { source } = recordingSource('rateFloor');
  await assert.rejects(
    () => tool({ zhiyunCc98: source }, 'campus_react').prepare({ action: 'rate', post: '1', value: 2 }),
    (error) => {
      assert.equal(error.code, 'INPUT');
      assert.match(error.message, /理由编号/);
      return true;
    },
  );
});

test('campus_react：rate 传了 reason 就原样到底', async () => {
  const { source, seen } = recordingSource('rateFloor');
  await tool({ zhiyunCc98: source }, 'campus_react').prepare({
    action: 'rate', post: '1', value: -2, reason: '7',
  });
  assert.deepEqual(seen[0], { post: '1', value: -2, reason: '7' });
});

test('campus_signin：不需要参数', async () => {
  const { source, seen } = recordingSource('signIn');
  await tool({ zhiyunCc98: source }, 'campus_signin').prepare({});
  assert.deepEqual(seen[0], undefined, 'source 的 signIn 不收参数');
});

test('参数校验：必填缺失、action 不认识都报 INPUT', async () => {
  const tools = createCc98WriteTools({});
  const post = tools.find((item) => item.name === 'campus_post');
  await assert.rejects(() => post.prepare({}), (error) => error.code === 'INPUT');
  await assert.rejects(
    () => post.prepare({ action: 'fly', content: 'x' }),
    (error) => error.code === 'INPUT',
  );

  // 正文超长要拒，不静默截断
  await assert.rejects(
    () => post.prepare({ action: 'post', board: '1', content: 'x'.repeat(20001) }),
    (error) => error.code === 'INPUT',
  );
});

test('服务没装配时报 SERVICE_MISSING 并说清装哪个包', async () => {
  const tools = createCc98WriteTools({});
  await assert.rejects(
    () => tools.find((item) => item.name === 'campus_signin').prepare({}),
    (error) => {
      assert.equal(error.code, 'SERVICE_MISSING');
      assert.match(error.message, /dsh-zju-source-cc98/, '缺包要说清装哪个');
      return true;
    },
  );
});

test('source 缺 Prepare / Execute 时报 CONTRACT_MISSING', async () => {
  const tools = createCc98WriteTools({ zhiyunCc98: {} });
  await assert.rejects(
    () => tools.find((item) => item.name === 'campus_signin').prepare({}),
    (error) => error.code === 'CONTRACT_MISSING',
  );
});

test('source 缺 cancel 时报 CONTRACT_MISSING —— 否则审批被拒后动作永久不可用', async () => {
  const half = {
    signInPrepare: async () => 'ok',
    signInExecute: async () => ({}),
    // 故意不给 signInCancel
  };
  const tools = createCc98WriteTools({ zhiyunCc98: half });
  await assert.rejects(
    () => tools.find((item) => item.name === 'campus_signin').prepare({}),
    (error) => {
      assert.equal(error.code, 'CONTRACT_MISSING');
      assert.deepEqual(error.methods, ['signInCancel']);
      return true;
    },
  );
});

test('inject 声明了 zhiyunCc98，缺它就整包不激活', async () => {
  const mod = await import('../../../packages/tool/cc98/src/index.js');
  assert.deepEqual(mod.inject, ['tools', 'approval', 'zhiyunCc98']);
  assert.equal(mod.name, 'zhiyun-tool-cc98');
});
