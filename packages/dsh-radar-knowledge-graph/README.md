# dsh-radar-knowledge-graph

> ## ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**
>
> 本包由「生态雷达」自动生成，只是一份**待人工审查的骨架**。
> 它**没有**被写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，
> 因此**不会**在运行时挂载。`src/index.js` 与 `src/upstream.js` 只有占位与 TODO，
> 调用即抛错 —— 这是故意的，避免「看起来能跑」的骨架被误用。

## 集成类型：**强化式集成**（不是全新）

| 项 | 值 |
| --- | --- |
| 与现有功能的关系 | **重复且可强化** |
| 强化哪个现有功能 | `dsh-zhiyun-page-notes`（「笔记」页）里的 **vault 链接图**（`dsh-zhiyun-core-vault`） |
| 关系判定 | **仍是同一个面板** ✅ + **功能正交** ✅ + **底层多调了更优质实现** ✅ |

### 1. 仍是同一个面板

目标是在「笔记」页**现有那张图谱画布**上，把「链接图」补成「链接图 + 语义图」，
**不新增侧栏项**。

⚠ 上游自带整页工作台（`exports['./client']`，`__ModuleLoader__` UI）。
**整页挂载会直接违反本条** —— 因此本骨架推荐**只挂宿主半**（路由 + store），
把读数交给现有画布（见 `src/upstream.js` 的 (a)/(b)）。

### 2. 功能仍相似正交

同一批笔记、同一个问题「**我刚才记的那个概念在哪**」：

| | vault 链接图（已有） | 本候选（上游） |
| --- | --- | --- |
| 节点 | 一篇笔记（文件路径） | 一个概念 / 定义 / 事实 / 例 / 反例 / 规则 |
| 边 | `[[链接]]`（**用户写下的**） | `defines / infers / causes / is_a / contains …`（**从正文抽出的**） |
| 回答 | 我的笔记**之间**怎么连 | 这篇**讲了什么**、结论出自**哪一段** |
| 索引单位 | 全库重算（几千篇量级） | 单篇按需抽取（LLM，有成本） |

不是同一功能的第二份实现：vault 按**链接**找，上游按**语义**找；
vault 的边是**人写的**，上游的边是**抽取的**，两者可以互补但不能互相替代。

### 3. 底层多调了更优质实现

本仓**没有任何正文语义抽取能力**，已核实：

- `packages/dsh-zhiyun-core-vault`：只解析 `[[…]]`、标签、嵌入；导出
  `unresolved / orphans / graph / resolve / parse / candidates / rename` —— **纯函数、零 IO**，
  没有任何模型调用或概念级结构。
- `packages/dsh-zhiyun-core-parser`：产出**逐句 ASR 转写 + 纠错**（`correction-policy.js`），
  是「老师说了什么」，不是「这段在论证什么」。
- `packages/dsh-zhiyun-core-knowledge`：只做**解析产物的入库与检索**（一张 `lectures` 表）。

