/**
 * dsh-radar-study-tutor —— 把上游「宿主拥有作答/判分/掌握度证据」接到学习页判分链路的骨架。
 *
 * ⚠️ 候选骨架：未评审、未接入 profile、不可直接使用。
 * 本文件只有一个空的 `apply()`；真实接入点在评审通过后写进
 * `packages/core/study` 与 `packages/client/page-study`，**不在这里**。
 *
 * 为什么是空骨架：上游虽然是可锁版的原生 DSH 包，但它自带一整套 agent preset
 * 与 12 个 host tool（`study_issue_question` / `study_author_question` /
 * `study_model_review` …）。**直接 insert 上游 patch 就等于装了个平行的第二个
 * 学习系统**，与本仓 `core/study` + `page-quiz` 的题库/判分/复习三处功能重叠 ——
 * 那正是任务书禁止的「简单集成重复功能」。
 *
 * 所以本骨架只做**外围兼容层**：上游的引擎（判分确定性、求助分级 H0–H4、
 * 掌握度分维度记录、append-only 证据、SQLite hash-chain）留下来，上游的
 * 面板与 preset 由评审决定是**改造接入**还是**整体不装**。
 */

import {
  UPSTREAM_PACKAGE,
  UPSTREAM_VERSION,
  UPSTREAM_TOOLS,
} from './upstream.js';

/** 白名单：本骨架承诺的公开面。不要从这个数组之外 import。 */
export const EXPORTS = Object.freeze([
  'UPSTREAM_PACKAGE',
  'UPSTREAM_VERSION',
  'UPSTREAM_TOOLS',
  'assertUpstreamShape',
]);

/**
 * 只读兼容性断言：上游导出的工具名单是否仍是我们适配过的那一份。
 *
 * 刻意**不做**的事：不包一层 tool proxy、不缓存上游的作答状态、不代替上游判分。
 * 一旦本包开始「中转」判分，就会出现第二个真相源 —— 而「唯一真相源在宿主」
 * 恰恰是这次集成想要的东西。
 *
 * @param {string[]} actualTools 运行时从上游 `apply()` 拿到（或从其清单读出）的工具名
 * @returns {{ ok: boolean, missing: string[], extra: string[] }}
 */
export function assertUpstreamShape(actualTools) {
  const actual = new Set(Array.isArray(actualTools) ? actualTools : []);
  const expected = new Set(UPSTREAM_TOOLS);
  return {
    ok: actual.size === expected.size && [...expected].every((t) => actual.has(t)),
    missing: [...expected].filter((t) => !actual.has(t)),
    extra: [...actual].filter((t) => !expected.has(t)),
  };
}

/**
 * 占位。**刻意什么都不做。**
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  // TODO(评审后)：先裁定下面三件事，再决定这个文件该不该存在。
  //
  //   1. **roster 问题（必须先裁）**：上游会往 agent preset 选择器里塞一个
  //      `Study Mode`。本仓已有 `lecture` preset（`packages/preset/lecture`），
  //      再加一个「教理科的」preset 会不会让选择器变成两个入口？若要留，
  //      留哪个、另一个怎么并入，属产品决策，骨架不预置。
  //
  //   2. **判分真相源冲突**：本仓 `packages/core/study/src/grading.js` 的
  //      主观题是「模型判掌握程度 + 一句评价」（`grading: 'llm'`），而且
  //      **模型失败时会把 verdict 退化成 `partial` 并照样写入**。上游相反：
  //      客观题确定性判分、主观题「未通过可靠校验就保持 pending，模型评论
  //      标记『不计入判分』」。这两种口径不能并存 —— 同一份作答会有两个结论。
  //      ⇒ 若要接，应当让上游接管**已有页面的判分**，而不是新开一套。
  //
  //   3. **存储位置**：上游写 `$DSH_HOME/study-core/study.db`（SQLite，
  //      hash-chain，schema 3）。本仓学习记录在别处。先定「谁是权威库」，
  //      再谈迁移；两库并存必然分叉。
  //
  // 接入点（评审通过后）：
  //
  //   - `packages/core/study/src/grading.js` —— 用上游的确定性判分替换
  //     `grading: 'llm'` 那条主观题路径；模型评论降级为「参考意见、不参与判分」
  //     （对齐上游的 `study_model_review` 语义）。
  //   - `packages/core/study/src/workbench.js` —— 挑战/作答记录的写入点，
  //     改为 append-only 事件 + 分维度能力档（U/N/S/P/R）。
  //   - `packages/client/page-study` —— 页面容器不动（仍是同一个面板）；
  //     只换判分结果卡片的字段来源。「求助等级 H0–H4」是新的 UI 元素，
  //     需要产品确认放在哪。
  void ctx;
}
