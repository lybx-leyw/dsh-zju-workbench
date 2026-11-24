---
name: site-recon
description: 站点接口侦察与只读爬虫脚本生成。用户给出一批网址和账号密码，想摸清网站有哪些可用接口、批量查询或下载站内资源时使用。触发场景包括：爬虫/抓取/接口探索/站点侦察/摸接口、批量下载电子书或文献、校内系统/统一身份认证/WebVPN 跳转、"看看这个网站能拿到什么数据"、复用已探索站点的接口知识。即使用户没明说"爬虫"，只要涉及"给网址+账号，探索接口并落盘成可复用脚本"，就应使用本技能。不适用于：运行已有脚本、一次性普通浏览、提交/修改/删除等写操作自动化（本技能只读）。
---

# site-recon：探索一次，落盘复用

YONKIK 的论点是「探索是一次性成本」。本技能把它从 UI 动作回放延伸到接口层：
agent 只读地摸清一个站点有哪些接口、怎么鉴权、限流多少，然后把认知落盘成
**脚本 + WIKI**。下一个会话先读 WIKI，直接复用，不重新探索。

本技能与具体学校/厂商无关：文中所有域名（`*.example.edu`）、凭据键、hex 编码
都是占位示例，实际值一律以目标站实测为准。

输入：用户的**目标**（想拿什么数据）。网址与凭据仅**首次配置**时需要（见「凭据与网站入口」）；
已配置/已桥接/已探索的，直接复用，不必再给。
输出：每个站点一套 `sites/<key>/`（脚本、接口清单、WIKI、限流与鉴权配置），积累在记忆根。

## 第 0 步：永远先读记忆（无条件）

**任何任务的第一动作都是读记忆区，先于一切假设。** 工作目录在哪不重要（哪怕当前在毫不相关的
论文文件夹），记忆根 `~/.yonkik/`（`YONKIK_HOME`）才是真相源：

1. 读 `~/.yonkik/MEMORY.md`（约定 + 脚本清单 + 网络陷阱）→ 读 `sites/_dir.md`（一行式站点目录）
   判断**哪个站**与当前问题有关。不要一次读完整个记忆区。
2. **按索引检索，不要整篇加载**：命中站点后，先看该站 `wiki.md` 顶部的「本页索引」，
   用 `grep -n "^## <小节>" wiki.md` 定位行号，**只读那几节**（常见只需「接口」「坑」两节）。
   `_index.json` 现在是薄路由表（无长文），可以整读；长内容都在各站文件里。
3. 命中已探站 → 复用它的 `crawler.mjs` / `login.mjs` 与 `endpoints.json`，**不要重新探测**。
3. **站点事实以记忆为准，不要凭常识猜**：域名、鉴权方式、接口路径都从 wiki/site.json 读。
   例如 CC98 是 `cc98.org`、API 在 `api.cc98.org`、用 Bearer token——记忆里都有，
   别猜成 `cc98.zju.edu.cn`，也别预设「需要重新登录」。
4. **凭据可能已就绪**：`campus-sso` 已桥接、或已在设置/`credentials.json` 配好、或 `state.json`
   仍有效。先查这些，**不要预设「需要 intake 文件」或「需要重新登录」**。intake 只是首次
   无凭据时的配置入口（见下文），不是每次查询的前置。

只有记忆未命中（全新站点）才进入下面的探索工作流。

## 凭据与 SSO：一证多站，经工具注入

**一证多站，别陷入「一密码一网站」。** 一卡通（凭据键 `campus-sso`）是整个 CAS 家族的统一凭据：
- `zjuam-cas` 家族：教务 zdbk、研究生 yjsy、服务平台 service、计财处 cwcx、图书馆 libweb、二课 sztz、体艺 tyys…
- `identity-keycloak` 家族：**学在浙大 courses、智云课堂 classroom**——经 identity.zju.edu.cn Keycloak
  **broker 回 CAS**，同样用一卡通。

这些站**共用一套 campus-sso**，不需要各站独立密码。站点归哪个家族查 `sites/_sso.json`，
别猜「这个站要不要单独的密码」——学在浙大就用一卡通，不是例外。

