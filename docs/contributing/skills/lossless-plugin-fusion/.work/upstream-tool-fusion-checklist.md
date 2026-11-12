# 上游能力 → 本仓 tool 融合清单（2026-11-12）

> **这一份是什么**：上游 `module.json` 声明的 **162 条 provides**，逐条对照本仓
> 「有没有对外的 **tool**」，分成：
>
> - **A · 只缺 tool** —— source 已有完整方法，补工具即可；
> - **B · source 也要补** —— 能力本身没实现或不完整；
> - **C · 明确不做** —— 有用户裁决，不列入范围。
>
> **为什么要这份清单**：`packages/tool/` 刚按域拆完（见
> [`tool-domain-restructure-2026-11-12.md`](tool-domain-restructure-2026-11-12.md)）。
> 一域一包之后，补 tool 是**只动一个包**的局部改动；之前混装在 `campus-write`
> 里，每加一个工具都要动同一份文件。

---

## 零、先纠正一个容易误判的前提

**上游不是「有几十个 tool」，它只有 1 个代理 + 8 个专用工具。**

| 工具 | 位置 | 作用 |
| --- | --- | --- |
| `zju` | `plugin/host/zju-tool.mjs:59` | **执行一条 CLI 命令**：`args: ["notice","search","--keyword","奖学金"]` |
| `campus_profile` | `plugin/host/tools.mjs:52` | 个人档案（read / write） |
| `campus_note` | `plugin/host/tools.mjs:72` | 备忘录（read / write） |
| `campus_schedule` | `plugin/host/tools.mjs:90` | 日程与校历（read / calendar / events） |
| `campus_context` | `plugin/host/tools.mjs:114` | 校园档案与关系核对（6 个 action） |
| `campus_notify` | `plugin/host/tools.mjs:168` | 页面角标提醒 |
| `campus_mail` / `campus_mail_send` | `plugin/host/rows/mail.mjs` | 邮箱读写 |
| `campus_wechat` | `plugin/host/rows/wechat.mjs` | 微信 |

那 162 条 provides **不是** 162 个工具，而是 `zju` 能跑的 **162 条命令**。
上游把工具数压到 4 个常驻，代价是模型得会拼命令行参数。

本仓走相反方向（一个动作一个字段齐全的工具），所以下面的清单回答的是
**「哪些能力值得变成工具」**，不是「上游有几个工具」。

### 本仓现状：25 个工具（2026-11-12 之后）

> 本节原来写的是「13 个工具，一条查课表 / 查成绩 / 看通知都没有」。那份现状已被
> 本轮落地改写，见 §八；**这一张表是新的现状**，上面的分类与统计仍是当时的口径。

| 包 | 写工具 | 读工具 |
| --- | --- | --- |
| `tool/zdbk` | `campus_course_select` | `campus_zdbk_read` |
| `tool/sztz` | `campus_activity` | `campus_sztz_read` |
| `tool/tyys` | `campus_venue` | `campus_tyys_read` |
| `tool/xuezai` | `campus_homework`、`campus_checkin` | `campus_xuezai_read` |
| `tool/pta` | `campus_answer` | `campus_pta_read` |
| `tool/cc98` | `campus_post`、`campus_react`、`campus_signin` | `campus_cc98_read` |
| `tool/lab` | `campus_lab_select` | `campus_lab_read` |
| `tool/classroom` | — | `study_catalog`、`study_read`、`study_search`、`campus_classroom_read` |
| `tool/notice`（新） | — | `campus_notice_read` |
| `tool/chalaoshi`（新） | — | `campus_chalaoshi_read` |
| `tool/ebook`（新） | — | `campus_ebook_read` |
| `tool/yjsy`（新） | — | `campus_yjsy_read` |

**读工具一律不过审批，写工具一律逐次审批 —— 两条注册链，见 §8.4。**

⚠️ 它们与写工具一样**还没有挂载点**（preset / D11 未定）：工具在表里，但到不了
agent。这是独立于本清单的空洞（§8.6）。

---

## 一、总账（可复算）

| 分类 | 条数 |
| --- | --- |
| 已有 tool 覆盖 | **20** |
| 会话动作（`session login/status/logout/import-cookie`，**无需 tool**） | **35** |
| **待补 tool** | **107** |
| 合计 | **162** ✅ |

107 条再分：

