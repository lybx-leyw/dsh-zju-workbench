import { build } from 'esbuild';
import { mkdir, readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownPackageDirs } from './workspace-packages.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// The profile name shown in the sidebar comes from the lock file, so the label
// and the profile this workspace boots cannot drift apart.
const lock = JSON.parse(await readFile(`${root}runtime.lock.json`, 'utf8'));

/**
 * 宿主静态模块表里的种子词（`.ref/packages/client/web/src/seed.ts` 的 9 个键）。
 *
 * 浏览器里由宿主直接提供，任何本仓客户端包都必须 external 化。**这份表必须与宿主
 * 逐一对应，不能只列「目前用到的几个」**：
 *   - 漏了 `@deepseek-ai/cordis`：根 node_modules 里恰好有它，esbuild 会**静默**把整包
 *     内联进来，于是插件的 cordis 与宿主的是两个实例（`sideEffects:false` 还会把
 *     纯副作用 import 整个消掉）；
 *   - 漏了 `@deepseek-ai/dsh-client-store` / `dsh-client-ui-slots` / `dsh-client-ui-dockkit`：
 *     本机解不开，表现为 `Could not resolve` 构建失败。
 * 两种失效都很难第一眼归因，所以宁可现在多写 5 个词。
 *
 * `tests/build-seeds.test.mjs` 会证明这份表确实覆盖了源码里的全部裸模块 import。
 */
export const HOST_SEEDS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
];

/**
 * 客户端包 = 有 src/client.jsx 的包。每个包构建到自己的 lib/client.js。
 *
 * ⚠️ 这是一份**手工维护**的清单，新增页面包时必须加进来 —— 漏了不会报错，
 *    只会让那个包在运行时找不到客户端 bundle（`profiles/` 里写着它，Loader 能
 *    解析宿主半边，页面却渲染成空白占位）。这就是「规划」页第一次构建时发生的事。
 *    `tests/build-seeds.test.mjs` 有一条断言在盯着「有 client.jsx 的包是否都在这里」。
 */
