# dsh-radar-ctx-compact —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-11-10 · r166 轮），**仅用于人工评审**。
> `src/index.js` 的 `apply()` 与 `src/upstream.js` 的 `loadUpstream()` **都直接抛错**，
> TODO 一条都没落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

**同一段对话、同一个压缩动作，换个后端：不再让模型「重写一遍摘要」，改成逐字抽取。**

## 集成类型：**强化式集成**（不是「全新」）

| 项 | 值 |
| --- | --- |
| 与现有功能的关系 | **重复且可强化** |
| 强化哪个现有功能 | 宿主的上下文压缩后端 `@deepseek-ai/dsh-compaction-basic` |
| 上游 | [`fan56/dsh-dcp`](https://github.com/fan56/dsh-dcp) · npm `@aiwayds/dsh-dcp@0.14.0` |
| 许可证 | **Apache-2.0** ✅（GitHub `spdx_id` 与 npm `license` 两处互证） |
| 类型 | **A · 原生 DSH 插件包**（`dsh.bundle.patch`，**无** `dsh.client` —— 纯宿主侧） |
| Stars | ★16，`created 2026-08-17` / `pushed 2026-11-06`，npm 已发 **21 个版本** |
| 运行时依赖 | **零**（`dependencies: {}`） |

### 三条判据

| # | 判据 | 结论 | 依据 |
| --- | --- | --- | --- |
| ① | **仍是同一个面板** | ✅ | 上游 patch **不新增面板、不新增导航项、不新增斜杠命令**。README「Not in scope」原文：*「`/compact` 命令、UI 检查点卡片（dsh 自带）」* —— 它显式不重做 UI。`dsh.manifest` 里**没有** `client` 字段，物理上就没有前端注入点 |
| ② | **功能仍相似正交** | ✅ | 同一动作（把旧对话压成检查点）、同一输出格式（上游：「检查点格式：官方，兼容可互相合并」）。正交的是**实现方式**：官方 1 次 LLM 语义归纳 vs 上游 0 次 LLM 五段逐字抽取 |
| ③ | **底层多调了更优质实现** | ✅ | 本仓 `grep -rn "compaction" packages/` → **0 命中**，连压缩策略都没有。上游是经 21 版迭代的确定性压缩器，「零 LLM + 可复现 + CJK 真实计价」不可能靠几十行自研追平 |

### 为什么值得做

宿主按 **4 字符/token** 估中文，而中文真实密度约 **2 字符/token**。
⇒ 中文会话的摘要预算被**系统性低估一半**，压出来的检查点又短又干。

上游做了两件事：① 按 CJK 真实密度计价；② 路径 / 命令 / 报错 / 用户原话**逐字保留**。
对本仓（中文用户为主、长会话多）这是**结构性收益**，不是「换个口味」。

---

## ⚠ 四条风险（评审必读，`src/upstream.js` 有完整版）

| # | 风险 | 严重度 | 处置 |
| --- | --- | --- | --- |
| **R-1** | **版本线**：本仓只支持宿主 `0.2.2-rc.1`；上游 peer 十余个 `@deepseek-ai/*`，下限 `>=0.2.0-rc.2`。**同一发行线 ≠ 同一版本** | 阻塞 | 必须在本仓那一个宿主版本上**实装验证**，不能只读 semver 范围 |
| **R-2** | **无回退**：上游 patch **无条件** `disabled: true` 掉 `compaction-basic` | 阻塞 | 本包 patch **刻意不抄那一行**，只 insert 自己 |
| **R-3** | **语义损失**：上游明说**不做语义归纳**，只保留「出现过的事实」。跨轮理解意图的场景可能退化 | 阻塞 | 真实会话 A/B（中英各一段 ≥40 轮），看 Pending Jobs 漏不漏 |
| **R-4** | npm 有 `0.0.0-stage` 占位版本 | 低 | 锁 `0.14.0` 精确版本（本骨架已如此写） |

> **R-3 是本骨架最可能被驳回的一条。** 上游 README 自己写了「Not in scope: 不做语义归纳 ——
> 需要深度语义摘要的场景，请继续用官方 `compaction-basic`」。
> 如果本仓的使用场景**恰是**「需要深度语义摘要」，那这个包就该被驳回。
> **允许且预期**的结局。

---

## 与本仓另外两个 `context-*` 骨架的关系

| 包 | 回答的问题 | 性质 |
| --- | --- | --- |
| `dsh-radar-context-dashboard` | 上下文**由什么构成**、各占多少 | 观测 |
| `dsh-radar-context-lens` | **哪个插件**占了成本、KV cache 怎么分账 | 观测 |
| **`dsh-radar-ctx-compact`（本包）** | 上下文**怎么压下去** | 动作 |

前两个回答「代价是什么」，本包回答「代价怎么降」。**不重叠、不替代。**

---

## 文件

```text
packages/radar/dsh-radar-ctx-compact/
├── package.json      # dependencies: { "@aiwayds/dsh-dcp": "0.14.0" }（精确版本，无 ^）
├── cordis.patch.yml  # 只 insert 自己；刻意不含上游的 disabled: true
├── src/index.js      # apply() 抛错 + TODO-0..7
├── src/upstream.js   # 锁版凭据 + R-1..R-4 + 上游 patch 真实行为
├── README.md         # 本文件
└── OWNERS            # Owner: shared
```

**无 `ATTRIBUTION.md`**：本包不摘取上游任何代码，只锁定版本并 import，不构成「借用实现」。

---

## 评审后的落地顺序

1. **R-1** 实装（不过 → 驳回）
2. **R-3** A/B（漏 Pending Jobs → 驳回）
3. **R-2** 决策（替换 / 并存）
4. 才轮到写 `loadUpstream()` 与 `apply()`
5. 最后接入观察面（TODO-4），**不新开页面**
