/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zhiyun-paper/src/upstream.js`。
 *
 * 为什么这个骨架虽然是「B 类上游」，仍然要单列一个 upstream 模块：
 *
 *   1. `skott` 是**宿主侧**依赖（要读 `fs` 与 `node_modules`），一旦把版本放开成 `^0.35.12`，
 *      上游任何 0.x 小版本都可能在 `ctx.modules.manifest` 形状之外再加一层（它在 0.35 里
 *      换过插件的注入方式），而本包的接线假设正是建立在这个形状上。
 *   2. 我们**不复制** skott 的任何源码：只调它的公开入口，把结果映射成页面已有的图结构。
 *      因此「锁版」不仅是稳定性措施，也是唯一能保证「我们调的是哪套 API」的手段。
 *   3. 版本号必须与 `package.json` 的 `dependencies.skott` **逐字符相同**。
 *      真实安装的版本由 `npm ls skott` 核对，不得信任本文件。
 */

export const UPSTREAM_PACKAGE = 'skott';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.35.12';

/** 上游许可证（用于 README / ATTRIBUTION 的核对，不参与运行时逻辑）。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 上游入口的**占位**：评审通过后在这里做「一次调用 → 一张图」的封装。
 *
 * 实现时必须遵守的三条（与 `dsh-zhiyun-paper` 的 upstream 层同规）：
 *   - 只调 `skott` 的公开导出（`buildSkottGraph` / `SkottConfig` 等），**不深挖 `dist/` 内部路径**；
 *   - 上游抛错不得穿透到宿主：返回 `{ ok:false, error }`，由调用方决定是否退回运行时图；
 *   - 不把 skott 的原始图对象直接交给 React（它有环引用与 Map，序列化会炸）。
 *
 * @returns {Promise<{ ok: boolean, graph?: unknown, error?: string }>}
 */
export async function buildModuleGraph(_options) {
  return { ok: false, error: 'candidate skeleton: not implemented' };
}
