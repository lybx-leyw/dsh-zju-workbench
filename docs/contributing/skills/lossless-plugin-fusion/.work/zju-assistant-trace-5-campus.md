# 溯源结果 · 代理 5：`packages/source/campus` 拆包可行性

**来源**：子代理只读溯源本仓（未读 vendor、未跑安装、未改文件）。

---

## 一、核心结论（推翻我清单里的拆包设想）

**可行，但不是「切目录」而是「切 `index.js`」。**

| 单元 | 可切性 | 依据 |
| --- | --- | --- |
| `src/pta.js`（521 行） | **零外溢**，可先无损切走 | 只 import `source-http` + `hosts.js`（`pta.js:33-34`） |
| `src/xzzd.js` + `xzzd-reads.js` + `cas/*` + `egress.js` | 自成体系 | 内部闭环 |
| `src/index.js`（923 行） | **深度混装**，是真正的工作量 | 三份会话、一个 `todos()`、一个路由、一个服务对象、一个缓存、一张错误码表全在同一批闭包里（`:158-169`、`453-531`、`720-803`、`805-831`） |

我清单里写「收 `xzzd.js` + `xzzd-reads.js` + `cas/` + 学在侧 `todos()`」——**这个描述掩盖了真实工作量**：
`index.js` 的 923 行要被逐段切成两半，而不是把几个文件移过去。

---

## 二、四个必须知道的硬风险

### R-1 · PTA Cookie 不可自愈（最高）

三份会话同住 `<profile>/data/zhiyun-campus/`（`index.js:158,167-169`）：
- `xzzd.session` —— 可自动重建
- `pta.session` —— **短信验证 → 手工粘贴**得来（`index.js:436-444`、`README.md:128-130`），**丢了无法自动恢复**

→ **拆包绝不可顺手改 `dataDir`**，否则给每个用户制造一次不可自愈的操作。

### R-2 · `{ xzzd, pta }` 是跨包契约，不只 campus 内部用

| 消费方 | 位置 | 用法 |
| --- | --- | --- |
| `core/planning` | `src/index.js:1680-1682` | `petContext` 读 `platform?.['xzzd'\|'pta']?.rows` |
| `client/page-planning` | `client.jsx:385-404` | 页面读 `state.todos.xzzd` / `.pta` |
| 探针 | `scripts/source_bridge/xzzd.mjs:45`、`pta.mjs:43-51` | — |

→ 拆完**必须在 planning 侧重新拼回同一形状**，否则坏的形态是「整个规划页没有数据」。

### R-3 · 旧 bundle 名必须登记 retiredBundles

`profile:init` 只清理 `retiredBundles` 里的名字（`scripts/profile.mjs:35-47`、`326-335`）。
Loader 解不开任意一条 bundle 就**整个工作台起不来**（`profile.mjs:31-33`、`CONTRIBUTING.md:250`）。

→ 拆包必须把 `@lybx-leyw/dsh-zju-source-campus` 加进 `retiredBundles`。

### R-4 · 同名三处都硬失败

| 项 | 冲突后果 | 依据 |
| --- | --- | --- |
| 服务名 | 整个插件激活失败，数据路由与 `zhiyunCampus` 一起消失 | `index.js:845-852`（原文报错）、`tests/egress-shared.test.mjs:153-155` |
| 路由 `(kind,path)` | 直接抛错 | `dsh-radar-dsh-web/README.md:106`、`dsh-radar-market/README.md:81` |
| i18n namespace | 同名同语言抛错 | `client.jsx:42-43`（`NAMESPACE='zju-source-campus'`） |
| 设置分区 id | 有守卫扫描 | `tests/source-error-contract.test.mjs:97-130` |

---

## 三、`zhiyunCampus` 完整公开面（11 个成员）

`ctx.provide('zhiyunCampus', {...})` 在 `index.js:805-831`，**完整字面量，无遗漏**：

