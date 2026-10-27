/**
 * dsh-radar-deadline-budget —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑；**不 import 上游本身**，
 * 只从 `./upstream.js` 取锁版凭据（那一个文件负责「上游长什么样」）。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 把「截止时间」从**一个比较键**变成**一个有长度的时间量**：
 * 「规划」页页头的摘要条（`FocusBar`）现在只数**条数**，本包给它补上
 * **「本周还剩几天、还压着几条」**这一维，并把「距离截止」的毫秒数交给
 * 上游 `Deadline.msUntil()` 算，而不是本仓散落的三处手写减法。
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条同时成立）──────────
 *
 *   1. **仍是同一个面板** —— 落点是 `dsh-zhiyun-page-planning/src/time.js` 的
 *      `focusSummary()` 返回值，消费者是**既有**的 `FocusBar`（`client.jsx:848`
 *      组装、`:1272` 渲染）。不新增页面、不新增导航项、不新增插槽。
 *      本包 `apply()` 的 `inject` 为空 —— 结构上**不可能**新建页。
 *   2. **仍是相似正交的功能** —— 现有 `FocusBar` 回答「**这会儿有几件火烧眉毛**」
 *      （overdue / 24h / 今天之内，三档，只数个数）；新增回答「**这一周压不压得住**」
 *      （按剩余天数分布 + 与课表空档比）。前者是**点估计**，后者是**面估计**，
 *      同一数据域（未完成条目）、不同粒度。
 *   3. **底层多调了更优质实现** —— 这一条**只部分成立**，见 README「为什么不是 🟢」
 *      与 §3.2 的实测：上游的 `msUntil` 比本仓手写减法只多一个「负值精确到毫秒」，
 *      这个增益**很小**；真正的增益来自「新增的那一维」而不是「换了底层」。
 *      → 这是本包被判 **🟡 需移植改造** 而不是 🟢 的直接原因。
 *
 * ── 已核实的缺口（本轮读码 + 实跑，不是猜）────────────────────────
 *
 *   （下方 `grep` 那一行是逐字命令，方便复核；放在注释里原样保留）
 *
 *   grep -rniE "pomodoro|focusSession|番茄|专注" --include=*.js packages --exclude-dir=node_modules
 *   → 只命中 radar- 开头的骨架与注释，宿主代码里**零实现**
 *
 *   但**「缺不计时」不是本包的缺口** —— r54 已由 `dsh-radar-focus-machine` 占位。
 *   本包盯的是另一处，且是**本仓内部就自相矛盾**的一处：
 *
 *   | 口径 | 位置 | 3 天外 7 天内的一条 | 是否进摘要条 |
 *   | --- | --- | --- | --- |
 *   | `urgencyOf()` | `time.js:371`（注释说「`today`＝24h 内 / `week`＝7 天内」） | `week` | — |
 *   | `focusOf()` | `time.js:78`（多了 `soon` 档，`today` 收窄成「3 天内」） | `week` | — |
 *   | `focusSummary()` | `time.js:120` | `week` → **不计入** | **不计入** |
 *   | `FocusBar` | `client.jsx:1272` | — | 只渲染 `overdue/soon/today` 三档 |
 *
 *   实测（`t.mjs`，`now = 2026-10-25 09:00 +08`）：
 *
 *   ```
 *   条目                        urgencyOf   focusOf
 *   今晚 23:59                  today       soon
 *   明早 08:00                  today       soon     ← 同档，未区分「今晚 vs 明早」
 *   10-27 23:59（后天）          week        today
 *   10-30 23:59（本周五）        week        week      ← 摘要条上完全不出现
 *   11-04 23:59（下周三）        later       later
 *
 *   focusSummary(5 条) → { overdue:0, soon:2, today:1 } → 显示 3 条 / 实际 5 条
 *   ```
 *
 *   **两件独立的事，别混为一谈**：
 *   - (a) `urgencyOf` 与 `focusOf` **两套口径并存**，同一行数据两种结论（今晚/明早同为 `today`）。
 *     `urgencyOf` 在本仓**只剩导出、零调用**（`grep -rn "urgencyOf"` 只有 `time.js:371`
 *     定义与 `index.js:34/547` 的转出）→ 它是**死代码**，且 `time.js:71` 的注释仍在
 *     用「与 `urgencyOf` 的区别」解释自己。
 *   - (b) 摘要条**只覆盖 3 天**。这是**有意为之**（`time.js:47` 注释：`soon` 是把
 *     「今晚 vs 明早」分开）还是**顺手漏掉**，注释没说。本包**不假设**是缺陷，
 *     只把差距量出来交给产品拍板（TODO-2）。
 */

import {
  UPSTREAM_GAPS,
  UPSTREAM_LICENSE,
  UPSTREAM_PACKAGE,
  UPSTREAM_REPOSITORY,
  UPSTREAM_VERSION,
  loadUpstream,
} from './upstream.js';

/** 插件名。与目录名 / `package.json.name` 一致。 */
export const name = 'dsh-radar-deadline-budget';

/** 让凭据在本模块可见（测试钉住三者与 `package.json` 一致）。 */
export const upstream = Object.freeze({
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  license: UPSTREAM_LICENSE,
  repository: UPSTREAM_REPOSITORY,
  gaps: UPSTREAM_GAPS,
});

/**
 * 新增的那一维：按「还剩几个自然日」分桶。
 *
 * 与 `focusOf` 的**时间**口径不同，这里是**日历**口径 —— 学生想的是
 * 「周三前」「这周五前」，不是「72 小时内」。两个口径**同时存在**是刻意的：
 * 摘要条上并排显示「3 条 24h 内」与「本周共 7 条」，回答两个不同的问题。
 *
 * 桶的边界**必须与 `FOCUS_ORDER` 不重叠**，否则同一条会被数两遍。
 */
