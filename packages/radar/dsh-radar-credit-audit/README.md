# dsh-radar-credit-audit —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` **直接抛错**，本包**不 import 上游**，
> 也没有任何业务逻辑。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

把「已获学分」从**一个数**（`reads.js` 的 `earned_credits`）变成**按培养方案模块拆开、逐条可溯源到方案页码**的达成度报告，渲染进**已有的**学分/GPA 看板。

**集成方式：强化式集成（重复且可强化），不是「全新」。**

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| 仍是同一个面板 | ✅ | 落点是 `dsh-zhiyun-source-zdbk/src/reads.js` 的 `gpaOf()` 结果（`earned_credits` / `gpa_credits`）；不新增页、不新增路由、**本包零 UI** |
| 功能仍相似正交 | ✅ | 现有 = **总数 + GPA**（一个口径、一个数）；接入后 = **同一个数**再按模块拆开 + 缺口 + 在修证据。同一件事的两个粒度，不是两件事 |
| 底层多调了更优质实现 | ✅ | 现有 = 学分加权求和（`gpaOf`）；接入后 = 确定性规则引擎（选课组「至少 N 门」折算、外语 L1/L2/L3 封顶、并列选项组、在修降级 red→yellow）+ JSON Schema 契约 + 双实现对拍 |

