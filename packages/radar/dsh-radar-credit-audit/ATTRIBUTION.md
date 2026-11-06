# 归属说明（ATTRIBUTION）

本包**未复制上游任何代码**。`src/` 下全部为占位与评审清单。

## 上游

| 项 | 值 |
| --- | --- |
| 项目 | 课舟 ClassArk（`zju-kezhou`） |
| 仓库 | https://github.com/Kepler16f/zju-kezhou |
| 版权 | `Copyright (c) 2026 KeZhou (ClassArk) contributors` |
| 许可证 | **MIT**（`LICENSE` 正文逐字 MIT；正文后另附「第三方说明」，见下） |
| 本包采用的资产 | **仅计划采用** `engine/` 与 `schema/`（TODO-0 落地后以 vendor 包形式引入） |

## 上游 `LICENSE` 中的第三方说明（转述，不摘录代码）

1. **Celechron**（https://github.com/Celechron/Celechron，**GPL-3.0**）—— 上游声明「教务网接口端点、请求参数、
   Cookie 名称与限频特征等**接口事实**参考了它」，并明确「网络层、解析层与限频实现均为独立编写，
   **未复制或翻译其源代码**」。
   → 本包与之一致：**只转述接口事实（HTTP 行为），不接触 Celechron 的任何代码**。GPL-3.0 不进入依赖图。
2. **Noto Sans SC**（SIL OFL-1.1）—— 仅位于上游 `assets/fonts/`。**本包明确不取该目录**，OFL 不进入依赖图。
3. **Flutter 及构建工具链**（BSD-3-Clause / Apache-2.0）—— 本包为 Node 侧适配层，不涉及。

## 本包的许可判定

`src/upstream.js` 的 `UPSTREAM_LICENSE = 'MIT'` 的依据是 **`LICENSE` 正文本身**，而不是 GitHub 的
`license.spdx_id`（后者因附加「第三方说明」报 `NOASSERTION`）。这是**雷达的工程判定，不替代法务意见**；
评审若认为需要更保守，可把 TODO-0 改为 (c)「只借 schema」（JSON Schema 是**契约描述**，
不构成对实现代码的复制）。

## 若将来以 vendor 形式引入

发布 `dsh-radar-credit-audit-vendor@1.7.0` 时，**必须**：

1. 保留上游 `LICENSE` 全文（含「第三方说明」段）在包内；
2. 在包内 `NOTICE` 写明来源仓库、版本（`ENGINE_VERSION = "1.7"`）与所做改动（原样发布，无改动）；
3. 读本文件「第三方说明」第 1 条：Celechron 是 GPL-3.0，**vendor 包不得包含其任何代码**，
   只允许包含上游独立编写的 `engine/`。
