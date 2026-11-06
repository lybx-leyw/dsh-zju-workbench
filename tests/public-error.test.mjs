/**
 * publicError 不能把具体的错误原因盖成泛化文案。
 *
 * # 这是本项目第三次修同一类问题
 *
 *   1. `runtimeState` 的 catch 丢了 PERSIST 的 cause
 *   2. `batchProblems` 的 detail 判据把真实原因判成「无额外信息」
 *   3. `publicError` 把 INPUT 一律翻成「输入信息无效。」
 *
 * 三次的共同点：**下游有一张 code → 文案的映射表，把调用方辛苦写清楚的原因盖掉**。
 * 规则统一成：能给出具体原因就不要用泛化文案覆盖它。
 *
 * # 为什么这几个 code 必须保留原文
 *
 * 同一个 code 在不同方法下原因完全不同：
 *   INPUT     —— 出题「参数不完整」/ 导出「没选择题目」/ 答题「作答超长」
 *   NOT_FOUND —— 各处指向不同的东西
 *   NOT_WIRED —— 缺哪个服务各不相同
 * 用一句话统一翻译，用户永远不知道自己哪一步错了。
 *
 * 用法：node tests/public-error.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicError } from '../packages/dsh-zhiyun-core-study/src/workbench.js';

const err = (message, code) => Object.assign(Error(message), { code });

test('INPUT 保留服务端给的具体原因', () => {
  const { message } = publicError(err('请选择要导出的题目', 'INPUT'));
  assert.equal(message, '请选择要导出的题目', '不能翻成「输入信息无效。」');
});

test('导出路径上的两个 INPUT 都能被用户看懂', () => {
  assert.match(publicError(err('请选择要导出的题目', 'INPUT')).message, /选择要导出/);
  assert.match(publicError(err('选中的题目都已弃用，没有可导出的内容', 'INPUT')).message, /都已弃用/);
});

test('NOT_FOUND 保留原文', () => {
  const { message } = publicError(err('部分题目已不存在，请刷新题库', 'NOT_FOUND'));
  assert.match(message, /部分题目已不存在/);
});

test('NOT_WIRED 保留原文（缺哪个服务各不相同）', () => {
  const { message } = publicError(err('笔记库未接入：缺少导出服务', 'NOT_WIRED'));
  assert.match(message, /笔记库未接入/);
});

test('message 为空时退回兜底文案，不显示空白', () => {
  const { message } = publicError(err('', 'INPUT'));
  assert.equal(message, '输入信息无效。', '没原文时才用兜底');
  assert.ok(message.trim().length > 0);
});

test('message 只有空白也算没有', () => {
  const { message } = publicError(err('   \n  ', 'INPUT'));
  assert.equal(message, '输入信息无效。');
});

test('其它 code 仍走既有翻译（不被这次改动影响）', () => {
  assert.match(publicError(err('anything', 'BUSY')).message, /已有加工任务/);
  assert.match(publicError(err('anything', 'CANCELLED')).message, /已取消/);
  assert.match(publicError(err('anything', 'SESSION_EXPIRED')).message, /登录已过期/);
});

test('未知 code 有通用兜底', () => {
  const { code, message } = publicError(err('某些内部细节', 'WEIRD_CODE'));
  assert.equal(code, 'WEIRD_CODE');
  assert.equal(message, '操作未完成，请重试。');
});