**它和「再做一套成绩查询页」的区别**：本包不查成绩、不算 GPA、不画图。它只吃 `reads.js` 已经算好的行，回答「这些学分**分别**顶掉了培养方案的哪一条」。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [Kepler16f/zju-kezhou](https://github.com/Kepler16f/zju-kezhou)（课舟 ClassArk） |
| 类型 | **B · 其他 JS/Python 项目** —— 无 `dsh.bundle.patch`、无 `cordis.patch.yml`、无 `package.json`（contents API 实测 `Not Found`） |
| npm | **无包**（`registry.npmjs.org/zju-kezhou` → `Not found`）→ 不能直接锁版，见 TODO-0 |
| 许可证 | **MIT** ✅（`LICENSE` 正文 1,664 B 逐字 MIT；GitHub `spdx_id` 报 `NOASSERTION`，原因是正文后附了「第三方说明」，见下） |
| 作者 | `Copyright (c) 2026 KeZhou (ClassArk) contributors` |
| 活跃度 | ★0，建仓 2026-10-15，push 2026-10-21（6 天内 8 次迭代，`ENGINE_VERSION` 已到 1.7） |
| 可复用资产 | `engine/`（`audit.py` 54 KB + `common.py` 3 KB，**纯 stdlib**）、`schema/`（`plan`/`record`/`report` 三份 JSON Schema） |

### 关于 `NOASSERTION`（本轮已通读，不是猜的）

`LICENSE` 的结构是：

```
MIT License … 标准 MIT 正文（逐字，无改动）……
------------------------------------------------------------------------------
第三方说明（Third-party notices）
1. Celechron（GPL-3.0）—— 只说「接口事实参考了它」，并声明「网络层、解析层与限频实现均为独立编写，未复制或翻译其源代码」
2. Noto Sans SC 字体（OFL-1.1）—— 仅 assets/fonts/
3. Flutter 及构建工具链 —— 各自许可
```

判定：**本项目自身授权 = MIT ✅**；附件是「第三方组件声明」，不改变授权范围，也不构成 copyleft 传染。
但为把风险压到零，本轮只考虑 `engine/` 与 `schema/` 两个目录，**不碰 `assets/`（OFL 字体）与 `compass_app/`（Flutter UI）**。

> ⚠ 这只是雷达的判定，**不替代法务意见**。评审可要求上游把「第三方说明」移到 `NOTICE` 文件，
> 这样 GitHub 就能正确识别为 MIT（对下游有实际好处）。

---

## 三条判据为什么成立（细节）

### ① 仍是同一个面板
`reads.js` 的 `grades()` 返回 `{ scope, summary: gpaOf(selected), grades, skipped_items, note }`，`summary` 里已有 `earned_credits`。
本包装的 `audit(record, plan)` 输出**按模块的 `earned / gap / remaining_future`**，展示位置就是这个 `earned_credits` 旁边。
不新建面板 = 判据①不是口头承诺，而是**结构上不可能**（本包没有 `slots` 注入点）。

### ② 功能仍相似正交
| | 现有 | 接入后多出来的 |
| --- | --- | --- |
| 回答的问题 | 「我拿了多少学分」 | 「这些学分顶掉了方案的哪几条、还差几条、差的能不能选到」 |
| 粒度 | 单个数 | 模块树（到叶子课） |
| 时间性 | 已修 | 已修 + 在修 + 计划 |

### ③ 底层多调了更优质实现
上游引擎**不是**「另一个求和」，而是一组本仓确实没有的口径：

| 口径 | 本仓现状（2026-10-25 实查） | 上游 `audit.py` |
| --- | --- | --- |
| 选课组「四选一 / 选 N 门」 | 无 | 按「至少 N 门」折算要求学分，**不再全组求和**（v1.3 修过一次重复计分） |
| 外语等级封顶 | 无 | L1=6 / L2=4.5 / L3=3；2026 级起新规单独一支 |
| 已选 vs 已获 | `counted_in_credits` 一个布尔 | `selected_no_credit` **单列**，与 `earned` 分开展示 |
| 在修证据 | 无（没有「计划」这一层） | `planned_courses` 覆盖缺口时 red→yellow，注记「已在修，待出成绩」 |
| 并列选项组 | 无 | 组行取最优选项计一次，落选项的缺口警告一并清除 |
| 可溯源性 | 无 | `trace` / `page` 字段，结论可回到方案页码 |

---

## 阻塞项（评审必须先拍板，代码写不了）

### TODO-0（**阻塞**）· 上游怎么进来
不是 DSH 插件、没有 npm 包 → **不能「锁版挂载」**。三条路线见 `src/index.js` 的 TODO-0，推荐 (a) vendor：
把 `engine/` 原样发到内部 scope 的 `dsh-radar-credit-audit-vendor@1.7.0`，本包依赖精确版本。
`package.json` 里现在就写着这个尚不存在的版本 —— **刻意的**：未拍板前它不该能装上。

### TODO-1（**阻塞**）· 学期口径换算
本仓 `semester` 是 `1..4`（且正则只认 `-1/-2`，`-3/-4` 会漏网原样变成 3/4）；引擎是 `'YYYY-A'`/`'YYYY-B'` 两段制。
两套制式之间**不是一一映射**（详见报告 §3）。适配层必须先定义一份单一真源的学期序号，再做双向映射并写测试。

### 其余待拍板
- **TODO-2** 落点：`earned_credits` 旁的展示形态；`page-today` 是否要「距毕业还差 X 学分」。
- **TODO-3** 输入契约：`score`（原文，可能是「合格/优秀」）→ `grade`（0–100）必须走 `hundredOf()`；`counted_in_credits ≠ passed`。
- **TODO-4** 方案数据源：直连 `pyfagl` / 本地 golden / 用户上传 PDF，三选一；**匹配有歧义必须让用户点选**。
- **TODO-5** 输出：`disclaimer` 是 `report.schema.json` 的 **required** 字段，必须**显示**（不能只放 tooltip）。

---

## 可白拿的三条（不需要集成本包）

即使本骨架被驳回，下面三条**应该抄进本仓**，成本都不高：

1. **双实现对拍**：上游 `audit.py` 与 `audit.dart` 两份实现，由 `eval/cross_engine_parity.py` 逐字段比对并要求一致。
   本仓 50+ 骨架**无一**有这样一层。最小落地：把 `gpaOf()` 的输入输出存成 golden JSON，改实现时对拍。
2. **「LLM 读和说，代码算对错」的分工**：上游把学分/先修/冲突一律交给确定性引擎，LLM 只写叙述。
   本仓若将来让 LLM 解释「你还差哪些学分」，应当**只让它读 report，不让它算**。
3. **接口事实清单**（`docs/培养方案接入说明.md`，真机实测，可直接抄成 TODO 注释）：
   方案列表 body **只能**含 `queryModel.showCount=5000&currentPage=1&_search=false`；主键是 `pyfaxx_id`/`jxjhh`；
   年级取行政班末四位**前两位**；明细/打印端点学生账号多回 **HTTP 910**。

---

## 本骨架**不做**什么

- ❌ 不提供选课建议、不自动选课（上游 CI 有 `eval/check_readonly.py` 机械拦截写接口）。
- ❌ 不重复算 GPA（仍由 `gpaOf()` 负责）。
- ❌ 不做培养方案 PDF OCR（那是 TODO-4 (iii) 的独立工作）。
- ❌ 不调 LLM（引擎是确定性的；解释性文字由调用方决定要不要加）。
- ❌ **未接入 `profiles/zhiyun-bench/package.json`**，也不会接入。

---

## 已知未做（不要让本文看起来像「已经能用」）

| # | 未做 | 说明 |
| --- | --- | --- |
| U-1 | 引擎**未实跑** | `audit.py` 依赖 `import common`（同级模块），沙箱内未建 vendor 包、未跑任何 golden 记录 |
| U-2 | `run_audit.py` 的 CLI 入参**未读** | 只知道 Dify 形态的 `main(record_json)`，CLI 形态是推断 |
| U-3 | 学期映射的**双向测试**未写 | TODO-1 落地后的第一件事 |
| U-4 | 方案匹配的**歧义处理**未设计 | 上游有 `PlanMatchResult.ambiguous`，本包需决定是照抄还是简化 |
| U-5 | 与 `page-planning` 的关系未定 | 「计划选课」在本仓目前没有数据结构 |

---

## 相关登记

见 `docs/ecosystem-radar/registry.md` 的「第六十四轮」段与 `docs/ecosystem-radar/2026-10-25-r64.md`。
