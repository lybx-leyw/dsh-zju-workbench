# 图谱三包 → 现有包的集成记录

> 分支 `vault-integrate` · 2026-10-28
> 依据：`docs/contributing/RADAR.md`（转正四道门槛 + 保守废弃原则）

## 结论摘要

| 骨架 | 判定 | 处置 | 理由（实测，非 README 自述） |
| --- | --- | --- | --- |
| `dsh-radar-note-graph` | **可移植** | **整包移植** → **新建正式包 `dsh-zhiyun-graph-render`**，骨架**删除** | 本仓确认无任何图谱渲染器（`page-notes/src` 零 `graph` 消费者），是「无 → 有」，无重复 |
| `dsh-radar-vault-graph` | **只有一项能力成立** | **提取 F-4** → `core-vault`，骨架**保留标记** | 声称的 F-1/F-2/F-3 **实测均不成立**；F-5 未做 → 仍有剩余能力 |
| `dsh-radar-knowledge-graph` | **前提错误** | **提取「使用计数」** → `page-plugins/src/usage.js`，骨架**保留标记** | 上游根本不是笔记语义图（`grep note\|semantic\|vault` = 0） |

---

## 1 · `note-graph`：整包移植 → 新包 `dsh-zhiyun-graph-render`

> **订正（本记录第一版写错了落点）**：初版把 `model.js` / `NoteGraph.jsx` 放进
> `packages/dsh-zhiyun-page-notes/src/graph/`，并写下「为何不单开一个包」。那是**错的**：
> 整包搬进某个已有包的子目录，既不是移植（落点是新的正式位置，骨架随之删除），
> 也不是提取（提取是摘一项能力写进已有包，骨架保留）—— 它是**两种模式混用**。
> 后果是具体的：`page-notes` 的客户端 bundle 内联了 cytoscape + fcose，页面替「画图」
> 背上了这份依赖。现已改为新建 `dsh-zhiyun-graph-render`。
> 规则见 `RADAR.md` §1.1。

**落了什么**：新包 `packages/dsh-zhiyun-graph-render/`

- `model.js` —— 纯函数：`toElements`（vault 图 → cytoscape elements）、`layoutFor`（规模选择）、
  `ringPositions`（超阈值时的圆周预设）、`graphStyles`（只走 `--zy-*` 变量）
- `NoteGraph.jsx` —— 挂载与清理；`ResizeObserver` 跟随右栏折叠；渲染失败不影响整页
- `style.css` —— 图谱自己的样式（含 `body[data-zhiyun]` 作用域前缀），由页面 `mountStyle` 挂上

**接入点**：

| 位置 | 改动 |
| --- | --- |
| `client.jsx` `refreshSide` | 多拉一次 `vault('graph')`（全库，不随当前笔记变） |
| `client.jsx` 右栏 | 「反向链接」之后插入 `<NoteGraph>` |
| `client.jsx` 状态栏 | 「N 条链接 · M 个标签」由 `<span>` 改成 `<button>`，可点开右栏 —— 解决候选 README 第 3 条风险「右栏默认收起 ⇒ 功能做了没人看见」 |
| `page-notes/src/style.css` | 图谱那段**移出**，`.zs-nt-graph*` 归新包所有 |

**依赖**：`cytoscape@3.34.4` + `cytoscape-fcose@2.2.0`（均 MIT，锁版无 `^`），
写在 `graph-render` 的 `dependencies`；`page-notes` 已**移除**这两个依赖。

已实测（真实 esbuild 构建，不是推断）：

| 检查 | 结果 |
| --- | --- |
| `graph-render` 单独构建 | 内联 cytoscape + fcose + cose-base + layout-base，不含本仓其它包 |
| `page-notes` 构建 | 约 60 KB，**不再**内联任何第三方；产出里出现 `require("dsh-zhiyun-graph-render")` |
| 模块表跑通 | 按宿主 `__ModuleLoader__` 形状注册两包，页面拿到 `NoteGraph`（函数）与 `css`（字符串） |
| external 面 | `graph-render` 的 `dsh.client.external` 为 `[]` —— 纯库无共享实例需求，随包内联 |

**为何单开一个包**（原「不单开」的理由已被推翻）：

