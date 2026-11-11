/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zhiyun-paper/src/upstream.js`。
 *
 * 为什么 A 类骨架要单列一个 upstream 模块：
 *
 *   1. 本包**不搬运**上游任何源码，只 `import` 它的公开入口。因此「我们调的到底是
 *      哪一版 API」必须有可被 grep 到的单一真源。
 *   2. 上游是 0.x（`0.3.24`），且**宿主版本窗口会随上游修订而变**：上游 98 个发布
 *      版本里 peer 区间已经改过多次。放开成 `^0.3.24` 会在宿主升级时静默换 API，
 *      必须写死。
 *   3. 版本号必须与 `package.json` 的 `dependencies["dsh-data-quality"]`
 *      **逐字符相同**。真实安装的版本由 `npm ls` 核对，不得信任本文件。
 */

export const UPSTREAM_PACKAGE = 'dsh-data-quality';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.3.24';

/** 上游许可证（README / ATTRIBUTION 核对用，不参与运行时逻辑）。Apache-2.0 ✅ */
export const UPSTREAM_LICENSE = 'Apache-2.0';

/** 上游作者（署名用）。 */
export const UPSTREAM_AUTHOR = 'PerryLink';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/PerryLink/dsh-data-quality';

/**
 * 上游声明的宿主版本窗口（`@deepseek-ai/dsh-tools` / `dsh-session` / `dsh-storage`
 * / `dsh-storage-json` / `dsh-storage-domain` 五项**共用**同一区间）。
 *
 * 这两个常量**不是**从上游读来的运行时值，而是本包**要求评审核对**的断言：
 * 若上游 `peerDependencies` 的区间与本仓 profile 实际锁定的版本不相交，本包必须在
 * **装载期**就拒绝启用（而不是等到第一次调用才发现）。
 *
 * 依据（2026-11-01 核实，npm registry `dsh-data-quality@0.3.24`）：
 *   `peerDependencies["@deepseek-ai/dsh-tools"]` == `"@deepseek-ai/dsh-session"`
 *   == `"@deepseek-ai/dsh-storage"` == `"@deepseek-ai/dsh-storage-json"`
 *   == `"@deepseek-ai/dsh-storage-domain"`，值为下文 UPSTREAM_HOST_RANGE。
 *   本仓 `runtime.lock.json` 的 `preferredHostVersion` 为 `0.2.0-rc.2`
 *   → 命中 `>=0.2.0-0 <0.3.0` 这一段，**在窗口内**。
 *   ⚠ 这是「交集非空」的判定，**不等于**「已实测通过本仓 scripts/test-host.mjs」。
 */
export const UPSTREAM_HOST_RANGE =
  '>=0.1.2-rc.1 <0.2.0 || >=0.1.5-alpha.1 <0.2.0 || >=0.1.6-0 <0.2.0 || ' +
  '>=0.1.7-0 <0.2.0 || >=0.2.0-0 <0.3.0 || >=0.2.1-0 <0.3.0';

/** `@deepseek-ai/cordis` 的 peer 区间（与上面五项不同，单独列）。 */
export const UPSTREAM_CORDIS_RANGE = '^4.0.5';

/** `@deepseek-ai/schemastery` 的 peer 区间（Config schema 用）。 */
export const UPSTREAM_SCHEMASTERY_RANGE = '^3.18.5-alpha.1';

/**
 * 上游 peer 依赖**全量**清单（7 项）。
 *
 * 注意：上游**没有** `dsh-client-*` 依赖 —— 它**没有前端半边**，纯宿主侧
 * （`exports` 实测只有 `.` 与 `./package.json`）。这一点与 `dsh-radar-agent-teams`
 * （21 项 peer、10 个 `dsh-client-*`、≈3.26 MB）形成鲜明对比：本骨架的体积风险
 * 比它小一个数量级（0.88 MB），且**不需要 iframe 承载**。
 */
export const UPSTREAM_PEERS = Object.freeze([
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-storage',
  '@deepseek-ai/dsh-storage-json',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/schemastery',
]);

/**
 * 我们**只**使用上游的一个导出路径（npm `exports` 实测：`.` → `lib/index.js`）。
 * 凡不在下表里的子路径，一律视为内部实现，不得 `import`。
 */
export const UPSTREAM_ENTRYPOINTS = Object.freeze({
  host: '.',
});

/**
 * 本包打算消费的上游**公开接缝**（三个工具 + 一个服务）：
 *
 *   - `ctx.dataQuality.verifyCitations({ dataset, citations })`
 *       → `{ results: [{ id, status: 'verified'|'mismatch'|'not-found'|'unverifiable' }] }`
 *       这是本骨架**唯一**必须调用的方法 —— 它替换的是
 *       `dsh-zhiyun-core-quiz/src/points.js:144` 的 `source.snippet.includes(quote)`。
 *   - `ctx.dataQuality.profileDataset` / `cleanDataset` / `verifyDataset`
 *       与本包**无关**（那是「学习」页材料卡的另外三种用途，见 README 的 P2/P3）。
 *   - 工具 `data_profile` / `data_clean` / `data_verify`
 *       会注册进**全局 tools registry**。是否允许它们在**非学习页会话**里出现，
 *       是 TODO 2 的核心问题。
 */
export const UPSTREAM_SEAMS = Object.freeze({
  service: 'dataQuality',
  method: 'verifyCitations',
  tools: Object.freeze(['data_profile', 'data_clean', 'data_verify']),
});

/**
 * 上游的**公开接缝**（占位）：评审通过后在这里做一次 `import()` + 形状检查。
 *
 * 实现时必须遵守的三条（与 `dsh-zhiyun-paper` 的 upstream 层同规）：
 *   - 只 `import` 上表里的入口，**不深挖 `lib/**` 内部文件**；
 *   - 上游抛错不得穿透到宿主：返回 `{ ok:false, error }`，由调用方决定退回现状；
 *   - 不把上游的内部状态对象直接交给 React（报告落在宿主 storage domain，不是内存对象）。
 *
 * @returns {Promise<{ ok: boolean, mod?: unknown, error?: string }>}
 */
export async function loadUpstream() {
  // TODO 1：`await import('dsh-data-quality')`，断言导出里有 `apply`；
  //         再断言 `apply` 注册的服务名是 `dataQuality`（读 `__exports_manifest__` 或
  //         在 dry-run ctx 上调用一次）。形状不符 → `{ ok:false, error:'SHAPE_MISMATCH' }`。
  // TODO 2：核对 `UPSTREAM_PEERS` 与本仓 `profileContext` 里的实际版本交集；
  //         不相交 → 返回 `{ ok:false, error:'HOST_RANGE_MISMATCH' }`。
  // TODO 3：确认 `ctx.dataQuality.verifyCitations` 存在且是函数（服务可能被配置关闭）。
  return { ok: false, error: 'candidate skeleton: not implemented' };
}
