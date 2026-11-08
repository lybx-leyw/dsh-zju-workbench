/**
 * 本仓自有 workspace 包的判定。
 *
 * 约定不再是「包名必须以 `dsh-zhiyun-` 开头」——那只是历史命名，profile 已经叫
 * `zju-workbench`，硬编码前缀只会让改名变成一次到处补字符串的重构。
 *
 * 现在的判据是**位置**：`packages/` 下带 `package.json` 的目录就是本仓包。
 *
 * 例外有两类，都不算本仓产品包：
 *   - `dsh-radar-*`：雷达候选骨架，独立隔离区（`packages/radar/`），
 *     不参与 profile 的 bundle 清单、目录链接与客户端构建；
 *   - `packages/vendor/`：**会改对方代码的上游副本**。我们改了它们的代码，
 *     但它们仍然不是本仓的逻辑 —— 不参与本仓的命名/结构约定与装配。
 *
 * 分组目录（如 `packages/radar/` 本身）没有 `package.json`，因此自然被排除，
 * 不需要单独维护一份黑名单。
 */
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

/**
 * 隔离区判定：出现在 `packages/` 下也**不当作本仓产品包**的东西。
 *
 * # 两种形态，两套判据
 *
 * | 形态 | 例子 | 判据 |
 * | --- | --- | --- |
 * | 平铺的前缀命名 | `packages/dsh-radar-xxx/` | 目录名前缀 |
 * | **分组目录** | `packages/vendor/` 下每个上游包 | 分组目录名 |
 *
 * 第二种是 `packages/vendor` —— 那里放的是**会改对方代码的上游副本**，
 * 与 `dsh-radar-*` 的区别只在「它们都是第三方的东西，不参与本仓装配」。
 *
 * # 为什么 vendor 需要豁免
 *
 * vendor 包是**别人写的、我们改过的**代码。若按普通本仓包处理：
 *   - `profile.mjs` 会给它建目录链接、可能进 bundle 清单；
 *   - `build.mjs` 会试图构建它的客户端半边；
 *   - `check-css-order` / `plugins-page` 等守卫会要求它符合本仓命名与结构约定。
 *
 * 这些要求对「改过的第三方副本」都不成立 —— 我们无权要求上游代码遵守本仓规范。
 */

/** 平铺包名前缀：这些包即使平铺在 `packages/` 下也不算本仓产品包。 */
export const ISOLATED_PREFIXES = Object.freeze(['dsh-radar-']);

/** 隔离的**分组目录名**：其下所有包都不算本仓产品包。 */
export const ISOLATED_GROUPS = Object.freeze(['vendor']);

/**
 * 一个目录名是否属于隔离区（平铺包名或分组目录名）。
 *
 * @param name - 目录名。
 * @returns 是否隔离。
 */
export function isIsolated(name) {
  if (ISOLATED_GROUPS.includes(name)) return true;
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

/**
 * 读取 vendor 区（`packages/vendor/<包>/`）的包 manifest。
 *
 * # 为什么与 `ownPackages()` 分开
 *
 * vendor 被 `ISOLATED_GROUPS` 排除在「本仓产品包」之外 —— 它们不参与构建清单、
 * 不进 profile 的常规装配、不受本仓命名/结构约定约束。这是对的。
 *
 * 但**有些地方需要同时看两边**：例如「profile 里这个 bundle 的目录链接指向谁」，
 * 而 profile 确实可能装 vendor 包（论文阅读就是）。只用 `ownPackages()` 反查，
 * vendor 包会「查不到目录」，而实际原因是**扫描范围**而不是链接错了。
 *
 * @param packagesRoot - `packages/` 的绝对路径。
 * @returns `{ dir, path, manifest }` 数组（目录名排序）。
 */
export async function vendorPackages(packagesRoot) {
  const out = [];
  for (const group of ISOLATED_GROUPS) {
    const groupRoot = path.join(packagesRoot, group);
    let children;
    try {
      children = await readdir(groupRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const dir = path.join(groupRoot, child.name);
      let raw;
      try {
        raw = await readFile(path.join(dir, 'package.json'), 'utf8');
      } catch {
        continue;   // 不是包（例如分组自己的 README）
      }
      out.push({ dir: child.name, path: dir, manifest: JSON.parse(raw) });
    }
  }
  return out.sort((a, b) => a.dir.localeCompare(b.dir));
}
