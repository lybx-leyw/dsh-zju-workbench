# dsh-radar-gbt7714-cite —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 与 `src/upstream.js` 只有占位与 TODO，
> `formatBibliography()` / `appendToBody()` / `createEngine()` / `parseBibtex()` /
> `renderBibliography()` 都直接抛错。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成性质：**强化式集成**（不是「全新」）

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| 仍是同一个面板 | ✅ | 落点是**既有**的「笔记」页正文编辑态（`dsh-zhiyun-page-notes/src/client.jsx` 的 `textarea`）与**既有**的 Markdown 阅读态（宿主 `MarkdownText`）。不新增页面、不新增导航项、不新增第二种编辑形态 |
| 功能相似且正交 | ✅ | 现有：**正文本身**（写什么、能不能被反链找到）。新增：**正文末尾那一串文献条目按国标排成什么样**。同一份文本、同一面板、不同问题 |
| 底层多调了更优质实现 | ✅（**带前提**） | 本仓 CSL 渲染与 BibTeX 解析**均为零**（见下「已核实的缺口」）。GB/T 7714-2015 的著录规则（类型标识 `[J]/[C]/[M]`、`et-al-min=4`、`[J/OL]` 载体标识、页码区间格式）全部落在 CSL 样式文件里，手写等于重写一个 CSL 子集。**前提**：`citeproc` 的 npm 许可是 `CPAL-1.0 OR AGPL-1.0`，须评审裁定（见「许可证」） |

## 已核实的缺口（本仓，`grep` 实测）

```text
grep -rniE "GB/?T ?7714|参考文献" packages/dsh-zhiyun-*/src   → 0 命中
grep -rniE "csl|citeproc" package.json apps/desktop/package.json → 0 命中
grep -rniE "citation" packages/dsh-zhiyun-*/src              → 只有页码引用
```

唯一叫「citation」的模块是 `dsh-zhiyun-page-paper/src/citations.js`，它做的事是
**把助手回答里的「第 12 页」改写成可点击的页码链接** —— 与「书目条目著录」是两件事。
`dsh-zhiyun-page-notes` 的正文编辑态是一个纯 `<textarea>`，阅读态是宿主的 Markdown 渲染器，
两者都**没有任何**文献能力。

## 上游

| 件 | 版本（锁死） | npm 许可 | 仓库 | 说明 |
| --- | --- | --- | --- | --- |
| `citeproc` | **2.4.63** | `CPAL-1.0 OR AGPL-1.0` ⚠ | `Juris-M/citeproc-js`（★367，NOASSERTION） | 单文件 967 KB，**零运行时依赖**，导出 `Engine`（**没有** `Cite`） |
| `@retorquere/bibtex-parser` | **13.0.11** | `ISC` ✅（GitHub `MIT`） | `retorquere/bibtex-parser`（★31，2026-11-02 推送） | WASM；Node 侧须 `init({ module_or_path })` 喂字节，默认 `fetch` 会失败 |
| GB/T 7714 样式 | `china-national-standard-gb-t-7714-2015-numeric.csl` | **CC BY-SA 3.0** | `citation-style-language/styles` | 15.5 KB；文件名**不是** `chinese-gb7714-2015-numeric.csl`（404） |
| 中文 locale | `locales-zh-CN.xml` | **CC BY-SA 3.0** | `citation-style-language/locales` | 18.6 KB |

## 许可证（**评审必须先裁定这一条**）

- `@retorquere/bibtex-parser` 系列 **ISC / MIT** ✅，无争议。
- `citeproc` npm 声明 **`CPAL-1.0 OR AGPL-1.0`**，两者都**不在**本任务的宽松白名单内。
  它与 `Juris-M/citeproc-js` 的 `NOASSERTION` 是**同一个成因**（双许可混合写法），
  历史上（2026-10-18、2026-10-27）两次被标 `⚠ 待核` / `⛔`。
- 因此本骨架**不是**「许可证已明确」的 🟢，而是 **🟡（需人工法务裁定）**：
  若裁定「`OR` 双许可可任选其一且 CPAL 的『Application』定义不覆盖本仓」→ 可继续；
  若否 → 本目录整删，**不得**为了「先把功能做出来」而摘码。
