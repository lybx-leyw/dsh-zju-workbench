# 参考实现库（radar）

> **状态：静态归档。不再维护、不再更新、不接收新的候选。**
>
> 本文件取代原先的两份过程文档：`docs/ecosystem-radar/`（生态雷达的轮换与扫描记录）
> 与 `docs/robot-digest/`（反馈机器人的每日工作记录）。那两份记录的是**怎么跑**，
> 随对应机制一并停用；本文件记录**留下了什么**，供实现时参考。
>
> 历史数据（92 份扫描日报、1,736 行候选登记表、轮换状态、机器人日记）已从工作树移除，
> 需要追溯时从 git 历史取。它们回答的是「当时为什么这么判」，而本文件回答「现在有什么可用」。

---

## 1. 这是什么

`packages/radar/` 下的 **79 个包**是一次生态扫描留下的**候选骨架**。它们：

- **不是产品代码，不是正式包**，不参与构建、不在 profile 里、不进 `node_modules`；
- **几乎全部未评审、未测试**（79 个里只有 2 个写了能力清单，0 个有测试）；
- 唯一的用途是**实现前参考**：想知道「这个能力别人是怎么做的」「接进来大概长什么样」「要先回答哪些问题」时来这里翻。

一条使用原则：**参考，不要照搬。** 骨架里的代码是评估产物，不是经过验证的实现；
真正采用要按第 4 节重写并走正常包流程。

---

## 2. 骨架索引

「上游」是它的参考来源；「类型」A = 原生 DSH 插件包，B = 其他 JS 项目，— = 无明确上游（提取式或形态说明）。

