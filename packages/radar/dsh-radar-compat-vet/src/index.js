/**
 * dsh-radar-compat-vet —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 把上游 `dsh-compat-vet`（MIT，npm 已发布 0.3.2）**锁版挂载**进来，
 * 在**「插件」页现有那张依赖图**上，为每一行补一列**兼容性状态**：
 * 这个插件在**下次启动时还能不能加载**、会不会被拒绝、
 * 是不是「快要不适配」（上游还没拒绝、但 peer 范围即将越界）。
 *
 * ── 为什么是「强化式集成」而不是简单集成 ────────────────────────
 *
 * 三条同时成立：
 *   1. **仍是同一个面板** —— 「插件」页，不新增导航项、不改侧栏，只在该页
 *      依赖图的每一行追加一列。（上游自带 `./client` 可以整页挂，但**不用** ——
 *      那会违反本条；见 `src/upstream.js` 的 (a)/(b) 说明。）
 *   2. **功能仍相似正交** —— 现有页回答的是**横向**问题：
 *      「**谁依赖谁、我现在能关掉谁**」（拓扑 / 可取消性，读的是**当前**运行时事实）。
 *      本候选回答的是**纵向**问题：
 *      「**下次启动它还能不能被加载**」（版本兼容性，读的是**未来**的判定）。
 *      同一批插件、同一个「它对我的工作台意味着什么」的判断，
 *      一个讲**当下的结构**，一个讲**时间上的可用性**。
 *   3. **底层多调了更优质实现** —— 本仓**没有任何**兼容性/版本矩阵判定能力。
 *      这不是「再写一个检查」的规模问题，而是**本仓拿不到判定所需的输入**：
 *      判定要的是「本机 dsh 版本 × 每个插件的 peer 范围 × 已知破坏性变更表」，
 *      其中第三项是上游长期维护的资产。已核实（见下「已实测核实」）。
 *
 * 缺任何一条都只能算重复集成，应当拒绝。
 *
 * ── 集成方式（效法 packages/dsh-zhiyun-host-paper / dsh-radar-plugin-audit）────
 *
 *   ❌ 不改上游源码。
 *   ✅ 锁版（写死 0.3.2，不用 `^`）引入上游。
 *   ✅ 由本包 `cordis.patch.yml` 把上游挂进 DSH 运行时。
 *   ✅ 「插件」页侧只**加一列**，其余布局、交互、开关语义保持原样。
 *
 * ── 已实测核实（2026-10-17，本骨架生成时）────────────────────────
 *
 *   - 上游仓库 `liujianqiao701/dsh-compat-vet`：★0、fork 0、JavaScript、
 *     建于 2026-09-30、末次推送 2026-09-30。**属极早期小项目**。
 *   - GitHub API `license.spdx_id = MIT`；`LICENSE` 实文首行
 *     `MIT License / Copyright (c) 2026 liujianqiao` —— **已比对，非仅凭元数据**。
 *   - npm `dsh-compat-vet@0.3.2`：`license = MIT`；
 *     `dsh.bundle.patch = './cordis.patch.yml'` —— **标准 bundle 形状，可锁版挂载**；
 *     `cordis.patch.yml` 实文为 `- insert: [{ id: compat-vet, name: 'dsh-compat-vet' }]`；
 *     实包 `files` 含 `lib/`（9 个模块）+ `scripts/`（6 个验证脚本）+ `README.md`。
 *   - 上游自带 `scripts/verify-real-boot.mjs` / `verify-real-repair.mjs` /
 *     `verify-tarball-install.mjs`，并带 9 个 `node --test` 测试文件 ——
 *     **自带真机验证脚本是加分项**（多数同类候选没有）。
 *   - 「本仓无此能力」的核实：`packages/` 下无任何 `compat` 命名包；
 *     `dsh-zhiyun-page-plugins/src/` 只处理 `deps` / `dependents` / `leaf` /
 *     `cancellable` / `readOnlyReason`，**全文无 peer / semver / 兼容 相关实现**。
 *
 * ── 与既有登记的重复比对（必做）──────────────────────────────────
 *
 * 已登记的两条**同域**候选，各有硬伤，**都不能锁版挂载**：
 *
 *   - `rogerdigital/dsh-vet`（2026-10-15，🟡，MIT，★2）：`dsh` 字段为
 *     `{ seams: [fs, shell, web] }`，**非 `bundle.patch` 形状** → 不能以 bundle 挂载。
 *   - `jkrandom-sudo/dsh-plugin-audit`（2026-10-15，🟢，已出骨架
 *     `dsh-radar-plugin-audit`）：做的是**静态权限画像**（它"能碰到什么"），
 *     与**兼容性判定**（它"还能不能被加载"）**是两件不同的事**，不构成重复。
 *
 * 另有本轮新命中的 `SongYuhui14/dsh-plugin-compat-checker`（★1，MIT）与
 * 上游同做「装前兼容性预测」—— 但该条 npm 未发布、无 bundle.patch，
 * **同样不能锁版挂载**；已在报告里登记为 🔵。
 *
 * ── TODO（评审通过后再动）────────────────────────────────────────
 *
 *   [ ] 核验上游 patch 行 id `compat-vet` 与本包 `radar-compat-vet` 是否冲突。
 *   [ ] 确认 `./audit` 的**可编程调用方式**（上游 `exports` 里有 `./audit`，
 *       比 plugin-audit 那个「只有 agent 工具」的候选**乐观得多**）——
 *       但仍需确认它是否需要宿主 `ctx` 才能跑，以及探测失败时的降级行为。
 *       **这是本骨架最大的未知项**，评审时应优先核实。
 *   [ ] 定「追加列」的边界：只给一枚三态徽标
 *       （`✅ 可加载` / `⚠ 即将不适配` / `⛔ 将被拒绝`）+ 点击展开原因？
 *       倾向**默认只给徽标**，避免插件页被信息淹没（与 plugin-audit 骨架同口径）。
 *   [ ] **不暴露上游「一键修复」写入口**：上游会做真实的隔离/卸载/升级。
 *       本仓策略为**只读预警 + 引导到既有行级开关**
 *       （`remote.pluginManager.setPluginEnabled`，与插件页现开关同路径，
 *       写在用户 overlay 里、`initialize()` 保留）。若要复用上游修复逻辑，
 *       **必须先裁决**是否接受上游直接写 profile。
 *   [ ] 定探测时机与成本：上游要「探测本机 dsh 版本与能力（含实测校准）」，
 *       不该每次打开插件页就跑一遍 → 需要缓存 + 失效条件（dsh 版本变更时重跑）。
 *   [ ] 文案口径：上游是**运行时探测**得出判定，可能误判 ——
 *       界面**不得**把「将被拒绝」渲染成确定结论，应为「预警 / 建议核对」口吻。
 *   [ ] 补 `tests/radar-compat-vet.test.mjs`，断言声明版本 === 安装版本。
 *   [ ] ⚠ **上游 ★0 / fork 0 / 建于 2026-09-30**：采用前须在**隔离环境**
 *       实跑其 `verify-real-boot.mjs`，确认它在当前 dsh 版本上确实可用。
 *       上游自称「适配任意 dsh 版本」，这句话需要**本仓自己验一遍**。
 */

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_MOUNT,
  UPSTREAM_COMPAT,
  readInstalledVersion,
  readCompatProfile,
} from './upstream.js';

export const name = 'dsh-radar-compat-vet';

export function apply() {
  // TODO: 评审通过后实现。当前刻意留空 —— 骨架不是实现。
  //
  // 预计形状（供评审时判断工作量，非最终设计）：
  //
  //   1) 运行时核对上游版本（不抛错，记状态供页面显示）——
  //      const installed = readInstalledVersion();
  //   2) 向「插件」页暴露一个**只读**的兼容性读数接口：
  //      readCompatProfile(packageName)
  //        → { state: 'ok'|'soon'|'rejected', reason, evidence }
  //      由插件页在渲染依赖图时按行取用（含缓存，dsh 版本变更时失效）
  //   3) **不**代理上游的 repair/upgrade —— 见文件头 TODO 第 4 条。
  //
  // 注意：**不要**在这里自己写一套版本矩阵/兼容性判定 ——
  // 那会变成重写上游，违反「绝不改上游源码、只做锁版挂载」的硬边界。
}

export {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_MOUNT,
  UPSTREAM_COMPAT,
  readInstalledVersion,
  readCompatProfile,
};
