/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zhiyun-paper/src/upstream.js`。
 *
 * 为什么 A 类骨架要单列一个 upstream 模块：
 *
 *   1. 本包**不搬运**上游任何源码，只 `import` 它的公开入口（`.` 与 `./client`
 *      两个 exports 路径）。因此「我们调的到底是哪一版 API」必须有一个可被 grep 到的
 *      单一真源。
 *   2. 上游是 0.x（`0.6.7`），且 README 自述「DSH 0.2.1-rc.2」—— **插件版本与宿主版本
 *      是绑定的**。放开成 `^0.6.7` 会在宿主升级时静默换 API，必须写死。
 *   3. 版本号必须与 `package.json` 的 `dependencies["dsh-llm-fallbacks"]`
 *      **逐字符相同**。真实安装的版本由 `npm ls` 核对，不得信任本文件。
 */

export const UPSTREAM_PACKAGE = 'dsh-llm-fallbacks';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.6.7';

/** 上游许可证（README / ATTRIBUTION 核对用，不参与运行时逻辑）。MIT ✅ */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者 / 组织。 */
export const UPSTREAM_AUTHOR = 'omdsh-dev';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/omdsh-dev/dsh-llm-fallbacks';

/**
 * 上游声明的宿主版本窗口。
 *
 * 这两个常量**不是**从上游读来的运行时值，而是本包**要求评审核对**的断言：
 * 若上游 `peerDependencies` 的 `@deepseek-ai/dsh-*` 区间与本仓 profile 实际锁定的
 * 版本不相交，本包必须在**装载期**就拒绝启用（而不是等到第一次调用才发现）。
 *
 * 依据（2026-10-19 核实，npm registry `dsh-llm-fallbacks@0.6.7`）：
 *   - 上游 `package.json` 未声明 `engines.dsh`（同作者的 `dsh-llm-fallback` 写了
 *     `engines.dsh = ">=0.0.1"`，本包**不采用**该宽松声明）；
 *   - 全部 `@deepseek-ai/dsh-*` peer 均为 `^0.2.1-rc.2`；
 *   - 上游 README 徽章标注 `DSH-0.2.1--rc.2`，`node >= 22`。
 *
 * ⚠ 本仓 `runtime.lock.json` 的 `hostVersions` 是 `0.2.0-rc.2` / `0.2.1-alpha.1`，
 *   **不含** `0.2.1-rc.2`。`^0.2.1-rc.2` 能否被 `0.2.1-alpha.1` 满足，
 *   取决于 semver 对 prerelease 的规则（`alpha` < `rc`，故 **很可能不相交**）。
 *   这是 README §风险 R-1 的核心，必须在评审时用 `semver.satisfies` 实测。
 */
export const UPSTREAM_HOST_RANGE = '^0.2.1-rc.2';

/**
 * 上游 peer 依赖**全量**清单（26 项，2026-10-19 从 npm tarball 的 `package.json` 逐项抄录）。
 *
 * ⚠ 评审必须逐项与本仓 profile 实际安装版本做交集判定。这不是「照抄一遍」，
 * 而是本包与上游之间唯一的版本契约：任何一项不相交，挂载即失败。
 */
export const UPSTREAM_PEERS = Object.freeze([
  'react',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-plugin-manager',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-retry',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/schemastery',
]);

/**
 * 上游的**运行时**依赖（非 peer）。只有一项 —— 这是它体积 0.9 MB 却几乎不拖累
 * 依赖树的原因（其余都在 peer 里由宿主提供）。
 */
export const UPSTREAM_RUNTIME_DEPS = Object.freeze({
  'use-sync-external-store': '^1.6.0',
});

/**
 * 我们**只**使用上游的两个导出路径。凡不在下表里的子路径，一律视为内部实现，
 * 不得 `import`（上游 `exports` 里只有 `.` 与 `./client` 两个 JS 入口，
 * 另有 `./locale/*.json`、`./bundle/cordis.patch.yml`、`./package.json` 三个资产路径）。
 */
export const UPSTREAM_ENTRYPOINTS = Object.freeze({
  host: '.',
  web: './client',
  patch: 'bundle/cordis.patch.yml',
});

/**
 * 上游监听的宿主事件（2026-10-19 从 `dist/index.js` grep 得到，仅作评审线索）。
 *
 * 本包**不**订阅这些事件，记录在这里是为了让评审一眼看出「它会插进请求管线」：
 *   `agent/request`            —— 发送前，可能按分时槽改写 chain 头
 *   `agent/request-error`      —— 失败后，按 triggerCodes 决定是否降级
 *   `agent/model-selection-policy` —— 与本仓「显式选择优先」的边界直接相关（TODO 3）
 *   `agent/pre-step`           —— step 级保险丝（maxSwitchesPerStep）
 *   `agent/catalog` / `agent/status` / `agent/created` / `agent/disposed` —— 状态投影
 */
export const UPSTREAM_EVENTS = Object.freeze([
  'agent/request',
  'agent/request-error',
  'agent/model-selection-policy',
  'agent/pre-step',
  'agent/catalog',
  'agent/status',
  'agent/created',
  'agent/disposed',
]);

/**
 * 上游的**公开接缝**（占位）：评审通过后在这里做一次 `import()` + 形状检查。
 *
 * 实现时必须遵守的三条（与 `dsh-zhiyun-paper` 的 upstream 层同规）：
 *   - 只 `import` 上表里的入口，**不深挖 `dist/**` 内部文件**；
 *   - 上游抛错不得穿透到宿主：返回 `{ ok:false, error }`，由调用方决定退回现状；
 *   - 不把上游的内部状态对象直接交给 React（上游用 typert remote，序列化规则不同）。
 *
 * @returns {Promise<{ ok: boolean, mod?: unknown, error?: string }>}
 */
export async function loadUpstream() {
  // TODO 1：`await import('dsh-llm-fallbacks')`，断言导出里有 `apply`（或 `default.apply`）；
  //         再 `await import('dsh-llm-fallbacks/client')`，断言导出形状。
  //         任一步失败 → `{ ok:false, error }`，**不要** throw。
  // TODO 2：核对 `UPSTREAM_PEERS` 与本仓 `profileContext` 里的实际版本交集；
  //         不相交 → 返回 `{ ok:false, error:'HOST_RANGE_MISMATCH' }`。
  // TODO 3：读上游 `bundle/cordis.patch.yml` 只为**核对挂载意图**（本包不执行它）。
  return { ok: false, error: 'candidate skeleton: not implemented' };
}