| 成员（行号） | 职责 | 归属 | 拆包后 |
| --- | --- | --- | --- |
| `routePath`（806） | 本包数据路由 | 共享 | 两包各留自己的 |
| `todos`（807） | **两类待办并发聚合**，返回 `{xzzd, pta}` | **混装** | **必须拆两个方法**，`{xzzd,pta}` 由 planning 拼回 |
| `ptaStatus`（808） | PTA Cookie 是否已配 | PTA | `zhiyunPta` |
| `savePtaCookie`（809） | 整串 Cookie 种进 session | PTA | `zhiyunPta` |
| `fingerprint`（810） | 学在会话 cookie 指纹 | 学在 | `zhiyunXuezai`（**无消费方**） |
| `egress`（812） | 出口状态 | **学在侧**（PTA 永远直连） | `zhiyunXuezai.egress`；唯一真实消费方是 `login` 探针 |
| `xzzdClient`（814） | 造 `XzzdApi` | 学在 | 无产品内调用方 |
| `ptaClient`（815） | 造 `PtaApi` | PTA | **全仓 0 调用方** |
| `ptaRead`（817） | 看题四动作 | PTA | `zhiyunPta` |
| `xzzdRead`（819） | 学在深入读取五动作 | 学在 | `zhiyunXuezai` |
| `loginProfile`（830） | 登录分段耗时 | 学在 | `zhiyunXuezai`；消费方 `source_bridge/xzzd.mjs:59` |

**补充事实**：
- `zhiyunEgress` **已不在本包**（`838-859` 是「为什么必须删掉」的说明），当前由 `source-http` 提供（`packages/source/http/src/host.js:108`），有守卫钉着（`tests/egress-shared.test.mjs:144-206`）。
- `README.md:20-21` 仍写「`provide('zhiyunEgress')` 同名」——**已过期，与代码不符**。

---

## 四、文件级依赖：什么能切、什么必须裁决

### 只服务学在
`cas/login.js`（428）、`cas/auth.js`（145）、`xzzd.js`（717）、`xzzd-reads.js`（518）、`egress.js`（94，其 `DIRECT_SUFFIXES=['pintia.cn']` 是唯一 PTA 痕迹，`:59-62`）

### 只服务 PTA
`pta.js`（521，**自带 `normalizeDeadline`**（`:119-126`），不依赖 `xzzd.js` —— 这是它能零成本切走的关键）

### 必须裁决的三处共享件

| 共享件 | 问题 | 方案 |
| --- | --- | --- |
| `hosts.js`（38 行） | `CAMPUS_HOSTS` 把 CAS、courses、pintia 三类域名装进**同一个 Set**（`:30-37`），而它同时决定 cookie 收发（`:20-29`）。不拆 → 任一侧 Transport 都带另一侧主机白名单（**安全性下降，但不报错**） | **必须按域名拆两份** |
| `reads.js`（24 行） | 通用 `sharedRead`，当前被 `index.js:548` 用于合并两类待办 | 两侧各放一份（24 行无依赖），或上提到 tier 0。**不可**让 xuezai import pta 的（触发 tier1→tier1 守卫，`tests/source-capability.test.mjs:141-156`） |
| `cas/http.js`（34 行） | **死文件**，0 个 import 方，唯一引用是 `package.json:9` 的 `"./http"` 导出子路径 | 不搬 |

### 两处隐藏耦合（最易漏）

1. **出口状态 → login 探针**：`login/src/index.js:576-583` 读 `campus.egress?.()` 的 `viaWebvpn`/`campus`。必须迁 xuezai，**不能**迁 PTA。
2. **SSO 借用 classroom**：`index.js:344-349` 调 `ctx.get('zhiyunClassroom').acquireSso(account)`。tier1→tier1 的**服务**依赖（静态 import 守卫管不到，`tests/source-capability.test.mjs:31-35` 明说不管 `ctx.get`）。**只有学在需要**，PTA 侧必须完全不带。

