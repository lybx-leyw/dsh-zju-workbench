# dsh-radar-doc-parse

> **候选骨架：未评审、未接入 profile、不可直接使用。**
> 本目录只用于承载评估结论与集成落点，`apply()` 为空实现。

## 一句话

给「会话内读文件」补齐 **DOCX / DOC / PPTX / XLSX** 的文本抽取 —— 本仓目前
**认得出这些扩展名，但读不了**它们的内容。

## 集成性质

**强化式集成**（不是「全新」，也不是「重复且无增益」）。

| 判据 | 结论 | 落点 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 能力挂在**既有的「把文件拖进对话让 AI 读」**这一动作上；不新增侧栏入口、不新增页面 |
| ② 功能仍相似正交 | ✅ | PDF 链路（`pdfjs-dist@6.4.299`）**完全不动**，只补另外四种容器格式；`parse/pdf.js` 不接管 |
| ③ 底层多调了更优质实现 | ✅ | 见下「选型」——尤其 `read-excel-file` 是为规避已知 CVE 而选 |

## 现状证据（为什么这是「补缺口」而不是「重复造」）

```
$ grep -rn "mammoth\|word-extractor\|read-excel-file" --include=package.json packages/
（0 命中）

$ grep -rn "read_document\|readDocument" packages/ scripts/
（0 命中）
```

`.docx/.xlsx` 在本仓只出现在两处**扩展名白名单 / MIME 别名表**：

- `packages/dsh-zhiyun-core-lecture/src/tree.js:85,128`
- `packages/dsh-zhiyun-host-classroom/src/upstream/mime.js:29-30`（含 `application/wps-office.docx` 别名）

PDF 能力已有：`packages/dsh-zhiyun-host-paper/package.json`、`packages/dsh-zhiyun-page-notes/package.json`
均锁 `pdfjs-dist: 6.4.299`。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [`taxueseek/dsh-files`](https://github.com/taxueseek/dsh-files) |
| 版本 | 0.7.0（仓库内），★43 / fork 10，2026-08-14 建 / 2026-11-07 推 |
| 形态 | A 类原生 DSH：`dsh.bundle.patch` → `cordis.patch.yml`；`dsh.client.inject` → `@deepseek-ai/dsh-client-ui-conversation` |
| 许可证 | **MIT** ✅（`LICENSE` 原文逐字核对：29 行标准 MIT，`Copyright (c) 2026 taxueseek`，无附加条款） |

## 选型（锁版，精确版本，不用 `^`）

| 库 | 版本 | 许可证 | 格式 | 为什么 |
| --- | --- | --- | --- | --- |
| `mammoth` | `1.13.0` | BSD-2-Clause ✅ | docx | 直接输出 **Markdown**（保留标题/列表/表格），不是裸文本 |
| `read-excel-file` | `9.3.14` | MIT ✅ | xlsx | 上游注释原文：*replaces `xlsx@0.18.5` which carries **prototype-pollution CVEs*** |
| `word-extractor` | `1.0.4` | MIT ✅ | doc | 老 `.doc`（Word 97 二进制）；浙大办公文件仍大量存在 |

## ⚠ 风险

### 1. npm 包名被他人占用（**最关键**）

`https://registry.npmjs.org/dsh-files` → **0.0.1**，作者 `dushaobindoudou`，
description：*"File manager panel for the dsh web GUI - **name reserved**; first release in development."*
tarball 内只有 `package.json` + `README.md`，**零代码**。

上游仓库自己的 `package.json` 里 `name` 恰恰是 `dsh-files`，但**从未发布成功**：
`@taxueseek/dsh-files`、`@taxueseek/files`、`dsh-files-toolkit` 全 404，`scope:taxueseek` 搜索 0 条。

⇒ **绝不能写 `"dsh-files": "0.7.0"`**，会装到陌生人的占位包。
⇒ 所以本骨架锁的是**它的底层库**，`read_document` 的编排由本仓兼容层自己写。

### 2. 不采用上游的客户端

上游把客户端预打包成 `lib/client.js`（19 KB）。**不复制**（违反「不搬运上游源码」），
也**不挂载**（它的 `inject` 指向宿主 `ui-conversation` 槽位，与本仓 `dsh-zhiyun-shell-ui` 两套布局主张）。
上游的「附件坞」（pill + library card）同样不采用。

### 3. `.doc` 分支的依赖年龄

`word-extractor@1.0.4` 发布于 2021-07，传递依赖 `saxes` / `yauzl` 需查 advisory。
若不可用，`.doc` 应先降级为「提示用户另存为 .docx」，而不是硬上。

### 4. 抽取文本的锚点漂移

若后续把抽取结果索引进 `core-vault`，同一份文件换库版本会得到不同文本，
导致笔记锚点漂移。锁版只能缓解；评审时决定是否给结果打 `(文件hash, 库版本)` 版本戳。

## 未做的事（有意为之）

- ❌ 没有写测试（雷达包硬规则）
- ❌ 没有写入 `profiles/*/package.json` 的 `dsh.profile.bundles`
- ❌ 没有复制上游 `lib/*.js`
- ❌ 没有把 PDF 纳入本包

## 评审清单

1. `inject` 该写 `['tools','fs']` 还是走 `dsh-zhiyun-core-tool` 的注册 API？（**看清前不要填**）
2. `read_document` 是否与 `core-tool` 既有工具抢名（当前 grep 为 0，需复核）
3. 格式分派用**文件头魔数**（`PK\x03\x04` / `\xD0\xCF\x11\xE0`）而非扩展名
4. 体积/时延上限按浙大课件实况调整，且**超限必须显式告知模型「已截断」**
5. 判据①要有可执行断言：拖入 `.docx` → 同一对话内出摘要，侧栏无新入口
