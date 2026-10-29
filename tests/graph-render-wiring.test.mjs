/**
 * 跨包客户端接线：`dsh-zhiyun-page-notes` external import `dsh-zhiyun-graph-render`。
 *
 * # 为什么值得一条常驻测试
 *
 * 这条接线是**整包移植**留下的：图谱渲染整包搬进 `dsh-zhiyun-graph-render`，
 * 页面只 `import { NoteGraph, css }`，自己不背 cytoscape。于是产生三处必须同时成立的约定：
 *
 *   1. 页面 `dsh.client.external` 里有 `dsh-zhiyun-graph-render`（否则 esbuild 会试图
 *      把整个渲染包连同 cytoscape 内联进页面 bundle —— 打包成功，但页面又背上了那份依赖）；
 *   2. `dsh-zhiyun-graph-render` 在 `CLIENT_PACKAGES` 里（否则它没有 `lib/client.js`，
 *      外部化后的 `require('dsh-zhiyun-graph-render')` 在运行时谁也解不到，图谱静默不显示）；
 *   3. 它在 profile 的 bundles 里（否则 Loader 根本不加载它，症状同上）。
 *
 * 三处**都不会**让构建报错，坏起来只是「图不出现」。所以拿真实产物跑一遍模块表：
 * 按宿主 `__ModuleLoader__` 的形状注册两个包，再按加载顺序解析，看图形组件能不能被页面拿到。
 *
 * 依赖 esbuild 与已安装的 node_modules；本仓根目录还没 `npm install` 时跳过（环境问题，
 * 不是回归）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * `scripts/build.mjs` 静态 `import 'esbuild'`，所以根目录没装依赖时**连 import 都会抛**
 * —— 那样「跳过」就跳不成了（模块解析失败发生在测试体之外）。
 * 因此这里动态探测：拿不到就当环境未就绪，整份跳过。
 */
async function loadBuildApi() {
  try {
    return await import('../scripts/build.mjs');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw error;
  }
}

/** 渲染包导出面：页面用到的那几项必须在。 */
const GRAPH_EXPORTS = ['NoteGraph', 'css', 'toElements', 'layoutFor', 'ringPositions', 'graphStyles', 'GRAPH_LAYOUT_LIMIT'];

/** 宿主在浏览器里提供的模块（这里只给到「能被 import 成功」的最小桩）。 */
function hostStubs() {
  const noop = () => null;
  return {
    react: {
      createElement: noop, cloneElement: noop, Fragment: noop,
      useRef: () => ({ current: null }), useEffect: () => {},
      useMemo: (fn) => fn(), useState: (v) => [v, () => {}],
      useCallback: (fn) => fn(), useContext: () => ({}),
    },
    'react/jsx-runtime': { jsx: noop, jsxs: noop, Fragment: noop },
    'react-dom': { createRoot: noop },
    'react-dom/client': { createRoot: noop },
    '@deepseek-ai/cordis': {},
    '@deepseek-ai/dsh-client-store': {},
    '@deepseek-ai/dsh-client-ui-slots': {},
    '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: noop },
    '@deepseek-ai/dsh-client-ui-dockkit': {},
    'dsh-zhiyun-shell-ui': { Icon: noop, Notice: noop, mountStyle: () => {} },
  };
}

/**
 * 产出是 `banner + 正文 + footer` 三段的 CJS。
 *
 * 宿主 Loader 执行的是 `factory(require)`，`module`/`exports` 由外壳预置。这里照抄
 * 同样的形状：剥掉外壳两行，重新包成 `(module, exports, require)` 再跑。
 */
async function loadInto(name, registry, buildClientPackage) {
  const { result } = await buildClientPackage(name, { write: false });
  const lines = result.outputFiles[0].text.split('\n');
  const inner = lines.slice(1, -2).join('\n');
  const factory = vm.runInNewContext(`(function(module, exports, require){${inner}\n})`, { console });
  const mod = { exports: {} };
  factory(mod, mod.exports, (spec) => {
    if (!(spec in registry)) throw new Error(`${name} require('${spec}')，模块表里没有（external 漏项或加载顺序错）`);
    return registry[spec];
  });
  return mod.exports;
}