| 分类 | 条数 | 含义 |
| --- | --- | --- |
| **A · 只缺 tool** | **84** | source 方法已存在且完整 |
| **B · source 也要补** | **21** | 能力缺失或不完整 |
| **C · 明确不做** | **2** | 知网非会话部分（用户裁决） |
| 合计 | **107** ✅ |

> **为什么「会话动作」不算缺口**：`session login` / `status` / `logout` 在本仓是
> 装配层的事（`source/login` + 设置页），不是 agent 该调的工具。让模型去
> 「登录教务网」既没必要也不安全。

### 逐模块分布

| 模块 | 待补 | A（只缺 tool） | B（source 也要补） |
| --- | --- | --- | --- |
| `cc98` | 21 | 21 | 0 |
| `zhiyun`（课堂） | 13 | 7 | 6 |
| `xuezai` | 12 | 10 | 2 |
| `zdbk` | 11 | 11 | 0 |
| `pta` | 8 | 8 | 0 |
| `chaoxing`（学习通） | 7 | 0 | 7 |
| `sztz` | 7 | 7 | 0 |
| `lab` | 5 | 3 | 2 |
| `doc` | 4 | 0 | 4 |
| `notice` | 4 | 4 | 0 |
| `tyys` | 4 | 4 | 0 |
| `webvpn` | 4 | 4 | 0 |
| `chalaoshi` | 3 | 3 | 0 |
| `cnki` | 2 | 0 | 0（C 类） |
| `ebook` | 1 | 1 | 0 |
| `yjsy` | 1 | 1 | 0 |
| **合计** | **107** | **84** | **21** |

> 各行 A 相加 = 84，B 相加 = 21，C = 2，84+21+2 = 107 ✅

---

## 二、A 类 · 只缺 tool（84 条）

### A-1 · 教务网 `tool/zdbk`（11 条）

| provides | source 方法 | 说明 |
| --- | --- | --- |
| `zdbk timetable` | `timetable()` | |
| `zdbk exams` | `exams()` | |
| `zdbk grades` | `grades()`、`gpaSummary()` | `gpaSummary` 是三份 GPA、4.3 制，本仓比上游强 |
| `zdbk plan list` | `planList()` | |
| `zdbk plan view` | `planView()` | 只回 `pdf_url`，不下载（D21 已澄清：落盘合法，只是没做） |
| `zdbk selection context` | `selectionContext()` | |
| `zdbk selection courses` | `selectionCourses()` | |
| `zdbk selection search` | `selectionSearch()` | |
| `zdbk selection sections` | `selectionSections()` | |
| `zdbk selection selected` | `selectionSelected()` | |
| `zdbk selection credits` | `selectionCredits()` | |

> **⚠️ 这不是「加个功能」，是让现有写工具能用。**
> `campus_course_select` 要求 `section`（教学班号），而班号只能靠
> `selectionSections()` 拿到。现在模型拿不到，只能问用户要一个用户不知道的编号。
> **不补这 11 条，选课功能事实上不可用。**

### A-2 · 学在浙大 `tool/xuezai`（10 条）

| provides | source 方法 |
| --- | --- |
| `xuezai todos` | `todos()`（三档 fast / slow / diff） |
| `xuezai course list` | `courses()` |
| `xuezai course view` | `courseBundle()` |
| `xuezai material list` | `materials()` |
| `xuezai homework list` | `assignments()` |
| `xuezai homework view` | `activity()`、`activitySubmission()` |
| `xuezai rollcall status` | `rollcallHistory()` |
| `xuezai rollcall history` | 同上 |
| `xuezai rollcall number` | `rollcallHistory()` 的数字点名分支 |
| `xuezai rollcall all` | 同上 |

> **同样不是「加功能」**：`campus_homework` 要 `homework` 参数，它来自
> `assignments()`。不补读侧，交作业同样不可用。

### A-3 · CC98 `tool/cc98`（21 条）

| 分组 | provides |
| --- | --- |
| 版块与主题 | `hot`、`search`、`board list`、`board topics`、`board tags`、`topic view`、`topic download`、`user` |
| 楼层 | `floor rating-reasons`、`floor original` |
| 私信 | `private-message list`、`private-message view` |
| 账号 | `account overview`、`topics`、`posts`、`history`、`favorites`、`following`、`feed`、`notifications`、`signin-month` |