**凭据经 yonkik 工具注入，不在你的 shell。** 工作台自动桥接两套独立凭据：
- `campus-sso`：工作台的浙大统一身份认证（一卡通），仅用于相应 CAS 登录。
- `webvpn`：工作台的 WebVPN 上网账号，仅用于用户授权的 WebVPN 网关；不要与 `campus-sso` 互相代用。

`yonkik` 工具运行脚本时将凭据注入子进程的 `YONKIK_CREDENTIALS`，不会复制到记忆区。
两套都按 `键一`（账号）、`键二`（密码）读取。用 `script=credcheck` 只查键名和存在性；不得输出或写盘凭据值。
- **用 `yonkik` 工具跑脚本**（script + args），凭据自动到位。
- **不要直接 bash 跑脚本再 `echo $YONKIK_CREDENTIALS`**——你的 shell 里它是空的（注入只发生在
  工具启动的脚本子进程），据此判「无凭据」是错的。
- **不要去翻加密 `.session` 文件或 Chrome cookie**——宿主会话是 DPAPI/App-Bound 加密、Chrome
  运行时锁库，那条路不通也无必要；campus-sso 桥接就是正路。

工作台未配置桥接凭据时，去对应的工作台设置配置；独立站点凭据（如 CC98 自有账号）才需在「设置 → YONKIK 侦察凭据」另填。若 YONKIK 中已有手动配置的同名键，以手动配置为准。

## 工具边界：别读 workbench 源码，一切经 yonkik 工具

**不要去读 zhiyun-pro-js 的实现源码**（`packages/source/*`、`packages/yonkik/*/src/*`、`cas.js`、
`transport.js`、`session.js` 等）。workbench 内部怎么实现与你无关——你只需要 yonkik 工具 + 记忆区知识。
翻源码找「现成 CAS 实现/会话」是歧路，本技能已给你完整能力。

**不要去解密 `session.dpapi` / Chrome cookie。** 宿主会话加密且锁库，那条路不通也无必要；
campus-sso 桥接就是凭据正路。

## 写盘纪律：临时产物归位，资产留索引

记忆区是**长期知识库**，不是草稿纸。探索期必然产生一次性脚本、中间 JSON、截图——
它们没有复用价值，混进 `sites/` 会让目录失真、让下一次的自己（和用户）无法分辨什么可信。

- **一次性脚本、中间数据、截图 → `sites/<key>/_scratch/`**（或全局 `sites/_scratch/`）。
  前缀 `_` 开头、不入索引、可随时整目录清空。
- **只有这三类算资产**，留在站点根：`wiki.md`（认知）、`endpoints.json`（接口）、
  `crawler.mjs` / `login.mjs`（可复跑脚本）。另有 `site.json`（配置）、`state.json`（会话）、
  `profile.json`（画像）。
- **探索收尾时清理**：把 `_scratch/` 里确认无复用价值的删掉；有复用价值的重命名后提升为资产，
  并在 wiki 记一行它做什么。
- **不要在 `sites/` 根下丢文件**。根下只允许 `_index.json` `_dir.md` `_playbook.md` `_sso.json`
  `_scratch/` 和站点目录 `<key>/`。
- **改索引后跑一次** `node ~/.yonkik/scripts/verify-index.mjs`：校验磁盘资产 ↔ 索引 ↔ site.json 三方对齐。

**你的 pwsh 是沙箱化的**（工作区外写入、起浏览器会被 EPERM 挡）。但 **yonkik 工具的子进程在沙箱外**：
能写记忆根、能起浏览器、有凭据注入。所以：
- 写文件到记忆根、起浏览器登录、跑自定义脚本——**都经 yonkik 工具**，别用 pwsh 直接做。
- **自写脚本经 `put` + `run`**：`yonkik put sites/<key>/login.mjs <脚本内容>` 落盘，
  `yonkik run sites/<key>/login.mjs [参数]` 执行（注入 campus-sso、可起 playwright）。
  CAS/Keycloak 登录脚本就这样自写自跑——不需要现成脚本，也不需要读 workbench 源码。

