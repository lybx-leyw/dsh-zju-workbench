// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 `dsh-llm-fallbacks`（原生 DSH Web 插件，MIT）锁版挂载进来，
//       作为整个工作台的**模型请求底层**——当某家 provider/model 持续失败时，
//       按配置的链自动切到下一个可用模型，当前 step / turn 继续，而不是整个任务中断。
//
// 上游：https://github.com/omdsh-dev/dsh-llm-fallbacks     ★21（2026-10-18 push，活跃）
//       npm: dsh-llm-fallbacks@0.6.7（锁版，不用 ^；见 ./upstream.js）
//       许可证：MIT ✅（GitHub metadata；npm `license` 字段未回填，见 README §风险 R-4）
//       体积：unpacked 905,327 B（≈0.90 MB），dist 696 KB
//
// 性质：**A 类（原生 DSH 插件包）· 强化式集成**。
//       上游自带 `dsh.bundle.patch`（`bundle/cordis.patch.yml`）与
//       `dsh.client.inject`（6 个前端包：plugin-manager / settings / conversation /
//       locale / connection / api-remotes），是真正的 Web 插件。
//
// # 集成方式：锁版挂载 + 外围兼容层（效法 dsh-zhiyun-paper / dsh-zhiyun-page-paper）
//
//   上游 patch 用上游自己的 id 插入。本包**不直接用那份 patch**（理由见 ./cordis.patch.yml）：
//   本包用**自己的 id** `radar-llm-fallback` 插入，由 `loadUpstream()` 在宿主侧
//   `import('dsh-llm-fallbacks')` 后调用上游 `apply(ctx)`。**上游源码一行不改。**
//
// # 集成判定：强化式集成的三条判据（与 README 对照阅读）
//
//   ① 仍是同一个面板 —— **是，而且是最严格意义的那种**：
//      不新增页面、不新增导航项、不新增任何面板。它挂在**所有页面共用的请求管线**上，
//      用户看到的仍是原来那些页面，只是「模型挂了」时不再报错。
//   ② 功能仍相似正交 —— 是。上游做的仍是「发一次模型请求」，与宿主 `dsh-llm`
//      的职责完全相同；新增的只是「失败之后怎么办」的决策（降级链 / 冷却 / 分时路由）。
//   ③ 底层多调了更优质实现 —— 是。本仓现有请求路径**没有任何跨 provider 的失败转移**：
//      provider 由用户在设置里选定，失败即失败（重试逻辑在 `dsh-llm-retry`，
//      但它只重试**同一个**模型/渠道，不会换 provider）。
//      ⚠ 判据③的「更优质」须在评审时用**同一份失败码样本**实测确认，见 README §风险 R-3。
//
// # 边界（评审前请确认这六条）
//
//   1. **不新增数据源、不改任何页面的落盘格式。** 上游的降级链配置写在上游自己的
//      settings 分区里，本包**不代它落盘**，也不把链写进任何 `AGENTS.md` / 计划 / 笔记。
//   2. **不做「模型选择器」的替代品。** 上游有「角色化 subagent」（`**Execute as**: <id>`
//      头部 → persona / 徽章 / 路由），这是**它自己的**能力域，与本仓「问一问 / 论文 / 规划」
//      各页无关。本包接入时**只启用降级 + 分时**两项，角色化一律关（见 TODO 4）。
//   3. **不改写用户的显式模型选择。** 用户明确选了某个模型时，本包不得在**成功路径**上
//      替换它；降级只允许发生在**该请求已经按失败码判定失败之后**。
//   4. **失败必须降级为现状，而不是报错。** 上游加载失败 / 版本窗口不相交 / 配置为空
//      → 退回现状（没有任何降级，行为与今天逐字一致）。**绝不**因为本包而让发消息点不动。
//   5. **不默认开「峰谷分时」。** 上游有四个冻结的 UTC+8 预设（`liang-peak` 等，
//      会按墙钟把请求切到不同 provider）。这**会改变学生在特定时段的账单/模型**，
//      属于产品决策，默认必须是**关**；且默认值要与现状逐字一致（=全时段链空）。
//   6. **不在客户端注入任何 UI。** 上游 `dsh.client.inject` 会在「设置 → 插件配置」
//      里放一张 Fallbacks 卡片。本包接入时**必须**评估这张卡片是否与
//      `dsh-zhiyun-page-me` 的设置分区冲突（见 TODO 3）；冲突则**去掉 client 入口**，
//      只保留宿主侧能力。
//
// # 本文件状态
//
// 只有签名与 TODO，**没有实现**。调用即抛错 —— 这是故意的，见 README 顶部声明。

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'radar-llm-fallback';

