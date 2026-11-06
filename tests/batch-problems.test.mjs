/**
 * batchProblems 不能吞掉错误里的真实原因。
 *
 * # 锁住的事故（2026-10-31，连续两次真机）
 *
 * 界面上只显示「题目或断点保存失败（错误码 PERSIST）」，而 error.message
 * 里其实带着真实原因。原因是这一行：
 *
 *   const detail = [hint && message && !message.startsWith(hint.slice(0,8)) ? message : '', ...]
 *
 * 保存失败的 message 形如「题目或断点保存失败：<真实原因>」，
 * 前 8 个字恰好等于 hint 的前 8 个字，于是被判为「没有额外信息」而丢弃。
 *
 * 讽刺的是：我为了让 PERSIST 带上 detail 特意改了 runtimeState 的 catch，
 * 结果 detail 在更下游的这一行被再次吞掉 —— 用户看到的还是那句话。
 *
 * 用法：node tests/batch-problems.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { batchProblems } from '../packages/dsh-zhiyun-core-study/src/question-bank.js';

const makeError = (message, code) => Object.assign(Error(message), { code });

test('PERSIST 带 detail 时，界面上必须看得到 detail', () => {
  const error = makeError('题目或断点保存失败：题库格式无效', 'PERSIST');
  const [line] = batchProblems(error, false);
  assert.match(line, /题目或断点保存失败/, 'hint 仍然要在');
  assert.match(line, /题库格式无效/, '真实原因必须同时出现，不能被 hint 吞掉');
});

test('hint 与 message 完全相同时不重复（避免「失败：失败」）', () => {
  const error = makeError('题目或断点保存失败', 'PERSIST');
  const [line] = batchProblems(error, false);
  assert.equal(line, '题目或断点保存失败（错误码 PERSIST）', '没有额外信息时不该重复 hint');
});

test('message 前缀与 hint 相同但尾部有信息 → 保留尾部', () => {
  const error = makeError('题目或断点保存失败：INVALID_RECORD', 'PERSIST');
  const [line] = batchProblems(error, false);
  assert.match(line, /INVALID_RECORD/);
});

test('其它错误码的 detail 同样要保留', () => {
  const error = makeError('上游返回了空题目', 'TRANSPORT');
  const [line] = batchProblems(error, false);
  assert.match(line, /模型接口多次失败/, 'hint 在');
  assert.match(line, /上游返回了空题目/, 'detail 也要在');
});

test('无 hint 的错误码：原样带出 message', () => {
  const error = makeError('某个未知故障', 'WEIRD_CODE');
  const [line] = batchProblems(error, false);
  assert.match(line, /某个未知故障/);
  assert.match(line, /WEIRD_CODE/);
});

test('暂停时给的是暂停文案，不掺错误', () => {
  const [line] = batchProblems(makeError('x', 'PERSIST'), true);
  assert.match(line, /已暂停/);
});