| 骨架 | 上游 | 许可证 | 类型 | 一句话 |
| --- | --- | --- | --- | --- |
| `dsh-radar-activity-heatmap` | `grubersjoe/react-activity-calendar` | MIT | — | react-activity-calendar |
| `dsh-radar-agent-router` | `aqiu817/dsh-llm-agentrouter` | MIT | A | dsh-llm-agentrouter（MIT，原生 DSH bundle 插件） |
| `dsh-radar-agent-teams` | `NanmiCoder/dsh-agent-teams` | MIT | A | @nanmicoder/dsh-agent-teams@0.1.25（MIT，原生 DSH Web 插件） |
| `dsh-radar-answer-equiv` | `MikeMcl/decimal.js` | MIT | — | 为「学习」页填空题的作答判定加一层「等价答案」归一（中文数字 / 分数 / 千分位 / 科学计数 / 小数位） |
| `dsh-radar-bbob` | `JiLiZART/BBob` | MIT | — | @bbob/core 4.4.1 + @bbob/preset-html5 4.4.1 |
| `dsh-radar-better-markdown` | `zerob13/dsh-better-markdown` | MIT | — | 上游 dsh-better-markdown |
| `dsh-radar-campus-zone` | `0x000005/better-zdbk` | MIT | — | 提取 ZJU 选课网页增强（0x000005/better-zdbk，MIT）的「上课地点 → 校区归属 / 校区别名」… |
| `dsh-radar-career-calendar` | `Dunn1127/zju-career-calendar` | MIT | B | B 类能力提取：把上游 zju-career-calendar（MIT）的「校招宣讲采集 → iCal/PWA 订阅」管… |
| `dsh-radar-cc98-md-render` | `amiongogo/cc98-vscode` | MIT | — | 能力提取 amiongogo/cc98-vscode（MIT）的「UBB → 保结构 Markdown 文档」语义 |
| `dsh-radar-cc98-sdk` | `EviterLesRoses2/cc98-mcp` | MIT | — | 原计划锁版挂载上游 cc98-mcp；该上游在 npm 上不存在（E404） |
| `dsh-radar-cc98-ubb-bridge` | `stevenstg/obsidian-cc98-publish` | MIT | — | 提能力提取 obsidian-cc98-publish 的 markdownToUbb（Markdown → CC98 … |
| `dsh-radar-code-highlight` | `highlightjs/highlight.js` | BSD-3-Clause | B | highlight.js（BSD-3-Clause，零依赖、core 可按需注册语言） |
| `dsh-radar-commit-semantics` | — | MIT | — | tiny-conventional-commits-parser（conventional commit 解析） |
| `dsh-radar-compat-vet` | `liujianqiao701/dsh-compat-vet` | MIT | — | 上游 dsh-compat-vet |
| `dsh-radar-context-dashboard` | `bowenliang123/dsh-context` | Apache-2.0 | — | 上游 dsh-context |
| `dsh-radar-context-lens` | `gordonlu/dsh-context-lens` | MIT | A | 上游 dsh-context-lens（请求上下文剖析器） |
| `dsh-radar-credit-audit` | `Kepler16f/zju-kezhou` | MIT | B | Kepler16f/zju-kezhou 的确定性审计引擎（dsh-radar-credit-audit-vendor@… |
| `dsh-radar-deadline-budget` | `SifisoScS/scheduler` | MIT | — | 把「截止时间」当成有长度的时间块（Deadline + Interval） |
| `dsh-radar-deep-read` | `PensiveFei/deep-read-summarize` | MIT | — | 上游 deep-read-summarize |
| `dsh-radar-dom-parse` | `cheeriojs/cheerio` | MIT | — | cheerio@1.2.0（经 ./slim 入口，不含 undici） |
| `dsh-radar-dsh-market` | `dsh-market/dsh-market` | MIT | — | 锁定挂载上游 dsh-market |
| `dsh-radar-dsh-web` | `zhu1090093659/dsh-web` | Apache-2.0 | — | 上游 dsh-web 的创意工坊宿主半边 |
| `dsh-radar-evolve-modes` | `GraySilver/dsh-evolve-modes` | MIT | A | @graysilver/dsh-evolve-modes（MIT，原生 DSH Web 插件） |
| `dsh-radar-fc-month` | `fullcalendar/fullcalendar` | MIT | — | fullcalendar@5.11.5（MIT，零依赖 UMD 构建） |
| `dsh-radar-fence-normalize` | — | — | — | B 类「能力提取 + 封装」：把本仓四处模型响应围栏剥离合并为一份口径（容忍尾随说明 / 保留 JS 模板串的 ``` … |
| `dsh-radar-focus-machine` | `statelyai/xstate` | MIT | — | xstate 5.33.3 |
| `dsh-radar-fsrs-browser` | `open-spaced-repetition/fsrs-browser` | BSD-3-Clause | — | fsrs-browser（FSRS 的 WASM 实现，含 Optimizer + Scheduler） |
| `dsh-radar-fsrs-scheduler` | `open-spaced-repetition/ts-fsrs` | MIT | — | ts-fsrs（FSRS 间隔重复调度） |
| `dsh-radar-ics-export` | `adamgibbons/ics` | ISC | — | ics@3.12.1，给「规划」页补上「导出 .ics」：把课表与截止时间序列化成 RFC 5545 日历，强化式集成 |
| `dsh-radar-ics-rrule` | `jakubroztocil/rrule` | BSD-3-Clause | — | rrule（RFC 5545 重复规则） |
| `dsh-radar-kb-rag` | `Breeze136/dsh-kb-rag` | MIT | — | dsh-kb-rag@1.6.8 |
| `dsh-radar-knowledge-fold` | — | — | — | B 类「能力提取 + 封装」：给 dsh-zhiyun-knowledge 的字面检索补一层与 dsh-zhiyun-q… |
| `dsh-radar-knowledge-graph` | `cwbcheng/dsh-knowledge-graph` | MIT | A | 上游 dsh-knowledge-graph |
| `dsh-radar-lecture-notes` | `drpwchen/lecture-to-notes` | MIT | B | B 类能力提取：把上游 lecture-to-notes（MIT）的「录像/录音 + 课件 → 时间戳逐字稿 → 与讲义… |
| `dsh-radar-llm-fallback` | `omdsh-dev/dsh-llm-fallbacks` | MIT | A | dsh-llm-fallbacks（MIT，原生 DSH Web 插件） |
| `dsh-radar-lookatstudy` | `Kaiji-Z/dsh-plugin-lookatstudy` | MIT | — | 上游 dsh-plugin-lookatstudy |
| `dsh-radar-lowtide` | `KelaoHu/dsh-lowtide` | MIT | — | 上游 dsh-lowtide 0.2.8 |
| `dsh-radar-market` | `dsh-market/dsh-market` | MIT | — | 上游 dshmarket |
| `dsh-radar-markitdown-js` | `Mirza-Glitch/markitdown-js` | MIT | — | 上游 markitdown-js |
| `dsh-radar-mastery-bkt` | `RudrenduPaul/MasteryTrace` | MIT | — | 把 MasteryTrace（RudrenduPaul/MasteryTrace，MIT，npm masterytrac… |
| `dsh-radar-mcp-manager` | `hyqhyq3/dsh-mcp-manager` | MIT | — | dsh-mcp-manager（MCP 服务器管理：stdio/SSE/HTTP + OAuth） |
| `dsh-radar-me-memory` | `AskTheWay/dsh-auto-memory` | MIT | — | dsh-auto-memory@0.9.0 |
| `dsh-radar-media-captions` | `vidstack/captions` | MIT | B | media-captions（MIT，零依赖字幕格式解析器） |
| `dsh-radar-mycoursereviews` | `compsci-adl/mycoursereviews` | MIT | — | 借鉴上游 compsci-adl/mycoursereviews 的课程评价数据模型（课程/评分/标签/检索） |
| `dsh-radar-note-fulltext` | `kyr0/clientside-search` | MIT | — | clientside-search@1.8.1 |
| `dsh-radar-note-search` | `lucaong/minisearch` | MIT | — | minisearch@7.2.0 |
| `dsh-radar-note-search-tokenizer` | `lucaong/minisearch` | MIT | — | 为 minisearch 补一个中文分词器：CJK 按 bigram 切、拉丁按词切 |
| `dsh-radar-ocr-web` | `bent2685/ocr-web` | MIT | — | @ocr-web/core@0.2.1（MIT，纯 JS 浏览器 OCR，PP-OCRv5 + onnxruntime-… |
| `dsh-radar-panda-calendar` | `runcat-tommy/dsh-panda-calendar` | MIT | — | 上游 dsh-panda-calendar |
| `dsh-radar-paper-union` | — | — | — | dsh-ai-library@0.3.39 |
| `dsh-radar-pinyin-match` | `xmflswood/pinyin-match` | MIT | — | pinyin-match 1.2.10 |
| `dsh-radar-plugin-audit` | `jkrandom-sudo/dsh-plugin-audit` | MIT | — | 上游 dsh-plugin-audit |
| `dsh-radar-plugin-graph` | `antoine-coulon/skott` | MIT | — | [candidate skeleton · unreviewed · not wired into profile] F… |
| `dsh-radar-plugin-ledger` | `ZSeven-W/dsh-harbor` | MIT | — | @zseven-w/dsh-harbor@0.1.0-rc.4 |
| `dsh-radar-plugin-score` | `PerryLink/dsh-score` | Apache-2.0 | — | 上游 dsh-score |
| `dsh-radar-pta-progress` | `jinzcdev/vscode-pintia` | MIT | — | 拼题A 做题进度的「口径修复 + 提交链路参考」：修正本仓 progress() 把已通过算成未通过的显示口径 |
| `dsh-radar-refs-import` | `citation-js/citation-js` | MIT | — | citation-js 0.9.0 解析族 |
| `dsh-radar-repeat-law` | `MAGMA27/dsh-calendar` | Apache-2.0 | — | 给「规划」页的重复任务补上三条本仓缺失的不变量：区间 N>1 能填、学校假期（寒假/暑假）能跳、取消勾选能把多生成的那一… |
| `dsh-radar-research-market` | `dsh-research/dsh-research` | MIT | — | 上游 dsh-research |
| `dsh-radar-review-due` | `open-spaced-repetition/ts-fsrs` | MIT | — | ts-fsrs 5.4.2 |
| `dsh-radar-score-practice` | `opensheetmusicdisplay/opensheetmusicdisplay` | BSD-3-Clause | — | opensheetmusicdisplay（MusicXML→SVG 乐谱渲染）与 osmd-audio-player（… |
| `dsh-radar-search-fuzzy` | `krisk/Fuse` | Apache-2.0 | — | Fuse.js 7.5.0（仅 basic 构建） |
| `dsh-radar-search-rank` | `lucaong/minisearch` | MIT | — | minisearch@7.1.2 |
| `dsh-radar-search-segment` | — | — | — | jieba-wasm@2.4.0 |
| `dsh-radar-section-deeplink` | — | — | — | 跨节深链：用来说明「笔记里的 zy://section 跨节链接跳不过去」缺的不是库 |
| `dsh-radar-session-notebook` | `timestatic/dsh-session-notebook` | Apache-2.0 | — | 上游 @timestatic/dsh-session-notebook |
| `dsh-radar-skill-stats` | `chen-zz20/dsh-skill-stats` | MIT | — | @dsh-external/dsh-skill-stats@0.1.0 |
| `dsh-radar-slide-dedup` | `Auspiow/ZYNotes` | 无 | — | 在讲义生成前剔除「回看重复页」 |
| `dsh-radar-temml` | `ronkok/Temml` | MIT | — | temml（TeX → MathML，零依赖） |
| `dsh-radar-todo-fence` | `8eoyw/zju-learning-cli` | — | — | 学在浙大待办的「判据围栏」：给今天/规划页已消费的那一份 rows 补上可复核的来源与完整性元数据（fast/slow … |
| `dsh-radar-tongge-schedule` | `DongLanQwQ0/ZJU-Tongge-Schedule` | MIT | — | 提取同格（DongLanQwQ0/ZJU-Tongge-Schedule，MIT）的 .ics 课表本地解析与撞课/同楼… |
| `dsh-radar-tool-plus` | `xiaoso456/dsh-tool-plus` | MIT | — | 上游 @xiaoso/dsh-tool-plus 0.1.14 |
| `dsh-radar-upstream-radar` | `MicroMilo/upstream-radar` | Apache-2.0 | — | 上游 upstream-radar@0.45.0 |
| `dsh-radar-vault-graph` | — | — | — | remark-parse@11.0.0 + unist-util-visit@5.1.0 + graphology@0.… |
| `dsh-radar-vault-parse` | `markdown-it/markdown-it` | — | — | markdown-it（MIT，零运行时依赖，CommonMark 级别解析器） |
| `dsh-radar-week-parser` | `wowhao333/shou-graduate-calendar-exporter` | — | — | 课表周次归一化（周次字符串→周次数组、第 1 周周一反推） |
| `dsh-radar-zju-login` | `5dbwat4/login-ZJU` | — | — | 以「锁版挂载 + 外围兼容层」方式引入上游 login-zju@1.0.9 |
| `dsh-radar-zju-recorder` | `p16e0nd/zju-recorder` | MIT | — | 从上游 p16e0nd/zju-recorder 提取智云 SSO（OAuth2 授权码 + _token cookie… |
| `dsh-radar-zotero-bridge` | `nftuoa/dsh-zotero` | — | — | 以「锁版挂载 + 外围兼容层」方式引入上游 @local/dsh-zotero 1.0.1 |

---

## 3. 三条判据

这三条是当年评审时用的，**仍然成立**，可以直接拿来判断一个参考值不值得跟进。

### 3.1 强化式集成（核心判据）

❌ 不得简单集成重复功能；✅ 某功能已有、外部有更优底层时接进来增强它。三条**同时**成立才算：

1. **仍是同一个面板** —— 不新开导航项，落在既有页面里；
2. **功能仍相似正交** —— 两者回答同域的不同问题，不重叠；
3. **底层多调了更优质实现** —— 确实引入了本仓没有的、更优的实现。

反例（真实教训）：把「图谱」整包塞进笔记页，让页面 bundle 内联了 1.3 MB 的 cytoscape ——
「画图」不是那个页面的职责。正确做法是新建独立包，页面只 `import`。

### 3.2 许可证白名单

| 许可 | 判定 |
| --- | --- |
| `MIT` / `Apache-2.0` / `BSD-2-Clause` / `BSD-3-Clause` / `ISC` / `0BSD` / `Unlicense` / `CC0-1.0` | ✅ 可引入 |
| `GPL` / `AGPL` / `LGPL` / `MPL` | ⛔ 只登记，**不得摘取任何代码** |
| 无许可证 / `NOASSERTION` | ⛔ 不采用 |

索引里标 `无` 的那一个（`dsh-radar-slide-dedup`）就是因为上游没有 LICENSE 文件。

### 3.3 保守原则

不再维护之后，这条从「什么时候删骨架」变成**「引用时看清它的状态」**：

- 骨架默认**永久保留**，当作档案；
- 如果某天要删，唯一理由是「整个目录都要清掉」，而不是「看起来没用了」；
- **不要**因为它是骨架就认为里面没有可用信息 —— 它记录的是当时做过的判断。

---

## 4. 真要采用某一条时

这不是转正流程（那个机制已停用），只是三条别踩的坑：

1. **新建正式包**，不要原地改骨架的 `package.json` 当正式包用。骨架从未被评审，继承它的身份等于跳过评审。
2. **写测试**。79 个骨架里有测试的是 0 个——别人不敢动一个没有测试的包。
3. **先回答骨架 README 里的「接入前必须先做的事」**，逐条划掉，不留「后续再说」。

正式包怎么写、`OWNERS` 怎么标、`ATTRIBUTION` 怎么记，见
[CONTRIBUTING.md](./contributing/CONTRIBUTING.md)；第三方来源记录见根 [ATTRIBUTION.md](../ATTRIBUTION.md)。

---

## 5. 两条实测结论（值得留下来）

这两条是当年花力气测出来的，比骨架本身更值钱。

### 5.1 锁版依赖：peer 区间相交 ≠ 可共装

2026-10-27 对 61 条锁版依赖做了五层体检：

| 层 | 检查内容 | 结果 |
| --- | --- | --- |
| ① 结构 | 版本是否精确（禁 `^ ~ >=`）、README 是否声明「未评审/未接入」 | ✅ 67/67 |
| ② 存在 | `(name, version)` 在 npm 上是否真实存在 | ❌ **1 条不存在** |
| ③ 新鲜 | 锁版是否落后 `dist-tags.latest` | ℹ 17 条落后 |
| ④ 共存（静态） | 两个上游包对同一宿主包的 peer 区间是否相交 | ⚠ 3 对 |
| ⑤ 共存（实测） | 两个上游包能否被 npm 装进**同一棵树** | ⚠ **43 对** |

**⑤ 比 ④ 多报 40 对**——这不是 ④ 写错了，而是它原理上看不见：多个包的约束落在**不同的宿主子包**上，
两两各自都有共同版本，但拼成一棵树时 npm 必须在同一层同时满足两个互斥的区间，无解。

> 结论：判「能不能一起接进来」只能用⑤（实跑 `npm install --dry-run`），不能用④（区间相交）。

唯一一条 npm 上不存在的：`dsh-radar-credit-audit-vendor@1.7.0` —— 上游 `Kepler16f/zju-kezhou`
没有 npm 包，README 里写的「把 engine/ 发到内部 scope」从未发生。

### 5.2 图谱三包的处置

2026-10-28 对三个图谱骨架做了实测判定，结论是三种不同结局，可作为「怎么判」的样板：

| 骨架 | 判定 | 处置 | 理由（实测，非 README 自述） |
| --- | --- | --- | --- |
| `dsh-radar-note-graph` | **可移植** | 新建独立包 | 本仓确认无任何图谱渲染器，是「无 → 有」 |
| `dsh-radar-vault-graph` | 只有一项能力成立 | 提取 F-4 → vault 核心 | 声称的 F-1/F-2/F-3 实测均不成立 |
| `dsh-radar-knowledge-graph` | **前提错误** | 只提取「使用计数」 | 上游根本不是笔记语义图（`grep` 结果为零） |

> 样板价值：三条都没有「读 README 就下结论」，全部靠实测。**候选自述的定位不可信**。

---

## 6. 与其它文档的关系

| 文档 | 关系 |
| --- | --- |
| [CONTRIBUTING.md](./contributing/CONTRIBUTING.md) | 正式包怎么写、Owner 怎么标、测试放哪 |
| [AGENTS.md](./contributing/AGENTS.md) | 文件归属与信息泄露检查 |
| [ATTRIBUTION.md](../ATTRIBUTION.md) | 参考他人实现后如何记录来源 |

一句话概括本文件：**这里放的是「别人怎么做过」的证据，不是「我们该做什么」的待办。**
参考完请自己写，不要照抄。
