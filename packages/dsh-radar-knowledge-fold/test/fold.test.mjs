/**
 * 规范化口径的对照测试 —— **只在骨架内自证，不声称与 quality.js 等价**。
 *
 * 期望值全部是**手算**的（依据 quality.js:109-118 的语义：U+3000→空格、U+FF01..FF5E 减
 * 0xFEE0、小写、去空白），**没有 import 对方源码**。这样做的原因：一旦 import，
 * 上游改了语义这里会静默跟着变，测试就失去「对照」的意义。
 *
 * ⚠ 本文件覆盖的是**构造样例**，不代表真实讲义语料里的出现频率。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, containsFolded } from '../src/fold.js';

test('全角 ASCII 折成半角', () => {
  assert.equal(fold('ＡＢＣ'), 'abc');
  assert.equal(fold('１２３'), '123');
});

test('全角空格与普通空白都被去掉', () => {
  assert.equal(fold('矩\u3000阵'), '矩阵');
  assert.equal(fold('矩 阵\n\t式'), '矩阵式');
});

test('大小写不敏感', () => {
  assert.equal(fold('Taylor'), 'taylor');
});

test('全角冒号折半角（U+FF1A 减 0xFEE0 = U+003A）', () => {
  assert.equal(fold('定理：'), '定理:');
});

test('containsFolded：检索词一侧也折过', () => {
  // 原文半角、检索词全角 —— 这正是 service.js:282 现状会漏的情形
  assert.equal(containsFolded('The Taylor series', 'ＴＡＹＬＯＲ'), true);
  assert.equal(containsFolded('泰勒 展开', '泰勒展开'), true);
});

test('containsFolded：空检索词不命中（不许退化成「全中」）', () => {
  assert.equal(containsFolded('任意原文', ''), false);
  assert.equal(containsFolded('任意原文', '   '), false);
});

test('containsFolded：确实不相关时不命中', () => {
  assert.equal(containsFolded('行列式的性质', '泰勒'), false);
});

test('TODO 2 的差异面：NFKC 比手写循环宽，这里**记录**而不是断言正确', () => {
  // 上标 ² → 2、罗马数字 Ⅻ → XII、连字 ﬁ → fi，手写循环**不会**折叠这三种。
  // 本测试只锁定「本实现确实更宽」这个事实，宽得对不对由评审决定。
  assert.equal(fold('m²'), 'm2');
  assert.equal(fold('Ⅻ'), 'xii');
  assert.equal(fold('ﬁle'), 'file');
});
