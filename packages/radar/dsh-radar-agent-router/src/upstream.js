/**
 * 上游包的**锁版凭据**（单一真源）—— 写法照抄 `dsh-radar-llm-fallback/src/upstream.js`。
 *
 * 为什么不搬运上游源码：上游是「路由声明 + 出站改写 + 设置卡片」三件套，
 * 任何一行搬进本仓都会立刻过期（它每周发版）。本包只 `import` 它的公开入口。
 *
 * 版本必须与 `package.json` 的 `dependencies["dsh-llm-agentrouter"]` **逐字符相同**。
 * 真实安装的版本由 `npm ls dsh-llm-agentrouter` 核对，不得信任本文件。
 */

export const UPSTREAM_PACKAGE = 'dsh-llm-agentrouter';

/** 我们适配并测试过的上游版本，必须与 `package.json` 的依赖逐字符相同。 */
export const UPSTREAM_VERSION = '2.6.1';

/** 上游许可证（README / ATTRIBUTION 核对用，不参与运行时逻辑）。MIT ✅ */
export const UPSTREAM_LICENSE = 'MIT';

/** 上游作者 / 组织。 */
export const UPSTREAM_AUTHOR = 'aqiu817';

/** 上游仓库。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/aqiu817/dsh-llm-agentrouter';

/**
 * 上游声明的 peer 窗口（2026-10-29 核实，npm registry `dsh-llm-agentrouter@2.6.1`）：
 *
 *   - `peerDependencies`：`@deepseek-ai/cordis: *`、`@deepseek-ai/schemastery: *` ——
 *     **两个都是 `*`，等于没有窗口**，必须由本仓在装载期自己把住；
 *   - `dependencies`：**无**（零运行时依赖，`unpackedSize` 100,432 B）；
 *   - `dsh.client.inject`：`@deepseek-ai/dsh-client-locale`、
 *     `@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-client-ui-plugin-manager`，
 *     `platform: web` —— 本仓 profile 是 web，宿主 `@deepseek-ai/dsh-base` + `dsh-web-app`
 *     必须已提供这三个客户端包，否则设置卡片会渲染成空白（见 README §风险 R-1）。
 *
 * 下面两个常量不是运行时读来的值，而是**要求评审核对**的断言。
 */
export const UPSTREAM_PEER_CORDIS = '*';
export const UPSTREAM_PEER_SCHEMASTERY = '*';

/**
 * 上游会**覆盖宿主 `llm-pi-ai` 行的 `providers`** —— 这是本骨架最大的风险面。
 *
 * 本仓 profile 目前没有自己的 `llm-pi-ai` 覆盖层（`profiles/zhiyun-bench/package.json`
 * 的 `bundles` 里没有相关行），所以冲突面暂时为零；但一旦以后为了别的 provider
 * 在 profile 里也覆盖 `providers`，**两处覆盖会互相整段顶掉**（上游 README 自己
 * 记录了这件事，并用 `lib/route.js` 做「路由自愈」）。
 *
 * 评审动作：若本仓将来加入任何 `llm-pi-ai.providers` 覆盖，必须先确认上游的
 * `route.js` 仍能把 `agentrouter` 路由重新声明回去，否则本包必须撤销。
 */
export const UPSTREAM_OVERRIDES = 'llm-pi-ai.providers';

/** 上游写入的哨兵主机后缀（识别「需要被改写的出站请求」用，评审对照用）。 */
export const UPSTREAM_SENTINEL_SUFFIX = '.internal';

/**
 * 加载上游。
 *
 * **故意返回失败**：候选骨架不注册任何路由、不发任何出站请求、不写任何设置。
 * 评审通过后，这里才换成 `await import('dsh-llm-agentrouter')` 并接 `apply(ctx)`。
 */
export async function loadUpstream() {
  return {
    ok: false,
    reason: 'candidate-skeleton: not wired',
    package: UPSTREAM_PACKAGE,
    version: UPSTREAM_VERSION,
  };
}
