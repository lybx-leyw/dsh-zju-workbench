# dsh-radar-deadline-budget —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 与 `src/upstream.js` 只有占位与 TODO，
> `budgetSummary()` / `remainMs()` / `apply()` / `loadUpstream()` / `toUpstreamDeadline()` /
> `toUpstreamInterval()` / `translateUpstreamError()` 都直接抛错（已实跑核实）。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。
>
> **`dependencies` 是空的**，这是刻意的：上游包在 npm 上不存在（下方 R1），
> 写上去只会在 `npm install` 时 404。

---

## 集成性质：**强化式集成**（不是「全新」）—— 但判 **🟡 需移植改造**，不是 🟢

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 落点是 `dsh-zhiyun-page-planning/src/time.js` 的 `focusSummary()`，消费者是**既有**的 `FocusBar`（`client.jsx:848` 组装、`:1272` 渲染）。本包 `apply()` 无 `inject`，**结构上不可能新建页** |
| ② 功能相似且正交 | ✅ | 现有：**点估计**——「这会儿有几件火烧眉毛了」（overdue / 24h / 3 天内，数个数）。新增：**面估计**——「这一周压不压得住」（按剩余自然日分桶）。同域不同粒度 |
| ③ 底层多调了更优质实现 | **⚠ 仅部分成立** | 上游 `Deadline.msUntil()` 比本仓手写减法只多「负值精确到毫秒」；而本包要用的只有两个语义，**自写约 30 行**（见下「为什么不是 🟢」） |

