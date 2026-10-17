/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 `package.json` 和注释里：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.1.0`，不是 `^0.1.0`）。
 *      上游处在 `0.x` —— 语义化版本在 0.x 阶段**不承诺兼容**，任何一次
 *      `minor` 都可能改 `dsh.client.inject` 的插槽 id 或 `dsh.bundle.patch`
 *      的形状。`^` 会让 `npm install` 在某次无关的改动里把上游换掉。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次，并把结果
 *      暴露给页面（不抛错：见 `index.js` 的说明）。
 *   3. 后续应补 `tests/radar-session-notebook.test.mjs`，用这两个常量断言
 *      「声明、实际安装、代码预期」三者一致 —— 锁版这件事必须有一条会红的测试，
 *      否则它只是一句口号。（本轮仅出骨架，测试留待评审通过后补。）
 */

export const UPSTREAM_PACKAGE = '@timestatic/dsh-session-notebook';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.1.0';

/**
 * 上游的挂载形状（2026-10-18 核对 npm `0.1.0` 的 `package.json` 得）：
 *
 *   "dsh": {
 *     "bundle": { "patch": "./cordis.patch.yml" },
 *     "client": {
 *       "inject": [
 *         "@deepseek-ai/dsh-client-ui-conversation",
 *         "@deepseek-ai/dsh-client-ui-sidebar-right",
 *         "@deepseek-ai/dsh-client-ui-workspace",
 *         "@deepseek-ai/dsh-client-ui-session"
 *       ],
 *       "platform": "web",
 *       "immediately": true
 *     }
 *   }
 *
 * ⚠ **这是本候选最大的适配风险**：上游会往**四个宿主插槽**里各自注入 UI。
 * 本仓的「今天」/「笔记」页是**自有面板**（自有前缀路由 + 自有插槽），
 * 不是一个全站外壳。若直接整包挂载，划线控件会出现在**每一个**会话界面上，
 * 而这是本仓明确不想有的东西（见 README「三条判据」第 1 条）。
 *
 * 因此本包（候选、未实现）的做法是：
 *   - **只挂宿主半边**（`src/host/index.js` 里的路由与存储）；
 *   - 客户端**不复用**上游的四个 inject，改由本包自有面板按需调用；
 *   - 若上游没有把「客户端」与「宿主」拆成两个入口，则**降级为 🟡 源码级移植**，
 *     不再走锁版挂载路线。评审时请先确认这一点。
 */
export const UPSTREAM_CLIENT_INJECTS = Object.freeze([
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-sidebar-right',
  '@deepseek-ai/dsh-client-ui-workspace',
  '@deepseek-ai/dsh-client-ui-session',
]);

/**
 * 许可证的**双源核对**（2026-10-18 实测，两源不一致，须人工看一眼）：
 *
 *   - GitHub API `license.spdx_id` → **Apache-2.0**；仓库根 `LICENSE` 正文为
 *     Apache License 2.0（已读前 400 字确认）。
 *   - npm `0.1.0` 的 `package.json` → `license` 字段**缺失**（`null`）。
 *
 * 结论：**取仓库 LICENSE 与 GitHub 元数据为准，判 Apache-2.0 ✅**，
 * 但发布产物里没有声明许可证这一条，应在评审时向上游提 issue（低风险：
 * GitHub 仓库即上游本人的 canonical 源，非 fork、非二次分发）。
 */
export const UPSTREAM_LICENSE = 'Apache-2.0';
