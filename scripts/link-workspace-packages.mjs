/**
 * 把新建的 workspace 包链进 node_modules。
 *
 * 为什么需要这个脚本：`npm install` 在这台机器上没有把新包链进来
 * （package-lock 里也没有它们），于是 `import '@lybx-leyw/dsh-zju-core-tool'` 报
 * ERR_MODULE_NOT_FOUND。core-question 为此加了相对路径兜底，
 * 但兜底是权宜之计：它让「测试跑的文件」和「产品装包后跑的文件」可能不是同一份，
 * 一旦某天两边真的分叉，症状会非常难查。
 *
 * 这里用目录联接（Windows 上是 junction，类 Unix 上是 symlink）把
 * packages/<pkg> 连到 node_modules/<pkg>。这在 npm workspaces 里等价于
 * `npm install` 本应做的事，只是不碰 lockfile、不联网。
 *
 * 用法：node scripts/link-workspace-packages.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const NODE_MODULES = path.join(ROOT, 'node_modules');
const CHECK_ONLY = process.argv.includes('--check');

/**
 * 找出所有尚未链入 node_modules 的 workspace 包。
 *
 * ⚠️ 这里必须列全**分组目录**。早先只扫 `packages` 与 `packages/radar`，
 * 于是包从顶层迁进 `packages/core/` 之后链接就断了 —— 症状是构建报
 * `Could not resolve "@lybx-leyw/dsh-zju-core-classroom-geometry"`，
 * 而包目录明明就在那儿。加新分组时同步补一行。
 *
 * ⚠️ **不要加 `packages/radar`**。那是「候选骨架区」：79 个候选包只做形态参考，
 * 不进产品 `node_modules`（既不需要被 import，也会让 `packageDir()` 的
 * basename 查找多出 79 个候选人）。早先这里写着 radar，但脚本从未成功执行过，
 * 所以「扫了但没链」一直没暴露；一旦真跑起来就会把 79 个候选全链进产品依赖图。
 */
function discover() {
  const dirs = [];
  for (const pattern of ['packages', 'packages/core', 'packages/client', 'packages/source', 'packages/tool', 'packages/preset']) {
    const base = path.join(ROOT, pattern);
    if (!fs.existsSync(base)) continue;
    for (const name of fs.readdirSync(base)) {
      const pkgJson = path.join(base, name, 'package.json');
      if (!fs.existsSync(pkgJson)) continue;
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      } catch {
        continue; // 坏 manifest 不阻塞其它包
      }
      if (!manifest.name) continue;
      dirs.push({ name: manifest.name, source: path.join(base, name), manifest });
    }
  }
  return dirs;
}

const packages = discover();
const missing = [];
const present = [];

for (const pkg of packages) {
  const target = path.join(NODE_MODULES, pkg.name);
  if (fs.existsSync(target)) { present.push(pkg.name); continue; }
  missing.push(pkg);
}

if (CHECK_ONLY) {
  console.log(JSON.stringify({
    total: packages.length,
    linked: present.length,
    missing: missing.map(p => p.name),
  }, null, 2));
  process.exitCode = missing.length ? 1 : 0;
} else {
  if (!fs.existsSync(NODE_MODULES)) fs.mkdirSync(NODE_MODULES, { recursive: true });
  const linked = [];
  const failed = [];
  for (const pkg of missing) {
    const target = path.join(NODE_MODULES, pkg.name);
    try {
      // ⚠️ **必须先把作用域目录建出来**（`node_modules/@lybx-leyw/`）。
      //
      // `symlinkSync` 不会为它创建一个父目录：目标父级不存在时直接 ENOENT。
      // 本仓 51 个包全是 `@lybx-leyw/*`，所以第一次在干净环境里跑本脚本时
      // **每一个都会失败** —— 而失败只落在 `failed[]` 里，输出看起来像
      // 「跑完了，有几个失败」，很容易被当成个别包的偶发问题。
      //
      // 这个 bug 长期没暴露，是因为 `node_modules/@lybx-leyw` 一直存在
      // （由早先某次 `npm install` 或手工链接留下）。一旦它被删掉
      // （例如误跑 `npm install` 把 workspace 当作 extraneous 清掉），
      // 本脚本就再也补不回来 —— 恢复路径断在这里。
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Windows 上必须用 junction：默认的 dir symlink 需要管理员或开发者模式。
      fs.symlinkSync(pkg.source, target, 'junction');
      linked.push(pkg.name);
    } catch (error) {
      failed.push({ name: pkg.name, error: error?.code ?? String(error) });
    }
  }
  console.log(JSON.stringify({ alreadyLinked: present.length, newlyLinked: linked, failed }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}
