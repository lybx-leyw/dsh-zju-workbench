# 上游覆盖度审计 · 批次 A（zdbk / cc98 / tyys / xuezai）

审计时间：2026-11-10
审计范围：76 条 provides（zdbk 17 / cc98 32 / tyys 9 / xuezai 18）

基线：`.tmp/upstream-baseline.json`；上游源码 `packages/vendor/zju-assistant/core/zju/lib/<模块>/`，
**已排除 `cli.ts` 作为能力来源**（只在需要确认「上游给的是不是读操作」时引用它作证据）。

判定口径：A 已实现 / B 已实现但有差异 / C 明确未做 / D 计划归他处，四类，无第三态。

**补充说明（口径落地细节，与批次 B 对齐）**：

- 纯字段改名 / 本仓返回**超集**且无信息丢失 → 记 **A**（「返回形状不同」按**信息是否丢失**判，否则几乎所有条目都会掉进 B，判定失去区分力）；
- 信息丢失、错误分类不同、多一道校验、默认行为不同、输入契约不同 → **B**；
- D 一律要求指向真实存在的裁决编号；**D 只说明「归谁」，不说明「那边做了」** —— 落地残缺另记遗漏清单。

---

## 汇总

| 包 | 上游 | A 已实现 | B 有差异 | C 未做 | D 归他处 | 覆盖率 |
| --- | --- | --- | --- | --- | --- | --- |
| `zdbk` | 17 | 5 | 9 | 0 | 3 | **100%** |
| `cc98` | 32 | 14 → **18** | 10 → **6** | 0 | 8 | **100%**（严格口径 56% → **72%**） |
| `tyys` | 9 | 4 | 3 | 0 | 2 | **100%** |
| `xuezai` | 18 | 2 | 4 | 5 | 7 | **72.2%** |
| **合计** | **76** | 25 → **29** | 26 → **22** | **5** | **20** | **93.4%** |

覆盖率 = (A + B + D) / 总数。
**严格口径** = 只把 A 算已完成（`upstream-gap-audit-2026-11-12.md` 用的是这个）。

> **2026-11-12 的改动**：cc98 四个写动作的参数错位、赞踩无法取消、发帖/回帖丢标签与匿名
> 已全部修好，四条 B 转 A（`board post` / `topic reply` / `floor like` / `floor edit` 等）。
> 图片上传仍未做，那是多段上传，单独记待办。

**⚠️ 覆盖率严重高估可用性，看这张表时请连读下面三条：**

1. **D 类 20 条里有 15 条在目标包中「有方法但不可用」或「根本没人实现」**（参数契约不匹配、运行期 ReferenceError、或目标包里没有对应方法）。
   本批实测复现了三个包的四组故障，见漏-1～漏-5。**D 算「已处理」，只是「归了别处」，不是「能用」**。
2. `tyys` 的 100% 里有一条**假的**：`bookVenue`/`cancelVenue` 的 `prepare()` 一被调用就抛
   `ReferenceError: createTyysWrites is not defined`（漏-1）。
3. `zdbk` / `cc98` 的 README 都在第 6 行、第 2 行写着「**本包只读**」，而代码里各有
   3 个 / 8 个写方法注册在服务面上。文档与代码直接矛盾，见「理由不实的条目」。

---

## 遗漏清单（**这是最重要的部分**）

按用户影响排序。前 5 条是**已实测复现的功能性故障**，不是「能力弱一点」，是「点了就报错」。

### 漏-1 · `tyys` · 场馆预约 / 取消预约（写）——运行期直接 ReferenceError

- **上游做什么**：`bookVenue`（`tyys/booking.ts:212`）预下单 + 提交订单；`cancelVenue`（`booking.ts:282`）取消。
- **本仓状态**：**有方法、有实现文件，但没接线**。`packages/source/tyys/src/index.js:146` 调用了
  `createTyysWrites(venue)`，而该文件第 36-40 行的 import 块**只导入了 `@lybx-leyw/dsh-zju-source-http`
  与 `./tyys.js`**，从未导入 `./writes.js`。`packages/source/tyys/src/writes.js:64` 导出的
  `createTyysWrites` 在 `tyys.js` 中不存在（实测 `typeof t.createTyysWrites === 'undefined'`）。
- **实测证据**：挂载后调用 `service.bookVenuePrepare({...})` →
  `ReferenceError: undefined createTyysWrites is not defined`。
- **影响**：`packages/tool/campus-write/src/tools.js:177-190` 的 `campus_activity` +
  `platform: 'tyys'` + `action: book|cancel` 这条路**100% 失败**，且错误不是 `TyysError`，
  没有 `code`，工具层会把一个 `ReferenceError` 直接抛给模型/用户。预约是时效性功能（放号就抢），
  失败代价高。
- **补的成本**：**小**（一行 import）。
- **建议**：**立刻补**。这是本批唯一的纯接线错误，修完立刻恢复两条能力。

### 漏-2 · `zdbk` · `selection select` / `reorder` / `drop`（写）——工具层与数据源参数契约不一致

- **上游做什么**：`Xsxk.select(target, opts)`（`zdbk/xsxk.ts:211`）用 `target.xkkh` + 提交前重查教学班取
  `tabname`；`reorder(xkkhs[])`（`:228`）要求**整个志愿组的完整顺序**；`drop(xkkh)`（`:249`）。
  三者的入口都接受 `{ course, teacher, time, section }`，由 `selection-task.ts` 的
  `taskSections` 按课程名搜索 → 解析 → 过滤。
- **本仓状态**：**两段式写方法已实现**（`packages/source/zdbk/src/writes.js:149` `selectCourse`、
  `:189` `dropCourse`、`:205` `reorderCourse`），但它们的入参是
  `{ course, pool, category, section }`（`writes.js:125-131` 的 `loadSections` 三缺一即报错）。
  而工具层 `packages/tool/campus-write/src/tools.js:131-140` 只传
  `{ course, section }` / `{ course }` / `{ course, order }` —— **既没 `pool` 也没 `category`**。
- **实测证据**（直接构造写会话调 `prepare`）：
  - `selectCourse({course:'高等数学', section:'(2025-2026-1)-X-1-1'})` → `INVALID_ARGUMENT 需要 pool（课程号…）`
  - `dropCourse({course:'高等数学'})` → `INVALID_ARGUMENT 需要 section（教学班号…）`
  - `reorderCourse({course:'高等数学', order:1})` → `INVALID_ARGUMENT 需要 section（教学班号）`
- **影响**：`campus_course_select` 的**三个 action 全部无法执行**。更糟的是它失败在
  `prepare` 阶段、文案是「需要 pool」—— 模型拿不到 pool（工具参数表里根本没有这个字段，
  `tools.js:107-117`），于是会反复重试同一个必然失败的调用。选课季这是致命影响。
  另外上游按课程名/教师/时间定位教学班的能力（`taskSections`）本仓**完全没有对应实现**。
- **补的成本**：中（要么给工具加 `pool`/`category` 两个参数并由调用方逐级传入，要么在 source 侧
  补一个「按课程名搜索→唯一化→展开教学班」的解析层，对齐上游 `selection-task.ts`）。
- **建议**：**必补**，且建议走后者 —— 现在的接口把「上游帮用户做的消歧」推给了模型。

### 漏-3 · `cc98` · `floor edit` / `topic favorite` / `floor rate` / `private-message send`（写）——四个动作参数名对不上

- **上游做什么**：`reply`（`cc98/api.ts:630`，支持 quote/anonymous/notifyAll/图片）、
  `setFavorite`（`:614`）、`like`（`:593`，再次发送当前状态即取消）、
  `rate`（`:607`，`{reasonId, type}`）、`editPost`（`:669`）、`sendMessage`（`:729`，按用户名解析）。
- **本仓状态**：8 个写动作在 `packages/source/cc98/src/writes.js:164-260` 实现，
  参数名与工具层 `packages/tool/campus-write/src/tools.js:306-362` **不匹配**，实测：

  | 工具层传的 | source 期望的 | 实测结果 |
  | --- | --- | --- |
  | `editPost` 传 `topic` | `post`（`writes.js:238`） | `INVALID_ARGUMENT 楼层编号 必须是正整数` |
  | `favoriteTopic` 传 `post` | `topic`（`writes.js:203`） | `INVALID_ARGUMENT 帖子编号 必须是正整数` |
  | `rateFloor` 传 `value`，不传 `reason` | `value` **且** `reason` 必填（`writes.js:191`） | `INVALID_ARGUMENT 评分需要 reason（理由编号）` |
  | `sendMessage` 传用户名 | 数字 `recipient`（`writes.js:250` `id()`） | `INVALID_ARGUMENT 收信人编号 必须是正整数` |

