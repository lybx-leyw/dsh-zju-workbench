/**
 * 适配层必须经由 `pool.execute` 调模型。
 *
 * # 锁住的事故（2026-10-31 真机）
 *
 * 我先后试过三种错误写法，症状各不相同但根因同一件事：
 *   a) 自己拼 `prepareCall + stream`：绕开宿主调度，provider 丢失 → NO_ADAPTER
 *   b) `yield* pooledCall(...)`：那是 r3 kernel 的传输层，返回整体响应不是流
 *      → `yield* (intermediate value) is not async iterable`
 *   c) 直接调 `pool.base.llm.prepareCall`：没有并发调度、没有 finish 转异常
 *      → 16 秒 8 并发全失败，用户只看到「0 道可用」
 *
 * 正确姿势是 `pool.execute(work)`：并发调度 + 路由 + 失败块翻异常全在里面。
 * 这条测试断言的就是「有没有走 execute」。
 *
 * 用法：node tests/host-llm-adapter.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 造一个「像 WorkerPoolLlm 那样」的假 pool。
 *
 * 关键特征：
 *   - `execute(work, {signal})` 接受 work 回调，由它负责调度
 *   - `base.llm.prepareCall(route)` 返回 `{config, stream()}`
 *   - provider 失败以 finish 块到达（不抛），适配层要负责翻成异常
 */
function fakePool({ mode = 'ok' } = {}) {
  const seen = { execute: 0, prepareRoute: null, streamOptions: null };
  const pool = {
    snapshot: [{ provider: 'deepseek-official', model: 'deepseek-flash', workers: 2 }],
    base: {
      llm: {
        async resolveModelInfo(provider) {
          if (provider !== 'deepseek-official') throw Error(`未知 provider: ${provider}`);
          return { inputModalities: ['text'] };
        },
        // ⚠️ 按宿主**顶层 LlmRuntime** 的真实签名：prepareCall(config, signal)，config 是对象。
        // 底层 adapter 才是位置参数 (provider, model, signal) —— 两层别搞混。
        // 2026-10-31 就是因为没读宿主实现，在这两层的签名之间来回改错两次。
        async prepareCall(config, _signal) {
          seen.prepareRoute = config;
          if (typeof config?.provider !== 'string') {
            throw Error(`prepareCall 的 config.provider 必须是字符串，收到 ${typeof config?.provider}`);
          }
          return {
            config: { provider: config.provider, model: config.model },
            async *stream(options) {
              seen.streamOptions = options;
              if (!Array.isArray(options?.messages) || !options.messages.length) {
                throw Error('宿主 stream 需要 messages');
              }
              yield { type: 'text-delta', text: '``FINISH``测试正文' };
              if (mode === 'transport-fail') {
                // 宿主的行为：失败以 finish 块到达，不抛异常
                yield { type: 'finish', reason: { kind: 'error', failure: { message: 'DeepSeek Messages transport failed', code: 'TRANSPORT' } } };
                return;
              }
              yield { type: 'finish', reason: { kind: 'stop' } };
            },
          };
        },
      },
    },
    async execute(work, options) {
      seen.execute += 1;
      // 真实实现会按 worker 配额调度；这里直接跑，但保留 route 参数形状
      const route = { provider: 'deepseek-official', model: 'deepseek-flash' };
      return work(route, options?.signal);
    },
  };
  return { pool, seen };
}

const LECTURE = {
  chapters: [{ title: '章', topics: [{ title: '节', blocks: [{ kind: 'paragraph', text: '材料内容' }] }] }],
};

async function runWith(pool) {
  const { createCoreQuestionBackend } = await import('../packages/dsh-zhiyun-core-study/src/core-question-backend.js');
  const backend = createCoreQuestionBackend({ pool, llmService: null });
  backend.__setHostResources({ attach: async () => ({ handleId: 'h1', revision: 'r1' }), release: async () => {} });
  backend.rememberBundle('h1', { lecture: LECTURE });
  await backend.runs.start({
    capability: 'deep_question',
    resourceHandles: ['h1'],
    options: { config: { num_questions: 1, question_types: ['choice'], difficulty: 'easy' } },
    input: {},
  });
  return backend.runs.result('core-run-1');
}

test('必须走 pool.execute（宿主的并发调度与路由）', async () => {
  const { pool, seen } = fakePool();
  await runWith(pool);
  assert.ok(seen.execute > 0,
    'pool.execute 一次都没被调用 —— 说明绕过了宿主调度，8 路并发会退化、失败也没有重试');
  assert.equal(seen.prepareRoute?.provider, 'deepseek-official',
    `路由必须是宿主注册表里的名字，实际：${JSON.stringify(seen.prepareRoute)}`);
  assert.ok(Array.isArray(seen.streamOptions?.messages) && seen.streamOptions.messages.length > 0,
    'stream 必须收到 messages');
});

test('消息必须补 source 元数据（会话归因靠它）', async () => {
  const { pool, seen } = fakePool();
  await runWith(pool);
  const first = seen.streamOptions?.messages?.[0];
  assert.ok(first?.source, `消息缺 source，审计链路会断。实际：${JSON.stringify(first)?.slice(0, 160)}`);
  assert.ok(first.id, '消息应有稳定 id');
});

test('宿主的 finish 失败块必须翻成异常，不能当空结果吞掉', async () => {
  const { pool } = fakePool({ mode: 'transport-fail' });
  const result = await runWith(pool);

  assert.notEqual(result.status, 'succeeded', '传输失败不该被当成成功');
  const message = String(result.error?.message ?? '');
  assert.match(message, /transport|失败/i, `失败原因要可读，实际：${message}`);
});

test('没有 pool 时退回自建 client，且不报 provider undefined', async () => {
  const result = await runWith(null);
  const message = String(result.error?.message ?? '');
  assert.ok(!/provider "undefined"/.test(message),
    `不该出现 provider undefined。实际：${message}`);
});
