/**
 * `pet-chat` 的集成测试：多轮对话 → 回复 + 动作，且**绝不写库**。
 *
 * # 最关键的一条
 *
 * 不管模型回什么（包括 `action: 'create'`），`pet-chat` 都**不能**新增条目。
 * 用户必须自己点「好」。这条一旦破，AI 记错日期就再没有拦截点了 ——
 * 而 DDL 记错比没记更糟，因为用户会相信它。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ENTRY = pathToFileURL(path.join(root, 'packages/dsh-zhiyun-page-planning/src/index.js')).href;

/**
 * 起一个最小宿主。`reply` 可以是字符串或函数（拿到请求再决定回什么）。
 */
async function boot({ reply }) {
  const { apply } = await import(ENTRY);
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-chat-'));

  const provided = new Map();
  const calls = [];
  const ctx = {
    get: (name) => provided.get(name),
    provide: (name, value) => { provided.set(name, value); return () => provided.delete(name); },
    logger: () => ({ info() {}, warn() {}, error() {} }),
  };
  // 注入的服务既是 ctx 属性也是 ctx.get —— 两者都提供
  ctx.profileContext = { dir, profileId: 'test' };
  provided.set('profileContext', ctx.profileContext);

  ctx.inject = (names, factory) => {
    factory({
      ...ctx,
      webServer: { register: () => () => {} },
      effect: (fn) => { fn(); return () => {}; },
    });
    return () => {};
  };
  ctx.provide('slots', { register: () => () => {} });

  ctx.provide('zhiyunParser', {
    llm: {
      resolve: async () => ({ provider: 'fake', model: 'fake-model' }),
      call: async (request) => {
        calls.push(request);
        return { text: typeof reply === 'function' ? reply(request) : reply };
      },
    },
  });

  await apply(ctx, {});
  return { dir, calls, service: () => provided.get('zhiyunPlanning') };
}

test('普通对话：回话 + action，且带 model', async () => {
  const host = await boot({
    reply: JSON.stringify({ say: '在的，有什么要记？', action: 'chat', draft: null }),
  });
  try {
    const result = await host.service().mine.pet('你好');
    assert.equal(result.say, '在的，有什么要记？');
    assert.equal(result.action, 'chat');
    assert.equal(result.draft, null);
    assert.equal(result.model, 'fake-model');
  } finally {
    await rm(host.dir, { recursive: true, force: true });
  }
});

test('**action=create 也不写库** —— 必须由用户点「好」才落', async () => {
  const host = await boot({
    reply: JSON.stringify({
      say: '记下了：周三前交第三章作业',
      action: 'create',
      draft: { title: '交第三章作业', detail: '', due: '2026-10-28T15:59:00.000Z', repeat: null },
    }),
  });
  try {
    const service = host.service();
    const before = service.mine.list().length;
    const result = await service.mine.pet('下周三交第三章作业');
    assert.equal(result.action, 'create');
    assert.ok(result.draft, '要给出草案给用户确认');
    assert.equal(service.mine.list().length, before, 'chat 不能新增条目');

    const onDisk = JSON.parse(await readFile(service.mine.file, 'utf8').catch(() => '{"items":[]}'));
    assert.equal((onDisk.items ?? []).length, 0, '磁盘上也不能有东西');
  } finally {
    await rm(host.dir, { recursive: true, force: true });
  }
});

test('确认之后走 create 才真的落库，且字段一致', async () => {
  const host = await boot({
    reply: JSON.stringify({
      say: '好', action: 'create',
      draft: { title: '交第三章作业', detail: '写名字', due: null, repeat: null },
    }),
  });
  try {
    const service = host.service();
    const { draft } = await service.mine.pet('交第三章作业');
    const created = service.mine.create({
      title: draft.title, detail: draft.detail, due: draft.due, repeat: draft.repeat,
    });
    assert.ok(created.id);
    assert.equal(service.mine.list().length, 1);
    assert.equal(service.mine.list()[0].title, '交第三章作业');
  } finally {
    await rm(host.dir, { recursive: true, force: true });
  }
});

test('提示词带今天与逐日表，且 stage=pet（能与 draft/plan 区分）', async () => {
  const host = await boot({ reply: JSON.stringify({ say: '嗯', action: 'chat' }) });
  try {
    await host.service().mine.pet('随便聊');
    const sent = host.calls[0];
    assert.equal(sent.stage, 'pet');
    assert.match(sent.constant, /今天是 \d{4}-\d{2}-\d{2}/);
    assert.match(sent.constant, /Asia\/Shanghai/);
  } finally {
    await rm(host.dir, { recursive: true, force: true });
  }
});

