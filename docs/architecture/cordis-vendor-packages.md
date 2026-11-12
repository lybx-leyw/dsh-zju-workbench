# DSH 的包地图：vendor 了什么、自研了什么

DeepSeek Harness 的包分两类，**不要混淆**：

| 类别 | 数量 | 位置 | 含义 |
|---|---|---|---|
| **vendor（复制来的框架）** | **9** | `vendor/` | 从 Cordis 及其生态复制进仓的第三方代码，改了 23 处 |
| **自研（自己写的）** | **319** | `packages/` | DSH 团队自己实现的插件，分布在 54 个分组 |

本文件同时记录两者：第 1–6 节讲 vendor，第 7 节讲自研包地图。

> **本文档的两个数据源**：`.ref/vendor/`（DSH 参考源码的 vendor 副本）与 `.ref-cordis/`（Cordis 上游快照）。

## 1. 全部 9 个 vendor 包

| # | DSH 包名 | 上游名 | 上游版本 | 上游仓库 | 角色 |
|---|---|---|---|---|---|
| 1 | `@deepseek-ai/cordis` | `cordis` | 4.0.0-rc.7 | cordiverse/cordis | **框架内核**：Context / Fiber / 服务与事件 |
| 2 | `@deepseek-ai/cordis-plugin-loader` | `@cordisjs/plugin-loader` | 1.0.0-rc.5 | cordiverse/cordis | 插件装载器：条目树、激活顺序 |
| 3 | `@deepseek-ai/cordis-plugin-include` | `@cordisjs/plugin-include` | 1.0.4 | deepseek-harness/cordis | YAML/profile 组合：patch 层叠加 |
| 4 | `@deepseek-ai/cordis-plugin-hmr` | `@cordisjs/plugin-hmr` | 1.0.15 | deepseek-harness/cordis | 热更新：配置与模块变更监听 |
| 5 | `@deepseek-ai/cordis-plugin-group` | `@cordisjs/plugin-group` | 1.0.0 | deepseek-harness/cordis | 条目分组（树形载体） |
| 6 | `@deepseek-ai/cordis-plugin-timer` | `@cordisjs/plugin-timer` | 1.1.2 | deepseek-harness/cordis | 定时器服务 |
| 7 | `@deepseek-ai/cordis-plugin-logger-console` | `@cordisjs/plugin-logger-console` | 1.0.0 | deepseek-harness/cordis | 控制台日志出口 |
| 8 | `@deepseek-ai/cosmokit` | `cosmokit` | 1.8.1 | deepseek-harness/cosmokit | 基础工具库（Cordis 的依赖） |
| 9 | `@deepseek-ai/schemastery` | `schemastery` | 3.18.0 | deepseek-harness/schemastery | 配置 schema 校验 |

**注意第 8、9 项不是 Cordis 的插件**，而是 Cordis 依赖的基础库，DSH 一并 vendor 了。

## 2. 上游来源是分叉的

同一张表里出现了**两个不同的上游**：

| 来源 | 包 |
|---|---|
| `cordiverse/cordis`（原始上游） | cordis、loader |
| `deepseek-harness/cordis`（**DeepSeek 自己的 fork**） | include、group、timer、hmr、logger-console |
| 另外两个独立 fork | cosmokit、schemastery |

这意味着：**DSH 不是简单 vendor 上游，而是先 fork、在 fork 上改、再把 fork 的内容 vendor 回主仓**。

我们本地 `.ref-cordis/` 是 `cordiverse/cordis` 的上游快照（core 4.0.0-rc.12），**版本比 DSH 用的新**，但**不含** DSH 在 fork 上做的修改。

## 3. 依赖分层

```
cosmokit（零依赖）
   ↑
schemastery
   ↑
cordis ──────────┐
   ↑             │
loader ── include
   ↑         ↑
group      timer
   ↑
hmr
```

按 `package.json` 实测：

| 包 | 依赖 | peerDependencies |
|---|---|---|
| cosmokit | 无 | 无 |
| schemastery | `@standard-schema/spec`、cosmokit | 无 |
| cordis | `@standard-schema/spec`、cosmokit | include、loader |
| loader | cosmokit、schemastery | **cordis**、node-addon-require-builtin |
| include | cosmokit、js-yaml | loader、cordis |
| group | 无 | loader、cordis |
| timer | cosmokit | cordis |
| hmr | @babel/code-frame、chokidar、cosmokit、picomatch、schemastery | **timer**、cordis |
| logger-console | cosmokit、schemastery、supports-color | cordis |

