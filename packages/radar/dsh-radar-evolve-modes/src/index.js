// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 `@graysilver/dsh-evolve-modes`（原生 DSH Web 插件，MIT）锁版挂载进来，
//       作为「规划」页 `dsh-zhiyun-page-planning` 的**工作流/审查底层**，
//       替换本仓目前「一键 `PLAN_PROMPT` → 单次 LLM 出计划 → 直接可执行」这一条直线。
//
// 上游：https://github.com/GraySilver/dsh-evolve-modes        ★204（2026-09-14 push）
//       npm: @graysilver/dsh-evolve-modes@0.4.1（锁版，不用 ^；见 ./upstream.js）
//       许可证：MIT ✅（GitHub metadata 与 npm `license` 两源一致）
//       体积：unpacked 499,204 B（≈0.48 MB）—— 与 `dsh-radar-code-highlight` 同量级
//
// 性质：**A 类（原生 DSH 插件包）· 强化式集成**。
//       上游自带 `dsh.bundle.patch`（`cordis.patch.yml`）与 `dsh.client.inject`（8 个前端包），
//       是真正的 Web 插件，不是库。
//
// # 集成方式：锁版挂载 + 外围兼容层（效法 dsh-zhiyun-paper / dsh-zhiyun-page-paper）
//
//   上游 patch 自己 insert 了 `id: dsh-evolve-modes`，并带一段 `!!js` 表达式。
//   本仓**不直接使用上游那份 patch**（理由与做法见 ./cordis.patch.yml 顶部注释）：
//   本包用**自己的 id** 插入，由 `loadUpstream()` 在宿主侧 `import()` 上游，
//   再用上游声明的 `apply(ctx)` 接进同一个 ctx。**上游源码一行不改。**
//
// # 集成判定：强化式集成的三条判据（与 README 对照阅读）
//
//   ① 仍是同一个面板 —— 是。「规划」仍是那一页：四个待办源、同一张表、同一个
//      「排一下」按钮。不新增页面、不新增导航项。
//   ② 功能仍相似正交 —— 是，做的仍是同一件事：**把一堆待办排成一个能执行的计划**。
//      上游新增的「质量门禁 / 自进化」不是新面板，是**同一份计划产出流程里的两个可选步骤**。
//   ③ 底层多调了更优质实现 —— 是：本仓当前的规划产出只有一次 LLM 调用
//      （`PLAN_PROMPT` → `readPlanResponse`），**没有任何独立审查环节**，
//      也不支持「先研究、再暴露假设、再出计划」的计划模式分流。
//
// # 边界（评审前请确认这五条）
//
//   1. **不新增数据源，不改落盘格式。** 计划仍然写进 `dsh-zhiyun-page-planning` 的
//      `LocalStore`（本地留存是这一页的真源，见该文件顶部注释）。上游的「自进化规则」
//      用**上游自己的存储**，本包不代它落盘，也不把它的规则写进 `AGENTS.md`。
//   2. **不接管输入区。** 上游会在输入区放一个紧凑的工作流控制项。本节的接法是把它
//      限定在**规划页的一次规划过程**内（见 TODO 3），不做全局开关 —— 否则它会变成
//      「每个会话都多一排按钮」，那就不是强化，是换了一页。
//   3. **质量门禁必须是「可选且默认关」。** 本仓的规划页是给学生排待办的，
//      默认加一道审查会改变现有节奏。默认值必须与现状**逐字一致**。
//   4. **失败必须降级为现状，而不是报错。** 上游加载失败 / 版本不匹配 / 审查超时
//      → 退回到现有 `PLAN_PROMPT` 单次产出路径。任何情况下不得让「排一下」点不动。
//   5. **不把上游的「自进化」默认打开。** 上游默认 `Propose`（每 3 轮回复学习一次）；
//      本包接入时**必须显式关掉**，是否开由用户在设置里自己决定。
//
// # 本文件状态
//
// 只有签名与 TODO，**没有实现**。调用即抛错 —— 这是故意的，见 README 顶部声明。

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'radar-evolve-modes';

