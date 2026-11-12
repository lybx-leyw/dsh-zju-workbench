# 上游 vs 本仓 逐模块能力审计（2026-11-12）

> **这一份是什么**：六个审计代理对「上游 `packages/vendor/zju-assistant/`」与「本仓
> `packages/source/` 等」做了逐方法比对，每条判断都带 `文件:行号`。这里是汇总，
> 原始三张表在各自的对话轮次里，结论已经落在下面。
>
> **证据强度**：静态读码为主；标了「实测」的是用真实模块 + 替身客户端跑出来的。
> 真实账号 / 真机行为**未验证** —— 与 `abandoned.md:152` 的口径一致。
>
> **口径**：分母 = 上游 `module.json` 的 `provides` 条数（共 162 条，17 个模块）。
> 折算：已实现 = 1、部分实现 = 0.5、完全缺失 / 明确不做 = 0。
>
> ⚠️ **2026-11-12 更正**：下表最后一行曾把 `doc` / `profile` / `core` / `plugin-host`
> 合记为 **67 条**，但 **`profile` / `core` / `plugin-host` 在上游没有 `module.json`** ——
> 那 67 是审计员按 `plugin/host/*.mjs` 与 `profile.ts` 手工清点的。
> 真实对账：15 个数据源 137 + `cnki` 5 + `zhiyun` 16 + `doc` 4 = **162**（与声明总数一致）。
> 「`profile`/`plugin-host` 有 40 条缺失」这个结论**方向正确、数字无出处**，需要重新清点后才能引用。

---

## 一、覆盖率总表

| 模块 | 上游 provides | 已实现 | 部分 | 缺失 | **覆盖率** | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| `yjsy` | 1 | 1 | 0 | 0 | **100%** | token 两跳齐全，多做自动重换 |
| `ebook` | 1 | 1 | 0 | 0 | **100%** | 三个增量：实体解码 / 超时 / 漂移检测 |
| `webvpn` | 8 | **8** | 0 | 0 | **100%** | 2026-11-12 补 `probeHost` + `checkReachable` 的服务面版本 |
| `tyys` | 9 | 6 | 3 | 0 | 83% / **72%** | 可用性口径：预约链断 |
| `sztz` | 8 | 6 | 1 | 1 | 81% / **75%** | 报名取消**实测抛 TypeError** |
| `zdbk` | 18 | 10 | 7 | 1 | **75%** | 无 provides 完全缺失；工具层 2 处断 |
| `classroom` | 16 | 9 | 6 | 1 | 75% / **48%** 宽 | 下载/媒体整条链无对应物 |
| `lab` | 9 | 4 | 5 | 0 | **72%** | `labs` 的 7 项计算只做了 1 项 |
| `cc98` | 32 | 14 → **18** | 18 → **14** | 0 | **72% → 79%** | 18 项半成品 → 4 项已修；图片上传仍缺 |
| `notice` | 4 | 1 | 3 | 0 | **62.5%** | `known` 作用域未实现；装配缺口 |
| `xxt` | 10 | 2 | 8 | 0 | **60%** | 缺三个作业源中的两个 |
| `pta` | 14 | 4 | 7 | 3 | 54% / **46%** | `buildDetail` 字段名几乎全错 |
| `chalaoshi` | 3 | 0 | 3 | 0 | **50%** | `teacher` 只回原始 HTML |
| `zjuam` | 3 | 1 | 1 | 1 | **50%** | 缺「这张票还有效吗」 |
| `xuezai` | 18 | 5 | 8 | 4 | 47–56% | 签到链最薄 + 工具层 2 处断 |
| **`doc` / `profile` / `core` / `plugin-host`** | **67**（⚠️ 其中仅 `doc` 的 4 条有 `module.json`；其余 63 条为手工清点，见上） | **4** | 18 | **40** | **6%** | **整块空白** |
| `cnki` | 5 | — | — | — | **已废除** | 用户明确不做，见 `coverage-gaps.md` 第十二 |

**数据源层算术平均约 70%；基础设施层约 6%。**

---

## 二、三类「代码在、接不上」（最该修）

六组审计**独立地**反复发现同一批形态。这些不是"没写代码"，是"写了但接不上"。

### 2.1 工具层参数与 source 契约不符 —— 五个动作一调就崩

