/**
 * dsh-radar-attendance —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**纯函数库占位**：只标注口径与 TODO，不写业务逻辑、不 import 任何东西。
 * 本包**没有** `cordis.patch.yml`、`package.json` 里**也没有** `dsh.bundle.patch` ——
 * 它不是插件形态，设计上就是给别的包当函数库用（同 `dsh-radar-week-parser` / `dsh-radar-ics-rrule`）。
 *
 * ═══ 这个包想做什么（强化式集成，不是新建功能）════════════════════════
 *
 * 今天页（`dsh-zhiyun-page-today`）已经有 `agenda.js`，把课表折成
 * `current / upcoming / finished` 三段；课表来自 `dsh-zhiyun-source-zdbk` 的
 * `/kbcx/xskbcx_cxXsKb.html`。也就是说「下一节是什么、几点开始」**已经有了**。
 *
 * 缺的是紧接着的那句话：**「这一节我能不能不去」**。
 *
 *   | 问法 | 现有实现 | 缺什么 |
 *   | --- | --- | --- |
 *   | 今天还有几节 | `agenda.js` → `projectAgenda()` | — |
 *   | 下一节几点开始 | `upcoming[0].startMs` | — |
 *   | 这门课我还能缺几次 | **无** | ← 本包 |
 *   | 已经迟到两次，算不算缺勤 | **无** | ← 本包 |
 *   | 请假的那次要不要算进分母 | **无** | ← 本包 |
 *
 * ═══ 本仓现状（2026-10-31 实测，grep 结论）═══════════════════════════
 *
 *   - `grep -rniE "出勤|考勤|签到|attendance|打卡|缺勤|旷课" packages/dsh-zhiyun-.* /src`
 *     → 排除「点名」这类无关命中的注释后，**业务命中 0**。
 *     `dsh-zhiyun-source-xxt` 的 9 个方法全是查询，「签到」被明确写成**不提供**
 *     （见该包 `src/index.js` 的「只读边界」一节）。→ 本包**不做签到**，只做口径计算。
 *   - `zdbk` 的 `ZDBK_PATHS` 只有 `grades / majorGrades / exams / timetable` 四条，
 *     **没有出勤类接口**；本仓也没有任何「出勤数据从哪来」的通道。→ **TODO-0 是本包的硬闸门。**
 *   - `agenda.js` 的节次对象只有 `startMs / endMs / courseTitle / day`，**没有 courseId**；
 *     要按课程聚合出勤，必须先补一个稳定课程键（见 TODO-2）。
 *
 * ═══ 三条判据核对 ═══════════════════════════════════════════════════
 *
 *   ① 仍是同一个面板 —— 不注册新页面、不注册 slot。唯一落点是今天页「下一节」卡片上
 *      追加**一行**文案（形如「还能缺 2 次 · 下一次缺课降到 74.4%」）。
 *
 *   ② 功能仍相似正交 —— 正交在**数据维度**：现有页面只有「时间」（什么时候上），
 *      本包补的是「余量」（还能缺几次）。不是把课表再画一遍。
 *
 *   ③ 底层多调了更优质实现 —— **部分成立，见 README「判据③打了折」。**
 *      候选源 `khalidhasan11/campuskit`（MIT）把「迟到计入出勤、请假剔出分母、
 *      `Excused` 不进入百分比基数」这套口径写死在数据模型里，比本仓「只有时间轴」更完整；
 *      但它的数值实现本身有缺陷（实测：`safeMisses` 返回**小数**）。
 *      → 只借**口径**，数值一律用整数重算，**不摘它的代码**（ATTRIBUTION 只记字段名与公式）。
 *
 * ═══ 一定不要做的事 ══════════════════════════════════════════════════
 *
 *   - **不要**根据出勤率自动替用户签到 / 代点名（触碰学业诚信红线，且 xxt 包已明确不做）。
 *   - **不要**把「还能缺几次」写成承诺。阈值是教务口径，可能中途变（见 TODO-3）。
 *   - **不要**在没有真实出勤数据（TODO-0 未过）时写任何计算实现 —— 会变成一套没人喂的函数。
 */

export const name = 'dsh-radar-attendance';

/**
 * 出勤口径（**借自 campuskit 的数据模型，不是它的代码**）。
 *
 * 本仓将来若要落地，这套字段名必须原样复用 —— 否则「迟到算不算」会在两个地方
 * 给出两个答案，而这个答案直接决定用户要不要去上课。
 */
