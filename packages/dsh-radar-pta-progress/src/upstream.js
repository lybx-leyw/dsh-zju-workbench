/**
 * 上游封装占位 —— **不写业务逻辑，只固定形状**。
 *
 * 本包与 `dsh-radar-repeat-law` 有一处本质不同：那个的上游是 **npm 可锁版的 A 类插件**，
 * 这个的上游是 **VS Code 扩展、npm 404、且是 B 类（不是 DSH 插件）**。
 * 所以「锁版挂载」在这里**不成立**，本文件存在的意义是：
 *
 *   1. 把「上游是什么、能不能装、能抄到哪一层」写死在一个地方，评审一眼看完；
 *   2. 明确 **不复制上游源码** —— 只提炼协议事实（端点、字段、轮询判据）；
 *   3. 把「真要复用」时唯一合法的路径（vendor 一个被裁剪的 `src/utils`）标成 TODO 待裁。
 *
 * ⚠ 本文件**不 import 任何东西**，包括上游。
 */

/** 上游仓库（只作对照物，不是依赖）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/jinzcdev/vscode-pintia';

/** 上游版本：`package.json.version = "0.11.0"`，`preview: true`（本轮实查）。 */
export const UPSTREAM_VERSION = '0.11.0';

/** 许可证：仓库根 `LICENSE` **1,073 B 全文读过**，`Copyright (c) 2022-present jinzcdev`，正文为标准 MIT，无附加限制。 */
export const UPSTREAM_LICENSE = 'MIT';

/** npm：`registry.npmjs.org/vscode-pintia` → **HTTP 404 `{"error":"Not found"}`** → **不可锁版**。 */
export const UPSTREAM_NPM_PACKAGE = null;

/** 作者：`Zhichao Jin`（`package.json.author`），GitHub owner `jinzcdev`。 */
export const UPSTREAM_AUTHOR = 'Zhichao Jin';

/**
 * 上游「是什么 / 不是什么」。
 *
 *   是：一个 **VS Code 扩展**（`engines.vscode ^1.66.0`、`main: ./out/extension`），
 *       把 PTA 的**读题、提交、看评测结果、答题计时、题目搜索**做完了；协议层集中在
 *       `src/utils/api.ts`（25 KB，35 个 async 方法）。
 *   不是：一个可复用的库。它没有 `exports`、没有 npm 包、`main` 指向编译产物，
 *       业务层与 `vscode.*` API（TreeView / Webview / StatusBar）深度耦合。
 *
 * → 本包对它的定位是「**协议字典 + 语义参照**」，不是「依赖」。
 */
export const UPSTREAM_NATURE = Object.freeze({
  kind: 'vscode-extension',
  npm: 'absent',
  lockable: false,
  protocolLayer: 'src/utils/api.ts',
  hardDependency: 'vscode',
});

/**
 * 上游已验证过的端点（**协议事实**，非代码复制）。
 *
 * 本仓 `pta.js` 已有：`/problem-sets`、`/problem-summaries`、`/exam-problem-list`、
 * `/exam-problem-status`、`/exam-problems/{pid}`。
 * 本仓**完全没有**的写链路端点，全部来自这里：
 */
export const UPSTREAM_ENDPOINTS = Object.freeze({
  examPermission: 'GET  /api/problem-sets/{psID}/exams           → permission / exam',
  createExam: 'POST /api/problem-sets/{psID}/exams               → 个人题集不建（permission=47）',
  submit: 'POST /api/exams/{examID}/submissions',
  submissionResult: 'GET  /api/submissions/{submissionID}',
  customTestResult: 'GET  /api/submissions/{submissionID}?custom_test_data_submission=true',
  lastSubmissions: 'GET  /api/problem-sets/{psID}/last-submissions?problem_set_problem_id={pID}',
  /**
   * ⚠ 第三个实现用了**另一个**状态端点：
   *   `lj200612/pintia-problemset-toolkit` `pta/client.py`
   *   `GET /api/exams/{examID}/problem-sets/{psID}/problem-status`
   * 本仓与 vscode-pintia 都用 `/exam-problem-status`。两者**是否等价未核**（TODO-4）——
   * 不要因为「多一个端点」就断定本仓的读法不对。
   */
  altProblemStatus: 'GET /api/exams/{examID}/problem-sets/{psID}/problem-status（第三方实现）',
});

/**
 * 上游的轮询语义（数值也属协议事实，便于评审对照）。
 *
 * 上游 `src/utils/polling.ts` 的注释写明它**刻意不用 `setInterval`**：
 * 定时器清理只写在成功分支上，接口失败时会永久轮询。这条经验本仓若实现提交必须照做。
 */
export const UPSTREAM_POLLING = Object.freeze({
  intervalMs: 1000,
  submissionMaxAttempts: 300,
  testMaxAttempts: 60,
  doneWhen: 'queued === -1 && status not in {WAITING, JUDGING}',
  pattern: 'for + await sleep（不用 setInterval）',
});

/**
 * TODO-5（不阻塞，但评审要知道代价）
 *
 * 若最终决定「不再自写、直接 vendor 上游 `src/utils/api.ts` + `polling.ts`」：
 *   - 文件合计约 **28 KB**（api.ts 25,575 B + polling.ts ≈ 2.4 KB，本轮实查）；
 *   - 但 `api.ts` 依赖 `node-fetch`、`fs-extra`、`memory-cache`、`l10n`、`pintia.cn`
 *     固定域名、以及一个进程级 `getSession()` 单例 —— 后四条与本仓的
 *     `Transport`（统一出口 / WebVPN / cookie jar）**冲突**；
 *   - 结论倾向：**只借语义、自写协议层**（本骨架的默认方案）；vendor 需另开评审。
 */
export function loadUpstream() {
  throw new Error('dsh-radar-pta-progress: 候选骨架，上游不可锁版（npm 404），无加载路径（TODO-5）');
}
