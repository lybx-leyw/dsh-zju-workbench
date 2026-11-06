/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 与 `dsh-radar-market/src/upstream.js`、`dsh-zhiyun-host-paper/src/upstream.js` 同一套做法：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.4.4`，不是 `^0.4.4`）。
 *      上游把「装插件」这件事落在 profile 上，读的是 `dsh-cli` / profile / 用户的
 *      `cordis.patch.yml` —— 都不是稳定公开协议，小版本也可能改形状。
 *   2. 锁 `package.json` 不够，运行时还要核一次真实的 `node_modules`；
 *      结果暴露给页面（**不抛错**，见 `index.js`）。
 *   3. 两份声明必须逐字符一致：`package.json` 的 `dsh-research` 依赖 = `UPSTREAM_VERSION`。
 */

export const UPSTREAM_PACKAGE = 'dsh-research';

/** 我们适配并核对过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.4.4';

/** 上游仓库，供 README 与人工复核对照。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/dsh-research/dsh-research';

/**
 * 上游的 bundle 行 id（取自上游 `cordis.patch.yml` 的 `insert[0].id`）。
 * 人工评审时要确认：本包与上游**不会**各自插入一行，导致同一个面板挂两次。
 */
export const UPSTREAM_PATCH_ROW_ID = 'research-market';
