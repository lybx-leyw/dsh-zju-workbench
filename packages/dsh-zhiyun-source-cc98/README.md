# dsh-zhiyun-source-cc98

浙大 **CC98 论坛**（`api.cc98.org`）的**只读**数据源。

纯 JavaScript（ESM，无 TypeScript），不编译、不打包宿主代码，`node -e "import(...)"` 就能加载。

## 它做什么

把 CC98 的读取接口收成 10 个方法，挂在一条同源数据路由上：

```text
GET  /api/zhiyun-cc98        → 自描述（能干什么、参数示例）+ 当前登录状态（不回令牌本身）
POST /api/zhiyun-cc98        → { type:'client-request', rpcId, method:'cc98.hot', payload:{…} }
```

信封里的 `method` 既接受顶层（本包约定），也接受 `payload.method`（omni 时代的口径）；
参数则从 `payload.args` 取（顶层形态下 `payload` 本身即参数）。两种信封都已在用的调用方
不该为一个字段改名。

| 方法 | 作用 | CC98 接口 |
| --- | --- | --- |
| `cc98.search` | 全站搜索（按标题） | `GET /topic/search` |
| `cc98.topic` | 帖子详情 + 楼层（UBB 已清洗） | `GET /topic/{id}` + `GET /Topic/{id}/post` |
| `cc98.hot` | 十大（今日/周/月/历史） | `GET /config/index`、`GET /topic/hot-{range}` |
| `cc98.newTopics` | 新帖 | `GET /topic/new` |
| `cc98.boards` | 全部版面（按分区） | `GET /Board/all` |
| `cc98.boardTopics` | 版面帖子 / 精品帖 | `GET /board/{id}/topic`、`GET /topic/best/board/{id}` |
| `cc98.user` | 用户资料（简介已清洗） | `GET /user/{id}`、`GET /user/name/{name}` |
| `cc98.notifications` | 通知列表（回复/@/系统） | `GET /notification/{kind}` + `GET /me/unread-count` |
| `cc98.conversations` | 最近私信联系人 | `GET /message/recent-contact-users` |
| `cc98.messages` | 与某人的私信记录（UBB 已清洗） | `GET /message/user/{id}` |

另有两条非数据动作：`cc98.status`（配了没、登录没）与 `cc98.logout`（丢掉本地令牌）。
两者都不碰网络：没配账号时也能回答"我到底配了没"。

## 认证：OAuth2 密码模式（不是 cookie 会话）

CC98 不属于浙大 CAS 体系。它有一个独立的身份服务：

```text
POST https://openid.cc98.org/connect/token
     grant_type=password&username=<学号>&password=<密码>
     &client_id=…&client_secret=…&scope=cc98-api openid offline_access
  → { access_token, refresh_token, expires_in }
之后：GET https://api.cc98.org/topic/1   Authorization: Bearer <access_token>
```

要点：

- **表单必须是 `application/x-www-form-urlencoded`**，发 JSON 会被端点直接 400，且错误像是"参数缺失"。
- `scope` 里的 **`offline_access` 是拿到 `refresh_token` 的前提**；少了它，每次都要重新输密码。
- 令牌在**提前 60 秒**判定过期（`expires_in` 是从发令牌那一刻算的，请求本身也要花时间）。
- 过期后先用 `refresh_token` 续；**续不上（被吊销）才退回密码模式**，不会把刷新失败原样抛给用户。
- 令牌缓存在 `SessionStore`（Windows 上是 DPAPI 密文）。一个进程内并发的取令牌请求会**合并成一次**。
- **不缓存失败**：这一次失败就是这一次，下次调用照常再试。

### 凭据：CC98 有**自己的**账号记录

**CC98 账号不是浙大统一认证账号。** 这是两套互相独立的账号体系：

| | 浙大统一认证（一卡通） | CC98 |
| --- | --- | --- |
| 身份服务 | `zjuam.zju.edu.cn`（CAS） | `openid.cc98.org`（OAuth2） |
| 账号形态 | 学号 | CC98 自己的账号（论坛 ID / 注册邮箱那一路） |
| 凭据记录 | `zhiyun-classroom/account` | **`zhiyun-cc98/account`**（独立） |

一个只注册过 CC98 的人可以正常发帖，但他没有（也不需要）浙大身份；反过来说，
有一卡通也不能推出"一定能登 CC98"。omni 自己就是把 CC98 当**独立账号种类**处理的：

```ts
export const ACCOUNT_KINDS = ['zju', 'webvpn', 'cc98', 'xxt'] as const;
cc98: ['CC98_USERNAME', 'CC98_PASSWORD'],   // 自己的环境变量
cc98: 'zju-omni.cc98',                       // 自己的钥匙串条目
cc98: 'CC98',                                // 自己的标签
```

