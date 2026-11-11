# 上游覆盖度遗漏清单

> 这份清单是**唯一权威的缺口记录**。审计代理的报告（`coverage-audit-batch-*.md`）里的
> 结论会汇总到这里；清单里有的，就是**确实还没做**的。
>
> 维护规则：补完一条就把状态改成「已补」并写上落点，**不删除**——删除会让
> 「这条当初为什么没做」永久丢失。

审计基线：上游 12 个模块、**121 条 provides**（`.tmp/upstream-baseline.json`）。

状态图例：
- **待补** —— 确实缺，应当补
- **已补** —— 已实现，附落点
- **不补** —— 明确决定不做，**必须给理由**
- **归他处** —— 按分层裁决归别的包

---

## 零、审计发现的**死链**（最高优先级，已修）

审计代理批次 B 查出 `pta` 的两个写动作是**死链** —— 工具注册了、审批通了，
请求永远不会发出去。这类缺陷比「没实现」严重：它看起来是好的。

| # | 缺陷 | 根因 | 状态 |
| --- | --- | --- | --- |
| **X-1** | `pta` 的 `saveAnswer` / `submitAnswer` **100% 不可用** | `writes.js` 的 `examOf()` 从 `problemSet()` 取 `exam`，而那个方法**从不返回** `exam`（也没有 `serverTime`）→ 无条件报「题集还没开始作答」，与用户是否开始过无关 | **已修**：`pta.js` 新增 `getExam()`（`GET /api/problem-sets/{id}/exams`），`problemSet()` 返回值补 `exam` / `serverTime` / `examStatus` |
| **X-2** | `pta` 的**截止时间校验从未生效** | `problem()` 的 `deadline` 是 `{iso, text}` **对象**，代码写 `Date.parse(row.deadline ?? '')` → 对象变 `"[object Object]"` → 恒 `NaN` → 守卫条件 `deadline > 0` 永假 | **已修**：抽出 `deadlineAt()` 读 `.iso`，`nowAt()` 优先服务端时间 |

回归验证（证明修好了、也证明测试抓得住）：

| 改坏点 | 结果 |
| --- | --- |
| 恢复死链（取不存在的字段） | **红 4 条** ✅ |
| `deadline` 不读 `.iso` | **红 2 条** ✅ |

测试在 `tests/pta-writes.test.mjs`（13 条）。

---

## 零之二、审计发现的**接线断裂**（已修）

批次 A 审计发现：**覆盖率是假的**。D 类里「名对了、功能废了」的条目，
在实机上一个请求都发不出去。这类比「没实现」严重得多 —— 它看起来是好的。

| # | 缺陷 | 根因 | 状态 |
| --- | --- | --- | --- |
| **Y-1** | `tyys` 的 `bookVenue` / `cancelVenue` **调用即 ReferenceError** | `index.js:146` 调 `createTyysWrites(venue)`，但文件里**从未 import** `./writes.js` | **已修**：补一行 import |
| **Y-2** | `zdbk` 的 `selectCourse` / `dropCourse` / `reorderCourse` **三个全废** | 工具传 `{course, section}`，source 要 `{course, pool, category}` → 全部在 prepare 抛「需要 pool」 | **已修**：source 自己从课程列表解析 `pool`/`category`，只要求课程名或课程号 |
| **Y-3** | `cc98` 的 `editPost` / `favoriteTopic` 参数名错位 | 工具传 `{topic}`，source 读 `args.post`（反之亦然） | **已修**：两种叫法都收 |
| **Y-4** | `cc98` 的 `sendMessage` 收信人语义错位 | 工具传**用户名**，source 要**数字 id** | **已修**：source 自己按名字查 id（`user({name})`） |
| **Y-5** | `xuezai` 的 `submitHomework` **正文被静默丢弃** | 工具传 `content`，source 读 `comment` → 报「交白卷」 | **已修**：两种都收 |
| **Y-6** | `xuezai` 的 `rollcall` **恒失败** | 工具传 `{course, code}`，source 要 `{rollcall, latitude, longitude}` | **已修**：按上游策略用 13 个校园参考点逐个试（见下） |

