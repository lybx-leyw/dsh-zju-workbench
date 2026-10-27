# 候选骨架的「锁版」到底能不能装

> 2026-10-27（r80）实测结论。由 `scripts/radar-baseline-check.mjs` 可复现。
> 本文只回答一个问题：**`packages/dsh-radar-*` 里那 61 条锁版依赖，是不是真的装得上？**

## 结论先行

| 层 | 检查内容 | 结果 |
| --- | --- | --- |
| ① 结构 | 版本是否精确（禁 `^ ~ >=`）、README 是否声明「未评审/未接入」 | ✅ 67/67 通过 |
| ② 存在 | `(name, version)` 在 npm 上是否真实存在 | ❌ **1 条不存在** → `dsh-radar-credit-audit-vendor@1.7.0` |
| ③ 新鲜 | 锁版是否落后 `dist-tags.latest` | ℹ 17 条落后（不失败，只报告） |
| ④ 共存（静态） | 两个上游包对**同一宿主包**的 peer 区间是否相交 | ⚠ 只报 **3 对** |
| ⑤ 共存（实测） | 两个上游包能否被 npm **装进同一棵树** | ⚠ 报 **43 对** |

**⑤ 比 ④ 多报 40 对**，这不是 ④ 写错了，而是它**原理上看不见**：多个包的约束落在**不同的宿主子包**上
（`lookatstudy` 约束 `dsh-tools`，`better-markdown` 约束 `dsh-client-locale`），两两各自都「有共同版本」，
但拼成一棵树时 npm 必须在**同一层**同时满足 `client-locale ^0.1.0-rc.8` 与 `client-ui-layout ^0.1.0-rc.6` —— 无解。

所以：**peer 区间相交 ≠ 可共装。** 判「能不能一起接进 profile」只能用 ⑤。

## 61 条锁版的体检表

- 包名去重 **59 个**，全部存在于 npm；版本 **60/61** 存在。
- 唯一缺口：`dsh-radar-credit-audit-vendor@1.7.0`（r64 设计），上游 `Kepler16f/zju-kezhou` **没有 npm 包**，
  README 第 93–94 行写的「把 engine/ 发到内部 scope」这一步**从未发生**。
  这就是 L-15（`npm ci` 长期失败）**第一次被定位到具体条目**的原因 —— 在此之前它只被记成「某个包 404」。

## 43 对不相容：按骨架聚成几团

对 11 个「带 `@deepseek-ai/*` peer」的上游包两两实测，冲突按宿主代际聚团：

| 团 | 骨架 | 宿主代际 | 团内共装 |
| --- | --- | --- | --- |
| **G0.1** | `evolve-modes` `context-dashboard` | `^0.1.1-rc.2 \|\| ^0.1.2-rc.1` | 互相兼容，但**与几乎所有人**冲突 |
| **G0.2** | `tool-plus` `llm-fallback` | `>=0.2.1-0 <0.3.0-0` / `^0.2.1-rc.2` | ✅ 二者可共装 |
| **旧客户端** | `better-markdown` `lookatstudy` `lowtide` | `client-* >=0.1.0-rc.5`（但传递依赖锁 `rc.8`） | 部分可共装，与 G0.2 冲突 |
| **宽区间** | `kb-rag` `me-memory` `agent-teams` `market` `knowledge-graph` | `>=0.2.0-rc.2 <0.3.0` 等 | 与多数 G0.1 / 旧客户端冲突 |

**当前唯一被实测确认「三者同装」的组合**：`better-markdown + lookatstudy + lowtide`。
**反例**（用于防止「两两可装 ⇒ 可同装」的错误推断）：`kb-rag`、`agent-teams`、`me-memory` 三者
两两中有一对不相容，所以三者不能同装 —— 即使另两对都 ✅。

## 怎么用

```bash
# 只看结构与声明（CI 可跑，无需联网）
node scripts/radar-baseline-check.mjs --offline

# 存在层（查 npm）
node scripts/radar-baseline-check.mjs

# 共存层（区间相交，快）
node scripts/radar-baseline-check.mjs --coexist

# 共存层（npm 实测，慢：43 对 × 每次 dry-run）
node scripts/radar-baseline-check.mjs --holdout
```

退出码：有 `error` → 1。**`warn` 不阻失败** —— 共存冲突是「不能同装」，不是「不能逐个评审」。

## 对雷达流程的影响（写进下一轮起点）

