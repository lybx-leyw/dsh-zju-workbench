/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 效法 `packages/dsh-radar-lookatstudy/src/upstream.js` 与 `packages/dsh-zhiyun-host-paper`：
 * 把版本号单独放一个模块，而不是散在 `package.json` 和注释里。原因：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（不是 `^`）。上游是 Cordis 插件形态，
 *      `dsh.bundle.patch` 指向它自己的补丁文件，挂载形状在小版本里就可能变；
 *      `^` 会让 `npm install` 在某次无关改动里悄悄把挂载形状换掉，
 *      而本仓的承载层是按旧形状写的。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次。
 *   3. 后续应补测试，用这两个常量断言「声明、实际安装、代码预期」三者一致 ——
 *      锁版这件事必须有一条会红的测试，否则它只是一句口号。
 *      （本轮仅出骨架，测试留待评审通过后补。）
 *
 * ⚠ **以下两行均为占位，尚未经 registry 核实** —— 采用前必须替换为真实值。
 *
 * 2026-10-20 复核：`npm view @perrylink/dsh-score` 返回 **E404**，该包在 npm 上
 * **不存在**（GitHub 仓库 `PerryLink/dsh-score` 也没有发布 npm 包的迹象）。
 * 因此 `package.json` 里**不能**写这条依赖：占位版本号（`0.0.0-TODO-锁版待定`）
 * 会让整个仓库的 `npm install` 直接 `EINVALIDTAGNAME` 失败，而装上也不会有任何东西。
 * 现在的做法与 `dsh-radar-career-calendar` 一致：**未核实上游就不声明依赖**，
 * 线索留在这里，等评审确认真实包名与版本后再补。
 */

/**
 * ⚠ 上游**尚未核实**，因此本文件**不声明** `UPSTREAM_PACKAGE` / `UPSTREAM_VERSION`。
 *
 * 与 `dsh-radar-career-calendar` 同一处理：没有可信的上游包名与版本，就不摆一对
 * 「看起来像锁版凭据」的常量 —— 那会让读者以为锁版已经完成。线索留在下面：
 *
 *   上游（待核实）在 npm 上的包名：`@perrylink/dsh-score`（2026-10-20 复核为 E404）
 *   上游（待核实）版本：无（npm 上不存在该包）
 *
 * 评审确认真实包名与版本后，再同时补 `dependencies` 与这两个常量，
 * `tests/radar-packages.test.mjs` 会自动把这条纳入锁版断言。
 */

/**
 * 上游信息（2026-10-16 经 GitHub API 核实）：
 *
 *   仓库：https://github.com/PerryLink/dsh-score
 *   许可证：Apache-2.0
 *   语言：TypeScript
 *   ★：12，fork：0
 *   最近 push：2026-10-12
 *   描述：Multi-dimensional quality scoring for DeepSeek Harness plugins —
 *         scores a repo or npm package across install success
 *         (consuming dsh-test-drive results), maintenance activity,
 *         documentation completeness …
 *
 * **本包不自建评分模型**，只做「锁版引入 + 承载 + 接进既有「插件」页」。
 * 这正是强化式集成第 3 条（底层多调了更优质的实现）的落点 ——
 * 评分逻辑留在上游，本仓不重复实现。
 *
 * ⚠ **风险提示（评审重点）**：上游 ★ 仅 12、fork 0、创建于 2026-08-17，
 * 属**早期项目**。采用前须在隔离环境跑通，并确认其评分数据来源的稳定性与可离线程度。
 */
