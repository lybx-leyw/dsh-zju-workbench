# dsh-radar-timetable-week-axis —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` / `normalizeWeeks()` / `weekNumberFromDate()`
> 与 `src/upstream.js` 的 `loadUpstream()` 都直接抛错。
> **请勿**把它加入任何 profile（`profiles/zju-workbench/package.json` 的 `dsh.profile.bundles`），
> **请勿**在真实环境挂载。评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

给课表补一条**周次轴**：把「这堂课到底是哪几周上」从**一串散落日期**归一成
「第 start–end 周、按 step 步进」，并给出「某天属于学期第几周」。

这是两个已在册骨架一直缺的前置能力 —— `dsh-radar-ics-rrule` 的 README 明写：
> 本仓课表条目**没有周次 / 节次号**，调课会让分组碎裂。

## 关系判定：**强化式集成**（不是全新）

| 判据 | 本候选 | 依据 |
| --- | --- | --- |
| 仍是同一个面板？ | ✅ | 不新增导航项 / 槽位 / 路由。只导出两个纯函数给课表与「规划」页内部调用 |
| 功能仍相似正交？ | ✅ | 仍是「这周这节在哪上课」与「课表带走」，不改选课、不改教室预约 |
| 底层多调了更优质实现？ | ✅ | 上游把 `weeks` 的**四种编码**统一收敛，并算清「学期第几周」的边界；本仓这块是零 |

## 类型：**B 类（其他 JS 项目）· 纯能力提取**

上游 `CPLADRAGON/nus-vacansee` 是 **Next.js 16 + TypeScript 站点**：
`private`、无 npm 发布、无 `dsh.bundle.patch` ⇒ **不可锁版**。
故 `dependencies` 为**空**，只借鉴「数据形状 + 判定规则」，实现自行编写（见 `ATTRIBUTION.md`）。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [CPLADRAGON/nus-vacansee](https://github.com/CPLADRAGON/nus-vacansee) |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id` 实查） |
| Stars | ★1（2026-05-27 建，最后推送 2026-08-23） |
| 语言 | TypeScript（Next.js 16 + Tailwind） |
| 体积 | 19,942 KB（含演示数据） |
| 参考文件 | `src/lib/nusmods.ts`（`normalizeWeeks` / `weekNumberFromDate` 的原始形状） |
| 首次发现 | 2026-11-07（C 组 · 学生功能域 · 「课表带走」轴） |
| 锁版 | ❌ 不可（站点非库） |

## 为什么值得：它填的是已有骨架的坑，不是再造一个课表面板

| 已有骨架 | 它缺什么 | 本包怎么补 |
| --- | --- | --- |
| `dsh-radar-ics-export` | 只有「逐条展开」，没有周次概念 | 提供「哪几周」 |
| `dsh-radar-ics-rrule` | 组不连续就退回逐条，因**没有周次 / 节次号** | 提供 `contiguous()` 判据所需输入 |
| `dsh-radar-timetable-calendar` / `week-parser` / `tongge-schedule` | 各自手算「第几周」 | 统一到一处，四种编码通吃 |

> **判据①仍是同一个面板**：本包不承载任何页面。若评审判定 `ics-export` / `ics-rrule` 不推进，
> **本包可独立保留**（「今天」页算「第几周」也要它）；反向也成立。

## 四种 `weeks` 编码（必须全吃，缺一种就静默丢整学期）

| 形状 | 含义 |
| --- | --- |
| `number[]` | 显式周号列表 |
| `{ start, end }` | 闭区间 |
| `{ start, end, weeks }` | 以 `weeks` 为准，`start/end` 作钳位 |
| `{ start, end, weekInterval }` | 按间隔步进，缺省 1 |

## 接入点（评审通过后的正确落点，均不在本骨架内）

| 步骤 | 落点 | 说明 |
| --- | --- | --- |
| ① | 本包 `normalizeWeeks()` | 纯函数、无 IO、无副作用 |
| ② | `packages/dsh-zhiyun-page-planning` | 「今天 / 本周」区块显示「第 N 周」 |
| ③ | `dsh-radar-ics-rrule` 评审时 | 用「组是否连续」决定 RRULE 还是逐条 |

## 需要人工拍板的四件事

1. **周号从「教学周」还是「自然周」起算？** 上游按「学期首周周一」起算；浙大校历有
   「报到周 / 考试周」，是否需要 `weekOffset`？建议**加一个显式 offset 参数**，不猜。
2. **「单双周」怎么表达？** 上游用 `weekInterval: 2` —— 但**单双周的奇偶锚点**必须随学期走，
   否则同一门课会在隔一周的错位周次上出现。
3. **调课（第 8 周停一次）**：`weekInterval` 表达不了，必须退回显式周号数组。
   建议：**只要能拿到显式列表就用列表**，区间形态只在没有列表时兜底。
4. **时区**：上游用 `new Date(iso).getTime()` 直减毫秒 —— 在 UTC+8 的 23:00 后会偏一天。
   建议实现时**按本地日**（`YYYY-MM-DD` 拆 `{y,m,d}` 后 `Date.UTC` 比较），不改上游。

## 硬边界

- 纯计算，**不落盘、不发网络**。
- 不搬运上游源码；只借鉴形状与规则（见 `ATTRIBUTION.md`）。
- 不改上游仓库、不碰他人 `OWNERS`；不接入 profile；`Owner: shared`。
