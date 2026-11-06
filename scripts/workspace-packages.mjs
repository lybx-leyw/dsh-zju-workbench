/**
 * 本仓自有 workspace 包的判定。
 *
 * 约定不再是「包名必须以 `dsh-zhiyun-` 开头」——那只是历史命名，profile 已经叫
 * `zju-workbench`，硬编码前缀只会让改名变成一次到处补字符串的重构。
 *
 * 现在的判据是**位置**：`packages/` 下带 `package.json` 的目录就是本仓包。
 * 唯一的例外是 `dsh-radar-*`：雷达候选骨架是独立隔离区（`packages/radar/`），
 * 不参与产品 profile 的 bundle 清单、目录链接与客户端构建。
 *
 * 分组目录（如 `packages/radar/` 本身）没有 `package.json`，因此自然被排除，
 * 不需要单独维护一份黑名单。
 */
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

/** 隔离区包名前缀：出现在 `packages/` 下也不当作本仓产品包。 */
export const ISOLATED_PREFIXES = Object.freeze(['dsh-radar-']);

/**
 * 一个目录名是否属于隔离区。
 *
 * @param name - 目录名。
 * @returns 是否隔离。
 */
export function isIsolated(name) {
  return ISOLATED_PREFIXES.some(prefix => name.startsWith(prefix));
}

/**
 * 列出本仓自有包目录名（排序）。
 *
 * 支持两种布局，与 `tests/publish-guard.test.mjs` 的扫描规则一致：
 *   - 平铺：`packages/<name>/package.json`
 *   - 分组：`packages/<group>/<name>/package.json`（例如 `packages/client/…`）
 *
 * 只往下看一层：分组本身不是包，再深的嵌套属于配置错误而不是设计。
 *
 * @param packagesRoot - `packages/` 的绝对路径。
 * @returns 绝对路径数组（按目录名排序）。
 */
export async function ownPackageDirs(packagesRoot) {
  let entries;
  try {
    entries = await readdir(packagesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const isPackage = async dir => {
    try {
      await access(path.join(dir, 'package.json'));
      return true;
    } catch {
      return false;
    }
  };
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || isIsolated(entry.name)) continue;
    const flat = path.join(packagesRoot, entry.name);
    if (await isPackage(flat)) {
      dirs.push(flat);
      continue;
    }
    // 分组目录：它的每个子目录才可能是包。
    let children;
    try {
      children = await readdir(flat, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory() || isIsolated(child.name)) continue;
      const nested = path.join(flat, child.name);
      if (await isPackage(nested)) dirs.push(nested);
    }
  }
  return dirs.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

/**
 * 列出本仓自有包的目录名（排序）。
 *
 * @param packagesRoot - `packages/` 的绝对路径。
 * @returns 包目录名数组。
 */
export async function ownPackageNames(packagesRoot) {
  return (await ownPackageDirs(packagesRoot)).map(dir => path.basename(dir));
}

/**
 * 读取本仓自有包的 manifest，附带目录名与绝对路径。
 *
 * @param packagesRoot - `packages/` 的绝对路径。
 * @returns `{ dir, path, manifest }` 数组（目录名排序）。
 */
export async function ownPackages(packagesRoot) {
  const out = [];
  for (const dir of await ownPackageDirs(packagesRoot)) {
    const raw = await readFile(path.join(dir, 'package.json'), 'utf8');
    out.push({ dir: path.basename(dir), path: dir, manifest: JSON.parse(raw) });
  }
  return out;
}
