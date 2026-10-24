# 第三方来源

本文件记录本仓库参考或移植的**第三方**项目与素材，是这类说明的唯一索引。作者自有项目（`zhiyun-pro`、`zju-mcp` 等）之间的搬迁属于同一作者，不在此列。

参考任何外部项目之前先确认对方的协议，参考之后必须在本文件追加说明；细节见 [CONTRIBUTING.md 第 3.3 节](docs/contributing/CONTRIBUTING.md#33-参考其他项目前先确认协议)。

本仓库自身未附 LICENSE（`package.json` 为 `private: true`）。这不改变第三方项目自身协议的约束力。

## 仅参考，未引入实现

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · MIT · 参考提交 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`。本项目的运行宿主：阅读其源码与文档以了解 Cordis 插件写法、宿主 API 与客户端启动图谱（种子词表等常量对照自其源码），未复制其实现；运行时以 npm 依赖形式引入。
- [DSH Codex UI](https://github.com/MichengAI/dsh-codex-ui) · Apache-2.0 · 参考提交 `ff42c6f9296ee7022ab2e919f849ecd05d4df63e`。参考其 manifest、浏览器 factory 装配、插槽所有权与宿主验证方式。没有引入该插件的业务或界面实现。

## 运行时依赖的第三方插件

以下项目以 npm 依赖形式引入，按各自协议使用，未复制其源码到本仓库：

- [dsh-paper-reader](https://github.com/GGboya/dsh-paper-reader) · MIT · 版本 `1.3.1`（精确锁定，见 `packages/dsh-zhiyun-host-paper/src/upstream.js`）。「论文阅读」栏目在 `packages/dsh-zhiyun-host-paper/` 里以子插件方式挂载它的宿主半边（HTTP 路由与 agent 工具），客户端界面由 `dsh-zhiyun-page-paper` 重写。锁版与改写理由见该包 README。

## 候选骨架引用的第三方插件（**尚未接入、未评审**）

以下条目由「生态雷达」任务登记。它们出现在 `packages/dsh-radar-*/` 的**候选骨架**里，
**未写入 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`，不会在运行时挂载**。
列在此处的目的是：**已阅读其源码/文档**，需按 CONTRIBUTING 3.3 留痕。
若评审后决定接入，应把条目**上移**到「运行时依赖的第三方插件」一节。

- [dsh-context-lens](https://github.com/gordonlu/dsh-context-lens) · MIT · 版本 `0.3.1`（精确锁定，见 `packages/dsh-radar-context-lens/src/upstream.js`）。请求上下文剖析器（按插件归因的 token 占比 + KV cache 分账）。候选骨架拟把它锁版挂载，为「插件」页（`dsh-zhiyun-page-plugins`）补上上下文成本视角 —— 撤销「论文那一块能不能关」只能看见结构、看不见代价的缺口。**未复制其源码**，骨架内只有占位与 TODO。上游自述为 Work in progress，且 token 占比为**估算**而非 provider 计费真值。
- [dsh-panda-calendar](https://github.com/runcat-tommy/dsh-panda-calendar) · MIT · 版本 `1.2.4`（精确锁定，见 `packages/dsh-radar-panda-calendar/src/upstream.js`）。离线圈日引擎（公历↔农历、干支、生肖、廿四节气）＋中国法定节假日（含调休）。候选骨架拟把它锁版挂载，为「今天」页（`dsh-zhiyun-page-today`）补上**历法表达** —— 本仓日期目前只有公历那一半。**未复制其源码**，骨架内只有占位与 TODO。⚠ 上游另含紫微斗数排盘、天气与时间戳转换，**均不拟接入**；⚠ 上游默认会在 `conversation.view` 注册一个「熊猫日历」标签页，**是否允许须人工裁决**。其内嵌历法数据派生自 [lunar-javascript](https://github.com/6tail/lunar-javascript)（6tail）· **MIT**，由上游的 `tools/gen-engine-data.mjs` 生成并被 `test/engine.test.mjs` 断言（1900-01-31..2100-12-31 共 73384 天逐日比对，0 处不一致）。

- [dsh-tool-plus](https://github.com/xiaoso456/dsh-tool-plus) · **MIT** · 版本 `0.1.14`（精确锁定，见 `packages/dsh-radar-tool-plus/src/upstream.js`）。基础工具增强：持久 bash 会话、输出最小化、后台作业托管、结构化 read/多模式 edit/原子 write、grep/glob。候选骨架拟把它锁版挂载，替换「今天」页终端分页的执行器 —— 本仓终端每次调用都是新 shell，`cd`/`export` 全丢，冗长输出直灌上下文。**未复制其源码**，骨架内只有占位与 TODO。⚠ **不拟整包套用上游 patch**：上游 `cordis.patch.yml` 会停用 `tool-bash`/`tool-pwsh`/`tool-fs`/`tool-fs-search` 四行官方工具，且其执行器不设沙箱参数，与本仓权限治理冲突（见骨架 TODO-1/TODO-2）。其内核为 [oh-my-pi](https://github.com/can1357/oh-my-pi)（can1357，**MIT**，★35,776），上游已用 `THIRD_PARTY_NOTICES.md` 声明移植范围；`@oh-my-pi/pi-natives` 随包分发上游编译的 Rust 二进制（不可审，建议关掉 hashline 只用纯 JS 编辑模式）。
- [dsh-session-notebook](https://github.com/timestatic/dsh-session-notebook) · **Apache-2.0** · 版本 `0.1.0`（精确锁定，见 `packages/dsh-radar-session-notebook/src/upstream.js`）。对话笔记插件：会话内划线/引用 → 可搜索、可打标签、可导出的个人知识库，带文本锚定、消息高亮与增量快照恢复。候选骨架拟把它锁版挂载，为「今天」页轨迹与「笔记」页之间补上**「对话 → 笔记」这条断掉的边** —— 本仓笔记域是纯存储，没有锚定、引用、快照。**未复制其源码**，骨架内只有占位与 TODO。⚠ 上游会向 **4 个宿主插槽**注入 UI（全站划线），接入前须先拆宿主/客户端；⚠ npm 包 `license` 字段为空（仓库 LICENSE 为 Apache-2.0，已核）。

- [pinyin-match](https://github.com/xmflswood/pinyin-match) · **MIT** · 版本 `1.2.10`（精确锁定，见 `packages/dsh-radar-pinyin-match/package.json`）。拼音检索库（汉字 / 全拼 / 首字母 / 多音字 / 繁简双字典），`match()` 直接回命中**闭区间**。候选骨架拟把它接到「学习」页（`dsh-zhiyun-page-study`）分层检索的 `findIn()` 底层：本仓自述「只做字面子串、不切词」，实测 `ddj` / `daodejing` / `lisao` 全部 0 命中 —— 中文课「只记得读音」的动作完全落空。**未复制其源码**，骨架内只有占位与 TODO。⚠ 上游**不是无脑更强**：整串拼音切分失败即整体回 `false`，且简体入口对纯繁体文本的拼音查询回 `false` → 必须「字面先行 + 繁体入口懒加载」，验收标准是**命中集合 ⊇ 旧实现**。详见该包 README「已知风险」。

- [Fuse.js](https://github.com/krisk/Fuse) · **Apache-2.0** · 版本 `7.5.0`（精确锁定，见 `packages/dsh-radar-search-fuzzy/package.json`）。轻量模糊检索库（bitap 近似匹配，回**闭区间**命中）。候选骨架拟把它接到「学习」页（`dsh-zhiyun-page-study`）分层检索的 `findIn()` 底层：本仓自述「只做字面子串」，实测 `付里叶` / `中植定理` / `离散傅里叶` **全部 0 命中**，而页面只说「没有命中」—— 用户会以为老师没讲过，而不是自己打错了。**未复制其源码**，骨架内只有占位与 TODO。⚠ `minMatchCharLength` **不能固定**（=1 时单字「的」在 8 条语料里命中 5 条噪声，=2 时「傅利叶」漏掉）→ 必须严格档→放宽档分层扫描，验收标准是**命中集合 ⊇ 旧实现**；⚠ `7.5.0` **无** `dist/fuse.min.js`（404），且**只能用 basic 构建**（完整构建的 extended search 会引入 `^ ! ' |` 新查询语法＝改档位）；⚠ 与 `dsh-radar-pinyin-match` **改同一行 `findIn`**，须合并裁决。详见该包 README。
- [MasteryTrace](https://github.com/RudrenduPaul/MasteryTrace) · **MIT** · 版本 `masterytrace-cli@0.1.3`（精确锁定，见 `packages/dsh-radar-mastery-bkt/package.json`）。BKT（`pInit` / `pTransit` / `pSlip` / `pGuess` 四参数 + 网格拟合）与 2PL IRT 的 TS 实现，另有独立 Python 移植。候选骨架拟把它接到「学习」页出题区**已有的知识点**上，把现在的二值规则（「近 3 次都错 / 近 3 次都对 / 有对有错」）**增强**为连续的后验掌握概率，为「先复习哪几个点」提供可排序的输入。**未复制其源码**，骨架内只有占位与 TODO。⚠ 上游 ★0、单点维护（建仓 2026-07-15）；⚠ 依赖 `zod@^4.6.5`（未压缩约 8.1 MB）；⚠ 其事件 schema 是「一条事件 = 一个技能」，本仓「一题多知识点」须拆事件，`responseCount` 会大于真实作答次数，**必须在界面上说清**；⚠ **接入前有前置阻塞**：本仓 `pointIds` 尚未落到题上（`makeItem` 不收、`itemToJson` 不序列化），见该包 README 的 TODO-0。

### 已阅读源码/文档、拟在候选骨架中**仅作能力提取**（不引入依赖）

以下条目由「生态雷达」登记。它们**既不是运行时依赖，也不含任何代码移植** ——
本仓**不引入**其依赖，只在**评审阶段**阅读其源码/文档以划定能力缺口与接口形状，
必要时由本仓自建等价实现。按 CONTRIBUTING 3.3「只做了简单借鉴」留痕。

- [ZYNotes](https://github.com/Auspiow/ZYNotes) · ⛔ **无许可证**（仓库无 `LICENSE` 文件，GitHub API `license: null`） · ★8 · 参考提交 `b9d5515f659f59f8bf5c242beb2fed8e0453c259`（2025-11-27）。智云课堂回放页 Chrome 扩展：把 PPT 画面 + 字幕导出为 PDF/Markdown，内含 `isSameImage()`（32×32 缩略图、逐通道差 <30、同像素率 ≥0.9）用于跳过重复帧。**已阅读**其 `README`、`inject.js`（全文 627 行）、`content.js` 与 `background.js` 头部，用于（a）确认「智云回放页的 PPT 序列中存在重复帧」这一**现象真实存在**，（b）实测其比对范围**只在相邻两张之间**（`inject.js:556-562`），对「A→B→A→C」这类**回看**命中率为 0 → 由此判定它**不构成本仓可用的更优实现**。候选骨架 `dsh-radar-slide-dedup` 内**只有占位与 TODO**，`dependencies` 为空，**未复制其任何源码**（无许可证，一行都不可取）；骨架只记录了三个**数值阈值**作为待标定初值。⚠ 该上游**无许可证** → 若将来许可证变化并决定移植，须把本条上移到「含实现移植」，否则任何从 `inject.js` 复制来的片段都属违规。
- [login-ZJU](https://github.com/5dbwat4/login-ZJU) · **MIT** · ★16 · npm `login-zju@1.0.9`（2026-07-03）。服务端库，把浙大 **12 个系统**（ZJUAM / ZDBK / COURSE / COURSES / CLASSROOM / APILIB / BOOKINGLIB / CC98 / ETA / FORM / OPEN / ALT）的登录态统一成一套 API（`new ZJUAM(u, p)` + `service.fetch()` 即用）。**已阅读其 README、`index.ts`、`src/utils/cookie-jar.ts`、`src/utils/fetch-utils.ts`、`src/classroom.ts`、`src/course.ts` 与 `LICENSE`**，用于（a）确认许可证实文为 MIT，（b）核对本仓 `dsh-zhiyun-source-classroom/src/auth.js` 的手写 CAS 流程与上游通用实现在**跳转链与票据形状**上的一致/差异。**未复制其源码**。其 `nanoid ^5.1.9` 为唯一运行时依赖。
- [lunar-javascript](https://github.com/6tail/lunar-javascript) · **MIT** · ★1704。农历 / 黄历权威实现（日历、公历↔农历、干支、生肖、节气、节日、彭祖百忌、每日宜忌）。**已阅读其文档与许可**，用于核实 `dsh-panda-calendar` 内嵌历法表的**来源与许可可追溯性**（见上一条）。**未复制其源码**，也未将其列为依赖。
- [better-zdbk](https://github.com/0x000005/better-zdbk) · **MIT** · ★3 · 单文件油猴脚本 `zdbk.user.js`（661 KB / 8706 行，`@version 1.2.1`），作用域 `zdbk.zju.edu.cn/jwglxt/xsxk*`。**已阅读**其 `LICENSE`、元数据头、`CONFIG.campusAliases`（约 211 行）、`isCampusMismatch()`（约 3180–3190 行）与 `updateCourseNotices()`（约 3196–3222 行）。用于划定本仓**「地点字符串 → 校区」这一层完全缺失**的能力缺口，并核对「全部节次都在本校区之外」的聚合口径。**未复制其源码**，也未将其列为依赖（上游未发布 npm）；候选骨架 `dsh-radar-campus-zone` 内只有占位与 TODO。⚠ 其主功能是 zdbk 选课页的整站 UI 改写，**不拟接入**；⚠ 其校区别名表仅 `紫金港 ⊃ 银泉` 一条，对不含校区名的楼栋会系统性误报，**不可照抄判定精度**。
- [iztro](https://github.com/SylarLong/iztro) · **MIT** · ★4227。紫微斗数排盘库，**顺带提供**完整的农历/干支/节气/节日历法能力。**已阅读其 README 与许可**，用于评估「历法底层取自建还是取上游」的取舍。⚠ 其**字面用途（命理排盘）与本仓无关**，若采用只可取历法模块 —— **该取舍属产品取向判断，尚未拍板**。**未复制其源码**。
- [obsidian-cc98-publish](https://github.com/stevenstg/obsidian-cc98-publish) · **MIT** · ★8 · Obsidian 插件，把笔记转成 **CC98 UBB / Markdown** 并复制到剪贴板（不自动发帖）。**已阅读**其 `package.json`、`LICENSE`、`README`、`src/md-to-ubb.ts`（288 行）、`src/links.ts`（217 行）、`src/convert.ts`（702 行）与 `src/images.ts`。用于（a）确认许可证实文为 MIT，（b）划定本仓**「Markdown → UBB」这一层完全缺失**（`grep -rln 'markdownToUbb\|toUbb\|toUBB' packages/` → 0；`dsh-zhiyun-source-cc98/src/ubb.js` 只有反向的 `ubbToText`），（c）实测其三个核心文件是**零宿主依赖纯函数**、可在 `node --experimental-strip-types` 下直接运行，而 `obsidian` 只出现在 `images.ts`/`settings.ts` 一类外围文件里。候选骨架 `dsh-radar-cc98-ubb-bridge` 内**只有占位与 TODO**，`dependencies` 为空。⚠ 该上游**未发布 npm**、`obsidian` 为宿主注入的虚拟模块 → **不能锁版挂载**，只能按能力提权移植并钉 git 提交（尚未钉）；⚠ 实测三处「按 Obsidian 成立、按 CC98 存疑」：引用块**不输出 `[quote]`**、表格原样透传、硬换行原样保留；⚠ 读/写不对偶（内联代码含 `[b]x[/b]` 时往返后被剥成 `x`）。**未复制其源码**。

> 若评审通过并实际移植 `md-to-ubb.ts` / `links.ts` / `convert.ts` 的纯逻辑，
> 须把上一条**上移到「含实现移植」**一节，并补：移植提交 SHA、移植范围（哪些函数）、
> 丢弃范围（`images.ts` 等 Obsidian 绑定部分）、以及文件头版权声明的位置。

## 含实现移植

- [ZJU-Omni](https://github.com/Vita0818/ZJU-Omni) · **MIT** · 移植提交 `192d1015a53a7b09f23ae143d56686c8fbf706af`。
  移植其**数据层**（教务课表/成绩/考试、学在浙大、CC98、拼题A 的接口适配）做成数据包而非 AI 工具。
  原落地包 `dsh-zhiyun-source-omni` 已于 2026-10-20 按平台拆分为本仓原生实现：

  | 平台 | 现落点 |
  | --- | --- |
  | 教务 `zdbk` | [dsh-zhiyun-source-zdbk](packages/dsh-zhiyun-source-zdbk/) |
  | CC98 | [dsh-zhiyun-source-cc98](packages/dsh-zhiyun-source-cc98/) |
  | 学习通 `xxt` | [dsh-zhiyun-source-xxt](packages/dsh-zhiyun-source-xxt/) |
  | 学在浙大 `xzzd` | [dsh-zhiyun-source-campus](packages/dsh-zhiyun-source-campus/)（原生重写，已修正 6 处缺陷） |
  | 拼题A `pta` | 同上（原生重写，并新增看题能力） |
  | 智云 `zhiyun` | [dsh-zhiyun-source-classroom](packages/dsh-zhiyun-source-classroom/)（原生重写） |

  各包的 README 记录了各自的改动与取舍；原移植说明见 git 历史（`dsh-zhiyun-source-omni/ATTRIBUTION.md`）。

## 协议实现说明（无第三方代码引入）

`packages/dsh-zhiyun-source-netproxy/src/connect.js` 实现了 HTTP `CONNECT`（RFC 9110）与
SOCKS5（RFC 1928 / RFC 1929）的客户端握手。这两者是**公开的协议标准**，实现按标准
编写，未复制任何第三方项目的代码。同目录 `relay.js` 的「单代理端点 + 就近分流」
思路，与 [dsh-net-proxy](https://github.com/mafeis/dsh-net-proxy)（MIT）所解决的
问题相邻（都涉及本地中继与代理转发），阅读其源码有助于理解该问题域；本包的实现
是独立编写的，未移植其代码，也未将其列为运行时依赖。
