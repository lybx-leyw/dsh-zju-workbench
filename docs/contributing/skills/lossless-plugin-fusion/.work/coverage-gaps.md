# 上游覆盖度遗漏清单

> 这份清单是**唯一权威的缺口记录**。审计代理的报告（`coverage-audit-batch-*.md`）里的
> 结论会汇总到这里；清单里有的，就是**确实还没做**的。
>
> 维护规则：补完一条就把状态改成「已补」并写上落点，**不删除**——删除会让
> 「这条当初为什么没做」永久丢失。

最后核对：2026-11-11（本轮实测复核，见下「八、本轮复核」）

## 审计基线的口径（本轮校正）

| 项 | 数字 | 怎么算的 |
| --- | --- | --- |
| 上游模块目录 | 17 | `packages/vendor/zju-assistant/core/zju/lib/*/` 里**有 `module.json`** 的目录 |
| 有 `module.json` 的模块 | 17 | `cc98` `chalaoshi` `chaoxing` `cnki` `doc` `ebook` `lab` `notice` `pta` `sztz` `tyys` `webvpn` `xuezai` `yjsy` `zdbk` `zhiyun` `zjuam` |
| 全部 provides | **162** | 上面 17 个 `module.json` 的 `provides` 逐条相加 |
| 其中 session 类 | 35 | 名字里含 `session` 的那些（login / status / logout / import-cookie） |
| 数据面 provides | **127** | 162 − 35 |
| 两份审计覆盖的数据面 | 147 = 76（A 批）+ 71（B 批） | A 批 `zdbk`/`cc98`/`tyys`/`xuezai`，B 批其余 10 个数据模块 |

**旧版本的「12 个模块、121 条 provides」是错的**，本轮用两种方法重算：

1. 逐个数 `module.json` 的 `provides` 数组 → 162；
2. 用 `"<模块名> "` 前缀在原文里数出现次数 → 与 1 一致（`zhiyun` 差 2 是因为它的
   `requires` 段里也写了 `zhiyun ...` 形状的字符串，不是 provides）——差异已定位，不是漏数。

那个数字来自已经不在仓库里的 `.tmp/upstream-baseline.json`（`.tmp/` 在 `.gitignore` 里），
无法再复现，所以本轮改成**直接从上游 `module.json` 重算**，并把方法写在这里。

**两份审计只覆盖了 147 条**（14 个数据模块）。**没被任何审计覆盖的 3 个模块**：

| 模块 | provides | 现在的状态 |
| --- | --- | --- |
| `zjuam` | 3（session login / status / logout） | 部分落地，**没有审计报告**，见第九节 Z-1 |
| `webvpn` | 8 | 有独立对账（`zju-assistant-webvpn-coverage.md`，16 个导出逐条） |
| `doc` | 4（text / pdf / pages / find） | **完全没有承接方**，见第九节 Z-2 |

状态图例：
- **待补** —— 确实缺，应当补
- **已补** —— 已实现，附落点
- **不补** —— 明确决定不做，**必须给理由**
- **归他处** —— 按分层裁决归别的包
- **口径更正** —— 原先的判断（含理由）本身不成立，本轮改判

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
这一步没做，已记 **W-29**（旧版误写成 W-17 —— W-17 在本清单里从来没有定义过，
是一处悬空引用，见第十一节）。

### 回归验证（证明修好了、也证明测试抓得住）

| 改坏点 | 结果 |
| --- | --- |
| `tyys` 漏 import | 调用即 `ReferenceError` |
| `zdbk` 恢复旧契约（要 pool/category） | **红 3 条** ✅ |
| `xuezai` content 不再当正文 | **红 1 条** ✅ |
| `xuezai` 坐标回到「必须调用方给」 | **红 3 条** ✅ |

新增测试：`tests/zdbk-writes.test.mjs`（19）、`tests/cc98-writes.test.mjs`（19）、
`tests/xuezai-writes.test.mjs`（13）。

### ⚠️ 上面的修复只到 source 边界（本轮实测）

「改坏 → 红灯 → 恢复」的验证全部是**直接调 source 的 `prepare()`**，
参数按 source 的期望写（`{homework: 101}`、`{rollcall: 202}`、`{venue, date, start, end}`）。
而工具层 `packages/tool/campus-write/src/tools.js` 传的是另一套参数
（`{course, homework: '作业名'}`、`{course, code}`、`{venue, slot, date}`）。

**结果是：Y-2 与 Y-6 的修复在真实调用路径上仍然走不通**（Y-5 是真修好了）。
本轮的实测证据与 7 条新断点见第八节「Y-7 ~ Y-13」。这不是回归（source 的测试确实守住了 source），
而是**测试只测了一层**——工具层的测试用的是假 source（`tests/campus-write.test.mjs:164-215`），
所以「工具传给 source 的参数对不对」从来没有任何一条测过。


---

## 一、写操作缺口（我自己核对出来的，审计代理复核）

上游标 `writes: true` 的 7 个模块共 **25** 条写 provides。本仓实现了 **22** 条，**缺 4 个动作**（W-1 / W-2 / W-3 / W-5）—— 净差 −3 是抵消出来的，逐包对账见下。

| # | 包 | 上游写能力 | 本仓 | 状态 | 说明 |
| --- | --- | --- | --- | --- | --- |
| W-1 | `pta` | `homework start` | 无 | **待补** | `POST /api/problem-sets/{id}/exams` 开一份答题实例。**注意**：本仓已有 `getExam()`（X-1 的修复）能**读**这个端点，但没有把它做成写动作 |
| W-2 | `pta` | `homework finish` | 无 | **待补** | `PUT /api/exams/{id}/end` 提前结束作业。源码里连注释都没有 |
| W-3 | `sztz` | `favorite`（收藏开关） | 无 | **待补** | `student/home/hdsc`，与报名同形态。`sztz/src/writes.js` 只有 `signupActivity` / `cancelActivity` |
| W-4 | `xuezai` | `rollcall number`（数字口令签到） | **源码已实现** | **已补（源码）/ 但工具走不到** | `writes.js:411` 走 `/api/rollcall/{id}/answer_number_rollcall`，测试 `tests/xuezai-writes.test.mjs:208` 覆盖。**但工具层传的是 `{course, code}`，source 要 `{rollcall}` 或 `{activity}`** → 见 Y-10 |
| W-5 | `xuezai` | `rollcall all`（一键签所有待签） | 无 | **待补** | `rollcall-all.ts`（并发跑 gps + number 双路，先签上者停），本仓无对应编排 |
| W-6 | `classroom` | `setup`（装 FFmpeg / 下 ASR 模型） | 无 | **待补** | 上游 `setup.ts`：`npm install ffmpeg-static` + 240 MB 模型下载。`diagnostics.js:20-25` 的措辞已经是「尚未实现（不是裁决）」，但那段仍把「本任务不跑 npm install」当理由 —— **那是流程约束，不是产品理由**，见第十节 |
| W-7 | `tyys` | 同伴参数（`vip/view/buddy_no` / `vip/check/buddy_no`） | 无 | **待补** | `writes.js:165-171` 对 `buddyMin > 0` 抛 `NOT_IMPLEMENTED` 并说清原因（**这是诚实的**，不是编理由） |
| W-8 | `classroom` | `check` 的 SHA-256 校验 | 部分 | **待补** | 上游用 `assets.json` 的 sha256 校验 ffmpeg 与模型；本仓 `diagnostics.js:165-167,211` 明确不做，`verified` 恒为 `false`（**如实标 false，不是假绿**） |