- **影响**：CC98 六个写动作里四个**必然失败**（reply / like / post 三条恰好对得上）。
  评分那条即使参数对了也做不满：上游 `setReaction` 支持「再次点即取消」与 `none`，
  本仓 `likeFloor` 只发 1/2（`writes.js:178-182`），**没有取消语义**。
- **补的成本**：小（改参数名 + 让 tool 传 `reason`）/ 中（补取消语义与用户名解析）。
- **建议**：**必补**。这类「契约错位」比没实现更糟：它有方法、有测试、看起来是通的。

### 漏-4 · `xuezai` · `rollcall`（课堂点名）——工具层永远给不出 source 需要的定位

- **上游做什么**：`signin`（`xuezai/rollcall.ts:111`）轮询 `/api/radar/rollcalls`，
  对每条待签的雷达点名按 12 个参考点应答、再按 ≥3 个 distance 做球面最小二乘拟合补签；
  成功即停。
- **本仓状态**：`packages/source/xuezai/src/writes.js:304` 实现了 `rollcall`，但它要求
  `latitude` / `longitude`（`:310-319`，且**明确拒绝伪造定位**）。
  工具层 `packages/tool/campus-write/src/tools.js:268-274` 只传 `{ course, code }` —— 没有坐标。
- **实测证据**：`prepare({course:'高数', code:'1234'})` →
  `INVALID_ARGUMENT 需要 homework（作业编号…）`（`resolveActivity` 先失败）。
- **影响**：`campus_checkin` + `platform: 'xuezai'` **恒失败**。点名窗口只有几分钟且不可补签，
  这条是「错过就没了」的功能。上游的雷达自动应答（12 参考点 + 球面拟合）本仓**完全没有**。
- **补的成本**：大（要移植 `rollcall.ts:37-43` 的 12 个参考点与 `:195-338` 的 100 位精度
  球面 Gauss-Newton；依赖 `decimal.js`，本仓当前无此依赖）。
- **建议**：**补**，但分两步：① 先让小范围可用 —— 轮询列表 + 用户显式给坐标应答；
  ② 雷达拟合单独排期。当前「有方法但永远报错」是最坏状态。

### 漏-5 · `xuezai` · `homework submit`（交作业）——参数契约错位且必须用数字 id

- **上游做什么**：`submitHomework`（`xuezai/homework.ts:173`）接受课程名 + 作业名，内部解析成
  activity，支持附件与正文，提交后回查。
- **本仓状态**：`packages/source/xuezai/src/writes.js:159` 只收
  `homework`（活动 id 或活动对象）+ `comment` + `files`；**不收课程名**，
  `resolveActivity`（`writes.js:146-156`）在 `todos()` 里找不到就报错。
  工具层 `tools.js:221-224` 传的是 `{ course, homework, content }` —— `content` 不是 `comment`。
- **实测证据**：`prepare({course:'高数', homework:'5', content:'我的答案'})` →
  `INVALID_ARGUMENT 交作业至少要有一个文件或一段正文，不能交空`（`content` 被丢弃）。
- **影响**：`campus_homework` + `platform: 'xuezai'` + `action: submit` 失败；
  即使改传 `comment`，用户也只能给数字 id 而不能给作业名（上游能）。
  `retract`（`writes.js:269`）同样只认 id，传作业名会落进 `resolveActivity` 的报错分支。
- **补的成本**：中（`content`→`comment` 是小改；补「课程名 + 作业名 → id」的解析层是中）。
- **建议**：**必补**。

### 漏-6 · `xuezai` · `rollcall status` / `rollcall history`（纯读，被误判成写）

- **上游做什么**：`rollcall status`（`xuezai/rollcall-cli.ts:52-59`）是**纯读**命令，
  描述原文「现在有没有点名、本人是否已签；**只查看，不签到**」，走 `listRollcalls`；
  `rollcall history`（`rollcall.ts:165`）也是纯读，逐课读
  `/api/course/{id}/student/{user}/rollcalls` 并给「已签到/缺勤/未签」统计。
- **本仓状态**：**两条都没有**。`packages/source/xuezai/src/` 里
  `grep 'radar|rollcall'` 只命中 `writes.js` 的写路径，**没有任何读点名的端点**。
  `README.md:129` 给的理由是「严格说历史是只读，但上游把它和签到绑定；本包未实现」。
- **影响**：用户无法回答「现在有没有点名」「我这学期点名缺了几次」——两个最常用的只读问题。
  `xuezai todos` 也不含点名（只有作业/测验）。
- **补的成本**：小（两个纯 GET，无需坐标、无需雷达）。
- **建议**：**必补**，且优先级高于漏-4 —— 它没有依赖，成本最低，收益立刻可见。
  （理由不实，见「理由不实的条目」第 3 条。）

### 漏-7 · `cc98` · `topic view` 的「只看楼主 / 按词筛楼层 / 热门回复 / 多帖」

- **上游做什么**：`viewTopic`（`cc98/index.ts`，`topic view` 的实现）给主楼全文、CC98 列出的全部热门回复
  （按赞排序）、`only`（只看某楼作者，1 即楼主，每页 20）、`find`（只留作者自己的话里含任一关键词的楼层，
  一次最多扫 30 页）；`viewTopics` 支持一次看多个帖并把读不到的列进 `failed`。
- **本仓状态**：`packages/source/cc98/src/reads.js:473` 的 `topic()` 只做**单页楼层读取**
  （`from`/`size`/`max_characters`），无主楼/热门拆分、无 `only`、无 `find`、无多帖。
- **影响**：长帖（几百楼）无法定位「楼主说了什么」；找某个关键词只能自己翻页拉全文；
  十大热帖的「热门回复」视图丢失。
- **补的成本**：中（`postsBySameAuthor` + `hotPosts` 两个端点 + 扫描编排）。
- **建议**：**补**。`README.md:172-173` 把它归为「多帖编排属于调用方，不属于数据层」——
  这条理由不成立（理由不实第 4 条）：`only`/`find` 是**同一个 provides 的参数**，
  不是跨能力编排，把它推给调用方等于让调用方重写分页与去重。

### 漏-8 · `cc98` · `board list` 的三分之二 + `board topics` 的置顶

- **上游做什么**：`boards(s, {all?, keyword?})`（`cc98/index.ts:490`）三态：默认「我关注的版面」、
  `all` 全站分区、`keyword` 按名称搜版面（走 `boardSearch` 唯一化）；`viewBoard`（`:496`）
  返回 `{board, topics}` 且 `top` 走 `topTopics`（**置顶帖**，`api.ts:527`）。
- **本仓状态**：`reads.js:563` 的 `boards()` **只有 `all` 这一态**（`/Board/all`），
  既没有「我关注的版面」（`/me` 的 `customBoards`），也没有 `boardSearch` 按名搜；
  `boardTopics()`（`reads.js:589`）有 `best`（精品帖）但**没有 `top`（置顶帖）**，
  也不返回版面本身的信息。
- **影响**：「我关注的版面」是 CC98 最高频入口之一，本仓拿不到；
  发主题前要先查版面 id 时无从下手（`resolveBoard` 在上游，本仓无对应物）。
- **补的成本**：小（一个 `/me` + 一个 `/board/search` + 一个 `topic/toptopics`）。
- **建议**：**必补**，成本极低。

### 漏-9 · `cc98` · `search` 的多关键词编排全部丢失

- **上游做什么**：`runSearch`（`cc98/query.ts:61`）串行限速查多个说法（最多 10 个）、
  合并去重、标出命中的说法、按 `relevance`（命中词数 + 标题命中 + 热度 + 新鲜度）/`recent`/`replies`
  排序，支持 `withinDays` 与 `limit`，单个关键词失败不影响其它。
- **本仓状态**：`reads.js:449` 的 `search({keyword, from, size})` 是**单关键词直通**
  `/topic/search`，无合并、无相关度、无排序、无 `boardId` 过滤，只回 `topics` + `next_from`。
- **影响**：上游注释写得很直白：「搜『数据结构』搜不到『fds』」。CC98 服务端只做标题子串匹配，
  一次只查一个说法等于**大半搜不到**。本仓 `README.md:171` 也承认「没有分页总数」。
- **补的成本**：中（纯编排，无新端点；需要 `splitPhrases` 与排序函数）。
- **建议**：**补**。这是「本仓有、但用户体感差一个量级」的典型。

### 漏-10 · `cc98` · `user` 资料字段大面积丢失 + 无 `topics` 选项

- **上游做什么**：`viewUser`（`cc98/index.ts:152`）给 levelTitle、privilege、groupName、
  wealth、popularity、prestige、fanCount、followCount、receivedLikeCount、isFollowing、
  lockState（禁言）、portrait、signature；`viewUserPage`（`:509`）还能附最近 10 个主题。
