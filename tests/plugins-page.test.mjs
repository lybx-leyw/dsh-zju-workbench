/**
 * 插件依赖图的折叠规则。
 *
 * 这里钉的都是「错了会让人取消掉不该取消的包」的那几条：叶的判定、插槽边、两棵树的硬边，
 * 以及环不许让整页打不开。折叠是纯函数，所以可以直接喂运行时读数的形状断言。
 * 末尾那条接线守卫是自动扫描的：加页面包时最容易漏的就是那几处手写清单，
 * 而漏了的表现是「真机上一页空白」或「端到端 60 秒超时」，不是这里立刻红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildView, fiberNameIndex, orderGraph, readPlane, slotEdges, stripClientSuffix, ZHIYUN_PREFIX } from '../packages/dsh-zhiyun-page-plugins/src/runtime.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = relative => readFileSync(path.join(root, relative), 'utf8');

/** 造一个 Loader 条目形状；`parent` 是 Cordis 的 **Context**（它自己的 fiber 挂在 `.fiber` 上）。 */
function entry(name, inject, parent) {
  const fiber = { inject: inject ?? {}, parent };
  return { options: { name }, fiber };
}

/** 造一个「包 A 提供 service，包 B 需要 service」的平面读数。`resolved` 默认按是否有提供者推断。 */
function plane(rows) {
  const providers = new Map();
  for (const row of rows) for (const service of row.provides ?? []) if (!providers.has(service)) providers.set(service, row.name);
  return {
    rows: rows.map(row => ({
      name: row.name,
      requires: [...(row.requires ?? [])].sort(),
      // 真实读数里这是 fiber 自己 store 的答案；默认「谁 provide 了就算有实现」，
      // 内核/引导服务（提供者不属任何条目）用 `resolvedOn` 显式声明。
      unresolved: (row.requires ?? [])
        .filter(service => !providers.has(service) && !(row.resolvedOn ?? []).includes(service))
        .sort(),
    })),
    providers: [...providers.entries()],
  };
}

const bundle = (name, extra = {}) => ({
  name, enabled: true, removable: true, rows: [{ rowId: name, moduleName: name, entryId: `entry:${name}` }], ...extra,
});

/** 造 listPlugins() 的行：一个包一行，带行级开关与 fiber 相位。 */
const plugin = (name, extra = {}) => ({
  entryId: `entry:${name}`, moduleName: name, enabled: true, fiberPhase: null, ...extra,
});

test('模块说明符归一到图行：<包名>/client 与裸包名是同一行', () => {
  assert.equal(stripClientSuffix('dsh-zhiyun-shell-ui/client'), 'dsh-zhiyun-shell-ui');
  assert.equal(stripClientSuffix('dsh-zhiyun-shell-ui'), 'dsh-zhiyun-shell-ui');
  // 只有尾部整段 `/client` 才算，别把包名里的 client 也切掉。
  assert.equal(stripClientSuffix('@x/dsh-client-ui-slots'), '@x/dsh-client-ui-slots');
});

test('readPlane：包内的子 fiber 归到同一个包，硬边才认得出来', () => {
  // 包页面的 `ctx.inject(['zhiyunStudyController'], …)` 会生出子 fiber，
  // 等待关系住在子 fiber 上 —— 只读条目自己的 fiber 会漏掉这条边。
  // Cordis 的形状：fiber.parent 是 Context，父 fiber 经 `parent.fiber` 拿；
  // 而且 `entry.fiber` 就是 `runtime.fibers` 里那一个对象（不是副本）。
  const pageFiber = { inject: { slots: null }, store: {}, parent: null };
  const pageContext = { fiber: pageFiber };
  // 子 fiber 的 store 里已经有实现 = 它等到了；没有的才算「等待依赖」。
  const childFiber = { inject: { zhiyunStudyController: null }, store: { zhiyunStudyController: {} }, parent: pageContext };
  const coreFiber = { inject: { connection: null }, store: {}, parent: null };
  const store = { [Symbol('zhiyunStudyController')]: { name: 'zhiyunStudyController', fiber: coreFiber } };
  const read = readPlane({
    entries: [
      { options: { name: 'dsh-zhiyun-core-study' }, fiber: coreFiber },
      { options: { name: 'dsh-zhiyun-page-study' }, fiber: pageFiber },
    ],
    runtimes: [{ fibers: [coreFiber, pageFiber, childFiber] }],
    store,
  });
  const page = read.rows.find(row => row.name === 'dsh-zhiyun-page-study');
  assert.deepEqual(page.requires, ['slots', 'zhiyunStudyController'], '子 fiber 的 inject 要算到包上');
  assert.deepEqual(page.unresolved, ['slots'], 'store 里没有的才是「等待依赖」');
  assert.equal(read.providers.get('zhiyunStudyController'), 'dsh-zhiyun-core-study');
});