`cordis` 反过来 peer 依赖 include 与 loader——这是 Cordis 的"内核不假设装载方式"设计：内核只定义组合语义，装载/组合由插件提供。

## 4. 上游有、但 DSH 没有 vendor 的

`.ref-cordis/packages/` 下有 11 个包，DSH 只取其中一部分：

| 上游包 | DSH 是否 vendor | 说明 |
|---|---|---|
| core | ✅（改名 cordis） | 框架内核 |
| loader | ✅ | 装载器 |
| include | ✅ | 组合 |
| group | ✅ | 分组 |
| timer | ✅ | 定时器 |
| hmr | ✅ | 热更新 |
| logger-console | ✅ | 日志 |
| **create** | ❌ | 脚手架工具，不参与运行时 |
| **fs-node** | ❌ | Node 文件系统插件，DSH 未用 |
| **loader-utils** | ❌ | 装载器辅助，未取 |
| **package-manager** | ❌ | 包管理插件，DSH 未用 |

DSH 的 `vendor/README.md` 另注明**有意不 vendor**：`reggol`、`@cordisjs/utils`、`@cordisjs/element`、`@cordisjs/unyaml`（仅开发期 YAML hook）。

## 5. DSH 对 vendor 源码的修改

`vendor/README.md` 有一份要求**穷尽**的修改日志，共 **23 条**（逐条核对过编号与目标文件）。按目标文件归类：

| 目标 | 条目号 | 数量 |
|---|---|---|
| `cordis/src/*`（内核） | #6 fiber 生命周期、#21 logger 出口处置 | 2 |
| `loader/src/*`（装载器） | #12 激活观察者、#18 `disabled` 插值、#19 运行时形状判定、#20 fiber 身份、#23 模块身份 | 5 |
| `include/src/index.ts`（组合） | #8 容错刷新、#11 patch 语义导出、#13 `writeTask` 类型、#14 持久化写入 | 4 |
| `hmr/src/index.ts`（热更新） | #1 移除 YAML i18n、#9 watcher 就绪与路径 | 2 |
| 跨包（内核 + 装载器 + 组合 + 热更新） | #15 惰性 config 解析、#22 volatile config、#10 Node 兼容 TS | 3 |
| 全部包的 manifest / 构建 | #2 package.json、#3 tsconfig、#5 tsdown、#16 发布 src、#17 rescope | 5 |
| 文档与导入形态 | #4 `.ts` 后缀、#7 JSDoc | 2 |

按**性质**再归一次：

| 性质 | 条目号 |
|---|---|
| **真正的行为语义改动** | #6 #8 #9 #11 #12 #14 #18 #19 #20 #21 #22 #23（12 条） |
| 移植上游未合并 PR | #15（`cordiverse/cordis#41`） |
| 构建 / 发布配置 | #2 #3 #5 #16 |
| 命名重作用域 | #17（`pnpm run rescope-vendor` 可重放） |
| 类型与导入形态 | #4 #10 #13 |
| 文档（仅注释） | #7 |
| 本地化裁剪 | #1 |

> 分类是阅读归纳，非 DSH 官方分类；条目号以 `vendor/README.md` 为准。

**最重要的三条**（直接影响我们对框架行为的理解）：

1. **#6 `cordis/src/fiber.ts` 生命周期加固**——堵了三个可重入销毁缺口：setup 期间的 disposer 登记顺序、`UNLOADING` 时拒绝新建 effect、清理期间的 owner 可见性。**上游没有这些**。
2. **#19 loader 用 API 形状而非 Node 主版本判定**——上游按 `>=24` 判断 module-job API，但 v2 接口实际是 Node 24.12 才有的，导致 24.0–24.11 全部误判。
3. **#15 惰性 config 解析**——移植自上游 **尚未合并** 的 PR，所以上游源码里根本没有。

## 6. 实践含义

1. **`.ref-cordis` 不能用来推断 DSH 的真实行为**。它是上游，DSH 改了 23 处。
2. **要查 DSH 的实际语义，看 `.ref/vendor/`**（这是我们仓内的参考副本）或 `.ref/packages/`。
3. **升级宿主时**，vendor 层的变化要按 DSH 的 sync procedure 重新核对，不是简单比版本号。
4. **我们自己的包**（`dsh-zju-*`）建立在 **DSH 层**，不直接接触 vendor。页面壳 `@lybx-leyw/dsh-pages` 是锁版本的 npm 依赖（独立仓库发布），同样只使用 DSH 层的 `shell.overlay` 与自有子槽，不替换原生 root。