> **2026-11-12 更正一处定性**：我曾把这批记成「D17 把写操作划给 `tool/`，所以 source 侧不算缺」。
> **这个理解是错的。写操作本质就是函数** —— `source` 要提供**完整的基础函数**（参数全收），
> `tool` 只是**现成的封装**：把用户话术翻成参数、校验、审批、暴露给模型。
> 所以「参数名错位」不是分工问题，是**接线错误**；「source 少收字段」不是归他处，是**基础函数不完整**。
>
> cc98 那四条（参数名）与三条（丢标签/匿名/取消赞踩）已按这个口径修掉。

**⚠️ 2026-11-12 重构后，下表的位置全部变了**：`tool/campus-write` 已按域拆成
`tool/{zdbk,sztz,tyys,xuezai,pta,cc98,lab}`，审批与注册器在 `tool/write-kit`。
下表的行号是**当时**的取证记录，保留不改（那是当时的证据）；现状见本节末尾。

| # | 动作 | 工具传什么 | source 要什么 | 证据（当时） |
| --- | --- | --- | --- | --- |
| T-1 | `zdbk drop` | `{course}` | `{course, section}` | `tool/campus-write/src/tools.js:155` vs `source/zdbk/src/writes.js:230-231` |
| T-2 | `zdbk reorder` | `{course, order}` | `{course, section, order}` | `tools.js:158` vs `writes.js:246-248` |
| T-3 | `xuezai submit` | `{course, homework: 作业名, content}` | 数字 id | `tools.js:242` vs `writes.js:201-211`（`resolveActivity` 只认数字） |
| T-4 | `xuezai retract` | 同上 | 同上 | `tools.js:246` |
| T-5 | `sztz signup` / `cancel` | — | `myActivities()` 返回**对象**却被当数组用 | `source/sztz/src/writes.js:119,138` vs `sztz.js:545-553`；**实测 `mine.some is not a function`** |

### T-1 ~ T-5 的处理结果（2026-11-12）

**T-1 / T-2 已修**，修的方式是**给 source 补基础函数**而不是让工具层去查 id：
`zdbk/src/writes.js` 新增 `findChoice()`，`drop` / `reorder` 现在既认 `section`
也认 `course`（按课程名解析，同名多志愿**拒绝并列候选**，不猜）。

**T-3 / T-4 已修**：`xuezai/src/writes.js` 的 `resolveActivity` 现在收 id、名称
或活动对象。名字匹配必须唯一，重名时抛出候选清单让调用方指定 —— 替用户挑一个
等于交了另一份作业。

**T-5 已修**（更早）：`myActivities()` 的对象形状已在 source 侧归一。

验证手段：`node scripts/probe-write-contract.mjs`（跨层探针，**不联网**）。
重构前 22 条里 8 条不通，现在 **28 条全通**。

### 2.2 注入口有定义、无装配方 —— 功能恒为「未配置」

| # | 包 | 注入点 | 调用方 | 后果 |
| --- | --- | --- | --- | --- |
| A-1 | `lab` | `setCredentialProvider` / `setSession` | 0 | `ready()` 恒 false |
| A-2 | `sztz` | `setSessionProvider` / `setSeenStore` | 0 | 「已读」永不生效 |
| A-3 | `tyys` | `setLoginProvider` / `setAccountProvider` | 0 | 预约/考勤不可用 |
| A-4 | `notice` | `setProfile` / `setSeenStore` | 0 | **「本人学院」恒 null；增量去重永不生效** |
| A-5 | `xxt` | `downloadParams` 的消费者 | 0 | 参数有、执行无 |

> **注**：2026-11-11 那轮已修 `lab`/`sztz`/`tyys`/`notice` 的「自己读凭据」兜底
> （见 `coverage-gaps.md` 零之二的 A-4 修复），但 **`notice` 的
> `setProfile`/`setSeenStore` 仍未接通** —— 它们不是凭据，是「学籍」与「已读存储」。

### 2.3 计算层无承接方 —— source 只给事实，没人算成可读结论

| 位置 | 缺什么 | 后果 |
| --- | --- | --- |
| `lab` 的 `labs` | 上游 `labsOverview` 的 7 项计算，本仓只有 `openWeek` 1 项 | 用户看到「有这些实验」，但不知道哪些能选、为什么不能选 |
| `classroom` 下载 | `acquire` + `hls` + `media` 三件套全无 | 只能单 URL 续传，无 manifest 编排、无 HLS、无 FFmpeg |
| `notice` 相关度 | 上游 `notice-filter` 按学籍判相关度 | 缺学籍（见 §3 profile），无从实现 |

> **结构性判断**（来自 xxt/notice/lab 那组）：**上游把「计算」放在 `cli.ts` 视图层；
> 本仓是纯数据包，计算整体无承接方。** 上游 `cli.ts` 承担了这个角色，本仓没有等价物。

