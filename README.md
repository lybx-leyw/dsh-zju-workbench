# 智云 Pro · DSH 工作台

用 DSH 插件把 DeepSeek Harness 改造成浙大自己的学习工作台：一个独立的 `zhiyun-bench` profile，加一层界面外壳，对应「今天 / 我的课 / 论文 / 问一问 / 学习 / 个人 / 插件 / 反馈」。界面按职责拆包：外壳只声明页框架与插槽、不认识具体页面，跨页共用的领域状态只有一份；依赖方向单向。

项目形态是**插件生态**，所以期望任何人都能做自己想做的那一块 —— 给 AI 加更多 tool、把解析后的智云数据继续加工（出题、可视化、内嵌播放器）、补本地 OCR 与笔记管理、把「论文阅读」做得更深（批注、多篇对比、引用图）等。只要不违反 [OWNER 核心规则](docs/contributing/CONTRIBUTING.md#2-owner-机制)，就可以做想做的一切。

「插件」页（`packages/dsh-zhiyun-page-plugins/`）就是给这个插件生态自己用的：它把本工作台的依赖关系**从运行时**读出来按拓扑序摆开，让用户能取消没有被任何包依赖的叶包。

## 从这里开始

| 路径 | 说明 |
| --- | --- |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 仓库根的贡献入口，正文在 [docs/contributing/CONTRIBUTING.md](docs/contributing/CONTRIBUTING.md)：安装 Node/npm/Git、开发环境准备、Owner 机制、贡献方式 |
| [AGENTS.md](AGENTS.md) | 仓库根的 AI 约定入口，正文在 [docs/contributing/AGENTS.md](docs/contributing/AGENTS.md)：共享仓库、开工前检查、文件归属、第三方来源、提交与推送 |
| [docs/contributing/OWNERS](docs/contributing/OWNERS) | 协作材料目录的负责人声明 |
| [ATTRIBUTION.md](ATTRIBUTION.md) | 参考或移植第三方项目时的来源与许可说明 |
| [docs/dependency-graph.html](docs/dependency-graph.html) | 插件依赖图（静态存档；运行时的活图在「插件」页） |

`profiles/zhiyun-bench/` 是 profile 模板；`packages/dsh-zhiyun-*` 是功能包，其中 `page-{today,courses,paper,study,me,plugins,feedback}` 对应七个页面（`paper` 是「论文阅读」，见 `packages/dsh-zhiyun-page-paper/README.md` 与它下面的 `dsh-zhiyun-paper`；`plugins` 是依赖图与插件裁剪，见 `packages/dsh-zhiyun-page-plugins/README.md`；`feedback` 是内嵌的迷你社区（发需求、评论讨论，形态照 GitHub issue），见 `packages/dsh-zhiyun-page-feedback/README.md`，其收件服务在 `deploy/feedback-service/`），其余为外壳、UI 原语、领域状态与业务能力；`scripts/`、`tests/` 是工具与测试。每个包内有自己的 `README.md`，用法与限制以包内那份为准。
