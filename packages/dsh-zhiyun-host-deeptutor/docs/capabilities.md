# 能力目录与能力状态

> 接口签名以 [contracts.md](./contracts.md) §7 与 §11 为唯一真源；本文解释**为什么**是这些状态、
> 以及每一层由谁负责判定。资源 schema 见同目录契约 §6 与
> `dsh-zhiyun-core-learning-resource/schema/learning-resource.v1.json`。

## 为什么「能不能用」不是布尔值

上游有 11 个内置能力。用户问「能不能出题」，答案取决于四件互不相干的事：
源码里有没有这个能力、它的依赖装没装、模型配没配、产品侧开没开放。
把四件事压成一个 `available: true/false`，结果就是用户看到「不可用」时
完全不知道下一步该做什么 —— 是去装 Python、装依赖、配模型，还是这个功能本来就没上线。

所以拆成五层，任一层不满足都能单独说出来：

| 状态 | 含义 | 判定者 | 判定方式 |
| --- | --- | --- | --- |
| `upstream` | 上游源码里有这个能力 | 能力探测 | 解析 vendor 里的类路径 |
| `depsAvailable` | 它的运行依赖装好了 | 能力探测 | 逐能力 import 探测 |
| `configured` | 模型 / 搜索等供应商已配置 | 宿主配置 | 传入的 `configured` |
| `verified` | 本机真实跑通过一次 | 运行记录 | `capabilities-state.json` 只由成功 run 写入 |
| `exposed` | 产品侧已开放 | profile 配置 | 传入的 `expose` |

## 每一层为什么放在那儿

### `upstream` —— 查源码而不是查文档

能力清单在 `vendor/deeptutor/deeptutor/runtime/bootstrap/builtin_capabilities.py`
的 `BUILTIN_CAPABILITY_CLASSES` 里，是 11 条「名字 → 类路径」的映射。探测的做法是
**解析类路径能不能真的导入**，而不是相信任何一份静态列表。

原因很直接：文档里的阶段名会落后于实际流水线（上游自己的 AGENTS.md 也写了这一点）。
静态列表在升级后会安静地变成错的，而类路径解析不会。

### `depsAvailable` —— 一个能力一个探针

最典型的例子是 `math_animator`：它的 manifest 在所有安装里都存在、类也能导入，
但真正跑起来需要 `manim`，而 `manim` 需要外部 LaTeX / cairo / cmake / ffmpeg，
不在 `requirements/server.txt` 里。所以它「存在但不可用」。

上游门面自己就是这么判的（`facade.py` 的 `get_capability_availability` 用
`importlib.util.find_spec("manim") is not None`）。我们沿用同一条判据，
这样两边对「可用」的理解不会分叉。

实测（本机，只装了 `server` 扩展）：11 个能力里
`math_animator` = 不可用，其余 10 个可用。

### `configured` —— 宿主才知道的事

上游不判断「模型配好了没有」，因为它假定配置在 `data/user/settings/model_catalog.json` 里。
而本仓的凭证、供应商、配额都在宿主侧（`ctx.llm` 与设置页），
Python 进程**拿不到也不该拿到** API key。

所以这一层只能由宿主回答，作为 `configured` 传进目录。

### `verified` —— 刻意不给手工置真的入口

一个能力「确实跑通过一次」和「应该能用」是两件事。差别在于：
前者有证据（哪次 run、什么资源、什么模型），后者是断言。

所以 `verified` **只能**由一个成功结束的 run 写进 `capabilities-state.json`，
代码里没有 `markVerified()` 之类的手工入口。没有这个约束，
半年后代码里会长期躺着一句「这个能力已验证」，而没人能说出是哪次运行验证的 ——
那句注释就成了谎言，而且没人会去删它。

失败不写 `verified`。一个能力跑挂过，它的 `verified` 该保持原样，
失败的证据在 `runs/<runId>/` 里，那才是该去看的地方。

### `exposed` —— 产品决定，不是技术决定

上游有的能力，产品未必开放给用户。`exposed` 来自 profile 配置，
它回答的是「这个入口在产品里存在吗」，与技术上能不能跑无关。

## 上层怎么用这五层

调用方**不需要**自己组合这五个布尔值。两种用法：

1. **拦在启动前**：`core-quiz` 的 `createUpstreamQuizEngine` 在起 run 之前，
   按 `upstream → depsAvailable → configured → exposed` 的顺序找第一个 `false`，
   直接抛「上游能力 X 在「Y」这一层不可用：<hint>」。
   这样用户不会等上游进程起来才被告知「没配模型」。
2. **解释给用户看**：`status().state` 给一个粗粒度结论，
   `capabilities()` 给逐能力的五态，界面上「为什么不能点」直接取后者。

`verified` 不在阻断链里。它是「跑通过」的证明，不是「能用」的前提 ——
一个新装的机器上没有任何 `verified`，但能力完全可用。

## 能力清单（上游 11 个内置能力）

优先级按本仓的规划：`deep_question` 是 P0（第一项落地功能），
`chat` / `ask_questions` / `deep_solve` / `visualize` / `immersive_reading` / `course_study` 是 P1，
`deep_research` / `math_animator` / `audio_overview` 是 P2。

| 能力 | 上游阶段 | 说明 |
| --- | --- | --- |
| `chat` | exploring → responding | 默认能力，单 agentic 循环 |
| `ask_questions` | responding | 强制走 `ask_user` 的问答 |
| `deep_solve` | responding | 分步解题，带 solve 规划工具 |
| `deep_question` | ideation → generation | 主出题流水线（Quiz 用这条） |
| `deep_research` | rephrasing → decomposing → researching → reporting | 深度研究 |
| `visualize` | analyzing → generating → reviewing | SVG / Chart.js / Mermaid / HTML；也可转 Manim |
| `math_animator` | concept_analysis → … → render_output | 需要 manim（本机不可用） |
| `mastery_path` | responding | 掌握路径 / 引导学习 |
| `immersive_reading` | responding | 文档或时间戳锚定的阅读 |
| `course_study` | responding | 课程状态感知 |
| `audio_overview` | retrieving → script_writing → voice_generation | 音频概览 |

**阶段名只用于发现，不要用它推导进度。** 上游流水线实际发出的阶段
可能比 manifest 里写得多或少，进度必须以真实事件为准（见契约 §5）。

## 资源侧的状态

资源没有五态，因为它不是「能力」而是**输入**。资源的状态是另外三个词：

| 状态 | 含义 |
| --- | --- |
| 已 attach | bundle 通过 schema 校验，写成了不可变快照，拿到 `revision` |
| 校验失败 | 报错带 JSON 路径，**不会**部分落盘 |
| 版本过期 | 终稿重新生成后 `revision` 变了，旧 run 仍指向旧 revision |

`revision` 是内容哈希（`sha256:` 前缀 + 64 位十六进制），所以「同一份终稿」
在任何机器上都是同一个 revision，「改了一个字」也一定是不同的 revision。
这条性质是运行指纹能成立的前提（契约 §8）。
