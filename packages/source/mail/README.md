# @lybx-leyw/dsh-zju-source-mail

浙大邮箱（`mail.zju.edu.cn`）数据源：**目录、邮件列表、收件箱增量、正文与附件、草稿清单**。

纯只读（D17），`auth: own`，`network: public`，`writes: false`。

## 平台事实

| 服务 | 主机 | 端口 | TLS |
| --- | --- | --- | --- |
| IMAP | `imap.zju.edu.cn` | **993** | 隐式 TLS（`secure: true`，`minVersion: TLSv1.2`） |
| SMTP | `smtp.zju.edu.cn` | **994** | 隐式 TLS（同上） |

- 认证用**16 位「客户端专用密码」**（浙大邮箱网页版生成），**不是**统一身份认证密码；
- 一个账号、直连 TLS，走公网（`network: public`），不经 WebVPN；
- 单封邮件上限 **25 MB**（`MAX_MESSAGE`），附件总量上限 **10 MB**（`MAX_ATTACHMENTS`，本包只读、该常量只用于与写包对齐）。

## 能力（8 个只读方法）

| 方法 | 路由 action | 作用 |
| --- | --- | --- |
| `folders()` | `mail.folders` | 目录清单，跳过 `\Noselect` |
| `list(input)` | `mail.list` | 某目录的信头分页（`limit` 1–50 / `offset` / `since` / `until` / `unread` / `from` / `query`） |
| `inbox(input)` | `mail.inbox` | 收件箱**增量**：按 UID + UIDVALIDITY 认新信，不看已读标记 |
| `read(input)` | `mail.read` | 一封邮件的信头、正文（≤60000 字符，`truncated` 明说）与附件清单 |
| `download(input)` | `mail.download` | 把一个附件落盘，返回 `{ file, filename, size }` |
| `drafts()` | `mail.drafts` | 草稿清单（**只读**；由写包落盘） |
| `test()` | `mail.test` | 真连一次：IMAP 只读打开收件箱 + SMTP `verify()`，**不发信** |
| `snapshot()` | `mail.snapshot` | 状态快照，**不联网** |

**路由 action 与 `methods` 里的字符串逐字相同。** 这一点是硬约束：此前的包在这里错过
（`methods: ['mail.list']` 而路由只认 `'list'`），外部照着 `methods` 写字面量会一直 400。
`tests/mail.test.mjs` 里有一条测试直接断言「每个 methods 都有对应的动作」。

## 三个方向都硬的地方

### 1. 网络问题与凭据问题是**不同的码**

两类的用户动作完全不同：**重试 vs 改密码**。混成一个码，用户会反复重试一个永远不会好的操作。

| 底层事实 | 本包的码 | 用户该做什么 |
| --- | --- | --- |
| `authenticationFailed` / `EAUTH` / `NO [AUTHENTICATIONFAILED]` | `AUTH_EXPIRED` | 去网页版重新生成 16 位专用密码 |
| `ETIMEDOUT` / `ETIMEOUT` / 文案含 timeout | `TIMEOUT` | 检查网络后重试 |
| `ENOTFOUND` / `EAI_AGAIN` / `ECONNREFUSED` / `ECONNRESET` / `EHOSTUNREACH` | `UNREACHABLE` | 查网络/代理后重试 |
| TLS 证书类（`CERT_HAS_EXPIRED` / `EPROTO` / …） | `UNREACHABLE` | 多半是网络中间人改写了加密流量，关代理 |

`AUTH_EXPIRED` 的文案里明写「这不是网络问题，反复重试不会好转」。

**命令级失败**（已经连上之后）走另一条翻译（`translateProtocolError`）：目录不存在 / 权限不够
都翻成 `REJECTED`（用户该刷新后重选），而命令阶段掉线（`ECONNRESET` / `ETIMEDOUT`）仍按连接口径报。
上游把这些原样抛成裸 `Error`，路由只能写 `code: 'FAILED'`，调用方没法按码分流 —— 这里补上了。

### 2. 超时有两层

`sharedFetch` 不适用（IMAP 不是 HTTP）。本包叠了两层：

