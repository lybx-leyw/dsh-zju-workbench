# Quiz 与 bench 的版本边界

## r1

基线是 `scripts/quiz_bench/experimental/CANDIDATE.json` 中的
`v2-candidate-r1`，不是 `experimental-r2`。
产品内核位于 `packages/dsh-zhiyun-core-quiz/src/engines/r1/`。
`versions.json` 分别记录实验源码摘要和产品源码摘要；两者不同不能被解释为完全一致。

产品保留已要求的题面自足性、学习价值审核与失败重试修复，因此不再是冻结实验的逐字副本。
生成和审核规则、缓存版本发生变化后，旧实验的质量/成本结果不能直接当作当前产品结果。
这些安全修复没有改写被冻结的实验文件。

## r3 v9

用户选择锁定 v9。产品使用 `src/engines/r3-v9/` 和 `versions.json`
记录的冻结摘要。

**v9 与当前 `experimental-r3` 的关系（2026-10-28 更正）**：
此前本节写着「不升级到当前 `experimental-r3` 目录后续的教学资产与独立求解流程」，
并据此认为 `experimental-r3/run.mjs` 的默认 verified 资产模式不能当作 v9 同版本对照。
这个判断是错的，并且因为它，产品一度停留在 bench 的**原始对照组**上：

- `experimental-r3/run.mjs:22` 的默认参数就是 `assetMode='verified'`；
  `README.md` 原文：「当前 `runR3` 和三组比较器中的 r3 默认使用验证资产模式；
  原始对照可显式设置 `assetMode:'raw'`」。
- 也就是说 **capsule（共享讲解资产）+ blind（独立盲解）是 bench 的正式默认路径**，
  `raw` 才是对照。产品走 `raw` 等于「用对照组当正式路径」。

现已对齐：`capsules.mjs`、`tools.mjs`、`tree.mjs`、`expansion.mjs` 与 bench
**逐字节一致**；`generator.mjs` 与 bench 一致（仅 import 路径不同）；
运行入口按默认档接入 `createCapsuleStore(...)` 并以 `blind:true` 生成。
`versions.json` 的 `measuredSha256` 记录 bench 原文摘要，`promotedSha256` 记录产品
（折回包内 import 后）的摘要，两者不同只代表 import 路径差异。

产品调度按 v9 的 compile → reserveWithExpansion → generate 顺序执行：

- 单份讲义沿用原图根节点，避免额外虚构一个集合标题并为它编译考法。
- 在整棵所选树上一次预留整个批次，不预先给每个叶知识点强加题数配额。
- 保留原生账本、工具调用、实例复核与质疑流程；题目绑定实际考法的来源。
- 多策略权重和按知识点均分不属于该原生调度契约，界面不显示为已执行的配额。

### 传输层为什么必须在适配器对齐

bench 的 `deeptutor-host.mjs:31` 在 `finish_reason` 非 `stop`/`tool_calls` 时直接抛异常。
DSH 宿主则**从不抛异常**：它把 provider 失败规整成终止块
（`dsh-llm` 的 `adapterFailureChunk` → `{type:'finish',reason:{kind:'error',failure}}`）。
而 kernel 的 `createToolTransport` 只累加 `text-delta` / `tool-call-delta` / `usage`，
**不读 `finish`**，于是 429、超时、限流全被读成 `{text:'',toolCalls:[]}` ——
一个「模型这次什么都没返回」的空结果。空结果不抛异常，kernel 的 16 轮 / 3 次修复预算
一次都不会花，整批直接失败，界面显示 `0 道可用 / 计划 N 道`。

这正是「bench 全绿、产品必挂」的全部原因。修复落在 `quiz-engine-runtime.js` 的
`pooledToolCall`（所有调用必经处），不改被测量过的 kernel：

1. 把 `finish` 块翻译成异常；DSH 的 code 词表
   （`RATE_LIMIT`/`SERVER`/`AUTH`/`QUOTA`/`CONTEXT_WINDOW_EXCEEDED`/`INVALID_REQUEST`）
   先折回状态码，再交给 `dsh-zhiyun-core-llm-error` 分类 —— 直接丢进去会落到
   `unknown` 被判成不可重试，等于没修。
2. `aborted` 单独给 `CANCELLED` 且永不重试：用户点了暂停，重试等于继续烧钱。
3. 传输层重试 `[500,1500]ms` 两次（与上游 `agent_loop.py` 同量级）。kernel 的重试
   预算只覆盖协议失败，传输失败在 `compiler.mjs:65` 直接冒泡、在 `generator.mjs:73`
   打成 `TRANSPORT` 后又被 `:110` 重新抛出，所以重试必须在这一层。
4. 单次调用 600s 超时；此前该路径没有任何超时，卡住的 provider 会让批次永久挂起。

按每批 C 次串行调用、单次成功率 p 计算，整批成功率为 p^C：p=0.95、C=30 时仅 21.5%，
而整批做到 90% 需 p≥0.997 —— 任何真实 provider 都给不出。加 3 次尝试后单次有效成功率
为 1-(1-p)³，同条件下整批升到 99.6% 量级。

