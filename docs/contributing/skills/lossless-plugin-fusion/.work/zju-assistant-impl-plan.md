# zju-assistant 无损融合 · 实现清单

**版本**：v2 · 2026-11-09（2026-11-11 补落地状态）
**状态**：**第 1 层（数据源）基本落地；第 2/3/4 层（proc / tool 其余 / preset / skill / 页面）未动手。**
逐条落地核对见 [`abandoned.md`](abandoned.md) 第一节；还差什么见 [`coverage-gaps.md`](coverage-gaps.md)。
**依据**：第 1–6 步（泳道图 / 入口映射 / 剪枝裁决 / 整合清单）+ WebVPN 独立计划 + 多轮裁决。

> ⚠️ **这份清单是「当时怎么决定」的记录，不是进度表。** 它的每一节写的是计划，
> 有几节已经过时（例如 S-15 邮箱写「拆 4 个包」，实际只建了 1 个）。
> 判断「做完了没」请看 `abandoned.md` 的 D1–D21 核对表。

---

## 总则（压倒一切）

> **不要嫌麻烦，项目规则和尽可能无损放在首位。**
>
> - 宁可拆成多个包各自守单一职责，也不要为了省事把数据源、工具、状态加工、界面揉进一个包。
> - 「上游就是这么写的、能跑」不是合并职责的理由；「本仓规则要求这样分层」才是拆分的理由。
> - 任何为了少建一个包而做的妥协，必须在清单里写明代价，交用户裁决。

## 分层硬约束

| 层 | 能放什么 | 不能放什么 |
| --- | --- | --- |
| `packages/source/*` | 连外部站点、只提供事实 | 变换、跨会话状态、UI |
| `packages/core/*` | 变换、状态、路由 | **数据源**（不连外部站点） |
| `packages/tool/*` | agent 工具注册 | 业务实现 |
| `packages/client/*` | 只含 UI | 数据获取 |
| `packages/preset/*` | 工具可见范围 | 工具实现 |

**「`core` 不放数据源」的理由**（用户裁决）：`core` 若放数据源，就得同时拥有一个数据源操作对象；
而数据源对象本身属于 `source`，于是 `core` 又得依赖数据源 —— 矛盾。所以涉及数据的一律进 `source` 或 `tool`。

---

## 裁决汇总（已定，不再询问）

| # | 事项 | 裁决 | 出处 |
| --- | --- | --- | --- |
| D1 | 数据源范围 | **18 个全接** | 用户 23:08 |
| D2 | 融合形态 | **新建本仓结构包**，不搬 vendor 内代码 | 用户 |
| D3 | 写操作 | ~~新增 tier 0 审批包~~ → **改用宿主 `ctx.approval` + 薄封装** | 用户裁决「加审批包」+ `.ref` 取证修正 |
| D4 | WebVPN | **采用上游规则**（模块声明 + 主机表 + 会话内降级） | 用户 |
| D5 | 未知主机 | 回退到后缀规则 | 用户 |
| D6 | 降级语义 | 会话内持久，跟上游一致 | 用户 |
| D7 | 主机表维护 | 移植探测脚本 | 用户 |
| D8 | 拆包 | **拆开 `source/campus`**（学在与 PTA 分离） | 用户 |
| D9 | 邮箱 | **拆 4 个包**：`source/mail` + `tool/mail` + `core/mail-feed` + `client` | 用户 |
| D10 | 总则 | **不要嫌麻烦，项目规则和尽可能无损放在首位** | 用户 |
| D11 | preset | **Q-E 延迟决策**（工具注册完成后再定）；preset 定在拓扑最顶层 | 用户 |
| D12 | skill | **新增**（本仓无同类对象可并入）；**如何新增延迟**到工具注册完成后 | 用户 |
| D13 | lab | **先实测再建包**；上游说能通则相信能通；穷尽策略仍失败才上报用户 | 用户 |
| **D14** | **骨架** | **确认继续用 dsh-pages**（`page.content`）。上游页面一律改挂 `page.content`，**不碰宿主 `main`** | 用户 |
| **D15** | **数据通道** | **一律改接本仓 core/source**，不移植上游 `plugin/host/` 的 `/api/zju-campus` handler | 用户 |
| D16 | Q-D | **移出数据源范围**（学习页聚合不是纯数据源问题） | 用户 |
| **D17** | **读写分层** | **写操作一律进 `tool/` 并注册成 AI tool；读操作进 `source/`。cc98 与 classroom 同理拆包** | 用户 |
| **D18** | **CAS 取票件** | **抽进 `source/login` 插件包**（tier 0），供所有走 CAS 的数据源共用 | 用户 |
| **D19** | **skill 包不带 patch** | **`wechat-chat` / `dingtalk-chat` / `weread` 删除 `cordis.patch.yml`**（它们是 agent skill，无 `main`/`exports`，插 patch 会 `ERR_MODULE_NOT_FOUND`） | 用户 |
| **D20** | **skill 发现机制** | **待裁决** —— 这仓的 skill 怎么被发现/安装尚未确认；当前阶段专注数据源构建，遇到对应场景再问 | 用户 |
| **D21** | **下载归 core** | **下载由 `packages/core/*` 执行；`source/*` 只暴露下载所需的全部参数（url / headers / 文件名 / 预期大小 / 变体），不碰文件系统** | 用户 |

### D14 的落地含义

| 项 | 结论 |
| --- | --- |
| 页面挂载点 | `page.content`（keyed，由 dsh-pages 在 `shell.overlay` 下声明） |
| 宿主 `main` / `sidebar.panellist` | **不用** |
| 上游页面的导航调用 | `openRow()` / `openAlert()` 改调 `pages.selectPage(id)`；`handToAssistant()` 用 `uiWorkspace.startSession()`，**可不动** |
| 导轨与页面管理 | 继续用 dsh-pages 的，不重做 |

### D15 的落地含义

| 项 | 结论 |
| --- | --- |
| 数据来源 | 本仓 `packages/source/*` 与 `packages/core/*` 的服务 |
| 前端取数模式 | 照 `page-today`：`ctx.inject(['zhiyunStudyController'])` + `fetch('/_dsh/zhiyun-*')` |
| 上游 `plugin/host/` | **不移植**，只作行为参照 |
| 影响面 | 全部 7 页的数据层都要重写接线，工作量集中在「把上游 `dispatch(action, input)` 的 60 个 action 映射到本仓服务调用」 |

**⚠️ 这条决定了 U-1～U-7 的改造量都不是「换挂载点」那么小** —— 每个页面背后都是一次数据层重写。
必须逐页列出「上游 action → 本仓服务方法」的映射表，否则漏掉的 action 表现为「页面某块永远空白」。

---

## 拆包专项（D8 落地 · 溯源代理 5）

完整报告见 [trace-5-campus](zju-assistant-trace-5-campus.md)。**四件事必须记住：**

### R-1 · `pta.session` 不可自愈（最高风险）

三份会话同住 `<profile>/data/zhiyun-campus/`（`index.js:158,167-169`）：

| 会话 | 可恢复性 |
| --- | --- |
| `xzzd.session` | 可自动重建 |
| `pta.session` | **短信验证 → 手工粘贴**（`index.js:436-444`），**丢了无法自动恢复** |

→ **拆包绝不可顺手改 `dataDir`。** 七步方案里没有任何一步动它。

### R-2 · `{ xzzd, pta }` 是跨包契约

被三处钉死，拆完必须由 `planning` 拼回同一形状：

| 消费方 | 位置 |
| --- | --- |
| `core/planning` `petContext` | `src/index.js:1680-1682` |
| `client/page-planning` | `client.jsx:385-404` |
| 探针 | `scripts/source_bridge/xzzd.mjs:45`、`pta.mjs:43-51` |

坏法是「整个规划页没有数据」。

### R-3 · 旧 bundle 名必须登记 `retiredBundles`

`profile:init` 只清理 `retiredBundles` 里的名字（`scripts/profile.mjs:35-47,326-335`）。
Loader 解不开任意一条 bundle → **整个工作台起不来**（`profile.mjs:31-33`）。

→ Step 6 必须把 `@lybx-leyw/dsh-zju-source-campus` 加进 `retiredBundles`。

### R-4 · 兼容路由不可省

