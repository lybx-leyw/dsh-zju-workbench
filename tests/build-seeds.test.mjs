/**
 * 客户端包的 external 面守卫。
 *
 * 为什么值得一条常驻测试：`external` 漏一项，两种失效都极难第一眼归因 ——
 *   - 漏了本机解得开的词（如 `@deepseek-ai/cordis`）：esbuild **静默**把整包内联，
 *     产出里凭空多出几万字节，运行时插件与宿主各持一个实例。构建不报错。
 *   - 漏了本机解不开的词（如 `@deepseek-ai/dsh-client-ui-slots`）：`Could not resolve`，
 *     构建直接失败。
 * 而且漏掉的往往是宿主种子词 —— 宿主浏览器里明明有，本仓为什么解不开？很容易
 * 被误判成「依赖没装」而去动 package.json，把真正的原因（external 表缺项）越推越远。
 *
 * 这里做两件事：
 *   1. 静态扫：客户端入口可达的源码里，每个裸模块名都必须落在 HOST_SEEDS ∪ 本包
 *      `dsh.client.external` 里；
 *   2. 真实构建（不落盘）取 metafile：产出里不许出现任何本包 src/ 之外的文件。
 *      第 2 条才是真正的牙齿 —— 第 1 条只看名字，第 2 条能看见「到底把谁打进去了」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClientPackage, CLIENT_PACKAGES, HOST_SEEDS } from '../scripts/build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** 从某个文件出发，跟踪相对 import，收集全部裸模块名。 */
async function bareSpecifiers(entry) {
  const seen = new Set();
  const bare = new Map(); // 裸模块名 -> 首次出现的文件:行
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    const key = path.resolve(file);
    if (seen.has(key)) continue;
    seen.add(key);
    // 只解析真正的 JS 模块。别的扩展名（`.css`、`.svg`、`.md`）是构建期的
    // 文本资源，不是模块：把它们的**正文**当源码扫，会得到不存在的 import ——
    // 文档页把 markdown 内置进 bundle（`'.md': 'text'`），而文档里的代码示例
    // 恰好就写着 `import x from '../packages/...'`，一旦被当成真的相对 import
    // 去读，就会在读一个根本不存在的路径时抛 ENOENT。
    if (!/\.(?:[cm]?js|[jt]sx?)$/.test(key)) continue;
    const source = await readFile(key, 'utf8');
    const lines = source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const match = /(?:^|\s)(?:import|export)[^'"\n]*?from\s+['"]([^'"]+)['"]/.exec(lines[i]);
      if (match === null) continue;
      const specifier = match[1];
      if (specifier.startsWith('.')) {
        queue.push(path.resolve(path.dirname(key), specifier));
      } else if (!specifier.startsWith('node:')) {
        const at = `${path.relative(root, key)}:${i + 1}`;
        if (!bare.has(specifier)) bare.set(specifier, at);
      }
    }
  }
  return bare;
}

test('每个有 src/client.jsx 的包都在 CLIENT_PACKAGES 里', async () => {
  // 这份清单是手工维护的，漏一个不会报错：Loader 照旧解析宿主半边，
  // 但那个包没有 lib/client.js，页面渲染成空白占位 —— 排查成本极高。
  // 「规划」页第一次构建时正是漏在这里，所以补一条会红的断言。
  //
  // ⚠️ `DETACHED.md` 是「包已完工、但决定暂不接进 profile」的显式标记：
  //    没有它，把一页从产品里摘下来就只能靠删包或删 client.jsx，
  //    而那两样都会毁掉本来可以随时接回去的实现。见到标记就跳过，
  //    接回去时删掉标记、补一行 CLIENT_PACKAGES —— 见各包的 DETACHED.md。
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(`${root}packages`, { withFileTypes: true });
  const missing = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('dsh-')) continue;
    let hasClient = true;
    try {
      await readFile(`${root}packages/${entry.name}/src/client.jsx`, 'utf8');
    } catch {
      hasClient = false;
    }
    if (!hasClient) continue;
    const detached = await readFile(`${root}packages/${entry.name}/DETACHED.md`, 'utf8').then(() => true, () => false);
    if (detached) continue;
    if (!CLIENT_PACKAGES.includes(entry.name)) missing.push(entry.name);
  }
  assert.deepEqual(missing, [], `这些包有 client.jsx 却不在 CLIENT_PACKAGES 里：${missing.join(', ')}`);
});

test('每个客户端包的裸模块 import 都被 HOST_SEEDS 或本包的 dsh.client.external 覆盖', async () => {
  const failures = [];
  let checked = 0;
  for (const name of CLIENT_PACKAGES) {
    const manifest = JSON.parse(await readFile(`${root}packages/${name}/package.json`, 'utf8'));
    const declared = new Set([...HOST_SEEDS, ...(manifest.dsh?.client?.external ?? [])]);
    const bare = await bareSpecifiers(`${root}packages/${name}/src/client.jsx`);
    for (const [specifier, at] of bare) {
      checked += 1;
      // 第三条路：**有意内联**的第三方依赖。它不该进 external（没人提供），
      // 所以必须在 INTENTIONALLY_BUNDLED 里点名 —— 白名单是显式豁免，不是默认放行。
      if (specifier in INTENTIONALLY_BUNDLED) continue;
      if (!declared.has(specifier)) failures.push(`${name}: ${at} import '${specifier}'，既不是宿主种子词也没写进 dsh.client.external`);
    }
  }
  // 防「一个 import 都没扫到」的假绿：7 个包至少各有一个 react。
  assert.ok(checked >= CLIENT_PACKAGES.length, `只检查了 ${checked} 个裸模块 import，扫描器可能失效`);
  assert.deepEqual(failures, [], `external 面不完整：\n${failures.join('\n')}`);
});

