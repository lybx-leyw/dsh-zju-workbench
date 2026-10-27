# dsh-radar-repeat-law —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 与 `src/upstream.js` 只有占位与 TODO，
> `repeatLabelOf()` / `buildTermCalendar()` / `recallOnUndo()` / `apply()` /
> `loadUpstream()` / `toUpstreamRule()` / `translateUpstreamError()` 都直接抛错。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成性质：**强化式集成**（不是「全新」）—— 判 **🟢**，但判据 ① **带一条如实标注**

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ *（带标注）* | 落点是既有列表行的重复标记（`client.jsx:1759`）与既有勾选框（`:1742`），**本包自身不注册任何插槽、不新增页**。**标注**：上游 `@magma27/dsh-calendar` 自己注册了 `shell.overlay` / `sidebar.footer.action` / `settings.plugins.tab` 三处（`client/index.ts:97/104/113`）→ **只取它的 `core/repeat.ts`，不得整包挂载**；本骨架的 patch 只为做差分，带 `mountUpstreamUi: false` |
| ② 功能相似且正交 | ✅ | 现有回答「下一次是哪天」（推进一步）；新增回答「这一步该不该跨过寒假」「点错了能不能退回去」。同一条规则、不同不变量 |
| ③ 底层多调了更优质实现 | ✅ | 上游有、本仓**完全没有**的四件东西：`materialized`（已生成日期记账，日粒度、幂等）、`alignSeries`（规则收窄时剪副本并清账）、`originTaskId`（副本回链）、`skipHolidays` **与推进逻辑解耦**（本仓内联在 `advanceBy()` 里，改不动）。另有 `<RepeatScopeConfirm>` 把「这次 / 整个系列」做成确认，而本仓只有 `title` 气泡 |

