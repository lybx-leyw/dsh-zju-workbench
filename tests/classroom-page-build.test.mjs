/**
 * 「课堂生成」页的两道闸。
 *
 * 1. **事件流归约**：正常流、中途取消、错误事件、空流。这些转移全在
 *    `src/progress.js`，裸 Node 直接 import，不构建、不起浏览器。
 * 2. **三步各自能渲染**：`renderToStaticMarkup` 真跑一遍组件树。语法正确不等于
 *    跑起来不炸（TDZ、hooks 顺序、undefined 的 props 都是运行时错误）——
 *    这个仓库在「规划」页上踩过一次白屏，所以页面包都要有这一条。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PHASE,
  SCENE_STATUS,
  addOutlineScene,
  createOutline,
  initialState,
  moveOutlineScene,
  outlineReady,
  reduce,
  reduceAll,
  removeOutlineScene,
  updateOutlineScene,
} from '../packages/dsh-zhiyun-page-classroom-build/src/progress.js';
import {
  SLOT_NAME,
  name as hostName,
  registerSlot,
} from '../packages/dsh-zhiyun-page-classroom-build/src/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));

/* ────────────────────────────── 插件面 ────────────────────────────── */

test('宿主半边是空壳，客户端把页面注册进 zhiyun.classroom.build', () => {
  assert.equal(hostName, 'zhiyun-page-classroom-build');
  assert.equal(SLOT_NAME, 'zhiyun.classroom.build');

  let injected = null;
  let registered = null;
  const scope = {
    slots: {
      inject(name, callback) {
        injected = name;
        callback();
      },
      register(descriptor, component) {
        registered = { descriptor, component };
      },
    },
  };
  const Page = () => null;
  registerSlot(scope, Page);

  assert.equal(injected, SLOT_NAME);
  assert.equal(registered.descriptor.name, SLOT_NAME);
  assert.equal(registered.component, Page);
});

/* ────────────────────────────── 归约 ────────────────────────────── */

test('正常流：场景逐个出现，done 收尾', () => {
  const state = reduceAll([
    { type: 'run_start' },
    { type: 'scene_start', data: { id: 's1', type: 'slide', title: '导入' } },
    { type: 'scene_done', data: { scene: { id: 's1' } } },
    { type: 'scene_start', data: { id: 's2', type: 'quiz', title: '随堂检测' } },
    { type: 'scene_done', data: { id: 's2' } },
    { type: 'done' },
  ]);

  assert.equal(state.phase, PHASE.done);
  assert.equal(state.done, true);
  assert.equal(state.error, null);
  assert.equal(state.scenes.length, 2);
  assert.deepEqual(state.scenes.map((scene) => scene.id), ['s1', 's2']);
  assert.deepEqual(state.scenes.map((scene) => scene.status), ['done', 'done']);
  // scene_done 只带 id 时不能把标题冲成 id。
  assert.deepEqual(state.scenes.map((scene) => scene.title), ['导入', '随堂检测']);
  assert.deepEqual(state.scenes.map((scene) => scene.type), ['slide', 'quiz']);
});

test('中途取消：正在跑的场景落成 cancelled，终局后迟到事件不翻案', () => {
  const running = reduceAll([
    { type: 'run_start' },
    { type: 'scene_start', data: { id: 's1', title: '导入' } },
  ]);
  assert.equal(running.phase, PHASE.running);
  assert.equal(running.done, false);
  assert.equal(running.scenes[0].status, SCENE_STATUS.running);

  const cancelled = reduce(running, { type: 'cancel' });
  assert.equal(cancelled.phase, PHASE.cancelled);
  assert.equal(cancelled.done, true);
  assert.equal(cancelled.error, null);
  assert.equal(cancelled.scenes[0].status, SCENE_STATUS.cancelled);

  // 在途的 scene_done / error 在取消之后才到：必须忽略。
  const lateDone = reduce(cancelled, { type: 'scene_done', data: { id: 's1' } });
  const lateError = reduce(cancelled, { type: 'error', data: { message: 'abort' } });
  assert.equal(lateDone, cancelled);
  assert.equal(lateError, cancelled);
});

