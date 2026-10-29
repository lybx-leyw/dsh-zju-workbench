/**
 * 讲义导出按钮（packages/dsh-zhiyun-page-study/src/handout-export.jsx）的静态契约守卫。
 *
 * 这一条是真机踩出来的：按钮点下去报「输入信息无效。」。根因不在服务端，而在
 * 客户端传错了字段 —— 节次对象上**没有可用的 `id`**，全仓一律用 `subId`
 *（见 `dsh-zhiyun-core-study/src/model.js:23` 的 `currentKey()`）。
 *
 * 更坏的是它有两层伪装：
 *   1. 前置检查写成 `lesson.id` 时永远为真，按钮点了只会说「还没选中一节课」，
 *      连 RPC 都发不出去；
 *   2. 就算发出去了，宿主侧的 `identifier()` 只收纯数字字符串，挡下来之后
 *      `publicError` 把它一律翻成「输入信息无效。」—— 真实原因被通用文案盖掉。
 *
 * 所以这里钉两件事：客户端只用 `subId`；宿主侧对「没有讲义」给出具体原因，
 * 不退化成一个分不清谁错了的 `INPUT`。
 *
 * 只读文件、纯静态比对：不起宿主、不跑构建，lib/client.js 一行不碰。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const BUTTON = 'packages/dsh-zhiyun-page-study/src/handout-export.jsx';
const READER = 'packages/dsh-zhiyun-page-study/src/lecture-reader.jsx';
const WORKBENCH = 'packages/dsh-zhiyun-core-study/src/workbench.js';

test('导出按钮只用 subId，绝不引用 lesson.id', () => {
  // 注释里会提到 `lesson.id` 作为反例，所以先把注释剥掉再查 —— 查的是真正会执行的代码。
  const src = read(BUTTON)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(!/\blesson\.id\b/.test(src), '出现了 lesson.id —— 节次对象上没有这个字段，会挡住整条调用');
  assert.ok(/lesson\.subId/.test(src), '必须用 lesson.subId 取节次编号');
  assert.ok(/course\.id/.test(src), '课程编号仍是 course.id（课程对象上确实有）');
});

test('导出按钮发出的是 handout-export，且带上课程与节次两个编号', () => {
  const src = read(BUTTON);
  const at = src.indexOf("controller.request('handout-export'");
  assert.ok(at >= 0, '没有调用 handout-export');
  const call = src.slice(at, at + 400);
  assert.ok(call.includes('courseId'), '缺少 courseId');
  assert.ok(call.includes('subId'), '缺少 subId');
});

test('导出按钮挂在讲义阅读器的工具栏上，与「导出 PDF」并列', () => {
  const src = read(READER);
  assert.ok(src.includes('HandoutExportButton'), '阅读器没有引用导出按钮');
  assert.ok(src.includes('LectureExportButton'), '原有的导出 PDF 不该被顶掉');
  assert.ok(/topics\.length>0/.test(src), '两个按钮都要受「有讲义」这一条件保护');
});

test('宿主侧对「没有讲义」给具体原因，不退化成 INPUT 的通用文案', () => {
  const src = read(WORKBENCH);
  const at = src.indexOf('async exportHandout(');
  assert.ok(at >= 0, '找不到 exportHandout');
  const body = src.slice(at, at + 1400);
  // INPUT 会被 publicError 翻成「输入信息无效。」，那句话把真实原因盖掉了。
  assert.ok(body.includes('NO_TOPICS'), '「这节课还没有生成讲义」应当用 NO_TOPICS 报出来');
  assert.ok(!/fault\("INPUT",\s*"这节课还没有生成讲义"\)/.test(body), '不要用 INPUT 报「没有讲义」');
});

test('handout-export 在 method 白名单里，且 host 注入了 handout 取值函数', () => {
  const host = read('packages/dsh-zhiyun-core-study/src/host.js');
  assert.ok(host.includes('"handout-export"'), 'method 白名单缺 handout-export，请求会被直接拒成 unknown');
  assert.ok(/handout:\s*\(\)\s*=>\s*ctx\.get\("zhiyunHandout"\)/.test(host), 'host 没有注入 handout 取值函数');
});
