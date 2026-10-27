# dsh-zhiyun-core-quiz

智云 Pro 的**出题与质检**层：题形状 + 先筛后出 + 三态硬检查。

零 UI、零 Flutter 依赖、**零落盘**。llm 由集成层注入窄接口，持久化交给宿主存储栈。

## 规格来源

**逐条对齐 App 的 Dart 实现，不自己发明算法。** 每个源文件头都写明了它对齐的是哪一件：

| 本包文件 | App 侧规格 |
|---|---|
| `src/model.js` | `lib/fusion/quiz_model.dart` |
| `src/generate.js` | `lib/fusion/quiz_generate.dart` |
| `src/quality.js` | `lib/fusion/quiz_quality.dart` |
| `src/dedupe.js` | `lib/fusion/quiz_dedupe.dart` |
| `src/lecture.js` | `lib/fusion/lecture_quiz.dart` |
| `src/store.js` | `lib/data/quiz_store.dart` |
| `src/index.js` | 无（本包自己的宿主接缝） |

阈值、判据、失败文案、三态语义、甚至 `cancelled()` 的措辞都照抄 ——
**测试里的每条断言都能追到 Dart 侧一条已经写在注释里的判据**。

## 三条硬纪律在这一层的落点

### ① 生成的题**默认不入库**

生成的题 `status = 'proposed'`，**不进复习队列**，必须用户一键采纳。
这条纪律如果只写在界面上，任何一条新的调用路径都能绕过它 —— 所以它落在**接口**上：

| 方法 | 能不能让题进队列 |
|---|---|
| `store.saveGenerated` | **不能**。状态**强制**写回 `proposed`，且**逐条记录 note** |
| `store.saveSelfAudited` | 能 —— 但只收「带 `讲义自审依据：` 前缀 + 块号 `-1`」的讲义题 |
| `store.adopt` / `store.discard` | 能 —— 这是**用户动作**的两个入口 |
| `store.reviewQueue` | **只返回 `accepted` 的**（读侧落点） |

`generate.js` 里**没有任何**把 `proposed` 改成 `accepted` 的路径。

### ② 先筛后出（不许整节一把丢）

- 输入单位是**已筛的块**，每块必须写明它是**怎么被选中的**；
- `selection === 'wholeSection'`（整节）会被 `planQuizGeneration` **拒绝**；
- `generate()` 对这类请求**一次模型调用都不发**（测试钉住 `llm.calls.length === 0`）。

### ③ 每块**两次**调用，次序是 Rewrite → 出题

`+Rewrite`（把材料改写成含答案的知识陈述）是主要收益来源，**不是可选优化**。
`generate()` 返回的 `calls` 里能直接读出次序：

```js
out.calls // ['rewrite', 'generate', 'rewrite', 'generate', ...]
```

第二段请求体里带的是 `statements`（改写产物），**不带** `material`（原始 ASR）——
这一点由测试捕获请求体断言。

## 质检是**三态**的

| 判定 | 含义 | 后果 |
|---|---|---|
| `pass` | 检查**适用**且通过 | 继续走后面的层 |
| `fail` | 检查**适用**且不通过 | 硬检查失败 → **直接丢弃**，不用 LLM 判 |
| `undecided` | 检查**适用但输入不在场** | **不许**自动采纳，进人工队列 |

「检查**不适用**于这道题」（如短答题去查「挖空标记」）算 `pass` 并在 `detail`
里写明「不适用」—— 那不是缺失输入，而是这道题**根本没有**那个维度；
记成 `undecided` 会让人工队列被「每道纯文本题都待人工」淹掉，那就等于
把人工环节做成橡皮图章。

**关键**：`passedAll` 为真**不代表**题目值得做 —— 实测 120/122 通过全部硬检查，
仍有 8/120 被警告层标记。硬检查保证**结构**，不保证教学正确。

## 本包**不做**什么