---

## 五、消费方清单（我清单里漏了 3 倍）

### 原有（我已知）

| 消费方 | 位置 | 拆包后 |
| --- | --- | --- |
| `core/planning` `loadTodos` | `:1925-1940` | **改一段不是改一行**：两服务并发 + 各自 try/catch + 拼回 `{xzzd,pta}` |
| `core/planning` `ptaStatus` | `:1944-1963` | 指向 PTA；**`:1954-1962` 是死代码**，正好清掉 |
| `core/planning` `savePtaCookie` | `:1977-1984` | 指向 PTA，保留 `names → cookie_names` 改名 |
| `source/login` `probeCampusSource` | `:572-587` | `ctx.get('zhiyunXuezai')` |
| `radar/dsh-radar-pta-progress` | `:22` | 纯文本改 `zhiyunPta`（该包 `apply()` 直接抛，未接入） |

### 新发现（清单里没有）

**真实代码（会跑）**：

| 位置 | 用法 |
| --- | --- |
| `scripts/source_bridge/xzzd.mjs:25,31,59` | mount → `routeOf(routes,'/api/zhiyun-campus')` → `services.get('zhiyunCampus').loginProfile()` |
| `scripts/source_bridge/pta.mjs:27,31,34,41,60` | mount → 同路由 → `?pta-cookie` / `?pta-read` / GET |
| `scripts/source_bridge/_base.mjs:216-227` | `mountCampus()` 按包名装配 |
| `scripts/knowledge_tree_bench/_base.mjs`（约 358-372） | 同一套 mountCampus；注释仍称「唯一 provide zhiyunEgress」（**已过期**） |
| `scripts/campus-live-probe.mjs:51-55,73-83` | **直接 import** 五个 src 文件 |
| `tests/campus.test.mjs:19-35,562-574` | 直接 import 五个 src + `apply()` |
| `tests/campus-planning-contract.test.mjs:6-7,19,71` | `apply` campus + classroom + 规划 handler；`ZHIYUN_TODOS='slow'` |
| `tests/campus-egress.test.mjs:16`、`tests/webvpn-egress.test.mjs:13` | import `campus/src/egress.js` |
| `tests/campus-reads.test.mjs:3` | import `campus/src/reads.js` |
| `tests/pta-problems.test.mjs:16`、`tests/xzzd-reads.test.mjs:18` | import `pta.js` / `xzzd-reads.js` |
| `tests/planning.test.mjs:362` | 读 `source/campus/src/client.jsx`，断言含「拼题A Cookie」 |
| `tests/planning-credentials.test.mjs:193` | 读 `campus/src/index.js`，断言 `NEED_LOGIN` |
| `tests/source-error-contract.test.mjs:47-55,85-135` | 断言两张错误表存在且生效；`mustRegister=['login','campus',...]` |
| `tests/egress-shared.test.mjs:197-205` | 断言 campus 不 provide `zhiyunEgress` |
| `tests/campus-live-probe.test.mjs:42,52,53` | 直接 import campus src |

**纯文档/注释引用**（不阻断但误导）：`core/planning:15-16,30,94,1918,1938,1974-1975,1979`；`client/page-planning/client.jsx:144-145,169-170,1392`；`radar/dsh-radar-todo-fence:9,61,70`；`source/{zdbk,cc98,xxt,webvpn,login}` 若干；根 `ATTRIBUTION.md:28,117`。

### 无消费方的死面（若要保留先确认仓外）

`fingerprint`、`ptaClient`、`routePath` 三个服务成员**本仓 0 调用方**。

---

## 六、不可丢的实测决策

### 6.1 `loadTodosUncached` 三模式（`index.js:453-531`）

`todoMode = process.env.ZHIYUN_TODOS ?? 'fast'`（`:485`）：

