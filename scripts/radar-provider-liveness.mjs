#!/usr/bin/env node
// 检查器：「插件」页的依赖图，会不会把一个**已经关掉的包**当成「不再需要它的服务」的提供者？
//
// 背景（r83）：`runtime.js` 的 `readPlane()` 只从**活着的** Loader 条目 / fiber 里读
// 「谁提供哪个服务」。用户关掉一个包之后，它的 fiber 不存在了，于是
//   ① 它这一行从 `host.rows` 消失 → 它自己声明的 `requires` 一并消失；
//   ② 它提供的服务从 `providers` 表里消失（`reflect.store` 里不再有那一项）。
// 后果不是报错，而是**图静默变薄**：原本「被它需要」的那个包变成没有任何下游，
// 于是被判成叶、被判成 `cancellable`、页面文案还会写上「不依赖本工作台的任何其他包」。
// 用户看到的是一张更干净、更正确的图 —— 而它已经不对了。
//
// 本脚本把这件事做成**可复跑的判定**：喂两种读数（关掉之前 / 关掉之后），
// 逐步移除被关包的活读数，看有多少条「曾经存在」的依赖边在新图里消失。
//
// 退出码：0 = 无差异（图对开关不透明）；1 = 有边因关包而消失（判 LIVENESS_ERODES）；
//        2 = 前置失败（模块导不出来 / 输入不合法）。
//
// 用法：
//   node scripts/radar-provider-liveness.mjs            # 判定 + 打印明细
//   node scripts/radar-provider-liveness.mjs --json     # 只输出 JSON（给测试用）

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const RUNTIME = path.join(root, 'packages/dsh-zhiyun-page-plugins/src/runtime.js');

// 用本仓真实的包名前缀与一个「教科书形状」的平面：parser 提供 zhiyunParser，
// study-core 需要它，page-today 需要 study-core 的一条服务。三包都活着时，
// 图应当是 page-today → study-core → parser，唯一的叶是 page-today。
const PKG = Object.freeze({
  parser: 'dsh-zhiyun-core-parser',
  study: 'dsh-zhiyun-core-study',
  today: 'dsh-zhiyun-page-today',
});

/**
 * 造一个平面读数（`readPlane` 的输入/输出同形：`rows` + `providers`）。
 *
 * 刻意**不**调 `readPlane` 造，而是直接给出已经折好的形状：本脚本要验的是
 * `buildView` 对「读数变薄」的反应，不是 `readPlane` 自己的归属算法（那有单测）。
 * @param live - 哪些包此刻是活的（关掉的包不贡献任何读数）。
 */
export function planeOf(live) {
  const spec = {
    [PKG.parser]: { inject: [], resolved: [], provides: 'zhiyunParser' },
    [PKG.study]: { inject: ['zhiyunParser'], resolved: ['zhiyunParser'] },
    [PKG.today]: { inject: ['zhiyunStudyController'], resolved: ['zhiyunStudyController'] },
  };
  // study-core 提供 zhiyunStudyController；它关掉后这条服务从 providers 消失。
  const providers = new Map();
  for (const name of live) if (spec[name]?.provides) providers.set(spec[name].provides, name);
  if (live.includes(PKG.study)) providers.set('zhiyunStudyController', PKG.study);
  const rows = live.map(name => ({
    name,
    requires: [...spec[name].inject].sort(),
    // 关掉的包不在 live 里，所以这里的 resolved 永远是「活着且等到了」。
    unresolved: [...spec[name].inject].filter(service => !spec[name].resolved.includes(service)).sort(),
  }));
  return { rows, providers: [...providers.entries()] };
}

/** 全部活着时的包清单（`listBundles()` 的形状）。 */
export function bundlesOf() {
  return [PKG.parser, PKG.study, PKG.today].map(name => ({
    name, enabled: true, removable: true,
    rows: [{ rowId: name, moduleName: name, entryId: `entry:${name}` }],
  }));
}

/**
 * 把 `buildView` 的输出折成边集：`from` 依赖 `to`。
 * 只看 `deps`（正向），不重算（重算就等于把被测实现抄一遍）。
 */
export function edgesOf(view) {
  const edges = new Set();
  for (const row of view.rows) for (const dep of row.deps) edges.add(`${row.name} -> ${dep}`);
  return edges;
}

/**
 * 主判定：先把每个包**单独**关掉算一次图，与「全部活着」的边集比。
 *
 * 只关一个、不连坐：关一个包会连带让它的下游失去服务，下游若也一起从读数里消失，
 * 就分不清「这条边是关 A 弄丢的」还是「关 B 弄丢的」。逐个关，归因才是干净的。
 *
 * @param buildView - `packages/dsh-zhiyun-page-plugins/src/runtime.js` 的 `buildView`。
 * @param plugins - 行级开关读数（`listPlugins()` 形状）；`enabled:false` 表示用户关掉了它。
 * @returns `{ baseline, cases }`；`cases[i].lost` 是这一步消失的边。
 */