| 不做 | 理由 |
|---|---|
| **不落盘** | 不 import 文件系统模块、不拼路径、不写文件。持久化由集成层用宿主存储栈完成（`ctx.storage`）。扫源码的测试钉住它。 |
| **不发 HTTP** | llm 由集成层注入窄接口 `{ call({stage, route, constant, variable, signal}) }`。 |
| **不读环境变量** | 同上，配置由集成层给。 |
| **不引入任何依赖** | `package.json` 里没有 `dependencies`；源码只 import `./` 相对路径。 |
| **零 UI** | 界面在别的包。 |

并发闸是本包**本地 20 行原语**（与 `dsh-zhiyun-core-parser` 的 `Limiter` 同语义），
不跨包复用：本包必须能单独发布，为了一个信号量去依赖兄弟包会把版本拴在一起。

## 用法

```js
import { createQuizGenerator } from 'dsh-zhiyun-core-quiz/generate';
import { createQualityPipeline } from 'dsh-zhiyun-core-quiz/quality';
import { makeSourceMaterial } from 'dsh-zhiyun-core-quiz/generate';

const gen = createQuizGenerator({
  llm,                        // 集成层注入的窄接口
  concurrency: 3,
  pipeline: createQualityPipeline({ answerability, judge }),
});

const out = await gen.generate({
  blocks: [makeSourceMaterial({ blockIndex: 0, page: 1, atSec: 0, summary: '…' })],
  context: { courseId, sectionId, pageCount: 12, sourceRevision },
  signal,                     // 取消抛 CANCELLED，不降级
  onProgress: ({ phase, done, total }) => {},
  rate,                       // 额度台账（可选）
  maxCards: 5,
});
// out: { admitted, rejected, problems, calls, rate, density, ok, summary }
```

Cordis 插件形式：`ctx.provide('zhiyunQuiz', { generate, store, dispose, … })`，
`inject: ['zhiyunParser']`（**不声明存储** —— 本包不落盘）。

## 验收

```bash
node --test tests/quiz.test.mjs
```

108 个用例全绿，覆盖任务书列的八条硬验收：
① 默认不入库 ② 硬检查失败就丢弃且有原因 ③ 三态（不在场是 `undecided`）
④ 锚点等式 `materialIdWith` ⑤ `wholeSection` 被拒 ⑥ 每块两次调用且次序固定
⑦ 取消抛 `CANCELLED` ⑧ 源码不出现 `node:fs` / `ctx.storage` / `process.env`。

> 测试是**离线**的：假 llm，不联网、不落盘。108 个用例 / 0 失败。

其中第 ① 条有**两层**保证：行为层（`saveGenerated` 产出的题进不了 `reviewQueue`）
+ **源码层**（扫 `store.js`，断言把题写成 `accepted` 的**写点只有两处**：
`saveSelfAudited` 与 `adopt`）。后者才是「没有别的路径」这句话的证据 ——
将来有人加一个批量采纳函数，它会立刻变红。

⚠️ 第 ⑧ 条的扫描**只针对代码，不针对注释**：本包的注释里**故意**写着
「这里不 import 文件系统模块」「持久化由集成层的存储服务负责」「不走 tmp+rename」
—— 那些是**说明为什么不这么做**的取舍记录。对整份文件做关键词扫描会把它们
误判成违规，于是为了过测试就得**删掉理由**，那正好把最有价值的注释换成了
最没价值的门禁。所以扫描先剥注释，并配一条反向对照断言证明剥离真的在剥。

---

## 实现与**未实现**判据（如实）

对齐度高的部分不在这里重复（见上面）。以下是**没有做到**或**与 App 有出入**的点。

### 1. 选择题 / 案例题的**生成**未实现（有意的，且拒绝在花钱之前）

请求里含 `mcq` / `caseStudy` 时，`planQuizGeneration` 会在**任何模型调用之前**
拒绝整次请求，理由名是 `typeNotImplementedInJs`：

```
typeNotImplementedInJs：本包**没有实现** mcq 的构造路径（现在能出的是 cloze、shortAnswer）。
⚠️ 选择题要造干扰项（实测 AI 干扰项仅 45% 功能有效）、案例题要综合多块，
它们的**形状与质检**已经实现并有测试覆盖，缺的是**构造那一步**。
这里直接拒绝，**不产出一道构造不完整的题**，也不先花一次 rewrite 的钱
```

