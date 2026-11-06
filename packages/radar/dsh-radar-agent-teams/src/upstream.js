/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zhiyun-paper/src/upstream.js`。
 *
 * 为什么 A 类骨架要单列一个 upstream 模块：
 *
 *   1. 本包**不搬运**上游任何源码，只 `import` 它的公开入口。因此「我们调的到底是
 *      哪一版 API」必须有可被 grep 到的单一真源。
 *   2. 上游是 0.x（`0.1.25`），且**宿主版本与插件版本强绑定**：上游 README 的
 *      支持矩阵写明「推荐 Harness `0.2.1-rc.2` + AgentTeams `0.1.25`」，
 *      并让 `compatibility.json` 做精确校验。放开成 `^0.1.25` 会在宿主升级时
 *      静默换 API，必须写死。
 *   3. 版本号必须与 `package.json` 的 `dependencies["@nanmicoder/dsh-agent-teams"]`
 *      **逐字符相同**。真实安装的版本由 `npm ls` 核对，不得信任本文件。
 */

export const UPSTREAM_PACKAGE = '@nanmicoder/dsh-agent-teams';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.1.25';

/** 上游许可证（README / ATTRIBUTION 核对用，不参与运行时逻辑）。MIT ✅ */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者（署名用）。 */
export const UPSTREAM_AUTHOR = 'NanmiCoder';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/NanmiCoder/dsh-agent-teams';

/**
 * 上游声明的宿主版本窗口。
 *
 * 这两个常量**不是**从上游读来的运行时值，而是本包**要求评审核对**的断言：
 * 若上游 `peerDependencies` 的 `@deepseek-ai/dsh-*` 区间与本仓 profile 实际锁定的
 * 版本不相交，本包必须在**装载期**就拒绝启用（而不是等到第一次调用才发现）。
 *
 * 依据（2026-10-21 核实，npm registry `@nanmicoder/dsh-agent-teams@0.1.25`）：
 *   `peerDependencies["@deepseek-ai/dsh-agent"]` 等 20 项均为
 *   `0.2.1-rc.2 || 0.2.1-rc.1 || 0.2.0-rc.2 || 0.1.7-rc.2 || 0.1.5-rc.3 ||
 *    0.1.5-rc.2 || 0.1.5-rc.1 || 0.1.2-rc.1 || 0.1.2-alpha.5 || 0.1.2-alpha.2`
 *   本仓 `runtime.lock.json` 的 `preferredHostVersion` 为 `0.2.0-rc.2` → **在窗口内**。
 *   ⚠ 这是「交集非空」的判定，**不等于**「已实测通过本仓 scripts/test-host.mjs」。
 */
export const UPSTREAM_HOST_RANGE =
  '0.2.1-rc.2 || 0.2.1-rc.1 || 0.2.0-rc.2 || 0.1.7-rc.2 || 0.1.5-rc.3 || ' +
  '0.1.5-rc.2 || 0.1.5-rc.1 || 0.1.2-rc.1 || 0.1.2-alpha.5 || 0.1.2-alpha.2';

/**
 * 上游 peer 依赖**全量**清单（20 项宿主包 + `react`）。
 *
 * ⚠ 评审必须逐项与本仓 profile 实际安装版本做交集判定。这不是「照抄一遍」，
 * 而是本包与上游之间唯一的版本契约：任何一项不相交，挂载即失败。
 * 注意其中带 `dsh-client-*` 的 10 项：上游有**前端半边**，挂载前要确认本仓
 * 前端 bundle 也在同一宿主版本上。
 */
export const UPSTREAM_PEERS = Object.freeze([
  'react',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-commands',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-ui-chat',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-layout',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-model-selection',
]);

/**
 * 我们**只**使用上游的两个导出路径（npm `exports` 实测：
 * `.` → `lib/index.js`、`./client` → 前端半边）。凡不在下表里的子路径，
 * 一律视为内部实现，不得 `import`。
 */
export const UPSTREAM_ENTRYPOINTS = Object.freeze({
  host: '.',
  web: './client',
});

/**
 * 上游的**公开接缝**（占位）：评审通过后在这里做一次 `import()` + 形状检查。
 *
 * 实现时必须遵守的三条（与 `dsh-zhiyun-paper` 的 upstream 层同规）：
 *   - 只 `import` 上表里的入口，**不深挖 `lib/**` 内部文件**；
 *   - 上游抛错不得穿透到宿主：返回 `{ ok:false, error }`，由调用方决定退回现状；
 *   - 不把上游的内部状态对象直接交给 React（上游状态在磁盘上，
 *     `<session workspace>/<stateDir>/<teamId>/`，不是内存对象）。
 *
 * @returns {Promise<{ ok: boolean, mod?: unknown, error?: string }>}
 */
export async function loadUpstream() {
  // TODO 1：`await import('@nanmicoder/dsh-agent-teams')`，断言导出里有 `apply`；
  //         再 `await import('@nanmicoder/dsh-agent-teams/client')`，断言导出形状。
  //         任一步失败 → `{ ok:false, error }`，**不要** throw。
  // TODO 2：核对 `UPSTREAM_PEERS` 与本仓 `profileContext` 里的实际版本交集；
  //         不相交 → 返回 `{ ok:false, error:'HOST_RANGE_MISMATCH' }`。
  // TODO 3：读上游 `compatibility.json`（若随包发布）做**第二道**精确校验，
  //         上游 README 明说它会在装包时拒绝不匹配的宿主 —— 本包不得绕过这条。
  return { ok: false, error: 'candidate skeleton: not implemented' };
}
