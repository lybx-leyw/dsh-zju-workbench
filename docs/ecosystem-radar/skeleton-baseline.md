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
