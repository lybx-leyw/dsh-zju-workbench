# dsh-radar-mastery-bkt —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-10-22 · 第 49 轮 · C 组派生「知识点归因底层轴」），
> **仅用于人工评审**。这不是一个可用插件：`src/index.js` 的 `apply()` 只打一行日志、
> `adapt()` 直接抛 `NOT_IMPLEMENTED`，`src/upstream.js` 的 `loadUpstream()` 永远返回 `{ ok: false }`。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载，**不要**从本包引入能力。

## 集成方式：**强化式集成**（不是全新功能，也不是简单集成）

| 判据 | 本包怎么满足 |
| --- | --- |
| ① 仍是同一个面板 | 「学习」页出题区（`dsh-zhiyun-page-study/src/quiz-panel.jsx`）的知识点区里多一个数，**不新开导航项、不加插槽** |
| ② 功能仍相似正交 | 现有：`makePointMastery`（`dsh-zhiyun-quiz/src/store.js:288`）回答「**这次**对不对」——可解释规则、人能核对。新增：BKT 回答「**这个点**现在大概掌握了多少」——跨题聚合、可排序。同域不同问题 |
| ③ 底层多调了更优质实现 | 本仓 `grep -rn "FSRS\|IRT\|BKT" packages/dsh-zhiyun-quiz/src` **只有注释、没有实现**；上游给的是四参数 BKT + 网格拟合，且不是本仓自写 |

**它不是**「再做一个复习面板」，也**不替代**现有的规则口径：规则继续显示（人要能核对），
BKT 后验只在 `responseCount ≥ 3` 时作为附加信息出现。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/RudrenduPaul/MasteryTrace |
| npm | `masterytrace-cli@0.1.3`（2026-09-25 发布） |
| 许可证 | **MIT**（包内 `LICENSE` 实文：`MIT License / Copyright (c) 2026 Rudrendu Paul and Sourav Nandy`） |
| 作者 | Rudrendu Paul、Sourav Nandy |
| 活跃度 | 仓库 ★0，建仓 2026-07-15，push 2026-10-20 |
| 锁定版本 | `masterytrace-cli: "0.1.3"`、`zod: "4.6.5"`（**写死，无 `^`**） |

### 为什么是它，而不是 `geekie/irt-js`（★16，同为 MIT）

| 检查项 | `masterytrace-cli@0.1.3` | `irt-js@0.2.0` |
| --- | --- | --- |
| 安装实测 | `npm i masterytrace-cli@0.1.3` → **added 3 packages in 2s** ✅ | 未装 |
| 能力 | BKT（四参数 + 网格拟合）**+** 2PL IRT | 只有 EAP 能力估计，**不含题目参数估计** |
| 能否在本仓数据量下用 | 能（3 条作答即可出后验） | **不能**：`estimateEAP(answers, zeta)` 要调用方先估出每题参数，本仓每题 1–3 次作答估不出来 |
| 最后更新 | npm 2026-09-25 / 仓库 2026-10-20 | npm **2017-09-15** / 仓库 **2019-07-15** |

## 增强的是哪个现有功能（改哪里）

| 位置 | 现在 | 接入后 |
| --- | --- | --- |
| `dsh-zhiyun-quiz/src/store.js:288` `makePointMastery` | `masteryLabel` → `近 3 次都错（共做过 3 题，错 3 题）` | 同一行**追加** `后验 0.06（基于 3 次作答）`；规则文案**保留** |
| `dsh-zhiyun-quiz/src/store.js:678` `masteryOf` | 全仓**零调用**（见下） | 成为 BKT 的输入出口，同时被出题面板消费 |
| `dsh-zhiyun-page-study/src/quiz-panel.jsx` | 只有待审 / 复习队列 | 「这个知识点你答得怎样」小结（数据来自 `masteryOf` + 本包） |

## ⛔ TODO-0（阻塞项 —— 评审须先裁决这个，再谈接入）

**`pointIds` 到不了题上。** 三条独立证据（均实测）：

