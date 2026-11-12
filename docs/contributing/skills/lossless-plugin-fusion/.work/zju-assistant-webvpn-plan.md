# WebVPN 出口策略集成计划（清单第 2 项 · 独立计划）

**裁决来源**：用户 2026-11-09 —— 「webvpn 需要部署集成进我们项目的计划，需要加入清单；
这里因为上游实现明显比我们更优，我觉得采用他们的规则」。

**结论**：不是「给 egress.js 加几条规则」，而是**替换选路模型**：
`域名后缀匹配` → `模块声明 + 主机表 + 运行时会话内降级`。

---

## 一、为什么上游更优（可核对的差异，不写「更好」）

| 维度 | 本仓 `packages/source/webvpn/src/egress.js` | 上游 `core/zju/lib/webvpn/` + 各模块 `module.json` |
| --- | --- | --- |
| 判定输入 | 1 个常量：`CAMPUS_SUFFIX = 'zju.edu.cn'`（`egress.js:52`） | 每模块 1 份 `module.json` 的 `network` + `hosts` + 可选 `publicHosts`；通知模块另有 68 主机实测表 |
| 粒度 | 全域名统一 | 逐模块、逐主机 |
| 误判方向 | `zdbk` / `courses` / `classroom` / `tyys` / `yjsy` 实测公网可达却被强制绕网关 | 无此类误判 |
| 漏判方向 | `cc98.org`（非 zju 域，只在校内）、`10.203.16.55`（私网 IP）→ 判定不覆盖，直连必失败 | `cc98` 声明 `network: campus` 覆盖到；`lab` 声明 campus 但也未验证能否通（见风险 R1） |
| 失败处理 | 直连失败后**单次**升级重试（`egress.js:282-303`），成功后 `usingWebvpn = true` 但**下一次仍重新判定**，`routeFor` 只在 `usingWebvpn && inside !== true` 时才走网关（`:233`） | 直连失败或落到 `/nopermit_zjusub.jsp` → **本次运行内该主机永久移出直连集合**（`transport.ts:139` `open.delete(host)`） |
| 探测依赖 | 每次运行要打 `mirrors.zju.edu.cn/api/is_campus_network`（`egress.js:55`），探不到就按直连试 | 不探测；由模块声明直接决定 |
| 用户设置语义 | `mode: auto/direct/webvpn` 三态，`webvpn` 模式下仍按后缀判断哪些走网关 | `transport: webvpn/direct` 两态，但 **`network: public` 的模块永远直连，用户选 webvpn 也不改**（`transport.ts:74`） |
| 配置落点 | 无配置文件，靠 `directSuffixes` 由各业务包传入 | `module.json` 是模块自带的事实声明，随代码走 |

**最关键的一条差异**（决定「更优」成立）：本仓把「哪些站点只在校内」当成**一条可推断的域名规律**，
上游把它当成**每个站点的事实**，并要求实测填表。前者写起来省事，但规律本身是错的 ——
`zju.edu.cn` 下有 47 个实测公网可达的站点，`cc98.org` 不在这个后缀下却只在校内可达。

---

## 二、迁移计划（分四阶段）

### 阶段 W1 · 引入主机表事实层（不动现有行为）

| 项 | 内容 |
| --- | --- |
| 动作 | 在 `packages/source/webvpn` 内新增 `src/hosts.js`，导出 `HOSTS` 表：`host → { network: 'public'\|'campus', cas: boolean }` |
| 数据来源 | 上游 `core/zju/lib/notice/hosts.json`（68 主机，`via: server`，2026-10-09 实测）+ 各 `module.json` 的 `hosts` 字段 |
| 导出面 | `classifyHost(hostname) → 'public' \| 'campus' \| 'unknown'`、`HOSTS`、`HOSTS_GENERATED_AT` |
| 依赖 | 零。纯数据 + 纯函数 |
| 验证 | 新增单测：对 7 个已知主机断言分类（`zdbk`→public、`sztz`→campus、`cc98.org`→campus、`10.203.16.55`→campus、`pintia.cn`→public、`mirrors.zju.edu.cn`→campus、未知域名→unknown） |
| 回滚 | 本阶段不改变任何既有调用路径，可单独合并/单独撤 |
| 风险 | 上游表是 2026-10-09 的，**融合时已过去一个月**，需在第 W4 复测 |

### 阶段 W2 · 选路函数换成三级判定