test('readPlane：内核服务的提供者不属任何条目，但不算「等待依赖」', () => {
  // ⚠️ 真机截图抓到的形状：`profileContext`、`loader` 由内核/引导提供，提供者 fiber 归不到
  //    任何 Loader 条目。若用「提供者能否归属到包」来判，这些正常依赖会被整片误报成
  //    「等待依赖」。判据必须是 fiber 自己 store 里有没有那一项。
  const fiber = { inject: { loader: null, profileContext: null }, store: { loader: {}, profileContext: {} }, parent: null };
  const read = readPlane({
    entries: [{ options: { name: 'dsh-zhiyun-core-vault' }, fiber }],
    runtimes: [{ fibers: [fiber] }],
    store: {}, // 内核服务不在 reflect 的条目归属表里
  });
  const row = read.rows.find(item => item.name === 'dsh-zhiyun-core-vault');
  assert.deepEqual(row.requires, ['loader', 'profileContext']);
  assert.deepEqual(row.unresolved, [], 'store 里有的就不算在等');
  assert.equal(read.providers.size, 0, '归不到包的服务不进连边表');
});

test('fiberNameIndex：只收有 Loader 条目的 fiber，未命名的不进表', () => {
  const index = fiberNameIndex([
    { options: { name: 'dsh-zhiyun-shell-workbench' }, fiber: { runtime: { name: 'zhiyun-shell-client' } } },
    // 没有 runtime.name 的（如 `ctx.inject` 生出的子 fiber）靠 fiber.name 兜底。
    { options: { name: 'dsh-zhiyun-page-me' }, fiber: { name: 'zhiyun-page-me-client' } },
    // 根 fiber 的兜底名是 'root'，不能进表（否则会把不相干的声明算到某个包上）。
    { options: { name: 'dsh-zhiyun-core-notes' }, fiber: { name: 'root' } },
    { options: { name: 'dsh-zhiyun-core-quiz' } },
  ]);
  assert.equal(index.get('zhiyun-shell-client'), 'dsh-zhiyun-shell-workbench');
  assert.equal(index.get('zhiyun-page-me-client'), 'dsh-zhiyun-page-me');
  assert.equal(index.has('root'), false);
  assert.equal(index.size, 2);
});

test('插槽边：填内容的包依赖声明插槽的包（外壳因此不会被当成叶）', () => {
  const inScope = new Set(['dsh-zhiyun-shell-workbench', 'dsh-zhiyun-page-today']);
  const roots = [{
    type: 'slot', name: 'main', declaredBy: 'dsh-zhiyun-shell-workbench',
    occupants: [],
    children: [{
      type: 'slot', name: 'zhiyun.today.content', declaredBy: 'dsh-zhiyun-shell-workbench',
      occupants: [{ registrant: 'dsh-zhiyun-page-today', active: true, priority: 0 }],
      children: [],
    }],
  }];
  assert.deepEqual(slotEdges(roots, inScope), [{ from: 'dsh-zhiyun-page-today', to: 'dsh-zhiyun-shell-workbench' }]);
  // 不在范围内的注册者不产生边。
  assert.deepEqual(slotEdges(roots, new Set(['dsh-zhiyun-shell-workbench'])), []);
});

