# r4 起出题引擎外置：lab 包与引擎注册表

本文是可执行实施方案，不是已完成的工作记录。**r1 与 r3 v9 的行为、内核摘要、断点格式一律不变**；
这条约束贯穿全文，任何一步违反它都应视为方案执行错误。

## 已定决策

| # | 决策 | 结论 |
|---|---|---|
| Q1 | r4 内核放在哪 | 内核留在 lab 包内；`versions.json` 不登记 r4；r1/r3 不起任何变化 |
| Q2 | lab 交给注册表什么 | 完整工厂 + 自带 `checkpointVersion`；dispatch 改为查表；落库权留在 core-study |
| Q3 | lab 是否进模板 | 进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，默认挂载 |
| Q4 | lab 卸载后已生成的题 | 显式标记「已卸载的出题引擎」，可读、不可续跑；**不**静默回落成 r1 |

Q4 未经你明确表态，此处按推荐项采纳。若你不认同，只需改第 6 节一处。

## 为什么必须这样做（代码事实）

1. **引擎不是可插拔的，是一组字符串字面量。** `core-quiz/src/engines.js:4` 的
   `QUIZ_ENGINES` 是 `Object.freeze` 常量；`question-bank.js:213-218` 是按 engine 字符串
   链式分支的 dispatch；`page-quiz/src/question-bank.jsx:85` 另有一份三选一的白名单。
   同一个「有哪些引擎」的知识活在三个地方。
2. **未登记引擎的判据是坏的。** `engines.js:14` 对未知引擎抛 `出题引擎无效`；
   而 `engines.js:30` 的 `canResumeEngine` 用 `versions[engine]` 比较，
   未知引擎两侧都是 `undefined`，`undefined === undefined` 使**任何断点都被判成可恢复**。
   这与 r4 内部那些「裸布尔」属于同一类缺陷：查表失败被读成了通过。
3. **Cordis 没有可选注入。** `@deepseek-ai/cordis` 的 `registry.d.ts:13` 中
   `Inject` 只有数组与映射两种形态，注入均为必需。所以解耦方向只能是
   core 定义契约、lab 提供注册项，不存在「lab 反过来让 core 感知自己」的做法。
4. **`experimental-r4` 不能搬走。** `scripts/quiz_bench/experimental-r4/compare.mjs:27`
   的 `kernelHashes()` 把该目录整目录算入实验冻结指纹，并断言 `codeUnchanged`。
   它是**被测量的对象**，移动它等于改测量基准。

第 4 点的后果必须明说：**同一份算法会出现两份实现**，而本仓明令禁止
（`core-quiz/src/index.js:22-24`：「两条路会在半年内无声漂开」）。
因此 lab 包**必须是唯一实现**，`experimental-r4` 从此只作只读存档，
不再接收功能改动——只允许它在测量口径需要时同步修复。

## 1. 契约形状

### 1.1 注册项

`core-quiz` 新增 `src/engine-registry.js`：

```js
/**
 * 引擎注册表：内建引擎仍是 QUIZ_ENGINES 常量，注册项只做「追加」。
 * 纯函数（planEngineQuestions / canResumeEngine）必须能同步读到这张表，
 * 所以状态住在模块级；Cordis 服务只是把注册/注销动作交出去。
 */
{
  id: 'r4-lab',                    // 稳定标识，写入题目的 provenance.engine
  label: 'r4 lab（实验）',
  description: '按需求缓构建考法树与题模。',
  checkpointVersion: 'point-quiz-r4-lab-demand-v3',
  native: false,                   // 是否需要 engineState.kernel 参与恢复判定
  source: 'course',                // 允许的资料来源；替代 question-bank.jsx:96 的硬编码
  createRun(hosts) -> { generatePoints(input), dispose?(), get workers? }
}
```

`hosts` **只含计算资源，不含存储句柄**：

```js
{ pool, records, graph, cache, concurrency }
```

落库一律由 core-study 通过 `input.onCheckpoint / onQuestion / onRectify` 完成，
与今天 `createTreeQuizRun` 的形状一致（它构造时吃 `{pool,records,graph,cache}`、
回调时才上交题目）。lab 能写坏的最坏结果因此被限制在「这一批出题失败」，
而不是「题库被写脏」。

### 1.2 纯函数的接口变化

