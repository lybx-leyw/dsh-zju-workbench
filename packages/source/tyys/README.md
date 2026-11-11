# @lybx-leyw/dsh-zju-source-tyys

浙大体艺两个**只读**面：

1. **场馆平台**（`http://www.tyys.zju.edu.cn/venue-server`）—— 场馆目录、某天余量、
   预约须知与放号时刻、本人场馆订单；
2. **体艺 App**（`http://tyys.zju.edu.cn/cgapp-server` + `http://www.tyys.zju.edu.cn/ptm`）
   —— 体育课考勤、App 会话状态。

**读 7 个方法 + 写 2 个动作**，`auth: cas`，`network: public`。

> ⚠️ 这一行早先写的是「纯只读（D17）……`writes: false`」。那与代码直接矛盾：
> `src/writes.js` 实现了预约与取消，`src/index.js:163` 的 `writeMethods` 列了 4 个
> `xxxPrepare` / `xxxExecute`，服务面 `readOnly` 是 `false`。
> `package.json` 的 `dsh.capability.writes` 仍是 `false`，那是**分层口径**
> （审批在 tool 层），不是「本包没有写方法」—— 两件事此前被混成一句了。

## 平台事实

| 项 | 值 |
| --- | --- |
| 主机 | `tyys.zju.edu.cn`、`www.tyys.zju.edu.cn` |
| 网络 | **public** —— 上游 `module.json` 声明 `network: public`，主机表（`source/webvpn/src/hosts.js`）也把这两个主机判 `public`+`cas: true`。校外能直连，不必绕 WebVPN |
| 认证 | **CAS，两个面各走一次 service 委托**，换来的令牌不能互换 |
| 协议 | 两个根都是 **HTTP**（不是 HTTPS） |

### 两套令牌

| 面 | CAS service | 拿到什么 | 怎么带 |
| --- | --- | --- | --- |
| 场馆平台 | `http://tyys.zju.edu.cn/venue-server/sso/manageLogin` | 回跳地址里的 `oauth_token` → `POST /api/login` → `token.access_token` → `POST /roleLogin {roleid:3}` 换正式令牌 | 请求头 `cgAuthorization` |
| 体艺 App | `http://www.tyys.zju.edu.cn/cgapp-server/cas/appLogin` | 页面正文里的 `jwtToken`（**5 段**） | 请求头 `cgAuthorization`（前 3 段）+ `sign` |

### 场馆平台的请求签名

```text
sign = md5(salt + endpoint + 排序后(按参数名)的 k+v（跳过 null、空串、对象） + timestamp + " " + salt)
```

`app-key` / `timestamp` / `sign` 在**请求头**里；GET 的查询串另加 `nocache=<timestamp>`，
**而它参与签名**（漏掉它签名就对不上）。`salt` 与 `app-key` 是场馆网页前端自带的公开常量。

### App 的请求签名

令牌第 4 段是 base64 的 `[4 字节长度 BE][16 字节 IV][32 字节密文]`（总长必须是 52，
首 4 字节必须等于总长），用 AES-256-CBC（`setAutoPadding(false)`）解出 32 字节材料；
签名 = `sha256(材料 + 规范化路径与查询 + 8 字节毫秒 BE + 反序材料)` 的 hex，
再在偏移 `12/28/36/38/58` 处插入 `"199st"` 五个字符（结果 69 个字符）。

`timestamp` 头不是当前时间，而是把毫秒时间戳过一遍 splitmix64 得到的数（上游算法）。

### 「时间」全部是北京时间

平台给的是不带时区的本地串（`2026-11-12 09:00:00`）。任何 `Date.parse` 都显式加
`+08:00`，否则在别的时区跑出来的时间会整体平移。

## 能力（7 个只读方法）

