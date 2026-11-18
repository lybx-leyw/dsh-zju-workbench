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
  // 这一列写**目录 basename**（`packageDir()` 按 basename 递归查找），不是包名。
  //
  // 2026-11-18：未接入页面的数据源与工具包已整体归档（见仓库根的归档说明）。
  // 现存客户端半边只剩页面壳、共享 UI、保留页面，以及几条支撑学习页的 core 包。
  'pages-default',
  'ui-shared',
  'login',
  'classroom',
  'study',
  'player',
  'playback',
  'quiz',
  'graph-render',
  'page-docs',
  'page-notes',
  'page-paper',
  'page-planning',
  'page-plugins',
  'page-quiz',
  'page-study',
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
    //（见 dsh-zju-page-docs）。esbuild 默认不认识 .md，不配这一行会在构建时
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