**本轮复核确认（2026-11-11，grep 实证）**：W-1 / W-2 / W-3 / W-5 / W-6 / W-7 / W-8 全部仍为待补；
W-4 的源码已实现、但工具层参数契约不通（Y-10）。**没有一条可以改判为已补。**

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

**写能力的总数对账（两种方法各算一遍）**：

| 包 | 上游写 provides | 本仓写方法 | 差 | 说明 |
| --- | --- | --- | --- | --- |
| `zdbk` | 3 | 3 | 0 | |
| `cc98` | 8 | 8 | 0 | |
| `xuezai` | 5（`submit` / `retract` / `rollcall` / `rollcall number` / `rollcall all`） | 3（`rollcall` 一条内含数字口令分支） | **−2** | `number` 合进 `rollcall`；`all` 完全没做（W-5） |
| `pta` | 4（`start` / `finish` / `save` / `submit`） | 2 | **−2** | W-1 + W-2 |
| `lab` | 1（`select`，上游用它带 `--cancel`） | 2（`selectLab` / `cancelLab`） | **+1** | 本仓把退选拆成独立方法 |
| `sztz` | 2（`signup` / `favorite`） | 2（`signupActivity` / `cancelActivity`） | 0 | **数字对齐纯属巧合**：本仓做的是「报名 + 取消」，上游是「报名 + 收藏」——`favorite` 缺（W-3），`cancel` 是上游没有的方法 |
| `tyys` | 2 | 2 | 0 | |
| **合计** | **25** | **22** | **−3（净）** | |

⚠️ **净差 −3 是「−2 −2 +1」抵消出来的，不能读成「只缺 3 条」。** 逐条看，**实际缺 4 个动作**：

| 缺的 | 编号 |
| --- | --- |
| `pta` `homework start` | W-1 |
| `pta` `homework finish` | W-2 |
| `sztz` `activity favorite` | W-3 |
| `xuezai` `rollcall all` | W-5 |

`sztz` 是最容易看漏的一行：两边都数出「2 条」，但**内容不同** ——
上游的 2 条是 `signup` + `favorite`，本仓的 2 条是 `signupActivity` + `cancelActivity`。
`favorite` 没做，`cancel` 是上游 provides 里没有的（上游把取消合进 signup 的开关语义）。
**条数相同不等于能力对齐**，这是「对数字」这件事最薄的一层。

> 旧版写的「上游约 22 条、本仓 19 条、缺 5 条」三个数都不对。
> **这就是「数字要用两种方法交叉验证」那条规矩的第四个实例** ——
> 只算总数会得到一个「看起来对」的差值（−3），逐包算才看得出缺的是哪 4 条。


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

> 维护规则：**「不补」必须能指向一条编号裁决，或者指向一条本仓的硬约束**。
> 只写「不做」「不搬」而不给依据的，一律不算不补，改记**待补**。
> 完整清单与逐条依据见 [`abandoned.md`](abandoned.md)（遗弃记录，单独一份）。

| # | 能力 | 依据 | 理由 | 证据 |
| --- | --- | --- | --- | --- |
| N-1 | `pta` 自动登录（邮箱 + 密码 + 验证码组件取票） | 硬约束（短信验证不可自动化） | 拼题A 的 `requireMfa` 要求短信验证码；上游自己的注释也只是「打开官方验证码组件」，不是纯自动化。本仓只收 Cookie，**能力在，输入少一种**（判 B 不判 C） | `pta/README.md:79-82`；`index.js:27-31` |
| N-2 | `cnki` 滑块**求解器** | 硬约束（不得绕过人机校验） | 上游 `slider.ts` 是滑块拼图求解器。本仓只做「检测到滑块就如实报」，不实现绕过 | `audit-cnki.md:61`（「不搬滑块拼图求解器是可辩护的范围决定」）；`cnki/src/` 无 slider 实现 |
| N-3 | `classroom` 内置 `sherpa-onnx-node` + SenseVoice 模型 | 硬约束（本仓不跑 `npm install`）+ D21 | ASR 内核与 240 MB 权重属**安装层**；本仓提供注入口（`setTranscriber`），内核由装配方给。**这条不是 W-6**：W-6 是 `setup` 这个**动作**本身没实现 | `classroom/src/asr.js:94`；`source.js:587` |
| N-4 | `tyys` 支付链路（`payAndVerify`） | 硬约束（支付不可自动化） | 上游要处理零元确认与真实支付。本仓无支付路径，`bookVenue` 到「预下单 + 提交」为止 | `tyys/src/writes.js`（无 `pay` 相关实现） |
| N-5 | 上游 `zju` CLI 入口整体 | D17（读写分层）+ 本仓无 CLI | 上游 `cli.ts` 是命令行入口。本仓把它的能力逐条映射到服务方法，**能力不丢、形态不同** | `zju-assistant-webvpn-coverage.md:99-101` 给了逐条映射的先例 |
| N-6 | `webvpn` 的 `rewriteFor` / `openContext` | 分层（结构转换） | 本仓的对应物是 `egress.js` 的 `downgraded` 集合 + `hosts.js` 归属表，同一职责更简单；`openContext` 的 CAS 注入在本仓属 `source/http` + `source/login`，搬进 tier 0 会反向依赖 | `zju-assistant-webvpn-coverage.md:60-72` |
| N-7 | `xuezai` 雷达点名的球面最小二乘反推 | **不成立，改判待补** | 见 W-29（原 W-17）。上游在 13 个参考点全败后用 ≥3 个距离反推位置；本仓 `writes.js:458-466` 停在「如实报试了多少点」 | `xuezai/src/writes.js:458-466` |

**这一节此前是空的（「待审计汇入」），本轮按实证补齐 7 条**，其中 6 条成立、1 条（N-7）改判。