- **形状**（`model.js` 的 `choices` / `distractorSourceIds`）与**质检**
  （`singleCorrectAnswer` / `optionCount` / `duplicateOption` /
  `numericEquivalence`）**都实现了**，且有用例覆盖；
- `distractorTraceability`（干扰项逐条可追溯）**已移植，有 4 个用例**；
- **未实现**的是 Dart 的 `buildMcqItem` / `buildCaseItem` 两条构造路径：
  `parseMcqRow` / `parseCaseRow`、选项按池内下标替换、案例题的多块综合与
  `_decorateStatements`、以及案例题「整批只出一次」那条分支。
- 理由：任务书把本包范围定为「题形状 + 先筛后出 + 三态硬检查」，
  而 Dart 自己就把选择题放在**质检链路验证之后**（实测 AI 干扰项仅 45% 功能有效）。
  与其产出一道半成品，不如**明确报名字**。
- ⚠️ 拒绝**必须在计划层**：若放到逐块循环里报，第一块已经发过一次 `rewrite`，
  而这次请求必然一道题都出不来 —— 那一笔是**纯白花**。有三个用例钉住这一点
  （`llm.calls.length === 0`，含正向对照：第 3 期的两类题不受影响）。

> 常量 `kImplementedQuizTypes` 与 `kPhase3QuizTypes` **值相同但含义不同**：
> 前者是「本包的代码里真的有这条构造路径吗」，后者是「产品这一期上哪两类」。
> 合成一个会让「白名单允许」被静默读成「本包实现好了」。

### 2. 讲义题送进硬检查会在 `schema` 上 fail（**与 App 同病**，已钉住）

事实（两侧都成立）：

- App 的 `lib/state/quiz.dart` 造讲义题时写 `blockIndex: -1` / `page: 0`；
- `quiz_quality.dart` 的 `schema` 项要求 `blockIndex >= 0` 且 `page >= 1`
  → 讲义题必然 `schema` fail；
- App 之所以不受影响，是因为「按讲义出题」**整条绕过质检链**：
  它自己的准入判据是 `admitLectureDrafts`（依据必须对得上工具回包原文），
  然后走 `saveSelfAudited` 直接进队列。

**本包照抄 App 的取值（-1 / 0），不改成能过 `schema` 的假值** ——
改成 `page: 1` 是发明一个 App 没有的取值，会让两边读同一份数据时对不上。
这条不一致由 `tests/quiz.test.mjs` 里一条**明确标注为「已知未对齐」**的用例钉住，
免得它被误读成「讲义题也过了质检链」。

**没做到的**：没有为讲义题单独定义一套质检口径。App 也没有。

### 3. `3.5×10^3` 解析不出来（Dart 的文档与实现不符，本包照抄**实现**）

`quiz_quality.dart` 的 `parseNumericValue` 文档说认 `3.5×10^3`，但实现先把 `×10`
替换成 `e`（得到 `3.5e^3`），而科学计数正则不接受 `^` → 返回 `null`。

本包照抄**实现的判据**（返回 `null`，落进 `uncovered`），不照抄文档的承诺 ——
猜成 3500 正是「假装准确」。有一个用例把这件事如实钉住。

### 4. 未移植的 Dart 成员（不在本任务范围）

| Dart | 状态 |
|---|---|
| `QuizRateLedger` / `QuizRatePolicy` / `QuizRateDecision` | **已移植**（含按天 / 按节、`check` / `consume` / JSON 往返） |
| `computeBacklog` / `QuizBacklog` | **已移植** |
| `adviseCardsPerPage` | **已移植** |
| `dropExactQuizDuplicates` / `parseQuizDedupeIndexes` | **已移植** |
| `QuizAttempt` / 错题归因 / 薄弱点 | **已移植**（含 FSRS 隔离：`fsrsRating` 只来自 `selfRecall`） |
| `wilsonInterval` / `ratioWithWilson` | **已移植**（`n=0` 拒绝给数） |
| `HumanCorrectionLedger` / 人工修正台账 | **未移植**（App 侧是审核界面的一部分，属 UI 层） |
| `rankByAgreement` / `AgreementRanking` / `WilsonInterval` 排名的**分配**逻辑 | 只移植了「一致性不得当放行阈值」这条纪律（`kAgreementGatingBanReason`）；排序 / 分配算力是审核界面的活 |
| 干扰项**功能率**统计（`DistractorStat` / `DistractorAnalysis`） | **未移植**（依赖真实作答的大样本，属统计报表层） |
| `QuizGenerator` 的案例题「整批只出一次」分支 | 未实现（依赖案例题构造，见第 1 条） |
| `saveSelfAudited` 的 `notes` 文案 | 已对齐，但**行号 / 文件路径**类的文案（如「第 3 行」）本包不产生（本包不认识文件） |

