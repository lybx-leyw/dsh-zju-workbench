# 遗弃记录

> **这份文档回答一个问题：上游的东西，哪些我们决定不要了？依据是什么？**
>
> 与 [`coverage-gaps.md`](coverage-gaps.md) 的分工：
> - `coverage-gaps.md` 记「**还差什么**」（待补的活）；
> - 本文件记「**已经决定不要什么**」（遗弃的活 + 它的依据 + 承接方到底在不在）。
>
> 两者的交界：一条能力若**没有依据**地被放弃，它不算遗弃，必须回到 `coverage-gaps.md` 记**待补**。
> 这条规矩来自本项目最重的一次流程事故，见 `coverage-gaps.md` 第五节
> 「我把自己判断的『不做』写成了『裁决』」。

最后核对：2026-11-11

---

## 零、怎么读这份文档

| 状态 | 含义 | 允许吗 |
| --- | --- | --- |
| **已遗弃（有依据）** | 有一条编号裁决、或一条本仓硬约束支撑 | ✅ 允许，但必须写清依据 |
| **已遗弃（待裁决）** | 想不做，但**没有**裁决支撑 | ⚠️ 只是暂缓，实质仍是待补 |
| **遗弃了一半** | 裁决说归别处，但**承接方不存在** | ❌ 这是最危险的状态，见第三节 |
| **不成立** | 原先的遗弃理由本身是错的 | ❌ 必须改判待补 |

**判据只有一条**：能不能指向一条**编号裁决（D1–D21）**或一条**本仓硬约束**
（不跑 `npm install`、不绕过人机校验、不自动化支付、不伪造定位…）。
指向不了，就不许写「不补」。

---

## 一、裁决落地核对（D1–D21）

**这一节回答「清单里剩下的已裁决项目处理完了没有」。**
逐条把裁决的**原文要求**与**仓库里的实际状态**对齐；「落地了吗」这一列是判断，
证据列是可以自己重跑的命令或文件位置。