/**
 * 只声明「必须存在」的那一个宿主服务。
 *
 * 规划页是**消费者**，本包是**底层**：没有 `profileContext`（数据目录）本包就没有
 * 可与计划对齐的锚点，因此写进 inject 由 Cordis 决定 pending，而不是 `ctx.get` 惰性取。
 */
export const inject = ['profileContext'];

/**
 * 注册 Cordis 服务。**未接入 profile，不会被调用。**
 *
 * 评审通过后的接入形状（占位，不实现）：
 *   ctx.provide('radar.planWorkflow', { plan, review })
 *     └ 供 `dsh-zhiyun-page-planning` 的 `plan()` 在「调 LLM」前后各插一步。
 */
export function apply(ctx) {
  // 与 `dsh-radar-plugin-graph` 同规：评审期间本包不得对宿主产生任何副作用。
  // 不注册 slot、不注册 RPC、不改任何现有页面，**也不 import 上游**（只打一行日志）。
  ctx.logger?.info?.(
    '[radar-evolve-modes] candidate skeleton loaded (no-op) · upstream %s@%s',
    UPSTREAM_PACKAGE,
    UPSTREAM_VERSION,
  );
}

// ── TODO（评审必须逐条回答，回答后才可以写第一行实现）────────────────────────────
//
// 1. **上游的「工作状态=计划」与本仓「规划」页是两件事，别混。**
//    上游的「计划」指的是 DSH 官方的 plan-mode（Agent 的执行计划）；
//    本仓「规划」页指的是**学生这一周的待办表**。二者同名不同物。
//    必须先裁定：本包接的是「生成待办表的那次 LLM 调用的质量门禁」，
//    还是「DSH plan-mode 的入口」？**不要两条都做。** 本骨架按前者出具。
//
// 2. **`!!js` 配置项怎么办。**
//    上游 patch 里 `shellTool` 用 `!!js` 表达式按平台取值。本仓安全补丁不支持 YAML 内执行 JS。
//    评审须决定：写死 `'bash'`（CI 是 Linux）还是由本包 `config` 给默认值？
//    **不得**把 `!!js` 原样搬进本仓的 patch。
//
// 3. **控制项放哪。**
//    上游默认把控件插在输入区（`dsh-client-ui-conversation`）。本包的诉求是「只在规划页生效」。
//    评审须确认上游是否暴露「仅在某路由挂载」的开关；**若不暴露**，本方案就不成立，
//    应考虑降级为「只在规划页的 drawer 里渲染上游的 client 组件」——
//    那属于**外围兼容层**，仍需先读上游 `lib/client.js` 的导出形状。
//
// 4. **两个会改持久化的开关，默认值必须是「不改变现状」。**
//    - 质量门禁：`关`（现状）；
//    - 自进化：`关`（上游默认 `Propose`，本包必须覆盖）。
//    写实现时这两条要能被单测钉死（像 `dsh-zhiyun-quiz` 的「默认不入库」那样）。
//
// 5. **计划页的 plan 结构要不要扩字段。**
//    若审查环节要回写「哪条待办被审查改过」，`PlanStore` 的条目就要加字段。
//    **禁止**静默改写：只允许**追加**字段，且旧数据读进来必须仍可用（与 quiz store 的 `loadItems` 同规）。
//
// 6. **版本窗口。** 上游 13 项 peer 与本仓 profile 实际版本的交集，须在装载期断言
//    （见 `src/upstream.js` 的 `UPSTREAM_PEERS`）。不相交 → 拒绝启用，退回现状。
//
// 7. 不搬运上游源码；完成后按 CONTRIBUTING 流程补测试、接入 profile、写 OWNERS
//    （本骨架已写 `Owner: shared`）。