- **样式与 locale 是 CC BY-SA 3.0**：它们是**数据资源**不是代码，但分发时要
  保留原许可与出处（写进 `ATTRIBUTION.md`）。

## 本轮实跑（Node 22.13 + 上述三件套，除骨架外均已落地验证）

```text
ZH 4 作者 + 卷期页：
  [1]张三, 李四, 王五, 等. 基于深度学习的课堂注意力分析[J]. 计算机学报, 2023, 46(5): 1023-1038.
ZH + DOI：
  [1]张三, 李四, 王五, 等. 基于深度学习的课堂注意力分析[J/OL]. 计算机学报, 2023, 46(5): 1023-1038. DOI:10.11897/SP.J.1016.2023.01023.
EN book + edition：
  [1]KNUTH D E. The art of computer programming, volume 1[M]. 3 版. Addison-Wesley, 1997.
正文角标：
  <sup>[1–3]</sup>
```

### 接缝上的四个坑（都是实跑踩到的，不是推测）

1. **`type: 'article'` → `[A]`**。样式第 131 行注释写明「`article` 为预印本」，
   必须写 `article-journal`，否则整条变成 `[A/OL]//…` 形态，**且不报错**。
2. **`pages` 被解析器归一化成 `–`（en-dash）**，而样式声明
   `page-range-format="expanded"` 只认 `-`：不换会渲染成 `1023-1038 → 023-1038`。
   （第一版我用 `String.replace` 只替换首个匹配，`page-first` 同时被切坏，得到 `12`。）
3. **`Engine` 不是默认导出、也没有 `Cite`**；`updateItems()` 必须传**字符串 id**，
   传对象数组会得到 `"[object Object]"` 并在 `retrieveItem` 处静默取不到条目。
4. **`processCitationCluster(citation, pre, post)` 三个参数缺一不可**，
   只传两个会在 `citationsPost.length` 处崩。

## 未解的一条：中英混排的「等」

GB/T 7714-2015 数字型样式**固定输出「等」**，英文条目也写成：

```text
[1]LEE Z, SMITH J A, BROWN M, 等. Retrieval-augmented generation for course notes[J]. …
```

这不是实现 bug —— 样式第 433 行写着「取消这部分注释可以开启 CSL-M 的多语言功能」，
即作者**有意默认关闭**。本轮试过的路径与结果：

| 尝试 | 结果 |
| --- | --- |
| 给条目加 `language: 'en'` | 无效（仍是「等」） |
| `<bibliography default-locale="en">` | 无效 |
| `new Engine(sys, style, 'en-US')` 并同时提供 `en-US` locale | 无效（仍是「等」） |
| `<layout suffix="." locale="en">` | **citeproc-js 直接崩**（`Level mismatch`） |

结论：**不能靠改 CSL 属性解决**，要么在条目级用「两段 layout + `choose type/language`」
自己写一份样式（那就不是「调更优底层」而是「改写国标样式」），要么在渲染后做
**条目级后处理**（英文条目把「等」换成「et al.」，但作者缩写规则也要一并对齐）。
→ **这一条必须在评审时定调，否则接进去就是「中文论文里冒出一个『等』」的可见 bug。**

## 接入点（评审通过后才改）

`packages/dsh-zhiyun-page-notes/src/client.jsx`

- 正文编辑态是一个**受控** `<textarea>`（自动保存挂在 `onChange`）：写入必须走
  `value + input` 事件，**不要**直改 DOM 再绕过 React 状态；
- 新按钮与既有「编辑 / 阅读」开关同排，**不新开工具栏**；
- 不联网、不调模型，纯本地字符串操作（`citeproc` 是同步的）。

## 不做什么

- ❌ 不做 Zotero 式文献管理器（分类 / 标签 / 同步 / 引文键管理）
- ❌ 不接管「论文」页的助手回答（那里的「引用」是**页码引用**，另一件事）
- ❌ 不做 Word / LaTeX 的域代码注入（本仓不产出 `.docx`，也无 LaTeX 链路）
- ❌ 不改上游任何源码；样式与 locale 原样引用、原样署名
