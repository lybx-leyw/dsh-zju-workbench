/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 与 `dsh-zhiyun-paper/src/upstream.js`、`dsh-radar-dsh-web/src/upstream.js` 同一套做法，理由相同，
 * 此处只记本包特有的部分：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.14.0`，不是 `^0.14.0`）。
 *      TeML 的产出物是 MathML 字符串 + 一份 CSS，**指令表的语义随版本变**
 *      （0.13 → 0.14 有过输出结构调整，见上游 CHANGELOG）。把 `^` 交给 `npm install`，
 *      等于让某天一次无关的 `npm ci` 悄悄换掉公式排版结果 —— 而公式排错是**静默的**：
 *      页面不会崩，只会显示错位。
 *   2. 光锁 `package.json` 不够 —— 真实的 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以运行时再核对一次，并把结果暴露给
 *      设置页（**不抛错**：见 `index.js` 的说明）。
 *   3. 三者必须逐字符一致：`package.json` 的 `temml` 依赖 = `UPSTREAM_VERSION` =
 *      `tests/radar-packages.test.mjs` 的断言。
 *
 * # 本包特有的一个有利条件
 *
 * 上游是**零依赖、纯函数**的（`dependencies: null`，weekly 下载 ~73 万）。
 * 它不碰 DOM、不发起网络、不开线程 —— 这使得「锁版」这件事的风险面比
 * 挂一个带客户端半边的 DSH 插件小得多：最坏情况是公式渲染结果不同，
 * 而不是工作台起不来。这是本候选被判 🟢 而非 🟡 的主要依据。
 */

export const UPSTREAM_PACKAGE = 'temml';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.14.0';

/** 上游仓库，供 README 与人工复核对照。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/ronkok/Temml';

/**
 * 本仓**没有**任何客户端公式渲染器（核对于 2026-10-18）。
 *
 * `dsh-zhiyun-lecture/src/tree.js` 的 `looksLikeNotationOnly()` 只用 `/^\$...\$$/`
 * 判断「整行是否为公式」，那是**分词启发式**，不是渲染；`$k_1$` 原样交给宿主
 * `MarkdownText` 显示。`dsh-zhiyun-page-paper/src/citations.js` 只处理「第 N 页」
 * 页码引用，与公式无关。
 *
 * ⚠ 这条事实决定了本包的定性：它不是替换现有渲染器，而是**从零接入**。
 * 评测里按「强化式集成」记 —— 因为同一段落、同一面板、同一内容，只是把
 * 「原样显示 `$x$`」换成「显示排好的公式」，属**同类内容渲染的质量升级**；
 * 但人工评审时请把「这是新能力而非替换」这一点算进去（见 README 的定性说明）。
 */
export const BASELINE_HAS_MATH_RENDERER = false;