## r4 起：实验引擎外置到 lab 包

r1 与 r3 v9 的定位不变，本方案不动它们的内核、摘要与断点格式。
变化在于**从 r4 开始，实验引擎不再演进入产品内核，而是留在 lab 包**。

原因不是「接壳麻烦」，而是 `versions.json` 的性质：它用
`measuredSha256` / `promotedSha256` 记录「这段代码被测量过」。
r4 的 README 自己写着只证明机制与故障处理、不证明题目质量；
把一个未测量的内核登记进去，等于给它发证书，之后每次改结构都要走重测流程。

配套的三处结构变更是本节的重点，也是与 r1/r3 无关的独立改动：

- `engines.js` 的 `versions` 查表对**未登记引擎**两侧都是 `undefined`，
  于是 `canResumeEngine` 的 `undefined === undefined` 把任意断点判成可恢复。
  改为 `engineVersionOf()` 返回 `null`，比较恒假。
- `QUIZ_ENGINES` 保持常量不变，注册项只做追加；`quiz-app-engines.test.mjs`
  对「恰好三个」的断言因此在未装 lab 时继续成立。
- 引擎的接缝是 `createRun(hosts) → {generatePoints}`。`hosts` 只含计算资源
  （`pool / records / graph / cache`），**不含存储句柄**——落库仍由 core-study
  通过 `onCheckpoint / onQuestion / onRectify` 完成，与今天 `createTreeQuizRun`
  的形状一致。lab 写坏的上限是「这一批失败」，不是「题库写脏」。

`scripts/quiz_bench/experimental-r4` **不搬走**：`compare.mjs:27` 的 `kernelHashes()`
把该目录整目录算入实验冻结指纹并断言 `codeUnchanged`，它是被测量的对象。
代价是同一份算法会短暂存在两份实现，而本仓禁止两条路并存——所以 lab 包
从落地起就是唯一实现，存档只读、不再接收功能改动。

完整方案（契约形状、文件清单、测试要点、五步迁移顺序）见
[quiz-lab-engine-registry.md](quiz-lab-engine-registry.md)。

## 失败必须可见

`question-bank.js` 原先把异步失败写成
`stored.problems = result?.problems ?? ['出题已暂停或未完成，已保存的题目和断点仍然保留。']`，
`error` 被整个丢弃。deeptutor-native 曾连续六次在 259–901ms 内失败、`phase` 停在
`queued`（说明死在 `tutor.runs.start()` 之前），但 `problems` 里只留下那句通用话术，
「Python 没装 / 依赖缺失 / 能力未就绪」的区分永久丢失。

现在 `batchProblems(error, aborted)` 按错误码给可操作提示并保留原始码；暂停与失败分开；
`bank-catalog` 的 `engines[].available` 改为向宿主询问 `status().state`
（旧实现只判服务对象在不在，于是 Python 缺失时按钮照旧可点、`· 未就绪` 永不出现），
并把不可用原因经 `reason` 传到界面。

## DeepTutor 直调

上游由 host-deeptutor 的 `upstream.lock.json` 锁定。
bench 和产品共用 `nativeQuizContract()`，相同题型、策略、难度下使用相同的
中文任务、资料构造和原生 config。bench 的标准对照是理解型选择题、基础难度。
产品允许显式选择其他题型与策略；这属于不同实验配置，不能直接比较结果。

产品每个题型/策略组合对整份所选资料运行一批原生规划，不按知识点拆成独立上游流水线。
不叠加本地候选生成、元数据模型、复核或统一整改。格式不合法的候选保留缺额，不能缓存为可发布题目。
多知识点原生结果只有在上游 topic 明确匹配时才绑定具体知识点，不能按返回顺序伪造归属。

模型回调优先读取该 run 注册的供应商与模型，不依赖 bench 才有的全局默认选择。
两种原生模式的调度与断点结构已改版，旧断点不能混入新流程，已有题目保留。

## 验证范围

`tests/quiz-app-engines.test.mjs` 验证冻结内核摘要、整树单批次预留、整批原生资料、
失败后的恢复与真实宿主存储。`tests/deeptutor-integration.test.mjs` 验证模型快照与模型桥。
真实 Python 宿主已使用合成资料走到本地测试模型边界。

2026-10-28 补入的三条回归测试：

- `provider failures arrive as finish blocks and are retried…` —— 锁住「宿主终止块必须
  变成异常，且可重试的失败要被重试」，防止再次退化成静默空结果。
- `batch failures keep the real cause…` —— 锁住失败原因与错误码不被通用话术覆盖。
- `deeptutor-native is reported unavailable with a reason…` —— 锁住 `available` 反映
  真实运行状态并带出原因。

已用真实 profile 的模块做端到端冒烟（假模型，注入 5 个 429）：产出 1/1，
`engineState` 含 `capsules`，资产成功编译缓存。

以上不能替代真实模型质量评测。真实课程资料外发、费用和题库写入测试需获得用户明确批准；
尚未获得该批准，不能宣称真实模型端到端生成成功或三种模式质量相同。
