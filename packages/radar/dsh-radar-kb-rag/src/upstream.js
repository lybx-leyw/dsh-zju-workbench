/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 写法照 `dsh-zhiyun-host-paper/src/upstream.js`：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`1.6.8`，不是 `^1.6.8`）。
 *   2. 光锁 `package.json` 不够 —— 真实的 `node_modules` 里装的是什么，取决于
 *      别人的 lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次。
 *   3. 锁版这件事必须有一条会红的测试，否则它只是一句口号（本骨架**尚未**带测试，
 *      评审通过后第一件事就是补 `tests/kb-rag.test.mjs`）。
 *
 * # 这一轮（r57）实查到的三件事，写在这里以免评审时重查
 *
 *   a. **npm 上的 `dsh-zotero` 不属于 `nftuoa/dsh-zotero`**：它的
 *      `package.json.repository.url` 指向 `Vncntvx/dsh-zotero`。所以「包名存在」
 *      不等于「这个仓库发布了它」—— `UPSTREAM_REPOSITORY` 这个字段就是为此而留。
 *   b. `dsh-kb-rag@1.6.8` 的 `dependencies` 为**空**；真正干活的是一个**随包分发**的
 *      Python 引擎（`kb_engine.py`，`sqlite3` + 内存 BM25(CJK) + 本地 bge-small 向量）。
 *      它**不在** npm 依赖图里 → 版本锁得住，**运行时锁不住**。
 *   c. 上游 `inject = ["tools", "timer", "subprocess"]`。缺任何一个，上游 `apply()` 会
 *      `console.error` 后**静默 return**（不抛错）→ 10 个工具全部不注册、工作台照常启动。
 *      这是 TODO-0 存在的原因。
 */

export const UPSTREAM_PACKAGE = 'dsh-kb-rag';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '1.6.8';

/** 上游发布源头。`dsh-kb-rag` 的 npm `repository.url` 指向这里（2026-10-23 实查）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/Breeze136/dsh-kb-rag';

/** 上游许可证。MIT —— 在宽松白名单内，可以集成。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 上游 `apply()` 依赖的宿主服务。本包在挂载上游**之前**必须先确认它们都在，
 * 否则会「挂上一个什么都不做的包」而没有任何报错。
 */
export const REQUIRED_SERVICES = ['tools', 'timer', 'subprocess'];

/** 上游注册的 model tool 名单（用于挂载后自检「是不是真的挂上了」）。 */
export const UPSTREAM_TOOLS = [
  'kb_ingest',
  'kb_search',
  'kb_rag',
  'kb_zotero',
  'kb_dedup',
  'kb_clear',
  'kb_fetch',
  'kb_scope',
  'kb_stats',
  'kb_status',
];

/**
 * 上游 `exports` 的键。本包**只需要** `.`（宿主半边）；`./client` 是上游自带的
 * 前端，本仓论文页不消费它（否则会多出一套文献库 UI，见报告 §2.4）。
 */
export const UPSTREAM_EXPORTS_USED = ['.'];

/**
 * 运行时核对上游是否是我们适配过的那个版本。
 *
 * 返回 `{ ok, installed, expected, reason }`，**不抛错** —— 理由与 paper 包相同：
 * 版本不符可能只是无关的 patch 发布，没必要让整个工作台起不来。
 * 但要把结果**暴露给页面**（让用户看见），而不是悄悄忽略。
 *
 * @param {NodeJS.ProcessEnv} [env] 便于测试注入
 * @returns {{ ok: boolean, installed: string | null, expected: string, reason?: string }}
 */
export function checkUpstreamVersion(env = process.env) {
  throw new Error('dsh-radar-kb-rag 是候选骨架，未实现：checkUpstreamVersion()');
}

/**
 * TODO（评审通过后落地）：用 `createRequire(import.meta.url)` 解析
 * `${UPSTREAM_PACKAGE}/package.json`，读 `version` 与 `dsh.bundle.patch`，
 * 与 `checkUpstreamVersion()` 的结论合并成一份「上游凭据快照」，交给 `index.js`。
 */
export function readUpstreamManifest() {
  throw new Error('dsh-radar-kb-rag 是候选骨架，未实现：readUpstreamManifest()');
}
