/**
 * dsh-radar-clash-guard —— **候选骨架的占位入口**。
 *
 * ⚠ 本文件**不写业务逻辑**，只标注适配点与 TODO；`apply()` 被调用即抛错，
 *   以免评审者误把本包挂进 profile 后在启动期静默加载。
 *   待人工评审通过后，再逐条落实 TODO；评审驳回则整目录删除。
 *
 * ── 它是什么 ──────────────────────────────────────────────────────────
 *
 * 回答一个问题：**「这两门课在同一周里撞不撞？」**
 *
 * 本仓已经有这节课的「星期几 / 起止节次 / 单双周 / 起止时刻」——
 * `packages/dsh-zhiyun-source-zdbk/src/parse.js` 的 `parseSession()` 一次给出
 * `weekday`（1–7）、`periods`（`[3,4]`）、`weeks`（`'all'|'odd'|'even'`）、
 * `time`（`'10:00-11:35'`，由 `PERIOD_TIMES` 首末节拼出）。
 * 但**没有任何一处**把它们两两比对。全仓 `conflict` 的真实调用只出现在白板版式
 * （`core-classroom-agent/src/summarizers/whiteboard-conflicts.js`：
 * 元素重叠 / 线穿元素 / 出血），与课表无关。
 *
 * ── 为什么这是「强化式集成」而不是「新功能」──────────────────────────
 *
 * 三条必须**同时**成立：
 *
 *   1. **仍是同一个面板** —— 不新增导航项、不新增插槽、不新增路由。
 *      落点是「规划」页已有的课表格子（`page-planning/src/schedule-view.jsx`
 *      左上角那个红点），用户看到的仍是同一张课表。
 *   2. **功能仍相似正交** —— 仍是「这周有什么课」，只是同一张格子多一个
 *      「这里的课撞了」的标记。不改排课、不改导出、不改提醒。
 *   3. **底层多调了更优质实现** —— ⚠ **这一条只「部分成立」，必须如实标注**。
 *      上游 `detectPlanConflicts()` 提供的**只有**「区间求交」这一条判据
 *      （`aStart < bEnd && bStart < aEnd`，逐字对照 `timeUtils.ts:98`）。
 *      这条判据本身是**本仓三行就能写完**的，**不是「更优质实现」**。
 *      上游真正值钱的是它踩过的**边界情形清单**（见下「上游不可照抄的三处」），
 *      以及一套 5000 次评估上限的**组合搜索**（`planGenerator.ts`，1079 行）——
 *      但本仓是「用户已经选完课，回头看撞没撞」，**不做选课求解**
 *      （选课求解需要「同一门课的其他教师/时段」候选池，正方接口不提供）。
 *      因此本包**只用上游的判据清单与失败形态，不搬求解器**。
 *
 * ── 上游不可照抄的三处（均已实测，详见 ATTRIBUTION.md）──────────────
 *
 *   - `detectPlanConflicts()` 对每一「课程对 × 天」**只记一条**（`break`，
 *     `timeUtils.ts:158`）→ 一门课一周排两次、与另一门也排两次的课全撞时，
 *     4 个重叠只报 1 个。本仓必须按「重叠区间」逐条记。
 *   - `Conflict` 结构**没有周字段**（`types/schedule.ts:33-42`）→ 单双周课
 *     会被判成「每学期都撞」。本仓 `weeks` 有 `odd/even/all`，必须先把
 *     两门课展开成「周集合」，无交集即不撞。
 *   - 时间入参是**字符串**，靠 `timeToMinutes()` 现转（`timeUtils.ts:6-49`）；
 *     本仓真正要判的是**节次**（`djj` + `skcd`），不是「首末节拼出的时刻」。
 *     用时刻判会把「第 1–2 节 vs 第 2–3 节」判成撞（正确），但把
 *     「第 13 节起 2 节」（`PERIOD_TIMES[14]` 不存在 → `time: null`）直接判成
 *     **不撞**（静默漏报）。节次判据无此问题。
 *
 * 待人工评审。**未评审前不得接入 profile、不得 import。**
 */

/** 本包标识，宿主日志用。 */
export const name = 'dsh-radar-clash-guard';

/** 骨架版本号：仅表示「这是第几版占位」，不是发布版本。 */
export const VERSION = '0.0.0';

/**
 * 骨架入口。**被调用即抛错**（防止未评审的包被静默加载）。
 *
 * @param {unknown} _ctx - 宿主服务上下文（评审通过后才会用到）。
 * @returns {never}
 */
export function apply(_ctx) {
  throw new Error(
    '[dsh-radar-clash-guard] 候选骨架未评审，不可挂载。'
      + '评审通过后请实现 src/index.js 的 TODO 并删除本抛错。',
  );
}

