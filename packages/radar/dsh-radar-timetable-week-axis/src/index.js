/**
 * dsh-radar-timetable-week-axis —— **候选骨架的占位入口**。
 *
 * ⚠ 本文件**不写业务逻辑**，只标注适配点与 TODO；`apply()` 被调用即抛错，
 *   以免评审者误把本包挂进 profile 后在启动期静默加载。
 *   待人工评审通过后，再逐条落实 TODO；评审驳回则整目录删除。
 *
 * ── 它是什么 ──────────────────────────────────────────────────────────
 *
 * 给课表补一条**周次轴**：把「这堂课到底是哪几周上」从
 *   「一串散落的日期」（现状）
 * 归一成
 *   「学期第 startWeek–endWeek 周，按 step 周间隔，命中这些周的日期」。
 * 这是 `dsh-radar-ics-export` / `dsh-radar-ics-rrule` 一直想要的那块前置能力
 * （rrule 骨架 README 里写着「本仓课表条目**没有周次 / 节次号**，调课会让分组碎裂」）。
 *
 * ── 关系判定：**强化式集成**（不是全新）──────────────────────────────
 *
 *   1. **仍是同一个面板** —— 不新增导航项、不新增插槽、不新增路由。
 *      只对外暴露 `normalizeWeeks()` / `weekNumberFromDate()`，由课表 / 规划页内部调用。
 *   2. **功能仍相似正交** —— 仍是「这周这节在哪上课」与「课表带走」，
 *      不改成选课、不改成教室预约、不改成日历订阅。
 *   3. **底层多调了更优质实现** —— 上游把「周次」的**三种编码**
 *      （显式数组 / `{start,end}` / `{start,end,weeks}` / `{start,end,weekInterval}`）
 *      统一收敛到绝对周号，并把「学期第几周 = 日期差 ÷ 7」这个边界算清楚；
 *      本仓这块是零，只有「日期 → 第几周」的散落手算。
 *
 * ── 授权边界（重要）─────────────────────────────────────────────────
 *
 *   上游 `CPLADRAGON/nus-vacansee` 是 **MIT** ✅，但本包**不锁定它的源码**：
 *   它是 Next.js 站点（`private` + 无 npm 发布 + 无 `dsh.bundle.patch`），**不可锁版**。
 *   因此本包 `dependencies` 为**空**，走「参考其数据形状与判定规则、自行实现」的 B 类能力提取，
 *   对应说明写在 `ATTRIBUTION.md`。**不得**把上游 `.ts` 文件整段拷进来。
 *
 * ── 不能做错的四件事 ────────────────────────────────────────────────
 *
 *   P0 · **周号必须 1-based 且钳到 ≥1**：`floor((date - semStart)/7)+1`，
 *        负值不能直接返回（开学前一周会变成第 0 / -1 周）。
 *   P1 · **三种 `weeks` 编码必须都吃**：只认数组会在另一种编码上静默返回空周次，
 *        课表不报错但整学期消失。
 *   P1 · **`weekInterval` 缺省按 1**，且 `end` 必须包含（闭区间），差一学期就少最后一节课。
 *   P1 · **时区**：日期一律按 `YYYY-MM-DD` 的**本地日**比较，不要用 `new Date(iso).getTime()`
 *        直接相减（上游就是这么写的，在 UTC+8 的 23:00 后会偏一天）。
 *
 * 上游：`CPLADRAGON/nus-vacansee` · MIT · https://github.com/CPLADRAGON/nus-vacansee
 * 本包**未评审、未接入 profile、不可直接使用**。
 */

/** 插件名。与目录名 / `package.json.name` 一致。 */
export const name = 'dsh-radar-timetable-week-axis';

/** 让上游凭据在本模块可见（评审时应核对与 `ATTRIBUTION.md` 一致）。 */
export const upstream = Object.freeze({
  repository: 'CPLADRAGON/nus-vacansee',
  license: 'MIT',
  lockedByPackageManager: false,
});

/**
 * 把任意一种 `weeks` 编码归一成「升序、去重、绝对周号数组」。
 *
 * TODO(评审后实现)：
 *   - `number[]`                     → 去重排序
 *   - `{ start, end }`               → start..end 闭区间
 *   - `{ start, end, weeks }`        → 以 `weeks` 为准（`start/end` 仅作钳位）
 *   - `{ start, end, weekInterval }` → start..end 步进 interval（缺省 1）
 *   - `undefined` / 其它形状          → `[]`（**不猜**）
 *
 * @param {unknown} weeks
 * @param {string} semStartISO 学期第一周的周一，`YYYY-MM-DD`
 * @returns {number[]}
 */
export function normalizeWeeks(weeks, semStartISO) {
  throw new Error('dsh-radar-timetable-week-axis: 候选骨架，normalizeWeeks() 尚未实现');
}

/**
 * `dateISO` 落在学期第几周（1-based，钳到 ≥1）。
 *
 * TODO(评审后实现)：按**本地日**算 `floor((date - semStart) / 7) + 1`，不用毫秒直减。
 *
 * @param {string} dateISO
 * @param {string} semStartISO
 * @returns {number}
 */
export function weekNumberFromDate(dateISO, semStartISO) {
  throw new Error('dsh-radar-timetable-week-axis: 候选骨架，weekNumberFromDate() 尚未实现');
}

/**
 * 插件的 `apply()`：**现在是故意抛错的**。
 *
 * TODO(评审后实现)：
 *   - 把 `normalizeWeeks()` / `weekNumberFromDate()` 挂到 ctx 的课表服务上；
 *   - 为 `dsh-radar-ics-export` 提供「组是否连续」判定（`contiguous()`），
 *     让 `dsh-radar-ics-rrule` 能决定「1 条 RRULE」还是「N 条逐条」；
 *   - **不**新增页面、**不**新增槽位。
 *
 * @param {unknown} _ctx
 */
export function apply(_ctx) {
  throw new Error('dsh-radar-timetable-week-axis: 候选骨架，禁止挂载（未评审）');
}

export default { name, apply };