## 前置依赖

浏览器探索（登录、抓 XHR、截图）依赖 `playwright-cli`。**若本机没有 playwright-cli，先请示用户**；
用户同意后再安装（`npm install -g @playwright/cli`，浏览器内核随 `npx playwright install chromium`），
装好再使用本技能。纯 HTTP 侦察（robots/config/bundle 提取、只读 API 单发）不需要浏览器，可先行。
`scripts/recon.mjs` 复用全局 `@playwright/cli` 自带的 playwright-core 与 chromium。

## 在 workbench 中的挂载

本技能在 workbench 里拆成两个兄弟包（`packages/yonkik/` 分组）：
- `yonkik-skill`：方法论（本 SKILL.md + references）+ skill 注册。
- `yonkik-tool`：运行时（lib）+ 脚本（scripts）+ 模板（assets）+ 本地知识库（sites/secrets）+ `yonkik` 读工具。

正文中 `references/` 相对 skill 包根；`lib/` `scripts/` `assets/` `sites/` `secrets/` 均相对 **tool 包根**
（`packages/yonkik/yonkik-tool/`）。执行优先用 `yonkik` 工具（script + args），它内部以 tool 包根为 cwd 跑脚本；
手动跑脚本时用 `node ~/.yonkik/scripts/<名>.mjs`（记忆根脚本，位置无关）。知识库与凭据真实数据本地 gitignore。

**记忆区**：可复用资产（脚本+知识）的稳定家园是 `~/.yonkik/`（`YONKIK_HOME`），与_workbench 包目录_解耦——
workbench 包放代码，知识积累在记忆根、跨项目复用。**产出写记忆根 `sites/`，不写当前工作目录**（避免混入用户文件）。

在 workbench 中，工作台「浙大统一身份认证」的一卡通会**自动桥接**为凭据键 `campus-sso`（只读复用，
值不回显、无需重填）；CAS 站点（zjuam）登录用 `credentialKey=campus-sso` 即可拿到账号密码。
其它独立凭据（如 CC98 自有账号）在「设置 → YONKIK 侦察凭据」里另填。

**workbench 现存数据源仅 `classroom`/`http`/`login`/`webvpn`（加 yonkik）。** `xuezai`（学在浙大）、
`campus`、`xxt`、`zdbk` 等数据源包**已删除**——profile 数据目录里若还有 `zw-xuezai`/`zw-campus`/
`zw-xxt`/`zw-zdbk`，那是**孤儿残留，不是可用数据源**，别去复用它们的加密 session（读不出也没用）。
学在浙大要取数走 yonkik 侦察（campus-sso 登录），不是找已删的 `zwXuezai` 服务。planning 页的
「学在浙大待办」是优雅降级的死路径（`zwXuezai` 服务已不存在），别据此以为有学在浙大数据源。

## 安全契约

这些规则保护的是用户自己的账号和站点的访问契约，违反它们可能封号或误改数据，
所以它们优先于任何探索效率。

1. **只读按语义判，不按 HTTP 动词判。** 标准是「是否改变服务端状态」：
   查询、搜索、下载、GET/HEAD/OPTIONS 允许——很多搜索接口本身就是 POST。
   登录是唯一允许的写操作（建立会话必需，且只用用户提供的凭据）。
   创建、提交、修改、删除、点赞、收藏、标记已读等一律不执行。
   灰区判定见 [references/safety.md](references/safety.md)。

2. **语义不明的接口不调用。** 记入 `endpoints.json` 的 unverified 区并标注疑似写。
   宁可少探一个接口，不可误写一次。

3. **探索期 agent 串行单发，绝不批量。** 任何时刻只有一个在途请求，不写循环
   批量打接口。探索的目的是认识接口，不是搬数据；批量是用户的决定，只发生在
   用户显式运行落盘脚本时，且脚本内置限流。

