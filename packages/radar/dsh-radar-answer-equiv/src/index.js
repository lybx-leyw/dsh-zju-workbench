/**
 * dsh-radar-answer-equiv —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑，也不 import 上游。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 给「学习」页填空题的**自动判定**（`QUIZ_AUTOGRADE_VERDICTS`）加一层
 * 「等价答案」归一，让**同一个面板**能认出下面这些「意思对、写法不同」的作答：
 *
 *   | 答案键 | 学生写 | 现在 | 期望 |
 *   | --- | --- | --- | --- |
 *   | `12000000` | 一千二百万 / 一千2百万 | ✗ 未命中 | ✓ 判对 |
 *   | `0.5` | 1/2 / 二分之一 | ✗ 未命中 | ✓ 判对 |
 *   | `1000` | 1,000 | ✗ 未命中 | ✓ 判对 |
 *   | `5000` | 5e3 / 5×10^3 | ✗ 未命中 | ✓ 判对 |
 *   | `0.5` | 0.50 / 零点五 | ✗ 未命中 | ✓ 判对 |
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条同时成立）──────────
 *
 *   1. **仍是同一个面板** —— 不新增页面、不加插槽、不动导航。作答判定仍发生在
 *      `dsh-zhiyun-quiz` 的 `makeAttempt({ response, autoVerdict })`，`selfRecall`
 *      四档评分的语义与「AI 判分不得进调度」的纪律**一个字都不改**。
 *   2. **仍是相似正交的功能** —— 现有：`normalizeForTrace()` 做全角/空白/大小写/尾标点
 *      归一后**逐字比较**；新增：比较的是**同一个量的两种写法**。
 *      归一层只产出 `correct | incorrect | unknown` 三态，三态语义不变。
 *   3. **底层多调了更优质实现** —— 本仓只有字符串归一，**没有**任意精度小数、
 *      没有分数、没有中文数词。上游 `decimal.js@10.6.0` 提供 `Decimal` 与
 *      `equals()`（任意精度、无浮点误差），这是本仓用 `Number` 写不出来的
 *      （`0.1+0.2 !== 0.3`）。
 *
 * ── 边界（写在这里，免得实现时越界）────────────────────────────
 *
 *   - **`unknown` 永远是兜底，绝不退化成 `correct`。** 判不了就进人工；
 *     把「像」当「是」会让填空题的复习信号整体失真。
 *   - **不做语义等价。** 「 mitochondrion 」与「线粒体」不算同一个答案 ——
 *     那需要模型判断，属于另一条链（`quality.js` 的 grounded judge），
 *     且违反「AI 判分不得直接当复习调度评分」的既有纪律。
 *   - **不动 `normalizeForTrace` 的既有口径**。它是三处副本、有一致性测试钉住；
 *     本层只在它**之后**追加，不替换、不改写。
 *   - **不处理单位换算**（1 km vs 1000 m）。本轮不采用单位库，理由见 README。
 */

export const name = 'radar-answer-equiv';

/**
 * 等价判定服务。
 *
 * @param {{ response: string, expected: string }} input
 * @returns {'correct' | 'incorrect' | 'unknown'}
 */
export function compareAnswer(input) {
  // TODO(评审后实现)：
  //   1. 先走本仓既有的 `normalizeForTrace()`（不改口径），命中即 `correct`；
  //   2. 未命中时依次尝试三条解析支路，**任一支路双方都解析成功**才比较：
  //      a) 中文数词 → 有理数（自写，≤120 行；**不复用上游**，理由见 README「为什么不整库引入」）
  //      b) 分数 `a/b`、`a分之b` → Decimal 除法
  //      c) 千分位 / 科学计数 / 尾随零 → `new Decimal(cleaned).equals(other)`
  //   3. 任一侧解析失败 → `unknown`（**不许**回落到字符串比较的 `incorrect`，
  //      否则「判不了」会被误记成「答错」，污染错题归因）。
  throw new Error('dsh-radar-answer-equiv: 候选骨架，尚未实现（见本文件 TODO）');
}

/** 无宿主行为：评审通过前不挂任何服务。 */
export function apply() {
  throw new Error('dsh-radar-answer-equiv: 候选骨架，未接入 profile，禁止挂载');
}
