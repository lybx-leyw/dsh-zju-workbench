/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 写法照 `dsh-zhiyun-host-paper/src/upstream.js` 与 `dsh-radar-kb-rag/src/upstream.js`：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.1.0-rc.4`，不是 `^0.1.0-rc.4`）。
 *   2. 光锁 `package.json` 不够 —— 真实的 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次。
 *   3. 锁版这件事必须有一条会红的测试，否则它只是一句口号（本骨架**尚未**带测试，
 *      评审通过后第一件事是补 `tests/plugin-ledger.test.mjs`）。
 *
 * # 本轮（r58）实查到的六件事，写在这里以免评审时重查
 *
 *   a. **`dist-tags.latest` 指向的是 `-rc` 版本**（`0.1.0-rc.4`），不是稳定版，
 *      且 `next` 反而指向更旧的 `0.1.0-rc.3`。与 r35 的 `media-captions`
 *      （`latest` 停旧版、新版挂 `next`）**方向相反** ⇒ 不能只看「有没有 `-rc`」，
 *      要看 `dist-tags` 到底指向谁。
 *   b. **它没有许可证维度**。`grep -rni "license" src/scan/ src/hub/` → 0 条。
 *      「每包什么许可」必须由本包自写（TODO-5），**不得**算成上游的能力。
 *   c. **证据会命中注释行**（r58 · M3）。对本仓 `dsh-zhiyun-source-campus` 实测：
 *      `network-egress` 的 6 条证据全部落在 `src/egress.js` 的 `/** … *\/` 注释里，
 *      另有 18 条被省略 ⇒ 证据是**线索**，不是**定论**。界面文案必须这么写。
 *   d. **`inspectPlugin` 的入参是 `{ dir, name }`**，不是 `{ packageDir }`；
 *      传错会抛 `ERR_INVALID_ARG_TYPE: path must be string`（上游 README 未写）。
 *      `inspectPlugin` 与 `reconcile` **不碰 ctx**，可同步调用、可单测。
 *   e. **`dsh.capabilities` 是社区公约，宿主不读、不强制**（SPEC §1 原文）。
 *      接它 = 接一套**别人定的词表**，词表一变，本仓界面文案就得跟着改 ⇒
 *      `CAPABILITY_IDS_SNAPSHOT` 把词表**快照**在本地，另加运行时核对。
 *   f. **`discoverInstalls()` 以 `~/.dsh/profiles`（或 `$DSH_HOME/profiles`）为根**，
 *      而本仓的 profile 在**仓库内**的 `profiles/zhiyun-bench/` ⇒ TODO-0：
 *      两者是不是同一处？不是的话扫描结果**恒为空且不报错**。
 */

export const UPSTREAM_PACKAGE = '@zseven-w/dsh-harbor';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.1.0-rc.4';

/** 上游发布源头。npm `repository.url` 指向这里（2026-10-24 实查）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/ZSeven-W/dsh-harbor';

/** 上游许可证。MIT —— 在宽松白名单内，可以集成（GitHub / npm / tarball 三处一致）。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 上游宿主半边依赖的宿主服务。
 *
 * 注意与 `dsh-kb-rag` 的区别：这里**只有** `webServer` —— 扫描是**进程内**的纯 Node
 * 文件读取，不 spawn、不联网（联网只发生在 `/updates` 与 `/preflight` 两条路由上）。
 * 所以不存在 r57 那种「缺 subprocess 就静默 return」的前置。
 */
export const REQUIRED_SERVICES = ['webServer'];

/**
 * 上游注册的回环路由（用于挂载后自检「是不是真的挂上了」）。
 *
 * `ping` 会返回 `{ ok, routes: { expected, mounted, failed } }` —— 这是唯一能在
 * 「路由没挂上」时**显形**的位置（上游 `register` 失败只 `warn`，不抛错）。
 */
export const UPSTREAM_ROUTES = [
  '/_dsh/dsh-harbor/ping',
  '/_dsh/dsh-harbor/report',
  '/_dsh/dsh-harbor/capabilities',
  '/_dsh/dsh-harbor/updates',
  '/_dsh/dsh-harbor/preflight/versions',
  '/_dsh/dsh-harbor/preflight',
];