| # | 裁决（原文要点） | 实际落地 | 落地了吗 | 证据 |
| --- | --- | --- | --- | --- |
| D1 | 数据源范围：18 个全接 | `packages/source/` 下 **22 个**包：4 个 tier 0（`http` `webvpn` `login` `netproxy`）+ 15 个 tier 1 数据源 + 3 个 agent skill 包 | ✅ 完成（且超出：多出了 `netproxy` 与 3 个 skill 包） | `ls packages/source`；profile 挂 18 个 |
| D2 | 新建本仓结构包，**不搬 vendor 内代码** | 源码里没有一条 `import` 指向上游树；只有注释里的溯源说明 | ✅ 完成 | `grep -rn "from .*vendor/zju-assistant" packages/*/*/src` → 空 |
| D3 | 写操作改用宿主 `ctx.approval` + 薄封装 | `tool/campus-write/src/approval.js` 消费 `ctx.approval.request`，四种返回值分流，`fail closed` | ✅ 完成 | `tests/campus-write.test.mjs` 的审批 5 条 |
| D4 | WebVPN 采用上游规则（模块声明 + 主机表 + 会话降级） | `webvpn/src/hosts.js`（public / campus / unknown 三态）+ `egress.js` 的 `downgraded` 集合 | ✅ 完成 | `zju-assistant-webvpn-coverage.md`：21 融合 / 4 偏离 / 2 丢弃 |
| D5 | 未知主机回退后缀规则 | `egress.js:144` `unknown → isCampusHost()` 后缀回退 | ✅ 完成 | `hosts.js:239-248` |
| D6 | 降级语义会话内持久 | `egress.js:261,396,414`：`downgraded` 是 Set，`forget()` 才清 | ✅ 完成 | 同上 |
| D7 | 移植探测脚本 | `packages/source/webvpn/scripts/probe-hosts.mjs`（**在包内，不在根 `scripts/`**，与旧文档写的路径不同） | ✅ 完成 | `find . -name "probe-hosts*"` |
| D8 | 拆开 `source/campus`（学在与 PTA 分离） | `source/campus` 已删；`retiredBundles` 登记了 `@lybx-leyw/dsh-zju-source-campus` | ✅ 完成 | `scripts/profile.mjs:51` |
| D9 | 邮箱**拆 4 个包**（source / tool / core / client） | **只做了 1/4**：`source/mail` 在；`tool/mail`、`core/mail-feed`、client 的 `MailSettings` **都不存在** | ⚠️ **部分** | `ls packages/tool`（只有 `campus-write` `study`）；`ls packages/core \| grep mail` → 空 |
| D10 | 总则：不要嫌麻烦，规则与无损优先 | 无法机械核验 | — | — |
| D11 | preset：延迟决定，位置在拓扑最顶层 | 未决策；`packages/preset/` 只有 `lecture` | ⏸ 按裁决延迟 | `ls packages/preset` |
| D12 | skill：新增（如何新增延迟） | `docs/contributing/skills/` 下**没有** `zju-campus`；`packages/skill/` 不存在 | ⏸ 按裁决延迟 | `ls docs/contributing/skills` |
| D13 | lab：先实测再建包，失败不得直接判不可行 | 已建包；实测记录在 `impl-plan.md:391`（SPA 86 端口 200、API 8098 可达、登录端点返回「用户名或密码错误」= 协议正确） | ✅ 完成 | 同上 |
| D14 | 骨架继续用 dsh-pages（`page.content`） | 本仓页面全走 `page.content`；`page-registration.jsx` 是统一入口 | ✅ 完成 | `grep -rn "page.content" packages/client` |
| D15 | 数据通道一律接本仓 core/source，不移植上游 handler | 页面用 `fetch('/_dsh/zhiyun-*')`；上游 `plugin/host/` 未移植 | ✅ 完成 | `page-today/src/client.jsx:41` |
| D16 | Q-D：学习页聚合移出数据源范围 | `core/campus-learning` 未建（P2-10 未做） | ✅ 按裁决不做 | 见第四节 |
| D17 | 写操作进 `tool/` 并注册成 AI tool；读进 `source/` | 22 条写操作里 22 条都在 `source/*` 的 `writeMethods`，`tool/campus-write` 收 7 个工具。**但见第二节 A-5**：工具层走不到其中 8 个动作 | ⚠️ **结构合规、行为不合** | 见 `coverage-gaps.md` 第八节 |
| D18 | CAS 取票件抽进 `source/login` | `source/login/src/cas.js` 导出 `casLogin` 等 7 个符号；`zdbk` 的 `cas.js` 只剩三个教务专有常量 | ✅ 完成（`zdbk` `xuezai` 已用） | `zdbk/src/cas.js:40` |
| D19 | 3 个 skill 包删除 `cordis.patch.yml` | 三个包都**没有** patch 文件 | ✅ 完成 | `ls packages/source/{weread,wechat-chat,dingtalk-chat}` |
| D20 | skill 发现机制：待裁决 | 仍是待裁决；`packages/skill/` 不存在 | ⏸ 按裁决延迟 | — |
| D21 | 下载归 `core/*`；`source/*` 只暴露参数 | ⚠️ 见 1.1 —— **2026-11-12 已更正口径**：原文被 agent 加了「不碰文件系统」，用户从未如此裁决。按更正后的口径，source 侧落盘**不是违规**；真正的缺口只剩「core 里没有下载执行方」与「参数无消费者」 | ⚠️ 部分，见 A-1~A-3 | `grep -rn "downloadParams\|saveFiles\|downloadTo" packages/core` → 空 |

### 1.1 D21 是本轮最大的问题（单独展开）

> **⚠️ 2026-11-12 更正**：这一节原来把「`source/*` 不碰文件系统」当成用户裁决，
> 并据此把 `cc98` / `classroom` / `mail` 的落盘判成「架构违规」（连 `upstream-gap-audit`
> 的 B-7 也照抄了这条）。**用户明确否定了这个限定** —— 他说的是「下载归 core」，
> 没有说 source 不许写文件。下面的口径已按此更正。

D21 原文（`impl-plan.md:61`，已更正）：

> **下载由 `packages/core/*` 执行；`source/*` 只暴露下载所需的全部参数（url / headers / 文件名 / 预期大小 / 变体）**

两个方向的实际状态：

