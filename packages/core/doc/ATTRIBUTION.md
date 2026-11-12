# ATTRIBUTION — @lybx-leyw/dsh-zju-core-doc

本包是 [dsh-zju-assistant](https://github.com/Anchorite-no/dsh-zju-assistant) 的
`core/zju/lib/doc/` 模块的移植。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/Anchorite-no/dsh-zju-assistant |
| 上游路径 | `core/zju/lib/doc/`（`index.ts` / `pdf.ts` / `office.ts` / `sniff.ts` / `cli.ts`） |
| 许可证 | **GPL-3.0-only**（`packages/vendor/zju-assistant/LICENSE` 实文已核，35,149 B） |
| 本地位置 | `packages/vendor/zju-assistant/`（只读参考，不在 workspaces 里） |
| 本仓协议 | GPL-3.0-or-later —— 与上游兼容 |

## 用了什么

| 本包文件 | 上游来源 | 改动 |
| --- | --- | --- |
| `src/sniff.js` | `sniff.ts` 全文 | **重写**（TypeScript → JSDoc ESM）；保留全部判据：文件头优先、OOXML 家族靠 zip 尾部目录的明文名字区分、OLE 魔数按 `OLE_FAMILY` 归到老格式、无扩展名时看内容像不像 HTML/JPEG/PNG。错误从 `ConfigError` 换成带稳定 `code` 的 `DocError` |
| `src/pdf.js` | `pdf.ts` 的 `pdfTexts` / `findInPdf` / `parsePageRule` / `extractPages` / `combinePdf` / `addImage` | **部分重写**。取字改为**逐页** `getTextContent()`（上游同样逐页），但去掉了 `sharp` 这条依赖：图片不重编码，EXIF 旋转直接读 APP1 并换算成 pdf-lib 的旋转参数（`readJpegOrientation` / `quarterTurnsOf` / `placeRotated`）。`parsePageRule`、`findInPdf`、`extractPages` 的判据与报错文案逐条对齐。`combinePdf` 的 `size`（`a4` / `original`）与 100 dpi 换算取自上游 |
| `src/office.js` | `office.ts` + `index.ts` 的 `extract()` | **重新实现**。上游把 Office 文件交给 `@deepseek-ai/libreoffice-kit`；那个包不在本仓依赖里，所以新增了一条**直接读 OOXML / ODF 的 XML** 的路径，并在装了引擎时自动切回上游那条路（`loadOfficeEngine`）。`convertWithEngine` 的「先拷进临时目录、换成引擎认识的名字」与 `engineExt` 映射照上游 |
| `src/text.js` | `index.ts` 的 `extractFile` / `extract` / `htmlText` / `readText` / `markdown` / `outputDir` | **重写**。`INLINE_CHARS = 20000`、`MAX_TEXT = 16 MiB`、状态枚举（`text` / `no_text` / `unsupported` / `error`→抛错）、Markdown 的标题规则（多页或有 title 才加 `## `）逐条保留。HTML 正文由 `parse5` 换成本文件内的极简扫描器（不新增依赖），块级标签与表格 `|` 分隔的规则一致。编码探测保留 UTF-8 → GB18030 的顺序 |
| `src/zip.js` | 无（上游用 `pdf-lib` 之外没有 zip 依赖） | **本仓新增**，但算法与 `core/classroom-media/src/pdf/zip.js` 同源（只读中央目录 + `node:zlib` 的 `inflateRawSync`），本包按「惰性解压 + 条目上限」重写 |
| `src/errors.js` | `core/errors.ts` 的 `BadResponse` / `ConfigError` / `ZjuError` | **替换**成本包的 `DocError` + 五个稳定 code（见 README）。理由：本包的失败面是「文件/格式/落盘」，与上游那套校园 HTTP 错误分类不是同一组 |
| `src/index.js` | `index.ts` 的 `extractFile` / `toPdf` / `pdfPages` / `pdfFind` 四个导出 | **重写为 Cordis 服务**：输出目录改为外部注入（`config.outputDir` → `<profile>/data/doc`），`outputFile()` 的「不覆盖已有文件」保留，默认名撞车时改为自动挪成 `(2)`（上游是直接报错）。`extractUrl` / `download` / `filenameOf` **未移植**（见 README「没做的部分」） |

## 没搬的部分

- `extractUrl` / `download` / `filenameOf`：要走 WebVPN 与教务网会话，属于
  `source/webvpn` / `source/zdbk`。`core/doc` 没有网络出口。
- `module.json` 的 `provides` / `localDependencies` 清单：本仓用 `package.json` 的
  `dsh.capability` 与依赖表代替（`tests/source-capability.test.mjs` 守着那一层）。
- CLI 包装（`cli.ts`）：本仓的入口是 agent 工具（`packages/tool/doc`），不是命令行。

## 算法出处（不是代码搬运）

`parsePageRule` 的「越界/倒序/写错一律报错」、`findInPdf` 的「每页前 30 / 后 60 字符
作为上下文」、`combinePdf` 的「A4 取 300 dpi 上限、原图按 100 dpi」这三个数值与判据
来自上游，属**移植**而非独立设计。数值本身不受版权保护，但来源如实记在这里。
