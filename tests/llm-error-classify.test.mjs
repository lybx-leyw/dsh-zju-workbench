/**
 * DeepSeek 错误分类的契约测试。
 *
 * 这里的每一条都对应官方文档里的一句，或者一个**文档没列但实际会遇到**的失败面。
 * 重点不是"能返回一个字符串"，而是**动作分界**对不对 ——
 * 因为调用方只按动作分支（fix / throttle / retry / client）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION, FAILURE, PLAYBOOK, STATUS_OF_FAILURE,
  classifyError, classifyClientFailure, shouldRetry, shouldThrottle,
} from '../packages/dsh-zhiyun-core-llm-error/src/index.js';

/** 断言助手：一个失败面 + 它应有的动作。 */
const expect = (input, failure, action) => {
  const r = classifyError(input);
  assert.equal(r.failure, failure, `failure 应为 ${failure}，实际 ${r.failure}（${r.reason}）`);
  assert.equal(r.action, action, `action 应为 ${action}，实际 ${r.action}`);
  return r;
};

test('官方 7 个码：每个都归到正确的动作', async (t) => {
  await t.test('400 → 先修（请求体畸形）', () => {
    const r = expect({ status: 400, message: 'invalid request body' }, FAILURE.BAD_REQUEST, ACTION.FIX);
    assert.equal(r.retryable, false);
  });
  await t.test('401 → 先修（凭证）', () => {
    const r = expect({ status: 401, message: 'invalid api key' }, FAILURE.UNAUTHORIZED, ACTION.FIX);
    assert.equal(r.retryable, false);
  });
  await t.test('402 → 先修（充值，**不是**限流）', () => {
    const r = expect({ status: 402, message: 'insufficient balance' }, FAILURE.INSUFFICIENT_BALANCE, ACTION.FIX);
    assert.equal(r.retryable, false);
    assert.equal(shouldRetry(r), false, '余额不足重试毫无意义');
    assert.equal(shouldThrottle(r), false, '也不该降并发');
    assert.match(r.hint, /充值/);
  });
  await t.test('422 → 先修（参数）', () => {
    expect({ status: 422, message: 'invalid parameter: temperature out of range' }, FAILURE.INVALID_PARAMETER, ACTION.FIX);
  });
  await t.test('429 → 降并发退避', () => {
    const r = expect({ status: 429, message: 'rate limit exceeded' }, FAILURE.RATE_LIMITED, ACTION.THROTTLE);
    assert.equal(shouldRetry(r), true);
    assert.equal(shouldThrottle(r), true);
    assert.match(r.hint, /并发/);
  });
  await t.test('500 → 谨慎重试', () => {
    expect({ status: 500, message: 'internal server error' }, FAILURE.SERVER_ERROR, ACTION.RETRY);
  });
  await t.test('503 → 谨慎重试', () => {
    expect({ status: 503, message: 'service unavailable' }, FAILURE.SERVICE_BUSY, ACTION.RETRY);
  });
});

test('422 的三类子情况必须被分开（光看码会混淆修法）', async (t) => {
  await t.test('上下文超限（落在 422 或 400）→ 改预算，不是改参数', () => {
    const r = expect({
      status: 422,
      message: 'This model\'s maximum context length is 65536 tokens. However you requested 70000 tokens',
    }, FAILURE.CONTEXT_OVERFLOW, ACTION.FIX);
    assert.match(r.hint, /max_tokens|窗口/);
  });
  await t.test('上下文超限落在 400 也要认出来', () => {
    expect({ status: 400, message: 'maximum context length is 65536 tokens' }, FAILURE.CONTEXT_OVERFLOW, ACTION.FIX);
  });
  await t.test('工具 schema 缺字段', () => {
    expect({ status: 422, message: 'tools[0].function is missing required field: name' },
      FAILURE.TOOL_SCHEMA_INVALID, ACTION.FIX);
  });
  await t.test('tool 消息 content 为空', () => {
    expect({ status: 422, message: 'tool message content must not be empty' },
      FAILURE.EMPTY_TOOL_CONTENT, ACTION.FIX);
  });
  await t.test('普通参数非法仍走 INVALID_PARAMETER', () => {
    expect({ status: 422, message: 'max_tokens must be an integer' }, FAILURE.INVALID_PARAMETER, ACTION.FIX);
  });
});

