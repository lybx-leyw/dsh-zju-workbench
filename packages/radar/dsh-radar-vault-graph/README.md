> 🅿️ **部分提取，保留待后续**（2026-10-28，branch `vault-integrate`）：F-4（重边折叠）已进
> `dsh-zhiyun-core-vault`；其余能力未做。**本包不删除**，按 `docs/contributing/RADAR.md` 3.2 保守废弃原则保留。

## 能力清单

| # | 能力 | 状态 | 去向 |
| --- | --- | --- | --- |
| F-1 | 相邻链接 `[[A]]与 [[B]]` 不漏第二个 | **作废** | 实测本仓解析器已正确（`parseNoteLinks` 返回两条），候选所记为误报。已在 `tests/vault.test.mjs` 加测试钉住 |
| F-2 | 代码块 / 行内代码里的 `[[x]]` 不算链接 | **作废** | 实测已正确排除（三种围栏形态均返回空） |
| F-3 | 未建笔记用虚拟节点表示 | **作废** | 本仓已把未解析按 `reason: missing/ambiguous` 记进 `unresolved`，不产生伪节点 |
| F-4 | 同一对笔记连两次产生两条重边 | **已提取** | `dsh-zhiyun-core-vault/src/index/vault-index.js`：边折叠 + `weight` + 出入度按关系数算。测试见 `tests/vault.test.mjs` |
| F-5 | 社区 / 枢纽 / 桥（graphology-louvain 聚类） | **未做** | — |
| — | 用 mdast 替换正则抽 `[[...]]` | **不做** | 本仓 `parse/links.js` 已按 Obsidian 语义逐条实现并钉了 11 条测试；换 mdast 得不到净收益，反而丢失 `%%注释%%` 等已知边界的处理共识 |

# dsh-radar-vault-graph

> **候选骨架：未评审、未接入 profile、不可直接使用。**
> 由「DSH 生态雷达」自动生成（2026-10-20 · 第四十轮）。仅供人工评估；
> 真要采用须重写并走正常包流程。**不得**写入 `profiles/zhiyun-bench/package.json`。

## 一句话

把「笔记」页反向链接的**计算底座**，从「全篇正则扫 `[[...]]`」换成
「mdast 语法树遍历 + graphology 图算法」。

## 集成类型

**强化式集成**（不是「全新」，也不是「简单集成」）。三条判据：

| 判据 | 回应 |
| --- | --- |
| ① 仍是同一个面板 | 「笔记」页右侧的「反向链接 N」列表，不新增页面/导航项/编辑器 |
| ② 功能仍相似正交 | 旧实现答「这篇被谁提到」，新层答同一问题（更准）+ 多一个只读「结构」视图。不是两套并列的链接管理 |
| ③ 底层多调了更优质实现 | 本仓无语法树、无节点类型、无图算法；上游三样都有 |

## 上游

| 包 | 版本（锁死） | 许可证 | 仓库 |
| --- | --- | --- | --- |
| `remark-parse` | `11.0.0` | MIT | `remarkjs/remark`（monorepo，★9021） |
| `unified` | `11.0.5` | MIT | 同上（monorepo 的 workspace 包） |
| `unist-util-visit` | `5.1.0` | MIT | `syntax-tree/unist-util-visit`（★360） |
| `graphology` | `0.26.0` | MIT | `graphology/graphology`（npm `repository` 字段） |
| `graphology-communities-louvain` | `2.0.2` | MIT | 同 monorepo |

- **作者**：remark/unified 生态（Titus Wormer 维护），graphology（Yomguithereal 维护）。
- **许可证核实**：五个包 `npm view <pkg> license` 全部返回 `MIT`；GitHub 元数据
  `remarkjs/remark`、`syntax-tree/unist-util-visit` 为 `MIT`。**无 `NOASSERTION`**。
- **集成方式**：锁版作为普通 npm 依赖引入（`dependencies` 里写死版本，不用 `^`），
  **绝不拷贝上游源码**、**绝不修改上游**。
- **不改本仓**：不动 `dsh-zhiyun-vault` 一行代码。本包只 `provide('radarVaultGraph')`，
  是 vault 索引的**下游只读派生视图**。

## 它增强的是哪个现有功能

「笔记」页（`dsh-zhiyun-page-notes`）的关系视图 —— `NoteRelations`（client.jsx:219 起），
其中「反向链接 N」由 `vault('backlinks', …)` 提供。

## 与本仓现状的差异（2026-10-20 实测，直接 import 本仓真实实现）

| # | 现象 | 本仓现在 |
| --- | --- | --- |
| F-1 | `见 [[A]]与 [[B]]` | 只连 `A`，**`B` 消失**（正则贪婪，`A]]与 [[B` 整段当目标；既不连边也不进未解析） |
| F-2 | ` ```js … "[[c]]" …``` ` / 行内 `` `[[d]]` `` | **算作真链接**，进未解析清单 |
| F-3 | `[[还没建的笔记]]` | 模型里没有这个节点；建出来之后边数不变（2→2） |
| F-4 | 同一对笔记连两次 | 两条重边，`inDegree` 记 2 |
| F-5 | 社区 / 枢纽 / 桥 | **完全没有** |

> F-1 是**纯 bug**，与本包无关，应先单独修（见 `src/index.js` TODO-0）。
> 在修掉之前，「换底座」会让用户看到**反链条数变多**，这是必须先说明的行为变化。

## 已知边界（评审务必逐条确认）

- 上游**不认识** Obsidian 专有语法：`%%注释%%` 里的 `[[链接]]` 仍会被算作链接；
  `![[嵌入]]`、`> [!callout]`、`:::block`、frontmatter 都会退化成普通文本。
- 上游**不做** wikilink 语义解析（别名 `|`、小节 `#`、块 `^`）—— 那部分仍用
  本仓 `splitWikilink`；本包只借上游的「**在哪**」，不借「**是什么**」。
- 未引 `remark-gfm` / `remark-frontmatter`：表格、删除线、frontmatter 会退化。
- Louvain 社区编号与遍历顺序有关，**必须规范化**，否则每次打开颜色都变。

## 不做什么

- 不新增页面、不改导航、不改编辑器。
- 不改 vault / notes / 任何既有包的源码。
- 不在每次自动保存（800ms）后重解析全库（见 TODO-7）。

## 待评审裁决

1. F-1 的修法：改本仓正则为非贪婪，还是直接换本包底座？（**建议先改正则**，本包再上）
2. 「结构视图」（社区/枢纽/桥）是否值得进「笔记」页，还是只做背后的正确性修复？
