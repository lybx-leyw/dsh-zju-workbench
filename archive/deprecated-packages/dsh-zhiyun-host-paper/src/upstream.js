/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 package.json 和注释里：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`1.3.1`，不是 `^1.3.1`）。
 *      上游的客户端/宿主协议是自渲染 HTML + 私有 HTTP 路由，小版本就可能改
 *      路由形状；`^` 会让 `npm install` 在某次无关的改动里悄悄把阅读器换掉。
 *   2. 光锁 `package.json` 不够 —— 真实的 `node_modules` 里装的是什么，取决于
 *      别人的 lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次，
 *      并把结果暴露给页面（不抛错：见 `index.js` 的说明）。
 *   3. `tests/paper.test.mjs` 用这两个常量断言「声明、实际安装、代码预期」
 *      三者一致 —— 锁版这件事必须有一条会红的测试，否则它只是一句口号。
 */

export const UPSTREAM_PACKAGE = '@ggboy123/dsh-paper-reader';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '1.3.1';