| 方法 | 作用 | 需要登录 |
| --- | --- | --- |
| `venues({ sport?, campus?, venue?, date?, time? })` | 场馆目录；筛选唯一时查那天的空场 | 目录需要 |
| `slots({ venueSiteId, date? })` | 指定场馆某天的原始时段表 | 需要 |
| `notice()` | 预约须知全文 + 各场馆放号时刻 | **不需要**（匿名可读） |
| `orders({ date?, venue? })` | 本人场馆预约订单 | 需要 |
| `attendance({ course? })` | 体育课历史考勤（体艺 App 面） | 需要 |
| `session()` | 体艺 App 会话状态（**会联网**） | 需要 |
| `identity()` | 场馆平台上的本人信息 | 需要 |

`venues()` 的状态机（照上游 `listVenues`）：

| status | 含义 |
| --- | --- |
| `catalog` | 没指定或命中多个场馆，只列目录 |
| `needs-time` | 该时刻没有这个时段，`alternatives` 给相邻 3 个 |
| `not-released` | 那天还没放号；能算出来就给 `releaseAt` |
| `available` / `unavailable` | 有空场 / 已开放但没有符合条件 |

## 宁可报错也不猜

- **`parseDay` 缺目标日期或字段不完整** → `SHAPE`。返回空 `slots` 会被读成
  「约满了」，那是**替平台下了一个它没说过的结论**。
- **`catalog` 一个可预约场地都没有** → `SHAPE`，不当成「今天没有任何场地」。
- **`readOrders` 分页信息缺失**（既无 `last` 也无 `totalPages`）→ `SHAPE`。
  「本人订单里没有这一笔」与「下一页还有」是完全不同的结论。
- **`releaseTime` 只有在所有命中规则的时刻唯一时才回答**。两条规则给两个不同
  时刻时不猜 —— 放号时刻猜错的代价是白等一小时。
- **`targetDate` 不会自动换日期**：超出「今天至三天后」就抛 `CONFIG`。
- **`parseTokens` 校验 JWT 的 `sub` 等于本次要读的账号**，对不上抛 `AUTH_EXPIRED`。
  上游注释写明「Login identity comes from JWT sub. Attendance row uid is not an
  account check.」—— 不校验就会把别人的考勤读给现在的人。
- **`history` 不用 `lack` 算缺勤**。上游注释：`lack` 把还没上的课也算进去
  （2026-09 学期：应到 16、已上 3 次却报缺 13）。到勤次数只用 `detail` 里已发生的
  课次自己数。

## 写操作去哪了

按 D17，**写操作的注册与审批归 `packages/tool/`**，实现留在本包（它需要本包的签名、
令牌与时段查询）。上游 `tyys/booking.ts` 里的写动作：

| 上游方法 | 平台接口 | 现在在哪 |
| --- | --- | --- |
| `bookVenue`（预约提交） | `POST /api/reservation/order/submit` | `packages/tool/campus-write` 的 `campus_activity` → 本包 `bookVenuePrepare` / `bookVenueExecute` |
| `cancelVenue`（取消预约） | `POST /api/venue/finances/order/cancel` | 同上 → `cancelVenuePrepare` / `cancelVenueExecute` |
| `payAndVerify`（付款 / 零元确认） | `POST /api/venue/finances/order/pay` | **尚未实现** |
| `captcha`（点字验证码，预约流程的一部分） | `GET /api/captcha/get`、`POST /api/captcha/check` | **已实现**（`src/captcha.js`）；识别用的模型调用由调用方注入 |
| `companionParams`（同伴码） | `POST /api/vip/view/buddy_no`、`POST /api/vip/check/buddy_no` | **尚未实现**，记 `coverage-gaps.md` 的 W-7 |

写路径走 `VenueClient.submit()`，**不经过**只读闸：只读入口 `request()` 仍然把
上表三个写接口列在 `FORBIDDEN_WRITES` 里直接拒绝，那条防线没被拆掉。