export const CLIENT_PACKAGES = [
  // 产品级的 dsh-pages 默认值校准（51px 导航宽度）。目录名是 `pages-default`，
  // 发布名是 `@lybx-leyw/dsh-zju-pages-default`，所以这里写**目录名**。
  'pages-default',
  // 共享 UI 原语：目录名 `ui-shared`，发布名 `@lybx-leyw/dsh-zju-ui-shared`。
  // 同样写目录名 —— 这一列是 `packages/client/<目录>` 的键。
  'ui-shared',
  // `dsh-zhiyun-shell-workbench` / `-shell-bridge` 已归档到
  // `archive/deprecated-packages/`（产品界面外壳，当前 profile 不装配）。
  // **不要在这里加回来** —— 除非它们真的搬回 `packages/`；
  // 留着会让构建报 `no package directory named ...`。
  // 分域网络代理：目录 `netproxy`（原 `@lybx-leyw/dsh-zju-source-netproxy`），包名不变。
  'netproxy',
  // 一卡通凭据（原 `dsh-zhiyun-source-card`）：目录名 `login`，
  // 发布名 `@lybx-leyw/dsh-zju-source-login`。这一列同样写**目录名**。
  'login',
  // 拼题A 的设置分区（Cookie 粘贴入口）。
  // 拆包前这一格是 `campus`（学在浙大 + 拼题A 混装），按「设置分区跟凭证走」拆开后
  // 归 `pta` —— 它才有独立凭证；学在浙大走 CAS，不占分区。
  'pta',
  // 实验课平台的账号分区（`auth: "own"`：它有自己的密码，不并入一卡通）。
  'lab',
  // 邮箱：独立账号（`auth: "own"`），凭据不是一卡通那一套。
  'mail',
  // 各数据源的设置分区：只做状态展示与 Cookie 粘贴，不重复收 CAS 密码。
  'xxt',
  'zdbk',
  'cc98',
  'classroom',
  // 课堂的**页面**已归档（`page-classroom` / `-play` / `-build`）：
  // 产品侧只要「AI 教学」这条链路（生成课件 + 单张渲染），不要独立的课堂播放页。
  // **不要加回来** —— 加了会报 `no package directory named ...`。
  // 保留的 classroom 包只有 `classroom-agent`（有客户端半边）。
  // `classroom-renderer` 已不在任何清单里：它的渲染组件搬去了 `ui-shared`。
  'classroom-agent',
  'quiz',
  // `core-study` 的目录名是 `study`（住在 `packages/core/` 下）。
  // `packageDir()` 按**目录的 basename** 查找，所以这一列只能写目录名 ——
  // 写包名会 `no package directory named "@lybx-leyw/..."`。
  'study',
  // 回放下面那层「主线/语速/四汇总」由本包算，学习页 external import 它 ——
  // 所以它必须有自己的客户端产物。（远端以旧名 `dsh-zhiyun-player` 加入，
  // 本仓按性质改名为 `core-player`，合并时对应成新名。）
  'player',
  // 回放字幕轨：学习页视频栏 external import 它的 `resolveTrack` / `burnLine`
  // （清洗句子替换原始碎片、字幕烧进播放器），所以它必须有自己的客户端产物。
  'playback',
  'page-study',
  'page-quiz',
  'page-planning',
  // `dsh-zhiyun-settings-account` 已归档到 `archive/deprecated-packages/`
  // （账号面板占位，从未装配）。**不要加回来** —— 加了会报
  // `no package directory named "dsh-zhiyun-settings-account"`。
  // 图谱渲染层：「笔记」页 external import 它（整包移植自雷达候选 note-graph），
  // 所以它必须有自己的客户端产物 —— 否则外部化后运行时谁都提供不了这个模块。
  //
  // ⚠️ 这一列写**目录名**（`packageDir()` 按 basename 递归找），不是包名。
  // 包已迁到 `packages/client/graph-render`，包名是
  // `@lybx-leyw/dsh-zju-ui-graph-render` —— 但这里只能写目录短名。
  'graph-render',
  'page-notes',
  // 目录名是 `page-paper`（住在 `packages/client/`），发布名才是
  // `@lybx-leyw/dsh-zju-page-paper`。`CLIENT_PACKAGES` 是**目录 basename** 的键。
  'page-paper',
  'page-plugins',
  'page-docs',
  // ⚠️ `classroom-renderer` 已从本清单删除：渲染组件（含 React / katex）已搬到
  // `packages/client/ui-shared/src/classroom-slide.jsx`，`core/classroom-renderer`
  // 只剩两个画布常量，**没有客户端半边**了。
];

/**
 * 构建一个客户端包。
 *
 * `write: false` + `metafile: true` 供测试在不落盘的前提下核对「external 面是否完整」
 * —— 只要有 node_modules 里的文件进了产出，就说明某个裸模块 import 没被 external 化。
 *
 * @param name - 包目录名（也是产物 banner 里的启动图谱行 id）。
 * @param options - `write`（默认 true）、`metafile`（默认 false）。
 * @returns 该包的 external 声明与 esbuild 结果。
 */
/**
 * 找出包内 vendored 源码的根目录（`packages/<name>/vendor/<x>/`），没有则返回 null。
 *
 * 目前没有包使用这种形态：「页面壳」`@lybx-leyw/dsh-pages` 已改为锁版本的 npm
 * 依赖，源码与产物都在 node_modules 里，本仓不再保留副本。保留这个探测是为了
 * 让「有人又放了一份 vendor 客户端源码」时被显式发现，而不是静默不构建。
 *
 * 判定只看目录结构，不看 package.json 字段：一个包最多有一份 vendored 源码，
 * 多于一份属于配置错误，直接报错而不是猜。
 *
 * @param pkg - 包目录（以 `/` 结尾）。
 * @returns vendored 源码根目录（以 `/` 结尾），或 null。
 */
async function findVendoredSource(pkg) {
  const vendorRoot = `${pkg}vendor/`;
  let entries;
  try {
    entries = await readdir(vendorRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await access(`${vendorRoot}${entry.name}/src/client.jsx`);
      candidates.push(`${vendorRoot}${entry.name}/`);
    } catch { /* not a vendored client package */ }
  }
  if (candidates.length > 1) {
    throw new Error(`${pkg}vendor/ 下有多个客户端源码目录：${candidates.join(', ')}。一个包只应 vendor 一份。`);
  }
  return candidates[0] ?? null;
}

