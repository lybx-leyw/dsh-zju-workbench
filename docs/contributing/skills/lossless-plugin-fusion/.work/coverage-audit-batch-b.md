# 上游覆盖度审计 · 批次 B（lab / pta / sztz / xxt / classroom / 四个小包）

审计时间：2026-11-10
审计范围：71 条 provides（lab 9 / pta 14 / sztz 8 / xxt 10 / classroom 16 / chalaoshi 3 / cnki 5 / ebook 1 / notice 4 / yjsy 1）

基线：`.tmp/upstream-baseline.json`；上游源码 `packages/vendor/zju-assistant/core/zju/lib/<模块>/`（**已排除 `cli.ts`** 作为能力来源，只在需要确认「上游到底给了什么视图」时引用）。

判定口径：A 已实现 / B 已实现但有差异 / C 明确未做 / D 计划归他处，四类，无第三态。

---

## 汇总

| 包 | 上游 | A | B | C | D | 覆盖率 |
| --- | --- | --- | --- | --- | --- | --- |
| `lab` | 9 | 4 | 4 | 1 | 0 | 88.9% |
| `pta` | 14 | 1 | 8 | 3 | 2 | 78.6% |
| `sztz` | 8 | 5 | 2 | 0 | 1 | 100% |
| `xxt`（chaoxing） | 10 | 2 | 7 | 1 | 0 | 90.0% |
| `classroom`（zhiyun） | 16 | 8 | 6 | 2 | 0 | 87.5% |
| `chalaoshi` | 3 | 1 | 1 | 1 | 0 | 66.7% |
| `cnki` | 5 | 4 | 0 | 1 | 0 | 80.0% |
| `ebook` | 1 | 1 | 0 | 0 | 0 | 100% |
| `notice` | 4 | 3 | 1 | 0 | 0 | 100% |
| `yjsy` | 1 | 1 | 0 | 0 | 0 | 100% |
| **合计** | **71** | **30** | **29** | **9** | **3** | **87.3%** |

覆盖率 = (A + B + D) / 总数。**C 类 9 条与 D 类 3 条已在「逐条对账」与「遗漏清单」双列。****覆盖率不代表可用性**：`classroom` 的 87.5% 里，`trans audio` 是有代码但缺内核注入（实机必然失败，见漏-4），`download` 是只有单文件下载、缺上游的批量/HLS/抽音频整条编排（见 classroom 逐条表 #5）。

---

## 遗漏清单（**最重要的部分**）

按用户影响排序。**C 类与 D 类全列**（漏-1～漏-10）；另加两类 B：「实际不可用」（漏-3、漏-5）与「明确建议不补」（漏-11，列出是为了让「不补」这个决定有据可查）。

### 漏-1 · `pta` · `problem save` / `problem submit` —— **代码写了，但必然失败（P0）**

- **上游做什么**：`saveAnswer` / `submitAnswer` 先 `getExam()` 拿答题实例，再按题型分批提交（`write.ts:146-202`）。
- **本仓状态**：**死链路**。`writes.js:162` 用 `detail?.exam ?? detail?.examInfo` 从 `problemSet()` 的返回值取答题实例；而 `pta.js:394-400` 的 `problemSet()` **只返回 `{id, name, description, problemTypes, progress}`，没有 `exam`、也没有 `serverTime`**。全仓唯一的 `/exams` 相关请求是 `writes.js:265`（`/api/exams/${exam.id}/exam-submissions`，在 `exam` 已被判定非空之后才用），**没有任何一处请求 `GET /api/problem-sets/{id}/exams`**（上游 `query.ts:13-17` 的 `getExam`）。
- **影响**：`examOf()`（`writes.js:161-172`）**无条件抛** `INVALID_ARGUMENT`「题集 X 还没有开始作答」。也就是说 **`campus_homework` 的 pta `save` / `submit` 两个 action 100% 不可用，与用户是否真的在网页上开始过作业无关**。这是本批次里唯一一条「工具注册了、参数校验过了、请求永远发不出去」的能力。
- **连带缺陷（同一处）**：`writes.js:190` `Date.parse(row.deadline ?? '')` —— 但 `problem()`（`pta.js:515`）返回的 `deadline` 是 `{iso, text}` **对象**，`Date.parse(对象)` 恒为 `NaN` → `deadline > 0` 恒假 → **截止时间校验从未生效**，过期作业照样能提交。
- **补的成本**：**小～中**（加一个 `getExam` 读方法 + 把 `exam`/`serverTime` 串进返回值；deadline 改为读 `.iso`）。
- **建议**：**立即补**。这比「补 homework start 功能」更优先 —— 因为先修这个，`submit` 才可能在任何情况下工作。

### 漏-2 · `pta` · `homework start` / `homework finish`（开始答题 / 交卷）

- **上游做什么**：`startHomework`（`write.ts:134-144`）`POST /api/problem-sets/{id}/exams` 建答题实例并起计时；`finishHomework`（`write.ts:203-216`）`PUT /api/exams/{id}/end` 提前结束，且先校验 `allowSubmitExam`、还有未答题要求 `--allow-incomplete`。
- **本仓状态**：**完全没有**。`packages/tool/campus-write/src/tools.js:198-249` 的 `campus_homework` 只收 `save` / `submit` / `retract`，没有 start/finish。`pta/src/writes.js:27-32` 已把它从「不做」改写成「尚未实现」并指向 `coverage-gaps.md`（这处措辞已修正，见 W-1）。
- **影响**：即便修好漏-1，用户仍然**必须在网页上点过「开始」**才能用 `submit`；本仓没有入口替他开，也没有入口交卷。
- **补的成本**：中（两条写能力 + 两个 tool action + exam 归属校验）。
- **建议**：**补**，排在漏-1 之后。

### 漏-3 · `pta` · `submission list` / `submission view` / `reconcile`

- **上游做什么**：`listSubmissions`（`query.ts:85-89`）按 `userId` 过滤的分页提交历史；`getSubmission`（`query.ts:90-95`）单次提交的作答、编译信息、各测试点结果；`reconcile`（`write.ts:85-95` + `reconcileLocked:73-84`）回查上一次未确认的写操作，**只读**，确认成功才清本地未决记录。
- **本仓状态**：三条**全无**。`pta/src/pta.js` 的 `READ_ACTIONS` 只有 `problemSet / problems / problem / progress`（`index.js:68`），没有 submission 相关动作。`pta/README.md:139-141` 把三条一起归到「只覆盖看题这一层」。
- **影响**：① 用户看不到「我上次交了没、判了没、错在哪」；② 写操作**没有回查闭环** —— 提交超时后本仓只能报错，无法判断到底存没存进去（上游靠 `pending/*.json` + 指纹比对解决）。第二条在弱网下会直接导致重复提交。
- **补的成本**：中（list/view 是纯读，两个端点；reconcile 需要未决记录机制，本仓没有 journal）。
- **建议**：**submission list/view 必补**；`reconcile` 建议补，但需要先决定未决记录落在哪（见漏-9 的同类问题）。

### 漏-4 · `classroom` · `trans audio` 的识别内核**没有任何装配方**

- **上游做什么**：`asr.ts` 自带 `sherpa-onnx-node` + SenseVoiceSmall int8，`prepareAsr` 缺模型现下（约 240 MB），`transcribeAudio` 直接出 `segments.json` / `transcript.txt` / `raw.json` / `metadata.json`。
- **本仓状态**：**编排在，内核不在，且没人注入**。`source.js:615` `transcribeAudio` → `asr.js:211` `transcribeFile` → `assertTranscriber`（`asr.js:94`）对 `null` 抛 `DEPENDENCY_MISSING`。全仓 `grep setTranscriber` 只命中 `source.js:587`（定义）、`asr.js:102`（注释）与 README，**没有任何 profile / preset / 集成层调用它**。
- **影响**：这条能力在实机上**必然失败**，且失败文案是「缺少转写内核」—— 用户会以为是装错了，而实际是没人接线。这是「名字对得上、代码在、功能不在」的典型。
- **补的成本**：小（接线）/ 大（真要内置内核）。
- **建议**：**先接线**：至少让 `packages/core/*` 或 preset 注入一个转写器；内核要不要内置是另一个决定（涉及 `npm install`，与仓储规则冲突）。