test('本包的 dsh.client.external 声明的每个包都真的被 import 了（没有过期声明）', async () => {
  const stale = [];
  for (const name of CLIENT_PACKAGES) {
    const manifest = JSON.parse(await readFile(`${root}packages/${name}/package.json`, 'utf8'));
    const declared = manifest.dsh?.client?.external ?? [];
    if (declared.length === 0) continue;
    const bare = await bareSpecifiers(`${root}packages/${name}/src/client.jsx`);
    for (const specifier of declared) {
      // 宿主种子词由浏览器侧注入，源码里本来就不会出现 import（JSX 自动运行时、
      // vendor 预构建产物都是这种情况）。判定「过期」只对第三方库有意义。
      if (HOST_SEEDS.includes(specifier)) continue;
      if (!bare.has(specifier)) stale.push(`${name}: dsh.client.external 声明了 '${specifier}' 但源码里没人 import`);
    }
  }
  assert.deepEqual(stale, [], `external 声明过期：\n${stale.join('\n')}`);
});

// 允许**有意内联**的第三方依赖（包名 -> 理由）。
// 其余任何 src/ 之外的文件出现在产出里，都说明某个裸模块 import 没被 external 化。
const INTENTIONALLY_BUNDLED = {
  // 见 packages/dsh-zhiyun-page-study/src/hls.js 文件头：客户端产物是 CJS，
  // esbuild 在 CJS 下不做代码分割，所以「按需加载」只能靠选最小构建产物，
  // 体积（~363 KB）已被显式接受。它必须进产出，否则直播直接不可用。
  'hls.js': 'page-study：HLS 直播播放器，按设计内联（见 src/hls.js 体积权衡）',
  // 图谱渲染层（graph-render）：cytoscape 与它的布局扩展 fcose 是**纯库**，
  // 没有别的包会需要它们、也没有运行时要共享的实例状态，所以不进 external 面、
  // 直接打进自己的 lib/client.js。反过来，如果把 cytoscape 写进 external 却
  // 没有任何客户端包提供它，图谱会在运行时静默不显示。
  'cytoscape': 'graph-render：纯绘图库，无共享实例需求，按设计内联进自己的 bundle',
  'cytoscape-fcose': 'graph-render：cytoscape 的 fcose 布局扩展，随宿主库一起内联',
  // fcose 自身的传递依赖（只在布局计算里用，不进 API）。
  'cose-base': 'graph-render：fcose 的布局基元，随 fcose 内联',
  'layout-base': 'graph-render：fcose 的布局基元，随 fcose 内联',
  // classroom-agent 的运行时会话 id 用 nanoid 生成。它是纯函数库（无实例状态、
  // 无 IO、体积 ~100B），没有跨包共享实例的需求，按设计随包内联。
  'nanoid': 'classroom-agent：纯函数 id 生成器，无共享实例需求，内联进 bundle',
  // classroom-geometry 的三个纯依赖：SVG path 解析、HTML 实体解码、颜色换算。
  // 都是无状态纯函数，classroom-stage 与 classroom-renderer 各自内联一份，
  // 没有跨包共享实例的需求（几何计算输入输出都是 JSON，不存在对象身份比较）。
  'svg-pathdata': 'classroom-geometry：纯 path 解析，随几何内核内联',
  'entities': 'classroom-geometry：纯实体解码，随几何内核内联',
  'tinycolor2': 'classroom-geometry：纯颜色换算，随几何内核内联',
};

test('真实构建（不落盘）的产出里没有任何本包 src/ 之外的文件（有意内联的除外）', async () => {
  for (const name of CLIENT_PACKAGES) {
    const manifest = JSON.parse(await readFile(`${root}packages/${name}/package.json`, 'utf8'));
    // vendor 型包（见 docs/architecture/classroom-port.md）：整棵依赖树按设计内联，
    // 逐个列进 INTENTIONALLY_BUNDLED 没有意义 —— 它会有几十个传递依赖。
    // 但「别的 workspace 包」仍必须拦住：那才是真正的边界泄漏。
    const bundlesDeps = manifest.dsh?.client?.bundlesDependencies === true;
    const { result } = await buildClientPackage(name, { write: false, metafile: true });
    const inputs = Object.keys(result.metafile.inputs).map((p) => path.resolve(root, p));
    // 「本包自己的文件」= 本包目录下的任何文件，不只是 src/。
    // vendor/ 是锁版快照（见 docs/architecture/classroom-port.md 第 2 节通道 1）：
    // 它属于本包、要被打进本包产物，判据是「不能被别的包 import」，不是「必须在 src/ 下」。
    const own = path.resolve(root, 'packages', name) + path.sep;
    const foreign = inputs.filter((p) => {
      if (p.startsWith(own)) return false;
      const bundled = /[\\/]node_modules[\\/]([^\\/]+)(?:[\\/]|$)/.exec(p);
      if (bundled === null) return true;
      if (bundlesDeps) return false;
      // scoped 包（@scope/name）取两段
      const base = bundled[1].startsWith('@') ? `${bundled[1]}/${p.split(bundled[1])[1].split(/[\\/]/)[1]}` : bundled[1];
      return !(base in INTENTIONALLY_BUNDLED);
    });
    assert.deepEqual(foreign, [], `${name} 的产出内联了外部文件（external 漏项）：\n${foreign.join('\n')}`);
  }
});