1. `imapflow` / `nodemailer` 自己的 `connectionTimeout` / `greetingTimeout` / `socketTimeout`（与上游逐项相同）；
2. `Promise.race` 兜底（`withTimeout()`）—— 注入的客户端不理会第一层，真机上 `connect()` 也偶尔在 greeting 之后静默挂住。

默认 `{ connectMs: 15_000, operationMs: 60_000 }`，可经 `apply(ctx, { timeouts })` 覆盖。

### 3. UIDVALIDITY 拿不到就报 `SHAPE`，不退化

UIDVALIDITY 是定位邮件的唯一锚点：`list()` 交给调用方，`read()`/`download()` 拿它比对，
`inbox()` 拿它判断目录有没有被重建。拿不到时抛 `SHAPE`，**不退化成空串继续跑** ——
那样「目录重建」会被误判成「没有新信」。

判定用**数字位数**（`/^[1-9]\d*$/`）而不是真值：`imapflow` 新版给的是 BigInt，
而 `String()` 之后 `'0'` / `'null'` / `'undefined'` 都是真值 —— 早先的 `if (!uidValidity)` 永远不成立。

## 凭据

**本包不读凭据服务、不写任何凭据文件。** 调用方通过 `setCredentialProvider` 注入：

```js
const mail = ctx.get('zhiyunMail')
mail.setCredentialProvider(async () => ({ address: '3200000000@zju.edu.cn', password: '******' }))
const page = await mail.list({ limit: 20 })
```

这与 `source/yjsy` 的 `setTokenProvider`、`source/http` 的 `setWebvpnSession` 是同一条原则：
**下层不知道凭据从哪来。**

传非函数且非 `null` 会**立刻**抛 `CONFIG` —— 静默置空会让调用方以为注入成功，
直到下一次真正取信才报「没有密码」，那时已经很难定位是谁没接通。

## 写操作去哪了

按 D17，**写操作归 `packages/tool/mail`**（本次不建）。上游 `mail.mjs` 的四个写方法：

| 上游方法 | 做什么 | 现在在哪 |
| --- | --- | --- |
| `send()` | 发送草稿（上游带写闸 `if (input?.confirm !== true) throw ...`） | 将来进 `packages/tool/mail` |
| `prepare()` | 新建草稿并落盘 | 同上 |
| `updateDraft()` | 改草稿 | 同上 |
| `removeDraft()` | 删草稿 | 同上 |

四者都没有出现在本包：`tests/mail.test.mjs` 有一条测试断言
`service.send / prepare / updateDraft / removeDraft / connect / disconnect` 全是 `undefined`。

上游 `send()` 里的 `if (input?.confirm !== true) throw new Error('请先在对话中确认邮件内容并取得用户的明确发送授权。')`
正是 D17「写操作要审批」的对应物 —— 那句话与它的写闸一起归写包，本包不复述、也不弱化。

### 「下载附件到本地」为什么不算写操作

判据是**「有没有改别人的状态」**：

- `download()` 只写本机文件，服务器上的邮件与已读标记一概不动（所有 IMAP 操作都是 `mailboxOpen(..., { readOnly: true })`）；
- 落盘路径是新 uuid 目录，用 `flag: 'wx'` 建新文件，理论上不会撞名；万一撞了宁可报错也不覆盖。

## 装配

```js
apply(ctx, {
  draftDir,      // 草稿目录（只读打开）；缺省 <profileContext>/data/zhiyun-mail/outbox
  downloadRoot,  // 附件落盘根；缺省 CAMPUS_DOWNLOADS_DIR/CampusAgent 或 ~/Downloads/CampusAgent
  timeouts,      // { connectMs, operationMs }
  imap, smtp, parse,  // 工厂注入点：测试传假的，全链路离线
})
```

`imap` / `smtp` / `parse` 三个工厂注入点是照上游 `mail.mjs:73` 的设计留的：

```js
constructor({ ..., imap = options => new ImapFlow(options), smtp = options => nodemailer.createTransport(options) })
```

