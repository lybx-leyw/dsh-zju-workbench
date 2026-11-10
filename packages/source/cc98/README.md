# @lybx-leyw/dsh-zju-source-cc98

浙大 **CC98 论坛**（`api.cc98.org`）数据源：22 个读方法 + 8 个写动作。

> ⚠️ 这一行早先写的是「**只读**数据源」。那与代码直接矛盾：`src/writes.js` 实现了
> 8 个写动作，`src/index.js:480` 的 `readOnly` 是 `false`，`writeMethods` 列了 16 个
> `xxxPrepare` / `xxxExecute`。分层结果是「写方法的**审批**在 `tool/campus-write`」，
> 不是「数据包里没有写方法」。

纯 JavaScript（ESM，无 TypeScript），不编译、不打包宿主代码，`node -e "import(...)"` 就能加载。

## 它做什么

把 CC98 的读取接口收成 22 个方法，挂在一条同源数据路由上：

```text
GET  /api/zhiyun-cc98        → 自描述（能干什么、参数示例）+ 当前登录状态（不回令牌本身）
POST /api/zhiyun-cc98        → { type:'client-request', rpcId, method:'cc98.hot', payload:{…} }
```

信封里的 `method` 既接受顶层（本包约定），也接受 `payload.method`（omni 时代的口径）；
参数则从 `payload.args` 取（顶层形态下 `payload` 本身即参数）。两种信封都已在用的调用方
不该为一个字段改名。

### 浏览与搜索

| 方法 | 作用 | CC98 接口 |
| --- | --- | --- |
| `cc98.search` | 全站搜索（按标题） | `GET /topic/search` |
| `cc98.topic` | 帖子详情 + 楼层（UBB 已清洗） | `GET /topic/{id}` + `GET /Topic/{id}/post` |
| `cc98.hot` | 十大（今日/周/月/历史） | `GET /config/index`、`GET /topic/hot-{range}` |
| `cc98.newTopics` | 新帖 | `GET /topic/new` |
| `cc98.boards` | 全部版面（按分区） | `GET /Board/all` |
| `cc98.boardTopics` | 版面帖子 / 精品帖 | `GET /board/{id}/topic`、`GET /topic/best/board/{id}` |
| `cc98.boardTags` | 版面标签（两层：`tag1` / `tag2`） | `GET /board/{id}/tag-v2` |
| `cc98.user` | 用户资料（简介已清洗） | `GET /user/{id}`、`GET /user/name/{name}` |
| `cc98.notifications` | 通知列表（回复/@/系统） | `GET /notification/{kind}` + `GET /me/unread-count` |
| `cc98.conversations` | 最近私信联系人 | `GET /message/recent-contact-users` |
| `cc98.messages` | 与某人的私信记录（UBB 已清洗） | `GET /message/user/{id}` |

### 帖内文件与楼层

| 方法 | 作用 | CC98 接口 |
| --- | --- | --- |
| `cc98.topicDownload` | 某一楼的文件链接（配了目录才落盘） | `GET /Topic/{id}/post` + `file.cc98.org` |
| `cc98.original` | 楼层原文（UBB / Markdown **原样**，不清洗） | `GET /post/{id}/original` |
| `cc98.ratingReasons` | 评分理由（`plus` / `minus`） | `GET /post/rating-reason?type=1\|2` |

### 账号（我的）

| 方法 | 作用 | CC98 接口 |
| --- | --- | --- |
| `cc98.overview` | 个人中心总览（资料 + 签到 + 未读 + 自定义版面） | `GET /me`、`/me/signin`、`/me/unread-count`、`/board/?id=…` |
| `cc98.myTopics` | 我发表的主题 | `GET /me/recent-topic` |
| `cc98.myPosts` | 我的回复（可只要高赞） | `GET /me/recent-post`、`GET /me/hot-post` |
| `cc98.history` | 浏览记录 | `GET /me/browsing-record` |
| `cc98.favorites` | 收藏（含分组；可按标题搜收藏） | `GET /me/favorite-topic-group`、`GET /topic/me/favorite`、`GET /topic/me/search-favorite` |
| `cc98.following` | 我关注的人 / 粉丝 | `GET /me/followee`、`GET /me/follower` + `GET /user/basic?id=…` |
| `cc98.feed` | 动态（自定义版面 / 关注的人） | `GET /me/custom-board/topic`、`GET /me/followee/topic` |
| `cc98.signinMonth` | 某月签到记录 | `GET /me/signin-in-month?year=&month=` |

