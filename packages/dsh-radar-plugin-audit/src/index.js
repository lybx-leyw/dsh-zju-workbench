/**
 * dsh-radar-plugin-audit —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 把上游 `dsh-plugin-audit`（MIT，npm 已发布 0.1.4）**锁版挂载**进来，
 * 在**「插件」页现有那张依赖图**上，为每一行补一列**静态权限画像**：
 * 这个插件能读写哪些文件、能不能起子进程、会往哪些主机发数据、
 * 碰不碰 `GITHUB_TOKEN` / `.ssh` 这类凭据。
 *
 * ── 为什么是「强化式集成」而不是简单集成 ────────────────────────
 *
 * 三条同时成立：
 *   1. **仍是同一个面板** —— 「插件」页，不新增导航项、不改侧栏。
 *      现有页面回答的是「**谁依赖谁、我能关掉谁**」；
 *      本候选回答的是同一批插件的「**它被开启时能碰到什么**」。
 *   2. **功能仍相似正交** —— 两者都在回答「这个插件对我的工作台意味着什么」，
 *      一个讲**结构**（拓扑 / 可取消性），一个讲**权限面**（能力 / 触达范围）。
 *      不是两套并列能力，而是同一判断的两个正交侧面。
 *   3. **底层多调了更优质实现** —— 本仓**没有任何**权限扫描能力
 *      （已核实：`packages/dsh-zhiyun-page-plugins/src/` 下 `runtime.js` / `Panel.jsx`
 *      只处理 `deps` / `dependents` / `leaf` / `cancellable` / `readOnlyReason`，
 *      全文无 audit / permission / 权限 相关实现）。上游提供的是带**文件/行号证据**
 *      的静态画像 + 动态代码执行检测 + 凭据路径识别，这是本仓从零写不划算的一层。
 *
 * 缺任何一条都只能算重复集成，应当拒绝。
 *
 * ── 集成方式（效法 packages/dsh-zhiyun-host-paper / dsh-radar-context-lens）────
 *
 *   ❌ 不改上游源码。
 *   ✅ 锁版（写死 0.1.4，不用 `^`）引入上游。
 *   ✅ 由本包 `cordis.patch.yml` 把上游挂进 DSH 运行时。
 *   ✅ 「插件」页侧只**加一列**，其余布局、交互、开关语义保持原样。
 *
 * ── 与前面几个 A 类骨架的关键差别（评审请注意）──────────────────
 *
 * `dsh-radar-better-markdown` / `dsh-radar-context-lens` 挂的上游都带 `dsh.client`，
 * 有现成的浏览器半边可用。**本上游没有** `dsh.client` —— 它只在宿主侧注册
 * 一个 `plugin_audit` 工具与一个 `tools/pre-execute` 监听器。
 *
 * 所以本骨架**不是**「挂上就有一块画面」，而是**宿主侧取数 + 页面侧自绘一列**。
 * 工作量因此比另两个骨架高：多一步「把 markdown 卡片解析成结构化行数据」
 * （上游同时提供 `format: 'json'`，优先用 json 而不解析 markdown）。
 *
 * ── TODO（评审通过后再动）────────────────────────────────────────
 *
 *   [ ] 核验 `dsh-plugin-audit@0.1.4` 的 `cordis.patch.yml` 挂载点 id
 *       （上游自带 patch 的行 id 为 `dsh-plugin-audit`）与本包
 *       `cordis.patch.yml` 的 `radar-plugin-audit` 是否冲突。
 *   [ ] 确认审计入口的**可编程调用方式**：上游对外是 **agent 工具**
 *       （`plugin_audit`，输入 `{ path, format }`）。要把它接成页面数据源，
 *       需确认是否存在可直接 import 的宿主侧 API；若只能经工具调用，
 *       则必须走 `ctx` 里的工具调用通道 —— **这是本骨架最大的未知项**，
 *       评审时应优先核实，它决定了方案 a 是否可行。
 *   [ ] 定「插件源码目录」的解析口径：审计要求传**源码目录**（非含 `node_modules`
 *       的安装副本）。本仓 `packages/dsh-zhiyun-*` 是 workspace 源码目录，口径吻合；
 *       但**第三方已装插件**在 profile 依赖里，需确认其源码位置。
 *   [ ] 定向扫描范围：本仓约 30 个自有包，**不该**每次打开插件页就全量扫。
 *       需要缓存/增量策略（按包 mtime 或按文件 hash），并给它设上限。
 *   [ ] 定「追加列」的边界：只展示 `risk` 一个徽标？还是展开成 capability 明细？
 *       倾向**默认只给一枚分级徽标 + 点击展开明细**，避免插件页被信息淹没。
 *   [ ] **哨兵默认关闭**（`sentinelEnabled: false`）。理由见 README
 *       「需要人工裁定的事项」第 2 条：本仓是学生日常学习台，
 *       不该给每次工具调用都加一道审批询问。
 *   [ ] 文案口径：上游自述 *"The audit is an aid, not a verdict"* ——
 *       界面**不得**把 `risk` 呈现成判决，应为「证据提示」口吻。
 *   [ ] 补 `tests/radar-plugin-audit.test.mjs`，断言声明版本 === 安装版本。
 *   [ ] 与同域候选**取优不叠加**：本轮另有 `rogerdigital/dsh-vet`、
 *       `chuanxuWei/dsh-trust-center`、`Evhye38496/dsh-perfscope` 等；
 *       先比对再决定接谁（见报告「与既有登记的重复比对」）。
 */

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_MOUNT,
  UPSTREAM_COMPAT,
  readInstalledVersion,
  readAuditProfile,
} from './upstream.js';

export const name = 'dsh-radar-plugin-audit';

export function apply() {
  // TODO: 评审通过后实现。当前刻意留空 —— 骨架不是实现。
  //
  // 预计形状（供评审时判断工作量，非最终设计）：
  //
  //   1) 运行时核对上游版本（不抛错，记状态供页面显示）——
  //      const installed = readInstalledVersion();
  //   2) 确认上游哨兵**未被启用**（本包不打算开启；若发现被开启要显式报出来）
  //   3) 向「插件」页暴露一个**只读**的审计读数接口：
  //      readAuditProfile(packageName) → { risk, findingsCount, capabilities[] }
  //      由插件页在渲染依赖图时按行取用（含缓存，避免每次全量扫）
  //
  // 注意：**不要**在这里自己写一套权限扫描 —— 那会变成重写上游，
  // 违反「绝不改上游源码、只做锁版挂载」的硬边界。
}

export {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_MOUNT,
  UPSTREAM_COMPAT,
  readInstalledVersion,
  readAuditProfile,
};
