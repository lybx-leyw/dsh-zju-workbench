/**
 * 上游包的**锁版凭据**（单一真源）。
 *
 * 为什么把版本号单独放一个模块、而不是散在 `package.json` 和注释里：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.1.0`，不是 `^0.1.0`）。
 *      上游是一个 MCP server：它的**对外形状是工具清单 + 入参 schema + 环境变量契约**，
 *      而不是 DSH 的 `dsh.bundle.patch`。这三样恰是小版本里最容易变的东西 ——
 *      工具一旦改名（例如 `cc98_get_posts` → `cc98_topic_posts`），承载层写死的映射就静默失效。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于别人的
 *      lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次，并把结果
 *      暴露给页面（不抛错：见 `index.js` 的说明）。
 *   3. 后续应补 `tests/radar-cc98-sdk.test.mjs`，用下面两个常量断言
 *      「声明、实际安装、代码预期」三者一致 —— 锁版这件事必须有一条会红的测试，
 *      否则它只是一句口号。（本轮仅出骨架，测试留待评审通过后补。）
 */

export const UPSTREAM_PACKAGE = 'cc98-mcp';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '0.1.0';

/**
 * 上游的事实（2026-10-18 经 GitHub API + 文件树 + `package.json`/`README` 实文核实）：
 *
 *   - 仓库：EviterLesRoses2/cc98-mcp，★4，MIT（`LICENSE` 1060 B 实文在库）
 *   - 语言：TypeScript（ESM），**需要构建**（`tsc` → `dist/`），`engines.node >= 18`
 *   - 运行时依赖：`@modelcontextprotocol/sdk` + `zod`（两个，均为 MIT）
 *   - 对外形态：**MCP server**（stdio），10 个**只读**工具
 *   - 网络：默认 `auto` —— 先直连 `api.cc98.org`，失败则走 `webvpn.zju.edu.cn` 中转
 *   - 凭据：`CC98_USERNAME` / `CC98_PASSWORD`（+ 可选 `ZJU_USERNAME` / `ZJU_PASSWORD`）
 *
 * ⚠ **锁版可安装性的关键风险（评审必读）**：
 *   仓库根 `package.json` 的 `name` 是 `cc98-mcp`、`version` 是 `0.1.0`，但
 *   **npm registry 上 `cc98-mcp` 返回 404（Not found）** —— 上游**从未发布到 npm**。
 *   因此 `"cc98-mcp": "0.1.0"` 这条依赖目前**装不上**。
 *   评审有两条出路，须二选一（见 README「接入边界」第 1 条）：
 *     (a) 等上游发 npm，或改用 git 依赖 `git+https://…/cc98-mcp.git#<commit>`（此时
 *         `UPSTREAM_VERSION` 改为该 commit 短哈希，仍属「锁版」但不属「npm 锁版」）；
 *     (b) 放弃挂载、按 MIT 做**源码级移植**，把 `webvpn.ts` / `client.ts` / `ubb.ts`
 *         三块搬进本仓并保留版权声明（属「移植较多代码」，须走 CONTRIBUTING 3.3 的包内 ATTRIBUTION）。
 *   **本骨架按 (a) 的形状写**（`dependencies` + `src/upstream.js`），因为它是 A 类模板；
 *   但若评审选 (b)，`dependencies` 与 `src/upstream.js` 应一并删除。
 *
 * 记在这里的作用是：本包**不复刻 CC98 客户端**，只做「锁版引入 + 服务化承载」。
 * 真正决定「论坛读数进哪个面板、哪些工具暴露给 AI」的那一步属于**编辑性质**，
 * 不在本骨架内完成 —— 见 README 的「接入边界」。
 */
export const UPSTREAM_MOUNT = {
  package: UPSTREAM_PACKAGE,
  version: UPSTREAM_VERSION,
  hasBundlePatch: false,
  hasClientEntry: false,
  /** 上游是 stdio MCP server：线程模型与本仓插件不同，承载层须做进程内适配，见 index.js TODO 第 2 条。 */
  transport: 'stdio-mcp',
  needsBuild: true,
  nodeEngine: '>=18',
  runtimeDependencies: ['@modelcontextprotocol/sdk', 'zod'],
  /** 上游暴露的 10 个只读工具（原名，勿改；映射表在 src/index.js 的 TODO 第 3 条）。 */
  tools: [
    'cc98_search_topics',
    'cc98_get_posts',
    'cc98_hot_topics',
    'cc98_new_topics',
    'cc98_list_boards',
    'cc98_get_board_topics',
    'cc98_get_user',
    'cc98_get_image',
    'cc98_download',
    'cc98_status',
  ],
  /**
   * 与上游「同源」的第二条实现：上游 `README.md` 明写其 API 端点与 WebVPN 实现
   * **参考了 `Lucent-Snow/CC98-CLI`（MIT）**。两条都 MIT、都只读、都 TS。
   * 承载层不必二选一，但**若只取一条**，须在评审记录里写明理由（见 README 第 3 条）。
   */
  siblingImplementation: { repo: 'Lucent-Snow/CC98-CLI', license: 'MIT', stars: 18 },
};
