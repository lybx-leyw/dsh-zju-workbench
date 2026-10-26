/**
 * dsh-radar-ics-rrule —— **候选骨架的占位入口**。
 *
 * ⚠ 本文件**不写业务逻辑**，只标注适配点与 TODO；`apply()` 被调用即抛错，
 *   以免评审者误把本包挂进 profile 后在启动期静默加载。
 *   待人工评审通过后，再逐条落实 TODO；评审驳回则整目录删除。
 *
 * ── 它是什么 ──────────────────────────────────────────────────────────
 *
 * 给 `dsh-radar-ics-export` 的「导出成 .ics」补上一层**真正的周重复**（RFC 5545 `RRULE`），
 * 使「周三 08:00 这节数据结构课，一学期 16 周」在日历里是 **1 条带 RRULE 的事件**，
 * 而不是 16 条各自独立、无法整体删除的事件。
 *
 * ── 为什么这是「强化式集成」而不是「新功能」──────────────────────────
 *
 * 三条同时成立（技能文档的核心判据）：
 *
 *   1. **仍是同一个面板** —— 不新增导航项、不新增插槽、不新增路由。本包只对外暴露一个
 *      `recurrenceRuleFor(group)`，由 `ics-export` 的 `buildCalendar()` 调用。
 *   2. **功能仍相似正交** —— 仍是「把课表 / 截止时间导出成 .ics 让用户带走」，
 *      不改成双向同步、不改成日历订阅源。
 *   3. **底层多调了更优质实现** —— 「一周重复 N 次、遇到不连续要拆」这件事，
 *      自己手写只会退化成「逐日展开」（`ics-export` 现状）；锁版 `rrule@2.8.1` 是
 *      RFC 5545 的成熟实现（★3.4k，BSD-3-Clause，`esbuild --bundle --minify` 后 51.9 KB）。
 *
 * ⚠ 但**范围必须收窄**：RRULE 只在「组内严格每 7 天一条」时与逐日展开等价。
 *   本仓课表条目没有周次 / 节次号（见 `src/upstream.js` TODO-C），调课会让分组碎裂。
 *   所以它是 🟡「需移植改造」，**不是** 🟢「可直接集成」。
 *
 * ── 不能做错的四件事（全部有实测，见 docs/ecosystem-radar/2026-10-26-r74.md §3）──
 *
 *   P0 · `Date#getDay()` 的整数**不能**直接当 `byweekday` 用 —— 两套枚举差一位，
 *        传错一天**不报错、不告警**，用户日历上整学期错一天。
 *   P1 · ESM 下**不能** `import { RRule } from 'rrule'` —— CJS 包无 `exports`，加载期即崩。
 *   P1 · **组不连续就必须退回逐条** —— `COUNT` 表达不了「第 8、12 周各停一次」。
 *   P1 · **绝不**让同一份条目既输出「展开后的 N 条」又挂 RRULE —— RFC 5545 下会被当成序列起点。
 *
 * 上游：`rrule@2.8.1` · BSD-3-Clause · https://github.com/jakubroztocil/rrule
 * 本包**未评审、未接入 profile、不可直接使用**。
 */

import { UPSTREAM_PACKAGE, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from './upstream.js';

/** 插件名。与目录名 / `package.json.name` 一致。 */
export const name = 'dsh-radar-ics-rrule';

/** 让锁版凭据在本模块可见（测试应钉住三者与 `package.json` 一致）。 */
export const upstream = Object.freeze({
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  repository: UPSTREAM_REPOSITORY,
});

/**
 * 允许转 RRULE 的导出档 —— 只有这两档，且各有前提。
 *
 * - `deadlines`：待办卡片的 `due` 是**单点时间**，天然没有「周次空洞」问题；
 *   但多数待办是一次性的，`contiguous` 判下来通常只有 1 条 → 退回逐条（等于不开 RRULE）。
 *   真正受益的是「每周同一时刻重复的例会 / 周报」类条目。
 * - `timetable`：必须先过 `contiguous()`。**默认从严**：判定不了就不开。
 */
export const RRULE_MODES = Object.freeze({
  timetable: 'timetable',
  deadlines: 'deadlines',
});

/**
 * 插件入口。**占位**：评审通过前，挂载即抛错。
 *
 * 把「静默加载但什么都没做」改成「显式失败」，比在 profile 里装一个空插件安全 ——
 * 空插件会让评审者以为「已经接好了」，而启动期抛错会立刻暴露。
 */
export function apply() {
  throw new Error(
    'dsh-radar-ics-rrule：候选骨架未实现（见 README 与 src/upstream.js 的 TODO-A..D）。不要接入 profile。',
  );
}

/**
 * 生成某一组的 `recurrenceRule`。
 *
 * TODO-1 · 实现顺序（每一步都别跳，跳了就会踩上面的 P0/P1）：
 *
 *   1. **判连续**：`contiguous(group)`（TODO-C）。`false` 一律 `return null` ——
 *      调用方据此退回逐条输出。**不要**在这条路径上「尽力而为」地猜 `COUNT`。
 *   2. **判同参**：组内 `endMs - startMs` 必须相等。时长不等（如最后一节拖堂）
 *      也 `return null` —— RRULE 只有一个 `DURATION`。
 *   3. **取 weekday**：用 `weekdayOf(dow, upstream)`（TODO-B），**不要**透传 `getDay()`。
 *      星期必须按 `Asia/Shanghai` 取（本仓惯例见 `page-today/src/agenda.js:11`、
 *      `core-study/src/model.js:568` 的 `Intl.DateTimeFormat`），
 *      不能按 UTC 取 —— 07:00 的早课在 UTC 是前一天。
 *   4. **受注**：`loadUpstream()`（TODO-A），默认导入。
 *   5. **组 RRULE**：`new RRule({ freq: RRule.WEEKLY, count: group.length,
 *      byweekday: [wd], dtstart: new Date(group[0].startMs) })`
 *      → 交回 `{ rruleString, instances: group.length }`。
 *   6. **不碰时间格式**：时区怎么输出（UTC 还是 `TZID=Asia/Shanghai`）**由 `ics-export`
 *      的 TODO-D 决定**，本包只给 `RRULE` 属性值，不改 `DTSTART`。两个包各改一半必然打架。
 *
 * @param {{ startMs: number, endMs: number }[]} group - 已按 `startMs` 升序、同一课程同一时段
 * @param {{ mode: 'timetable'|'deadlines' }} options
 * @returns {{ rruleString: string, instances: number } | null} `null` 表示不得使用 RRULE
 */
export function recurrenceRuleFor(group, options) {
  // 占位：评审通过后实现。
  throw new Error('dsh-radar-ics-rrule：候选骨架未实现（TODO-1）。不要接入 profile。');
}
