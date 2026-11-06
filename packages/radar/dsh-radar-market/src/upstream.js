/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 与 `dsh-zhiyun-host-paper/src/upstream.js` 同一套做法，理由也相同，此处只记本包特有的部分：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`1.66.21`，不是 `^1.66.21`）。
 *      本包把上游的**宿主半边**（`lib/index.js`，含 catalog / install / profile / patch /
 *      registry 等一整套）挂进来跑，它的读法是 `dsh-cli`、profile 与用户 `cordis.patch.yml`
 *      ——这些都不是稳定的公开协议，patch 版本就可能改形状；`^` 会让 `npm install`
 *      在某次无关的改动里悄悄把它换掉。
 *   2. 光锁 `package.json` 不够：真实的 `node_modules` 里装的是什么，取决于别人的 lockfile、
 *      全局覆盖、`npm link`。所以还要在**运行时**核对一次，并把结果暴露给页面
 *      （**不抛错**：见 `index.js` 的说明）。
 *   3. 两份声明必须逐字符一致：`package.json` 的 `dshmarket` 依赖 = `UPSTREAM_VERSION`。
 */

export const UPSTREAM_PACKAGE = 'dshmarket';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '1.66.21';

/** 上游仓库，供 README 与人工复核对照。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/dsh-market/dsh-market';
