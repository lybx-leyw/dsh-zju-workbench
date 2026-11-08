# 智云 Pro · DSH 工作台

用 DSH 插件把 DeepSeek Harness 改造成浙大自己的学习工作台：一个独立的 `zju-workbench` profile，加一层界面外壳，对应「今天 / 论文 / 问一问 / 学习 / 课堂 / 题库 / 规划 / 笔记 / 插件 / 文档 / 反馈」；账号与数据在原生设置浮窗里。界面按职责拆包：外壳只声明页框架与插槽、不认识具体页面，跨页共用的领域状态只有一份；依赖方向单向。

项目形态是**插件生态**，所以期望任何人都能做自己想做的那一块 —— 给 AI 加更多 tool、把解析后的智云数据继续加工（出题、可视化、内嵌播放器）、补本地 OCR 与笔记管理、把「论文阅读」做得更深（批注、多篇对比、引用图）等。只要不违反 [OWNER 核心规则](docs/contributing/CONTRIBUTING.md#2-owner-机制)，就可以做想做的一切。

「插件」页（`packages/dsh-zhiyun-page-plugins/`）就是给这个插件生态自己用的：它把本工作台的依赖关系**从运行时**读出来按拓扑序摆开，让用户能取消没有被任何包依赖的叶包。

工作台布局由 [shell-bridge](packages/dsh-zhiyun-shell-bridge/README.md) 分为两层：智云导航与业务页面使用独立槽位；「问一问」承载完整原生 DSH 工作区，普通插件的原生导航入口不会混入智云主导航。设置沿用 DSH 的原生浮窗（导轨「设置」与账号菜单同一入口），插件的设置分区零改动。新增桥接或升级后请完整刷新页面；全局 DOM、快捷键和 body 弹窗不属于隔离沙箱。

## 从这里开始

| 路径 | 说明 |
| --- | --- |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 仓库根的贡献入口，正文在 [docs/contributing/CONTRIBUTING.md](docs/contributing/CONTRIBUTING.md)：安装 Node/npm/Git、开发环境准备、Owner 机制、贡献方式 |
| [AGENTS.md](AGENTS.md) | 仓库根的 AI 约定入口，正文在 [docs/contributing/AGENTS.md](docs/contributing/AGENTS.md)：共享仓库、开工前检查、文件归属、第三方来源、提交与推送 |
| [docs/contributing/OWNERS](docs/contributing/OWNERS) | 协作材料目录的负责人声明 |
| [ATTRIBUTION.md](ATTRIBUTION.md) | 参考或移植第三方项目时的来源与许可说明 |
| [LICENSING.md](LICENSING.md) | **授权**：非 vendor 包默认 GPL-3.0-or-later，例外与上游 MIT 归属逐条列明 |
| [docs/dependency-graph.html](docs/dependency-graph.html) | 插件依赖图（静态存档；运行时的活图在「插件」页） |

## 授权

**非 vendor 包默认以 GPL-3.0-or-later 授权**，全文见 [LICENSE](LICENSE)。

引用、修改或以任何形式分发这些包的一方需要遵守 GPLv3 —— 其中包括分发时
提供完整对应源码、衍生作品同样以 GPLv3 授权。

例外：

- `packages/core/parser` —— **MIT**（包内独立声明）
- `packages/vendor/*` —— 各自上游协议（`@lybx-leyw/dsh-pages` 与
  `@ggboy123/dsh-paper-reader` 均为 MIT）

部分包 vendored 了 MIT 协议的第三方代码（主要是 `core/classroom-*` 的
OpenMAIC 来源），这些归属记录在各自的 `ATTRIBUTION.md` 里，不影响按包划分的协议。
完整规则见 [LICENSING.md](LICENSING.md)。

`profiles/zju-workbench/` 是 profile 模板；`packages/dsh-zhiyun-*` 是功能包，其中 `page-{today,paper,study,quiz,planning,notes,me,plugins,docs,feedback}` 对应侧栏各页（`paper` 是「论文阅读」，见 `packages/dsh-zhiyun-page-paper/README.md` 与它下面的 `dsh-zhiyun-host-paper`；`quiz` 是跨课程题库，见 `packages/dsh-zhiyun-page-quiz/README.md`；`plugins` 是依赖图与插件裁剪，见 `packages/dsh-zhiyun-page-plugins/README.md`；`feedback` 是内嵌的迷你社区（发需求、评论讨论，形态照 GitHub issue），见 `packages/dsh-zhiyun-page-feedback/README.md`，其收件服务在 `deploy/feedback-service/`），其余为外壳、UI 原语、领域状态与业务能力；`scripts/`、`tests/` 是工具与测试。每个包内有自己的 `README.md`，用法与限制以包内那份为准。

`packages/source/netproxy/` 是**分域网络代理**：所有出口流量经一个本地中继，按你在「设置 → 网络代理」里配置的域名规则分发到不同代理或直连（代理数量不设上限）。它存在的理由是智云是国内站点，不该跟着全局代理绕道海外。设计与配置形状见该包 [README](packages/source/netproxy/README.md)。

`packages/dsh-zhiyun-source-omni/` 是**浙大校园数据包**（移植自 [ZJU-Omni](https://github.com/Vita0818/ZJU-Omni)，MIT）：教务课表/成绩/绩点/考试、学在浙大作业与课件、CC98、拼题A，共 44 个数据函数。它**不做工具层** —— 对外只暴露数据，谁来消费（页面 / 脚本 / 将来要接的 AI）由调用方决定。凭据在 Windows 上用 DPAPI 加密落盘（上游的 macOS 钥匙串在 Windows 上不可用）。见该包 [README](packages/dsh-zhiyun-source-omni/README.md) 与 [ATTRIBUTION](packages/dsh-zhiyun-source-omni/ATTRIBUTION.md)。

