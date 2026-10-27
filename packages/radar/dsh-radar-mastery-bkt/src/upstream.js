/**
 * `upstream.js` —— 上游 `masterytrace-cli` 的**封装占位**。
 *
 * 本文件只做三件事，**全部不执行上游逻辑**：
 *   1. 记录锁定的版本与许可证（供评审一眼核对）；
 *   2. 声明本包**实际会用到**的三个入口（其余 9 个具名导出不取）；
 *   3. 给出「本仓作答记录 → 上游事件」的字段映射表，并说明为什么现在映射出来是空串。
 *
 * ── 为什么锁版，而不是 `^` ────────────────────────────────────────
 *
 * 上游 `0.1.3` 的 `exports` 字段是 `null`，子路径 `./dist/models/bkt.js` 属于**非公开入口**；
 * 一旦发 `0.2.x` 并补上 `exports`，这个子路径可能直接消失。锁死版本 + `package-lock.json`
 * 才能保证「今天能跑、明天还能跑」。
 *
 * ── 本包不做什么 ─────────────────────────────────────────────────
 *
 *   ❌ 不复制上游源码进本仓；❌ 不改上游文件；❌ 不在 `apply()` 里真实发起装载。
 */

/** 锁定的上游版本（与 `package.json` 的 `dependencies` 必须逐字一致）。 */
export const UPSTREAM = Object.freeze({
  name: 'masterytrace-cli',
  version: '0.1.3',
  license: 'MIT',
  repository: 'https://github.com/RudrenduPaul/MasteryTrace',
  /** npm 上 0.1.3 的发布时间（元数据，非推断）。 */
  published: '2026-09-25',
  /** 运行时要带的伴生依赖（锁死具体版本，不用 `^`）。 */
  companions: Object.freeze({ zod: '4.6.5' }),
});

/**
 * 本包**实际会用到**的上游入口。
 *
 * ⚠ 子路径 `./dist/models/bkt.js` 是非公开入口（上游 `exports` 为 `null`），
 * 这也是锁版而不是 `^` 的原因之一。
 */
export const ENTRYPOINTS = Object.freeze({
  /** 具名导出路径：`import { BktModel, BKT_DEFAULT_PARAMS } from 'masterytrace-cli'`。 */
  root: './dist/index.js',
  /** 本包唯一需要的类。 */
  model: './dist/models/bkt.js',
  /** 只读类型声明的位置（本包不抄实现，只引用形状）。 */
  types: './dist/models/bkt.d.ts',
});

/** 上游事件 schema（见 `dist/core/event-schema.d.ts`），四字段。 */
export const UPSTREAM_EVENT_SCHEMA = Object.freeze({
  learnerId: 'string',
  skillId: 'string',
  correct: 'boolean',
  timestamp: 'string (ISO-8601)',
});

/**
 * 本仓作答 → 上游事件的字段映射。
 *
 * ⚠ **`skillId` 这一格今天是断的**：`pointIds` 到不了题上（见 README 的 TODO-0），
 * 真实数据里 `pointIdsOf(q)` 恒为 `[]`。所以下面这一行写的是「**应该**怎么映射」，
 * 而不是「现在已经能映射」。
 */
export const FIELD_MAP = Object.freeze({
  learnerId: { from: 'accountId（StudyWorkbench.key() 第一段）', ready: true },
  skillId: { from: "pointIdsOf(item)[n]（一题多点须拆成 n 条事件）", ready: false, blockedBy: 'TODO-0' },
  correct: { from: '!attempt.countsAsWrong（**不是** autoVerdict）', ready: true },
  timestamp: { from: 'attempt.at（已是 ISO-8601）', ready: true },
});

/**
 * 装载上游。**永远是占位** —— 返回 `{ ok: false }`，不 `import()`。
 *
 * 骨架阶段刻意不真的加载：一旦真的加载，就有人会把它当作「能用」。
 *
 * @returns {Promise<{ok: false, reason: string}>}
 */
export async function loadUpstream() {
  return {
    ok: false,
    reason: '候选骨架：未评审、未接入 profile。评审通过后再实现真实装载'
      + '（并需先解决 TODO-0：pointIds 到不了题上）。',
  };
}