自研等价物 = 本体设计（8 类节点 / 12 类关系）+ 约束抽取 + **双向锚点定位** +
证据核验 + 审计日志。规模不是一个「再写个解析器」的量级。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [`cwbcheng/dsh-knowledge-graph`](https://github.com/cwbcheng/dsh-knowledge-graph) |
| npm | `dsh-knowledge-graph@0.1.3` |
| 许可证 | **MIT** ✅（GitHub `spdx_id = MIT`；`LICENSE` 实文首行 `MIT License / Copyright (c) 2025 cwbcheng` 已比对） |
| 作者 | cwbcheng |
| 语言 / stars | JavaScript / ★1（fork 0） |
| 最近 push | 2026-10-16 |
| 类型 | **A · 原生 DSH 插件包**（`dsh.bundle.patch → ./cordis.patch.yml` + `dsh.client.platform = web`） |
| 挂载行 id | `dsh-knowledge-graph`（上游 patch 实文，已核） |
| 运行时依赖 | `markdown-it@14.1.0`、`pdfjs-dist@4.10.38`（`0.1.3` 的 npm 元数据显示无运行时依赖，`1.0.1` 的仓库 `package.json` 有这两项 → **须在安装后实测**） |
| peer | `@deepseek-ai/cordis: *`、`react: ^18.2.0` |

### 前置条件核实

| 项 | 上游要求 | 本仓现状 | 结论 |
| --- | --- | --- | --- |
| React | `^18.2.0` | `18.3.1` | ✅ 满足 |
| cordis | `*` | 宿主自带 | ✅ |
| Node | 未声明 | `^22.19.0 \|\| >=24.0.0` | ✅ 取本仓更严者 |
| 持久化 | **自带 SQLite**（常驻模式） | `dsh-zhiyun-core-knowledge` 硬约束「只用宿主存储栈、零文件 IO」 | ⚠ **冲突，须评审裁决** |
| DSH host | 未声明窄区间 | `0.2.0-rc.2` / `0.2.1-alpha.1` | ⚠ 需真机挂载验证 |

## 已知风险（评审前必读）

1. **⚠ npm 与 GitHub 版本号不一致**：仓库 `package.json` 是 `1.0.1`，npm `latest` 是 `0.1.3`，
   且 npm 上 4 个版本全部发布于 **2026-09-01 当天**、仓库最后 push 在 **2026-10-16**。
   → **npm 包大概率落后于仓库**。锁 `0.1.3` 可能锁到的是一个月前的形态。
   评审时须先确认：是否直接 git 依赖某个 commit，或等上游重新发布。
2. **抽取质量不可先验**：上游以 `claim / inference` 区分「概括」与「事实」，
   并强调「AI 转写不是原书文字」—— 这与本仓 `dsh-zhiyun-core-quiz` 的「找不到依据就报错」
   同一种诚实，但**准确率仍需在本仓的真实讲义上抽样**（建议 3 篇：数学、程序、人文各一）。
3. **成本**：单篇抽取要多次 LLM 调用，且上游设计了「复核轮」。**必须默认手动触发**。
4. **★1 / fork 0**：极早期。采用前应在**隔离环境**跑通它的 smoke 脚本，再评。

## 需要人工裁定

| # | 决议项 | 雷达建议 |
| --- | --- | --- |
| 1 | (a) 只挂宿主半 / (b) 整页挂载 | **(a)**；(b) 违反「仍是同一个面板」 |
| 2 | 路径 ↔ `documentId` 的映射策略 | 用笔记路径作为上游 `documentId` 的**外部提示**，由上游随机 UUID 内部承载；映射表落在本包 |
| 3 | 正文改写后旧锚点 | **标记失效、不自动重抽**（钱与不可逆） |
| 4 | SQLite 冲突 | 只读接口优先；若要 checkpoint 续跑，须显式豁免 `dsh-zhiyun-core-knowledge` 的「零文件 IO」约束 |
| 5 | 图片路径 | 首版**关闭**（本仓笔记库不存图片附件） |

## 边界

- **只读优先** —— 抽取产物不得改写笔记正文；用户确认前只作「附加视图」。
- **不改上游源码**；需要改动时走上游 issue / PR。
- **锁版** —— `dependencies` 写 `0.1.3`，不用 `^`；`src/upstream.js` 的常量是单一真源。
- **不新增导航项** —— 若最终不得不新增，评审应记录这次让步，而不是让它悄悄发生。

## 目录

```text
packages/dsh-radar-knowledge-graph/
├── package.json     # 锁版引入 dsh-knowledge-graph@0.1.3（无 ^）
├── cordis.patch.yml # - insert: [{ id: radar-knowledge-graph, name: dsh-radar-knowledge-graph }]
├── src/index.js     # 占位 + 适配点 TODO（无业务逻辑）
├── src/upstream.js  # 锁版凭据 + 上游封装占位
├── README.md        # 本文件
└── OWNERS           # Owner: shared
```

## 许可与署名

上游 MIT，本骨架**仅锁版引用、不摘取任何源码**。若后续确有代码借鉴，
按 `CONTRIBUTING.md` 3.3 在 `ATTRIBUTION.md` 登记。
