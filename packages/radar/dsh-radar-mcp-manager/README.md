# dsh-radar-mcp-manager —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` 与 `src/upstream.js` 的 `loadUpstream()`
> 都直接抛错或返回占位值。
> **请勿**把它加入任何 profile（`profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`），
> **请勿**在真实环境挂载。评审通过后才可继续实现；驳回则整目录删除。

---

## 集成方式：**全新**（**不是**强化式集成）

**这一点必须写在最前面，因为它违背了本仓库的默认偏好。**

skill 的核心策略是「强化式集成」—— 已有功能配上更优底层，三条判据必须是
**同一个面板 + 功能仍相似正交 + 底层多调了更优质实现**。本包**三条全部不成立**：

| 判据 | 为何不成立 | 证据 |
| --- | --- | --- |
| ① 同一个面板 | 本仓**没有**任何「外部工具来源」面板 | `grep -rli mcp packages/dsh-zhiyun-*/src` → 8 个文件命中，**全是注释/文档字符串**（`cc98-mcp`、`zju-mcp`、`MCP HTTP 传输`），无一行实现 MCP 客户端 |
| ② 功能相似正交 | 本仓工具面是**业务取数**（直连 CC98 / 学在浙大 / 智云课堂），MCP 是**工具来源通道**，不在同一抽象层 | `packages/dsh-zhiyun-source-*/src` 均为站点专用实现 |
| ③ 底层更优实现 | 本仓**没有**同类实现可供替换 | 同上 |

所以这是**补空白**。若把它写成「强化式集成」，就是在虚报判据。

---

## 它补的是什么空白

上游 `dsh-mcp-manager` 是一个 MCP（Model Context Protocol）服务器管理器：

- 从 `$DSH_HOME/mcp-servers.json`（`DSH_HOME` 缺省 `~/.dsh`）读服务器清单；
- 支持 **stdio / SSE / streamable-HTTP** 三类传输；
- 把对端工具注册进宿主的 `tools` 服务（`ctx.tools.insert()`）；
- 在 `/mcp-manager/*` 上开管理路由，含 OAuth 授权码流程
  （`/.well-known/oauth-authorization-server`、`/authorize`、`/token`、`/register`）。

本工作台目前的工具全部是**自建**的。缺的正是「用户自己接一个 MCP 服务器」这条通道。

---

## 锁版

```json
"dependencies": { "dsh-mcp-manager": "0.6.0" }
```

| 项 | 值 | 核实方式 |
| --- | --- | --- |
| npm 可锁版本 | **0.6.0**（也是 npm 最高版本） | `npm view dsh-mcp-manager version` → `0.6.0` |
| 仓库 HEAD 版本 | `0.14.0` | 克隆 `hyqhyq3/dsh-mcp-manager` 后读 `package.json` |
| 是否自包含 | **是**（666 KB esbuild bundle，只 import `node:*`） | 解包 tarball 后 `grep 'from"'` |
| 传递依赖 | **0 个** | 同上 |
| 许可证 | MIT（npm `license` 与 `LICENSE` 正文一致） | 两处比对 |
| Node | `^22.19.0 || >=24.0.0` | `engines.node` |

> **⚠ 关键陷阱：仓库 HEAD ≠ npm 包。** HEAD 的 `0.14.0` 有 4,212 行、含 workspace 隔离与
> 按需 tool broker；npm 的 `0.6.0` 只有 214 行的入口（其余在 bundle 里），**不含**这两项。
> 评审要判断的是「0.6.0 够不够用」，而不是「GitHub 上的 HEAD 好不好用」。

---

## 评审必须先回答的三个问题（都不是代码问题）

1. **它会接管 `tools` 服务。** 0.6.0 的 `inject = ["tools", "webServer"]`。
   本仓无任何包注册 `tools`。若宿主的 `tools` 是单例且已被官方插件占用，
   本包会**静默不生效**（不报错、不告警）→ 接入前必须真机验。
2. **stdio 传输 = 任意命令执行。** 上游自带一道闸：webServer 监听 `0.0.0.0` 且未配 `token`
   时拒绝全部 `/mcp-manager/*` 请求。但**配置文件本身没有守卫** —— 能写
   `mcp-servers.json` 的人等于能在这台机器上执行命令。
3. **和既有「来源包」的边界。** `dsh-zhiyun-source-*` 是带登录态、带限流的站点专用实现；
   MCP 是通用通道。第一版建议**只允许用户手填清单，不内置任何 MCP 服务器**。

## 外围兼容层要做的三件事（评审通过后）

- `mcp-servers.json` 不存在时**不替用户创建**（0.6.0 读不到就走空清单）；
- `/mcp-manager/*` 全 401 时，把「缺 access token」暴露成**可见告警**，
  而不是让用户看到 404（0.6.0 只在 logger 里 `warn`）；
- 上游抛错**不吞**，直接向上抛 —— 避免插件行看着「已加载」但功能全无。

## 不做的事

- **不改上游源码**，不 fork，不 patch `node_modules`；
- **不接 profile**；
- **不写测试**（radar 包约定）；
- 不搬运上游源码进本仓库。

上游：`dsh-mcp-manager@0.6.0` · MIT · <https://github.com/hyqhyq3/dsh-mcp-manager>