`/api/zhiyun-campus` 被三处硬编码：`client.jsx:39`、`scripts/source_bridge/xzzd.mjs:31`、`pta.mjs:31`。
且 `scripts/source-check.py:1040-1042` **对 `webServer` 路由整体 SKIP** —— 没有自动化会替你发现它断了。

→ Step 3 保留转发壳，最后再移除。

### 七步方案

| Step | 动作 | 验证 |
| --- | --- | --- |
| 0 | 冻结基线：记录 link/test/profile 输出 | 全绿 |
| 1 | 建 `source/pta`（`pta.js` 原样 + PTA 两行 hosts + 复制 reads + 窄 index） | `tests/pta-problems.test.mjs` |
| 2 | 建 `source/xuezai`（其余全部，**不搬 `cas/http.js`**） | `campus.test.mjs`、`xzzd-reads`、`campus-planning-contract`（`ZHIYUN_TODOS=slow` 仍绿） |
| 3 | **兼容层**：旧路由转发壳 | `source-check.py` 离线链全绿 |
| 4 | 改消费方（planning 三段 + login + radar，一次改完） | `tests/planning*.test.mjs` |
| 5 | 探针与测试迁移（13 测试 + 3 bridge + live-probe） | `grep -rn "source/campus" tests scripts` 只剩历史说明 |
| 6 | **装配收口**（单独提交）：删包 → `retiredBundles` → profile package.json → `CLIENT_PACKAGES` → ATTRIBUTION → 两个 patch | link **54/54** → build → `profile:init` → `profile:check` → 起得来 |
| 7 | 清理兼容壳；data 目录仍共用 | `npm test` + `source-check.py` |

### 这次溯源查出的死代码与文档不一致（顺手修）

| 项 | 位置 |
| --- | --- |
| `cas/http.js` 死文件 | 34 行，0 import 方 |
| `planning` 死分支 | `:1954-1962`（前一个 `if (campus)` 已排除） |
| 无消费方服务成员 | `fingerprint`、`ptaClient`、`routePath` |
| README 说仍 provide `zhiyunEgress` | `README.md:20-21`（早已删除） |
| README 验证命令不全 | `README.md:167` 只列 2 个测试文件，实有 13 个 |
| 缓存时长不一致 | `README.md:189` 与 `reads.js:4` 写 60 秒，`index.js:549` 是 **10 分钟** |
| 请求数不一致 | `index.js:474` 说 42 请求，`xzzd.js:9` 说 38，`xzzd.js:40,360` 说 55/60.8s |

---

## 第 0 层 · 新增基础设施包（tier 0）

### ~~P0-1 · 新建审批服务~~ → 已取消，改为 P0-1'

**原判断错误**：我曾据「`packages/` 全树 0 命中 `ctx.approval`」推出「本仓缺审批服务，需自建 tier 0 包」。
查 `.ref` 后推翻：宿主 `dsh-bundle-base` **强制装配** `@deepseek-ai/dsh-user-approval`
（`.ref/packages/bundle/base/cordis.patch.yml:259-262`），服务名就是 `ctx.approval`。
本仓 patch 层不写它，是因为它在 base 层，不是因为它不存在。

详见 [Q-A 裁决](zju-assistant-qa-approval.md)。

### P0-1' · `@lybx-leyw/dsh-zju-core-write-guard` 写操作审批封装

| 项 | 内容 |
| --- | --- |
| 目录 | `packages/core/zju-write-guard/` |
| 定位 | tier 0，**消费**宿主 `ctx.approval`，不提供服务 |
| 上游参照 | `plugin/host/approval.mjs`（26 行） |
| 对外 | `askToWrite(ctx, exec, { toolName, reason, displayReason }, notDone)` |
| 必须照抄 | · 无 `ctx.get('approval')` 或无 `exec.agent` → **抛错**<br>· 只有 `allowed-once` 才放行<br>· `rejected` / `cancelled` / `unavailable` 三种都抛错，措辞不同<br>· 用 `overrideOf(session) ?? config.policy` 判措辞（不判放行） |
| 宿主硬约束 | · **必须在已开启的 turn 内调用**（`index.ts:244-250`）→ 后台定时任务不能审批<br>· `never` 策略由服务内部兜底（`index.ts:301`），业务侧不得抢先判 |
| **返回值无法区分原因** | 子任务（policy 被钉 `never`）与用户点拒绝**都返回 `rejected`**。`askToWrite` 必须先看 `overrideOf(session) ?? config.policy` 与 `agents.roots()` 来选措辞，否则会给用户错误提示 |
| **后台任务的唯一正确写法** | 宿主**没有**「排队到下一个 turn」的审批通道（`user-approval/README.md:164` 明说 deferred，全仓 grep 0 命中）。后台要写操作只能 `agent.followup(message)` 唤醒真 turn，在那一轮里再 ask |
| ~~V-1~~ | **已关闭**：`roots()` 存在（`core/agent/src/index.ts:621-625`），上游写法在现有全部创建路径上不误报，且与宿主 `assertLiveRoot` 同模式。更精确的替代：`delegationDepthOf(agent) > 0`。见 [trace-2](zju-assistant-trace-2-approval.md) |

### 工具注册的硬规则（代理 1 溯源结论）

| 规则 | 依据 |
| --- | --- |
| `output` 必填，`{ type: 'json' }` 合法 | `core/tools/src/schema.ts:75-78,360-365`；编译成注解节点，校验退化为「任意无损 JSON」 |
| 名字不得为 `run_code`（无条件保留，禁遮蔽） | `core/tools/src/index.ts:145-147` |
| 同层重名 → 同步抛错 | `index.ts:63-71`、`core/scope/src/store.ts:43-45` |
| 跨层同名 → **静默遮蔽**，无日志无事件 | `index.ts:199-227` ← **隐患，需启动期自检** |
| 模型只见 `name/description/parameters/deferLoading` | `schema.ts:641-646` + `system-prompt/src/index.ts:649-654` |
| `parameters` 注册期不校验子集，投影期才报错 | `schema.ts:644` |
| 作用域来自 `scopeOf(ctx)`，不是参数 | `index.ts:148-152` → `store.ts:231` |
| `ToolRegistrationOptions` 只有 `when`，**无作用域参数** | `contracts.ts:104-124` |
| 测试 | 5 条：allowed-once / rejected / cancelled / unavailable / 无 agent |

### P0-2 · `@lybx-leyw/dsh-zju-source-webvpn` 出口策略升级（W1–W8）—— **已实现**

已出独立计划，见 [zju-assistant-webvpn-plan.md](zju-assistant-webvpn-plan.md)；
覆盖度对账与风险备注见 [webvpn-coverage](zju-assistant-webvpn-coverage.md)。

| 阶段 | 交付 | 改行为 | 状态 |
| --- | --- | --- | --- |
| W1 | `src/hosts.js`（主机表 + `classifyHost()`） | 否 | ✅ |
| W2 | `needsCampusNetwork()` 三级判定 + `hostNetwork` | 是 | ✅ |
| W3 | 会话内逐主机降级 + `nopermit` 页识别 | 是 | ✅ |
| W4 | `scripts/probe-hosts.mjs` 探测脚本 | 否 | ✅ |
| W5 | 登录页动态 key/iv（回退内置常量） | 是 | ✅ |
| W6 | `do-confirm-login` 二次确认（带 `onConfirm` 留痕） | 是 | ✅ |
| W7 | `probeWebvpnSession` + `importWebvpnTicket` | 否 | ✅ |
| W8 | `src/doctor.js` 网络诊断（凭据由调用方传入） | 否 | ✅ |

**爆炸半径**：`source/http/src/host.js`、`source/campus/src/egress.js` 直接消费，10 个数据源包全部受影响。
**保留**：`isCampusHost` / `isPublicHost` 作为 `unknown` 回退；「只重试 GET/HEAD」保护未被覆盖。

#### ⚠️ 风险备注（打勾前必读）

