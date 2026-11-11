/**
 * 上游封装**占位**（骨架，未实现）。
 *
 * 上游：`GlariaLuminous/dsh-plugin-health-check`，MIT（仓库 `package.json.license` 实核）。
 *
 * # 核验记录（2026-11-05 实测，非推断）
 *
 * | 项 | 结果 |
 * | --- | --- |
 * | 仓库许可证 | `MIT` ✅（GitHub API `license.spdx_id` + `package.json.license` 一致） |
 * | 首屏版本号 | `0.3.1`（仓库 `package.json.version`） |
 * | npm 可锁版 | ⛔ **不可**。`registry.npmjs.org/dsh-plugin-health-check` → **HTTP 404** `{"error":"Not found"}`，连试 5 次 |
 * | 上游自述检查项 | profile、bundle、patch、**版本兼容**、MCP 冲突，含装前候选检查 |
 * | 挂载形状 | `dsh.bundle.patch = ./cordis.patch.yml`（**A 类**原生 DSH 插件包） |
 * | 依赖 | `@deepseek-ai/cordis@4.0.5`、`cordis-plugin-include@1.0.10`、`cordis-plugin-loader@1.0.6`、`js-yaml@4.3.2`、`semver@7.8.5` |
 * | peer | `@deepseek-ai/dsh-tools >=0.1.1-rc.2`（optional） |
 *
 * # 为什么没有把它锁版挂进来
 *
 * 「锁版挂载」的前提是**有一个能锁的版本**。npm 404 时只剩 git 源，
 * 而本仓规矩是不搬运上游源码。所以本包只取它的**检查项形状**（下面这份列表），
 * 一行代码都不摘；等上游发布到 npm 后再议锁版。
 *
 * 另外：它不仅做版本兼容，还做 profile / bundle / patch / MCP 冲突四件事。
 * 整包挂进来会在插件页旁多出它自己的入口 —— 违反「仍是同一个面板」。
 *
 * # 上游检查项（只作为形状参考，未摘码）
 *
 *   profile 解析 / bundle 接线 / patch 名冲突 / 版本兼容 / MCP 冲突
 *
 * 本包只打算复刻**其中一格**：版本兼容。其余四格与 `dsh-radar-plugin-audit`、
 * `dsh-radar-compat-vet` 已覆盖的部分高度重叠，按「重复且无增益」处理。
 */

/** 上游标识，仅用于登记与追溯。 */
export const UPSTREAM = {
  repo: 'GlariaLuminous/dsh-plugin-health-check',
  license: 'MIT',
  version: '0.3.1',
  npm: null, // 2026-11-05：registry 404，不可锁版
  kind: 'A', // 原生 DSH 插件包（dsh.bundle.patch）
};

/**
 * **占位**：等上游上 npm 后，这里应改为
 * `export { checkVersionCompat } from 'dsh-plugin-health-check'` 形式的锁版再导出，
 * 并在此处注明核对过的版本号与 `package.json.license`。
 */
export function wrappedChecks() {
  return [
    'profile',
    'bundle',
    'patch-name-conflict',
    'version-compat', // ← 本包唯一要用的那一格
    'mcp-conflict',
  ];
}