### 漏-5 · `classroom` · `zhiyun search subtitles`（录播字幕关键词检索）

- **上游做什么**：`materials.ts:46-71` `searchCaptions` —— 遍历所选课次拿字幕，按关键词命中并**带上前后各一句**做上下文，返回 `lessonsSearched` / `lessonsWithoutCaptions` / `counts` / `total` / `hits`。上游 CLI 的描述就是「老师有没有说点名、考试范围」。
- **本仓状态**：**完全没有**。`packages/source/classroom/src/` 下 `grep searchCaptions|keywords` 零命中；`source.check` / `searchResources` 只给字幕**句数**，不给检索。core 侧也没有替代实现（`packages/core/playback` 只做字幕轨清洗）。
- **影响**：这是智云课堂最常用的一个功能（考前找「点名」「考试范围」「不考」）。现在用户只能整节读逐字稿，90 分钟 3–5 万字。
- **补的成本**：小（纯读，逻辑 60 行，`getSubtitles` 已就绪）。
- **建议**：**补**，且优先于 download 的任何增强。

### 漏-6 · `xxt` · `material list` 缺「资料」栏；`material/video download` 只有参数没有执行方

- **上游做什么**：`courses.ts:166-201` `inventory` = 章节卡片附件 **+ 资料栏**（`dataRows`，逐层文件夹、`dataId`、`downloadable`、按页面约数换算大小）；`download.ts:92-113` `saveFiles` 真的落盘（3 并发、4 MB 分块、断点复用、同名加编号）。
- **本仓状态**：
  - 清单：`reads.js:235` `materials` **只读章节卡片**，没有 `dataRows` 那一路 → 资料栏文件整类读不到，也没有 `source` / `dataId` / `downloadable` 字段。
  - 下载：`reads.js:304` `downloadParams` **只返回** `{url, variant, filename, size, headers, note}`，按 D21 是正确的分工；但**全仓没有任何 core 包消费它**（`grep downloadParams` 只命中 `xxt/src/reads.js` 与它自己的注释）→ 用户拿不到文件，也没有「把参数交给谁」的说明。
- **影响**：学习通的课件下载在学习场景里是刚需（老师课件只在资料栏）。目前**两类都不可用**：资料栏根本列不出来，章节附件也下不下来。
- **补的成本**：中（资料栏是一条独立的逐层翻页 + `enc` 链路）/ 小（下载执行方接一个通用下载器）。
- **建议**：**都补**。资料栏优先 —— 没有清单，下载参数也无从产生。

### 漏-7 · `classroom` · `zhiyun setup`（FFmpeg / ASR 模型安装）

- **上游做什么**：`setup.ts:46-53` —— `media` 分支 `npm install ffmpeg-static@5.3.0` 到 `<data>/tools/zhiyun-media`；`asr` 分支从 HuggingFace / hf-mirror 下约 240 MB 模型。
- **本仓状态**：**无**。`diagnostics.js:23` 已如实写「尚未实现」（这处措辞已被修正，见 coverage-gaps W-6），`README.md:195` 说交给宿主安装层。
- **影响**：与漏-3 联动 —— 没有 FFmpeg，`trans audio` 也处理不了 m3u8/视频；没有模型，转写内核即使注入也没有权重。
- **补的成本**：**大**（要在宿主安装层做，且本仓不跑 `npm install`）。
- **建议**：**暂不补**，但必须把「`check` 返回的 `action` 指向哪里」写清楚（现在 `action` 只说「本包不执行下载」，没说去哪执行）。

### 漏-8 · `sztz` · `activity favorite`（收藏 / 取消收藏）

- **上游做什么**：`index.ts:358-373` `setFavorite` —— 开关接口 `student/home/hdsc`，先读本人收藏列表，状态已符合就不提交（因为重发会把状态翻回去）。
- **本仓状态**：D17 归 `packages/tool/campus-write`，但该包 `campus_activity` 只有 `signup` / `cancel` / `book`（`tools.js:150-191`），**没有 favorite**。
- **影响**：二课收藏做不了。用户侧影响中等（收藏是弱需求），但它是 D17 判定下「应该存在却不存在」的洞。
- **补的成本**：小（与报名同形态，source 已有 `myActivities` 可回查）。
- **建议**：**补**，与漏-1 一起做省一次 tool 版本变更。

### 漏-9 · `lab` / `xxt` · `session logout`（本地会话清不掉）

- **上游做什么**：`labSession(account).clear()`（`lab/cli.ts:135`）、`sessionStore().clear()`（`chaoxing/cli.ts:250`）。
- **本仓状态**：`lab` 服务面只有 `status()` / `reset()` / `setSession()`（`index.js:152-163`），`reset()` 只丢内存客户端，**不碰持久化 token**；`xxt` 服务面 `CLIENT_ACTIONS` 只有 `status / importCookie / checkLogin`（`index.js:70`），**没有清除动作**。
- **影响**：换账号、或「这个 Cookie 脏了想重来」时，用户只能去删 profile 里的文件。这与两个包都承诺的「重新导入一次即可」自相矛盾 —— 没有清除就没有重新导入。
- **补的成本**：小（两处各一个方法，`session.clear({persist:true})` 已存在）。
- **建议**：**补**。

### 漏-10 · `cnki` · `cnki download`（全文 PDF / CAJ 下载）

- **上游做什么**：`index.ts:325-419` —— 详情页取全文链接（有 PDF 用 PDF、只有 CAJ 用 CAJ）、`%PDF-` 文件头校验、10 分钟超时、CAJ 时附「要用 CAJViewer 打开」说明。
- **本仓状态**：**一行都没有**。`cnki/src/cnki.js` 530 行只有检索与登录；`src/index.js` 的 `methods` 是 `['cnki.search', 'cnki.login', 'cnki.logout']`。
- **影响**：知网只能搜到题录，拿不到文献 —— 对一个「知网数据源」来说这是半边。
- **补的成本**：中（详情页解析 + 跳转 + 落盘；落盘按 D21 应归 core）。
- **建议**：**补**，但先修虚假声明（见理由不实第 1 条）。

### 漏-11 · `chalaoshi` · `course`（课程绩点表）

- **上游做什么**：`index.ts` 的 `courseGpa` + `cli.ts:54-69` —— 教一门课的所有老师的平均绩点、标准差、样本人数，并附各人在查老师上的评分。
- **本仓状态**：**无**。`chalaoshi/src/chalaoshi.js` 只有 `searchIndex` / `IndexCache` / `fetchIndex` / `fetchTeacherPage`，**没有 `parseTeacherPage` / `parseComments` / `parseGpaTable` 的对应实现**。`README.md:79` 承认「本包没搬」。
- **影响**：查老师只剩「查老师」，查不了「这门课哪个老师给分好」——而后者是学生真正用来选课的。
- **补的成本**：中（三个 HTML 解析器 + 一个 API 调用；上游有现成口径）。
- **建议**：**补**。顺带把 `teacher` 也解析成结构（见 B-2）。

### 漏-12 · `pta` · 自动登录（`session login` 只能粘 Cookie）

- **上游做什么**：`client.ts` 的 `resolveLogin` —— 邮箱 + 密码登录，遇 `GATEWAY_WRONG_CAPTCHA` 时打开官方验证码组件取票据续登一次，`requireMfa` 时明确要求导入 Cookie。
- **本仓状态**：只能粘 Cookie（`index.js:255` `saveCookie`），`README.md:79-82` 给了理由（短信验证码无法自动化）。
- **影响**：中。用户每 1–2 周要手粘一次；且上游那种「验证码组件取票」的路子本仓完全没有尝试。
- **补的成本**：大（要维护验证码/票据链路）。
- **建议**：**不补**，但这属于 B 而非 C —— 能力有，输入少一种。理由成立（上游自己的注释也只是「打开官方组件」，不是纯自动化）。

---

## 逐条对账

