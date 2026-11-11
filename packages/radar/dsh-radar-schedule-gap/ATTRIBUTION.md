# ATTRIBUTION

本目录**未复制任何上游源代码**，仅参考以下项目的行为规格与失败形态。

## Kozmosa/MySCUT

- 仓库：https://github.com/Kozmosa/MySCUT
- 许可证：MIT（`LICENSE` 首行 `MIT License`，`package.json` 亦声明 `"license": "MIT"`）
- 参考文件：
  - `src/core/schedule/intersection.ts` —— 半开区间重叠判据 `isIntervalOverlapped()`、
    两级取时 `resolveLessonInterval()`、周次步长 `isWeekMatched()`
  - `src/core/schedule/timeSlotTrim.ts` —— **仅作反面参照**，未采用（见 `src/upstream.js` 注释）
  - `docs/DATA_MODEL.md` —— 课表数据模型的分层口径（`table` / `timeSlots` / `courses` / `lessons`）
- 借鉴方式：按 CONTRIBUTING 3.3 记录；**只借行为规格，不摘取代码**。

## 本仓对照（非借鉴，为本仓既有实现）

- `packages/dsh-zhiyun-source-zdbk/src/parse.js:281-285` —— `PERIOD_TIMES` 节次时刻表
- `packages/dsh-zhiyun-source-zdbk/src/parse.js::parseSession()` —— 单条课表记录的字段来源
- `packages/dsh-zhiyun-page-planning/src/schedule-hint.js::scheduleHint()` —— 既有「这天有 N 节课」文案
