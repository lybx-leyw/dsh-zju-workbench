# ATTRIBUTION —— dsh-radar-repeat-law

> 本包**未摘取上游任何源码**（`src/` 下全部是占位与 TODO，不含实现）。
> 本节只记录「等价借鉴」的概念来源，按 `CONTRIBUTING.md` 3.3 登记。

| 概念 | 来源 | 许可证 | 借鉴形式 |
| --- | --- | --- | --- |
| 重复任务用「模板 + 物料化副本 + `originTaskId` 回链」建模 | [MAGMA27/dsh-calendar](https://github.com/MAGMA27/dsh-calendar) `src/core/repeat.ts`（`buildRepeatCopy` / `alignSeries` / `materialized`） | Apache-2.0 | **仅概念**：本仓拟给条目加 `generatedId` 字段与「已生成日期」记账，代码自写 |
| 「这次 / 整个系列」二次确认 | 同上 `src/client/components/RepeatScopeConfirm.tsx` | Apache-2.0 | **仅交互形态**（三选一确认），文案与组件自写 |
| 假日判定与推进逻辑解耦（`matchesRepeat(rule, day)` 而非在推进函数里内联） | 同上 `src/core/repeat.ts` | Apache-2.0 | **仅结构**：本仓拟把 `skipHolidays` 从 `advanceBy()` 提到独立判定函数，假日内容自建 |

**未借鉴**：上游的 `PUBLIC_HOLIDAYS` 写死表（2025/2026 手抄）、`host-ledger.ts` 的 60 天物料化循环、
`host-scheduler.ts` 的调度 tick —— 这些与本仓「不预生成」的约定冲突，且写死的数据不可复用。

若日后**确实**复制了上游代码片段，必须在此处补 CSV 式清单（文件、行号、许可证、修改说明），
并保留 `Copyright 2026 MAGMA27` 与 Apache-2.0 的 `NOTICE` 义务。
