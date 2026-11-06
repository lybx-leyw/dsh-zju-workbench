# dsh-radar-schedule-gap —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` 被调用即抛错，
> `src/upstream.js` 的导出函数全部 `throw`。
> 评审通过前**不得**加入 `profiles/zju-workbench` 的 `dsh.bundle` 清单。
>
> **本包 `dependencies` 为空**：上游 `Kozmosa/MySCUT` 是 `private: true` 的应用工程、
> npm 上不作为库发布，属 **B 类源码级借鉴**（只借行为规格与失败形态，不引依赖、不复制代码）。

---

## 集成性质：**强化式集成**（不是全新功能）

本包**不新增面板**。它补的是「规划」页课表提示缺的那一格：**「这两节课之间还剩多久」**。

本仓现在能回答的是「这天有几节课」（`page-planning/src/schedule-hint.js` 的
`scheduleHint()` → `这天有 N 节课。`），**回答不了**「第 2 节 09:35 下课、第 3 节 10:00
上课，中间 25 分钟够不够从东 1 走到西 2」。全仓 `空闲 / 空档 / gap / 连堂` 在
`dsh-zhiyun-*` 业务代码里**命中 0**（唯一的 `gap` 是解析器分块参数、`空闲` 是 LLM 流
看门狗）。上一轮 r136 的 `dsh-radar-clash-guard` 补的是**「撞不撞」**，
本包补的是它正交的另一半**「中间有多久」**。

### 三条判据核验

| 判据 | 成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 不新增导航 / 插槽 / 路由。落点是 `page-planning/src/client.jsx:1662` 已有的 `<small className="zpg-schedule-hint">` 一行文案 |
| ② 功能仍相似正交 | ✅ | 仍是「这天课怎么排」，只多一个「第 2–3 节之间 25 分钟」。不改排课、不改导出、不改提醒、不做选课求解 |
| ③ 底层多调了更优质实现 | ⚠ **部分成立** | 上游 `isIntervalOverlapped()`（半开区间）与 `resolveLessonInterval()`（显式时刻优先、回落节次表）是 5 行就能写完的判据，**不构成「更优质实现」**。真正借的是它把「节次表」与「显式时刻」分成两级并**逐条给出失败形态**（见下），以及一套**不依赖时刻**的兜底口径 |

> 按判据 ③ 的诚实结论，本包评级为 **🟡（需移植改造）**，不是 🟢。
> 若评审认为「5 行判据不值得单开一个包」，本目录**应当整目录删除** —— 这是允许的结局。

---

## 上游是什么（`Kozmosa/MySCUT`，MIT）

一所华南高校的「课表 + 校园手册」跨平台应用（React + Capacitor，同时出 Android / iOS /
OpenHarmony / PWA）。它**不是 DSH 插件**，与本仓同为「学生课表」场景，因此只作**源码级借鉴**。

| 文件 | 借什么 |
| --- | --- |
| `src/core/schedule/intersection.ts` | `isIntervalOverlapped()` 半开区间判据；`resolveLessonInterval()` 的两级取时（显式 `startTime/endTime` 优先，缺失才回落节次表）；`isWeekMatched()` 的 `(week - startWeek) % step` |
| `src/core/schedule/timeSlotTrim.ts` | ❌ **不借**，见下「实测否决」 |

**上游不可照抄的两处（本仓已实测）**

- **U-1 固定 10 分钟间隔假设**：`trimRedundantTimeSlots()` 逐字移植到本仓 `PERIOD_TIMES`
  （`source-zdbk/src/parse.js:281-285`）后，因本仓**没有任何一对相邻节次相差正好 10 分钟**
  （真实间隔是 5 / 25 / 60 分钟），函数**原样返回全部 13 节**，裁剪量为 **0**。
  ⇒ 该函数在本仓数据上永远不做任何事，**不得移植**。
- **U-2 时刻格式只认 `HH:mm`**：`parseTimeToMinutes()` 的正则是 `/^(\d{1,2}):(\d{2})$/`，
  不含秒也不含时区。本仓 `ClassSession.time` 恰好是 `'10:00-11:35'`（**区间串**，不是单点），
  必须先按 `-` 拆开再喂；`parseExamTime()` 产出的则是带 `+08:00` 的 ISO 串，**不能混用**。

---

## 本仓接入链（评审起点）

```
source-zdbk/src/parse.js  parseSession()  → { weekday, periods[3,4], weeks:'all'|'odd'|'even',
                                              terms, time:'10:00-11:35' }
        ↓
core-study/src/model.js   readScheduleWindow(start, end) → { items:[{ day, courses[] }], meta }
        ↓  page-planning/src/client.jsx:774
page-planning/src/schedule-hint.js  scheduleHint(context, dueLocal) → '这天有 N 节课。'
        ↓  page-planning/src/client.jsx:1662   ← 本包的落点（同一行 <small>）
```

## TODO（评审通过后逐条落实）

1. 在 `page-planning/src/schedule-hint.js` 增加**一个纯函数** `gapHint(items, day)`：
   输入 `readScheduleWindow` 那一行 `courses`，按 `periods[0]` 排序后相邻两两求
   `next.start - prev.end`（分钟）。
2. 间隔 ≤ 10 分钟 → 视为「连堂」，不提示；> 10 分钟 → 给出「第 a–b 节之间有 N 分钟」。
3. 跨午休（本仓 5→6 节间隔 60 分钟）**必须**给出，这是最多人真正关心的那一段。
4. 单双周：`weeks` 为 `'odd'` / `'even'` 的课，**只在对应周参与排序**；不做周次推断时
   一律按「本周」口径，且在文案里不出现周次。
5. `meta.complete !== true` 时**一个字都不说**（与 `scheduleHint()` 现有姿态一致：
   不能把「没读到」说成「没有课」）。
6. 不新增依赖、不改 `build.mjs` / `profile.mjs`、不写测试（radar 包约定）。
