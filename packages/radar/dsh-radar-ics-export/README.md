# dsh-radar-ics-export —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 与 `src/upstream.js` 只有占位与 TODO，
> `buildCalendar()` / `apply()` / `loadUpstream()` / `toLocalParts()` / `stableUid()` 都直接抛错。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [adamgibbons/ics](https://github.com/adamgibbons/ics) |
| npm | **`ics@3.12.1`**（2026-10-01 发布，`dist-tags.latest = 3.12.1`，本轮实查） |
| 许可证 | **ISC** ✅（GitHub `license.spdx_id`、npm `versions['3.12.1'].license` 两处一致） |
| 作者 | Adam Gibbons（`adamgibbons`） |
| Stars | ★787（2026-10-01 仍在推） |
| 语言 | JavaScript（CJS 产物 + `index.d.ts`，**无 `node:` 内置依赖**） |
| 体积 | npm `unpackedSize` **72,079 B**；连依赖 esbuild `--bundle --minify` 实测 **76,577 B（≈75 KB）** |
| 传递依赖 | `yup@^1.2.0`(MIT, 270 KB) / `nanoid@^3.1.23`(MIT, 15 KB) / `runes2@^1.1.2`(MIT, 123 KB)；yup 再带 `property-expr` / `tiny-case` / `toposort` / `type-fest`，**全部 MIT**，无 copyleft |
| 首次发现 | 2026-10-23（C 组 · 学生功能域 · 「课表带走」轴） |

## 类型与集成判定

- **类型**：**B · 其他 JS 项目**（纯生成器库，无 `dsh.bundle.patch`、不注册路由、不挂插槽）
- **与现有功能的关系**：**重复且可强化** → **强化式集成**
  - ① 仍是同一个面板：「规划」页页头一个导出动作，不新增导航项；课表仍取「今天」页那份 `projectAgenda` 结果。
  - ② 功能相似正交：现有 =「我接下来要做什么」（站内）；新增 =「我怎么在**自己的日历里**看到它」（离开工作台）。同数据、同域、不同问题。
  - ③ 底层多调了更优质实现：**本仓 iCalendar 序列化是零实现**（全仓 grep 已核实，见下），RFC 5545 的折行 / 转义 / `VALARM` / 时区形式全部现成。
- **声明：本包是「强化式集成」，不是「全新功能」** —— 数据、页面、入口都是既有的，只是补最后一个出口。

## 已核实的缺口（本轮读码，不是猜）

```bash
grep -rniE "ical|\.ics|rrule|vevent" --include=*.js --include=*.jsx --include=*.mjs \
  . | grep -v node_modules | grep -v "packages/dsh-radar-"
```

命中 13 个文件，**没有一处是日历**：`core-lecture/src/tree.js` 命中的是 `verticalRule`
（`kTreeHeaderRuleMinRatio`），其余是 `physical` / `vertical` 之类子串。
→ **本仓没有 iCalendar 能力**，不是「实现得不好」，是「没有」。

## 接入点（评审通过后的正确落点，均不在本骨架内）

| 步骤 | 落点 | 说明 |
| --- | --- | --- |
| ① | 本包 `buildCalendar()` | 纯函数、无 IO、无副作用，入出都是普通对象 |
| ② | `packages/dsh-zhiyun-page-planning` | 页头「导出日历」动作：调 ①，`Blob` + `a[download]` 落地 |
| ③ | （可选）`dsh-zhiyun-host-*` | 若要服务端生成，才是宿主的活 |

## 实测（沙箱实跑 `ics@3.12.1`）

| # | 试了什么 | 结果 | 结论 |
| --- | --- | --- | --- |
| M1 | `createEvent` 传 `id` 字段 | **报错** `this field has unspecified keys: id` | schema 是 `noUnknown()`，**多一个字段整条拒绝** → 必须字段白名单 |
| M2 | 不传 `uid` 连生成两次 | 每次不同（`aXPsYcWAV4xBuUE_N_2JP`） | **默认随机 UID** → 每导出一次日历就多一套重复事件 |
| M3 | 显式传 `uid` 连生成两次 | 逐字相同 | UID 可固定 → 必须由 `(学期, 课程, 起始毫秒)` 确定性派生 |
| M4 | 传 `timezone: 'Asia/Shanghai'` | **报错** `this field has unspecified keys: timezone` | 上游**不支持 VTIMEZONE** |
| M5 | `startInputType:'local'` + `startOutputType:'local'` | `DTSTART:20261026T080000`（无 `TZID`） | **浮动时间**，跨时区导入会错 |
| M6 | 同上但 `startOutputType:'utc'` | `DTSTART:20261026T000000Z` | 08:00+08:00 换算正确 → **建议走这条** |
| M7 | 把 `Date(ms).getUTC*()` 拆出的数组当本地时间传 | `DTSTART:20261025T080000Z`（早 8 小时，**且不报错**） | 必须显式按 `Asia/Shanghai` 拆 |
| M8 | `valarm: [{ action:'display', trigger:{ hours:1, before:true } }]` | 产出 `TRIGGER:-PT1H` ✅ | 提醒可用，无需自己拼 |
| M9 | `createEvents` 批量 2 条 | 产出 2 个 `VEVENT` ✅ | 批量路径可用（回调式） |
| M10 | esbuild bundle | **76,577 B** | 大头是 yup 校验库 —— **成本争议点，见下** |

## 需要人工拍板的三件事

1. **75 KB 换「导出 .ics」值不值？** 上游为校验引入了 yup（占体积大头）。
   若产品认为不划算，可改判 🔵，改用「本仓手写 200 行 RFC 5545 子集」
   —— 但那样要自己处理折行（75 octet）、`,` `;` `\` 转义、`DTSTAMP`，出错难发现。
2. **时区走 UTC 还是浮动？** 见 M5/M6。建议 UTC（时刻正确优先）；若必须显示北京时间，
   `ics` 不满足，需换 `ical-generator@11.1.2`（MIT）—— 属**换上游**，不在本骨架内。
3. **改时间后旧事件删不掉**：UID 随起始时刻变化，用户日历里会留旧条目。
   UI 必须提示「改了时间会多出一条，需手动删除旧的」，**不许静默**。

## 硬边界

- 只读导出，**不写回**任何数据；**不做 .ics 反向同步**。
- `due` 为 null 的卡片**不生成事件**（不猜）。
- 不把 `sourceTitle` 原文 / 笔记正文写进 `DESCRIPTION`（日历会同步到云，最易泄露）。
- 不改上游源码；不接入 profile；`Owner: shared`。