test('插槽边：declaredBy 是诊断串、registrant 是 fiber 名，两个都要翻回包名', () => {
  // ⚠️ 真机踩到的两种形状：
  //    declaredBy 是 DSH 拼出来的诊断串 `an entry in "main" (zhiyun-shell-client)`，
  //    registrant 是插件自己导出的 name（`zhiyun-page-today-client`）—— 都不是包名。
  //    直接拿包名比对会一条边都匹配不上。
  const inScope = new Set(['dsh-zhiyun-shell-workbench', 'dsh-zhiyun-page-today']);
  const fiberNames = fiberNameIndex([
    { options: { name: 'dsh-zhiyun-shell-workbench' }, fiber: { runtime: { name: 'zhiyun-shell-client' } } },
    { options: { name: 'dsh-zhiyun-page-today' }, fiber: { runtime: { name: 'zhiyun-page-today-client' } } },
  ]);
  const shape = declaredBy => ([{
    type: 'slot', name: 'main', declaredBy,
    occupants: [],
    children: [{
      type: 'slot', name: 'zhiyun.today.content', declaredBy,
      occupants: [{ registrant: 'zhiyun-page-today-client', active: true, priority: 0 }],
      children: [],
    }],
  }]);
  const expected = [{ from: 'dsh-zhiyun-page-today', to: 'dsh-zhiyun-shell-workbench' }];
  assert.deepEqual(slotEdges(shape('an entry in "main" (zhiyun-shell-client)'), inScope, fiberNames), expected,
    '「an entry in …」是声明插槽的那条注册的写法');
  assert.deepEqual(slotEdges(shape('factory "x" (zhiyun-shell-client)'), inScope, fiberNames), expected,
    'factory 那条也要认');
  assert.deepEqual(slotEdges(shape('zhiyun-shell-client'), inScope, fiberNames), expected,
    '裸 fiber 名也照收');
  assert.deepEqual(slotEdges(shape('an entry in "main" (zhiyun-shell-client)'), inScope), [],
    '没有对照表就一条边都没有 —— 这正是要修的形状');
});

test('拓扑序：被依赖的在前，平局按运行时基线序', () => {
  const edges = new Map([['a', new Set(['b'])], ['b', new Set()], ['c', new Set()]]);
  const baseline = name => ({ a: 2, b: 1, c: 0 })[name];
  assert.deepEqual(orderGraph(['a', 'b', 'c'], edges, baseline).order, ['c', 'b', 'a']);
  assert.deepEqual(orderGraph(['a', 'b', 'c'], edges, baseline).cycles, []);
});

test('拓扑序：有环时不抛错，把环整组落地并报出来', () => {
  const edges = new Map([['a', new Set(['b'])], ['b', new Set(['a'])] , ['c', new Set()]]);
  const { order, cycles } = orderGraph(['a', 'b', 'c'], edges, name => ({ a: 0, b: 1, c: 2 })[name]);
  assert.deepEqual([...order].sort(), ['a', 'b', 'c'], '一个都不能丢');
  assert.deepEqual(cycles, [['a', 'b']], '环要如实报出来，而不是让整页打不开');
});

test('叶 = 没有任何包请求它；有下游的包不给勾选框', () => {
  const view = buildView({
    bundles: [bundle('dsh-zhiyun-core-parser'), bundle('dsh-zhiyun-core-study'), bundle('dsh-zhiyun-page-today')],
    modules: [
      { id: 'dsh-zhiyun-core-parser', inject: [], external: [] },
      { id: 'dsh-zhiyun-core-study', inject: [], external: [] },
      { id: 'dsh-zhiyun-page-today', inject: [], external: ['dsh-zhiyun-shell-ui'] },
    ],
    // 宿主面：study-core 硬依赖 parser 的服务。这条边决定 parser 不是叶。
    host: plane([
      { name: 'dsh-zhiyun-core-parser', provides: ['zhiyunParser'], requires: [] },
      { name: 'dsh-zhiyun-core-study', requires: ['zhiyunParser'] },
      { name: 'dsh-zhiyun-page-today', requires: [] },
    ]),
    client: plane([]),
    plugins: [
      plugin('dsh-zhiyun-core-parser'), plugin('dsh-zhiyun-core-study'), plugin('dsh-zhiyun-page-today'),
    ],
    slots: [],
  });
  const byName = Object.fromEntries(view.rows.map(row => [row.name, row]));
  assert.equal(byName['dsh-zhiyun-core-parser'].leaf, false, 'parser 被 study-core 硬依赖');
  assert.deepEqual(byName['dsh-zhiyun-core-parser'].dependents, ['dsh-zhiyun-core-study']);
  assert.equal(byName['dsh-zhiyun-core-parser'].cancellable, false, '有下游就不能勾');
  assert.equal(byName['dsh-zhiyun-core-study'].leaf, true);
  assert.equal(byName['dsh-zhiyun-core-study'].cancellable, true);
  assert.deepEqual(view.leaves.sort(), ['dsh-zhiyun-core-study', 'dsh-zhiyun-page-today']);
  // parser 必须排在 study-core 之前：依赖在前。
  assert.ok(view.order.indexOf('dsh-zhiyun-core-parser') < view.order.indexOf('dsh-zhiyun-core-study'));
});

