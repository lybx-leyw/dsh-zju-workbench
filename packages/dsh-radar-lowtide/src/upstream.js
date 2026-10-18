/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * ── 为什么版本写死在两个地方 ────────────────────────────────────
 *
 *   1. `package.json` 的依赖必须是**精确版本**（`0.2.8`，不是 `^0.2.8`）。
 *      上游处在 `0.2.x`，0.x 阶段语义化版本**不承诺兼容**：一次 patch 就可能改掉
 *      `ctx` 上的服务键、设置项形状，或 `permissionPresets` 的写入方式 ——
 *      而这些恰好是本包唯一要接的地方。
 *   2. `package.json` 只约束「装什么」，不约束「跑起来的是哪份」：lockfile、
 *      workspace 提升、`npm link` 都能绕过。所以运行时必须再核一次
 *      （`index.js` 的 TODO-0 / TODO-2）。
 *
 *   3. 后续应补 `tests/radar-lowtide.test.mjs`，用这两个常量断言
 *      「声明 → 实际安装 → 代码预期」三者一致。锁版这件事必须有一条会红的测试。
 */

export const UPSTREAM_PACKAGE = 'dsh-lowtide';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.2.8';

/** 供人工复核对照（契约测试要求导出）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/KelaoHu/dsh-lowtide';

/**
 * 上游的挂载形状（2026-10-19 从 **npm tarball `dsh-lowtide-0.2.8.tgz`**
 * 解出的 `package.json` 读得，不依赖仓库 HEAD，避免「仓库已改、npm 未发」的口径差）：
 *
 *   "dsh": {
 *     "bundle": { "patch": "./cordis.patch.yml" },
 *     "client": {
 *       "inject": [
 *         "@deepseek-ai/dsh-client-locale",
 *         "@deepseek-ai/dsh-client-ui-conversation",
 *         "@deepseek-ai/dsh-client-ui-settings",
 *         "@deepseek-ai/dsh-client-connection"
 *       ],
 *       "platform": "web"
 *     }
 *   }
 *
 * `peerDependencies`（npm 上的 0.2.8）：
 *   @deepseek-ai/dsh-llm / dsh-agent / dsh-session / dsh-settings / dsh-storage-domain
 *   全部 `>=0.1.0-rc.7 <0.2.2-0` —— **锁版挂载成立**，无需改上游源码。
 */
export const UPSTREAM_MOUNT = {
  bundlePatch: './cordis.patch.yml',
  clientInject: [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-settings',
    '@deepseek-ai/dsh-client-connection',
  ],
  platform: 'web',
};

/**
 * 上游 patch 里**我们明确不取**的那一段（见 `cordis.patch.yml` 顶部说明）：
 *
 *   `- id: permission` —— 整行替换宿主权限行，并新增三个 `approval: never` 预设。
 *
 * 这里只记「不取什么、为什么」，不复制上游那段 YAML（避免被误当模板粘贴）。
 */
export const REJECTED_PATCH_ROWS = ['permission'];

/**
 * 上游的**外部 API 面**，本仓默认必须关闭。
 *
 * 上游 `routes.ts` 在 L3 全自动模式下提供 `POST /ds-lowtide/tasks`（外部投递任务）。
 * 本仓单机工作台**没有鉴权层**，该路由一旦绑到 0.0.0.0 就等于「内网任何人可让 Agent 跑活」。
 *
 * TODO-2：确认上游是否支持只绑回环 / 完全关闭该路由；不支持则本包不能启用 L3。
 */
export const EXTERNAL_ROUTES_TO_DISABLE = ['POST /ds-lowtide/tasks'];

/**
 * TODO-0：核对上游在 `ctx` 上暴露的服务名与设置键。
 *
 * 已确认的信号（读 npm tarball 的 `lib/index.js`，**未摘码**）：
 *   - `ctx.permissionPresets.set(agent.session, task.permissionPreset)` —— 说明它在**运行时**
 *     往会话上写预设名；因此「预设名不存在」不会在挂载时立刻报错，而是在跑任务那一刻才炸。
 *   - 上游内置 `permissionPreset` 枚举里含 `lt-*` 预设名。
 *
 * 未确认：服务导出名、设置项 schema。**评审时必须对照 `lib/types/**/*.d.ts` 核实后再填。**
 */
export const SERVICE_KEY_TO_VERIFY = 'lowtide';