## 7. DSH 自研包地图（319 个，54 个分组）

**这些全是 DSH 自己写的插件，不是 Cordis 的一部分。** 它们建立在 vendor 层之上，通过 Cordis 的服务 / 事件 / effect 机制组装。

按分组统计（括号内为包数）。包名均带 `@deepseek-ai/dsh-` 前缀，下表省略前缀。

### 7.1 运行时主干

| 分组 | 包数 | 包 |
|---|---|---|
| `core` | 8 | agent, agent-default-model, agent-loop, agent-tool-presentation, scope, session, system-prompt, tools |
| `llm` | 9 | llm, llm-deepseek, llm-deepseek-account, llm-deepseek-api-key, llm-pi-ai, llm-retry, token-meter, deepseek-llm-api-extensions, plugin-package-inventory-deepseek |
| `session` | 20 | session-format（+ v0→v4 四个迁移）、session-persistence(-jsonl)、session-projection(-cache)、session-stats、session-telemetry(-otel)、session-title（+3 个实现）、session-turn-outline、session-checkpoint-policy |
| `context` | 6 | agent-instructions, file-reference(-local), session-reference, time-context, tmux-context |
| `compaction` | 5 | compaction, compaction-basic, command-compact, compaction-image-offload, compaction-tool-result-pruner |

### 7.2 工具与执行

| 分组 | 包数 | 包 |
|---|---|---|
| `fs` | 7 | fs, fs-local, fs-observation-policy, fs-sandbox, tool-fs, tool-fs-search, tool-str-replace-editor |
| `shell` | 10 | shell, shell-env, bash-local/sandbox, pwsh-local/sandbox, tool-bash(-persistent), tool-pwsh(-persistent) |
| `sandbox` | 4 | sandbox, sandbox-local, sandbox-policy, sandbox-windows-acl |
| `subprocess` | 3 | subprocess, subprocess-local, win32-process |
| `terminal` | 3 | terminal, terminal-bash, tool-terminal |
| `ssh` | 4 | ssh, fs-ssh, sandbox-ssh, subprocess-ssh |
| `lsp` | 3 | lsp, lsp-stdio, tool-lsp |
| `jobs` | 3 | jobs, jobs-local, tool-jobs |
| `spill` | 3 | spill, spill-local, spill-policy |
| `ptc-runtime` | 2 | ptc-runtime, ptc-runtime-node |

### 7.3 外部世界接入

| 分组 | 包数 | 包 |
|---|---|---|
| `web` | 6 | web, tool-web, web-fetch-http, web-search-deepseek, web-search-exa, web-search-perplexity |
| `mcp` | 2 | mcp-client, mcp-resources |
| `browser-use` | 1 | browser-use |
| `computer-use` | 1 | computer-use |
| `hooks` | 3 | hook-protocol, hooks-claude-code, hooks-codex |
| `webhook` | 2 | webhook, webhook-github |
| `acp` | 1 | acp |
| `document` | 1 | office-to-pdf |

### 7.4 委派与编排

| 分组 | 包数 | 包 |
|---|---|---|
| `subagent` | 10 | subagent, subagent-acp, subagent-claude-code, subagent-codex, subagent-dsh-sdk, subagent-fork-in-process, subagent-in-process-driver, subagent-spawn-in-process, tool-subagent, tool-subagent-control |
| `workflow` | 4 | workflow, workflow-ptc, tool-workflow, tool-ralph |
| `goal` | 4 | goal, goal-round-driver, command-goal, tool-goal |
| `plan` | 1 | plan-mode |
| `preset` | 3 | agent-preset, agent-preset-registry, persona |
| `schedule` | 2 | schedule, tool-schedule |
| `todo` | 1 | tool-todo |
| `guard` | 2 | repeat-tool-reminder, timeout-policy |

### 7.5 人机交互

| 分组 | 包数 | 包 |
|---|---|---|
| `interaction` | 5 | commands, permission-presets, tool-ask-user, user-approval, user-questions |
| `feedback` | 2 | command-feedback, message-feedback |
| `skill` | 6 | skill, skill-badge, skill-filesystem, skill-office, tool-skill, tool-workspace-dependencies |
| `deliverables` | 2 | tool-present, workspace-changes |

### 7.6 界面（客户端）

| 分组 | 包数 | 说明 |
|---|---|---|
| `client` | **63** | 53 个 `ui-*` + 10 个基础设施（connection/store/modules/hmr/locale/shortcuts/…）。详见下文 7.8 |

### 7.7 宿主与启动