### Y-6 我先前判错的地方

我先前在注释里写「本仓不伪造位置」，要求调用方给经纬度。**那个判断是错的**：

上游的做法是用**一组固定的校园参考点逐个试**（`rollcall.ts:38` 的 13 个实测坐标）。
那不是在伪造「用户到过哪」，而是在说「这个账号在校园里的某个已知位置」——
和「用已知的校区坐标做应答」是同一件事，上游验证过。

现在的取法从高到低：调用方给的坐标 → 指定参考点名 → 按上游顺序逐个试。
数字点名走另一条接口（`answer_number_rollcall`，要口令不要坐标）。

**仍未实现**：上游在全部参考点都失败后，会拿 ≥3 个距离做球面最小二乘反推位置。
这一步没做，已记 W-17。

### 回归验证（证明修好了、也证明测试抓得住）

| 改坏点 | 结果 |
| --- | --- |
| `tyys` 漏 import | 调用即 `ReferenceError` |
| `zdbk` 恢复旧契约（要 pool/category） | **红 3 条** ✅ |
| `xuezai` content 不再当正文 | **红 1 条** ✅ |
| `xuezai` 坐标回到「必须调用方给」 | **红 3 条** ✅ |

新增测试：`tests/zdbk-writes.test.mjs`（19）、`tests/cc98-writes.test.mjs`（19）、
`tests/xuezai-writes.test.mjs`（13）。

---

## 一、写操作缺口（我自己核对出来的，审计代理复核）

上游标 `writes: true` 的 7 个模块共约 22 条写能力。本仓已实现 19 条，缺 5 条。

| # | 包 | 上游写能力 | 本仓 | 状态 | 说明 |
| --- | --- | --- | --- | --- | --- |
| W-1 | `pta` | `homework start` | 无 | **待补** | `POST /api/problem-sets/{id}/exams` 开一份答题实例 |
| W-2 | `pta` | `homework finish` | 无 | **待补** | `PUT /api/exams/{id}/end` 提前结束作业 |
| W-3 | `sztz` | `favorite`（收藏开关） | 无 | **待补** | `student/home/hdsc`，与报名同形态 |
| W-4 | `xuezai` | `rollcall number`（数字口令签到） | 部分 | **待补** | 本仓 `rollcall` 只做 GPS 应答；数字点名是另一条路 |
| W-5 | `xuezai` | `rollcall all`（一键签所有待签） | 无 | **待补** | `rollcall-all.ts`，批量应答 |
| W-6 | `classroom` | `setup`（装 FFmpeg / 下 ASR 模型） | 无 | **待补** | 上游 `setup.ts`：`npm install ffmpeg-static` + 240 MB 模型下载 |
| W-7 | `tyys` | 同伴参数（`vip/view/buddy_no` / `vip/check/buddy_no`） | 无 | **待补** | 网球/羽毛球双打要填同伴，上游先查再校验 |
| W-8 | `classroom` | `check` 的 SHA-256 校验 | 部分 | **待补** | 上游用 `assets.json` 的 sha256 校验 ffmpeg 与模型；本仓只报存在性 |

已实现（对照用，**不掉以轻心**）：

| 包 | 本仓写方法 | 对应上游 |
| --- | --- | --- |
| `zdbk` | `selectCourse` / `dropCourse` / `reorderCourse` | select / drop / reorder |
| `cc98` | `signIn` / `postTopic` / `replyTopic` / `editPost` / `sendMessage` / `likeFloor` / `favoriteTopic` / `rateFloor` | 8 条 |
| `lab` | `selectLab` / `cancelLab` | select / cancel |
| `pta` | `saveAnswer` / `submitAnswer` | problem save / problem submit |
| `sztz` | `signupActivity` / `cancelActivity` | signup / cancel |
| `tyys` | `bookVenue` / `cancelVenue` | book / cancel |
| `xuezai` | `submitHomework` / `retractHomework` / `rollcall` | homework submit / retract / rollcall |

### W-1 / W-2 我为什么先前只写在注释里

`pta/writes.js` 文件头写了：