---

## 四之二、遗弃记录（谁接、接没接）

「按裁决归 X」**不等于**「X 做了」。下面这三类是本轮查出的**承接方不存在**：

| # | 能力 | 裁决说归谁 | 实际状态 | 证据 |
| --- | --- | --- | --- | --- |
| **A-1** | `xuezai` 的 `material download` / `homework download` | D21 → `packages/core/*` | **core 里没有下载执行方**。`packages/core/` 28 个包 grep `downloadParams` / `saveFiles` / `downloadTo` **零命中** | `grep -rn "downloadParams\|saveFiles\|downloadTo" packages/core` → 空 |
| **A-2** | `zdbk` 培养方案 PDF、`cc98` 帖内附件 | D21 → core | 同上，无承接方。且 `cc98` 的 source 侧**已经**有落盘（`reads.js` 的 `downloadDir`），与 D21「source 不碰文件系统」自相矛盾 | `cc98/src/reads.js` 有 `createWriteStream` |
| **A-3** | `xxt` 的 `downloadParams` | D21 → core | 参数接口正确（只给 `{url, variant, filename, size, headers}`），但**全仓无消费者** | `grep -rn downloadParams packages` 只命中定义处 |

> 完整推导、以及 D1–D21 每一条的落地核对，见 [`abandoned.md`](abandoned.md)。


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
| W-9 | `pta` | `submission list` / `submission view` / `reconcile` | README 里有理由 | **理由不实**（三处同源）。上游是「交完回查」的三个读动作，本仓没有 → **前两条已补**（`submissions` / `submission`）；`reconcile` 依赖本机 journal，留在「修哪一侧」的裁决里 |
| W-10 | `cnki` | `download` | README 说已声明 | **虚假声明** —— 声明了但没实现 |
| W-11 | `lab` | `session logout` | 无 | **无理由** → **已补**（见 6.6） |
| W-12 | `xxt` | `session logout` | 无 | **无理由** → **已补**（见 6.6） |
| W-13 | `classroom` | `search subtitles` | 无 | **无理由** → **已补**（见 6.6） |
| W-14 | `chalaoshi` | `course`（结构化课程信息） | 自称不做 | **无授权自判** → **已补**（`chalaoshi.course` + `fetchCourseGpa`） |
| W-15 | `xxt` | 资料栏（`material list`） | 无 | 审计列为「最该补」第 4 条 → **已补**（见 6.6） |

### 6.2 待补里我认可「最该先补」的 5 条（审计排序）

| 序 | 条目 | 理由 |
| --- | --- | --- |
| 1 | **X-1 `pta` 死链** | 不修则 `save` / `submit` 在任何情况下都不工作 | **已修** |
| 2 | `classroom trans audio` 接线 | 编排完整但**没有注入方** —— `setTranscriber()` 与 `config.transcriber` 在 `packages/` + `profiles/` 全量 grep **零供给**，实机必然 `DEPENDENCY_MISSING`。是「跑不通」，不是「没实现」 | 待补 |
| 3 | W-13 `classroom search subtitles` | 上游有、本仓无 | **已补** |
| 4 | W-15 `xxt` 资料栏 | 上游有、本仓无 | **已补** |
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

### 6.6 本轮已补的五条（2026-11-11，不需要裁决的那一批）

这一批的共同点是：**补的是上游明确有的只读能力或本机清理动作**，不改变任何
已发布的调用契约（不改工具层参数表、不改审批模型、不新建装配层）。

| # | 包 | 补了什么 | 为什么它不需要裁决 | 钉住它的测试 |
| --- | --- | --- | --- | --- |
| W-11 | `lab` | `logout()`：清内存登录态 **+** 持久化层，服务面与路由都挂上 | 上游 `lab session logout` 就是「清本地会话」；本仓只清内存会让 `restore()` 把同一个 token 读回来，「已退出」是假的。不动凭据、不向平台发请求 | `tests/lab.test.mjs` 两条（有/无持久化层） |
| W-12 | `xxt` | 客户端 `logout()` + 路由动作 `logout` | 上游 `sessionStore().clear()` 同口径；同样是**本地**清理，不动服务端登录态 | `tests/xxt.test.mjs`「客户端 logout」；`tests/xxt-route.test.mjs` 的动作清单 |
| W-13 | `classroom` | `searchCaptions()`：字幕关键词检索，命中带前后句、按关键词计数、`limit` 封顶、无字幕课次如实列出 | 上游 `materials.ts:46` 的 `searchCaptions` 是纯读；本仓已有 `getSubtitles` 与 `getMyLectures`，缺的只是编排 | `tests/classroom-readonly-gaps.test.mjs` 六条 |
| W-15 | `xxt` | `dataFiles()`：资料栏逐层文件夹 + 分页；`downloadParams` 增加 `dataId` 分支（走 302 取 `Location`）；`XxtClient.redirect()` | 上游 `inventory(data:true)` 就是这条通路。**它不落盘**（D21 不变）：改的只是「清单能不能列出来」与「下载参数从哪来」 | `tests/xxt.test.mjs` 资料栏与 redirect 共 9 条 |
| W-19 | `zdbk` | `grades()` 多一个可选的 `evaluationPending` 提示 | 上游只是**解释**「本学期成绩为什么是空的」；新增可选字段、失败即不显示，不改变既有返回形状 | `tests/zdbk.test.mjs` 三条 |
| W-9（前两条） | `pta` | `submissions()` 提交记录（游标分页）+ `submission()` 单条详情；路由动作 `submissions` / `submission` | 上游 `query.ts:85-95` 的两条**纯 GET**，审计自己写明 `write.ts:85` 的 `reconcile` 才是「只读回查」。本仓不搬 `reconcile`（它要有 journal） | `tests/pta.test.mjs` 五条 |
| W-14 | `chalaoshi` | `parseGpaTable()` + `fetchCourseGpa()` + 服务方法 `course` + 路由动作 `course` | 上游 `chalaoshi/index.ts:366-424` 的纯解析 + 纯 GET。原先那句「解析留给消费方」不是裁决，是把能力丢给每个调用方 | `tests/chalaoshi.test.mjs` 四条 |

另外两处顺手订正（不是缺口，是**口径**）：

- `xxt` 的方法表白名单从 12 条变 **13 条**（`dataFiles`），`actions` 从 3 条变 4 条（`logout`）；
  README 与两处测试同步。
- `xxt/src/reads.js` 文件头原写「9 个只读方法」，那是补 `chapters` / `materials` /
  `downloadParams` 之前的数字，本轮改成不写死条数。

