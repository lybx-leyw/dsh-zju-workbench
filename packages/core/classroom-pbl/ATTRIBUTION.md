# ATTRIBUTION — @lybx-leyw/dsh-zju-core-classroom-pbl

本包是 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) **PBL（项目式学习）层**的移植，按上游 TS 重写
（文件头标 `// 源：…:<行范围>`），**不含逐字节副本**。

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/THU-MAIC/OpenMAIC |
| 上游版本 | v1.3.0 · commit `03dee2bb4e1bf2e3296ad05ca1f78ce863452921` |
| 许可证 | MIT（Copyright (c) 2026 THU-MAIC） |
| 本包 `vendor/` | **无** |

## 移植范围

| 本仓文件 | 上游来源 |
| --- | --- |
| `src/planner.js`（项目规划、里程碑） | `lib/pbl/v2/agents/planner.ts` |
| `src/eval-prompts.js`（场景证据分段与评分口径） | `lib/pbl/v2/operations/runtime/eval-prompts.ts` |
| `src/prompts/*.md` | `packages/@openmaic/generation/prompts-pbl/` |

## 改动

- 项目简报、里程碑 `completionCriteria`、debrief 的中文措辞按本仓教学语境重写。
- 上游的 PBL 评估流程（transcript 渲染、证据分段）保留语义，但**未移植**其数据库侧实现。

## 升级流程

1. 按新 commit 重新拉取 `ref/OpenMAIC/`；
2. 对照 `lib/pbl/v2/` 检查 `// 源：` 注释；
3. 跑 `node --test tests/classroom*.test.mjs`。