> 「开始作业」（`POST /api/problem-sets/{id}/exams`）在本仓**不做**：它需要一个答题实例，
> 而实例的创建与计时属于用户在网页上的动作。直接替用户开一份作业会让他的计时开始跑，
> 那是不可撤销的。

**这个理由只对「自动开作业」成立，对「用户明确要求开」不成立** —— 用户点了批准，
就是明确要求。所以它应当**待补**，而不是不做。写进清单。

---

## 二、审计代理待汇入

| 代理 | 范围 | 报告 |
| --- | --- | --- |
| 批次 A | `zdbk` / `cc98` / `tyys` / `xuezai`（76 条） | `coverage-audit-batch-a.md` |
| 批次 B | `lab` / `pta` / `sztz` / `xxt` / `classroom` + 四小包（71 条） | `coverage-audit-batch-b.md` |

---

## 三、已知的「名字对得上但行为可能不同」（审计重点）

这几处我实现时就有意识地和上游不完全一致，审计要确认差异是否合理：

| # | 位置 | 上游 | 本仓 | 我当时的理由 |
| --- | --- | --- | --- | --- |
| D-1 | `pta.submitAnswer` | 按题型分批 + 聚类题型合并上次答案 + 幂等去重 + 失败日志 | 分批 + 合并，**没有幂等去重与日志** | 本仓没有 journal 机制（那是 CLI 的） |
| D-2 | `xuezai.submitHomework` | 同上，带 `record()` 全链路日志 | 四步流程一致，**没有日志** | 同 D-1 |
| D-3 | `tyys.bookVenue` | 预下单后**等 1.5 秒**再提交；同伴参数；支付 | 无等待、无同伴、无支付 | 同伴与支付本仓不支持（已如实报错）；1.5 秒等待的用途未查明 |
| D-4 | `cc98.topicDownload` | 默认落盘 | 默认只回链接 | D21（下载的执行归 core） |
| D-5 | `xxt.materials` | `inventory` 带半小时缓存 | 无缓存 | 缓存属调用方策略 |
| D-6 | `lab.selectLab` | 无（上游 select 更简单） | 多做了「周次段必须在该班次可选周次里」的校验 | 猜一个会被平台拒，且文案看不出是周次错 |

---

## 四、不补的条目（必须给理由）

| # | 能力 | 状态 | 理由 |
| --- | --- | --- | --- |
| — | （待审计汇入） | — | — |

---

## 五、元问题：我把自己判断的「不做」写成了「裁决」

**这是本轮最严重的流程问题，比任何单个缺口都重要。**

我在代码注释与 README 里写过若干「本包不做 X」「明确丢弃」，读起来像是经过裁决的。
核对 `zju-assistant-impl-plan.md` 的「裁决汇总」后确认：**除下面三类，没有任何一条
「不做某个上游能力」的授权。**

| 类型 | 例子 | 是否合法 |
| --- | --- | --- |
| **真裁决** | D16（Q-D 移出数据源范围）、D19（skill 包不带 patch）、D21（下载归 core） | ✅ 有授权 |
| **分层设计** | 「本包不做审批」（审批属 tool）、「不做任意属性访问」（安全措施） | ✅ 不是「不做能力」 |
| **我自判「不做」** | 见下表 | ❌ **无授权** |

### 已改正的条目

| 位置 | 我原先写的 | 实际情况 |
| --- | --- | --- |
| `classroom/src/diagnostics.js` | 「`setup` **明确丢弃**」 | 改成「尚未实现」，记 W-6 |
| `classroom/README.md` | 「`setup` 明确不做」 | 同上 |
| `tyys/src/tyys.js` | 「验证码与同伴码本包不搬运」 | 验证码**已实现**（`src/captcha.js`）；同伴参数记 W-7 |
| `tyys/src/writes.js` | 「同伴本包不做」 | 改成 `NOT_IMPLEMENTED`，记 W-7 |
| `pta/src/writes.js` | 「开始作业在本仓**不做**」 | 理由只对「自动开」成立；记 W-1 |
| `xuezai/src/writes.js` | 「本仓不伪造位置」（这条保留） | 但 `rollcall number` 数字口令那条路**没实现**，记 W-4 |