| 分组 | 包数 | 包 |
|---|---|---|
| `boot` | 5 | app-boot, cmdline, config-editor, hmr, plugin-manager |
| `bundle` | 6 | base, web-app, headless, sdk-app, sdk-minimal, acp-app |
| `host` | 9 | webserver, frontend-static, directory-picker(-auto/-browse/-native), open-in-app, plugin-inventory, product-telemetry-otel |
| `api` | 9 | gateway, remotes, account/job/session/settings/terminal/workspace-controller, workspace-files |
| `sdk` | 3 | protocol, server, client |
| `typert` | 4 | generator, loader, protocol, registry |

### 7.8 client 分组详解（63 个）

这是与页面壳最相关的一组。63 = **53 个 `ui-*` + 10 个基础设施包**（connection、store、modules、hmr、locale、shortcuts、product-analytics、resources、file-upload、web）。

但「前缀是 `ui-`」不等于「渲染 UI」。按实际内容分：

- **真正渲染 UI 的：51 个**（有 `.tsx` 组件，或注册了槽位）
- **不渲染 UI 的：12 个**

这 12 个里有 3 个**名字带 `ui-` 却没界面**：

| 包 | 为何不算 UI |
|---|---|
| `ui-slots` | 纯类型与注册表引擎，零 `.tsx`。真正渲染在 `ui-renderer` |
| `ui-settings` | 只定义设置槽位的类型契约，无组件 |
| `ui-reference` | 只有类型声明 |

反过来，`locale` 名字不带 `ui-` 但**有组件、也注册槽位**，所以计入 51。

注册槽位最多的三个：`ui-tool`（49 次）、`ui-chat`（23）、`ui-sidebar-documentpreview`（12）。

另有 3 个**只提供组件、不注册槽位**的纯库：`ui-primitives`（55 个组件）、`ui-dockkit`（7）、`ui-session`（1）。

### 7.9 支撑与实验

| 分组 | 包数 | 说明 |
|---|---|---|
| `util` | 17 | atomic-write, brand, chunked-list, code-language, crypto, **deque**, home-paths, http-proxy, launch-environment, lazy-require, native-command, output-retention, package-manifest, time, timeout, values, workspace-path |
| `experimental` | 24 | agent-team、voice-input、browser/computer-use 各种 driver、inspector、webworker、ptc-python 等 |
| `extensions` | 4 | cordis-host-runner, cordis-client-runner, tool-cordis, ui-cordis |
| `test-support` | 7 | agent-loop-testkit, client-runtime, llm-mock-server, llm-replay, loader-smoke, remote-mock, session-snapshot |
| `storage` | 4 | storage, storage-domain, storage-json, storage-sqlite |
| `session-query` | 4 | session-query, session-query-sqlite, session-log-export, tool-session-query |
| `credentials` | 5 | credentials, credentials-local, authorization, deepseek-account(-platform) |
| `attachment` | 2 | attachment, attachment-local |
| `identity` | 1 | anonymous-user-id |
| `settings` | 1 | settings |
| `telemetry` | 1 | otel |
| `workspace` | 1 | workspace |

### 7.10 三层对照

```
vendor/（9 个）           ← Cordis 框架：effect/coeffect 原语、装载、组合
       ↓ 提供 ctx.effect / ctx.on / ctx.plugin
packages/（319 个）        ← DSH 自研插件：agent、工具、会话、UI、宿主
       ↓ 通过 ctx.slots / ctx.layout / ctx.uiWorkspace 等
我们仓（dsh-zju-*）  ← 产品层插件（页面壳 @lybx-leyw/dsh-pages 为锁版本 npm 依赖）
```

**关键区分**：Cordis 只提供"组件如何组合、如何撤销"，**不含任何 agent 逻辑、工具、UI 组件**。那 319 个包全是 DSH 的发明。

## 8. 数据出处

| 事实 | 出处 |
|---|---|
| 9 个 vendor 包、上游名、版本、提交号 | `.ref/vendor/README.md` manifest 表 |
| 23 条本地修改 | `.ref/vendor/README.md` "Local modifications" |
| 依赖与 peer 关系 | 各包 `.ref/vendor/<pkg>/package.json` |
| 上游包集合（11 个） | `.ref-cordis/packages/` |
| 上游版本 4.0.0-rc.12 | `.ref-cordis/packages/core/package.json` |
| **319 个自研包、54 个分组** | 逐目录统计 `.ref/packages/*/*/package.json` |
| client 组 63 包中 51 个渲染 UI | 扫 `src/**/*.tsx` 与 `slots.register(` 调用 |
