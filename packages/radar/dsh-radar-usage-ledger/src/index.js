// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 目标：把上游 `@ychris12138/dsh-usage-stats`（原生 DSH Web 插件，MIT）锁版挂载进来，
//       作为整个工作台的**用量账本底层** —— 回答本仓今天回答不了的那个问题：
//       「我今天、在这个工作区，一共花了多少钱」。
//
// 上游：https://github.com/Ychris12138/dsh-usage-stats        ★188（2026-11-04 push，活跃）
//       npm: @ychris12138/dsh-usage-stats@0.3.7（锁版，不用 ^；见 ./upstream.js）
//       许可证：MIT ✅
//       依赖：**运行时零依赖、零 peer 依赖**；`dsh.client.inject` 仅两个官方 client 包
//       （`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-primitives`）
//
// 性质：**A 类（原生 DSH 插件包）· 强化式集成**。
//       上游自带 `dsh.bundle.patch`（`cordis.patch.yml`）与 `dsh.client.platform=web`，
//       是真正的 Web 插件，不是静态页。
//
// # 为什么本仓需要它（实测，不是推测）
//
//   本仓**计量在、账本不在**：
//     · `core-question-stream/src/usage-frame.js:1-29` 明写自己只做「形状转换」，
//       计价是「宿主已经做了这件事」—— 但它**没有把结果落给任何人**；
//     · `core-parser/src/llm.js:146` 把 `usage` 透传出来，只用于判「截断且空输出」，
//       用完即弃，**不进任何累计**；
//     · `page-plugins/src/usage.js` 里的 `usage` 指**工具使用次数**（`count/lastUsed`），
//       与 token 无关；
//     · 全仓 `aggregate|totalSpent|ledger.*token` 命中 6 处，**全部与 token 无关**；
//     · `core-llm-error/src/classify.js:47` 只认 `INSUFFICIENT_BALANCE` 错误码 ——
//       知道「没钱了」，**不知道「花了多少」**；
//     · 无任何价格表（`per_million|/1M|元/` 全仓 1 处假命中）。
//   ⇒ 三个计数器、四套口径、没有一本账。
//
// # 集成方式：锁版挂载 + 外围兼容层（效法 dsh-zhiyun-paper / dsh-zhiyun-page-paper）
//
//   上游 patch 用上游自己的 id（`usage-stats`）插入。本包**不直接用那份 patch**
//   （理由见 ./cordis.patch.yml）：本包用**自己的 id** `radar-usage-ledger` 插入，
//   由 `loadUpstream()` 在宿主侧 `import('@ychris12138/dsh-usage-stats')` 后调用上游
//   `apply(ctx)`。**上游源码一行不改。**
//
// # 集成判定：强化式集成的三条判据
//
//   ① 仍是同一个面板 —— 是。不新增页面、不新增导航项。它注册进**已有的设置页**
//      （`settings.section` 插槽，`page-paper/src/client.jsx:12-13` 原文：
//      「壳里的 `PersonalSettingsBridge` 会把所有 `settings.section` 注册按 order
//      摊成折叠分组，所以新插件零改壳」）。用户看到的仍是「设置 → 用量」这一处。
//      ⚠ 须评审确认：本仓是否愿意让「用量」成为设置页的一个分区，而不是新开一页（TODO 2）。
//   ② 功能仍相似正交 —— 是。本仓已有的是**逐次**的用量归一（`usage-frame.js`）
//      与**逐次**的透传（`parser/llm.js`）；上游提供的是**跨会话的累计与计价**。
//      同一件事（「花了多少」）的另一个粒度，不是另一件事。
//   ③ 底层多调了更优质实现 —— 是。上游从 `ctx.sessionQuery` 读会话日志里的
//      `assistant/message.usage`（含 `inputTokens/outputTokens/cacheReadTokens/
//      cacheWriteTokens`），支持**历史全量扫描 + 实时增量**，并用
//      `Map<sessionId:seq>` 幂等去重。本仓**没有任何**跨会话读取。
//
// # 边界（评审前请确认这五条）
//
//   1. **不新增数据源、不改任何页面的落盘格式。** 上游读的是**宿主已有的**会话日志，
//      本包不得额外落一份 token 账到自己的位置 —— 否则又多出第五套口径。
//   2. **不改写本仓已有的三个计量点。** 本包只**旁路读**，不改 `usage-frame.js` /
//      `parser/llm.js` / `page-plugins/usage.js` 的行为。收敛口径是评审项（README §下一步 a），
//      不是本骨架擅自做的事。
//   3. **失败必须降级为现状。** 上游加载失败 / 版本窗口不相交 / `sessionQuery` 缺席
//      → 退回现状（设置页没有「用量」分区，其余逐字不变）。**绝不**因为本包让设置页打不开。
//   4. **不做「余额不足就自动充值/切 provider」。** 上游有余额查询，但「余额低 → 做什么」
//      是产品决策；本包**只展示**，不联动任何请求路由。
//   5. **隐私：用量记录含 `apiKey` 字段（上游对掩码处理）。** 本包接入前须确认
//      导出的 HTML/CSV 中不出现完整 key；见 README §风险 R-2。
//
// # 本文件状态
//
// 只有签名与 TODO，**没有实现**。调用即什么都不做 —— 这是故意的，见 README 顶部声明。