### 5. 一处**有意的**与 Dart 不同的设计

Dart 的 `QuizGenerator.generate` 是 `request` + `rate` + `maxCards` 三个位置 / 具名参数；
本包收一个 `{ blocks, context, signal, onProgress, rate, maxCards }` —— 因为任务书
指定的签名就是这个（`generate({ blocks, context, signal, onProgress })`）。
`rate` / `maxCards` 作为**可选**扩展字段保留，行为与 Dart 一致
（速率判定在**任何模型调用之前**，不够就**明确拒绝**而不是静默少出几张）。

### 6. 并发

`createQuizGenerator({ concurrency })` 的并发闸**已实现**（含「异常也释放名额」与
「排队中可取消」两条语义，各有用例），但 `generate()` **按固定次序逐次 await**
（先 rewrite、再 generate），所以实际在飞请求恒为 1。
`concurrency` 的实际作用是**硬上限**：它让 `active <= concurrency` 成为一条
能用代码判的不变量。这不是缺陷，是「先筛后出 + 两次调用次序固定」的必然结果；
如果将来要并行处理多块，闸已经就位。

## 知识点生成

`points.js` 提供知识点投影、均匀/随机分配与新旧题抽样。`strategies.js` 是服务端与客户端共用的策略/题型词表，策略权重用最大余数法分配，保持总题数，且不改变知识点的均匀分配。支持 recall（基础巩固）、understand（理解拓展）、apply（应用变式）、explore（综合探究），题型支持 cloze、mcq、trueFalse、shortAnswer。

`concepts.js` 通过 Web Crypto SHA-256 标识资料与概念；概念陈述和原文依据必须逐字来自知识点，挖空位置须可核对。集成层用 `conceptCache` / `onConcept` 跨批次持久化；资料内容、概念版本与知识点身份共同决定复用键。基础填空渲染直接从未用过的有效挖空位置无放回抽取；默认模式可先调用模型补全底稿，仅变体模式不补全，最终不足如实少出。其他题型生成候选后用独立模型调用复核答案、课内可解性与拓展新颖性，再用规则检查来源、选项、填空答案、评分要点、历史角度与母题关系。语义检查仍受模型能力限制，题目保持待核对状态。

历史上下文包括同类题覆盖角度、已用挖空位置和代表题。应用变式关联母题与家族，understand/explore 排除已覆盖角度及过近题干。每题保存 strategy、conceptId、blankId、angle、solutionPath、familyId、parentId 及 variantChange。可选窄 `search(request,signal)` 由宿主 `ctx.web` 实现，应用类检索背景资料并保存可核对的 URL/原文引用；未配置或无结果时明确失败，不伪造联网来源。算法层不发网络请求、不落盘。

`generatePoints` 支持可持久化检查点：概念底稿、检索结果、待复核候选、复核后草稿及逐题游标分别保存。调用方必须将题目和回调携带的检查点原子提交。续跑只处理不足目标数量的步骤；已完成分配不重新调用模型，复核中断也复用已生成候选。缓存版本或计划指纹不同则拒绝恢复。v1 批次保留查看，v2 新架构不恢复旧生成计划。

## App 出题引擎