### `lab`（9 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `lab timetable` | **A** | `packages/source/lab/src/lab.js:448` `myTimetable()` | 字段（date/start/course/experiment/room/teacher/sequence）与上游 `LabSession` 一致；缺 `dates` 时同样回查 `/api/courseLabTimes/date`，查不到给 `date: null` 不猜 |
| 2 | `lab courses` | **A** | `lab.js:372` `myCourses(term)` | 上游 CLI 额外拼了 `selectionOpens/Closes`，那是 CLI 视图（`lab/cli.ts:22-28`），不属 provides |
| 3 | `lab labs` | **B** | `lab.js:381` `labs(courseId)` | **差异**：上游 `lab labs` 的视图含 `availableWeeks` / `unavailableReason` / `selectionOpen` / `window`（`cli.ts:39-75`，排除了已选、周次冲突、满员）；本仓只给班次原始字段 + `weeks`，余量要另调 `weekStatus()`（`lab.js:394`）自己算。**为什么这样改**：本仓把「班次事实」与「窗口/余量事实」拆成两个读方法，便于缓存与并行；注释理由在 `lab.js:381-386`（只解释 openWeek 解析），**没有说明为何不提供可用性视图** |
| 4 | `lab selected` | **B** | `lab.js:406` `mySelections(term)` | **差异**：上游 `selected` 给每项带课程名、教师、实验室、`dates`、`selectedAt`（`cli.ts:31-36` 的 `selectionRow`）；本仓给平台原始记录，课程名/日期要调用方自己再查 |
| 5 | `lab select` | **B** | `packages/source/lab/src/writes.js:102` `selectLab` + `packages/tool/campus-write/src/tools.js:367-399` | **差异**：① 上游选之前查容量，**满员不提交**（`index.ts:411-413`）；本仓 `writes.js:102-140` 只校验班次存在、周次在 `weeks` 内、是否已选过，**没有容量检查** → 满员也会发出写请求，交给平台拒。② 上游写后 `mySelections` 回查并要求 `verified`（`index.ts:416-421`）；本仓无回查。**为什么这样改**：注释只解释了「三者都要真的查一遍」（`writes.js:16-18`）与周次校验的理由（`:118-119`），容量与回查**无理由** |
| 6 | `lab notices` | **A** | `lab.js:429` `notices()` | HTML→纯文本、`publishedAt` 转 ISO，与上游一致 |
| 7 | `lab session login` | **B** | `index.js:80-94` `client({fresh})` | **差异**：上游 `login()` 是显式命令，返回 `{username, name, expiresAt}`（`lab/cli.ts:127-133`）；本仓**没有独立 login 方法**，登录在首次读取时隐式发生，服务面只暴露 `status()` / `reset()`。**为什么**：凭据由集成层注入（`index.js:15-17`），把登录做成隐式可避免 UI 上出现第二个登录入口 |
| 8 | `lab session status` | **A** | `index.js:155-160` `status()` | 纯本地、不联网；返回 `{loggedIn, username, name, role, expiresAt}`，比上游多 `loggedIn` |
| 9 | `lab session logout` | **C** | **无** | **理由：无理由**。`reset()`（`index.js:163`）只清内存客户端，不碰持久化 token；README「写操作去哪了」只提 select/cancel，未提 logout |

### `pta`（14 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `pta homework list` | **B** | `packages/source/pta/src/pta.js:313` `problemSets()` | **差异**：上游 `listHomework`（`query.ts:57-73`）逐份作业再查两次拿 `progress.state`（未开始/未作答/部分/已答完）并支持 `state` 过滤；本仓**刻意不做 N+1**（`pta.js:34-38` 注释），只给题集元信息 + `ended`，**没有作答状态**，且**没有翻页**（`README.md:144-145` 承认超 100 条会静默少列）。**为什么**：`pta.js:34-38`「那个端点只为了拿 score/status…是 omni 链路最慢的一段」 |
| 2 | `pta homework view` | **B** | `pta.js:371` `problemSet(id)` | **差异**：上游 `homeworkView`（`view.ts:78-87`）给**逐题题号/题型/分值/状态**（`problems[]`）；本仓给的是**题型分布**（`problemTypes[]`）+ `progress` 计数，**没有逐题列表**。逐题要再调 `problems()` 分页 |
| 3 | `pta homework start` | **D** | 归 `packages/tool/campus-write`（D17），**尚未实现** | 归属依据：`zju-assistant-source-tool-split.md:88`（T-1 表：pta `homework start`）+ 该文件 `:80-92` 的 T-1 全集。缺口见漏-2、W-1 |
| 4 | `pta homework finish` | **D** | 归 `packages/tool/campus-write`（D17），**尚未实现** | 同上，缺口见漏-2、W-2。源码里**连注释都没有**（`writes.js` 只提 start） |
| 5 | `pta problem view` | **B** | `pta.js:482` `problem(setId, id)` | **差异**：上游 `problemView`（`view.ts:143-162`）给 `choices[]`（A./B. 带前缀）、`blanks`、`examples`（去重后）、`limits`、`lastSubmission`、`draft`；本仓给 `content`（可分段）、`timeLimitMs`/`memoryLimitKb`/`codeSizeLimitKb`/`compiler`，**没有 choices / blanks / examples / lastSubmission / draft**。选择题用户看不到选项，只能读题面 Markdown |
| 6 | `pta problem save` | **B（实际不可用，P0）** | `packages/source/pta/src/writes.js:174` `saveAnswer` + `campus-write/src/tools.js:236-240` | **差异**：① 上游「save」对聚类题型是**正式保存答题记录**、对代码题才是草稿（`write.ts:145` 注释 + `answers.ts:37-79` 的 `buildDetail`）；本仓 `saveAnswer` 一律走 `/exam-draft`（`writes.js:200`），**聚类题型也被存成草稿** → 判断题/选择题「保存」后平台上不算已答。② 上游按题型校验答案形状（选项必须是原始顺序 A/B/C…、填空数必须等于空位数、编程题 compiler 必须在该题集允许列表里，`answers.ts:31-79`）；本仓 `buildDetail`（`writes.js:318-332`）**不校验任何一项**，不认识就原样塞。③ 上游写前有 `ensureWritable`（`write.ts:48-57`：exam 存在、`status==="PROCESSING"`、`permission & 4`、互评/监考拒绝）；本仓 `examOf`（`writes.js:161-172`）只判 exam 存在与 ended，**且它取 exam 的来源本身是坏的**：`problemSet()`（`pta.js:394-400`）从不返回 `exam`/`serverTime` → `examOf` 无条件抛错，**这条写能力 100% 跑不通**。另 `writes.js:190` 把 `deadline` 当字符串 `Date.parse`，而 `problem()` 给的是 `{iso,text}` 对象 → 截止校验从未生效。见漏-1 |
| 7 | `pta problem submit` | **B（实际不可用，P0）** | `writes.js:208` `submitAnswer` + `tools.js:241-244` | **差异**：① **聚类题型合并上次答案**——一致（`writes.js:253-262`，与 `write.ts:183-187` 同口径）。② **按题型分批**——一致（`writes.js:92-111` ↔ `write.ts:160-165`）。③ **没有幂等去重**：上游发现「合并后与上次完全相同」就跳过提交（`write.ts:188-190`），本仓照发。④ **没有未决记录/回查**（上游 `execute()` 每次写后 `verifyEventually`，不确定就保留 pending、只回查不重发）。⑤ **没有 SUBJECTIVE 的 file 保留**（`write.ts:178-182`），主观题附件会被清掉。⑥ **不支持 MULTIPLE_FILE / SQL_PROGRAMMING / CHOICE_BLANK 的 detail 形状**（上游 `answers.ts:62-76`）。⑦ 上游提交后 `settle()` 等判题结果（`cli.ts:58-67`），本仓不等。⑧ **死链**：同 #6，`examOf()` 无条件抛错 → `submitAnswer` 也跑不通。见漏-1 |
| 8 | `pta submission list` | **C** | **无** | **理由**：`README.md:139-141`「只覆盖『看题』这一层：提交记录（`listSubmissions`/`getSubmission`/`lastSubmission`）…都不在本包 —— 前者属于写链路」。这条理由**不成立**：`submission list/view` 是纯 GET 读（`query.ts:85-95`），不是写链路。见理由不实第 3 条 |
| 9 | `pta submission view` | **C** | **无** | 同上 |
| 10 | `pta reconcile` | **C** | **无** | 同上。追加一点：上游的 `reconcile` 本身**也是只读**（`write.ts:85-95` 注释明确「只读，确认成功才清除本地未决记录」），把它归进「写链路」更站不住 |
| 11 | `pta session login` | **B** | `index.js:255` `saveCookie` | **差异**：上游是邮箱+密码登录（可打开官方验证码组件，`client.ts` `resolveLogin`）；本仓只能粘 Cookie。**为什么**：`index.js:27-31` 注释给了理由（短信验证 → 自动化登录注定维护验证码识别器）。理由成立，归 B 不归 C |
| 12 | `pta session status` | **B** | `index.js:231` `ptaStatus()` | **差异**：上游 `status` 给 `{file, username, expiresAt, cached}`（不联网）；本仓给 `{configured, names}`（**只报键名**，刻意不回值）。本仓多一个 `error` 字段。另：本仓**不报过期时间**，因为 Cookie 过期是平台侧判定的 |
| 13 | `pta session logout` | **A** | `index.js:466` `clearCookie()` | 名字不同（`logout` → `clearCookie`），行为一致：`saveCookie('')` → `session.clear({persist:true})` |
| 14 | `pta session import-cookie` | **B** | `index.js:255` `saveCookie(raw)` | **差异**：① 上游 `importCookie` 会**验证**（`new Pta()` → `current()` 校验账号匹配），失败即报错且不落盘；本仓 `saveCookie` **不验证**，粘错也回「已保存」。② 上游**要求 `PTASession` 必须存在**（缺则 `BadResponse`）；本仓没有这条，任意 `k=v` 都种。③ 本仓支持四种粘贴形态（cURL / 请求头 / DevTools 表格 / 裸串），上游只收单行 Cookie 头 → 这是本仓**更强**的地方 |

