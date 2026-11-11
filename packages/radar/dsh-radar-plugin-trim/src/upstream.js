/**
 * 上游单一真源 + 版本契约。
 *
 * 本文件**不 import 上游**。它只描述「如果要 import，允许从哪里、允许取什么」。
 * 目的：让评审看到我们打算依赖的是**公开导出**，而不是上游内部路径；
 *       上游一旦改内部结构，本包应该「加载失败并如实报错」，而不是静默半残。
 */

/** 上游坐标。与 package.json 的 `dependencies` 必须逐字一致（锁版，不用 ^）。 */
export const UPSTREAM = Object.freeze({
  repo: 'https://github.com/Starlit-Sky-code/dsh-experience-optimizer',
  /** 本仓锁的包：同仓还发布了 `dsh-plugin-recipe`，本轮**只要 trim**（见 README「为什么不要 recipe」）。 */
  pkg: 'dsh-plugin-trim',
  version: '0.2.2',
  license: 'MIT',
  /** 上游仓库是 monorepo（packages/plugin-trim），npm 包名不带 scope。 */
  monorepoPath: 'packages/plugin-trim',
});

/**
 * 允许从上游取的导出路径（白名单）。
 *
 * 只允许「包根」与「`package.json`」。任何 `dsh-plugin-trim/lib/…` 之类的深路径
 * 都是上游内部实现，**一旦允许就等于把上游的目录结构写进本仓契约**。
 */
export const ALLOWED_EXPORTS = Object.freeze(['.', './package.json']);

/**
 * 加载上游。
 *
 * 骨架阶段恒返回失败 —— 这是**故意的**：宁可让调用方拿到明确的
 * `candidate skeleton: not implemented`，也不要让它拿到一个只是打日志的假对象。
 *
 * @returns {Promise<{ok: false, error: string}>}
 */
export async function loadUpstream() {
  return Object.freeze({
    ok: false,
    error: 'candidate skeleton: not implemented',
  });
}

/**
 * 版本契约自检（骨架阶段不联网、不读 node_modules，只回执预期值）。
 *
 * 评审落地 TODO-0 后，这里应改为读取已安装包的 `package.json.version` 并比对：
 * 不一致就 fail-closed，不降级继续跑。
 *
 * @returns {{expected: string, ok: boolean, reason: string}}
 */
export function checkVersionContract() {
  return {
    expected: UPSTREAM.version,
    ok: false,
    reason: 'candidate skeleton: 未安装上游，无法核对实际版本（TODO-0）',
  };
}