- **本仓状态**：`reads.js:352` 的 `userView()` 只有
  `id/name/gender/posts/fans/level/introduction/register_time/last_login/url`；
  `user()`（`reads.js:605`）没有 `topics` 参数。
- **影响**：看人页面缺「财富/声望/受赞/关注关系/禁言状态/头像」，无法判断对方是不是活跃用户；
  也无法从用户页直接看他最近发了什么。
- **补的成本**：小（同一端点返回里字段都在，只是没取）。
- **建议**：**必补**，纯字段透传。

### 漏-11 · `cc98` · `notifications` 的汇总模式

- **上游做什么**：`notifications(s, kind?, …)`（`cc98/index.ts:320`）不给 `kind` 时**并行汇总**
  回复 / @ / 系统三类，并在有未读私信时附上各会话最新一条（明确「不读会话、不会标已读」）。
- **本仓状态**：`reads.js:628` 的 `notifications({kind='reply'})` **默认只查回复一类**，
  且必须给一个 kind，无法一次拿全。
- **影响**：用户问「我有什么新消息」时，本仓只回「回复我的」那几类；
  未读私信不在同一个视图里。
- **补的成本**：小（三次并行 + 一次未读判断）。
- **建议**：**补**。

### 漏-12 · `cc98` · 私信列表丢失未读会话内容；单会话顺序与上游相反

- **上游做什么**：`messages`（`cc98/index.ts:353`）不给用户时列最近会话，**有未读的会话直接带上最近
  10 条对话**；给用户时把 `messagesWith` 的结果 `.reverse()` 成**从早到晚**。
- **本仓状态**：`conversations()`（`reads.js:660`）只给 `user_id/last/time/read` ——
  没有对方用户名（上游补了 `basicUsers`），也没有未读会话的对话内容；
  `messages({user_id})`（`reads.js:681`）**直接 map，不 reverse**，顺序与上游相反。
- **影响**：读私信要先拿 id 再查两次；顺序反了会让「谁先说的」看起来颠倒（对话类数据这是硬伤）。
- **补的成本**：小（一次 `basicUsers` + 一个 reverse + 条件性拉对话）。
- **建议**：**补**。

### 漏-13 · `zdbk` · `timetable` 缺学籍、节次表来源、六类非正式课、缓存

- **上游做什么**：`getTimetable`（`zdbk/kbcx.ts:110`）返回
  `student`（学号/姓名/行政班/学院/专业）、`enrollOpen`、`courses` + **六类非正式课**
  （`practice`/`online`/`english`/`training`/`arranged`）、`slots`（每日节次分布）；
  `getSchedule`（`:202`）另从**页面 JS 的 `arrKbjcsj`** 读真实节次时刻并合并被拆开的相邻节，
  `cachedSchedule`（`:260`）带 6 小时缓存 + 跨日失效 + 「刷新失败退回一周内旧缓存」。
- **本仓状态**：`packages/source/zdbk/src/reads.js:222` 的 `timetable()` 只返回
  `academic_year/term/semester/inferred_term/sessions/skipped_items/note`。
  `sjkList`/`xskList`/`ywkList`/`jxkList`/`fKbList` **在 `reads.js` 与 `parse.js` 里一个都不出现**（已 grep 确认）；
  节次时刻用**写死的 `PERIOD_TIMES`**（`parse.js:281`，紫金港常规作息）；
  无缓存、无 `student`、无 `enrollOpen`。
- **影响**：① 实践/线上/英文/进修/服从调配的课**看不见**（用户会以为课表全了）；
  ② 换校区（海宁/舟山）节次时间全错；③ 每次打开都真打一次接口（上游有 6h 缓存与陈旧兜底）。
- **补的成本**：中（六类列表是纯透传、`student` 同响应内；节次表要抓页面 JS；缓存要定落点）。
- **建议**：**六类列表与 `student` 必补**（同一响应里就有，成本≈0）；节次表从页面读、缓存按 D21 归 core。

### 漏-14 · `zdbk` · `grades` 缺评教提示；GPA 口径与上游不同

- **上游做什么**：`getGrades`（`zdbk/cjcx.ts:57`）额外查 `xtgl/index_cxMyCosJxpj.html`，
  评教未完成时给 `evaluationPending`：「本学期尚未完成评教，教务网暂不显示本学期成绩；完成评教后再查。」
  并返回 `rule`（文件依据）与 `sourceUrl`。
- **本仓状态**：`reads.js:130` 的 `grades()` 无评教检查（全仓 grep `评教|jxpi` 无命中）。
  GPA 口径另有分叉：本仓多算 `gpa_4_3`（`parse.js:261`，4.3 制映射）、
  `average_score`（`parse.js:264`，本仓自定等级折算表）、`earned_credits` 口径也不同
  （`parse.js:256-258` 把「合格」与 `xtwkc` 计入，上游 `cjcx.ts:72` 用 PASS 正则 + 数字≥60）。
- **影响**：学期初用户看到「没有成绩」而**不知道是评教没做**——这是每学期都会发生的困惑，
  也是上游专门写了一条提示的原因。GPA 数值在两套实现下**可能不同**（4.3 制与均分是新增口径，
  不冲突；但 `earned_credits` 的两套判据会让「已获学分」对不上）。
- **补的成本**：小（评教一个请求 + 一个字段）。
- **建议**：**评教提示必补**；`earned_credits` 口径建议对齐上游或在 `note` 里写明差异。

### 漏-15 · `zdbk` / `cc98` / `xuezai` · 三条「下载」全部悬空（D21 归 core，core 里没有）

- **上游做什么**：`downloadPdf`（`zdbk/pyfagl.ts:127`）存 PDF 到 `paths.output()`；
  `download.ts`（cc98）**必然**流式落盘到 `data/output/cc98/`；
  `downloadMaterials`/`downloadSubmission`（`xuezai/materials.ts:115`、`homework.ts:116`）落盘并复用。
- **本仓状态**：三条全部**没有落盘实现**：
  - `zdbk`：`reads.js:391-395` 只回 `pdf_url`；
  - `cc98`：`reads.js:756` 的 `topicDownload` 默认只回链接，**配了 `downloadDir` 才落盘**；
  - `xuezai`：只给附件元数据（`xzzd-reads.js:87` `publicFile`），无下载流。
  **D21 裁决真实存在**（`zju-assistant-impl-plan.md:56`：「下载由 `packages/core/*` 执行；
  `source/*` 只暴露下载所需的全部参数」），但 `packages/core/` 下 **28 个包无一有 download 实现**
  （已按 `download` 关键字全目录 grep，零命中）。
- **影响**：「把作业附件拿下来」「把培养方案 PDF 存本地」这两个最普通的动作，**本仓没有承接方**。
  D21 把活划给了 core，core 没接 —— 能力在组织图上存在，在代码里不存在。
- **补的成本**：中（core 侧一个通用下载器 + 三处参数透传）。
- **建议**：**补 core 侧**。注意 `cc98` 的 source 侧**已经**有落盘能力（`downloadDir`），
  与 D21「source 不碰文件系统」直接冲突 —— 这是需要先裁决的一处自相矛盾。

### 漏-16 · `xuezai` · 无课程详情 / 章节树（modules）

- **上游做什么**：`getCourseContent`（`xuezai/courses.ts:99`）= `listModules` + `listActivities`
  + `courseTree`（`:83`，按 module → syllabus → activity 三级归位，未归位的进 `unassigned`）；
  `listMaterials` 借它实现「按章节组织的文件清单」。
- **本仓状态**：**没有 modules 端点**。`xzzd-reads.js` 只有 `activities`/`assignments`/`activity`/
  `materials`/`activitySubmission`，全部平铺；`materials` 靠 `conditions.itemsSortBy.chapter`
  （`xzzd-reads.js:398-402`）让**服务端**排章节，但**不返回章节名**。
- **影响**：无法按章节目录浏览课程内容；课件清单没有「第几章第几节」。`README.md:178-179` 已自认。
- **补的成本**：中（一个端点 + 归位逻辑）。
- **建议**：**补**（`course view` 这条 provides 的主体就是它，见 C-#3）。

### 漏-17 · `tyys` · 同伴参数（双打场地）与支付

- **上游做什么**：`companionParams`（`tyys/booking.ts:103`）走 `vip/view/buddy_no` 查同伴再
  `vip/check/buddy_no` 校验；`payAndVerify` 处理零元确认与支付。
- **本仓状态**：`packages/source/tyys/src/writes.js:167-173` 对 `buddyMin > 0` 明确抛
  `NOT_IMPLEMENTED`（**这是诚实的**，不是编理由）；无支付路径。
- **影响**：网球/羽毛球双打等需要同伴的场地**无法预约**。`coverage-gaps.md` 已记为 W-7。
- **补的成本**：中。
- **建议**：**补**（已有 W-7 记录，此处只做交叉引用）。