test('错误事件：phase=failed、done=true、error 带 message/code，在跑的场景标失败', () => {
  const state = reduceAll([
    { type: 'run_start' },
    { type: 'scene_start', data: { id: 's1', title: '导入' } },
    { type: 'error', data: { message: '模型超时', code: 'E_TIMEOUT' } },
  ]);

  assert.equal(state.phase, PHASE.failed);
  assert.equal(state.done, true);
  assert.deepEqual(state.error, { message: '模型超时', code: 'E_TIMEOUT' });
  assert.equal(state.scenes[0].status, SCENE_STATUS.failed);
});

test('空流：保持 idle，不冒充完成', () => {
  assert.deepEqual(reduceAll([]), initialState());
  assert.deepEqual(reduceAll(null), initialState());
  assert.deepEqual(reduceAll(undefined), initialState());
  assert.equal(initialState().phase, PHASE.idle);
  assert.equal(initialState().done, false);
});

test('归约不改入参，未知事件原样返回', () => {
  const before = reduceAll([{ type: 'run_start' }]);
  const snapshot = JSON.parse(JSON.stringify(before));
  const after = reduce(before, { type: 'scene_start', data: { id: 's1' } });
  assert.deepEqual(before, snapshot, 'reduce 不能改旧状态');
  assert.notEqual(after, before);

  const ignored = reduce(after, { type: 'text_delta', data: { content: '...' } });
  assert.equal(ignored, after, '无关事件应返回原引用，省一次重渲染');
  const nonsense = reduce(after, null);
  assert.equal(nonsense, after);
});

test('重复的 scene_done 幂等，迟到的 scene_start 不把终局场景拉回 running', () => {
  const done = reduceAll([
    { type: 'scene_start', data: { id: 's1', title: '导入' } },
    { type: 'scene_done', data: { id: 's1' } },
  ]);
  const again = reduce(done, { type: 'scene_done', data: { id: 's1' } });
  assert.equal(again, done);

  const lateStart = reduce(done, { type: 'scene_start', data: { id: 's1' } });
  assert.equal(lateStart.scenes[0].status, SCENE_STATUS.done);
});

test('大纲事件先铺 pending；无 id 的场景错误只标当前场景，不造幽灵行', () => {
  const planned = reduceAll([{
    type: 'outline',
    data: { scenes: [{ id: 's1', type: 'slide', title: '导入' }, { id: 's2', type: 'quiz', title: '测验' }] },
  }]);
  assert.equal(planned.phase, PHASE.running);
  assert.deepEqual(planned.scenes.map((scene) => scene.status), ['pending', 'pending']);

  const started = reduce(planned, { type: 'scene_start', data: { id: 's1' } });
  const failed = reduce(started, { type: 'scene_error', data: { message: '这一段生成失败' } });
  assert.equal(failed.scenes.length, 2, '不能多出第三个场景');
  assert.deepEqual(failed.scenes.map((scene) => scene.status), ['failed', 'pending']);
  // 单场景失败不是整条流的终局：还能继续生成下一节。
  assert.equal(failed.phase, PHASE.running);
  assert.equal(failed.done, false);
});

/* ────────────────────────────── 大纲 ────────────────────────────── */