学习题库将引擎选择与基础巩固、理解拓展、应用变式、综合探究分开。新批次默认采用 r1（推荐），同时提供 r3 v9（实验）和 DeepTutor 直调。r1 使用冻结的实验快照，逐知识点规划、并发生成并统一复核整改；r3 v9 使用 `src/engines/r3-v9/` 快照，从讲义原有树自底向上编译叶节点和标题节点考法。标题节点收到子树正文及页详情；跨考点题保留涉及知识点，并逐分支复核其必要性。r3 提供局部、跨考点或混合范围，执行仍沿用原始树结构。DeepTutor 直调提交讲义及原生规划/生成请求，不经过本包的本地逐题作者、复核或整改。

冻结文件的实测摘要和晋升后摘要记录于 `src/engines/versions.json`。产品只导入纯生成内核，不导入 bench runner、fixture 或文件系统代码；学习集成层负责资源桥接、模型 worker 配额与题库原子保存。检查点按引擎和版本区分，避免跨引擎恢复。DeepTutor 保存已返回的批次候选；上游没有单题级恢复接口，未完整返回的批次可能需要重试。

## 基础巩固：考点补全与变体分流

当前生成链路为：概念原文提取 → 独立来源反例检查 → 原子考点/位置审查 → 历史引导补漏并复审 → 程序选考点 → 渲染/生成 → 答案与目标复核 → 原子提交题目和游标。`facts.js` 保存事实身份、位置归属、隔离原因和冲突证据；原文陈述 ID 和挖空 ID 保留用于追溯，不再等同于独立事实 ID。

来源检查单独用最小实例对照定义与后续规则，保留 `checks` 和可核对的冲突原文；不确定内容隔离，冲突相关位置不能出题。位置审查将同义陈述归入同一个 `factId`，过滤无意义套话和上下文提示答案的位置。缺失/重复审查、伪造引文、无效旧事实引用均不放行。语义归组、同义泄露和冲突发现仍依赖模型，不保证发现所有问题，不能把模型审查当作学科金标。

complete 模式跨批次、跨基础题型过滤已考事实，同批每个事实最多选一次，不足时如实缺额并尝试补漏；variant 模式允许同一事实的不同位置继续练习，但不再使用同题型已用的位置。选择/判断/简答题的基础巩固目标由程序预选为短 `targetId`，模型仅按目标生成；程序绑定原有 concept/blank/fact ID，独立复核必须明确 `targetMatched:true`。编号有效也不能替代目标语义匹配。

来源推演的数值差异由程序比较；不同单位或符号表达不按字符串差异误判矛盾，另行核对等价性。`quiz-source-proof-review` 检查推演是否忠实于对应原文分支。只有可定位的冲突才隔离相关内容；无法验证的冲突引文、来源检查格式失败均保留 `warnings`，不能推断整篇资料错误。每个位置仍须独立通过审查。未确认提示随题目带出 `requiresSourceReview`，题库及练习显示待核对提示。

v3 检查点新增原始模型回包缓存，按阶段及完整请求摘要复用；生成、审核和底稿修正都在回包落盘后再解析。已保存回包恢复不再请求模型；持久化只对 EACCES/EPERM/EBUSY 做有限重试，保留底层错误码，永久错误停止。模型响应与首次持久化之间仍存在不可消除的中断窗口，不承诺供应商调用绝对 exactly-once。新计划使用 v3，不恢复旧版本生成计划，历史题仍可查看。

真实模型可能算错挖空字符下标。唯一出现的词默认由程序定位；初次提取和增量补全若校验失败，最多请求一次格式修正。仍有部分无效项时，逐个位置使用原有严格解析器验证，只保留来源与位置都有效的项，底稿记录 `validation.rejected`；首次提取同时向调用方报告剔除数量。全部无效仍报错，不把剔除当作完整覆盖，也不放宽原文与重复词定位要求。

`recallMode` 默认 `complete`（补全考点优先），可选 `variant`（仅底稿变体）。初次独立提取；复用底稿、有第一类历史或可用位置不足时，`completion.js` 结合完整原文、已有底稿及该知识点第一类历史题（含题干、答案、形式与角度）请求增量补全，再独立复核原文和新增性。新增陈述或同陈述的有意义新位置追加到库，保留原有 ID、挖空位置与历史题关联；同义重述与重复位置不充当新考点。出题优先未考概念及新增位置。

