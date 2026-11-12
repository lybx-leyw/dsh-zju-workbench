# @lybx-leyw/dsh-zju-core-doc

文档转文字与 PDF 处理。四条能力对应上游 `core/zju/lib/doc` 的四条 provides：

| 上游 provides | 本包方法 | 做什么 |
|---|---|---|
| `doc text` | `ctx.zhiyunDoc.text(file)` | PDF / Word / Excel / PPT / HTML / 纯文本 → 文字（按页给出），全文另存 Markdown |
| `doc pdf` | `ctx.zhiyunDoc.pdf(files, opts)` | 图片、PDF、Office 文档按顺序合成一个 PDF |
| `doc pages` | `ctx.zhiyunDoc.pages(file, rule, opts)` | 从 PDF 取出指定页另存 |
| `doc find` | `ctx.zhiyunDoc.find(file, keywords)` | 找关键词在 PDF 的哪几页，每页附上下文 |

模型侧的入口是 `@lybx-leyw/dsh-zju-tool-doc` 的 `campus_doc`（一条工具收 `action`）。

## 为什么放在 `core/`，不放在 `source/`

这是 `abandoned.md` 的 **Q-1**（「`doc` 归属未裁决」）与 `coverage-gaps.md` 的 **Z-2**。
本包选 `packages/core/doc/`，理由三条：

1. **它不连外部站点。** `source/*` 的定义是「外部站点的平台接口 + 出口（网络 / VPN /
   凭据）」。`doc` 的输入就是本机文件，`sniff()` 之后没有任何网络调用。放进 `source/`
   会让 `dsh.capability.network` 这个字段立刻失真 —— 而 `tests/repo/source-capability`
   正是靠那个字段守住分层。
2. **它做的是「变换 + 落盘」。** 取字、切页、合成、按关键词定位，全部是纯变换；
   唯一的副作用是往**调用方给的目录**写一个 PDF 或一份 Markdown。本仓的 `core/*`
   就是这个形状（`card`-外的 `core/parser`、`core/classroom-export` 都是变换层）。
3. **D21 的「下载执行归 core、source 只给参数」在这里并没有冲突 —— 它不适用。**
   D21 管的是「谁去下载」。`doc` 没有任何下载动作：`doc text --url` 那条路是上游
   为了省一步手工下载才有的，它要 WebVPN 会话与教务网附件登录，属于 `source/webvpn`
   与 `source/zdbk` 的职责。本包**明确不接 `url`**，`extractUrl` 那条路留给将来
   一个真正能取会话的装配方（见下面「没做的部分」）。所以 Q-1 卡住的那一半
   —— 「连外部的部分归谁」—— 在这里被**切掉**了，剩下的一半确实是 core。

结论：`doc` 是一个**没有任何网络出口**的领域变换服务，`core/doc` 是它唯一自洽的落点。
`source/` 不该收它，`tool/` 只该收它的工具面（已单独建包）。

## 依赖

| 依赖 | 用途 | 为什么是它 |
|---|---|---|
| `pdfjs-dist`（`legacy/build/pdf.mjs`） | 逐页取 PDF 文字层 | 已随 `core/vault` 装进依赖图；`unpdf` 也基于同一份 pdf.js。用 `legacy` 构建是因为它是 ESM 且不依赖 `canvas` |
| `pdf-lib` | 合成、取页、图片页 | 纯 JS，`copyPages` 只带走被引用的字体与图片 |
| `@deepseek-ai/libreoffice-kit` | **可选**，Word 老格式与「Word → PDF」 | 桌面端自带；本仓 `node_modules` 里没有。见下节 |

**没有新增任何依赖。** Word / Excel / PPT 的文字走的是「直接读 OOXML / ODF 里的
XML」，不需要 `mammoth` / `xlsx` / `officegen` / LibreOffice。

## Word / Excel / PPT 怎么取字（与上游的差异，必须明说）

