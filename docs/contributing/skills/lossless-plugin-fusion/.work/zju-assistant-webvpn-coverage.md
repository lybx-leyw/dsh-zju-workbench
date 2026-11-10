# WebVPN 上游覆盖度对账（2026-11-10）

**方法**：把上游 `packages/vendor/zju-assistant/core/zju/lib/webvpn/` 的**全部导出**
逐条列出，每条给出「本仓对应物」或「明确丢弃 + 理由」。没有第三态。

**上游文件总览**：`client.ts`（9156 B）、`transport.ts`（9046 B）、`probe.ts`（6831 B）、
`doctor.ts`（3259 B）、`cli.ts`（3993 B）、`module.json`（493 B）。

---

## 一、`client.ts` 的 11 个导出 + 1 个类的 8 个成员

| # | 上游导出 | 本仓对应 | 状态 |
| --- | --- | --- | --- |
| 1 | `WEBVPN_BASE` | `protocol.js` 的 `WEBVPN_ORIGIN` | ✅ 等价 |
| 2 | `WEBVPN_HOST` | `protocol.js` 的 `WEBVPN_HOST` | ✅ 等价 |
| 3 | `TICKET_COOKIE` | `login.js` 的 `WEBVPN_TICKET_COOKIE` | ✅ 等价 |
| 4 | `requirements: ModuleRequirements` | `hosts.js` 的 `classifyHost('webvpn.zju.edu.cn') === 'public'` | ✅ **结构转换**：上游用模块声明，本仓用主机表 |
| 5 | `encryptPassword(password, key, iv)` | `protocol.js` 的 `webvpnPassword(password, {key, iv})` | ✅ **已融合（W5）**，且多一层「挖不到就回退」 |
| 6 | `encodeHost(host)` | `protocol.js` 的 `wrdEncrypt(URL_KEY, host)` | ✅ 等价 |
| 7 | `decodeHost(encoded)` | `protocol.js` 的 `wrdDecrypt(URL_KEY, encoded)` | ✅ 等价 |
| 8 | `rewriteUrl(url)` | `protocol.js` 的 `toWebvpnUrl(url)` | ⚠️ **有意差异**：本仓**不加** `?vpn-12-o2-<host>` 后缀（见下「偏离 D-1」） |
| 9 | `unwrapUrl(vpnUrl)` | `protocol.js` 的 `fromWebvpnUrl(url)` | ⚠️ **有意差异**：不剥离 `vpn-12-o2`（因为不添加；见 D-1） |
| 10 | `parseLoginPage(html)` | `protocol.js` 的 `parseWebvpnLoginPage(html)` | ✅ **已融合（W5）**，返回 `{csrf, captchaId, key, iv}` |
| 11 | `Webvpn` 类 | 本仓**没有类**，改为函数集合 | ✅ **结构转换**（见下） |

### `Webvpn` 类的 8 个成员

| 成员 | 本仓对应 | 状态 |
| --- | --- | --- |
| `constructor({username,password,http,ttlMs})` | 无类；`webvpnLogin(transport, {username,password})` | ✅ 结构转换 |
| `private save()` | 调用方负责（`campus/src/index.js:222` 的 `webvpnSession.save()`） | ✅ 责任下放 |
| `get hasTicket` | `login.js` 的 `hasWebvpnSession(session)` | ✅ 等价（判据更宽，见 D-2） |
| `async probe()` | `login.js` 的 `probeWebvpnSession(transport)` | ✅ **已融合（W7）** |
| `login(force)` | `login.js` 的 `webvpnLogin(transport, creds)` | ✅ 等价（无 `force`，无登录去重，见 D-3） |
| `importTicket(ticket, route)` | `login.js` 的 `importWebvpnTicket(transport, {ticket, route})` | ✅ **已融合（W7）**，且导入后立即 `probe` |
| `fetch(realUrl, opts)` | **本仓无**：改写与实际发送由 `egress.js` 的 `fetch` 负责 | ✅ 结构转换（职责在 egress） |
| `logout()` | 调用方 `session.clear()`（`http/src/session.js:120-126`） | ✅ 责任下放 |

---

## 二、`transport.ts` 的 3 个导出

| # | 上游导出 | 处置 | 理由 |
| --- | --- | --- | --- |
| 12 | `NO_PERMIT_PATH` | ✅ **已融合** | `egress.js` 的同名常量 + `isNoPermitResponse()` |
| 13 | `rewriteFor(hosts, open)` | ❌ **明确丢弃** | 上游的「按模块 hosts 列表 + 运行时 open 集合」改写器。本仓的对应物是 `egress.js` 的 `downgraded` 集合 + `hosts.js` 的归属表 —— **同一职责，更简单**。`rewriteFor` 的价值在于「逐主机直连失败后移出直连集合」，那部分已由 W3 融合 |
| 14 | `openContext(req, opts)` | ❌ **明确丢弃** | 上游的 Context 工厂：把「选路 + CAS 组件 + WebVPN 组件 + cookie jar」装配成一个对象。本仓的装配点在**调用方**（`campus/src/index.js:255` 的 `transportFor`、`http/src/host.js:61` 的共享出口）。引入 `openContext` 会与这两处重复且冲突 |

