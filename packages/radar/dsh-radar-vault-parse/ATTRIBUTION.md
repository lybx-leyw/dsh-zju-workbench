# 借鉴声明

本包（`dsh-radar-vault-parse`）为**候选骨架**，尚未包含任何上游代码。
以下声明按 `CONTRIBUTING.md` 第 3.3 条记录**借鉴来源**，供人工评审时核对。

## 借鉴对象

| 项 | 值 |
| --- | --- |
| 仓库 | [markdown-it/markdown-it](https://github.com/markdown-it/markdown-it) |
| 作者 | markdown-it contributors |
| 许可证 | **MIT** |
| 许可证文件 | `LICENSE`（仓库根目录，直读核实） |
| 借鉴范围 | **仅「用 token 判定块级/行内上下文」这一设计**（`token.map` 行号 + `code_block`/`fence`/`html_block` 分类），**非代码** |
| 使用方式 | 计划按第 3.3 条末句「第三方库通过 `package.json` 正常引入并按原协议使用」——即**锁版 npm 依赖**，不搬运源码 |

## 借鉴的性质

- **未复制**上游任何源代码、测试用例或资源文件。
- 本包只写**适配层**：把 `markdown-it` 的 token 树翻成本仓既有的区间表形状
  （`[[start, end], …]`，半开、按原文下标）。
- 若后续实现中**摘取任何上游代码**（例如直接改写其 linkify 规则），
  必须在此处逐文件列明来源路径与提交号，并保留 MIT 许可与版权声明。

## 与本仓既有实现对读的部分

实现 `excludedRanges()` 之前，已**逐行走读**本仓
`packages/dsh-zhiyun-vault/src/parse/links.js`（`CODE_FENCE_RE` / `INLINE_CODE_RE` /
`INLINE_MATH_RE` / `URL_RE` / `ATX_HEADING_RE` / `mergeRanges` / `parseNoteLinks`）
与 `packages/dsh-zhiyun-page-paper/src/citations.js`（`protectedRanges` / `linkLine` /
`linkCitations`），用于确认「哪些上下文已经处理、哪些没有」。
这两份是本仓内部代码，不涉及第三方授权。
