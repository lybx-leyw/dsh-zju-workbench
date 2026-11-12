/**
 * `campus_classroom_read` 的**新增 action**：`liveCandidates` / `check` / `setupPlan`。
 *
 * # 为什么单独一个文件
 *
 * `tests/tool/reads/read-tools.test.mjs` 是全仓读工具的**共同守卫**：它钉的是
 * 「action 在 enum 里就一定能分派」「读工具不过审批」「schema 是封闭的」。
 * 那几条已经自动覆盖了本文件这三个 action —— 但它只证明**分派到了**，
 * 不证明**转出去的参数是对的**。
 *
 * 这个文件补的就是「参数翻译」这一层，也是这一轮最容易被写错的地方：
 * `liveCandidates` 要把 `date` / `course` 两个可选参数**原样**交给
 * `LiveSource.remaining`；`setupPlan` 不能顺手把 `verify` 之类只有 `check`
 * 认识的参数漏出去（多了会让 source 的封闭校验拒绝）。
 *
 * 全离线：source 是假身，不联网、不读磁盘。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createClassroomReadTools } from '../../../packages/tool/classroom/src/reads.js';

/* ────────────────────────────────── 夹具 */

/** 记下每次调用收到什么参数的假 source。 */
function fakeClassroom(overrides = {}) {
  const calls = [];
  const record = (name) => async (...args) => { calls.push([name, args]); return { stub: name }; };
  const live = { remaining: async (...args) => { calls.push(['live.remaining', args]); return { items: [], meta: {} }; } };
  const service = {
    listCourses: record('listCourses'),
    searchCourses: record('searchCourses'),
    listLessons: record('listLessons'),
    searchResources: record('searchResources'),
    searchCaptions: record('searchCaptions'),
    liveStatus: record('liveStatus'),
    liveText: record('liveText'),
    check: async (...args) => { calls.push(['check', args]); return { component: 'all', available: false, results: [] }; },
    setupPlan: async (...args) => { calls.push(['setupPlan', args]); return { component: 'all', executed: false, steps: [] }; },
    live,
    ...overrides,
  };
  return { service, calls };
}

const run = (service, args) => createClassroomReadTools({ zhiyunClassroom: service })[0].run(args, {});

/* ══════════════════════════════════ liveCandidates ══════════════════════════════════ */

test('liveCandidates 把 date 与 course 原样交给 LiveSource.remaining', async () => {
  const { service, calls } = fakeClassroom();
  const result = await run(service, { action: 'liveCandidates', date: '2026-11-13', course: '数据结构' });
  assert.equal(result.stub, undefined);
  const call = calls.find(([name]) => name === 'live.remaining');
  assert.ok(call, '必须走 live.remaining（它才是按直播口径筛课次的那个）');
  assert.equal(call[1][0], '2026-11-13', '第一个位置参数是 date');
  assert.deepEqual(call[1][1], { course: '数据结构' }, '可选参数只在给了的时候才出现');
});

test('liveCandidates 不给参数时不塞空字符串（那会被当成「找一门叫空串的课」）', async () => {
  const { service, calls } = fakeClassroom();
  await run(service, { action: 'liveCandidates' });
  const [, args] = calls.find(([name]) => name === 'live.remaining');
  assert.equal(args[0], undefined, '不传 date 就让 source 用默认（今天）');
  assert.deepEqual(args[1], {}, '不该出现 course: undefined');
});

test('liveCandidates 在 source 缺 remaining 时报清楚的原因，而不是 undefined is not a function', async () => {
  // 版本错配（数据源是旧版、工具包是新版）在 profile 里真实会发生。
  const { service } = fakeClassroom({ live: {} });
  await assert.rejects(
    run(service, { action: 'liveCandidates' }),
    (error) => {
      assert.equal(error.code, 'INPUT');
      assert.match(error.message, /remaining/);
      return true;
    },
  );
});

/* ══════════════════════════════════ check ══════════════════════════════════ */

test('check 默认查 all，并只在给了 verify 时才往下传', async () => {
  const { service, calls } = fakeClassroom();
  await run(service, { action: 'check' });
  assert.deepEqual(calls.find(([name]) => name === 'check')[1], ['all', {}]);

  await run(service, { action: 'check', component: 'asr', verify: true });
  assert.deepEqual(calls.filter(([name]) => name === 'check')[1][1], ['asr', { verify: true }]);

  // verify:false 也要显式传下去 —— 「不校验」与「没提到」在 source 那边是同一支，
  // 但把用户明确的 false 丢掉会让 `check` 的回显少一个字段。
  await run(service, { action: 'check', verify: false });
  assert.deepEqual(calls.filter(([name]) => name === 'check')[2][1], ['all', { verify: false }]);
});

/* ══════════════════════════════════ setupPlan ══════════════════════════════════ */

test('setupPlan 只传 component，不把 check 专用的参数漏给 source', async () => {
  const { service, calls } = fakeClassroom();
  await run(service, { action: 'setupPlan', component: 'media' });
  assert.deepEqual(calls.find(([name]) => name === 'setupPlan')[1], ['media']);

  await run(service, { action: 'setupPlan' });
  assert.deepEqual(calls.filter(([name]) => name === 'setupPlan')[1][1], ['all']);
});

test('setupPlan 的输出以 executed:false 为契约 —— 工具层不许把它包装成「已安装」', async () => {
  // 真正的 implementation 在 source/diagnostics；这条钉的是**工具层不撒谎**：
  // 它必须把 source 的原样结果交回去，不补一个 ok/installed 之类的字段。
  const { service } = fakeClassroom();
  const value = await run(service, { action: 'setupPlan' });
  assert.equal(value.executed, false);
  assert.deepEqual(value.steps, []);
});

/* ══════════════════════════════════ 边界 ══════════════════════════════════ */

test('每个新增 action 都出现在 schema 的 enum 与描述里', async () => {
  const [definition] = createClassroomReadTools({});
  const actions = definition.parameters.properties.action.enum;
  for (const action of ['liveCandidates', 'check', 'setupPlan']) {
    assert.ok(actions.includes(action), `${action} 必须在 enum 里，否则 schema 校验先拒了`);
  }
  // 新增的参数也要在 schema 里，否则 `additionalProperties:false` 会把它们拒掉。
  for (const key of ['date', 'course', 'component', 'verify']) {
    assert.ok(key in definition.parameters.properties, `${key} 必须声明在 parameters 里`);
  }
  assert.match(definition.description, /liveCandidates/);
  assert.match(definition.description, /setupPlan/);
});

test('缺 source 时新增 action 也报 SERVICE_MISSING（不是别的错）', async () => {
  const [definition] = createClassroomReadTools({});
  for (const action of ['liveCandidates', 'check', 'setupPlan']) {
    await assert.rejects(
      definition.run({ action }, {}),
      (error) => {
        assert.equal(error.code, 'SERVICE_MISSING', `${action} 缺服务时应当报 SERVICE_MISSING`);
        assert.match(error.message, /dsh-zju-source-classroom/);
        return true;
      },
    );
  }
});