### `sztz`（8 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `sztz credits` | **A** | `packages/source/sztz/src/sztz.js:500` `myCredits()` | `summary`+`records` 逐字段对齐（`index.ts:228-247`），含 `hiddenOnTranscript`、`aestheticPassed`/`laborPassed` |
| 2 | `sztz activity list` | **A** | `sztz.js:378` `listActivities()` | 排序、`byStatus`、`hasMore`、`includeEnded`、匿名 `****` 后重取一次（`:393-396`）全部一致 |
| 3 | `sztz activity new` | **B** | `sztz.js:468` `newActivities({seen})` | **差异**：上游自己读写 `<data>/sztz/seen.json`（`index.ts:190,215`）；本仓把 `seen` 交给调用方持久化（`index.js:162-167` `setSeenStore`），返回对象**多一个 `seen` 字段**。**为什么**：`sztz.js` 注释与 README「newActivities 是纯本地比较」——数据源不写盘是分层要求（`index.js:158`「这是它唯一的副作用，且只写本地」）。差异合理 |
| 4 | `sztz activity mine` | **A** | `sztz.js:534` `myActivities()` | `signedUp`/`favorites`/`recognized` + `counts` 一致 |
| 5 | `sztz activity signup` | **B** | `packages/source/sztz/src/writes.js:106` `signupActivity` + `campus-write/src/tools.js:164-175` | **差异**：① 上游校验**报名状态**：`报名中` 才提交，`未开始报名`/`已截止` 都报明确原因（`index.ts:332-333`）；本仓只判「不在平台报名」（`:110-115`）与「已报过」（`:118-124`），**未开始/已截止仍会发请求**。② 上游写后 `commit()` 回查本人列表并给 `verified:true`（`index.ts:299-319`）；本仓无回查、无 journal。③ 上游 `already-signed-up` 返回**不发请求**（`:327`）；本仓在 `already` 分支**仍然构造了一个会发 POST 的 `run`**（`writes.js:119-124`）—— 只有说明文字不同，Execute 照样写 |
| 6 | `sztz activity favorite` | **D** | 归 `packages/tool/campus-write`（D17），**尚未实现** | 归属依据：`zju-assistant-source-tool-split.md:85`（T-1 表：sztz `activity signup` / `activity favorite`）。缺口见漏-8、W-3 |
| 7 | `sztz projects` | **A** | `sztz.js:434` `listProjects()` | 字段与 `index.ts:173-183` 一致（`points` 范围、`grades`、`applicants`、`intro`、`notes`） |
| 8 | `sztz notices` | **A** | `sztz.js:560` `listBulletins()` | 含附件 `{text, url}`，与 `index.ts:378-384` 一致 |

### `xxt` / chaoxing（10 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `chaoxing course list` | **A** | `packages/source/xxt/src/reads.js:158` `listCourses()` | 5 分钟缓存 + `fid` 两种写法 + 兜底 427 都是本仓加强项；字段 `course_id/class_id/name/teacher` 与上游 `courseRow` 对齐。**唯一缺口**：上游 `courseRow`（`courses.ts:63`）多一个 `link`（课程页地址），本仓没有 —— 判 A 而非 B 的理由见「审计方法与局限」第 2 条（那是 CLI 视图的便利字段，不是数据） |
| 2 | `chaoxing chapter list` | **B** | `reads.js:205` `chapters()` | **差异**：上游 `chapter list` 的输出是 `inventory` 按节聚合 —— 每节下挂 `materials[]` / `videos[]`（`courses.ts:166-201` + `cli.ts:221-235`），一次给出「整门课有什么」；本仓 `chapters()` 只给目录（`{id,title,path[],locked}`），文件要再调一次 `materials()`。**为什么**：`reads.js:218-234` 只解释了「为什么是一串请求」，**没解释为何拆成两步**。对 30 门课的场景，两步意味着调用方自己得记住先把 chapters 喂给 materials（本仓 `materials()` 内部确实自己又调了一次 `chapters()`，`:237`，等于目录被读两遍） |
| 3 | `chaoxing material list` | **B** | `reads.js:235` `materials()` | **差异（重）**：上游 `inventory`（`courses.ts:166-201`）在 `data: true` 时**并读资料栏**（`dataRows`，逐层文件夹最多 8 层、`dataId`、`downloadable`、按页面「310KB」换算大小）；本仓**只读章节卡片**，资料栏整类缺失，也没有 `source`/`dataId`/`downloadable`。另：上游有半小时清单缓存（`CACHE_MS`，`courses.ts:144`），本仓无（coverage-gaps D-5 已记录）。**为什么**：`reads.js:218-234` 只解释了「为什么是一串请求」，**资料栏缺失无理由**。缺口见漏-6 |
| 4 | `chaoxing material download` | **B** | `reads.js:304` `downloadParams({objectId})` | **差异**：上游 `saveFiles` 真落盘（3 文件并发、4 MB 分块、断点复用、同名加编号、`playback` 变体另起文件名）；本仓按 D21 **只给参数**，不落盘。分工正确，但**无执行方**（见漏-6） |
| 5 | `chaoxing video list` | **B** | `reads.js:235` `materials()`（按 `kind === 'video'` 过滤） | **差异**：① 没有独立的 `videos()`，要靠调用方过滤 `kind`（`kindOf` 在 `reads.js:45`，只分 `video/document`，**没有 `audio`**，上游分三类）。② 上游 video list 含资料栏视频，本仓同样缺资料栏。③ 上游 `video` 组还带 `size`（`fileSize` 格式化）与 `downloadable` 标记，本仓只有裸 `size` |
| 6 | `chaoxing video download` | **B** | `reads.js:304` `downloadParams({objectId, playback:true})` | 同 #4。`playback` 的三种变体（original/playback/preview）与「要的没有就退另一种并给 note」与上游 `objectSource`（`download.ts:33-45`）**逐条一致**，是本包质量最高的一段 |
| 7 | `chaoxing homework list` | **B** | `reads.js:419` `listHomework()` / `:458` `deadlines()` | **差异（重）**：上游 `listHomework`（`homework.ts:135-148`）有**三个来源**：课程作业页 + **学习任务**（`task.chaoxing.com` 的 `getUserStandard`，逐任务点读作业，带 4 小时缓存）+ **手机端全局列表**（`/work/stu-work`）；本仓只有**课程作业页**（`reads.js:380-408`）→ 只发在学习任务里的作业、以及跨课程的手机端作业**全部读不到**。另：上游输出有 `task`、`requirement`（老师写的要求）、`opens`、`otherLeft`，本仓没有 |
| 8 | `chaoxing session login` | **B** | `packages/source/xxt/src/client.js:223` `importCookie` | **差异**：上游 `Chaoxing.login()` 是账号密码登录（`client.ts` `resolveLogin`，二次验证时 `NeedsUser`）；本仓只能粘 Cookie。**为什么**：`index.js:30-34` 给了理由（扫码/滑块）。理由成立 |
| 9 | `chaoxing session status` | **A** | `client.js:202` `status()` | 纯本地；`{configured, source, cookie_names, missing_required}` 比上游多两项，是加强 |
| 10 | `chaoxing session logout` | **C** | **无** | **理由：无理由**。`CLIENT_ACTIONS` 只有 `status/importCookie/checkLogin`（`index.js:70`）；README 与源码均未解释为何没有清除。缺口见漏-9 |

