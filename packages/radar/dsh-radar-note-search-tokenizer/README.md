# dsh-radar-note-search-tokenizer —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar`（第七十二轮，2026-10-26）自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 的 `apply()` 抛 `NOT_IMPLEMENTED`。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。
>
> 与 [`packages/dsh-radar-note-search/`](../dsh-radar-note-search/) 是**同一个面板上的两级**，
> **必须一起评审、择一或合并实施** —— 见下文「与已有候选的关系」。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [lucaong/minisearch](https://github.com/lucaong/minisearch) |
| npm | `minisearch@7.2.0` |
| 许可证 | **MIT** ✅（宽松白名单内，允许锁版引入） |
| 作者 | Luca Ongaro（上游维护者） |
| 依赖 | **零依赖**（`dependencies: {}`，`npm view` 实查） |
| 最近发布 | 2025-09-16（7.2.0 = `latest`） |
| 语言 | TypeScript（产出 ESM + CJS + UMD） |
| 上游形态 | **纯库**：无 `dsh.bundle.patch`、无 `cordis.patch.yml`、无客户端半边 |

本包**只用到上游的 `tokenize` 钩子**，不改上游任何一行。

## 集成方式

**锁版引入 + 补一层分词**（B 类）。`package.json` 写精确版本 `7.2.0`；运行时核对；
本包新增的代码只有 `src/tokenizer.js` 里一个纯函数 `tokenizeCJK()`（约 40 行，无依赖）。

## 集成判定：**强化式集成**

| 判据 | 结论 |
| --- | --- |
| 仍是同一个面板 | ✅ 笔记页左侧同一个过滤框（`zs-nt-filter` / `buildRows()`）。本包**不碰 UI**，只提供分词函数与实例工厂 |
| 功能仍相似正交 | ✅ 仍是「在一堆笔记里找某几篇」；变的是「怎样的字符序列算命中」，且**旧的文件名子串命中必须保留**（TODO-1） |
| 底层多调更优质实现 | ✅ 上游 minisearch 提供倒排索引 / 字段加权 / 打分；本仓现状是一次 `String.includes()` |

**增强哪个现有功能**：`dsh-zhiyun-page-notes` 的「过滤笔记」输入框。

## 现状核实（为什么是「强化」而不是「全新」）

对 `radar` 分支（2026-10-26，`c2ce0d9` / `4fe6236` 基线）读码：

| 位置 | 现状 |
| --- | --- |
| `packages/dsh-zhiyun-page-notes/src/client.jsx:120-130` `buildRows()` | 过滤时 `entries.filter((e) => e.type !== 'folder' && `${e.path}`.toLowerCase().includes(query))` —— **只比 `path`** |
| `packages/dsh-zhiyun-page-notes/src/index.js:321-346` `tree` | 返回的条目已带 `title` / `folder` / `preview`（正文前 120 字）/ `chars` —— **数据在手边，只是没参与匹配** |
| 全仓 | 无任何倒排索引 / 分词器（`minisearch` 只出现在**未评审**的 `dsh-radar-*` 骨架里） |

## 现场证据（2026-10-26 沙箱实跑，`minisearch@7.2.0` + 本包 `tokenizeCJK`）

5 篇合成笔记（`path` / `title` / `preview`，模拟 `tree` 的真实返回形状）：

| 查询 | 旧实现（`path` 子串） | 上游默认分词 + `prefix:false` | 上游默认分词 + `prefix:true` | **本包 `tokenizeCJK` + `prefix:false`** |
| --- | --- | --- | --- | --- |
| `佩亚诺` | 1（`高数/泰勒与佩亚诺`） | **0** | **0** | 2（`e` 184 / `a` 44） |
| `泰勒` | 2 | **0** | 2 | 2（`a` 59 / `e` 42） |
| `数学` | 2 | **0** | 2 | 3（`b` 39 / `a` 19 / **`e` 3**）|
| `线` | 1 | **0** | 1 | 1 |
| `partition`（正文里的词） | **0** | 1 | 1 | 1 |
| `学分`（跨词片段） | **0** | 0 | 0 | 2（**假阳性**） |

三件事同时成立：

1. **默认分词对中文完全无效**（第 3 列 0 命中），`prefix:true` 只能救「token 开头」；
   「佩亚诺」在标题正中间 → 仍是 0（第 4 列）。
2. **本包补上了这一层**（第 5 列），且顺带命中了正文里的 `partition`。
3. **但本包引入了新的假阳性**：`数学` 命中了 `e`（正文写「高数复习」，tokens 里有 `数` + `学`），
   `学分` 命中两篇（bigram 跨词）。**这两条正是 TODO-2 / TODO-3 必须解决的** ——
   不含原文复核就上线，等于把「搜不到」换成「搜出不该有的」。

### 体积与延迟（合成语料，**不可外推**）

2,000 篇 × 40 句（每篇约 500 字，token 数 2,122 个去重项）：

| 指标 | 值 |
| --- | --- |
| 建索引 | 81 ms |
| `JSON.parse` + `loadJSON` | 24 ms |
| 索引 JSON（**含 storeFields，故偏大**） | 689 KB |
| 单次查询 | 1.7 ms |

真实笔记库多半远小于此；**仍需用真实数据量一次**（TODO-5）。

## 为什么不是 FlexSearch / Orama（本轮实测）

| 候选 | 结论 |
| --- | --- |
| `nextapps-de/flexsearch@0.8.212`（Apache-2.0） | 默认 `Index` 对中文 **0 命中**（实跑 `数学`/`线` 全空）；切到 `tokenize:'full'` 才有效 —— 但那是**换引擎**，不是补分词，等于把在途的 minisearch 方案整个推翻。2026-10-22、10-26 两次判定均为 ⛔ |
| `@orama/orama@3.1.18`（Apache-2.0） | `fulltext` / 默认模式下中文**全 0 命中**（实跑 3 条查询）；`hybrid` 模式抛 `Cannot read properties of undefined (reading 'property')`。可用但需要外部 embedding 或改分词 → 成本远高于 minisearch 补一层 |
| `orama@2.0.6`（同名前缀的**另一个包**） | **是 D3 图表库**（导出 `Chart`/`Axis`/`Bars`…），与检索无关 —— 一个「名字撞车」的坑，登记以免下轮重复踩 |

## 主要风险

1. **召回放宽 → 排序变差**（最容易被误判为「变好了」）。必须有**原文子串复核**与差分计数，
   否则无法证明「命中集合 ⊇ 旧集合 且新增的都是对的」。
2. **单字污染**：`的` / `数` / `线` 这类字几乎每篇都有（实跑 `的` 命中 3/5 篇，分数 0.69–0.82）。
3. **版本冲突**：`dsh-radar-search-rank` 锁 7.1.2，本包锁 7.2.0 → 采用本包时须一并升版。
4. **两套分词并存**：若 `dsh-radar-search-segment`（jieba-wasm）被采用，本包的 bigram 应当让位。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 插件入口占位（`apply()` 抛 `NOT_IMPLEMENTED`）+ 6 条 TODO |
| `src/upstream.js` | 锁版凭据（包名 / 精确版本 / 仓库 / 上游无中文分词这一事实） |
| `src/tokenizer.js` | **唯一的真实代码**：`tokenizeCJK()` 纯函数（CJK bigram + 单字，拉丁整词小写）+ `createNoteSearch()` 占位 |
| `cordis.patch.yml` | 一条 `insert`，`name` 与包名一致 |

## 与已有候选的关系（评审必读）

| 候选 | 职责 | 与本包的关系 |
| --- | --- | --- |
| `dsh-radar-note-search` | 把 minisearch 接进笔记页（正文召回） | **前置**。本包是它的「分词补丁」；两者建议**合并成一个包**，而不是各挂一个 |
| `dsh-radar-search-rank` | 学习页重排（7.1.2，默认分词） | **版本冲突**：同仓不应并存在两个 minisearch 小版本 |
| `dsh-radar-search-fuzzy` | 打错字仍命中（Fuse.js） | **正交**（错字 ≠ 分词），但改同一族调用点，须合并裁决 |
| `dsh-radar-search-segment` | jieba-wasm 分词（学习页） | **冲突面**：若采用 wasm 分词，本包应降级为「仅供 B 类兜底」 |

## 下一步（给评审者）

1. 先裁**合并还是并存**：与 `dsh-radar-note-search` 合并成一个包（推荐），还是保留两个。
2. 再裁**分词口径**：bigram+单字（本包）vs `Intl.Segmenter('zh')` vs jieba-wasm。
   `Intl.Segmenter` 零依赖，但给的是**词**，搜「傅里」之于「傅里叶」会漏。
3. 两条都通过后，按 `src/index.js` TODO-1…6 落地，**第一步先写「召回 ⊇ 旧实现」的差分测试**。