> ⚠️ 这段早先写的是「本包不含任何写代码，而且是硬拦」。前半不实（写方法早已实现），
> 而后半藏着一个死链：`writes.js` 当时调的是 `client.request()`，于是
> **预约与取消这两个动作在任何情况下都被本包自己的闸挡死**，报的还是
> 「本数据源不提供」—— 看起来像分层设计，实际审批通过后必然失败。
> 已记 `coverage-gaps.md` 的 X-3，并补了两条「执行路径真的发得出请求」的回归测试。

写操作在上游都过写闸（`--confirm` + `ZJU_ALLOW_WRITE`），本仓对应的是
`tool/campus-write` 的逐次审批（`ctx.approval`，只有 `allowed-once` 放行）；
「写请求只发一次、之后用本人订单回查」这条，回查在 `Prepare` 里做（`cancelVenue`
先核对订单存在）。

## 验证码识别：代码实现了，但**这与一条更严的约束冲突，待裁决**

> ⚠️ 这一节早先的标题是「**明确丢弃：验证码识别**」，正文断言 `tyys/captcha.ts` 的
> 全部导出「一个都没有对应物」。**后半是事实错误**：`src/captcha.js` 有 9 个导出
> （`CAPTCHA_SCALE`、`ASK_TIMEOUT_MS`、`decodePng`、`encodePng`、`enlargePng`、
> `glyphsIn`、`locate`、`promptOf`、`CaptchaSolver`），`writes.js` 的预约流程真的会调它。
>
> 但把标题改成「已实现」也是错的 —— 那等于替用户撤销一条更强的约束。现状是
> **代码与政策不一致**，两天平都指不出哪边该让步，所以要单独记，不能就地结案。

上游 `tyys/captcha.ts` 是**用多模态模型识别点字验证码**：把图片放大 3 倍交给模型，
让模型认出图里每个汉字并给出中心坐标，再按题目顺序点出来。

### 事实：本仓实现了什么

| 部分 | 在哪 |
| --- | --- |
| PNG 编解码、放大、坐标换算、题面拼装 | `src/captcha.js` |
| 问模型 | `CaptchaSolver` 的 `ask` 回调，**由调用方注入** |
| 什么时候要过验证码 | `preview().captchaRequired`；`bookVenuePrepare` 遇到它才启动识别 |

没注入 `ask` 时 `CaptchaSolver.start()` 报 `DEPENDENCY_MISSING` 并说清要注入什么，
不假装提交、不编坐标。

### 冲突：另一处写着「不绕过人机校验」

同一批文档里，`cnki` 滑块求解器被判为**硬约束不做**（「不绕过人机校验」，
见 `abandoned.md` 的 N-2；`cnki/src/` 里确实没有 slider 求解器）。
tyys 的点字验证码与 cnki 的滑块拼图在性质上是同一类东西 —— 站点用来区分人机的门槛。

**所以这是个必须由用户裁定的问题，不是我能就地解掉的**：

- 若「不绕过人机校验」是全局硬约束 → `captcha.js` 与 `writes.js` 的那段要**删掉**，
  `captchaRequired` 的场地如实报「需要人工验证码，本仓不代做」，并记进遗弃记录；
- 若只有 cnki 那个滑块属于红线（理由可能是它破解的是拼图算式，而点字只是「看图选字」）
  → 现状保留，但要在这里写清理由，并在 `abandoned.md` 的 N-2 旁边补一句边界说明。

**在裁定之前不要依据 `captcha.js` 承诺「自动过验证码」** —— 它是否该存在本身还没定。

### 顺带查出的死链（无论上面怎么裁定都要修）

`writes.js:141` 取题时调的是 `client.request('POST', '/api/reservation/captcha/check')`，
而只读入口的 `READ_POSTS` 只有 `/api/reservation/order/info` —— 这个 POST 会被
`request_` 的「不支持对这个接口用 POST」直接拒掉。也就是说：**需要验证码的场地，
连取题这一步都过不去**。上表写的是「理论路径」，实测走不通。
已记 `coverage-gaps.md` 的 X-4。

