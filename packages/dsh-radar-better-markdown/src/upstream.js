/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 `package.json` 和注释里：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.1.2`，不是 `^0.1.2`）。
 *      上游是 Web 端渲染插件，`dsh.bundle.patch` 指向它自己的 `cordis.patch.yml`，
 *      形状（挂载点 id、暴露的 client 入口）在小版本里就可能变；`^` 会让
 *      `npm install` 在某次无关的改动里悄悄把渲染器换掉。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次，并把结果
 *      暴露给页面（不抛错：见 `index.js` 的说明）。
 *   3. 后续应补 `tests/radar-better-markdown.test.mjs`，用这两个常量断言
 *      「声明、实际安装、代码预期」三者一致 —— 锁版这件事必须有一条会红的测试，
 *      否则它只是一句口号。（本轮仅出骨架，测试留待评审通过后补。）
 */

export const UPSTREAM_PACKAGE = 'dsh-better-markdown';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.1.2';

/**
 * 上游在 `dsh` 字段里声明的挂载形状（2026-10-15 经 npm registry 核实）：
 *
 *   dsh: { bundle: { patch: './cordis.patch.yml' }, client: ... }
 *
 * 记在这里的作用是：本包**不自建渲染实现**，只做「锁版引入 + 承载」。
 * 真正把渲染器接进面板的那一步（替换论文页 / 笔记页的呈现区）属于**编辑性质**，
 * 不在本骨架内完成 —— 见 README 的「集成方式」。
 */
export const UPSTREAM_MOUNT = {
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  hasBundlePatch: true,
  hasClientEntry: true,
};