**仍然留着、需要裁决的**：Y-7 ~ Y-12 的工具层参数契约（改哪一侧）、X-4 的验证码题面
（受 K-1 阻塞）、A-1 ~ A-8 的装配层（Q-3）、W-1/W-2 `pta` 开/结束作业、
W-9 的 `reconcile`（要 journal 机制）、以及 `abandoned.md` 第七节列的 Q-1 ~ Q-9。
Z-1（审批被拒后动作永久不可用）**已在 `ecf080f` 里修掉**，见 8.0 的落地核对。

---

## 七、批次 A 审计汇入（76 条 provides）

报告：`coverage-audit-batch-a.md`。表面覆盖率 93.4%（A 25 / B 26 / C 5 / D 20），
但**审计代理的关键结论是「这个覆盖率是假的」**——D 类 20 条里 15 条「名对了、功能废了」。
其中 6 条已在「零之二」修好。

### 7.1 新增待补（批次 A 列出的遗漏）

| # | 包 | 能力 | 影响 |
| --- | --- | --- | --- |
| W-18 | `zdbk` | `timetable` 六类非正式课 + `student` | 六类**已补**（`kind` 字段标明来源）；`student` 待补 |
| W-19 | `zdbk` | `grades` 的评教提示 | 评教没做时查成绩会被拒，本仓没提示原因 → **已补**（见 6.6） |
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

## 八、本轮复核（2026-11-11）：工具层 → source 层的参数契约

**这一节的每一条都是实测出来的，不是读代码推的。**探针在 `scripts/probe-write-contract.mjs`，
可以随时重跑。

### 8.1 怎么跑、跑出什么（**可复现**）

探针已经**提交进仓**，不是一次性的临时脚本：

```bash
node scripts/probe-write-contract.mjs
```

它直接 `import` 源码里的写工厂，喂**工具层 `tools.js` 实际传的那个参数对象**
给 `prepare()`。不联网、不碰真账号。当前输出：

```
✅ 14 条
❌ 8 条
合计 22 条探针：通 14，不通 8
```

（出口码 1。可以当 CI 用。）

> **22 条探针 ≠ 22 条写操作**：`xuezai submit` 试了「按作业名」与「按编号」两种输入
> （同一个动作的两条路径），其余一一对应。按**动作**数是 21 条探针覆盖的动作，
> 其中 **8 个动作**有一个走不通的入口。`pta save` / `submit` 的探针走的是
> 「没有答题实例 → 按预期拒绝」，那**不算不通**（上游同款行为）。

### 8.2 八条不通的实测记录

| 工具 | action | 工具传的 | source 要的 | 实测报错 |
| --- | --- | --- | --- | --- |
| `campus_course_select` | drop | `{course}` | `{section}` | `需要 section（教学班号，来自 selectionSelected）` |
| `campus_course_select` | reorder | `{course, order}` | `{section, order}` | `需要 section（教学班号）` |
| `campus_react` | rate | `{post, value, reason: undefined}` | `reason` 必填 | `评分需要 reason（理由编号）` |
| `campus_activity` | tyys book | `{venue, slot: '19:00-20:00', date}` | `{venue, date, start, end}` | `start / end 要写成 HH:MM` |
| `campus_lab_select` | select | `{course: '大学物理实验', lab, week}` | `course` 是正整数 | `课程编号 必须是正整数` |
| `campus_homework` | xuezai submit | `{homework: '第三次作业'}` | `{homework: 编号}` | `需要 homework（作业编号，来自 assignments 的 id）` |
| `campus_homework` | xuezai retract | `{homework: '第三次作业'}` | `{homework: 编号}` | 同上 |
| `campus_checkin` | xuezai rollcall | `{course, code}` | `{rollcall}` 或 `{activity}` | `需要 homework（作业编号）`（文案也不对：用户在点名，被问作业编号） |

### 8.3 七处断点（Y-7 ~ Y-12，Y-13 是根因条目）

| # | 位置 | 缺陷 | 根因 | 影响 |
| --- | --- | --- | --- | --- |
| **Y-7** | `campus_course_select` 的 `drop` / `reorder` | 两个 action **必然在 prepare 抛错** | 工具传 `{course}` / `{course, order}`，`zdbk/writes.js:229,245` 要 `section`。工具的 `section` 参数写着「select 必须」，**drop / reorder 没让它必填** | 退课与调序**完全不可用** |
| **Y-8** | `campus_activity` 的 tyys `book` | 必然在 prepare 抛错 | 工具把时段拼成一个字符串 `slot: target`，`tyys/writes.js:102-106` 要 `start` / `end` 两个 `HH:MM` | 场馆预约**完全不可用**（`cancel` 通，所以「取消」比「预约」能用，状态很怪） |
| **Y-9** | `campus_homework` 的 xuezai submit / retract | 传作业**名字**就不通，只接受**编号** | 工具参数描述是「作业名或编号」，`xuezai/writes.js` 的 `resolveActivity` 只认 `Number(input) > 0`；工具传的 `course` source 不读 | 用户按自然说法调用 → 100% 失败，要先自己查 `assignments` 拿 id |
| **Y-10** | `campus_checkin` 的 xuezai rollcall | 必然在 prepare 抛错 | 工具传 `{course, code}`，`xuezai/writes.js:363` 读 `args.rollcall ?? args.activity` → `resolveActivity(undefined)` | 课堂点名（错过就没了）**完全不可用**，且报错文案与场景无关 |
| **Y-11** | `campus_react` 的 `rate` | 必然在 prepare 抛错 | 工具把 `reason` 当**可选**（`optStr`），`cc98/writes.js:191` 要求必填 | CC98 评分**完全不可用** |
| **Y-12** | `campus_lab_select` 的 `select` | 传课程名必然抛错 | 工具参数写「实验课程名或编号」，`lab/writes.js:103` 的 `id(args.course, '课程编号')` 只收正整数 | 按课程名调用 → 失败 |
| **Y-13** | 以上全部的**测试层** | 这些断点**没有任何一条测试能抓到** | `tests/campus-write.test.mjs` 用**假 source**（`selectCoursePrepare` 一个函数就够），从不 import 真的写工厂；`tests/*-writes.test.mjs` 直接调 source，参数按 source 的写法给。**两层各测各的，中间的缝没测** | 8 个动作在真实路径上不可用，而全部测试（80 条写测试 + 全部守卫）都是绿的 |

**Y-13 不是第 9 个断点，是「为什么一个都没被抓住」的根因条目。**

### 8.4 与「零之二」的关系（务必分清）

「零之二」修的 Y-2 / Y-5 / Y-6 是**同一种缺陷的前一批**：

