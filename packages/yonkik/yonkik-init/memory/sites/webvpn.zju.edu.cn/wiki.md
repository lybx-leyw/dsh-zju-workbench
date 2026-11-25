# WebVPN（webvpn.zju.edu.cn）

> **本页索引**：这是什么 · 能力 · URL 重写规则（核心） · 坑 · 只读边界 · 未闭环

**状态**：done（2026-11-22）｜**鉴权**：深信服本地认证（`webvpn` 上网账号）｜**限流**：1.5s/串行
**脚本**：`login.mjs`（登录） · `crawler.mjs`（get / encode / decode / health）

---

## 这是什么

浙大 WebVPN，**深信服（Sangfor）WEngine** 实现。作用是把「仅校内 IP 可访问」的站，
经 `webvpn.zju.edu.cn` 代理出去——**不需要装 VPN 客户端**，纯 URL 重写。

**这是本库补上的最大基础设施缺口。** 在此之前，`zju-notices` 那批站里有 15 个
`*.office.zju.edu.cn` 内网子站全是 502 不可达；现在全部能读。

## 能力

```bash
node sites/webvpn.zju.edu.cn/login.mjs                    # CAS 登录（约 10 秒）
node sites/webvpn.zju.edu.cn/crawler.mjs health           # 自检（含一个内网站探针）
node sites/webvpn.zju.edu.cn/crawler.mjs get http://ygb.zju.edu.cn/31555/list.htm
node sites/webvpn.zju.edu.cn/crawler.mjs encode zdbk.zju.edu.cn   # 看编码结果
node sites/webvpn.zju.edu.cn/crawler.mjs decode <编码串>           # 反解
```

**实测穿透（2026-11-22，全部直连 502 的站）**：

| 目标 | 结果 |
|---|---|
| `ygb.zju.edu.cn/31555/list.htm`（研工部） | 200 / 15,301B「通知公告」 |
| `ai.office.zju.edu.cn/nbgs/list.htm`（人工智能学院） | 200 / 115,410B「内部公示」 |
| `bmsoa.zju.edu.cn/85937/list.htm`（基础医学系） | 200 / 15,871B「内部公示」 |
| `www.cls.office.zju.edu.cn/25820/list.htm`（生命科学） | 200 / 50,711B「最新通知」 |
| `office.chem.zju.edu.cn/34507/list.htm`（化学系） | 200 / 44,117B「信息公告」 |
| `doe-oa.zju.edu.cn/75536/list.htm`（能源工程） | 200 / 44,734B「学工」 |

## URL 重写规则（本页核心）

深信服的规则是**公开且固定的**，不需要逆向：

```
https://webvpn.zju.edu.cn/<scheme><-port>/<enc(host)><path><sep>vpn-12-o2-<host>

enc(host) = hex("wrdvpnisthebest!") + hex(AES-128-CFB(host, key=iv="wrdvpnisthebest!"))
```

细则：

- **默认端口 443/80 不写**。只有非默认端口才写成 `https-8443` 这种**后缀**形式。
- `sep` 是 `?` 或 `&`（原 URL 已有 query 时用 `&`）。
- 加密 key 与 IV **都是** `wrdvpnisthebest!`（16 字节，正好 AES-128）。
- 头部 32 位 hex 是 IV 本身，后面才是密文——所以 `decode` 时先剥前缀。

### 我踩的坑（值得记）

第一版把端口写成独立段：`/https/443/<enc>/`。结果服务器返回

```
错误代码：HOST_NOT_FOUND
错误信息：无法解析请求 Host: 443
```

它把 `443` 当成了主机名。**这个错误信息很直白，但只有把 302 跟到底才看得到**——
表面上是 302 → `/wengine-vpn/failed` → 200「访问出错」，很容易误判成「登录态没拿到」。

判据：看到 `HOST_NOT_FOUND` + `Host: <数字或奇怪串>` 就是 URL 结构错了，不是权限问题。

## 坑

1. **未登录时是 302 到 `/login`，不是 401**。所以判「要不要登录」看 302 目标。
2. **站点自身的 302 会被 WebVPN 包一层**。跟随时要区分「VPN 层的重定向」和「目标站的重定向」。
3. **`zdbk` 经 WebVPN 只有 68B**（跳转壳），说明有的站不适合走 VPN 代理（它本来公网可达，绕一层反而坏）。
   **判据：公网可达的站不要走 WebVPN**。
4. **验证码**：登录页有 `captcha` / `needCaptcha` / `captcha_id` 字段，但当前 `needCaptcha` 为空（未强制）。
   若将来要验证码，会走 `zjuam` 那套（`getKaptchaStatus` 先探）。
5. **票据 cookie 名**：`wengine_vpn_ticketwebvpn_zju_edu_cn`。缺它一定拿不到内容。

## 只读边界

`get` 只发 GET。不提供上传、提交、修改。

## 未闭环

- **POST 穿透**：只做了 GET。业务系统的写操作（选课、提交）走 WebVPN 需要额外处理 body 与 content-type。
- **WebSocket 穿透**：智云直播那类长连接未试。
- **票据有效期**：未测。`health` 会提示 `needLogin`，过期重跑 `login.mjs`。
- **响应内 URL 重写**：目标站页面里的相对链接仍是原始形式，若要做「经 VPN 的站内爬取」需要再实现 `unwrap/rewrap`（`crawler.mjs` 已有 `decode` 可反解主机）。

## 凭据：这是「上网账号」，不是统一身份认证

**本节是本页最重要的一节，也是一次真实误判的记录。**

WebVPN 登录页的 `auth_type` 隐藏字段**默认值是 `local`**，即深信服本地上网账号。
页面文案明写「**上网账号登录**」。虽然同页还挂了 `cas` / `oidc` / `escience` /
`dingding` / `auth_sms` 多种认证入口，但**默认不是 CAS**。

所以：

| 凭据键 | 是否适用 |
|---|---|
| `webvpn`（描述：「WebVPN 上网账号」） | ✅ **正确** |
| `campus-sso`（浙大一卡通 CASC） | ❌ 不适用 |

**踩坑经过**：`login.mjs` 第一版写死 `loadCredentials('campus-sso')`，而它**登录成功了**——
因为当时两个键对应的凭据恰好都能登录成功（纯属巧合）。于是错误结论被「成功」掩盖，差点固化成资产前提。

**教训：登录成功不能反推「用对了凭据」。** 正确判据是站点的 `auth_type` 声明，
不是「哪个键能登进去」。现在的 `login.mjs` 按 `webvpn` → 回退 `campus-sso` 的顺序解析，
**回退时打印显式告警**，让「用错凭据」在日志里可见。

> 若登录失败且日志显示回退到 campus-sso：去「设置 → YONKIK 侦察凭据」加一个键名 `webvpn` 的凭据。