### 为什么 `openContext` 不能融合（不只是「不想做」）

上游 `openContext` 的核心是「模块声明 → 自动装配」。它的三条语义：

1. `network === 'public'` → 永远直连；
2. `auth === 'cas'` → 注入 zjuam 组件；
3. `campus` + `publicHosts` → 逐主机直连/降级。

本仓的 1、3 已由 W2/W3 覆盖，但 **2（CAS 注入）不在本包职责内** —— 本仓的 CAS 在
`source/http`（`AUTH_HOSTS`、`Transport`）与 `source/login`（账号读取）。
把 `openContext` 搬进来会让 tier 0 的 webvpn 包反向依赖那些包，**违反分层**。

---

## 三、`probe.ts` 的 1 个导出

| # | 上游导出 | 本仓对应 | 状态 |
| --- | --- | --- | --- |
| 15 | `probeHost(host, {via})` | `scripts/probe-hosts.mjs` | ✅ **已融合（W4）**，判法一致（跟跳转、看最终落点、分 public/campus/cas） |

**差异**：上游支持 `--via <ssh目标>` 从外部主机实测；本仓脚本只在本机跑，但**增加了
「在校园网内拒绝运行」的自查** —— 那正是 `--via` 想解决的问题（本机判断不可信）。
两种解法取向不同：上游换机器，本仓检测环境。

---

## 四、`doctor.ts` 的 1 个导出

| # | 上游导出 | 本仓对应 | 状态 |
| --- | --- | --- | --- |
| 16 | `doctor(timeout)` | `src/doctor.js` 的 `doctor(options)` | ✅ **已融合（W8）** |

**差异**：上游自己 `readProfile()` 读凭据；本仓凭据**由调用方传入**（tier 0 约束）。
三项探测（公网/校园网/网关）与 `advice[]` 结构一致，探测地址也一致
（`CAMPUS_PROBE_HOST = 'api.cc98.org'` 与上游 `doctor.ts:10` 同源）。

---

## 五、`cli.ts` 的 1 个导出（8 条命令）

| # | 上游命令 | 本仓对应 | 状态 |
| --- | --- | --- | --- |
| 17 | `webvpn check` | `doctor()` | ✅ 导出函数 |
| 18 | `webvpn check --host` | ❌ **未做** | 逐主机可达性检查。`scripts/probe-hosts.mjs --hosts` 可替代（但它是脚本，不是服务面） |
| 19 | `webvpn probe --host --via` | `scripts/probe-hosts.mjs` | ✅ 脚本 |
| 20 | `webvpn url encode` | `toWebvpnUrl` / `wrdEncrypt` | ✅ 导出函数 |
| 21 | `webvpn url decode` | `fromWebvpnUrl` / `wrdDecrypt` | ✅ 导出函数 |
| 22 | `webvpn login` | `webvpnLogin` | ✅ 导出函数 |
| 23 | `webvpn status` | `hasWebvpnSession` + `probeWebvpnSession` | ✅ 导出函数（无「本地会话文件状态」那一层，那属 `SessionStore`） |
| 24 | `webvpn logout` | 调用方 `session.clear()` | ✅ 责任下放 |
| 25 | `webvpn import-cookie` | `importWebvpnTicket` | ✅ **已融合（W7）** |

**整体处置**：`cli.ts` 作为**命令行入口**整体丢弃（本仓无 `zju` CLI）；
它的 9 条能力逐条映射到导出函数或脚本，**能力不丢，形态不同**。

---

## 六、四处有意偏离（都记了理由）

| 编号 | 偏离 | 理由 |
| --- | --- | --- |
| **D-1** | 不加 `?vpn-12-o2-<host>` | 该参数让网关「原样返回内容、别改写页面里的链接」，只对**给人看的页面**有意义（vendor 的 `campus-page.mjs:45` 有明文注释）。对 JSON API 影响为零，且它追加在原始 query 之后会让已签名 URL 失效。不加，所以也不需要剥离 |
| **D-2** | `hasWebvpnSession` 判「域上任意 cookie」而非钉死 `TICKET_COOKIE` | 网关用过好几种会话 cookie 名，钉死一个会在它换名时静默失效。`importWebvpnTicket` 反过来**必须**用具体名字（塞错名字等于没塞）—— 两处口径不同是故意的 |
| **D-3** | `webvpnLogin` 无登录去重（上游有 `loginPromise`） | 上游在类里持有 `loginPromise` 防并发重登。本仓无类，并发重登的风险由调用方的 `webvpnSession` 与 `exclusive()` 承担（`campus/src/index.js`）。**这是已知差异，不是遗漏** |
| **D-4** | 挖不到 key/iv 时回退内置常量（上游直接抛错） | 页面结构变化不该等价于「完全不能登录」。先试一次旧值，比直接失败好 |

---

## 七、结论

