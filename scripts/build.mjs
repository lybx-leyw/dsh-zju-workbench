import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  'dsh-zhiyun-shell-ui',
  'dsh-zhiyun-shell-workbench',
  'dsh-zhiyun-source-netproxy',
  'dsh-zhiyun-source-card',
  'dsh-zhiyun-core-study',
  // 回放下面那层「主线/语速/四汇总」由本包算，学习页 external import 它 ——
  // 所以它必须有自己的客户端产物。（远端以旧名 `dsh-zhiyun-player` 加入，
  // 本仓按性质改名为 `core-player`，合并时对应成新名。）
  'dsh-zhiyun-core-player',
  'dsh-zhiyun-page-today',
  'dsh-zhiyun-page-study',
  'dsh-zhiyun-page-planning',
  'dsh-zhiyun-page-me',
  'dsh-zhiyun-page-notes',
  'dsh-zhiyun-page-paper',
  'dsh-zhiyun-page-plugins',
  'dsh-zhiyun-page-feedback',
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
export async function buildClientPackage(name, options = {}) {
  const pkg = `${root}packages/${name}/`;
  const manifest = JSON.parse(await readFile(`${pkg}package.json`, 'utf8'));
  // 单一真源：跨包 import 的 external 面写在 package.json 的 dsh.client.external，
  // 构建直接照用 —— 两处各写一份迟早漂移（漂移的后果是运行时 require 打不进模块表）。
  const declared = manifest.dsh?.client?.external ?? [];
  const result = await build({
    entryPoints: [`${pkg}src/client.jsx`],
    outfile: `${pkg}lib/client.js`,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: [...HOST_SEEDS, ...declared],
    loader: { '.css': 'text', '.svg': 'text' },
    define: { 'process.env.NODE_ENV': '"production"', __ZHIYUN_PROFILE__: JSON.stringify(lock.profile) },
    // banner 的 id 必须等于包名：客户端模块表按 stripClientSuffix(id) 建行，
    // 而启动图谱的行 id 是宿主 Loader 条目的 name。
    banner: { js: `window.__ModuleLoader__.load({id:"${name}",factory:(require)=>{var module={exports:{}};var exports=module.exports;` },
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
