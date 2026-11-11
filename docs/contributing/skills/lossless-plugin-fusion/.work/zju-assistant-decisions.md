# 裁决记录

## 第 4 步 · 数据源集成范围

**裁决人**：用户（2026-11-09 23:08）
**裁决内容**：**18 个数据源全部接入**。WebVPN 走上游口径，不另立规则。
**与推荐的关系**：我未给推荐（这一步按硬规则 1 不替用户裁决），用户选择全覆盖。

### 后果（必须记录的影响）

1. **上游 `writes: true` 的 6 个模块全部进入范围**：`zdbk`（选课）、`sztz`（二课报名）、
   `tyys`（场馆预约）、`xuezai`（交作业/签到）、`pta`（交作业）、`cc98`（发帖/私信）、`lab`（选实验）。
   这批命令在上游都过 `ctx.approval` + `ZJU_ALLOW_WRITE=1` 双闸。
   **本仓是否有等价审批机制，我仍未核实** —— 这是实现前必须解决的前置项，否则这是把
   「能改学校系统的写操作」接进一个没有审批落点的仓库。
2. **`lab` 模块的主机是 `10.203.16.55`**（私网 IP），`network: campus`。经 WebVPN 改写私网 IP
   是否可行，上游没有测试记录 —— 这是已知风险项。
3. **`cc98` 的 `network: campus`** 但域名不在 `zju.edu.cn` 下（`cc98.org`），
   本仓 `packages/source/webvpn/src/egress.js` 的 `CAMPUS_SUFFIX = 'zju.edu.cn'` 单一规则**覆盖不到它**。
   本仓 `source/cc98` 现在怎么走，需在第 7 步单独查证。

---

## 第 4 步附 · WebVPN 走法（上游口径）

用户指示「根据上游的决策来决定走不走 webvpn」。上游的口径不是一句话，是**两层**：

### 第一层：模块级声明（`lib/<模块>/module.json` 的 `network`）

| 模块 | network | auth | 主机 | 上游判据 |
| --- | --- | --- | --- | --- |
| `webvpn` | public | own | webvpn.zju.edu.cn | 网关自己必须直连 |
| `zjuam` | public | none | zjuam.zju.edu.cn | 统一身份认证公网可达 |
| `zdbk` | **public** | cas | zdbk.zju.edu.cn | 实测公网可达 |
| `yjsy` | **public** | cas | yjsy.zju.edu.cn | 实测公网可达 |
| `xuezai` | **public** | cas | courses.zju.edu.cn | 实测公网可达 |
| `zhiyun` | **public** | cas | classroom / yjapi.cmc / education.cmc / tgmedia.cmc | 实测公网可达 |
| `tyys` | **public** | cas | tyys / www.tyys | 实测公网可达 |
| `chalaoshi` | public | none | chalaoshi.de / api.chalaoshi.de | 公网站 |
| `chaoxing` | public | own | chaoxing.com | 公网站 |
| `pta` | public | own | pintia.cn / passport.pintia.cn | 公网站 |
| `doc` | public | none | （无固定主机） | 本地为主，需 `zdbk` 登录附件 |
| `notice` | **campus** | cas | zju.edu.cn（逐站表见下） | 部分学院站点只在校内 |
| `sztz` | **campus** | cas | sztz.zju.edu.cn | 只在校内 |
| `cc98` | **campus** | own | cc98.org | 只在校内（域名不在 zju.edu.cn 下） |
| `ebook` | **campus** | none | gk4pb6yy8y.search.serialssolutions.com / sslibrary.com | 只在校内 |
| `cnki` | **campus** | none | cnki.net | 只在校内（IP 登录） |
| `lab` | **campus** | own | **10.203.16.55** | 私网 IP |

**规则落地**（`lib/webvpn/transport.ts:74`）：

```ts
const transport = req.network === "public" ? "direct" : (opts.transport ?? currentTransport())
```

即：`public` → **永远直连**，连用户在设置里选了「都走 WebVPN」也不改；
`campus` → 跟随用户设置（`auto` 时校内直连、校外绕网关）。

### 第二层：主机级例外（`publicHosts` + 运行时降级）

`transport.ts:34-41` 的 `rewriteFor()`：