> 判 🟢 的**唯一前提**是「只取 `src/core/repeat.ts`」。若评审认为 R1 无解（见下），
> 判据 ③ 只剩「记账 + 回链 + 三问」三个概念 → 那部分 **自写约 60 行**，应改判 🟡 或直接删除本骨架。
> **不套用**「上游更大就更好」的直觉。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [MAGMA27/dsh-calendar](https://github.com/MAGMA27/dsh-calendar) |
| npm | **`@magma27/dsh-calendar@0.1.7`**（`dist-tags.latest`，发布于 2026-10-01 06:12Z，本轮实查） |
| 许可证 | **Apache-2.0** ✅（GitHub `spdx_id = Apache-2.0`；仓库根 `LICENSE` **11,338 B 全文逐字读过**；npm `license` 同为 Apache-2.0） |
| 作者 | MAGMA27 |
| Stars | ★1（★ 不作为判据，见下） |
| 语言 | TypeScript（`src/` 源码随包发布，`lib/` 为产物；ESM） |
| 体积 | npm `unpackedSize` **1,498,324 B（≈1.4 MB）** —— 大头是 `lib/` + `src/` 双份 + 资源 |
| 依赖 | `dependencies`: `@deepseek-ai/schemastery@^3.18.4`；`peerDependencies`: `react@^18.2.0` |
| 宿主窗口 | 上游 README 明写 *targets DSH `0.2.0-rc.2`*；本仓 `runtime.lock.json` 的 `preferredHostVersion` **正是 `0.2.0-rc.2`** ✅（另含 `0.2.1-alpha.1`，上游未声明，需 `scripts/test-host.mjs` 复验） |
| 首次发现 | 2026-10-25（r66 · A 组 · DSH 插件生态 · 「重复规则的不变量」轴） |

---

## 已核实的缺口（本轮读码 + 实跑）

```bash
# ① 界面能传的 every 只有 1
grep -n "every: 1" packages/dsh-zhiyun-page-planning/src/client.jsx      # → :1482
grep -n "MAX_REPEAT_INTERVAL" packages/dsh-zhiyun-page-planning/src/local.js  # → 1..12，校验允许 2..12
# ② 本仓没有「已生成日期」这层记账
grep -rniE "materialized|原样回链|originId" packages/dsh-zhiyun-page-planning/src/   # → 0 命中
# ③ 本仓没有学校假期/调休概念
grep -rniE "寒假|暑假|校历|补班|调休" packages/dsh-zhiyun-page-planning/src/ packages/dsh-zhiyun-source-zdbk/src/  # → 0 命中
```

### F-1 · 引擎会做「每两周」，界面不会传（实跑）

`client.jsx:1482` 是字面量 `{ every: 1, unit: repeatUnit, anchor: repeatAnchor }`。
把同一份 `advanceBy()` 直接喂 `every: 2`：

```text
repeat = {"every":2,"unit":"week","anchor":"due"}，due = 2026-10-25T15:59Z
→ 下一次 2026-11-08T15:59:00.000Z   ← 正确（+14 天）
```

→ **不是缺实现，是缺入口**。与 r65（摘要条「数据齐全、出口没有」）方向相反：
这次是**能力在、入口缺**。`REPEAT_UNITS` 的注释也写着「每两周（某些实验）」是目标场景。

### F-2 · 撤销勾选后会留下一条重复副本（实跑，**这是本轮最重要的发现**）

`local.js:371` 的注释写「取消勾选不该生成下一次」，`tests/planning-repeat.test.mjs:181`
也只断言 `next === null`。但真实链路上，「下一次」在**第一次勾选**时就已经被
`LocalStore.setDone()` `push` 进 `items`、并被 `client.jsx:494` 插进列表：

```text
勾（10-25）      → 列表：原条目(done) + 下一次 11-01          【setDone 返回 next ✓】
取消勾（10-25）  → 列表：原条目(未完成) + 下一次 11-01        【setDone 返回 null ✓ 但那条仍在】
再勾（10-25）    → 列表：原条目(done) + 11-01 + **又一条 11-01**  【两条 id 不同、都未完成】
```

实测输出（`setDone` 三连调）：

```text
s1.next.id = p-tngs40-8b9gu  2026-11-01T15:59:00.000Z
s3.next.id = p-tngsko-23d39  2026-11-01T15:59:00.000Z
→ 同一截止日两条
```

`setDone()` 单测**全绿（31/31）** —— 因为单测测的是**返回值**，而缺陷在**返回值被消费之后**。
→ 这不是「再出一版实现」能修的问题，缺的是上游那套 **`originTaskId` + `materialized`**：
「这条副本是谁生的」与「这个日期已经生过没有」这两件事，本仓**都没有字段承载**
（实跑：生成的副本上 `originId` 为 `undefined`，该字段根本不存在）。

### F-3 · 上游的 `skipHolidays` 不能直接照搬（实跑）

```text
R2  2027-01-04 .. 2027-02-15 每周一 + skipHolidays:true
    → 2027-01-04 01-11 01-18 01-25 02-01 02-08 02-15（**七个**，全部生成）
R6  2026-10-10（周六，法定补班日）→ isWeekend = true → matchesRepeat(每天) = false（被跳过）
```

→ 上游的「假日」= **周末 OR 一张写死的 `PUBLIC_HOLIDAYS`**（2025 官方 + 2026 预计），
**没有**学校校历、**没有**调休补班表。本仓若直接 `skipHolidays: true`：
「每周背单词」会在寒假里继续冒；而补班的周六反而不生成。
→ 本包的立场：**只借「日粒度判定与推进解耦」这个结构**，假日的**内容**由本仓自建（TODO-3/TODO-4）。

### R5 · 「每两周」「每三月」「按完成日推进」在上游**无法表达**

上游 `RepeatRule.kind` 只有 `daily` / `weekly`，**没有 `every: N`**，也没有 `month` 与 `anchor`。
本仓的 `REPEAT_UNITS = ['day','week','month']` + `every: 1..12` + `REPEAT_ANCHOR = ['due','done']`
**必须原样保留**，上游只当「日匹配器」。

---

## 实测（沙箱实跑上游 `src/core/repeat.ts`）

把 npm tarball 里的 `src/core/repeat.ts` 抽出来，配两个 12 行的桩模块
（`calendar.ts` 提供 `addDays/dayKey/minutesOfDay`，`tasks.ts` 只出类型），
用 `node --experimental-strip-types` 直接跑 —— **不装整包**，因此不含任何 UI 副作用。

| # | 试了什么 | 结果 | 结论 |
| --- | --- | --- | --- |
| R1 | 查 npm 包 `exports` | `[".", "./src/*", "./client", "./invariant", "./package.json"]` | `lib/core/repeat.js` **没有子路径出口**；要么走 `./src/*`（TS 源码），要么整包载入 |
| R2 | 寒假里的每周一 | 7 个日期全部生成 | 「假日」里没有学校校历 |
| R3 | `repeatDatesBetween` 区间长度 | 传 61 天跨度 → **62** 个日期 | **闭区间**，照抄会多一条 |
| R4 | `buildRepeatCopy` 传模板自身日期 | 副本 `startAt` 与模板**逐字相同** | 模板日不自动占位，上游靠 `cursor = 次日` 规避 |
| R5 | 规则种类 | `daily` / `weekly` 两种 | 无 `every` / `month` / `anchor` |
| R6 | 2026-10-10（补班周六） | `matchesRepeat` = false | 缺「补班」这一侧 |
| R7 | `REPEAT_HORIZON_DAYS` | **60**（`host-scheduler.ts:136` 每 tick 调） | 上限明确，便于对照本仓「不预生成」的取舍 |
| R8 | `alignSeries` 剪枝 | 规则收窄时返回 `prunedIds` 并同步 `materialized` | 本仓完全没有对应能力 —— **这是判据③的主证据** |

> ⚠ 本次**未**验证：整包挂载（会注册三处 UI）、浏览器打包体积、`0.2.1-alpha.1` 宿主兼容。

---

## 接入点（评审通过后的正确落点，均不在本骨架内）

| 步骤 | 落点 | 说明 |
| --- | --- | --- |
| ① | `dsh-zhiyun-page-planning/src/client.jsx:1482` | 把 `every: 1` 换成选择器（TODO-1），`local.js` 校验已就位 |
| ② | `dsh-zhiyun-page-planning/src/local.js:361 setDone()` | 补「撤销时收回」对称分支（TODO-5） |
| ③ | `dsh-zhiyun-page-planning/src/local.js:203 advanceBy()` | 假日判定外提（TODO-3/4），**不改**既有推进算术 |
| ④ | `dsh-zhiyun-page-planning/package.json` | 锁版 `@magma27/dsh-calendar@0.1.7`（**不写 ^**，**不写 profile**） |

---

## 需要人工拍板的三件事

1. **TODO-0（阻塞）**：R1 让「只取 `core/repeat.ts`」在 npm 层不成立。三条路：
   A 让本仓构建链吃 TS 的 `./src/*`；B 整包载入（= 连带三处 UI，判据①破）；C 自写 60 行（= 不做集成，删骨架）。
   → **未拍板前本骨架不可实现**。
2. **TODO-6（迁移）**：已有重复条目没有 `generatedId`，撤销时只能靠 `title + due` 兜底 —— 会误删用户手写的同名条目。
   「不迁移（老条目仍留副本）」与「迁移（可能误删）」二选一。
3. **假期数据来源**：本包主张「用户自填起止日期」，不内置任何校历。若产品要「开箱即用」，需另议数据源（且涉及合规）。

## 硬边界

- **不改上游源码**；只调用；锁版 `0.1.7`（写死，不用 `^`）。
- **不整包挂载上游 UI**（`mountUpstreamUi: false`）；本包不注册任何插槽。
- **不预生成**：本仓沿用「勾完成时推进」，不照抄上游的 60 天物料化。
- **不内置校历**；不猜假期；没有起点就不生成下一次（沿用 `nextOccurrence()` 既有约定）。
- **不写 profile**；`Owner: shared`。
