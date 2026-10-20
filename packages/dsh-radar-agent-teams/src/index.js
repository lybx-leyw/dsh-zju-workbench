// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 `@nanmicoder/dsh-agent-teams`（原生 DSH Web 插件，MIT）锁版挂载进来，
//       作为「规划」页 `dsh-zhiyun-page-planning`（周计划）与「今天」页
//       `dsh-zhiyun-page-today`（当日执行）的**分解与依赖调度底层**，
//       替换本仓目前「一个 PLAN_PROMPT → 一次 LLM 出清单 → 学生自己排先后」这一条直线。
//
// 上游：https://github.com/NanmiCoder/dsh-agent-teams        ★2299（2026-10-18 push）
//       npm: @nanmicoder/dsh-agent-teams@0.1.25（锁版，不用 ^；见 ./upstream.js）
//       许可证：MIT ✅（GitHub metadata `MIT` 与 npm `license: MIT` 两源一致）
//       体积：npm unpacked 3,418,813 B（≈3.26 MB）—— 比 `dsh-radar-evolve-modes`
//       （0.48 MB）大近 7 倍，主要差异见 TODO 8（前端半边 + 29 项 peer）。
//
// 性质：**A 类（原生 DSH 插件包）· 强化式集成**。
//       上游自带 `dsh.bundle.patch`（`cordis.patch.yml`）、`lib/index.js` 与
//       `./client` 两个 exports，是真正的 Web 插件，不是库。
//
// # 集成方式：锁版挂载 + 外围兼容层（效法 dsh-zhiyun-paper / dsh-zhiyun-page-paper）
//
//   本包**不直接使用**上游那份 patch（理由见 ./cordis.patch.yml 顶部注释）：
//   用**本仓 id** `radar-agent-teams` 插入本包，由 `loadUpstream()` 在宿主侧
//   `import()` 上游，再调上游导出的 `apply(ctx)` 接进同一个 ctx。**上游源码一行不改。**
//
// # 集成判定：强化式集成的三条判据（与 README 对照阅读）
//
//   ① 仍是同一个面板 —— 是（**有前置条件**）：「规划」仍是那一页周计划表，
//      「今天」仍是那一页当日待办。不新增页面、不新增导航项。
//      ⚠ 上游**自带一个 native workspace 面板**（roster + 任务 DAG + 进度）。
//      如果照搬，这是**换了一页**，不成立。因此本包只允许「在规划页的一个抽屉里
//      渲染上游的 workspace」，不得让上游的 panel 自己出现在导航里（见 TODO 3）。
//
//   ② 功能仍相似正交 —— 是：做的仍是同一件事**把一堆待办排成一个能执行的计划**。
//      上游新增的「依赖感知任务 / 成员间直邮 / 质量门禁」不是新面板，
//      是**同一条计划产出流程里的步骤**。反例（不成立的做法）：把上游做成
//      「多 Agent 编程协作台」放进工作台 —— 那是另一个产品，不在学生场景内。
//
//   ③ 底层多调了更优质实现 —— 是：本仓规划页当前产出的是**扁平清单**
//      （每条待办只有标题/时长/来源，没有 `dependsOn`、没有中间状态、没有执行者），
//      排序靠学生自己；上游提供的是 **依赖感知状态机 + 空闲成员自动认领 + 失败重试**
//      （`docs/quality-gates.md`：requirements → implementation → verification）。
//      对「先做完 A 才能开始 B」这类课业（如：先读完讲义 → 再刷题 → 再订正），
//      这是底层能力的实质升级，不是重复。
//
// # 边界（评审前请确认这六条）
//
//   1. **不新增页面、不接管导航。** 上游 workspace 只能在规划页抽屉内渲染；
//      上游的 `/agent-teams` 命令**不得**成为工作台默认入口（它会把一次普通排计划
//      变成一次多 Agent 会话，成本不可控）。
//   2. **不改规划页的落盘格式。** 计划仍写进 `dsh-zhiyun-page-planning` 的
//      `LocalStore`。上游团队状态写在 `<session workspace>/.agent-teams/`，
//      由上游自己管，本包**不代它落盘、不把它的 inbox 抄进计划表**。
//   3. **失败必须降级为现状，而不是报错。** 上游加载失败 / 版本不匹配 / 成员无法
//      启动 → 退回现有的 `PLAN_PROMPT` 单次产出。任何情况下不得让「排一下」点不动。
//   4. **不得默认 `spawn` 新会话成员。** 上游 `memberProvider` 默认 `spawn`。
//      学生的机器与额度都不是为「一次点开 5 个成员」准备的，默认必须是最省的拓扑
//      （见 TODO 4），且必须能被学生一键关掉。
//   5. **不把上游的「质量门禁」默认打开。** 上游明说它是 opt-in；
//      本仓同样保持 `关`，默认值必须与现状**逐字一致**。
//   6. **上游状态目录不得进 git、不得进笔记库、不得被「今天」页当作数据源。**
//      `.agent-teams/` 是会话级临时状态；若要沉淀，只允许沉淀**计划表**本身。
//
// # 本文件状态
//
// 只有签名与 TODO，**没有实现**。调用即抛错 —— 这是故意的，见 README 顶部声明。

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'radar-agent-teams';

/**
 * 只声明「必须存在」的那一个宿主服务。
 *
 * 规划页是**消费者**，本包是**底层**：没有 `profileContext`（数据目录 / 宿主版本）
 * 本包就没有可与计划对齐、可做版本断言的锚点，因此写进 inject 由 Cordis 决定
 * pending，而不是 `ctx.get` 惰性取。
 */
