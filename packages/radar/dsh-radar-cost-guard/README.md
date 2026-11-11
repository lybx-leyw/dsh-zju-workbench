# dsh-radar-cost-guard —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-11-11 第九时轮 / r170）。**仅用于人工评审。**
> `src/index.js` 与 `src/upstream.js` 均为空实现，`TODO` 未落实；**请勿**加入任何 profile，
> **请勿**在真实环境挂载。评审通过后才可继续实现；驳回则整目录删除。

---

## 集成性质：**强化式集成**（不是「全新」）

三条判据同时成立：

| 判据 | 本轮事实 |
| --- | --- |
| **仍是同一个面板** | 输出口只允许是**既有页面**（候选：「插件」页 `page-plugins` 的只读表列 / `page-today` 的当日用量卡）。**不新增导航条目**，不接管上游的 `sidebar.panellist` 注册。 |
| **功能仍相似正交** | 本仓已有「用量」，缺的是「钱」。接进来补的是**同一本账的计价维度**，不是另一本账。 |
| **底层多调了更优质实现** | 价格表 + 缓存命中口径（`inputMiss = uncached + cacheWrite`）由上游提供，本仓现有代码**没有**任何计价实现。 |

**判 ⛔ 的对照**：若直接把上游当独立侧边栏面板装上，就是「第二个看用量的地方」→ 重复且无增益。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [TomJerryGit/dsh-cost-guard](https://github.com/TomJerryGit/dsh-cost-guard) |
| npm | `@tomjerrygit/dsh-cost-guard@0.1.0`（**写死，不用 `^`**） |
| 许可证 | **MIT** ✅（仓内 `LICENSE` + npm `license` 双处一致，2026-11-11 核） |
| 类型 | **A 类 · 原生 DSH 插件包**（`dsh.bundle.patch` → `cordis.patch.yml`；`dsh.client.inject` 三项） |
| Stars | ★0（**2026-11-11 当天新建**，首次提交 01:20Z，共 3 次提交） |
| 包体 | npm unpacked **39,256 B**；`dependencies` **空**、`peerDependencies` 无 |
| 数据源 | 宿主 `storages/session_projcache/sessions/*.json` → `record.rows.tokenUsage.val.totals` |

> ⚠ **活跃度诚实标注**：★0 且当天首版，属「刚上架」而非「被验证」。这也是本轮**不判 🟢
> 直接集成、只出骨架**的原因之一 —— 判 🟢 指的是「可锁版试用」，不是「可以进主分支」。

---

## 为什么是本仓的空白

本仓的用量能力只有两处，且都**不做计价**：

| 位置 | 做了什么 | 缺什么 |
| --- | --- | --- |
| `packages/core/classroom-studio/src/upstream/usage-storage.js` | 从 `data/usage/*.jsonl` **只读**（写侧 `recordUsage` 未搬） | 无价格表、无 `costOf`、无预算 |
| `packages/core/question-stream/src/usage-frame.js` | 把 usage 方言归一、估算字符数 | 文件头明写：「价格表、成本估算…**与计价无关**」 |

全仓 `costOf` / `perMillion` / `pricePerM` **0 命中** —— 所以任何「用量 → 钱」的能力都是
**全新维度**，不存在「重复集成」。

---

## 评审必须裁定的四件事

1. **数据源二选一**（见 `src/index.js` TODO-2）：上游读宿主 `session_projcache`，本仓读
   `data/usage/*.jsonl`，**两者不是同一份数据**。必须先定一个真源，否则会出现「两个数不一致」。
2. **价格表不得写死**：本仓会走浙大校内网关与自建端点，单价与 DeepSeek 官方不同（TODO-3）。
3. **上游首版稳定性**：0.1.0 是当天首版、无测试、无 peer 声明；锁版前须在沙箱实测字段名（TODO-5）。
4. **只在既有页面渲染**：任何新增侧边栏条目都应直接驳回（TODO-4）。

---

## 文件

```
packages/radar/dsh-radar-cost-guard/
├── package.json      # 锁版 0.1.0；dsh.bundle.patch → ./cordis.patch.yml
├── cordis.patch.yml  # - insert: [{ id: radar-cost-guard, name: dsh-radar-cost-guard }]
├── src/index.js      # 占位 apply()：只打日志，不注册任何服务
├── src/upstream.js   # 上游封装占位：只复用「token 形状归一」与「按百万折算」两件纯事
├── ATTRIBUTION.md    # 借鉴记账
├── OWNERS            # Owner: shared
└── README.md
```

**本包不含测试**（radar 口径：radar 包内不写测试），**不参与** `build.mjs` / `profile.mjs`。