| 视角 | 单独成包 | 塞进 page-notes 子目录 |
| --- | --- | --- |
| 依赖归属 | cytoscape/fcose 只属于「画图」 | 页面 bundle 内联 1.3 MB，且页面从此不敢删这份依赖 |
| 模式一致性 | 移植 = 整包搬到新位置，骨架删除，语义干净 | 移植的产物藏在提取的落点里，下一个人分不清这里发生了什么 |
| 可测试性 | `model.js` 是纯函数，独立包下 import 路径直白 | 要穿过页面目录层级 |
| 消费者 | 目前只有右栏，但「谁画图」是通用问题 | 想复用就得从页面包里挖 |

**职责边界**（写进包的 `src/index.js` 与 README）：不做数据（不重算度数）、不做存储、
不新增页面。只有 `{nodes, edges}` → 画布的映射与绘制。

**跨包接线**（三处必须同时成立，漏一处都不报错、只是图不显示）：

| 位置 | 作用 |
| --- | --- |
| `page-notes/package.json` → `dsh.client.external` | 让 esbuild 外部化它，而不是内联 |
| `scripts/build.mjs` → `CLIENT_PACKAGES` | 它才会有 `lib/client.js` |
| `profiles/zhiyun-bench/package.json` → `bundles` | Loader 才会加载它 |

## 2 · `vault-graph`：只提取 F-4

候选列出 F-1～F-5 五个「本仓缺陷」。**逐条实测后，只有 F-4 成立**：

| 断言 | 候选说法 | 实测 | 结论 |
| --- | --- | --- | --- |
| F-1 | `见 [[A]]与 [[B]]` 只连 A，B 消失 | 返回 `["A","B"]` | ❌ 误报 |
| F-2 | 代码块 / 行内代码里的 `[[x]]` 算真链接 | 三种围栏形态均返回 `[]` | ❌ 误报 |
| F-3 | 未建笔记在模型里没有节点 | 进 `unresolved`（`reason: missing`），无伪节点 | ❌ 误报 |
| F-4 | 同一对笔记连两次 → 两条重边、`inDegree` 记 2 | 确实如此 | ✅ **成立** |
| F-5 | 无社区 / 枢纽 / 桥 | 确实没有 | ✅ 成立（未做） |

**F-4 的修法**（`vault-index.js`）：

- 同一 `(from, target)` 的 `link` 边折叠为一条，重复次数记 `weight`
- `embed` 与 `link` **不互相折叠** —— 一篇既 `[[a]]` 又 `![[a]]` 确实是两种意图
- `inDegree` / `outDegree` 改按**关系数**算（`new Set(...)`），不再按书写次数
- `backlinks` 面板**保持逐次记录**（用户要知道「它在哪几处提到我」）

**为什么不换 mdast**：候选主张用 `remark` + `graphology` 替换正则。本仓 `parse/links.js`
已按 Obsidian 真实语义逐条实现（别名、`#小节`、块引用、`![[嵌入]]`、`%%注释%%`、URL 里的 `#`…）
并钉了 11 条测试。换底座要重新对齐这些边界，净收益为负 → 标 `不做`。

## 3 · `knowledge-graph`：前提错误，只剩一项

**它自称**：笔记语义图（`documentId` / `sourceId` / LLM 抽取 / SQLite）。
**实测 `dsh-knowledge-graph@0.1.3`**：

```text
description: 可视化插件/技能/工具、依赖关系与使用统计
grep -ci 'note|语义|semantic|vault' lib/client.js  →  0
files: lib/client.js (1294 行) + lib/index.js (560 行)，依赖 null
```

是**插件生态**的可视化。原 README 的 6 条 TODO（路径↔documentId 映射、抽取产物写库边界、
SQLite 豁免、LLM 成本控制…）**全部建立在这个错误前提上，一条都不成立**。

去掉误读后，对本仓的真空白只有一项：**「这个工具我到底用过没有」**。

- 本仓「插件」页答运行时**依赖拓扑**（谁依赖谁、能不能安全关）
- 上游的 `ensureNode/touch` 答**使用频率**（`count` / `lastUsed`）

**提取为** `packages/dsh-zhiyun-page-plugins/src/usage.js`（纯函数，不搬上游 1854 行）：

| 函数 | 作用 |
| --- | --- |
| `createLedger` / `recordUse` | 按 `kind:name` 记账，缺字段不产生脏节点 |
| `staleness` | `never` / `stale` / `active` 三态，边界严格大于 |
| `summarize` | 合并「已安装但没用过」的条目，never → stale → active 排序 |

接入 `Panel.jsx`：新增「吃灰」区块，读 `localStorage['zhiyun-plugin-usage-v1']`，
按 `view.rows` 补齐从未使用的包。

### ⚠️ 仍未接线的部分（必须说清楚）