test('关闭中的包不能勾；只读包不能勾；只统计本仓前缀', () => {
  const view = buildView({
    bundles: [
      bundle('dsh-zhiyun-page-today'),
      bundle('dsh-zhiyun-page-me'),
      bundle('dsh-zhiyun-page-study'),
      // `removable: false` 说的是「不能 pnpm remove」，不是「不能停用」——不能拿它当闸门。
      bundle('dsh-zhiyun-page-paper', { removable: false }),
      bundle('dsh-zhiyun-page-notes'),
      bundle('@deepseek-ai/dsh-client-ui-layout'),
    ],
    // 行级开关的真源：`page-me` 已经被用户关掉了，`page-study` 是只读的。
    plugins: [
      plugin('dsh-zhiyun-page-today'), plugin('dsh-zhiyun-page-paper'),
      plugin('dsh-zhiyun-page-me', { enabled: false }),
      plugin('dsh-zhiyun-page-study', { readOnlyReason: 'management-required' }),
    ],
    modules: [], host: plane([]), client: plane([]), slots: [],
  });
  // 四个之间没有任何边，于是平局按 profile 层序落地（不是字母序）——「依赖在前」定不下来的
  // 部分才交给层序，这样图不会因为一次重建就换个排布。
  assert.deepEqual(view.rows.map(row => row.name), [
    'dsh-zhiyun-page-today', 'dsh-zhiyun-page-me', 'dsh-zhiyun-page-study',
    'dsh-zhiyun-page-paper', 'dsh-zhiyun-page-notes',
  ], '上游包不进图，剩下的按层序');
  const cancellable = new Set(view.cancellable);
  assert.ok(cancellable.has('dsh-zhiyun-page-today'));
  assert.ok(cancellable.has('dsh-zhiyun-page-paper'), 'profile 依赖照样能停用（removable 不是闸门）');
  assert.ok(!cancellable.has('dsh-zhiyun-page-me'), '已经关掉的不该再给「取消」');
  assert.ok(!cancellable.has('dsh-zhiyun-page-study'), '只读的不该给勾选框');
  assert.ok(!cancellable.has('dsh-zhiyun-page-notes'), '没有 Loader 条目的行没有句柄，不能给勾选框');

  const byName = Object.fromEntries(view.rows.map(row => [row.name, row]));
  assert.equal(byName['dsh-zhiyun-page-me'].enabled, false, '行级开关决定这一行的状态');
  assert.equal(byName['dsh-zhiyun-page-me'].entryId, 'entry:dsh-zhiyun-page-me', '关掉的包也要留着句柄才能再打开');
  assert.equal(byName['dsh-zhiyun-page-today'].entryId, 'entry:dsh-zhiyun-page-today', '写动作要的是行句柄');
  assert.equal(byName['dsh-zhiyun-page-study'].readOnlyReason, 'management-required', '只读原因来自行');
});

test('层序违例：依赖排在消费者之后要说出来，但不重排', () => {
  const view = buildView({
    // profile 层序：study-core 在前、parser 在后 —— 与依赖序相反。
    bundles: [bundle('dsh-zhiyun-core-study'), bundle('dsh-zhiyun-core-parser')],
    modules: [], plugins: [], slots: [],
    host: plane([
      { name: 'dsh-zhiyun-core-parser', provides: ['zhiyunParser'] },
      { name: 'dsh-zhiyun-core-study', requires: ['zhiyunParser'] },
    ]),
    client: plane([]),
  });
  assert.deepEqual(view.layerViolations, [{ dependent: 'dsh-zhiyun-core-study', dependency: 'dsh-zhiyun-core-parser' }]);
  assert.ok(view.order.indexOf('dsh-zhiyun-core-parser') < view.order.indexOf('dsh-zhiyun-core-study'), '显示用的拓扑序照旧');
  assert.deepEqual(view.rows.map(row => row.name), view.order, '层序没有被改写');
});