### 漏-18 · `zdbk` · `session login/status` 字段与上游不同

- **上游做什么**：`openZdbk().status()`（`zdbk/client.ts:187`）给
  `{username, file, cached, ageMs, expired}`；`login` 命令回
  `{...status, probed, httpStatus}`（`zdbk/cli.ts:43-50`）。
- **本仓状态**：`packages/source/zdbk/src/index.js:548` 的 `status()` 给
  `{logged_in, account_known, account, session_file, using_cached_session, note}`；
  `login()`（`:561`）给 `{logged_in, forced}`。
- **影响**：页面无法显示「会话还有多久过期」（无 `ageMs`/`expired`）；
  也无法显示 CAS 探测的 HTTP 状态（`probed`/`httpStatus`），排查登录问题时少一层证据。
  本仓的取舍写得很清楚（不联网、不发请求），但**信息确实少了**。
- **补的成本**：小（过期时间从 cookie `expires` 或文件 mtime 读）。
- **建议**：**可选补**。这是纯展示信息，不影响读取。

---

## 逐条对账

### zdbk（17 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `zdbk timetable` | **B** | `packages/source/zdbk/src/reads.js:222` `timetable()` | 缺 `student`/`enrollOpen`/六类非正式课/`slots`/页面节次表/6h 缓存（漏-13）。**为什么这样改**：节次写死 `PERIOD_TIMES` 的理由在 `parse.js:276-280`（正方只给节次号不给时间）；缓存与页面节次表**无理由** |
| 2 | `zdbk exams` | **B** | `reads.js:192` `exams()` | 上游按课程聚合、期中/期末各给 `{status,date,startTime,endTime,location,seat}`（`kscx.ts:15-22`）；本仓**拆成扁平行**（`parse.js:398` 每行带 `type`），并支持 `upcoming_only`（上游无）。**为什么**：`reads.js:198-200` 明确解释「`end==null` 的保留，那不是已过去」—— 这是修正，但形状确实不同 |
| 3 | `zdbk grades` | **B** | `reads.js:130` `grades()` | 缺 `evaluationPending`（评教）、`rule`、`sourceUrl`；多 `gpa_4_3`/`average_score`；`earned_credits` 判据不同（漏-14）。**为什么**：4.3 制与均分的理由在 `parse.js:145-153`、`209-218`；评教提示**无理由** |
| 4 | `zdbk plan view` | **B** | `reads.js:367` `planView()` | 只回 `pdf_url`，**不下载**（原文 `fs.writeFileSync`）。**为什么**：`reads.js:350-355` + `plan.js:15-16`：`Transport` 是文本通道，二进制归 tool/D21；专业名消歧用 `NEEDS_DISAMBIGUATION`（上游 `uniqueMatch` 同义） |
| 5 | `zdbk plan list` | **A** | `reads.js:304` `planList()` | 本地按学院/专业名包含匹配，与上游 `findPlans` 同口径；返回是上游 `planRow` 的**超集**（多 `core_courses`/`frontier_courses`），无信息丢失 |
| 6 | `zdbk selection context` | **A** | `reads.js:424` `selectionContext()` | 与上游 `context()` 同源（选课首页隐藏 input），多给 `kind`（courses/search/special）用于分派 |
| 7 | `zdbk selection courses` | **B** | `reads.js:463` `selectionCourses()` | 入参是**类别码 `dl`**（+ 可选 `name` 消歧），上游 CLI 是**类别名**并「不给就列类别」；本仓也不回「类别清单」这一态。**为什么**：`reads.js:447-458` 解释同码多页签必须 `dl`+`name` 一起定位 —— 理由成立，但入口语义确实不同 |
| 8 | `zdbk selection search` | **A** | `reads.js:518` `selectionSearch()` | 支持 `keyword`/`field`（对齐上游）+ `conditions`/`relation`（超集）；逐页去重、重复即报 `PAGINATION_UNSTABLE`（`reads.js:701-724`），与上游 `searchAll` 同义 |
| 9 | `zdbk selection sections` | **B** | `reads.js:560` `selectionSections()` | 必须给 `course`+`pool`+`category` 三件（`reads.js:567-569`），`xk_9` 还要回传 `search`；上游入口接受 `{course,teacher,time,section}` 并**自己按名搜→解析→展开**（`selection-task.ts:72`）。本仓**没有那层解析**。**为什么**：`reads.js:545-555` 解释 `pool` 必要（服务端按池展开）—— 成立，但缺失「按名定位」是真差异 |
| 10 | `zdbk selection selected` | **A** | `reads.js:621` `selectionSelected()` | `state` 三态（已选上/待筛选/未知）与上游 `selectionState` 一致；`credits` 失败时降级为 `null`+`credits_error`（比上游 `.catch(()=>undefined)` 更如实） |
| 11 | `zdbk selection credits` | **A** | `reads.js:675` `selectionCredits()` | `xf9/xf91/xf92` 三档，非法值抛 `SCHEMA_CHANGED`，与上游 `xsxk.ts:146-154` 同口径 |
| 12 | `zdbk selection select` | **D** | `packages/tool/campus-write/src/tools.js:131-134` → `packages/source/zdbk/src/writes.js:149` `selectCourse` | 依据 **D17**（`zju-assistant-impl-plan.md:52`「写操作一律进 tool/」）。**落地残缺**：工具层缺 `pool`/`category`，实测必失败（漏-2） |
| 13 | `zdbk selection reorder` | **D** | `tools.js:139-140` → `writes.js:205` `reorderCourse` | 同上。另：上游 `reorder` 接受「教师名/班号逐位指定」并由 `ownedTarget` 解析（`selection-cli.ts:94-100`），本仓只收 `{section, order}` 单条语义（**整体重排** vs **移到第 N 位**，`writes.js:216-226`）—— 语义不同 |
| 14 | `zdbk selection drop` | **D** | `tools.js:135-138` → `writes.js:189` `dropCourse` | 同上，工具层不传 `section`，实测必失败（漏-2） |
| 15 | `zdbk session login` | **B** | `packages/source/zdbk/src/index.js:561` `login()` | 行为对齐上游（真登 + 真读一次业务接口 = 上游 `verify`，`index.js:380`），但返回 `{logged_in, forced}` 而非 `{username,file,cached,ageMs,expired,probed,httpStatus}`；`force` 默认 **true**（上游 `fresh` 默认 false）。**为什么**：`index.js:475-488` 解释「登录态没有业务数据可读，硬塞进 READ_METHODS 会触发 CAS」 |
| 16 | `zdbk session status` | **B** | `index.js:548` `status()` | 不联网（好），但缺 `expired`/`ageMs`（漏-18）。**为什么**：`index.js:543-545` 明说「不许为它发请求」 |
| 17 | `zdbk session logout` | **B** | `index.js:579` `logout()` | 清会话但**失败时抛 `LOGOUT_FAILED`**（上游返回 `{cleared:false}`）；成功恒回 `{cleared:true}`。**为什么**：`index.js:573-575` `persist:true` 立即落盘，理由是「延迟落盘会让旧会话在进程退出时复活」—— 成立 |

