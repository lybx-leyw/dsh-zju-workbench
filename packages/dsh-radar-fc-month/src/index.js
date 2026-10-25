/**
 * dsh-radar-fc-month —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑；**不 import 上游做任何事**，
 * 只从 `./upstream.js` 取锁版凭据。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 「规划」页的月历**每月会漏掉最后一周的几天**（F-1，本轮实跑复现）。
 * 本包把这个「日期网格该怎么分格」的几何计算交给 FullCalendar 的 `dayGridMonth`
 * 时间单位去出，本仓只保留「哪一天有哪些条目」的映射与全部渲染。
 *
 *   一句话：**换的是「哪几格」，不是「格子里画什么」**。
 *
 * ── 为什么是「强化式集成」（三条同时成立）──────────────────────────
 *
 *   1. **仍是同一个面板** —— 落点是既有的 `CalendarView`（`client.jsx:1944`），
 *      既有的 `zpg-cal-*` 类名与 `role="grid"`、既有的翻月按钮（`:1950/:1962`）、
 *      既有的勾选框（`:2003` 的 `zpg-check-sm`）。本包**不注册任何插槽、不新增页、
 *      不新增导航项、不新增存储**。
 *   2. **功能相似且正交** —— 现有：按天显示「截止在这天的事」；新增：无。
 *      换掉的只有**首尾补格与月末判定**这一处口径，其余一模一样。
 *   3. **底层多调了更优质实现** —— 上游 `dayGridMonth` 的日期网格是
 *      20719 ★ / 3717 fork / 2010 年起持续维护的同一段代码，被数千个非本仓项目
 *      按同一份日历口径校验过；本仓那份是 80 行手写、**只在 10 月与 2027-01 被单测
 *      钉过**（`tests/planning-calendar.test.mjs` 11 条，见 README §3 的分类）。
 *
 *   → 三条成立，判 **🟢**。但**有三处必须由评审拍板**（见 README「三处待拍板」），
 *     其中 H-2「月视图换渲染器」若拍「不换」，本骨架应整目录删除。
 *
 * ── 已核实的缺口（本轮读码 + 实跑，不是猜）────────────────────────
 *
 *   F-1  `time.js:300-301` 把「上海时间 1 号 0 点」当成 UTC 日期去取月份长度与星期：
 *
 *          const firstUtc = Date.UTC(targetYear, targetMonth - 1, 1);
 *          const firstAt  = firstUtc - 8 * 3600 * 1000;     // ← 其实是**上月末 16:00Z**
 *          const daysInMonth = Math.round((Date.UTC(y, m, 1) - firstUtc) / 86400000);
 *          const gridStart   = firstAt - dowOf(firstAt) * 86400000;
 *          const totalCells  = Math.ceil((dowOf(firstAt) + daysInMonth) / 7) * 7;
 *
 *        `dowOf(firstAt)` 取的是 `firstAt` 所在**上海日**的星期，而 `firstAt` 是
 *        上月末的 16:00Z → 星期是**上个月最后一天**的星期，不是 1 号的。
 *        实跑（`now=2026-10-25`，本月 10 月）：首格 `2026-09-27` ✅ 恰好对
 *        （9-30 是周三、10-01 是周四，只差一天且 35 格恰好收在 10-31），
 *        但 `2026-11-02` 的条目**一格都找不到**。逐月跑 2026-07 / 09 / 11 / 2027-01
 *        四个月末，**四个中有四个的末格都落在下个月**，即本月最后一周的格子被往前挤掉。
 *
 *   F-2  单测**钉住了错误的几何**：`tests/planning-calendar.test.mjs:66-79` 的断言
 *        「总格数必须是 7 的倍数」永真（35/42 都是），而「10-31 是周六 → 正好收在
 *        周末，不需要向后补」把**一次巧合**写成了不变量 —— 2026 年 10 月恰好 5 行收尾，
 *        换成 2026 年 11 月（30 日周一）就漏一周。→ 与 r66/r68 同族：
 *        **单测全绿 ≠ 用户看到的对**，因为断言的是「已发生过的那个月」。
 *        另：`:129` 的用例名写着「按月归日：UTC 与上海跨日的那几小时不能落错格」，
 *        但 `dayKey` 的实现是对的（`Intl` + `timeZone`），**这条用例保护的是对的那一半**。
 *
 *   F-3  月历只收未完成条目（`client.jsx:902-906` 传的是 `openTodos` /
 *        `!row.done` 的卡片 / `openMine`），而 `time.js:buildMonthCalendar` 的入参
 *        注释写的是「`{ id, due, done }`」并**真的读了 `done`**（`:1990` 的 overdue
 *        判定 `day.rows.some((row) => !row.done)`）→ 那个 `!row.done` 在现在的调用下
 *        **恒为 true**，是死条件。不是 bug，但说明「月历要不要显示已完成」这件事
 *        从来没有被决定过。本包不改这个语义（保持「只显示未完成」）。
 *
 * ── 不能照搬的两条（README「硬约束」有完整版）──────────────────────
 *
 *   - v5 的 `main.js` 是 **UMD**，`import { Calendar }` 会得到 `undefined`（esbuild 实测警告）。
 *   - 上游自带 `main.css`（1,495 行 / 9,974 B gzip），与本仓 `zpg-cal-*` 样式**必然冲突** →
 *     只能用它的**日期计算**（`public-api` 里的 `DateEnv` / `DateProfile`），
 *     不能用它的 DOM 渲染，或者必须写一份「把上游标签页换成既有样式」的桥。
 */