| 方向 | 要求 | 实际 | 证据 |
| --- | --- | --- | --- |
| core 侧 | 有一个下载执行方 | **没有**。`packages/core/` 28 个包 grep `downloadParams` / `saveFiles` / `downloadTo` / `downloadFile` 全空 | `grep -rn "downloadParams\|saveFiles\|downloadTo" packages/core` → 空 |
| source 侧 | 暴露下载所需的全部参数 | **多数做到了**，个别没做全（`zdbk` 只回 `pdf_url`）。**顺带落盘是允许的**，不再算违规 | `grep -rln "createWriteStream\|writeFile" packages/source/*/src` |
| 参数与执行之间 | 有「谁接参数」的说明 | **没有**。`xxt` 的 `downloadParams` 返回 `{url, variant, filename, size, headers, note}`，全仓无消费者，也没有一句说「交给谁」 | `grep -rn downloadParams packages` 只命中定义处与自述注释 |

**判读**：D21 是一条**没有派生出实施任务**的裁决。它写在清单里，看起来像已定方案，
但没人去 `core/` 建那个执行方。
`coverage-gaps.md` 的 W-30 记了其中两条（`xuezai` 的下载），漏了 `zdbk` / `cc98` / `xxt` 三条。

**这也是一条关于「记录本身会腐化」的实例**：一条裁决在被转述时被加了限定词，
之后所有引用它的文档都继承了那个限定，并据此报出 12 处「违规」——
而那些「违规」全都不成立。

**这也是本仓自主记下的那条教训的第三个实例**：
> 「引用一条裁决」不等于「问题已解决」。

前两个实例是 W-30（xuezai 下载）与 W-17→W-29（球面反推）。

---

## 二、真正遗弃的条目（有依据，改判为「不做」）

> 每一行都必须能回答：**依据是哪一条**？没有依据的行不许留在这里。

| # | 能力 | 依据 | 依据的类型 | 理由 | 证据 |
| --- | --- | --- | --- | --- | --- |
| **N-1** | `pta` 自动登录（邮箱 + 密码 + 验证码组件取票） | 硬约束：不自动化短信/人机验证 | 安全约束 | 拼题A 的 `requireMfa` 要短信验证码。上游自己的做法也只是「打开官方验证码组件」，不是纯自动化。本仓只收 Cookie（且支持 4 种粘贴形态，比上游多）。**能力在，输入少一种** → 判 B 不判 C | `pta/README.md:79-82`；`index.js:27-31`；`tests/pta*.test.mjs` |
| **N-2** | `cnki` 滑块**求解器** | 硬约束：不绕过人机校验 | 安全约束 | 上游 `slider.ts` 是滑块拼图求解器。本仓只做「检测到滑块 → 如实报」，不实现绕过 | `audit-cnki.md:61` 原话「不搬滑块拼图求解器是可辩护的范围决定」；`cnki/src/` 无 slider |
| **N-3** | `classroom` 内置 `sherpa-onnx-node` + SenseVoice 模型权重 | 硬约束（不跑 `npm install`）+ D21 | 流程约束 | ASR 内核与 240 MB 权重属安装层。本仓给注入口 `setTranscriber`，内核由装配方提供。**注意 W-6 是另一件事**：`setup` 这个**动作**（谁来装）没实现 | `classroom/src/asr.js:94`；`source.js:587` |
| **N-4** | `tyys` 支付链路（`payAndVerify`） | 硬约束：不自动化支付 | 安全约束 | 上游要处理零元确认与真实支付。本仓到「预下单 + 提交」为止 | `tyys/src/writes.js` 无 `pay` |
| **N-5** | 上游 `zju` CLI 入口整体 | D17（读写分层）+ 本仓无 CLI | 分层 | 上游 `cli.ts` 是命令行入口。能力逐条映射到服务方法，**能力不丢、形态不同** | `webvpn-coverage.md:99-101` 给了映射先例；`tool/zju` 未建（见第四节） |
| **N-6** | `webvpn` 的 `rewriteFor` / `openContext` | 分层（结构转换） | 分层 | 本仓对应物是 `egress.js` 的 `downgraded` + `hosts.js` 归属表。`openContext` 的 CAS 注入在本仓属 `source/http` + `source/login`，搬进 tier 0 会反向依赖 | `webvpn-coverage.md:60-72` |
| **N-7** | `README` 里「本包只读」的**措辞**（`zdbk` / `cc98`） | — | — | **不是能力问题**：这两个包的 source 侧**确实**有写方法（`writeMethods` 列了），README 第 6 / 第 2 行仍写「只读」。这是**文档与代码矛盾**，不是遗弃。已在 `coverage-gaps.md` 记过，本轮见第五节 | `zdbk/README.md:6`、`cc98/README.md:3` vs 两处 `readOnly: false` |

