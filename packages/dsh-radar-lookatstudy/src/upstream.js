/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 `package.json` 和注释里：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.26.3`，不是 `^0.26.3`）。
 *      上游是 Web 端插件，`dsh.bundle.patch` 指向它自己的 `cordis.patch.yml`，
 *      且 `dsh.client.inject` 声明了 4 个注入点（`slots`/`workspaces`/`sessions`/`locale`）——
 *      这种「挂载形状 + 注入点清单」在小版本里就可能变；`^` 会让 `npm install`
 *      在某次无关改动里悄悄把挂载形状换掉，而本仓的承载层是按旧形状写的。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次，并把结果
 *      暴露给页面（不抛错：见 `index.js` 的说明）。
 *   3. 后续应补 `tests/radar-lookatstudy.test.mjs`，用这两个常量断言
 *      「声明、实际安装、代码预期」三者一致 —— 锁版这件事必须有一条会红的测试，
 *      否则它只是一句口号。（本轮仅出骨架，测试留待评审通过后补。）
 */

export const UPSTREAM_PACKAGE = 'dsh-plugin-lookatstudy';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.26.3';

/**
 * 上游在 `dsh` 字段里声明的挂载形状（2026-10-16 经 npm registry 核实）：
 *
 *   dsh: {
 *     bundle: { patch: './cordis.patch.yml' },
 *     client: {
 *       inject: ['slots', 'workspaces', 'sessions', 'locale'],
 *       platform: 'web',
 *       immediately: true
 *     }
 *   }
 *
 * `dependencies` 为**空**（零运行时依赖），`peerDependencies` 为宿主侧
 * `@deepseek-ai/cordis` / `dsh-client-ui-conversation` / `dsh-tools` / `schemastery`
 * 与 `react`/`react-dom`（`engines.node >= 22.19`）。
 *
 * 记在这里的作用是：本包**不自建掌握度模型与技能树**，只做「锁版引入 + 承载」。
 * 真正把上游接进面板、并决定它接管哪一块 UI 的那一步属于**编辑性质**，
 * 不在本骨架内完成 —— 见 README 的「接入边界」。
 */
export const UPSTREAM_MOUNT = {
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  hasBundlePatch: true,
  hasClientEntry: true,
  /** 上游声明的注入点，承载层需逐一对照，避免与既有页面争抢同一 slot。 */
  injectPoints: ['slots', 'workspaces', 'sessions', 'locale'],
  runtimeDependencies: [],
};