另有两条非数据动作：`cc98.status`（配了没、登录没）与 `cc98.logout`（丢掉本地令牌）。
两者都不碰网络：没配账号时也能回答"我到底配了没"。

返回形状要点：

- 列表方法统一带 `next_from`（`null` = 到底了）。`myPosts` / `history` 有服务端给的
  `count`，那时按**总数**算下一页，而不是靠"满页即可能还有"猜；
- `myPosts` / `history` 的每条是 `postView` / `topicSummary` + 额外定位字段；
- `topicDownload` 的 `downloaded` 标明这次到底落没落盘，`dir` 是落盘根（没配就是 `null`）；
- `overview` 里拿不到的项给 `null` 而不是 0 —— 0 是"确实没有"，`null` 是"不知道"。

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
`@lybx-leyw/dsh-zju-source-login` 的设置界面（`writeCc98`）。

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

`cc98.topicDownload` 只写本机文件，服务器上的一切不动（判据：**有没有改别人的状态**）；
而且**默认不落盘** —— 没配 `downloadDir` 时只回链接。

## 写操作去哪了

按 D17（数据源只提供事实，写操作单独成包），**写操作归 `packages/tool/campus-write`**。
本仓**本次不建**那个包，所以下面 8 条目前**没有任何实现**，本包也不提供：

| 上游能力（`zju-assistant/cc98`） | 做什么 | 现在在哪 |
| --- | --- | --- |
| `cc98 board post` | 发主题（`api.createTopic`） | `packages/tool/campus-write`（未建） |
| `cc98 topic reply` | 回帖（`api.reply`） | 同上 |
| `cc98 topic favorite` | 收藏 / 取消收藏（`api.setFavorite`） | 同上 |
| `cc98 floor like` | 赞 / 踩（`api.like`） | 同上 |
| `cc98 floor rate` | 评分（`api.rate`，理由取自本包的 `ratingReasons`） | 同上 |
| `cc98 floor edit` | 编辑自己的楼层（`api.editPost`） | 同上 |
| `cc98 private-message send` | 发私信（`api.sendMessage`） | 同上 |
| `cc98 account signin` | 签到（`api.signIn`） | 同上 |

上游这 8 条都过写闸（`ZJU_ALLOW_WRITE=1` + `--confirm`）并落写日志（`begin/done/rejected/verified/unknown`），
其中「发出去结果不明」只允许**只读回查**、绝不重发。那套闸与日志一起归写包；
本包不复述、也不弱化 —— `tests/cc98.test.mjs` 有一条断言这 8 个名字**都不在** `METHODS` 里。

**为什么要分成两包**：本包是「读」，任何一次调用都不改变论坛状态；写包需要确认、审计、
幂等回查。把两件事放进同一个方法表里，页面就无法用"这个方法安全"来区分了。

## 已知限制

| 限制 | 说明 |
| --- | --- |
| **没有 WebVPN** | 只直连 `api.cc98.org`。人在校外时 CC98 需要网关，本包没有内置，显式抛 `WEBVPN_REQUIRED`（见下一节） |
| **帖内文件默认不落盘** | `topicDownload` 只在配了 `downloadDir` 时写文件；否则只回 `file.cc98.org` 的链接。落盘用 `wx` 独占创建，撞名加 `(1)` 序号，**从不覆盖** |
| **只下载 `file.cc98.org`** | 楼层链接是外部用户写的，别的主机一律 `INVALID_PATH`。不做任意 URL 抓取 |
| **`original` 只能读自己的楼层** | 服务端对别人的楼层回 403，本包如实翻成 `FORBIDDEN`，不绕 |
| **签到只读** | `signinMonth` 读记录；**签到本身是写操作**，归 `campus-write`。本包没有任何能改变签到状态的方法 |
| **搜索没有分页总数** | `/topic/search` 不回 `count`，`next_from` 只能按"满页即可能还有"给 |
| **一次只能看一个帖子** | 上游 `viewTopics` 支持一次多帖（`--id a\|b\|c`），本包没有：多帖编排属于调用方，不属于数据层 |
| **没有「只看楼主」/「按词筛楼层」** | 上游靠 `postByFloor` + `postsBySameAuthor` 实现；本包只做单页楼层读取（`topic`），这类编排留给调用方 |
| **没有搜索编排** | 上游 `query.ts` 的「多说法合并去重 + 相关度排序 + 限流退避」未移植；本包 `search` 只做一次直查 |
| **`following` 的名字可能为 null** | `/user/basic` 查不到时回 `null`，**不编**「用户123」 |
| **`overview` 任一项失败即整体失败** | 总览缺一块就是一份错的概况，所以不 `.catch(() => null)` 静默降级 |
| **`signinMonth` 的 `total_reward` 可能为 null** | 所有记录都缺 `reward` 字段时回 `null`（不知道），不回 0（确实没奖励） |