**目前没有任何代码在写这个账本。** 所以「吃灰」区块首次打开时会**全部显示「没用过」**——
这是如实反映「还没记录」，不是 bug，但**在当前状态下这个功能还不能用**。

要真正跑起来需要「工具调用信号」，而本仓：

```text
grep -rn "ctx.on(|ctx.effect(|session.events" packages/dsh-zhiyun-*/src/
→ 无任何命中
```

即**没有可订阅的会话事件通路**，宿主那边怎么拿到每轮工具调用未经验证。按「不硬接」原则，
这一步留给评审：要么先探明宿主事件 API，要么把 `recordUse` 接到已有的可观测点。

## 4 · 骨架处置（保守废弃原则）

| 骨架 | 处置 | 依据 |
| --- | --- | --- |
| `dsh-radar-note-graph` | **删除** | 整包移植，能力清单全空（RADAR.md §3.1 情形 ①） |
| `dsh-radar-vault-graph` | **保留**，顶部加 🅿️ 标记 + 能力清单 | F-5 未做，还有剩余能力（§3.2） |
| `dsh-radar-knowledge-graph` | **保留**，顶部加 🅿️ 标记 + 订正 + 能力清单 | 第 4 项「轨迹回放」未做（§3.2） |

两个保留的骨架都在 README 顶部写明了「部分提取、不删除」及剩余项，
下一轮雷达不会把它们当新候选重扫。

## 5 · 测试

| 文件 | 条数 | 覆盖 |
| --- | --- | --- |
| `tests/vault.test.mjs` | 37（原 32 + 新 5） | 重边折叠、出入度口径、embed 不折叠、F-1 回归钉住 |
| `tests/note-graph-model.test.mjs` | 10（新） | 映射、孤立节点、布局切换、只走主题变量 |
| `tests/plugin-usage.test.mjs` | 10（新） | 计数、三态判定、排序、脏数据容错 |
| `tests/graph-render-wiring.test.mjs` | 3（新） | 跨包接线：真产物跑模块表、三处接线齐全、种子词表未被污染 |

合计 **79 条全过**（含 `radar-rotation` 19 条）。

`graph-render-wiring` 做过**变异验证**，确保它真能红而不是永远绿：

| 故意造坏 | 结果 |
| --- | --- |
| 从 `page-notes` 的 `dsh.client.external` 里删掉 `graph-render` | 2 条红（构建期会把 cytoscape 内联回来） |
| 从 `CLIENT_PACKAGES` 里删掉 `graph-render` | 1 条红（运行时没有 `lib/client.js` 可 require） |

另外，这次改动**顺带修好了两条本来就红的测试**：`dsh-radar-note-graph` 骨架删除后，
它在 `build-seeds.test.mjs` 的 `CLIENT_PACKAGES` 里留下的过期条目让
「external 覆盖」与「真实构建无内联」两条一直失败。已随本次接线一并清理。

全量对比（`node --test tests/*.test.mjs`）：基线 59 红 → 现在 57 红，**新增失败 0 条**。
（其余红均为本沙箱未完整 `npm install` 导致的 `ERR_MODULE_NOT_FOUND`，例如
`tests/vault-notes.test.mjs` 缺 `@deepseek-ai/dsh-atomic-write`；已用 `git stash` 对照确认
改动前表现一致。）

## 6 · 沉淀成规则：移植与提取不可混用

这次踩的坑值得写成硬约定，否则下一个人会重犯（而且症状不是报错，只是「包里多了一份不该有的依赖」）。

| | **移植（port）** | **提取（extract）** |
| --- | --- | --- |
| 前提 | 整个包都能用 | 只有某几项能力成立 |
| 落点 | **新建**正式包 `dsh-zhiyun-<slug>` | **已有**的目标包 |
| 骨架 | 删除（能力已全部搬走） | 保留，顶部标 🅿️ + 能力清单 |
| 反例 | 把整个包塞进某个已有包的子目录 | 把一项能力单独开成新包 |

**判定顺序**：先逐项核能力清单 —— 全部成立（或成立的部分就是它的全部价值）→ 移植；
只有部分成立 → 提取，并且骨架**必须保留**。

混合的代价是具体的：`page-notes` 的 bundle 因为整包塞进来而内联了 1.3 MB 的 cytoscape，
而页面的职责描述里根本没有「画图」这一项。依赖错位不会让任何测试失败，只会让下一个
想动页面的人以为这份依赖是必需的。

规则已写进 `docs/contributing/RADAR.md` §1.1，本记录是它的第一次实战应用（含一次返工）。