上游把这三类交给 `@deepseek-ai/libreoffice-kit`（DSH 桌面端的无头 LibreOffice）
转成 PDF 或纯文本。那个包**不在本仓依赖里**（实测 `MODULE_NOT_FOUND`），而本轮的
约束是「要装新依赖就停下来报告」。

所以本包走两条路，**运行时自动选**：

1. **有引擎**（桌面端装了 libreoffice-kit）：与上游完全一致 —— Word 导出纯文本
   （不按版面断行，最干净），表格与演示先转 PDF 再逐页取字（页是准确的）。
   结果里 `convertedVia: 'libreoffice'`。
2. **没引擎**（本仓当前）：直接读 zip 里的 XML。结果里 `convertedVia: 'ooxml'`（Office
   Open XML）或 `'odf'`（OpenDocument）。

第 2 条能做到什么、做不到什么：

| 能做 | 说明 |
|---|---|
| 段落与表格 | 段落换行；表格行内单元格用制表符分隔（与 LibreOffice 导出纯文本的形态一致） |
| 共享字符串 | `.xlsx` 的单元格默认只存索引，本包读 `sharedStrings.xml` 解回来，并**保留空列位置**（否则列会错位） |
| 工作表 / 幻灯片分页 | 一张工作表 / 一张幻灯片算一页，`title` 是工作表名 |
| 幻灯片顺序 | 按 `ppt/presentation.xml` 的 `sldIdLst`，**不按文件名数字**（`slide10` 会排在 `slide2` 前面） |
| 修订删除 | `w:delText` / `w:del` 里的旧文字被跳过，正文里不会出现两份 |

| 做不到 | 那需要什么 |
|---|---|
| 97-2003 老式二进制（`.doc` / `.xls` / `.ppt` / `.wps` / `.et` / `.dps`） | 解析 OLE 复合文档 + 各代格式。**明确报 `UNSUPPORTED` 并提示另存**，不猜 |
| Word 的页边界 | `w:lastRenderedPageBreak` 取决于「上次是谁排的版」，用它会让同一份文件的页数随机器变。所以 Word 一律按**一页**报，页的概念交给 PDF |
| 版面、图片、脚注、批注、公式 | 那是「还原文档」，不是「取文字」。要看版面的场合应当用引擎转 PDF，或把页面渲染成图 |
| 合并单元格的语义 | ODF 的 `number-columns-spanned` 展开为空单元格（列位置对，但「跨了几列」这个信息丢了） |

> 这是一处**已知的能力差**，不是遗漏：在装了引擎的桌面端会自动用回上游那条路。

## 返回形状

四条方法的返回值与上游 `index.ts` 的字段一一对应。

### `text(file, opts?)`

```js
{ file, format, declaredFormat?, status: 'text' | 'no_text' | 'unsupported',
  pageCount, chars, convertedVia?, reason?, markdown?, text?, truncated?, note? }
```

- `status` 是**正常结果**，不是错误：扫描件是 `no_text`，老格式是 `unsupported`。
  只有「文件不存在 / 空文件 / 损坏 / 超限」才抛 `DocError`。
- `text` 只内联**前 20 000 字**，全文在 `markdown` 指向的文件里 —— 300 页教材塞进上下文
  会把模型挤爆，而上游的做法正是这个。
- `declaredFormat` 只在**扩展名与真实格式不符**时出现（学校服务器给错扩展名是常态）。

### `pdf(files, { size, out, name }?)`

```js
{ file, pages, bytes, inputs: [{ file, kind: 'pdf'|'image'|'word'|'excel'|'ppt', pages }] }
```

- `size`：`a4`（默认，图片等比缩放后居中放在 A4 白页上）或 `original`（100 dpi 算实际尺寸，小图不放大）。
- 图片只收 JPEG / PNG。**不重编码**：截图里的字不会因为再压一遍 JPEG 而糊掉。
  EXIF 的旋转（1/3/6/8）会按 90° 的倍数应用；**镜像（2/4/5/7）不做** —— 那要求真的
  翻转像素，本仓没有图像解码链。镜像的图仍会正常出现，只是保持文件里的样子。
