/**
 * dsh-radar-plan-solver —— **候选骨架的占位入口**。
 *
 * ⚠ 本文件**不写业务逻辑**，只标注适配点与 TODO；`apply()` 被调用即抛错，
 *   以免评审者误把本包挂进 profile 后在启动期静默加载。
 *   待人工评审通过后，再逐条落实 TODO；评审驳回则整目录删除。
 *
 * ── 它是什么 ──────────────────────────────────────────────────────────
 *
 * 给「规划」页补一层**硬约束可满足性**：把用户当天的卡片（固定事件、截止、
 * 「必须 1 小时内」「两件不能相邻」「至少留 30 分钟午休」这类规则）喂给
 * 一整型线性规划求解器；**解不出来时，回传是哪组约束互斥**，而不是像现在这样
 * 悄悄丢掉放不下的卡片。
 *
 * ── 关系判定：**强化式集成**（不是全新）──────────────────────────────
 *
 *   1. **仍是同一个面板** —— 「规划」页不动。不新增导航项、不新增插槽、不新增路由。
 *      只是在既有 `projectAgenda` 之后多调一次 `diagnose()`。
 *   2. **功能仍相似正交** —— 仍是「今天先做什么」（排程），
 *      不改成课程表、不改成待办清单、不改成日历同步。
 *   3. **底层多调了更优质实现** —— 现在放不下时是「静默丢」，本包给出
 *      **不可行约束集合**（哪几条规则同时成立就不可能）。这是语义上的升级，不是换个写法。
 *
 * ── 为什么是 A 类（原生 DSH 插件包）──────────────────────────────────
 *
 *   上游 `hermes98761234/shift-scheduler` 自带 `dsh.bundle` 形状的站点（Vite + React，
 *   有独立的 `src/lib/` 纯逻辑层，`solver.worker.ts` + `dsatur.ts` + `solve.ts`），
 *   按技能文档归为**原生 DSH 生态可对接**一类；但**它没有发 npm**，
 *   所以本包**不锁它**，改锁它同样依赖的通用 ILP 求解器 `yalps@0.6.4`（MIT）。
 *   上游只作**建模形状**参考（`src/lib/timetable.ts` 的「约束 → 变量」映射），
 *   **不复制任何源码**。
 *
 * ── 不能做错的四件事 ────────────────────────────────────────────────
 *
 *   P0 · **不可行不是错误**：`status` 为 `Infeasible` 时必须**照常渲染课表**，
 *        只把冲突说明挂上去；抛异常会让整页白屏。
 *   P1 · **变量规模**：一天几十张卡片 → 变量数是「卡片 × 时段槽」乘积。
 *        超阈值（建议 2000）就退回启发式排程，**不要**让求解器卡住 UI 线程。
 *   P1 · **必须放进 Worker**：`yalps` 是同步阻塞的，主线程会掉帧。
 *   P1 · **约束要可解释**：每条约束自带人类可读 `label`，否则「解不出来」用户看不懂。
 *
 * 上游参考：`hermes98761234/shift-scheduler` · MIT · https://github.com/hermes98761234/shift-scheduler
 * 锁版上游：`yalps@0.6.4` · MIT · https://github.com/IvanRublev/yalps
 * 本包**未评审、未接入 profile、不可直接使用**。
 */

import { UPSTREAM_PACKAGE, UPSTREAM_REPOSITORY, UPSTREAM_VERSION } from './upstream.js';

/** 插件名。与目录名 / `package.json.name` 一致。 */
export const name = 'dsh-radar-plan-solver';

/** 让锁版凭据在本模块可见（评审时应核对与 `package.json` 一致）。 */
export const upstream = Object.freeze({
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  repository: UPSTREAM_REPOSITORY,
  reference: 'hermes98761234/shift-scheduler',
});

/**
 * 诊断「这天的排程有没有解、没解是哪几条规则打架」。
 *
 * TODO(评审后实现)：
 *   - 入：卡片列表（含固定时段）+ 约束列表（每条带 `id` / `label` / 系数）
 *   - 出：`{ status: 'optimal'|'infeasible'|'skipped', conflicts: string[], assignment }`
 *   - `infeasible` → 用「逐条移除约束复解」定位冲突集（最小冲突集不必最优，够用即可）
 *   - 变量数超阈值 → `status: 'skipped'`，由调用方退回启发式
 *
 * @param {unknown} _input
 * @returns {never}
 */
export function diagnose(_input) {
  throw new Error('dsh-radar-plan-solver: 候选骨架，diagnose() 尚未实现');
}

/**
 * 插件的 `apply()`：**现在是故意抛错的**。
 *
 * TODO(评审后实现)：
 *   - 把 `diagnose()` 注册到「规划」页的排程钩子之后（**不新增页面**）；
 *   - 求解放进 Worker，主线程只等消息；
 *   - **不得**改写既有排程结果 —— 只做「诊断 + 冲突说明」叠加。
 *
 * @param {unknown} _ctx
 */
export function apply(_ctx) {
  throw new Error('dsh-radar-plan-solver: 候选骨架，禁止挂载（未评审）');
}

export default { name, apply };
