# dsh-zhiyun-host-deeptutor

智云 Pro 的 **DeepTutor 上游服务宿主**。它把 [DeepTutor](https://github.com/HKUDS/DeepTutor)（Apache-2.0）
以锁版源码快照的形式挂进工作台，对外只注册一个 Cordis 服务 `ctx.zhiyunDeepTutor`：
业务包（`core-quiz` / `core-study` / 将来的 `core-tutor` 与页面包）通过它取用上游的出题、答疑、
可视化等能力，**不直接 import 上游 Python 的任何东西**。

## 为什么需要这一层

上游 DeepTutor 是一套独立的 Python 应用（FastAPI + 一堆 agent 流水线 + 自有 SQLite 会话库）。
如果业务包直接调它，会立刻背上四个问题：

1. **环境不可控**：上游要求 Python `>=3.11,<3.15`，依赖里有 faiss / PyMuPDF / llama-index 这类重包。
   本机默认解释器很可能不满足，装上装不上还得看平台。
2. **版本会漂移**：上游是活跃仓库，提示词、阶段名、题型枚举都在变。业务包一旦跟着漂，
   出题质量的变化就无从归因。
3. **数据落错地方**：上游默认把会话、日志、索引写到自己的 `data/`。那份目录在 vendor 快照里，
   写进去等于污染源码树，打包分发还会把用户数据带走。
4. **失败方式不可解释**：Python 没装、依赖缺、模型没配，这三种情况的报错长得完全不一样。
   直接透给用户就是「点了没反应」。

本包把四件事都收进自己身上：版本锁在 `upstream.lock.json`、运行时用 NDJSON stdio 协议隔离
（`docs/contracts.md` §3）、数据全部重定向到 profile 目录、能力状态收敛成可解释的五态。

## 目录

```
vendor/deeptutor/     逐字节上游快照（固定提交，见 upstream.lock.json），只读；不进仓库，用 `npm run vendor:fetch` 拉取
python/               Python 侧：bridge 主循环、模型 shim、能力探测
src/                  Node 侧：运行时桥、模型桥、能力目录、服务面、适配器
patches/              万一必须改上游行为时的可重放补丁（当前为空）
docs/                 contracts.md（接口真源）、runtime.md、capabilities.md、upstream.md
upstream.lock.json    上游提交 / 版本 / 归档校验 / Python 要求 / 已装 extras
distribution.json     分发清单：哪些上游目录必须随包发、哪些只在仓库里留
```

## 对外接口

`docs/contracts.md` §11 是唯一真源。这里是缩略：

```js
const tutor = ctx.zhiyunDeepTutor;

await tutor.status();                    // { state, reason, python, upstream, dataDir }
await tutor.capabilities();              // 11 个能力的五态目录
const handle = await tutor.resources.attach(bundle);   // 标准学习资源 -> 不可变快照句柄
const run = await tutor.runs.start({ capability: 'deep_question', resourceHandles: [handle], input, options });
for await (const event of tutor.runs.events({ runId: run.runId })) { /* 流式事件 */ }
await tutor.runs.cancel(run.runId);
```

## 能力五态

`upstream` / `depsAvailable` / `configured` / `verified` / `exposed`。任一层不满足都会给出
人能读的 `reason` 与 `installHint`，而不是让调用方猜。`verified` 只能由**真实成功 run** 写入
`capabilities-state.json`，没有任何手工置真的入口 —— 否则"能跑"就成了一个没人验证过的声明。

## 数据落在哪

| 内容 | 位置 |
| --- | --- |
| 上游运行时状态（会话、日志、索引） | `<profile>/data/zhiyun-deeptutor/home/`（`DEEPTUTOR_HOME`） |
| 每次 run 的证据 | `<profile>/data/zhiyun-deeptutor/runs/<runId>/` |
| 学习资源快照 | `<profile>/data/zhiyun-deeptutor/resources/snapshots/` |
| 能力已验证状态 | `<profile>/data/zhiyun-deeptutor/capabilities-state.json` |

**绝不写回 `vendor/deeptutor/`。** 上游自己的 `validate_runtime_home()` 也会拒绝它。

## 开发

```sh
# 协议自检（不需要装上游依赖）
node scripts/deeptutor_bridge_selftest.mjs

# 单元测试
node --test tests/deeptutor-bridge.test.mjs tests/deeptutor-service.test.mjs tests/learning-resource.test.mjs
```

上游依赖安装见 `docs/runtime.md`。首轮只装 `requirements/server.txt`，
`math-animator` / `partners` / `matrix` / `rag-rerank` / `video-learning` / `parse` 这些 extras
按需再装 —— 它们会把外部工具链（LaTeX、cairo、ffmpeg、各 IM SDK）一起拖进来。

## 上游版本

固定提交 `a31d82624c27d75f4e771d4fcb78dce16470b383`（版本 1.6.15）。
来源说明与改动记录见 `ATTRIBUTION.md`。启动时**不联网检查更新** —— 升级是一次显式的代码变更，
不是运行时行为。

## 题库中的实际接入

出题页的“出题引擎”可选择“DeepTutor · 独立题目并行”。每道已规划题独立运行 vendored Explore → Plan → Quiz；这属于 `integrated-parallel`，与上游同批逐题串行的 `upstream-native` 分别记录和评测。四种策略、考点准备、独立答案复核、挂账和最终批量查重整改继续由知识点流水线执行。基础记忆填空直接从已核对的底稿生成，不额外调用上游。

所选讲义会登记不可变快照，按选区投影正文、块和来源锚点，通过桥交给上游。资源账号必须与运行账号一致；上游会话、记忆和文件使用对应账号的独立目录。设置 `config.topic` 时同样保留资源上下文，避免上游用短标题覆盖完整讲义。Windows 使用扩展路径访问深层输出目录，vendor 源码保持原样。

模型调用、元数据桥接、复核和整改共用页面选择的供应商 worker 池。工具调用历史及其结果保持配对；OpenAI 兼容传输会携带结构化输出和工具选择约束，无法携带约束的传输明确拒收结果。取消会中止正在进行及排队的模型调用。

运行指纹包括资源版本、输入、配置、账号、模式及模型；成功产物和候选适配结果原子保存，重启后可按指纹复用。题目记录保存上游运行编号、版本、资源修订和锚点。磁盘保存失败会报告错误，不能宣称结果已缓存。上游产生的题目仍可能错误，复核失败会保留原因并允许继续未完成任务。