| 位置 | 今天 | 改为 |
|---|---|---|
| `engines.js:14` | `Object.hasOwn(versions, engine)` | `engineVersionOf(engine) !== null` |
| `engines.js:30` | `versions[job.plan?.engine ?? 'local']` | `engineVersionOf(job.plan?.engine ?? 'local')` |
| `engines.js:10` | `['r3-v9','deeptutor-native'].includes(engine)` | 内建名单 ∪ 注册项的 `native` |

`engineVersionOf` 对未知引擎返回 `null`（不是 `undefined`），这样
`checkpoint.version === null` 恒为假，第 2 条事实里的漏洞自然消失。

**`QUIZ_ENGINES` 本身不改。** `tests/quiz-app-engines.test.mjs:125` 断言它恰好三个 label，
`:280` 断言 `catalog.engines.length === 3`；这两条在有 lab 的 profile 之外必须继续成立。
注册表只负责「追加」，目录由 `[...QUIZ_ENGINES, ...registered]` 组成。

### 1.3 宿主工具包

`core-study` 新增导出 `dsh-zhiyun-core-study/engine-kit`：

```js
export {pooledToolCall, runtimeState, serial, fault, bankQuestion}
```

这些今天都是 `quiz-engine-runtime.js` 的私有件。导出它们而不是让 lab 复写，
正是为了守住「同一件事不能有两份实现」。`bankQuestion` 必须导出：
它是把引擎原生题目规整成题库形状的唯一入口，lab 不得自己造一份。

## 2. 文件清单

### 新增

| 文件 | 内容 |
|---|---|
| `packages/dsh-zhiyun-core-quiz/src/engine-registry.js` | 注册表 + `engineVersionOf` / `engineEntries` |
| `packages/dsh-zhiyun-quiz-lab/package.json` | 包声明；**无** `dsh.client`（纯宿主办） |
| `packages/dsh-zhiyun-quiz-lab/OWNERS` | `Owner: @lybx-leyw + Open` |
| `packages/dsh-zhiyun-quiz-lab/README.md` | 取舍与边界，见第 7 节 |
| `packages/dsh-zhiyun-quiz-lab/cordis.patch.yml` | `insert` 一行，id `zhiyun-quiz-lab` |
| `packages/dsh-zhiyun-quiz-lab/src/index.js` | `apply()` 里注册、返回 dispose 注销 |
| `packages/dsh-zhiyun-quiz-lab/src/engine.js` | `createRun(hosts)` → 适配 r4 到 `generatePoints` |
| `packages/dsh-zhiyun-quiz-lab/src/checkpoint.js` | 检查点版本与迁移边界 |
| `packages/dsh-zhiyun-quiz-lab/src/*.mjs` | 从 `experimental-r4` 迁入的内核（见 2.3） |
| `tests/quiz-lab-registry.test.mjs` | 注册表契约 |
| `tests/quiz-lab-engine.test.mjs` | 适配层与恢复语义 |

### 修改（逐处最小）

| 文件 | 改动 | 风险 |
|---|---|---|
| `core-quiz/src/engines.js` | 三处判据改走 `engineVersionOf`；`isNativeEngine` 查注册表 | 低；不碰 `versions` 字面量 |
| `core-quiz/src/index.js` | `ctx.provide('zhiyunQuizEngines', {register, list, versionOf})`，dispose 时注销 | 低 |
| `core-study/src/quiz-engine-runtime.js` | 末尾加 `engine-kit` 导出 | 低；不改既有函数体 |
| `core-study/src/question-bank.js:213-218` | switch 改为 `registry.get(engine)?.createRun(hosts)`，三条内建分支原样保留为兜底 | 中；必须逐字保留 r3 分支 |
| `core-study/src/question-bank.js:289` | `QUIZ_ENGINES` → `engineEntries()` | 低 |
| `page-quiz/src/question-bank.jsx:85,96,97` | 白名单改查目录；`courseOnly` 改用 `item.source` | 中；三处同一函数内 |
| `profiles/zhiyun-bench/package.json` | `bundles` 追加 `dsh-zhiyun-quiz-lab` | 低 |

### 不动

- `packages/dsh-zhiyun-core-quiz/src/engines/{r1,r3-v9}/**`：一个字节都不改。
- `packages/dsh-zhiyun-core-quiz/src/engines/versions.json`：不登记 r4。
- `scripts/quiz_bench/experimental-r4/**`：冻结存档，只读。
- `scripts/build.mjs` 的 `CLIENT_PACKAGES`：lab 无 client 半边，不需要加。

## 3. lab 包内部结构

### 3.1 `apply()`

