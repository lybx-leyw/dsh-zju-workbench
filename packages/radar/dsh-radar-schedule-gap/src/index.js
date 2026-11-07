/**
 * dsh-radar-schedule-gap —— **候选骨架的占位入口**。
 *
 * ⚠ 本文件**不写业务逻辑**，只标注适配点与 TODO；`apply()` 被调用即抛错，
 *   以免评审者误把本包挂进 profile 后在启动期静默加载。
 *   待人工评审通过后，再逐条落实 TODO；评审驳回则整目录删除。
 *
 * ── 它是什么 ──────────────────────────────────────────────────────────
 *
 * 回答一个问题：**「这两节课之间还剩多久？」**
 *
 * 本仓已经能回答「这天有几节课」——`packages/dsh-zhiyun-page-planning/src/schedule-hint.js`
 * 的 `scheduleHint()` 返回 `这天有 N 节课。`。但它**只数条数，不排序、不比时刻**：
 * 第 2 节 09:35 下课、第 3 节 10:00 上课，中间 25 分钟；5→6 节之间则是 60 分钟
 * （午休）。这两件事对「什么时候出门」「要不要带饭」是决定性的，而本仓一个字都没说。
 *
 * `packages/dsh-zhiyun-source-zdbk/src/parse.js` 的 `parseSession()` 一次给出全部所需字段：
 * `weekday`（1–7）、`periods`（`[3,4]`）、`weeks`（`'all'|'odd'|'even'`）、
 * `terms`（如「秋冬」）、`time`（`'10:00-11:35'`，由 `PERIOD_TIMES` 首末节拼出）。
 * 数据齐了，**只差一次相邻比较**。
 *
 * ── 为什么这是「强化式集成」而不是「新功能」──────────────────────────
 *
 *   1. **仍是同一个面板** —— 不新增导航项、不新增插槽、不新增路由。落点是
 *      `page-planning/src/client.jsx:1662` 已有的那一行 `<small className="zpg-schedule-hint">`。
 *   2. **功能仍相似正交** —— 仍是「这天课怎么排」。上一轮 r136 的 `dsh-radar-clash-guard`
 *      补的是「撞不撞」，本包补的是它正交的另一半「中间有多久」。
 *   3. **底层多调了更优质实现** —— ⚠ **只「部分成立」，如实标注**。
 *      上游 `isIntervalOverlapped()` 是 5 行判据，不构成「更优质实现」。
 *      真正值钱的是它把「显式时刻」与「节次表」**分成两级取时**
 *      （`resolveLessonInterval()`：`startTime/endTime` 可用就先用，坏了才回落节次表），
 *      以及它的**失败形态清单**（见 `src/upstream.js` 的 U-1 / U-2）。
 *
 * ── 落点与姿态（与 `scheduleHint()` 保持一致）────────────────────────
 *
 *   - `meta.complete !== true` → **一个字都不说**。不能把「没读到」说成「没有课」。
 *   - 只做**读侧**：不写课表、不改课表、不导出、不提醒。
 *   - 不新增依赖：本包 `dependencies` 为空，`PERIOD_TIMES` 从 `source-zdbk` 导入。
 */

const NOT_IMPLEMENTED = 'dsh-radar-schedule-gap 是候选骨架，未评审、未实现，不可挂载。';

/**
 * 应用入口（占位）。
 *
 * TODO(评审通过后)：
 *  1. 不要在这里注册任何 page / slot —— 落点是既有规划页的一行文案，
 *     由 `page-planning` 自己调 `gapHint()`，本包只提供纯函数。
 *  2. 若最终形态仍需一个 cordis 插件壳，再补 `ctx.provide('radar.scheduleGap', …)`
 *     并把 `apply()` 改成注册纯函数服务；**现在不写**。
 *
 * @returns {never} 恒抛错。
 */
export function apply() {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * 计算一天内相邻两节课之间的间隔（占位，未实现）。
 *
 * TODO(评审通过后) —— 纯函数，不碰网络、不碰存储：
 *
 *   输入：`courses`（`readScheduleWindow` 返回的 `items[i].courses`，
 *         每条含 `{ name, periods, weeks, terms, time }`）、
 *         `weekParity`（`'odd'|'even'`，由调用方给「本周」口径）。
 *   输出：`[{ from: '第2节', to: '第3节', minutes: 25, kind: 'move'|'meal' }]`
 *
 *   规则：
 *   a. 按 `periods[0]` 升序；相同起始节次的课**并列**，不互相比较间隔。
 *   b. `minutes = nextStartMin - prevEndMin`，两者都取自 `PERIOD_TIMES`
 *      （首节 `[0]` 为上课、末节 `[1]` 为下课）。**不要**解析 `time` 区间串
 *      （U-2：上游正则只认单点 `HH:mm`，本仓 `time` 是 `'10:00-11:35'`）。
 *   c. `kind`：`minutes >= 45` → `'meal'`（跨午休 / 跨晚饭）；否则 `'move'`。
 *   d. `weeks` 为 `'odd'` / `'even'` 时，只在 `weekParity` 匹配的那一周参与排序；
 *      `'all'` 恒参与。`terms` 与当前 `term` 不匹配的条目**直接跳过**。
 *   e. `courses` 为空 / 非数组 → 返回 `[]`（**不要**返回 null，让调用方少一个分支）。
 *
 * @returns {never} 恒抛错。
 */
export function gapHint() {
  throw new Error(NOT_IMPLEMENTED);
}
