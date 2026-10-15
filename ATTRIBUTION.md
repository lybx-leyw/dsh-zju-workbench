# 第三方来源

本文件记录本仓库参考或移植的**第三方**项目与素材，是这类说明的唯一索引。作者自有项目（`zhiyun-pro`、`zju-mcp` 等）之间的搬迁属于同一作者，不在此列。

参考任何外部项目之前先确认对方的协议，参考之后必须在本文件追加说明；细节见 [CONTRIBUTING.md 第 3.3 节](docs/contributing/CONTRIBUTING.md#33-参考其他项目前先确认协议)。

本仓库自身未附 LICENSE（`package.json` 为 `private: true`）。这不改变第三方项目自身协议的约束力。

## 仅参考，未引入实现

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · MIT · 参考提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。本项目的运行宿主：阅读其源码与文档以了解 Cordis 插件写法、宿主 API 与客户端启动图谱（种子词表等常量对照自其源码），未复制其实现；运行时以 npm 依赖形式引入。
- [DSH Codex UI](https://github.com/MichengAI/dsh-codex-ui) · Apache-2.0 · 参考提交 `ff42c6f9296ee7022ab2e919f849ecd05d4df63e`。参考其 manifest、浏览器 factory 装配、插槽所有权与宿主验证方式。没有引入该插件的业务或界面实现。

## 运行时依赖的第三方插件

以下项目以 npm 依赖形式引入，按各自协议使用，未复制其源码到本仓库：

- [dsh-paper-reader](https://github.com/GGboya/dsh-paper-reader) · MIT · 版本 `1.3.1`（精确锁定，见 `packages/dsh-zhiyun-paper/src/upstream.js`）。「论文阅读」栏目在 `packages/dsh-zhiyun-paper/` 里以子插件方式挂载它的宿主半边（HTTP 路由与 agent 工具），客户端界面由 `dsh-zhiyun-page-paper` 重写。锁版与改写理由见该包 README。

## 候选骨架引用的第三方插件（**尚未接入、未评审**）

以下条目由「生态雷达」任务登记。它们出现在 `packages/dsh-radar-*/` 的**候选骨架**里，
**未写入 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，不会在运行时挂载**。
列在此处的目的是：**已阅读其源码/文档**，需按 CONTRIBUTING 3.3 留痕。
若评审后决定接入，应把条目**上移**到「运行时依赖的第三方插件」一节。

- [dsh-context-lens](https://github.com/gordonlu/dsh-context-lens) · MIT · 版本 `0.3.1`（精确锁定，见 `packages/dsh-radar-context-lens/src/upstream.js`）。请求上下文剖析器（按插件归因的 token 占比 + KV cache 分账）。候选骨架拟把它锁版挂载，为「插件」页（`dsh-zhiyun-page-plugins`）补上上下文成本视角 —— 撤销「论文那一块能不能关」只能看见结构、看不见代价的缺口。**未复制其源码**，骨架内只有占位与 TODO。上游自述为 Work in progress，且 token 占比为**估算**而非 provider 计费真值。

## 含实现移植

- [ZJU-Omni](https://github.com/Vita0818/ZJU-Omni) · **MIT** · 移植提交 `192d1015a53a7b09f23ae143d56686c8fbf706af`。
  移植其**数据层**（教务课表/成绩/考试、学在浙大、CC98、拼题A 的接口适配）到 `packages/dsh-zhiyun-omni/`，
  做成数据包而非 AI 工具。改动（凭据层由 macOS 钥匙串改为 Windows DPAPI、删除 MCP 工具层等）
  与完整来源说明见该包的 [ATTRIBUTION.md](packages/dsh-zhiyun-omni/ATTRIBUTION.md)。

## 协议实现说明（无第三方代码引入）

`packages/dsh-zhiyun-net-proxy/src/connect.js` 实现了 HTTP `CONNECT`（RFC 9110）与
SOCKS5（RFC 1928 / RFC 1929）的客户端握手。这两者是**公开的协议标准**，实现按标准
编写，未复制任何第三方项目的代码。同目录 `relay.js` 的「单代理端点 + 就近分流」
思路，与 [dsh-net-proxy](https://github.com/mafeis/dsh-net-proxy)（MIT）所解决的
问题相邻（都涉及本地中继与代理转发），阅读其源码有助于理解该问题域；本包的实现
是独立编写的，未移植其代码，也未将其列为运行时依赖。
