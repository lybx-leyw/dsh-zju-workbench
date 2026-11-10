/**
 * 校园写操作工具包的测试。
 *
 * # 测什么
 *
 * 三块：**审批契约**（只有 `allowed-once` 放行）、**source 契约**（
 * `prepareXxx` / `XxxExecute` 两个方法）、**工具参数校验**。
 *
 * 全部离线：`approval` 与 source 服务都是假的。
 *
 * # 一处要特别说明
 *
 * 这个包里最危险的行为是「**没批准却执行了**」。那种缺陷不会报错 ——
 * 它表现为「某天有人发现作业被交了」。所以审批那几条断言写得很死：
 * 不是「没抛错」，是「`act` 一次都没被调用」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { WRITE_CODES, WriteRejected, guardWrite, requireApproval } from '../packages/tool/campus-write/src/approval.js';
import { createCampusWriteTools } from '../packages/tool/campus-write/src/tools.js';

/* ────────────────────────────── 审批契约 */

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
  assert.equal(called, 1, '批准后要真的执行');
  assert.equal(approval.calls.length, 1, '只问一次');
  assert.equal(approval.calls[0].toolName, 'campus_course_select');
  assert.equal(approval.calls[0].callId, 'call-1', 'callId 要带上，审批框才能关联到那次调用');
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
      assert.equal(error.code, WRITE_CODES.NOT_APPROVED);
      return true;
    },
  );
  // 这条断言是重点：不是「抛了错」，是「写动作一次都没被调用」。
  assert.equal(called, 0, '**没批准就不许执行**');
});

test('审批：cancelled 与 unavailable 都不执行，且码不同', async () => {
  for (const [outcome, code] of [['cancelled', WRITE_CODES.CANCELLED], ['unavailable', WRITE_CODES.NO_CHANNEL]]) {
    let called = 0;
    await assert.rejects(
      () => guardWrite({
        approval: fakeApproval(outcome),
        agent: AGENT,
        act: async () => { called += 1; },
        toolName: 'campus_post',
      }),
      (error) => {
        assert.equal(error.code, code, `${outcome} 要映射到 ${code}`);
        return true;
      },
    );
    assert.equal(called, 0, `${outcome} 时不许执行`);
  }
});

test('审批：没有 approval 服务时 fail closed（不是默认允许）', async () => {
  let called = 0;
  await assert.rejects(
    () => guardWrite({
      approval: undefined,
      agent: AGENT,
      act: async () => { called += 1; },
      toolName: 'campus_react',
    }),
    (error) => {
      assert.equal(error.code, WRITE_CODES.NO_CHANNEL);
      assert.match(error.message, /审批通道/);
      return true;
    },
  );
  assert.equal(called, 0, '没有通道就不许执行 —— fail closed');
});