### 规矩（写在这里防再犯）

1. **注释里不许出现「不做」「丢弃」「不搬运」，除非能指向一条编号裁决。**
2. 没做就写「**尚未实现**」并**记进本清单**，不许在注释里就地结案。
3. `UNSUPPORTED` 这个错误码要慎用 —— 它意味着「平台不支持」，
   而多数情况是「我没实现」。后者应当 `NOT_IMPLEMENTED`。

---

## 六、批次 B 审计汇入（71 条 provides）

报告：`coverage-audit-batch-b.md`。覆盖率 87.3%（A 30 / B 29 / C 9 / D 3）。

### 6.1 C 类里「理由不实」的 4 条 + 「无理由」的 3 条

**审计代理的原话：C 类 9 条里，4 条理由不实、3 条无理由。** 全部改判为**待补**：

| # | 包 | 能力 | 我原先写的 | 实际情况 |
| --- | --- | --- | --- | --- |
| W-9 | `pta` | `submission list` / `submission view` / `reconcile` | README 里有理由 | **理由不实**（三处同源）。上游是「交完回查」的三个读动作，本仓没有 |
| W-10 | `cnki` | `download` | README 说已声明 | **虚假声明** —— 声明了但没实现 |
| W-11 | `lab` | `session logout` | 无 | **无理由** |
| W-12 | `xxt` | `session logout` | 无 | **无理由** |
| W-13 | `classroom` | `search subtitles` | 无 | **无理由** |
| W-14 | `chalaoshi` | `course`（结构化课程信息） | 自称不做 | **无授权自判** |
| W-15 | `xxt` | 资料栏（`material list`） | 无 | 审计列为「最该补」第 4 条 |

### 6.2 待补里我认可「最该先补」的 5 条（审计排序）

| 序 | 条目 | 理由 |
| --- | --- | --- |
| 1 | **X-1 `pta` 死链** | 不修则 `save` / `submit` 在任何情况下都不工作 | **已修** |
| 2 | `classroom trans audio` 接线 | 编排完整但**没有注入方** —— `setTranscriber()` 与 `config.transcriber` 在 `packages/` + `profiles/` 全量 grep **零供给**，实机必然 `DEPENDENCY_MISSING`。是「跑不通」，不是「没实现」 | 待补 |
| 3 | W-13 `classroom search subtitles` | 上游有、本仓无 | 待补 |
| 4 | W-15 `xxt` 资料栏 | 上游有、本仓无 | 待补 |
| 5 | W-1/W-2 `pta` homework start/finish | 补了 X-1 之后才谈得上 | 待补 |

### 6.3 需要判定的 6 条高危 B 类（名字对得上但行为不同）

| # | 位置 | 差异 |
| --- | --- | --- |
| D-7 | `pta` save/submit | 见 X-1 / X-2（已修） |
| D-8 | `sztz` signup | 上游写前 journal + 写后回查；本仓无 journal |
| D-9 | `lab` select | 本仓多校验了周次段（见 D-6） |
| D-10 | `xxt` materials + video list | 上游 `inventory` 一次读全 + 半小时缓存；本仓逐节逐卡、无缓存 |
| D-11 | `xxt` homework list | 上游带逐题状态；本仓只有列表 |
| D-12 | `classroom` live start | **结构性差异**：上游是脱离进程的后台采集器 + 租约；本仓是进程内定时器。README 已写代价 |

### 6.4 文档与实现不一致（顺手记）

| 位置 | 写的 | 实际 |
| --- | --- | --- |
| `xxt/README.md:20`、`xxt/src/index.js:148` | 「9 个只读方法」 | `XXT_METHODS` 是 **12 个** |

### 6.5 审计代理自己划的一条线（需你确认）

代理原话：

> 上游 CLI 视图里的「便利字段」（`courseRow` 的 `link`、`fileSize` 格式化）我没判 B，
> 但「计算逻辑」（`lab labs` 的 `availableWeeks`、`pta homeworkView` 的逐题列表）判了 B。

**我认可这条线**：字段重命名不算差异，「少了计算」算。

---

