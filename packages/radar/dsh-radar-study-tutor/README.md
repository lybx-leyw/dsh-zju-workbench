# dsh-radar-study-tutor

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 由「DSH 生态雷达」自动生成（2026-11-09 15:00 · r159 · A 组）。采用前请**重写**并走正常包流程。

**集成方式：强化式集成**（不是全新功能）。落点是既有的学习页与判分链路，不是新开页面。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/HaowenCang/dsh-study-mode（**仓库名 ≠ npm 名**） |
| npm | **`dsh-study-tutor`**，最新 `0.2.2`（`2026-11-07` 发布）✅ 可锁版 |
| 许可证 | **MIT** ✅ |
| 类型 | **A · 原生 DSH 插件包**（`cordis.patch.yml` + `dsh.bundle.patch`，含 agent preset 与 12 个 host tool） |
| 运行依赖 | `dependencies: null`（零运行时依赖，`lib/` 已构建并入库） |
| 引擎 | `dsh: >=0.2.1-rc.3 <0.2.3`、`node: >=24.13.0` |
| 体积 / 活跃 | 535 KB ｜ ★0 ｜ `pushed 2026-11-07` ｜ 自带 164 个文件（含 `tests/`、`rich/`） |

> ⚠️ **同名陷阱（登记时已踩过）**：npm 上的 `dsh-study-mode` 属于**无关项目**；本仓 registry 里的 `waspqj/dsh-study-mode` 也是**另一个仓**（做的是「主题知识库 + 命中标出处」）。三者互不相同，登记必须写 npm 名。

## 集成判定

- **与现有功能的关系**：**重复可强化**。
- **强化而非重复 —— 三条同时成立**：

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 落点是既有 `packages/client/page-study` + `packages/core/study`。**不新开页面**；上游的 `Study Mode` preset 是否进 roster 是待裁定项（见 TODO 1），不是既定 |
| ② 功能相似且正交 | ✅ | 本仓判分（`core/study/src/grading.js`）与上游判分**是同一件事的两种口径**：本仓主观题 `grading: 'llm'`（模型判掌握程度），上游客观题确定性判分、主观题「无可靠校验则 pending」。正交面是**上游多出的「求助分级 H0–H4 + 分维度能力档 U/N/S/P/R + 24h 重过的 R 档」** —— 本仓完全没有 |
| ③ 底层多调了更优质实现 | ✅ | 本仓 `grading.js` 的失败策略是「模型失败 → 退化成 `partial: 'self'` 并**照样写入**」；上游是 append-only + hash-chain SQLite + 「模型不能提交作答/设掌握度」的**宿主侧强制**。判分权归属是硬差别，不是风格差别 |

## 为什么锁版（A 类）

`dependencies` 写死 `dsh-study-tutor: "0.2.2"`，不带 `^`。

上游 0.2.2 的 CHANGELOG 本身就说明了原因：**DSH `0.2.2` 移除了 `tools` 服务的 `presentAs()` API**，上游为此改了整个工具呈现方式（改挂原生 tool executor）。这类改动在 0.x 里随时再来一次，`^0.2.2` 会在宿主升级时静默换 API。

## 为什么骨架是空的

**直接 insert 上游 patch = 装上第二个平行的学习系统**。上游自带一套 preset + 题库发行（`study_issue_question` / `study_author_question`）+ 判分 + 成绩存储，与本仓 `core/study`、`core/quiz`、`page-quiz` 三处重叠。任务书明确禁止这种简单集成。

所以本包只保留**外围兼容层**：`assertUpstreamShape()` 做只读断言，`apply()` 为空。评审通过后再按 `src/index.js` 里的三个 TODO 决定接哪几条。

## 评审必须先裁的三件事

1. **roster**：本仓已有 `lecture` preset，再加一个「教理科」的 `Study Mode` 会不会让选择器变两个入口。
2. **判分真相源**：本仓「模型判主观题」vs 上游「模型评论不计分」。同一份作答不能有两个结论。
3. **存储权威库**：上游 `$DSH_HOME/study-core/study.db`（schema 3，hash-chain）与本仓学习记录只能有一个权威。

## 不做的事

- 不搬运上游源码（只 `import` 公开入口，版本见 `src/upstream.js`）。
- 不写测试、不接 profile（按任务书硬边界）。上游自带的 `tests/` 留在 node_modules 里，不进本仓。
- 不代上游判分（那会出现第二个真相源）。