本包用 `readCc98(ctx)` 读 **CC98 自己的**记录，与一卡通完全分开：

- 只有 CC98 账号的用户**能用**（不需要浙大身份）；
- 清除 CC98 账号**不会**顺手动掉一卡通，反之亦然；
- 失败时文案说「去「设置 → CC98 账号」核对」，不会把人赶去改一个正确的浙大密码。

> 早先本包是**借用**一卡通那份记录接过来的（搬运 omni 时顺着"同一份 readCard"），
> 后果是只有 CC98 账号的人永远登不进去、失败提示方向也是错的。现已改为独立记录。

本包**只读凭据，从不写入**：一个数据包不该替用户保存密码。写入走
`dsh-zhiyun-source-card` 的设置界面（`writeCc98`）。

`client_id` / `client_secret` 是 CC98 发给公开第三方客户端的凭据（密码模式没有 PKCE，
客户端密钥天然公开，CC98-CLI / CC98-Desktop / cc98-mcp 都写在源码里），因此它出现在
公开仓库里不构成泄露。

## 只读边界

**本包没有任何写操作。** omni 的 `actions.ts`（发帖、回复、私信发送）**未移植** ——
那些操作在 omni 里靠 `PlanStore` 做「先生成预览再执行」的两段式确认，本包没有那层状态，
也就不该有那批方法。少一个能改论坛状态的入口，比多一层确认更可靠。

路由的方法表是**白名单**（`METHODS`），不是反射读取器上的属性：这条路由给同源页面用，
让调用方能拨动 `constructor` / `__proto__` 之类的属性没有正当用途。

`cc98.notifications` 也不会把通知标为已读。

## WebVPN 限制（如实说明）

omni 的 `client.ts` 里有一支 `mode === 'webvpn'`，依赖 omni 自己的
`ctx.network.webvpnJar()` / `loginWebvpn()`。那是**omni 内部的网络抽象**，不属于共享层，
本包**不依赖它**。

本包改用**共享出口**：请求经 `sharedFetch(ctx)` 借 `dsh-zhiyun-source-campus`
提供的 `zhiyunEgress` 服务。CC98 是公网域，策略判定为**直连** —— 关键是这条直连
会**绕开宿主为 LLM 配的全局代理**（实测：同一个 `api.cc98.org` 请求，
`globalThis.fetch` 10.7 秒后 `NETWORK` 失败，走共享出口 97ms 就拿到响应）。

校园域（`*.zju.edu.cn`）的请求若出现在 CC98 链路上，也会自动走 WebVPN；
本包自己不再判断网络。campus 没装时退回 `globalThis.fetch`，此时若因网络原因失败
（`NETWORK` / `TIMEOUT`），仍抛 **`ClassroomError('WEBVPN_REQUIRED', …)`**，
不会把它伪装成「密码错了」或「论坛挂了」。

## UBB → 纯文本

帖子正文、私信、通知内容、个人简介在 API 里是**带 UBB 标记的字符串**。`src/ubb.js` 负责清洗：

| 标记 | 结果 |
| --- | --- |
| `[img]u[/img]` `[video]u[/video]` `[audio]u[/audio]` | `[图片: u]` 等占位符（**保留地址**） |
| `[upload=2]u[/upload]`、无闭合的 `[upload]u` | `[文件: u]` |
| `[url=x]文本[/url]` / `[url]u[/url]` | `文本 (x)` / `u` |
| `[quote]…[/quote]` | 行首 `> [引用]`，保留层级 |
| `[code]…[/code]` | 只剥标签，代码内容原样保留 |
| `[b] [i] [u] [del] [center] …`、`[color=red]` 等带参样式 | 剥掉 |
| `[ac01] [em02] [CC9801] …` | `[表情]` |

`contentType === 1` 的楼层是服务端已给的纯文本，**不再过 UBB**（否则正文里字面的 `[b]`
会被吃掉）。

## 取舍（与 omni 的差别，逐条）

