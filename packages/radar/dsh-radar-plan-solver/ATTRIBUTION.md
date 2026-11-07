# ATTRIBUTION

本包（`dsh-radar-plan-solver`）为**候选骨架**，按 CONTRIBUTING 3.3 记录借鉴来源。
**未复制上游源码**；只借鉴建模形状，代码待评审后自行编写。

## 借鉴来源

| 项 | 值 |
| --- | --- |
| 项目 | Shift Scheduler —— 排班 / 课表约束求解（浏览器内运行） |
| 仓库 | https://github.com/hermes98761234/shift-scheduler |
| 作者 | hermes98761234 |
| 许可证 | MIT |
| 许可证核验 | GitHub API `license.spdx_id = "MIT"`（2026-11-07 实查） |
| 参考文件 | `src/lib/timetable.ts`、`src/lib/solve.ts`、`src/lib/dsatur.ts`、`src/lib/solver.worker.ts`（均只读） |

## 借鉴了什么

| 借鉴项 | 本包落点 |
| --- | --- |
| 「约束 → 变量」建模形状（卡片 × 时段槽） | `src/upstream.js` 的 `buildModel()` TODO |
| 「不可行时说明哪条规则打架」的产品语义 | `diagnose()` 返回 `conflicts` |
| 「求解放 Worker」 | `apply()` TODO |

## 明确排除

| 项 | 原因 |
| --- | --- |
| 上游 `.ts` 源码 | 不搬运源码 |
| DSATUR / 模拟退火的具体实现 | 与本包「ILP + 冲突定位」路线不同，不合并 |
| 上游的 `presets.ts` / `shifts.ts`（排班领域预设） | 面向值班表，与本仓学生场景无关 |

## 锁版依赖

| 包 | 版本 | 许可证 | 用途 |
| --- | --- | --- | --- |
| `yalps` | **0.6.4** | MIT | 整型线性规划求解（`status / result / variables`） |
| `heap`（yalps 的依赖） | `^0.2.7` | MIT | 优先队列 |

## 许可证文本

上游 MIT 许可证全文见其仓库根 `LICENSE`。本仓若后续合入本包，须在同一目录保留本文件。
