/**
 * 把新建的 workspace 包链进 node_modules。
 *
 * 为什么需要这个脚本：`npm install` 在这台机器上没有把新包链进来
 * （package-lock 里也没有它们），于是 `import 'dsh-zhiyun-core-tool'` 报
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

/** 找出所有尚未链入 node_modules 的 workspace 包。 */
function discover() {
  const dirs = [];
  for (const pattern of ['packages', 'packages/radar']) {
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