| 模式 | 端点 | 学在侧请求数 |
| --- | --- | --- |
| `fast`（默认） | `GET /api/todos?no-intercept=true`（`xzzd.js:51`） | **1** |
| `slow` | `my-semesters` → `my-courses` → 逐课 5 端点 | 2 + 3N～5N |
| `diff` | 两条都跑，返回 fast rows + `diffTodos` | 1 + (2+3N～5N) |

PTA 侧恒定 **1** 个请求（`pta.js:27-30` 明确无 N+1）。**生产默认总请求 = 2。**

### 6.2 「11 门课 42 请求 / p50 2112ms / 48 秒」怎么处理

原文在 `index.js:472-484`。**判断：原样保留，一个字不改。**

理由：
1. 它是默认值 `fast` 的**唯一论证**（`:485` 紧跟其后）。改成概括就丢掉了「瓶颈是单请求延迟 2s/req，不是并发不够」——这个结论否掉了「提高并发」这条错误方向（`xzzd.js:13-16` 再次独立给出）。
2. 它同时否掉「`/api/todos` 会漏」这条流传断言，并指明验证手段（`diff` 模式）。删掉等于让 `slow`/`diff` 变成「没人知道为什么存在」的遗留代码。
3. **但必须补一句**：本仓数字**自相矛盾**——`index.js:474` 说「42 请求、48 秒」，`xzzd.js:9` 说「55 → 38 请求」，`xzzd.js:40,360` 说「55 请求、60.8 秒」。42 与 38 都对不上。
   → **原文保留 + 加一行标注**，不替它改数、不删掉。

### 6.3 其余不可丢的注释（摘要）

| 位置 | 决策 |
| --- | --- |
| `index.js:181-207` | 出口归本包；全局代理 7s ECONNRESET vs 直连 0.1s；三条错路 |
| `index.js:244-255` | `Transport` 必须显式传 `hosts=CAMPUS_HOSTS`，否则「登录成功而会话永远空」 |
| `index.js:276-280` | 凭据**每次现读不缓存** |
| `index.js:305-313` | **不缓存失败**（omni 15 分钟封锁的反面教材） |
| `index.js:327-378` | `loginProfile` 挂 **session** 且在 `finally` 写（踩过两次） |
| `index.js:388-409` | CAS 失败**不一律说密码错** |
| `index.js:533-547` | 待办缓存 **10 分钟**（README 与 `reads.js:4` 都写 60 秒，**文档不一致，以代码为准**） |
| `index.js:552-556` | 缓存键含 PTA cookie → 换 cookie 立即失效 |
| `xzzd.js:37-49` | `/api/todos` **必须带 `?no-intercept=true`** |
| `xzzd.js:57-59` | `/api/course/`（**单数**），改复数 → 404 |
| `xzzd.js:70-79` | `COURSE_CONCURRENCY = 1`（课程间串行） |
| `xzzd.js:275-295` | 5 端点并行（**OWNER 决策 2026-10-21**），30 门课 78s→17s |
| `pta.js:16-31` | 三处必照抄：404=Cookie 失效、`filter` 只编码一次（双编码 400）、服务端排序不保证 |
| `cas/login.js:8-32` | 四条坑：不带 `service`、手动跟跳转、每跳 cookie 写所有域、同号两次登录互废 ticket |
| `hosts.js:20-29` | 主机白名单决定 cookie 收发；漏一个 = 会话永远空且不报错 |
| `client.jsx:341-344` | `ptaStatus()` 只回 `{configured,names}`，**没有 `ok`** |

---

## 七、测试与校验（与我清单的差异）

**包内无 `tests/` 目录**，`package.json` **无 `scripts` 字段**。测试全在仓库根 `tests/`（295 个 `.test.mjs`），campus 相关 **13 个文件**。

**README 的验证命令不全**：`README.md:167` 只写两个测试文件，漏了 reads / planning-contract / pta-problems / xzzd-reads / 三个守卫。