- `campus` 模块里，`publicHosts` 点名的主机**直连**（实测公网可达）；
- 直连失败（`TransportError`）或落到 `/nopermit_zjusub.jsp`「无权访问」页 →
  **这一次运行里把该主机从直连集合移除，之后走 WebVPN**（`open.delete(host)`，`transport.ts:139`）。
  降级是**会话内持久**的，不是单次重试。

`notice` 模块就是这一层的典型：逐站表在 `lib/notice/hosts.json`，由 `scripts/notice/hosts.ts`
在**外部干净主机上用 curl 实测**生成（`via: "server"`，`generatedAt: 2026-10-09`）：
命中统一身份认证登录页 → `public + cas`；200 → `public`；
连不上/超时/403/5xx/`nopermit_zjusub.jsp` → `campus`。

实测结果 68 个主机：**47 个 public、21 个 campus**。例如
`zdbk.zju.edu.cn` 是 public+cas，而 `ygb.zju.edu.cn`、`zjutw.zju.edu.cn`、
`office.*` 系列、`bms.zju.edu.cn` 等是 campus。

### 与本仓现有口径的冲突（**必须由用户裁决**）

本仓 `packages/source/webvpn/src/egress.js` 只有一条规则：

```js
const CAMPUS_SUFFIX = 'zju.edu.cn'
export const PUBLIC_AUTH_HOSTS = Object.freeze(['zjuam.zju.edu.cn', 'identity.zju.edu.cn'])
```

即 **`*.zju.edu.cn` 在校外一律绕 WebVPN**，只有两个认证主机直连。

与上游口径的直接冲突：

| 主机 | 上游 | 本仓现规则 | 差异 |
| --- | --- | --- | --- |
| `zdbk.zju.edu.cn` | **public 直连** | campus 绕网关 | 教务网被无谓绕道 |
| `courses.zju.edu.cn` | **public 直连** | campus 绕网关 | 学在浙大被无谓绕道 |
| `classroom.zju.edu.cn` 等 4 个 | **public 直连** | campus 绕网关 | 智云被无谓绕道 |
| `tyys.zju.edu.cn` | **public 直连** | campus 绕网关 | 场馆被无谓绕道 |
| `yjsy.zju.edu.cn` | **public 直连** | campus 绕网关 | 研究生教务被无谓绕道 |
| `sztz.zju.edu.cn` | campus 绕网关 | campus 绕网关 | 一致 |
| `cc98.org` | campus 绕网关 | **规则覆盖不到** | 本仓会直连，校外必然失败 |
| `10.203.16.55`（lab） | campus 绕网关 | **规则覆盖不到** | 私网 IP，本仓会直连 |
| `pintia.cn` / `chaoxing.com` / `chalaoshi.de` | public 直连 | 非 zju 域，直连 | 一致 |

**这不是笔误层面的差异**：本仓现行的「一个后缀管全部」是粗粒度近似，
上游是逐模块 + 逐主机实测。用户说「走上游口径」，那么本仓 `egress.js` 的
`CAMPUS_SUFFIX` 单规则需要改成**按主机表判定**，否则会退回粗粒度。

需要用户确认的三件事在下面「待裁决」一节。

---

## 第 4 步附 · 数据源拆包（Q-B 定案）

**裁决人**：用户（2026-11-09）
**裁决内容**：**把 `packages/source/campus` 这个「学在 + PTA 混装包」拆开。**