### `classroom` / zhiyun（16 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `zhiyun search courses` | **A** | `packages/source/classroom/src/source.js:149` `searchCourses()` | 带 `user_id/user_name` 才搜（按可见性过滤），分页 16 条，返回 `{courses,total,nextPage}` |
| 2 | `zhiyun search lessons` | **A** | `source.js:212` `listLessons(courseId)` | 默认只回可播放（`onlyPlayable`），与上游 `playable` 过滤同口径 |
| 3 | `zhiyun timetable` | **A** | `source.js:467` `getSchedule()`（+ `:369` `getMyLectures()`） | 两套都保留：`getSchedule` 对齐上游 `timetable`（时间段/最多 31 天），`getMyLectures` 是「以我为口径按天倒序」的本仓增强 |
| 4 | `zhiyun search resources` | **A** | `source.js:512` `searchResources()` | `kind` 白名单（拼错直接拒）、`slides`/`subtitles` 按需计数、吞掉「未查询到语音数据」这一种、`audio` 缺独立音轨时给 `available:false` 说明项（`source.js:499-503` 说明理由：宁可报不可用也不给下不下来的地址） |
| 5 | `zhiyun download` | **B** | `source.js:772` `downloadResource()` + `:837` `downloadSlides()` | **差异（重）**：上游 `acquire()`（`acquire.ts:30-130`）是**多资源批量**：`kinds` 多选、`selectQuality` 1080p/360p、HLS 分片合并（`hls.ts`）、从视频抽音频（`media.ts` `extractLocalAudio`，要 FFmpeg）、`download.json` manifest（sha256 + sourceKey）、`download.lock` 防并发、断点与 `publish()` 原子落盘、`dryRun`。本仓只有一个「按 URL 下到绝对路径」的 `downloadResource`（断点用 ETag+Range，原子用 `link`）与一个课件图批量下载 → **没有 kinds 批量、没有 manifest、没有 HLS 合并、没有抽音频、没有 dryRun** |
| 6 | `zhiyun setup` | **C** | **无** | **理由**：`diagnostics.js:20-25`「本任务不跑 `npm install`」+「已补进 coverage-gaps.md 的待补清单」。**这个理由不是产品理由**，是任务约束；`README.md:190` 的小标题仍是「`setup` 明确不做」，与同段 `:195`「交给宿主安装层」自相矛盾。见理由不实第 4 条、漏-7 |
| 7 | `zhiyun check` | **B** | `source.js:570` `check()` → `diagnostics.js:229` `checkComponents()` | **差异**：上游 `checkAsr` 用 `assets.json` 的 sha256 校验模型与 FFmpeg（`asr.ts:113` 的 `signature`）；本仓 `diagnostics.js:165-167,211` 明确「不做哈希校验」，`verified` **恒为 false**。另：上游 `check` 的 `component` 收 `asr/media`（`all` 只在 setup 用）；本仓 `all` 也收（`diagnostics.js:229-235`）。每个组件带 `action` 是本仓加强 |
| 8 | `zhiyun trans audio` | **B** | `source.js:615` `transcribeAudio()` → `asr.js:211` `transcribeFile()` | **差异（重，实际不可用）**：① **识别内核必须注入**（`source.js:587` `setTranscriber`），本仓不含 `sherpa-onnx-node` 与 SenseVoice 模型；上游自带。② 产物不同：上游 `segments.json`/`transcript.txt`/`raw.json`/`metadata.json`；本仓 `segments.json`/`transcript.txt`/`transcript.md`/`transcribe.json`。③ 上游先 `prepareAsr`（缺模型现下）；本仓没有下载这一步。④ 缓存键不同（上游 `audio sha256 + 环境签名`；本仓 `路径 + 字节数 + 引擎名`，`asr.js:225`）。**为什么**：`asr.js` 文件头与 `source.js:584-586` 说明「本包不含运行库与模型」。理由成立，但**没人注入**这件事让能力实际为零 → 见漏-4 |
| 9 | `zhiyun session login` | **A** | `source.js:96` `login(credentials)` | 同账号串行（`loginQueues`）、`reuseSso` 选项、登录后 `listCourses` 验证业务会话、成功才把凭据交宿主（`index.js:93-100` 解释了为什么只「补空缺」） |
| 10 | `zhiyun session status` | **B** | `source.js:122` `getCurrentUser()`（+ `:91` `restoreSession()`） | **差异**：上游 `status` 是纯本地 `{file, username, expiresAt, cached}`（`session(credentials().username).status()`）；本仓 `getCurrentUser()` 只解 `JWTUser` cookie 给 `{id,name}`，**不报文件位置与过期时间**；`restoreSession()` 语义不同（它**会联网**验证，`source.js:91-95`）。本仓另在 `SessionStore` 里有 `epoch`/`accountKey`，但没暴露成状态 |
| 11 | `zhiyun session logout` | **A** | `source.js:121` `logout()` | 立即 `persist:true` 落盘（注释 `:120` 明确「延迟写 + 进程退出 = 旧会话复活」） |
| 12 | `zhiyun search subtitles` | **C** | **无** | **理由：无理由**。`packages/source/classroom/src/` 全目录 `grep searchCaptions|keywords|点名` 零命中；README 的能力表里也没提这条。缺口见漏-5 |
| 13 | `zhiyun live start` | **B** | `source.js:647` `liveStart()` → `live-caption.js:241` `LiveCollector` | **差异**：① 上游 `startLive(course?)` 可**省略课程**，自动跟当天本人剩余课次（`live-task.ts:135` `dayLessons` + `matchLiveCourse`）；本仓**必须显式给 `courseId` + `subId`**（`source.js:649`），没有「按当天课程自动展开」。② 上游是**脱离进程的后台采集器**（Windows WMI 隐藏进程 / POSIX detached，配 `task.lock`/`owner.json`/`stop.json` 租约），本仓是进程内定时器 → **进程退出即停采**。**为什么**：`live-caption.js:27-58` 给了三条理由（不把进程管理塞进只读层、沿用 `prefetchInBackground` 先例、宿主是常驻 GUI）。理由充分，但「必须显式指定课次」这一条**无理由** |
| 14 | `zhiyun live status` | **A** | `source.js:678` `liveStatus()` | 纯本地；`receiving` 显式区分「连上了」与「真收到字」（`source.js:670-672`），并在无任务时给 `not-running`，比上游更明确 |
| 15 | `zhiyun live stop` | **A** | `source.js:703` `liveStop()` | 停定时器 + 主动退订 `u<uid>&cl`（`dispose()` 会 `await` 到退订发完，`source.js:293-294` 说明理由）；已收文字不删 |
| 16 | `zhiyun live text` | **B** | `source.js:742` `liveText()` → `live-caption.js:536` `.text()` | **差异**：上游 `liveText` 会为 `--after` **阻塞到点**（`live-task.ts:178-194`），把未来时段等出来；本仓**不等待**，未来部分用 `pending` 标记，并逐段报 `gaps`。多任务命中时本仓抛 `INVALID_INPUT` + `candidates`（`source.js:763-767`），上游是 `ConfigError` 让先看 status。**为什么**：`source.js:729-733` 与 README `:288-291` 明确「本包是长驻服务，阻塞式等待会把宿主的一个请求挂上几分钟」 |

### 四个小包 + yjsy

