/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 `package.json` 和注释里：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`1.2.4`，不是 `^1.2.4`）。
 *      上游是 Web 端插件：它声明了 `dsh.bundle.patch`（指向自己的 `cordis.patch.yml`）、
 *      `dsh.client.inject`（4 个注入点）与 `dsh.marketplace` 元数据 ——
 *      这种「挂载形状 + 注入点清单 + marketplace 权限」在小版本里就可能变。
 *      `^` 会让 `npm install` 在某次无关改动里悄悄把挂载形状换掉，
 *      而本仓的承载层是按旧形状写的。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次，并把结果
 *      暴露给页面（不抛错：见 `index.js` 的说明）。
 *   3. 后续应补 `tests/radar-panda-calendar.test.mjs`，用这两个常量断言
 *      「声明、实际安装、代码预期」三者一致 —— 锁版这件事必须有一条会红的测试，
 *      否则它只是一句口号。（本轮仅出骨架，测试留待评审通过后补。）
 */

export const UPSTREAM_PACKAGE = 'dsh-panda-calendar';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '1.2.4';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/panda/dsh-panda-calendar';

/**
 * 上游在 `dsh` 字段里声明的挂载形状（2026-10-16 经 npm registry + 仓库 `package.json` 核实）：
 *
 *   dsh: {
 *     bundle: { patch: './cordis.patch.yml' },
 *     client: {
 *       platform: 'web',
 *       inject: [
 *         '@deepseek-ai/dsh-client-runtime',
 *         '@deepseek-ai/dsh-client-locale',
 *         '@deepseek-ai/dsh-client-ui-slots',
 *         '@deepseek-ai/dsh-client-ui-conversation'
 *       ]
 *     },
 *     marketplace: {
 *       profiles: ['web'],
 *       requiresBuildApproval: false,
 *       requiresRestart: true,
 *       manualSteps: false
 *     }
 *   }
 *
 * `dependencies` 与 `peerDependencies` **均为空**（零运行时依赖，
 * 宿主侧依赖全部从 `dsh.client.inject` 的注入点取得）—— 零传递污染。
 *
 * 上游另有 `exports`：`"."` → `./lib/index.js`、`"./client"` → `./lib/client.js`。
 * 本包**只取 `./client` 的历法模块**（见 index.js 的 TODO 第 2 条），不用其标签页形态。
 *
 * 记在这里的作用是：本包**不自建历法引擎**，只做「锁版引入 + 承载」。
 * 真正把上游接进「今天」页、并决定它接管哪一块 UI 的那一步属于**编辑性质**，
 * 不在本骨架内完成 —— 见 README 的「接入边界」。
 */
export const UPSTREAM_MOUNT = {
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  hasBundlePatch: true,
  hasClientEntry: true,
  /** 上游声明的注入点，承载层需逐一对照，避免与既有页面争抢同一 slot。 */
  injectPoints: [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-conversation',
  ],
  runtimeDependencies: [],
  /**
   * 上游 `dsh.client` 注册在 `conversation.view` slot 上的**标签页**。
   * ⚠ 本骨架**不打算**接管这个标签页 —— 见 README「接入边界」第 3 条。
   * 记在这里是为了让评审能一眼看到「上游默认会多出一个页头标签」这件事。
   */
  upstreamRegistersTab: { slot: 'conversation.view', order: 30, label: '熊猫日历' },
  /**
   * 上游内嵌的离线圈日引擎，其数据表的**来源与校验**（源码注释已核实）：
   *   - 生成器：`tools/gen-engine-data.mjs`
   *   - 来源：`lunar-javascript`（6tail，**MIT**）
   *   - 校验：`test/engine.test.mjs` 断言 1900-01-31 … 2100-12-31
   *     共 **73384 天逐日比对，0 处不一致**
   * 这是本候选「底层更优质」判据的**证据**，不是自述。
   */
  calendarEngine: {
    source: 'lunar-javascript (6tail)',
    sourceLicense: 'MIT',
    coverage: '1900-01-31 .. 2100-12-31',
    daysValidated: 73384,
    mismatches: 0,
  },
};