1. **新增骨架前先跑 `--offline`**：结构性错误（没锁版、漏声明）零成本拦住。
2. **判 🟢 之前先跑 `--holdout`**：若候选上游与已选定的宿主代际冲突，它只能是 🟡 ——
   不是「能力不够」，而是「装不进去」。这比 r79 的「自带 patch ⇒ 只能 🟡」更硬。
3. **`--holdout` 的 43 对不是债务清单**，而是「profile 现在最多只能容纳哪一团」的证据。
   在 L-15 修掉之前，任何「接入 N 个骨架」的计划都缺这一步。

## 边界（没做到的地方）

- **没有真的 `npm install` 全部 61 条**：`credit-audit-vendor` 404 会让整棵树失败（这正是 L-15），
  所以存在层用「逐条查 registry」代替整装。
- **`--holdout` 用 `--dry-run`**：只验解析，不验构建与运行时 —— 装得上 ≠ 跑得起来。
- 71 个 `dsh-zhiyun-*` / 宿主自有包不在本检查范围（它们不是候选骨架）。

---

## 第二轮体检（r81 · 2026-10-27）· 声明层

r80 验的是**存在层**（依赖在 npm 上有吗）与**共存层**（能不能装进同一棵树）。
本层补的是中间那段空白：**包说自己要 inject 什么，有没有如实声明。**

| 层 | 问的问题 | 检查器 | 本轮结论 |
| --- | --- | --- | --- |
| 结构 | 有没有锁版、漏声明 | `radar-baseline-check.mjs --offline` | 67 个骨架 JSON 全合法 |
| 存在 | 依赖在 npm 上存在吗 | `radar-baseline-check.mjs` | 59/60 存在，1 条 E404（**仍未修**） |
| **声明** | **inject 的宿主服务有 peer 背书吗** | **`radar-inject-audit.mjs`** | **14/21 无背书，16 个服务无人声明** |
| 共存 | 能不能装进同一棵树 | `--holdout` | 43 对不相容 |

### 为什么声明层比存在层更重要

存在层只回答「装得上」。但 `dsh.client.inject: ['@deepseek-ai/dsh-client-ui-slots']`
这种写法，npm **不会**因为它没进 `peerDependencies` 而报错 —— 装得很顺利，
直到运行时 `ctx` 里没有 `slots` 这个服务（r79 的 F-1 就是这么来的）。

### 本轮得到的清单

- **14 个包** inject 了未声明的宿主服务；最极端的 `@magma27/dsh-calendar@0.1.7` 是 **7 条 inject / 1 条 peer**，
  而那唯一一条 peer（`@deepseek-ai/schemastery`）与 inject 完全不相交 —— 等于**一条都没声明**。
- **16 个宿主服务**被引用却无人声明：`dsh-client-ui-settings`(7)、`dsh-client-locale`(7)、
  `dsh-client-ui-conversation`(7)、`dsh-client-connection`(4)、`dsh-client-runtime`(4)、
  `dsh-client-ui-slots`(3)、`dsh-client-ui-renderer`(3)、`dsh-client-ui-sidebar-right`(3)，
  以及 `dsh-client-ui-workspace`(2)、`dsh-client-ui-primitives`(2)、
  `dsh-api-remotes`、`dsh-api-session-controller`、`dsh-client-ui-session`、
  `dsh-client-ui-layout`、`dsh-client-ui-sidebar`、`dsh-client-ui-theme`（各 1）。

### 用法

```bash
node scripts/radar-inject-audit.mjs              # 骨架锁版引入的全部上游包
node scripts/radar-inject-audit.mjs --json      # 机器可读，便于聚合
node scripts/radar-inject-audit.mjs dsh-context-lens   # 只查一个
node scripts/radar-inject-audit.mjs --all       # 连普通 npm 库一起列（含 N/A）
```

退出码：有 `INJECT_UNDECLARED` 时为 1。**但现在 14 个必然红，不建议直接当 PR 门禁** ——
先只产出报告，等数字压下去再转硬门禁。

### 建议的处置（不是去催上游）

在骨架里补一份 `host-requirements.json`，把「我 inject 了哪些宿主服务、需要什么代际」
从上游的 inject 列表里**抽取并写死**，再让 `radar-baseline-check.mjs` 在锁版时对照。
这比改上游现实，也比「靠人读 README 记」可靠。

### 边界（没做到的地方）

- **一个包都没真正挂进宿主跑过**：本层只判声明，不判「声明全了是否真能跑」。
- **`--all` 里的 38 个普通 npm 库判为 N/A**：它们没有 `dsh` 字段，天然不适用，不代表「已验过」。