---

## 三、整块空白

### 3.1 `doc`（4 条 provides，整块没有）

| 上游能力 | 本仓 |
| --- | --- |
| `doc text` PDF 取文字 | **部分**：`core/classroom-media/src/pdf/parse.js:466`，但 `mergePages:true`（`:165`）**丢掉了页边界** |
| Word / Excel / PPT 取文字 | **完全缺失**：`libreoffice-kit` 在 `node_modules` 里不存在 |
| `doc pdf` 合成 PDF | **完全缺失**：`pdf-lib` 全仓 **0 命中** |
| `doc pages` 取指定页 | **完全缺失**：`parsePageRule` / `extractPages` 0 命中 |
| `doc find` 关键词找页 | **完全缺失**：`findInPdf` 0 命中 |
| 格式嗅探（`sniff.ts`） | **完全缺失**：只有 `core/vault/src/notes-host.js:549` 一条 `%PDF-` |
| GB18030 兜底 | **完全缺失**：全仓 grep `gb18030` 0 命中 |
| 链接下载后提取 | **完全缺失**：无 `content-disposition` 处理 |

> **关键**：不是「少实现两个命令」，而是**数据模型不支持** —— `mergePages:true`
> 结构性地放弃了「第 N 页」这个单位，而 `doc pages` / `doc find` 全建立在它上面。
>
> 归属问题登记为 **Q-1（`abandoned.md:247`「仍未裁决」）**。**裁决未下 ≠ 明确不做**。

### 3.2 D21 下载 —— 裁决说「归 core」，core 里没人接

实测（2026-11-12）：`packages/core/` 里 `downloadParams` / `saveFiles` /
`downloadTo` / `createWriteStream` / `If-Range` **全部 0 命中**。
（`resume` 有 15 个文件命中，但那是 LLM 断流续传，不是文件下载。）

| 上游 | 本仓 |
| --- | --- |
| `Downloads` 类（向 Shell 问真实下载目录） | ❌ 0 命中 |
| `Documents` 类 | ❌ 0 命中 |
| `reveal()`（打开所在文件夹） | ❌ 0 命中 |
| 下载进度总线 | ❌ 只有 `source/classroom/download.js:52` 的包内回调 |
| **断点续传** | ⚠️ **只在 `source/classroom/src/download.js`**（`.part` + `If-Range` + `link()` 原子发布 + 六种错误码）—— **恰好是 D21 明令不该在的地方**，且只有 1 个 importer、无 tool 消费 |
| 四个页面的下载入口 | ❌ 0 |
| ffmpeg / TeX / gsap / ASR 模型按需下载 | ❌ 0 |

### 3.3 `profile`（学籍档案）

| 上游 | 本仓 |
| --- | --- |
| 学籍 5 键（`grade`/`major_code`/`major_name`/`college`/`student_level`） | **完全缺失**：`identity.json` 全仓 0 命中 |
| `readProfileAll()` 合并视图 | **完全缺失** |
| `transport` 偏好（`webvpn` / `direct` 二选一） | **完全缺失**：`source/http/src/host.js:79` **硬编码 `mode:'auto'`** |
| CC98 多账号（`cc98_username_2`） | **完全缺失**：0 命中 |
| 学籍自动填充（`identity-fill`） | **完全缺失**；连带 `zdbk student` 命令也没有 |
| 档案 Shelf（Obsidian 式 md） | **完全缺失** |

> **连带后果**：`notice` 的通知相关度筛「照个人档案的基础信息（培养层次、学院、专业、
> 年级、校区）」—— 本仓的通知包在，筛选逻辑不在。

### 3.4 skill 机制 —— 确认**不对应**

| 上游 | 本仓 |
| --- | --- |
| `ctx.skills.registerProvider()` | **0 处** |
| 根 `SKILL.md` + 9 rows + 3 references | **无**（`docs/contributing/skills/` 下没有校园技能，D12） |
| `core/skills/` 5 个任务 skill（30 文件） | **无**，`packages/skill/` 不存在 |
| `source/{weread,wechat-chat,dingtalk-chat}/SKILL.md` | ✅ 3 个静态文件，但**无注册通道** |

> ⚠️ **`classroom-studio/src/services/agent-runtime.js` 那套 `dataDir/skills/<id>/SKILL.md`
> 与上游 `zju-campus` 技能语义无关** —— 它是智云课堂 agent 的文件目录，不是 skill 机制。

---

## 四、具体的真 bug（实测/代码级）