**关键守卫**：
- `tests/source-capability.test.mjs:88-196` —— 每个 source 包必须声明 `dsh.capability`；**tier1 不得 requires 另一个 tier1**；裸 import 必须被 `requires` 覆盖
- `tests/source-error-contract.test.mjs:47-135` —— 错误翻译只在数据源；`mustRegister` 名单；设置分区 id 唯一
- `tests/build-seeds.test.mjs:88-117` —— 有 `src/client.jsx` 的包必须在 `CLIENT_PACKAGES`
- `scripts/source-check.py:1040-1042` —— **对 `webServer` 路由整体 SKIP**，没有自动化会发现路由断

**拆包后 link 期望值**：`52 → 54`。

---

## 八、七步拆包方案（每步可运行、可回退）

| Step | 动作 | 验证 |
| --- | --- | --- |
| 0 | 冻结基线：记录 link/test/profile 输出 | 基线全绿 |
| 1 | 建 `source/pta`（`pta.js` 原样搬 + PTA 两行 hosts + 复制 `reads.js` + 新写窄 index） | `tests/pta-problems.test.mjs`；「PTA 只发 1 个请求」断言 |
| 2 | 建 `source/xuezai`（其余全部；`egress.js` 去掉 `pintia.cn`；**不搬 `cas/http.js`**） | `tests/campus.test.mjs`、`xzzd-reads`、`campus-planning-contract`（`ZHIYUN_TODOS=slow` 必须仍绿） |
| 3 | **兼容层**：旧 `/api/zhiyun-campus` 保留转发壳 | `python scripts/source-check.py` 离线链全绿 |
| 4 | 改消费方（planning 三段 + login + radar，一次改完避免中间态） | `tests/planning*.test.mjs`；起工作台看规划页有数据 |
| 5 | 探针与测试迁移（13 个测试 + 3 个 bridge 脚本 + live-probe） | `grep -rn "source/campus" tests scripts` 只剩历史说明 |
| 6 | 装配收口（单独一次提交）：删包 → `retiredBundles` 加旧名 → profile package.json 换两条 → `CLIENT_PACKAGES` → ATTRIBUTION → 两个 patch | link 54/54 → build → `profile:init` → `profile:check` → 起得来 |
| 7 | 事后清理：移除兼容壳；**data 目录仍共用或写一次性迁移** | `npm test` + `source-check.py` |

**Step 6 是最容易炸的一步**（`retiredBundles` 漏了 → 整个工作台起不来）。

---

## 九、对清单的修正

| 原清单 | 修正 |
| --- | --- |
| S-03 说「收 `xzzd.js` + `xzzd-reads.js` + `cas/` + 学在侧 `todos()`」 | **低估工作量**：真正要切的是 `index.js` 923 行，逐段分两半 |
| S-04 说「收 `pta.js` + `ptaRead()`」 | 补充：`pta.js` 零外溢可先切，但 `ptaStatus`/`savePtaCookie`/`ptaRead`/`normalizePta`/`translatePtaError` 都在 `index.js` 里 |
| 只列了 3 个消费方 | **实际 13 个测试 + 5 个脚本 + 3 处 planning + login + radar** |
| 未提数据目录 | **新增 R-1：`pta.session` 不可自愈，绝不可改 `dataDir`** |
| 未提 `{xzzd,pta}` 契约 | **新增 R-2：形状被 planning + 页面钉死** |
| 未提 `retiredBundles` | **新增 R-3：漏登记 = 工作台起不来** |
| 未提兼容路由 | **新增 Step 3：`/api/zhiyun-campus` 三处硬编码 + 无自动化守护** |
| 未提死代码 | 发现：`cas/http.js` 死文件、`planning:1954-1962` 死分支、`fingerprint`/`ptaClient`/`routePath` 无消费方 |
| 未提文档不一致 | 发现 4 处：README 的 zhiyunEgress、README 验证命令、缓存 60s vs 10min、42 vs 38 请求 |
