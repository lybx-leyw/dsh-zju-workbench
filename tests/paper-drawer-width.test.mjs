import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, '../packages/dsh-zhiyun-page-paper/src/AssistantDrawer.jsx'), 'utf8');
const css = readFileSync(path.join(here, '../packages/dsh-zhiyun-page-paper/src/style.css'), 'utf8');

test('助手栏宽度没有产品上限，只受窗口宽度约束', () => {
  // 旧实现把宽度夹在 MIN_WIDTH..MAX_WIDTH(720) 之间，用户拖不过去。
  assert.ok(!/MAX_WIDTH/.test(source), '不应再有固定的宽度上限常量');
  assert.match(source, /function clampWidth/, '拖动结果必须经过一处统一的夹取');
  assert.match(source, /globalThis\.innerWidth/, '上限应取窗口宽度');
  assert.match(source, /available - 80/, '给阅读区留余量，否则抽屉吃满整屏就拖不回来了');
  // 下限仍然要挡：太窄时头部和输入框会互相压住。
  assert.match(source, /MIN_WIDTH/);
});

test('拖动时不触发整页重渲染，松手才提交一次', () => {
  const drag = source.match(/const startResize[\s\S]*?\}, \[width\]\);/);
  assert.ok(drag, '应能找到拖动实现');
  // 每一帧 setState 会让整页重排、PDF iframe 跟着重排 —— 这正是连续漂移和卡顿的来源。
  assert.ok(!/setWidth\(/.test(drag[0].replace('setWidth(pending)', '')), '拖动过程中不能 setWidth');
  assert.match(drag[0], /requestAnimationFrame/, '挪动合并到每帧一次');
  assert.match(drag[0], /--zp-drawer-width/, '拖动只改 CSS 变量');
  assert.match(drag[0], /setPointerCapture/, '指针捕获，避免移进 iframe 后丢事件');
  assert.match(drag[0], /setWidth\(pending\)/, '松手时才提交一次');
  assert.match(source, /onDoubleClick=\{resetWidth\}/, '双击分隔条恢复默认宽度');
  assert.match(source, /addEventListener\?\.\('resize'/, '窗口变窄要把超出的宽度收回来');
  assert.match(source, /onPointerDown=\{startResize\}/, '用 pointer 事件，鼠标移出窗口也能收到');
  assert.match(css, /body\.zp-resizing[\s\S]*?user-select: none/, '拖动时禁止选中文本');
  assert.match(css, /body\.zp-resizing \.zp-frame[\s\S]*?pointer-events: none/, '拖动时不让 iframe 吃掉指针');
  assert.match(css, /width: var\(--zp-drawer-width/, '抽屉宽度读变量');
});

test('存下来的宽度只在合法区间内复用', () => {
  assert.match(source, /stored >= MIN_WIDTH \? clampWidth\(stored\) : DEFAULT_WIDTH/);
  assert.ok(!/stored <= MAX_WIDTH/.test(source));
});
