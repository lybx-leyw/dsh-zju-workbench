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
- [dsh-panda-calendar](https://github.com/runcat-tommy/dsh-panda-calendar) · MIT · 版本 `1.2.4`（精确锁定，见 `packages/dsh-radar-panda-calendar/src/upstream.js`）。离线圈日引擎（公历↔农历、干支、生肖、廿四节气）＋中国法定节假日（含调休）。候选骨架拟把它锁版挂载，为「今天」页（`dsh-zhiyun-page-today`）补上**历法表达** —— 本仓日期目前只有公历那一半。**未复制其源码**，骨架内只有占位与 TODO。⚠ 上游另含紫微斗数排盘、天气与时间戳转换，**均不拟接入**；⚠ 上游默认会在 `conversation.view` 注册一个「熊猫日历」标签页，**是否允许须人工裁决**。其内嵌历法数据派生自 [lunar-javascript](https://github.com/6tail/lunar-javascript)（6tail）· **MIT**，由上游的 `tools/gen-engine-data.mjs` 生成并被 `test/engine.test.mjs` 断言（1900-01-31..2100-12-31 共 73384 天逐日比对，0 处不一致）。

- [dsh-session-notebook](https://github.com/timestatic/dsh-session-notebook) · **Apache-2.0** · 版本 `0.1.0`（精确锁定，见 `packages/dsh-radar-session-notebook/src/upstream.js`）。对话笔记插件：会话内划线/引用 → 可搜索、可打标签、可导出的个人知识库，带文本锚定、消息高亮与增量快照恢复。候选骨架拟把它锁版挂载，为「今天」页轨迹与「笔记」页之间补上**「对话 → 笔记」这条断掉的边** —— 本仓笔记域是纯存储，没有锚定、引用、快照。**未复制其源码**，骨架内只有占位与 TODO。⚠ 上游会向 **4 个宿主插槽**注入 UI（全站划线），接入前须先拆宿主/客户端；⚠ npm 包 `license` 字段为空（仓库 LICENSE 为 Apache-2.0，已核）。

### 已阅读源码/文档、拟在候选骨架中**仅作能力提取**（不引入依赖）

以下条目由「生态雷达」登记。它们**既不是运行时依赖，也不含任何代码移植** ——
本仓**不引入**其依赖，只在**评审阶段**阅读其源码/文档以划定能力缺口与接口形状，
必要时由本仓自建等价实现。按 CONTRIBUTING 3.3「只做了简单借鉴」留痕。

- [login-ZJU](https://github.com/5dbwat4/login-ZJU) · **MIT** · ★16 · npm `login-zju@1.0.9`（2026-07-03）。服务端库，把浙大 **12 个系统**（ZJUAM / ZDBK / COURSE / COURSES / CLASSROOM / APILIB / BOOKINGLIB / CC98 / ETA / FORM / OPEN / ALT）的登录态统一成一套 API（`new ZJUAM(u, p)` + `service.fetch()` 即用）。**已阅读其 README、`index.ts`、`src/utils/cookie-jar.ts`、`src/utils/fetch-utils.ts`、`src/classroom.ts`、`src/course.ts` 与 `LICENSE`**，用于（a）确认许可证实文为 MIT，（b）核对本仓 `dsh-zhiyun-classroom/src/auth.js` 的手写 CAS 流程与上游通用实现在**跳转链与票据形状**上的一致/差异。**未复制其源码**。其 `nanoid ^5.1.9` 为唯一运行时依赖。
- [lunar-javascript](https://github.com/6tail/lunar-javascript) · **MIT** · ★1704。农历 / 黄历权威实现（日历、公历↔农历、干支、生肖、节气、节日、彭祖百忌、每日宜忌）。**已阅读其文档与许可**，用于核实 `dsh-panda-calendar` 内嵌历法表的**来源与许可可追溯性**（见上一条）。**未复制其源码**，也未将其列为依赖。
- [iztro](https://github.com/SylarLong/iztro) · **MIT** · ★4227。紫微斗数排盘库，**顺带提供**完整的农历/干支/节气/节日历法能力。**已阅读其 README 与许可**，用于评估「历法底层取自建还是取上游」的取舍。⚠ 其**字面用途（命理排盘）与本仓无关**，若采用只可取历法模块 —— **该取舍属产品取向判断，尚未拍板**。**未复制其源码**。

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