/**
 * 包的客户端源码根目录，以 `/` 结尾；没有客户端入口则返回 null。
 *
 * 导出它，是因为 `tests/build-seeds.test.mjs` 需要判断「这个包有没有客户端半边」。
 * 让测试复用这同一份解析，避免两处各自硬编码路径后漂移。
 *
 * 包既可能平铺（`packages/<name>/`），也可能在分组目录下
 * （`packages/client/<name>/`），所以按目录名反查真实路径，不拼字符串。
 *
 * @param name - 包目录名。
 * @returns 源码根目录（以 `/` 结尾），或 null。
 */
export async function clientSourceRoot(name) {
  const pkg = await packageDir(name);
  if (pkg === undefined) return null;
  const vendored = await findVendoredSource(pkg);
  if (vendored !== null) throw new Error(`${name} 使用了 vendor 客户端源码（${vendored}），当前不支持：请改为 npm 依赖。`);
  try {
    await access(`${pkg}src/client.jsx`);
    return pkg;
  } catch {
    return null;
  }
}

/**
 * 一个包目录的绝对路径（以 `/` 结尾），按目录名在 `packages/` 与一层分组目录里查找。
 *
 * @param name - 包目录名。
 * @returns 路径，或 undefined。
 */
export async function packageDir(name) {
  const dir = (await ownPackageDirs(`${root}packages`)).find(candidate => path.basename(candidate) === name);
  return dir === undefined ? undefined : `${dir.replaceAll('\\', '/')}/`;
}

export async function buildClientPackage(name, options = {}) {
  const pkg = await packageDir(name);
  if (pkg === undefined) throw new Error(`buildClientPackage: no package directory named "${name}"`);
  const manifest = JSON.parse(await readFile(`${pkg}package.json`, 'utf8'));
  // 单一真源：跨包 import 的 external 面写在 package.json 的 dsh.client.external，
  // 构建直接照用 —— 两处各写一份迟早漂移（漂移的后果是运行时 require 打不进模块表）。
  const declared = manifest.dsh?.client?.external ?? [];
  // 产物一律写本包 lib/：源码只有 `packages/<name>/src/` 一种形态（见 clientSourceRoot）。
  const sourceRoot = pkg;
  const outRoot = pkg;
  const result = await build({
    entryPoints: [`${sourceRoot}src/client.jsx`],
    outfile: `${outRoot}lib/client.js`,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: [...HOST_SEEDS, ...declared],
    // `.md` 进 text loader：文档页把 `src/docs/*.md` 当字符串打进 bundle
    //（见 dsh-zhiyun-page-docs）。esbuild 默认不认识 .md，不配这一行会在构建时
    // 直接报 "No loader is configured for .md files"。用 text 而不是自己写插件，
    // 是因为正文只需要原文，不需要在构建期解析。
    loader: { '.css': 'text', '.svg': 'text', '.md': 'text' },
    define: { 'process.env.NODE_ENV': '"production"', __ZHIYUN_PROFILE__: JSON.stringify(lock.profile) },
    // banner 的 id 必须等于**包名**（manifest.name），不是目录名：客户端模块表按
    // `stripClientSuffix(id)` 建行，而启动图谱的行 id 是宿主 Loader 条目的 name ——
    // 那个 name 来自 profile bundles 里的 npm 包名。目录名可以不同（例如
    // `packages/client/pages-default/` 发布为 `@lybx-leyw/dsh-zju-pages-default`），
    // 两者混用会让模块表建不出该行，页面静默空白。
    banner: { js: `window.__ModuleLoader__.load({id:"${manifest.name}",factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
    footer: { js: 'return module.exports;}});' },
    write: options.write !== false,
    metafile: options.metafile === true,
  });
  return { name, declared, result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const name of CLIENT_PACKAGES) {
    const { declared } = await buildClientPackage(name);
    console.log(`Built ${name}${declared.length > 0 ? ` (external: ${declared.join(', ')})` : ''}`);
  }
  console.log('Client bundles built. React and the host seed words are provided by DSH.');
}