## WebVPN 限制（如实说明）

omni 的 `client.ts` 里有一支 `mode === 'webvpn'`，依赖 omni 自己的
`ctx.network.webvpnJar()` / `loginWebvpn()`。那是**omni 内部的网络抽象**，不属于共享层，
本包**不依赖它**。

本包改用**共享出口**：请求经 `sharedFetch(ctx)` 借 `@lybx-leyw/dsh-zju-source-campus`
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
| 写操作 | `actions.ts`（发帖/回复/私信） | **不移植** | 只读数据源，写操作归 `packages/tool/campus-write` |
| `[code]` | 未处理，裸标签留在正文里 | 剥标签、留内容 | 与函数自己的语义一致 |
| 私信 `contentType` | 未判断，直接 `String(content)` | `contentType === 1` 走纯文本，否则 UBB | 与帖子同一口径 |
| 时间 | `deadline().shanghai` 形如 `2024-01-02 11:04:05 +08:00` | 同格式（**接口契约保持一致**） | 拆包只换实现，不换对外形状 |
| 错误 | `ToolError(code, message, details)` | 共享层 `ClassroomError(code, message, details)` | 全仓统一一种错误形状 |

返回结构（`topicSummary` 的下划线字段、`next_from`、`total_floors`、`note`）**逐一照搬 omni**，
调用方不需要跟着改。

与上游 `zju-assistant/cc98` 的对照（本包补的那 12 条只读方法）：

| 项 | 上游 | 本包 | 为什么 |
| --- | --- | --- | --- |
| 帖内文件 | `download()` **必然**流式落盘到 `data/output/cc98/` | 默认只回链接；配了 `downloadDir` 才落盘 | 一个只读数据源不该替用户决定磁盘布局；落盘策略归 `packages/tool/` |
| 落盘撞名 | 以 uuid `.part` 写入后 rename（覆盖） | `wx` 独占创建，撞名加 `(1)` 序号 | 覆盖会把用户上一次下载的文件悄悄换掉 |
| 文件名 | 按 URL 路径建子目录 | 只取最后一段 + 过滤非法字符 | 路径来自外部用户写的链接，不把目录结构交给发帖人 |
| 楼层视图 | `viewPost()` 含引用拆分、附件、评分 | `postView()` 只给定位 + 正文 | 引用拆分/评分摘要是展示策略，本包不做（`ubb.js` 保留 `[引用]` 提示） |
| 多帖 / 只看楼主 / 按词筛 | `viewTopics` / `only` / `find` | **不移植** | 多帖编排与筛选属于调用方，不属于数据层 |
| 搜索编排 | `query.ts`（多说法 + 相关度 + 限流退避） | **不移植** | 同上；`search` 只做一次直查 |
| 分页 | 上游不给 `next_from`，由 CLI 拼 | 统一 `next_from`；有 `count` 时按总数算 | 偏移分页靠"满页"猜会多打一次空请求 |
| 文件名 `displayName` | 匿名显示 `匿名ABCD` | 只显示「匿名」 | 与 omni 那 10 条保持一致，不按上游改 |

## 复用共享层（不复制）

```js
import { Transport, SessionStore, ClassroomError, shape, object, array } from '@lybx-leyw/dsh-zju-source-http';
```

