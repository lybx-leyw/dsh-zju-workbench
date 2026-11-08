import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

/**
 * 页面生命周期契约。
 *
 * # 守的是什么
 *
 * `registerPage` 接受 `onActivate` / `onDeactivate`；切页时壳**保证**按顺序调用，
 * 且旧页的清理抛错不能阻止导航。
 *
 * 这是「page 层不得影响 home」的实现基础：页面把全局副作用登记在
 * `onDeactivate` 里撤销，壳负责调用。漏了调用就是框架缺陷 —— 所以要有测试。
 */

/** 用 esbuild 把状态模块编成可 require 的 CJS。 */
async function stateModule() {
  const result = await build({
    stdin: {
      contents: "export { createPagesState, normalizeConfig } from './src/state.js'",
      resolveDir: process.cwd(),
      loader: 'js',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    external: ['react', 'react-dom'],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports,
  );
  return module.exports;
}

test('registerPage 保留生命周期钩子，lifecycleOf 能取到', async () => {
  const { createPagesState } = await stateModule();
  const state = createPagesState({ homePage: 'home', managerPage: 'pages' }, 'home', {});

  const onActivate = () => {};
  const onDeactivate = () => {};
  state.registerPage({ id: 'paper', label: '论文', onActivate, onDeactivate });

  const hooks = state.lifecycleOf('paper');
  assert.equal(hooks.onActivate, onActivate);
  assert.equal(hooks.onDeactivate, onDeactivate);
});

test('没给钩子时 lifecycleOf 返回空对象，不报错', async () => {
  const { createPagesState } = await stateModule();
  const state = createPagesState({ homePage: 'home', managerPage: 'pages' }, 'home', {});
  state.registerPage({ id: 'plain', label: '普通页' });
  assert.deepEqual(state.lifecycleOf('plain'), {});
  assert.deepEqual(state.lifecycleOf('没这一页'), {});
});

test('非函数钩子被静默忽略（一个 typo 不该让注册失败）', async () => {
  const { createPagesState } = await stateModule();
  const state = createPagesState({ homePage: 'home', managerPage: 'pages' }, 'home', {});
  state.registerPage({ id: 'bad', label: '坏钩子', onActivate: 'not a function', onDeactivate: 42 });
  assert.deepEqual(state.lifecycleOf('bad'), {});
});

test('注销登记时执行 onDeactivate（页面被移除后副作用要清理）', async () => {
  const { createPagesState } = await stateModule();
  const state = createPagesState({ homePage: 'home', managerPage: 'pages' }, 'home', {});

  let deactivated = 0;
  const dispose = state.registerPage({
    id: 'temp', label: '临时页',
    onDeactivate: () => { deactivated += 1; },
  });

  dispose();
  assert.equal(deactivated, 1, '注销时应调用一次 onDeactivate');

  // 幂等：再注销一次不该重复执行
  dispose();
  assert.equal(deactivated, 1);
});

test('注销时 onDeactivate 抛错不阻止注销本身', async () => {
  const { createPagesState } = await stateModule();
  const state = createPagesState({ homePage: 'home', managerPage: 'pages' }, 'home', {});

  const dispose = state.registerPage({
    id: 'boom', label: '会抛错',
    onDeactivate: () => { throw new Error('清理炸了'); },
  });

  // 只警告，不抛给调用方 —— 否则一个页面的 bug 会让卸载流程中断。
  const originalWarn = console.warn;
  let warned = 0;
  console.warn = () => { warned += 1; };
  try {
    assert.doesNotThrow(() => dispose());
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warned, 1, '应记录一条警告');
  assert.equal(state.getSnapshot().pages.some(p => p.id === 'boom'), false, '页面本身仍要移除');
});

test('页面条目里不含函数（快照要能安全比较与序列化）', async () => {
  const { createPagesState } = await stateModule();
  const state = createPagesState({ homePage: 'home', managerPage: 'pages' }, 'home', {});
  state.registerPage({ id: 'p', label: '页', onActivate: () => {}, onDeactivate: () => {} });

  const entry = state.getSnapshot().pages.find(p => p.id === 'p');
  for (const [key, value] of Object.entries(entry)) {
    assert.notEqual(typeof value, 'function', `entry.${key} 不该是函数`);
  }
  // 能 JSON 序列化就说明没有函数/循环引用
  assert.doesNotThrow(() => JSON.stringify(entry));
});