| 编号 | 风险 | 状态 |
| --- | --- | --- |
| **R-1** | **真实校外网络从未验证** —— 本机在校园网内，`probe:hosts` 按设计拒绝运行。协议层用假 transport 全覆盖，但真实网关未被触碰 | **未解除** |
| **R-2** | `HOSTS_GENERATED_AT` 是 2026-10-09 的快照，接手时已过期约一个月 | 已知 |
| **R-3** | `setWebvpnSession` 有时序要求，且**当前无人调用** → 校外场景 `source/http` 仍抛 `WEBVPN_REQUIRED`（cc98/zdbk/xxt 校外用不了）。**修好了「静默失败」，没修「能工作」** | **未解除** |
| **R-4** | 三处已知未修：`probeCampus` 失败不缓存/无去重、`fromWebvpnUrl` 不剥离 `vpn-12-o2-`（当前无触发）、IPv6 主机名被拒 | 已知 |
| **R-5** | `webvpn check --host` 缺服务面版本（只有维护者脚本） | 已知 |
| **R-6** | 全仓 26 个既有测试失败与本批无关（严格比对：基线 27 → 26，新增 0） | 已核实 |

**结论**：可作为「**实现完成**」提交，**不能标为「验收通过」**。打勾需 R-1 与 R-3 解除。

---

## 第 1 层 · 数据源包

图例：**新建** = 新包 ｜ **扩展** = 在现有包加方法 ｜ 方法数列为上游有、本仓无的缺口。

### S-01 `zdbk` 教务网 —— 扩展 `packages/source/zdbk`

| 项 | 内容 |
| --- | --- |
| 现有（取证） | `src/reads.js` 4 方法：`grades:116` / `gpaSummary:148` / `exams:178` / `timetable:208` |
| 上游能力 | `module.json` 列 16 条 provides：timetable / exams / grades / **plan view** / **plan list** / **selection context** / **selection courses** / **selection search** / **selection sections** / **selection selected** / **selection credits** / **selection select** / **selection reorder** / **selection drop** / session 3 条 |
| 缺口（读） | `plan view`、`plan list`（培养方案）、`student`（学籍）、`selection` 读 6 条（context/courses/search/sections/selected/credits） |
| 缺口（写） | `selection select`、`selection reorder`、`selection drop` —— **走 P0-1' 审批封装** |
| 上游源文件 | `lib/zdbk/pyfagl.ts`（培养方案 8.6 KB）、`lib/zdbk/xsxk.ts`（选课 18.8 KB）、`lib/zdbk/selection-task.ts`、`selection-cli.ts` |
| network/auth | 上游 `public` + `cas`；本仓 `capability.network` 现为 `campus` → **随 W2 改为 public** |
| 副作用 | `plan`/`student` 是 `campus_context.initialize` 建档的数据来源，不补则档案缺字段 |

### S-02 `yjsy` 研究生教务 —— **新建** `packages/source/yjsy`

| 项 | 内容 |
| --- | --- |
| 上游 | 1 条 `timetable`，主机 `yjsy.zju.edu.cn`，`auth: cas`，`network: public`，`writes: false` |
| 源文件 | `lib/yjsy/index.ts`（15.6 KB）+ `cli.ts`（1 KB） |
| 接口 | `timetable({ year?, term? })` → 每门课的教师/星期/节次/起止/地点/周次/每次课日期 |
| 依赖 | `source/login`（一卡通）、`source/http`（CAS 传输）、`source/webvpn` |
| 规模 | 小。单文件 + 单方法 |
| 独特性 | 本科教务网**查不到**研究生课；选了研究生课的本科生两边课要并表 |

### S-03 `xuezai` 学在浙大 —— **新建** `packages/source/xuezai`（从 `source/campus` 拆出）

| 项 | 内容 |
| --- | --- |
| **拆包裁决** | D8。**真正的工作量不是搬文件，是切 `index.js` 923 行**（溯源代理 5 结论） |
| 收什么 | `xzzd.js`（717）+ `xzzd-reads.js`（518）+ `cas/login.js`（428）+ `cas/auth.js`（145）+ `egress.js`（94，**去掉 `pintia.cn`**）+ `hosts.js` 的 CAS/courses 部分 + `reads.js` + `index.js` 的学在半边 |
| **不搬** | `cas/http.js`（34 行，**死文件**，0 import 方，只有 `package.json:9` 的 `"./http"` 导出引用它） |
| 上游能力 | `module.json` 17 条：todos / course list / course view / material list / material download / homework list / homework view / homework download / **homework submit** / **homework retract** / **rollcall** ×5 / session ×3 |
| 源文件 | `lib/xuezai/` 10 个 ts，约 128 KB |
| 缺口 | 课件清单下载、作业详情、**提交/撤回**、点名 5 条 |
| 服务名 | `zhiyunXuezai`；路由 `/api/zhiyun-xuezai`；i18n namespace 必须换（`client.jsx:42-43` 现为 `zju-source-campus`） |
| **隐藏耦合** | `index.js:344-349` 调 `ctx.get('zhiyunClassroom').acquireSso(account)` —— tier1→tier1 的**服务**依赖（静态 import 守卫管不到，`tests/source-capability.test.mjs:31-35` 明说不管 `ctx.get`）。**只有学在需要，PTA 侧必须完全不带** |
| **`egress` 归学在** | PTA 永远直连（`egress.js:59-62`）。唯一真实消费方是 `login` 探针（`login/src/index.js:576-583`） |
| **必须保留的本仓决策** | `todos()` 的 `fast` 模式（1 个请求）不得被上游逐课实现覆盖。原注释 `index.js:472-484` 的「42 请求 / 48 秒」**原样保留**，但要加一行标注它与 `xzzd.js:9` 的「38 请求」口径不一致 |
| 阶段 | 第一步只新建、老包不动；第二步再改调用方 |

### S-04 `pta` 拼题A —— **新建** `packages/source/pta`（从 `source/campus` 拆出）

| 项 | 内容 |
| --- | --- |
| **拆包裁决** | D8。**这是最容易切的一块：`pta.js` 零外溢**（`pta.js:33-34` 只 import `source-http` + `hosts.js`），可先无损切走 |
| 收什么 | `pta.js`（521 行，**自带 `normalizeDeadline`**（`:119-126`），不依赖 `xzzd.js`）+ `hosts.js` 的 pintia 两行 + 复制一份 `reads.js` + `index.js` 的 PTA 半边 |
| `index.js` 里属于 PTA 的段 | `ptaTransport`（436-444）、`ptaStatus`（560-569）、`savePtaCookie`（580-601）、`ptaRead`（645-670）、`translatePtaError`（139-149）、`normalizePta`（910-922） |
| 现有（取证） | `pta.js` 只读方法：`problemSets:259` / `problemSet:317` / `problems:362` / `problem:428` / `progress:476` |
| 上游能力 | 14 条，含 **homework start/finish**、**problem save/submit**、`submission list/view`、`reconcile` |
| 缺口（读） | `submission list`、`submission view`、`reconcile`（交完回查） |
| 缺口（写） | `problem save`（保存草稿）、`problem submit`（提交）、`homework finish` —— **走 P0-1'** |
| 源文件 | `lib/pta/write.ts`（15.9 KB）、`answers.ts`（6.7 KB）、`view.ts`（13.3 KB） |
| network/auth | `public` + `own`（独立账号，**不走 CAS**，不与学在共用凭据） |
| 服务名 | `zhiyunPta`；路由 `/api/zhiyun-pta` |
| **请求数恒定 1** | `pta.js:27-30` 明确无 N+1 |
| **R-1 硬约束** | `pta.session` 是「短信验证 → 手工粘贴」得来（`index.js:436-444`），**丢了无法自动恢复**。拆包**绝不可**改 `dataDir`，否则给每个用户制造一次不可自愈的操作 |
| **必照抄三条** | `pta.js:16-31`：404 = Cookie 失效、`filter` 只编码一次（双编码 400）、服务端排序不保证 |
| 拆包影响 | `packages/radar/dsh-radar-pta-progress`（纯文本，该包未接入） |

### S-05 `chaoxing` 学习通 —— 扩展 `packages/source/xxt`

