/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 `package.json` 和注释里
 * （与 `dsh-zhiyun-host-paper/src/upstream.js`、`dsh-radar-context-lens/src/upstream.js`
 * 同一套理由）：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.1.4`，不是 `^0.1.4`）。
 *      上游做的是**静态权限扫描**，它的判定口径会随版本变：新增哪一类
 *      capability、哪些目录算「凭据路径」、`risk` 分级的阈值怎么算 ——
 *      这些都在动，而且**动了以后报告看上去仍然是「正常的卡片」**。
 *      `^` 会让 `npm install` 在某次无关改动里悄悄把审计口径换掉，
 *      而「插件页徽标少了一条 / 多了一条」是最难被发现的那类漂移。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于
 *      别人的 lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次。
 *   3. `tests/radar-packages.test.mjs` 用下面这几个常量断言
 *      「声明、实际安装、代码预期」三者一致 —— 锁版必须有一条会红的测试，
 *      否则它只是一句口号。
 *
 * > ⚠️ **上游自述的适用边界**（README 原文口径，评审时请一并核对）：
 * > - DSH 主线的**兼容快照是 2026-08-14**，且明确写明 *"DSH is in developer preview
 * >   and ships breaking changes frequently"* —— **兼容性是时效性的**，不是长期的。
 * > - `dsl-plugin-audit` 的 sentinel 依赖 `tools/pre-execute` waterfall，
 * >   这是**上游内部契约**，非本仓可控面。
 * > - 上游自称 *"The audit is an aid, not a verdict"* —— 报告是**证据**不是**判决**。
 * >   本仓若采用，界面文案**不得**把 `risk` 呈现成最终结论。
 */

export const UPSTREAM_PACKAGE = 'dsh-plugin-audit';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.1.4';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/jkrandom-sudo/dsh-plugin-audit';

/** 上游许可证：MIT（GitHub API `license.spdx_id = MIT`，npm `license = MIT`）。 */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者。 */
export const UPSTREAM_AUTHOR = 'jkrandom-sudo';

/**
 * 上游在 `dsh` 字段里声明的挂载形状（2026-10-15 经 npm registry 核实）：
 *
 *   dsh: { bundle: { patch: './cordis.patch.yml' } }
 *   exports: {
 *     ".":        ./lib/index.js          ← 插件主体（静态审计工具 + 运行时哨兵）
 *     "./invariant": ./lib/invariant.js   ← **上游刻意不接进自己的 patch**
 *     "./src/*":  ./src/*
 *   }
 *   peerDependencies: { cordis: '^4.0.0-rc.7', schemastery: '^3.18.0' }
 *   engines: { node: '^22.19.0 || >=24.0.0' }
 *
 * 与 `dsh-radar-better-markdown` / `dsh-radar-context-lens` 的**关键差别**：
 * 上游**没有** `dsh.client` 声明。也就是说它**自己不提供浏览器半边** ——
 * 它只在宿主侧注册一个 `plugin_audit` 工具和一个 `tools/pre-execute` 监听器。
 *
 * 这个差别决定了本骨架的集成路径，也决定了「强化式集成」的第三条判据能否成立：
 * 本仓「插件」页**不能**指望「挂上游视图」拿到画面（上游没有视图可挂），
 * 只能**在宿主侧调它的审计接口拿数据**，再自己画成插件页上的一列。
 * 详见 `src/index.js` 的 TODO 与 README 的「集成路径」。
 */
export const UPSTREAM_MOUNT = {
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  hasBundlePatch: true,
  hasClientEntry: false,
  /** 上游导出的审计入口（`plugin_audit` 工具背后的实现；评审时按实际 exports 复核）。 */
  auditEntry: 'plugin_audit',
  /** 上游的运行时哨兵依赖的宿主 waterfall —— **上游内部契约**，非本仓可控面。 */
  sentinelWaterfall: 'tools/pre-execute',
  /** 上游的 invariant 伴生包：上游刻意未接进 patch（stock profile 无 `invariants` 服务）。 */
  invariantCompanion: 'dsh-plugin-audit/invariant',
};

/**
 * 上游声明的宿主兼容性（**时效性**声明，非承诺）。
 *
 * 记在这里的用途：本仓若要跟进，必须把这一行当作**会过期的字段**来维护，
 * 而不是当作「已验证」的结论。评审时请核对当前 DSH 主线快照是否已越过它。
 */
export const UPSTREAM_COMPAT = {
  verifiedSnapshot: '2026-08-14',
  node: '^22.19.0 || >=24.0.0',
  cordisPeer: '^4.0.0-rc.7',
};

/**
 * 读取上游运行时版本。骨架阶段**不实现** —— 保持与 paper 包同形，
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
 * 上游是**宿主侧**插件（无 `dsh.client`，见 `UPSTREAM_MOUNT`）。它对外只有两样东西：
 *
 *   ① `plugin_audit` 工具 —— 输入一个插件源码目录，输出权限画像卡片
 *      （markdown + `{ markdown, risk, filesScanned, findingsCount, writesPerformed }`）；
 *   ② `tools/pre-execute` 哨兵 —— 工具调用触到凭据路径/未知主机时返回 `ask`。
 *
 * 本仓「插件」页要的是 ① 的**结构化读数**，喂给现有那张依赖图。
 * 两条路（评审时二选一）：
 *
 *   a. **只取数据（倾向）**：宿主侧调 `plugin_audit`，把每个已装插件的
 *      `risk` / `findingsCount` / 关键 capability（fs-write、child-process、
 *      outbound-hosts、env-credential）取出来，作为依赖图每一行的**追加列**。
 *      —— 满足「**仍是同一个面板**」：插件页不新开视图、不改导航。
 *
 *   b. **整页挂载**：把上游当独立插件页挂上。**不建议** —— 上游没有 client 半边，
 *      这条路实际要先给它补一个视图层，等于重写上游，违反硬边界。
 *
 * ⚠️ **无论走哪条，「运行时哨兵」都不应在本仓默认启用**：它会在每一次工具调用上
 * 追加一次审批询问，而本工作台是**学生日常使用**的学习台，不是安全运维台。
 * 详见 README 的「需要人工裁定的事项」第 2 条。
 */
export function readAuditProfile() {
  throw new Error('骨架占位：readAuditProfile() 未实现。见上方 (a)/(b) 二选一说明。');
}