| 旧编号 | 当时的修法 | 修完之后的实际状态 |
| --- | --- | --- |
| Y-2 `zdbk` 三个写动作 | source 自己解析 `pool` / `category` | **select 真通了**；drop / reorder 仍需 `section` → 变成 Y-7 |
| Y-5 `xuezai` 正文被丢弃 | source 同时收 `content` 与 `comment` | **真修好了** |
| Y-6 `xuezai` 点名恒失败 | source 改用 13 个参考点 | source 侧通了，但**工具根本给不到 `rollcall` 编号** → 变成 Y-10 |

**结论**：Y-2 / Y-6 的修复验证只在 source 一层做过，所以「红 3 条」是真的、
「这条能力可用了」是假的。这正是本仓反复记的那条：**测试通过 ≠ 调用路径能走到底。**

### 8.5 这轮不改代码的原因（如实说明）

本轮的授权是「处理清单文档、覆盖度校验、遗弃记录」。上面 8 条断点是
**工具层与 source 层之间的接口约定**，修法有两种且方向相反：

- **A**：改工具层，让它按 source 要的参数传（要给 `drop`/`reorder` 加 `section` 必填、
  把 `slot` 拆成 `start`/`end`、让模型提供 `rollcall` 编号…）；
- **B**：改 source，让它接受自然输入（按作业名唯一解析、按课程名唯一解析…）。

两种都改变**已发布的工具参数表**（模型看到的东西）或**服务的入参契约**，
属于「破坏调用方预期」。按本仓规矩，这种要先定方向再动。
**所以本轮只记录、不改代码**，并把修法选项写清楚留给下一个接手的人。

---

## 九、没被任何审计覆盖的两个模块（Z-1 / Z-2）

两份审计（A 批 76 条 + B 批 71 条 = 147 条）覆盖了 **14 个数据模块**。
剩下三个模块里，`webvpn` 有独立对账（`zju-assistant-webvpn-coverage.md`，16 个导出逐条），
`zjuam` 与 `doc` **一条都没有**。

### Z-1 · `zjuam`（统一身份认证，3 条 provides）

| # | 上游 provides | 本仓落点 | 判定 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `zjuam session login` | `source/login/src/cas.js:317` `casLogin(transport, {entry, hosts, credentials})` | **B** | 能力在：跟跳转 → 抠 execution → 取 RSA 公钥 → 加密 → 提交 → 判票，六步齐全（`cas.js` 的 `casForm` / `encryptCasPassword` / `authUrlGuard` / `describeAuthFailure` 各有单测）。**差异**：上游是一个 `Zjuam` 类，自己管 `SessionStore` 与 `loginPromise` 并发去重；本仓是无类函数集合，会话持久化**由调用方**负责，登录去重也没有（`webvpn-coverage` 的 D-3 记了同一类差异） |
| 2 | `zjuam session status` | 无独立方法；但路由的 GET 会**探下游** | **B / 部分** | 精确说：`zjuam` 本身没有 `status()`。`source/login` 的服务面给的是**凭据**状态（`cardStatus` → `{configured, username}`）；它的**路由 GET** 另外并行探三个下游（`probeCampusSource` / `probeClassroom` / `probeZdbk`，`index.js:768-770`，带 `withDeadline`）。所以「下游能不能用」有答案了，但**「CAS 这张票现在还有效吗」这个单独的判据没有** —— 上游 `zjuam status` 给的是 `{file, username, expiresAt, cached}`（纯本地、不联网）。本仓的 `webvpn` 侧倒是有等价的 `hasWebvpnSession`/`probeWebvpnSession`。**结论：新增能力，判待补而非缺失** |
| 3 | `zjuam session logout` | `cardStatus` 侧的 `clear()` / `clearWebvpn()`（`index.js:839,844`） | **B** | 清的是**凭据记录**，不是 CAS 会话票。上游 `logout()` 清的是 `zjuam.json` 里的 cookie。**语义不同**：本仓没有「把票作废」这个动作 |

**这条要特别记**：`zju-assistant-inventory.md:39` 把 `zjuam` 一行标成「`无需`」，
依据是「`source/login` 有账号，`source/http` 的 `AUTH_HOSTS` 含 zjuam」。
那个判断**只覆盖了 login 的输入侧**（账号从哪来），没覆盖 status / logout。
本轮改判：**login B / status 待补（新增能力，不是丢失）/ logout B**。
`status` 的准确说法是「`zjuam` 没有单独的票有效性判据」，而不是「忘了做」。

### Z-2 · `doc`（文档转文字与 PDF 处理，4 条 provides）

上游 `doc` 模块：`text`（文件/链接 → 文字）、`pdf`（图片/Word/PDF 合成 PDF）、
`pages`（取指定页）、`find`（找关键词所在页）。依赖 `pdfjs-dist` / `pdf-lib` /
`sharp` / LibreOffice 引擎（`module.json` 的 `localDependencies`）。

本仓现状（逐条 grep 实证）：

| # | 上游 provides | 本仓 | 判定 |
| --- | --- | --- | --- |
| 1 | `doc text` | **部分**：`core/classroom-media` 的 `parsePdf(buffer)` 能取 PDF 文字（`unpdf` 优先，可配 MinerU）；`core/vault` 有 `pdfjs-dist` 但用于**阅读器渲染**。**Word / PPT / Excel 无解析**（无 `mammoth` / `xlsx` / office 引擎依赖） | **部分 / 待补** |
| 2 | `doc pdf`（合成 PDF） | **无**。全仓无 `pdf-lib` | **待补** |
| 3 | `doc pages`（取指定页） | **无**。grep `extractPages` / `parsePageRule` 零命中 | **待补** |
| 4 | `doc find`（关键词找页） | **无**。grep `findInPdf` 零命中 | **待补** |

**为什么这一整块一直没人发现**：它不在 `zju-assistant-inventory.md` 的 20 行清单里
（那份清单列的是「数据源」，`doc` 被当成工具而不是数据源），也不在两份审计的范围里。
按 providess 算，它是 **4 条**，比 `yjsy`（1 条）、`chalaoshi`（3 条）、`ebook`（1 条）都多。

**归属建议（不替用户裁决）**：`doc` 不连外部站点（它读本地文件），所以按分层硬约束
**不该进 `source/*`**；而它做的是「变换 + 落盘」，`core/*` 是合理的落点。
但 D21 说「下载执行归 core、source 只给参数」—— `doc` 的输入本身就是本地文件，
不需要下载。**这条要单独裁决，记在这里。**

### Z-3 · 顺带校正 `zju-assistant-inventory.md:39` 的两处

