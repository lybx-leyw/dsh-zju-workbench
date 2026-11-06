# DeepTutor 接入架构

> 本文描述**已实现**的结构与边界。上游源码的版本、目录与升级流程见
> [packages/dsh-zhiyun-host-deeptutor/docs/upstream.md](../../packages/dsh-zhiyun-host-deeptutor/docs/upstream.md)；
> 接口签名以 [packages/dsh-zhiyun-host-deeptutor/docs/contracts.md](../../packages/dsh-zhiyun-host-deeptutor/docs/contracts.md) 为唯一真源。

## 数据流

```
视频 / 转录 / PPT
      │
      ▼
core-parser → core-lecture        （现有：解析与讲义提取）
      │
      ▼
core-knowledge / core-study        （现有：知识点树、终稿、复核记录）
      │
      ▼  标准学习资源（schema v1）
dsh-zhiyun-core-learning-resource  （新：校验 / 内容哈希 / 投影 / 来源锚点）
      │
      ▼  resourceHandle（不可变快照 + revision）
dsh-zhiyun-host-deeptutor          （新：ctx.zhiyunDeepTutor，独占上游运行时）
      │  NDJSON stdio
      ▼
vendor/deeptutor 的 Python 进程    （锁版快照 + 独立 venv + DEEPTUTOR_HOME）
      │
      ▼  事件流 / 候选题目 / 产物句柄
core-quiz（候选题目再经现有质量门 → 全局题库）  ·  将来的 core-tutor / 页面包
```

模型传输反向穿过宿主：Python 进程不直连供应商，所有模型调用以**反向请求**
（`llm.stream` / `llm.complete`）回到 Node 侧的 `ctx.llm`。这样凭证、配额、模型选择
都留在宿主一处，Python 侧拿不到也不需要 API key。

## 三层边界

| 层 | 包 | 独占的东西 | 不允许做的事 |
| --- | --- | --- | --- |
| 数据权威 | `core-knowledge` / `core-study` / `core-quiz` | 课程、讲义终稿、知识点、全局题库 | — |
| 资源投影 | `core-learning-resource` | 资源 schema、校验、内容哈希、投影、锚点索引 | 不落用户题库，不调上游 |
| 上游宿主 | `host-deeptutor` | 版本锁、Python 进程、协议、模型与配额桥、能力五态、运行证据 | 不定义课程/题库结构，不写业务判断 |

**业务包只能通过 `ctx.zhiyunDeepTutor` 使用上游能力。** 直接 `import` vendor 下的任何模块、
或者自己 spawn 一个 Python 进程，都是越界 —— 那会让版本锁、数据落点、失败解释同时失效。

## 为什么用独立子进程而不是嵌入

上游是一整套 FastAPI 应用，带着自己的事件循环、SQLite 会话库、ContextVar 作用域的模型配置。
嵌进 Node 进程做不到；用 in-process Python（如 pybind）又会把上游的异常和生命周期
直接灌进宿主的事件循环。

子进程 + NDJSON stdio 换来的是：

- **故障隔离**：Python 崩了，Node 侧只是看到一个 `crashed` 状态和一段 stderr 尾巴，工作台不挂。
- **语言边界即接口边界**：`docs/contracts.md` 的报文形状是唯一的耦合面，改上游不用改 Node。
- **可单独诊断**：同一个 bridge 可以用 `--selftest` 单跑，不依赖宿主，也不依赖上游装没装好。

代价是多一层序列化与一次进程启动。上游自己的流水线是分钟级的，这点开销无关紧要。

## 能力五态

一个能力「能不能用」不是布尔值。本仓把它拆成五层，任一层不满足都能给出人能读的原因：

| 状态 | 含义 | 谁决定 |
| --- | --- | --- |
| `upstream` | 上游源码里存在这个能力（类路径可解析） | 能力探测 |
| `depsAvailable` | 它的依赖装好了（如 `math_animator` 需要 `manim`） | 能力探测 |
| `configured` | 模型/搜索等供应商已配置 | 宿主配置 |
| `verified` | 本机**真实跑通过一次** | `capabilities-state.json`，只由成功 run 写入 |
| `exposed` | 产品侧已开放（有页面/入口） | profile 配置 |

`verified` 刻意不给手工置真入口。没有它，代码里就会长期躺着一句「这个能力已验证」，
而没有人能说出是哪次运行验证的。

## 两种运行方式

- **`upstream-native`**：保留上游原样的阶段划分、提示词、逐题顺序与前序依赖，只桥接
  输入资源、模型传输与输出格式。这是基线。
- **`integrated-parallel`**：把任务树与事实目标预先分配，用冻结资源 / 完整计划 / 历史快照
  并行推进。这是**实验模式**，必须单独标识、单独评测。

两者不能混为一谈。上游主出题流水线里后续题目会拿到 `previous_pairs`，把 `for/await`
换成 `gather` 就宣称「无损加速」是错的 —— 那是行为变更。

## 数据落点

| 内容 | 位置 | 权威 |
| --- | --- | --- |
| 课程、讲义终稿、知识点 | 现有 `core-knowledge` / `core-study` 存储 | 智云 |
| 全局题库 | 现有 `core-quiz` 存储 | 智云（上游只读授权题史 + 输出候选） |
| 标准学习资源快照 | `<profile>/data/zhiyun-deeptutor/resources/snapshots/` | 派生，可重建 |
| 上游会话 / 日志 / 索引 | `<profile>/data/zhiyun-deeptutor/home/` | 上游私有 |
| 每次 run 的证据 | `<profile>/data/zhiyun-deeptutor/runs/<runId>/` | 诊断用 |
| 能力状态 | `<profile>/data/zhiyun-deeptutor/capabilities-state.json` | 见上「五态」 |

**终稿与派生物分离**：上游会话与索引是可丢的，终稿和题库不是。
所以前者的目录可以整体删掉重建，后者不行。

## 失败时的样子

| 情况 | `status().state` | 用户看到 |
| --- | --- | --- |
| 没装 Python 或版本不对 | `not-installed` / `unsupported-python` | 需要 Python 3.11–3.14，附一条安装命令 |
| 依赖没装全 | `deps-missing` | 缺哪些包，附安装命令 |
| 模型没配 | `configured=false`（能力级） | 去设置里选供应商与模型 |
| 进程崩了 | `crashed` | 崩溃退出码 + stderr 摘要 |
| 产品未开放 | `disabled` | 该能力未启用 |

任何一种都不应该是「点了没反应」或者一个裸栈。

## 与现有页面的关系

题库页面在独立页面包 `dsh-zhiyun-page-quiz`（`page-study` 只保留知识点卡片上那一小块同源面板）。上游候选题目进来之后，
**仍然走现有的质量门与落库流程** —— 上游只是把「出题」这一步换成它的实现，
题目质量校验、去重、覆盖台账、复习排程都还是本仓的。

这条边界很重要：换掉出题引擎不应该同时换掉质量判断，否则质量变化就无法归因到具体一侧。