### cc98（32 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `cc98 hot` | **A** | `packages/source/cc98/src/reads.js:524` `hot({range})` | 四档与上游一致；`today` 走 `/config/index` 的 `hotTopic`（anonymous），周/月/历史走 `/topic/hot-*` |
| 2 | `cc98 search` | **B** | `reads.js:449` `search()` | 单关键词直通，无多说法合并/相关度/排序/`boardId`（漏-9）。**为什么**：注释只解释 UBB 清洗与 `next_from`，**搜索编排缺失无理由** |
| 3 | `cc98 user` | **B** | `reads.js:605` `user()` + `reads.js:352` `userView()` | 字段大面积丢失 + 无 `topics`（漏-10）。**为什么**：注释只解释「名字要 encodeURIComponent」，字段取舍**无理由** |
| 4 | `cc98 board list` | **B** | `reads.js:563` `boards()` | 只剩「全站分区」（`all`）一态，缺「我关注的版面」与「按名搜版面」（漏-8）。**为什么**：无理由 |
| 5 | `cc98 board topics` | **B** | `reads.js:589` `boardTopics({board_id, from, size, best})` | 有 `best`（精品）**无 `top`（置顶）**，且不回版面信息（漏-8）。**为什么**：`reads.js:579-587` 只解释 `best` 两条路径，置顶**无理由** |
| 6 | `cc98 board tags` | **A** | `reads.js:714` `boardTags()` | `tag1` + `tag2` 并集 + `layers`，与上游 `boardTags` 同义；`tags` 缺失时给空数组而非报错（有注释理由 `:718-720`） |
| 7 | `cc98 board post` | **D** | `tools.js:306-310` → `packages/source/cc98/src/writes.js:211` `postTopic` | 依据 **D17**。**落地残缺**：上游 `post`（`cc98/index.ts:567`）支持图片上传/标签 `tag1`/`tag2`/匿名/Markdown/`type`，本仓只发 `title/content/type:'0'/tag1:''`（`writes.js:217-221`）—— 有标签的版面**发不出去** |
| 8 | `cc98 topic view` | **B** | `reads.js:473` `topic()` | 单页楼层，无主楼/热门拆分、无 `only`、无 `find`、无多帖（漏-7）。**为什么**：`README.md:172-173` 称「多帖编排属于调用方」—— 不实，见「理由不实」第 4 条 |
| 9 | `cc98 topic reply` | **D** | `tools.js:311-315` → `writes.js:225` `replyTopic` | 依据 **D17**。上游支持引用/匿名/通知全体/图片/Markdown（`index.ts:556` + `api.ts:630`），本仓只发 `content/contentType:'0'/anonymous:'false'`（`writes.js:230-233`） |
| 10 | `cc98 topic favorite` | **D** | `tools.js:353-356` → `writes.js:202` `favoriteTopic` | 依据 **D17**。**契约错位**：工具传 `post`，source 要 `topic`（漏-3 实测失败）；supports `on:false` 取消（`:204`），上游 `setFavorite` 还会**回查** `isFavorite`（`api.ts:617`），本仓无回查 |
| 11 | `cc98 topic download` | **B** | `reads.js:756` `topicDownload()` | 默认**只回链接**，配 `downloadDir` 才落盘；上游**必然**落盘到 `data/output/cc98/`。**为什么**：`README.md:233` + `reads.js:743-748` 明说「目录由装配方定，不让调用方传」—— 安全理由成立，但与 D21「source 不碰文件系统」冲突（漏-15） |
| 12 | `cc98 floor like` | **D** | `tools.js:349-352` → `writes.js:176` `likeFloor` | 依据 **D17**。**能力缺失**：上游 `like` 再次发送当前状态即取消、且 `setReaction` 支持 `'none'`（`index.ts:532`）；本仓只发 1/2（`writes.js:178-182`），**无法取消赞踩** |
| 13 | `cc98 floor rate` | **D** | `tools.js:357-362` → `writes.js:185` `rateFloor` | 依据 **D17**。**契约错位**：工具不传 `reason`，source 必填（漏-3 实测失败） |
| 14 | `cc98 floor rating-reasons` | **A** | `reads.js:854` `ratingReasons()` | `{plus, minus}`，过滤 `enabled!==false`，与上游 `index.ts:540` 一致 |
| 15 | `cc98 floor original` | **A** | `reads.js:881` `original()` | 原样不清洗（这是它的意义，注释 `:868-875` 说明）；403 由 client 翻成 `FORBIDDEN`，与上游一致 |
| 16 | `cc98 floor edit` | **D** | `tools.js:316-320` → `writes.js:237` `editPost` | 依据 **D17**。**契约错位**：工具传 `topic`，source 要 `post`（漏-3 实测失败） |
| 17 | `cc98 private-message list` | **B** | `reads.js:660` `conversations()` | 缺对方用户名、缺未读会话的对话内容（漏-12）。**为什么**：注释只说「预览只留前 200 字」，缺 `basicUsers` **无理由** |
| 18 | `cc98 private-message view` | **B** | `reads.js:681` `messages({user_id})` | **顺序未 reverse**（上游 `thread()` 转成从早到晚），字段 `from: 'them'|'me'` 对齐；无 `readByPeer`（上游 `viewMessage` 给「自己发的对方读没读」） |
| 19 | `cc98 private-message send` | **D** | `tools.js:321-325` → `writes.js:249` `sendMessage` | 依据 **D17**。**契约错位**：工具传用户名，source 要数字 id（漏-3 实测失败）；上游按用户名 `resolveUser` 解析、支持图片、5 分钟去重（`index.ts:376`） |
| 20 | `cc98 account overview` | **A** | `reads.js:913` `overview()` | 四项串行、任一失败即整体失败（`reads.js:903-905` 有理由：缺一块就是错的概况），与上游 `index.ts:244` 同义 |
| 21 | `cc98 account topics` | **A** | `reads.js:948` `myTopics()` | 同端点 `/me/recent-topic` |
| 22 | `cc98 account posts` | **A** | `reads.js:966` `myPosts()` | 保住服务端 `count` 并用它算 `next_from`（`reads.js:170-182`），比上游更准 |
| 23 | `cc98 account history` | **A** | `reads.js:990` `history()` | 同上，每条带 `last_browsing_time` |
| 24 | `cc98 account favorites` | **A** | `reads.js:1021` `favorites()` | 分组 + 搜索收藏 + `order` 校验，与上游一致且更严 |
| 25 | `cc98 account following` | **A** | `reads.js:1066` `following()` | 按原始 ID 列表保序（`reads.js:1080-1082` 有理由），查不到名字给 `null` 不编造 |
| 26 | `cc98 account feed` | **A** | `reads.js:1103` `feed()` | `boards`/`users` 两态，`order: 0` 照上游 |
| 27 | `cc98 account notifications` | **B** | `reads.js:628` `notifications()` | 默认只查 `reply`，无法一次拿全三类 + 未读私信（漏-11）。**为什么**：注释 `:616-626` 只解释「只读、不标已读」，汇总模式缺失**无理由** |
| 28 | `cc98 account signin` | **D** | `tools.js:276-280` → `writes.js:165` `signIn` | 依据 **D17**。本仓 `signIn` 先查 `/me` 判今天是否已签（`writes.js:168-169`）再发，比上游 `doSignIn` 更简洁；上游的 `already`/`signed`/`failed` 三态与 `reward`/`streak` 未回 |
| 29 | `cc98 account signin-month` | **A** | `reads.js:1126` `signinMonth()` | 年月校验 + `total_reward` 全 null 时给 null 而非 0（`reads.js:1151-1152` 有理由） |
| 30 | `cc98 session login` | **B** | `packages/source/cc98/src/token.js:277` `token({force})` / `:320` `login()` | **无独立登录入口**：登录在首次读取时隐式发生；服务面只有 `status`/`logout`（`index.js:377-380`），无法显式强制重登。**为什么**：`index.js:367-376` 解释「会话动作与 methods 分开列」—— 解释了分类，没解释为何不给 login |
| 31 | `cc98 session status` | **A** | `index.js:334` `status()`（路由 `cc98.status`） | 不回令牌本身（`index.js:328-333` 有安全理由）；字段是上游 `status()` 的超集 |
| 32 | `cc98 session logout` | **A** | `index.js:486` `logout()`（路由 `cc98.logout`） | 清令牌信封，只清本包那条 cookie（`token.js:199-209` 有理由：整 jar clear 会带走 Transport 的 cookie） |

### tyys（9 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `tyys rollcall history` | **A** | `packages/source/tyys/src/tyys.js:1432` `history(client, course)` | 与上游 `rollcall.ts:17` 逐句对齐：`lack` 不用、日期从 `course_times` 对、`isEarly` 补「（早退）」。本仓 `:1421-1427` 把两条坑写清楚了 |
| 2 | `tyys session login` | **B** | `packages/source/tyys/src/index.js:291` `session()` | 等于上游 `login`（都调 `checkSession` → `/api/l/v6/u/info`，`tyys.js:1382`），但**无 `fresh` 参数**（上游可强制重登）、返回值形状不同。**为什么**：`index.js:105-107` 解释「不注入登录回调也能读匿名接口」，未解释为何去掉了 fresh |
| 3 | `tyys session status` | **B** | `index.js:291` `session()` | **行为相反**：上游 `status` 读**本地会话文件**、标注 `"local"`（不联网，`tyys/cli.ts:94`）；本仓 `session()` **会联网**（`index.js:287` 注释自认）。**为什么**：无理由（本仓根本没有会话文件层次，见 #4） |
| 4 | `tyys session logout` | **B** | `index.js:217` `reset()` | 只掉**内存**令牌（`tyys.js:886`），无磁盘会话可清 —— 因为本包**从不落盘**。上游 `logout` 删 `SessionStore` 文件。**为什么**：`index.js:834` 注释「令牌与目录/须知缓存都在内存里；**不落盘**（调用方要持久化就自己存）」—— 理由成立，但导致 `status/logout` 这一对失去对象 |
| 5 | `tyys venue list` | **A** | `tyys.js:1495` `listVenues()` | 五态状态机（catalog/needs-time/not-released/available/unavailable）逐条对齐上游 `venue.ts:239-258`，连「相邻时段」与「放号时刻」都一致 |
| 6 | `tyys venue book` | **D** | `tools.js:183-188` → `index.js:172` → `packages/source/tyys/src/writes.js:99` `bookVenue` | 依据 **D17**。**完全不可用**：`createTyysWrites` 未导入，实测 `ReferenceError`（漏-1）。另缺同伴参数与支付（漏-17） |
| 7 | `tyys venue order list` | **A** | `tyys.js:812` `listOrders()` | `complete` 与 `partial` 区分（`tyys.js:762-766` 有理由：不能把一页当全部），`orderView` 文案与上游 `booking.ts:745` 一致 |
| 8 | `tyys venue order cancel` | **D** | `tools.js:179-182` → `index.js:174` → `writes.js:194` `cancelVenue` | 依据 **D17**。**完全不可用**（同漏-1）。本仓另有优点：取消前用 `listOrders` 核对订单存在（`writes.js:202-206`） |
| 9 | `tyys venue notice` | **A** | `tyys.js:1106` `notice()` | 匿名可读 + 内存缓存（`CATALOG_TTL_MS`），与上游 `venue.ts:202` 及 `publicOnly` 口径一致 |

