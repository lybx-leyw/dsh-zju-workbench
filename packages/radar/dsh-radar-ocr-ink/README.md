# dsh-radar-ocr-ink —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-11-09 03:00 · r155 · **C 组**），
> **仅用于人工评审**。这不是一个可用插件：`src/index.js` 的 `apply()` 只打一行日志，
> `src/upstream.js` 的 `loadUpstream()` 永远返回 `{ ok: false }`，`dependencies` 是**空**的
> （原因见 §风险 R-0，不是漏写）。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。评审驳回则整目录删除。

---

## 集成类型

**强化式集成**（不是「全新功能」）。

一句话：**不是给工作台加一个 OCR 面板，而是给「笔记页」已有的「附件 + 全文检索」补上缺失的一档输入 ——
手写、截图、扫描件。「同附件、同检索」不变，「多一种能被检索的文字来源」是新增的底层。**

三条判据同时成立：

| 判据 | 本仓现状 | 接进来之后 |
| --- | --- | --- |
| ① **仍是同一个面板** | `packages/client/page-notes` 笔记页，左文件树 + 中编辑区 + 右反链 | **不变**。不新增页面、不新增侧栏 |
| ② **功能仍相似正交** | 附件区只放 `.pdf`；`pdf-viewer.js` 负责 PDF 渲染；正文进全文索引 | **不变**。附件区多接几类扩展名；索引链路不动 |
| ③ **底层多调了更优质实现** | **没有 OCR 层**（§空档核实） | 多一层「引擎可切换 + 文本层优先」的识别底层 |

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [jritzi/ocr-extractor](https://github.com/jritzi/ocr-extractor) |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id` = `MIT`；`LICENSE` 徽章指向根文件） |
| Stars | ★76 · fork — · `created 2025-09-05` · `pushed **2026-11-01**`（**已满 1 年、近 8 天有 push**，不是新建仓） |
| 形态 | **Obsidian 社区插件**（桌面端）。`main.js` + `manifest.json` + `styles.css` 三件套经 Release 分发 |
| 版本 | **无 git tag、未发 npm** ⇒ **锁版条件不成立** |
| 体积 | 仓库 ≈ 18.1 MB（主要是 demo.gif 与 release 产物，不是源码体量） |
| 能力 | 从「笔记里嵌入的 PDF / 文档 / 图片」抽文本；引擎可切（Tesseract 默认本地 / 其他云 OCR）；可**优先用 PDF 自带文本层**；结果落成附件下方的**可折叠 callout** ⇒ 能被 Obsidian 自带搜索与系统文件搜索命中 |

## 空档核实（为什么值得开骨架）

本仓笔记页的输入面，是**按扩展名硬编码**的：

| 位置 | 证据 | 含义 |
| --- | --- | --- |
| `packages/client/page-notes/src/client.jsx:1283` | `accept="application/pdf,.pdf"` | 文件选择器**只收 PDF** |
| `client.jsx:635` | `if (isPdfPath(path)) { … kind: 'pdf' … }` | 只有 `.pdf` 走 iframe 渲染分支 |
| `client.jsx:643` | 其余一律 `notes('read')` | 非 PDF 且非 md ⇒ **报「没有名为…的笔记」** |
| `grep -riE 'ocr\|handwrit\|手写\|pencil' packages/client/page-notes/src` | 0 命中（`pencil` 只是重命名图标的 name） | **OCR / 手写两条路都没有** |

配套事实：论文页、课堂上都**没有 OCR 入口**（`grep -riE 'ocr' page-paper/src page-classroom/src` = 0）。
既有 OCR 相关包（`dsh-radar-ocr-web` 等）都是**候选骨架**，一个都没落地 ⇒ **运行时 OCR 为零**。

> 所以「拍一张板书 / 手写一页纸 → 它进不了笔记页」不是认知偏差，是 `accept` 那行的直接后果。

## 不搬源码的理由

上游是 MIT，**可以**摘码。本骨架仍然不搬，理由是可移植性：

1. 它的执行主体是 `Plugin extends Obsidian.Plugin`，所有入口都挂在 Obsidian 的 ribbon / command palette 上；
2. 它的输出目标是 **Obsidian callout 语法**渲染在 vault 文件里；
3. 它读附件用的是 `app.vault.getResourcePath()` —— 本仓没有 vault 概念。

搬过来要改的三处，正好是它的全部骨架 ⇒ 搬完等于重写。**可迁移的是三条决策**（见 `src/index.js` 的 `BORROWED_CONTRACTS`）：

- **C-1 引擎可切换、默认本地**：默认云 OCR = 用户第一次点就外联；
- **C-2 文本层优先**：论文页已经把文本层解出来了，再 OCR 一遍是双重成本 + 双重误差；
- **C-3 结果写进正文**（不另建索引）：一份数据一条索引，旁挂索引会与正文索引互相漂移。

## 落地顺序（评审通过后）

1. **能力探测**：本机有哪些引擎可用（Tesseract / system OCR），产一张能力表。**不在此处下载任何模型。**
2. **单文件提取**：`ocr.extract(path, { engine })`，按 C-2 先查文本层。
3. **笔记页接入**：附件区放开图片扩展名；提取结果作为可折叠块追加（C-3），复用笔记现有写入通道，**不改 `pdf-viewer.js`**。
4. **降级**：引擎缺失 → **明确报错、不静默下载**（照 `core/classroom-media` 的 MinerU 三不口径：先验、缺则报错、不下载）。

## 风险

| 编号 | 风险 | 处置建议 |
| --- | --- | --- |
| **R-0** | **无版本可锁**。仓库无 tag、未发 npm ⇒ 写不出合法 `dependencies`。 | 本骨架 `dependencies: {}` 是**刻意的**。若要锁版，须先让上游打 tag，或由本仓 `packages/vendor/` 走 `clone → 删 .git → 入库`（与 `vendor/paper-reader` 同路径） |
| **R-1** | 引擎是**原生二进制**（Tesseract / system），不是 wasm。谁来装、装在哪、离线包多大都要拍板。 | 本仓**没有**静态资源管线（`dsh-radar-ocr-web` 的 R-1 撞的是同一堵墙）。建议先做「探测 + 报错」，把「安装」留给用户在设置页显式触发 |
| **R-2** | C-3 的写语义**会改用户 markdown 正文**。 | 必须是「追加可折叠块 + 幂等标记」，重复提取不叠加；评审需明确是否接受 |
| **R-3** | 手写识别质量与版面相关（竖排 / 公式 / 表格）。 | 先只承诺「印刷体截图、扫描件」；手写作为实验档，结果标 `confidence` |
| **R-4** | 隐私：笔记可能含个人信息，云 OCR 会把内容送出。 | C-1 已覆盖（默认本地）；云引擎必须**逐次显式确认**，不做「记住选择」 |

## 与既有骨架的边界

| 既有包 | 边界 |
| --- | --- |
| `dsh-radar-ocr-web` | 那条走 **wasm 浏览器 OCR（PP-OCRv5）**，目标是**习题**链路；本条走**原生引擎 + 文本层优先**，目标是**笔记附件**。二者引擎路线不同，评审时**不要合并成一个目录** |
| `dsh-radar-doc-parse` / `dsh-radar-markitdown-js` | 那是「文档 → markdown 结构」；本条只做「图 → 文本」，**不碰版面结构** |
| `dsh-radar-note-fulltext` / `dsh-radar-note-search` | 那两条是**索引与检索**；本条是**往正文里喂可检索文字**，不改索引实现 |

## 许可证与署名

上游 **MIT**，本骨架未复制任何上游源码（只迁移三条设计决策），因此 `ATTRIBUTION.md` 从略。
评审若改为「摘码移植」，**必须**补 `ATTRIBUTION.md`（照 CONTRIBUTING 3.3）。
