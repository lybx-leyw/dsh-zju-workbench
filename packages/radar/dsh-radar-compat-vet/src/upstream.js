/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 `package.json` 和注释里
 * （与 `dsh-zhiyun-host-paper/src/upstream.js`、`dsh-radar-plugin-audit/src/upstream.js`
 * 同一套理由）：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.3.2`，不是 `^0.3.2`）。
 *      上游做的是**兼容性判定**，它内部带着一张「哪些 dsh 版本 / 哪些 peer 范围
 *      算兼容」的**版本矩阵**，而那张矩阵本身会随 dsh 主线漂移。也就是说
 *      上游**判定口径**在版本间会变，但**变了以后输出看上去仍是「正常的中文预警」**。
 *      `^` 会让 `npm install` 在某次无关改动里悄悄把判定口径换掉，
 *      而「插件页少了一条预警 / 多了一条预警」是最难被发现的那类漂移。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于
 *      别人的 lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次。
 *   3. 后续应补 `tests/`，用下面这几个常量断言「声明、实际安装、代码预期」
 *      三者一致 —— 锁版必须有一条会红的测试，否则它只是一句口号。
 *
 * > ⚠️ **上游自述的适用边界**（README 口径，评审时请一并核对）：
 * > - 上游靠**探测本机 dsh 版本与能力（含实测校准）**来适配「任意 dsh 版本」。
 * >   这既是它的价值，也是它的**风险面**：判定依赖运行时探测结果，
 * >   探测本身可能失败或误判 —— 界面文案**不得**把预警渲染成确定结论。
 * > - 上游的「一键修复」会做**真实的写操作**（隔离 / 卸载 / 升级），
 * >   且自称「改前自动备份、失败自动回滚」。本仓对该写入口的边界见 README。
 */

export const UPSTREAM_PACKAGE = 'dsh-compat-vet';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.3.2';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/liujianqiao701/dsh-compat-vet';

/** 上游许可证：MIT（GitHub API `license.spdx_id = MIT`，LICENSE 首行实文已核）。 */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者。 */
export const UPSTREAM_AUTHOR = 'liujianqiao';

/**
 * 上游在 `dsh` 字段里声明的挂载形状（2026-10-17 经 npm registry 实包核实）。
 *
 *   dsh: {
 *     bundle:  { patch: './cordis.patch.yml' },     ← **标准 bundle 形状，可锁版挂载**
 *     engines: { dsh: '*' },
 *     client:  { inject: [], platform: 'web' },
 *   }
 *   exports: {
 *     ".":          ./lib/index.js
 *     "./audit":    ./lib/audit.js
 *     "./adapt":    ./lib/adapt.js
 *     "./repair":   ./lib/repair.js
 *     "./upgrade":  ./lib/upgrade.js
 *     "./client":   ./lib/client.js
 *   }
 *   bin: { "dsh-compat-vet": "lib/cli.js" }         ← 另有 CLI 入口（doctor）
 *   engines: { node: '>=20' }
 *
 * 与 `rogerdigital/dsh-vet` 的**关键差别**（那条已登记为 🟡 但**不可锁版挂载**）：
 * 后者的 `dsh` 字段是 `{ seams: [fs, shell, web] }`，**不是 `bundle.patch` 形状** ——
 * 那意味着它**不能被 profile 以 bundle 方式挂载**，只能另想办法。
 * 本上游是**标准 `bundle.patch` 形状**，且 npm 已发布 0.3.2，**可以锁版引入**。
 * 这是本轮把 L2 骨架给它、而不是给 dsh-vet 的**决定性理由**。
 */
export const UPSTREAM_MOUNT = {
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  hasBundlePatch: true,
  hasClientEntry: true,
  /** 上游自带 patch 的 insert 行 id（来自实包 `cordis.patch.yml`）。 */
  upstreamPatchRowId: 'compat-vet',
  /** 上游导出的可编程入口（实包 `exports` 字段，供适配层取数）。 */
  auditEntry: './audit',
  adaptEntry: './adapt',
  repairEntry: './repair',
  /** 上游 CLI 入口（`dsh-compat-vet` / `npm run doctor`）。 */
  cliBin: 'dsh-compat-vet',
};

/**
 * 上游声明的宿主兼容性。
 *
 * 与 paper / plugin-audit 两个骨架不同，**本上游刻意不锁 dsh 版本**
 * （`engines.dsh: '*'`）—— 它选择「运行时探测 + 实测校准」来适配任意 dsh 版本。
 * 记在这里的用途：这是一个**策略声明**，不是兼容性承诺；
 * 它的实际可靠性取决于探测逻辑，评审时应要求给出探测失败时的降级行为。
 */
export const UPSTREAM_COMPAT = {
  dshEngines: '*',
  node: '>=20',
  strategy: 'runtime-probe-and-calibrate',
};

/**
 * 读取上游运行时版本。骨架阶段**不实现** —— 保持与 paper / plugin-audit 同形，
 * 以便评审通过后直接照抄那边的实现。
 *
 * TODO（评审通过后）：解析 `node_modules/${UPSTREAM_PACKAGE}/package.json`
 * 的 `version`，与 `UPSTREAM_VERSION` 比对；不一致时**不抛错**，
 * 而是把结果暴露给页面（与 paper 包一致：锁版失败应当在界面上可见，
 * 而不是让整页挂掉）。
 */
export function readInstalledVersion() {
  throw new Error('骨架占位：readInstalledVersion() 未实现。');
}

/**
 * 上游能力的**适配出口**占位。
 *
 * 上游是**宿主侧 + 客户端**双半边插件（有 `dsh.client`），对外是「插件体检」：
 *
 *   ① `./audit` —— 探测本机 dsh 版本与能力，检查**已装插件是否冲突**，
 *      产出「哪些插件下次启动会被拒绝加载」的结构化预警；
 *   ② `./repair` —— 一键修复（隔离 / 卸载 / 升级），改前自动备份、失败自动回滚；
 *   ③ `./client` —— 在 DSH 页面上给出中文预警与一键修复按钮。
 *
 * 本仓「插件」页要的是 ① 的**结构化读数**，喂给现有那张依赖图。
 * 两条路（评审时二选一）：
 *
 *   a. **只取数据（倾向）**：宿主侧调 `./audit`，把每个已装插件的
 *      `compatible` / `rejectReason` / `soonIncompatible` 取出来，
 *      作为依赖图每一行的**追加列**。
 *      —— 满足「**仍是同一个面板**」：插件页不新开视图、不改导航。
 *
 *   b. **挂上游整套 UI**：上游自带 `./client`，理论上可整页挂载。
 *      **不建议** —— 会多出一个导航项/一块新面板，违反「仍是同一个面板」；
 *      而且上游的修复按钮会写 profile，与本仓「不另开写入口」原则冲突。
 *
 * ⚠️ **无论走哪条，上游的「一键修复」写入口都不应直接暴露给学生**：
 * 它做的是真实的隔离/卸载/升级。本仓的策略是**只读预警 + 引导到既有行级开关**
 * （`pluginManager.setPluginEnabled`，与「插件」页现有开关同一条路径）。
 * 详见 README 的「需要人工裁定的事项」第 2 条。
 */
export function readCompatProfile() {
  throw new Error('骨架占位：readCompatProfile() 未实现。见上方 (a)/(b) 二选一说明。');
}