/**
 * 评审通过后的对外形状（**现在是占位，调用即抛错**）。
 *
 * 只暴露两个纯函数，均**零依赖、无 I/O、可单独测**（评审者可在 Node 里直接 import）。
 *
 * @typedef {object} Session  本仓 `parseSession()` 的返回形状（子集）
 * @property {number} weekday  星期几，1=周一 … 7=周日
 * @property {number[]} periods 起止节次覆盖的节次列表，如 `[3,4]`
 * @property {'all'|'odd'|'even'} weeks 单双周
 * @property {string|null} terms 所跨学期，如 `'秋冬'`
 * @property {string} name 课程名（用于文案）
 * @property {string|null} teacher
 * @property {string|null} location
 */

/**
 * @typedef {object} Clash
 * @property {string} weekdayName 周一 … 周日
 * @property {number[]} sharedPeriods 两门课共同占用的节次（升序，去重）
 * @property {string[]} sharedWeeks `['all']` / `['odd']` / `['even']` / `['odd','even']`（奇偶周都撞）
 * @property {Session} left
 * @property {Session} right
 */

/**
 * 找出**同一学期、同一周**里共用节次的两两组合。
 *
 * TODO-A（核心）：判据改为**节次集合求交**，不是时刻区间求交。
 *   - `left.periods ∩ right.periods` 非空即冲突；`sharedPeriods` 直接可给文案
 *     （「周一第 3–4 节」）。这同时修掉「第 13 节起越界 → time=null → 静默不撞」。
 *   - **必须逐条记**，不能像上游那样 `break`：一门课一周排两次是常态。
 *   - 同一门课（`name` + `teacher` 相同）自己的多段**不算冲突**
 *     （本仓一次课记成一条 `periods`，不会出现「1-2 节」与「3-4 节」两条同课）；
 *     但若上游拆分后出现，须按同课处理。
 *
 * @param {Session[]} sessions - 同一学期的课表条目。
 * @returns {Clash[]} 空数组表示无冲突。
 */
export function findClashes(sessions) {
  void sessions;
  throw new Error('[dsh-radar-clash-guard] TODO-A 未实现：findClashes() 为骨架占位。');
}

/**
 * 先按「周集合」过滤，再做节次求交。
 *
 * TODO-B（上游缺的那一格）：本仓 `weeks ∈ {'all','odd','even'}`。
 *   - `odd` × `even` → **不撞**（这是本仓最常见的「假冲突」来源：
 *     两门课都排在周四第 11–12 节、正好一单一双，教务上完全合法）。
 *   - `all` × `odd` → 撞在单周。
 *   - `odd` × `odd` → 撞在单周。
 *   - ⚠ **`terms` 也必须比**：本仓一条课就带 `terms: '秋冬'`，
 *     秋季课与春季课若都排同一节，**不在同一周**、不撞。
 *     上游 `Conflict` 无此字段 → 照抄必然误报。
 *
 * @param {Session} left
 * @param {Session} right
 * @returns {boolean}
 */
export function weeksOverlap(left, right) {
  void left;
  void right;
  throw new Error('[dsh-radar-clash-guard] TODO-B 未实现：weeksOverlap() 为骨架占位。');
}

/**
 * 把一组 `Clash` 折成「每个格子要不要变红」。
 *
 * TODO-C（渲染侧，落点 `page-planning/src/schedule-view.jsx`）：
 *   - 返回 `Map<'<weekday>-<period>', Clash[]>`，格子只需 `map.has(key)`。
 *   - **不要**在本包里做任何 DOM / CSS；样式由页面既有类名承担。
 *   - 课表读不到（`readScheduleWindow` 的 `meta.complete !== true`）时必须返回空 Map
 *     —— 页面既有约定是「读不到就一个字都不提」，冲突标记同理。
 *
 * 已知未决项（评审者先答，再落代码）：
 *   1. 冲突标记是**常显**还是只在 hover/点击时出现？常显会让课表格子变成「红格子墙」，
 *      但本仓课表本来就不提供改课动作 ⇒ 用户看到了也**无法处理**。
 *      这是本包**最大的产品风险**，见 README「评审前必须回答」。
 *   2. 是否报告「同一门课跨校区连堂课」？（如 紫金港东 1-101 → 西 2-205 间隔 10 分钟）
 *      `PERIOD_TIMES` 里第 2→3 节有 25 分钟、第 5→6 节有 60 分钟，其余只有 5 分钟。
 *      这是**通勤冲突**，不是时间冲突，本包默认**不做**（需另一条判据与另一套数据）。
 *
 * @param {Clash[]} clashes
 * @returns {Map<string, Clash[]>}
 */
export function toCellIndex(clashes) {
  void clashes;
  throw new Error('[dsh-radar-clash-guard] TODO-C 未实现：toCellIndex() 为骨架占位。');
}