4. **协议先行。** 每站第一步抓 robots.txt、API 文档、服务条款、响应头，提取
   自动化与限流要求，带证据写进 `site.json`。查不到就用保守默认（间隔 ≥ 2s、
   并发 1）。遇到 429/Retry-After 立即停等并记录。详见
   [references/rate-limits.md](references/rate-limits.md)。

5. **凭据隔离。** 密码只进 `secrets/credentials.json`（已 gitignore）；
   `state.json` 含会话 cookie，同样是敏感凭据（已 gitignore）。
   WIKI、脚本、日志、聊天里不出现密码和 cookie 值。

6. **不绕过访问控制。** 401/403 记录即止，不尝试绕过，不遍历猜测他人资源 ID。
   WebVPN 是用户已有权限的通道，不是提权工具。

## 产物布局

```
sites/<key>/            key 通常是源站 hostname（WebVPN 站也用源站 host）
├── site.json           origin、via、requires、rateLimit(带证据)、auth 配置
├── endpoints.json      机读接口清单（verified + unverified 候选区）
├── wiki.md             人读 WIKI：入口、鉴权、限流、接口表、坑
├── crawler.mjs         只读爬虫脚本（从 assets/crawler.mjs 复制填充）
└── state.json          登录态（gitignored，lib 自动导入 cookie）
sites/_index.json       单一索引：依赖图 + 探索队列 + 资产目录（status/requires/...）
sites/_sso.json         SSO 家族图谱：IdP → 凭据键 + 成员站
sites/_playbook.md      跨站可迁移经验（每条带证据 + 适用范围）
lib/                    零依赖 Node 运行时（http/cookies/credentials）
secrets/                凭据目录（gitignored）：intake.example.json 入口模板 / credentials.json 模型写入
```

字段 schema 与 WIKI 模板见 [references/artifacts.md](references/artifacts.md)。

## 凭据与网站入口（仅首次配置，零基础用户）

**本节只在记忆区尚无可用凭据时才走。** 若 `campus-sso` 已桥接、或 `credentials.json`/`state.json`
已有凭据，跳过本节直接复用（见顶部「第 0 步」）。

用户可能完全不会编程——不开终端、不配环境变量、不懂 JSON 语法。入口的分工是：
**聊天里用户只说目标；网址和凭据全部填进本地 JSON，模型引导，数据不经聊天。**

- 聊天只收**目标**（想拿什么数据：查书/下电子书/查课表…），用于任务 scoped 探索。
- **网址、凭据用途、凭据值**一律填进本地 `secrets/intake.json`，不在聊天里给。
  聊天会留痕，任何数据（含网址、密钥）发进聊天都构成暴露，「模型不复述」救不回来。

凭据每条含 `描述` + 若干通用键（键一/键二/键三…，数量任意），描述说明每个键
是什么（账号/密码/API key/凭证码/cookie…），不固定 username/password。
不要求用户预先映射「哪套凭据用于哪个站」——那由模型探索时发现（SSO 识别、
登录探测、`_sso.json` 家族登记）；判断不了就问用户。

流程：

1. 模型从 `secrets/intake.example.json` 生成 `secrets/intake.json`：含 `网站` 列表
   与 `凭证` 数组，值留占位符，`_说明` 写好填写指引。
2. 模型在聊天里**只给填写指引**（不索要数据）：右键 intake.json → 打开方式 → 记事本，
   在「网站」填网址、在「凭证」每套写描述+键值（需几套加几条），保存。
3. 用户本地填完保存，告诉模型「填好了」。模型**读 intake.json 并校验 JSON**：
   格式坏了指出第几行怎么修，但**不读出/不回显密钥值**。
4. 模型**拆分落盘**：凭证 → `secrets/credentials.json`（键 = credentialKey，供
   `site.json` 的 `auth.credentialKey` 引用）；网站 → `sites/_index.json` 进 triage。
   确认只说「凭据 X 已写入含 N 键、网址 M 个」，不复述值。

零基础用户只需「聊天说目标 → 按指引在记事本填文件 → 保存」，语法风险由模型校验
兜底，网址与密钥全程不上聊天。格式见 `secrets/intake.example.json`。

