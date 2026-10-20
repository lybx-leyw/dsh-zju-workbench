# dsh-zhiyun-campus

浙大校园数据源：**学在浙大待办** 与 **拼题A 题集**。本仓原生实现。

## 为什么有这个包

`dsh-zhiyun-omni` 是移植来的（上游 [Vita0818/ZJU-Omni](https://github.com/Vita0818/ZJU-Omni)，MIT），
而它**为 macOS 写**。移植层改掉了凭据后端的强制依赖，但留下几处结构性问题，
且都落在「规划」页每天要读的两条链路上：

| 问题 | 具体表现 | 本包怎么避开 |
| --- | --- | --- |
| **一次失败封锁 15 分钟** | `assertNoRecentFailure`：网络抖动也被记成"凭据被拒"，此后 15 分钟内直接抛错 —— 偶发失败被放大成"半天不可用" | 聚合读取合并并发并复用 60 秒结果；保留失败状态，防止页面操作反复提交登录 |
| **认证层自己探网络模式** | 取数前先探测（6s 超时兜底），探测与取数耦合在一起 | 出口策略独立成 `src/egress.js`，探测结果**缓存一次**、可手动重探，且失败不阻断（见下节） |
| **macOS 残留** | `pbpaste \| npm run cli -- pta-cookie` 印在用户可见的错误提示里；`DEFAULT_USER_AGENT` 声称是 Mac | 错误提示全是中文可操作指引，UA 用中性值 |
| **拼题A 的 N+1** | 每个题集再补一次 `/exams`（12 个题集 13 个请求），还被 200ms limiter 串起来 | **不提供**那个补齐接口。列表只发 1 个请求 |

## 出口：为什么本包自己管（而不是交给全局代理）

这是本包最容易踩错的一处，结论是**真机实测**出来的：

| 目标 | 直连 | 经全局代理（UniClash `127.0.0.1:7993`） |
| --- | --- | --- |
| `zjuam.zju.edu.cn/cas/login` | 200 · 0.10 s | **ECONNRESET · 7.4 s** |
| `courses.zju.edu.cn/user/index` | 302 · 0.11 s | **ECONNRESET · 7.6 s** |
| `pintia.cn/api/problem-sets` | 404 · 0.81 s | **ECONNRESET · 7.6 s** |

宿主的 `globalThis.fetch` 走全局 dispatcher，那份 dispatcher 来自启动时读的
`HTTPS_PROXY`。对 DeepSeek 这类海外目标是必要的，但浙大域名是**国内校园站点**，
绕道海外代理只会全灭。

试过三条路，前两条都不成立：

1. **指望 `dsh-zhiyun-net-proxy` 接管** —— 它默认 `enabled: false`（刻意如此：装个
   插件不该顺手改全局网络行为）。用户没打开时，校园域名照样走全局代理。
2. **给 `globalThis.fetch` 传 `dispatcher`** —— Node 内置 fetch 直接抛
   `UND_ERR_INVALID_ARG`，选项根本不生效。
3. **`undici.fetch` + 逐请求 `dispatcher`** ✅ —— 把全局 dispatcher 指向死端口后验证过：
   `globalThis.fetch` 报 ECONNREFUSED，而同一次 `undici.fetch(…, { dispatcher })` 返回 200。

所以本包**只改自己的请求**，不动宿主的全局策略 —— 别的包（LLM、`web_fetch`）怎么走还怎么走。

## 校外：走 WebVPN

学在浙大只在校园网内可达。人在校外时，本包可以经学校的 WebVPN 网关转发：

```text
https://courses.zju.edu.cn/api/…        ← 逻辑地址（其余代码只认这个）
https://webvpn.zju.edu.cn/https/<hex>/api/…   ← 物理地址（真正发出去的）
```

`<hex>` 是 `AES-128-CFB` 密文，key 与 IV 都是公开常量 `wrdvpnisthebest!`，
前面拼上 key 本身的 hex 当版本前缀。这不是加密，只是一层地址编码。

### 三条出口规则（顺序即优先级）

1. **网关自己**（`webvpn.zju.edu.cn`）→ 永远直连，否则会无限套娃。
2. **非校园域名**（拼题A 等公开站点）→ 直连。它们在校外本来就可达。
3. **校园域名**（`*.zju.edu.cn`）→ 按 `networkMode`：
   - `auto`（默认）：优先直连业务站点；只有未确认校内且只读请求发生网络失败时才尝试 WebVPN；
   - `direct` / `webvpn`：听用户的。

CAS 与 identity 在自动模式下直接访问。校园网探测结果不能代替业务站点的可达性；只有未确认在校内、只读请求发生**网络类失败**且未取消时才升级到 WebVPN。4xx/5xx 是业务答复，重试没有意义，
还会把一次失败的登录提交打两遍。

### ⚠️ WebVPN 用的是「上网账号」，不是统一身份认证

| | 统一身份认证（CAS） | WebVPN 网关 |
| --- | --- | --- |
| 密码 | 统一身份认证密码 | **上网密码**（可能是另一套） |
| 用在哪 | 课堂、学在浙大 | 只在**校外**访问校内站点时 |

两者经常被混为一谈，后果很具体：用户在校外看到"登录失败"，去改统一认证密码，
然后还是失败。所以设置页把这份凭据**单独一块**，错误文案也逐条点明"这是上网账号"。

## 数据路由

`/api/zhiyun-campus`

| 方法 | 作用 |
| --- | --- |
| `GET` | `{ todos: { xzzd, pta }, pta, egress }`，两个来源各自带 `ok` / `rows` / `error` |
| `POST ?pta-cookie` | 存拼题A Cookie（需 `x-zhiyun-campus: 1` 头） |
| `POST ?reprobe` | 重新探测出口（换网络后不必重启） |

`egress` 字段回答"这次请求走的是哪条路"：`{ mode, campus, viaWebvpn, degraded, webvpn }`。
用户看到"连不上"时第一个要问的就是这件事 —— 没有它，所有人都会先去怀疑密码。

**每个来源各自 try/catch**：一个读不到不该让另一个也拿不到。这一点与 omni 版不同，
也是「规划」页曾经显示"宿主侧没起来"那个坑的一半根源。

## 会话存在哪

`<profile>/data/zhiyun-campus/`：

- `xzzd.session` —— CAS 换来的，可以自动重建；
- `pta.session` —— 用户手动粘贴的 Cookie，丢了必须再粘一次；
- `webvpn.session` —— 网关会话，与上面两份**完全分开**。

**分成三个文件**是有意的：混在一个 jar 里，"清除学在浙大会话"会顺手把拼题A Cookie
与网关会话也清掉。

## 凭据

从宿主凭据服务读两份**互不相干**的记录：

| 记录键 | 是什么 | 界面位置 |
| --- | --- | --- |
| `zhiyun-classroom/account` | 浙大一卡通（统一身份认证学号 + 密码） | 设置 → 浙大一卡通 |
| `zhiyun-campus/webvpn` | WebVPN 上网账号 | 同上，WebVPN 折叠块 |

本包**只读不写** —— 一个数据包不该替用户保存密码。写入在 `dsh-zhiyun-card`。

## 复用了什么

跨包依赖在本仓只走 `ctx` 服务，但 CAS 与 HTTP 传输是**纯库代码**（无 Cordis 依赖，
约 270 行），复制进 `src/cas/` 比引入一个脆弱的相对路径 import 更稳。

| 复用 | 来源 |
| --- | --- |
| `src/cas/{errors,urls,session,transport,auth}.js` | 原样复制自 `dsh-zhiyun-classroom/src/`（同仓同作者） |
| `src/cas/login.js` | 新写。借用 `auth.js` 的 `rsaEncrypt` / `executionToken`，落点改成学在浙大 |
| `src/xzzd.js`、`src/pta.js`、`src/index.js` | 新写 |

⚠️ 复制的那几份**不会**随 classroom 自动更新。改动时要两边一起看 —— 文件头写明了。

## 范围

只做 **xzzd** 与 **pta**。教务课表/成绩（`zdbk`）仍由 omni 提供 ——「今天」页在用，
本包不碰，避免一次性把那一页也卷进来。

## 验证

```bash
node --test tests/campus.test.mjs tests/campus-egress.test.mjs
```

测试不连外网：`Transport` 与 `egress` 都接受注入，所有接口都用假回包覆盖。
重点钉的是**它比 omni 好在哪，以及那些好处真的成立**：

- 题集列表只发 **1** 个请求（断言不出现 `/exams`）；
- 没有时区的时间串给 `iso: null` 而不是按本地时间猜（否则页面差 8 小时）；
- 站点回登录页 HTML 时判 `SESSION_EXPIRED`，不是 `API_SHAPE`
  （后者会把人引去查接口变更，而实际只要重新登录）；
- Cookie 解析排除 DevTools 表头（`Name` / `Value`）与属性行（`Path /`、`HttpOnly ✓`）；
- **CAS 错误文案按元素取 `#msg`**，不能把属性名 `id="errormsg"` 当成文案 ——
  那次误判把网络失败报成了"密码错"（见 `casErrorMessage` 的注释）；
- 校园域名判定的点边界（`evilzju.edu.cn` 不算校园站点）；
- 出口升级只在**网络类**失败时发生，4xx 不重试；
- 探不到校园网时**先试直连**，不默认推去绕网关。

## 读取边界与频率

- `cas/` 只负责认证与会话，登录跳转允许 CAS、`identity.zju.edu.cn` 与学在浙大，支持相对 Location。
- 已有 SSO 票时只续接业务跳转，不再次提交密码。
- `xzzd.js` / `pta.js` 负责平台接口与归一化；`reads.js` 合并页面的并发读取。
- 聚合结果（包括明确的失败状态）复用 60 秒。本地规划编辑不会每次都全量抓校园数据。
- 一卡通账号、密码或 PTA Cookie 改变后立即重新读取；重新探测出口也会清掉读取缓存。
- `.env` 只供显式实验入口读取，工作台的账号仍从设置里的宿主凭据服务读取。

## 低频真实宿主实验

先运行 `node scripts/campus-live-probe.mjs` 检查字段，不联网。
显式加 `--live` 后，脚本在隔离的数据目录启动本仓完整 profile 的真实 DSH 宿主，
以插件上下文调用本仓真实 Transport、CAS 与平台客户端，不运行全量逐课待办抓取。

总预算为 12 个外部请求（含跳转）、最多一次密码提交、一次 PTA 列表请求。
403、429 或网络异常会停止后续请求。运行记录用独占创建方式阻止重复实验，
不要删除记录来绕过限制。仅当保存会话在密码提交前失败，或已有 SSO 票需要续接时，
提供受旧报告状态与独立一次性记录约束的续接入口；总预算不重置。

报告、实验 profile 和会话都在忽略目录 `artifacts/campus-live/`。
报告仅保留状态、错误码和数量；不保存响应正文、账号、密码、Cookie 或带票据的 URL。
会话仍采用 Windows DPAPI。实验前先用无敏感信息的样本检查 DPAPI，失败时不请求网站。
实验只验证其实际到达的阶段；拿到业务会话不能代替课程接口与完整待办的验收。


课程列表使用 `GET /api/my-courses`，查询中的 `conditions.semester_id` 与 `conditions.status` 是数组，不能改成 `{value,type}`。查询还带 `normal`、`sort` 和 `fields`；缺失 `courses` 时明确报结构错误，避免误报成无课。


## 待办读取的契约与恢复

默认逐课、逐端点串行取数，避免把课程并发再乘以五个端点。遇到 429 立即停止，普通读取错误不自动重试。作业提交状态的 404 明确表示该课无作业，可以按空处理；其他 404、500 和提交状态缺权限都会明确失败，不能推断成“未提交”。

作业提交状态读取 homework_activities；已交测验读取 exam_ids。保留旧版明确命名字段兼容，缺少这些字段时报告响应契约错误。published/is_active 支持布尔值和数字 1；进行中且无结束时间的课堂互动仍保留。

校园会话绑定账号，切换账号必须重新建会话。首次使用与会话过期都走同一认证入口；课堂服务可用时在后端共享已核对账号的 SSO，不靠复制实验文件。过期后只允许重新认证并重试当前只读请求一次，不能重跑整批课程或重放 POST。

离线验收覆盖：空 profile 启动两个真实服务、一次 CAS 提交、全部五类待办端点、规划路由响应；以及会话中途过期、无作业 404、真实字段名称、响应字段漂移、限流停止、移除凭据。夹具全部为虚构数据，不使用 .env。
