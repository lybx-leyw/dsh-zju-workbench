# dsh-radar-llm-fallback

> ## ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**
>
> 本包由「生态雷达」自动生成，只是一份**待人工审查的骨架**。
> 它**没有**被写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，
> 因此**不会**在运行时挂载。`src/index.js` 只打一行日志、不注册任何槽位/RPC，
> `src/upstream.js` 的 `loadUpstream()` 直接返回失败 —— 这是故意的。

## 集成类型：**强化式集成**（同一个面板 · 相似正交 · 底层换更优实现）

| 项 | 值 |
| --- | --- |
| 类型 | **A 类 · 原生 DSH 插件包**（自带 `dsh.bundle.patch` + `dsh.client.inject` / 6 个前端包） |
| 上游 | [`omdsh-dev/dsh-llm-fallbacks`](https://github.com/omdsh-dev/dsh-llm-fallbacks) ★21 |
| 锁定版本 | `dsh-llm-fallbacks@0.6.7`（精确版本，非 `^`） |
| 许可证 | **MIT** ✅（GitHub metadata；npm 包内 `LICENSE` 文件存在，但 `package.json` **没有 `license` 字段**，见 §风险 R-4） |
| 作者 | omdsh-dev |
| 体积 | npm `unpackedSize` 905,327 B（≈ 0.90 MB），其中 `dist` 696 KB；**运行时依赖只有 `use-sync-external-store`** |
| 与现有功能的关系 | **重复且可强化**（不是全新功能） |
| 强化的是谁 | **整个工作台的模型请求管线**（`@deepseek-ai/dsh-llm` 的失败路径），不是某一个页面 |
| 集成方式 | **锁版挂载 + 外围兼容层**（本包用自己的 id 插入，运行时 `import()` 上游并调它的 `apply`；**不改上游源码**） |

## 为什么是「强化」而不是「重复」/「全新」

| 判据 | 成立？ | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | **不存在新面板**。不新增页面、不新增导航项、不新增设置分区（见 TODO 3 的二选一）。用户看到的就是原来那些页面 |
| ② 功能仍相似正交 | ✅ | 仍是「发一次模型请求」；上游新增的只是**失败之后怎么办**（降级链 / 冷却 / 分时路由），不是另一件事 |
| ③ 底层多调了更优质实现 | 🟡 **待实测** | 本仓现有请求路径**没有跨 provider 的失败转移**：provider 由用户在设置里选定，失败即失败；`dsh-llm-retry` 只重试**同一个**模型/渠道。上游提供按角色/按触发码的降级链 + 冷却 + 半开恢复。**「更优质」须用同一份失败码样本实测确认（§风险 R-3）**，未实测前不得当作既成事实 |

## 上游做什么（三件事，按对本仓的相关度排序）

1. **自动降级**：当请求持续失败（重试耗尽 / `AUTH` / `QUOTA` / `RATE_LIMIT`，可扩到
   `CONTEXT_WINDOW_EXCEEDED`）时，沿 fallback 链切到下一个 provider/model，**当前 step 继续**。
   被切走的模型在 `cooldownMs` 内不再被选中，冷却到期回到主模型（可选 `half-open` 证据驱动回归）。
2. **峰谷分时路由**：按墙钟窗口切换生效链（四个冻结的 UTC+8 预设 + 自定义 `HH:mm` 行）。
   **本包默认关闭**（见 §风险 R-5）。
3. **角色化 subagent**：`**Execute as**: <id>` 头部 → persona / `[role: <id>]` 通知行 / 徽章 /
   可选改写子代理模型。**与本仓无关，本包接入时必须显式关掉**（TODO 4）。

## 风险（评审必须逐条回答）

| # | 风险 | 事实 | 处置 |
| --- | --- | --- | --- |
| **R-1** | **宿主版本窗口可能不相交**（本骨架最大风险） | 上游 26 项 peer 全为 `^0.2.1-rc.2`；本仓 `runtime.lock.json` 为 `0.2.0-rc.2` / `0.2.1-alpha.1`。按 semver，`^0.2.1-rc.2` 只接受 `0.2.1-rc.2` 及以上；`0.2.1-alpha.1` 的 prerelease 段 **`alpha` < `rc`** $\Rightarrow$ **不满足**；`0.2.0-rc.2` 主版本号更低 $\Rightarrow$ **不满足**。两条 `hostVersions` **都不在窗口内** | 评审须先裁定：是**升宿主**到 `0.2.1-rc.2`（`npm view` 已确认该版本 2026-10-17 发布），还是**放弃本候选**。**不得**用 `--force` 装上去 |
| **R-2** | 监听顺序 | 上游 patch 自述「profile 必须把 llm-retry 放在本插件之前，否则瞬时 5xx 会被直接换模型」。本仓 profile 无显式 retry 行（来自 `dsh-base`） | 在**实际安装的宿主**上确认 `agent/request-error` 的注册顺序；不可保证则**不接** |
| **R-3** | 判据③「更优质」未实测 | 本骨架**没有**跑过任何失败码样本 | 评审通过后，用 `AUTH` / `QUOTA` / `CONTEXT_WINDOW_EXCEEDED` 三类各一条构造样本，对比「现状：直接报错」vs「上游：链式降级」 |
| **R-4** | 许可证字段 | npm `package.json` 无 `license` 字段（`npm view` 不回显），但 tarball 内**有 `LICENSE` 文件**，GitHub metadata 为 MIT | 判 **MIT ✅**；按「许可证链只认文件实体」原则，以 tarball 内 `LICENSE` 为准。评审时请打开该文件核对正文 |
| **R-5** | 分时会改账单 | 四个 UTC+8 预设（`liang-peak` 等）会在特定时段把请求切到另一家 provider | 默认 `timeSlots = []`；是否开、何时开，**产品决策**，未定前不实现 |
| **R-6** | 同名同作者小仓 | 同作者另一仓 `YFY-AI/dsh-llm-fallback`（★1，2026-08-21 停更，`publishConfig.registry = npm.pkg.github.com` → **公网 npm 不可装**）与本包**名字几乎相同** | 本包锁的是 `omdsh-dev/dsh-llm-fallbacks`（★21，2026-10-18 push）。**评审时切勿混用** |

## 与既有骨架的关系

| 骨架 | 锁版 | 关系 |
| --- | --- | --- |
| `packages/dsh-radar-llm-fallback`（本包） | `dsh-llm-fallbacks@0.6.7` | 模型**请求失败**后的降级（管线层） |
| `packages/dsh-radar-evolve-modes` | `@graysilver/dsh-evolve-modes@0.4.1` | Agent **产出**的质量审查门禁 |
| `packages/dsh-radar-fsrs-scheduler` | `ts-fsrs@5.4.2` | 复习**调度** |
| `packages/dsh-radar-answer-equiv` | `decimal.js@10.6.0` | 答案**判等** |

四者正交（请求 / 审查 / 调度 / 判等）。但本包与 `dsh-radar-evolve-modes` **都改全局 Agent 行为**，
若两者都接，建议**先接本包**（它只动失败路径，成功路径逐字不变），再评估后者。

## 来源与许可

- 上游 MIT：<https://github.com/omdsh-dev/dsh-llm-fallbacks>（tarball 内 `LICENSE` 文件）
- 本包**未复制**上游任何源码，`dependencies` 里以精确版本引用；
  运行时不改上游文件，只在宿主侧 `import()` 其公开入口（`.` 与 `./client` 两个 exports 路径）。
- 无第三方代码借鉴，故不含 `ATTRIBUTION.md`。
