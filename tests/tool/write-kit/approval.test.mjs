/**
 * `tool/write-kit` 的审批契约测试。
 *
 * # 为什么这一份最要紧
 *
 * 这个包里最危险的行为是「**没批准却执行了**」。那种缺陷不会报错 ——
 * 它表现为「某天有人发现作业被交了」。所以审批那几条断言写得很死：
 * 不是「没抛错」，是「`act` 一次都没被调用」。
 *
 * 全部离线：`approval` 是假的。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WRITE_CODES,
  WriteRejected,
  guardWrite,
  requireApproval,
} from '../../../packages/tool/write-kit/src/approval.js';

/** 造一个假的审批服务，记录调用并返回指定结果。 */
function fakeApproval(outcome = 'allowed-once') {
  const calls = [];
  return {
    calls,
    request: async (request) => {
      calls.push(request);
      return outcome;
    },
  };
}

/** 一个最小的 agent 替身（审批服务只把它透传去写审计）。 */
const AGENT = { session: { id: 'session-fixture' } };

test('审批：allowed-once 放行，且 act 被调用一次', async () => {
  const approval = fakeApproval('allowed-once');
  let called = 0;
  const result = await guardWrite({
    approval,
    agent: AGENT,
    act: async () => { called += 1; return 'done'; },
    toolName: 'campus_course_select',
    callId: 'call-1',
    reason: '选课：高等数学',
  });
  assert.equal(result, 'done');
  assert.equal(called, 1);
  assert.equal(approval.calls.length, 1);
  assert.equal(approval.calls[0].toolName, 'campus_course_select');
  assert.equal(approval.calls[0].callId, 'call-1');
  assert.equal(approval.calls[0].reason, '选课：高等数学');
});

test('审批：rejected 时**一次都不执行**', async () => {
  let called = 0;
  await assert.rejects(
    () => guardWrite({
      approval: fakeApproval('rejected'),
      agent: AGENT,
      act: async () => { called += 1; },
      toolName: 'campus_course_select',
    }),
    (error) => {
      assert.ok(error instanceof WriteRejected);
      assert.equal(error.code, WRITE_CODES.NOT_APPROVED);
      return true;
    },
  );
  assert.equal(called, 0, '用户拒绝了就一次都不许执行');
});

test('审批：cancelled 与 unavailable 都不执行，且码不同', async () => {
  // 「用户拒绝」与「没有通道」对调用方的含义完全不同：前者不要重试，
  // 后者是配置问题。混成一句会让模型反复重试一个永远不会成的动作。
  let called = 0;
  const act = async () => { called += 1; };

  await assert.rejects(
    () => guardWrite({ approval: fakeApproval('cancelled'), agent: AGENT, act, toolName: 'x' }),
    (error) => error.code === WRITE_CODES.CANCELLED,
  );
  await assert.rejects(
    () => guardWrite({ approval: fakeApproval('unavailable'), agent: AGENT, act, toolName: 'x' }),
    (error) => error.code === WRITE_CODES.NO_CHANNEL,
  );
  assert.equal(called, 0);
});

test('审批：没有 approval 服务时 fail closed（不是默认允许）', async () => {
  let called = 0;
  await assert.rejects(
    () => guardWrite({ approval: null, agent: AGENT, act: async () => { called += 1; }, toolName: 'x' }),
    (error) => error.code === WRITE_CODES.NO_CHANNEL,
  );
  assert.equal(called, 0, '没有通道就等于不做');
});

test('审批：非词表返回值也当没有通道（fail closed）', async () => {
  let called = 0;
  await assert.rejects(
    () => guardWrite({
      approval: { request: async () => 'yes-please' },
      agent: AGENT,
      act: async () => { called += 1; },
      toolName: 'x',
    }),
    (error) => error.code === WRITE_CODES.NO_CHANNEL,
  );
  assert.equal(called, 0, '只认 allowed-once，别的值不许当成批准');
});

test('审批：已经中止的 signal 不会走到审批', async () => {
  const approval = fakeApproval('allowed-once');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => guardWrite({
      approval,
      agent: AGENT,
      act: async () => 'x',
      signal: controller.signal,
      toolName: 'campus_activity',
    }),
  );
  assert.equal(approval.calls.length, 0, '中止了就不该去打扰用户');
});

test('审批：审批期间被中止，不会把写发出去', async () => {
  // 审批可能耗时很久。用户批准前已经走开了，这时不能再执行。
  const controller = new AbortController();
  let called = 0;
  await assert.rejects(
    () => guardWrite({
      approval: { request: async () => { controller.abort(); return 'allowed-once'; } },
      agent: AGENT,
      act: async () => { called += 1; },
      signal: controller.signal,
      toolName: 'x',
    }),
  );
  assert.equal(called, 0, '批准回来之后要再确认一次没被中止');
});

test('requireApproval：把 displayReason 原样透给宿主', async () => {
  const approval = fakeApproval('allowed-once');
  await requireApproval({
    approval,
    agent: AGENT,
    toolName: 'campus_homework',
    reason: '交作业',
    displayReason: { en: 'Submit homework', zh: '交作业' },
  });
  assert.deepEqual(approval.calls[0].displayReason, { en: 'Submit homework', zh: '交作业' });
});

test('describeWrite：说清具体做了什么，不写「执行写操作」', async () => {
  const { describeWrite } = await import('../../../packages/tool/write-kit/src/approval.js');
  const line = describeWrite('选课', '高等数学 A01', '周三 3-4 节');
  assert.match(line, /选课/);
  assert.match(line, /高等数学 A01/);
  assert.match(line, /周三 3-4 节/);
  assert.match(line, /改变你在平台上的状态/, '要提醒后果，用户才判得对');
});