import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'radar-usage-ledger';

/**
 * 上游 `apply(ctx)` 需要的宿主服务。
 *
 * 上游 patch 注释里的关键一句：`ctx.inject(['sessionQuery'], ...)` ——
 * 服务已就绪则立即执行，否则挂起等待。因此本包的 `inject` **只声明一项**：
 *   - `settings` —— 上游把面板挂在设置分区，需要 settings 的贡献点；
 *
 * `sessionQuery` **不写进本包的 inject**：它是上游自己的软依赖，由上游内部
 * `ctx.inject` 处理。本包若也声明它，就会把「用量面板」变成「没有 sessionQuery
 * 就整个插件加载失败」——与边界 3 冲突。
 */
export const inject = ['settings'];

/**
 * 挂载上游。**未接入 profile，不会被调用。**
 *
 * 评审通过后的接入形状（占位，不实现）：
 *   const upstream = await loadUpstream();
 *   if (upstream.ok) ctx.plugin(upstream.mod.default ?? upstream.mod);
 *   else ctx.logger?.warn?.('[radar-usage-ledger] upstream unavailable: %s', upstream.error);
 */
export function apply(ctx) {
  // 与 `dsh-radar-llm-fallback` / `dsh-radar-plugin-graph` 同规：
  // 评审期间本包不得对宿主产生任何副作用 —— 不 import 上游、不注册分区、不读会话日志。
  ctx.logger?.info?.(
    '[radar-usage-ledger] candidate skeleton loaded (no-op) · upstream %s@%s',
    UPSTREAM_PACKAGE,
    UPSTREAM_VERSION,
  );
}

// ── TODO（评审必须逐条回答，回答后才可以写第一行实现）────────────────────────────
//
// 1. **先做减法，再接账本 —— 本骨架最重要的前置项。**
//    本仓的三个计量口径（`usage-frame.js` 的 chars/3.5 粗估、
//    `parser/llm.js` 的 `usage` 对象、`page-plugins/usage.js` 的 `{count,lastUsed}`）
//    必须先收敛到**一个** `recordUsage()` 出口。收不掉就不要接账本：
//    账本会跟着三个口径一起漂，最后出现「账本说 40 万，页面说 38 万」这种不可辩论的错误。
//    **评审结论若是「暂不收敛」，则本骨架应当直接 `rejected`，而不是「先装上看看」。**
//
// 2. **「用量」放哪一页？**
//    (a) 设置页新增一个 `settings.section` 分区（**零改壳**，与「账号与数据」并列）；
//    (b) 「今天」页的一张卡片（更常用，但需要与本仓 `planning` 的数据模型对齐）；
//    (c) 保持上游原样（侧栏独立入口）。
//    本骨架**倾向 (a)**：`settings.section` 已被 `page-paper` 验证过零改壳；
//    (c) 违反边界①（新增导航项）。**评审须二选一并写进 README。**
//
// 3. **计价口径要不要跟上游 / 要不要分时价。**
//    本骨架锁的 `dsh-usage-stats@0.3.7` 计价**简于** `wycto/dsh-dock@0.21.0`
//    的 tokenlog（后者支持多段分时价 + 工作日/节假日谷价 + 四级单价优先级 + USD→CNY）。
//    评审须回答：学生账单上「峰谷半价」是否必须体现？
//    · 若**必须** → 改锁 `dsh-dock@0.21.0` 的 `features/tokenlog`（但那是单仓 14 功能，
//      为记账锁进游戏/桌宠/TTS 属过度绑定，须写进 README 的取舍段）；
//    · 若**不必** → 维持本骨架，并在 README 明写「本包不计分时价」。
//
// 4. **多设备同步要不要（`dsh-workload-report@2.4.0` 有 COS/GitHub/Gitea）。**
//    这是 §2.1 里 `tableau-China/dsh-workload-report` 唯一**不是「再加一个仪表盘」**
//    的形态。但学生场景下「多设备」= 宿舍台式 + 笔记本 + 手机，
//    接一个云存储 = 接一份凭证 = 一份新的泄露面。**本骨架默认不做**；
//    评审若要，须单独立项（不在本包范围内）。
//
// 5. **版本窗口。** 上游 `0.3.7` 与宿主 `@deepseek-ai/dsh-*` 的 peer 交集
//    须在评审时按 `runtime.lock.json` 的 `hostVersions` 逐项核（见 `upstream.js`）。
//    **不相交 → 拒绝启用**，不得降级为「先装上试试」。
//
// 6. 不搬运上游源码；完成后按 CONTRIBUTING 流程补测试、接入 profile、写 OWNERS
//    （本骨架已写 `Owner: shared`）。
