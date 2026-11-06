# dsh-radar-note-fulltext —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-10-29 · 第九十五轮），**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 的 `index()` / `bodyHits()` 直接抛 `NOT_IMPLEMENTED`，TODO 未落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成性质：**强化式集成**（不是「全新功能」）

给「笔记」页**已有的**目录过滤框补一层**正文**索引 —— 仍是同一个面板、同一个输入框，
不新增页面、不新增搜索入口。

| 判据 | 结论 | 依据（均已逐行/实测核对） |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ 成立 | 改的是 `dsh-zhiyun-page-notes/src/client.jsx` 的 `buildRows()` 过滤口径，无新 UI |
| ② 功能仍相似正交 | ✅ 成立 | 同一问题的两个面：「**文件名**里有这个词」vs「**内容**里有这个词」 |
| ③ 底层多调了更优质实现 | ⚠️ **部分成立** | 本仓该链路**零**正文索引（见下）；上游给倒排 + 子串命中，但**无中文分词**、**同分并列** |

> 判据③的折扣必须在评审时正面处理，不许写成「相关度排序」糊过去。详见「现场证据」。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [kyr0/clientside-search](https://github.com/kyr0/clientside-search) |
| npm | `clientside-search@1.8.1`（锁版，**不用 `^`**） |
| 许可证 | **MIT** ✅（GitHub `/license` 实核 `MIT`，1069 B；npm `license` 同为 `MIT`） |
| 作者 | kyr0 |
| Stars | ★12（2026-10-28 实取）—— **低星不是压级理由**，判级依据是实测行为 |
| 最后 push | 2023-07-21（**近三年未更新**，这是真实风险，单列在下） |
| 依赖 | `dependencies` **不存在**（`npm view` 实查）→ **零运行时依赖** |
| 体积 | ESM `index.esm.js` **23,338 B** + `en.esm.js` **14,042 B**；npm `unpackedSize` 2,139,515 B（含 cjs/iife/sourcemap/多语言包） |
| 语言 | TypeScript（产物为 ESM/CJS/IIFE 纯 JS） |
| 形态 | **纯库**，不是 DSH 插件 —— 本包是 **B 类**（能力提取 + 封装） |
| 首次发现 | 2026-10-29（第九十五轮 · C 组 · 轴「笔记的全文检索：找得到 ≠ 排得准」） |

---

## 本仓缺口（为什么需要它）

三处逐行读过，**该链路上没有任何正文索引**：

| 位置 | 现在是什么 | 后果 |
| --- | --- | --- |
| `dsh-zhiyun-page-notes/src/client.jsx:128-131` | `.filter((e) => \`${e.path}\`.toLowerCase().includes(query))` | **只看路径**，正文再多次提及也搜不到 |
| `dsh-zhiyun-core-vault/src/index/vault-index.js:203` | `notesMap.set(path, { path, title, outlinks, tags })` | 库索引**不保留正文**，只有链接/标签 |
| `dsh-zhiyun-core-knowledge/src/service.js:280` | 字面 `String.includes`，只覆盖 knowledge 自己的域 | 与笔记库**不是同一批数据** |

> 一句话：现在「搜一篇笔记里的词」这件事，在本工作台里**做不到**。

---

## 现场证据（2026-10-28 实测 · Node 22.13.1）

`npm i clientside-search@1.8.1` 后直接 import 跑的，**不是照 README 复述**：

### E-1 语言包必须显式传，否则**崩**

```js
new SearchEngine(undefined)
// TypeError: Cannot read properties of undefined (reading 'stopwords')
```

不是「回落到英文」，是直接抛。必须 `import en from 'clientside-search/en'`。

### E-2 语言包只有 `en/de/fr/es/ja` + `phonetic` + `stem` —— **没有中文**

实测用 `en` 包跑中文**可用**：

```js
en.tokenizer('守恒')                      // → ['守恒']     整串一个 token
en.isLogograhic                           // → undefined
processText('动量守恒定律：…')             // → ['动量守恒定律：若系统不受外力，总动量保持不变。']  整句一个 token
```

→ 中文能**子串命中**（走 `bkTree.searchPartial`，`match` 标 `partial`），但**没有分词**。

### E-3 子串命中成立（这是它比现状强的地方）

`行最简形` 与 `行 最简形` 都能命中「矩阵的秩 = 行最简形中非零行的个数」那篇；
`拉格朗日` / `中值定理` / `泰勒 展开` 均正确命中。这正是 `client.jsx` 现在给不出的。

### E-4 分数是**单查询 min-max 归一化**，同分必然并列

源码：`u[m] = (max(min,score) - min) / (max - min)`。

| 夹具 | 结果 |
| --- | --- |
| 「守恒」打两篇**等长**文档（动量守恒 / 能量守恒） | `1.000` / `1.000` —— **并列** |
| 「守恒」打一**短**一**长**文档 | `1.000` / `1.000` —— **并列** |
| 只命中一篇 | 恒 `1.000` |

→ **它比现状强的是「找得到」，不是「排得准」**。任何「相关度」措辞都不成立，
同分必须由 TODO-3 显式 tie-break，否则排序层等于没做。

### E-5 规模与持久化

| 项 | 读数 |
| --- | --- |
| 建索引 2000 篇 × ~600 字 | **286 ms** |
| 单查询（含长中文查询） | **0.1 – 0.6 ms** |
| `hydrateState()` 体积 | **1.49 MB**（2000 篇） |
| `fromHydratedState()` | **375 ms** |
| 空查询 `search('')` | `[]`（不抛错，也不返回全部） |

> 注：E-5 的「2000 次 IPC 读正文」**未计入** —— 那是 TODO-0 要裁决的事，
> 286 ms 只是**内存里建索引**的耗时，不代表端到端首屏成本。

---

## 真实风险（评审先看这几条）

| # | 风险 | 说明 | 缓解 |
| --- | --- | --- | --- |
| R-1 | **近三年未更新**（2023-07-21 最后一次 push） | 无维护，出问题要自己扛 | 锁版 1.8.1 + 零依赖，影响面可控；若有 bug 在 `src/upstream.js` 记明 |
| R-2 | **无中文分词** | 只做子串命中；`高数` 搜不到「高等数学」 | 本包**不宣称**分词；若将来要分词，应与 `dsh-radar-search-segment`（jieba-wasm）拼，而不是换引擎 |
| R-3 | **同分并列** | 见 E-4 | TODO-3 强制 tie-break；评审必须看到差分计数 |
| R-4 | **IPC 风暴** | 客户端建索引要逐篇 `notes('read')` | TODO-0 裁决：优先服务端建 |
| R-5 | 索引失效点有 **6 个**（write/create/remove/move/rename + 启动） | `id` 是内容哈希，改一个字就换 id | TODO-4：全量重建（286 ms 可接受），不落盘 |

---

## 与已有候选的关系（**不与已登记的重复**）

本仓已有 4 个检索方向的骨架/候选，**没有一个是「笔记正文全文索引」**：

| 已有 | 作用对象 | 与本包的关系 |
| --- | --- | --- |
| `dsh-radar-search-rank`（minisearch） | 「学习」页**单节课**的整理结果**重排** | 不重复：输入是已算好的命中集，本包是**从零建库级索引** |
| `dsh-radar-search-segment`（jieba-wasm） | 中文**分词** | **互补**：将来可拼成「jieba 切词 → 本包索引」 |
| `dsh-radar-note-search` / `dsh-radar-note-search-tokenizer` | 笔记**标题/路径** | 不重复：那两个也只看路径与标题，本包看**正文** |
| `dsh-radar-search-fuzzy` | 模糊匹配 | 不重复：上游模糊是 BK-tree 的 `distance` 策略，本骨架走 `searchPartial` |

> 为什么要单独开一个包：`search-rank` 的边界写死了「**只对页面算好的 hits 重排，不增删**」，
> 而本包面对的是**空索引**，两者接的不是同一个位置。硬塞进 `search-rank` 会同时破坏它的边界。

---

## 被否决的同类（本轮复核，维持原判）

| 仓库 | 为什么不用 |
| --- | --- |
| `nextapps-de/flexsearch` ★13,813 | **第 3 次复核维持 ⛔**：2026-10-26 已实跑 `0.8.212`，默认 `Index` 中文 0 命中、`tokenize:'full'` 才命中；换引擎会推翻在途的两条线，且中文不比 minisearch 好 |
| `tobi/qmd` ★30,712（MIT） | ★最高、方向最对，但 npm 依赖含 `node-llama-cpp`/`better-sqlite3`/`sqlite-vec` **原生模块 + 本地模型**，是 **CLI**，DSH 前端无法直用 → 只作路线参考，见本轮报告 |
| `s2b-dev/smart-second-brain` ★1,326（MIT） | **npm 404**（`@s2b-dev/smart-second-brain` 不存在），仓库 11.3 MB 且是 Obsidian 插件（依赖 `obsidian` 运行时）→ 不可锁版、形态不符 |
| `flowing-abyss/obsidian-hybrid-search` ★115（MIT） | 仓库 **51.5 MB**，含向量/SQLite；Obsidian 插件形态，抽取成本远高于收益 |

---

## 用法（评审通过**之后**）

```js
// 评审通过后由页面侧调用（本骨架不自行挂载）
import { SearchEngine } from 'clientside-search';
import en from 'clientside-search/en';

const engine = new SearchEngine(en);          // ← 必须传语言包，见 E-1
for (const note of notes) engine.addDocument(note.markdown, { index_title: note.title });
const hits = engine.search(query, 20);        // 分数同查询内 min-max，见 E-4
```

## 落点

评审通过的改造点在 **`packages/dsh-zhiyun-page-notes/src/client.jsx:123` 的 `buildRows()`**
（路径命中置顶、正文命中追加），以及**服务端**的索引建库位置（TODO-0 裁决）。
本骨架不改任何现有文件。
