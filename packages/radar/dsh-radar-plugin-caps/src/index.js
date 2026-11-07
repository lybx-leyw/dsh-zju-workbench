/**
 * 插件本体能力插件入口（候选骨架 · 占位实现）。
 *
 * ⚠️ 这是**骨架**：未评审、未接入 profile、不可直接使用。`apply()` 只打一行日志，
 *    不注册页面、不注册 slot、不注册工具。评审驳回则整目录删除。
 *
 * # 定性：**强化式集成**（不是「全新」）
 *
 * 「插件」页（`dsh-zhiyun-page-plugins`）已经存在，且已经读了三份事实：
 *
 *   - 开关状态与包清单 —— 宿主 `remote.pluginManager`；
 *   - 模块边与拓扑序 —— `ctx.modules.manifest.modules`（宿主已用 `orderByModuleGraph` 排好）；
 *   - 两棵树上的硬边 —— 浏览器面 `ctx.loader` / `ctx.registry` / `ctx.reflect`，宿主面 `/api/zhiyun-plugins`。
 *
 * 这三份合起来回答的是**「关掉谁会不会连坐」**。另外 `src/usage.js`（r112 从
 * `dsh-radar-knowledge-graph` 提取）已经记了**「用了没有 / 多久没用了」**（`count` + `lastUsed` + `STALE_DAYS=30`）。
 *
 * 唯一没被回答的是：
 *
 *   →「这一个插件本身提供了什么？」—— `ctx.tools` / `ctx.commands` / `ctx.slots` 里各占了什么。
 *
 * 本包要补的就是这一格，页面还是同一张页面。
 *
 * ⚠️ **注意**：出骨架时的原计划里还有「使用账本」一半，核对后发现本仓 `usage.js` **已经覆盖**，
 *    因此账本那一半在本包里作废（`src/caps.js` 的 `foldLedger` / `silentPlugins` 应删）。
 *    这也意味着判据③（底层更优实现）**当前不成立** —— 参 README「与原计划的差距」。
 *
 * # 三条判据
 *
 * | 判据 | 本包怎么满足 |
 * | --- | --- |
 * | 仍是同一个面板 | 上到 `zhiyun.plugins.content` 同一槽位，**不新增导航项** |
 * | 功能仍相似正交 | 现有：依赖风险 + 用没用过；本包：**提供了什么**（工具/命令/槽位清单） |
 * | 底层多调了更优质实现 | ⚠ 不成立。上游没有比本仓 `usage.js` 更强的账本；本包只剩一张纯静态清单 |
 *
 * 三条缺一即降级为「重复且无增益」。③ 不成立 ⇒ **不要按「强化」批准**，
 * 只把它当成「要不要补一张静态能力表」的问题单。
 *
 * # 不做什么（评审重点）
 *
 * 1. **不做 MCP / Skill / Expert 管理** —— 那是上游看板的主体，在册已有 `dsh-radar-mcp-manager`。
 *    **不得**借「反正都装了」把整块搬进来。
 * 2. **不做主题切换** —— 上游的六档主题会在插件页旁再开一块面板，直接违反判据①。
 * 3. **不写 profile、不装卸插件** —— 本仓「不另开写入口」的口径，插件页只读。
 * 4. **不引任何 npm 依赖** —— 见 `package.json` 的 `dependencies: {}`。
 */

export const UPSTREAM = null;

export const name = 'dsh-radar-plugin-caps';

/**
 * 插件挂载点（占位）。
 *
 * TODO-0（**阻塞**，不定这条不该评审通过）：
 *   能力清单从哪一份真源读？
 *
 *   - **A. 宿主的 `manifest`**：零成本、零新路由，但只有 patch 行名（`radar-x` / `dsh-y`），
 *     拿不到「这个包导出哪些工具 / 命令 / 槽位」。→ 只能答「装了什么」，答不了「提供什么」。
 *   - **B. 扫每个包的 `package.json` + `cordis.patch.yml`**：准确，但与
 *     `dsh-zhiyun-page-plugins` 已有的 `/api/zhiyun-plugins`（宿主半边已经读过这两份文件）
 *     **极可能撞同一份缓存** → 要么复用那条路由加字段，要么新开 `/api/zhiyun-plugin-caps` 并在
 *     `plugin-manager/changed` 时一起失效。**评审须在两者间拍板**，不要两边各做一半。
 *
 * TODO-1：**作废** —— 账本已由 `dsh-zhiyun-page-plugins/src/usage.js` 提供，不再自打点，
 *   `src/caps.js` 的 `foldLedger()` / `silentPlugins()` 应删除。
 *
 * TODO-2：**默认关**。能力清单对多数用户是噪声；账本只在「插件越装越多、越来越慢」时才需要看。
 *
 * TODO-3：若评审结论是「内联即可」，删除本包，把 `src/caps.js` 的形状挪进 `dsh-zhiyun-page-plugins`。
 */
export function apply(ctx) {
  ctx?.logger?.info?.('[dsh-radar-plugin-caps] 候选骨架，未实现');
}