## 七、批次 A 审计汇入（76 条 provides）

报告：`coverage-audit-batch-a.md`。表面覆盖率 93.4%（A 25 / B 26 / C 5 / D 20），
但**审计代理的关键结论是「这个覆盖率是假的」**——D 类 20 条里 15 条「名对了、功能废了」。
其中 6 条已在「零之二」修好。

### 7.1 新增待补（批次 A 列出的遗漏）

| # | 包 | 能力 | 影响 |
| --- | --- | --- | --- |
| W-18 | `zdbk` | `timetable` 六类非正式课 + `student` | 六类**已补**（`kind` 字段标明来源）；`student` 待补 |
| W-19 | `zdbk` | `grades` 的评教提示 | 评教没做时查成绩会被拒，本仓没提示原因 |
| W-20 | `cc98` | `board list` 缺「我关注的」与「按名搜」两态 | 版面发现能力弱 |
| W-21 | `cc98` | `search` 单关键词、无编排 | 上游支持多说法 + 相关度 + 限流退避 |
| W-22 | `cc98` | `user` 字段大面积丢失 | 用户资料只留了一部分 |
| W-23 | `cc98` | `notifications` 无汇总 | 上游有按类汇总 |
| W-24 | `cc98` | ~~`messages` 顺序反了~~ | **已修**：加 `.reverse()`。原测试夹具是按正序写的，所以删掉 reverse 也不会红 —— 夹具已改成平台真实顺序（从新到旧） |
| W-25 | `cc98` | `topic view` 的 `only`（只看楼主）/ `find`（按词筛楼层）/ 热门 | 长帖读不动 |
| W-26 | `xuezai` | ~~`rollcall status` / `rollcall history`~~ | **`rollcallHistory` 已补**（纯 GET）；`rollcall status` 待补 |
| W-27 | `xuezai` | `course list` 未暴露 | 上游有独立课程列表 |
| W-28 | `xuezai` | `course view` / `modules` | 课程详情缺模块清单 |
| W-29 | `xuezai` | 参考点全败后的最小二乘反推 | 见 Y-6 |

### 7.2 D 类「归 core」但**承接方不存在**

| # | 能力 | 归属 | 问题 |
| --- | --- | --- | --- |
| **W-30** | `xuezai` 的 `material download` / `homework download` | 按 D21 归 `packages/core/*` | **`packages/core/` 28 个包 grep `download` 零命中** —— 承接方不存在，这两条事实上没人做 |

这条要特别记：**引用一条裁决不等于问题已解决**。D21 说了「下载归 core」，
但没人去 core 里建那个执行方。清单里要留一条，否则「按裁决归 core」会被当成「已完成」。

### 7.3 理由不实的条目（批次 A 查出 3 条 + 半不实 1 条）

| # | 包 | 能力 | 我原先写的理由 | 实际情况 |
| --- | --- | --- | --- | --- |
| 1 | `xuezai` | `rollcall status` / `rollcall history` | 「上游把它和签到绑定」 | **编的**。上游 `rollcall-cli.ts:52` 原文写「只查看，不签到」，`rollcallHistory` 是纯 GET |
| 2 | `xuezai` | `course list` | 写成「内部未暴露」但标了 ✅ | 自相矛盾：既然未暴露就不该标已实现 |
| 3 | `xuezai` | `session status` | 把「没接线」写成了「没有」 | 两回事 |
| 4 | `xuezai` | `course view` | 只解释了 `modules` 缺 | 部分成立 |

### 7.4 最隐蔽的一条：`cc98 messages` 顺序反了

审计代理原话：

> 字段全对、只是顺序反了。上游 `index.ts:353` 有 `.reverse()` 转成「从早到晚」，
> 本仓 `reads.js:681` 直接 map。**不报错、不缺字段，只在「谁先说的」上骗人。**

已记 W-24。这类缺陷**任何形状校验都抓不到** —— 它的返回形状完全合法。

---

## 八、第二轮自检新增（2026-11-11）

> 详细记录见 [`recheck-2026-11-11.md`](recheck-2026-11-11.md)。这一节只登记编号。

