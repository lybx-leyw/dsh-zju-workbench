/**
 * dsh-radar-plan-solver —— 上游封装占位（A 类 · **锁版**）。
 *
 * 锁版对象：`yalps@0.6.4`（MIT，2025-12-24 发布，unpacked 240,180 B，仅依赖 `heap@^0.2.7`）。
 * 选它而不是选 `hermes98761234/shift-scheduler` 本体，是因为后者**没发 npm**，
 * 不能锁版；而 yalps 正是同一类问题（整型线性规划）的通用成熟实现。
 *
 * ⚠ `yalps` 是 CJS 包：ESM 下必须 `import yalps from 'yalps'`（默认导入），
 *   `import { solve } from 'yalps'` 在部分 bundler 下会在加载期报「无命名导出」。
 *
 * 沙箱实跑（2026-11-07）：`Object.keys(solve({...}))` → `status, result, variables`。
 */

/** 锁定的 npm 包名。**必须**与 `package.json.dependencies` 的键逐字一致。 */
export const UPSTREAM_PACKAGE = 'yalps';

/** 锁定的版本号。**写死、不带 `^`**；升级须走单独评审。 */
export const UPSTREAM_VERSION = '0.6.4';

/** 锁定的仓库地址（供 ATTRIBUTION / 供应链核对）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/IvanRublev/yalps';

/** 建模形状的参考仓库（**不锁版、不复制源码**）。 */
export const REFERENCE_REPOSITORY = 'https://github.com/hermes98761234/shift-scheduler';

/** `yalps.solve()` 返回对象已知的顶层键（沙箱实跑所得，用于防御性断言）。 */
export const SOLVE_RESULT_KEYS = Object.freeze(['status', 'result', 'variables']);

/**
 * 加载锁版上游 —— **占位，待评审后实现**。
 *
 * TODO(评审后实现)：
 *   - 动态 `import('yalps')` 并用 `?? mod.default ?? mod` 兜 CJS 互操作；
 *   - 断言版本：读 `require('yalps/package.json').version === UPSTREAM_VERSION`，不一致就拒绝加载；
 *   - 返回值缓存（模块级单例），不要每次调用都重新解析模块。
 *
 * @returns {never}
 */
export function loadUpstream() {
  throw new Error('dsh-radar-plan-solver: 候选骨架，loadUpstream() 尚未实现');
}

/**
 * 把「卡片 × 时段槽」建成 ILP —— **占位**。
 *
 * TODO(评审后实现)：参考上游 `src/lib/timetable.ts` 的建模**形状**（只读思路）：
 *   - 决策变量：`x[cardId][slot] ∈ {0,1}`，约束 `Σ_slot x = 1`（每卡必须落一个槽）
 *   - 互斥：同槽内 `Σ_card x ≤ 1`
 *   - 前置/顺延：`x[a][t] - x[b][t±k] ≥ 0`
 *   - 每条约束必须自带 `label`（人类可读），供冲突说明使用
 *
 * @param {unknown} _input
 * @returns {never}
 */
export function buildModel(_input) {
  throw new Error('dsh-radar-plan-solver: 候选骨架，buildModel() 尚未实现');
}
