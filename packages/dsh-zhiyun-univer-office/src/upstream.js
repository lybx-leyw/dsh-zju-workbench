/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 与 `dsh-zhiyun-paper/src/upstream.js` 同一条理由：把版本号单独放一个模块，
 * 让「声明（package.json）」「代码预期（这里）」「实际安装」三者能被一条会红的
 * 测试同时断言 —— 否则锁版只是一句口号。
 *
 * 为什么这个包要锁版：上游是本仓**唯一**引入 Office 能力的口子，它的宿主半边
 * 挂了 `/univer-viewer` 路由并注册 14 个 agent 工具，客户端半边注入 7 个宿主 UI 包。
 * 这些形状在小版本里就可能变，`^` 会让 `npm install` 在某次无关改动里悄悄换掉它。
 */

export const UPSTREAM_PACKAGE = 'dsh-univer-office';

/** 我们适配并验证过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.3.7';