| 项 | 内容 |
| --- | --- |
| 动作 | `egress.js` 的 `needsCampusNetwork()` 改为：<br>`unknown` → 回退到现有 `isCampusHost()` 后缀规则（保持向后兼容）<br>`public` → false<br>`campus` → true |
| 保留 | `isCampusHost` / `isPublicHost` **不删**，作为 `unknown` 的回退路径 —— 新站点在表里查不到时仍有可用行为 |
| 同时改 | `PUBLIC_AUTH_HOSTS` 从「只有 zjuam + identity」扩为「所有实测 public 主机」，因为 public 主机不需要网关 |
| 影响面 | `packages/source/` 下 10 个数据源包全部经过此函数（`source/campus/src/egress.js:79` 二次封装、`source/http/src/host.js:61` 直接 `createEgress`） |
| 验证 | 现有 10 个包的测试全绿 + 新增「教务网不再绕网关」「cc98 现在绕网关」两条行为断言 |
| 回滚 | 单点改 `needsCampusNetwork` 一处，回滚代价低 |
| **须裁决** | 见「三、需用户裁决」Q1 |

### 阶段 W3 · 运行时会话内降级

| 项 | 内容 |
| --- | --- |
| 动作 | 移植上游 `transport.ts:127-140` 的语义：某主机本次运行直连失败或命中 `/nopermit_zjusub.jsp`，则**移出直连集合**，后续请求改走网关 |
| 与现状差异 | 本仓现在每次请求重新 `routeFor`，同一主机可能反复「直连失败→升级→再直连失败」 |
| 现有约束 | 本仓 `egress.js:287-291` 有「只重试 GET/HEAD，绝不重放凭据提交」的保护 —— **这条必须保留**，上游靠的是同一 `Context` 生命周期的 `open[]` 集合，语义等价 |
| 验证 | 新增测试：注入失败 fetch，断言第一次 GET 失败后第二次同主机请求**直接**走网关（不再尝试直连） |
| 回滚 | 降级集合是纯内存状态，回滚即恢复旧逻辑 |
| **须裁决** | 见 Q2 |

### 阶段 W4 · 复测与维护机制

| 项 | 内容 |
| --- | --- |
| 动作 | 移植上游 `core/zju/scripts/notice/hosts.ts` 的探测脚本为 `packages/source/webvpn/scripts/probe-hosts.mjs`，输出 `src/hosts.js` 的数据部分 |
| 前置条件 | 需要**一台校外干净的国内云主机**（上游用法是 `--via <ssh目标>`）。没有这台机器，这张表只能手工维护 |
| 记录 | 参照本仓 README 对第三方素材的做法：`SOURCES.md` 记 `generatedAt` / `via` / 每主机的 `status`，便于日后复核 |
| **须裁决** | 见 Q3 |

---

## 三、需用户裁决

### Q1 · `public` 站点在校园网内也直连吗

上游口径：`network: public` **永远直连**，校内校外都是（`transport.ts:74`）。
这条对校内用户是**正确的**（少一跳），但也意味着**校内**访问 `zdbk` 时不带网关会话。
上游的 `hosts.json` 显示 `zdbk` 是 `public + cas`，即校内直连也行，靠 CAS 拿票。
- 选项 A：完全照上游（public 永远直连）—— 推荐，语义最简单
- 选项 B：校内直连、校外也直连（`public` 无非就是校内外都能直连，A 与 B 其实是同一条）

> 这题实际不成立 —— A 就是唯一解。**我把它删掉，改为下面的 Q1'。**

### Q1' · `unknown` 主机的回退行为

表里查不到的新站点（例如将来新加的学院站），应该：
- 选项 A：**回退到后缀规则**（`*.zju.edu.cn` → 绕网关，其余直连）—— 推荐，保守且与现状一致
- 选项 B：回退到「先直连，失败再升级」—— 上游在 `publicHosts` 里对未知主机就是这个行为
- 选项 C：直接报错，要求先补表 —— 最严格，但会让新站点完全不可用

### Q2 · 降级是「会话内持久」还是「本次请求」

- 选项 A：**会话内持久**（上游语义）—— 某主机一旦直连不通，本次运行不再试
- 选项 B：本仓现状（每次重新判）—— 好处是网络恢复后能自动回到直连
- 推荐 A：网络在同一会话内突变的情况少，反复重试的代价更高（每次失败都要等超时）

### Q3 · 主机表的维护方式

- 选项 A：**移植探测脚本，保留复测能力**（需要一台校外主机）—— 推荐，否则这张表就是一次性的
- 选项 B：只把上游 2026-10-09 的表抄进来，不维护 —— 省事，但站点变更后无人知道
- 选项 C：抄表 + 在 README 写明「需要复测时去上游取新表」—— 折中，把维护责任指回上游