test('页面 require 到的 graph-render 带着 NoteGraph 与 css（跨包接线成立）', async (t) => {
  const api = await loadBuildApi();
  if (api === null) {
    t.skip('根目录还没 npm install（解不开 esbuild）—— 环境问题，不是回归');
    return;
  }
  const { buildClientPackage } = api;

  // 没有 node_modules 时 esbuild 解不开 cytoscape —— 环境问题，跳过而不是红。
  try {
    await buildClientPackage('dsh-zhiyun-graph-render', { write: false });
  } catch (error) {
    t.skip(`构建依赖未就绪（多半是根目录还没 npm install）：${error instanceof Error ? error.message.split('\n')[0] : error}`);
    return;
  }

  const registry = hostStubs();
  // 加载顺序：宿主种子词 → 渲染包 → 页面（与 profile 的 bundles 顺序一致）。
  const graph = await loadInto('dsh-zhiyun-graph-render', registry, buildClientPackage);
  registry['dsh-zhiyun-graph-render'] = graph;

  for (const key of GRAPH_EXPORTS) {
    assert.ok(key in graph, `graph-render 没有导出 ${key}`);
  }
  assert.equal(typeof graph.NoteGraph, 'function', 'NoteGraph 必须是组件函数');
  assert.equal(typeof graph.css, 'string', 'css 必须是字符串（页面拿它传给 mountStyle）');
  assert.match(graph.css, /\.zs-nt-graph/, 'graph-render 的样式表里没有 .zs-nt-graph');
  assert.ok(graph.css.length > 100, `样式表疑似为空（${graph.css.length} 字符）`);
  // 与其它包一致的作用域前缀：少了它整块样式不生效（不是「稍微不一样」）。
  assert.match(graph.css, /body\[data-zhiyun\] \.zs-nt-graph/, '图谱样式缺 body[data-zhiyun] 前缀');

  // 最后再走一遍页面：它能跑起来，就证明 external 面真的解到了渲染包。
  const notes = await loadInto('dsh-zhiyun-page-notes', registry, buildClientPackage);
  assert.equal(typeof notes.apply, 'function', '页面没有导出 apply');
});

test('页面 dsh.client.external 里写着 graph-render，渲染包也在 CLIENT_PACKAGES 和 profile 里', async (t) => {
  const api = await loadBuildApi();
  // 这条只读 package.json，不需要 esbuild —— 但 CLIENT_PACKAGES 在 build.mjs 里，
  // 拿不到就只能把「清单」那半段跳过，前半段（manifest 与 profile）照样查。
  const CLIENT_PACKAGES = api?.CLIENT_PACKAGES ?? null;

  const notesManifest = JSON.parse(await readFile(`${root}packages/dsh-zhiyun-page-notes/package.json`, 'utf8'));
  const declared = notesManifest.dsh?.client?.external ?? [];
  assert.ok(declared.includes('dsh-zhiyun-graph-render'),
    '页面没有把 graph-render 写进 dsh.client.external —— esbuild 会把 cytoscape 内联进页面');

  if (CLIENT_PACKAGES === null) {
    t.diagnostic('解不开 scripts/build.mjs（未 npm install），跳过 CLIENT_PACKAGES 断言');
  } else {
    assert.ok(CLIENT_PACKAGES.includes('dsh-zhiyun-graph-render'),
      'graph-render 不在 CLIENT_PACKAGES 里 —— 它不会有 lib/client.js，外部化后运行时解不到');
  }

  const profile = JSON.parse(await readFile(`${root}profiles/zhiyun-bench/package.json`, 'utf8'));
  const bundles = profile.dsh?.profile?.bundles ?? [];
  assert.ok(bundles.includes('dsh-zhiyun-graph-render'),
    'graph-render 不在 profile 的 bundles 里 —— Loader 不会加载它，图谱静默不显示');

  // 渲染包自己不 external 任何东西：cytoscape 是纯库，没有共享实例需求，随包内联。
  const graphManifest = JSON.parse(await readFile(`${root}packages/dsh-zhiyun-graph-render/package.json`, 'utf8'));
  const graphExternal = graphManifest.dsh?.client?.external ?? [];
  assert.deepEqual(graphExternal, [],
    `graph-render 不应该 external 任何包（实际：${graphExternal.join(', ')}）—— 声明了却没人提供，` +
    '运行时会 require 失败');
  // 反过来，cytoscape 必须是真依赖（不是 devDependency）：产出要靠它。
  assert.ok(graphManifest.dependencies?.cytoscape, 'graph-render 的 dependencies 里没有 cytoscape');
  assert.ok(graphManifest.dependencies?.['cytoscape-fcose'], 'graph-render 的 dependencies 里没有 cytoscape-fcose');
  // 而页面**不**该再声明它们 —— 那是移植留下的旧依赖，留着就会误导下一个人。
  assert.equal(notesManifest.dependencies?.cytoscape, undefined,
    '页面还声明着 cytoscape —— 渲染已整包移植走，这份依赖不该留在页面里');
});

test('宿主种子词表没被这次移植改动', async (t) => {
  const api = await loadBuildApi();
  if (api === null) {
    t.skip('解不开 scripts/build.mjs（未 npm install）');
    return;
  }
  // 防止有人为了让构建过，把 cytoscape 塞进 HOST_SEEDS —— 宿主浏览器里没有它。
  for (const seed of api.HOST_SEEDS) {
    assert.ok(!/cytoscape/.test(seed), `HOST_SEEDS 里出现了 ${seed}：宿主不提供 cytoscape`);
  }
  assert.equal(api.HOST_SEEDS.length, 9, `宿主种子词应为 9 个（实际 ${api.HOST_SEEDS.length}）`);
});