| 位置 | 原文 | 实际 |
| --- | --- | --- |
| `zjuam` 行 | 待办「无需」 | 见 Z-1：`status` 确实缺 |
| `doc` 行 | **不在表里** | 4 条 provides，其中 3 条完全没有承接方 |

---

## 十、「名字对得上但工具走不到」的完整名单

把第八节与前面合并，**本仓现在有 8 个「source 有实现 / 工具层调不通」的写动作**：
Y-7（drop / reorder，2 个）、Y-8（tyys book）、Y-9（xuezai submit / retract，2 个）、
Y-10（xuezai rollcall，含 W-4 的数字口令分支）、Y-11（cc98 rate）、Y-12（lab select）。
**Y-13 不是第 9 个动作，是「为什么这些缺陷一个都没被测试抓到」的根因条目。**

另有 **3 处「source 有实现 / 没有任何东西调用它」**（不是缺陷，是本轮确认的装配状态）：

| 注入口 | 谁该调 | 实际 |
| --- | --- | --- |
| `sourceClassroom.setTranscriber()` | 某个装配方 | **全仓无人调用**（`packages/` + `profiles/` grep 只命中定义处与测试）→ 漏-4 仍然成立 |
| `sourceHttp.setWebvpnSession()` | 某个装配方 | **全仓无人调用** → R-3 仍然成立 |
| `sourceLab/Tyys/Sztz/Mail/Yjsy/Notice` 的 `setCredentialProvider` / `setLoginProvider` / `setSessionProvider` / `setCredentialProvider` / `setTokenProvider` / `setServiceLoginProvider` | 某个装配方 | **全仓无人调用**。本轮实测：挂载后 `ready()` 全部为 `false`，读方法抛 `CONFIG:「…还没接入登录…（若你是插件作者：调用 setXxxProvider）」` |

**最后一条是本轮最重要的发现之一**，单独记：

### 装配缺口：六个包在实机上「挂得上、用不了」

`lab` / `tyys` / `sztz` / `mail` / `yjsy` / `notice` 六个包**都**采用「凭据由集成层注入」的设计
（`README` 里叫「集成层」，代码里是 `setCredentialProvider` 一类方法）。
本轮把六个包各自 `apply()` 到一个最小 ctx 上，然后调它们的读方法：

| 包 | `ready()` | 第一次读的结果 |
| --- | --- | --- |
| `lab` | `false` | `CONFIG: 实验课平台还没接入登录…（若你是插件作者：调用 setCredentialProvider）` |
| `tyys` | `false` | `CONFIG: 还不知道用哪个账号查体艺：到「设置 → 浙大一卡通」配置学号后重试。` |
| `sztz` | `false` | `CONFIG: 素质拓展平台还没接入登录…（若你是插件作者：调用 setSessionProvider）` |
| `mail` | `false` | `CONFIG: 浙大邮箱还没有可用的客户端专用密码…（若你是插件作者：调用 setCredentialProvider 注入。）` |
| `yjsy` | `false` | `CONFIG: 研究生教务网还没接入登录…（若你是插件作者：调用 setTokenProvider 注入取 token 的能力）。` |
| `notice` | `false` | 匿名可用（`status: partial`，11 个来源读不到） |

**为什么会这样**：这些包声明了 `auth: cas`（`lab` 是 `own`），但 `export const inject = []`、
`package.json` 的 `requires` 里也没有 `source/login`。它们按设计**不自己读凭据**，
等装配方注入。而**装配方不存在**：`profiles/zju-workbench/` 里只有 `package.json` 的 bundles 列表
和一份 `cordis.patch.yml`（只有 `dsh-pages` 一条），没有任何一行注入代码。

**同类对照**：`zdbk` / `xuezai` / `classroom` / `cc98` 走的是另一条路 —— 直接
`import { readCard } from '@lybx-leyw/dsh-zju-source-login'`，自己读宿主凭据服务，
所以它们**不需要装配方**。（这是两种设计并存，本身不是错，但结果是六个包不可用、
四个包可用，而文档里没写这个区别。）

**结论**：这不是「缺口没补」，是**装配层整块没写**。它不属于任何一条 W 编号，
本轮新记为 **A-4**（见 `abandoned.md`）。**用户可用性上的影响**：实验选课、场馆预约、
二课、邮箱、研究生课表、通知（部分）**六个数据源在实机上全部取不到数据**，
而它们都挂着 profile、都在 README 里写着「已完成」。

> **2026-11-11 复核（结论已变）**：`ecf080f` 按 D18 给 `source/login` 补了
> `casTransport` / `casLoginFor`，`lab` / `mail` 改成读 `source/login` 的记录，
> `sztz` / `tyys` / `notice` 改走共享 CAS；`yjsy` 在本票里补了同样的兜底
> （`casLoginFor` 拿票 → 本包发 `validateLogin` 换 `X-Access-Token`）。
> **六个包全部接上了**，上面那张 `ready()=false` 的表是当时的记录，保留原文不动。

> ⚠️ 这条只在最小替身 ctx 上验证过（`ctx.get` 返回 undefined、没有 `credentials` 服务）。
> 真实 profile 里若有别的地方提供这些服务，结论会不同 —— 但**全仓 grep 那些 `setXxxProvider`
> 的方法名，除定义处与测试之外零命中**，所以真实 profile 里也没有。这一判断的证据强度是「静态 grep + 替身实测」，不是「在真机上跑过」。

#### A-4 的修复（2026-11-11）

**修法不是「写一个装配方」**，而是让这些包**自己读凭据** —— 照 `zdbk` / `xuezai` /
`classroom` / `cc98` 那条已验证的路。理由：装配方是一种「必须有别的东西先跑」的
耦合，而这个仓里没有那样的东西，也不该为了喂凭据再造一个。

| 包 | 改法 | 依据 |
| --- | --- | --- |
| `lab` | `readLab(ctx)` —— 存 `zhiyun-lab/account` | `auth: "own"`，有自己的密码 |
| `mail` | `readMail(ctx)` —— 存 `zhiyun-mail/account` | `auth: "own"`，16 位专用密码 |
| `sztz` | `ctx.get('zhiyunCard').casTransport({ entry, hosts })` | 走 CAS，按 D18 向 tier 0 要共享会话 |
| `tyys` | `ctx.get('zhiyunCard').casLoginFor({ entry, hosts })` | 要从落地页取 `oauth_token` / `jwtToken` |
| `notice` | 同上（`casTransport`） | 多站点各登一次，共享 jar 按域隔离 |
| `yjsy` | **未改** —— 它要的是「取 token 的能力」，与 CAS 会话不同 | 仍待处理，见下 |

