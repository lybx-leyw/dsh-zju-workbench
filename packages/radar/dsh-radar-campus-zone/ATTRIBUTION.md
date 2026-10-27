# 来源与改动说明

本包是**候选骨架**，由「生态雷达」生成，**未评审、未接入任何 profile**。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/0x000005/better-zdbk |
| 许可证 | **MIT**（仓库根 `LICENSE`，1060 B，SPDX 由 GitHub 识别为 `MIT`） |
| 作者 | 用户脚本头 `@author HZR`；GitHub 账号 `0x000005` |
| 提交 | 仓库**只有一次 push**：`2026-09-15T03:10:53Z`，`main` 分支当前 HEAD |
| 文件 | `LICENSE` / `README.md`（35 B）/ `zdbk.user.js`（661 KB，8706 行，`@version 1.2.1`） |

## 借鉴范围（CONTRIBUTING 3.3）

**已阅读**：`LICENSE`、`README.md`、`zdbk.user.js` 头部元数据与以下小节
（`CONFIG` 主题/行为开关、`CONFIG.labels`、`CONFIG.campusAliases` 约 211 行、
`isCampusMismatch()` 约 3180–3190 行、`updateCourseNotices()` 约 3196–3222 行，
以及 `td.skdd` / `td.xxq` / `tr-conflit` 等选择器用法）。

**拟借用**：仅「地点字符串 → 校区归属 + 校区别名」这一层判定**口径**，改写为纯函数
（字符串进、结构化结果出），并非逐行移植。

**不借用**：整站 UI 改写（卡片重排、主题色板、列宽、批量展开、隐藏冲突/余量不足课程）、
`unsafeWindow`、`GM_*` 持久化、任何 DOM 注入逻辑。

**未复制上游源码到本仓库** —— 本目录只有占位文件与 TODO。

> ⚠ 与 `CONTRIBUTING 3.3` 的对应：本包属于「**只做了简单借鉴**」情形，须在仓库根
> `ATTRIBUTION.md` 的「已阅读源码/文档、拟在候选骨架中仅作能力提取」一节留痕。