#### `chalaoshi`（3 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `chalaoshi search` | **A** | `packages/source/chalaoshi/src/chalaoshi.js:175` `searchIndex()` + `src/index.js:162` `search()` | 打分制、`hot` 按 `maxHot` 归一（注释 `:181-188` 明确纠正了「除以 10」的错法）、`sort`/`limit`/`ratedOnly`/`college` 全支持，多一个 `college` 二次过滤（`index.js:167-171`） |
| 2 | `chalaoshi teacher` | **B** | `chalaoshi.js:370` `fetchTeacherPage({id})` | **差异（重）**：上游 `parseTeacherPage` + `parseComments` + `parseGpaTable` 解析成 `{name, college, rating, ratingCount, rollCallPct, courses[{course,gpa,students}], url, commentCount, comments[{date,likes,text}]}`；本仓**只回 `{id, url, html}` 原始 HTML**，且**只认 `id`**（不支持按姓名唯一定位 + 同名时给候选，那是上游 CLI 的 `findTeacher`）。**为什么**：`README.md:79`「解析留给消费方…本包没搬」 |
| 3 | `chalaoshi course` | **C** | **无** | **理由**：`README.md:79`「上游有 `fetchTeacherPage` 之外的评论/绩点解析，本包没搬」。这是**自判不做**，无裁决支撑（见理由不实第 5 条）。缺口见漏-11 |

#### `cnki`（5 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `cnki search` | **A** | `packages/source/cnki/src/cnki.js:453` `searchPapers()` | 上游三处硬口径全对齐：**POST 表单 + `QueryJson`**（不是 `GET ?kw=JSON`，注释 `:440-447` 专门记了这条）、**JSONP**（`parseJsonp`，字段按上游 `IsSuccess`/`Expire`/`ShowName`，`:347-361`）、**Cookie 承载**（`Transport` + `SessionStore`，`index.js:36-62` 解释了「第一版最大的缺陷」）。`queryJson` 12 个顶层键、`gradetxt-N` 重编号、`allOf` 的 110 上限都在。本仓加强：`matchedBy` 对非 keyword 条件也给实质描述（`:517-524`） |
| 2 | `cnki download` | **C** | **无** | **理由：无理由** —— 而且**宣称有**。`packages/source/cnki/package.json:4` 写「文献检索与全文 PDF 下载」、`src/cnki.js:2` 写「检索与全文下载」、`:17` 写「每篇文献的下载地址**只请求一次**」，但 `src/` 下**没有任何下载代码**。见理由不实第 1 条、漏-9 |
| 3 | `cnki session login` | **A** | `cnki.js:325` `ensure(fresh)` + `index.js:127` `login()` | IP 登录（`IpLoginFlush?callback=cb`）+ 60 秒安全余量（`USABLE_MARGIN_MS`，`:373`）+ `FALLBACK_TTL_MS` 15 分钟。本仓 `login({fresh})` 是显式入口，修掉了 audit-cnki 的 S10 |
| 4 | `cnki session status` | **A** | `index.js:115` `loginStatus()` | 纯本地 `{loggedIn, institution, expiresAt, msLeft}` |
| 5 | `cnki session logout` | **A** | `index.js:131` `logout()` | 清内存 + `transport.session.clear({persist:true})`，并关 transport（`:187`） |

#### `ebook`（1 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `ebook search` | **A** | `packages/source/ebook/src/ebook.js:310` `searchEbooks()` | 两个来源并行、任一成功即返回、`merge` 按 ISBN/书名+著者+出版社合并、`interleave` 轮流取、`matchedBy`、`found`、`hasMore`、`note` 全对齐。本仓加强：**自造 30 秒超时**（`:319-371`，注释说明整条 `sharedFetch→egress→undici` 链上没人读 `timeoutMs`）、`drift` 结构漂移检测（`:451-473`）、`sourceErrors` |

#### `notice`（4 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `notice list` | **A** | `packages/source/notice/src/notice.js:2346` `list()` | 合并去重、补正文、`status: partial/complete`、`sourceErrors`、`drift`、`searchedBackTo`、按 profile 选源（`selectSources(..., {scope:'default'})`）全对齐；68 主机表 + 学院名录已随包（`data/hosts.json` 13334 B、`data/colleges.json` 71692 B） |
| 2 | `notice view` | **A** | `notice.js:2388` `view()` | 三种检索形态（`byUrl` 多链接竖线分隔 / `byTitle` 分词重试）；上游不唯一时给候选，本仓在 `byTitle` 里逐关键词退让（`:2433-2449`） |
| 3 | `notice new` | **B** | `notice.js:2497` `new()` | **差异**：上游自己读写 `seen`（`index.ts` `newNotices`）；本仓 `seen` 由调用方通过 `setSeenStore` 注入（`index.js:156-159`），返回多一个 `seen` 字段。**为什么**：`index.js:9-10`「`new` 会算出新出现的，但它**不写盘**…这样本包在磁盘上没有副作用」。差异合理 |
| 4 | `notice sources` | **A** | `notice.js:2561` `sources()` | 不联网；来源/栏目/学院名录 + 已读状态 |

#### `yjsy`（1 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `yjsy timetable` | **A** | `packages/source/yjsy/src/yjsy.js:225` `timetable()` | `resolveTerm`（`py_xsxk` 的 `dqxn`/`dqxq`）、教学日历、节次时间（第 14 节固定 22:05）、冬/夏学期周次换算（`secondHalfFrom`）、每次课日期、`unscheduled`、双入口（研究生/本科）全对齐。错误翻译（`index.js:61-77`）是本仓加强 —— 把 `Transport` 的「无法连接智云服务」改成正确站点名 |

---

## 本仓多出来的能力

上游 `module.json` 的 provides 条数之外，本仓多做了这些（按包列，只列**能力级**的，不列工具函数）：

| 包 | 多出来的能力 | 落点 |
| --- | --- | --- |
| `lab` | `terms()` / `currentTerm()` / `weekStatus()` / `openStatus()`（含服务器时钟）/ `myInfo()` / `myTimetable()` / `myCourses()` —— 上游 6 条 provides 里没有的读方法，本仓 10 个 | `packages/source/lab/src/lab.js:343,355,394,415,482,448,372` |
| `lab` | 写操作拆成 **Prepare/Execute 两段**（审批由 tool 层做） | `lab/src/writes.js:75-99` |
| `pta` | `todos()` 归一化待办（`core/planning` 依赖）、`translatePtaError`（可直接上屏的中文） | `pta/src/pta.js:594,627` |
| `pta` | `read` **动作白名单**（不做任意属性访问）+ 四种 Cookie 粘贴形态 | `pta/src/index.js:68,300`；`parsePtaCookie` 在 `source/http` |
| `pta` | 题集的**题型分布**一次拿全（`problem-summaries` 聚合，避免逐题型翻页） | `pta/src/pta.js:371-401` |
| `sztz` | `bulletins()` 带附件直链；`newActivities` 的 `seen` 可注入 | `sztz/src/sztz.js:560`；`index.js:129` |
| `xxt` | `deadlines()` 全局截止聚合（`max_courses`/`horizon_days` 控成本、单课无作业不算错误、`complete:false` 如实报不完整） | `xxt/src/reads.js:458` |
| `xxt` | `exams()` / `notices()`（13 字段 POST + 5 页上限 + 游标不前进即停）/ `schedule(week)` / `findCourse()` | `reads.js:523,544,604,181` |
| `xxt` | `checkLogin()` 真探一次登录态（与 `status()` 的「只看配没配」分开） | `xxt/src/client.js:368` |
| `classroom` | `getTranscript()` 逐字稿分页（`offset`/`maxCharacters`/`timestampEverySec`） | `classroom/src/source.js:304` |
| `classroom` | `getMyLectures()`（以我为口径按天倒序 + `upcoming`） | `source.js:369` |
| `classroom` | `getLessonContent()` 并行取 slides+subtitles + 课件缓存装饰 | `source.js:422` |
| `classroom` | **课件图本地缓存**（索引原子写、2 GB LRU、`/zhiyun-slides` 前缀、ETag） | `src/slide-cache.js`、`src/slide-store.js`、`index.js:143-154` |
| `classroom` | **直播流转发端点** `/zhiyun-live`（改写 m3u8、白名单 `*.zju.edu.cn`、日志不含签名） | `src/stream.js`、`index.js:166-172` |
| `classroom` | `prefetchSlides()` / `prefetchInBackground()`（读完再补、按节去重、不跟调用方 signal） | `source.js:831,795` |
| `classroom` | `acquireSso()`（后端级 SSO 票据共享，只给已存的同一账号） | `index.js:108-119` |
| `ebook` | `drift` 结构漂移检测（「计数说有、解析出 0」显式标出，防页面改版冒充「没有这本书」） | `ebook/src/ebook.js:451-473` |
| `notice` | 多关键词、`drift`、`searchedBackTo`、`incomplete` 计数 | `notice/src/notice.js:2346-2378` |
| `yjsy` | `Transport` 错误码→本包口径的翻译（否则文案说「无法连接智云服务」，站点名错） | `yjsy/src/index.js:61-77` |