export const ATTENDANCE_STATUS = Object.freeze({
  PRESENT: 'present',
  /** 迟到：**计入**出勤分子（campuskit 口径） */
  LATE: 'late',
  /** 缺勤：进入分母，不进分子 */
  ABSENT: 'absent',
  /** 请假：**剔出分母**（`Excused`），分子分母都不变 */
  EXCUSED: 'excused',
});

/**
 * 计算口径的**整数**表达（不用浮点，也不用 `Math.floor(A / r - T)`）。
 *
 * 记要求阈值为百分比的 100 倍整数 `p`（75% → `p = 7500`），则「满足」等价于
 *
 *     attended * 10000 >= p * total
 *
 * 全部是整数乘加，没有舍入；`attended += 1, total += 1` 一次，左边加 10000、右边加 `p`。
 * 需要线性推进时用这个增量，不要用除法估一个初值再 while 修 —— 见 TODO-1。
 *
 * @example
 *   meetsRequirement(30, 40, 7500) // 30 * 10000 = 300000 >= 7500 * 40 = 300000 → true（正好 75%）
 *   meetsRequirement(29, 40, 7500) // 290000 >= 300000 → false
 */
export function meetsRequirement(attended, total, requiredScaled) {
  return attended * 10000 >= requiredScaled * total;
}

/** TODO：未实现。骨架只导出口径，不导出结果。 */
export function attendanceMetrics() {
  throw new Error('dsh-radar-attendance 是候选骨架：未评审、未接入 profile、不可直接使用');
}

/** TODO：未实现。 */
export function apply() {
  throw new Error('dsh-radar-attendance 是候选骨架：未评审、未接入 profile、不可直接使用');
}

/**
 * TODO-0（**阻塞**）：出勤数据从哪来？
 *
 * 本仓目前**没有**任何出勤通道（`zdbk` 四条接口全不含出勤，`xxt` 明确不做签到）。
 * 必须先在下面三条里选一条，否则本包没有输入、不该实现：
 *
 *   a. 教务系统是否有「学生自己的出勤记录」页面（不是点名系统，是成绩单旁的考勤统计）？
 *      有 → 加进 `dsh-zhiyun-source-zdbk`，本包只做计算。
 *   b. 用户**手动**记（今天页点一下「到了 / 迟到 / 没去 / 请假」）→ 本包负责聚合。
 *      ⚠ 这条路要明确：手动记录**不等于**教务认定的出勤。
 *   c. 都不要 → 本包撤销。
 */
export const TODO_0 = 'BLOCKING: 确认出勤数据的真实来源（见 src/index.js 注释），无来源则撤销本包';

/**
 * TODO-1：`safeMisses` 用**线性推进**，不要用除法估初值。
 *
 * 候选源的写法是 `Math.floor(A / r - T)` 再 while 修正，实测返回 `1.33 / 4.67` 这类
 * **小数**（`A=31,T=40,p=7500` → `1.3333…`）—— 根因是 `r = p/10000` 是浮点、`A / r` 不是整数除法。
 * 页面上一旦渲染成「还能缺 1.33 次」，用户不会去上课，先来问这是什么意思。
 *
 * 正确写法：从 0 开始 `total += 1` 逐个试到第一次不满足为止（课表量级一学期 ≤ 200 节，
 * 线性即可，O(n) 远小于一次渲染预算）。
 */

/**
 * TODO-2：今天页的节次**没有课程键**。
 *
 * `packages/dsh-zhiyun-page-today/src/agenda.js` 的 `projectAgenda()` 产出
 * `{ startMs, endMs, courseTitle, day }`，**没有** `courseId` / 课程代码。
 * 出勤是按课程聚合的，`courseTitle` 会重名（「大学物理」在多个学期/多个学院都有）。
 * 必须先让 `source-zdbk` 的课表解析产出稳定键，否则会出现两门课共用一份出勤。
 */

/**
 * TODO-3：阈值不是常数。
 *
 * campuskit 默认 80%，浙大多门课是 75%（也有 70% / 100% 的实践课）。**不能**写死一个值：
 * 阈值应当来自课程来源（若有）或用户设置，并**展示在文案里**（「按 75% 算」），
 * 让用户知道这句话是基于哪个口径算出来的。
 *
 * TODO-4：数据陈旧要显式暴露。
 * 出勤记录是滞后的（老师可能两周后才录）。文案必须带「截至 YYYY-MM-DD」，
 * 否则「还能缺 3 次」在数据过期后会变成事实错误。
 *
 * TODO-5：与 `dsh-radar-deadline-budget`（截稿预算）**不改同一行代码**，但评审时合并看 ——
 * 两者都是「今天页上的一句话预算」，其中「请假」同时影响出勤与作业截止。
 */
