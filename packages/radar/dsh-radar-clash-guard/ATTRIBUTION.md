# 归属声明

> **候选骨架：未评审 · 未接入 profile · 不可直接使用。** 本文件只用于留痕。

按 [CONTRIBUTING 3.3](../../../docs/contributing/CONTRIBUTING.md#33-参考其他项目前先确认协议)：
本仓**已阅读**下列项目的源码以划定能力缺口与接口形状，**未复制任何源码**。
骨架内 `src/*.js` 全部是本仓自写的占位、签名与 TODO。

## 参考项目（只借行为规格，不引入依赖、不复制代码）

- [Sira-pel/Course_Planner](https://github.com/Sira-pel/Course_Planner)
  · **Apache-2.0** ✅（GitHub `spdx_id` 实核；仓内另有 `LICENSE` 11,358 B、`NOTICE` 132 B、`THIRD_PARTY_NOTICES.md` 759 B）
  · 版本：无 npm 包（`private: true`；实测 `courseflow` 与 `@sira-pel/course-planner` 在 npm 均 **404**）
  · 2026-09-12 建仓，push 2026-11-03，★1，TypeScript，2,177 KB
  · 课程表规划器（快速文本输入 / 冲突检测 / 导出日历·图片·文本）

**阅读范围**：`LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md`、`README.md`、`package.json`、
`src/types/schedule.ts`、`src/utils/timeUtils.ts`、`src/utils/planGenerator.ts`（仅读前半的
`overlapsBlocked` / `sectionSelfClashes` / `explainEmpty`）

**授权依据**：Apache-2.0 允许衍生与再分发（须保留版权与 NOTICE）。本包**未衍生其代码**，
仅以行为规格形式记录；若评审后决定直接搬用其判据函数，须在 `NOTICE` 保留上游版权行。

**借用范围（行为规格，非代码）**：

| 上游符号 | 借用内容 | 本仓落点 |
| --- | --- | --- |
| `checkSessionCollision(a, b)` | 左闭右开区间判据 `aStart < bEnd && bStart < aEnd`；「起止倒置视为无效 ⇒ 不撞」的取向 | `src/upstream.js` → `timeRangesOverlap()` 的 TODO-E |
| `timeToMinutes(str)` | 输入宽容度（`'09:00'` / `'0900'` / `'2:30 PM'`；clamp `[0,1439]`） | `src/upstream.js` → `minutesOfTime()` 的 TODO-D（**但须改掉 D-3**） |
| `detectPlanConflicts(courses)` | **失败形态清单** D-1/D-2/D-3（见下） | `src/index.js` → `findClashes()` 的 TODO-A、`weeksOverlap()` 的 TODO-B |

**明确未借用**：

- `planGenerator.ts` 全部（1,079 行）：组合搜索 / `MAX_EVALUATIONS = 5000` / 偏好打分 /
  `explainEmpty()` 文案。本仓**不做选课求解**（正方接口不给同课候选时段池）。
- `src/types/schedule.ts` 的 `COURSE_COLORS` 12 色、`LayoutSession` 的 `colIndex/totalCols/cascadeIndex`
  （手机端周视图「侧移不并道」的排版算法）—— 与冲突判定正交，且本仓课表格子是 `periods` 制。
- `src/utils/excelImport.ts`（65 KB）/ `textParser.ts`（53 KB）/ `icsImport.ts` —— 本仓已有
  `source-zdbk` 解析与 `dsh-radar-ics-*` 导出链。
- `src/components/header/ConflictModal.tsx` —— 只是一个列表弹窗，本仓格子标记不需要弹窗。

**本仓相对上游的修正**（上游有缺陷，本仓不照抄）：

- **D-1** `detectPlanConflicts()` 每个「课程对 × 天」只记一条（`break`，`timeUtils.ts:158`）：
  实测课 A/B 都排周一+周三第 3–4 节 → 期望 2 条、实得 1 条。本仓 TODO-A 要求**逐条记**。
- **D-2** `Conflict` 无周次 / 学期字段（`types/schedule.ts:33-42`）：本仓 `weeks` 有
  `odd/even/all`、`terms` 有 `'秋冬'`，TODO-B 要求先按周集合与学期过滤。
- **D-3** `timeToMinutes()` 对非法入参 `return 0`（`timeUtils.ts:13`）：
  本仓 TODO-D 要求**无法解析即抛错**，禁止静默归零。
- 判据主体从「时刻区间」改为「**节次集合求交**」：本仓的真实输入是 `djj` + `skcd`，
  时刻只是由 `PERIOD_TIMES` 推出的展示值；用时刻判会在 `PERIOD_TIMES[14]` 越界时静默漏报。

**本仓新增（上游无对应实现）**：

- `toCellIndex(clashes)` —— 把冲突折成「格子的 `weekday-period` 键 → 冲突列表」，
  直接供 `schedule-view.jsx` 的 `map.has(key)` 使用。上游用 React 组件内联算 `hasConflict`，
  无可复用的纯函数。
- 与 `readScheduleWindow()` 的 `meta.complete !== true` 约定对齐（读不全就不标）。
