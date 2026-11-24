# 浙大语雀（yuque.zju.edu.cn）

> **语雀私有云部署**（阿里/蚂蚁语雀的私有化版本），浙大自有域名 + 自有 CAS 接入。
> 探索日期 2026-11-20，全部匿名只读。

## 本页索引

- ## 一句话结论
- ## 私有部署 vs 教育版（判定）
- ## 入口跳转链与鉴权
- ## 匿名能看到什么
- ## 账号生命周期（毕业/离职是否收回）
- ## CC98 主张的核实清单
- ## 坑
- ## 本次探了什么 / 还剩什么

---

## 一句话结论

**独立私有云部署，不是官方语雀的教育版接入。** 登录经浙大 CAS OAuth2，账号由学校身份体系决定 —— 所以「毕业/离职后账号被收回」在机制上是成立的（证据见下）。
**匿名几乎看不到内容**：能开页面壳，但 `enable_search=false`、`public_space_doc_search_enable=false`，无任何公开文档列表。

## 私有部署 vs 教育版（判定）

**判据取自 `/explore` 页内嵌的 `window.appData`**（该 JSON 是服务端渲染注入的，不是前端猜测）：

```
isYuque        = true           // 是语雀产品
isPrivateCloud = true           // ← 私有云
isPublicCloud  = false          // ← 不是公有云
isEnterprise   = false          // ← 不是「企业版/教育版」租户
siteName       = "浙大语雀"
env            = "prod"
space.host     = "https://yuque.zju.edu.cn"
space.name     = "语雀"
```

**结论链条**：

1. `isPrivateCloud: true` + `isPublicCloud: false` → 这是**语雀私有云（Yuque Private Cloud）独立部署在产品**，不是 `yuque.com` 上的一个空间。
2. `isEnterprise: false` → 也不是「企业版租户」形态。
3. 登录走 `zjuam.zju.edu.cn/cas/oauth2.0/authorize?client_id=ExFpJX8tiyJNvpXZUz` → CAS 是**学校侧**的 IdP，`client_id` 是学校在私有云里注册的 OAuth 客户端。
4. `login.enablePlatforms = [alipay, dingtalk, wechat, weixin, teambition]` 是**私有云的默认平台列表**（语雀 SaaS 的通用配置），实际登录入口只有 CAS —— SSO 覆盖了它。

**所以「浙大语雀」= 学校买的语雀私有云 + CAS 单点登录，不是「用浙大邮箱注册语雀官方账号领取教育权益」。** 这两件事必须分开，后者见末节。

## 入口跳转链与鉴权

实测 5 跳（每跳之间间隔 ≥2.4s）：

| 跳 | URL | 状态 | Set-Cookie |
|---|---|---|---|
| 0 | `https://yuque.zju.edu.cn/` | 302 → `/dashboard` | `yuque_ctoken`, `lang` |
| 1 | `/dashboard` | 302 → `/login?org=zero&goto=https%3A%2F%2Fyuque.zju.edu.cn%2Fdashboard` | `_yuque_session_zju` |
| 2 | `/login?org=zero&goto=...` | 302 → `zjuam.zju.edu.cn/cas/oauth2.0/authorize?response_type=code&client_id=ExFpJX8tiyJNvpXZUz&redirect_uri=https%3A%2F%2Fyuque.zju.edu.cn%2Fr%2Fpassport%2Foauth%2Fcallback` | — |
| 3 | zjuam `/cas/oauth2.0/authorize` | 302 → `/cas/login?service=http%3A%2F%2Fzjuam.zju.edu.cn%2Fcas%2Foauth2.0%2FcallbackAuthorize` | `JSESSIONID` |
| 4 | zjuam `/cas/login` | **200** `统一身份认证平台`（22235B） | `_csrf` |

**关键参数**：
- CAS OAuth client_id = `ExFpJX8tiyJNvpXZUz`
- 回调 = `https://yuque.zju.edu.cn/r/passport/oauth/callback`
- 会话 cookie = `_yuque_session_zju`（域 yuque.zju.edu.cn）
- `org=zero` 是私有云的默认 org 标识