| 项 | 内容 |
| --- | --- |
| 现有（取证） | `src/reads.js` 9 方法：`courses:105` / `listCourses:136` / `findCourse:159` / `homework:184` / `listHomework:223` / `deadlines:262` / `exams:327` / `notices:348` / `schedule:408` |
| 上游能力 | 10 条：+ **chapter list**、**material list/download**、**video list/download** |
| 缺口 | 章节课件清单与下载、视频清单与下载、实验课表对齐 |
| 源文件 | `lib/chaoxing/` 5 个 ts 共约 48 KB（`download.ts` 8.2 KB、`parse.ts` 9.2 KB） |
| network/auth | `public` + `own` |
| 独特性 | 上游「整门课一次读回」（30 节约 10 秒），页面点哪节都不再等 |

### S-06 `zhiyun` 智云课堂 —— 扩展 `packages/source/classroom`

| 项 | 内容 |
| --- | --- |
| 现有（取证） | `src/source.js` 17 方法：`restoreSession:69` / `login:74` / `searchCourses:127` / `listCourses:170` / `listLessons:190` / `getSlides:196` / `getSubtitles:223` / `getTranscript:259` / `getMyLectures:324` / `getLessonContent:377` / `getSchedule:422` / `downloadResource:435` / `downloadSlides:500` 等 |
| 上游能力 | 16 条，含 **live start/status/stop/text**（实时字幕）、`trans audio`、`search resources`、`setup`（FFmpeg + ASR 模型下载） |
| 缺口 | 实时字幕 4 条、音频转写、资源检索、FFmpeg/ASR 依赖安装 |
| 源文件 | `lib/zhiyun/` 22 个 ts，约 200 KB（最大 `remote.ts` 20 KB、`live-task.ts` 17 KB、`asr.ts` 16.7 KB、`cli.ts` 17.3 KB） |
| network/auth | `public` + `cas`，主机含 4 个（classroom / yjapi.cmc / education.cmc / tgmedia.cmc） |
| 依赖 | FFmpeg（`ffmpeg-static` 的 b6.1.1，SHA-256 校验）+ sherpa-onnx SenseVoiceSmall int8 |

### S-07 `notice` 通知 —— **新建** `packages/source/notice`

| 项 | 内容 |
| --- | --- |
| 上游能力 | `list` / `view` / `new` / `sources` |
| 源文件 | `lib/notice/` 9 个 ts，约 80 KB（`index.ts` 28.5 KB 最大）+ `scripts/notice/colleges.ts`（17.5 KB）+ `hosts.ts`（8.4 KB） |
| 两套适配器 | `webplus.ts`（10.5 KB，网站群）、`kyjs.ts`（2 KB）、`zdbk.ts`（8.7 KB，教务网通知） |
| 数据表 | `lib/notice/colleges.json`（学院名录）+ `hosts.json`（68 主机实测表） |
| network/auth | 模块级 `campus` + `cas`，但靠 `publicHosts` 逐站直连；实测 47 public / 21 campus |
| 缺口 | 全部。本仓无任何部门官网通知读取 |
| 风险 | 需定期复测主机表；学院名录需随学校调整更新 |

### S-08 `sztz` 二课 —— **新建** `packages/source/sztz`

| 项 | 内容 |
| --- | --- |
| 上游能力 | 8 条：credits / activity list / activity new / activity mine / **activity signup** / activity favorite / projects / notices |
| 源文件 | `lib/sztz/index.ts`（29 KB）+ `cli.ts`（3.9 KB） |
| 缺口 | 全部。含写：报名 / 取消报名 / 收藏 |
| 独特性 | 写命令 `write()` 在**建立会话之前**就检查写闸（`cli.ts:14`）—— 未授权不进登录流程 |
| network/auth | `campus` + `cas` |

### S-09 `tyys` 场馆 —— **新建** `packages/source/tyys`

| 项 | 内容 |
| --- | --- |
| 上游能力 | 9 条：rollcall history / session ×3 / venue list / **venue book** / venue order list / **venue order cancel** / venue notice |
| 源文件 | `lib/tyys/` 6 个 ts 共约 76 KB（`booking.ts` 27 KB 最大、`venue.ts` 20 KB） |
| 特殊能力 | 验证码识别（`captcha.ts` 7.5 KB）经 `CAMPUS_MODEL_ENDPOINT` 管道问模型；预约 180 秒限时（`BOOK_LIMIT_MS`）；收费预约**不自动取消** |
| network/auth | `public` + `cas`（注意：`hosts.json` 里 `tyys` 未出现，靠 `module.json` 声明 public） |
| 缺口 | 全部 |

### S-10 `cc98` —— 扩展 `packages/source/cc98`

| 项 | 内容 |
| --- | --- |
| 现有（取证） | `src/reads.js` 10 方法：`search:175` / `topic:199` / `hot:250` / `newTopics:275` / `boards:289` / `boardTopics:315` / `user:331` / `notifications:366` / `conversations:398` / `messages:419` |
| 上游能力 | 32 条（`module.json`），含 board tags/post、topic reply/favorite/download、floor like/rate/edit、**private-message send**、account 系列、**account signin** |
| 缺口（读） | board tags、topic download、floor rating-reasons/original、account topics/posts/history/favorites/following/feed、signin-month |
| 缺口（写） | board post、topic reply、topic favorite、floor like/rate/edit、private-message send、account signin |
| 源文件 | `lib/cc98/` 6 个 ts 共约 110 KB（`api.ts` 38 KB、`index.ts` 32.7 KB、`cli.ts` 21 KB） |
| **network 关键** | 上游声明 `campus`。本仓 `source/cc98` 是**只直连**（`src/index.js:29-31`：「不做 WebVPN」），校外抛 `WEBVPN_REQUIRED` |
| 依赖 W2 | **必须先做 WebVPN 升级**，否则校外 CC98 永远不可用 |

### S-11 `chalaoshi` 查老师 —— **新建** `packages/source/chalaoshi`

| 项 | 内容 |
| --- | --- |
| 上游能力 | 3 条：search / teacher / course |
| 源文件 | `lib/chalaoshi/index.ts`（17.8 KB）+ `cli.ts`（5.5 KB） |
| network/auth | `public` + `none`（无需登录） |
| 缺口 | 全部 |
| 规模 | 小，优先级低 |

### S-12 `ebook` 电子书 —— **新建** `packages/source/ebook`

| 项 | 内容 |
| --- | --- |
| 上游能力 | 1 条：search（书名/ISBN → 有全文的平台与直达地址） |
| 源文件 | `lib/ebook/index.ts`（14.8 KB）+ `cli.ts`（0.9 KB） |
| 主机 | `gk4pb6yy8y.search.serialssolutions.com`、`sslibrary.com` —— 均非 zju 域，`network: campus` |
| network/auth | `campus` + `none` |
| 缺口 | 全部 |

### S-13 `cnki` 知网 —— **新建** `packages/source/cnki`

| 项 | 内容 |
| --- | --- |
| 上游能力 | 5 条：search / download / session ×3 |
| 源文件 | `lib/cnki/index.ts`（23.9 KB）+ `cli.ts`（9.5 KB）+ `slider.ts`（9.7 KB 滑块） |
| network/auth | `campus` + `none`（IP 登录，`login.cnki.net` 探针） |
| 缺口 | 全部 |
| 独特性 | IP 登录意味着依赖 WebVPN 给校内 IP；滑块验证 |

### S-14 `lab` 实验选课 —— **前置实测（D13），通过后新建** `packages/source/lab`

| 项 | 内容 |
| --- | --- |
| 上游能力 | 6 条：timetable / courses / labs / selected / **select** / notices |
| 源文件 | `lib/lab/index.ts`（27 KB）+ `cli.ts`（11.4 KB） |
| 主机 | `10.203.16.55`（私网 IP），两个端口：**86** SPA 静态页、**8098** API |
| 声明 | `index.ts:42-49`：`hosts: [LAB_HOST]`、`auth: 'own'`、`network: 'campus'`、`writes: true` |
| 认证 | 平台本地账号（默认同学号）；`POST /api/login` → JWT 48h；请求头 `Authorization: <token_type> <token>` |
| 签名 | `api_sign` = md5(secret + path + 按参数名排序的 k+v + timestamp + " " + secret)；app_key/secret 是从前端混淆常量 base64→hex 解出的写死值（`index.ts:37,52`） |
| 缺口 | 全部 |
| **前置实测（D13）** | **已验证可用**（2026-11-10 校园网内实测）：SPA 86 端口 200、API 8098 端口可达、登录端点用上游签名返回 `{"code":200,"message":"OK","data":"用户名或密码错误"}` —— **协议逐项正确**。详见 [webvpn-plan 的 R1](zju-assistant-webvpn-plan.md) |
| **R1 已降级** | 原写「私网 IP 能否转发无证据」是错的。上游 `index.ts:6` 明写「走 WebVPN 重写 http-8098」，`rewriteUrl` 对 IP 是纯字符串处理、`wrdEncrypt` 不挑格式，**机械可行**。待验证的是「网关是否愿意代理该内网目标」，属网关策略问题 |
| 依赖 | 实测依赖 P0-2 WebVPN W1–W2 |