/**
 * **会离开本机**的两条路由：`/updates`（查 npm 新版本）与 `/preflight*`（列宿主机型）。
 * 本仓既有叙述是「本地优先」⇒ 是否挂这两条，是 TODO-4 要评审拍板的事，
 * 不应由「上游默认全挂」替我们决定。
 */
export const NETWORK_ROUTES = new Set([
  '/_dsh/dsh-harbor/updates',
  '/_dsh/dsh-harbor/preflight/versions',
  '/_dsh/dsh-harbor/preflight',
]);

/**
 * 上游 `exports` 的键。本包**只消费** `./scan`（纯函数，不碰 ctx）与 `.`（宿主半边）。
 *
 * `./client` 是上游自带的 `settings.section` 面板 —— 本仓「插件」页已经有了所有行，
 * 再接一个设置段就是「一个概念两个入口」⇒ **不消费** `./client`（见 README 与 TODO-1）。
 */
export const UPSTREAM_EXPORTS_USED = ['./scan', '.'];

/**
 * 13 项能力词表的**快照**（2026-10-24 从 `CAPABILITIES` 导出，逐项照抄）。
 *
 * 为什么要快照：词表是**上游的**、还会变（M1 的 e）。本包界面上的中文标签、分组、
 * 「哪几项进那一行」（TODO-2）都建立在**这一份**上；上游新增/改名时，
 * `checkCapabilityVocabulary()` 会报出来，而不是让界面上悄悄少一行。
 */
export const CAPABILITY_IDS_SNAPSHOT = [
  'client-injection',
  'realm-risk',
  'realm-copy',
  'global-hook',
  'llm-adapter',
  'subprocess',
  'network-egress',
  'web-routes',
  'tool-registration',
  'mcp-server',
  'foreign-config',
  'credential-handling',
  'env-read',
];

/**
 * 建议进「插件」页那一行的 4 项（TODO-2 的**提案**，未拍板）。
 *
 * 挑选口径是「学生看得懂、且与『我关掉它安全吗』直接相关」：
 *   - `subprocess`：起本机进程，权力等同用户自己的 shell；
 *   - `network-egress`：把请求发出去；
 *   - `web-routes`：在本机开路由；
 *   - `foreign-config`：读写别的软件的配置（卸载残留也从这里查）。
 * 其余 9 项折叠到「详情」，不占行的宽度。
 */
export const CAPABILITIES_FOR_ROW = ['subprocess', 'network-egress', 'web-routes', 'foreign-config'];

/**
 * 核对上游的**版本与词表**是否仍是我们适配过的那一个。
 *
 * 返回 `{ ok, installed, expected, vocabularyOk, unknownIds, reason }`，**不抛错** ——
 * 理由与 paper 包相同：版本不符可能只是无关的 patch 发布，没必要让整个工作台起不来。
 * 但结果要**暴露给页面**（让用户看见「这台机器的 harbor 不是我们适配的那个版本」），
 * 而不是悄悄忽略。
 *
 * @param {NodeJS.ProcessEnv} [env] 便于测试注入
 * @returns {{ ok: boolean, installed: string | null, expected: string, vocabularyOk: boolean, unknownIds: string[], reason?: string }}
 */
export function checkUpstreamVersion(env = process.env) {
  throw new Error('dsh-radar-plugin-ledger 是候选骨架，未实现：checkUpstreamVersion()');
}

/**
 * TODO（评审通过后落地）：用 `createRequire(import.meta.url)` 解析
 * `${UPSTREAM_PACKAGE}/package.json`，读 `version` 与 `dsh.bundle.patch`，再
 * `import('${UPSTREAM_PACKAGE}/scan')` 取 `CAPABILITIES` 与 `CAPABILITY_IDS_SNAPSHOT`
 * 比对，合并成一份「上游凭据快照」交给 `index.js`。
 */
export function readUpstreamManifest() {
  throw new Error('dsh-radar-plugin-ledger 是候选骨架，未实现：readUpstreamManifest()');
}