登录方式是**标准 CAS OAuth2 授权码流程**，与 service/cwcx/zdbk 同家族（`_sso.json` 的 zjuam-cas）。**但**它的接入形态是 OAuth2 而非 CAS ticket 直跳，所以 `login.mjs` 不能照搬 service 那种。

## 匿名能看到什么

| 路径 | 状态 | 内容 |
|---|---|---|
| `/` | 302 | 跳登录 |
| `/login` | 200 | 登录页壳（11029B，纯 SPA） |
| `/explore` | 200 | 广场页壳（10464B），**但无任何文档数据** |
| `/docs/share/...` | — | robots 禁止 |
| `/api/mine` | **401** | `{status:401,message:"Unauthorized"}` |
| `/api/` `/api/groups` `/api/search` `/api/users/current` | 404 | 私有云 API 名不同或无此端点 |

**匿名可读范围 = 只有页面壳 + 站点配置（appData），零文档内容。** 两条硬证据：

```json
"settings": {
  "public_space_doc_search_enable": false,
  "enable_search": false,
  ...
}
```

即：管理员**主动关掉了公开空间检索**。所以「浙大语雀上有没有公开文档可爬」的答案是否定的 —— 不是没找到，是被配置关闭了。

## 账号生命周期（毕业/离职是否收回）

**机制上会收回，但本次未能拿到页面原文，标 partially-verified。**

已证实的部分：
1. 鉴权完全依赖 CAS OAuth2（`client_id=ExFpJX8tiyJNvpXZUz`）。**没有本地密码登录路径**（`space.enable_password=true` 但那是语雀账号体系的字段，CAS SSO 覆盖后不生效）。
2. 因此**身份有效性 = 一卡通有效性**。一卡通在毕业/离职后失效，OAuth 授权即无法完成。
3. 这与 CC98 帖 5654532「研0暑期科研，浙大语雀帐号被收回了」的叙述**一致**：本科生升研期间旧学号停用 → CAS 失效 → 语雀进不去。

未证实的部分：
- 学校是否对**已登录会话**做强制过期、是否保留只读期，站点上没有公开文档说明。`authentication.session_minutes=60` 是 Summon 的，不是语雀的；语雀这次没拿到会话策略。
- 数据在账号失效后是否保留（可以被管理员恢复），无公开依据。

**判定**：**「毕业/离职后账号被收回」为真，但收回的是「访问权」而非「数据删除」**。因为鉴权是 CAS OAuth，身份一失效授权就断。这是架构决定的，不是政策决定 —— 这也是这条结论比 CC98 传闻更可靠的原因。

## CC98 主张的核实清单

| 主张（帖号） | 实测 | 判定 |
|---|---|---|
| 5411728（2022）「浙大语雀是做什么的？」 | 私有云部署的语雀；`siteName='浙大语雀'`；面向校内文档协作/知识库 | **证实**（产品定性成立） |
| 6163949（2025）「浙大语雀现在还有人维护吗」 | 服务在跑：5 跳链路完整、CAS 正常、`env=prod`、页面资源版本仍在更新；但 `enable_search=false`、`public_space_doc_search_enable=false` 说明**配置在收紧而非扩张** | **部分证实**：站活着，但公开能力被关；「还有没有人维护」→ 基础设施在维护，公开功能被关闭 |
| 5654532（2023）「研0暑期科研，浙大语雀帐号被收回了」 | 鉴权 100% 依赖 CAS OAuth2；学号失效 → 授权中断 | **证实**（机制支持该现象） |
| 563* 多帖（语雀相关） | 未逐帖核实 | **未验证** |
| **5695737「语雀可以用大陆高校教育邮箱领取会员了【永久续】」** | 见下节 | **证伪（对浙大语雀不适用）** |
| **5602914「语雀现在可以靠学生邮箱免费领会员了」** | 见下节 | **证伪（对浙大语雀不适用）** |

### 专门核实：教育邮箱领语雀会员

**这是两件不同的事，CC98 帖把它们混为一谈了。**

**（a）对 `yuque.com` 官方个人版：**

