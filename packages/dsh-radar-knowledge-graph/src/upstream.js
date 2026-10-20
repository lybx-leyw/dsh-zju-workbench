/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 与 `dsh-zhiyun-host-paper/src/upstream.js`、`dsh-radar-context-lens/src/upstream.js` 同一套理由：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.1.3`，不是 `^0.1.3`）。
 *      上游仍在 0.1.x（npm 上 4 个版本全在 2026-09-01 一天内发布），
 *      抽取本体（第一套 8 类节点 / 12 类关系，第二套《学习观》18 类节点 / 21 类关系）
 *      与 store 结构都可能变；`^` 会让 `npm install` 把抽取口径换掉，
 *      而画出来的图看上去仍然「像那么回事」—— 这种漂移最难发现。
 *   2. 光锁 `package.json` 不够：真实 `node_modules` 里装的是什么取决于别人的 lockfile、
 *      全局覆盖、`npm link`。所以还要在**运行时**核对一次。
 *   3. 将来补 `tests/` 时用这几个常量断言「声明 = 实际安装 = 代码预期」三者一致。
 *
 * > ⚠️ **npm 与 GitHub 版本号不一致**（已实测）：仓库 `package.json` 为 `1.0.1`，
 * > npm `latest` 为 `0.1.3`。本骨架**以 npm 为准**（锁版引入的是 npm 包），
 * > 并把这一差异写进 README 的「已知风险」，评审时须确认两者是否同源构建。
 */

export const UPSTREAM_PACKAGE = 'dsh-knowledge-graph';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.1.3';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPO = 'https://github.com/cwbcheng/dsh-knowledge-graph';

/** 上游许可证：MIT（GitHub API `license.spdx_id = MIT`，`LICENSE` 实文首行已比对）。 */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游 npm `peerDependencies`（`0.1.3` 实测值）。 */
export const UPSTREAM_PEERS = Object.freeze({
  '@deepseek-ai/cordis': '*',
  react: '^18.2.0',
});

/**
 * 读取上游运行时版本。骨架阶段**不实现** —— 保持与 paper 包同形，
 * 以便评审通过后直接照抄那边的实现。
 *
 * TODO（评审通过后）：解析 `node_modules/${UPSTREAM_PACKAGE}/package.json` 的 `version`，
 * 与 `UPSTREAM_VERSION` 比对；不一致时**不抛错**，而是把结果暴露给页面
 * （锁版失败应当在界面上可见，而不是让整页挂掉）。
 */
export function readInstalledVersion() {
  throw new Error('骨架占位：readInstalledVersion() 未实现。');
}

/**
 * 上游能力的**适配出口**占位。
 *
 * 上游是 host + client 双半插件：
 *   - host 半：`webServer` 路由 `/api/dsh-knowledge-graph` + SQLite store；
 *   - client 半：`__ModuleLoader__` 整页工作台（`exports['./client']`）。
 *
 * 本仓只有两条路（评审时二选一，见 `src/index.js` TODO 第 1 条）：
 *
 *   (a) 【推荐】只挂 host 半，从 `exports['./store']`（`lib/kg-store.mjs`）
 *       或路由读取「某篇源文的 canonical graph」，交给 vault 图谱画布渲染。
 *       → 满足「仍是同一个面板」。
 *   (b) 整页挂上游工作台。→ **不满足**判据 1，除非评审接受「新增标签页」的让步。
 *
 * TODO（评审通过后按选中的方案实现其中一支）：
 *   1. `mapVaultPathToDocumentId(path)` —— vault 节点身份是**文件路径**，
 *      上游身份是随机逻辑 UUID + 全文 SHA-256。两者无天然对应，必须显式建映射。
 *   2. `readGraph(documentId)` —— 只读，返回 8 类节点 / 12 类关系的规范化数组，
 *      字段名映射收敛在本文件内，不散到页面代码。
 *   3. `onSourceChanged(sourceId)` —— 正文被改写后旧锚点如何处置
 *      （保留 / 标记失效 / 重抽），**必须由评审先拍板**，不要默认重抽（花钱且不可逆）。
 */
export function createAdapter() {
  throw new Error('骨架占位：createAdapter() 未实现。');
}
