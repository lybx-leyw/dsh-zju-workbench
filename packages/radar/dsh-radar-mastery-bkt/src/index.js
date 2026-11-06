/**
 * dsh-radar-mastery-bkt —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * `apply()` 挂上一行日志就退出；`adapt()` 直接抛错。评审通过后再逐条落实 TODO，
 * 评审驳回则整个目录删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 把上游 `MasteryTrace`（npm `masterytrace-cli@0.1.3`，MIT）的 **BKT**（Bayesian
 * Knowledge Tracing）接到本仓「学习」页出题区**已有的知识点**上，把现在的
 * **二值规则**（「近 3 次都错 / 近 3 次都对 / 有对有错」，见 `dsh-zhiyun-quiz/src/store.js:288`
 * 的 `makePointMastery`）**增强**为**连续的后验掌握概率**：
 *
 *   // 现在（store.js:288 的 makePointMastery）
 *   masteryLabel → '近 3 次都错（共做过 3 题，错 3 题）'        // 定性、无趋势、无跨题聚合
 *   // 接入后（同一批作答交给 BKT）
 *   posteriorHistory → 0.077 → 0.064 → 0.062                  // 连续量，能排序、能画趋势
 *
 * 输出的不是新页面，而是一次**附加**的估计：
 *
 *   estimate({ attempts, pointIdsOf, accountId }) → {
 *     points: [{ pointId, posterior, observed, skipped }],
 *     model: 'bkt',
 *     params: { pInit, pTransit, pSlip, pGuess },
 *     unattributed: number,        // 拿不到 pointId 的作答条数 —— **必须回传，不许吞**
 *   }
 *
 * ── 为什么是「强化式集成」而不是简单集成（B 类，三条同时成立）──────
 *
 *   1. **仍是同一个面板** —— 不新增导航项、不加插槽。消费者是「学习」页出题区
 *      （`packages/dsh-zhiyun-page-study/src/quiz-panel.jsx`）里**已有的**知识点区，
 *      只是每个知识点多一个概率；「今天」页的复习列表（`dsh-zhiyun-page-today`）仍按原样工作。
 *   2. **功能仍相似正交** —— 现有能力回答「**这次**对不对」（可解释规则，人能核对）；
 *      新增能力回答「**这个点**现在大概掌握了多少」（概率模型，跨题聚合）。
 *      同域不同问题：规则可解释、模型可排序，两者不互相替代。
 *   3. **底层多调了更优质实现** —— 本仓**完全没有**任何概率模型（`grep -rn "FSRS\|IRT\|BKT"
 *      packages/dsh-zhiyun-quiz/src` 只有注释里的「FSRS 隔离」说明，没有实现）；
 *      上游给的是四参数 BKT + 网格拟合，且**不是本仓自己实现**（不重复造轮子）。
 *
 * ── TODO-0（阻塞项，必须先解决，否则本包接进来也是空转）──────────
 *
 *   [!] **`pointIds` 到不了题上。** 三条独立证据：
 *
 *       · `packages/dsh-zhiyun-quiz/src/model.js:381` `makeItem({...})` 的参数表里**没有** `pointIds`
 *         → 实测 `Object.hasOwn(makeItem({...pointIds:['kp-1']}), 'pointIds') === false`；
 *       · `itemToJson()`（`model.js:517`）也不序列化 `pointIds` → 落盘后更不可能有；
 *       · `packages/dsh-zhiyun-study-core/src/workbench.js:390` `quizMaterials()` 构造材料时
 *         只填 `blockIndex/page/atSec/summary/facets/text/selection`，**没填 `pointIds`**。
 *
 *       后果：`pointIdsOf(q)` 在真实数据上恒返回 `[]` → BKT 的 `skillId` 只能是空串。
 *       修法是 **~5 行、零依赖**（`makeItem` 加字段 + `itemToJson` 序列化 + `quizMaterials` 填值），
 *       属于业务代码改动，**不在本骨架的授权范围内**（生态雷达不改业务代码）。
 *       → **评审需先裁决：先补环，再接 BKT。** 若先接 BKT，本包只能退化为按 `blockIndex` 估计。
 *
 * ── 其余 TODO（评审通过后再动）────────────────────────────────────
 *
 *   [ ] **一次性作答拆成多事件。** 上游 `ResponseEventSchema` 是
 *       `{ learnerId, skillId, correct, timestamp }`（一条事件 = 一个技能），
 *       而本仓 `attributeByPoint` 明确支持「一道题挂多个知识点，每个单独计数」。
 *       一题多点时必须拆成 N 条事件 —— 但拆完 `responseCount` 会大于真实作答次数，
 *       **必须在 UI 上说清**（否则就是「假装准确」）。
 *   [ ] **`correct` 的取法只能是 `!attempt.countsAsWrong`。**
 *       不许把 `autoVerdict === correct` 直接当 `correct`：`store.js:42` 的 FSRS 隔离原则
 *       同样适用于 BKT（「AI 说对了」不等于「我记得」）。
 *   [ ] **参数从哪来。** 默认值是教科书值（`pInit .4 / pTransit .3 / pSlip .1 / pGuess .2`），
 *       **不是**为本仓数据拟合的。`fit: true` 会做网格搜索（默认同步、纯 JS），
 *       题库大时必须挪到 Worker（`dsh-zhiyun-page-study/src/hls.js` 已有 Worker 先例）。
 *   [ ] **数据量下限。** 每题 1–3 次作答时，BKT 后验主要由先验决定（实测 3 次全错 →
 *       0.062 几乎等于 0.4×0.9×… 的连乘），**不能**在 `responseCount < 3` 时展示概率，
 *       应继续显示现在的「数据不足」文案（与 `makePointMastery` 的阈值一致）。
 *   [ ] **落盘**：本包**不写文件**。估计所需的事件流由 `dsh-zhiyun-study-core` 的
 *       `openQuizStore(stored)` 读出来传进来（它已经 `loadAttempts`，见 `workbench.js:375-380`）。
 *   [ ] **体积**：`zod` 未压缩约 8.1 MB。若最终只用到 `BktModel`，考虑只锁 `masterytrace-cli`
 *       并让 bundler 做 tree-shaking；若不行，需评审决定是否值得为一次估计引入这个体积。
 *
 * ── 已知风险（写在这里而不是藏起来）──────────────────────────────
 *
 *   R-1 ★0 单点维护（建仓 2026-07-15，唯一维护者）。上游哪天停更，本包**没有**备用实现。
 *   R-2 依赖 `zod@^4.6.5` 只为校验事件；本仓已有自己的形状校验习惯，存在「两套校验」风险。
 *   R-3 「掌握概率」是**概率**，不是「掌握度 87%」这种分数。本仓 `store.js:290` 明确
 *       「不报掌握度百分比」——接入后**只能**说「后验 0.06（基于 3 次作答）」，措辞需评审定。
 *   R-4 上游是 TS 源（`dist/` 已编译），`type: module`，与本仓 ESM 一致；但它的 `exports`
 *       字段为 `null`，子路径 `./dist/models/bkt.js` 属于**非公开入口**，随时可能变。
 *   R-5 本包**不修改**上游任何文件，也不把上游源码复制进本仓。
 */

export const name = 'radar-mastery-bkt';

/** 只是占位：真正接入时，它要依赖出题服务的题库句柄。 */
export const inject = [];

/**
 * 占位。评审通过前**刻意不做任何事**，只留一行日志。
 */
export async function apply(ctx) {
  ctx?.logger?.info?.(
    'radar-mastery-bkt: 候选骨架已加载（未实现，见 README 与 TODO-0；不要接入 profile）',
  );
}

/**
 * 把本仓的作答记录映射成上游的 `ResponseEvent[]`。
 *
 * **未实现** —— 直接抛错，避免有人误以为它能用。
 *
 * @param {object} _input
 * @param {Array<object>} _input.attempts  `store.snapshot().attempts` 的条目
 * @param {(item: object) => string[]} _input.pointIdsOf
 * @param {string} _input.accountId
 * @throws {Error} 永远抛 `NOT_IMPLEMENTED`
 */
export function adapt(_input) {
  throw new Error(
    'NOT_IMPLEMENTED: dsh-radar-mastery-bkt 只是候选骨架。'
    + '先解决 README 里的 TODO-0（pointIds 到不了题上），再实现本函数。',
  );
}