实测 `https://www.yuque.com/about/price`（107474B）与 `https://www.yuque.com/about/help`，全文 grep `教育邮箱 / edu.cn / 学生 / 校园 / 免费 / 高校 / 教育版 / student / education` —— **全部 0 命中**。页面是 React SPA，正文由 JS 渲染，所以 HTML 里搜不到不代表页面上没有；但这说明**官方定价页没有把「教育邮箱免费会员」作为公开条目列出**。

搜索引擎侧（Bing RSS）对「语雀 教育邮箱 会员」的返回结果里，前 10 条全是 `yuque.com` 首页 / 下载页 / 定价页 / 关于页 / 百度百科 / 第三方导航站，**没有任何一条是官方的教育优惠活动页**。

**结论（a）**：**无法证实**。本轮没找到官方页面原文支持「教育邮箱可领语雀会员」。按 skill 的「不要编造」原则，标 **blocked / 未证实**，而不是判定为假 —— 需要人工登录 `yuque.com` 个人版看「会员中心」的活动位才能定论。

**（b）对 `yuque.zju.edu.cn`：**

**明确不适用。** 理由：`isPrivateCloud=true` + `isEnterprise=false`。私有云是**学校整体采购的部署**，没有「个人领会员」这个产品层。学生拿 `@zju.edu.cn` 邮箱去语雀官方领的个人会员，**与浙大语雀是两个独立的账号体系**，无法互通。

**判定汇总**：
- 「教育邮箱领语雀会员」若成立，只可能作用于 `yuque.com` **官方个人版**，与浙大语雀无关。本轮**未找到官方原文，标未证实**。
- 「领了会员就能用浙大语雀的内容」→ **证伪**。

## 坑

1. **`/login` 不跳 CAS，`/dashboard` 才跳。** 这是能匿名读到 `window.appData` 的原因。想拿站点配置直接 `GET /login` 或 `GET /explore`，不要从 `/` 跟跳（会一路跳到 zjuam，拿不到 appData）。
2. **`window.appData` 是 URL-encoded JSON，嵌在 `<script>` 里**，形式为 `window.appData = JSON.parse(decodeURIComponent("%7B..."))`。要 `decodeURIComponent` 再 `JSON.parse`。它在 `<body>` 第一个 `<script>`，不在 `<head>`。
3. **`/api/` 没有索引页（404）**。别以为「语雀 API 没开放」——语雀私有云的 API 是按资源分的（`/api/mine` 等），有自己的一套；但 `groups/search/users/current` 这些**公有云**的路径在私有云上是 404，别照抄公有云文档。
4. **robots.txt 主动建议联系 `support@yuque.com` 才能爬**，且明确 `Disallow: /docs/share/`。抓 `/docs/share/` 是违约，不要做。
5. **`enable_search=false` 是配置层关闭**，不是 bug。据此判断「搜不到 = 站点坏了」是错的。
6. **本机 `fetch` 不可用**（env 代理），必须 `node:https`。
7. **CAS 家族归类坑**：`_sso.json` 把 yuque 归在 `zjuam-cas` 是对的（IdP 就是 zjuam），但**接入协议是 OAuth2 授权码**，不是 CAS service ticket。以后写 `login.mjs` 要按 OAuth2 走，不能照抄 `service.zju.edu.cn` 的 ticket 流程。

## 本次探了什么 / 还剩什么

**已探（约 12 次只读请求）**：`/` 5 跳链路 · `/robots.txt` · `/login` · `/explore` · `/api/` · `/api/mine` · `/api/groups` · `/api/search` · `/api/users/current` · `/login` 资源清单 · `yuque.com` 定价/帮助页各 1 次。

**未探 / blocked**：
- **登录后的文档与知识库内容** —— 需 CAS OAuth2 + 浏览器；且属他人协作数据，按只读契约不做批量。已在 `endpoints.json` 的 `blocked` 区记录解锁方式（playwright + `getKaptchaStatus` 先行）。
- **语雀官方「教育优惠」活动页** —— 需登录 `yuque.com` 个人版看会员中心，本轮无该账号。
- `login.mjs` **本轮未写**：没有登录需求，且登录是唯一允许的写操作、非任务必需，不主动做。若后续要写，按 `endpoints.json` 的 blocked.howToUnblock 走。
