import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * 页面侧栏契约：`registerPageSidebar` / `getPageSidebar` / `subscribePageSidebar`。
 *
 * 这是「导轨那只鲸鱼能收起各页自己的侧栏」的接缝：页面登记，产品层取用。
 * 两边互不相识，所以出问题时症状是「按钮在、点了没反应」或「导轨整格空白」——
 * 都很难从界面上定位。这里把注册表本身的行为逐条钉住。
 *
 * 断言对象是**纯 JS 那一层**（`page-sidebar.js`）。带 React 的
 * `useRegisterPageSidebar` / `usePageSidebar` 在 `rail-action.test.mjs` 与真机里验。
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * 打成自包含 ESM 再 import。
 *
 * ⚠️ `page-sidebar.js` 用的是模块级 Map，**跨用例存活**，所以每条用例先
 * `resetPageSidebars()`。不能靠「另起一次 import」隔离：ESM 缓存按 specifier 去重，
 * 同一个 `data:` URL 只会求值一次。
 */
async function bundle() {
  const result = await build({
    entryPoints: [path.join(root, 'packages/client/ui-shared/src/page-sidebar.js')],
    bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const registry = await bundle();

test('a page can register its sidebar and the rail can read it back', () => {
  registry.resetPageSidebars();
  const toggle = () => {};
  const undo = registry.registerPageSidebar('notes', { expanded: true, toggle });

  const control = registry.getPageSidebar('notes');
  assert.equal(control.toggle, toggle, '拿到的是页面自己那个函数，不是包装过的');
  assert.equal(control.expanded, true);
  assert.equal(registry.getPageSidebar('paper'), undefined, '没登记的页面必须取不到');

  undo();
  assert.equal(registry.getPageSidebar('notes'), undefined, '卸载后要真的撤掉');
});

test('the disposer is idempotent and never removes a newer registration', () => {
  // 页面重挂载时「新注册 -> 旧 disposer 才跑」这个顺序是常态（React 的 effect 清理
  // 与下一次 effect 之间没有额外约束）。旧 disposer 若按 pageId 盲删，会把新那份抹掉，
  // 表现是切走再切回来后导轨按钮忽然不可点。
  registry.resetPageSidebars();
  const first = registry.registerPageSidebar('notes', { expanded: true, toggle: () => {} });
  const second = registry.registerPageSidebar('notes', { expanded: false, toggle: () => {} });
  const current = registry.getPageSidebar('notes');
  assert.equal(current.expanded, false, '后注册的生效');

  first();
  assert.equal(registry.getPageSidebar('notes'), current, '旧 disposer 不该动新注册');

  first();  // 幂等
  assert.equal(registry.getPageSidebar('notes'), current);

  second();
  assert.equal(registry.getPageSidebar('notes'), undefined);
});

test('subscribers are notified on register, on state change, and on dispose — but not on no-op re-register', () => {
  // 「不因重复注册抖动」是性能要求，不是洁癖：`useRegisterPageSidebar` 每次渲染都会
  // 重跑，而订阅方是页面壳的内联样式子树。每次渲染都把导轨重渲染一遍，会让按钮的
  // 悬停态在页面无关重渲染时闪一下。
  registry.resetPageSidebars();
  let calls = 0;
  const stop = registry.subscribePageSidebar('notes', () => { calls += 1; });
  const toggle = () => {};

  const undo = registry.registerPageSidebar('notes', { expanded: true, toggle });
  assert.equal(calls, 1, '首次注册派发一次');

  registry.registerPageSidebar('notes', { expanded: true, toggle });
  assert.equal(calls, 1, '完全等价的重注册不派发');

  const undoSecond = registry.registerPageSidebar('notes', { expanded: false, toggle });
  assert.equal(calls, 2, '展开态变了要派发 —— 按钮的 aria-label 依赖它');

  // ⚠️ 撤第一次那份**不该**派发：它已经被第二次注册替换掉了（上一节钉的就是这条）。
  // 于是这里必须撤当前那一份，才观察得到「撤销会派发」。
  undo();
  assert.equal(calls, 2, '撤一份已被替换的注册是静默的');

  undoSecond();
  assert.equal(calls, 3, '撤销当前那份要派发，导轨据此退回纯鲸鱼');

  stop();
  registry.registerPageSidebar('notes', { expanded: true, toggle });
  assert.equal(calls, 3, '退订之后不再收通知');
});

test('one failing subscriber does not starve the others', () => {
  // 订阅方在渲染期跑（页面壳的 renderSlot）。一个抛错不该让整格导轨变成空白。
  registry.resetPageSidebars();
  const seen = [];
  registry.subscribePageSidebar('notes', () => { throw new Error('boom'); });
  registry.subscribePageSidebar('notes', () => seen.push('second'));
  registry.registerPageSidebar('notes', { expanded: true, toggle: () => {} });
  assert.deepEqual(seen, ['second']);
});

test('a malformed registration fails loudly at the call site', () => {
  // 静默接受会让页面「注册成功但点不动」—— 那比抛错难查得多。
  registry.resetPageSidebars();
  assert.throws(() => registry.registerPageSidebar('', { toggle: () => {} }), /pageId/);
  assert.throws(() => registry.registerPageSidebar('notes', null), /toggle/);
  assert.throws(() => registry.registerPageSidebar('notes', { expanded: true }), /toggle/);
});