test('等待依赖：被取消的提供者会让消费者带上 unresolved', () => {
  const view = buildView({
    // parser 被取消了（不在 bundles 里），study-core 还在。
    bundles: [bundle('dsh-zhiyun-core-study')],
    modules: [], plugins: [], slots: [],
    host: plane([{ name: 'dsh-zhiyun-core-study', requires: ['zhiyunParser', 'zhiyunClassroom'] }, { name: 'dsh-zhiyun-source-classroom', provides: ['zhiyunClassroom'] }]),
    client: plane([]),
  });
  // classroom 不在 bundles 里，所以图里没有它；study-core 无从解析 zhiyunParser。
  const row = view.rows.find(item => item.name === 'dsh-zhiyun-core-study');
  assert.deepEqual(row.waiting, ['zhiyunParser'], '缺哪个依赖要说清楚');
});

test('前缀可换：本仓默认只看 dsh-zhiyun-', () => {
  assert.equal(ZHIYUN_PREFIX, 'dsh-zhiyun-');
  const view = buildView({
    bundles: [bundle('acme-page'), bundle('dsh-zhiyun-page-today')],
    modules: [], plugins: [], slots: [], host: plane([]), client: plane([]), prefix: 'acme-',
  });
  assert.deepEqual(view.rows.map(row => row.name), ['acme-page']);
});

/**
 * 接线守卫（自动扫描，不是点名清单）。
 *
 * 加一个客户端包要动四处手写清单，漏任何一处的表现都不是「这里立刻红」，而是
 * 「真机上那一页空白」或「端到端 60 秒超时」：
 *   1. `scripts/build.mjs` 的 CLIENT_PACKAGES —— 漏了就没有 lib/client.js，模块表缺行；
 *   2. `profiles/zhiyun-bench/package.json` 的 bundles —— 漏了 Loader 不装载它；
 *   3. 外壳 NAV —— 漏了没有入口（页面注册了也没人打开）；
 *   4. `scripts/test-host.mjs` 的整体停用清单 —— 那条已经从 CLIENT_PACKAGES 推导了。
 */
test('接线：每个有客户端半边的包都进了构建清单、profile 与外壳 NAV', () => {
  const clientPackages = readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('dsh-zhiyun-'))
    .map(entry => entry.name)
    .filter(name => existsSync(path.join(root, 'packages', name, 'src', 'client.jsx')))
    .sort();
  assert.ok(clientPackages.length >= 8, `只扫到 ${clientPackages.length} 个客户端包，扫描器可能失效`);

  const build = read('scripts/build.mjs');
  const bundles = JSON.parse(read('profiles/zhiyun-bench/package.json')).dsh.profile.bundles;
  const nav = read('packages/dsh-zhiyun-shell-workbench/src/model.js');
  const missing = [];
  for (const name of clientPackages) {
    if (!new RegExp(`'${name}'`).test(build)) missing.push(`${name}: 不在 scripts/build.mjs 的 CLIENT_PACKAGES`);
    if (!bundles.includes(name)) missing.push(`${name}: 不在 profiles/zhiyun-bench 的 bundles`);
    // 声明了 `dsh.client` 就**必须**有 `./client` 出口 —— 否则宿主组装客户端模块表时
    // 直接抛「declares dsh.client but exports no "./client" bundle」并**拒启整个工作台**。
    // 这条是实测踩出来的：新建页面包时漏了 `"./client": "./lib/client.js"`，
    // 启动当场失败，而上面两条（build / bundles）都是绿的 —— 它们看不出这个洞。
    const manifest = JSON.parse(read(`packages/${name}/package.json`));
    if (manifest.dsh?.client !== undefined && manifest.exports?.['./client'] === undefined) {
      missing.push(`${name}: 声明了 dsh.client 但 exports 里没有 "./client"（宿主会拒启）`);
    }
  }
  // 页面包额外要求：NAV 里必须有一项与它的 `zhiyun.<id>.content` 插槽对应。
  for (const name of clientPackages.filter(item => item.startsWith('dsh-zhiyun-page-'))) {
    const entry = read(`packages/${name}/src/client.jsx`);
    const slot = /'zhiyun\.([a-z]+)\.content'/.exec(entry);
    if (slot === null) { missing.push(`${name}: 没有注册 zhiyun.<page>.content 插槽`); continue; }
    if (!new RegExp(`id: '${slot[1]}'`).test(nav)) missing.push(`${name}: 外壳 NAV 里没有 id: '${slot[1]}' 这一项`);
  }
  assert.deepEqual(missing, [], `接线不完整：\n${missing.join('\n')}`);
});

