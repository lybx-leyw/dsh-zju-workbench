# MyVPN 网费自助服务 myvpn.zju.edu.cn

## 本页索引

<!-- yonkik:toc -->
> 按节读：grep -n "^## <标题>" wiki.md 取行号。

- 结论速览
- 入口与鉴权
- 接口（全部已验证）
- 公开通知区（免登录）
- 证书链坑（TLS 诊断，重点）
- 与 RVPN 的关系
- 坑
- 未探候选
- 一证多站

---
**状态：done（2026-11-20 只读探索）** —— 公开区 + 登录表单形态 + TLS 诊断已闭环；**网费账单/流量查询 blocked**（缺「网络账号密码」凭据）。

系统身份：浙江大学 **MyVPN 自助服务**（网费管理 / RVPN 账号自助），Yii2 PHP，nginx。

## 结论速览

1. **登录用「网络账号」，不是学号/一卡通密码**——凭据键 `campus-sso` 只能用来「激活账号」（走 CAS OAuth2 开号），不能直接登录。这是网费查询做不下去的真正原因。
2. **`UNABLE_TO_VERIFY_LEAF_SIGNATURE` 是偶发，证书链本身完整**（4 级链；102 次探测里仅 2 次偶发，其余全通过）。**不要因此降级 `rejectUnauthorized:false`**。
3. **通知页免登录可读**：`/news/view?id=N`。
4. 有短信登录、人脸实名校验（`/site/complete-process`，公安人脸比对）。

## 入口与鉴权
- 首页 `GET /` → 18284B，title=「登录」。
- 登录表单（Yii2 ActiveForm）：
  - `form#login-form` action=`/` method=post，字段 `LoginForm[username]` / `LoginForm[password]` / `LoginForm[verifyCode]`
  - 验证码图 `/site/captcha?v=<hash>`（`yii.captcha.js` 点击刷新）
  - 隐藏 CSRF：name=`_csrf-8800`（值每次会话不同）
  - 另有 `form#phone-form`：`LoginForm[phoneCode]` 走短信验证码登录
  - 前端加密脚本：`/js/crypto-js.min.js` + `/js/base64.js`（密码不是明文提交）
- **开号入口**：`/zju/new-account-sso` → 302 CAS OAuth2
  `zjuam.zju.edu.cn/cas/oauth2.0/authorize?response_type=code&client_id=GgZvGNbUEHnw9qCPLv&redirect_uri=https://myvpn.zju.edu.cn/zju/new-account-sso`
  → 即「激活账号」按钮。新生第一次用必须走这里。
- 登出：`zjuam.zju.edu.cn/cas/logout?service=https://myvpn.zju.edu.cn`

## 接口（全部已验证）
| 接口 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `/` | GET | 登录页（含 2 条通知入口） | 免登录 |
| `/robots.txt` | GET | 404（Yii2 错误页） | — |
| `/zju/new-account-sso` | GET | 302 → CAS OAuth2 开号 | 免登录 |
| `/news/view?id={n}` | GET | 通知正文 | 免登录 |
| `/site/complete-process` | GET | 身份验证页（上传正脸照片做公安人脸校验） | 免登录（提交需登录） |

## 公开通知区（免登录）
`/news/view?id=N`，实测有内容的两条：
- **id=2「自助服务修改个人基础信息指南」**（2025-03-20，42KB）——含四种「原手机号/邮箱有误」组合的完整改绑流程：
  - 原手机号有误、邮件正确 → 填新手机号 + 邮箱验证码
  - 手机号和邮件都有误 → 先点「原手机号无效，请点击修改」→ 身份证号校验或「其他证件号验证」（护照号+姓名，无需上传照片）→ 再改
  - 邮件有误、手机正确 → 改邮件 + 短信验证码
  - 各校区服务窗口：紫金港行政服务办事大厅 115 室 19 号窗口（88981611）、玉泉图书馆 702 室（87951762）、华家池纳米行政大楼 103 室（86971518）、西溪西六教学楼 333 室（88273001），含各自办公时间
- **id=6「信息技术中心关于2026年经费卡转账截止时间的通知」**（2026-11-17）——标题有，正文为空。

这是本站最有复用价值的部分：改手机号/改邮箱是网费账号最常见的卡点，流程原文比问客服快。

## 证书链坑（TLS 诊断，重点）

### 症状
首轮探针 `GET https://myvpn.zju.edu.cn/` 返回 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`，同一轮 `/robots.txt`（同域同 IP）却正常 404。
后续爬虫端到端跑时又复现了一次（`crawler.mjs login-form` 首次运行报同一错误，立即重跑即 200）。

Node 完整报错原文：
```
Error: unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca
  code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
  at TLSSocket.onConnectSecure (node:_tls_wrap:1631:34)
