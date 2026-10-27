# dsh-radar-ics-rrule —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` / `recurrenceRuleFor()`
> 与 `src/upstream.js` 的 `loadUpstream()` / `weekdayOf()` / `contiguous()` 都直接抛错或返回占位值。
> **请勿**把它加入任何 profile（`profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`），
> **请勿**在真实环境挂载。评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

给 `dsh-radar-ics-export` 的「导出成 .ics」补一层**真正的周重复**（RFC 5545 `RRULE`）：
一学期的「周三 08:00 数据结构」在日历里是 **1 条带 RRULE 的事件**，而不是 16 条各自独立、删起来点 16 次的事件。

## 关系判定：**强化式集成**（不是全新）

| 判据 | 本候选 | 依据 |
| --- | --- | --- |
| 仍是同一个面板？ | ✅ | 不新增导航项 / 槽位 / 路由。只暴露 `recurrenceRuleFor()` 给 `ics-export` 的 `buildCalendar()` 用 |
| 功能仍相似正交？ | ✅ | 仍是「课表 / 截止时间 → .ics 带走」，不改成双向同步、不改成订阅源 |
| 底层多调了更优质实现？ | ✅ | 「一周重复 N 次 + 不连续要拆」手写只会退化成逐日展开（现状）；锁版 `rrule@2.8.1` 是 RFC 5545 成熟实现 |

**不是 🟢 而是 🟡** 的原因：RRULE 只在「组内严格每 7 天一条」时与逐日展开等价，
而本仓课表条目**没有周次 / 节次号**，调课会让分组碎裂（见下文「实测」C）。

> ⚠ **装配关系**：本包**不独立承载页面**。若评审判定 `dsh-radar-ics-export` 不推进，**本包应一并驳回**。
> 反向不成立：`ics-export` 不装本包也仍然可用（就是逐日展开的现状）。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [jakubroztocil/rrule](https://github.com/jakubroztocil/rrule) |
| npm | **`rrule@2.8.1`**（`dist-tags.latest`，**2023-11-10 发布**，本轮实查） |
| 许可证 | **BSD-3-Clause** ✅（GitHub `license.spdx_id` 与 npm `versions['2.8.1'].license` 两处一致） |
| Stars | ★3.4k |
| 语言 | TypeScript 源 → CJS 产物（**`package.json` 无 `exports` 字段**，见实测 A） |
| 体积 | npm `unpackedSize` 687,245 B（含类型与源码）；`esbuild --bundle --minify` 实测 **51.9 KB** |
| 传递依赖 | 仅 `tslib@^2.4.0`（**0BSD** ✅，132 KB，打包时基本被 tree-shake 掉） |
| 首次发现 | 2026-10-26（B 组 · 浙大场景 · 「课表导出成日历」轴） |

> **活跃度说明**：2023-11 后未发新版。这不是加分项 —— 但它恰好满足「锁版」的要求：
> RFC 5545 的 `FREQ` / `COUNT` / `BYDAY` 语义早已冻结，**不需要**它继续迭代；
> 需要的是**行为不变**。若评审要求「必须活跃」，本条应降为 🔵。

---

## 实测（沙箱 `npm i rrule@2.8.1`，Node 22.13.1，2026-10-26）

| # | 试什么 | 结果 | 结论 |
| --- | --- | --- | --- |
| **A** | `import { RRule } from 'rrule'` | `SyntaxError: Named export 'RRule' not found … is a CommonJS module` | **P1** 必须 `import pkg from 'rrule'; const { RRule } = pkg;`。本仓全是 `"type":"module"`，照抄官网示例**加载期即崩** |
| **B** | `byweekday:[dow]` 透传 `Date#getDay()` | `getDay()`=3（周三）→ `options.byweekday=[3]` → `BYDAY=TH` → 展开 **周四** | **P0** 两套枚举差一位（`rrule`: MO=0…SU=6；`getDay()`: SU=0…SA=6），**不报错不告警**。必须走 `RRule.WE` 一类的枚举 |
| **C** | 4 周 × 每周 2 节 + 第 3 周调课到周六（9 条）按 `(courseId, 星期, 时分, 时长)` 分组 | 3 组，`COUNT` = 4 / 4 / **1**；条数守恒 9=9，**语义不守恒** | **P1** `COUNT` 表达不了「哪一周被调走了」；不连续必须**退回逐条** |
| **D** | 停课不连续（第 8、12 周各停一次） | `BYDAY` + `COUNT` 无法表达两次空洞，展开会把停课周也排上课 | 同 C：`contiguous()` 判定为**唯一**放行条件 |
| **E** | `tzid: 'Asia/Shanghai'` 是否影响 `all()` | **不影响**（与不传 `tzid` 结果相同）；只影响 `toString()` 里的 `DTSTART;TZID=` 写法 | 时区输出**留给 `ics-export` 拍板**（它的 TODO-D），本包只给 `RRULE` 值 |

---

## 与 `dsh-radar-ics-export` 的接线（TODO-D）

`ics-export` 的 `EVENT_FIELDS`（`src/index.js:79-82`）**刻意不含 `recurrenceRule`**，注释理由是
「逐日展开后再加 RRULE 会重复生成」。

**这句结论对，理由要补**：RFC 5545 下，一个 `VEVENT` 若既有独立 `DTSTART` 又带 `RRULE`，
客户端会把它当作**该序列的起点**。所以危险的是「同一份条目**同时**以『展开后的 N 条』和
『带 RRULE 的 1 条』出现」，而不是「多传了一个字段」。

实现时必须**二选一**：

- `contiguous(group) === true` → 只输出 **1 条** + `recurrenceRule`；
- 否则 → 输出 **N 条**，且每条 `recurrenceRule` 为空。

**绝不能**「N 条 + 每条挂同一个 RRULE」。这条建议补进 `ics-export` 的 TODO-D，本轮**未改**该包
（避免混淆 L2 每日 1 个配额）。

---

## 评审要拍板的事

1. **`mode: 'deadlines'` 值不值得开 RRULE** —— 多数待办是一次性的，`contiguous` 判下来通常只有 1 条，
   等于不开。真正的受益面是否只剩「每周例会」？若答案是否，本包的范围应缩到 `timetable` 一档。
2. **`contiguous` 判定失败时要不要记一条可见的提示** —— 静默退回逐条，用户看到 16 条独立事件，
   与「有 RRULE」时看到 1 条，**体验差异明显但都没有错**。是否要让 UI 说一句「本次导出未合并重复」？
3. **`rrule` 51.9 KB 的预算** —— 与 `ics@3.12.1`（`ics-export` 上游，bundle 后 ≈75 KB）叠加，
   导出链路总增量约 127 KB。桌面端可接受，是否需要按需 `await import()`？
4. **上游 2023 后未更新** —— 若项目方要求「依赖必须有近期维护」，本条应降 🔵 并删除本骨架。

---

## 生成信息

| 项 | 值 |
| --- | --- |
| 轮次 | r74 · 2026-10-26 · B 组（浙大场景） |
| 报告 | `docs/ecosystem-radar/2026-10-26-r74.md` |
| 登记表 | `docs/ecosystem-radar/registry.md`（2026-10-26 · B 组 · r74 段） |
| Owner | `shared`（未触碰他人 `OWNERS`） |
| 是否接入 profile | **否**（`profiles/zhiyun-bench/package.json` 未改） |
