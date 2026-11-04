# dsh-radar-notes-portable —— 候选骨架

> ## ⚠ 候选骨架：**未评审** · **未接入 profile** · **不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> `src/index.js` 与 `src/upstream.js` 里的函数**一律抛错** —— 这是故意的，
> 避免「看起来能跑」的骨架被误用。评审通过才可实现；驳回则整目录删除。

---

## 零、一句话

「笔记」页**已经能**把一节笔记导出成 Markdown（`core-notes` 的 `exportMarkdown()`），
本包要做的是在它后面**再接一步**：转成**一个可离线打开、公式不糊、代码带色**的 HTML 文件。
**面板还是那个面板，功能还是导出，只是底层换成了真正的渲染器。**

## 一、类型与关系

| 项 | 值 |
| --- | --- |
| 类型 | **B · 其他 JS 项目**（`marked` / `highlight.js` 都没有 `dsh.bundle.patch`，不是 DSH 插件） |
| 与现有功能的关系 | **重复且可强化** → **强化式集成**（不是「全新」） |
| 上游 1 | [`markedjs/marked`](https://github.com/markedjs/marked) **`18.1.3`**（MIT，锁版） |
| 上游 2 | [`highlightjs/highlight.js`](https://github.com/highlightjs/highlight.js) **`11.12.0`**（BSD-3-Clause，锁版） |
| 数学 | **不新增依赖**：宿主 `MarkdownText` 已内置 KaTeX（见 §二），导出层复用同一个 `katex@0.16.x` |
| 首次发现 | 2026-11-05（A 组 · DSH 插件生态 · 「带走」轴） |

### 强化式集成三条判据

| 判据 | 是否成立 | 依据（都能在源码里指到） |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 不新增页面/导航/路由。挂载点是笔记页已有的导出动作，`exportMarkdown()` 本身不改。 |
| ② 功能仍相似正交 | ✅ **（带许可前提）** | 仍是「把这一节笔记带走」。**前提**：单文件 HTML 里内联的 KaTeX 字体必须附 OFL 声明（§五），否则违反「不搬运上游源码」的精神。 |
| ③ 底层多调了更优质实现 | ✅ | 现状只到 `{markdown, files}` 为止，**没有任何渲染器**（`marked`/`remark`/`markdown-it`/`mdast` 在本仓 `package.json` 里命中 0）。 |

> 判据③的准确说法：不是「有导出但不好」，而是「**导出停在裸 md**」。
> 附件 `files` 交给调用方去读，**由它自己决定怎么处理** —— 目前没有调用方处理成可读文档。

## 二、本仓现状（2026-11-05 实测）

| 能力 | 本仓现状 | 位置 |
| --- | --- | --- |
| 导出 markdown 正文 | ✅ 有 `exportMarkdown()`，含两条改写 + 附件 id→路径映射 | `packages/dsh-zhiyun-core-notes/src/store.js:447-465` |
| 附件改名（`p.basename` 语义） | ✅ `exportFileName()` | 同文件 `:513` |
| md → HTML | ❌ **无** | `grep -E "marked\|remark\|markdown-it"` 在 `packages/*/package.json` **0 命中** |
| md → docx / pdf | ❌ **无** | `grep -rn "\.docx\|toPdf\|pandoc\|libreoffice"` 在 `packages/*/src/*.js` **0 命中** |
| 笔记正文的渲染 | ✅ 阅读态用宿主 `<MarkdownText text={draft} />` | `packages/dsh-zhiyun-page-notes/src/client.jsx:1415` |
| 宿主 `MarkdownText` 的数学能力 | ✅ 已接 KaTeX（`renderTexToReact` → `katex.renderToString`），自带 `katex.min.css`，原生支持四种分隔符 | `packages/dsh-zhiyun-page-quiz/src/question-bank.jsx:33-46` 的注释即为本仓自己的结论 |
| 单文件 HTML 导出（课堂侧） | ✅ **已有**，含 CSP 契约与 KaTeX 字体挂载点 | `packages/dsh-zhiyun-core-classroom-export/src/standalone/contract.js:15-38`（`mathFonts` 指向 `katex-fonts.min.css`） |

**最后一行是本包最重要的「已有零件」**：课堂导出那条链路已经把
「单文件 HTML + 内联 KaTeX 字体 + CSP」跑通了。本包**不重新发明**，
而是复用 `contract.js` 的 CSP 口径与 `sanitize.js:110` 的 KaTeX 白名单，
把它接到笔记侧 —— 这是「同一个仓库里两套导出不该长得不一样」的必然要求。

## 三、沙箱实测（2026-11-05，可原样复跑）

`npm i marked@18.1.3 highlight.js@11.12.0 katex@0.16.25` 后 `node` 实跑：

| # | 断言 | 结果 |
| --- | --- | --- |
| M1 | marked 内置 `gfm` 表格 | ✅ `<table>` |
| M2 | 任务列表 `- [x]` | ✅ `type="checkbox"` |
| M3 | 围栏代码 + `highlight.js` 词法着色 | ✅ `hljs-*` 类名 |
| M4 | 注册 `$…$` 自定义 extension 后，**行内 `$$E=mc^2$$` 会被吞到下一个 `$$`** | ⚠ **失败** → 红字 `katex-error`，整段中文被塞进数学模式 |
| M5 | 改成「先保护、后解析、再还原」 | ✅ 2 个公式全部渲染，0 错误 |
| M6 | 「价格 **$5** 和 **$6**」不被配对成公式（负向后行断言排除数字） | ✅ 原样保留 |
| M7 | 代码块内 `const price = "$100"` 不被当公式 | ✅ 原样保留（围栏先摘出是关键） |
| M8 | 块级公式**不被 `<p>` 包裹**（否则 `<div>` 在 `<p>` 内是非法嵌套） | ✅ 第一版失败，按「整段 `<p>` 一并替换」修正后通过 |
| M9 | `katex.min.css` 引用字体数 / 体积 | 60 个文件 / **1.03 MB**，base64 后 **≈1.37 MB** |

> **M4、M8 是本轮两条净值最高的校准** —— 它们说明「marked 扩展 + KaTeX」
> 这条看起来最直觉的路在**中文 + 行内 `$$`** 的笔记里会直接坏掉，
> 且坏得很安静（红字而不是报错）。

## 四、必须先解决的三个缺口（不解决就不能合入）

1. **体积**：单文件 HTML 内联 KaTeX 全套字体 ≈ **1.4 MB / 份**。若一个学期 30 节笔记全导出
   ≈ 42 MB。**建议**：只内联 woff2 一档（≈ 1/3）；或对「无公式的笔记」走「不内联字体」分支
   —— 这需要一个**能看出有没有公式**的判定，正好是 M5 的保护层顺手能给出的。
2. **图片**：`exportMarkdown()` 交回的 `files` 是「附件 id → 文件路径」，**本包不碰文件系统**。
   内联成 `data:` 需要调用方读字节；外链会导致换个机器就打不开。**建议**：评审时先定「内联上限（如 20 MB）」。
3. **CSP 与离线**：课堂侧的 `STANDALONE_HTML_CSP` 是 `default-src 'none'` 的白名单口径。
   笔记侧若也用同一口径，**KaTeX 的 `<style>` 与 data: 字体必须显式放行**，
   否则离线打开是一堆乱排的公式（不报错、只是难看）。

## 五、许可

| 组件 | 许可证 | 备注 |
| --- | --- | --- |
| `marked@18.1.3` | **MIT** ✅ | 代码可随包分发，需保留版权声明 |
| `highlight.js@11.12.0` | **BSD-3-Clause** ✅ | 同上 |
| `katex`（复用宿主，不新增依赖） | **MIT** ✅（**代码**） | ⚠ **字体另议**：`katex/fonts/` 走 **SIL Open Font License 1.1**。内联 base64 字体即构成再分发 → **必须附 OFL 全文与版权行**。这是判据②的许可前提。 |

**不输入、不落盘**：本包不读写任何远端服务，也不做遥测。

## 六、下一步（给评审人）

1. 先定 §五的 **OFL 声明放哪里**（`<meta name="license">` 还是文末注释）—— 这一步不定，后面的体积与 CSP 都白做。
2. 再定 §四-1 的体积策略（woff2 only / 无公式不内联）。
3. 三条都定了，才把 `src/upstream.js` 里的伪代码落到真实实现；
   `src/index.js` 的 `apply()` **仍然不注册插槽**，等页面侧给出导出动作的插槽名再说。