export const inject = ['profileContext'];

/**
 * 注册 Cordis 服务。**未接入 profile，不会被调用。**
 *
 * 评审通过后的接入形状（占位，不实现）：
 *   ctx.provide('radar.planDecompose', { decompose, status, cancel })
 *     └ 供 `dsh-zhiyun-page-planning` 的 `plan()` 在「出清单」之后、写 `LocalStore`
 *       之前各插一步；供「今天」页读某个任务的依赖是否已满足。
 */
export function apply(ctx) {
  // 与 `dsh-radar-plugin-graph` / `dsh-radar-evolve-modes` 同规：评审期间本包不得
  // 对宿主产生任何副作用。不注册 slot、不注册 RPC、不改任何现有页面，
  // **也不 import 上游**（只打一行日志）。
  ctx.logger?.info?.(
    '[radar-agent-teams] candidate skeleton loaded (no-op) · upstream %s@%s',
    UPSTREAM_PACKAGE,
    UPSTREAM_VERSION,
  );
}

// ── TODO（评审必须逐条回答，回答后才可以写第一行实现）────────────────────────────
//
// 1. **先裁定「谁来分解」，再谈挂载。**
//    规划页的 `PLAN_PROMPT` 出的是一条条独立待办；上游要的是「目标 → 依赖感知任务图」。
//    这两者之间缺一个**翻译层**：谁把「这周的 8 条待办」变成上游的 team goal？
//    本骨架的答案是**本包**（`decompose()`：待办表 → 任务 DAG），**不是学生手写 prompt**。
//    评审须确认：翻译层放在本包，还是放在规划页？**不要两条都做。**
//    本骨架按「本包提供 pure function，规划页只调用」出具 —— 这与 `dsh-zhiyun-quiz`
//    的「入库逻辑留在 quiz、页面只管展示」是同一条边界。
//
// 2. **`agent_teams_*` 14 个工具会不会污染全局 `tools` 注册表？**
//    上游 patch 注释明说它把这些工具注册进**共享的 `tools` registry**，并往**全局
//    system prompt** 插一段 usage。对内嵌面板（paper 包模式，iframe 承载）这没问题；
//    但本仓 profile 是**一整个工作台**，全局 system prompt 里多一段「你可以组建团队」
//    会影响**每一个**会话（包括「问一问」「笔记」）。评审必须先测：
//    在学生日常会话里模型是否开始无端组建团队。**若有，本方案需退回「仅规划页 ctx」**。
//
// 3. **上游 workspace 面板怎么「只出现在规划页」。**
//    上游默认把 native workspace 注册成一个页面/面板。本包要求它**只在**规划页的
//    抽屉里渲染（效法 `dsh-zhiyun-page-paper` 的 iframe 承载）。
//    评审须先读上游 `lib/client.js` 的导出形状，确认是否暴露「不自动注册面板」的开关；
//    **若不暴露**，只能用 iframe + 主题注入，并接受「上游内部导航无法完全隐藏」的风险。
//
// 4. **成员拓扑默认值必须是「最省」。**
//    上游 `memberProvider` 有 `spawn` / `fork` 两种；`spawn` 会新起会话。
//    本项目要给出默认值并写进本包 config（**骨架阶段故意不给**，见 patch 注释），
//    且必须能被一只开关关掉。判定依据：一名学生一次规划最多允许多少个成员？
//    上游 README 未给硬上限 —— 评审需实测，并把上限写进本包 config schema。
//
// 5. **两个会改持久化的开关，默认值必须是「不改变现状」。**
//    - 质量门禁（requirements → implementation → verification）：`关`（现状 + 上游 opt-in）；
//    - 自动 reuse / takeover：`关`（避免空闲成员自己认领学生没批准的任务）。
//    写实现时这两条要能被单测钉死（像 `dsh-zhiyun-quiz` 的「默认不入库」那样）。
//
// 6. **计划表结构允许追加，不允许改写。**
//    若要回写「哪个任务由哪个成员完成 / 依赖满足了几条」，`PlanStore` 条目只允许
//    **追加**字段；旧数据读进来必须仍可用（与 quiz store 的 `loadItems` 同规）。
//    **禁止**把上游的 teamId / inbox 路径写进计划表：那是临时状态，换设备即失效。
//
// 7. **版本窗口。** 上游 21 项 peer（含 10 个 `dsh-client-*`）与本仓 profile
//    实际版本的交集，须在装载期断言（见 `src/upstream.js` 的 `UPSTREAM_PEERS`，
//    以及 `UPSTREAM_HOST_RANGE` 的注释：本仓 `preferredHostVersion` 为
//    `0.2.0-rc.2`，**落在上游窗口内但未实测**）。不相交 / 未测 → 拒绝启用，退回现状。
//
// 8. **体积。** unpacked ≈3.26 MB，是本轮所有 A 类骨架里最大的。若最终形态是
//    「只在规划页抽屉里用」，须评估是否值得为它牺牲首屏（参考第四十一轮
//    `jieba-wasm` 的 Q-1 阻塞：2.8 MB wasm 不进浏览器 bundle）。**未答复前不接入。**
//
// 9. 不搬运上游源码；完成后按 CONTRIBUTING 流程补测试、接入 profile、写 OWNERS
//    （本骨架已写 `Owner: shared`）。
