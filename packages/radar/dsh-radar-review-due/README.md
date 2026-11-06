# dsh-radar-review-due —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 由 `dsh-ecosystem-radar` 于 **2026-10-28 · r88 · C 组** 自动生成，仅用于人工评审。
> `apply()` 只打一行日志；没有 UI、没有存储、没有路由。**请勿**加入任何 profile。
> 评审驳回则整目录删除。

---

## 一句话

**本仓「该复习哪道题」这件事，现在没有时间维度** —— 题库的复习队列是按**采纳顺序**返回的。
本包只补这一件事：锁版 `ts-fsrs`，给队列补上「到期 / 未到期 / 从没做过」三态与到期排序。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/open-spaced-repetition/ts-fsrs |
| npm | `ts-fsrs`（**锁版 `5.4.2`**，`latest`，不用 `^`；`6.0.0-beta.15` 存在但为 beta） |
| 许可证 | **MIT** ✅（`LICENSE` 实文首行 `MIT License / Copyright (c) 2026 Open Spaced Repetition`） |
| 形态 | `dist/index.mjs` + `dist/index.d.ts`，无 wasm、无原生依赖，可纯 JS 运行 |

## 集成判定

- **类型**：B · 其他 JS 项目（非 DSH 原生插件包；上游无 `dsh.bundle.patch`，故**不含**上游 DSH 依赖）
- **关系**：**强化式集成**（不是「全新」）
  - ① **仍是同一个面板** —— 「学习 › 题库」不新增页面、不改题面、不改自评交互；
  - ② **功能仍相似正交** —— 还是做题与复习，只是「先做哪道」由到期时间决定；
  - ③ **底层多调了更优质实现** —— 单调的「采纳顺序」→ FSRS 记忆模型。
- **边界**：本包**不落盘**、不出题、不判分、不算积压。积压（`computeBacklog`）已在
  `dsh-zhiyun-core-quiz/src/generate.js:1087` 实现且**无人调用**；本包只出队列，截断策略留给产品决策。

## 为什么不是重复 `dsh-radar-fsrs-scheduler`

本仓已有该骨架（2026-10-14），锁的是**同一个** `ts-fsrs@5.4.2`。本包**不是**它的替代品，而是补它的盲区：

| | `dsh-radar-fsrs-scheduler`（已有） | `dsh-radar-review-due`（本包） |
| --- | --- | --- |
| 依赖 | `ts-fsrs@5.4.2` | `ts-fsrs@5.4.2`（同一把锁） |
| 代码 | 只有 `export const name` + 注释 TODO | `upstream.js` **已实测跑通**；`index.js` 是可调用的纯函数 |
| 状态放在哪 | README 写着「落 `dsh-zhiyun-core-study`」 | **不落盘**：进出都是普通对象，由宿主决定放哪 |
| 自评 → 评分映射 | 未提及 | **实测两种映射都不可用**，见下节 |

**结论：两者不能同时启用**（`insert id` 已错开：`radar-review-due` vs `radar-fsrs-scheduler`）。
若本包被采纳，`dsh-radar-fsrs-scheduler` 应整目录删除，而不是并存。

## 已核实事实（2026-10-28 实测，不是推断）

用 `npm pack ts-fsrs@5.4.2` 取实包、在沙箱里**真跑了一遍**，四条会影响设计的结论：

1. **`f.next(card, now, grade)` 返回 `{ card, log }`**，`log` 是**平铺**对象（`log.due`、`log.rating`），
   不是 `log.card.due`。`card` 有 11 个字段，其中 `state` 与 `learning_steps` **不可丢**。
2. **`Again` 不是「立即到期」**。它把卡置为 `state=3`（重学）并给 `due = 作答时刻 + 10min`。
   → 任何拿 `due` 当「重放到哪了」游标的实现都会**整段丢掉后续历史**；本包已改为用 `lastReview`。
3. **`Rating` 四档没有一档叫「部分掌握」**。本仓自评是三档（`correct / partial / incorrect`，
   见 `dsh-zhiyun-core-study/src/question-bank.js:257`）。实测同一序列
   `掌握了 → 部分掌握 → 需要复习 → 掌握了`：
   - 方案 A（`correct→Good, partial→Hard, incorrect→Again`）→ `0d, 0d, 0d, 0d`，**间隔全不增长**；
   - 方案 B（`correct→Easy, partial→Good, incorrect→Again`）→ `8d, 39d, 0d, 5d`，**partial 反而比 correct 长**。
   两方案都**不可直接采用**。本包默认取 A（宁短勿长），并导出 `mappingIsCalibrated = false`。
4. **`enable_fuzz` 默认开启**会让同一输入两次跑出不同间隔。本包默认 `enable_fuzz: false`，便于复核。

## 尚未完成（采用前必做）

- [ ] **拍板自评映射**（上面第 3 条）。这是产品判断，不是技术调参：要么把自评扩到四档，
      要么接受 A 方案「部分掌握 = 继续在学习步里」并**在界面上说清楚**。
- [ ] **决定状态落哪**：本包不落盘。候选是 `dsh-zhiyun-core-study` 的题库记录（`quiz.attempts` 已有），
      但**不要**新增第三个存储键。
- [ ] **回答「作答链路本身是否已通」**：见下节，这一条比调度器本身更关键。

## ⚠ 前置阻断：本仓有**两套**作答记录，其中一套断链

评审必须先回答这个，否则本包接上去也是接在断线上：

| | 服务层（`dsh-zhiyun-core-study/src/question-bank.js:257`） | 存储层（`dsh-zhiyun-core-quiz/src/store.js:608`） |
| --- | --- | --- |
| 作答字段 | `verdict` / `grading` / `selfVerdict` | `selfRecall` / `autoVerdict` |
| `fsrsRating` | 无 | 有，且**全仓无消费方** |
| 存储 | `question.attempts` + `session.answers`，随 `this.save(bank)` 落盘 | 由 `workbench.js:403 openQuizStore` 每次重新装载，**不写回** |
| 是否被页面使用 | **是**（`bank-answer`） | **否**（`recordAttempt` 全仓零调用） |

也就是说：**FSRS 隔离那套精心的设计（`selfRecall` 唯一来源、AI 判分不得当复习评分）目前是死代码**；
真正在落盘的是 `verdict` 三档。本包按**三档**设计，正是因为它才是活的。
但如果评审的结论是「应该把 store.js 那套接上」，那本包的重放函数要改成吃 `selfRecall`。

## 未改动上游声明

本骨架**不含任何上游源码**，只 `import` 公开导出；`fromRecord` 里回灌的字段名（`elapsed_days` 等）
是上游 `card` 的**公开字段名**，不是复制实现。