### 2.1 改判：原以为是遗弃，其实不成立

| # | 原判断 | 为什么不成立 | 改判为 |
| --- | --- | --- | --- |
| **N-7 old** | `xuezai` 雷达点名的球面最小二乘反推「不做」 | 没有任何裁决支撑。「上游没做我们也别做」不是理由。上游有明确的 100 位精度 Gauss-Newton 实现，而本仓有 13 个参考点与它们返回的距离 —— **输入是齐的，只是没写那一步** | **W-29 待补** |
| **N-8 old** | `tyys` 同伴参数「本包不做」 | 已由代码自己改正：`writes.js:165-171` 现在抛 `NOT_IMPLEMENTED` 并说清「本仓还没实现代填同伴信息」。`NOT_IMPLEMENTED` ≠ 遗弃 | **W-7 待补** |
| **N-9 old** | `pta` `homework start`「不做」（理由：替用户开作业会让计时跑） | 该理由只对「自动开」成立，对「用户点了批准」不成立 | **W-1 待补** |
| **N-10 old** | `chalaoshi` 的 `course`（课程绩点表）「解析留给消费方」 | 「留给消费方」不是裁决，而且数据源自己不做解析等于把上游能力丢给每个调用方各写一遍 | **W-14 待补** |
| **N-11 old** | `pta` 的 `submission list` / `view` / `reconcile`「属于写链路」 | 三条都是纯 GET 读（`query.ts:85-95`；`write.ts:85` 注释写明 reconcile「只读」）。归类错误 | **W-9 待补** |

**这一节是本文件的核心**：以上 5 条曾经被当作「不做」，逐条核对后没有一条站得住。

---

## 三、遗弃了一半：裁决说归别处，承接方不存在

**这是最危险的一类** —— 在组织图上问题「已解决」，在代码里不存在。

| # | 能力 | 裁决/设计说归谁 | 承接方在吗 | 后果 |
| --- | --- | --- | --- | --- |
| **A-1** | `xuezai` 的 `material download` / `homework download` | D21 → `packages/core/*` | ❌ 不存在 | 学在浙大的课件与作业附件**下不下来** |
| **A-2** | `zdbk` 培养方案 PDF（`downloadPdf`） | D21 → core | ❌ 不存在（`zdbk/README.md` 自己写「丢弃」但没引 D21） | 培养方案只能拿到 `pdf_url`，拿不到文件 |
| **A-3** | `xxt` 的 `downloadParams`（课件 / 视频） | D21 → core | ❌ 参数接口正确，**无消费者** | 用户拿不到学习通课件，也看不到「该把参数交给谁」 |
| **A-4** | 六个包的**凭据/会话注入口**（`setCredentialProvider` / `setLoginProvider` / `setSessionProvider` / `setTokenProvider` / `setServiceLoginProvider`） | 设计说「由集成层注入」 | ✅ **六个全修**：`ecf080f` 把 `lab` / `mail` 改成读 `source/login` 的记录、`sztz` / `tyys` / `notice` 改走共享 `casTransport` / `casLoginFor`；`yjsy` 补了共享 CAS 兜底（`validateLogin` 那一跳在本包发，因为 `dataapi` 前缀只有它知道） | 见 3.1；六行的实测结论已全部作废 |
| **A-5** | 8 个写动作的**工具层入口** | D17 → `tool/campus-write` | ⚠️ 工具存在，但**参数契约对不上** | 退课/调序、场馆预约、交/撤作业、点名、评分、选实验**点了就报错**（见 `coverage-gaps.md` 第八节） |
| **A-6** | `classroom` 的 `trans audio` 识别内核 | 本仓设计 → 装配方注入 `setTranscriber` | ❌ 无装配方 | 转写**必然** `DEPENDENCY_MISSING`（漏-4） |
| **A-7** | `source/http` 的 `setWebvpnSession` | 本仓设计 → 装配方 | ❌ 无调用方 | 校外场景 `source/http` 仍抛 `WEBVPN_REQUIRED`（R-3） |
| **A-8** | `tool/mail` / `core/mail-feed` / client 的 `MailSettings` | **D9（编号裁决）** | ❌ 三个包都没建 | 邮箱只能读（`source/mail`），发信与后台轮询没有承载方 |

