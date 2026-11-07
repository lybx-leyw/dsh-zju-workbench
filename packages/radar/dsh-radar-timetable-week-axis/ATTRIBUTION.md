# ATTRIBUTION

本包（`dsh-radar-timetable-week-axis`）为**候选骨架**，按 CONTRIBUTING 3.3 记录借鉴来源。
**未复制上游源码**；只借鉴了数据形状与判定规则，实现待评审后自行编写。

## 上游

| 项 | 值 |
| --- | --- |
| 项目 | NUS Vacansee —— 实时找空教室 |
| 仓库 | https://github.com/CPLADRAGON/nus-vacansee |
| 作者 | CPLADRAGON |
| 许可证 | MIT |
| 许可证核验 | GitHub API `license.spdx_id = "MIT"`（2026-11-07 实查） |
| 参考文件 | `src/lib/nusmods.ts`（只读） |

## 借鉴了什么

| 借鉴项 | 本包落点 |
| --- | --- |
| `weeks` 字段的四种编码形状（数组 / 闭区间 / 区间+列表 / 区间+间隔） | `src/upstream.js` 的 `WEEK_ENCODINGS`；`normalizeWeeks()` 的契约 |
| 「学期第几周 = 天数差 ÷ 7 + 1，下限 1」 | `weekNumberFromDate()` 的语义 |
| 「周号升序去重」 | `normalizeWeeks()` 的返回值约定 |

## 没有借鉴 / 明确排除

| 项 | 原因 |
| --- | --- |
| 上游的具体 `.ts` 源码 | 不搬运源码；且其毫秒直减有时区偏一天的问题，本包不沿用 |
| NUSMods API 客户端（`VENUE_LOCATIONS_URL` 等） | 与本包无关；且不该把第三方校园 API 引入本仓 |
| 教室占用引擎（`occupancy-engine.ts`） | 与在册 `dsh-radar-room-occupancy` 重复，不并入 |

## 许可证文本

上游 MIT 许可证全文见仓库根 `LICENSE`。本仓若后续合入本包，须在同一目录保留本文件。