请求/超时/取消/按主机白名单收发 cookie、DPAPI 会话落地、统一错误形状都由共享层提供。
本包只补三件 CC98 特有的事：Bearer 头、HTTP 状态到可操作错误码的翻译、UBB 清洗。

凭据读 `@lybx-leyw/dsh-zju-source-login` 的 `readCard(ctx)`，跨包走**包名**而不是相对路径。

## 文件结构

```text
packages/source/cc98/
├── package.json        # type: module, main: ./src/index.js
├── cordis.patch.yml    # id: zhiyun-cc98
├── OWNERS
├── README.md
└── src/
    ├── index.js        # Cordis 插件：apply + 数据路由 + zhiyunCc98 服务
    ├── hosts.js        # CC98_API / TOKEN_URL / CC98_HOSTS
    ├── token.js        # OAuth2 密码模式：获取 / 刷新 / 缓存
    ├── client.js       # Cc98Client：GET + Bearer + 状态翻译 + 401 重试一次 + fetchFile
    ├── ubb.js          # UBB → 纯文本
    └── reads.js        # Cc98Reader：22 个只读方法 + 纯函数（asList / fileLinks / floorAnchor …）
```

## 挂载

`cordis.patch.yml` 会把 `zhiyun-cc98` 插进 profile：

```yaml
- insert:
    - id: zhiyun-cc98
      name: @lybx-leyw/dsh-zju-source-cc98
```

`apply(ctx, config)` 的可用配置：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `dataDir` | `<profile>/data/zhiyun-cc98` | 令牌与会话目录；**传 `null` 则纯内存**（测试据此不碰 DPAPI） |
| `downloadDir` | `null`（**不落盘**） | `cc98.topicDownload` 的文件目录。不默认开：写满磁盘这件事应当显式同意 |
| `fetch` | `globalThis.fetch` | 出口实现，测试注入假 fetch |
| `protect` | `dpapi` | `SessionStore` 的保护器 |
| `timeoutMs` | `20000` | 单请求超时（文件下载单独用 10 分钟） |
| `verbose` | `false` | 打每次请求的日志 |

## 测试

```bash
node --test tests/cc98.test.mjs
```

62 条用例，全部离线：假 `fetch` / 假 `Transport` / 假 Cordis 上下文，
`SessionStore` 不传 `file`（纯内存，不碰 DPAPI，也不 spawn 保护器）。
唯一碰磁盘的是 `topicDownload` 的落盘用例，它建在 `os.tmpdir()` 下并在 `finally` 里删掉。

覆盖：

- UBB 的各类标记（样式、链接、图片/视频/附件、引用、代码块、表情、空行折叠）；
- OAuth2 表单字段与 `form-urlencoded` 编码、响应解析、提前 60 秒过期、
  缓存命中不重复请求、refresh 被拒退回密码模式、密码错误与端点故障的错误码区分；
- 22 个方法的 URL 与查询参数（含 `/Topic/{id}/post` 的大写 T、`best` 的两条路径、
  `/board/{id}/tag-v2`、`/me/signin-in-month`、`/user/basic?id=…` 的重复参数写法）；
- 每个方法都同时断言**成功分支的具体值**与**失败分支的具体错误码**；
- 帖内文件：嵌套 UBB 引用的剥离、只认 `file.cc98.org`、落盘撞名加序号不覆盖、
  `fetchFile` **不**把 Bearer 发到另一个域；
- Bearer 头确实被带上、匿名接口不带、401 只重试一次；
- 插件的信封校验、方法白名单（8 个写操作名全被挡）、只读状态、`WEBVPN_REQUIRED` 翻译。

## 来源

接口契约与返回结构移植自本仓的 `dsh-zhiyun-source-omni`（其来源与改动见该包的
`ATTRIBUTION.md`：上游 [ZJU-Omni](https://github.com/Vita0818/ZJU-Omni)，MIT；
CC98 部分的上游为 [cc98-mcp](https://github.com/EviterLesRoses2/cc98-mcp)，MIT）。
本包是**纯 JS 重写**，不是逐行翻译：认证、错误归因、失败策略与只读边界都重做了。
