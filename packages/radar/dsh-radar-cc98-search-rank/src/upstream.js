/**
 * 上游 `cc98-searchpro` 的锁定信息。
 *
 * ⚠ 本文件只记录**事实**（我用 `npm registry` / GitHub API / 下载 tarball 实核到的），
 *   不带任何上游代码。骨架阶段不允许把上游源码搬进本仓。
 */

/** 上游包名（npm 上**未登记**，见下方 `UPSTREAM_DIST` 的注解）。 */
export const UPSTREAM_PACKAGE = 'cc98-searchpro'

/** 锁死版本：写死，不用 `^`（`package.json` 的 `dependencies` 与本文件必须一致）。 */
export const UPSTREAM_VERSION = '0.1.0'

export const UPSTREAM_REPOSITORY = 'https://github.com/Vita0818/CC98-SearchPro'

export const UPSTREAM_LICENSE = 'MIT'

/**
 * 取包方式：npm 命名空间下**没有** `cc98-searchpro`（`registry.npmjs.org` 返回
 * `{"error":"Not found"}`），但上游在 GitHub Release 里挂了可直接 `npm i` 的 tarball。
 * `package.json` 里那条 `"cc98-searchpro": "0.1.0"` 因此**装不上**，评审前必须先改成
 * 下面这个 URL（或换成 `github:Vita0818/CC98-SearchPro#v0.1.0`）—— 这是骨架的已知缺陷，
 * 不要试图 `npm i` 验证。
 */
export const UPSTREAM_DIST = {
  tarball: 'https://github.com/Vita0818/CC98-SearchPro/releases/download/v0.1.0/cc98-searchpro-0.1.0.tgz',
  /** tarball 大小（字节），用于下载后校验。 */
  bytes: 335626,
  tag: 'v0.1.0',
  publishedAt: '2026-10-23T07:38:32Z',
}

/**
 * 上游真正要借的模块（tarball 内已编译，无需 tsc）。
 *
 * | 模块 | 导出的东西 | 本包怎么用 |
 * | --- | --- | --- |
 * | `dist/search/rank.js` | `queryPlan` / `rank` / `compare` / `timestamp` / `SCORES` | 直接调，产生排序与证据等级 |
 * | `dist/search/queryVariants.js` | `generateVariants` / `normalizeQuery` / `hanRunSlices` | 由 `queryPlan` 内部调用，本包不直接调 |
 * | `dist/text.js` | `readableText` / `searchText` / `snippet` | 首帖 UBB → 可检索文本 → 命中片段 |
 *
 * 都是**纯函数**（无 `fetch`、无 `fs`、无全局状态），这是能「只借检索层」的前提。
 */
export const UPSTREAM_MODULES = {
  rank: 'cc98-searchpro/dist/search/rank.js',
  text: 'cc98-searchpro/dist/text.js',
}

/**
 * 上游**不**具备的形态（所以这里是「兼容层」，不是「挂载」）。
 *
 * - 上游**没有** `dsh.bundle.patch`、没有 `cordis.patch.yml`、没有 `dsh.client`
 *   —— 它是 Codex 插件 + MCP server，不是 DSH 原生插件包。
 * - 它的入口是 `runtime/server.mjs`（esbuild 打包，内含 `@modelcontextprotocol/sdk@1.32.1`
 *   + `zod@4.6.5`，整包约几百 KB），起的是 stdio MCP 进程。
 * - 它**只读**：不含发帖/回帖/私信/点赞。
 *
 * 因此本包**不** `insert` 上游、**不**起 MCP 子进程、**不**挂它的 `runtime/`；
 * 只把上面两个纯函数模块锁版引入，套在本仓 `dsh-zhiyun-source-cc98` 的 search 动作外面。
 */
export const UPSTREAM_INTEGRATION_SHAPE = {
  native: false,
  hasBundlePatch: false,
  hasCordisPatch: false,
  readOnly: true,
  extraRuntimeDeps: ['@modelcontextprotocol/sdk@1.32.1', 'zod@4.6.5'],
}

/**
 * 上游 `dist/search/rank.js` 的分级常量（**这是上游的公开 API 语义，不是源码搬运**）：
 * `exact-title 1000 > exact-content 900 > all-words-title 700 > all-words-content 500 > weak 100`。
 * 「证据等级」一词在上游是 `tier`，`verification` 取 `not_checked` / `checked` / `unavailable`。
 *
 * 与 CC98 官方搜索接口的关系（上游 `engine.ts` 实测所得）：
 * - 服务端 `/topic/search` **按标题**匹配，且对连写中文的切分不可靠；
 * - 上游的做法是多发几次**查询变体**（整串 + 二元切片），再在**本地**按「标题/首帖正文
 *   是否含完整短语」重排 —— 即：**召回靠服务端，排序与验证靠本地**。
 */
export const UPSTREAM_RANK_MODEL = {
  tiers: ['exact-title', 'exact-content', 'all-words-title', 'all-words-content', 'weak'],
  verification: ['not_checked', 'checked', 'unavailable'],
  recall: 'server: /topic/search（标题匹配）',
  rerank: 'local: 标题/首帖正文短语命中',
}
