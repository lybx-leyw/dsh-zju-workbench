// 「文档」页滚动键的**纯函数**层：判据、步长、平滑/立即。
//
// 为什么不只有浏览器测试：这三件事是"算出来的"行为，不是布局行为 —— 判据里
// 最容易错的是边界（修饰键、输入法合成、原型链上的键名、`line-height: normal`），
// 而每一条边界都在真机里复现一遍既慢又不可靠。这里全部用纯函数钉住，
// 浏览器那条（`tests/docs-scroll-keys.test.mjs`）只负责证"接线真的接上了"。
//
// 全部用裸 Node 跑：不构建、不启动宿主、不连网。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FALLBACK_LINE_HEIGHT, LINE_FACTOR, PAGE_RATIO, REPEAT_WINDOW_MS, SCROLL_KEYS,
  isInstantScroll, scrollAmount, scrollIntent,
} from '../packages/dsh-zhiyun-page-docs/src/keys.js';

// ---------------------------------------------------------------- 认键

test('四个键都认，并按「按屏 / 按行」分组', () => {
  assert.deepEqual(scrollIntent('PageDown'), { mode: 'page', direction: 1 });
  assert.deepEqual(scrollIntent('PageUp'), { mode: 'page', direction: -1 });
  assert.deepEqual(scrollIntent('ArrowDown'), { mode: 'line', direction: 1 });
  assert.deepEqual(scrollIntent('ArrowUp'), { mode: 'line', direction: -1 });
  // 别的键不认（Home/End/空格都不接管：它们在本页没有明确语义，
  // 留给浏览器与宿主自己的处理）。
  for (const key of ['Home', 'End', ' ', 'Enter', 'a', 'Escape', 'PageDownish']) {
    assert.equal(scrollIntent(key), null, `${key} 不该被认成滚动键`);
  }
});

test('带修饰键一律不接管', () => {
  // Ctrl/⌘+PageDown 是浏览器切标签页；Shift+PageUp 是选中；Alt 是菜单/后退。
  for (const modifiers of [{ ctrl: true }, { meta: true }, { alt: true }, { shift: true }]) {
    for (const key of Object.keys(SCROLL_KEYS)) {
      assert.equal(scrollIntent(key, modifiers), null,
        `${JSON.stringify(modifiers)} + ${key} 不该被接管`);
    }
  }
});

test('输入法合成中不接管（↑/↓ 那时是在选候选词）', () => {
  assert.equal(scrollIntent('ArrowDown', { composing: true }), null);
  assert.equal(scrollIntent('ArrowUp', { composing: true }), null);
  // 合成结束之后立刻恢复。
  assert.notEqual(scrollIntent('ArrowDown', { composing: false }), null);
});

test('原型链上的键名不算滚动键', () => {
  // `SCROLL_KEYS[key]` 这种取值方式会把 `toString` / `constructor` 一并读出来，
  // 于是按下名字恰好是这些的键会被误判成滚动键。用 `Object.hasOwn` 挡掉。
  for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
    assert.equal(scrollIntent(key), null, `${key} 不该被认成滚动键`);
  }
});

test('非字符串输入返回 null，不抛', () => {
  for (const key of [undefined, null, 42, {}, [], Symbol('x')]) {
    assert.equal(scrollIntent(key), null);
  }
});

test('不传第二个参数也不炸（修饰键默认全 false）', () => {
  assert.deepEqual(scrollIntent('PageDown'), { mode: 'page', direction: 1 });
});

// ---------------------------------------------------------------- 步长

test('翻页是视口的 85%，方向带符号', () => {
  // 1200×700 的窗口里实测 `.zyd-main` 的 clientHeight ≈ 659，85% → 560。
  assert.equal(scrollAmount(scrollIntent('PageDown'), { height: 659 }), 560);
  assert.equal(scrollAmount(scrollIntent('PageUp'), { height: 659 }), -560);
  assert.equal(PAGE_RATIO, 0.85);
});

test('翻页只跟视口高走，与行高无关', () => {
  const page = scrollIntent('PageDown');
  assert.equal(scrollAmount(page, { height: 800, lineHeight: 10 }), 680);
  assert.equal(scrollAmount(page, { height: 800, lineHeight: 90 }), 680);
});

