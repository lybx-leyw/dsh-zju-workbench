/**
 * 练习中的题目级操作：跳过与弃用。
 *
 * # 语义差异（这是本需求的要点）
 *
 *   跳过 —— 「这次不想做这道」
 *     可用时机：**仅解析出来前**
 *     影响范围：只影响这次练习（本地移除），不写 attempt、不判分、不改题目状态。
 *              下次练习它还会出现。
 *     为什么解析后不给跳：解析已经看到了，再跳过会让练习记录与真实掌握脱节。
 *
 *   弃用 —— 「这道题本身有问题」
 *     可用时机：**任何时候**（解析前、解析后都行）
 *     影响范围：持久操作。标记 status='rejected'，从题库与练习里一起拿掉。
 *
 * # 为什么跳过不改 state.practice.questions
 *
 * 那份数据带着 sessionId，是后端发下来的会话快照。就地改它会让「下一题」
 * 的索引用到错误数组，刷新后还会被还原成没跳过 —— 用户以为操作丢了。
 * 所以用一份本地 removed 集合，只影响这次渲染。
 *
 * 用法：node tests/practice-skip-discard.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('packages/dsh-zhiyun-page-quiz/src/question-bank.jsx');
const src = fs.readFileSync(SRC, 'utf8');

/** 取 PracticeSession 组件源码段。 */
const session = (() => {
  const start = src.indexOf('function PracticeSession(');
  assert.ok(start > 0, '找不到 PracticeSession');
  const end = src.indexOf('\nfunction ', start + 10);
  return src.slice(start, end > 0 ? end : undefined);
})();

test('跳过的按钮只在解析出来前渲染', () => {
  // 跳过按钮被 !grade 包着
  assert.match(session, /!grade&&[^>]*>[^<]*跳过本题/, '跳过必须受「尚未判分」条件约束');
  // 反向：不能在 grade 分支里也放一个
  const gradeBlock = session.slice(session.indexOf('{grade&&'));
  assert.ok(!/跳过本题/.test(gradeBlock), '解析出来后不该再出现「跳过」');
});

test('弃用的按钮不受判分状态限制', () => {
  const idx = session.indexOf('弃用本题');
  assert.ok(idx > 0, '找不到弃用按钮');
  // 往前看一小段，确认没有被 !grade 或 grade 条件包住
  const before = session.slice(Math.max(0, idx - 200), idx);
  assert.ok(!/!grade&&[^<]*$/.test(before), '弃用不该被 !grade 限制');
  assert.ok(!/grade&&\{?$/.test(before), '弃用不该被 grade 限制');
});

test('跳过：本地移除，不写 attempt、不改题目状态', () => {
  const start = session.indexOf('const skip=');
  assert.ok(start > 0, '找不到 skip 实现');
  // 只截到函数结尾的 `};`，别把后面弃用函数的注释一起吃进来
  const end = session.indexOf('};', start) + 2;
  const body = session.slice(start, end);
  assert.match(body, /setRemoved/, '要记进本地移除集合');
  assert.ok(!/bank\.answer/.test(body), '跳过不能写作答记录');
  assert.ok(!/status\s*=\s*'rejected'/.test(body), '跳过不改题目状态');
  assert.ok(!/bank\.discard/.test(body), '跳过不走弃用接口');
});

test('弃用：持久操作，走 bank.discard 并从队列移除', () => {
  const start = session.indexOf('const discard=');
  assert.ok(start > 0, '找不到 discard 实现');
  const body = session.slice(start, session.indexOf('const subjective=', start));
  assert.match(body, /bank\.discard\(/, '必须调弃用接口');
  assert.match(body, /setRemoved/, '同时从本次练习移除');
  assert.match(body, /await/, '弃用是异步持久操作');
});

test('弃用失败时不盲目移除（依赖 bank 层回滚）', () => {
  const start = session.indexOf('const discard=');
  const body = session.slice(start, session.indexOf('const subjective=', start));
  assert.match(body, /if\s*\(\s*!done\s*\)\s*return/, '失败要直接返回，不能假装成功');
});

test('队列用移除集合过滤，索引不会错位', () => {
  assert.match(session, /const queue=all\.filter\(q=>!removed\.has\(q\.id\)\)/, '必须有过滤');
  assert.match(session, /queue\[Math\.min\(index,\s*Math\.max\(0,\s*queue\.length-1\)\)\]/, '索引要夹在有效范围内');
});

test('不就地修改 state.practice.questions', () => {
  assert.ok(
    !/state\.practice\.questions\s*=\s*/.test(src),
    '不能赋值替换会话快照 —— 刷新会还原，用户以为操作丢了',
  );
  assert.ok(
    !/state\.practice\.questions\.splice/.test(src),
    '不能原地 splice 会话快照',
  );
});

test('全部题被跳过/弃用后给出结束态，而不是崩溃', () => {
  assert.match(session, /if\s*\(\s*!question\s*\)\s*return/, '队列空要有兜底');
  assert.match(session, /本次练习已结束/);
});

test('结束态里如实报告跳过与弃用数量', () => {
  assert.match(session, /removed\.size/, '要显示被拿掉的数量');
});

test('切换题目时清空输入与提示，避免被带到下一题', () => {
  const start = session.indexOf('const advance=');
  const body = session.slice(start, session.indexOf('const skip=', start));
  assert.match(body, /setResponse\(''\)/, '要清空作答');
  assert.match(body, /setNotice\(''\)/, '要清空提示');
});
