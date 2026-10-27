# dsh-radar-vault-parse

> ## ⚠️ 候选骨架：**未评审、未接入 profile、不可直接使用**
>
> 本包由「生态雷达」自动生成，只是一份**待人工审查的骨架**。
> 它**没有**被写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，
> 因此**不会**在运行时挂载。`src/index.js` 与 `src/upstream.js` 只有占位与 TODO，
> 调用即抛错 —— 这是故意的，避免「看起来能跑」的骨架被误用。

## 集成类型：**强化式集成**（同一个面板 · 相似正交 · 底层换更优实现）

| 项 | 值 |
| --- | --- |
| 与现有功能的关系 | **重复且可强化**（不是全新功能） |
| 强化的是谁 | ①「笔记」页右栏 `NoteRelations` 的 `[[双链]]`/`#标签` 预览<br>②「论文」页 `citations.js` 的「第 N 页」引用改写 |
| 是否新增页面 / 导航项 / RPC | **全部否** |
| 判据 ③（底层更优） | ✅ **成立** —— 见下方对照表，每一条都能在源码里指到行 |

### 它替掉的是什么，凭什么说「更优」

本仓现在有两处**用正则估算「哪一段是代码」**的代码：

| 位置 | 现在怎么判 | 漏掉的情形 |
| --- | --- | --- |
| `dsh-zhiyun-vault/src/parse/links.js` `excludedRanges()` | 1 条围栏正则 + 行内代码 + 行内数学 + URL | **缩进式代码块**、**setext 标题**、**HTML 块** |
| `dsh-zhiyun-page-paper/src/citations.js` `protectedRanges()` | 只处理**行内**反引号与已有链接（单行） | 围栏由其外层 `linkCitations` 按行跳过；**缩进代码 / HTML 块**仍会漏 |

漏掉的后果不是「不好看」，是**错**：

- 笔记里写一段示例 `[[另一篇笔记]]`（放在 4 空格缩进的代码块里）→ 右栏「指向」多一条
  不存在的链接，用户点开才发现是空的；图谱（`dsh-radar-note-graph`）里多一个不存在节点。
- 回答里贴一段缩进代码，里面有「第 3 页」→ 变成可点链接，点了跳到 PDF 第 3 页。
- ⚠ 注意区分**两处**的实现：`vault` 侧已排除围栏 / 行内代码，**只缺**缩进代码、setext
  标题、HTML 块；而「笔记」页右栏 `NoteRelations` 是**另一份更粗的正则**
  （`page-notes/src/client.jsx` L220 起，连围栏都没排除）。两者都要换，但**收益来源不同**。

上游 `markdown-it` 是 **CommonMark 规范级**的 token 化解析器，上面这些都不是特例而是
一级语法；它把这些判定做成了 `token.map` 与 `code_block` / `fence` / `html_block` /
`heading_open` 等 token 类型，**结构上就不可能漏**。

### 三条判据逐条对照

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 不新增页面/导航/路由/RPC，只换右栏与引用改写的**判定函数** |
| ② 功能仍相似正交 | ✅ | 仍是「这个 `[[x]]` / `#x` / `第 N 页` 算不算链接」，不多做检索、编辑、渲染 |
| ③ 底层多调了更优质实现 | ✅ | 见上表：从「正则近似」换成「CommonMark token 判定」 |

> 与 `dsh-radar-note-graph`（昨日骨架）的区别：那条是「**无 → 有**」，按「全新」登记；
> 这条是「**有 → 更准**」，才符合强化式集成。雷达不把两者混为一谈。

## 许可证

| 组件 | 版本（锁版） | 许可证 | 依据 |
| --- | --- | --- | --- |
| `markdown-it` | `14.1.0` | **MIT** ✅ | 上游仓库根 `LICENSE`（直读，非 API 推测） |

依赖树（`package.json` 实核）：`argparse` / `entities` / `linkify-it` / `mdurl` /
`punycode.js` / `uc.micro` —— 全部 MIT 或同族宽松，**全部零原生依赖、无构建步骤**，
不触发「装个包就要编译」的那类成本。

## 上游与作者

| 项 | 值 |
| --- | --- |
| 上游 | <https://github.com/markdown-it/markdown-it> |
| npm | `markdown-it@14.1.0` |
| 作者 | markdown-it contributors（Vitp / Vitaly Puzrin 等） |
| 集成方式 | **锁版 npm 依赖 + 能力提取**（B 类）。不搬运上游源码、不改上游文件；本包只写**适配层**（区间表转换）。 |

## 落地方式（评审通过后）

1. **推荐走纯库包**：删掉 `cordis.patch.yml` 与 package.json 的 `dsh.bundle`，
   让 `page-notes` / `page-paper` 直接 `import`。理由见 `src/index.js` TODO 1。
2. 实现 `excludedRanges()` 的 token 版，**与现有实现做双实现差分**：
   本仓已有链接解析用例，逐条跑，差异必须为零才允许切换。
3. 先只接「笔记」页右栏（风险最低、用户可见收益最直接），观察一周再接「论文」页。

## 验收线（评审请按这四条判「接得对不对」）

1. **同源同口径**：右栏「指向」列出的每个目标，只要不是「本文内跳转」（`[[#小节]]`），
   就必须能在 `vault.invoke('notes')` 的节点 id 里解析到；解析不到、又不是
   `describe().unresolvedCount` 计过的那几条，即为错。
   —— **不能**写成「右栏条数 == 某个计数」：`describe()` 只给 `noteCount / tagCount /
   `unresolvedCount / orphanCount / edgeCount`（`host.js` L94–102），**没有**「链接总数」，
   不要为此新增 RPC 字段（那属于扩大范围）。
2. **差分零差异**：`tests/vault.test.mjs`（342 行，含「代码块与行内代码里的 `[[x]]` 不是链接」
   「代码块未闭合时其后内容仍在代码块内」「URL 里的 `#` 不产生假标签」）全部通过。
3. **降级不报错**：人为让解析抛错，右栏回落旧实现、不白屏。
4. **不卡**：10 万字笔记，按键后右栏更新 < 16ms（否则 debounce）。

## 不做的事（防止范围蔓延）

1. **不做渲染**。不产出 HTML、不替换 `MarkdownText` —— 那是宿主的职责。
2. **不做第二份语义真源**。`[[a#b|c]]` 里谁是目标，仍归 `vault#splitWikilink()`。
3. **不顺手改「反馈」页**（`page-feedback/client.jsx` 也有一份 `MARKDOWN_LABELS`）：
   它渲染的是用户评论，改判定没有收益，只增风险。

## 需人工裁定

1. **是否值得为两处调用引入一棵 6 包的依赖树？** 反方观点：把 `excludedRanges` 的正则
   补上「缩进代码 + setext + HTML 块」三条，成本可能低于接库。**这是本候选唯一真正的
   分歧点**，请评审先回答它。
2. 若走「纯库包」，本包的 `cordis.patch.yml` 应从骨架里删除（现在保留是因为
   决议之前不该替评审做决定）。
3. `citations.js` 的 `protectedRanges` 改签名是**破坏性变更**，调用方是否只有一处，需核。