## 多站编排

用户一次给多个网址时，主 agent 跑编排循环，**每个站点的深探（单站完整工作流）
派一个子代理**（fresh context，避免长会话上下文污染导致质量衰减；单站任务可主 agent 自己跑）。
串行派遣：共享 CAS/网关的站并发会撞限流和会话争用，串行代价可控。

```
triage O(N)：每站几个廉价请求归类去重 → 写入 _index.json（status: pending）
loop：
  选站：依赖已满足 ∧ 期望收益最大（枢纽 > 成员、任务相关、playbook 可迁移）
        按内容画像置信度做相关性路由：低相关 ∧ 高置信站跳过深探（可逆、留痕）
  派子代理：标准简报包 → 按下方单站工作流深探 → 产出全部落盘
  主 agent 读盘：更新 _index / _sso / _playbook（backprop）
  重估下一站（资产变了，下游价值和前提都变了）
until 队列空或预算尽；blocked 站显式记录原因并问用户，不静默丢弃
```

这不是数值 MCTS：没有 rollout，价值靠模型语义判断，程序只维护图和队列。
选站用内容画像的置信度做**相关性路由**——可见读数、可逆跳过，不是输出质量门控。
每轮**重估**是关键——探完枢纽站后，成员站可能已免登、已可复用
playbook，静态排序会错过这些。triage 程序、选择输入、相关性路由、子代理简报模板、
写回契约见 [references/orchestration.md](references/orchestration.md)。

## 工作流

以下是单站深探流程，由子代理（或单站任务时的主 agent）执行。

### 阶段 0 · 先读已有知识

（即顶部「第 0 步：永远先读记忆」，无条件、先于一切假设。）
**先读记忆区入口 `~/.yonkik/MEMORY.md`**（脚本清单+参数+站点目录+约定），再读 `sites/_index.json`、`sites/_playbook.md`、`sites/_sso.json`（都在记忆根 `~/.yonkik/` 下，由 `YONKIK_HOME` 定位）。
目标站点 status=done → 读它的 `wiki.md` 和 `endpoints.json`，直接用现成脚本，
只对失效部分（401、响应结构变化）和本次任务新增的候选做增量重探，不全站重来。
playbook 里适用本站的经验直接采用（带证据的迁移，不是猜测）。
这是本技能存在的全部意义，跳过它等于白探索。
未命中（新站）→ 单站任务从阶段 1 开始；多站任务进编排循环。

### 阶段 1 · 协议侦察（不需要登录）

triage 已抓过 robots.txt 与重定向链 → 直接复用结论，本阶段只补抓 triage 没做的
（sitemap、API 文档、ToS），不重复请求。

- GET `sitemap.xml`；找 API 文档入口（`/openapi.json`、`/swagger`、
  `/api-docs`、页脚"开发者/API"链接）；读服务条款里的自动化条款。
- 留意响应头 `X-RateLimit-*`、`Retry-After`。
- 把结论写进 `sites/<key>/site.json`：`rateLimit.minIntervalMs` + `source` +
  `evidence`（原文摘录）。没有证据就用默认值并标 `source: "default"`。
- URL 长得像 WebVPN 包装（`/http/<一长串hex>/...`）→ 先读
  [references/webvpn.md](references/webvpn.md)，按源站 host 建 key。

### 阶段 2 · 鉴权（模型自主写登录脚本）

**登录脚本由你自己写，不是等现成的。** 按站点鉴权类型（OAuth password / 表单 / CAS / Keycloak broker）
用 `playwright-cli` + 桥接凭据（`campus-sso` 等）写一个登录脚本，经 `yonkik put sites/<key>/login.mjs <内容>`
落盘、`yonkik run sites/<key>/login.mjs` 执行（见「工具边界」）。
`assets/crawler.mjs` 旁的 login 示例只是 cc98 OAuth 一例；CAS/Keycloak 站要你照其流程自己实现。