| # | 位置 | 问题 | 严重度 |
| --- | --- | --- | --- |
| B-1 | `source/sztz/src/writes.js:119,138` | `myActivities()` 返回对象，代码当数组用 → **报名/取消 100% TypeError** | 致命 |
| B-2 | `source/pta/src/writes.js:43` | 聚类题型写了平台不存在的 `MULTIPLE_SELECTION`，漏了多选/程序填空/选择填空 | 致命（交作业被拒） |
| B-3 | `source/pta/src/writes.js:384-398` | `buildDetail` 字段名几乎全错（`code/language` vs `program/compiler`，`content` vs `answer`，缺 `problemId:"0"`） | 致命 |
| B-4 | `source/tyys/src/writes.js:101,110` | `client.day(site, date)` 传字符串，`site.id` → undefined → URL 缺 `venueSiteId` | 高 |
| B-5 | `source/tyys/src/writes.js:213` | 取消预约传 `{orderId}`，上游是 `{venueTradeNo: order.number}` | 高 |
| B-6 | `source/tyys` 验证码 | 取题端点、字段、打包方式全不同：上游 `GET /api/captcha/get` + **AES-128-ECB** + `secretKey`，本仓 `POST /api/reservation/captcha/check` + 无打包；且**该 POST 会被自己的 `READ_POSTS` 白名单拒** | 高（需验证码的场地走不通） |
| B-7 | `source/cc98/src/reads.js:841` | `fs.writeFile(...)` 真的落盘。~~与 D21「source 不碰文件系统」矛盾~~ → **2026-11-12 更正：该限定是 agent 擅自加的，用户从未裁决 source 不许落盘，本条不是 bug**。真正值得记的是它用了 `flag:'wx'`（同名即失败），而不是 `D21` 说的「参数交给 core」 | ~~架构~~ → **撤销** |
| B-8 | **两套 CAS 密码编码并存** | `login/src/cas.js:173-189` 用「整串反转 + UTF-16 + 小端分块」，`classroom/src/auth.js:19` 用 `Buffer.from(utf8)` 当大整数。**同一次 CAS 两套密文，至少一方错**；`cas.js:136-157` 断言上游会解出乱码，但**无任何对拍测试或实机证据** | **未知但可能致命** |
| B-9 | `source/notice/src/notice.js:2332` | 硬编码 `scope:'default'`，上游按标题去重用 `"known"`（= `default ∪ feed`）→ **只在 feed 栏目的通知按标题永远检不到** | 中 |
| B-10 | `source/xuezai/src/writes.js:345` | 撤回不校验 `can_retract` / `allow_retract` | 中 |

### B-8 需要单独说

这是唯一一条**可能已经坏了但没人知道**的问题：

- `login` 的 `casTransport` 现在是**共享会话入口**，`zdbk` / `xuezai` / `sztz` / `tyys` / `notice` 全走它
- 如果那套编码是错的，**这五个数据源的 CAS 登录全部失败**
- 而 `classroom` 用自己的实现，**可能仍然正常**
- 这正好能解释「智云课堂可用、教务登不上」的现象

**建议**：优先实机验证一次 `casLogin` 能否拿到 `iPlanetDirectoryPro`；或直接对齐成
`classroom/auth.js` 那套（它与上游一致，且 classroom 确实能登录）。

---

## 五、三源共同缺失：无事务机制

上游三源各有完整的写事务：

| 上游 | 机制 |
| --- | --- |
| `pta/write.ts:25-130` | `Pending` → 落盘 JSON → `.lock` → `digest` 幂等 → `verifyEventually` 4 次重试 → 五态日志 |
| `sztz/index.ts:299-319` | `commit()`：submit / rejected / reconcile 三段 + 本人列表回查 |
| `tyys/booking.ts:136-171` | `VenueJournal` 的 begin/resolve/pending + `recover()` |

**本仓三源 `src/` 连 `node:fs` 都没 import**（grep 零命中）。

**后果**：网络抖动时「实际成功却报失败」→ 用户重试 → **重复提交**。
对选课、报名、交作业这三类操作，这是真实风险。

---

## 六、文档与实现不一致（4 处）

| 位置 | 文档说 | 实际 |
| --- | --- | --- |
| `cc98/README.md:130-134` | 「本包没有任何写操作」 | `writes.js` 有 8 个写动作 |
| `cc98/README.md:177-179` | 「不移植」多帖/只看楼主等 | **无编号裁决**，应记待补（W-20/21/22/23/25） |
| `chalaoshi/README.md:85-86` | 「课程绩点表尚未解析」 | `course` 已解析 |
| `pta/README.md:107-110` | 「写操作在 `tool/campus-write`（未实现）」 | `tools.js:251-263` 已接 `saveAnswer`/`submitAnswer` |
| `source/ebook/README.md` | 被 `package.json` 的 `files` 声明 | **文件不存在** |