### S-15 浙大邮箱 —— **拆 4 个包**（D9）

> **清单总则**：**不要嫌麻烦，项目规则和尽可能无损放在首位。**
> 宁可拆成 4 个包各自守单一职责，也不要为了省事把数据源、工具、状态加工、界面揉进一个包。

上游邮箱链路**不是「只拉取资源给 AI」**。源码取证（`plugin/host/mail.mjs` + `mail-feed.mjs` + `mail-vault.mjs` + `rows/mail.mjs`）：

| 职责 | 证据 | 性质 |
| --- | --- | --- |
| 读（IMAP） | `mail.mjs` 的 `folders:153` / `list:160` / `inbox:188` / `read:224` / `download:231` | 数据源 |
| 写（SMTP 发信） | `mail.mjs` 的 `send:297` / `updateDraft:284` / `removeDraft:276`，走审批 `rows/mail.mjs:84-87` | 数据源 + 工具 |
| 草稿本地状态 | `draftFile:244` / `revision:248`（sha256）/ `drafts:250` / `prepare:261` | 有状态加工 |
| 后台轮询与基线 | `mail-feed.mjs` 的 `check:93` / `read:100` / `onNew:131`（UID + UIDVALIDITY） | 有状态加工 |
| 凭据封存 | `mail-vault.mjs`（专用密码 → `ctx.credentials` 的 grant） | 数据源依赖 |
| 连接表单 | `client/MailSettings.tsx`（`mail-status` / `mail-connect` / `mail-test` / `mail-disconnect`） | 界面 |

#### 拆包方案

| # | 包 | 分层 | 收什么 | 依据 |
| --- | --- | --- | --- | --- |
| 9-1 | `packages/source/mail/` | source | IMAP/SMTP 连接、`folders/list/read/download`、`send`、草稿文件读写、`mail-vault` 凭据封存 | 连 `imap.zju.edu.cn:993` / `smtp.zju.edu.cn:994`；**数据源规则：只提供事实** |
| 9-2 | `packages/tool/mail/` | tool | `campus_mail`（status/folders/search/read/download/drafts/draft/remove）、`campus_mail_send`（走 P0-1' 审批） | 纯 agent 触点，`ctx.tools.register` |
| 9-3 | `packages/core/mail-feed/` | core | 基线逻辑：UID/UIDVALIDITY 增量、`check()`、`onNew` 回调、本地缓存 | **不连外部**，只用 source 的读接口；持有跨会话状态 → 属 core |
| 9-4 | `packages/client/`（并入现有页或新建） | client | `MailSettings.tsx`（连接表单）+ 通知栏邮件条目渲染 | 上游 `Feed.tsx` 里邮件只是条目类型，**不必然需要独立页** |

#### 为什么必须分开（不是「为了整齐」）

1. **`core` 不放数据源**（用户规则，已提升为全局约束）：`packages/core/*` 现有包没有一个连外部站点。
   邮箱的数据源部分只能在 `source/`。
2. **`mail-feed` 不能放 source**：它持有 `cache/mail-feed.json` 跨会话状态，还要接 `onNew` 回调进提醒总线。
   本仓 source 包定位是「只提供事实，不做变换」（`packages/source/campus/README.md` 与
   `docs/contributing/AGENTS.md` 的分层要求）。
3. **后台轮询不能触发审批**（已查实：`approval.request()` 要求 turn 已开启，`user-approval/src/index.ts:244`）。
   所以 `check()` 只能读；发信必须由 agent 在 turn 内发起。拆包后架构上天然满足这条。
4. **凭据依赖方向**：`mail-vault.mjs` 依赖 `@deepseek-ai/dsh-credentials`，而 `source/*` 的 peer 依赖里没有宿主
   credentials。本方案选择**留在 source**（凭据是「连这个数据源所需的东西」，与 `source/login` 保管一卡通同性质），
   代价是 source/mail 要多声明一个 peer 依赖。

#### 待定

`9-3 core/mail-feed` 是否必要独立成包 —— 若本仓 `source/` 下已有持有本地状态的先例，可并入 `9-1`。
等溯源代理（本仓 campus 依赖图）确认 source 包能否持状态后定。
**按总则，倾向独立成包。**

### S-16 微信公众号 —— **新建** `packages/source/weread`

| 项 | 内容 |
| --- | --- |
| 上游位置 | `core/weread`（独立子包，`weread-skill` 0.1.0） |
| 关键机制 | 用微信读书的登录态读公众号文章，绕过腾讯验证 |
| 浏览器 | 要 Chromium 内核浏览器，CDP + 独立资料目录（`plugin/host/browser.mjs` 25.7 KB） |
| 缺口 | 全部 |
| 风险 | 依赖本机浏览器；公众号文章链接**一律**要走它，直抓必被拦 |

### S-17 微信聊天 —— **新建** `packages/source/wechat-chat`

| 项 | 内容 |
| --- | --- |
| 上游位置 | `core/wechat`（`campus-wechat-chat` 0.1.0） |
| 缺口 | 全部：群聊/私聊/联系人/附件只读 |
| 风险 | 上游自述 Mac 要关 SIP、只用合成数据测过；Windows 可离线查 |

### S-18 钉钉聊天 —— **新建** `packages/source/dingtalk-chat`

| 项 | 内容 |
| --- | --- |
| 上游位置 | `core/dingtalk`（`dingtalk-skill` 0.1.0） |
| 认证 | `@napi-rs/keyring` |
| 缺口 | 全部：v2/v3 账号库、群聊/私聊/群成员 |
| 风险 | 上游自述 Mac 只用合成数据测过 |

---

## 第 2 层 · proc 链路包（新建）

| # | 包名（建议） | 上游源 | 职责 | 规模估计 |
| --- | --- | --- | --- | --- |
| P2-1 | `packages/core/campus-calendar` | `holidays.mjs` 9.4 KB + `calendar.mjs` 18.9 KB | 校历三层（国家放假 + 浙大校历 + 用户填）、周次/单双周/调休 | 中，含 2025/2026 硬编码数据 |
| P2-2 | `packages/core/campus-schedule` | `schedule.mjs` 31 KB | 两网课表合表、考试、作业截止、备忘、自建日程 | 大 |
| P2-3 | `packages/core/campus-affairs` | `affairs.mjs` 24 KB | 三平台作业聚合、附件下载、缓存策略（FRESH 60s / RETRY 5min） | 大 |
| P2-4 | `packages/core/campus-feed` | `feed.mjs` 18.5 KB | 六源通知汇总、campus/personal 两页签分流、后台轮询 | 大 |
| P2-5 | `packages/core/campus-notice-filter` | `notice-filter.mjs` 9 KB | 屏蔽词 + 模型逐条判断相关度（BATCH 40 / ROUNDS 3） | 中 |
| P2-6 | `packages/core/campus-notice-content` | `notice-content.mjs` 8.9 KB + `notice-memo.mjs` 19.5 KB | 正文读取、加进备忘录（直加 / AI 总结） | 中 |
| P2-7 | `packages/core/campus-alerts` | `alerts.mjs` 3.4 KB | 提醒总线（内存留 50 条，点开回到对话/页签） | 小 |
| P2-8 | `packages/core/campus-context` | `context.mjs` 20.6 KB + `context-relations.mjs` 18 KB + `context-sources.mjs` 13.5 KB | 校园档案三种 + 关联核对（review token / resolve decisions） | 大 |
| P2-9 | `packages/core/campus-store` | `store.mjs` 22.6 KB | 记忆/备忘录/基础信息三份 Markdown 库，带 revision | 大 |
| P2-10 | `packages/core/campus-learning` | `learning.mjs` 24 KB + `xuezai.mjs` 18.7 KB + `chaoxing.mjs` 21.7 KB | 学习页聚合（**与现有 `core/study` / `core/learning-resource` 重叠，需裁决 Q-D**） | 很大 |
| P2-11 | `packages/core/campus-approval-bridge` | `approval.mjs` 2 KB | 见 P0-1' | 小 |

