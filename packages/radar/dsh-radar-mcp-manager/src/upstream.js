/**
 * 上游 `dsh-mcp-manager` 的**唯一**引用点 —— 锁版凭据只在本文件出现一次。
 *
 * 本文件是占位：**不 import 上游本身**，只把「包名 / 版本 / 仓库 / 许可证 / 已知坑」
 * 写死在这里，供评审者对照。评审通过后再实现 `loadUpstream()`。
 *
 * 所有结论都在沙箱里对 `dsh-mcp-manager@0.6.0`（npm tarball 解包 + 仓库 HEAD 对照）核过
 * （2026-10-28，Node 22.13.0）。见 `docs/ecosystem-radar/2026-10-28-21.md` §3。
 */

/** npm 包名。 */
export const UPSTREAM_PACKAGE = 'dsh-mcp-manager';

/**
 * **锁版**（不带 `^`）：这是工具来源通道，版本漂移会直接改变「模型能调用到哪些工具」，
 * 必须写死。**npm 上可用的最高版本就是 0.6.0**（`npm view dsh-mcp-manager version` → `0.6.0`），
 * 仓库 HEAD 的 `0.14.0` **未发布到 npm**。
 */
export const UPSTREAM_VERSION = '0.6.0';

/** 源码仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/hyqhyq3/dsh-mcp-manager';

/** 许可证：MIT（npm `license` 字段与仓库 `LICENSE` 首行两处一致）。 */
export const UPSTREAM_LICENSE = 'MIT';

/** 宿主侧注入点（0.6.0 实测：`Y9=["tools","webServer"]`）。 */
export const UPSTREAM_INJECT = Object.freeze(['tools', 'webServer']);

/** 服务器清单文件：`$DSH_HOME/mcp-servers.json`，`DSH_HOME` 缺省为 `~/.dsh`。 */
export const UPSTREAM_CONFIG_PATH = '$DSH_HOME/mcp-servers.json';

/** 管理路由前缀（0.6.0 `webServer.register({ kind: 'prefix', path: '/mcp-manager' })`）。 */
export const UPSTREAM_ROUTE_PREFIX = '/mcp-manager';

/**
 * TODO-A · 加载上游。
 *
 *   `dsh-mcp-manager@0.6.0` 的 `exports["."]` 指向 `./lib/index.js`（ESM，自包含 bundle），
 *   具名导出仅三个：`apply` / `inject` / `name`（另加 `storePath`）。
 *   旧版本文档里的「CJS 默认导入」写法**不适用**（本包有 `exports` 字段）。
 *
 *   预计形态：
 *
 *     const mod = await import(UPSTREAM_PACKAGE);
 *     if (typeof mod.apply !== 'function') throw new Error('…上游导出面变化…');
 *
 *   必须**校验导出面**再转交：上游若在小版本里改掉 `apply` 的位置，
 *   `import()` 不会报错，只会在挂载时空转。
 */
export function loadUpstream() {
  throw new Error('dsh-radar-mcp-manager: 候选骨架占位，loadUpstream() 未实现');
}

/**
 * TODO-B · 确认宿主是否允许「第二个 `tools` 提供者」。
 *
 *   0.6.0 用 `ctx.tools.insert(definition)` 注册工具（`lib/index.js:2057/2288/2301` 附近）。
 *   本仓 `grep -rn "tools.register\|tools.insert" packages/dsh-zhiyun-*/src` → **0 命中**，
 *   即本工作台不提供 `tools` 服务。若宿主的 `tools` 是单例且已被官方插件占用，
 *   本包会**静默不生效**（不报错、不告警）—— 这是接入前必须真机验的第一件事。
 *
 * TODO-C · 定「谁能写 `mcp-servers.json`」。
 *
 *   stdio server 会在宿主进程里**执行任意命令**。0.6.0 自带一道闸：
 *   webServer 监听 `0.0.0.0` 且未配 `token` → 拒绝全部 `/mcp-manager/*`。
 *   但**文件本身**没有守卫 —— 能写该文件的人等于能在这台机器上执行命令。
 *
 * TODO-D · 与本仓既有「来源包」的边界（写清楚，否则评审会误判成重复功能）。
 *
 *   `dsh-zhiyun-source-campus`（CC98 / 学在浙大）、`source-cc98`、`source-classroom`
 *   是**业务取数**，走的是各自站点的真实 HTTP 端点、带登录态与限流；
 *   MCP 是**通用工具来源通道**，不替代它们，也不应被用来绕开它们。
 *   评审建议：第一版只允许用户手动填清单，**不**内置任何 DSH 官方或社区 MCP 服务器。
 */
export const TODO = Object.freeze(['A', 'B', 'C', 'D']);