**CC98 是 21 条里唯一「纯读、风险为零、使用频率最高」的一个**，
且 source 侧方法全在（`reads.js` 有 39 个方法）。

### A-4 · 二课 / 场馆（11 条）

| 模块 | provides |
| --- | --- |
| `sztz`（7） | `credits`、`activity list`、`activity new`、`activity mine`、`activity favorite`、`projects`、`notices` |
| `tyys`（4） | `venue list`、`venue order list`、`venue notice`、`rollcall history` |

### A-5 · 拼题A 读侧 `tool/pta`（8 条）

| provides | source 方法 |
| --- | --- |
| `pta homework list` | `problemSet()` |
| `pta homework view` | `getExam()` |
| `pta problem view` | `problems()`、`problem()` |
| `pta submission list` | `submissions()` |
| `pta submission view` | `submission()` |
| `pta reconcile` | `progress()` |
| `pta homework start` | `getExam()`（**写操作**：会启动答题计时） |
| `pta homework finish` | 交卷（**写操作**） |

> ⚠️ **`homework start` / `homework finish` 是写操作，不是读**。
> 「开始答题」在拼题A 会**启动计时**，交卷之后不能改 —— 它们必须走
> `tool/pta` 的审批链路，与 `campus_answer` 同一套，不能当读工具放行。
>
> 这也解释了本仓现在的 `campus_answer` 为什么必须有前置条件：
> `pta/src/writes.js` 会检查「题集是否已开始作答」，没开始就拒绝 ——
> 而「开始」这个动作**本仓刻意没做**（`pta` 的 `README.md:107-110` 记过原因：
> 替用户开计时是替他做决定）。这 2 条要不要补，属于**产品决定**，不是缺口。

> `campus_answer` 要 `problemSet` + `problem` 两个编号，都来自读侧。
> 缺这层的话，`campus_answer` 同样只能让用户猜编号。

### A-6 · 课堂 `tool/classroom`（7 条）

| provides | source 方法 |
| --- | --- |
| `zhiyun search courses` | `searchCourses()` |
| `zhiyun search lessons` | `listLessons()` |
| `zhiyun timetable` | `listCourses()` |
| `zhiyun search resources` | `searchResources()` |
| `zhiyun search subtitles` | `searchCaptions()` |
| `zhiyun live status` | `liveStatus()` |
| `zhiyun text` | `text()` |

### A-7 · 四个小包 + webvpn（13 条）

| 模块 | provides |
| --- | --- |
| `notice`（4） | `list`、`view`、`new`、`sources` |
| `chalaoshi`（3） | `search`、`teacher`、`course` |
| `webvpn`（4） | `probe`、`check`、`url encode`、`url decode` |
| `ebook`（1） | `search` |
| `yjsy`（1） | `timetable` |

> `webvpn` 这 4 条**刚补齐**（`src/probe.js`、`src/reach.js`），只是还没做成 tool。
> 它们更可能挂在**设置页的诊断按钮**上，而不是给 agent 的工具。

### A-8 · lab `tool/lab`（3 条）

`lab timetable`、`lab courses`、`lab labs`（`campus_lab_select` 要的
`lab` + `week` 来自 `labs()`）。

---

## 三、B 类 · source 也要补（21 条）

**这 21 条逐条可追溯**（避免像首版那样把 A/B 混算）：

| 模块 | 条数 | 具体 provides |
| --- | --- | --- |
| `doc` | **4** | `doc text`、`doc pdf`、`doc pages`、`doc find` |
| `chaoxing` | **7** | `course list`、`chapter list`、`material list`、`video list`、`homework list`、`material download`、`video download` |
| `zhiyun` | **6** | `setup`、`trans audio`、`live start`、`live stop`、`check`、`download` |
| `xuezai` | **2** | `material download`、`homework download` |
| `lab` | **2** | `lab notices`、`lab selected`（方法在但不完整） |
| **合计** | **21** | |

### B-1 · 下载执行（4 条，散在三个模块）

| provides | 现状 |
| --- | --- |
| `xuezai material download` | source 只给元数据 + `allowDownload` |
| `xuezai homework download` | 同上 |
| `chaoxing material download` | `downloadParams()` 给参数，**无消费者** |
| `chaoxing video download` | 同上 |
| `zhiyun download` | `classroom/download.js` 有断点续传，无 tool 消费（已算在上表 zhiyun 6 里） |

