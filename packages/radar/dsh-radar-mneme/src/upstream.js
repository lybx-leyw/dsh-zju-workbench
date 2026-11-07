/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 写法照 `dsh-radar-kb-rag/src/upstream.js`：`package.json` 写精确版本，
 * 运行时再核对一次 —— 只锁 `package.json` 挡不住别人的 lockfile / 全局覆盖 / `npm link`。
 *
 * # r112 实查到的四件事（写在这里，评审时不必重查）
 *
 *   a. **npm 包归属与仓库一致**：`@modusensus/dsh-mneme` 的 `repository.url`
 *      指向 `https://github.com/slow-stack/mneme.git`，`latest = 0.9.5` 与仓内
 *      `dsh-mneme/package.json` 的 `version` 逐字符相同。**这是 r111 的
 *      `dsh-modpack` 教训的正面对照**（那次的 npm 包指向了别家仓库）。
 *   b. **体积**：npm `dist.unpackedSize = 7,710,271 B`（约 7.4 MiB）、`fileCount = 396`。
 *      这是本轮对该包唯一保留的顾虑之一（见 README「风险」表第 2 行）。
 *   c. **`dependencies` 只有 1 个**（`morphicons@^1.7.1`），其余全是 `peerDependencies`：
 *      `@deepseek-ai/cordis` / `dsh-host-webserver` / `dsh-llm` / `dsh-system-prompt` /
 *      `dsh-tools` / `schemastery` / `@huggingface/transformers` / `dsh-better-sidebar`。
 *      **其中 `dsh-better-sidebar` 是本仓既有架构里没有的一层**（工作台右栏底座），
 *      见 `REQUIRED_SIDE_EFFECTS` 与 README 的 TODO-1。
 *   d. **上游自带 `dsh.bundle.patch`**（`cordis.patch.yml` 只有一条 `insert`，带默认 config）。
 *      ⇒ 与本包 patch **不可同挂**（同 r111 `dsh-diff-approval` 的结论）。
 *      本包 patch 只挂**本包**，上游由本包在 `apply()` 里按 config 显式挂载。
 */

export const UPSTREAM_PACKAGE = '@modusensus/dsh-mneme';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.9.5';

/** 上游发布源头。npm `repository.url` 实查（2026-10-30）指向这里。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/slow-stack/mneme';

/** 上游许可证。MIT —— 宽松白名单内，可集成。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 上游 `apply()` 依赖的宿主服务（取自 `peerDependencies`）。
 * 少任何一个，cordis 的激活顺序就会让上游拿到 `undefined` —— 表现为
 * 「面板在、记忆不注入」，而不是启动失败。
 */
export const REQUIRED_SERVICES = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-host-webserver',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/schemastery',
];

/**
 * **不是** cordis 服务、但上游运行时时会去找的槽位 / 类型：
 *   - `slots`：上游 `dsh.client.inject = ["slots", "locale"]`，`platform: "web"`；
 *   - `sidebar.right.pane.tab` 等：`lib/client.js` 里 `ctx.slots.inject(...)` 的目标槽位；
 *   - `dsh-better-sidebar`：可选软依赖（`lib/client.js:293` 注释明写「inject 声明的
 *     服务是硬等待 —— 未安装 better-sidebar 的环境里整个 entry 会挂起」）。
 *
 * ⇒ 本包**不需要** `dsh-better-sidebar` 也能加载，但**必须先确认**宿主槽位表里有
 *    下面这几个 key，否则面板会挂在一个不存在的槽上（静默不显示）。
 */
export const REQUIRED_SLOT_KEYS = [
  'conversation.session.header.actions',
  'conversation.chat.turnTail',
  'sidebar.right.pane.tab',
  'sidebar.right.pane.tab.title',
];

/**
 * 上游注册的 model tools（README 声明 10 个，本轮**未逐条实取**，见 TODO-3）。
 * 列出名字是为了让评审一眼看清「这些工具会进模型的工具面」。
 */
export const UPSTREAM_TOOLS = [
  'memory_save',
  'memory_search',
  'memory_get',
  'memory_update',
  'memory_forget',
  'memory_list',
  'memory_summarize',
  'memory_profile',
  'memory_rules',
  'memory_stats',
];
