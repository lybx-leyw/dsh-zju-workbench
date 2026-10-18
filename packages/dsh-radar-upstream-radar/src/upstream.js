/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 `package.json` 和注释里：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.45.0`，不是 `^0.45.0`）。
 *      上游是「常驻轮询 + 起 Agent 跑隔离环境」的服务端插件，小版本就可能改
 *      任务契约、状态文件 schema 与 webhook 载荷；`^` 会让 `npm install`
 *      在某次无关的改动里悄悄把行为换掉。
 *   2. 光锁 `package.json` 不够 —— 真实的 `node_modules` 里装的是什么，取决于
 *      别人的 lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次，
 *      并把结果暴露给页面（不抛错：见 `index.js` 的说明）。
 *   3. `tests/` 里应有一条断言「声明、实际安装、代码预期」三者一致的测试 ——
 *      锁版这件事必须有一条会红的测试，否则它只是一句口号。
 *      （骨架阶段尚未提供该测试，见 README 的 TODO。）
 */

export const UPSTREAM_PACKAGE = 'upstream-radar';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.45.0';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/MicroMilo/upstream-radar';

/**
 * 上游许可证：Apache-2.0（宽松白名单内）。
 * 三源一致已核：GitHub API `license.spdx_id` = `Apache-2.0`；仓库根有 `LICENSE`；
 * npm `0.45.0` 的 `package.json.license` = `Apache-2.0`。
 */
export const UPSTREAM_LICENSE = 'Apache-2.0';

/** 上游作者。 */
export const UPSTREAM_AUTHOR = 'MicroMilo';

/**
 * 上游在 `dsh` 字段里声明的挂载形状（2026-10-18 经 npm registry 实包核实）。
 *
 *   dsh: {
 *     bundle: { patch: './cordis.patch.yml' },   ← 标准 bundle 形状，可锁版挂载
 *   }                                            ← **注意：没有 `client` 字段**
 *   exports: {
 *     ".":                  ./dist/src/index.js
 *     "./dsh":              ./dist/src/dsh-plugin.js   ← 真正的插件入口
 *     "./cordis.patch.yml": ./cordis.patch.yml
 *   }
 *   bin: { "upstream-radar": "dist/src/cli.js" }     ← 另有 CLI
 *   engines: { node: '>=22' }
 *   dependencies: {}                                 ← **零运行时依赖**
 *
 * 上游 patch 实文（`- insert: [{ id: upstream-radar, name: 'upstream-radar/dsh', config: {...} }]`）
 * 里把 `configFile` / `stateFile` 等都读自 `process.env.UPSTREAM_RADAR_*`，
 * 且**没有库存文件时保持休眠、安装无副作用** —— 这一点对「先挂上、评审后再启用」很有利：
 * 即便本骨架被误挂载，在没设 `UPSTREAM_RADAR_CONFIG` 前它也不会开始轮询。
 *
 * **关键差别（相对 `dsh-radar-compat-vet` 的上游）**：
 * `dsh-compat-vet` 有 `dsh.client`，自带一整页 UI，挂上去会多一块面板；
 * 本上游**纯服务端、无 client 注入** —— 它**不可能**另起面板。
 * 这让「仍是同一个面板」这条判据从「靠自律不用」变成「结构上就用不了」。
 */
export const UPSTREAM_MOUNT = {
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  hasBundlePatch: true,
  /** 上游**没有** `dsh.client` —— 纯服务端。这是本骨架「不新增面板」的结构性保证。 */
  hasClientEntry: false,
  /** 上游自带的服务端入口子路径（不是裸包名）。 */
  upstreamEntry: 'upstream-radar/dsh',
  /** 上游 patch 的 insert 行 id（来自实包 `cordis.patch.yml`）。 */
  upstreamPatchRowId: 'upstream-radar',
  /** 本包在 profile 里的行 id（见 `cordis.patch.yml`）。 */
  localPatchRowId: 'radar-upstream-radar',
  /** 上游声明的 Cordis 服务依赖。 */
  inject: ['agents'],
};

/**
 * 上游声明的宿主兼容性 —— **注意它是一条硬门槛，不是建议**。
 *
 * `engines.node: '>=22'`。本仓若在 Node 20/21 上安装，`npm install` 会直接失败
 * （若 `engine-strict`）或运行时炸掉（若只在 CI 校验）。
 * **这是采用前第一件要核实的事**：核对本仓 `runtime.lock.json` 与 CI 的 Node 版本。
 */
export const UPSTREAM_COMPAT = {
  dshEngines: null,
  node: '>=22',
  strategy: 'isolated-run-evidence',
};

/**
 * 上游的产物形态：不是「给结论」，是「给带证据的报告」。
 *
 * 上游 README 里那句话必须被本仓的文案继承：
 *
 *   > *completed means the analysis closed, **not** that the plugin passed.*
 *
 * 也就是说，本列至少需要**三态以上**，且「未知/未测/分析失败」必须与「通过」分开：
 *
 *   - `passed`      —— 在隔离环境里真装真跑成功，证据绑定到具体字节与版本
 *   - `failed`      —— 有失败证据（安装失败 / 加载失败 / 启动崩溃）
 *   - `unknown`     —— 还没测 / 测了但证据不完整 / Agent 不可用 / 离线
 *   - `stale`       —— 有旧结论，但此后 DSH 或该插件发过新版（结论已过期）
 *
 * ⚠ `unknown` **不得**被渲染成中性或绿色 —— 那是上游最反对的「silent unknowns」。
 */
export const COMPAT_STATES = Object.freeze(['passed', 'failed', 'unknown', 'stale']);

/**
 * 读取上游运行时版本。骨架阶段**不实现**。
 *
 * TODO（评审通过后）：解析 `node_modules/${UPSTREAM_PACKAGE}/package.json` 的 `version`，
 * 与 `UPSTREAM_VERSION` 比对；不一致时**不抛错**，而是把结果暴露给页面 ——
 * 锁版失败应当在界面上可见，而不是让整页挂掉。
 */
export function readInstalledVersion() {
  throw new Error('骨架占位：readInstalledVersion() 未实现。');
}

/**
 * 把上游的兼容性报告**归一**成本仓「插件」页要的那一列。骨架阶段**不实现**。
 *
 * 三条路（评审时三选一，按推荐度排序）：
 *
 *   a. **读上游持久化的报告（倾向）** —— 上游把结果写成「与插件字节、源码 commit、
 *      DSH 版本、Node 版本、profile、命令、日志绑定的版本化报告」。本包只需**读**这些报告，
 *      按「包名 → 最新一条结论」索引，喂给依赖图。
 *      ✅ 只读、不触发执行、打开页面零成本（报告由上游自己的调度产生）。
 *      ⚠ 代价是「结论可能不是刚刚测的」→ 因此必须有 `stale` 态（见 `COMPAT_STATES`）。
 *
 *   b. **程序化触发一次分析** —— 调上游 `./dsh` 导出的能力去建任务。
 *      ⚠ 会**起 Agent、开隔离环境、耗时数分钟、消耗配额**。
 *      若走这条，页面上必须有「测一下」的**显式按钮**，绝不能在渲染时隐式触发。
 *
 *   c. **只用上游 CLI**（`bin.upstream-radar`）在构建期跑，产出静态快照。
 *      ⚠ 快照会立刻过期，且与本仓「页面反映当下」的预期不符。**最不推荐**。
 *
 * 无论哪条，都**不得**代理上游的修复/升级动作（见 README「人工裁定事项」）。
 */
export function readCompatProfile() {
  throw new Error('骨架占位：readCompatProfile() 未实现。见上方 a/b/c 三选一说明。');
}