### 3.1 A-4 的实测（本轮新发现）

方法：把六个包各自 `apply()` 到一个最小 ctx（`ctx.get` 返回 `undefined`、无 `credentials` 服务）上，
再调它们的读方法与 `ready()`：

```
lab     ready=false   CONFIG: 实验课平台还没接入登录…（若你是插件作者：调用 setCredentialProvider）
tyys    ready=false   CONFIG: 还不知道用哪个账号查体艺：到「设置 → 浙大一卡通」配置学号后重试。
sztz    ready=false   CONFIG: 素质拓展平台还没接入登录…（若你是插件作者：调用 setSessionProvider）
mail    ready=false   CONFIG: 浙大邮箱还没有可用的客户端专用密码…（若你是插件作者：调用 setCredentialProvider 注入。）
yjsy    ready=false   CONFIG: 研究生教务网还没接入登录…（若你是插件作者：调用 setTokenProvider 注入取 token 的能力）。
notice  ready=false   匿名可用（status: partial，11 个来源读不到）
```

对照可用的一批：`zdbk` / `xuezai` / `classroom` / `cc98` 直接
`import { readCard } from '@lybx-leyw/dsh-zju-source-login'`，自己读宿主凭据服务，
**不需要装配方**，所以它们能工作。

两种设计并存本身不是错，但结果是「六个包不可用、四个包可用，而文档里都写着已完成」，
且这个区别**在任何一份文档里都没写**。`profiles/zju-workbench/cordis.patch.yml` 只有
`dsh-pages` 一条配置，没有任何注入代码。

**证据强度**：静态 grep（`setXxxProvider` 除定义处与测试外零命中）+ 最小替身实测。
**没有**在真实 profile 上跑过一次真机（那需要账号）。

> **2026-11-11 复核**：上面六行里五行的结论**已作废** —— `ecf080f` 按 D18 给
> `source/login` 补了 `casTransport` / `casLoginFor` 两项共享能力，`lab` / `mail`
> 改为读 `source/login` 的记录，`sztz` / `tyys` / `notice` 改走共享 CAS。
> 复核命令：
>
> ```bash
> for p in lab tyys sztz mail yjsy notice; do
>   printf '%-8s %s\n' $p "$(grep -o 'readCard\|readLab\|readMail\|casTransport\|casLoginFor' packages/source/$p/src/index.js | sort -u | tr '\n' ' ')"
> done
> ```
>
> 结果是 `lab` → `readCard readLab`、`mail` → `readMail`、`sztz` / `tyys` / `notice` →
> `casTransport` / `casLoginFor`。`yjsy` 在 `ecf080f` 之后**仍然为空**，所以本票
> 把它的兜底也补上了：`tokenFromSharedCas()` 用 `card.casLoginFor()` 拿票、
> 自己发 `validateLogin` 换 token，`ready()` 也把这条路算进「已接入」。
> 复核：`node --test tests/yjsy-host.test.mjs`（13 条，含三条新增的共享 CAS 用例）。

### 3.2 A-5 的实测（本轮新发现）

`node scripts/probe-write-contract.mjs`（已提交进仓）按工具层实际传的参数喂给真的 source：
**22 条探针，通 14，不通 8**。
明细在 `coverage-gaps.md` 8.1 / 8.2。

最严重的两条：