test('大纲：brief 生成骨架，增删改与拖序都是纯函数', () => {
  const outline = createOutline({ topic: '傅里叶变换', depth: 'deep' });
  assert.deepEqual(outline.map((scene) => scene.type), ['slide', 'slide', 'slide', 'slide', 'interactive', 'quiz']);
  assert.equal(outline[0].title, '导入：傅里叶变换');
  assert.equal(outlineReady(outline), true);

  const added = addOutlineScene(outline, 'pbl');
  assert.equal(added.length, outline.length + 1);
  assert.equal(added.at(-1).type, 'pbl');
  assert.equal(new Set(added.map((scene) => scene.id)).size, added.length, 'id 不能撞');

  const renamed = updateOutlineScene(added, added.at(-1).id, { title: '课程项目', type: 'quiz' });
  assert.equal(renamed.at(-1).title, '课程项目');
  assert.equal(renamed.at(-1).type, 'quiz');

  const moved = moveOutlineScene(renamed, 0, 2);
  assert.equal(moved[2].id, renamed[0].id);
  assert.equal(moveOutlineScene(renamed, 0, 0), renamed, '原地不动返回原引用');
  assert.equal(moveOutlineScene(renamed, -1, 3), renamed, '越界不动');

  const removed = removeOutlineScene(moved, moved[0].id);
  assert.equal(removed.length, moved.length - 1);
  assert.equal(outline.length, 6, '原数组不能被改');
});

/* ────────────────────────────── 渲染 ────────────────────────────── */

/**
 * 把 client.jsx 打成可 import 的 ESM，并把 `dsh-zhiyun-shell-ui` 换成最小桩。
 * React 必须 external —— 打进来会有两份 React，hooks 直接拿到 null dispatcher。
 */
async function loadClient(suffix = '') {
  const { build } = await import('esbuild');
  const dir = await mkdtemp(path.join(root, '.verify-render-'));
  const outfile = path.join(dir, `client-${suffix}.mjs`);
  try {
    await build({
      entryPoints: [path.join(root, 'packages/dsh-zhiyun-page-classroom-build/src/client.jsx')],
      bundle: true,
      write: true,
      outfile,
      format: 'esm',
      jsx: 'automatic',
      logLevel: 'silent',
      external: ['react', 'react/jsx-runtime', 'react-dom'],
      loader: { '.css': 'text' },
      plugins: [{
        name: 'stub-shell-ui',
        setup(builder) {
          builder.onResolve({ filter: /^dsh-zhiyun-shell-ui$/ }, () => ({ path: 'stub', namespace: 'stub' }));
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: 'export const mountStyle = () => {};',
            loader: 'js',
            resolveDir: root,
          }));
        },
      }],
    });
    return await import(`file://${outfile.replace(/\\/g, '/')}?v=${suffix}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('三步各自能渲染（白屏闸）', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const client = await loadClient('steps');

  for (const component of ['BriefStep', 'OutlineStep', 'GenerateStep']) {
    assert.equal(typeof client[component], 'function', `必须导出 ${component}`);
  }

  const brief = renderToStaticMarkup(React.createElement(client.BriefStep, {}));
  assert.match(brief, /zyc-build-brief/, '第一步应渲染出 brief 面板');
  assert.match(brief, /主题/);
  assert.match(brief, /下一步：看大纲/);

  const outline = renderToStaticMarkup(React.createElement(client.OutlineStep, {
    scenes: createOutline({ topic: '测试主题' }),
  }));
  assert.match(outline, /zyc-build-outline/, '第二步应渲染出大纲面板');
  assert.match(outline, /场景大纲/);
  assert.match(outline, /添加场景/);

  const generate = renderToStaticMarkup(React.createElement(client.GenerateStep, {
    brief: { topic: '测试主题' },
    outline: createOutline({ topic: '测试主题' }),
  }));
  assert.match(generate, /zyc-build-generate/, '第三步应渲染出进度面板');
  assert.match(generate, /尚未开始/);
});

test('整页在没有宿主服务时也能渲染', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const client = await loadClient('page');

  for (const ctx of [
    null,
    undefined,
    {},
    { get: () => undefined },
    { get: () => { throw new Error('no inject'); } },
    // 有外壳导航：`navigationOf` 会拿到服务，「去播放」按钮的条件成立 —— 渲染仍不该炸
    { get: (name) => (name === 'zhiyunNavigation' ? { navigate() {} } : undefined) },
  ]) {
    assert.doesNotThrow(
      () => renderToStaticMarkup(React.createElement(client.ClassroomBuild, { ctx })),
      `ctx=${String(ctx)} 时不该抛`,
    );
  }
});
