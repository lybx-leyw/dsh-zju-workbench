/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-zhiyun-paper/src/upstream.js`。
 *
 * 为什么 A 类骨架要单列一个 upstream 模块：
 *
 *   1. 本包**不搬运**上游任何源码，只 `import` 它的公开入口（`lib/index.js` 与
 *      `lib/client.js` 两个 exports 路径）。因此「我们调的到底是哪一版 API」
 *      必须有一个可被 grep 到的单一真源。
 *   2. 上游是 0.x（`0.4.1`）。它自己 README 里写了「0.4.0 对应 DSH 0.1.1-rc.2，
 *      更老的宿主请装 0.3.1」—— 也就是说**宿主版本与插件版本是绑定的**。
 *      放开成 `^0.4.1` 会在宿主升级时静默换 API，必须写死。
 *   3. 版本号必须与 `package.json` 的 `dependencies["@graysilver/dsh-evolve-modes"]`
 *      **逐字符相同**。真实安装的版本由 `npm ls` 核对，不得信任本文件。
 */

export const UPSTREAM_PACKAGE = '@graysilver/dsh-evolve-modes';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.4.1';

/** 上游许可证（README / ATTRIBUTION 核对用，不参与运行时逻辑）。MIT ✅ */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者（署名用）。 */
export const UPSTREAM_AUTHOR = 'GraySilver';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/GraySilver/dsh-evolve-modes';

/**
 * 上游声明的宿主版本窗口。
 *
 * 这两个常量**不是**从上游读来的运行时值，而是本包**要求评审核对**的断言：
 * 若上游 `peerDependencies` 的 `@deepseek-ai/dsh-*` 区间与本仓 profile 实际锁定的
 * 版本不相交，本包必须在**装载期**就拒绝启用（而不是等到第一次调用才发现）。
 *
 * 依据（2026-10-19 核实，npm registry `@graysilver/dsh-evolve-modes@0.4.1`）：
 *   `peerDependencies["@deepseek-ai/dsh-plan-mode"] === "^0.1.1-rc.2 || ^0.1.2-rc.1"`
 */
export const UPSTREAM_HOST_RANGE = '^0.1.1-rc.2 || ^0.1.2-rc.1';

/**
 * 上游 peer 依赖**全量**清单（13 项 + `react`）。
 *
 * ⚠ 评审必须逐项与本仓 profile 实际安装版本做交集判定。这不是「照抄一遍」，
 * 而是本包与上游之间唯一的版本契约：任何一项不相交，挂载即失败。
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
  '@deepseek-ai/dsh-plan-mode',
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-agent-presets',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-typert-protocol',
]);

/**
 * 我们**只**使用上游的两个导出路径。凡不在下表里的子路径，一律视为内部实现，
 * 不得 `import`（上游 `exports` 里还有 `./typert`、`./remote`，本骨架不碰）。
 */
export const UPSTREAM_ENTRYPOINTS = Object.freeze({
  host: '.',   // lib/index.js
  web: './client', // lib/client.js
});

/**
 * 上游的**公开接缝**（占位）：评审通过后在这里做一次 `import()` + 形状检查。
 *
 * 实现时必须遵守的三条（与 `dsh-zhiyun-paper` 的 upstream 层同规）：
 *   - 只 `import` 上表里的入口，**不深挖 `lib/**` 内部文件**；
 *   - 上游抛错不得穿透到宿主：返回 `{ ok:false, error }`，由调用方决定退回现状；
 *   - 不把上游的内部状态对象直接交给 React（上游用 typert remote，序列化规则不同）。
 *
 * @returns {Promise<{ ok: boolean, mod?: unknown, error?: string }>}
 */
export async function loadUpstream() {
  // TODO 1：`await import('@graysilver/dsh-evolve-modes')`，断言导出里有 `apply`；
  //         再 `await import('@graysilver/dsh-evolve-modes/client')`，断言导出形状。
  //         任一步失败 → `{ ok:false, error }`，**不要** throw。
  // TODO 2：核对 `UPSTREAM_PEERS` 与本仓 `profileContext` 里的实际版本交集；
  //         不相交 → 返回 `{ ok:false, error:'HOST_RANGE_MISMATCH' }`。
  return { ok: false, error: 'candidate skeleton: not implemented' };
}