> **D21 已更正**：source 可以落盘（用户 2026-11-12 明确否定了我擅自加的
> 「source 不碰文件系统」）。所以这几条**不再是裁决问题**，只是工作量问题。
>
> `cc98 topic download` 不在 B 类 —— 它的 `topicDownload()` 已经有可用的落盘
> 能力（可选 `downloadDir`），所以归 A-3。

### B-2 · 文档处理 `doc`（4 条）

| provides | 卡在哪 |
| --- | --- |
| `doc text` | 部分：`classroom-media/src/pdf/parse.js` 有 PDF 取字，但 `mergePages:true` **丢了页边界** |
| `doc pdf` | `pdf-lib` 全仓 0 命中，且本仓不跑 `npm install` |
| `doc pages` | 依赖页边界（上一条） |
| `doc find` | 同上 |

**归属未裁决（Q-1）**，且是唯一「连数据模型都不支持」的一整块。

### B-3 · 课堂进阶（6 条）

| provides | 缺什么 |
| --- | --- |
| `zhiyun setup` | FFmpeg / ASR 模型安装动作 |
| `zhiyun trans audio` | `transcribeAudio()` 在，但**无装配方**注入 ASR 内核 |
| `zhiyun live start` / `stop` | `liveStart()` 等有，直播链路未真机验证 |
| `zhiyun check` | 部分 |
| `zhiyun download` | 见 B-1 |

### B-4 · 学习通 `chaoxing`（7 条）

`xxt` 10 条 provides 里会话 3 条已算进「无需 tool」，
其余 7 条**全部只到半成品**：缺「资料」栏、只有参数无执行方等，
见 `coverage-gaps.md` 漏-6。

### B-5 · lab 的两条半成品（2 条）

`lab notices`、`lab selected` —— `notices()` / `mySelections()` 存在但字段不全。

---

## 四、C 类 · 明确不做（2 条）

| provides | 依据 |
| --- | --- |
| `cnki search`、`cnki download` | **用户明说「不做知网数据源」**，见 `coverage-gaps.md` 第十二 |

（`cnki` 另有 3 条会话动作，已算进「无需 tool」的 35 条。）

`source/cnki` 已删除，所以这 2 条**不列入任何阶段**。

---

## 五、建议的融合顺序

判据：**先让现有写工具真正能用，再扩覆盖面。**

| 阶段 | 内容 | 条数 | 为什么 |
| --- | --- | --- | --- |
| **1** | `tool/zdbk` 读侧 | 11 | 选课要的 `section` 只能从这里拿到 —— **不补则选课不可用** |
| **2** | `tool/xuezai` 读侧 | 10 | 交作业要的 `homework` id 同上 |
| **3** | `tool/cc98` 读侧 | 21 | 纯读、零风险、使用频率最高 |
| **4** | 四个小包（notice / chalaoshi / ebook / yjsy） | 9 | 纯读，一域一包，成本最低 |
| **5** | `tool/pta` 读侧 | 8 | 与 `campus_answer` 配套 |
| **6** | `tool/sztz` + `tool/tyys` 读侧 | 11 | 报名要的活动/场地 id 来自这里 |
| **7** | `tool/classroom` 读侧 | 7 | 已有 3 个工具，补在同一包 |
| **8** | B 类逐项（先定归属再动手） | 33 | 每条都要先裁决或补依赖 |

**阶段 1～7 共 77 条，全部属于 A 类（只缺 tool）。**
一域一包之后，每个阶段只动一个 `packages/tool/<域>/`。

---

## 六、两件必须先说清的事

### 6.1 工具太多会挤占上下文

上游把 162 条压成 1 个代理工具，是有道理的：**每个工具声明都占 token**。
本仓若把 84 条都做成独立工具，工具表会从 13 涨到 97，误选率会上去。

**建议按域合并成「一个工具 + action 枚举」**，就像现有的
`campus_course_select`（3 个 action）、`campus_post`（4 个 action）：

| 包 | 合并后的工具数 |
| --- | --- |
| `tool/zdbk` | 2（`campus_course_select` 已有 + `campus_zdbk_read`） |
| `tool/cc98` | 4（3 个写 + `campus_cc98_read`） |
| `tool/xuezai` | 3 |
| 其余 | 各 1～2 |

**84 条能力 ≈ 新增 12～14 个工具**（按域合并后）。

