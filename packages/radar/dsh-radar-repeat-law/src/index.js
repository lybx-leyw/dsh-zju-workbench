/**
 * dsh-radar-repeat-law —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑；**不 import 上游做任何事**，
 * 只从 `./upstream.js` 取锁版凭据（那一个文件负责「上游长什么样、哪些话不能照搬」）。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 「规划」页的重复任务**引擎是对的，入口是缺的，撤销是错的**。本包只补这三处，
 * 且**不新增任何页面、不新增导航项**：
 *
 *   ① 选得出「每两周」     —— `local.js` 已支持 `every: 1..12`，但界面只能传 `every: 1`
 *   ② 放得过「寒假」       —— 上游 `skipHolidays` 只认周末 + 一张写死的法定假日表
 *   ③ 撤销勾选不留下副本   —— `setDone()` 只认 `done: false → true`，但**忘了**自己
 *                             上一次 `true` 时已经生成过一条
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条同时成立）──────────
 *
 *   1. **仍是同一个面板** —— 落点是既有列表行上的「重复」标记
 *      （`client.jsx:1759` 的 `REPEAT_LABEL`）与既有勾选框（`client.jsx:1742`
 *      的 `onToggle → togglePlan`）。不新增插槽、不新增页面。
 *      ⚠ 但本包引入的上游**自己有** `shell.overlay` 等三个注册点，见 README 判据①的如实标注。
 *   2. **仍是相似正交的功能** —— 现有回答「下一次是哪天」（推进一步）；
 *      新增回答「这一步该不该跨过寒假」「我点错了能不能退回去」。同一条规则、不同不变量。
 *   3. **底层多调了更优质实现** —— 上游 `materialized`（已生成日期记账）+ `alignSeries`
 *      （规则收窄时剪掉多余副本）+ `originTaskId`（副本回链模板）+ 三句确认
 *      （这次 / 整个系列）是本仓 `setDone()` **完全没有**的一组概念；纯函数、无 IO、
 *      `skipHolidays` 的判定是**日粒度与规则解耦**的（本仓写成 `advanceBy` 内联，改不动）。
 *
 *   → 三条成立，判 **🟢 可直接集成**（前提：只取 `core/repeat.ts`，**不**把上游 UI 面一起挂）。
 *
 * ── 已核实的缺口（本轮读码 + 实跑，不是猜）────────────────────────
 *
 *   （逐字命令见 README「已核实的缺口」；本节只放结论，避免注释里出现会过早闭合的星号斜杠序列）
 *
 *   F-1  UI 只能传 `every: 1`：`client.jsx:1482` 是字面量 `{ every: 1, unit, anchor }`。
 *        实跑 `advanceBy(..., { every: 2, unit: 'week' })` 得 **2026-11-08**（正确），
 *        但页面走不到那里。→ **引擎会做，界面不给入口**（与 r65 的「数据齐全、出口没有」同形，
 *        方向相反：这次是入口缺、能力在）。
 *
 *   F-2  `setDone()` 的注释写着「取消勾选不该生成下一次」，单测
 *        `tests/planning-repeat.test.mjs:181` 也**只断言了 `next === null`**。
 *        但真实路径上「下一次」在**第一次**勾选时就已经 `push` 进列表了：
 *        勾 → 列表多一条 11-02；取消 → 原条目回到未完成（列表里仍有那条 11-02）；
 *        再勾 → **又生成一条 11-02**。同一截止日两条、id 不同、都未完成。
 *        单测测的是**函数返回值**，而缺陷在**返回值被消费之后**。
 *
 *   F-3  上游 `skipHolidays` 的实际语义是「周末 OR 写死的 PUBLIC_HOLIDAYS」，
 *        且**没有调休补班表**。实跑：2027-01-04..02-15 每周一**七个周一全部生成**
 *        （学校已放假）；2026-10-10（周六，法定补班日）被判为假日而跳过。→ 直接照搬
 *        `skipHolidays: true` 会让「每周背单词」在寒假里继续冒，且漏掉补班日。
 *
 * ── 不能照搬的三条（README「硬边界」有完整版）──────────────────────
 *
 *   - 上游 `repeatDatesBetween()` 的**上界是闭区间**：传 60 天 horizon 返回 **62** 份副本
 *     （实跑）。本仓若照抄循环，60 天 == 62 条。
 *   - `buildRepeatCopy()` 把模板 `startAt` 的**时刻**平移到目标日；传模板自己的日期会
 *     产出**与模板同一天同一刻**的副本（实跑 R5）。上游靠 `cursor = startOfDay+1` 规避，
 *     本仓若改成「按日期记账」，这个前提就不在了。
 *   - 上游只有 `daily` / `weekly` 两种 kind，**没有 `every: N`**；本仓的「每两周 / 每三月」
 *     在上游**无法表达**，只能本仓保留 `every`，把上游当「日匹配器 + 记账 + 回链」用。
 */

/** 本包可做的事：三条不变量，逐条对应一个 TODO。 */
export const INVARIANTS = Object.freeze(['interval', 'term-calendar', 'undo-restore']);