每个知识点每批最多一次补全检查；同一历史版本的已完成检查跨批复用，包括没有发现新增考点的结果。历史变化后可重新检查。候选与复核分别持久化，恢复不重复已完成调用；全局底稿已写入但批次游标中断时会合并较新的缓存。未发现增量只表示本轮未发现，不保证资料完整。

`variant` 不发补全请求。基础题的生成与复核阶段都不携带历史题正文，由程序提前过滤位置并在保存时去重；完整第一类历史只用于补全，不能让变体路径承受同样的上下文成本。understand/explore 的历史引导保持独立。填空渲染本身仍不调用模型，但默认补全模式在上述触发条件下会调用模型检查底稿。

考点身份通过 `factLedger` 持久化：同一挖空位置保留原考点 ID，同义合并通过别名解析历史题，人工停用位置在重审后继续生效。账本只从最新审查通过的位置构建可考集合，不能把来源拒收的位置恢复进候选。App 历史题库的“停用此挖空位置”通过题库事务保存，暂停任务恢复前同步该修订。

来源审查默认为 focused，形式化推导和条件规则主动追加推演，full 用作对照。程序提取的条件分支必须逐条检查；一次格式修复后仍无法核验的分支按待核对隔离，不冒充已确认矛盾。题干、选项、解释与依据均检查来源风险，不能只换一个干净的 basis 绕过。来源状态、引用、拒收原因保留到产物以供人工核查。

## 先挂账，最后统一整改

单题自身的正确性、依据和格式复核通过后先挂账；所有 worker 完成后，再对照历史题与本批题批量查重。重复判定是整改任务，不是通过减少题数完成去重。

每个重复任务携带原题、具体原因、当前知识点全部历史题、本批题和历次整改底稿，完整提供题干、选项、答案与解题路径，不截取最近若干题。优先沿原题改数字、约束、场景、挖空或作答操作；第二次尝试可在用户所选且策略支持的题型中切换，再继续返工。相同角度标签、相同知识点本身不是重复；只换措辞或题型外壳仍重复。基础巩固优先寻找未覆盖考点；考点用尽时整改可以复用已审查的目标，创作有效变体。整改填空走模型重写，不能重复渲染同一句原文。

每轮替代题仍须通过原有答案、目标、引用与格式复核，再进行全批查重；未被判重的代表题保持不变。单次执行最多追加三轮整改以限制成本，仍重复则标为 needs-repair，批次为 partial，可以从断点继续，并不是静默舍弃或宣称完成。生成失败的任务同样保留。语义复核调用或解析失败标为 needs-review，不进入练习。

被替代的版本以 rejected 状态归档供审计，任务继续存在，新题通过 replacesQuestionIds 关联原题。只有计划数量全部通过复核才算 completed。检查点保存每轮原因、完整上下文、目标、模型响应与游标，恢复时不会重做已经完成的任务。

### 单题任务树与统一整改（v5）

考点整理/补全按知识点共享一次；随后为每一道题持久化一个任务与目标考点。单题生成及自身正确性复核使用 worker 队列，同一知识点也允许并发。记忆题预先分配 fact / blank，理解和应用类题携带侧重点与独立任务 ID，避免多个 worker 复用同一个批量生成请求。同一个供应商的所有阶段共用其 worker 配额，总并发为各供应商 workers 之和。纯程序填空渲染不额外调用模型。

所有合格候选先以 pending 状态挂账，再与历史题和本批题统一查重。语义比对同时传题干、答案、策略和路径；历史题按上下文预算分页，不只截取最近 60 道，后续新题批次还对照前批保留题。未完成或无法解析的语义复核标记 needs-review，不进入练习；明确重复才拒收。重复任务逐轮整改并重新查重，原题、替代题和原因均保留；单次执行限制三轮，未完成的整改可续跑。

题目、任务游标、模型结果和整改判定均可断点恢复；全部已挂账但查重未完成的批次仍可继续复核，不能仅凭已挂账数量判断完成。旧断点版本通过 resumable 明确区分。