**验证码先自己尝试攻破，不要默认甩给用户。** 用视觉模型/OCR 识别并作答（workbench 配有视觉模型；
上游微信读书验证码就是视觉模型自动作答）。账号密码 + 验证码类登录应自主完成；**多次尝试仍失败才请用户协助**。
只有扫码（QR）这类必须本人操作的才直接请用户扫。

登录成功后 `playwright-cli state-save sites/<key>/state.json`，`lib/http.mjs` 自动导入 cookie。
登录态过期 → 重跑你写的登录脚本即可，接口知识不用重探。凭据键 = `site.json` 的 `auth.credentialKey`
（CAS 家族共用 campus-sso，一证多站）。

### 阶段 3 · 接口发现

通过浏览器 UI 只读地浏览：列表页、详情页、点一次无害搜索——这些 UI 操作触发的
XHR 供你观察，不是用 lib 主动打接口。同时：

- `playwright-cli requests` 列出网络请求，`playwright-cli request <id>` 看
  单个 XHR/fetch 的 URL、方法、载荷、响应——这是接口清单的主要来源。
- `playwright-cli webmcp-list`：页面若注册了 WebMCP 工具，**只调用标了
  `[readOnly]` 的**，一次调用替代一串点击。
- 探测阶段 1 找到的 openapi/swagger；从页面 JS 里搜 `/api/` 路径作补充。

每个候选记录：method、path、参数、来源页面、疑似语义。此阶段只**被动观察** UI
触发的请求，不用 lib 客户端主动调用候选接口（主动单发验证是阶段 4）。

### 阶段 4 · 单发验证

与阶段 3 的被动抓包不同，这里用 lib 客户端**主动**对每个候选打**一次**良性请求
（搜索用无害词、分页取第一页、详情取一个用户自己的资源）。记录真实响应结构。判定：

- 响应正常且语义只读 → 进 verified。
- 语义不明 / 疑似写 → 不调用，进 unverified。
- 401/403 → 停止该接口，记录状态码，不绕。

### 阶段 5 · 落盘脚本

复制 [assets/crawler.mjs](assets/crawler.mjs) 到 `sites/<key>/crawler.mjs`，
把 verified 接口实现成命名操作（参数化，下载用 `client.download`）。
只实现只读操作——脚本的能力面就是安全边界，lib 不提供 put/patch/delete。
填完跑 `node crawler.mjs --list` 和每个操作的一次单发，确认可用。

### 阶段 6 · 写 WIKI

按 [references/artifacts.md](references/artifacts.md) 的模板写 `wiki.md`（人读）
和 `endpoints.json`（机读），更新 `sites/_index.json`。WIKI 要写坑：
哪个接口会 302 到登录、哪个参数必填、token 从哪来、限流证据原文。
下一个 agent 靠这些省掉重新探索。

## 增量探索：多次逼近，不求单次收敛

每次访问是**任务 scoped 的增量**：优先探与用户当前任务相关的接口，其余记入
unverified 候选区即可，不必把整站翻完。候选区就是下次探索的起点——整棵接口树
靠多次会话逐步逼近，远比单次强行收敛便宜、安全、可恢复。

停止条件（满足其一即收工落盘）：本次任务所需接口已验证可用；单站预算尽
（几十次单发请求量级）；感到"在搬数据而不是在认识接口"。批量需求留给落盘脚本。
收工时 wiki 和 endpoints.json 必须写清「本次探了什么、还剩什么候选」，
让下一次无缝接续。

## 参考导航

| 何时读 | 文件 |
|---|---|
| 多站排队 / 派子代理 / 写回契约 | [references/orchestration.md](references/orchestration.md) |
| 拿不准某接口能不能调 | [references/safety.md](references/safety.md) |
| URL 是 WebVPN 包装 / CAS 登录 | [references/webvpn.md](references/webvpn.md) |
| 定限流值、处理 429 | [references/rate-limits.md](references/rate-limits.md) |
| 写 site.json / endpoints.json / wiki.md | [references/artifacts.md](references/artifacts.md) |
| 浏览器操作细节 | 仓库 `skills/playwright-cli/SKILL.md`（官方原文） |