- 输出**不覆盖**已有文件：显式 `out` 已存在就报错；默认名字撞了就自动挪成 `(2)`。

### `pages(file, rule, opts?)`

```js
{ file, pages: number[], totalPages, bytes }
```

`rule` 形如 `43-49,390-391`。越界、倒序、写错一律报错 —— 切错页的代价是用户拿到
一份「看起来对、内容不对」的 PDF，那种错误没人会发现。

### `find(file, keywords)`

```js
{ totalPages, textPages, matches: { [keyword]: [{ page, snippet }] } }
```

页码从 1 起。匹配是**区分大小写的精确子串**（与上游一致）：中文没有大小写问题，而
英文里 `Heap` 在标题、`heap` 在正文，混在一起会让「命中」失去意义。

## 错误码

`DocError.code`：

| code | 谁的问题 | 该怎么办 |
|---|---|---|
| `INPUT` | 入参不对（文件不存在、页越界、关键词为空） | 改参数 |
| `UNSUPPORTED` | 这个格式本机读不了（老式 .doc、RTF、Word 合成需要引擎） | 换格式另存 |
| `READ_FAILED` | 文件在、但解析失败（损坏、加密） | 换文件 |
| `CONFIG` | 没有输出目录 / 同名文件太多 | 补配置 |
| `TOO_LARGE` | 提取量超上限 | 拆分文件 |

## 输出目录与 `inject`

本包**不自己决定落盘位置**：`config.outputDir` → `<profile>/data/doc`；两者都没有时
`apply()` 抛 `CONFIG` 而不激活。理由是没有目录就只能把全文塞进上下文，而那对
300 页的文档等于不可用；静默退回内存则等于「这次能看、下次就没了」。

所以 `inject` 里只有一项 —— `profileContext`。它在不在 inject 里不是风格问题：
Cordis 里没写进 inject 的服务，直读会**抛** `cannot get property ... without inject`
（不是 `undefined`），所以「不声明、用时判空」这条路走不通。声明它的代价是
「没有 profile 目录的宿主里不激活」，而这个代价本包可以接受：产物本来就只能落在
profile 里。`tools` / `approval` / `storageDomain` 都不需要（工具面在 `tool/doc`，
审批不适用，落盘是本包自己写文件）。

## 验证

```bash
node --test tests/core/doc/doc-core.test.mjs
node --test tests/tool/doc/doc-tool.test.mjs
```

用例全离线，素材现场生成（PDF 用 `pdf-lib`、docx/xlsx/pptx 用 `zip()` 拼最小 OOXML、
PNG 用 `node:zlib`）。反证记录见 [PROOF.md](PROOF.md)。

## 没做的部分（如实列）

1. **`doc text` 的 `--url` 分支。** 上游能按链接取字：校内与 CC98 走 WebVPN、教务网附件
   用教务网会话。那是 `source/webvpn` + `source/zdbk` 的职责，本包**没有网络出口**，
   所以工具层也没有 `url` 参数。要补时，装配方应当是 `source/http` 或一个 core 的
   下载执行方（D21 / Q-5），而不是在 `core/doc` 里开一条取会话的路。
2. **老式二进制格式**（`.doc` / `.xls` / `.ppt` / `.wps` / `.et` / `.dps`）。需要
   LibreOffice 引擎或一个 OLE 解析器。本机没有引擎，所以如实报 `UNSUPPORTED`。
3. **OCR。** 扫描件返回 `no_text`，要「看图」是模型自己的能力，不是这条链路。
4. **`.ods` / `.odp` 的按表/按页拆分。** 三种 ODF 共用 `content.xml`，其中表与页没有
   清晰分层，所以本包按一个文件一页报（结构差异留在文字里的制表符与空行上）。
