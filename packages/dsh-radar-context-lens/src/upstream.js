/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 package.json 和注释里
 * （与 `dsh-zhiyun-host-paper/src/upstream.js` 同一套理由）：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.3.1`，不是 `^0.3.1`）。
 *      上游的观测口径会随版本变（token 估算密度、KV cache 字段、
 *      归因覆盖范围都还在动），`^` 会让 `npm install` 在某次无关改动里
 *      悄悄把剖析器换掉，而读数看上去还是「正常的数字」—— 这种漂移最难发现。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于
 *      别人的 lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次。
 *   3. 将来补 `tests/` 时用这两个常量断言「声明、实际安装、代码预期」三者一致。
 *
 * > ⚠️ **上游自述为 Work in progress**（README 原文：*"may still contain
 * > substantial bugs or incomplete behavior"*，并明确 token 占比是用 DSH
 * > token-meter 密度**估算**、不是 provider tokenizer）。评审时请把它当
 * > **观测参考**而非计费真值。
 */

export const UPSTREAM_PACKAGE = 'dsh-context-lens';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.3.1';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPO = 'https://github.com/gordonlu/dsh-context-lens';

/** 上游许可证：MIT（GitHub API `license.spdx_id = MIT`，npm `license = MIT`）。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 读取上游运行时版本。骨架阶段**不实现** —— 保持与 paper 包同形，
 * 以便评审通过后直接照抄那边的实现。
 *
 * TODO（评审通过后）：解析 `node_modules/${UPSTREAM_PACKAGE}/package.json`
 * 的 `version`，与 `UPSTREAM_VERSION` 比对；不一致时**不抛错**，
 * 而是把结果暴露给页面（与 paper 包一致：锁版失败应当在界面上可见，
 * 而不是让整页挂掉）。
 */
export function readInstalledVersion() {
  throw new Error('骨架占位：readInstalledVersion() 未实现。');
}

/**
 * 上游能力的**适配出口**占位。
 *
 * 上游是 read-only 观测插件：它自己在 Chat / Trajectory 旁加一个 Lens 视图。
 * 本仓若要复用，只有两条路（评审时二选一）：
 *
 *   a. **整页挂载**：接受上游自带视图，确认不与 `dsh-zhiyun-shell-workbench` 会话区冲突；
 *   b. **只取数据**：不挂上游视图，只调它的 public API 拿「按插件归因的 token 占比」，
 *      喂给「插件」页现有那张依赖图 —— 让每一行同时显示「依赖关系 + 成本」。
 *
 * 倾向 (b)：这才符合「**仍是同一个面板**」的强化式集成要求 ——
 * 插件页不该变成两个页面的拼贴。
 */
export function readAttribution() {
  throw new Error('骨架占位：readAttribution() 未实现。见上方 (a)/(b) 二选一说明。');
}
