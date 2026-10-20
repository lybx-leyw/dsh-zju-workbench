/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 与 `dsh-zhiyun-host-paper/src/upstream.js`、`dsh-radar-market/src/upstream.js` 同一套做法，
 * 理由也相同，此处只记本包特有的部分：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.0.1`，不是 `^0.0.1`）。
 *      本包把上游的**宿主半边**挂进来跑，它的读法是 dsh 的 plugin manifest 与
 *      用户的 profile —— 这些都不是稳定的公开协议，patch 版本就可能改形状；
 *      `^` 会让 `npm install` 在某次无关的改动里悄悄把它换掉。
 *   2. 光锁 `package.json` 不够：真实的 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次，并把结果暴露给
 *      页面（**不抛错**：见 `index.js` 的说明）。
 *   3. 两份声明必须逐字符一致：`package.json` 的 `dsh-web` 依赖 = `UPSTREAM_VERSION`，
 *      并由 `tests/radar-packages.test.mjs` 断言三者（声明 / 预期 / 磁盘实际）一致。
 *
 * # 本包特有的一个风险：版本号太空
 *
 * 上游 npm 包 `dsh-web` 目前**只有 `0.0.1` 这一个版本**，`dist-tags` 也只有 `latest`。
 * 「0.0.1 + 单版本」意味着两件事：
 *
 *   - 上游的发布节奏与语义化承诺**都还没形成**，任何一次发版都可能是破坏性的；
 *   - 也正因为只有这一个版本，`0.0.1` 这个锁**实际上锁不住任何东西** —— 锁版的
 *     保护力在下一次发版才会真正生效，届时必须重新核对协议形状并更新此处。
 *
 * 这是把本候选排在 `dsh-radar-market`（上游 161 个版本、1.66.x 已稳定）之后的
 * 主要原因之一。
 */

export const UPSTREAM_PACKAGE = 'dsh-web';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.0.1';

/** 上游仓库，供 README 与人工复核对照。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/zhu1090093659/dsh-web';
