# 上游快照说明

## 锁定的东西

| 项 | 值 | 记录位置 |
| --- | --- | --- |
| 提交 | `a31d82624c27d75f4e771d4fcb78dce16470b383` | `upstream.lock.json` → `upstream.commit` |
| 版本 | `1.6.15` | `upstream.lock.json` → `upstream.version`，真源是 `vendor/deeptutor/deeptutor/__version__.py` |
| 归档校验 | `bb9b1281afccf632a4f51f1d834233051970b44143967fa206e24314ff457830` | `upstream.lock.json` → `upstream.archive.sha256` |
| 许可证 | Apache-2.0 | `vendor/deeptutor/LICENSE` |
| 快照规模 | 3875 文件 / 约 60.8 MB | — |

## 为什么 vendor 而不是 pip 安装

上游 PyPI 上没有可用的发行版，只能从源码装。直接 `pip install git+https://...` 有三个问题：
装的时候要联网拉、装出来的内容随远端默认分支漂移、以及离线/受限网络环境直接装不上。
vendor 一份快照进仓库，把「我们到底在跑哪一版上游」变成一个可审计的、和代码一起 review 的事实。

快照本身**不进仓库**（见 `.gitignore`）：`npm run vendor:fetch` 按上表的提交与归档校验值重新拉回，
所以「我们到底在跑哪一版」仍由锁文件保证，而不是靠把 60 MB 塞进提交历史。

打包分发时再由 `distribution.json` 排除开发截图、上游前端源码、上游测试与文档 —— Python 运行只需要
`deeptutor/`、`deeptutor_cli/`、`requirements/`、`pyproject.toml`、`LICENSE`、
`THIRD_PARTY_NOTICES.md`。

## 上游的关键结构（读源码时要落到的位置）

| 用途 | 文件 |
| --- | --- |
| 应用门面（对外唯一入口） | `deeptutor/app/facade.py` → `DeepTutorApp` |
| 应用容器（能力注册表、turn 服务） | `deeptutor/app/container.py` |
| turn 请求模型 | `deeptutor/core/turn_request.py` → `TurnRequest`（`extra="forbid"`） |
| 流式事件 | `deeptutor/core/stream.py` → `StreamEvent` / `StreamEventType`（15 种） |
| 能力清单与类路径 | `deeptutor/runtime/bootstrap/builtin_capabilities.py` |
| 主出题流水线 | `deeptutor/agents/question/pipeline.py` |
| 轻量阅读测验 | `deeptutor/reading/quiz.py` |
| 模型层（所有 agent 的唯一出口） | `deeptutor/services/llm/` |
| 数据根与环境变量 | `deeptutor/runtime/home.py`、`deeptutor/services/path_service.py` |
| 依赖声明 | `pyproject.toml`、`requirements/*.txt` |

## 11 个内置能力

`chat` / `ask_questions` / `deep_solve` / `deep_question` / `deep_research` / `math_animator` /
`visualize` / `mastery_path` / `immersive_reading` / `course_study` / `audio_overview`。

盘点来源是 `BUILTIN_CAPABILITY_SPECS`（类路径 + manifest）。注意上游自己的文档里写的阶段名
**可能落后于实际流水线** —— 能力注册表只用于「发现有哪些能力」，不要拿它的 stage 名当行为契约。
行为契约以实际流水线源码为准。

## 出题流水线的两个必须知道的事实

1. **是串行的。** 探索/规划之后逐题 `await _quiz_one(...)`，`previous_pairs` 传给下一题 ——
   后续题目依赖前序题目。把它改成并发是**行为变更**，不是无损加速，必须单独标识并单独评测。
2. **`concept` 是判断题。** 上游把它的正确答案规范成 `"true"` / `"false"`，并校验它不得带选项。
   所以映射到智云侧必须落到 `trueFalse`，不能是"概念填空"。上游 `QuestionType` 只有 6 个值：
   `choice` / `concept` / `fill_in_blank` / `short_answer` / `written` / `coding`。
   （`services/practice/importing.py` 里另有一套刷题导入用的题型，是不同流水线，别混。）

## 升级流程

1. 取新的上游提交号与归档 `sha256`。
2. 更新 `upstream.lock.json` 的 commit / version / archive.sha256（`npm run vendor:fetch -- --check` 会告出本地快照与锁是否对得上）。
3. `npm run vendor:fetch -- --force --only deeptutor` 整目录重拉（不要就地改）。
4. 若 `patches/` 里有补丁，逐个 `git apply --check` 重放。
5. 跑 `tests/deeptutor-bridge.test.mjs` 与 `node scripts/deeptutor_bridge_selftest.mjs`。
6. 用一条真实用例跑通出题，确认事件映射表仍然覆盖全部上游事件类型
   （新版本加了新的 `StreamEventType` 会落到 `diagnostic`，不会静默丢失，但会变多）。

**启动时不联网检查更新。** 升级是一次显式的代码变更，不是运行时行为 —— 用户机器上的
一次启动不应该因为上游发了新版就改变行为。