test('审批：非词表返回值也当没有通道（fail closed）', async () => {
  let called = 0;
  await assert.rejects(
    () => guardWrite({
      approval: { request: async () => 'yes-please' },
      agent: AGENT,
      act: async () => { called += 1; },
      toolName: 'campus_checkin',
    }),
    (error) => {
      assert.equal(error.code, WRITE_CODES.NO_CHANNEL);
      return true;
    },
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

/* ────────────────────────────── source 契约 */

/** 造一个符合契约的假 source。 */
function fakeSource(log) {
  return {
    selectCoursePrepare: async (input) => { log.push(['prepare', input]); return `选课：${input.course}`; },
    selectCourseExecute: async (signal) => { log.push(['execute', Boolean(signal)]); return { ok: true }; },
  };
}

test('source 契约：prepare 被调用、execute 只在批准后调用', async () => {
  const log = [];
  const tools = createCampusWriteTools({ services: { zhiyunZdbk: fakeSource(log) } });
  const tool = tools.find((item) => item.name === 'campus_course_select');

  const prepared = await tool.prepare({ action: 'select', course: '高等数学', section: 'A01' });
  assert.equal(prepared.summary, '选课：高等数学');
  assert.equal(typeof prepared.execute, 'function');
  // prepare 阶段不该执行写动作
  assert.deepEqual(log, [['prepare', { course: '高等数学', section: 'A01' }]]);
  assert.equal(log.filter(([kind]) => kind === 'execute').length, 0, 'prepare 里不许执行');
});

test('source 契约：缺 Prepare / Execute 时报 CONTRACT_MISSING', async () => {
  const tools = createCampusWriteTools({ services: { zhiyunZdbk: {} } });
  const tool = tools.find((item) => item.name === 'campus_course_select');
  await assert.rejects(
    () => tool.prepare({ action: 'select', course: 'x', section: 'y' }),
    (error) => {
      assert.equal(error.code, 'CONTRACT_MISSING');
      assert.match(error.message, /selectCoursePrepare/);
      return true;
    },
  );
});

test('source 契约：服务没装配时报 SERVICE_MISSING 并说清装哪个包', async () => {
  const tools = createCampusWriteTools({ services: {} });
  const tool = tools.find((item) => item.name === 'campus_course_select');
  await assert.rejects(
    () => tool.prepare({ action: 'select', course: 'x', section: 'y' }),
    (error) => {
      assert.equal(error.code, 'SERVICE_MISSING');
      assert.match(error.message, /dsh-zju-source-zdbk/, '要说清是哪个包，否则用户不知道装什么');
      return true;
    },
  );
});

/* ────────────────────────────── 工具集与参数校验 */

test('七个工具，名唯一，都有 description 与 parameters', () => {
  const tools = createCampusWriteTools({ services: {} });
  assert.equal(tools.length, 7);
  const names = tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length, '名字不许重复');
  for (const tool of tools) {
    assert.ok(tool.description && tool.description.length > 20, `${tool.name} 的描述要够说明白`);
    assert.equal(tool.parameters.type, 'object');
    assert.ok(Array.isArray(tool.parameters.required), `${tool.name} 要有 required`);
    assert.equal(tool.parameters.additionalProperties, false, '不许传未声明的参数');
  }
});

test('参数校验：必填缺失、action 不认识都报 INPUT', async () => {
  const tools = createCampusWriteTools({ services: {} });
  const course = tools.find((item) => item.name === 'campus_course_select');
  await assert.rejects(() => course.prepare({ action: 'select' }), (e) => e.code === 'INPUT');
  await assert.rejects(() => course.prepare({ course: 'x' }), (e) => e.code === 'INPUT');
  await assert.rejects(() => course.prepare({ action: '乱写', course: 'x' }), (e) => e.code === 'INPUT');
  // select 缺 section
  await assert.rejects(
    () => createCampusWriteTools({ services: { zhiyunZdbk: fakeSource([]) } })
      .find((item) => item.name === 'campus_course_select')
      .prepare({ action: 'select', course: 'x' }),
    (e) => e.code === 'INPUT',
  );
});

test('参数校验：campus_lab_select 的 select 需要 lab 与 week', async () => {
  const tools = createCampusWriteTools({ services: {} });
  const lab = tools.find((item) => item.name === 'campus_lab_select');
  // 缺服务先报 SERVICE_MISSING，给了假服务才轮到参数校验
  await assert.rejects(() => lab.prepare({ action: 'select', course: 'x' }), (e) => e.code === 'SERVICE_MISSING');

  const withSource = createCampusWriteTools({ services: { zhiyunLab: {} } })
    .find((item) => item.name === 'campus_lab_select');
  await assert.rejects(() => withSource.prepare({ action: 'select', course: 'x' }), (e) => e.code === 'INPUT');
  await assert.rejects(() => withSource.prepare({ action: 'select', course: 'x', lab: 'L1' }), (e) => e.code === 'INPUT');
});

test('参数校验：tyys 预约需要 venue 与合法 date', async () => {
  const tyys = { bookVenuePrepare: async () => 'ok', bookVenueExecute: async () => ({}) };
  const tools = createCampusWriteTools({ services: { zhiyunTyys: tyys } });
  const activity = tools.find((item) => item.name === 'campus_activity');

  await assert.rejects(() => activity.prepare({ platform: 'tyys', action: 'book', target: 'x' }), (e) => e.code === 'INPUT');
  await assert.rejects(
    () => activity.prepare({ platform: 'tyys', action: 'book', target: 'x', venue: 'V1', date: '2026/01/01' }),
    (e) => e.code === 'INPUT',
  );
});

test('参数校验：rate 需要整数 value', async () => {
  const cc98 = { rateFloorPrepare: async () => 'ok', rateFloorExecute: async () => ({}) };
  const tools = createCampusWriteTools({ services: { zhiyunCc98: cc98 } });
  const react = tools.find((item) => item.name === 'campus_react');
  await assert.rejects(() => react.prepare({ action: 'rate', post: '1' }), (e) => e.code === 'INPUT');
});

test('参数校验：正文超长要拒，不静默截断', async () => {
  const cc98 = { postTopicPrepare: async () => 'ok', postTopicExecute: async () => ({}) };
  const tools = createCampusWriteTools({ services: { zhiyunCc98: cc98 } });
  const post = tools.find((item) => item.name === 'campus_post');
  await assert.rejects(
    () => post.prepare({ action: 'post', board: '1', content: 'x'.repeat(20001) }),
    (e) => e.code === 'INPUT',
  );
});