/**
 * 选「每两周」。
 *
 * TODO-1 · 入口：`dsh-zhiyun-page-planning/src/client.jsx` 的重复下拉（约 :1604）
 *   在 `day/week/month` 之下加一档间隔（1/2/3/4），把 `:1482` 的字面量 `every: 1`
 *   换成选中的值。**只改 client.jsx 一处**，`local.js` 的校验（1–12 整数）已经就位。
 *
 * TODO-2 · 存储形状**不变**：仍然是 `{ every, unit, anchor }`。不要为了迁就上游而改成
 *   `{ kind: 'daily' | 'weekly' }` —— 那样会把 `month` 与 `every: N` 直接丢掉，
 *   而本仓的既有数据（`planning-repeat.test.mjs` 覆盖了 `every: 2` 与 `month`）会读不懂。
 *   → 上游在这里只提供**形状参考**，不提供实现。
 *
 * @param {object} rule - `{ every, unit, anchor }`
 * @returns {string} 列表行上显示的中文标签（如「每两周」）
 */
export function repeatLabelOf(rule) {
  void rule;
  throw new Error('候选骨架：repeatLabelOf() 未实现（见 README，未评审）');
}

/**
 * 假期日历：把「学校放不放假」抽出来，**不进** `advanceBy()`。
 *
 * TODO-3 · 两类日期必须分开建模，不能合并成一个 `skipHolidays: boolean`：
 *
 *   | 类别 | 例子 | 对重复任务的影响 |
 *   | --- | --- | --- |
 *   | 放假（停） | 寒假 2027-01-18..02-21、暑假 | 跳过，**不补** |
 *   | 补班（加） | 法定调休的周六/周日 | **要生成**（那天是工作日） |
 *
 *   上游只有「周末算假日」这一侧（`isWeekend`），没有「补班」这一侧；
 *   本仓若需要，必须自己维护一个 `workingDays` 覆盖表，**不能**向上游要。
 *
 * TODO-4 · 来源只能是**用户自己标**（设置里填起止日期），不要内置某校校历：
 *   校历逐年变、各校区不同，写死即过度承诺。等价借鉴见 `ATTRIBUTION.md`。
 *
 * @param {{ skip?: Array<[string,string]>, extra?: string[] }} calendar
 * @returns {(dayKey: string) => boolean} 判定「这一天算不算上学日」
 */
export function buildTermCalendar(calendar) {
  void calendar;
  throw new Error('候选骨架：buildTermCalendar() 未实现（见 README，未评审）');
}

/**
 * 撤销勾选时把那一条**收回**。
 *
 * TODO-5 · 这是本包唯一真正的行为改动，动的是 `local.js` 的 `setDone()`：
 *   现在的分支是 `if (done && !wasDone) { next = … }`；
 *   要补的对称分支是 `if (!done && wasDone && current.generatedId) { recall = current.generatedId }`。
 *   为此条目需要一个 **`generatedId`** 字段（本仓现在**没有**：实跑确认生成的副本上
 *   `originId` 为 `undefined`），且 `LocalStore.setDone()` 要能**删**一条 —— 目前它只会
 *   `push`。→ 两处改动 + 一条数据迁移（老条目没有 `generatedId`，只能按
 *   `originId + 同日` 兜底匹配）。
 *
 * TODO-6 · **迁移是阻塞项**。现在已存在的重复条目没有回链，靠 `title + due` 猜会误删
 *   用户手写的同名条目。评审需在「不迁移（老条目撤销后仍会留副本）」与
 *   「迁移（一次性扫描，可能误判）」之间拍板。**在拍板前不得改 `local.js`。**
 *
 * TODO-7 · 「整个系列」的语义要照上游的三问（这次 / 以后所有 / 取消）落成
 *   **确认文案**，不要直接改数据。上游把这三问做成了组件 `RepeatScopeConfirm.tsx`，
 *   本仓若只在列表行上做一个 `title` 气泡（现状）就永远问不出来。
 *
 * @param {object} item - 刚被取消勾选的条目
 * @returns {{ recall: string|null }} 应当一并删除的条目 id
 */
export function recallOnUndo(item) {
  void item;
  throw new Error('候选骨架：recallOnUndo() 未实现（见 README，未评审）');
}

/**
 * 挂载点。
 *
 * 评审通过后的正确落点是（全都在**别的**包里，不属于本骨架）：
 *   ① 本包只导出纯函数，无副作用、无 IO、无 `inject`；
 *   ② `dsh-zhiyun-page-planning/src/local.js` 的 `setDone()` / `advanceBy()` 换成调用本包；
 *   ③ 依赖锁版写在 `dsh-zhiyun-page-planning/package.json`（**不是**写进 profile）；
 *   ④ 本骨架的 `cordis.patch.yml` 评审后删除 —— 它只是为了做「挂上 / 摘掉」差分。
 *
 * ⚠ 第 ③ 步锁的是 `@magma27/dsh-calendar@0.1.7`（Apache-2.0，npm 有包）。
 *   但**只 `import` 它的 `core/repeat.ts` 产物是不成立的**：npm 包 `exports` 只开
 *   `.` / `./src/*` / `./client` / `./invariant` / `./package.json`，`lib/core/repeat.js`
 *   没有单独的子路径 → 只能走 `./src/*`（`src/core/repeat.ts` 是**源码**，
 *   需要本仓构建链支持 TS）。这是 TODO-0 阻塞项，见 README R1。
 */
export async function apply(ctx, config = {}) {
  void ctx;
  void config;
  throw new Error('候选骨架：apply() 未实现（见 README，未评审）');
}
