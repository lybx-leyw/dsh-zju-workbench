/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 `package.json` 和注释里：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.3.13`，不是 `^0.3.13`）。
 *      上游的 `dsh` 字段自带 `lockedRuntime: "workflow tool semantics"` 与
 *      `breakingPolicy: "re-validate with npm test after each DSH upgrade"` ——
 *      上游作者自己就声明了「工具语义会随 DSH 升级变化」。`^` 会让
 *      `npm install` 在某次无关的改动里悄悄把工具语义换掉。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次，并把结果
 *      暴露给页面（不抛错：见 `index.js` 的说明）。
 *   3. 后续应补 `tests/radar-deep-read.test.mjs`，用这两个常量断言
 *      「声明、实际安装、代码预期」三者一致 —— 锁版这件事必须有一条会红的测试，
 *      否则它只是一句口号。（本轮仅出骨架，测试留待评审通过后补。）
 */

export const UPSTREAM_PACKAGE = 'deep-read-summarize';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.3.13';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/dsh-deep-read/deep-read-summarize';

/**
 * ⚠ **命名陷阱（2026-10-15 实测）**：
 *
 *   npm 包名是 `deep-read-summarize` —— **没有** `dsh-` 前缀。
 *   尝试 `npm view dsh-deep-read-summarize` 会得到 **E404**。
 *
 *   本仓其他 A 类骨架的上游多带 `dsh-` 前缀（`dsh-better-markdown`、`dsh-web`、
 *   `dshmarket`），容易让人顺手补上前缀。这里把结论固化成常量，
 *   并在测试里断言「**不得**带 `dsh-` 前缀」，避免后续改错。
 */
export const UPSTREAM_NAME_HAS_DSH_PREFIX = false;

/**
 * 上游在 `dsh` 字段里声明的挂载形状（2026-10-15 经 npm registry 核实）：
 *
 *   dsh: {
 *     bundle: { patch: './cordis.patch.yml' },
 *     minVersion: '0.1.0',
 *     lockedRuntime: 'workflow tool semantics — see CHANGELOG.md',
 *     breakingPolicy: 're-validate with npm test after each DSH upgrade'
 *   }
 *
 * **关键观察：`hasClientEntry = false`** —— 上游**只声明了 `bundle`，没有 `dsh.client`**。
 * 对比 `dsh-voice-mode`（`dsh.client.inject` 注入 9 个 UI 分包）可看出区别：
 * 本上游大概率是「**给 Agent 加一个工具**」的形态，而**不自带 UI**。
 *
 * 这直接决定接法：
 *   • 若确为 tool 形态 → **本包不应新增任何 UI**，只在既有页面按钮上调用该工具；
 *     这反而更符合「仍是同一个面板」的强化式集成判据。
 *   • 若实际也带 UI 而未在 `dsh` 字段声明 → 需在评审时重新核实，勿凭猜。
 *
 * 该字段记录在这里的作用是：本包**不自建解析/精读实现**，只做「锁版引入 + 承载」。
 * 真正把产出接进笔记域的那一步属于**编辑性质**，不在本骨架内完成 —— 见 README。
 */
export const UPSTREAM_MOUNT = {
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  hasBundlePatch: true,
  /** 上游 `dsh` 字段未声明 `client` —— 疑为纯 tool 形态，评审时须先确认。 */
  hasClientEntry: false,
  minVersion: '0.1.0',
  engines: { dsh: '>=0.1.0-rc.6', node: '>=18' },
  /** 上游自述：无运行时依赖（npm `dependencies: null`），零传递污染。 */
  runtimeDependencies: null,
};

/**
 * 上游声明的能力边界 —— 用于承载层决定**收窄哪些入口**。
 *
 * 上游覆盖四类材料：书 / 论文 / 视频 / 网页。
 * 本仓场景只明确需要**论文**（论文阅读页）；书与网页可视需要保留；
 * **视频**与本仓既有 `dsh-zhiyun-core-lecture`（讲座）域不同，
 * 是否开放需人工裁定 —— 见 README「需要人工裁定的事项」。
 */
export const UPSTREAM_MATERIAL_KINDS = ['book', 'paper', 'video', 'web'];