**另有两条「本仓有、上游 provides 里没有」的分层产物**（不算能力，但要记）：
- `pta` / `lab` / `sztz` / `classroom` 都提供了一条**同源数据路由**（`/api/zhiyun-pta` 等），上游是 CLI 进程，没有这一层。
- `xxt` 的路由用 `{type:'client-request', rpcId, payload}` **信封**（`index.js:223-233`），与其他 source 包的 `{action, input}` 不同 —— 这是历史形状，不是缺陷，但审计时要记住两套。

---

## 理由不实的条目

| # | 位置 | 原文声称 | 实际情况 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | `packages/source/cnki/package.json:4`、`packages/source/cnki/src/cnki.js:2,6-7,17` | 「文献检索与**全文 PDF 下载**」「每篇文献的下载地址只请求一次」 | `src/` 下**零下载代码**；`methods` 只有 `search/login/logout`（`index.js:113`）。README 不存在，所以这条虚假声明没有任何地方纠正 | **理由不实（虚假声明）** |
| 2 | `packages/source/pta/src/writes.js:27-32` | 「开始作业：…替用户开作业会让计时跑」那段旧的「不做」理由 | **这处已修正**：`writes.js:27-32` 现在写「两处**尚未实现**（不是裁决，已记进 `coverage-gaps.md`）」，并明确承认「那个理由只对『自动开』成立，对『用户明确要求开』不成立」。措辞已是正确形态 | ~~理由不实~~ → **已修正，不计入** |
| 3 | `packages/source/pta/README.md:139-141` | 「提交记录（`listSubmissions`/`getSubmission`/`lastSubmission`）、考试详情都不在本包 —— **前者属于写链路**」 | `listSubmissions`/`getSubmission` 是纯 GET 读（`vendor/.../pta/query.ts:85-95`）；`reconcile` 在上游注释里写明「只读」（`write.ts:85`）。把它们归「写链路」从而排除，是把**读能力**错误地划走。**另注**：该 README 同段还把「考试详情（`/exams`）」说成「被刻意去掉的 N+1」—— 但 `/exams` 正是 `examOf()` 唯一需要的端点（漏-1），去掉它就是去掉写能力的前提 | **理由不实** |
| 4 | `packages/source/classroom/src/diagnostics.js:20`、`packages/source/classroom/README.md:190` | 「**本任务不跑 `npm install`**」，小标题「`setup` 明确不做」 | 同一段 `:23-25` 已改成「尚未实现」，`:195` 也写「交给宿主安装层」—— 但小标题与理由仍是「任务约束」口吻，且与「交给宿主」并存。「任务不跑 npm install」是**流程约束**，不是产品理由；`setup` 若真归宿主安装层，应写成「归宿主安装层」而不是「明确不做」 | **措辞残留 + 理由性质错位**（详见 coverage-gaps §五 D-6/W-6，此处复核：`diagnostics.js:23` 的「尚未实现」已改正，`:20` 未改） |
| 5 | `packages/source/chalaoshi/README.md:79-80` | 「教师详情页与课程绩点表**尚未解析成结构** —— 只返回原始 HTML，**解析留给消费方**。上游有…本包没搬」 | 这是**自判不做**（「留给消费方」不是裁决），但它是**如实描述**、没有编造归因。与 #1–#3 的「编理由」不同：它承认没做 | **无授权自判**（不是编造，但缺裁决支撑；且 `course` 整条因此为 C） |
| 6 | `packages/source/xxt/README.md:20`、`packages/source/xxt/src/index.js:148` | 「**9 个**只读方法」 | `XXT_METHODS`（`reads.js:634-647`）实际是 **12 个**：`courses/listCourses/findCourse/chapters/materials/downloadParams/homework/listHomework/deadlines/exams/notices/schedule` | **文档与实现不一致**（不是缺口理由，但同属「注释不可信」） |

**C 类里「理由不实」与「无理由」的分布**（9 条 C）：

| 条 | 包 · 能力 | 理由状态 |
| --- | --- | --- |
| C-1 | `lab session logout` | **无理由** |
| C-2 | `pta submission list` | **理由不实**（#3） |
| C-3 | `pta submission view` | **理由不实**（#3） |
| C-4 | `pta reconcile` | **理由不实**（#3） |
| C-5 | `xxt session logout` | **无理由** |
| C-6 | `classroom setup` | 理由在，但性质是**任务约束**（#4） |
| C-7 | `classroom search subtitles` | **无理由** |
| C-8 | `chalaoshi course` | **无授权自判**（#5） |
| C-9 | `cnki download` | **理由不实 + 虚假声明**（#1） |

→ **严格「理由不实」= 4 条**（C-2 / C-3 / C-4 同源于 #3，按条目数 3 条 + C-9 按 1 条 = 4 条）。**无理由 = 3 条**（C-1、C-5、C-7）。**无授权自判 / 理由性质错位 = 2 条**（C-6、C-8）。合计 9 条，全部归项。

---

## 报告最后必须回答的四问

### 1. 最该补的五条（按用户影响排序）

1. **`pta` 的 `problem save` / `submit` 死链（漏-1）** —— 不是「少一个功能」，是「**工具注册了、审批也过了、请求永远发不出去**」。`examOf()`（`writes.js:161-172`）从 `problemSet()` 取 `exam`，而 `problemSet()`（`pta.js:394-400`）从不返回它，于是无条件抛「题集还没开始作答」——**与用户是否真的开始过作业无关**。附带一条：`writes.js:190` 把 `deadline` 对象当字符串 `Date.parse`，截止校验从未生效。**修它只要几十行（加一个 `getExam` + 把 `exam`/`serverTime` 串出来 + deadline 读 `.iso`），但它是本批唯一「100% 虚假可用」的能力。**
2. **`classroom trans audio` 的接线（漏-4）** —— 代码 100% 写完，识别内核却从来没人注入（全仓无 `setTranscriber` 调用方），实机必然 `DEPENDENCY_MISSING`。**投入产出比最高：几十行接线换回一个完整能力。**
3. **`classroom search subtitles`（漏-5）** —— 「老师有没有说点名/考试范围」是学生考前最常用的动作，上游有现成 60 行口径（`materials.ts:46-71`），本仓零实现。**成本小、感知强。**
4. **`xxt material list` 的资料栏（漏-6）** —— 老师课件大多放资料栏，现在整类读不到；连带下载参数也产生不出来。**这是学习通数据源「能不能用」的分界线。**
5. **`pta homework start/finish`（漏-2）** —— 修好第 1 条之后，这条才是真正的用户阻塞点：`submit` 依赖一个已存在的答题实例，而本仓没有任何入口创建它，也没有入口交卷。**它是 D 类（归 tool），但归了却没人实现。**

> 备选第六：`pta submission list/view`（漏-3）—— 比 start/finish 便宜的纯读，能看到「交没交、判没判、错在哪」。第七：`xxt downloadParams` 的执行方。

### 2. 有没有「名字对得上但行为不同」的？

**有，而且是本批次的主要风险。** 共 **29 条 B**，其中 6 条属「同名同形、语义已偏」的高危项（另有 2 条 B 属「代码在、永远跑不通」的 P0，见下）：