export function probe(buildView, plugins) {
  const bundles = bundlesOf();
  const full = buildView({ bundles, modules: [], host: planeOf(Object.values(PKG)), client: planeOf([]), plugins, slots: [] });
  const baseline = edgesOf(full);
  const cases = [];
  // 逐个把包「关掉」——关掉一个包 = 它的行还在（`listBundles` 仍列出），
  // 但 fiber 不在了，于是 `readPlane` 不会给出它的任何读数。
  for (const name of Object.values(PKG)) {
    const live = Object.values(PKG).filter(other => other !== name);
    const view = buildView({
      bundles, modules: [],
      host: planeOf(live), client: planeOf([]),
      plugins: plugins.map(row => (row.moduleName === name ? { ...row, enabled: false } : row)),
      slots: [],
    });
    const edges = edgesOf(view);
    const lost = [...baseline].filter(edge => !edges.has(edge));
    const row = view.rows.find(item => item.name === name);
    cases.push({
      closed: name,
      lost,
      // 被关掉的那个包自己此刻的判定（它已不运行，cancellable 必为 false；看 leaf 才有意义）
      closedRow: row === undefined ? null : { leaf: row.leaf, cancellable: row.cancellable, dependents: row.dependents },
      // 关键断言材料：**别的**包因为这次关包而新获得「可取消」资格
      newlyCancellable: view.rows
        .filter(item => item.name !== name && item.cancellable)
        .map(item => item.name),
    });
  }
  return { baseline: [...baseline], cases };
}

/** 打印用的一行判定。 */
export function verdictOf(result) {
  const erosion = result.cases.filter(item => item.lost.length > 0);
  return {
    code: erosion.length === 0 ? 'LIVENESS_STABLE' : 'LIVENESS_ERODES',
    lost: erosion.reduce((sum, item) => sum + item.lost.length, 0),
    affected: erosion.map(item => ({ closed: item.closed, lost: item.lost })),
  };
}

async function main() {
  const json = process.argv.includes('--json');
  let runtime;
  try {
    runtime = await import(pathToFileURL(RUNTIME).href);
  } catch (error) {
    console.error(`✗ 前置失败：导不出 ${RUNTIME}：${error?.message ?? error}`);
    process.exit(2);
  }
  if (typeof runtime.buildView !== 'function') {
    console.error('✗ 前置失败：runtime.js 没有导出 buildView');
    process.exit(2);
  }
  const plugins = Object.values(PKG).map(name => ({ entryId: `entry:${name}`, moduleName: name, enabled: true, fiberPhase: null }));
  const result = probe(runtime.buildView, plugins);
  // 防空跑：基线为空时边集差分恒为空，判定只能是 LIVENESS_STABLE —— 那不是「稳定」，
  // 是「没东西可丢」。这种输入一律按前置失败处理，免得被当成绿灯引用。
  if (result.baseline.length === 0) {
    console.error('✗ 前置失败：基线边集为空（buildView 没给出任何依赖边），判定无判别力');
    process.exit(2);
  }
  const verdict = verdictOf(result);
  if (json) {
    console.log(JSON.stringify({ verdict, baseline: result.baseline, cases: result.cases }, null, 2));
    process.exit(verdict.code === 'LIVENESS_STABLE' ? 0 : 1);
  }
  console.log(`基线边集（全部活着）：${result.baseline.join(' | ') || '（空）'}`);
  for (const item of result.cases) {
    const short = item.closed.replace(/^dsh-zhiyun-/, '');
    console.log(`\n关掉 ${short}：`);
    console.log(`  消失的边：${item.lost.length === 0 ? '（无）' : item.lost.join(' | ')}`);
    console.log(`  它自己：leaf=${item.closedRow?.leaf} cancellable=${item.closedRow?.cancellable}`);
    console.log(`  因此新获得「可取消」的包：${item.newlyCancellable.map(name => name.replace(/^dsh-zhiyun-/, '')).join('、') || '（无）'}`);
  }
  if (verdict.code === 'LIVENESS_STABLE') {
    console.log('\n✓ 图对行的开关是透明的：关掉一个包，不会让别的包的依赖凭空消失。');
    process.exit(0);
  }
  console.log(`\n✗ 判定不通过：${verdict.code}（${verdict.lost} 条边因关包而消失）`);
  console.log('  含义：关掉一个包之后，它的下游不再显示「在被依赖」，于是被当成叶、');
  console.log('  被当成可取消 —— 页面给的是一张更干净但已经不对的图。');
  process.exit(1);
}

// 只有直接执行才跑 main；被 import 时只导出纯函数（测试要用）。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