```js
export const name = 'zhiyun-quiz-lab';
export const inject = ['zhiyunQuizEngines'];

export function apply(ctx) {
  const remove = ctx.zhiyunQuizEngines.register(LAB_ENGINE);
  // 卸载时必须注销：不注销则 profile 热重载后目录里留着一条指向已消失包的引擎。
  return () => remove();
}
```

`inject` 是硬依赖（Cordis 无可选注入）：`core-quiz` 缺席时 lab 起不来，
这是可接受的——没有注册表它本来也无处注册。

### 3.2 `createRun(hosts)` 到 r4 的适配

这是整份方案里唯一有实质复杂度的地方。`generatePoints(input)` 的入参与
`runR4(config)` 不是同一套词汇，必须显式映射：

| `generatePoints(input)` | `runR4(config)` | 说明 |
|---|---|---|
| `input.plan.tasks[].point.id` | `pointIds` | 去重保序 |
| `input.plan.count` | `count` | |
| `input.plan.types` | `types` | |
| `input.plan.strategies[].id` | `strategies` | |
| `input.checkpoint` | `state` | r4 的检查点就是整个 `state` 对象 |
| `hosts.graph` | `graph` | 由 core-study 用 `selectedQuizGraph` 算好 |
| `input.runId` | `requestId` | 决定 r4 的幂等身份 |
| — | `compositeCount` | 默认 `0`，见 3.4 |
| — | `maxCalls` | 见 3.4 |

回调方向相反，必须逐个翻译：

- r4 的 `onCheckpoint(next)` → `input.onCheckpoint(next)`。语义一致（都是整份状态）。
- r4 **不回调单题**，只在 `result.results[].questions` 里返回。适配层必须在收尾时
  逐题调 `input.onQuestion(q, checkpoint)`，并先按 `input.checkpoint` 里已有的
  `questionIds` 去重——否则恢复时会重复入库。
- 题目形状须过 `bankQuestion`，不能原样塞进题库。

`dispose()` 接 `AbortController`，与 `createTreeQuizRun` 同构。

### 3.3 检查点版本

`checkpointVersion: 'point-quiz-r4-lab-demand-v3'`。它与 r4 内部的 `r4-demand-v3` 是
**两个不同层次的号**：前者是产品侧「这份断点归谁解析」，后者是 lab 内部格式版本。
这一层分离正是 Q1 的要点——`versions.json` 那张证书表不为未测量内核服务。

`checkpoint.js` 负责：加载时校验版本、版本不符时**拒绝恢复而不是尝试兼容**、
并在产物里保留 `engine:'r4-lab'` 便于 Q4 的显式标记。

### 3.4 两个需要你知道的旋钮

- **`compositeCount` 默认 `0`。** 产品的 `plan` 只有 `ideaScope`（`all/local/cross`），
  没有「几道综合题」；r4 却有硬配额。默认不产综合题，需要时用 lab 自己的配置项打开。
- **`maxCalls`。** 产品没有调用预算概念。适配层默认**不设上限**，只靠
  `signal` 中止；若你希望有上限，从 `config` 读，不要猜一个魔数。

### 3.5 内核迁移方式

`analysis.mjs`、`blueprint.mjs`、`compiler.mjs`、`fixture.mjs`、`generator.mjs`、
`item-model.mjs`、`run.mjs`、`scheduler.mjs`、`tools.mjs` 迁入 lab 时做两件事：

1. **深路径 import 改包名。** 今天这些文件从
   `../../../packages/dsh-zhiyun-core-quiz/src/concepts.js`、
   `.../src/strategies.js`、`.../src/engines/r3-v9/{common,tree,graph,tools}.mjs`、
   `.../src/generate.js` 取值，而 core-quiz 的 `exports` 字段**一个都没导出**。
   必须给 core-quiz 补 `./concepts` `./strategies` `./engines/r3-v9/*` 等子路径，
   否则 `packages/` 里跨包深引用会让构建与打包都不成立。
   这是一处**需要另行批准的 core-quiz 改动**（新增 exports 不改任何实现）。
2. **不迁 `compare.mjs`、`smoke.mjs`、`demo.mjs`、`README.md`、`REFERENCES.md`。**
   前三个是被测量对象的一部分（compare 的指纹覆盖整目录）；后两个是存档文档。
   lab 的等价物是它自己的测试与 README。

## 4. 测试要点

新增测试，全部纯 node、不联网。

**`tests/quiz-lab-registry.test.mjs`**

