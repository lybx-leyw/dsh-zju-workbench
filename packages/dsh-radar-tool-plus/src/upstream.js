/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * ── 为什么版本写死在两个地方 ────────────────────────────────────
 *
 *   1. `package.json` 的依赖必须是**精确版本**（`0.1.14`，不是 `^0.1.14`）。
 *      上游处在 `0.1.x`，语义化版本在 0.x 阶段**不承诺兼容**：任何一次 patch
 *      都可能改掉 `dsh.bundle.patch` 里要停用的工具 id，而这几个 id 一旦命名变化，
 *      `cordis.patch.yml` 里的 `disabled: true` 会**静默失效**（配置项对不上不会报错，
 *      只是不生效）—— 届时页面会「看起来装上了」，但工具其实还是官方那套。
 *   2. `package.json` 只约束「装什么」，不约束「跑起来的是哪份」。lockfile、全局覆盖、
 *      `npm link` 都能绕过它。所以运行时再核对一次（见 `index.js` 的 TODO-5）。
 *
 *   3. 后续应补 `tests/radar-tool-plus.test.mjs`，用这两个常量断言
 *      「声明 → 实际安装 → 代码预期」三者一致。锁版这件事必须有一条会红的测试。
 */

export const UPSTREAM_PACKAGE = '@xiaoso/dsh-tool-plus';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.1.14';

/** 供人工复核对照（契约测试要求导出）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/xiaoso456/dsh-tool-plus';

/**
 * 上游的挂载形状（2026-10-18 读仓库 `HEAD` 的 `package.json` 得）：
 *
 *   "dsh": {
 *     "manifestVersion": 1,
 *     "bundle": {
 *       "patch": [
 *         "./cordis.patch.yml",
 *         "./presets/tool-plus-standard.patch.yml",
 *         "./presets/tool-plus-ptc.patch.yml"
 *       ]
 *     },
 *     "client": {
 *       "inject": ["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-settings"],
 *       "platform": "web"
 *     }
 *   }
 *
 * ⚠ **三个 patch、两个插槽** —— 这是本候选最大的适配风险：
 *
 *   - patch #1 **停用四行官方工具**（bash / pwsh / fs / fs-search）。本仓的沙箱治理与
 *     `ctx.shell` 能力缝就挂在这几行上，整包套用 = 拆掉治理层（见 README TODO-1）；
 *   - patch #2 / #3 是**产物形态**预设（标准增强版 / PTC Code Mode），属整包切换，
 *     本仓只需要其中一种的部分能力，不需要「整套换掉」。
 *
 * 因此本骨架**只挂宿主半边**，`cordis.patch.yml` 里只有一条 insert，不复刻上游 patch。
 * 若上游无法在不套用它的 patch 的情况下单独提供工具实现 → **降级为 🟡**（源码级移植），
 * 不走锁版路线。
 */
export const UPSTREAM_PATCH_FILES = [
  './cordis.patch.yml',
  './presets/tool-plus-standard.patch.yml',
  './presets/tool-plus-ptc.patch.yml',
];

/**
 * 上游会**停用**的宿主工具行 —— 评审时必须逐条核对本仓是否依赖它们。
 *
 * 其中 `bash-sandbox` / `pwsh-sandbox` 上游**保留**（它只替换「模型可见的工具行」，
 * 保留 `ctx.shell` 能力缝给 hooks 等消费者）。这一区分是对的，但本仓仍需自行确认：
 * 停掉 `tool-bash` 之后，终端分页里直接敲命令的通道是否还在。
 */
export const UPSTREAM_DISABLES_HOST_TOOL_IDS = [
  'tool-bash',
  'tool-pwsh',
  'tool-fs',
  'tool-fs-search',
];

/**
 * 运行时依赖里需要单独评估的三项（不是「不许用」，是「装的时候要看一眼」）：
 *
 *   - `koffi`（optional，^3.3.1）：原生 FFI 绑定，安装要放行构建脚本
 *     （上游 README 要求 `--allow-build=koffi`）。本仓 CI 若禁构建脚本，装不上；
 *   - `puppeteer-core`（^25.3.0）：`read` 抓取 SPA 页面时调用**本机**浏览器。
 *     不下载 Chromium，但需要机器上已有浏览器；
 *   - `@oh-my-pi/pi-natives`（18.1.17）：随包分发**上游编译好的二进制**（Rust 版
 *     hashline 引擎）。这是「不搬源码」原则下最需要人工看一眼的一项 —— 二进制不可审。
 *     上游 `THIRD_PARTY_NOTICES.md` 已声明其来源与 MIT 许可。
 */
export const UPSTREAM_RUNTIME_RISKS = ['koffi', 'puppeteer-core', '@oh-my-pi/pi-natives'];