**上游还有但不建议单独建包的**：

- `chat-watch.mjs`（39 KB，最大文件）—— 聊天监控 + 模型整理。依赖 S-17/S-18
- `model.mjs`（3.6 KB）—— `askModel` 包装 `ctx.llm`，建议合进 `campus-alerts` 或独立小包
- `vision.mjs`（6.8 KB）—— 验证码管道，建议随 S-09 tyys
- `ffmpeg.mjs`（3.2 KB）—— 下载 FFmpeg，建议随 S-06 zhiyun
- `identity-fill.mjs`（3.5 KB）—— 学号推年级/层次，小，可合进 `campus-store`
- `colleges.mjs`（0.9 KB）+ `documents.mjs`（1.5 KB）+ `downloads.mjs`（2.3 KB）—— 小工具，建议合进一个 `campus-paths` 包

---

## 第 3 层 · tool / preset / skill

### T · 工具（9 个新建）

| 工具名 | 上游 | 归属包（建议） | 依赖 |
| --- | --- | --- | --- |
| `zju` | `zju-tool.mjs` 101 行 | `packages/tool/zju` | 全部数据源 + P0-1' 审批封装 |
| `campus_profile` | `tools.mjs:51` | `packages/tool/campus` | P2-9 store |
| `campus_note` | `tools.mjs:71` | 同上 | P2-9 |
| `campus_schedule` | `tools.mjs:89` | 同上 | P2-2 |
| `campus_context` | `tools.mjs:113` | 同上 | P2-8 |
| `campus_notify` | `tools.mjs:167` | 同上 | P2-7 |
| `campus_mail` / `campus_mail_send` | `rows/mail.mjs` | `packages/tool/mail` | S-15 的 9-2 |
| `campus_wechat` | `rows/wechat.mjs:40` | `packages/tool/campus-wechat` | S-16 |
| `campus_wechat_chat` / `campus_dingtalk` | `rows/chat.mjs:32` | `packages/tool/campus-chat` | S-17/S-18 |

**注入点约定（已核实本仓事实）**：`packages/tool/study/src/index.js:53` 只做 `ctx.tools.register(tool)`，
**不带挂载行**；可见范围由 preset 决定，不写进 profile bundles。

### P · preset —— **Q-E 暂不决策（D11），位置定在拓扑最顶层**

**裁决**（用户 2026-11-09）：**延迟决定。**

- **理由**：在所有新工具注册完毕之前，用户无法判断最终具体有哪些可用工具。
  先定 preset 就是在信息不全的情况下做裁剪决策。
- **位置**：preset 作为**拓扑最顶层**，在依赖图里排在所有 `tool` 之上，**暂时不决策**。

#### 机制已查明（代理 1 溯源，不影响 D11 的延迟）

**preset 不是「过滤全局工具表」，而是「一棵独立的 Cordis scope 子树」。**

| 事实 | 依据 |
| --- | --- |
| `PresetDefinition` 只有 `plugins: EntryOptions[]`，**没有工具 allow/deny 字段** | `agent-preset-registry/src/definition.ts:5-11` |
| 每个 preset 建独立 scope，在其中挂载整棵插件树 | `agent-preset-registry/src/index.ts:119-138`、`mount.ts:204-216` |
| 子树内 `register()` 落到该 scope 层，只有绑定该 preset 的 Agent 沿链可见 | `core/tools/src/index.ts:148-152`、`:199-227` |
| **preset 内工具不污染全局视图** | `agent-preset-registry/tests/registry.spec.ts:28-31`（`ctx.tools.schemas()` 为空） |

**所以 D11 延迟的是「挂哪个 preset」，不是「怎么挂」。怎么挂已经有确定答案：**

```yaml
# 正确形状（照 bundle/web-app/presets/cordis.patch.yml:4-10）
- insert:
    - id: preset-zju
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: zju
        plugins:
          - id: tool-zju
            name: '@lybx-leyw/dsh-zju-tool-zju'
          - id: tool-campus
            name: '@lybx-leyw/dsh-zju-tool-campus'
```

#### 上游的根因（实施时不得沿用）

`packages/vendor/zju-assistant/plugin/bundle/cordis.patch.yml:7-31` 用的是**顶层 `- insert:`**，
把行插入 profile 根层 → **注册成全局工具** → 这就是「9 个工具出现在所有会话工具表」的根因。

**必须改造成 `dsh-agent-preset` 声明行**，把工具行搬进 `config.plugins`；
**不是**加 `when`、也不是加 `restrict`。

#### 三条已定事实（代理 3 溯源，仍不改变 D11 的延迟）

| # | 事实 | 依据 |
| --- | --- | --- |
| 1 | **没有 preset patch 能力** —— 不能「只加一行工具进已有 preset」 | `architecture.md:25` 声称有，但 `PatchOptions` 无 `preset` 字段（`vendor/include/src/patch.ts:5-16`），`applyPatches` 只处理 `insert`/`id`（`:62-106`），全仓 grep `presetPatch\|applyPreset` 零命中，且 2026-09-21 笔记（`:31`）明确**否决**该方案 |
| 2 | **改已有 preset 只能整份覆盖 `config`** | `patch.ts:91-106`。这就是 `lecture` 的 composition 是 standard **整份逐行复制**的原因（`PresetDefinition.plugins` 是必填完整数组，无 `extends`） |
| 3 | **工具包不得进 profile bundles** | 进了就注册进 global 层，`minimal`（只有 2 个工具行）/`ptc` 也会看到。官方同结论：`2026-09-21-...md:17` |

**→ 结论：D11 定案时必须新建 `packages/preset/campus`，不能改现有 preset。**

包结构照 `lecture`（同构）：

```
packages/preset/campus/
├── package.json          # dsh.bundle.patch: ./cordis.patch.yml
├── cordis.patch.yml      # - insert: preset-campus + config.plugins
└── src/index.js          # 可为空。**不要**复制 lecture 的 3 秒 console 自检
```

| 项 | 决定 |
| --- | --- |
| 9 个工具挂哪个 preset | **未定，延迟到工具全部注册完成后再裁决**（D11） |
| 挂载方式 | **已定：新建 `preset/campus`，工具行进 `config.plugins`** |
| `packages/preset/lecture` | **暂不动**（但它的 3 秒自检已被代理标记为非标准且无诊断力） |
| 工具注册时的写法 | 只 `ctx.tools.register`，**不带挂载行、不写 profile bundles** |

**这条延迟是有代价的，必须记录**：在 preset 定下来之前，9 个校园工具一旦注册，
本仓**所有 preset 的所有会话**都会看到它们的工具表。这正是上游刻意避免的事
（上游用 10 行子插件开关控制能力可见性）。所以实施顺序上：

1. 工具包可以照建、照测（单元测试直接 `ctx.tools.register` 即可）；
2. **但不要挂进任何 profile bundles** —— 挂进去就等于对每个会话生效；
3. 等 preset 裁决完成，再决定注入点。

**待 Q-E 定案后需要回答的**（留给后续）：

- 9 个工具是否只对「校园任务」有意义（→ 新增 preset），还是与现有 `lecture` 重叠（→ 并入）
- 上游的「10 行子插件开关」在本仓用什么等价机制（`ToolRegistrationOptions.activate`？preset allowlist？）
- 关掉的行的工具是否要彻底不可见，还是仍在工具表里但执行时报错（上游是后者，见 `zju-tool.mjs:76-77`）

### K · skill —— **新增确认（D12），新增方式延迟决策**

**裁决**（用户 2026-11-09）：

| 项 | 结论 |
| --- | --- |
| 新增还是并入 | **新增**。理由：本项目**还没有专门给 AI 写的 skill**，不存在可并入的对象 |
| 如何新增（放哪个扫描根、走哪种注册方式、frontmatter 怎么写） | **延迟决策** |
| 延迟理由 | **skill 依赖其正文里罗列的 tool 而成立** —— 工具集未定，就无法写准 skill 的正文，也就无法决定它该长什么样 |