/** 本包只做一件事，没有第二件事。 */
export const SCOPE = Object.freeze(['month-grid-geometry']);

/**
 * 算出某个月的 7 列网格（**占位，未实现**）。
 *
 * TODO-1 · 形状**必须**与本仓 `buildMonthCalendar()` 的返回**逐字段对齐**，
 *   否则 `CalendarView` 一行都不用改（这是本包唯一的低风险路径）：
 *
 *   ```text
 *   { weeks: [{ key, days: [{ key, date, outside, dayNumber, isToday, isPast, rows: [] }] }],
 *     monthKey, monthLabel, weekdayLabels, total, undated }
 *   ```
 *
 *   即：**上游只提供「哪些天、属于哪一周、是不是本月」**，`rows` 仍由本仓填。
 *
 * TODO-2 · 口径逐项对照（本仓 `time.js` ↔ 上游 `dayGridMonth`）：
 *
 *   | 本仓要做的事 | 上游对应物 | 是否等价 |
 *   | --- | --- | --- |
 *   | 月长（含闰年） | `DateProfile` 的 `daysInMonth` | ✅ |
 *   | 1 号是周几 | `DateProfile` 的 `currentRange` + `weekDow` | ✅ |
 *   | 首尾补格到整周 | `weekCount`（fixed 时恒 6） | ⚠ **上游默认 6 行**，本仓是「按需 35/42」 |
 *   | 上海时区归日 | `DateEnv.offset` / `tz` | ⚠ 需要 `locale + timeZone` 选项，v5 的 tz 支持是**按字符串** |
 *   | 当天高亮（`isToday`） | `day.isToday` | ✅ |
 *   | 无日期条目计数（`undated`） | 无 | ❌ 本仓自算 |
 *
 *   → **「6 行 vs 按需行数」是真正的行为变化**：接上游 = 每月固定 6 行（多空一行），
 *     本仓现在是 5 或 6 行。这不在「等价替换」范围内，必须评审拍板（README「三处待拍板」H-3）。
 *
 * @param {{ year: number, month: number, now?: number, fixedWeeks?: boolean }} input
 * @returns {object} 与 `buildMonthCalendar()` 同形状
 */
export function buildGrid(input) {
  void input;
  throw new Error('候选骨架：buildGrid() 未实现（见 README，未评审）');
}

/**
 * 挂载点。
 *
 * 评审通过后的**真实落点不在本包**，在 `dsh-zhiyun-page-planning`：
 *   ① `src/time.js:257` 的 `buildMonthCalendar()` 内部改为调用 `buildGrid()`；
 *   ② `src/client.jsx:902` 的 `useMemo(() => buildMonthCalendar(...))` **不动**
 *      （这是判据①「仍是同一个面板」的证据）；
 *   ③ `fullcalendar@5.11.5` 的锁版依赖写在 `dsh-zhiyun-page-planning/package.json`
 *      （**不是**写进 profile，也不是写进本骨架）；
 *   ④ 本骨架目录评审后删除 —— 它只是「挂上 / 摘掉」的对照物。
 *
 * ⚠ 因为是 B 类（无 `dsh.bundle.patch`），本包**故意不导出可用的 `apply()`**：
 *   误接入会直接抛错，而不是上线一个空面板。
 *
 * @param {unknown} ctx
 * @param {unknown} config
 */
export async function apply(ctx, config = {}) {
  void ctx;
  void config;
  throw new Error('候选骨架：apply() 未实现（见 README，未评审）');
}