### xuezai（18 条）

| # | 上游 provides | 类别 | 本仓落点 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `xuezai todos` | **B** | `packages/source/xuezai/src/index.js:430` `loadTodos()` / `:755` `todos` | 形状不同：本仓 `{xzzd:{ok,rows,error}, pta:{…notInThisPackage}, egress}`，上游 `{currentTime, count, todos[]}`（`todos.ts:36` 合并原生 + 作业扫描）；**默认 `fast` 只发 1 个请求、不跑作业扫描**（`index.js:409-426` 有实测理由）。`pta` 半边已拆包（D8/Q-B） |
| 2 | `xuezai course list` | **C** | 仅内部 `XzzdApi.courses()`（`xzzd.js:249`），**无对外方法** | 理由：`README.md:117`「内部，未单独暴露」。**这条不是「未做」的理由，是「没暴露」的事实** —— D17 只划分读写，不授权把读能力留在内部 → 见「理由不实」第 2 条 |
| 3 | `xuezai course view` | **C** | 无 | 上游 `getCourseContent`（`courses.ts:99`）= 课程详情 + 章节树；本仓**没有课程详情端点**，只有按课查活动/材料（`xzzd-reads.js:284/393`）。理由：`README.md:118`「没有课程模块树」—— 只覆盖了 modules 那一半，缺整个 course view 这层 |
| 4 | `xuezai material list` | **B** | `xzzd-reads.js:393` `materials()` | 能列，但每条是 `activitySummary`（`xzzd-reads.js:186`），**没有上游 `materialRow` 的 `chapter`/`section`/`activity` 归属**（`materials.ts:36`），也无 `video`/`link` 标记。原因同 #3（无 modules） |
| 5 | `xuezai material download` | **D** | 归 `packages/core/*`（**未实现**） | 依据 **D21**（`impl-plan.md:56`）。本仓只给元数据 + `allowDownload`（`xzzd-reads.js:87`）。⚠️ `README.md:120` **没有引用 D21**，只写「不下载文件」→ 理由未引用裁决，见「理由不实」第 5 条 |
| 6 | `xuezai homework list` | **A** | `xzzd-reads.js:315` `assignments()` | 按课取 `/api/courses/{id}/homework-activities`，给 `deadline`/`submitted`/`isClosed`/`files`/`weightPercent`，与上游 `listHomework`（`homework.ts:13`）同义且分页更完整 |
| 7 | `xuezai homework view` | **B** | `xzzd-reads.js:364` `activity()` + `:470` `activitySubmission()` | 要**两次调用**才能拼出上游 `getHomework`（`homework.ts:24`）一次给的 `{name, deadline, requirement, files, submissions[]}`；缺 `requirementText`（`homework.ts:44`）；提交流形状更细（`canRetract`/`score`/`instructorComment`/`draftIds`，是超集） |
| 8 | `xuezai homework download` | **D** | 归 `packages/core/*`（**未实现**） | 同 #5（D21）。上游 `downloadSubmission`/`downloadAttachments`（`homework.ts:116/141`） |
| 9 | `xuezai homework submit` | **D** | `tools.js:221-224` → `index.js:777` → `packages/source/xuezai/src/writes.js:159` `submitHomework` | 依据 **D17**。**契约错位**：工具传 `content`，source 要 `comment`；且只认数字 id（漏-5 实测失败）。上游支持课程名 + 作业名解析 |
| 10 | `xuezai homework retract` | **D** | `tools.js:226-229` → `index.js:779` → `writes.js:269` `retractHomework` | 依据 **D17**。参数名恰好对得上（`homework`），但只认 id；`canRetract` 未校验（上游 `retractHomework` 会看平台是否允许） |
| 11 | `xuezai rollcall` | **D** | `tools.js:268-274` → `index.js:781` → `writes.js:304` `rollcall` | 依据 **D17**。**调用链断裂**：工具给 `{course, code}`，source 要 `{rollcall, latitude, longitude}`，且明确拒绝伪造定位（`writes.js:308-318`）→ 实测必失败（漏-4） |
| 12 | `xuezai rollcall number` | **D** | 归 `packages/tool/campus-write`（**未实现**） | 依据 **D17** + `coverage-gaps.md` W-4。上游 `signinNumber`（`rollcall-number.ts`，12.4 KB）含课堂字幕 OCR 取码；本仓 `writes.js:325` 只在 GPS 应答里附带一个 `number` 字段，**不是同一条路** |
| 13 | `xuezai rollcall all` | **D** | 归 `packages/tool/campus-write`（**未实现**） | 依据 **D17** + W-5。上游 `signinAll`（`rollcall-all.ts:7`）并发跑 gps + number 双路，先签上者停 |
| 14 | `xuezai rollcall status` | **C** | 无 | **纯读**能力（上游 `rollcall-cli.ts:52-59`，描述原文「只查看，不签到」）。理由：`README.md:129`「严格说历史是只读，但上游把它和签到绑定」→ **不实**（见「理由不实」第 3 条）。漏-6 |
| 15 | `xuezai rollcall history` | **C** | 无 | **纯读**能力（上游 `rollcall.ts:165` `rollcallHistory`，只发 GET）。理由同上 → **不实**。漏-6 |
| 16 | `xuezai session login` | **B** | `packages/source/xuezai/src/index.js:290` `openTransport(force)` | 隐式登录（`force` 只在会话失效时用）；上游 `login` 是显式命令且可 `--fresh`。**为什么**：`index.js:294-299` 解释「凭据搬到设置页，别指一个不存在的按钮」—— 解释了凭据位置，未解释为何不给显式入口 |
| 17 | `xuezai session status` | **C** | 无对外方法（内部有 `hasXzzdSession`，`xzzd.js:716`） | 判据存在但**没人能问**：服务面只有 `todos`/`xzzdRead`/`fingerprint`/`egress`/`reset`（`index.js:740-782`）。`README.md:130` 自认「没有独立的 status/logout 动作」。漏-6 同级，但 status 更常被页面用到 |
| 18 | `xuezai session logout` | **A** | `index.js:624` `reset()` | 清本地会话 + 不碰凭据（`index.js:619-623` 有理由），与上游 `logout`（`xuezai/client.ts:198`）同义；名字不同不计差异 |

---

## 本仓多出来的能力

