/**
 * dsh-radar-week-parser —— **候选骨架的占位入口**。
 *
 * ⚠ 本文件**不写业务逻辑**，只标注适配点与 TODO；`apply()` 被调用即抛错，
 *   以免评审者误把本包挂进 profile 后在启动期静默加载。
 *   待人工评审通过后，再逐条落实 TODO；评审驳回则整目录删除。
 *
 * ── 它是什么 ──────────────────────────────────────────────────────────
 *
 * 把「课表里那句 `1-8,10-16周(单)`」变成 **可计算的周次数组**，
 * 并把「学期第 1 周从哪个周一开始」**投票推出来**。
 * 上游（MIT）是上海海洋大学研究生课表导出扩展，只借它这两个纯函数的**行为规格**，
 * 不搬运源码、不引入其 `exporters.js`。
 *
 * ── 为什么这是「强化式集成」而不是「新功能」──────────────────────────
 *
 * 三条同时成立：
 *
 *   1. **仍是同一个面板** —— 不新增导航项、不新增插槽、不新增路由。本包只对外暴露
 *      `normalizeWeeks()` / `inferFirstMonday()`，由 `ics-export` 的 `buildCalendar()` 内部调用，
 *      用户看到的仍是「导出日历」那一个入口。
 *   2. **功能仍相似正交** —— 仍是「课表 → .ics 带走」，只是同一门课从 16 条独立事件
 *      收敛成 1 条可整体删除的重复事件。不改双向同步、不加订阅源。
 *   3. **底层多调了更优质实现** —— 「中文周次表达式解析」本仓**完全没有**
 *      （三源三形态，见 `src/upstream.js` 的三条实证）。上游实现被中文真实数据打磨过
 *      （破折号 `— – －`、`～`、`至`、顿号 `、`），比自写更稳。
 *
 * ⚠ **判据③是「部分成立」，必须如实标注**：
 *   上游**只**解决「周次字符串 → 周次数组」与「第 1 周定位」。
 *   **RRULE（`COUNT` / `BYDAY` / 不连续退回）仍完全依赖 `dsh-radar-ics-rrule` 的锁版 `rrule@2.8.1`。**
 *   本包是 `ics-rrule` 的**上游数据供给**，不是替代品。
 *
 * ── 不能做错的四件事 ────────────────────────────────────────────────
 *
 *   P0 · **不要照抄上游的单双周判定**。上游 `含"单" ? 1 : 含"双" ? 0 : null`
 *        会让「周一(单), 周三(双)」静默丢一半课。本仓必须返回结构化 `parity`。
 *   P0 · **第 1 周推不准就退回逐日展开**。投票数不过阈值时必须返回 `confidence:'low'`，
 *        由 `ics-export` 退回「16 条独立事件」——**宁可多 16 条，不可整学期错一周**。
 *   P1 · **`xxt` 源的 `weeks` 形态未经核实**（`source-xxt/src/parse.js:372` 原样透传）。
 *        实现前必须拿真实响应样本确认是字符串还是数组，否则解析器就是猜的。
 *   P1 · **`zdbk` 只有 `all/odd/even`**，没有「第几到第几周」。
 *        `fromParity()` 需要学期总周数，**这个数从哪来必须由人拍板**。
 *
 * 上游：`wowhao333/shou-graduate-calendar-exporter@0.1.1` · MIT · `core/schedule.js`
 * 本包**未评审、未接入 profile、不可直接使用**。
 */

import {
  UPSTREAM_LICENSE,
  UPSTREAM_REPOSITORY,
  normalizeWeeks,
  inferFirstMonday,
  fromParity,
} from './upstream.js';

/** 插件名。与目录名 / `package.json.name` 一致。 */
export const name = 'dsh-radar-week-parser';

/** 让锁版凭据在本模块可见。 */
export const upstream = Object.freeze({
  repository: UPSTREAM_REPOSITORY,
  license: UPSTREAM_LICENSE,
});

/**
 * TODO-1 · 把本包接进 `ics-export` 的 `buildCalendar()`。
 *
 * ⚠ 本包**没有 `cordis.patch.yml`** —— 它不是独立插件，不注册任何服务。
 *   接法是**改调用方**（`dsh-radar-ics-export`），在本包评审通过后由人来做。
 *
 *   期望的调用形状：
 *
 *     const { weeks, parity } = normalizeWeeks(entry.rawWeeks, { maxWeek: term.weeks });
 *     const monday = inferFirstMonday(blocks);
 *     if (monday.confidence === 'low') {
 *       // 退回逐日展开 —— 不开 RRULE
 *     }
 *
 * @throws 始终抛错。本包未评审。
 */
export function apply() {
  throw new Error('候选骨架：apply() 未实现（见 README，未评审）');
}

/**
 * TODO-2 · 对外能力表（供 `ics-export` 评审时核对）。
 *
 * 返回**能力清单**而非实现，避免评审者误以为可用。
 */
export function capabilities() {
  return Object.freeze([
    { id: 'weeks.normalize', impl: 'normalizeWeeks', status: 'todo', from: 'upstream-spec' },
    { id: 'weeks.first-monday', impl: 'inferFirstMonday', status: 'todo', from: 'upstream-spec' },
    { id: 'weeks.parity-expand', impl: 'fromParity', status: 'todo', from: 'local-zdbk' },
  ]);
}

export { normalizeWeeks, inferFirstMonday, fromParity };
