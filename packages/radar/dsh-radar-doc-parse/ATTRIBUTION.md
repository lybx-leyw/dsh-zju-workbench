# ATTRIBUTION

本骨架**未复制上游任何源码**。以下记录的是「能力来源」与「选型情报来源」，供评审追溯。

## 能力来源

| 项 | 值 |
| --- | --- |
| 上游项目 | `taxueseek/dsh-files` |
| 上游地址 | https://github.com/taxueseek/dsh-files |
| 上游版本（阅读时） | 0.7.0 |
| 许可证 | MIT（`Copyright (c) 2026 taxueseek`） |
| 使用方式 | **仅借鉴能力边界与底层库选型**；不复制代码、不挂载其客户端、不采用其附件坞 UI |
| 阅读过的文件 | `package.json`、`LICENSE`、`cordis.patch.yml`、`src/parse/docx.ts`、`src/parse/xlsx.ts` |

## 选型情报

1. **`read-excel-file` 替代 `xlsx`** —— 上游 `src/parse/xlsx.ts` 首段注释原文：
   > *"XLSX cell text extraction via read-excel-file (read-only parser, no known advisories — replaces `xlsx@0.18.5` which carries prototype-pollution CVEs)."*

   这条结论是**事实性技术情报**（关于第三方库的已知漏洞），不是代码。本仓采纳该结论并独立选型。

2. **`mammoth` 双档输出** —— `convertToMarkdown` 保留结构 / `extractRawText` 出裸文本。

3. **截断必须显式报告** —— 上游 `xlsx.ts` 注释：
   > *"Truncation is reported explicitly so the model never mistakes a partial table for the whole workbook."*

   本仓采纳该设计原则（见 `src/index.js` 评审项 5）。

## 不适用部分

上游的 `lib/client.js`（客户端预打包）、附件坞（pill + library card）、
`dsh.client.inject → @deepseek-ai/dsh-client-ui-conversation` 均**未采用**，
理由见 `README.md` 风险第 2 条。