---

## 四、风险

**R1 · ~~`lab`（`10.203.16.55`）经 WebVPN 是否可行，上游与我方都没有证据。~~ → 已实测解除**

原文写的「WebVPN 改写基于主机名，私网 IP 作为主机名能否被网关转发，未测试」这条猜测**已被实测推翻**。

2026-11-10 在**校园网内**直连实测（不经网关）：

| 端点 | 结果 | 说明 |
| --- | --- | --- |
| `http://10.203.16.55:86/lab-course/selectCourse` | **200**，1120 字节 | SPA 静态页可达 |
| `http://10.203.16.55:8098/lab-course/api/`（GET） | **404** | 服务端已响应，只是根路径没有路由 |
| 登录（参数不全，JSON body） | `{"code":400,...,"message":"Bad Request"}` | 服务端正常处理并给出结构化错误 |
| 登录（上游完整签名 + **form-urlencoded**） | `{"code":200,"message":"OK","data":"用户名或密码错误"}` | **协议完全正确**：签名被接受、字段被识别、返回明确业务错误 |

**结论**：实验选课平台在校内**完全可用**，上游的协议实现（`app_key`/`secret` 签名、form-urlencoded 请求体、`{code, message, data}` 信封）**逐项验证正确**。

顺带纠正两处容易写错的地方：
1. 请求体必须是 **`application/x-www-form-urlencoded`**，不是 JSON —— 用 JSON 会稳定拿到 400；
2. 签名参数必须**与业务参数混在同一份 form 里**（GET 进 query，POST 进 body），不能只放 header。

**仍未验证的**：局域网外经 WebVPN 改写 `http-8098` 是否也能通。但既然校内直连成立，
「校外不可达」只影响不在校园网的用户，不构成「平台不可用」。

**R2 · `hosts.json` 的时效性。**
`generatedAt: 2026-10-09`，`via: server`。到融合实施时至少滞后一个月以上。
学院站点换域名、加 CDN、改目录结构都会让表失真。**这份表是快照，不是真理。**

**R3 · 改动落在 tier 0 共享包，爆炸半径大。**
`packages/source/http/src/host.js:61` 与 `packages/source/campus/src/egress.js:79` 都直接消费
`needsCampusNetwork` / `createEgress`。这 10 个数据源包（campus / cc98 / classroom / http /
login / netproxy / webvpn / xxt / zdbk）全部受影响。必须整包回归，不能只测 webvpn 自己。

**R4 · 上游 `hosts.json` 含 `itc.zju.edu.cn` 标为 `cas: true`**，是全表唯一一个 public+cas 的
非教务站点。若我方判断口径不同，这一条会成为分歧点。

---

## 五、清单登记

本计划替换原清单第 2 项「webvpn 扩展：后缀规则 → 主机表」，改为独立条目：

| # | 泳道 | 保留节点 | 类型 | 本项目现状 | 待办 |
| --- | --- | --- | --- | --- | --- |
| 2 | L1 | WebVPN 出口策略：模块声明 + 主机表 + 会话内降级 | proc | `packages/source/webvpn` | **独立集成计划 W1–W8** |

---

## 六、实施状态（2026-11-10）

**W1–W10 全部已实现并有测试**，85 条 webvpn 用例通过（含反证）。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| W1 | `src/hosts.js` 主机归属表（campus / public / cas 三份名单） | ✅ |
| W2 | `needsCampusNetwork` 三级判定 + 新增 `hostNetwork` | ✅ |
| W3 | 会话内降级（逐主机）+ `nopermit_zjusub.jsp` 识别 | ✅ |
| W4 | `scripts/probe-hosts.mjs` 探测脚本（校园网内拒绝运行） | ✅ |
| W5 | 登录页动态 key/iv（回退内置常量） | ✅ |
| W6 | `do-confirm-login` 二次确认（带 `onConfirm` 回调留痕） | ✅ |
| W7 | `probeWebvpnSession` + `importWebvpnTicket` 逃生口 | ✅ |
| W8 | `src/doctor.js` 网络诊断（凭据由调用方传入，tier 0 约束） | ✅ |
| **W9** | `src/probe.js` 单主机探测 —— 把 W4 的脚本逻辑提升为**服务面**（DoH 解析 / 私网判定 / TUN 检测 / 跟跳转 / `casRedirect` / `via` 外部实测） | ✅ **2026-11-12** |
| **W10** | `src/reach.js` 逐主机可达性 —— 补齐 `webvpn check --host`（TTL 缓存，落盘可选） | ✅ **2026-11-12** |