```

### 实际证书链（服务端下发的，4 级完整）
```
[0] CN=*.zju.edu.cn                ← issuer CN=TrustAsia OV TLS RSA CA 2024   (2026-02-27 ~ 2027-03-27)
[1] CN=TrustAsia OV TLS RSA CA 2024 ← issuer CN=TrustAsia TLS RSA Root CA     (2024-05-15 ~ 2034-05-15)
[2] CN=TrustAsia TLS RSA Root CA    ← issuer CN=Certum Trusted Network CA     (2025-10-07 ~ 2029-01-14)
[3] CN=Certum Trusted Network CA    ← self-signed                               (2008-10-22 ~ 2029-12-31)
```
协议 TLSv1.2，SNI 生效。DNS 只有单个 A 记录 `10.203.8.130`（内网）——不存在「多后端 IP 有的少下发中间证书」这种情况。

### 复测统计（102 次探测，2 次失败）
| 测法 | 次数 | 结果 |
|---|---|---|
| `tls.connect({servername, rejectUnauthorized:true, maxCachedSessions:0})` | 8 | 8/8 authorized:true, chainLen=4 |
| 同上高频样本（150ms 间隔） | 30 | 30/30 ok |
| 同上密集样本（120ms 间隔） | 40 | 40/40 ok |
| 按 IP 定点握手（300ms 间隔） | 6 | 6/6 ok |
| `https.request` 4 种写法（URL+headers / URL+servername / {host,port,path,servername} / 无 servername） | 4 | 4/4 200 |
| 复刻 `lib/http.mjs` rawRequest 选项 | 12 | 12/12 200 |
| 首轮探针 + 爬虫端到端 | 2 | 2 次均失败 |
| 合计 | 102 | 100 通过 / 2 次 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`（约 2%） |

### 判定与规避写法
- 证书链没缺（叶证书已带全中间证书到根），不是站点配置错误。
- 该错误是偶发/瞬时——发生率约 2%（2/102）。两次都出现在该进程对本站的第一条请求上，重试立刻恢复。最可能的原因：首次 TLS 握手时（无 session ticket 复用）服务端在某次握手中少下发中间证书，或本地 CA store 在该连接上未命中 `TrustAsia TLS RSA Root CA → Certum Trusted Network CA` 这段交叉签发路径。
- 规避写法（推荐）：
  ```js
  https.request(url, {
    servername: url.hostname,                 // 显式 SNI
    agent: new https.Agent({ keepAlive: false }),
  })
  ```
  同一请求重试一次即恢复（实测两次都如此）。
- 兜底选项（仅当需要长期稳定跑批）：`node --use-system-ca`（Node 22+，用系统 CA store，通常能补上 Certum 交叉签名路径）。
- 不要图省事写 `rejectUnauthorized: false`：本站证书有效，降级只会掩盖真实的中间人风险。
- 判「是不是真故障」的口诀：跑 5 次 `tls.connect` 严格校验。≥1 次 authorized:true 就是偶发；5 次全 false 且 `authorizationError` 稳定复现，才是真缺链。

## 与 RVPN 的关系
- 本站是网费/账号自助（MyVPN 门户）；RVPN 是校外接入隧道（EasyConnect 客户端）。
- CC98 4863123（2019）说「easyconnect 登 RVPN 后能访问 CC98、图书馆，但访问不了现代教务/综合服务」——那不是 RVPN 的限制：回复指出「教务网不需要内网」「大概是校内也访问不了」，即那些站当时本身不可用。别把「某站打不开」记成「RVPN 封了它」。
- 网费充值的真实约束（CC98 6564319，社区口径，未经本机验证）：
  - 「浙大校园卡」APP 可充网费，APP 下载地址 `https://itc.zju.edu.cn/49401/list.htm`
  - 提交「电子离校单」后不能再充网费
  - 服务时间有窗口限制
  - 限额说法冲突（「120 元上限」vs「已不限额度」），无定论

## 坑
1. 账号体系是「网络账号」，不是学号密码。这是本站最容易被误判的一条——用 campus-sso 去 POST `LoginForm[username]/[password]` 一定失败。开号走 `/zju/new-account-sso`（CAS）。
2. `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 不要当真故障：实测 102 次请求仅 2 次偶发，证书链完整。重试即可，别降级 TLS 校验。
3. `/robots.txt` 是 404（Yii2 错误页 2789B），不是站点故障。
4. CSRF 字段名是 `_csrf-8800`（Yii2 自动生成的带后缀名），每次会话不同，硬编码会失败。
5. 密码前端加密（crypto-js + base64.js），不能明文 POST。要自动化登录必须用浏览器。
6. `/site/complete-process` 要求上传正脸照片做公安人脸校验——属身份验证区，任何自动化都不该碰。
7. 通知正文 id=6 是空正文：只有标题没有内容，不是抓取失败。
8. `/site/complete-process`、`/news/view` 的 `<title>` 是空字符串，`grep <title>` 会误以为页面坏了。
9. `crawler.mjs` 首次运行可能撞上那条偶发 TLS 错误，直接重跑一次（这是设计如此，不是脚本 bug）。

## 未探候选
- 网费余额/账单/流量只读查询（blocked）——需「网络账号密码」这一凭据；登录后「个人信息管理」区。
- 短信登录（`LoginForm[phoneCode]`）流程。
- RVPN 客户端（EasyConnect）分发地址与配置。
- `/site/captcha` 的验证码强度（若将来要自动化登录）。

## 一证多站
`/zju/new-account-sso` 的 CAS OAuth2（client_id `GgZvGNbUEHnw9qCPLv`）用 `campus-sso`。但日常登录用网络账号，两者不是一回事。