/**
 * r79：两处「看图的人会被误导」的折叠缺陷 —— 钉住现状，不是为了修，而是为了不让它悄悄变样。
 *
 * 为什么先钉而不先修：两处的正确形态都需要产品决定（见 docs/ecosystem-radar/2026-10-27-r79.md §5）：
 *   F-3 上游提供者要不要显示？F-4 环里的层序违例要不要全列出来？
 * 在没有决定之前动 `buildView`，会让页面上的文案与数字在无人察觉时改变。
 */
test('F-3 · 服务由上游包提供时，行上显示「不依赖任何包」而开关仍可点 —— 现状钉死', () => {
  // 真实形状：`dsh-zhiyun-core-notes` 真的 inject 了宿主提供的服务（如 office / vault），
  // 而提供者不在 `dsh-zhiyun-` 前缀内 → addEdge 因 !inScope.has(to) 直接丢弃。
  const view = buildView({
    bundles: [bundle('dsh-zhiyun-core-notes')],
    modules: [],
    host: { rows: [{ name: 'dsh-zhiyun-core-notes', requires: ['hostOffice'], unresolved: [] }], providers: [['hostOffice', '@deepseek-ai/dsh-host-office']] },
    client: { rows: [], providers: [] },
    plugins: [plugin('dsh-zhiyun-core-notes')],
    slots: [],
    fiberNames: new Map(),
  });
  const row = view.rows[0];
  // 现状：服务确实「已解析」（不在 waiting），但边被丢掉 → deps 为空、leaf 为真、可取消。
  assert.deepEqual(row.waiting, [], '服务有提供者，所以不显示「等待」');
  assert.deepEqual(row.deps, [], '提供者在范围外 → 边被静默丢弃');
  assert.equal(row.leaf, true);
  assert.equal(row.cancellable, true, '面板此时显示「不依赖本工作台的任何其他包」，并允许取消');
  // 若将来改成「显示上游提供者」，这里会红 —— 那时请同步改 Panel 文案与 §5 的结论。
});

test('F-4 · 环里的两条边只有一条进 layerViolations —— 取决于 Set 的插入顺序', () => {
  const names = ['dsh-zhiyun-a', 'dsh-zhiyun-b'];
  const view = buildView({
    bundles: names.map(name => bundle(name)),
    // 层序：a 在前、b 在后 → a→b 是违例；b→a 不是违例。但两者构成环。
    modules: [
      { id: 'dsh-zhiyun-a', inject: ['dsh-zhiyun-b'], external: [] },
      { id: 'dsh-zhiyun-b', inject: ['dsh-zhiyun-a'], external: [] },
    ],
    host: { rows: [], providers: [] },
    client: { rows: [], providers: [] },
    plugins: names.map(name => plugin(name)),
    slots: [],
    fiberNames: new Map(),
  });
  assert.deepEqual(view.cycles, [['dsh-zhiyun-a', 'dsh-zhiyun-b']], '环是被认出来的');
  const edges = Object.fromEntries(view.rows.map(row => [row.name, row.deps]));
  assert.deepEqual(edges['dsh-zhiyun-b'], ['dsh-zhiyun-a'], 'b→a 这条边确实在图里');
  // 但 layerIndex(a)=0 < layerIndex(b)=1 → 「依赖排在消费者之后」对 b→a 不成立，
  // 于是环里只报一条。页面文案说「环内无法定先后」，而这一栏仍按层序只报一边。
  assert.deepEqual(view.layerViolations, [{ dependent: 'dsh-zhiyun-a', dependency: 'dsh-zhiyun-b' }]);
});