### 拆包前的事实（已取证）

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/index.js` | 923 | 服务装配 + `todos()` 学在待办 + `ptaRead()` + `egressStatus()` |
| `src/xzzd.js` | 717 | 学在浙大客户端（`todosFast:382`、`todos:432`） |
| `src/xzzd-reads.js` | 518 | 学在读器（`activities:272`、`assignments:303`、`materials:381`） |
| `src/pta.js` | 521 | 拼题A 客户端 |
| `src/cas/` | 607 | CAS 登录，**只被 `index.js:40` 引用一次** |
| `src/egress.js` + `hosts.js` + `reads.js` | 156 | 出口与主机常量 |

### 拆包方案

| 新包 | 收什么 | 来源 |
| --- | --- | --- |
| `packages/source/xuezai/` | `xzzd.js` + `xzzd-reads.js` + `cas/` + 学在侧的 `todos()` | 从 `campus` 迁出 |
| `packages/source/pta/` | `pta.js` + PTA 侧的 `ptaRead()` | 从 `campus` 迁出 |
| `packages/source/campus/` | **退役**（或只留 `egressStatus` 一类共享件，若无人消费则整体删） | — |

### 必须同步改的调用方（已取证）

| 调用方 | 位置 | 现在读什么 | 拆包后 |
| --- | --- | --- | --- |
| `packages/core/planning/src/index.js` | `:1926` | `ctx.get('zhiyunCampus')` → `campus.todos()` | 改指向新学在包的服务名 |
| `packages/source/login/src/index.js` | `:574` | `ctx?.get?.('zhiyunCampus')` → `campus.egress?.()` | 改指向新出口服务或直接读 `zhiyunEgress` |
| `packages/radar/dsh-radar-pta-progress` | 全文含 `zhiyunCampus` | 取 PTA 进度 | 改指向新 PTA 包 |

### 拆包顺序（分两步，留回退路径）

1. **第一步**：新建 `source/xuezai` 与 `source/pta`，把上游缺口能力一并实现；
   老 `source/campus` **保持不动、继续挂着**，`planning` 仍读 `campus.todos()`。
   此阶段两个服务并存，**但服务名不能重复**（本仓 README 记过 `zhiyunEgress` 重名直接报错）。
2. **第二步**：新包稳定后，改三处调用方指向、卸下 `source/campus`。

### 风险

- `source/campus` 的 `todos()` 有 `fast / slow / diff` 三种模式（`index.js:485`），
  迁移时要原样保留，尤其是 `fast` 模式注释里那段「1 个请求 vs 42 个请求、48 秒」的
  实测依据 —— 那是本仓自己的性能决策，不能被上游实现覆盖。
- `cas/` 607 行只服务学在登录；PTA 走独立账号体系（`pta_username`），不共用 CAS。

---

## 第 6 步附 · 总则与分层硬约束

**裁决人**：用户（2026-11-09）
**裁决原文**：**「不要嫌麻烦，项目规则和尽可能无损放在首位。」**

### 分层硬约束

| 层 | 能放什么 | 不能放什么 |
| --- | --- | --- |
| `packages/source/*` | 连外部站点、只提供事实 | 变换、跨会话状态、UI |
| `packages/core/*` | 变换、状态、路由 | **数据源**（不连外部站点） |
| `packages/tool/*` | agent 工具注册 | 业务实现 |
| `packages/client/*` | 只含 UI | 数据获取 |
| `packages/preset/*` | 工具可见范围 | 工具实现 |

**「`core` 不放数据源」的推理**（用户给的理由）：
`core` 若放数据源，就得同时拥有一个「数据源操作对象」；而数据源对象本身属于 `source`，
于是 `core` 又得依赖数据源 —— 矛盾。所以**涉及数据的一律进 `source` 或 `tool`**。

### 对清单的连带影响

- 13 个待新建数据源包全部落 `packages/source/*`，无一进 `core`。
- 有「状态 + 轮询」的链路（如 `mail-feed`）拆到 `core`，但它**不连外部**，只消费 source 的读接口。
- 任何「为一个包省事而合并职责」的方案，必须在清单写清代价并交用户裁决。

---

## 第 6 步附 · 邮箱拆 4 包（Q-C 定案）

**裁决人**：用户（2026-11-09）
**裁决内容**：上游邮箱链路拆 **4 个包**。

### 前置事实（回答用户提问）

用户问：「上游路线里需要邮箱是干啥用的？是仅拉取用户邮箱的资源作为 data 并接给 AI 嘛？」

**不是。** 源码取证 `plugin/host/mail.mjs` + `mail-feed.mjs` + `mail-vault.mjs` + `rows/mail.mjs`：

| 职责 | 证据 | 性质 |
| --- | --- | --- |
| 读（IMAP） | `folders:153` / `list:160` / `inbox:188` / `read:224` / `download:231` | 数据源 |
| 写（SMTP 发信） | `send:297` / `updateDraft:284` / `removeDraft:276`；审批在 `rows/mail.mjs:84-87` | 数据源 + 工具 |
| 草稿本地状态 | `draftFile:244` / `revision:248`（sha256）/ `drafts:250` / `prepare:261` | 有状态加工 |
| 后台轮询与基线 | `mail-feed.mjs` 的 `check:93` / `read:100` / `onNew:131` | 有状态加工 |
| 凭据封存 | `mail-vault.mjs` → `ctx.credentials` 的 grant | 数据源依赖 |
| 连接表单 | `client/MailSettings.tsx`（`mail-status`/`mail-connect`/`mail-test`/`mail-disconnect`） | 界面 |

结论：**读写双向 + 本地草稿状态 + 后台轮询 + 凭据封存 + 界面**，五类职责。

### 拆分

| # | 包 | 分层 | 收什么 |
| --- | --- | --- | --- |
| 9-1 | `packages/source/mail/` | source | IMAP/SMTP、读接口、`send`、草稿文件、`mail-vault` |
| 9-2 | `packages/tool/mail/` | tool | `campus_mail`（7 个 action）、`campus_mail_send`（走 P0-1'） |
| 9-3 | `packages/core/mail-feed/` | core | UID/UIDVALIDITY 基线、`check()`、`onNew`、本地缓存 |
| 9-4 | `packages/client/`（并入或新建） | client | `MailSettings` + 通知栏邮件条目 |

### 必须分开的四条理由

1. **`core` 不放数据源** —— 邮箱数据源只能在 `source/`。
2. **`mail-feed` 不能放 source** —— 它持有 `cache/mail-feed.json` 跨会话状态，要接 `onNew` 回调进提醒总线；
   而本仓 source 包定位是「只提供事实，不做变换」。
3. **后台轮询不能触发审批**（`user-approval/src/index.ts:244` 要求 turn 已开启）——
   `check()` 只能读，发信必须 agent 在 turn 内发起。拆包后天然满足。
4. **凭据依赖方向** —— `mail-vault` 依赖 `@deepseek-ai/dsh-credentials`，`source/*` 的 peer 依赖里没有它。
   本方案选择留在 `source/mail` 并补一个 peer 声明（凭据是「连这个数据源所需的东西」，
   与 `source/login` 保管一卡通同性质）。

### 待定

`9-3 core/mail-feed` 是否必要独立 —— 若本仓 `source/` 已有持本地状态的先例，可并入 `9-1`。
等溯源代理确认后定。**按总则，倾向独立成包。**

---

## 第 9 步附 · preset 决策延迟（Q-E）

**裁决人**：用户（2026-11-09）
**裁决内容**：**本裁决延迟决定。**

**理由（用户原话）**：
> 在所有新工具注册完毕之前，用户无法判断最终具体有哪些可用工具。
> 而且接入 preset 作为拓扑最顶层，暂时不决策。

### 由此确定的两件事

1. **preset 的位置是拓扑最顶层** —— 在依赖图里排在所有 `tool` 之上。
   理由：preset 不产生能力，只决定「哪些能力对谁可见」，所以它必须最后装配。
2. **时序约束**：preset 裁决必须等工具全部注册完成之后。
   在信息不全时定 preset，等于在不知道最终能力集的情况下做裁剪决策。

### 对实施的硬约束（必须遵守，否则会污染所有会话）

| # | 约束 |
| --- | --- |
| 1 | 工具包可以照建、照测（单元测试直接 `ctx.tools.register` 即可） |
| 2 | **不要挂进任何 profile bundles** —— 挂进去就等于对每个会话生效 |
| 3 | 等 preset 裁决完成，再决定注入点 |

**为什么第 2 条是硬约束**：本仓 `packages/tool/study/src/index.js:53` 的约定是
「工具包只 `ctx.tools.register`，不带自己的挂载行」。一旦把工具包写进 profile bundles，
它就绕过了 preset 这一层，对本仓所有会话可见 —— 这正是上游用 10 行子插件开关刻意避免的事。

### 留给后续的三个子问题

1. 9 个工具是否只对「校园任务」有意义（→ 新增 preset），还是与现有 `preset/lecture` 重叠（→ 并入）
2. 上游的「10 行子插件开关」在本仓用什么等价机制：
   `ToolRegistrationOptions.activate`（`core/tools/src/contracts.ts:115`）？preset allowlist？还是别的
3. 关掉的行，其工具是彻底不可见，还是仍在工具表里但执行时报错
   —— 上游是后者（`zju-tool.mjs:76-77` 在 `execute` 里抛「这一行在插件页里关着」）

---

## 第 9 步附 · skill 新增确认与延迟（Q-F）

**裁决人**：用户（2026-11-09）

| 项 | 结论 |
| --- | --- |
| 新增还是并入 | **新增** |
| 如何新增 | **延迟决策** |

**用户原话**：
> 本项目还没有专门给 AI 写的 skill，因此此 skill 应该作为新增，
> 但如何新增需要延后决策，理由：skill 依赖其 skill 中罗列的 tool 而成立，
> 因此也需要在 tool 全部注册完成后再定

### 理由的源码支撑

上游 skill 正文几乎全是**工具调用说明**。`plugin/skill/SKILL.md` 的「工具」一节逐个列出
`zju` / `campus_profile` / `campus_note` / `campus_schedule` / `campus_context` / `campus_notify`，
再往下 9 篇 `skill/rows/*.md` 分别讲各自模块的命令怎么拼参数。

**工具的最终形状变了，skill 正文就得跟着重写。** 所以顺序只能是「先工具、后 skill」。

### 与 D11 的因果链

```
数据源包 → proc 包 → tool 注册 → ┬→ preset（哪些工具对谁可见）  D11 preset 延迟
                                  └→ skill（怎么用这些工具）      D12 skill 延迟
```

两处延迟不是两个独立决定，是同一因果链的两端。**任何先写 skill 再写工具的顺序都会返工。**

### 本仓现状（支撑「无可并入」）

| 目录 | 内容 | 是否可并入 |
| --- | --- | --- |
| `docs/contributing/skills/human-factors-screen-design/` | 人体工效学，8 份公有领域标准 | 否，主题无关 |
| `docs/contributing/skills/lossless-plugin-fusion/` | 本次用的融合流程 | 否，主题无关 |

两者都**不是给 AI 干本项目活用的**，且该目录 README 第 5 行明确写「这里不是任何 harness 的自动加载目录」。

### 待 Q-F 定案后要回答的四个子问题

1. **放哪**：`docs/contributing/skills/zju-campus/`（不入扫描根，需手动装）？
   还是新建本仓自己的扫描根（如 `.agents/skills/`）？后者会让 skill 对所有使用者生效，
   与 `docs/contributing/skills/README.md:30-32`「自动加载目录会与本仓库的公开性质冲突」的既有立场相反。
2. **走哪条注册路**：静态文件（扫描根）还是 `ctx.skills.registerProvider`（上游做法，可动态拼正文）？
   上游选后者是因为要按「开着的行」拼段落；本仓若无行开关机制，静态文件可能更简单。
3. **正文写什么**：9 个工具全部注册完才知道。上游 5.4 KB 正文 + 3 篇 references 要按本仓工具重写，
   **不能照抄**（工具名、参数、调用约定都可能不同）。
4. **可见性**：`userInvocable` 设 true 还是 false？上游设 false（不进 `/` 菜单），
   因为它是「模型自己判断该用时用」，不是「用户手动触发」。

---

## 第 7 步附 · lab 可行性实测（Q-G）

**裁决人**：用户（2026-11-09）

| 项 | 结论 |
| --- | --- |
| 先实测还是直接建包 | **先做可行性实测**，再建包 |
| 前提 | **上游说能通，我们也相信能通** |
| 实测失败时的态度 | **不可以因为实测不通过便认定不可行** |
| 穷尽策略仍失败 | **告知用户，由用户决策** |

**用户原话**：
> 上流说能通我们也相信能通，可以先做可行性实测，但不可以因为实测不通过便认定不可行，
> 若采取各种策略仍然失败需要告知用户，到时候再由用户决策

### 实测前已核实的上游证据（把 R1 从「未验证」降级）

我上一版把 R1 写成「私网 IP 能否被网关转发，上游与我方都无证据」。**这是错的**，上游有证据：

| 证据 | 位置 | 内容 |
| --- | --- | --- |
| 明确写了走 WebVPN 重写 | `core/zju/lib/lab/index.ts:6` | 「API 在 `http://10.203.16.55:8098/lab-course/api/*`（HTTP，校内 IP，**走 WebVPN 重写 http-8098**）」 |
| 声明 | `index.ts:42-49` | `hosts: [LAB_HOST]`、`auth: 'own'`、`network: 'campus'`、`writes: true` |
| 实际调用 | `index.ts:486` | `await openContext(requirements, opts)` → `rewriteFor` → `rewriteUrl` |
| 改写函数支持端口 | `core/zju/lib/webvpn/client.ts:72-75` | `port = u.port ? '-'+u.port : ''`，生成 `/http-8098/<hex>/...` |
| 加密不挑格式 | `packages/source/webvpn/src/protocol.js:69-70` | `wrdEncrypt` 对任意明文做 CFB，IP 与域名无差别 |
| 我方同样支持 | `packages/source/webvpn/src/protocol.js:107-108` | `property = target.port ? scheme+'-'+target.port : scheme`，同样生成 `http-8098` |

**结论**：改写链路对私网 IP 在**机械上完全可行**，且上游已按此实装。
实测要验证的不是「能不能改写」，而是「网关是否愿意代理这个内网目标」——
这是网关侧的策略问题，不是协议问题。

### 「各种策略」的清单（实测顺序，逐条尝试）

按代价从低到高，每条都要留下结果记录，不能跳过：

| # | 策略 | 做法 | 预期 |
| --- | --- | --- | --- |
| 1 | **经 WebVPN 改写 8098** | `http://webvpn.zju.edu.cn/http-8098/<wrdEncrypt 后的 hex>/lab-course/api/...` | 上游口径，最可能成功 |
| 2 | **经 WebVPN 改写 86** | 同上但 `http-86`，打 SPA 静态页 | 验证网关是否只拦某些端口 |
| 3 | **换协议 https** | 试 `https-8098` | 若后端只支持 http 会失败 |
| 4 | **校内直连** | 若本机在校园网（`mirrors.zju.edu.cn/api/is_campus_network` 返回 1/2），直接打 `10.203.16.55:8098` | 排除网关因素，验证平台本身可达 |
| 5 | **WebVPN 全量模式** | 网关的「全部走代理」入口（非改写模式），让网关自己解析内网 IP | 部分网关版本支持 |
| 6 | **查网关是否暴露该目标的登录跳转** | 请求 `http://10.203.16.55/`，看网关返回什么（403/404/登录页） | 从错误码判断是「拒绝代理」还是「代理了但目标不可达」 |
| 7 | **上游 issue / 文档** | 查上游仓库是否有人报告 lab 在校外失败 | 上游自述「已实测」则策略 1 应当有效 |

**实测到什么程度算「通过」**：能完成一次 `lab courses`（列出实验课）的读请求即算通；
不需要做到选课写操作。

### 失败上报的格式（必须遵守）

若策略 1–7 全部失败，**不得**写「lab 不可行」然后删掉这一项。必须交一份报告给用户，含：

1. 每条策略的**实际请求地址**（含改写后的完整 URL）与**实际响应**（状态码 / 错误体 / 网关返回页的关键内容）
2. 区分三类失败原因：
   - **网关拒绝代理该目标**（网关侧策略，本仓无法解决）
   - **代理了但目标不可达**（校内网络策略或平台下线）
   - **本仓改写实现有 bug**（我们能修的）
3. 明确说出「以上三条哪一条成立」，不确定就写「不确定」
4. 给出可选项交用户决策：放弃 lab / 改成「只在校园网内可用」/ 等上游更新 / 其他

### 对清单的连带影响

| 项 | 变化 |
| --- | --- |
| S-14 `lab` 建包 | 从「先实测再建」改为「**实测作为前置任务，通过后建包**」 |
| R1 风险等级 | 从「判断可能不可达」降为「机械可行，待验证网关策略」 |
| 依赖顺序 | S-14 实测依赖 P0-2 WebVPN W1–W2（需要主机表判定 + 会话内降级才测得准） |
