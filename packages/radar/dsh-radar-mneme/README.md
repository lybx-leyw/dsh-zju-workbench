# dsh-radar-mneme —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-10-30 · 第 112 轮），**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 的 `apply()` 直接抛错，TODO-0 ~ TODO-6 未落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成性质：**强化式集成**（不是「全新功能」）

给「我的」页**已有的**记忆台账换一层**召回实现** —— 仍是那块面板、仍是「把过去的记录找回」
这件事，不新增页面、不新增导航项。

| 判据 | 结论 | 依据（均已实核） |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ 成立 | 改的是 `dsh-radar-me-memory`（即本仓「我的」页台账）的检索口径，无新 UI |
| ② 功能仍相似正交 | ✅ 成立 | 同一问题的两个面：「**记下来的是哪些字**」（子串）vs「**记得的是哪件事**」（词法/实体/语义） |
| ③ 底层多调了更优质实现 | ✅ 成立 | 本仓该链路只有 `LIKE` 子串 + 当前包 `dsh-auto-memory@0.9.0` 的线性扫；上游有 **三路召回融合 + CJK bigram BM25 + 查询自适应阈值 + 实体轴**（详见下「现场证据」） |

> 判据③是本轮唯一一条**三条全绿**的候选。仍在册的 `minisearch`（`dsh-radar-search-rank`）
> 只覆盖「字段加权排序」，**不含** CJK bigram、不含阈值自适应、不含实体轴 —— 两者关系是
> 「本包在召回轴上更深，search-rank 在排序轴上更宽」，**不冲突、不重复**。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [slow-stack/mneme](https://github.com/slow-stack/mneme) |
| npm | `@modusensus/dsh-mneme@0.9.5`（锁版，**不用 `^`**） |
| 许可证 | **MIT** ✅（GitHub API `license.spdx_id = MIT`；仓内 `LICENSE` 1,067 B） |
| Stars | ★199（2026-10-30 实取），fork 22 |
| 建仓 / 最后 push | 2026-08-13 / 2026-10-29（**活跃**） |
| 依赖 | `dependencies` 只有 `morphicons@^1.7.1`；其余 8 个全为 `peerDependencies` |
| 体积 | npm `unpackedSize` **7,710,271 B**（≈7.4 MiB）、`fileCount` **396** |
| 语言 | JavaScript（ESM，`type: module`） |
| 形态 | **A 类 · 原生 DSH 插件包**：自带 `dsh.bundle.patch`、`dsh.client.inject = ["slots","locale"]`、`platform: "web"` |
| 首次发现 | 2026-10-30（第 112 轮 · A 组 · 发布通道轴） |

### npm 归属与仓库一致（r111 教训的正面对照）

r111 的 `KERBALMans/dsh-modpack` 判 🟢 却没出骨架，原因是 npm 包指向了别家仓库。
本轮**先查了这一点**：

```
npm repository.url  → git+https://github.com/slow-stack/mneme.git
npm latest = 0.9.5  → 与仓内 dsh-mneme/package.json 的 "version": "0.9.5" 逐字符相同
```

✅ 归属一致，可以锁版。

---

## 现场证据（判据③「更优质」到底优质在哪）

全部来自 `slow-stack/mneme@main` 的 `dsh-mneme/src/`，本轮逐行读过：

| 能力 | 本仓现状 | 上游实现 | 文件 |
| --- | --- | --- | --- |
| 中文分词 | 无（`LIKE '%词%'` 子串） | **ASCII 原样保留 + CJK 滑窗 bigram**；单字退化 unigram | `src/search/bm25.js:11-27` |
| 词法打分 | 无 | BM25，`K1=1.5 / b=0.75`，IDF 归一化到 `[0,1]` 以便与向量分同尺度融合 | `src/search/bm25.js:29-60` |
| 召回阈值 | 固定 | **查询自适应**：`entity:`/`attr:` → 0.5；长度 <5 → 0.7；>50 → 0.6；head-gap>0.3 → 0.5；否则 0.65（纯函数，无 store 访问） | `src/search/adaptive.js:1-22` |
| 召回轴数 | 1（子串） | **4**：向量 / FTS5-LIKE / BM25 / 实体图；融合有 blend / rrf / minmax 三配方 | `README.md:264-265` |
| 中文向量 | 无 | 本地 ONNX `Xenova/bge-small-zh-v1.5`，512 维，批量 8；**正文不外发** | `README.md:428-431` |

> 「`dsh-mneme@0.9.5` 的 `src/` 全量 **30,843 行**（`src/*.js` + `src/search/*` + `src/entities/*` 合计）——
> 这不是一个可以自己重写的量级，正属于「外部有更优底层、接进来增强」的典型。」

---

## 风险（评审时必须正面处理，不许糊过去）

| # | 风险 | 事实 | 影响 |
| --- | --- | --- | --- |
| **1** | **`dsh-better-sidebar` 硬依赖** | 上游 `peerDependencies` 含 `dsh-better-sidebar >=0.18.0 <1`；`lib/client.js:293` 注释：「inject 声明的服务是硬等待 —— 未安装 better-sidebar 的环境里整个 entry 会挂起」；本仓 `packages/` **无任何包**声明它 | 要么引入整套右栏底座，要么功能砍半。**TODO-0 阻塞** |
| **2** | **体积** | 7.4 MiB / 396 文件；本地推理闭包（transformers + onnxruntime-node + sharp）上游自述 **≈393 MB**、49 个包，需手动「收编」到 `~/.dsh/mneme/runtime/` 才不与 profile 共用依赖图 | workspace 与首次启动成本都显著。**TODO-1 阻塞** |
| **3** | **bundle patch 冲突** | 上游自带 `cordis.patch.yml`（一条 `insert`，id=`dsh-mneme`）。若 profile 同时列上游与本包 → 面板双份 | 必须在 `apply()` 里检测已挂载。**TODO-2** |
| **4** | **Node 版本** | 上游 README 明写 `Node 24+`（`node:sqlite` 内置） | 宿主 `runtime.lock.json` 不满足则**整包不可用**。**TODO-6** |
| **5** | **隐私** | 记忆含作息 / 成绩 / 健康；上游有「敏感度」字段与「事件时间」 | 本仓台账须默认按敏感度过滤，且不得进入 `docs/` 或任何导出物。**TODO-4** |
| **6** | **工具名未实取** | `UPSTREAM_TOOLS` 的 10 个名字取自 README 声明，本轮**未解包 dump 真实名单** | 评审先核实，再决定哪些进「我的」页。**TODO-3** |

---

## 目录

```
packages/radar/dsh-radar-mneme/
├── package.json       # 锁版依赖 @modusensus/dsh-mneme@0.9.5（无 ^）
├── cordis.patch.yml   # - insert: [{ id: radar-mneme, name: dsh-radar-mneme }]
├── src/index.js       # 占位；apply() 抛错；TODO-0 ~ TODO-6
├── src/upstream.js    # 锁版凭据 + 服务/槽位/工具清单（单一真源）
├── README.md          # 本文件
└── OWNERS             # Owner: shared
```

无 `ATTRIBUTION.md` —— 本骨架**未摘取任何上游源码**，只声明依赖与适配点。

---

## 下一步（按优先级）

1. **TODO-2 先做**（成本最低、收益最高）：确认上游 patch 是否会与本包重复插入。
   若会，先只做一个「薄壳 + 检测」，不计入面板功能。
2. **TODO-0 裁决**：`dsh-better-sidebar` 是否值得为一个面板引入。若否，退回
   `conversation.session.header.actions` 单槽，并在 README 里**明确写明功能范围**。
3. **TODO-6 核对 Node 版本**（`runtime.lock.json`），不满足即**直接整目录删除**。
4. 通过后再做 TODO-1 / 3 / 4 / 5。
