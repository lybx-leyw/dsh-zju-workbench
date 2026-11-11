// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 `dsh-data-quality`（原生 DSH 宿主插件，Apache-2.0）锁版挂载进来，
//       作为「学习」页材料卡 `dsh-zhiyun-page-study` 与「测验」质检链
//       `dsh-zhiyun-core-quiz/src/quality.js` 的**确定性数据层**，
//       替换本仓目前唯一那条「字符串包含」判据：
//
//         points.js:144
//         if (!source || typeof item.quote !== 'string' || item.quote.length < 8
//             || !source.snippet.includes(item.quote)) return { error: '外部来源或引用无法核对' }
//
//       这条判据把 `1,234` 与 `1234`、`12.3%` 与 `0.123` 一律判成「无法核对」，
//       于是**真实的引用**被判为假，学生看到的题被无谓拦下。
//
// 上游：https://github.com/PerryLink/dsh-data-quality   ★54（2026-11-01 push）
//       npm: dsh-data-quality@0.3.24（锁版，不用 ^；见 ./upstream.js）
//       许可证：Apache-2.0 ✅（GitHub metadata / LICENSE 首行 / npm license 三源一致）
//       体积：npm unpacked 927,706 B（≈0.88 MB），唯一运行时依赖 zod@4.4.3
//       形态：**纯宿主侧**（exports 只有 `.`），无前端半边 → **不需要 iframe 承载**
//
// 性质：**A 类（原生 DSH 插件包）· 强化式集成**。
//
// # 集成方式：锁版挂载 + 外围兼容层（效法 dsh-zhiyun-paper / dsh-zhiyun-page-paper）
//
//   本包**不直接使用**上游那份 patch（理由见 ./cordis.patch.yml 顶部注释）：
//   用**本仓 id** `radar-data-quality` 插入本包，由 `loadUpstream()` 在宿主侧
//   `import()` 上游，再调上游导出的 `apply(ctx)` 接进同一个 ctx。**上游源码一行不改。**
//
// # 集成判定：强化式集成的三条判据（与 README 对照阅读）
//
//   ① 仍是同一个面板 —— 是：不新增页面、不新增导航项。学生看到的仍是
//      「学习」页上的那张材料卡、仍是「测验」出题时的同一条质检结论。
//      本包**不提供任何 UI**，只提供 Cordis 服务与（可关的）三个工具。
//
//   ② 功能仍相似正交 —— 是：做的仍是同一件事**判断一段数字/引用是否可信**。
//      上游新增的「列类型推断 / 单位归一 / IQR 离群」不是新面板，
//      是同一条质检流程里**本仓目前空缺的那一段**。
//      反例（不成立的做法）：把它做成「数据分析工作台」放进工作台 —— 那是另一个产品，
//      不在学生场景内，也与「刷题 / 笔记 / 论文」没有交集。
//
//   ③ 底层多调了更优质实现 —— 是：
//      - 本仓：字符串包含（`includes`），零容差，单位敏感；
//      - 上游：定位符行走 + 数值**相对容差**（`|a-b| <= tol*max(|a|,|b|)`）+
//        四态 `verified / mismatch / not-found / unverifiable`，可数值解析的
//        CSV 单元格按数值比较，字符串精确比较，类型不可比归 `unverifiable`。
//      这是**同一个判断**换了一个更准的底层，不是多一个功能。
//
// # 边界（评审前请确认这六条）
//
//   1. **只接 `verifyCitations`。** `data_clean` 会**写文件**（尽管「绝不覆盖源文件」）、
//      `data_profile` 会**读非会话工作区的文件**。这两条在学生机器上都不是「默认该开」的。
//      评审须裁定：三个工具是否全部向学生暴露，还是只留服务、工具全部从 tools 注册表摘掉。
//   2. **不改质检链的分层顺序。** `quality.js` 的四层是**成本序**（近零 → 低 → 中 → 高），
//      本包只能加强第 1 层，**不得**跨到第 2 层（可回答性是语义判断，上游不做）。
//   3. **失败必须降级为现状，而不是报错。** 上游加载失败 / 版本不匹配 / 服务被关 →
//      退回 `source.snippet.includes(item.quote)`。任何情况下不得让「出题」点不动。
//   4. **`unverifiable` 保持现状（放行），`mismatch` 才拦截。** 现状是「不中即拦」，
//      本包若把 `unverifiable` 也拦，等于**比现状更严** —— 那就不是强化，是改行为。
//   5. **不把 storage domain 的报告当数据源。** `data_quality` 的报告是运行记录，
//      换设备即失效；题库 / 笔记**不得**从那里读。
//   6. **不放开 `workspaceRoot` 为空时的兜底。** 上游默认「空 = harness 进程启动目录」，
//      在学生机器上意味着「能读整个家目录里任意 .csv」。评审须裁定是否必须显式配置。
//
// # 本文件状态
//
// 只有签名与 TODO，**没有实现**。调用即抛错 —— 这是故意的，见 README 顶部声明。

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'radar-data-quality';