| 包 | 能力 | 上游有吗 | 判断 |
| --- | --- | --- | --- |
| `zdbk` | `gpaSummary`（总体/专业/分学期三份 GPA，专业那份失败降级为 `major_error`） | **无此 provides** | 有意增强。`reads.js:150-160` 有理由：专业 GPA 走另一个接口、口径不同，不能互相替代 |
| `zdbk` | `gpa_4_3` / `average_score` | 无 | 有意增强。`parse.js:145-153` 明确「其余封顶 4.0，不按比例缩放」—— 这条口径是踩出来的，保留 |
| `zdbk` | `selectionSearch` 的多条件（`conditions` + `relation`，最多 20 条） | 上游只有 `keyword`/`only-available` | 有意增强（正方 `cxtjList` 原生支持） |
| `zdbk` | `inferred_term` / `skipped_items` / `PAGINATION_UNSTABLE` | 无 | 有意增强：把「推断」「坏行」「分页回退」都显式化，避免静默错 |
| `zdbk` | 会话与账号身份绑定（换账号先清 jar） | 无 | 有意增强，`index.js:253-277` 写了事故经过 |
| `zdbk` | 登录串行化 + 不缓存失败 | omni 有「失败封锁 15 分钟」 | **修正**，`index.js:242-244` 有理由 |
| `cc98` | `newTopics`（新帖） | 无 provides | 有意增强（omni 时代就有） |
| `cc98` | `conversations`（私信会话单独成方法） | 上游合在 `messages` 里 | 有意拆分，多一个方法但不丢能力 |
| `cc98` | `cc98.status` / `cc98.logout` 两个 action | 有（`session` 组） | 对齐，不是新增 |
| `cc98` | `checkinMonth` 的 `total_reward: null` 语义 | 上游把缺失当 0 求和 | **修正**，`reads.js:1151-1152` 有理由 |
| `cc98` | `readOnly: false` + `writeMethods` 分列 | 上游只有 provides 字符串 | 有意增强（能力自描述更准确） |
| `tyys` | `slots`（某场馆某天原始时段表） | 上游 CLI 无独立命令（`day` 只在 `listVenues` 内部用） | 有意增强：把「筛不动的原始数据」也给出来 |
| `tyys` | `identity()`（场馆平台本人信息） | 上游 `VenueClient.identity` 存在但无对应 provides | 有意增强 |
| `tyys` | `request_` 层写接口**硬拒绝**（`FORBIDDEN_WRITES`，`tyys.js:134`） | 无 | 有意增强：分层不只写在注释里 |
| `xuezai` | `egress` / `fingerprint` / `loginProfile` / `diffTodos` | 无 | 有意增强，全是诊断项（`index.js:537-546`、`index.js:189-190`） |
| `xuezai` | `xzzdRead` 五动作（activities/assignments/activity/materials/submission） | 上游拆成 5 个 provides | 有意合并（**但其中 4 个只覆盖了上游 18 条里的 4 条**，别把「有名字」当「已覆盖」） |
| `xuezai` | `activitySubmission` 的小组作业识别 + `GROUP_UNAVAILABLE` | 上游 `mySubmissions` 有 groupId 但无「未分组」错误分类 | 有意增强，`xzzd-reads.js:476-489` 有理由 |
| `xuezai` | `currentUserId` 反推 + 多值即报错 | 上游 `client.me()` 直接给 id | 有意增强，`xzzd-reads.js:424-433` 有理由（猜一个会查别人的提交） |

**一个有意的「凭空造」需要单独指出**：本仓 `zhiyunZdbk` / `zhiyunCc98` / `zhiyunTyys` /
`zhiyunXuezai` 四个服务上都注册了**上游不存在**的 `Prepare`/`Execute` 两段式写方法。
这是 D17 + D3（`ctx.approval`）的落地形态，设计上合理；但**它让三个包的 README 里
「本包只读」全部变成不实陈述**（见下一节）。

---

## 理由不实的条目

| 包 | 能力 | 注释里说的理由 | 实际情况 |
| --- | --- | --- | --- |
| `zdbk` | 全部写操作 | `README.md:61-63`：「这三条在**本包不存在**：`READ_METHODS` 里没有、`zhiyunZdbk` 服务上没有、`ZdbkClient` 也没有给它们用的单次写请求语义」 | **三处全错**：① `packages/source/zdbk/src/writes.js` 完整实现了三个写方法（149/189/205）；② `index.js:498-500` 的 `writeMethods` 列了 6 个方法名，`:526-531` 一起实现并注册到 `zhiyunZdbk`（实测 `typeof svc.selectCoursePrepare === 'function'`）；③ `client.js:210` 的 `postOnce` 就是单次写请求语义。README 开头第 6 行还写着「**只读**」 |
| `zdbk` | `selection select/reorder/drop` | `README.md:297-299`：「归 `packages/tool/campus-write`（**本次未建**）」 | `packages/tool/campus-write` **已建**（`index.js`、`tools.js` 402 行、`approval.js`），`campus_course_select` 已注册。「本次未建」是过期陈述 —— 更麻烦的是它掩盖了漏-2：工具建了但与 source 的参数契约对不上 |
| `xuezai` | `rollcall status` / `rollcall history` | `README.md:129`：「严格说历史是只读，但上游把它和签到绑定；本包未实现」 | **上游没有把它们和签到绑定**。`rollcall-cli.ts:52-59` 的 `status` 是普通 `command`，描述原文「现在有没有点名、本人是否已签；**只查看，不签到**」；`rollcall.ts:165` 的 `rollcallHistory` 全程只发 GET。两条都是**纯读**，「绑定」这个前提不成立 → 应按 C→**待补**处理（漏-6） |
| `xuezai` | `course list` | `README.md:117`：「✅ 内部，未单独暴露」 | 这不是「未做」的理由，是「没暴露」的事实。D17（`impl-plan.md:52`）只说「读操作进 `source/`」，**没有授权**把读能力留在内部不暴露。能力在 `xzzd.js:249` 已有，暴露成本≈0 → 应判**待补**，不是「✅」 |
| `xuezai` | `material download` / `homework download` | `README.md:120/123`：「只给附件元数据与 `allow_download`，不下载文件」 | 理由**本身部分成立**（D21 确实把下载划给 `core`），但**注释与 README 都没引用 D21**，读起来像本仓自律。且 `packages/core/` 28 个包**一个下载实现都没有** → 「归 core」目前等于「无人承接」（漏-15） |
| `cc98` | 全部写操作 | `index.js:2`「**只读**数据包」、`:27-28`「本包没有任何会改变论坛状态的入口」、`:85`「同时它也是**只读**的证明 —— 表里没有任何写操作」、`README.md:3` 同一句 | **四处不实**：`writes.js` 实现了 8 个写动作，`index.js:466-472` 把它们展开成 16 个 `xxxPrepare/Execute` 并 `:493` 注册进 `zhiyunCc98`，`:480` 自己写着 `readOnly: false`。`:381` 的 `note` 说「没有发帖/回复/私信发送/签到/赞踩/评分等写操作」与 `:482-483` 的 `writeMethods` 直接自相矛盾 |
| `cc98` | `topic view` 的 `only` / `find` / 多帖 | `README.md:172-173`：「多帖编排属于调用方，不属于数据层」「这类编排留给调用方」 | **不是编排**：`only` 与 `find` 是 `cc98 topic view` **这条 provides 自己的参数**（上游 `viewTopic` 的 `o.only` / `o.find`，`index.js` 的 `topic view` 描述里写着「可一次看多个帖、连读多页、只看楼主或某一楼的作者、只留含某些词的楼层」）。把它们推给调用方 = 让调用方重写分页、去重、扫页上限。D17 只划分读写，不授权削减读参数 |
| `tyys` | 写操作归 tool | `index.js:6-8`：「纯只读数据源：**不注册 AI 工具**、**无写操作**。上游三个写动作归 `packages/tool/`」，`:12`「分层不只写在注释里」 | 「归 tool」按 D17 成立，但**「无写操作」不成立**：`index.js:162-163` 声明了 4 个 `writeMethods`，`:172-175` 实现为调用 `createTyysWrites`，而该函数**从未被 import**（`:36-40`）。`:12` 那句「分层不只写在注释里」尤其反讽 —— 代码里留下的是一对**必然 ReferenceError** 的方法。另 `README.md` 第 5 行「纯只读（D17），`writes: false`」与 `package.json` 的 `writes: false` 一致，但与服务面 `readOnly: false`（`:156`）矛盾 |

### 另一个方向：**代码是对的、注释是错的**（不影响判定，但会误导下一个人）

| 位置 | 注释说 | 实际 |
| --- | --- | --- |
| `zdbk/src/reads.js:9-14` | 「这里**只有读取**……连发写请求需要的 `postOnce` 语义都不在这里出现」 | `client.js:210` 有 `postOnce`，只是写方法在 `writes.js` 里用它。这句「不在这里出现」把「分层」说成了「缺能力」 |
| `cc98/README.md:220-221` | 「写操作 \| `actions.ts` \| **不移植** \| 只读数据源」 | `actions.ts` 确实没搬，但**等价写能力**（发帖/回帖/私信/赞踩/评分/编辑）在 `writes.js` 里全部实现 |

---

## 报告最后必须回答的三个问题

### 1. 最该补的三条是什么（按用户影响排序）

**第一：`tyys` 写操作接线（漏-1）。** 一行 import 就能修好两条能力（预约、取消）。
它是本批唯一「修完立刻 100% 恢复」的项，成本最小、收益最直接，且当前形态最误导
（方法存在、声明存在、调用即崩）。修完顺手把 `README.md:5`「纯只读」与
`index.js:6-8`「无写操作」改掉。

**第二：`zdbk` 选课三写操作的参数契约（漏-2）。** 选课季用户只有一次机会，而
`campus_course_select` 的三个 action **全部**在 `prepare` 阶段就失败，失败文案还指向
工具层根本拿不到的 `pool`。修法建议在 source 侧补「按课程名/教师/时间 → 教学班」的解析层
（对齐上游 `selection-task.ts` 的 `taskSections` / `ownedTarget` / `oneSection`），
而不是把 `pool`/`category` 两个新参数塞给模型。这同时补回上游的消歧能力。

