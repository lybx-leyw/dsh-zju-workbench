# 第三方来源

本包**移植**了第三方项目的实现，按 [CONTRIBUTING 3.3](../../docs/contributing/CONTRIBUTING.md#33-参考其他项目前先确认协议) 在此说明来源、许可与改动。

## 上游

- **项目**：[Vita0818/ZJU-Omni](https://github.com/Vita0818/ZJU-Omni) · 浙大校园平台的统一 MCP 服务
- **许可**：**MIT**（Copyright (c) 2026 Vita0818）；原始许可文本保留在本目录的 [`LICENSE.upstream`](LICENSE.upstream)
- **移植依据的提交**：`192d1015a53a7b09f23ae143d56686c8fbf706af`（2026-10-13）
- **移植范围**：**数据层**，即上游的 `src/core/`、`src/auth/`、`src/platforms/<平台>/{client,reads,parse,actions,ubb,shared,sync,workflows}.ts` 与 `src/lite/deadlines.ts`，以及 `skills/` 两个技能文件。
- **未移植**：上游的工具层（`src/app.ts`、`src/server.ts`、`src/cli.ts` 的 MCP 部分、`src/core/tools.ts`、各平台 `tools.ts`、`src/lite/index.ts`）、`tests/`、`scripts/`、`packaging/`。

## 做了哪些改动（日后同步上游时按此比对）

改动集中在「让它能在 Windows 上跑、并且成为本仓的数据包」两件事上，**业务逻辑（各平台接口适配）未改动**。

| 文件 | 改动 |
| --- | --- |
| `src/core/keychain.ts` | **最大的一处**。上游凭据后端是 macOS 钥匙串专属，非 darwin 直接抛错。本包改为按平台选后端：`win32` 用 **DPAPI**（`ProtectedData`/`CurrentUser`），`darwin` 沿用上游钥匙串，其他平台退回环境变量。新增 `Accounts.save()` / `hasNativeBackend` / `dpapi()` / `readPasswordHidden()` / `backendLabel()`；删除上游的 `storePasswordInteractively()`。 |
| `src/core/config.ts` | `toolProfile()` 非法值不再抛错（工具档位已与数据层无关）；新增 `defaultDataDir()`，Windows 落 `%LOCALAPPDATA%\zju-omni` 而非 XDG 路径。 |
| `src/auth/tools.ts` → `src/auth/actions.ts` | **改名**并删除文件末尾的 `authTools()`（工具适配器）。保留 `authStatus` / `authLogin` / `authForget` 三个数据函数，并让提示语按平台说出实际凭据后端。 |
| `src/platforms/index.ts` | 删除各平台 `tools.ts` 的装配与 `Runtime.tools` 字段；只保留「客户端 + 读取器」的装配。 |
| `src/core/store.ts` 等 | 未改动。 |
| `src/host.js` | **本仓新增**（上游没有）：DSH 宿主半边，注册 `omni` 服务与 `/api/zhiyun-omni` 数据路由。 |
| `cordis.patch.yml`、`package.json`、`OWNERS`、`README.md` | **本仓新增**。 |
| `src/cli.ts` | 删除 MCP 依赖（`catalog` 走 MCP 列出工具）与 `tools` 命令的 MCP 实现，改为列出平台与可用数据函数；`configure` 改为跨平台。 |

## 为什么是移植而不是依赖挂载

上游**没有发布 npm 包**，无法像 `dsh-zhiyun-paper` 挂 `@ggboy123/dsh-paper-reader` 那样锁版引入。
而且凭据层在 Windows 上必须改造（见上），改动本身也要求能编辑源码。因此选择移植，
并把上游提交号记在这里以便日后重新同步。

## 上游自身的第三方来源

上游 README 的「致谢与许可」一节记录了它自己参考/移植的项目（均为 MIT）：
zju-chaoxing（学习通）、cc98-mcp 与 cc98-desktop（CC98）、jinzcdev/vscode-pintia（拼题A）、
8eoyw/zju-learning-cli（智云课堂）、EviterLesRoses2/cc98-mcp（WebVPN）。这些是上游自己的来源
声明，本包未额外引入它们的代码。
