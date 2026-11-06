/**
 * 拼题A 做题进度 —— **候选骨架，占位不实现**。
 *
 * 本文件只写「要接在哪、要变成什么形状」，**不写任何业务逻辑**，所有入口一律抛错。
 * 评审通过后才可继续实现；驳回则整目录删除。
 *
 * 落点（全部是**既有**的面板与既有**一个**服务，本包不注册任何插槽）：
 *
 *   ① `ptaRead({ action: 'progress' })` 的**返回口径**
 *      → `packages/dsh-zhiyun-source-campus/src/pta.js:480 progress()`
 *   ② `ptaRead({ action: 'problems' })` 的每行 `myStatus` 的三态化
 *      → 同文件 `:390 problems()`
 *   ③ 提交链路（本仓**完全不存在**，见 README「缺口 F-4」）
 *      → 需要在 campus 服务面上新增方法，而不是在本包里另起一套抓取器
 *
 * ⚠ 本包定位是 **B 类（能力提取 + 封装）**：`dependencies` 为空。
 *   上游 `vscode-pintia` 是 **VS Code 扩展且 npm 404**，不可锁版、不可 import，
 *   只能「读它的语义 → 在本仓写」。因此**不复制上游源码**，只借鉴协议事实。
 */

/** 服务名：本包依赖的既有校园数据服务（由 `dsh-zhiyun-source-campus` 提供）。 */
export const CAMPUS_SERVICE = 'zhiyunCampus';

/**
 * 上游 PTA 的做题状态枚举（**协议事实**，不是上游代码）。
 *
 * 来源三处交叉核对（见 README「证据链」）：
 *   - `jinzcdev/vscode-pintia` `src/shared.ts` `ProblemSubmissionState`
 *   - `jinzcdev/vscode-pintia` `src/explorer/explorerNodeManager.ts`
 *     （`problemExamMapping.get(id) ?? PROBLEM_NO_ANSWER` —— 缺行即「未作答」）
 *   - `lj200612/pintia-problemset-toolkit` `pta/client.py` 同名端点
 *
 * ⚠ 本仓当前只认前一个（`PROBLEM_ACCEPTED`），把另外两个**并进 `byStatus` 却不算未通过**，
 *   见 README F-1 的实跑输出。
 */
export const PTA_SUBMISSION_STATE = Object.freeze({
  ACCEPTED: 'PROBLEM_ACCEPTED',
  WRONG_ANSWER: 'PROBLEM_WRONG_ANSWER',
  NO_ANSWER: 'PROBLEM_NO_ANSWER',
});

/**
 * TODO-1（阻塞：需产品先定「三档还是四档」）
 *
 * 把 `exam-problem-status` 的行归一到**互斥的三态**。
 *
 * 现在的 `progress()` 是「有行就算做过、等于 ACCEPTED 才算过」，缺行落进 `UNKNOWN`：
 *   实跑 `[ACCEPTED, WRONG_ANSWER, PROBLEM_NO_SUBMISSION, {无字段}]`
 *   → `{ total: 4, accepted: 1, byStatus: {... 'UNKNOWN': 1} }`
 * 上游把「缺行」与「NO_ANSWER」视为同一件事（未作答），而本仓把它们分成了两个桶。
 *
 * @param {unknown} row - `exam-problem-status` 的一行。
 * @returns {'accepted'|'wrong'|'untouched'} 三态之一。
 */
export function classifySubmissionState(row) {
  void row;
  throw new Error('dsh-radar-pta-progress: 候选骨架，未实现（TODO-1）');
}

/**
 * TODO-1（同上）
 *
 * 把若干行聚合成「看起来对」的进度。
 *
 * 必须与 `progress()` 现有字段名保持一致（`total` / `accepted` / `byStatus`），
 * 因为消费方尚未存在 —— 由评审决定是**原地改 campus**，还是**在本包算完再覆盖**。
 *
 * @param {ReadonlyArray<unknown>} rows - `exam-problem-status` 的 `problemStatus`。
 * @returns {{ total: number, accepted: number, wrong: number, untouched: number, byStatus: Record<string, number> }}
 */
export function summarizeProgress(rows) {
  void rows;
  throw new Error('dsh-radar-pta-progress: 候选骨架，未实现（TODO-1）');
}

/**
 * TODO-2（阻塞：状态端点失败时的语义要产品拍板）
 *
 * `problems()` 在状态端点失败时 `catch` 成空 Map，于是每行 `myStatus` 都是 `null`。
 * 实跑（状态端点 403）：
 *   `problems -> [["1",null],["2",null]]`
 * 这与「真的没作答」在返回值上**完全同形**，界面无法区分「你没做过」和「没读到」。
 *
 * 本函数要把「没读到」表达成一个**显式的**未知态，而不是 `null`。
 *
 * @param {unknown} error - `problems()` 里被吞掉的异常。
 * @returns {{ status: 'unknown', reason: string }} 显式未知态。
 */
export function markStatusUnavailable(error) {
  void error;
  throw new Error('dsh-radar-pta-progress: 候选骨架，未实现（TODO-2）');
}

/**
 * TODO-3（需要 campus 先开「客户端」接口，见 README TODO-0）
 *
 * 提交并轮询到评测结束。
 *
 * 上游语义（**逐条读自** `vscode-pintia` `src/ptaExecutor.ts`，本包不复用其代码）：
 *   1. 先 `getProblem` 拿 `type` —— 决定 payload 用
 *      `programmingSubmissionDetail` 还是 `codeCompletionSubmissionDetail`；
 *   2. 再 `getProblemSetPermission`；`MY_PROBLEM_SET(47)` **不自动建 exam**；
 *   3. `getProblemSetExams` → 没有 `exam` 就 `createProblemSetExamAndReturn`；
 *   4. `POST /api/exams/{examId}/submissions`；
 *   5. 轮询 `GET /api/submissions/{id}`，结束判据
 *      `queued === -1 && status ∉ {WAITING, JUDGING}`，
 *      上限 **300 次 × 1s**（约 5 分钟）；自定义样例 60 次。
 *
 * ⚠ 本仓 `pta.js` 里**没有任何** `/submissions`、`/last-submissions`、`createProblemSetExam`
 *   的实现（grep 命中数 0），所以这不是「接一下就有」，而是**新能力**。
 *
 * @param {string} problemSetId - 题集 id（数字串）。
 * @param {string} problemId - 题目 id（数字串）。
 * @param {{ compiler: string, code: string }} solution - 语言与源码。
 * @returns {Promise<unknown>} 评测结果（形状待定，TODO-3）。
 */
export async function submitSolution(problemSetId, problemId, solution) {
  void problemSetId; void problemId; void solution;
  throw new Error('dsh-radar-pta-progress: 候选骨架，未实现（TODO-3）');
}

/**
 * Cordis 插件入口 —— **必须保持抛错**。
 *
 * 本包任何一行都不该在真实环境里生效；`apply()` 抛错在 Cordis 里是整束起不来，
 * 这正是「不可直接使用」该有的表现（与 `dsh-radar-repeat-law` 同一约定）。
 */
export function apply() {
  throw new Error('dsh-radar-pta-progress: 候选骨架，未接入 profile，请勿挂载');
}
