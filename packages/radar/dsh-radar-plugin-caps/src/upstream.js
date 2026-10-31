/**
 * 上游封装占位（**不含任何上游代码**）。
 *
 * 上游：`2026heshao/dsh-armory` · **MIT** ✅ · npm `dsh-armory@2.4.7` · ★62。
 * 上文许可证按 GitHub API `license.spdx_id` 与仓库 `LICENSE` 两处核对；npm 包 license 字段未实取（TODO-L）。
 *
 * # 为什么这里没有 `import`
 *
 * 本仓的 A 类骨架惯例是「锁版挂载上游」。**这一条不是。** 原因只有一条但很硬：
 * 上游是一体看板，`cordis.patch.yml` 只插一行 `id: dsh-armory`，挂上之后它在插件页**旁边**
 * 再开一块自己的面板（MCP / Skills / Experts / 四大市场 / 六档主题 / 悬浮按钮）。
 * 判据①「仍是同一个面板」当场不成立，而且它与在册 `dsh-radar-mcp-manager` 同域。
 *
 * ⇒ 正确做法是**只取契约**：把上游的实现形状写成常量与待核项，评审时对着核；
 *    真要落地时由本仓在 `dsh-zhiyun-page-plugins` 里重写，而不是挂上游。
 *    这与 `dsh-radar-paper-evidence`（★0、非 npm 包、只取 `data-contract.md`）是同一类处理。
 *
 * # 能力契约（从上游 README 与 `package.json` 读出，未读其源码）
 *
 * | 字段 | 含义 | 出处 |
 * | --- | --- | --- |
 * | `tool` | 工具名 | README「tool-usage tailor with wire-tax trends」 |
 * | `count` | 调用次数 | 同上 |
 * | `ms` | 累计耗时（毫秒） | 同上 |
 * | `errors` | 失败次数 | 同上（README 未明说计数口径，TODO-M） |
 *
 * 每行再带三组**本体**信息（这才是本仓真正缺的那一格）：
 *
 * | 字段 | 含义 | 从哪取 |
 * | --- | --- | --- |
 * | `tools[]` | 该插件 `ctx.tools` 注册了哪些工具 | 宿主 registry（TODO-0 B） |
 * | `commands[]` | 该插件注册了哪些 `/xxx` 命令 | 同上 |
 * | `slots[]` | 该插件往哪些 slot 注入（`zhiyun.*` 与宿主原生两类都要） | 同上 |
 *
 * # 待核项
 *
 * - **TODO-L**：npm `dsh-armory@2.4.7` 的 `license` 字段实取（GitHub 侧已核 MIT）。
 * - **TODO-M**：`errors` 的计数口径 —— 是「工具返回 isError」还是「抛异常」？两者在宿主里不是一回事。
 * - **TODO-N**：上游 `usage.js` 是否**持久化**（跨会话累计）还是只算当前会话。跨会话需要落盘，
 *   本仓笔记/轨迹都有落盘先例，但要先确认不会把工具参数一并写进盘里（参数可能含成绩、PII）。
 * - **TODO-O**：上游 2.4.x 的 peer 全是 `>=0.1.5-rc.1`，而本仓宿主在 `0.2.x` 带 —— 若真要挂，
 *   须先确认它没有用到 `0.1.x` 已移除的客户端包（`dsh-client-ui-primitives` 一类）。
 */

export const UPSTREAM = {
  repo: 'https://github.com/2026heshao/dsh-armory',
  npm: 'dsh-armory',
  /** 观察到的版本；**本包不依赖它**，仅作核对锚点。 */
  versionObserved: '2.4.7',
  license: 'MIT',
  /** 可选锁版（评审若改判「允许整包挂载」时改这里；默认为 false）。 */
  lockable: false,
  /** 只取契约的能力形状。 */
  ledgerShape: ['tool', 'count', 'ms', 'errors'],
  capsShape: ['tools', 'commands', 'slots'],
};

/**
 * 上游是否可整包挂载（**默认不可**，理由见文件头）。
 * 若评审改判，把 `lockable` 置 true 并把 `dsh-armory` 写进 `package.json` 的 `dependencies`（**写死版本，不用 `^`**）。
 */
export function canLockUpstream() {
  return UPSTREAM.lockable === true;
}
