/**
 * dsh-radar-clash-guard / upstream —— **上游行为规格的占位封装**。
 *
 * ⚠ 三个函数**全部抛错**，只在评审时当「合同文档」读：
 *   它们描述的是**本包将从上游借用什么行为**，而不是上游代码本身。
 *
 * ── 为什么这里没有 `dependencies` ─────────────────────────────────────
 *
 * B 类候选的常规做法是「锁版引入上游 npm 包」。**本包做不到，也不需要**：
 *
 *   - `Sira-pel/Course_Planner` 的 `package.json` 是 `"private": true` 的应用工程，
 *     **npm 上不存在**（实测 `courseflow` 与 `@sira-pel/course-planner` 均 HTTP 404）；
 *   - 上游 `src/utils/timeUtils.ts` 与 `src/types/schedule.ts` 直接 `import` 了
 *     `../types/schedule` 与 `../../types/schedule`，`ACADEMIC` 配色、`DAYS_LIST`、
 *     `LayoutSession` 等**全部是它的 UI 类型**，抽不出独立的库。
 *
 * 因此本包的定位是 **B 类源码级借鉴**（与 `dsh-radar-week-parser`、
 * `dsh-radar-timetable-calendar` 同一档）：只读它的**判据清单与失败形态**，
 * 代码由本仓自写。**不复制任何源码**。
 *
 * ── 上游三处实测缺陷（本轮跑出来的，不是推断）────────────────────────
 *
 * 实测方法：把上游 `timeToMinutes()` / `checkSessionCollision()` /
 * `detectPlanConflicts()` 的算法**逐行移植成 Python**（同一逻辑，便于在本机跑本仓真实
 * `PERIOD_TIMES` 数据），输入为本仓 `source-zdbk/src/parse.js` 的
 * `PERIOD_TIMES`（紫金港作息）与 `parseSession()` 的输出形状。
 *
 *   **D-1 · 每「课程对 × 天」只记一条冲突（漏报）**
 *     上游 `timeUtils.ts:145-160`：内层命中即 `break`，外层再 `break`。
 *     实测：课 A 周一/周三第 3–4 节，课 B 同样周一/周三第 3–4 节
 *     → **期望 2 条（周一 + 周三），实得 1 条**。
 *     本仓「一门课一周两次」极常见（实验课、英语），照抄即系统性少报一半。
 *
 *   **D-2 · `Conflict` 结构无周字段（误报）**
 *     `types/schedule.ts:33-42` 的 `Conflict` 只有
 *     `day / overlapStart / overlapEnd`，没有 parity、没有学期。
 *     本仓 `weeks ∈ {'all','odd','even'}`、`terms ∈ {'秋冬','春夏',…}`：
 *     一单一双排同一节、或秋季课与春季课排同一节，都在教务上合法，
 *     但上游判据**只会看到「同一天、时间重叠」⇒ 一律判冲突**。
 *
 *   **D-3 · 时间是字符串，越界静默**
 *     `timeToMinutes(undefined)` → `return 0`（`timeUtils.ts:13`）。
 *     本仓 `parseSession()` 用 `PERIOD_TIMES[periods[0]]` 与
 *     `PERIOD_TIMES[periods[last]]` 拼 `time`，**第 13 节再往后排一次课**
 *     （`PERIOD_TIMES[14]` 不存在）会把 `time` 置 `null`；
 *     若把 `null` 一路喂进上游判据，它不报错、直接算「不撞」。
 *     本仓应以**节次集合**为判据，从根上没有这一格。
 *
 * ── 上游**确实值得借**的部分（本包保留、照它的形状写 TODO）─────────
 *
 *   - 判据本身极简且**边界取向正确**：`aStart < bEnd && bStart < aEnd`
 *     （左闭右开），即「第 1–2 节 08:00–09:35」与「第 3 节 10:00–10:45」
 *     **不撞**，而「第 1–2 节」与「第 2–3 节」**撞**（第 2 节共用）。
 *     本轮已用本仓 `PERIOD_TIMES` 逐格验证：连续节次全部正确判「不撞」，
 *     真正重叠（共用第 2 节）正确判「撞」。
 *   - `timeToMinutes()` 的**输入宽容度**（`'09:00'` / `'9:00'` / `'0900'` /
 *     `'2:30 PM'` / `'1430'`，越界 clamp 到 `[0,1439]`）—— 本仓暂时用不上
 *     （只用节次），但**若哪天接别的学校课表**（有的是时刻制）这是现成的口径。
 *   - `detectPlanConflicts()` 的**内部冲突检查**（同一门课的多个 session 互相撞）
 *     —— 本仓用 `periods` 数组一条记完，结构上不需要；保留此结论备查。
 *
 * **不借**：`planGenerator.ts`（1079 行组合搜索 / 5000 次评估上限 / 偏好打分）——
 * 它是「从候选池里**选**一套不撞的课」，本仓是「用户已选完，回头**看**撞没撞」，
 * 且正方接口不给同一门课的候选时段池 ⇒ 求解器无输入。
 */

/** 上游三处缺陷的机器可读标记，供评审与后续回归用。 */
export const UPSTREAM_DEFECTS = Object.freeze({
  /** D-1：每「课程对 × 天」只记一条（`timeUtils.ts:145-160` 的双 `break`）。 */
  ONE_RECORD_PER_PAIR_PER_DAY: 'D-1',
  /** D-2：`Conflict` 无周次 / 学期字段（`types/schedule.ts:33-42`）。 */
  NO_PARITY_OR_TERM: 'D-2',
  /** D-3：`timeToMinutes()` 对非法入参返回 0，静默（`timeUtils.ts:13`）。 */
  INVALID_TIME_SILENT_ZERO: 'D-3',
});

/**
 * 节次 → 时刻（**上游 `timeToMinutes()` 的行为规格，本仓可能不需要**）。
 *
 * TODO-D（可选）：仅当本仓要接「时刻制课表」（非 `djj/skcd` 制）时实现。
 *   须保留上游的宽容度与 clamp，但**必须改为「无法解析即抛错」**，
 *   不接受 `return 0`（D-3：`undefined` → `0` 会被判成「午夜 00:00」）。
 *
 * @param {string} timeStr - 形如 `'09:00'` / `'0900'` / `'2:30 PM'`。
 * @returns {number} 自 00:00 起的分钟数，`[0,1440)`。
 */
export function minutesOfTime(timeStr) {
  void timeStr;
  throw new Error('[dsh-radar-clash-guard] TODO-D 未实现：minutesOfTime() 为骨架占位（上游 D-3 需修正，不得照抄）。');
}

/**
 * 两段时刻是否重叠（**上游 `checkSessionCollision()` 的行为规格**）。
 *
 * TODO-E（可选，与 TODO-D 同档）：左闭右开，`aStart < bEnd && bStart < aEnd`。
 *   本仓主判据是**节次集合**（TODO-A），此函数只在接时刻制数据时用。
 *
 * @param {string} aStart @param {string} aEnd @param {string} bStart @param {string} bEnd
 * @returns {boolean}
 */
export function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  void aStart; void aEnd; void bStart; void bEnd;
  throw new Error('[dsh-radar-clash-guard] TODO-E 未实现：timeRangesOverlap() 为骨架占位。');
}
