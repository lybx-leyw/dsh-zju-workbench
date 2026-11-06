/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 `package.json` 和注释里：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.71.0`，不是 `^0.71.0`）。
 *      上游 `dsh` 字段自带 `compatibility.dshReleases` 白名单 ——
 *      它在**逐个 DSH 版本**上声明「compatible / 不兼容」。`^` 会让
 *      `npm install` 在某次无关的改动里悄悄越过白名单。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次，并把结果
 *      暴露给页面（不抛错：见 `index.js` 的说明）。
 *   3. 后续应补 `tests/radar-context-dashboard.test.mjs`，用这两个常量断言
 *      「声明、实际安装、代码预期」三者一致 —— 锁版这件事必须有一条会红的测试，
 *      否则它只是一句口号。（本轮仅出骨架，测试留待评审通过后补。）
 */

export const UPSTREAM_PACKAGE = 'dsh-context';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.71.0';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/gordonlu/dsh-context';

/**
 * ⚠ **版本号异常大（2026-10-15 实测）**：
 *
 *   上游 npm 版本是 `0.71.0` —— 对 ★2134、推送频繁（2026-10-14）的项目来说，
 *   这个 minor 号意味着**上游迭代极快**。本仓其他 A 类骨架的上游多在 `0.1.x`/`0.3.x`，
 *   容易被「顺手写个 `^0.71.0` 图省事」。
 *
 *   结论固化成常量：**版本必须写死**，且升级需人工重新核 `compatibility.dshReleases`。
 */
export const UPSTREAM_VERSION_IS_HIGH_CHURN = true;

/**
 * 上游在 `dsh` 字段里声明的挂载形状（2026-10-15 经 npm registry 核实）：
 *
 *   dsh: {
 *     bundle: { patch: './cordis.patch.yml' },
 *     client: {
 *       inject: [
 *         '@deepseek-ai/dsh-api-remotes',
 *         '@deepseek-ai/dsh-client-connection',
 *         '@deepseek-ai/dsh-client-locale',
 *         '@deepseek-ai/dsh-client-ui-conversation',
 *         '@deepseek-ai/dsh-client-ui-settings',
 *         '@deepseek-ai/dsh-client-ui-sidebar-right'
 *       ],
 *       platform: 'web'
 *     },
 *     compatibility: { dshReleases: { '0.1.7-rc.2': 'compatible', '0.2.0-rc.2': 'compatible' } }
 *   }
 *
 * **关键观察：`hasClientEntry = true`** —— 与 `deep-read-summarize`（只声明 `bundle`）
 * 不同，本上游**自带 UI**，且明确注入 `dsh-client-ui-sidebar-right`（右侧栏）
 * 与 `dsh-client-ui-settings`（设置页）。这直接决定接法：
 *   • 它**不是**纯 tool，而是「面板型插件」，会往右侧栏与设置页挂东西；
 *   • 因此评审必须裁定**它与本仓右侧栏 / 设置页的既有内容如何共存**，
 *     而不是简单地「多调一个工具」。
 *
 * 该字段记录在这里的作用是：本包**不自建上下文统计/可视化实现**，只做「锁版引入 + 承载」。
 * 真正把它挂进右侧栏的那一步属于**编辑性质**，不在本骨架内完成 —— 见 README。
 */
export const UPSTREAM_MOUNT = {
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  hasBundlePatch: true,
  /** 上游 `dsh.client.inject` 声明注入 6 个 UI 分包 —— **自带 UI，非纯 tool**。 */
  hasClientEntry: true,
  clientPlatform: 'web',
  /** 上游自述的 DSH 版本白名单；本仓当前版本须落在其中才可挂载。 */
  dshReleasesCompatibility: {
    '0.1.7-rc.2': 'compatible',
    '0.2.0-rc.2': 'compatible',
  },
  engines: { node: '^22.19.0 || >=24.0.0' },
  /** 上游运行时依赖：仅 `zod`（`^4.4.3`），传递污染极小。 */
  runtimeDependencies: { zod: '^4.4.3' },
  /** 上游 peerDependencies：react / react-dom / cordis / dsh-session 等宿主提供。 */
  peerDependencies: {
    react: '^18.3.1',
    'react-dom': '^18.3.1',
    '@deepseek-ai/cordis': '^4.0.4',
    '@deepseek-ai/dsh-session': '>=0.1.7-rc.2',
    '@deepseek-ai/schemastery': '^3.18.2',
    '@deepseek-ai/dsh-client-ui-primitives': '>=0.1.7-rc.2',
  },
};

/**
 * 上游声明的能力边界 —— 用于承载层决定**收窄哪些入口**。
 *
 * 上游覆盖四块：上下文**统计**（statistics）/ **构成**（composition）/
 * **分解**（breakdown）/ **演化**（evolution），形态为
 * 「dashboard + browser + sidebar + context 命令」四入口。
 *
 * 本仓场景只需要**统计与构成**两块（贴在「今天」页与「问一问」的上下文预算上）；
 * **browser（逐条浏览）**与 **evolution（历史演化）**对学习工作台收益存疑，
 * 是否开放需人工裁定 —— 见 README「需要人工裁定的事项」。
 */
export const UPSTREAM_CAPABILITY_KINDS = [
  'context-statistics',
  'context-composition',
  'context-breakdown',
  'context-evolution',
];
