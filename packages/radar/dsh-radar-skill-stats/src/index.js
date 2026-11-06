/**
 * dsh-radar-skill-stats —— **候选骨架的占位入口**。
 *
 * ⚠ 本文件**不写业务逻辑**，只标注适配点与 TODO；**不导出 `apply()`**，
 *   以免评审者误把本包挂进 profile 后静默加载成一个空面板。
 *   待人工评审通过后，再逐条落实 TODO；评审驳回则整目录删除。
 *
 * ── 它是什么 ──────────────────────────────────────────────────────────
 *
 * A 类（原生 DSH 插件包）的**锁版挂载 + 外围兼容层**：
 *
 *   - 锁版引入上游 `@dsh-external/dsh-skill-stats@0.1.0`（见 `src/upstream.js`）；
 *   - **不用**上游的侧栏页（会话视图 / 全局面板 / SVG 趋势图 / 1·3·7·30 天筛选条）；
 *   - 只取它的 `/skill-stats/api/stats?scope=current` 计数，**替换**本仓插件页
 *     `packages/dsh-zhiyun-page-plugins/src/usage.js` 那条账本的**数据来源**。
 *
 * ── 为什么这是「强化式集成」而不是「加一个统计页」──────────────────────
 *
 * 三条同时成立：
 *
 *   1. **仍是同一个面板** —— 不新增导航项、不新增路由、不新增开关。
 *      那列「吃灰清单」本来就在 `Panel.jsx:147`，本包只换它背后的数。
 *   2. **功能仍相似正交** —— 仍是「这一项值不值得留」，仍是 `usage.js` 的
 *      `never / stale / active` 三态（**判定逻辑一行不改**），只是计数更真。
 *   3. **底层多调了更优质实现** —— 本仓现有账本**根本没有生产级数据源**：
 *      `recordUse()`（`usage.js:53`）除 `tests/plugin-usage.test.mjs` 外
 *      **全仓零调用点**，`USAGE_KEY='zhiyun-plugin-usage-v1'` 的 localStorage 也**无人写入**
 *      → 线上结论恒为「全部 never」，这是一个**已经存在但永远空着的面板**。
 *      上游做的是「扫描会话日志回放 + 实时订阅 `tool/call` + 按文件大小/mtime 增量缓存 +
 *      技能已删除标记 + 重放未完成时不把空快照当成 0」。
 *
 * ── 上游的关键形状（沙箱核对，2026-10-29）─────────────────────────────
 *
 *   - `dsh.bundle.patch: ./cordis.patch.yml`  ← 标准 bundle 形状，**可直接锁版挂载**
 *   - `dsh.client.inject: ["@deepseek-ai/dsh-client-runtime"]`，`platform: web`
 *   - `dependencies: { "@deepseek-ai/dsh-home-paths": "^0.1.0-rc.6" }`  ← **`^` 在 rc 段**
 *   - `private: true` → **不在公共 npm 上**，只能 git / 本地 link（最大成本）
 *
 * 详见 README 的「评审必须先回答的四个问题」。
 */

export const PACKAGE = 'dsh-radar-skill-stats'

/**
 * TODO-A · 读出上游计数（**只读**；绝不写会话日志、绝不写技能目录）
 *
 *   P0  用 `?scope=current`，不要用全量：前者只含**磁盘上还在**的技能（含 0 次），
 *       后者含已删除技能。吃灰清单里混进已卸载的包，会把结论带偏。
 *   P0  **拿不到就整列留空并标「无数据」**，绝不回落成 `count: 0`。
 *       `usage.js` 里 `state === 'never'` 的含义是「确实没用过」，与「还没读到」是两回事，
 *       混在一起会让第一次打开面板的用户看到一片「全都没用过」。
 *   P1  只要 `name / invocations / lastUsedAt` 三个字段；**原始 `callTimes[]` 不落盘、不上传**
 *       —— 那是逐次时间戳，属于会话行为数据。
 */
export function readSkillCounts() {
  throw new Error('TODO-A: 未实现（候选骨架，禁止挂载）')
}

/**
 * TODO-B · 替换 `usage.js` 的账本数据源（**唯一出口**）
 *
 *   P0     `summarize(ledger, { known })` 的**入参与出参形状必须保持不变**：
 *          `{ key, kind, name, count, lastUsed, state }`。`tests/plugin-usage.test.mjs`
 *          测的是这套纯函数契约，改形状等于改契约。
 *   P0     把上游的 `invocations` 填进 `count`、`lastUsedAt` 填进 `lastUsed`；
 *          `kind` 只有上游认识的 `skill` 一类，`tool` / `plugin` 仍留在本仓账本里
 *          → **两条数据源共存**，上游只补 `skill:` 这一段，不得整体替换。
 *   P0     `recordUse()` 保留（它是纯函数、已有测试），但**不再作为计数真源**；
 *          README 要写清「同一个数字不能有两个写者」。
 *   P1     0 次的项**不隐藏**：0 次恰恰是最该被看到的一类（上游 README 第 4 条痛点同此）。
 */
export function attachCountSource() {
  throw new Error('TODO-B: 未实现（候选骨架，禁止挂载）')
}

/**
 * 挂载即抛错 —— 让「误接入」是一次显式失败，而不是一个安静的空面板。
 */
export function apply() {
  throw new Error(
    'dsh-radar-skill-stats 是候选骨架（未评审），不可挂载。见 README。',
  )
}
