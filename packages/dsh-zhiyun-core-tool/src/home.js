/**
 * 运行时 home 解析 —— 上游 `runtime/home.py` 的 JS 对位。
 *
 * # 为什么这个看起来"只有三行"的模块需要被搬过来
 *
 * 它守着一条规则：**运行时数据不许落在源码检出目录里再套一层**。上游会显式拒绝
 * `<package_root>/data` 与 `<package_root>/data/user` 这两个路径，因为一旦有人把
 * `DEEPTUTOR_HOME` 指到那里，程序就会在数据目录里再建一个数据目录，重新启动后
 * 找不到上次的东西，而错误信息只会说"没有讲义"。
 *
 * 优先级：显式参数 > 环境变量 > 当前工作目录。返回值是**工作区根**，
 * 运行时数据在 `<root>/data` 下面。
 */

export const DEEPTUTOR_HOME_ENV = 'DEEPTUTOR_HOME';

let packageRootOverride = null;

/** 测试用：覆盖"包根"，避免把测试绑到真实检出路径上。 */
export function setPackageRoot(root) {
  packageRootOverride = root === null || root === undefined ? null : String(root);
}

export function getPackageRoot() {
  if (packageRootOverride !== null) return packageRootOverride;
  // 本文件位于 <pkg>/src/home.js → 再上两级是 <pkg>
  return new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
}

function normalize(path) {
  return String(path)
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/(.)\/$/, '$1');
}

/**
 * 拒绝指向检出目录数据树内部的运行时 home。
 *
 * @throws {Error} 路径非法时
 */
export function validateRuntimeHome(home) {
  const resolved = normalize(home);
  const packageRoot = normalize(getPackageRoot());
  const invalid = new Set([`${packageRoot}/data`, `${packageRoot}/data/user`]);
  if (invalid.has(resolved)) {
    throw new Error(
      `Invalid DeepTutor runtime home: ${resolved}. Runtime data must live under ` +
        `${packageRoot}/data without nesting. Start DeepTutor with ` +
        `DEEPTUTOR_HOME=${packageRoot} from ${packageRoot}.`,
    );
  }
}

/**
 * 返回本进程运行时数据的所有者目录。
 *
 * @param {string|null} [home] 显式指定
 * @returns {string}
 */
export function getRuntimeHome(home = null) {
  const raw = home !== null && home !== undefined ? home : process.env[DEEPTUTOR_HOME_ENV];
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return process.cwd();
  }
  return String(raw);
}

/** 返回 `<runtime-home>/data`。 */
export function getRuntimeDataRoot(home = null) {
  return `${getRuntimeHome(home)}/data`;
}