### 6.2 「不涨覆盖率但涨可用性」

阶段 1～2 做完，`upstream-gap-audit` 里的 `provides` 覆盖率**不会变**（那些
能力本来就记作「已实现」，缺的只是工具面）。但**选课与交作业会从「模型拿不到
参数」变成「能用」**。

这与审计的结论一致：**上游赢在「能用」，本仓赢在「能加工」**。
`provides` 覆盖率量的是后者，量不出前者。

---

## 七、怎么复核这份清单

```bash
# 1) 上游权威清单（162 条）
node -e "..."   # 见本文档 §一的复算脚本

# 2) 本仓现有工具
grep -rn "name: 'campus_\|name: 'study_" packages/tool/*/src/index.js

# 3) 跨层契约（新增工具后必跑）
node scripts/probe-write-contract.mjs
```

**新增读工具的验收口径**：

1. source 方法已存在且返回完整（不是「只回链接」那种半成品）；
2. 工具参数里**不出现**用户拿不到的东西 —— 例如要求 `section` 却已提供查
   `section` 的 action；
3. 读操作**不过审批**（审批只给写操作）；
4. 若依赖跨域字段（如 `gpaSummary` 依赖学籍），在 `coverage-gaps.md` 登记。

---

## 八、落地记录（2026-11-12）

本轮把 **A 类 84 条里能直接做的**做成了 **12 个读工具**，并补了 3 处 source 缺口。

### 8.1 新增的读工具（按域，一个域一个工具 + action 枚举）

| 包 | 工具 | action 数 | 覆盖的 provides |
| --- | --- | --- | --- |
| `tool/zdbk` | `campus_zdbk_read` | 12 | 11 条 A-1 全部（`selection credits` 与 `gpa` 各算一条） |
| `tool/xuezai` | `campus_xuezai_read` | 7 | 10 条 A-2（`homework view` 一条覆盖 `activity` + `activitySubmission`；4 条点名只有 `rollcallHistory` 有 source 方法） |
| `tool/cc98` | `campus_cc98_read` | 22 | 21 条 A-3 全部 |
| `tool/pta` | `campus_pta_read` | 7 | A-5 的 7 条读（含 `problem view` 的清单 + 正文两步；`homework start` / `finish` **未做**，见 8.3） |
| `tool/sztz` | `campus_sztz_read` | 6 | A-4 的 7 条里 6 条（`activity favorite` **未做**，见 8.3） |
| `tool/tyys` | `campus_tyys_read` | 5 | A-4 的 4 条（`venue list` 一个 action 覆盖目录与余量）+ 签到历史 |
| `tool/lab` | `campus_lab_read` | 10 | A-8 的 3 条 + `lab selected` / `lab notices`（两条半成品已能读） |
| `tool/classroom` | `campus_classroom_read` | 7 | A-6 的 7 条**读侧**（`zhiyun text` 用 `liveText`，`zhiyun live start/stop` 未做） |
| `tool/notice`（新） | `campus_notice_read` | 4 | A-7 的 4 条 |
| `tool/chalaoshi`（新） | `campus_chalaoshi_read` | 3 | A-7 的 3 条 |
| `tool/ebook`（新） | `campus_ebook_read` | 1 | A-7 的 1 条 |
| `tool/yjsy`（新） | `campus_yjsy_read` | 1 | A-7 的 1 条 |

`webvpn`（4 条）**没有**做成工具：清单 A-7 自己就说「它们更可能挂在设置页的诊断
按钮上，而不是给 agent 的工具」。做成工具会让模型有机会去碰出口配置。

**工具数从 13 涨到 25**（新增 12 个读工具）。

清单 §6.1 估的是「84 条能力 ≈ 新增 12～14 个工具」，实际新增 **12** 个，落在
估计区间内。差别的来源是清单按「能力条数 ÷ 域」估，实际按「一个域一个工具」
落 —— `cc98` 的 21 条压成 1 个工具、`zdbk` 的 11 条压成 1 个，所以工具数比
能力条数少得多。

### 8.2 顺带补的 source 缺口（3 处）