test('提示词里要带上当前未完成的事（用户会问"我有什么事"）', async () => {
  const host = await boot({ reply: JSON.stringify({ say: '嗯', action: 'chat' }) });
  try {
    const service = host.service();
    service.mine.create({ title: '交第三章作业', due: '2026-10-28T15:59:00.000Z' });
    service.mine.create({ title: '已做完的事' });
    // 把第二条标记为完成，确认不会出现在提示词里
    const done = service.mine.list()[1];
    service.mine.setDone(done.id, true);

    await service.mine.pet('我今天有什么事');
    const sent = host.calls[0];
    assert.match(sent.constant, /交第三章作业/, '未完成的要出现');
    assert.equal(sent.constant.includes('已做完的事'), false, '已完成的不要出现');
  } finally {
    await rm(host.dir, { recursive: true, force: true });
  }
});

test('多轮：历史被送进模型，且以 JSON 形式（顺序明确）', async () => {
  const host = await boot({ reply: JSON.stringify({ say: '好', action: 'chat' }) });
  try {
    const history = [
      { role: 'user', text: '下周有个作业' },
      { role: 'assistant', text: '什么作业？哪天交？' },
    ];
    await host.service().mine.pet('第三章，下周三交', { history });
    const sent = host.calls[0];
    assert.match(sent.variable, /下周有个作业/);
    assert.match(sent.variable, /什么作业？哪天交？/);
    assert.match(sent.variable, /第三章，下周三交/);
  } finally {
    await rm(host.dir, { recursive: true, force: true });
  }
});

test('无历史时 variable 就是原话（不要包一层空数组）', async () => {
  const host = await boot({ reply: JSON.stringify({ say: '嗯', action: 'chat' }) });
  try {
    await host.service().mine.pet('你好');
    assert.equal(host.calls[0].variable, '你好');
  } finally {
    await rm(host.dir, { recursive: true, force: true });
  }
});

test('空话 / 超长话在调模型前就拒掉（不花冤枉钱）', async () => {
  const host = await boot({ reply: JSON.stringify({ say: '嗯', action: 'chat' }) });
  try {
    const service = host.service();
    for (const bad of ['', '   ', null, undefined]) {
      await assert.rejects(() => service.mine.pet(bad), (error) => error.code === 'INVALID_INPUT');
    }
    await assert.rejects(() => service.mine.pet('x'.repeat(1001)), (e) => e.code === 'INVALID_INPUT');
    assert.equal(host.calls.length, 0, '校验失败不该调用模型');
  } finally {
    await rm(host.dir, { recursive: true, force: true });
  }
});

test('模型不可用 → NO_LLM，信息可读', async () => {
  const { apply } = await import(ENTRY);
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-chat-'));
  const provided = new Map();
  const ctx = {
    get: (name) => provided.get(name),
    provide: (name, value) => { provided.set(name, value); return () => provided.delete(name); },
    logger: () => ({ info() {}, warn() {}, error() {} }),
    inject: (names, factory) => {
      factory({ ...ctx, webServer: { register: () => () => {} }, effect: (fn) => { fn(); return () => {}; } });
      return () => {};
    },
  };
  ctx.profileContext = { dir, profileId: 'test' };
  provided.set('profileContext', ctx.profileContext);
  ctx.provide('slots', { register: () => () => {} });
  await apply(ctx, {});
  try {
    await assert.rejects(
      () => provided.get('zhiyunPlanning').mine.pet('你好'),
      (error) => {
        assert.equal(error.code, 'NO_LLM');
        assert.match(error.message, /设置|模型/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('模型回半个 JSON（截断）→ 降级成聊天，不卡死对话', async () => {
  // 提示词改成「先说话再给围栏」之后，解析器不再要求"整段必须是 JSON"。
  // 截断的 `{"say":"好的"` 会被当成一句普通的话——没有 action，就是 chat。
  // 这比抛 BAD_JSON 好：用户只是想要个回话，不该因为模型少个括号就整段对话报废。
  const host = await boot({ reply: '{"say":"好的"' });
  try {
    const result = await host.service().mine.pet('你好');
    assert.equal(result.action, 'chat', '解析不了动作时按普通聊天处理');
    assert.ok(result.say.length > 0, '总要回一句人话');
  } finally {
    await rm(host.dir, { recursive: true, force: true });
  }
});

test('模型包了代码围栏 → 仍能解析', async () => {
  const host = await boot({
    reply: '```json\n' + JSON.stringify({ say: '在的', action: 'chat' }) + '\n```',
  });
  try {
    const result = await host.service().mine.pet('你好');
    assert.equal(result.say, '在的');
  } finally {
    await rm(host.dir, { recursive: true, force: true });
  }
});

test('模型说要创建但没给草案 → 退成 ask，回话能引导用户再说一遍', async () => {
  const host = await boot({
    reply: JSON.stringify({ say: '好的', action: 'create', draft: null }),
  });
  try {
    const result = await host.service().mine.pet('下周要交个东西');
    assert.equal(result.action, 'ask');
    assert.equal(result.draft, null);
    assert.match(result.say, /没听明白|再说/);
  } finally {
    await rm(host.dir, { recursive: true, force: true });
  }
});
