# dsh-radar-usage-ledger

> ## ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**
>
> 本包由「生态雷达」自动生成，只是一份**待人工审查的骨架**。
> 它**没有**被写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，
> 因此**不会**在运行时挂载。`src/index.js` 只打一行日志、不注册任何分区/RPC，
> `src/upstream.js` 的 `loadUpstream()` 恒返回失败 —— 这是故意的。
>
> 生成于 2026-11-04 12:00（A 组 · DSH 插件生态）。
> 报告：`docs/ecosystem-radar/2026-11-04-12.md`。

## 集成类型：**强化式集成**（同一个面板 · 相似正交 · 底层换更优实现）

| 项 | 值 |
| --- | --- |
| 类型 | **A 类 · 原生 DSH 插件包**（自带 `dsh.bundle.patch` + `dsh.client.platform=web`） |
| 上游 | [`Ychris12138/dsh-usage-stats`](https://github.com/Ychris12138/dsh-usage-stats) ★188 |
| 锁定版本 | `@ychris12138/dsh-usage-stats@0.3.7`（精确版本，非 `^`） |
| 许可证 | **MIT** ✅ |
| 体积 / 依赖 | `dependencies` 与 `peerDependencies` **均为空**；`dsh.client.inject` 仅两个官方 client 包 |
| 与现有功能的关系 | **重复且可强化**（不是全新功能） |
| 强化的是谁 | 本仓**已经存在但各管各的**三个计量点（见下表） |
| 集成方式 | **锁版挂载 + 外围兼容层**（本包用自己的 id 插入，运行时 `import()` 上游并调它的 `apply`；**不改上游源码**） |
| 落点 | 设置页的 `settings.section` 插槽（**零改壳**） |

## 为什么是「强化」而不是「重复」/「全新」

| 判据 | 成立？ | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 不新增页面、不新增导航项。注册进**已有的设置页**（`page-paper/src/client.jsx:12-13`：「壳里的 `PersonalSettingsBridge` 会把所有 `settings.section` 注册按 order 摊成折叠分组，所以新插件零改壳」）。**前提**：评审须在 TODO 2 里裁定「用量」确实该是设置页的一个分区 |
| ② 功能仍相似正交 | ✅ | 本仓有的是**逐次**的用量归一与透传；上游提供的是**跨会话的累计与计价**。同一件事（「花了多少」）的另一个粒度 |
| ③ 底层多调了更优质实现 | ✅ | 上游从 `ctx.sessionQuery` 读会话日志的 `assistant/message.usage`，支持**历史全量扫描 + 实时增量**，并用 `Map<sessionId:seq>` 幂等去重（其源码注释直言「此前用数组 push 导致『两倍』」）。本仓 **`ctx.sessionQuery` 命中数 = 0**、无任何跨会话读取 |

### 本仓「计量在、账本不在」的逐条证据

| 事实 | 证据（文件:行） |
| --- | --- |
| 用量**已被归一**，但只是**形状转换** | `core-question-stream/src/usage-frame.js:1-29`：「core-llm 的 `usage.js` 主要是 `UsageTracker` 类：价格表、成本估算……**那是「客户端自己算账」的职责 —— 宿主已经做了这件事**」「本包只需要三个纯函数……与计价无关」 |
| 用量**逐次透传**，但**用完即弃** | `core-parser/src/llm.js:146` `const spentOutput = usage?.outputTokens ?? usage?.completion_tokens ?? 0;` —— 只用于判「截断且空输出」，不进累计 |
| 全仓**没有**跨会话落账 | `grep -rnE "累计\|aggregate\|totalSpent\|ledger.*token" packages/dsh-zhiyun-*/src` → 6 处，**全部与 token 无关** |
| 「usage」在本仓指**工具使用次数** | `page-plugins/src/usage.js:1-30`：「插件 / 技能 / 工具的**使用计数**」「**「这个工具我到底用过没有」**」 |
| 计费只以**错误码**形式存在 | `core-llm-error/src/classify.js:47` `INSUFFICIENT_BALANCE` —— 知道「没钱了」，不知道「花了多少」 |
| 无价格表 | `grep -rniE "per_million\|/1M\|1e6\|元/"` → 1 处假命中（`source-classroom/src/models.js:40` 的 `videoDurationMs/1e6` 单位换算） |
| 有**天然落点** | `page-paper/src/client.jsx:12-13` 的 `settings.section` 机制 |

## 取舍：为什么锁 `dsh-usage-stats` 而不是计价更强的 `dsh-dock`

| 候选 | 计价强度 | 锁定代价 | 结论 |
| --- | --- | --- | --- |
| `wycto/dsh-dock@0.21.0` | **最强**：多段分时价、工作日/节假日谷价、四级单价优先级、USD→CNY 汇率、改价即时重算、缓存读写独立计价 | **单仓 14 个功能模块**（`tokenlog` / `balance` / `notify` / `tts` / `games` / `animation` …）。为「记一笔账」锁进游戏、桌宠、TTS | ❌ 过度绑定 |
| `Ychris12138/dsh-usage-stats@0.3.7` | 中（余额 + 订阅配额 + 用量分析，**不分时价**） | **单一职责、零 runtime 依赖、零 peer 依赖** | ✅ 本骨架选它 |
| `tableau-China/dsh-workload-report@2.4.0` | 中（按「日期 × 工作区」+ 自包含 HTML + 多设备同步） | 中（含 COS 同步 = 新凭证面） | 🔶 形态最好但**多设备同步**需单独立项（TODO 4） |

> 若评审判定「峰谷半价必须体现在学生账单上」，则改锁 `dsh-dock@0.21.0`，
> 并接受上述绑定代价 —— **这一条必须写进评审结论**，不能默认。

## 风险

| # | 风险 | 说明 | 处置 |
| --- | --- | --- | --- |
| R-1 | **版本窗口未实测** | `src/upstream.js` 的 `UPSTREAM_HOST_RANGE` 是 `null` 占位，`assertHostCompatible()` **fail-closed 恒返回 false**。上游未声明 peer，须实读对应 tag 的 `package.json` + `CHANGELOG` 才能填 | 填完之前**不得启用** |
| R-2 | **隐私：`apiKey` 字段** | 上游的记录模型含 `apiKey(掩码)`；导出 HTML/CSV 时须确认掩码在位 | 接入前用真实导出物逐字检查；不过关则不启用导出 |
| R-3 | **口径漂移** | 本仓三套计量口径若不先收敛，账本会与页面数字互相打架 | **TODO 1 是硬前置**：收敛不了就 `rejected`，不要「先装上看看」 |
| R-4 | **静默不挂载** | 上游 `dsh.client.inject` 的两个官方 client 包缺失时，宿主侧 API 照常注册、**面板却不见** | 接入时加一条启动自检：宿主侧 ready 但面板未注册 → 打 `warn` |
| R-5 | **上游 0.x 漂移** | `0.3.7` 之后 upstream 可能带 breaking change | 锁精确版本；升级必须重走评审 |

## 下一步（评审按此顺序）

1. **TODO 1（硬前置）**：本仓三个计量点能否收敛为一个 `recordUsage()` 出口？不能 → 本骨架 `rejected`。
2. **TODO 2**：「用量」放设置页分区（本骨架倾向）/「今天」页卡片 / 上游原样三选一。
3. **TODO 3**：是否必须体现峰谷半价？必须 → 改锁 `dsh-dock`。
4. **TODO 4**：多设备同步单独立项（本包不做）。
5. **TODO 5**：填 `UPSTREAM_HOST_RANGE`，把 `assertHostCompatible()` 从 fail-closed 改成真实判定。

## 未做（按仓库规则）

- ❌ 不写测试（`packages/radar/` 下不得有 `test/`、`*.test.*`）
- ❌ 不接 profile（`dsh.profile.bundles` 不得含 `dsh-radar-*`）
- ❌ 不改 `build.mjs` / `profile.mjs`（它们只认 `dsh-zhiyun-` 前缀）