| 工具 | 症状 | 用户会看到什么 |
| --- | --- | --- |
| `campus_course_select` + `drop` / `reorder` | 缺 `section` | 「需要 section（教学班号，来自 selectionSelected 的 section）」—— 而工具参数表里 drop / reorder 根本没有要求 `section` |
| `campus_checkin` + `xuezai` | `resolveActivity(undefined)` | 「需要 homework（作业编号）」—— 用户在点名，却被问作业编号 |

**为什么测试全绿**：工具层测试用假 source（`tests/campus-write.test.mjs` 的
`fakeSource` 只有 `selectCoursePrepare` 一个函数），source 层测试直接调 `prepare`
并**按 source 的写法给参数**。两层之间那道缝从来没有测试跨过。

---

## 四、明确「不做」但不属于遗弃（裁决本身的产物）

这些不是「我们放弃了上游能力」，而是**裁决改变了形态**：

| # | 项 | 裁决 | 说明 |
| --- | --- | --- | --- |
| P-1 | 上游 `plugin/host/` 的 `/api/zju-campus` handler | D15 | 改接本仓 core/source，handler 不移植 |
| P-2 | 上游用顶层 `- insert:` 挂工具的方式 | D11 的推理 | 会注册成全局工具（上游那个「9 个工具出现在所有会话」的根因）；本仓要求走 preset 的 `config.plugins` |
| P-3 | 上游 `Memos` / `Notes` / `Feed` / `NoticeContent` 当「页面」 | D14 | 它们是 `AffairsPage` 内部的两栏组件，不是页 |
| P-4 | 上游 `source/campus`（学在 + PTA 混装包） | D8 | 已删，登记进 `retiredBundles` |
| P-5 | 13 个待建数据源里进 `core/` 的部分 | 分层硬约束 | 「涉及数据的一律进 source 或 tool」，`core` 不放数据源 |
| P-6 | `pta.session` 的 `dataDir` 变更 | R-1 硬约束 | 那条会话是「短信验证 → 手工粘贴」来的，丢了无法自动恢复；拆包**绝不可**动 `dataDir` |
| P-7 | `chat-watch.mjs` / `model.mjs` / `vision.mjs` / `ffmpeg.mjs` / `identity-fill.mjs` / `colleges.mjs` 等 | `impl-plan.md:484-491` 的建议 | 建议合进别的包或随模块，**不是遗弃**；但清单里从未给过裁决，本轮**不当作已决**（仍是待定，见第七节） |

---

## 五、文档与代码矛盾（不是遗弃，但会误导后来者）

| # | 位置 | 写的 | 实际 | 处理 |
| --- | --- | --- | --- | --- |
| 1 | `zdbk/README.md:6` | 「**只读**。选课的选/退/排序是写操作，归 tool」 | source 侧有 3 个写方法并注册在服务面上（`readOnly: false`） | 口径应改成「读方法在此、写方法也在 source 但只经 tool 批准调用」 |
| 2 | `cc98/README.md:3`、`cc98/src/index.js:2,27-28,85` | 「只读数据源」「本包没有任何会改变论坛状态的入口」 | 8 个写方法，`readOnly: false`，`writeMethods` 16 个方法名 | 同上 |
| 3 | `xxt/README.md:20,85`、`xxt/src/index.js:26,148` | 「9 个只读方法」 | `XXT_METHODS` 是 **12 个** | 数量要改 |
| 4 | `cnki/package.json:4`、`cnki/src/cnki.js:2,6-7,17` | 「文献检索与**全文 PDF 下载**」 | `src/` 下**零下载代码** | **虚假声明**，必须改（W-10） |
| 5 | `classroom/README.md:190,197` | 小标题「`setup` **明确不做**」，同段又写「交给宿主安装层」，并引「W-8」 | `setup` 是 W-6；且「明确不做」与「交给宿主」自相矛盾 | 措辞与编号都要改 |
| 6 | `xuezai/src/writes.js:460` | 「已记进 coverage-gaps.md 的 **W-6**」 | 球面反推是 **W-29**（W-6 是 classroom 的 setup） | 编号要改 |
| 7 | `coverage-gaps.md` 零之二 | 「已记 W-17」 | W-17 从未定义；应为 W-29 | 编号要改 |
| 8 | `notice/src/index.js` | `inject = []`、`requires: [source-http]`，README 说 CAS 由集成层注入 | 与 A-4 同类 | 已在第三节记 |