> 判据 ③ 不成立到位 → **不能判 🟢**。r64 的 `dsh-radar-credit-audit` 是三条全成立才判 🟢；
> 本包不套用那个结论。这也是本轮**没有**简单地去「接一个重复功能」。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [SifisoScS/scheduler](https://github.com/SifisoScS/scheduler) |
| 包名（声明） | `@sifiso-guy/scheduler` |
| 版本（声明） | `0.1.0` |
| **npm 状态** | **404 —— 从未发布**（实测 `https://registry.npmjs.org/@sifiso-guy%2Fscheduler` → `{"error":"Not Found"}`，2026-10-25） |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id = MIT`；仓库根 `LICENSE` 1,066 B；`package.json.license = MIT`） |
| 作者 | Sifiso Cyprian Shezi |
| Stars | ★0（建仓 2026-10，`pushed_at` 2026-10-13） |
| 形态 | 纯 ESM/CJS 双构建值对象库，`sideEffects: false`，零 runtime 依赖（仅 devDeps） |
| 源码体量 | `src/index.ts` 530 B + `src/deadline/index.ts` 5,138 B + `src/interval/index.ts` 7,937 B，**已全文通读** |

### 它到底是什么（通读后的结论，不是读 README 的产品描述）

只导出 **两个类 + 一个两行函数**：

| 导出 | 形状 |
| --- | --- |
| `Deadline` | `new Deadline(dueDate: Date, description?)` → `isOverdue(now)` / `msUntil(now)` / `toJSON()` / `fromJSON()` / `static compare(a,b)` |
| `Interval` | `new Interval(startsAt: Date, everyMs: number)` → `occurrenceAt(i)` / `nextOccurrenceAfter(now)` / `countBetween(from,to)` / `occurrencesBetween(from,to,limit)` / `nextDeadline()` |
| `validate` | `(x) => x != null` —— 两行，无实义 |

它是**值对象层**，不是调度器：**没有**「把 N 个任务排进 M 天」的算法，**没有**可用时间、
**没有**优先级、**没有**冲突消解。名字里的 `scheduler` 不要当成能力。

---

## 缺口（本轮读码 + 实跑，可复现）

### 1. 本仓摘要条只覆盖「3 天内」，且口径与死代码 `urgencyOf` 不一致

| 口径 | 位置 | 说明 |
| --- | --- | --- |
| `urgencyOf()` | `time.js:371` | 注释自称「`today`＝24h 内 / `week`＝7 天内」 |
| `focusOf()` | `time.js:78` | **多一档 `soon`**，`today` 收窄成「3 天内」 |
| `focusSummary()` | `time.js:120` | 只累加 `overdue / soon / today` |
| `FocusBar` | `client.jsx:1272` | 只渲染这三档 |

`urgencyOf` 在本仓**只剩导出、零调用**（`grep -rn "urgencyOf"` 只命中定义处与
`index.js:34/547` 的转出）→ 是**死代码**；但 `time.js:71` 的注释仍在用
「与 `urgencyOf` 的区别」来解释 `focusOf`，读代码的人会以为它还在用。

实测（沙箱 Node 22.13，`now = 2026-10-25 09:00 +08`）：

| 条目 | `urgencyOf` | `focusOf` |
| --- | --- | --- |
| 今晚 23:59 | `today` | `soon` |
| 明早 08:00 | `today` | `soon` |
| 10-27 23:59（后天） | `week` | `today` |
| 10-30 23:59（本周五） | `week` | `week` |
| 11-04 23:59（下周三） | `later` | `later` |

```
focusSummary(上面 5 条) → { overdue: 0, soon: 2, today: 1 } → 摘要条显示 3 条 / 实际 5 条
单条「本周五 10-30 截止」→ { overdue: 0, soon: 0, today: 0 } → 摘要条上完全不出现
```

> ⚠ **本包不宣称这是 bug**。「3 天覆盖」可能是刻意的（`time.js:47` 注释解释 `soon`
> 是为了分「今晚 vs 明早」）。本包只把差距**量出来**，要不要改由产品拍板（TODO-2）。
> 真正可以确定的缺陷只有一条：**两套口径并存 + 其中一套是死代码**。

### 2. 课表是「墙钟 + 不等距」，`Interval` 表达不了

`packages/dsh-zhiyun-source-zdbk/src/parse.js` 的 `PERIOD_TIMES` 实测：

```
第1→2节 08:00→08:50 = 50 分
第2→3节 08:50→10:00 = 70 分（大课间）
第5→6节 11:40→13:25 = 105 分（午休）
→ 13 个节次之间共 3 种不同间隔 {50, 70, 105}，12 处不等距
```

所以「一周 = 604800000 ms」能表达「每周同一时刻」，**表达不了「第 3 节是 10:00」**。
再加上单双周（`parse.js:341` 的 `weeks: 'odd' | 'even'`）与学期边界，课表周期**必须由本仓自己算**。

### 3. `Deadline.compare` 不能直接替换现有排序（但现有排序是对的）

`client.jsx:865-869` 用 `due ? Date.parse(due) : Infinity` 排序。实跑 `今晚 → 明早 → 没填时间`，
**结果正确**。而上游 `new Deadline(null)` 会 `throw`（`assertValidDate`）——
所以「换成上游比较器」必须先按 `due == null` 分流。

> 本包**不修一个不存在的 bug**，只把正确做法写进 `SORT_CONTRACT` 常量。

---

## 为什么不是 🟢

三条判据里 ③ 只部分成立。具体数字：

| 本包真正需要的语义 | 上游 | 自写成本 |
| --- | --- | --- |
| `剩余毫秒 = due - now`（负值即过期） | `Deadline.msUntil(now)` | 1 行 |
| `窗口内有几个周期` | `Interval.countBetween(from, to)` | 约 6 行 `Math.ceil` 差 |
| `due == null` 分流 | ❌ 不支持（构造即抛） | 3 行 |
| 墙钟周期（每周一 08:00） | ❌ 只有等距 `everyMs` | 约 15 行 |
| 单双周 / 学期边界 | ❌ | 约 10 行 |

**合计自写约 35 行**，而上游还要先解决「npm 上没有」的问题（R1）。
再加 ★0、建仓不足 1 个月 —— 引入它换来的「更优质底层」**不足以覆盖接入成本**。

→ 判 **🟡 需移植改造**：建议**先把「本周压力」这一维在本仓实现**（不需要外部包），
再回头看 `Deadline` / `Interval` 是否值得为「统一减法口径」引入。

---

## 已实测的硬约束

| # | 约束 | 证据 |
| --- | --- | --- |
| R1 | **npm 上不存在**，不能锁版 | `registry.npmjs.org/@sifiso-guy%2Fscheduler` → `{"error":"Not Found"}`。仓库 `package.json` 有 `publishConfig`/`prepublishOnly`，但从未发过 |
| R2 | **构造即抛**：`new Deadline(null)` / `new Interval(d, NaN)` 直接 `throw Error` | 源码 `assertValidDate()`；本仓 `due: null` 是常态（`plans.js:178`） |
| R3 | **`occurrencesBetween` 会物化 `Date[]` 且有硬上限 1000** | `DEFAULT_LIMIT = 1000`，超限抛 `RangeError`。一个跨学期窗口就能触发 → 本包只用 `countBetween` |
| R4 | **等距 ≠ 墙钟** | 见上文条 2；中国无夏令时，所以「周」这个粒度侥幸不出错，但课表节次不行 |
| R5 | **`files: ["dist"]`**，源码不进包 | 若永远不发 npm，`dist/` 也不存在 —— 不是「版本旧」，是「没有可安装物」 |

---

## 接入点（评审通过后）

1. 本包只导出**纯函数**（`budgetSummary` / `remainMs`），无副作用、无 IO、无 `inject`；
2. `dsh-zhiyun-page-planning/src/time.js` 的 `focusSummary()` 增补一列，
   或新增 `budgetSummary()` 由 `client.jsx:848` 那个 `useMemo` 一并计算；
3. 依赖锁版写在 `dsh-zhiyun-page-planning/package.json`，
   **本骨架的 `cordis.patch.yml` 评审后删除**（与 `dsh-zhiyun-host-paper` 锁
   `@ggboy123/dsh-paper-reader@1.3.1` 同一套做法）。

**硬边界**：

- **不改上游源码**；不 vendor 上游（TODO-0 未拍板前）。
- **不与课表相减**：「还剩几小时」需要本仓自己的「本周空档」函数，本包只报条数与天数。
- **不新增第三套紧迫度口径**：`budgetSummary` 必须把 `focusSummary` 的结果原样带出，
  不得重算 `overdue/soon/today`。
- **不做 UI 改动**：摘要条要不要多一档，是 TODO-2 的产品拍板项。

---

## 文件

```text
packages/dsh-radar-deadline-budget/
├── package.json      # dependencies 为空（R1）；dsh.bundle.patch 指向下面那份
├── cordis.patch.yml  # 单条 insert，供评审做「挂上 / 摘掉」差分
├── src/index.js      # TODO-0..TODO-5，apply() 直接抛错，无 inject
├── src/upstream.js   # 锁版凭据 + 上游「是什么 / 不是什么」，零业务逻辑
├── README.md         # 本文件
└── OWNERS            # Owner: shared
```

本包**无借鉴代码**，故无 `ATTRIBUTION.md`（上游 MIT，通读后只记录语义，未复制实现）。
