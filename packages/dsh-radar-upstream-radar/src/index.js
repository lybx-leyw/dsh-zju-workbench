/**
 * dsh-radar-upstream-radar —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 把上游 `upstream-radar`（Apache-2.0，npm 已发布 0.45.0）**锁版挂载**进来，
 * 在**「插件」页现有那张依赖图**上，为每一行补一列**兼容性状态**：
 * 这个插件**下次启动还能不能被加载**，以及这个结论**有没有证据**（在隔离环境里真装真跑过）。
 *
 * ── 为什么是「强化式集成」而不是简单集成 ────────────────────────
 *
 * 三条同时成立：
 *   1. **仍是同一个面板** —— 「插件」页，不新增导航项、不改侧栏，只在该页
 *      依赖图的每一行追加一列。本上游**没有 `dsh.client`**（纯服务端），
 *      结构上就**无法**另起一块面板 —— 这条判据不由自律保证，由包形态保证。
 *   2. **功能仍相似正交** —— 现有页回答**横向**问题：「谁依赖谁、我现在能关掉谁」
 *      （拓扑 / 可取消性，读的是**当前**运行时事实）；
 *      本候选回答**纵向**问题：「下次启动它还能不能被加载」（版本兼容性，
 *      而且是**带证据**的：绑定插件字节 / 源码 commit / DSH 版本 / Node 版本 / 日志）。
 *      同一批插件、同一个「它对我的工作台意味着什么」。
 *   3. **底层多调了更优质实现** —— 判定需要**一次性隔离运行器**：自选 Node/profile、
 *      真装真跑、增量读日志、处理可恢复构建门禁、去重与重试。
 *      本仓（以及本仓已出的 `dsh-radar-compat-vet` 骨架）**都没有**这条证据链。
 *
 * ── 与 `dsh-radar-compat-vet` 的关系（必读，否则会被判「简单集成重复功能」）──
 *
 * 两者**抢同一列的同一行**，但**取证层不同**：
 *
 *   | | `dsh-radar-compat-vet`（10-17 出） | 本包（10-18 出） |
 *   | --- | --- | --- |
 *   | 上游 | `dsh-compat-vet@0.3.2`（MIT） | `upstream-radar@0.45.0`（Apache-2.0） |
 *   | 取证 | **静态契约比对**（读 peer 范围 / engines / 已知破坏表） | **动态隔离实跑**（真的装起来跑一次） |
 *   | 类比 | 体检报告（看指标） | 实车碰撞测试（真撞一次） |
 *   | 成本 | 打开页面即出，近乎零 | 起 Agent + 开环境，分钟级 |
 *   | 结论口径 | 「将要越界」预警 | 「装不进 / 起不来」的硬证据 |
 *   | 无 client | ❌ 有（骨架刻意不启用） | ✅ **本身就没有** |
 *
 * **二者输出同构**（插件 × DSH 版本 × Node 版本 → 可加载 / 不可加载 / 未知），
 * 所以**应当汇入同一列**，用 `source: 'static' | 'isolated-run'` 区分，而不是做成两列。
 * **但本轮不改动 compat-vet 骨架** —— 是否合并由人工裁决（见报告 §6 第 1 条）。
 *
 * ── 集成方式（效法 packages/dsh-zhiyun-paper / dsh-radar-compat-vet）────
 *
 *   ❌ 不改上游源码。
 *   ✅ 锁版（写死 0.45.0，不用 `^`）引入上游。
 *   ✅ 由本包 `cordis.patch.yml` 把上游 `upstream-radar/dsh` 挂进 DSH 运行时。
 *   ✅ 「插件」页侧只**加一列**，其余布局、交互、开关语义保持原样。
 *
 * ── 已实测核实（2026-10-18，本骨架生成时）────────────────────────
 *
 *   - 上游仓库 `MicroMilo/upstream-radar`：★11、TypeScript、建于 2026-08-14、
 *     末次推送 2026-10-16（**活跃**，非一次性小项目）。
 *   - 许可证三源一致：API `license.spdx_id = Apache-2.0`、根目录有 `LICENSE`、
 *     npm `0.45.0` 的 `package.json.license = Apache-2.0`。
 *   - npm 实包：`dsh = { bundle: { patch: './cordis.patch.yml' } }`，**无 `client`**；
 *     `exports` 有 `.` / `./dsh` / `./cordis.patch.yml`；
 *     `dependencies` 为**空**（零运行时依赖）；`engines.node = '>=22'`。
 *   - 上游 `cordis.patch.yml` 实文：`- insert: [{ id: upstream-radar,
 *     name: 'upstream-radar/dsh', config: { configFile: !!js process.env.UPSTREAM_RADAR_CONFIG, ... } }]`，
 *     且注释明写「**未配置库存文件时保持休眠，安装无副作用**」——
 *     这对「先挂上、评审后再启用」是有利条件。
 *   - 「本仓无此能力」的核实：`packages/` 下无 compat / 兼容 命名包；
 *     `dsh-zhiyun-page-plugins/src/` 全文无 peer / semver / engines 实现
 *     （与 compat-vet 骨架的同项核实结论一致，两轮独立复核）。
 *
 * ── TODO（评审通过后再动）────────────────────────────────────────
 *
 *   [ ] **先核 Node 版本**：上游 `engines.node >= 22`。本仓 `runtime.lock.json`
 *       与 CI 若不是 22+，锁版安装会直接失败 —— 这是采用前的**第一道门槛**。
 *   [ ] 核验 `cordis.patch.yml` 里挂的是 `upstream-radar/dsh` 还是裸包名
 *       （上游 exports 把两者分开，挂错会拿到 CLI 库而不是插件）。
 *   [ ] 定「读报告」的实现（见 `src/upstream.js` 的 a/b/c 三选一）——
 *       倾向 a：**只读上游已产出的报告**，打开页面零成本，不隐式触发 Agent。
 *   [ ] 定 `stale` 的判定：上游报告绑定了 DSH 版本 + 插件字节，
 *       一旦任一变化，旧结论必须降级为 `stale`，**不能继续显示为 passed**。
 *   [ ] 定 `unknown` 的呈现：离线 / Agent 不可用 / 未测 一律 `unknown`，
 *       **不得**渲染成中性或绿色（上游明确反对 “silent unknowns”）。
 *   [ ] **不代理上游的修复/升级/安装动作**（上游本身以「发布报告」为主，
 *       但若评审引入其 CLI 的写能力，须先裁决是否接受写 profile）。
 *   [ ] 与 `dsh-radar-compat-vet` 的合并方案（同列 + `source` 字段），
 *       由人工裁决后再动；**在此之前两者都不接入 profile**。
 *   [ ] 补 `tests/radar-upstream-radar.test.mjs`，断言声明版本 === 安装版本，
 *       且 `UPSTREAM_MOUNT.hasClientEntry === false` 与上游实包一致
 *       （这是一条**会红的**结构化断言：上游哪天加了 client，本包的「不新增面板」保证就失效了）。
 */

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_MOUNT,
  UPSTREAM_COMPAT,
  COMPAT_STATES,
  readInstalledVersion,
  readCompatProfile,
} from './upstream.js';

export const name = 'dsh-radar-upstream-radar';

export function apply() {
  // TODO: 评审通过后实现。当前刻意留空 —— 骨架不是实现。
  //
  // 预计形状（供评审时判断工作量，非最终设计）：
  //
  //   1) 运行时核对上游版本（不抛错，记状态供页面显示）——
  //      const installed = readInstalledVersion();
  //   2) 向「插件」页暴露一个**只读**的兼容性读数接口：
  //      readCompatProfile(packageName)
  //        → { state: 'passed'|'failed'|'unknown'|'stale', evidence: { dshVersion, nodeVersion, commit, logRef } }
  //      由插件页在渲染依赖图时按行取用。
  //   3) 报告本身由上游自己的调度产生 —— 本包**不**在页面渲染路径上触发任何分析。
  //
  // 注意：**不要**在这里自己写版本矩阵/兼容性判定 —— 那会变成重写上游，
  // 违反「绝不改上游源码、只做锁版挂载」的硬边界。
}

export {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_MOUNT,
  UPSTREAM_COMPAT,
  COMPAT_STATES,
  readInstalledVersion,
  readCompatProfile,
};
