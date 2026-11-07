# dsh-radar-clash-guard —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` 被调用即抛错，
> `src/upstream.js` 的两个函数全部 `throw`。
> 评审通过前**不得**加入 `profiles/zhiyun-bench` 的 `dsh.bundle` 清单。
>
> **本包 `dependencies` 为空**：上游是 `private: true` 的应用工程、npm 上不存在，
> 属 **B 类源码级借鉴**（只借行为规格，不引依赖、不复制代码）。

---

## 集成性质：**强化式集成**（不是全新功能）

本包**不新增面板**。它补的是「规划」页课表格子缺的那一格：**「这两门课撞不撞」**。

### 三条判据核验

| 判据 | 成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 不新增导航 / 插槽 / 路由。落点是 `page-planning/src/schedule-view.jsx` 已有的课表格子 |
| ② 功能仍相似正交 | ✅ | 仍是「这周有什么课」，只多一个「这里撞了」的标记。不改排课、不改导出、不改提醒 |
| ③ 底层多调了更优质实现 | ⚠ **部分成立** | 上游只给**一条**区间求交判据（三行可写）；真正借的是它的**失败形态清单**（D-1/D-2/D-3）与**输入宽容度**。判据本身不构成「更优质实现」 |

> 判据③如实标注为「部分成立」。评审时若认为「三行可写」已经足够，
> 本包可整目录删除、改为在 `page-planning` 内直接实现 —— 这是**允许的结局**。

---

## 本仓现状（本轮实测）

| 事实 | 证据 |
| --- | --- |
| 课表**已有**判冲突所需的全部字段 | `source-zdbk/src/parse.js:335-347` 的 `parseSession()` 一次给出 `weekday`(1–7) / `periods`(`[3,4]`) / `weeks`(`'all'\|'odd'\|'even'`) / `time`(`'10:00-11:35'`) / `terms` |
| 课表格子**没有**任何冲突标记 | `page-planning/src/schedule-view.jsx`、`client.jsx:762-800` 只把课表当「截止日前后的上下文」读，`setSchedule({ items, from, to, complete })` 后直接渲染 |
| 全仓 `conflict` 的真实调用**只在白板** | `core-classroom-agent/src/summarizers/whiteboard-conflicts.js`（元素重叠 / 线穿元素 / 出血），与课表无关 |
| 规划页**不做选课求解** | `schedule.js` 的 `ScheduleStore` 只有「独立执行块」的增删查，无候选池 |

---

## 上游三处实测缺陷（本轮跑出来的）

实测方法：把上游 `timeToMinutes()` / `checkSessionCollision()` / `detectPlanConflicts()`
**逐行移植成 Python**，喂本仓真实 `PERIOD_TIMES`（紫金港作息）。

| 编号 | 现象 | 实测输出 |
| --- | --- | --- |
| **D-1** | 每「课程对 × 天」只记一条（`timeUtils.ts:158` 双 `break`） | 课 A/B 均周一+周三第 3–4 节 → **期望 2 条，实得 1 条** |
| **D-2** | `Conflict` 无周次/学期字段（`types/schedule.ts:33-42`） | 单双周课、跨学期课一律判「撞」 |
| **D-3** | `timeToMinutes(undefined)` → `0`（`timeUtils.ts:13`） | 第 13 节起 2 节 → `PERIOD_TIMES[14]` 不存在 → `time: null` → 喂进去**静默判不撞** |

**已用本仓数据验证判据本身是对的**：连续节次（1–2 vs 3–4、3–4 vs 5–6、6–8 vs 9–10）
全部正确判「不撞」；共用第 2 节（1–2 vs 2–3）正确判「撞」。

---

## 评审前必须回答（**答否 → 整目录删除**）

1. **用户看到红格子之后能做什么？**
   本仓课表是**只读**的（数据来自正方，不提供改选），规划页也**不做选课求解**。
   若答案是「什么也做不了」，那红格子就只是**焦虑源** —— 请考虑让标记仅在
   点击格子时出现，或干脆不做。
2. **谁的数据会撞？**
   课表来自正方，教务**理论上**不会下发撞课的课表。
   真实撞课来源只有两类：(a) 用户手工补录/导入的课（本仓 `ScheduleStore` 的
   `slots` 是「执行块」，不是「课程」）；(b) **辅修/微辅修/跨校区**两套课表合并。
   若这两类占比极低，收益 < 成本。
3. **要不要做「通勤冲突」？**
   `PERIOD_TIMES` 显示节间空隙极不均：第 2→3 节 25 分钟、第 5→6 节 60 分钟，
   其余只有 **5 分钟**。紫金港东西区之间 5 分钟走不到 —— 这是**更真实**的冲突类型，
   但需要「校区」字段（`location` 尾部的 `zwf…` 内部编码目前被**切掉**了，
   `parse.js:346`），本包默认**不做**。

---

## 目录

```
package.json        # dependencies 为空（B 类源码级借鉴）
OWNERS              # Owner: shared
README.md           # 本文件
ATTRIBUTION.md      # 读了哪些文件、借了什么、明确不借什么
src/index.js        # findClashes / weeksOverlap / toCellIndex（占位 + TODO-A/B/C）
src/upstream.js     # minutesOfTime / timeRangesOverlap（占位 + TODO-D/E）+ UPSTREAM_DEFECTS
```

**无测试**（radar 包一律不写测试）、**不入 profile**、**不改上游源码**。
