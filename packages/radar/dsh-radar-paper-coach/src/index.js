/**
 * dsh-radar-paper-coach —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**：只标注适配点与 TODO，不写业务逻辑。`apply()` 直接抛错 ——
 * 目的与 `dsh-radar-paper-evidence` / `dsh-radar-orb` 相同：万一有人误挂，
 * **立刻响**，而不是静默转成一个什么都不做的包。
 *
 * ═══ 这个包想做什么（强化式集成，不是新建功能）═══════════════════════
 *
 * 「论文阅读」页（`dsh-zhiyun-page-paper`）右侧抽屉现在只有一种问法：**你问，它答**
 * （`AssistantDrawer.jsx` → `/api/ask` → SSE 流式气泡）。它回答得很快、很完整 ——
 * 快和完整恰恰是这个场景的副作用：**用户跳过原文**。
 *
 *   学生看论文的现实流程：划一句 → 问「这句什么意思」→ 拿到一段解释 → 划下一句
 *   → 最后「读完」了，但复述不出论文要解决什么问题。
 *
 * 上游 `@ggboy123/dsh-paper-reader` 在 **1.6.x 起**自带一套「论文伴读」教练闸
 * （`cordis.patch.yml` 里随 bundle 声明的 `preset-paper-reader`），规则是：
 *
 *   - 先由 `study_progress` 读学习档案，没有就设计 3~6 步计划；
 *   - 第 1 步固定是**独立通读**，配 2~4 道校验题，答不出不往下走；
 *   - 答得含糊 → **先送回原文重读**（带 `&q=` 高亮原句），再答同一题；
 *   - 只有答对才 `complete_step`；最后 `record_quiz` 记分。
 *
 * 也就是说：「同一篇论文、同一支问答、同一个页面」上多出的只是**一道闸**。
 * 这正是 skill 要求的强化式集成三条：
 *
 *   ① **仍是同一个面板** —— 本包不注册页面、不注册 slot；教练闸落在
 *      `AssistantDrawer.jsx` 已有的抽屉里，与「问一问」共用同一个输入框与同一条 SSE。
 *   ② **功能仍相似正交** —— 「问」与「考」是同一域（读懂这篇论文）的两个不同问题：
 *      前者要答案，后者要理解。两者不重叠：Quick Q&A 明确**不推进**学习计划。
 *   ③ **底层多调了更优质实现** —— 见下节「底层多调了什么」。
 *
 * ═══ 底层多调了什么（判据③核对，如实标注）═════════════════════════
 *
 * ✅ 真实新增：`study_progress` / `study_update` 两个工具 + 每篇论文一份
 *    `<论文>.study.json` 档案（计划 / 完成步 / 测验历史 / 薄弱点）。本仓
 *    `packages/dsh-zhiyun-*/src` 全量 grep 无「学习档案」「逐段门禁」类实现。
 * ✅ 真实新增：回答里的页码链接带 `&q=` 原句高亮参数，点击后在阅读器里**选中原句**
 *    而不是只落到页首。
 *
 * ⚠ **打折扣的一条（评审必须先看）**：`preset-paper-reader` 是**会话级 preset**，
 *    上游把它做成「选这个 preset 开一段对话」，而**不是**「论文页抽屉内的开关」。
 *    本包要做的正是把这层 preset **反显进抽屉** —— 这属于**外围兼容层**的活，
 *    不是上游现成能力。所以判据③只能说「底层多了更优质实现（教练闸 + 档案）**且**
 *    多了一层本仓自己的适配」，不能说「照抄即可」。
 *
 * ═══ 版本上的硬约束：为什么锁 1.3.1 ═════════════════════════════════
 *
 * `preset-paper-reader` 出现在 **1.6.x**；本仓 `packages/dsh-zhiyun-host-paper`
 * 锁的是 **1.3.1**。二者不同版本 —— 锁版冲突是**本候选最大的落地阻塞**，比代码多。
 * 见 `src/upstream.js` 的 `LOCK_CONFLICT` 与 README「前置条件」。
 *
 * ═══ TODO（评审通过后按序做，不要在评审前实现）═════════════════════
 *
 *   1. 先解决 `src/upstream.js` 的 `LOCK_CONFLICT`：要么 host-paper 升到 1.6.x
 *      （会连带换掉整个论文页阅读器，**不是本骨架能决定的**），要么只借
 *      `study_*` 工具的契约、自己实现档案与闸门（那就退化成本仓自研，判据③降级）。
 *   2. 抽屉加「伴读模式」开关：打开后同一输入框走教练闸，关闭即回到现在的问法。
 *   3. 「伴读模式」打开时，`/api/ask` 的系统提示换成上游 `preset-paper-reader` 的
 *      `persona.prefix` 口径（**引用，不抄写**——以 `peerDependencies` 锁版的包为准）。
 *   4. 档案落盘位置与 `dsh-zhiyun-host-paper` 的 `dataDir`（`data/zhiyun-paper`）
 *      对齐，不要另起一个目录。
 *   5. 主题注入沿用 `dsh-zhiyun-page-paper` 的 `mountStyle` 口径，**不改上游源码**。
 *
 * @type {import('@deepseek-ai/cordis').Plugin}
 */
export const name = 'dsh-radar-paper-coach';

export function apply() {
  throw new Error(
    'dsh-radar-paper-coach 是候选骨架（未评审、未接入 profile、不可直接使用）。'
    + '评审通过前请不要在任何 profile 里挂载它。',
  );
}
