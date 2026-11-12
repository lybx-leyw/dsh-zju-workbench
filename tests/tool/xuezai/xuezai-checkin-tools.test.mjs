/**
 * `campus_checkin` 的工具层测试 —— **走过审批链**，不是直接调 source。
 *
 * # 为什么这一层要单独测
 *
 * 本仓有过一次教训（coverage-gaps 的 Y-13）：source 层测试全绿，而工具层传给
 * source 的参数在实机上走不通。所以这里从 `apply()` 注册出来的宿主工具进入，
 * 装配**真的** `createRollcallBatch` + 假 reader + 假审批。
 *
 * # 这一组钉住什么
 *
 * 1. **`all: true` 与单次是两条路**：前者走 `rollcallAll*`，后者走 `rollcall*`。
 *    接错线路的表现是「批个寂寞」—— 看起来签了，实际只签了调用方点名的那一个。
 * 2. **审批理由要说清「可能一次签多个」**：用户批准的是「签这几个」，
 *    不是「某个动作」。审批框上只写「批量签到」等于没写。
 * 3. **审批被拒后能立刻重试**：`cancel` 段缺了就是永久 `WRITE_BUSY`。
 * 4. **参数边界**：`all` 与 `code` 不能同时给（一个口令签不了多个点名）。
 *
 * 全部离线。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apply } from '../../../packages/tool/xuezai/src/index.js';
import { createRollcallBatch } from '../../../packages/source/xuezai/src/rollcall-batch.js';

/** 一条雷达点名。 */
const radarRow = (id, course, extra = {}) => ({
  rollcall_id: id, course_title: course, is_radar: true, status: 'not_on_call', ...extra,
});

/**
 * 造一个假 reader：`json` 回点名列表。
 *
 * @param rows - 点名列。
 * @returns 假 reader。
 */
function fakeReader(rows) {
  const calls = [];
  return {
    calls,
    async json(url, options) {
      calls.push({ url, options });
      return { rollcalls: rows };
    },
  };
}

/**
 * 装配一份工具：真 batch 工厂 + 真单点应答替身 + 假审批。
 *
 * @param options.rows - 点名列表。
 * @param options.outcome - 审批结果。
 * @param options.answer - 单点应答替身（`rollcall` 那对）。
 * @returns `{ tool, asked, reader, answer }`。
 */
function harness({ rows = [radarRow(1, '数据结构'), radarRow(2, '算法')], outcome = 'allowed-once' } = {}) {
  const reader = fakeReader(rows);

  /** 单点应答的替身：记录每次签哪个 id。 */
  const answerCalls = [];
  const answer = {
    async prepare(args) {
      answerCalls.push({ kind: 'prepare', id: Number(args?.rollcall?.id) });
      return `签到：${args?.rollcall?.title ?? args?.rollcall?.id}`;
    },
    async execute() { return { ok: true }; },
    async cancel() {},
  };

  const batch = createRollcallBatch(reader, { rollcall: answer, wait: async () => {} });

  /** source 服务面：批量 + 单次两套都挂上（模拟 `source/xuezai/src/index.js`）。 */
  const service = {
    rollcallAllPrepare: (input) => batch.prepare(input),
    rollcallAllExecute: (signal) => batch.execute(signal),
    rollcallAllCancel: () => batch.cancel(),
    // 单次那套：直接转给同一个替身，便于断言「走的是哪条路」。
    rollcallPrepare: async (input) => {
      answerCalls.push({ kind: 'single-prepare', input });
      return '单次签到';
    },
    rollcallExecute: async () => ({ single: true }),
    rollcallCancel: async () => {},
  };

  const asked = [];
  const registered = [];
  const ctx = {
    get: (key) => (key === 'zhiyunXuezai' ? service : undefined),
    tools: { register: (tool) => { registered.push(tool); return () => {}; } },
    approval: { async request(request) { asked.push(request); return outcome; } },
    effect: (fn) => fn(),
  };
  apply(ctx);
  const tool = registered.find((item) => item.name === 'campus_checkin');
  return { tool, asked, reader, answer, answerCalls };
}