```js
// ① makeItem 不收
makeItem({ ..., pointIds: ['kp-1'] })  →  Object.hasOwn(item, 'pointIds') === false
// ② itemToJson 不序列化（model.js:517）→ 落盘后更不可能有
// ③ workbench.js:390 quizMaterials() 构造材料时不填 pointIds
```

后果：`pointIdsOf(q)` 在真实数据上**恒返回 `[]`** → BKT 的 `skillId` 只能是空串，
整个估计退化成「按 `blockIndex` 估」——那是**块**不是**知识点**，价值大打折扣。

修法约 **5 行、零新依赖**（`makeItem` 加字段 + `itemToJson` 序列化 + `quizMaterials` 填值），
属**业务代码**改动 —— 不在生态雷达的授权范围内（雷达不改业务代码）。
**建议：先补环，再接 BKT。**

## 上游实跑证据

```js
// 同一知识点 3 次「忘了」（selfRecall='again' → correct=false）
new BktModel().fit([
  { learnerId:'l1', skillId:'kp-1', correct:false, timestamp:'2026-10-10T08:00:00Z' },
  { learnerId:'l1', skillId:'kp-1', correct:false, timestamp:'2026-10-11T08:00:00Z' },
  { learnerId:'l1', skillId:'kp-1', correct:false, timestamp:'2026-10-12T08:00:00Z' },
]).results[0]
// → params: { pInit: 0.4, pTransit: 0.3, pSlip: 0.1, pGuess: 0.2 }
// → posteriorHistory: 0.077 → 0.064 → 0.062
// → finalMastery: 0.062
```

对照本仓现状：`masteryLabel` 只能说「近 3 次都错（共做过 3 题，错 3 题）」——**定性、无趋势**。

## 已知风险（不掩饰）

| # | 风险 | 影响 |
| --- | --- | --- |
| R-1 | **★0 单点维护**（建仓 2026-07-15，唯一维护者） | 上游停更时本包**没有备用实现** |
| R-2 | 依赖 `zod@^4.6.5`，未压缩约 **8.1 MB** | 与第三十八轮 `cheerio` 的「首屏体积」同类问题；需评审裁决是否值得 |
| R-3 | 「掌握概率」是**概率**，不是「掌握度 87%」 | `store.js:290` 明确「不报掌握度百分比」→ 措辞只能是「后验 0.06（基于 3 次作答）」，需评审定 |
| R-4 | 上游 `exports` 为 `null`，`./dist/models/bkt.js` 是**非公开入口** | 发新版可能直接消失 —— 这就是必须锁版的原因 |
| R-5 | 一题多知识点时须**拆成多条事件** | `responseCount` 会大于真实作答次数，**必须在 UI 上说清**，否则就是「假装准确」 |

## 一件必须知道的事：本轮撤回了一条旧结论

第四十四轮记录的 **R-2「复载时丢弃作答记录」在当前代码上不成立**。按 `workbench.js:375-380`
逐行复刻实跑，「落库 3 条 → 再采纳一题」后仍是 **3 条**；该段自 `a66bcda`（2026-10-11）起未变。
当时的结论只跑了 `store` 层的 `loadItems → snapshot`，漏读了那行 `loadAttempts`。
详见 `docs/ecosystem-radar/2026-10-22-r49.md` §2.1。**本包的 TODO 不建立在 R-2 之上。**

## 文件

| 文件 | 内容 |
| --- | --- |
| `package.json` | 锁版依赖；`dsh.bundle.patch → ./cordis.patch.yml` |
| `cordis.patch.yml` | 一行 `insert`，id `radar-mastery-bkt`（**未接入 profile**） |
| `src/index.js` | `apply()` 只打日志；`adapt()` 抛 `NOT_IMPLEMENTED`；TODO 全部写在这里 |
| `src/upstream.js` | 锁版凭据 + 3 个入口 + 字段映射表 + `loadUpstream()` 空实现 |
| `ATTRIBUTION.md` | 只读了类型声明，未抄实现 |
| `OWNERS` | `Owner: shared` |