**第三：`xuezai` 的两条纯读点名（漏-6）。** `rollcall status` + `rollcall history`
没有任何依赖（不需要坐标、不需要雷达、不需要 decimal.js），两个 GET 就能补，
补完立刻回答「现在有没有点名」「这学期缺了几次」—— 这两问是学生每天都会问的。
它现在缺失的**理由还是编的**（见「理由不实」第 3 条），所以优先级高于看起来更严重的漏-4：
漏-4（雷达签到）至少理由诚实（明确拒绝伪造定位），漏-6 是**用不实理由把纯读能力删了**。

> 第四名值得单列：`cc98` 四个写动作的参数名错位（漏-3）。修起来只是改名 + 补一个 `reason` 参数，
> 1 小时以内，但它影响「回复之外的整个 CC98 交互」。如果只看「修一次影响多大」，
> 它其实排在第二。

### 2. 有没有「名字对得上但行为不同」的？—— **有，11 条，其中 5 条是「名对了、功能废了」**

这是本批最危险的一类，因为它**有方法、有测试、看起来是通的**。按危险程度：

| 危险级 | 条目 | 名字对得上 | 实际行为 |
| --- | --- | --- | --- |
| 🔴 **废掉** | `tyys venue book` / `venue order cancel` | `bookVenuePrepare` / `cancelVenuePrepare` 存在且被测试断言过 | 调用即 `ReferenceError`（漏-1） |
| 🔴 **废掉** | `zdbk selection select` / `reorder` / `drop` | `selectCoursePrepare` 等 6 个方法都在服务面上 | `prepare()` 必抛 `INVALID_ARGUMENT`（漏-2） |
| ~~🔴 **废掉**~~ → ✅ **已修** | `cc98 floor edit` / `favorite` / `rate` / `pm send` | 4 对方法齐全 | 参数名错位，`prepare()` 必抛（漏-3）。**2026-11-12 已对齐**：`edit` 改收 `post`、`rate` 必传 `reason` 并说明编号从哪查、`favorite` 补 `on` 开关、`pm send` 用户名由 source 解析 |
| 🔴 **废掉** | `xuezai rollcall` | `rollcallPrepare` 存在 | 工具给不了坐标与 id，必抛（漏-4） |
| ~~🟠 **残**~~ → ✅ **已修** | `cc98 floor like` | `likeFloor` 通 | ~~不能取消~~ **2026-11-12 修**：`state` 认 `'none'` / `0` / `'cancel'`，工具层新增 `unlike` 动作 |
| ~~🟠 **残**~~ → ✅ **已修** | `cc98 board post` | `postTopic` 通 | ~~丢掉标签/匿名~~ **2026-11-12 修**：收 `tag1` / `tag2` / `anonymous` / `contentType` / `title`，必选标签的版面能发出去 |
| ~~🟠 **残**~~ → ✅ **已修** | `cc98 topic reply` | `replyTopic` 通 | ~~丢掉引用/匿名/通知全体~~ **2026-11-12 修**：收 `quote`（楼层号）/ `anonymous` / `notifyAll` / `contentType` |
| 🟠 **残** | `zdbk selection reorder` | `reorderCourse` 通 | 语义不同：上游「给完整顺序」vs 本仓「移到第 N 位」（`writes.js:216-226`） |
| 🟡 **弱** | `zdbk timetable` | `timetable()` 通 | 少六类非正式课 + 学籍 + 节次表来源 + 缓存（漏-13） |
| 🟡 **弱** | `cc98 search` | `search()` 通 | 单关键词直通，多说法/相关度/排序全丢（漏-9） |
| 🟡 **弱** | `xuezai todos` | `todos` 通 | 默认不跑作业扫描，且形状与上游不同（#1） |

> **图片上传仍未做**：上游 `post` / `reply` 支持图片，本仓没有。那是**多段上传**
> （先传图拿 id，再带 id 发帖），比补一个参数重得多，单独记作待办。

**还有一条最隐蔽的**：`cc98 messages` 名字一样、字段一样，**唯独顺序反了** ——
上游 `thread()` 有 `.reverse()` 把它变成「从早到晚」（`index.ts:353` 的
`(await ...).reverse().map(...)`），本仓 `reads.js:681-695` 直接 `map` 没有 reverse。
这类 bug 不会报错、不会缺字段，只会在「谁先说的」上骗人。

### 3. C 类里理由不实的有几条？—— **C 类 5 条：理由不实 3 条（#1/#3/#4）、半不实 1 条（#5）、部分成立 2 条（#2 及 #4 的同一处）**

| # | C 类条目 | 理由 | 判定 |
| --- | --- | --- | --- |
| 1 | `xuezai course list` | `README.md:117`「✅ 内部，未单独暴露」 | **理由不实**：把「没暴露」写成「✅ 已覆盖」。D17 不授权隐藏读能力；能力已在 `xzzd.js:249`，暴露成本≈0 |
| 2 | `xuezai course view` | `README.md:118`「没有课程模块树」 | **理由部分成立**：只解释了 modules 缺失，没解释「课程详情」这一层整个没有 |
| 3 | `xuezai rollcall status` | `README.md:129`「上游把它和签到绑定」 | **理由不实**：上游 `rollcall-cli.ts:52` 明写「只查看，不签到」，`rollcallHistory` 纯 GET。前提不成立 |
| 4 | `xuezai rollcall history` | 同上 | **理由不实**（同上） |
| 5 | `xuezai session status` | `README.md:130`「登录在 `openTransport()` 里自动发生；有 `reset()`；**没有**独立的 status/logout 动作」 | **半不实**：logout 的那件事 `reset()`（`index.js:624`）已经做了，本表判 A；**status 才是真的没有**——判据 `hasXzzdSession`（`xzzd.js:716`）就在那里，只是没挂到服务面（`index.js:740-782` 的方法表里没有它）。把「没接线」写进同一句「没有」，会让读的人以为两件都没有 |

**所以：C 类 5 条里，理由不实 3 条（#1 `course list`、#3 `rollcall status`、#4 `rollcall history`——
后两条是同一句理由，按能力条数计 2）、半不实 1 条（#5 `session status`）、部分成立 1 条（#2 `course view`）。
另有 2 条**理由本身成立但没引用任何裁决**：`material download` / `homework download`（属 D 类，记在此便于查）。**

**但真正严重的不是 C 类的 3 条，而是 D 类的 3 组「假 D」**：
`zdbk` 写操作、`cc98` 写操作、`tyys` 写操作全部标成「归 tool」，
而 tool 那边**要么参数对不上（zdbk/cc98/xuezai），要么根本没接线（tyys）**。
按判定口径它们算 D（裁决真实存在），但**「归他处」被当成了「已处理」**——
这是本批最容易让覆盖率骗人的地方。

---

## 附：本批实测复现清单（供复核）

| # | 命令要点 | 结果 |
| --- | --- | --- |
| 1 | 挂载 `tyys/src/index.js` → `service.bookVenuePrepare({venue,date,start,end})` | `ReferenceError: undefined createTyysWrites is not defined` |
| 2 | `createZdbkWrites(fakeReader).selectCourse.prepare({course,section})` | `INVALID_ARGUMENT 需要 pool（课程号…）` |
| 3 | 同上 `dropCourse.prepare({course})` | `INVALID_ARGUMENT 需要 section（教学班号…）` |
| 4 | 同上 `reorderCourse.prepare({course,order})` | `INVALID_ARGUMENT 需要 section（教学班号）` |
| 5 | `createCc98Writes(fake).editPost.prepare({topic,content})` | `INVALID_ARGUMENT 楼层编号 必须是正整数` |
| 6 | 同上 `favoriteTopic.prepare({post})` | `INVALID_ARGUMENT 帖子编号 必须是正整数` |
| 7 | 同上 `rateFloor.prepare({post,value})` | `INVALID_ARGUMENT 评分需要 reason（理由编号）` |
| 8 | 同上 `sendMessage.prepare({recipient:'somebody',content})` | `INVALID_ARGUMENT 收信人编号 必须是正整数` |
| 9 | `createXuezaiWrites(fake).rollcall.prepare({course,code})` | `INVALID_ARGUMENT 需要 homework（作业编号…）` |
| 10 | 同上 `submitHomework.prepare({course,homework:'5',content:'我的答案'})` | `INVALID_ARGUMENT 交作业至少要有一个文件或一段正文，不能交空`（`content` 被丢弃） |
| 11 | `packages/core/` 全目录 grep `download` | 零命中 —— D21 的承接方不存在 |

> 以上全部为离线复现（假 reader / 假 client / 假 ctx），未联网、未读写凭据、未改任何文件。
> 除本报告外，本次审计**未修改仓库中的任何文件**。