/** 一次成功的调用要带 agent（没有 agent 等于没有可审计主体，会 fail closed）。 */
const EXEC = { agent: { session: { id: 'session-fixture' } }, callId: 'call-1' };

/* ─────────────────────── 单次那条路（回归） ─────────────────────── */

test('单次：给 course 时走 rollcall，不碰批量那条路', async () => {
  const { tool, answerCalls } = harness();
  await tool.execute({ course: '数据结构' }, EXEC);
  assert.equal(answerCalls.filter((c) => c.kind === 'single-prepare').length, 1, '走的是单次');
  assert.equal(answerCalls.filter((c) => c.kind === 'prepare').length, 0, '不该碰批量');
});

/* ─────────────────────── 批量那条路 ─────────────────────── */

test('批量：all=true 走 rollcallAll，且真的签了**多个**', async () => {
  const { tool, answerCalls, reader } = harness();
  const result = await tool.execute({ all: true }, EXEC);

  assert.equal(result.ok, true);
  assert.equal(result.result && typeof result.result === 'string', true);
  assert.match(result.result, /已签 2 个/, '两个都要签，不能只签第一个');
  assert.match(result.result, /数据结构/);
  assert.match(result.result, /算法/);

  assert.ok(reader.calls.length >= 1, '批量要自己列当前点名');
  assert.match(reader.calls[0].url, /radar\/rollcalls/);
  assert.equal(answerCalls.filter((c) => c.kind === 'prepare').length, 2);
});

test('批量：审批理由要写明「可能一次签多个点名」', async () => {
  // 用户批准的是「签这几个」。只写「批量签到」等于没写 —— 他不知道会签几个。
  const { tool, asked } = harness();
  await tool.execute({ all: true }, EXEC);

  assert.equal(asked.length, 1, '要问一次审批');
  assert.match(asked[0].reason, /可能一次签多个/, '审批框要说清这次可能签好几个');
  assert.match(asked[0].reason, /数据结构/, '要指名会签哪些');
  assert.match(asked[0].reason, /算法/);
});

test('批量：Prepare 阶段一个应答请求都不发（审批框弹出时还是原样）', async () => {
  // 用「审批拒绝」把 Prepare 单独隔离出来：若 Prepare 偷偷签了，answerCalls 就不空。
  const { tool, answerCalls, reader } = harness({ outcome: 'rejected' });
  await assert.rejects(
    () => tool.execute({ all: true }, EXEC),
    (error) => {
      assert.equal(error.code, 'WRITE_NOT_APPROVED');
      return true;
    },
  );
  assert.equal(answerCalls.length, 0, '**Prepare 绝不能发应答请求**');
  assert.equal(reader.calls.length, 1, '只读了一次列表（Prepare 用）');
});

test('批量：course 在 all 模式下是**筛选器**，不是必填', async () => {
  const { tool, answerCalls } = harness({ rows: [radarRow(1, '数据结构'), radarRow(2, '算法')] });
  const result = await tool.execute({ all: true, course: '数据' }, EXEC);

  assert.equal(answerCalls.filter((c) => c.kind === 'prepare').length, 1, '只签筛选到的那个');
  assert.match(result.result, /数据结构/);
  assert.doesNotMatch(result.result, /已签 2 个/);
});

/* ─────────────────────── 参数边界 ─────────────────────── */

test('参数：两个都不给要拒（那种调用会变成「随便签点什么」）', async () => {
  const { tool } = harness();
  await assert.rejects(
    () => tool.execute({}, EXEC),
    (error) => {
      assert.equal(error.code, 'INPUT');
      assert.match(error.message, /course/);
      assert.match(error.message, /all/);
      return true;
    },
  );
});