#### 事实基础

| 项 | 内容 |
| --- | --- |
| 上游 | `zju-campus`：`SKILL.md` 5.4 KB + 3 篇 references（pages / records / schedule）+ 9 篇 rows 段落 |
| 上游机制 | 正文按**开着的行**拼接（`plugin/host/index.mjs:203-218` 的 `skill()`），关掉的行那一段不给模型看 |
| 上游可见性 | `modelInvocable: true`、`userInvocable: false`（不进 `/` 菜单） |
| 本仓现状 | `docs/contributing/skills/` 有 2 个（`human-factors-screen-design`、`lossless-plugin-fusion`），**但都不是给 AI 干本项目活用的**；本仓没有面向校园能力的 skill |
| 关键约束 | `docs/contributing/skills/` **不在任何扫描根里**（该目录 README 第 5 行明确写了「这里不是任何 harness 的自动加载目录」），放进去 ≠ 自动生效 |

#### 为什么「延迟」是正确判断（记录推理）

上游这份 skill 的正文几乎全是**工具调用说明**：`SKILL.md` 的「工具」一节逐个列出
`zju` / `campus_profile` / `campus_note` / `campus_schedule` / `campus_context` / `campus_notify`，
再往下 9 篇 `rows/*.md` 分别讲各自模块的命令怎么拼参数。
**工具的最终形状变了，skill 正文就得跟着重写** —— 所以顺序只能是「先工具、后 skill」。

这与 D11（preset 延迟）是同一个因果链的两端：

```
数据源包 → proc 包 → tool 注册 → ┬→ preset（哪些工具对谁可见）  D11
                                  └→ skill（怎么用这些工具）      D12
```

#### 待 Q-F 定案后要回答的

1. **放哪**：`docs/contributing/skills/zju-campus/`（不入扫描根，需用户手动装）？
   还是新建一个本仓自己的扫描根（如 `.agents/skills/`）？后者会让 skill 对所有使用者生效，
   与 `docs/contributing/skills/README.md` 第 30-32 行「自动加载目录会与本仓库的公开性质冲突」的既有立场相反。
2. **走哪条注册路**：静态文件（扫描根）还是 `ctx.skills.registerProvider`（上游做法，可动态拼正文）？
   上游选后者是因为它要按「开着的行」拼段落；本仓如果没有行开关机制，静态文件可能更简单。
3. **正文写什么**：9 个工具全部注册完才知道。上游 5.4 KB 正文 + 3 篇 references 要按本仓工具重写，
   不能照抄（工具名、参数、调用约定都可能不同）。
4. **可见性**：`userInvocable` 设 true 还是 false？上游设 false（不进 `/` 菜单），
   因为它是「模型自己判断该用时用」，不是「用户手动触发」。

#### 机制已查明（代理 3 溯源）

**扫描根按 rank**（`skill-filesystem/src/index.ts:251-271`）：

| rank | source | 根 |
| --- | --- | --- |
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `bundledSkillDir` / `$DSH_BUNDLED_SKILL_DIR` |

- `projectRoot` = 最近的含 `.git` 的祖先（`:959-969`）→ 本仓就是仓库根
- **只认一层，不递归 `**/SKILL.md`**（`:740-747`）
- rank 只在同层内比大小；跨层是「最近的 scope 层覆盖同名」

**frontmatter 只有这 6 个字段**（`parseSkillFile`，`:828-853`）：

| 字段 | 必填 |
| --- | --- |
| `name`（须匹配 `^[a-z0-9]+(?:-[a-z0-9]+)*$`） | ✅ |
| `description`（非空） | ✅ |
| `whenToUse` | — |
| `metadata` | — |
| `disable-model-invocation`（旧键 `disableModelInvocation` 被拒） | — |
| `user-invocable`（旧键 `userInvocable` 被拒） | — |

**`allowed-tools` 不存在** —— 全仓 skill 包 grep 只命中 `liveshare` 的 fork 上限与
`subagent-claude-code` 的 `disallowedTools`（Claude Code 子代理 CLI 参数，无关）。
→ **宿主没有「skill 级工具白名单」能力**，skill 无法约束自己能用哪些工具，只能靠正文说明。

**三条落地路径**：

| # | 方案 | 优劣 |
| --- | --- | --- |
| **1（推荐）** | 移植成 provider 包挂 host 平面：`packages/skill/zju-campus`，`apply()` 里 `ctx.skills.registerProvider` | 与上游行为一致（按行裁剪正文）、全局可见、无需用户复制。契约已核实通过。**`resourceBase` 必须指向随包发布的目录**，否则 `references/*.md` 相对引用失效（`skill/src/index.ts:193-198`） |
| 2 | 静态单文件 + `customSkillDirs` | 官方推荐的外部目录接法（`web-app/presets/cordis.patch.yml:124-128` 有样例）。代价：失去按行裁剪，要包路径表达式 |
| 3 | 搬进 `.dsh/skills/`（rank 100） | 零配置全体可见，但把产品内容塞进用户工作区目录 |

**不推荐**放 `docs/contributing/skills/` 就完事 —— 该目录 README 明说不是自动加载目录，宿主确实不扫。

**上游 `registerProvider` 用法核实：符合契约，可照搬。** 三处可选改进：
`list`/`get` 起步加 `options.signal?.throwIfAborted()`；把 `control.signal` 的 abort 接到「下次 list 返回空」。

---

## 第 4 层 · 页面（7 项，事实已查明，待裁决）

**完整溯源见 [trace-4-slots](zju-assistant-trace-4-slots.md)。**

### 两个前置事实（决定全部页面决策）

> **裁决已下（D14/D15）**：骨架继续用 dsh-pages，数据通道一律改接本仓 core/source。
> 下面两个事实是裁决的依据，保留备查。

**F-1 · 骨架冲突：本仓不用宿主 `main`**

全量 grep `packages/client` 的 `name: 'main'` / `'sidebar.panellist'` → **零命中**。
本仓走 dsh-pages 的 `page.content`，它由 `shell.overlay` 下运行时声明（`vendor/pages/src/page-shell.jsx:387-392`），**不在宿主 109 个标准槽里**。

| | 宿主原生（上游用的） | 本仓 dsh-pages |
| --- | --- | --- |
| 内容槽 | `main` + `sidebar.panellist` | `page.content` + `page.rail-action` |
| 几何 | grid `.centerCol` | **`position: fixed; inset: 0; z-index: 1000`** |
| 共存 | **被浮层盖住** | 盖住宿主全部界面 |

**→ 不可混用。** 挂进 `main` 在本仓 profile 里看不到。

**F-2 · 数据通道在本仓完全不存在**

上游全部页面只走 `fetch('/api/zju-campus')`（`plugin/client/api.ts:3-15`）。
全量 grep 本仓 `packages/` + `apps/` → **零命中**。

**→ 「直接挂」是假的：能渲染，但所有数据请求失败。** 必须二选一：
- (a) 移植上游 `plugin/host/` handler
- (b) 改接本仓 core/source 服务（与 `page-today` 的 `ctx.inject(['zhiyunStudyController'])` 模式一致）

### 逐项可行性

| # | 页面 | 能挂吗 | 槽 | 改造量 |
| --- | --- | --- | --- | --- |
| U-1 | 日程表 `SchedulePage.tsx` 40.6 KB | 🟡 | `page.content`（key=`schedule`） | 中：换挂载点 + `openRow()` 改 `pages.selectPage()` |
| U-2 | 校园事务 `AffairsPage.tsx` 22.2 KB | 🟡 | `page.content`（key=`affairs`） | 中偏大：依赖 `useMemos` + `FeedColumn` |
| U-3 | 学习 `LearningPage` + 两子文件 | 🟡 | `page.content`（key=`learning`） | 中 + 与 `page-study` **语义重叠**（产品裁决） |
| U-4 | 通知 + 个人消息 `Feed` / `NoticeContent` | 🔴 **挂不上** | — | `FeedColumn` 是「两栏布局的一列」，不是页 |
| U-5 | 个人档案 `ProfileSettings.tsx` 10.9 KB | ✅ **几乎零改造** | `settings.section` + `.icon` | 极小：本仓已有 2 个先例 |
| U-6 | 备忘录 `Memos` + `Notes` | 🔴 **挂不上** | — | `useMemos()` 返回 **5 个 ReactNode 片段**，不是页 |
| U-7 | 7 个配置页 | 🟡 | `plugins.row.config` | 小—中：key 须为 `<本仓包名>#<行 id>`，**不匹配静默不渲染** |