| 项 | omni | 本包 | 为什么 |
| --- | --- | --- | --- |
| 实现语言 | TypeScript | 纯 JS（ESM） | 不需要编译步骤，`node -e` 直接可用 |
| 包结构 | 六平台合一 | 只 CC98 | 六平台的认证方式根本不同（CAS cookie / WebVPN / OAuth2 Bearer），混在一起 regression 面太大 |
| 网络抽象 | `ctx.network.chooseMode()` + `webvpnJar()` | 共享层 `Transport` + 共享出口 `zhiyunEgress`（自动分域） | 出口只有一份（campus 持有），各包共用同一个 dispatcher 与 WebVPN 会话 |
| 失败处理 | `assertNoRecentFailure` 封锁 15 分钟 | 不缓存失败 | 一次网络抖动被放大成"半天不可用" |
| 写操作 | `actions.ts`（发帖/回复/私信） | **不移植** | 只读数据源 |
| `[code]` | 未处理，裸标签留在正文里 | 剥标签、留内容 | 与函数自己的语义一致 |
| 私信 `contentType` | 未判断，直接 `String(content)` | `contentType === 1` 走纯文本，否则 UBB | 与帖子同一口径 |
| 时间 | `deadline().shanghai` 形如 `2024-01-02 11:04:05 +08:00` | 同格式（**接口契约保持一致**） | 拆包只换实现，不换对外形状 |
| 错误 | `ToolError(code, message, details)` | 共享层 `ClassroomError(code, message, details)` | 全仓统一一种错误形状 |

返回结构（`topicSummary` 的下划线字段、`next_from`、`total_floors`、`note`）**逐一照搬 omni**，
调用方不需要跟着改。

## 复用共享层（不复制）

```js
import { Transport, SessionStore, ClassroomError, shape, object, array } from 'dsh-zhiyun-source-campus/http';
```

请求/超时/取消/按主机白名单收发 cookie、DPAPI 会话落地、统一错误形状都由共享层提供。
本包只补三件 CC98 特有的事：Bearer 头、HTTP 状态到可操作错误码的翻译、UBB 清洗。

凭据读 `dsh-zhiyun-source-card` 的 `readCard(ctx)`，跨包走**包名**而不是相对路径。

## 文件结构

```text
packages/dsh-zhiyun-source-cc98/
├── package.json        # type: module, main: ./src/index.js
├── cordis.patch.yml    # id: zhiyun-cc98
├── OWNERS
├── README.md
└── src/
    ├── index.js        # Cordis 插件：apply + 数据路由 + zhiyunCc98 服务
    ├── hosts.js        # CC98_API / TOKEN_URL / CC98_HOSTS
    ├── token.js        # OAuth2 密码模式：获取 / 刷新 / 缓存
    ├── client.js       # Cc98Client：GET + Bearer + 状态翻译 + 401 重试一次
    ├── ubb.js          # UBB → 纯文本
    └── reads.js        # Cc98Reader：10 个只读方法
```

## 挂载

`cordis.patch.yml` 会把 `zhiyun-cc98` 插进 profile：

```yaml
- insert:
    - id: zhiyun-cc98
      name: dsh-zhiyun-source-cc98
```

`apply(ctx, config)` 的可用配置：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `dataDir` | `<profile>/data/zhiyun-cc98` | 令牌与会话目录；**传 `null` 则纯内存**（测试据此不碰 DPAPI） |
| `fetch` | `globalThis.fetch` | 出口实现，测试注入假 fetch |
| `protect` | `dpapi` | `SessionStore` 的保护器 |
| `timeoutMs` | `20000` | 单请求超时 |
| `verbose` | `false` | 打每次请求的日志 |

## 测试

```bash
node tests/cc98.test.mjs
```

40 条用例，全部离线：假 `fetch` / 假 `Transport` / 假 Cordis 上下文，
`SessionStore` 不传 `file`（纯内存，不碰 DPAPI，也不 spawn 保护器）。覆盖：

- UBB 的各类标记（样式、链接、图片/视频/附件、引用、代码块、表情、空行折叠）；
- OAuth2 表单字段与 `form-urlencoded` 编码、响应解析、提前 60 秒过期、
  缓存命中不重复请求、refresh 被拒退回密码模式、密码错误与端点故障的错误码区分；
- 10 个方法的 URL 与查询参数（含 `/Topic/{id}/post` 的大写 T、`best` 的两条路径）；
- Bearer 头确实被带上、匿名接口不带、401 只重试一次；
- 插件的信封校验、方法白名单（写操作名被挡）、只读状态、`WEBVPN_REQUIRED` 翻译。

## 来源

接口契约与返回结构移植自本仓的 `dsh-zhiyun-source-omni`（其来源与改动见该包的
`ATTRIBUTION.md`：上游 [ZJU-Omni](https://github.com/Vita0818/ZJU-Omni)，MIT；
CC98 部分的上游为 [cc98-mcp](https://github.com/EviterLesRoses2/cc98-mcp)，MIT）。
本包是**纯 JS 重写**，不是逐行翻译：认证、错误归因、失败策略与只读边界都重做了。