注入点全部**保留**（测试与特殊部署仍可用），只是不再**必需**。

四个包的 `ready()` 语义也一并修正：注入的 provider 存在，**或者**凭据/共享会话可用，
都算「已接入」。先前只认前者，而那个注入点零调用方 —— 于是设置页恒红。

**`yjsy` 仍未修**：它要的是 `(ctx) => Promise<string>` 形状的取 token 回调，
与其余五个的信道不同，需要单独看它的 token 从哪来。这一条留在 A-4 里不关闭。

---

## 十一、清单自身的编号缺陷（本轮修正）

| # | 缺陷 | 修正 |
| --- | --- | --- |
| 1 | **W-16 不存在**。W 编号从 W-15 直接跳到 W-17 | 本轮在 W-15 之后补了空隙说明；W-16 记为**空号**（不挪用，避免历史引用错位） |
| 2 | **W-17 被两处错引**：`xuezai/src/writes.js:460` 写「已记进 coverage-gaps.md 的 W-6」（实际是 W-29）；本文件零之二也写 W-17 | 代码注释改成 W-29；本文件零之二改成 W-29 |
| 3 | **`classroom/README.md:197` 写「记进待补清单（W-8）」**，但 W-8 是「`check` 的 SHA-256」，`setup` 是 W-6 | README 改成 W-6 |
| 4 | 第一节的「约 22 条 / 已实现 19 / 缺 5」三个数都不对 | 改成 25 / 22 / 3，并给了两种算法 |
| 5 | 第四条「不补的条目」是空表（「待审计汇入」） | 补齐 7 条（N-1 ~ N-7），其中 N-7 改判待补 |
| 6 | 审计基线「12 个模块、121 条 provides」无法复现 | 改成「17 个模块（19 个目录里 17 个有 `module.json`）、162 条 provides」，并写上两种算法 |

**空号说明（有意保留）**：

| 编号 | 状态 |
| --- | --- |
| **W-16** | **空号**。历史文档从未定义过它。不回收，避免旧引用指向别的条目 |
## 八、第二轮自检新增（2026-11-11）

> 详细记录见 [`recheck-2026-11-11.md`](recheck-2026-11-11.md)。这一节只登记编号。

| # | 包 | 缺陷 | 状态 |
| --- | --- | --- | --- |
| **X-3** | `tyys` | `bookVenueExecute` / `cancelVenueExecute` **100% 不可用** —— `writes.js` 调的是只读入口 `client.request()`，而该入口把这两个写接口列在 `FORBIDDEN_WRITES` 里直接拒绝。审批通过了也发不出去，报的却是「本数据源不提供」 | **已修**：新增写专用入口 `VenueClient.submit()`（不查只读闸、不自动重放），两个写动作改走它；只读闸原样保留。回归测试 3 条（含「拆掉闸要红」） |
| **X-4** | `tyys` | 取验证码题面的 `POST /api/reservation/captcha/check` 被 `READ_POSTS` 拒掉（该表只有 `order/info`）→ **需要验证码的场地连取题都过不去**。上游 `READ_POSTS` 是四个 | **待补**，受 K-1 阻塞（验证码该不该存在尚未裁定；裁定保留则补一行即可） |
| **Z-1** | `cc98` `zdbk` `lab` `pta` `sztz` `tyys` `xuezai` | **审批被拒 → 该动作永久不可用**：`pair()` 的 `prepare()` 存下参数，只有 `execute()` 会清；审批拒绝时 `execute()` 不被调用 → 之后每次 `prepare()` 恒报 `WRITE_BUSY`，直到重启进程。七个包全部如此，实测四个包逐个复现 | **已修（2026-11-11，`ecf080f`）**：按 K-2 的建议 A 落地 —— 七个包各暴露 `<动作>Cancel`，`tool/campus-write` 的 `guardWrite` 在任何失败路径（无 agent / 审批拒绝 / 中止 / execute 抛错）都先 `rollback()` 再抛。`contract()` 现在**强制要求** `cancel` 存在，缺了直接 `CONTRACT_MISSING`。见 8.0 的落地核对 |

### 8.0 Z-1 的落地核对（2026-11-11，本轮复核）

`recheck-2026-11-11.md` 把 Z-1 记成「等裁决」，但 `ecf080f` 已经按建议 A 修完。
本轮逐条核对（可复现）：

```bash
# 七个写包都会给每个写动作加一个 <name>Cancel
grep -c 'Cancel\b' packages/source/{cc98,zdbk,lab,pta,sztz,tyys,xuezai}/src/index.js
# tool 层在**每条**失败路径上都先撤销
grep -n 'rollback()' packages/tool/campus-write/src/index.js
```

| 检查点 | 结果 |
| --- | --- |
| 七个包的 `cancel` | ✅ `zdbk` / `xuezai` 各 3 个，`lab` / `pta` / `sztz` / `tyys` 各 2 个；`cc98` 用 `Object.entries(writes)` **动态生成**，同样齐全 |
| 工具层 `contract()` 强制要求 `cancel` | ✅ 缺了抛 `CONTRACT_MISSING`，不让「静默退化成不可用」通过 |
| 失败路径（无 agent / 拒绝 / 中止 / execute 抛错） | ✅ 四条都先 `rollback()`，再抛原始原因（撤销失败不覆盖真正的原因） |
| 拒绝之后能否重新发起 | ✅ 撤销后立刻可重新 `prepare`，**不加冷却**（拒绝一次是「这次不做」，不是「以后都不许做」） |

**结论：Z-1 与 K-2 都已关闭**，`recheck-2026-11-11.md` 第三节的「为什么本轮不修」
是当时的记录，保留原文不动。

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
| **K-2** | Z-1 怎么修 | **已定并已落地（A）**：source 各暴露 `<动作>Cancel`，工具层审批失败时调它（保留「并发 Prepare 被拒」）。原建议就是 A，实际实施见 8.0 |

### 8.3 不在本清单范围、但会卡住新人

~~`package-lock.json` 与 `package.json` 不同步~~ —— **已修**（2026-11-11）。

重新生成后条目 373 → 375，精确 diff 只两处：

- 补进 `@lybx-leyw/dsh-zju-tool-campus-write`（正是缺的那条）
- `parse5` 从根 `dependencies` 移到 `packages/source/xxt`（按本仓约定第三方依赖
  只声明在包内；根上那条是先前手改 `package.json` 留下的，锁文件没跟上）

验证：`npm ci` 实跑退出码 0（added 205 packages）、链接 66/66、`npm run build` 通过。

---

## 十二、用户明确废弃：知网（cnki）数据源