export const BUDGET_BUCKETS = Object.freeze(['todayLeft', 'next3', 'thisWeek']);

/**
 * 计算「本周压力」。
 *
 * TODO-1 · 与现有 `focusSummary()` 的**关系必须写死在返回值里**：
 *   `focusSummary` 仍是唯一真源，本函数**不改它、不替代它**，只额外产出一列。
 *   实现方式应是把 `focusSummary` 的返回值原样带出来（`{ ...focusSummary(...), budget }`），
 *   而不是另算一遍 `overdue/soon/today` —— 另算就等于在仓库里加**第三套**紧迫度口径，
 *   正是本包要削的那件事（`urgencyOf` 已经是多余的第二套）。
 *
 * TODO-2 · **产品拍板项：3 天外 7 天内的条目要不要上菜单**
 *   现状是「不上」（§ 已核实的缺口 (b)）。两个方向：
 *   - 上：`FocusBar` 多一档「本周 N 条」；好处是「周五交的作业」不再隐形；
 *     代价是摘要条从 3 个数字变 4 个，`zpg-focus` 在窄屏上会换行。
 *   - 不上：本包只在**日历视图**（`buildMonthCalendar`）里给格子加个角标，不碰摘要条。
 *   → 拍板前**不得**改 `client.jsx`。本骨架不含任何 UI 改动。
 *
 * TODO-3 · **不与课表相减**（硬边界）。
 *   「这周还剩多少空档」需要课表占用，而课表是**墙钟周期 + 不等距节次 + 单双周 + 学期边界**
 *   （见 `upstream.js` `UPSTREAM_GAPS`）。上游 `Interval` 只能表达等距，表达不了这些。
 *   → 本包**只报「还剩几条」与「还剩几天」，不报「还剩几小时」**。
 *   想做「还剩几小时」，得先有一个本仓自己的「本周空档」函数，那是另一个议题
 *   （且与 r54 专注计时、r63 讲义装配都相关，应从本仓代码起手，不是找库）。
 *
 * @param {{ openTodos?: object[], courseSessions?: object[], now?: number }} input
 * @returns {{ overdue: number, soon: number, today: number, newArrivals: number,
 *             budget: { todayLeft: number, next3: number, thisWeek: number, undated: number } }}
 */
export function budgetSummary(input = {}) {
  throw new Error('候选骨架：budgetSummary() 未实现（见 README，未评审）');
}

/**
 * 一条条目「还剩多久」—— 唯一一处算减法。
 *
 * TODO-4 · 用上游 `Deadline.msUntil(now)`，**不要**在这里写 `Date.parse(due) - now`。
 *   理由不是「上游更准」（它也就是一次减法），而是：
 *   - 上游对**已过期**返回负值且负的就是差额（`getDueDate - now`），
 *     本仓现在的三处手写减法各自写法不同，容易一处 `Math.max(0, …)` 一处不 max；
 *   - 负值语义在本包要用来排「过期最久的一条」—— 上游的 `static compare` 可直接当
 *     `Array#sort` 的比较器用，本仓的 `client.jsx:865-869` 是内联箭头函数，
 *     且用 `Infinity` 顶 `null`（这个写法本身没问题，见 TODO-5）。
 *
 * @param {{ due: string|null }} row
 * @param {number} now - 毫秒时间戳。
 * @returns {Promise<number|null>} 毫秒差（负=已过期）；`due` 为空时 `null`（**不构造 Deadline**）
 */
export async function remainMs(row, now) {
  throw new Error('候选骨架：remainMs() 未实现（见 README，未评审）');
}

/**
 * TODO-5 · `Deadline.compare` 不能直接替掉 `client.jsx` 的排序，原因是**入参形状不同**：
 *   本仓排序的数组里混着 `due: null` 的行，而上游 `new Deadline(null)` 会**抛错**。
 *   → 要替掉必须先把 `null` 分流到队尾（本仓现在用 `Infinity` 顶，等价且更省），
 *     再对非 null 那一支用 `Deadline.compare`。
 *   实跑结论：现有排序 `今晚 → 明早 → 没填时间` 是**正确**的（`t2.mjs`）——
 *   本包**不修一个不存在的 bug**，只把「以后有人想改成上游比较器」的正确做法写在这里。
 */
export const SORT_CONTRACT = Object.freeze({
  undatedLast: true,
  comparator: 'Deadline.compare (仅对非 null 子序列)',
});

/**
 * 挂载点。
 *
 * 评审通过后的正确落点是（三条都是改**别的**包，不属于本骨架）：
 *   ① 本包只导出纯函数（`budgetSummary` / `remainMs`），无副作用、无 IO、无 `inject`；
 *   ② `dsh-zhiyun-page-planning/src/time.js` 的 `focusSummary()` 增补一列，
 *      或新增 `budgetSummary()` 由 `client.jsx:848` 那个 `useMemo` 一并计算；
 *   ③ 依赖锁版写在 `dsh-zhiyun-page-planning/package.json`，**本骨架的 patch 文件评审后删除**。
 *
 * ⚠ 在那之前，**npm 上没有 `@sifiso-guy/scheduler`**（`upstream.js` R1）——
 *   第 ③ 步现在做不了。这是 TODO-0 阻塞项。
 */
export async function apply(ctx, config = {}) {
  // 占位：**不要**在这里注册路由、也不要在这里改任何页面包。
  void ctx;
  void config;
  void loadUpstream;
  throw new Error('候选骨架：apply() 未实现（见 README，未评审）');
}