### 已被订正的旧结论

- `audit-chalaoshi.md:30` 记的 M1「`hot` 加成被改坏为 `min(3, hot/10)`」**在现码中已不存在**，`chalaoshi.js:212-213` 与上游等价。
- `notice/README.md:225` 引 **D17** 论证不写 `identity.json`，但 `zju-assistant-source-tool-split.md:102` 明写「落盘不算写操作」→ 依据不成立，应改记待补。
- `xxt` 密码登录「不做」**无编号裁决** → 应记待补（N-1 只覆盖 PTA 自动登录）。

---

## 七、本仓明显强于上游的地方（不能只列落后）

| 模块 | 本仓增量 |
| --- | --- |
| `ebook` | 完整实体解码（命名+十进制+十六进制，`&amp;` 用哨兵防双解）、自建超时、`drift` 结构漂移检测 |
| `xuezai` | `todos` 三档（fast / slow / diff 对账）、提交状态四态、分页参数、`allow_download` 否决权合并、旧会话迁移 |
| `zdbk` | `gpaSummary` 三份 GPA、4.3 制、多条件搜索、`inferred_term` / `skipped_items` 显式化、会话与账号绑定 |
| `classroom` | 课件磁盘缓存（LRU 2GB）、直播流本机转发、`searchCaptions` 的 `courseId+days` 展开、双登录入口、`acquireSso` 借票 |
| `webvpn` | 主机归属**三态表**（public/campus/unknown）、7 类网关失败码、`doctor()` 四项分离诊断 |
| `cc98` | （写动作 8 条全在，只是缺参数） |
| **全仓** | **28 个 `core/` 包**：课堂录制转写、讲解生成、题库、知识图谱、笔记库、播放器、渲染器 —— **上游几乎没有** |

**一句话**：**上游赢在「能用」，本仓赢在「能加工」。**

---

## 八、修复优先级

| 顺序 | 内容 | 成本 | 收益 |
| --- | --- | --- | --- |
| **1** | 修 T-1 ~ T-5 五个工具契约断裂 | 几十行 | 5 个动作从「必崩」到「能用」 |
| **2** | 验证 / 对齐 B-8 的 CAS 密码编码 | 小 | 消除「教务登不上」隐患 |
| **3** | 接通 A-4 的 `notice` 装配（`setProfile` / `setSeenStore`） | 每处几行 | 「本人学院」与增量去重真正生效 |
| **4** | 修 B-1 ~ B-5 的写动作参数/字段 | 中 | 报名、交作业、预约从「被拒」到「成功」 |
| **5** | 加统一工具入口（像上游 `zju`） | 中 | **让 70% 的只读能力真正可达** |
| **6** | 补 journal / 幂等 | 大 | 消除写操作重复提交风险 |
| **7** | 补 `doc` / profile / 下载执行器 | 很大 | 需先定归属（Q-1 未裁决） |

**前四项加起来可能不到一天，能把这些"看起来能用"变成"真的能用"。**

### 已关闭的一项

`webvpn` 的 `probe` / `check --host` 已于 2026-11-12 补齐（`src/probe.js`、`src/reach.js`），
该模块覆盖率 93.75% → **100%**。它是 17 个模块里**唯一达到 100% 的**。

`cc98` 的四个写动作参数错位、赞踩取消语义、发帖/回帖的标签与匿名也已修
（`source/cc98/src/writes.js` + `tool/campus-write/src/tools.js`），72% → **79%**。
剩余缺口是**图片上传**（多段上传，比补参数重）与若干读侧增强。

---

## 九、未验证 / 读不到

1. **上游代码未运行**：`packages/vendor/zju-assistant/` 未进 workspaces，所有上游判断来自静态阅读。
2. **真实账号未验证**：本报告全部结论是「静态读码 + 替身实测」强度，不是真机验收。
3. **B-8 的 RSA 算法谁对**：无真实 CAS 响应样本，`tests/` 里也无对拍断言。
4. **`classroom/stream.js` 的 `sub_content` 假设**：`README.md:127-129` 自认「推的、没实测过」。
5. **校外真实网络下的 webvpn 行为**：`webvpn-coverage.md:153-161` 的 R-1 写明「真实校外网络从未验证」。
