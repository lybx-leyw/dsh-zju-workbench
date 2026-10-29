# dsh-radar-week-parser —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` 被调用即抛错，
> `src/upstream.js` 的三个函数全部 `throw`。
> 评审通过前**不得**加入 `profiles/zhiyun-bench` 的 `dsh.bundle` 清单。

---

## 集成性质：**强化式集成**（不是全新功能）

本包**不新增面板**。它补的是 `dsh-radar-ics-export` 缺的那一层「周次语义」。

### 三条判据核验

| 判据 | 成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 不新增导航 / 插槽 / 路由。只被 `ics-export` 的 `buildCalendar()` 内部调用 |
| ② 功能仍相似正交 | ✅ | 仍是「课表 → .ics」，只是同一门课从 16 条独立事件收敛为 1 条可整体删除的重复事件 |
| ③ 底层多调了更优质实现 | ⚠ **部分成立** | 「中文周次字符串解析」本仓**完全没有**（三源三形态），上游被中文真实数据打磨过。**但 RRULE 仍须 `ics-rrule` 的 `rrule@2.8.1`**，本包不生成 RRULE |

> **③ 的边界必须说清**：本包是 `ics-rrule` 的**上游数据供给**，不是替代品。
> 二者**串联**：`week-parser`（周次数组）→ `ics-rrule`（RRULE）→ `ics`（序列化）。
> 若把本包理解为「RRULE 方案」，属误读。

---

## 上游

[shou-graduate-calendar-exporter](https://github.com/wowhao333/shou-graduate-calendar-exporter) · **MIT** ✅ · v0.1.1

- `core/schedule.js`（319 行）—— **只借** `parseWeeks()` 与 `inferWeekOneMonday()` 的行为规格
- `core/exporters.js`（135 行）—— **不借**（理由见下）

### 为什么只借两个函数，不整包引入

| 上游能力 | 本仓现状 | 判定 |
| --- | --- | --- |
| 75 字节折行 `foldIcsLine()` | `ics-export/src/index.js:28` 已写明 RFC 5545 折行 | 不借 |
| 手写 `TZID:Asia/Shanghai` + `VTIMEZONE` | `ics-export/src/upstream.js:126-130` 已实测：上游 `ics` 传 `timezone` **直接报错**；且「UTC/浮动」已判定为**产品拍板事项** | 不借 |
| `stableUid()` | 本仓 TODO-C 规格更严（`termKey+courseTitle+startMs` 三元组） | 不借 |
| `findConflicts()` | `page-today/src/agenda.js` 已有 agenda 同日投影 | 不借 |

> 整包引入 = 用「未测的手写 ICS」替换「已测的上游 `ics` + 已知坑」 → **净损失**。

---

## 本仓为什么真的缺这两格（三条实证）

1. `packages/dsh-zhiyun-source-xxt/src/parse.js:372` → `weeks: lesson.weeks ?? null`，**原样透传，形态未定**
2. `packages/dsh-zhiyun-source-zdbk/src/parse.js:297,343` → `'all' | 'odd' | 'even'`，**只有单双周，无区间**
3. `packages/radar/dsh-radar-ics-rrule` → 自述「本仓课表条目**没有周次 / 节次号**」

→ 三个源三种形态，**中间缺一层归一化**。

---

## 已知缺陷（上游有，本仓**不得照抄**）

**P0 · 单双周混写静默截断**

上游：`含"单" ? 1 : 含"双" ? 0 : null`
→ 「周一(单), 周三(双)」会被判成**纯单周**，**双周课全丢，且不报错**。

本仓要求：返回结构化 `parity: 'odd' | 'even' | 'both' | 'mixed'`，
`mixed` 时由调用方明确决定「报错」还是「全留」。

---

## 实现前必须人工确认的两件事

1. **`xxt` 的 `lesson.weeks` 真实形态**（字符串？数组？掩码？）—— 无样本不许实现
2. **`zdbk` 的学期总周数从哪来** —— `fromParity()` 必须有它才能展开 `odd/even`

---

## 目录

```text
package.json     # B 类：零 runtime deps（上游是 MIT 扩展，无可锁版 DSH 包）
src/index.js     # 占位入口，apply() 抛错
src/upstream.js  # 上游两函数的行为规格（含实证、边界、缺陷），非源码
README.md        # 本文件
ATTRIBUTION.md   # MIT 归属（CONTRIBUTING 3.3）
OWNERS           # Owner: shared
```

**无 `cordis.patch.yml`** —— B 类不提供 `dsh.bundle.patch`；本包不注册服务，只被调用。

---

## 评审结论

- [ ] 通过 → 落实 `src/upstream.js` 三个 TODO，改 `ics-export` 调用方
- [ ] 驳回 → **整目录删除**（本包零副作用）

**本包未评审、未接入 profile、不可直接使用。**