test('思考模式必须回传 reasoning_content（DeepSeek 推理模型独有）', () => {
  const r = expect({
    status: 400,
    message: 'reasoning_content in thinking mode must be passed back to the API',
  }, FAILURE.REASONING_NOT_ECHOED, ACTION.FIX);
  assert.match(r.hint, /reasoning_content/);
  assert.match(r.hint, /思考模式/);
});

test('403 地区/权限限制：文档未列，但重试无效', () => {
  const r = expect({ status: 403, message: 'RegionError: not available in your region' },
    FAILURE.REGION_BLOCKED, ACTION.FIX);
  assert.equal(r.retryable, false);
  assert.match(r.hint, /地区|权限/);
});

test('5xx 家族里未单列的码按服务端故障重试', () => {
  for (const status of [502, 504, 520, 599]) {
    const r = classifyError({ status, message: 'bad gateway' });
    assert.equal(r.action, ACTION.RETRY, `${status} 应可重试`);
    assert.equal(r.retryable, true);
  }
});

test('客户端侧失败单独分类（不是服务端返回的码）', async (t) => {
  await t.test('流静默停滞 → 改 idle 超时，不重试', () => {
    const r = classifyClientFailure('stream_stalled');
    assert.equal(r.failure, FAILURE.STREAM_STALLED);
    assert.equal(r.action, ACTION.CLIENT);
    assert.equal(r.retryable, false, '停滞要先改超时策略，而不是原样重发');
    assert.match(r.hint, /空闲超时|idle/);
  });
  await t.test('连接超时可重试（请求还没到模型，不花钱）', () => {
    const r = classifyClientFailure('connect_timeout');
    assert.equal(r.failure, FAILURE.CONNECT_TIMEOUT);
    assert.equal(r.retryable, true);
  });
  await t.test('读超时提示"别把慢响应当失败"', () => {
    const r = classifyClientFailure('read_timeout');
    assert.equal(r.failure, FAILURE.READ_TIMEOUT);
    assert.match(r.hint, /30 秒|慢响应/);
  });
});

test('不确定时**不重试**：宁可早报给人，也不要被重试稀释成"偶发"', () => {
  const r = classifyError({ status: null, message: 'something odd happened' });
  assert.equal(r.failure, FAILURE.UNKNOWN);
  assert.equal(r.action, ACTION.FIX);
  assert.equal(r.retryable, false);
  // 完全没有输入时也算未知，但不抛
  assert.equal(classifyError({}).failure, FAILURE.UNKNOWN);
});

test('每个失败面都有处置说明，且动作取值只在四种之内', () => {
  const actions = new Set(Object.values(ACTION));
  for (const [failure, plan] of Object.entries(PLAYBOOK)) {
    assert.ok(actions.has(plan.action), `${failure} 的 action 不合法：${plan.action}`);
    assert.ok(typeof plan.hint === 'string' && plan.hint.length > 5, `${failure} 缺 hint`);
    assert.equal(typeof plan.retryable, 'boolean', `${failure} 缺 retryable`);
  }
  // 官方 7 个码必须都在映射表里
  assert.deepEqual(
    Object.values(STATUS_OF_FAILURE).sort((a, b) => a - b),
    [400, 401, 402, 422, 429, 500, 503],
  );
});

test('402 与 429 绝不能混：这是 DeepSeek 的第一条分界线', () => {
  const balance = classifyError({ status: 402, message: 'insufficient balance' });
  const limited = classifyError({ status: 429, message: 'rate limit' });
  assert.notEqual(balance.action, limited.action);
  assert.equal(balance.retryable, false);
  assert.equal(limited.retryable, true);
  // 即使错误信息里同时出现 rate limit 字样，402 也必须按余额处理
  const sneaky = classifyError({ status: 402, message: 'rate limit: insufficient balance' });
  assert.equal(sneaky.failure, FAILURE.INSUFFICIENT_BALANCE);
});