- 未注册任何引擎时，`engineEntries()` 深度等于 `QUIZ_ENGINES`，
  且 `engineCatalog` 仍是三条——锁住「没装 lab 时与今天逐字节等价」。
- `register` 后目录追加、`engineVersionOf('r4-lab')` 非空；`dispose` 后恢复原状。
- 重复注册同一 id 抛错；注册项缺 `checkpointVersion` 或 `createRun` 抛错。
- `planEngineQuestions(..., 'r4-lab')` 在注册后通过、注销后回到 `出题引擎无效`。
- `canResumeEngine`：伪造 `{plan:{engine:'r4-lab'}, checkpoint:{version:undefined}}`
  必须返回 **false**——这条直接钉住第 2 节事实 2 的漏洞。

**`tests/quiz-lab-engine.test.mjs`**

- 用替身 `pool` 走通一批，断言 `onQuestion` 收到的题都过了 `bankQuestion`（有 `pointKey`、`provenance.engine==='r4-lab'`）。
- 恢复：同一 `runId` 二次调用不新增模型调用，且 `onQuestion` 不重复发射。
- `dispose()` 后 `generatePoints` 在飞的调用被中止。
- 断点版本不符时拒绝恢复。

**回归（必须仍绿，不许改断言）**

- `tests/quiz-app-engines.test.mjs:125 / :131 / :280`
- `tests/quiz-r4*.test.mjs`：这些跑的是 `experimental-r4`，与本方案无关，**证明存档没被碰**。
- `tests/plugins-page.test.mjs`、`tests/build-seeds.test.mjs`：lab 无 client 半边，
  三处装配清单都不必动；若这两条红了，说明 lab 被做成了页面包，方向就错了。

## 5. 迁移顺序

分五步，每步都能独立回滚：

1. **只做注册表**（core-quiz `engine-registry.js` + 三处判据 + 服务），不带 lab。
   验收：全部既有测试绿，`engineEntries()` 恒等于三元素。
2. **lab 骨架**：包结构 + `apply` 注册一个**空壳引擎**（`createRun` 返回一个
   `generatePoints` 就抛 `NOT_WIRED` 的实现）。验收：目录里出现第四个、
   点下去得到明确错误而不是空白。这一步把接线风险与算法风险分开。
3. **内核迁入 + 适配层**：按 3.5 做，补 core-quiz exports。验收：lab 自己的一批能跑通。
4. **进模板挂载**：改 `profiles/zhiyun-bench/package.json`。
   验收：`npm start` 后插件页可见、可关、关掉后引擎按钮消失。
5. **Q4 接线**：`question-bank.jsx:85` 改为「查目录，查不到就保留原值并标 unloaded」；
   `engineLabel` 的兜底从 `历史出题批次` 改为 `已卸载的出题引擎：<id>`。

第 5 步的验收方式是**真的关掉 lab 再打开一张含 r4 题的旧卷**，
确认题目可读、来源标注正确、续跑按钮给出「引擎已卸载」而不是把题当 r1 续跑。

## 6. Q4 的唯一改点

若你要把 Q4 改回「静默回落成 r1」，只需保留 `question-bank.jsx:85` 原样，
并**同时**接受一个后果：卸载 lab 后，r4 的题会被当作 r1 的题显示与续跑，
`architecture/quiz-bench-alignment.md` 第 78-81 行批评过的
「通用话术覆盖真实原因」会在这里重演一次。我不推荐。

## 7. lab README 必须写清的三条边界

1. **lab 不是产品引擎。** 它的题目 `reviewState:'ready'` 只代表
   「模型审核通过」，`psychometricValidation` 恒为 `null`，不得据此宣称认知诊断。
2. **卸载是可逆的，但痕迹不全可逆。** 引擎按钮会消失、断点不可续跑；
   已生成的题目保留在原卷里并标注来源（见 Q4）。
3. **`experimental-r4` 是存档。** 两者代码不共享；实验室的改动只允许发生在
   lab 包内，需要同步回存档时须先确认 `compare.mjs` 的指纹口径是否要一起变。

## 8. 未决项（需要你后续定，不阻塞开工）

- core-quiz 补 exports 属于改他人包（`@lybx-leyw + Open`），按仓库规则可直接做，
  但应在 PR 描述里单列，说明「只新增导出、不改实现」。
- lab 是否也要做页面（C 方案的完整形态）。本方案只做 B；
  页面是增量，不动本文任何契约。
- `compositeCount` 与 `maxCalls` 的产品侧来源（见 3.4）暂不定义。