区别是默认实现走**动态 `import()`**：`imapflow` / `nodemailer` / `mailparser` 是产品依赖、
不在本仓 `node_modules` 里，静态 import 会让本文件的任何测试在加载阶段就 `ERR_MODULE_NOT_FOUND`。

## 没有设置分区

`auth: own` 但凭据由集成层注入，本包无用户可配置项 → 需要进 `tests/source-settings.test.mjs`
的 `NO_SETTINGS` 白名单：`['mail', '凭据由集成层注入、本包无用户可配置项；IMAP 993 / SMTP 994 直连公网']`。

## 已知限制（如实写）

### ⚠️ 没有任何一项经过真实邮箱验证

**没有**用真实浙大邮箱跑通过任何一个方法。所有测试都用注入的假 IMAP/SMTP 工厂与合成的
parser 结果；夹具（信封字段名、`uidValidity` 的存在形式、附件在 `simpleParser` 结果里的形状）
是**照上游代码与注释推断**的，不是从真实服务器抓的。真实返回可能有别的边角
（例如 `uidValidity` 是 BigInt、某些目录的 `specialUse` 缺失），那种差异这里测不出来。

### 与上游行为**不等价**的地方

| 项 | 上游 | 本包 | 影响 |
| --- | --- | --- | --- |
| 下载目录探测 | Windows 上问 Shell 要「下载」的真实位置（可能被挪到别的盘） | 不 exec 外部进程，只用 `~/Downloads/CampusAgent`（`CAMPUS_DOWNLOADS_DIR` 可整体覆盖） | 用户把「下载」挪到别的盘时，附件会落到主目录下 |
| 插件开关 | `enabled()` 读 `plugins.disabled().includes('zju-mail')` | 无（本包没有插件开关概念） | 上层要停用请直接不装配它 |
| 账号持久化 | `mail.json` 存 `{ id, address, secret, connectedAt }` | 不落盘；`id` 从地址现算，`snapshot().connectedAt` 恒为 `''` | 「上次连接时间」这个读数没有 |
| 并发互斥 | `busy` + `exclusive()` + `generation` 代际作废 | 全部去掉：每次调用开一条连接、用完即关 | 两个并发调用会各开一条 IMAP 连接（服务器允许，但没有合并） |
| 下载目录结构 | `<下载>/CampusAgent/mail/<uuid>/<文件名>` | 相同（根目录的探测方式不同，见上） | — |

### 明确未验证

- **`test()` 的 SMTP 侧**：`verify()` 在真实 `smtp.zju.edu.cn:994` 上是否需要先 `EHLO` 之外的额外握手，未测。
- **`inbox()` 的 `n:*` 语义**：按上游注释与 IMAP 规范复刻（`n:*` 会带上最新一封，所以必须
  `.filter(uid => uid > after)`），但**没有对着真实服务器验证过**。
- **`read()` 的 60000 字符上限**：上游是 `slice(0, 60000)`，本包保留；真实长邮件（比如
  一份 300 KB 的纯文本通知）会不会在 60000 字符内丢掉关键信息，未评估。
- **附件落盘时的并发冲突**：`flag: 'wx'` 会抛 `EEXIST`，本包**没有**把那个错误翻成 `MailError`
  —— 会以原始 `Error` 上抛。理论上 uuid 目录不会撞，但这条路径没测。

## 上游对账（`mail.mjs` 的全部方法）