| # | 包 | 缺陷 | 状态 |
| --- | --- | --- | --- |
| **X-3** | `tyys` | `bookVenueExecute` / `cancelVenueExecute` **100% 不可用** —— `writes.js` 调的是只读入口 `client.request()`，而该入口把这两个写接口列在 `FORBIDDEN_WRITES` 里直接拒绝。审批通过了也发不出去，报的却是「本数据源不提供」 | **已修**：新增写专用入口 `VenueClient.submit()`（不查只读闸、不自动重放），两个写动作改走它；只读闸原样保留。回归测试 3 条（含「拆掉闸要红」） |
| **X-4** | `tyys` | 取验证码题面的 `POST /api/reservation/captcha/check` 被 `READ_POSTS` 拒掉（该表只有 `order/info`）→ **需要验证码的场地连取题都过不去**。上游 `READ_POSTS` 是四个 | **待补**，受 K-1 阻塞（验证码该不该存在尚未裁定；裁定保留则补一行即可） |
| **Z-1** | `cc98` `zdbk` `lab` `pta` `sztz` `tyys` `xuezai` | **审批被拒 → 该动作永久不可用**：`pair()` 的 `prepare()` 存下参数，只有 `execute()` 会清；审批拒绝时 `execute()` 不被调用 → 之后每次 `prepare()` 恒报 `WRITE_BUSY`，直到重启进程。七个包全部如此，实测四个包逐个复现 | **待裁决**（K-2）：修法 A（加 `cancelPrepare()`）/ B（改成后次覆盖）都动已发布契约 |

### 8.1 README 与代码矛盾（已修）

与第五节同一类问题，这次错在「只读」这个词上：

| # | 位置 | 原文 | 实际 |
| --- | --- | --- | --- |
| R-1 | `lab/README.md:5,81-90` | 「纯只读」+「不含任何写代码」 | 写方法已实现，`writeMethods` 列 4 个，`readOnly: false` |
| R-2 | `sztz/README.md:6,83-95` | 同上 | 报名/取消已实现；只有收藏（W-3）真缺 |
| R-3 | `tyys/README.md:10,89-106` | 「纯只读……`writes: false`」+「不含任何写代码，而且是硬拦」 | 预约/取消已实现；「硬拦」正是 X-3 的来源 |
| R-4 | `tyys/README.md:122` | 标题「明确丢弃：验证码识别」 | `src/captcha.js` 有 9 个导出且 `writes.js` 在调它 —— **代码与政策不一致**，见 K-1 |
| R-5 | `tyys/README.md:89-106` | 写操作「归将来的 `tool/tyys-write`」 | 实际归 `tool/campus-write` 的 `campus_activity` |

R-1 ~ R-3、R-5 已改（保留 `writes: false` 的声明与理由，把「不含写代码」改成
「写方法在、审批在 tool 层」）。R-4 改成如实陈述冲突，不当场裁定。

### 8.2 新增的两条待裁决

| # | 问题 | 两条路 |
| --- | --- | --- |
| **K-1** | `tyys` 的点字验证码算不算「绕过人机校验」？（`cnki` 滑块被判为硬约束不做，见 `abandoned.md` N-2；两者性质相同） | 是 → 删 `captcha.js` 与 `writes.js` 那段，`captchaRequired` 场地如实报人工；否 → 保留，但要在 N-2 旁补边界说明 |
| **K-2** | Z-1 怎么修 | A：source 加 `cancelPrepare()`，工具层审批失败时调它（保留「并发 Prepare 被拒」）；B：`prepare()` 改后次覆盖（放弃那条保护）。建议 A，但要先定方向 |

### 8.3 不在本清单范围、但会卡住新人

`package-lock.json` 与 `package.json` 不同步：`npm ci` 在干净工作树上直接失败
（`Missing: @lybx-leyw/dsh-zju-tool-campus-write@0.1.0 from lock file`），
`link-workspace-packages.mjs --check` 报 65/66。重新生成会顺带删 372 行 `extraneous`
条目并**摘掉根 `dependencies.parse5`**（`xxt/src/parse.js` 在用，虽仍能从包内解析），
属单独一张票的范围，本轮没动。
