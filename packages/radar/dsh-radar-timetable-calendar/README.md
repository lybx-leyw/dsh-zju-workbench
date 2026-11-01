# dsh-radar-timetable-calendar —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` / `normalizeWeekSpec()` / `calendarProps()`
> 与 `src/upstream.js` 的 `loadUpstream()` 都直接抛错。
> **请勿**把它加入任何 profile（`profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`），
> **请勿**在真实环境挂载。评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

把「第 3~16 周（双）、星期三、第 3~4 节」这类**教学周语义**换算成真实日期，
并补上标准 `VALARM` / `VTIMEZONE` 属性，交给课表面板的 `.ics` 导出。

## 关系判定：**强化式集成**（不是全新）

| 判据 | 本候选 | 依据 |
| --- | --- | --- |
| 仍是同一个面板？ | ✅ | 不新增导航项 / 槽位 / 路由。只向 `dsh-radar-ics-export` 暴露两个纯函数 |
| 功能仍相似正交？ | ✅ | 仍是「把课表带走」，不改做双向同步 / 订阅源 / 华师大浏览器扩展 |
| 底层多调了更优质实现？ | ✅ | 上游对「连续周 / 逗号列表 / 单双周 / `第X周` 前缀 / 全角波浪号」的解析覆盖完整，比本项目现有逐条手写更稳 |

## 类型：**B 类（其他 JS 项目）**，不是 A 类

上游 `ecnu-timetable-calendar` 是 **Chrome MV3 浏览器扩展**（原生 HTML/CSS/JS），
`package.json` 里 `"private": true` → **未发布 npm、无法锁版**，也**没有** `dsh.bundle.patch`。

因此本包走 **源码级借鉴**（MIT 允许），而不是 A 类的「锁版挂载 + 外围兼容层」。
`package.json` 的 `dependencies` 因此为空。

可借鉴文件白名单见 `src/upstream.js` 的 `UPSTREAM_ALLOWED_FILES`，
**不搬运** `content.js` / `api-hook.js` / `manifest.json` / `popup.html|css` / `mobile/` / `vendor/`。

## 不能做错的四件事

| 级别 | 事项 | 后果 |
| --- | --- | --- |
| P0 | `第X周` 前缀**先剥再切逗号** | 顺序反了 → 整段正则失配 → **静默丢课** |
| P0 | `～ — － 至` 一律归一成 `~` | 浙大课表常见全角 `～`，不归一则**一条都解析不出** |
| P1 | 单双周与周范围**同时**生效 | 「3~16(双)」须产出 4,6,…,16，不是 3~16 全部 |
| P1 | 周日 `日` / `天` 都映射到 7 | 漏一个 → 周日的课丢失 |

## 上游的两处不足（本项目侧需补）

1. **区间单调性未校验**：`16~3` 产出空数组且不报错 → 应记入 `unparsed[]`。
2. **周次上限硬编码 30**：浙大夏季短学期可能到第 31 周 → 应改为参数。

## 与相邻 radar 包的边界

| 包 | 负责 |
| --- | --- |
| `dsh-radar-timetable-calendar`（本包） | 周次语义解析 + `VALARM` / `VTIMEZONE` |
| `dsh-radar-ics-export` | `DTSTART` / `DTEND` 拼装、整体 `VCALENDAR` |
| `dsh-radar-ics-rrule` | `RRULE` 周重复压缩 |

三者**各改一半必然打架**，装配顺序须在评审时一并确定。

> ⚠ 若评审判定 `dsh-radar-ics-export` 不推进，本包应**一并驳回**。

## 上游

- 仓库：<https://github.com/marioMLLL/ecnu-timetable-calendar>
- 参考版本：`1.9.1` · MIT · ★8 · 最后推送 2026-09-22
- 评分理由见 `docs/ecosystem-radar/` 对应时段报告