test('↑/↓ 是行高的三倍', () => {
  // 正文块实测 line-height = 13.5px × 1.85 ≈ 25；×3 ≈ 75。
  assert.equal(scrollAmount(scrollIntent('ArrowDown'), { height: 659, lineHeight: 25 }), 75);
  assert.equal(scrollAmount(scrollIntent('ArrowUp'), { height: 659, lineHeight: 25 }), -75);
  assert.equal(LINE_FACTOR, 3);
  // 按行的幅度必须明显小于按屏 —— 否则两个键的手感没有区别。
  const line = Math.abs(scrollAmount(scrollIntent('ArrowDown'), { height: 659, lineHeight: 25 }));
  const page = Math.abs(scrollAmount(scrollIntent('PageDown'), { height: 659 }));
  assert.ok(line * 3 < page, `按行 ${line} 应远小于按屏 ${page}`);
});

test('量不到行高时退回兜底值，不滚 0 像素', () => {
  // `line-height: normal` 会让 parseFloat 得到 NaN；0 与负值同理。
  for (const lineHeight of [Number.NaN, 0, -5, undefined, null]) {
    const amount = scrollAmount(scrollIntent('ArrowDown'), { height: 659, lineHeight });
    assert.equal(amount, FALLBACK_LINE_HEIGHT * LINE_FACTOR,
      `lineHeight=${lineHeight} 时应退回 ${FALLBACK_LINE_HEIGHT * LINE_FACTOR}`);
  }
});

test('视口高度量不到时不滚（返回 0，调用方据此不做任何事）', () => {
  for (const height of [0, -1, Number.NaN, undefined]) {
    assert.equal(scrollAmount(scrollIntent('PageDown'), { height }), 0);
  }
  // 但按行不受视口高度影响。
  assert.equal(scrollAmount(scrollIntent('ArrowDown'), { height: 0, lineHeight: 25 }), 75);
});

test('最少滚 1 像素：极小的视口不该算成 0', () => {
  assert.equal(scrollAmount(scrollIntent('PageDown'), { height: 1 }), 1);
});

test('intent 为 null 时返回 0', () => {
  assert.equal(scrollAmount(null, { height: 659 }), 0);
  assert.equal(scrollAmount(undefined, { height: 659 }), 0);
});

// ---------------------------------------------------------------- 平滑 / 立即

test('单次点按走平滑，长按走立即', () => {
  const now = 1_000_000;
  assert.equal(isInstantScroll(null, 'PageDown', now, false), false);
  // 浏览器说这是自动重复 → 立即。按住不放必须跟得上。
  assert.equal(isInstantScroll(null, 'PageDown', now, true), true);
});

test('连敲（每次 repeat 都是 false）也算连续操作', () => {
  // 笔记本轮实测：smooth 的缓动约 300ms，而连敲间隔常在 100ms 内，
  // 每次都重新起动画 → 画面几乎不动，用户观感是"越按越慢"。
  const now = 1_000_000;
  const previous = { key: 'ArrowDown', at: now - 120 };
  assert.equal(isInstantScroll(previous, 'ArrowDown', now, false), true);
  // 边界：正好等于窗口宽度时仍算连续。
  assert.equal(isInstantScroll({ key: 'ArrowDown', at: now - REPEAT_WINDOW_MS }, 'ArrowDown', now, false), true);
  // 超过窗口就不算了 —— 隔一会儿再按，仍应看到平滑的一屏。
  assert.equal(isInstantScroll({ key: 'ArrowDown', at: now - REPEAT_WINDOW_MS - 1 }, 'ArrowDown', now, false), false);
});

test('换方向不算连续操作', () => {
  const now = 1_000_000;
  // 上一下、下一下是"来回看"，各自都该是自己那一下的平滑动画。
  assert.equal(isInstantScroll({ key: 'ArrowDown', at: now - 50 }, 'ArrowUp', now, false), false);
  assert.equal(isInstantScroll({ key: 'PageDown', at: now - 50 }, 'ArrowDown', now, false), false);
});

test('时间戳坏掉时不抛，退回平滑', () => {
  const now = 1_000_000;
  assert.equal(isInstantScroll({ key: 'ArrowDown', at: Number.NaN }, 'ArrowDown', now, false), false);
  assert.equal(isInstantScroll({ key: 'ArrowDown', at: 'x' }, 'ArrowDown', now, false), false);
  assert.equal(isInstantScroll({ key: 'ArrowDown' }, 'ArrowDown', now, false), false);
});

// ---------------------------------------------------------------- 常量契约

test('判据常量是冻结的，且数值与注释一致', () => {
  assert.ok(Object.isFrozen(SCROLL_KEYS), 'SCROLL_KEYS 应冻结');
  for (const value of Object.values(SCROLL_KEYS)) assert.ok(Object.isFrozen(value), '每一项也应冻结');
  assert.equal(PAGE_RATIO, 0.85);
  assert.equal(LINE_FACTOR, 3);
  assert.equal(REPEAT_WINDOW_MS, 350);
  assert.equal(FALLBACK_LINE_HEIGHT, 24);
});