test('参数：all 与 code 不能同时给（一个口令签不了多个点名）', async () => {
  const { tool, answerCalls } = harness();
  await assert.rejects(
    () => tool.execute({ all: true, code: '1234' }, EXEC),
    (error) => {
      assert.equal(error.code, 'INPUT');
      assert.match(error.message, /不能同时给 code/);
      return true;
    },
  );
  assert.equal(answerCalls.length, 0, '参数错就不该走到 source');
});

test('参数：schema 里 course 不再是必填，但 all / passes 都在', async () => {
  const { tool } = harness();
  assert.deepEqual(tool.parameters.required, [], '批量模式恰恰是「不知道该签哪门」时用的');
  assert.ok(tool.parameters.properties.all, 'all 必须出现在参数表里');
  assert.ok(tool.parameters.properties.passes);
  assert.match(tool.description, /一次签全部待签/, '描述要让模型知道有这条路');
});

/* ─────────────────────── 审批被拒后能重试 ─────────────────────── */

test('审批被拒后能**立刻**重试同一个动作（不 WRITE_BUSY）', async () => {
  const reader = fakeReader([radarRow(1, '数据结构')]);
  const answerCalls = [];
  const answer = {
    async prepare(args) { answerCalls.push(Number(args?.rollcall?.id)); return 's'; },
    async execute() { return { ok: true }; },
    async cancel() {},
  };
  const batch = createRollcallBatch(reader, { rollcall: answer, wait: async () => {} });
  const service = {
    rollcallAllPrepare: (input) => batch.prepare(input),
    rollcallAllExecute: (signal) => batch.execute(signal),
    rollcallAllCancel: () => batch.cancel(),
  };

  let outcome = 'rejected';
  const registered = [];
  apply({
    get: (key) => (key === 'zhiyunXuezai' ? service : undefined),
    tools: { register: (tool) => { registered.push(tool); return () => {}; } },
    approval: { request: async () => outcome },
    effect: (fn) => fn(),
  });
  const tool = registered.find((item) => item.name === 'campus_checkin');

  await assert.rejects(
    () => tool.execute({ all: true }, EXEC),
    (error) => {
      assert.equal(error.code, 'WRITE_NOT_APPROVED', '拒绝的码必须是「没批准」，不是「忙」');
      return true;
    },
  );
  assert.deepEqual(answerCalls, [], '拒绝就不许签');

  // 用户改主意批准了：**不能**报 WRITE_BUSY。
  outcome = 'allowed-once';
  const result = await tool.execute({ all: true }, EXEC);
  assert.equal(result.ok, true);
  assert.deepEqual(answerCalls, [1], '第二次必须真的签出去');
});

test('审批通道不可用（没有 agent）时不发请求，且会话被撤销（不封锁）', async () => {
  const { tool, answerCalls } = harness();
  await assert.rejects(
    () => tool.execute({ all: true }, {}),
    (error) => {
      assert.equal(error.code, 'WRITE_NO_CHANNEL');
      return true;
    },
  );
  assert.equal(answerCalls.length, 0);

  // 紧接着带 agent 重来：必须走得通（说明上一次的会话已被撤销）。
  const result = await tool.execute({ all: true }, EXEC);
  assert.equal(result.ok, true);
});

test('source 缺 Cancel 时立刻报 CONTRACT_MISSING（否则审批被拒后永久不可用）', async () => {
  const registered = [];
  apply({
    get: (key) => (key === 'zhiyunXuezai'
      ? { rollcallAllPrepare: async () => 's', rollcallAllExecute: async () => ({}) }
      : undefined),
    tools: { register: (tool) => { registered.push(tool); return () => {}; } },
    approval: { request: async () => 'allowed-once' },
    effect: (fn) => fn(),
  });
  const tool = registered.find((item) => item.name === 'campus_checkin');
  await assert.rejects(
    () => tool.execute({ all: true }, EXEC),
    (error) => {
      assert.equal(error.code, 'CONTRACT_MISSING');
      assert.match(error.message, /Cancel/);
      return true;
    },
  );
});