**挂不上的通则**：上游真正是「页」的只有 4 个 + 7 个配置页。`Memos`/`Notes`/`Feed`/`NoticeContent` 是 `AffairsPage` 内部的两栏组件：

```
AffairsPage
├─ 左栏: useMemos()  → Memos.tsx → Notes.tsx
└─ 右栏: FeedColumn   → Feed.tsx  → NoticeContent.tsx
```

### 三处其他硬约束

| # | 约束 |
| --- | --- |
| 1 | 前端服务错位：`pluginNavigation.openBundle()` 打开的是**宿主插件页**，本仓「插件」是 `page-plugins`，不是一回事；`layout.selectPanel()` 选的是宿主 `main` 面板，本仓页面不在 `main` 里。→ `openRow()`/`openAlert()` 要改调 `pages.selectPage()`；`uiWorkspace.startSession()` 可不动 |
| 2 | 样式 87 KB 搬得出但要过门：命名空间已隔离（上游 427/448 条 `.campus-`，本仓 `.zs-`/`.zy-` 零交集），但搬进 `packages/client/` **立刻进 `check:css` 范围**；10 条 `:root[data-campus-move]::view-transition-*` 很可能被判竞争；新包须在 `tests/css-order.test.mjs:53` 登记 |
| 3 | 配置页耦合：`ChatSettings.tsx` 带 `ChatMessage` 导出（`:66`），被 `NoticeContent.tsx:6` import —— **不能只搬配置页** |

### 建议落地顺序（代理给的）

1. 先定骨架（确认继续用 dsh-pages）
2. **先做 `ProfileSettings`** —— 挂真宿主槽、不碰骨架、数据最简单，是验证「上游组件能否在本仓环境跑」的最小试验
3. 数据通道早做决定（覆盖全部 7 页，越晚返工越大）
4. 日程表 / 校园事务 / 学习按三步做，日程表最难
5. `Memos`/`Notes`/`Feed`/`NoticeContent` 不当页处理
6. 配置页最后做，key 全重算并手工确认每个「配置」按钮真的出现

**上游 UI 总量**：`plugin/client/` 共 32 个文件，含 `style.css` **87 KB**。
**本仓 UI 约定**：`packages/client/*` 各自只含 UI，数据由 `core-*` 提供；有跨包 CSS 层叠顺序要求（见 `packages/vendor/zju-assistant/PATCHES.md`「它不参与本仓约定」一节的反面）。

---

## 待裁决汇总（7 项 + 本轮新增 9 项）

### 原 7 项

| 编号 | 问题 | 影响面 |
| --- | --- | --- |
| ~~Q-A~~ | **已裁决**：宿主 base bundle 提供 `ctx.approval`，本仓只写薄封装 | 见 [Q-A](zju-assistant-qa-approval.md) |
| Q-B | ~~`source/campus` 的「学在待办」迁到新 `source/xuezai` 还是留在原地~~ | **已裁决 D8**：拆包，学在与 PTA 分离 |
| ~~Q-C~~ | **已裁决 D9**：拆 4 包，数据源进 `source/mail` | 见 S-15。**落地 1/4** |
| Q-D | 学习页聚合（P2-10）与现有 `core/study` / `core/learning-resource` 怎么分工 | P2-10、U-3 |
| ~~Q-E~~ | **已裁决 D11**：延迟到工具全部注册完成后再定 | 见第 3 层 P 节 |
| ~~Q-F~~ | **已裁决 D12**：新增；新增方式延迟到工具注册完成后 | 见第 3 层 K 节 |
| ~~Q-G~~ | **已裁决 D13**：先实测；失败不得直接判不可行，穷尽策略后上报 | 见 S-14 |

### 本轮新增（2026-11-11，实证查出，全部未决）

> 完整推导见 [`abandoned.md`](abandoned.md) 第七节。这里只列问题，不给答案 ——
> 按本仓规矩，这些都要用户裁决，不自行决定。

| 编号 | 问题 | 卡住了什么 |
| --- | --- | --- |
| **Q-H** | 装配层（凭据/会话注入口）放哪：profile 的 patch？新包？还是各 source 自己读凭据？ | `lab` / `tyys` / `sztz` / `mail` / `yjsy` / `notice` 六个包实机不可用 |
| **Q-I** | 工具层与 source 层 9 处参数契约断裂，修哪一侧？ | 退课/调序、场馆预约、交/撤作业、点名、CC98 评分、选实验 全部报错 |
| **Q-J** | D21（下载归 core）怎么落地：建 core 执行方，还是**改裁决**承认 source 可落盘？ | 所有下载能力；现状是 core 没有、source 已在落盘 |
| **Q-K** | `doc` 模块（4 条 provides）归哪一层？ | 文档转文字 / PDF 合成 / 取页 / 找页 整块没有归属 |
| **Q-L** | D9 的邮箱另外 3 个包（`tool/mail` / `core/mail-feed` / client）还建不建？ | 邮箱只能读，发信与「有没有新信」没有承载方 |
| **Q-M** | proc 层 11 个包（P2-1 ~ P2-11）整体的归属与优先级 | 校历、课表合并、作业聚合、通知汇总、档案、备忘录…全部未建 |
| **Q-N** | `tool/campus-write` 的注入点（preset 未定，它现在不加载） | 22 条写能力在实机上没有入口 |
| **Q-O** | `zjuam session status` 补不补（本仓没有单独的「这张票还有效吗」判据） | 服务面只报「有没有存账号密码」；路由 GET 会探三个下游，但那不是这张票本身 |
| **Q-P** | 上游「不单独建包」的 8 个辅助文件（`chat-watch.mjs` / `model.mjs` / `vision.mjs` / `ffmpeg.mjs` / `identity-fill.mjs` / `colleges.mjs` / `documents.mjs` / `downloads.mjs`）归哪个包 | 清单第 2 层末尾给过「建议合进 X」，但那是**建议**不是裁决，按规矩不算已决 |

---

## 工作量与顺序

**必须先做（有依赖）**：

1. **P0-1' 审批封装**（7 个写操作模块的前提；宿主已提供服务，只需 26 行移植）
2. **P0-2 WebVPN W1→W2**（S-10 cc98 校外可用、S-13 cnki IP 登录的前提）
3. **S-14 lab 可行性实测**（决定这一项建不建）

**可并行**：

- 只读数据源：S-02 yjsy、S-07 notice、S-11 chalaoshi、S-12 ebook
- 扩展类：S-01 zdbk（读部分）、S-05 xxt、S-06 zhiyun
- proc 层：P2-1 校历、P2-7 提醒、P2-9 store

**依赖链最深**：

`S-15 邮箱` → `P2-4 feed` → `P2-5 filter` → `P2-6 content` → `U-4 通知页`
`S-03 xuezai + S-04 pta + S-05 xxt` → `P2-3 affairs` → `U-2 校园事务页`
`S-17 + S-18` → `chat-watch` → `P2-4 feed`

---

## 未探索范围（如实列出）

- 上游 `core/learn/engine/**`（含 `vendor/`）：只读了 `plugin/host/learn.mjs` 调用面，引擎内部渲染细节未读
- `plugin/client/*.tsx` 组件内部按钮：除 `index.tsx` 外未逐个枚举
- `core/chat`：无代码（仅测试），`core/skills` 是 md 模板，`core/initialize` 只有 references
- 本仓宿主的 `ctx.approval` 是否存在：**已查实**（`.ref/packages/bundle/base/cordis.patch.yml:259`），
  且 `danger-full-access` 模式下 `policy: never`。`node_modules/@deepseek-ai/` 只有 `dsh-atomic-write`
  是因为本仓走 profile 链接而非 npm 安装，不能用它判断宿主能力 —— 这是我上一版的错误推理路径。
