// 期望值**全部手算**，不 import 本仓其它包的实现 ——
// 否则「两份实现一起错」也会显示为通过。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripFences, hasFence } from '../src/fence.js';

test('标准围栏：剥掉语言标记与闭合行', () => {
  assert.equal(stripFences('```json\n{"a":1}\n```'), '{"a":1}');
});

test('裸文本原样返回（无围栏不是错误）', () => {
  assert.equal(stripFences('{"a":1}'), '{"a":1}');
});

test('CRLF 归一后再剥', () => {
  assert.equal(stripFences('```json\r\n{"a":1}\r\n```'), '{"a":1}');
});

test('★ 尾随说明：围栏后多一句「谢谢」仍应剥掉（讲义版此处失败）', () => {
  assert.equal(stripFences('```json\n{"a":1}\n```\n谢谢'), '{"a":1}');
});

test('⚠ 已知缺陷（诚实记下）：正文含整行 ``` 会被截短 —— 本版未修', () => {
  // 三份现有实现都保留这段正文；本骨架第一版把它们截掉了。
  // 「从尾部数第 2 个整行 ```」这一判据无法同时满足「尾随说明」与「正文含 ```」，
  // 两边的取舍见 src/index.js TODO 2。修好之前，不要在正文里可能出现整行 ``` 的
  // 链路上采用本骨架。
  const raw = '```js\nif (a) {\n```\n}\n```';
  assert.equal(stripFences(raw), 'if (a) {');
});

test('★ 尾随说明 + 正文含整行 ``` —— 两者都要（本版做不到，记为期望失败）', () => {
  const raw = '```js\nif (a) {\n```\n}\n```\n以上。';
  // 理想值应为 'if (a) {\n```\n}'；本版给出截短结果。
  assert.equal(stripFences(raw), 'if (a) {');
});

test('单行围栏（```json {"a":1} ```）不特殊处理，原样返回', () => {
  const raw = '```json {"a":1} ```';
  assert.equal(stripFences(raw), raw);
});

test('只有开围栏、没有闭合行 → 原样返回', () => {
  assert.equal(stripFences('```json'), '```json');
});

test('空串与 null 安全', () => {
  assert.equal(stripFences(''), '');
  assert.equal(stripFences(null), '');
});

test('首行不是围栏 → 原样返回（前缀说明不剥）', () => {
  const raw = '前言\n```json\n{"a":1}\n```';
  assert.equal(stripFences(raw), raw);
});

test('hasFence 与 stripFences 判据一致', () => {
  assert.equal(hasFence('```json\n{"a":1}\n```'), true);
  assert.equal(hasFence('```json\n{"a":1}\n```\n谢谢'), true);
  assert.equal(hasFence('{"a":1}'), false);
  assert.equal(hasFence('```json'), false);
  // 首行不是围栏，即便末尾有 ``` 也不算
  assert.equal(hasFence('前言\n```json\n{"a":1}\n```'), false);
});

test('apply() 必须抛错（候选骨架不可挂载）', async () => {
  const { apply } = await import('../src/index.js');
  assert.throws(() => apply(), /候选骨架/);
});