| 分类 | 数量 |
| --- | --- |
| ✅ 已融合（含结构转换） | 21 |
| ⚠️ 有意偏离（有理由） | 4 |
| ❌ 明确丢弃（有理由） | 2（`rewriteFor`、`openContext`） |
| ❌ 未做（能力缺口） | 1（`webvpn check --host` 的服务面版本） |

**上游 webvpn 链路的可执行能力已全部处置**：要么融合，要么写明丢弃理由，
没有「没看见所以没做」的项。

**唯一真正的能力缺口**是 `webvpn check --host`（逐主机可达性检查）没有服务面版本
—— 它只在 `scripts/probe-hosts.mjs` 里有，而那是给维护者用的脚本，不是给
设置页/agent 用的接口。**若将来设置页要做「测一下这个站能不能通」，需要补。**

---

## 八、与清单的一致性

清单第 2 项的状态可以从「W1–W4 部分完成」更新为：

| 阶段 | 状态 |
| --- | --- |
| W1–W8 | ✅ 全部实现 |
| 上游覆盖度 | ✅ 21 融合 / 4 有意偏离 / 2 明确丢弃 / 1 能力缺口（`check --host` 服务面版，未做） |
| 测试 | ✅ 240 条相关用例通过（含 5 条反证），全仓无新增失败 |

---

## 九、风险备注（提交时已知未验证项）

> **这一节是给「将来打勾的人」看的。** 打勾代表不回头，所以下面每条都写成
> 「什么条件下会出问题」，而不是「已知问题」。

### R-1 · 真实校外网络从未验证（**最高**）

| 项 | 内容 |
| --- | --- |
| 状态 | 本机在校园网内（`is_campus_network` 返回 `1`），`probe-hosts.mjs` 按设计拒绝运行 |
| 已验证 | 校外路径的**协议层**用假 transport 全覆盖（302/200/cookie 丢弃/降级/升级） |
| **未验证** | 真实网关是否接受这套改写与登录；真实校外网络下 `zdbk`/`courses` 等是否真能直连 |
| 会怎么坏 | 若 `hosts.json` 的实测结论过时，校外用户会遇到「本该直连的被绕道」（慢）或「本该绕道的直连失败」（错） |
| 解除条件 | 在**校园网外**真机跑一次 `npm run probe:hosts --prefix packages/source/webvpn`，比对差异 |

### R-2 · `HOSTS_GENERATED_AT` 是 2026-10-09 的快照

表里的 68 个主机是上游在外部主机上一轮实测的结果，**到本仓接手时已过期约一个月**。学院站换域名、加 CDN、改目录结构都会让表失真。

**缓解**：未知主机回退后缀规则（D5），所以表失真不会导致「完全不可用」，只会导致「该直连的被绕道」。

### R-3 · `setWebvpnSession` 有时序要求

出口实例是**惰性创建**的，创建后**不会换回调**。注册必须早于第一次需要走网关的请求；晚于那次的请求仍会抛 `WEBVPN_REQUIRED`，下一次才生效。

**当前无人调用 `setWebvpnSession`** —— 所以 `source/http` 的共享出口在校外场景下仍会抛 `WEBVPN_REQUIRED`（cc98/zdbk/xxt 校外用不了）。这是**修好了「静默失败」但没有修「能工作」**。

### R-4 · 三处未修的已知缺陷

| 缺陷 | 影响 | 为什么没修 |
| --- | --- | --- |
| `probeCampus()` 失败不缓存、无并发去重 | 探测端点长期不可用时，每个请求等满 6 秒；首批并发请求惊群 | 改动面在热点路径，需要单独压测 |
| `fromWebvpnUrl` 不剥离 `vpn-12-o2-` | 本仓 `toWebvpnUrl` **不加**这个参数，所以当前无残留。若将来为「给人看的页面」加上，必须同时补剥离 | 暂无触发条件 |
| IPv6 主机名被主机名校验拒绝 | `[::1]` 这类字面量往返会抛 `WEBVPN_URL` | 浙大无 IPv6-only 站点 |

### R-5 · `webvpn check --host` 缺服务面版本

逐主机可达性检查只在 `scripts/probe-hosts.mjs` 里（维护者脚本），**没有给设置页/agent 用的接口**。若设置页要做「测一下这个站能不能通」，需要补。

### R-6 · 全仓 26 个既有测试失败与本批无关

`npm test` 有 26 个失败，**全部是既有失败**（严格比对：基线 27 → 26，新增 0，消失 1 是偶发）。根因举例：`tests/zdbk.test.mjs:1157` 的正则没考虑 patch 文件里包名带引号。**不要**把这些算进本批改动的账上，也不要顺手「修」到本批里。

---

## 十、可以打勾的条件（三者齐备）

- [x] W1–W8 全部实现
- [x] 上游覆盖度无「没看见所以没做」的项
- [x] 测试覆盖（含反证）
- [ ] **R-1 解除**：校园网外真机验证一次 `probe:hosts`
- [ ] **R-3 解除**：有人调用 `setWebvpnSession`（即校外真正可用，而非只是报错清楚）

**当前状态：前三条已满足，后两条未满足 → 可作为「实现完成」提交，但不能标为「验收通过」。**