| 上游 | 本仓对应物 |
| --- | --- |
| `constructor({ file, plugins, vault, downloads, imap, smtp })` | `Mail({ credentialProvider, imap, smtp, parse, draftDir, downloadRoot, timeouts })` —— `vault`/`plugins`/`file` 去掉（凭据与开关由外部注入），多一个 `parse` 注入点 |
| `enabled()` | **丢弃**：本包没有插件开关，装配与否就是开关 |
| `assertEnabled()` | **丢弃**：同上 |
| `account()` | **丢弃**：不落盘账号记录；地址由凭据提供者给 |
| `snapshot()` | `snapshot()` —— `enabled`/`connectedAt`/`servers` 保留形状；`error` 是新增字段 |
| `changed()` | **丢弃**：无长连接、无代际，没有「作废在途连接」的需求 |
| `check(generation)` | **丢弃**：同上 |
| `exclusive(work)` | **丢弃**：不互斥；每次调用独立连接 |
| `idle(rounds)` | **丢弃**：没有后台扫描要等 |
| `credentials()` | `credentials()` —— 改为调注入的提供者 |
| `withImap(credentials, generation, work)` | `withImap(work)` —— 签名收窄，凭据内部取 |
| `transporter(credentials)` | `transporter(credentials)` —— 相同（只给 `test()` 用） |
| `verify(credentials, generation)` | `test()` —— 改名与上游公开方法名一致 |
| `connect(input)` | **丢弃（写）**：存账号/密码 → `packages/tool/mail` |
| `test()` | `test()` —— 保留 |
| `disconnect()` | **丢弃（写）**：删账号记录 → `packages/tool/mail` |
| `folders()` | `folders()` —— 保留 |
| `list(input)` | `list(input)` —— 保留（含 `since >= until` 拒绝、`uidValidity` 校验） |
| `inbox(input)` | `inbox(input)` —— 保留全部语义（baseline / more / last / `n:*` 过滤） |
| `message(client, input)` | `message(client, input)` —— 保留（内部步骤，不对外暴露） |
| `read(input)` | `read(input)` —— 保留 |
| `download(input)` | `download(input)` —— 保留 |
| `draftFile(id)` | **丢弃**：本包不建草稿路径，只读 `draftDir` 下的文件 |
| `revision(draft)` | `revision(draft)` —— 导出为纯函数 |
| `publicDraft(draft)` | `publicDraft(draft)` —— 导出为纯函数 |
| `drafts()` | `drafts()` —— 保留（只读） |
| `prepare(input)` | **丢弃（写）** → `packages/tool/mail` |
| `removeDraft(input)` | **丢弃（写）** → `packages/tool/mail` |
| `updateDraft(input)` | **丢弃（写）** → `packages/tool/mail` |
| `send(input)` | **丢弃（写）** → `packages/tool/mail` |

模块级导出：

- `ZJU_MAIL` → 同名常量保留；
- `MAX_MESSAGE` / `MAX_ATTACHMENTS` → 同名常量保留；
- `readJSON` / `writeJSON` → **丢弃**：落盘归写包；
- `text` / `address` / `recipients` / `integer` / `date` → 保留 `text` / `integer` / `date`；
  `address` / `recipients` 只被「写」路径（`prepare` / `updateDraft` / `connect`）用到 → **丢弃**；
- `addresses` / `iso` / `filename` / `connectionError` → 保留 `addresses` / `iso` / `filename`；
  `connectionError` 改造成 `translateConnectError`（多了 `MailError` 码与阶段信息）；
  另新增 `translateProtocolError`（命令级失败 → `REJECTED`），上游没有对应物；
- `snapshotAttachments` → **丢弃（写）**：只给 `prepare` / `updateDraft` 用。

`downloads.mjs`：`Downloads` 类**丢弃**（`root()` 的行为由 `downloadRoot` 取代；
`reveal()` 是「打开文件管理器」，不属于数据源）。

`mail-vault.mjs`：`mailVault()` **丢弃** —— 凭据存 `ctx.credentials` 属于「凭据从哪来」，
本包改为由调用方注入；`seal` / `open` / `forget` 三个动作**一个都不在本包**。

`mail-feed.mjs`：`MAIL_PLUGIN`、`CHECK_MS`、`CHECK_RETRY_MS`、`fromMail()`、`MailFeed` **全部丢弃**
—— 那是「个人消息通知栏」的缓存与轮询层，不是邮箱数据源本身。
它需要的两样东西本包已经给了：`mail.inbox()`（增量）与 `mail.idle()` 的替代
（本包没有 `busy`，feed 层可以并发调用）。将来若要重建 feed，应在 `packages/client/page-today`
或独立的通知服务里做，不要塞回数据源。