## 登录与会话

凭据由集成层注入，本包不知道凭据从哪来，也不走 CAS：

```js
const tyys = ctx.get('zhiyunTyys')
tyys.setAccountProvider(async () => '3230100000')
tyys.setLoginProvider(async ({ service }) => {
  // service 是 VENUE_LOGIN_SERVICE 或 APP_LOGIN_SERVICE
  // 走一遍 CAS service 委托，返回：
  //   场馆平台要 { url }  —— 回跳后的最终地址（里面有 oauth_token）
  //   体艺 App 要 { body } —— 回跳后页面的正文（里面有 jwtToken）
})
await tyys.attendance({})
```

没注入账号时抛 `CONFIG`，文案指向「设置 → 浙大一卡通」，不静默返回空数据。
没注入登录回调时，`notice()`（匿名）仍可用，其余方法在登录那一步抛 `CONFIG`。

令牌与目录/须知缓存**只在进程内**，不落盘。换账号会重建客户端
（`ensureAccount` 比对账号），避免把上一个人的考勤/订单读给现在的人。

## 超时

`REQUEST_TIMEOUT_MS = 10_000`。

依据：上游没给这两个站单独设超时，它走 `openContext` 里 `HttpClient` 的默认值
`timeout: opts.timeout ?? 10000`（`webvpn/transport.ts:79`）。

⚠️ 本仓的 `sharedFetch` / `egress` **不读 `timeoutMs`**，所以在 `init` 里写它是假参数。
本包自己用 `Promise.race` + 定时器实现（`withTimeout`），并**同时**传 `signal` ——
只传 signal 不够，因为 `request` 是调用方注入的，它未必监听 signal。

## 没有设置分区

`auth: cas` 但凭据由集成层注入，本包无用户可配置项 → 进
`tests/source-settings.test.mjs` 的 `NO_SETTINGS` 白名单。

## 已知限制

- **没有用真实账号跑通任何接口。** 所有响应形状来自上游注释与实现
  （`venue.ts` / `client.ts` / `rollcall.ts` 的字段名与判据），测试全部用**合成夹具**，
  夹具按上游注释推断，**未经真实响应验证**。
- **`releaseTimes` 的解析规则照抄上游正则**，它依赖须知里的写法（校区名 + 破折号 +
  「每天 HH:mm」）。须知改文案时它会解析出空数组 —— 那时 `releaseAt` 返回
  `undefined`，结果里明说「放号时刻暂时算不出来」，不编一个时间。
- **`parseNotice` 里 `、` 的拆分口径**（「紫金港、玉泉体育馆-每天 20:00」拆成
  「紫金港」与「玉泉体育馆」两条）是上游的行为，语义上略怪，但**照抄不改进** ——
  改进会让 `releaseTime` 的匹配结果与上游不一致，而我们没有真实须知来验证哪种更对。
- **`preview()` 的真实用途只是告诉用户「要不要验证码 / 电话有没有登记 / 同伴人数」**。
  它不创建订单，但它是 POST —— 若平台哪天把它改成有副作用，本包不会察觉。
  **未验证**：这个接口是否真的幂等。
- **场馆目录的树遍历**用「有 `siteName` 与 `id` 的节点才是场地，否则递归所有字段」
  这套启发式（照上游）。平台若新增一层既有 `siteName` 又是容器的节点，会被当成场地。
  **未验证**。
- **`VenueClient` 的令牌有效期用了上游的 4 小时**（`4h - 30s`），没有考虑平台可能
  提前作废；提前作废时靠 401 → 重登一次兜住。
- **`history` 的日期对应用 `teachingWeek → date`**，`course_times` 里没有的周次
  给 `date: ''`（不猜日期）。真实数据里缺日期有多常见，**未验证**。
- **同伴（buddy）与验证码相关的只读信息只覆盖到「要不要」这一层**：本包不读同伴列表、
  不取同伴码，那两条接口留给写包。
