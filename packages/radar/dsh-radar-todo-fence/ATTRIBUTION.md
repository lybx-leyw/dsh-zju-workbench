# ATTRIBUTION

本包为**候选骨架**，不含任何上游源码。以下为概念/事实层面的借鉴，按 CONTRIBUTING 3.3 记录。

## 1. 活动类型枚举（事实性借鉴）

| 项 | 值 |
| --- | --- |
| 来源 | [`8eoyw/zju-learning-cli`](https://github.com/8eoyw/zju-learning-cli) |
| 位置 | `zju.py:739` 的 `ACT_TYPES` 常量 |
| 许可 | MIT（`LICENSE` 1,137 B，无附加限制） |
| 作者 | 8eoyw；部分移植自 [PeiPei233/zju-learning-assistant](https://github.com/PeiPei233/zju-learning-assistant) |
| 借鉴内容 | **只是事实**：学在浙大的活动类型名称（`material` / `online_video` / `homework` / `forum` / `exam` / `page` / `web_link` / `questionnaire` / `classroom` / `lesson` / `vocabulary` / `survey` / `chatroom`）及其中文标签 |
| **未借鉴** | 未复制任何代码行、函数、注释；`src/index.js` 的 `TYPES` 是本仓自行编写的结构（增加了 `countsAsMissing` 维度，上游没有这个概念） |

> 类型名本身是**平台契约**（学在浙大 API 的枚举值），不构成版权作品；此处登记是为了留下可核对来源。

## 2. 「聚合端点 vs 逐课」的对账思路

| 项 | 值 |
| --- | --- |
| 来源 | 本仓 `packages/dsh-zhiyun-source-campus/docs/todos-vs-zju-mcp.md`（内部文档，2026-10-21） |
| 借鉴内容 | 概念：用「两条路都跑一次再比」代替「引用一句断言」 |
| 改动 | 本包**不同意**该文档的 `type !== 'classroom'` 阈值（见报告 r67 §3.1），改为三态（计入漏 / 无法判定 / 结构性差异） |

## 3. 未借鉴但读过的实现

| 仓库 | 许可 | 读了什么 | 为什么不借鉴 |
| --- | --- | --- | --- |
| `ZakWang1229/zju-cli` | **无许可证** ⛔ | 只看了 GitHub 上的描述（功能表） | 无许可证 → **不采用、不摘取任何代码**，也不以它为依据 |
| `PeiPei233/zju-learning-assistant` | 未核 | 未读源码（仅经上面 CLI 的 README 间接得知其存在） | 未核许可，不使用 |