| # | 缺什么 | 补在哪 | 为什么归 source |
| --- | --- | --- | --- |
| S-1 | `xuezai course list` | `source/xuezai` 的 `xzzdRead` 加 `courses` 动作 | 「正在上的学期」的判据在 `activeSemesterIds()` 里，复制到工具层就会漂 |
| S-2 | `xuezai course view` | 同上，加 `courseBundle` 动作 | 5 个端点的降级口径是平台知识（403 只丢那一类） |
| S-3 | `pta homework view` 的读侧 | `source/pta` 的 `READ_ACTIONS` 加 `exam`（走 `api.getExam`） | 这是 GET，**不**启动计时；`homework start` 才是写操作 |

三处都只补**基础函数**，视图拼装与名字解析留在工具层。

### 8.3 明确没做的（不是遗漏）

| 项 | 条数 | 为什么不做 |
| --- | --- | --- |
| `pta homework start` / `homework finish` | 2 | **写操作**且是产品决定：「替用户开计时」= 替他做决定。`pta/README.md:107-110` 记过原因，清单 A-5 也把它归为「要补的话属于产品决定，不是缺口」 |
| `sztz activity favorite` | 1 | 上游是**写**（收藏 / 取消收藏），而 `source/sztz` 只实现了收藏的**读**。按「source 做完整基础函数」这条分工，它不是缺工具，是基础函数没写完 → 归 B 类 |
| `tyys` 的签到（`rollcall` 写） | — | 同 `favorite`：`source/tyys` 只有考勤历史（读），没有签到方法 |
| `zhiyun live start` / `live stop` | 2 | 起停后台采集进程（改状态、占资源），且直播链路未真机验证（B-3）。本包只读 `liveStatus` / `liveText` |
| `zhiyun download` / `xuezai * download` / `chaoxing * download` | 4+ | D21 已澄清「source 可以落盘」，所以**不再是裁决问题**，是工作量问题：要处理保存目录、重名、断点续传。本轮不动 |
| `doc` 的 4 条 | 4 | B-2：`pdf-lib` 全仓 0 命中、`mergePages:true` 丢了页边界。归属未裁决（Q-1） |
| `chaoxing` 的 7 条 | 7 | B-4：全部只到半成品（缺「资料」栏等） |
| `zhiyun setup` / `trans audio` / `check` | 3 | B-3：FFmpeg / ASR 模型安装与内核注入都没有装配方 |
| `webvpn` 的 4 条 | 4 | 见 8.1：属于设置页诊断，不是 agent 工具 |
| `cnki` 的 2 条 | 2 | C 类：用户明确不做知网数据源 |

### 8.4 读工具的共享底座

新增 `packages/tool/kit`（`@lybx-leyw/dsh-zju-tool-kit`）：参数判据 +
`createReadToolRegistrar`。`tool/write-kit` 从它**转出** `inputError` / `str` /
`optStr` / `serviceLookup`，不复制一份。

分开两个底座的理由写在包 README：写工具必须审批、读工具**必须不** —— 共用一条
注册链的后果是某天有人把审批也套在读工具上，而**测试里看不出来**。

### 8.5 验收口径的对账（对照本文 §七）

| 口径 | 本轮结果 |
| --- | --- |
| source 方法已存在且返回完整 | 12 个工具全部只调 source 已有方法；3 处缺的补在 source（8.2） |
| 工具参数里不出现用户拿不到的东西 | 所有「编号」类参数都另有 action 能取到；`selectionSections` 的 `pool` / `category` 在描述里写明「来自 selectionCourses」 |
| 读操作不过审批 | `tests/tool/reads/read-tools.test.mjs` 有一条断言：走宿主注册出来的 `execute`，`ctx.approval.request` 一次都不许被调 |
| 依赖跨域字段要登记 | `gpaSummary` 依赖学籍（专业 GPA 走另一个接口）—— 已在 `source/zdbk` 的 `gpaSummary` 注释里说明；本轮没新增跨域依赖 |

### 8.6 还没解决的

- **preset（D11）仍未定**：12 个读工具与 7 个写工具一样**没有挂载点**。
  按约定它们不进 profile bundles，所以现在**一个都到不了 agent**（与重构前
  的写工具同一处境）。这是本仓已知的、独立于本轮的空洞，不能靠加工具解决。
- `tests/tool/classroom` 的 3 条用例需要 `.runtime/dsh-<版本>` 宿主，
  本机没有那份临时安装 —— 它们在改动前就是红的（`ERR_MODULE_NOT_FOUND`）。
- `tests/repo/profile.test.mjs` 的 6 条同理（需要已安装的 DSH 宿主）。
