# dsh-radar-agent-router

> ## ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**
>
> 本包由「生态雷达」自动生成，只是一份**待人工审查的骨架**。
> 它**没有**被写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，
> 因此**不会**在运行时挂载。`src/index.js` 只打一行日志、不注册任何路由 / 设置分节，
> `src/upstream.js` 的 `loadUpstream()` 直接返回失败 —— 这是故意的。

## 集成类型：**强化式集成**

| 判据 | 判定 | 说明 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 落点是宿主既有的**模型选择器**（`llm-pi-ai` 的 provider 列表），不新增页面、不新增侧栏项 |
| ② 功能仍相似正交 | ✅ | 「从哪个 provider 取模型」与「怎么失败降级」（`dsh-radar-llm-fallback`）、「怎么重试」都正交；它只多一个分组 |
| ③ 底层多调了更优质实现 | ✅ | 不自己写 OpenAI-compatible 适配器，锁版调用上游那套已验证的 Responses API 适配 + 出站围栏 |

> 结论：**重复且可强化**。不是全新功能（本仓已能连模型），也不是无增益重复
> （多一个 provider 来源 = 多一条随时可切换的失败逃逸路径）。

## 事实

| 项 | 值 |
| --- | --- |
| 类型 | **A 类 · 原生 DSH 插件包**（`dsh.bundle.patch` + `dsh.client.inject`，`platform: web`） |
| 上游 | [`aqiu817/dsh-llm-agentrouter`](https://github.com/aqiu817/dsh-llm-agentrouter) ★35 |
| 锁定版本 | `dsh-llm-agentrouter@2.6.1`（精确版本，非 `^`） |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id = MIT`，npm `license: MIT`） |
| 体积 | npm `unpackedSize` 100,432 B（≈ 0.10 MB）；**零运行时依赖** |
| 最近发布 | 2026-10-22（`2.6.1`） |
| 与现有功能的关系 | **重复且可强化** |

## 上游到底做了什么（评审要点）

1. **`override: llm-pi-ai`**，声明一条 `agentrouter` 路由，`baseURL` 指向
   哨兵主机（`.internal` 保留域，**故意不可解析**）；
2. 出站围栏（`lib/index.js`）在请求路径上把哨兵主机改写成「国内 / 国际」所选端点，
   顺带换 `user-agent`、按端点绕过进程代理、给缺失 `required` 的工具 schema 补 `[]`；
3. 设置 → 插件里的 AgentRouter 卡片（`lib/client.js`）负责端点分段控件与静默重试开关；
4. `lib/route.js` 做**路由自愈**：profile 自己的补丁层会整段覆盖
   `llm-pi-ai.providers`，围栏据此把这条路由重新声明回去。

## 风险（评审必须逐条回答）

- **R-1 · peer 全是 `*`**：上游只声明 `@deepseek-ai/cordis: *` 与
  `@deepseek-ai/schemastery: *`，**等于没有版本窗口**。宿主升级后是否仍兼容，
  只能靠 `scripts/radar-host-window.mjs` 在装载期拦，不能信上游。
- **R-2 · 三个 `dsh.client.inject` 包**：`dsh-client-locale` / `dsh-client-ui-settings` /
  `dsh-client-ui-plugin-manager` 必须由宿主提供；本仓依赖 `@deepseek-ai/dsh-base` +
  `dsh-web-app`，**未逐个核实**这三个是否都在。缺任何一个 = 设置卡片空白。
- **R-3 · 出站改写 = 全局请求路径上的代码**：它会把 `.internal` 哨兵主机改写掉。
  若本仓将来有别的插件也用 `.internal` 域名（例如内网代理 `dsh-zhiyun-source-netproxy`
  相关路径），必须确认互不误伤。
- **R-4 · 凭证**：需要中转站 key，走 `~/.dsh/.credentials.yaml` 或
  `AGENTROUTER_API_KEY`。**本骨架不写任何 key**，评审也不得把 key 提交进仓库。
- **R-5 · 上游模型清单随中转站变动**：2026-10-22 版已因 503 删掉
  `claude-opus-5-5` 与 `deepseek-v4-flash`。锁版 = 模型清单冻结，评审需确认
  这不会挡住学生日常使用。

## 若要评审通过，本骨架要补的最小集

1. `src/index.js` 的 `apply()` 换成真实 `import` 上游 + `apply(ctx)`；
2. 装载期插 `radar-host-window.mjs` 的窗口判定（peer `*` → 以本仓宿主版本为窗口）；
3. R-2 的三个 client 包逐个在本仓 profile 里 `grep` 到；
4. 用 `scripts/radar-inject-audit.mjs` 跑一遍，确认上游 patch 的 `override` 有 peer 背书；
5. **不写测试**（本仓规定 radar 包无测试）。

## 明确不做

- 不把上游源码复制进本包；
- 不在本包内再声明 provider 路由（重复声明 = 选择器里两个 AgentRouter 分组）；
- 不接入 profile（这条由人工评审后另行决定）。