/**
 * 上游 `apply(ctx)` 需要的宿主服务。
 *
 * 上游 peer 里与本包直接相关的只有三个，其余由上游自己 `ctx.get` 惰性取：
 *   - `llm`      —— 发请求的那一层，降级要在这里拦 `agent/request-error`；
 *   - `settings` —— 读/写降级链；
 *   - `subagents`—— 上游的角色化分流用；本包**不启用**该能力（TODO 4），
 *                   因此这里**不声明**它，以免把可选能力变成硬依赖。
 */
export const inject = ['llm', 'settings'];

/**
 * 挂载上游。**未接入 profile，不会被调用。**
 *
 * 评审通过后的接入形状（占位，不实现）：
 *   const upstream = await loadUpstream();
 *   if (upstream.ok) ctx.plugin(upstream.mod.default ?? upstream.mod);
 *   else ctx.logger?.warn?.('[radar-llm-fallback] upstream unavailable: %s', upstream.error);
 */
export function apply(ctx) {
  // 与 `dsh-radar-plugin-graph` / `dsh-radar-evolve-modes` 同规：
  // 评审期间本包不得对宿主产生任何副作用 —— 不 import 上游、不改请求管线、不注册分区。
  ctx.logger?.info?.(
    '[radar-llm-fallback] candidate skeleton loaded (no-op) · upstream %s@%s',
    UPSTREAM_PACKAGE,
    UPSTREAM_VERSION,
  );
}

// ── TODO（评审必须逐条回答，回答后才可以写第一行实现）────────────────────────────
//
// 1. **「谁先接 `agent/request-error`」—— 本骨架最大的不确定性。**
//    上游 patch 顶部的注释明确写了：必须让 `dsh-llm-retry` **先**于本插件注册，
//    本插件只在「重试耗尽」后介入。本仓 profile 的 bundles 里没有显式的 retry 行
//    （它来自 `@deepseek-ai/dsh-base`）。评审须在**实际安装的宿主**上确认监听顺序，
//    并在本包 `apply` 里做一次 `ctx.get('llm')` 的能力探测；**顺序不可保证时，
//    宁可不接**（否则会出现「还没重试就先降级」，把瞬时 5xx 变成换模型）。
//
// 2. **触发码的默认集合要不要收窄。**
//    上游默认 `triggerCodes = AUTH / QUOTA / RATE_LIMIT`，并允许加入
//    `CONTEXT_WINDOW_EXCEEDED`（会降级到上下文更大的模型）。对本仓而言：
//    「笔记/论文里塞了一篇长 PDF → 上下文超限」是**高频且可解释**的场景，值得开；
//    但 `RATE_LIMIT` 在免费额度下同样高频，降级到另一家 provider 意味着**另一份账单**。
//    评审须裁定默认集合，并把默认值钉进单测（改默认值必须改测试）。
//
// 3. **设置分区的归属。**
//    上游把配置放在「设置 → 插件配置 → Fallbacks」卡片；本仓「个人」页
//    （`dsh-zhiyun-page-me`）已有 `settings.section` 注册体系。评审须二选一：
//    (a) 保留上游卡片（**最少改动**，但与「个人」页的视觉/交互不一致）；
//    (b) 去掉上游 client 入口，由本包在「个人」页注册一个只读写上游 config 的分区
//        （更一致，但要读上游 config 的 schema，属于外围兼容层的工作量）。
//    **不得**两个入口同时存在。
//
// 4. **角色化 subagent 必须显式关闭。**
//    上游会在 subagent 分发提示词里找 `**Execute as**: <id>` 头部，命中则注入 persona、
//    写一行 `[role: <id>]` 通知、并在宿主允许时**改写该 subagent 的模型**。
//    这会影响「问一问 / 论文助手 / 规划」里所有由 Agent 派发的子任务。
//    本包接入时：`roles` 置空、`subagent-model-selection` 注入**禁用**，
//    并在 README 里写明「本包不提供角色化能力」。
//
// 5. **峰谷分时的默认值与可见性。**
//    默认：`timeSlots = []`（不轮换）。若未来要开，必须先回答：
//    切换发生在**哪一层的账单**上？学生看到的是哪一个数字？**未回答前不实现**。
//
// 6. **版本窗口。** 上游 26 项 peer（`@deepseek-ai/dsh-*` 均为 `^0.2.1-rc.2`）
//    与本仓 `runtime.lock.json` 的 `hostVersions`（`0.2.0-rc.2` / `0.2.1-alpha.1`）
//    是**必须逐项做交集**的：`^0.2.1-rc.2` 与 `0.2.1-alpha.1` 是否相交取决于
//    semver 对 prerelease 的处理 —— 见 `src/upstream.js` 的 `UPSTREAM_HOST_RANGE`
//    与 README §风险 R-1。**不相交 → 拒绝启用**，不得降级为「先装上试试」。
//
// 7. 不搬运上游源码；完成后按 CONTRIBUTING 流程补测试、接入 profile、写 OWNERS
//    （本骨架已写 `Owner: shared`）。