| 高危项 | 名字 | 实际差异 | 为什么危险 |
| --- | --- | --- | --- |
| **`pta problem save`** | 保存答案 | **先看 P0：`examOf()` 无条件抛错（漏-1），这条根本发不出请求。** 修好之后还有第二层差异：上游聚类题型 → **正式答题记录**（算已答）、代码题 → 草稿；本仓**一律存草稿**（`writes.js:200`） | 用户点「保存」后以为答了，平台上仍是「未作答」→ 交卷时被判未答 |
| **`pta problem submit`** | 提交答案 | **同样卡在漏-1 的死链上。** 修好后仍缺**幂等去重**（上游 `write.ts:188-190`）与**未决回查**（`:121-129`），缺 SUBJECTIVE 附件保留（`:178-182`） | 弱网下重复提交；主观题附件被静默清空 |
| **`sztz activity signup`** | 报名 | 上游只允许「报名中」，未开始/已截止都报明确原因（`index.ts:332-333`）；本仓只要「在平台报名」就发请求。且「已报过」分支**仍构造了会 POST 的 run**（`writes.js:119-124`） | 用户看到的说明是「已经报过（再提交平台会拒）」，但 Execute 真的会发出去 |
| **`lab select`** | 选实验 | 上游**选前查容量、满员不发包**（`index.ts:411-413`）；本仓无容量检查 | 满员时把一个必然失败的写请求发到平台，还可能被平台记为一次异常尝试 |
| **`xxt materials` / `video list`** | 课件/视频清单 | 上游 `inventory` 含**资料栏**；本仓只有章节卡片 | 用户以为「这门课没有课件」，其实课件在资料栏 |
| **`xxt homework list`** | 作业列表 | 上游三源（课程作业页 + 学习任务 + 手机端）；本仓只有课程作业页 | 只发在学习任务里的作业**彻底看不到**，而那是超星最常见的作业形态 |

另有一条**结构性**的：`classroom live start` 名字对得上，但上游可省略课程、自动跟随当天课次，本仓必须显式给 `courseId`+`subId` —— 用起来完全是两个东西。

### 3. C 类里理由不实的有几条？

- C 类共 **9 条**。
- **理由不实：4 条** —— `pta submission list` / `pta submission view` / `pta reconcile`（同一处 README 理由，把只读能力归「写链路」）、`cnki download`（宣称有、代码为零的虚假声明）。
- **无理由：3 条** —— `lab session logout`、`xxt session logout`、`classroom search subtitles`。
- **无授权自判 / 理由性质错位：2 条** —— `chalaoshi course`（「解析留给消费方」，无裁决）、`classroom setup`（理由是「本任务不跑 npm install」，是流程约束不是产品理由）。
- 另有 1 条 **D 类**曾属「理由不实」但**已修正**：`pta homework start` 的 `writes.js:27-32` 现在写的是「两处**尚未实现**（不是裁决，已记进 `coverage-gaps.md`）」，并明确承认「那个理由只对『自动开』成立」—— 这条措辞已改成正确形态，不计入不实。

**严格口径下：4 条 C 的理由不实**（`pta` 三条同源算一组 + `cnki` 一条虚假声明；按条目数是 4 条）。若把「无授权自判」也算进来则是 6 条。

### 4. `classroom` 的 live / trans audio 那几条到底实现了没？

**用户特别关注的这两组，结论分别是「实现了」和「实现了但不可用」，不是「没实现」。**

#### `live start / status / stop / text` —— **四条全部实现，实机可用**

| 条 | 判定 | 证据 |
| --- | --- | --- |
| `live start` | **B**（实现，两处语义差异） | `source.js:647-666` `liveStart()`；采集器 `live-caption.js:241-603`（613 行，含 glue 协议 `decodeFrame:116`、握手/订阅/心跳 `pi`/`po`、`"t"` 超时不前进 token、断线 1s→2s→4s 退避上限 30s、课后继续听 5 分钟、开课前 5 分钟取地址、`sub_status` 3/6 判结束）；路由已挂 `index.js:198` |
| `live status` | **A** | `source.js:678-696`，纯本地，`receiving` 区分「连上」与「收到字」，与上游 `liveStatus()` 一致 |
| `live stop` | **A** | `source.js:703-724`，停定时器 + 主动退订 `u<uid>&cl`；`dispose()` 会 `await` 到退订发完（`source.js:293-294`），比「只 abort」正确 |
| `live text` | **B** | `source.js:742-770`，取窗口内已收文字并按段报 `gaps`；**唯一有意差异**：不为 `--after` 阻塞未来（`source.js:729-733` + README `:288-291` 明确说明理由） |

**注意两条真实限制**（不是缺陷，但要告知用户）：① `liveStart` **必须显式给 `courseId`+`subId`**，没有上游「跟随当天本人剩余课次」的便利；② 采集是**进程内定时器**，宿主进程退出即停，没有上游那种脱离进程的守护 + 租约。

#### `trans audio` —— **编排完整，但识别内核没有任何装配方，实机必然失败**

- **实现了的**：`source.js:615-624` `transcribeAudio()` → `asr.js:211-268` `transcribeFile()`。包含：绝对路径校验、文件存在与字节数、**缓存命中**（文件+字节数+引擎名，`asr.js:225`）、30 分钟默认超时（`DEFAULT_TRANSCRIBE_TIMEOUT_MS`）、`AbortSignal.any` 合并取消、**原子落盘**（阶段目录 → 逐文件 `rename`，`transcribe.json` 最后落，`asr.js:278-287`）、中间 WAV/临时目录 `finally` 清理、`NO_TEXT` 与 `DEPENDENCY_MISSING` 分开报。
- **缺的**：识别内核。两个注入口：① `source.js:587` `setTranscriber()`；② `index.js:75` 的 `transcriber: config.transcriber ?? null`。两者在仓内**都没有供给方** —— 对 `packages/` + `profiles/` 全量 `grep setTranscriber|transcriber`，命中全部落在 `classroom/src/` 自己的三个文件（`asr.js` / `source.js` / `index.js` 的转发）与 README，**没有任何 profile / preset / core 包调用 `setTranscriber`，也没有任何 profile 配置写 `transcriber:`**。`asr.js:94` `assertTranscriber` 对 `null` 抛 `DEPENDENCY_MISSING`。
- **结论**：**代码在，能力不在。** 这是本批次最典型的「看起来实现完了其实跑不通」。补法有两种：小改（接线注入一个转写器）或大改（内置 sherpa-onnx + 模型，与「本仓不跑 npm install」冲突）。建议先做小的。

---

## 审计方法与局限

1. **A/B 判定依据**：读上游实现（不含 `cli.ts`；`cli.ts` 只用来确认「上游 provides 这一条到底输出什么视图」）。
2. **CLI 视图里的「便利字段」不判 B**（如 `courseRow` 的 `link`、`fileSize` 的格式化字符串、`beijingMinute` 的时间格式化）—— 那是 CLI 为了上屏拼的，不是数据源能力。但**CLI 视图里的「计算逻辑」判 B**（如 `lab labs` 的 `availableWeeks`/`unavailableReason` 是容量+窗口+冲突三重判断，`pta homeworkView` 的逐题列表是真实数据结构）。这条线是我自己划的，如与裁决口径不同请以裁决为准。
3. **方法名不同不算差异**（如 `logout` → `clearCookie`），只有返回形状 / 错误分类 / 额外校验 / 少支持输入才判 B。
4. **未做真机验证**：本轮全部是源码对读，没有用真实账号打任何接口。三个包（`lab` / `sztz` / `chalaoshi`）的 README 自己声明「没有用真实账号验证过任何接口」，这会影响 B 类里「行为是否真的不同」的置信度 —— 但**不影响 A/B/C/D 的分类**（分类依据是代码结构，不是运行结果）。
5. **`classroom` 的 `download` 判 B 而非 D**：D21 说下载执行归 core，但本仓 core 里**没有**智云下载编排（`grep acquire|downloadLesson` 零命中），所以「归他处」不成立 —— 能力确实缺失，只是缺的理由是「没搬」不是「归了别处」。
6. **未审计**：`packages/vendor/*` 其它模块、批次 A 的四个包（zdbk/cc98/tyys/xuezai）。`coverage-gaps.md` 已有的 W-1～W-8 与本报告重合的部分已注明，未重复计数。