/**
 * 只声明「必须存在」的那一个宿主服务。
 *
 * 质检链是**消费者**，本包是**底层**：没有 `profileContext`（数据目录 / 宿主版本）
 * 本包就没有可做版本断言的锚点，因此写进 inject 由 Cordis 决定 pending，
 * 而不是 `ctx.get` 惰性取。
 *
 * ⚠ 上游自己 inject 的是 `dataQuality` 之外的 storage 栈（`storage-json` +
 * `storage-domain`，由 `dsh-base` bundle 组合进来）。本包**不重复声明**这些 ——
 * 它们是上游的依赖，由上游 patch 负责；本包只声明自己的。
 */
export const inject = ['profileContext'];

/**
 * 注册 Cordis 服务。**未接入 profile，不会被调用。**
 *
 * 评审通过后的接入形状（占位，不实现）：
 *   ctx.provide('radar.citationCheck', { check, capabilities })
 *     └ 供 `dsh-zhiyun-core-quiz/src/quality.js` 的第 1 层硬检查调用；
 *        内部转调 `ctx.dataQuality.verifyCitations()`，把 `mismatch` 翻译成本仓
 *        现有的 `{ error: '外部来源或引用无法核对' }` 形状（**调用方零改动**）。
 */
export function apply(ctx) {
  // 与 `dsh-radar-plugin-graph` / `dsh-radar-agent-teams` 同规：评审期间本包不得
  // 对宿主产生任何副作用。不注册 slot、不注册 RPC、不改任何现有页面，
  // **也不 import 上游**（只打一行日志）。
  ctx.logger?.info?.(
    '[radar-data-quality] candidate skeleton loaded (no-op) · upstream %s@%s',
    UPSTREAM_PACKAGE,
    UPSTREAM_VERSION,
  );
}

// ── TODO（评审必须逐条回答，回答后才可以写第一行实现）────────────────────────────
//
// 1. **先裁定「谁翻译结果」，再谈挂载。**
//    上游返回的是 `{ id, status, actual?, note? }` 四态；本仓质检链要的是
//    `{ error: string } | { ...ok }` 二元。这两者之间缺一个**翻译层**：谁把
//    `mismatch` 变成现在的错误文案？本骨架的答案是**本包**（`check()`），
//    **不是**在 `quality.js` 里加 if 分支。评审须确认：翻译层放在本包，还是放在
//    `core-quiz`？**不要两条都做。**（同 `dsh-radar-agent-teams` TODO 1 的边界）
//
// 2. **三个工具会不会污染全局 `tools` 注册表？**
//    上游把 `data_profile` / `data_clean` / `data_verify` 注册进**共享的 `tools` registry**。
//    本仓 profile 是**一整个工作台**：学生问「帮我整理一下这份笔记」时，模型可能开始
//    调用 `data_clean` 去**改文件**。评审必须先测：在笔记 / 论文 / 课堂会话里，
//    模型是否开始无端调用数据清洗。**若有，本包必须在装载后把这三个工具从 registry 摘掉**
//    （只留 `ctx.dataQuality` 服务）。这是本包**最可能的阻塞点**。
//
// 3. **`workspaceRoot` 默认空 = 进程启动目录，必须改。**
//    上游 README：「`workspaceRoot` 空 = harness 进程启动目录；工具调用始终使用会话工作区 cwd」。
//    本包要求：`workspaceRoot` **必须**显式设为会话工作区，不得回落到进程 cwd。
//    理由：进程启动目录在桌面壳里可能是家目录，等于「能读家目录里任意 csv」。
//
// 4. **`allowedExtensions` 与 `maxFileSizeMB` 的默认值必须比上游更窄。**
//    上游默认 `.csv/.tsv/.json/.jsonl`。本仓材料里还有 `.md` / `.html` / `.docx`，
//    这些**不在**上游白名单内 —— 也就是说**大部分课程材料它读不了**。
//    评审须裁定：是否接受「只对 csv/tsv/json 生效」，还是要求上游扩展白名单
//    （若是后者，本骨架的方案不成立，需退回「只借 README 的容差公式，自己实现」）。
//    ⚠ **这一条可能直接推翻整个方案** —— 见 README「最大风险」。
//
// 5. **`unverifiable` 的处置必须写进测试**（评审通过后）。
//    现状是「字符串不包含即拦」；本包按「`unverifiable` 放行、`mismatch` 拦截」出具。
//    这条差异必须被一条单测钉死，否则等于悄悄放松了质检。
//
// 6. **体积与依赖。** 0.88 MB + `zod@4.4.3`。本仓已有 zod 吗？
//    若无，等于为它多带一个运行时依赖；评审须确认 `zod` 版本不与本仓其他包冲突。
//
// 7. **不搬运上游源码**；完成后按 CONTRIBUTING 流程补测试、接入 profile、写 OWNERS
//    （本骨架已写 `Owner: shared`）。若借鉴了上游的容差公式，按 CONTRIBUTING 3.3
//    记 ATTRIBUTION（本骨架未抄任何代码，故**不建** ATTRIBUTION.md）。