**为什么这些要单独列**：本仓的判断口径里有一条是「没做的有没有如实说 —— 编个理由比不做更糟」。
上面第 4 条是**编了一个不存在的实现**（不是编理由），比编理由更糟：
它让下一个接手的人不会去查「下载到底做了没」。

---

## 六、遗弃条目的数量对账（两种方法各算一遍）

| 口径 | 数字 |
| --- | --- |
| 有依据的遗弃（第二节 N-1 ~ N-6） | **6**（N-7 是文档矛盾，不算） |
| 改判为待补的「曾以为遗弃」（2.1） | **5**（原 N-7 ~ N-11） |
| 遗弃了一半（承接方不存在，第三节 A-1 ~ A-8） | **8** |
| 裁决改变形态（第四节 P-1 ~ P-6，不含 P-7 待定） | **6** |
| 文档矛盾（第五节） | **8** 处 |

第二种算法：把 `coverage-gaps.md` 第四节的表逐行数 → N-1 ~ N-7 共 7 行，
其中 N-7 本轮改判待补 → **6 条遗弃**。与上面一致。

---

## 七、仍未裁决、本轮不自行决定的事项

按「不得自行裁决」的规矩，下面这些**只记录、不决定**：

| # | 事项 | 为什么需要裁决 | 卡住了什么 |
| --- | --- | --- | --- |
| Q-1 | `doc` 模块（4 条 provides）归哪一层 | 它读本地文件（不连外部 → 不该进 source），做变换与落盘（→ core 合理），但和 D21 的「下载归 core、source 给参数」不是同一形状 | 文档转文字、PDF 合成/取页/找页**整块没有归属** |
| Q-2 | D9 的邮箱另外 3 个包还建不建 | D9 已裁「拆 4 个包」，但 `tool/mail`（发信走审批）、`core/mail-feed`（后台轮询基线）、client 的连接表单都没建 | 邮箱只能读；发信与「有没有新信」没有承载方 |
| Q-3 | A-4 的装配层放哪 | **已按「各 source 包自己取」落地**：读凭据的用 `readCard` / `readLab` / `readMail`，走 CAS 的用 `casTransport` / `casLoginFor`；`yjsy` 用 `casLoginFor` 拿票后自己发 `validateLogin` | ✅ 不再卡住任何能力 |
| Q-4 | A-5 的 8 处契约断裂修哪一侧 | 改工具层（要给模型加参数）或改 source（要接受自然语言定位），两条路都改已发布契约 | 8 个写动作不可用 |
| Q-5 | D21 怎么落地 | 要么在 core 建下载执行方，要么**改裁决**（承认 source 可以落盘）。现状是两边都不成立 | 所有下载能力 |
| Q-6 | D11 preset / D12 skill / D20 发现机制 | 原裁决就是「延迟」 | 工具可见范围、skill 形态 |
| Q-7 | proc 层（P2-1 ~ P2-11）全部未建 | `impl-plan.md` 第 2 层列的 11 个包，`packages/core/` 里**一个都没有**（`campus-*` 前缀零命中） | 校历、课表合并、作业聚合、通知汇总、档案、备忘录… |
| Q-8 | `tool/` 层其余 6 个包 | `tool/zju` / `tool/campus` / `tool/mail` / `tool/campus-wechat` / `tool/campus-chat` 都没建；已建的 `campus-write` **没有挂进 profile 也没有挂进 preset** | 22 条写能力**在实机上没有任何入口** |
| Q-9 | 7 个页面（U-1 ~ U-7） | 上游 4 个真页 + 7 个配置页，一个都没移植 | 日程表、校园事务、学习、通知、档案视图 |

> Q-8 值得单独说：`tool/campus-write` 是本轮验证过「审批逻辑正确」的包，
> 但它既不在 `profiles/zju-workbench/package.json` 的 bundles 里，
> 也不在 `packages/preset/lecture/cordis.patch.yml` 的 plugins 树里
> （那份 preset 只加了 `tool-study`）。按 D11「不要挂进 profile bundles」是对的，
> 但 preset 也没定，所以**它在实机上根本不加载**。