**决定**：用户 2026-11-11 明确指示「知网数据源明确删除，用户明确不做知网数据源了」。

**这不是「待补」，也不是「暂缓」——是不做。** 记录在此以免后来者把它当成遗漏。

### 删除范围（已执行）

| 项 | 处理 |
| --- | --- |
| `packages/source/cnki/` | **整包删除** |
| `tests/cnki.test.mjs` | 删除 |
| `profiles/zju-workbench/package.json` | 移除 `@lybx-leyw/dsh-zju-source-cnki`（53 → 52） |
| `source/login` 的 `probeCnki` | 删除（探测函数与 `runProbes` / `sources` 里的引用） |
| `login/client.jsx` 的 `sourceCnki` | 删除（状态行 + 8 种语言文案） |
| `tests/login-sources.test.mjs` | 去掉知网相关的期望与断言 |
| `tests/source-settings.test.mjs` | `NO_SETTINGS` 白名单移除 `cnki` |

### 保留了什么，为什么

| 位置 | 内容 | 为什么保留 |
| --- | --- | --- |
| `source/webvpn/src/hosts.js` | `'cnki.net'` 在主机归属表里 | 那是**事实**（知网只在校内可达），不是知网的实现。表是 WebVPN 的路由依据，删一条会让「将来别人接知网时又得重新实测」 |
| `source/tyys/README.md` | 提到 `cnki` 的滑块求解器作为**类比** | 讲的是「tyys 的点字验证码与 cnki 的滑块是同一类人机门槛」，是论证材料，不是知网功能 |

### 连带影响

原本 `cnki` 在设置页的「这份凭据的用途」里有一行（因为它是 `auth: none` + 按 IP 认证，没独立分区）。删掉后那一块从 9 行变 8 行。

### 对上游融合清单的影响

上游 `cnki` 模块的 5 条 provides **全部随之废弃**，不再计入覆盖率分母。审计报告（`coverage-audit-batch-b.md`）里那一节的数字是**删除前**的历史记录，保留原文不动 —— 它记的是「当时本仓做到什么程度」，而这份决定记的是「以后不做」。


---

## 十三、本轮交付（2026-11-11 下午）

这一节登记**本轮真正做完**的东西，避免下次又把已修的当待办（本轮开头就踩过一次：
Z-1 / X-3 / 锁文件都已修，清单还标着「待裁决 / 待补」）。

### 13.1 设置分区：所有数据源统一行为

六个分区的两张卡片现在按**配置状态**自动展开：

| 状态 | 凭证卡片 | 状态卡片 |
| --- | --- | --- |
| 已配置 | 收起 | **展开** |
| 未配置 | **展开** | 收起 |

应用到 `pta` / `xxt` / `cc98` / `lab` / `mail` / `login`。

**底层**：`Card` 加可选受控属性 `open` / `onOpenChange`。不传时行为与以前
完全一致（内部 `useState`），所以现有 9 处调用一行都不用改。

`defaultOpen` 做不到这件事 —— 它是 `useState` 的初值，只在挂载时生效，
而「配没配」是异步读回来的。

### 13.2 新增两个独立分区

| 分区 | order | 凭据 | 说明 |
| --- | --- | --- | --- |
| 实验课平台 | 62 | `zhiyun-lab/account` | `auth: "own"`，有**自己的密码** |
| 浙大邮箱 | 66 | `zhiyun-mail/account` | `auth: "own"`，16 位客户端专用密码 |

两者都从「浙大一卡通」的「这份凭据的用途」列表里移出 —— 它们不是 CAS 一套，
混进去会让用户以为"配了一卡通就能用"。

**邮箱这一版只做专用密码**。CAS / OAuth2 路径要邮箱服务端注册的 `client_id`
才能走 XOAUTH2，记为后续工作（用户明确说过「后续再想办法做 cas」）。

### 13.3 CAS 登录失败自动重启

照上游 `zdbk/client.ts:113-123` 的实测结论，抽成 `createCasRetry`：

- 只重试一次（连续失败是密码/权限问题，再试只是拖时间）
- 凭据类错误（`CREDENTIALS` / `AUTH_REJECTED`）不重试
- 重试前等 1.5 秒，并清掉目标域 cookie（残票会让重试"以为已登录"）
- **同 entry 并发去重** —— 这一条是本仓补的：九个数据源同时要会话时，
  不去重就会并发登九次 CAS，而 CAS 的票**后登的作废先登的**

`casTransport` 与 `casLoginFor` 走同一个函数，避免两份实现漂移。

### 13.4 设置页状态探测改成 C 方案

真探测要发网络请求、有几项还要真登录一次。现在：

- `GET` 只回缓存；没探过就是 `UNKNOWN`（「未检测」），**不编状态**
- 只有显式 `POST probe` 才真探一遍并记录采样时间

顺带修三个真 bug：

| # | 缺陷 | 症状 |
| --- | --- | --- |
| P-1 | `probeCampusSource` 查已退役的 `zhiyunCampus` | 「学在浙大」**恒**显示「数据源未启用」，即使装着 |
| P-2 | `egress.state()` 的 `campus` 在没探测过时是 `'unknown'`，被误判成「校外」 | 同一时刻 xuezai 会话探测成功、出口却说「校外且未配 WebVPN」—— 两个结论互相矛盾 |
| P-3 | `sztz.ready(...).catch is not a function` | `ready()` 是同步的，探测按 Promise 调。四个包同时因此恒红 |

### 13.5 `tool/campus-write` 的致命解构错误

```js
const [definition] = build(services());   // build 返回单个对象
```

对非数组解构得到 `undefined` → **7 个工具的执行路径此前从未工作过**，
每次都 `TypeError`。此前的 16 条测试全只测 `prepare`，所以没暴露。

已修，测试改用**真实 `apply()`** 驱动而非替身。

### 13.6 废弃知网

见第十二节。

### 13.7 仍未做

| # | 条目 | 状态 |
| --- | --- | --- |
| A-4 残留 | `yjsy` 的凭据接线 | 它要的是取 token 回调，与其余五个信道不同，待单独看 |
| X-4 | `tyys` 取验证码题面被 `READ_POSTS` 拒 | 受 K-1 阻塞 |
| K-1 | `tyys` 点字验证码算不算「绕过人机校验」 | **仍待裁决** |
| W-* | 约 30 条写操作/只读缺口 | 见第一、六、七节，未动 |
| D11 | `tool/campus-write` 挂哪个 preset | 仍待裁决 |
| D14/D15 | 7 个页面 | 未开始 |
| proc 层 | 9 个包 | Q-D 范围未定 |
| 邮箱 CAS | XOAUTH2 路径 | 需 `client_id` |