> **W9/W10 的由来**：上游 `probe.ts` 与 `reach.ts` 是**库**，本仓原先只有 CLI 脚本，
> 于是「探测」这项能力对设置页与 agent 不可达 —— 覆盖率差 6.25%。
> 补的方式是**把判定留在库里、脚本降级为包装**，而不是给脚本加参数。

### 实施中查出并修复的四个缺陷

| # | 缺陷 | 影响 | 证据 |
| --- | --- | --- | --- |
| **A** | `CAMPUS_HOSTS` **不含 `webvpn.zju.edu.cn`**，而网关登录用的正是这个 Transport；`Transport` 只对白名单主机存 `Set-Cookie` | **网关登录在生产路径上根本不可能成功**：do-login 回 200 + ticket，cookie 被静默丢弃 → `WEBVPN_NO_SESSION` | `campus/src/hosts.js:30-37`、`http/src/transport.js:102`。实测：不含 → ticket 数 0 且抛错；含 → 登录成功 |
| **B** | `usingWebvpn` 被当作路由**输入**（全局闩锁） | 一个主机降级后，**所有**需要校园网的主机都跟着改道，包括本来能直连的 | `egress.js` 原 `:233` 读、`:246` 写。实测：sztz 失败一次 → 无关站点被迫走网关 |
| **C** | 未传 `onWebvpnRequired` 时**静默改写** | `source/http` 建共享出口时没传它 → 校外 + 直连失败 → 拿到**网关登录页**（HTTP 200），各数据源把登录页当业务数据解析 | `egress.js` 原守卫 `typeof … === 'function' &&`。实测：按 http 的构造方式 → 现在抛 `WEBVPN_REQUIRED` |
| **D** | `PUBLIC_AUTH_HOSTS` 检查在 `mode==='webvpn'` 分支之后 | `mode: 'webvpn'` 会把 `zjuam` 也改写，变成「网关的网关」 | `egress.js` 分支顺序。已上移到 auto 判断之前 |

**四个缺陷都是「不报错、只在特定网络条件下发作」的那一类**，靠人肉 review 抓不住，
所以每个都补了**反证测试**（故意用错误配置跑一遍，断言它确实失败）。

### 测试清单

| 文件 | 条数 | 守什么 |
| --- | --- | --- |
| `tests/webvpn-hosts.test.mjs` | 11 | 主机表判定、点边界、冻结、零依赖 |
| `tests/webvpn-downgrade.test.mjs` | 12 | 降级语义、逐主机、无回调必抛错、POST 不重放 |
| `tests/webvpn-login.test.mjs` | 22 | W5–W8 全部 |
| `tests/webvpn-gateway-login.test.mjs` | 4 | **缺陷 A 的反证**（真实 Transport + 真实 CookieJar） |
| `tests/webvpn-egress.test.mjs` | 16 | 三级判定、模式路由、未知主机回退 |
| `tests/campus-egress.test.mjs` | 28 | 协议、登录页解析、探测与升级 |
| `tests/egress-shared.test.mjs` | 10 | 共享出口所有权、惰性解析 |

### 仍未做的（如实列出）

| 项 | 为什么没做 |
| --- | --- |
| `fromWebvpnUrl` 剥离 `vpn-12-o2-<host>` 参数 | 本仓 `toWebvpnUrl` **不加**这个参数，所以现在不存在残留。若将来为「给人类看的页面」加上，必须同时补剥离 |
| IPv6 主机名 | `protocol.js:127` 的主机名校验拒绝 `[::1]` 这类字面量。浙大站点没有 IPv6-only 的，优先级低 |
| 探测失败短缓存 + 并发去重 | `probeCampus()` 失败不缓存 ⇒ 探测长期不可用时每个请求等满 6 秒；无并发去重 ⇒ 首批并发请求惊群。**已知，未修** |
| property test（改写↔反改写往返） | 仓库无 fast-check。现有 2 组固定用例覆盖主路径 |

### 已明确丢弃的上游部分

| 上游 | 为什么不移植 |
| --- | --- |
| `transport.ts` 的 `openContext` / `rewriteFor` | 架构不同：上游把选路交给 module 声明 + `Context` 实例；本仓用 `egress.js` + `hosts.js`，**已覆盖同一职责**且更简单。`NO_PERMIT_PATH` 语义已移植 |
| `cli.ts` 的 8 条命令 | 本仓没有 `zju` CLI 入口。能力改为服务面暴露（`doctor` / `probeWebvpnSession` / `importWebvpnTicket` 都是导出函数） |
