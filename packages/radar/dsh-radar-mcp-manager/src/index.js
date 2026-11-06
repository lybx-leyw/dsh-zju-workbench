/**
 * dsh-radar-mcp-manager —— **候选骨架的占位入口**。
 *
 * ⚠ 本文件**不写业务逻辑**，只标注适配点与 TODO；`apply()` 被调用即抛错，
 *   以免评审者误把本包挂进 profile 后在启动期静默加载。
 *   待人工评审通过后，再逐条落实 TODO；评审驳回则整目录删除。
 *
 * ── 它是什么 ──────────────────────────────────────────────────────────
 *
 * 上游 `dsh-mcp-manager@0.6.0` 是一份完整的 MCP（Model Context Protocol）客户端管理插件：
 * 从 `$DSH_HOME/mcp-servers.json` 读服务器清单，连 stdio / SSE / streamable-HTTP 三类传输，
 * 把对端工具注册进宿主 `tools` 服务，并在 `/mcp-manager/*` 上开一组管理路由
 * （含 `/.well-known/oauth-authorization-server`、`/authorize`、`/token`、`/register`）。
 *
 * ── 为什么是「全新」而不是「强化式集成」────────────────────────────────
 *
 * 强化式集成的三条判据是「**同一个面板** + 功能相似正交 + 底层换更优实现」。本包例外地
 * 一条都不成立，**必须如实写成「全新」**：
 *
 *   1. 不是同一个面板 —— 本仓 34 个 `dsh-zhiyun-*` 包里 **没有一个** 提供「外部工具来源」
 *      这个概念的面板（实测 `grep -rli mcp packages/dsh-zhiyun-*/src` 的 8 个命中
 *      **全部是注释/文档里的字符串**：`cc98-mcp`、`zju-mcp`、`MCP HTTP 传输`，
 *      没有任何一行在实现 MCP 客户端）。没有可被强化的既有面板。
 *   2. 功能不是「相似正交」—— 本仓的工具面是**自建**的
 *      （`dsh-zhiyun-source-*` 直连 CC98 / 学在浙大 / 智云课堂；`core-quiz` 自己出题），
 *      这些是**业务取数**，MCP 是**工具来源通道**，两者不在同一抽象层。
 *   3. 没有「更优底层」可换 —— 本仓压根没有同类实现可供替换。
 *
 * 结论：这是**补空白**。用词必须是「全新」，写成「强化式集成」就是虚报。
 *
 * ── 评审必须先回答的三个问题（都不是代码问题）──────────────────────────
 *
 *   Q1 **同版本≠同能力**。仓库 HEAD 是 `0.14.0`（4,212 行，`dsh.compatibility.dsh`
 *      写死 `>=0.1.2-rc.1 <0.2.0`，含 workspace 隔离 + 按需 tool broker），
 *      而 npm 上**只有 `0.6.0`**（最后一次发布，仓库 package.json 里的 `version`
 *      也是 0.6.0；`engines.node` 为 `^22.19.0 || >=24`）。
 *      **锁版只能锁 0.6.0** —— 评审要判断的是「0.6.0 够不够用」，不是「HEAD 好不好用」。
 *      0.6.0 已实测含 OAuth 流程与 `/mcp-manager/*` 路由，**不含** workspace 隔离与 broker。
 *   Q2 **它会接管 `tools` 服务**。0.6.0 的 `inject = ["tools", "webServer"]`，
 *      工具注册走 `ctx.tools.insert()`。本仓没有任何包注册 `tools`，
 *      但宿主是否只有一个 `tools` 提供者必须真机确认 —— 若冲突，插件会静默不生效。
 *   Q3 **stdio 传输=任意命令执行**。0.6.0 自身的告警写得很清楚：
 *      「the web server is network-exposed (host 0.0.0.0) and no access token is set」
 *      时直接拒绝全部 `/mcp-manager/*` 请求。接入前必须定：谁能写 `mcp-servers.json`。
 *
 * ── 实测结论（2026-10-28，Node 22.13.0 / 沙箱）────────────────────────
 *
 *   P0 · npm 包是 **自包含 esbuild 产物**（`lib/index.js` 666 KB，`import` 只出现
 *        `node:module|crypto|os|path|process|stream` 与 `","`）→ **无需任何传递依赖**，
 *        `"dependencies": { "dsh-mcp-manager": "0.6.0" }` 是有效的锁版。
 *   P0 · 0.6.0 的 `exports` 指向 `./lib/index.js` 与 `./lib/client.js`；
 *        **client 侧**依赖 `@deepseek-ai/dsh-client-locale`（`dsh.client.inject`），
 *        宿主侧无 `dsh.client` → **不挂 UI 也能跑**，评审可分两步（先宿主、后 UI）。
 *   P1 · `engines.node` 要求 `>=22.19`；沙箱/宿主要自己先核 Node 小版本。
 *
 * 上游：`dsh-mcp-manager@0.6.0` · MIT · https://github.com/hyqhyq3/dsh-mcp-manager
 * 本包**未评审、未接入 profile、不可直接使用**。
 */

export const name = 'radar-mcp-manager';

/** 与上游 `inject` 保持一致；TODO-B 落实前不要改。 */
export const inject = ['tools', 'webServer'];

/**
 * TODO-A · 加载上游并**只做外围兜底**，不改上游源码。
 *
 *   预计形态（评审通过后实现）：
 *
 *     const upstream = await loadUpstream();           // src/upstream.js
 *     const run = upstream.apply(ctx, config);         // 原样转交宿主上下文
 *
 *   外围兜底要补的三件事：
 *     - `mcp-servers.json` 不存在时**不要**替用户创建（0.6.0 会自己读，读不到走空清单）；
 *     - `/mcp-manager/*` 全 401 时，把「缺 access token」暴露成一条可见告警，
 *       而不是让用户看到 404（0.6.0 只在 logger 里 warn）；
 *     - 上游抛错时**不要**吞掉，直接向上抛，避免插件行看着「已加载」但功能全无。
 */
export function apply() {
  throw new Error(
    'dsh-radar-mcp-manager: 候选骨架占位，未评审、未接入 profile、不可直接使用',
  );
}
