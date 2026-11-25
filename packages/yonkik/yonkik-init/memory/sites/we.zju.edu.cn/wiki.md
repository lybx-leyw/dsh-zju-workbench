# we.zju.edu.cn · 就餐指数（域名已废弃，内容重定向到后勤集团）

> 探索日期 2026-11-20。Apache/2.4.48 PHP/5.6.38 ThinkPHP2.1，IP `10.12.204.25`（校内网段）。
> **结论先行：TIMEOUT 是 HTTPS 端口不通造成的假象，站点 HTTP 80 活着。但「就餐指数」本身已不在这个域名上。**

## 本页索引

- [一句话结论（含 TIMEOUT 归因）](#一句话结论含-timeout-归因)
- [分层诊断证据](#分层诊断证据)
- [这个域名现在是什么](#这个域名现在是什么)
- [「就餐指数」去哪了](#就餐指数去哪了)
- [接口表](#接口表)
- [坑](#坑)
- [blocked 说明：还缺什么](#blocked-说明还缺什么)

## 一句话结论（含 TIMEOUT 归因）

**TIMEOUT 不是站点下线，也不是「只在校园网可达」。** 真相是：

- **443 端口 TCP 握手超时**（8 秒无响应）→ 任何 `https://we.zju.edu.cn` 的探测都会 TIMEOUT。这就是原先「实测 TIMEOUT」的全部原因。
- **80 端口正常**（12ms 连上）→ `http://we.zju.edu.cn/` 返回 **200，1682B**。
- 返回的内容是一张「系统提示」跳转页：
  > 浙江大学后勤集团网站已升级改版，10 秒后自动跳转到首页
  > （`<meta http-equiv="refresh" content="10;url= http://zulg.zju.edu.cn/ ">`）

**所以：域名活着，被废弃了，做了一个友好的 10 秒跳转页到 `zulg.zju.edu.cn`。就餐指数功能不在这里。**

## 分层诊断证据

严格按 site-recon / playbook「本机代理 7993」的诊断口诀逐层做：

```
### we.zju.edu.cn
  DNS → 10.12.204.25/4          ← 内网地址，必须绕过 env 代理
  TCP 443 → TCP_TIMEOUT 8007ms  ← HTTPS 不通，这是 TIMEOUT 的真因
  TCP 80  → OK 12ms             ← HTTP 通
  GET / → 200 1682B 786ms title="系统提示" server=Apache/2.4.48 (Win64) PHP/5.6.38
```

关键点：**如果只探 HTTPS（很多脚本默认 https），就会看到 TIMEOUT 并误判成「站点挂了」。**
DNS 解析正常（10.12.204.25）、80 端口 TCP 正常、HTTP 200 —— 三层都通，唯独 443 不可用。

这**不是** playbook 里记的「代理出口在墙外」问题：代理问题会让 DNS/TCP/TLS 都正常但 HTTP 超时，
而这里是 **TCP 443 层就超时**（在应用层之前）。所以是站点自己没开 HTTPS。

### 响应头（证明是活的 PHP 应用，不是 CDN 兜底页）

```
date: Fri, 20 Nov 2026 08:11:43 GMT
server: Apache/2.4.48 (Win64) PHP/5.6.38
x-powered-by: ThinkPHP2.1
set-cookie: PHPSESSID=...
access-control-allow-origin: *
content-length: 1682
content-type: text/html; charset=utf-8
```

`x-powered-by: ThinkPHP2.1` + `PHPSESSID` 说明后面是个活的 PHP 框架应用，不是静态 404。

## 这个域名现在是什么

### `/` —— 跳转公告页（200，1682B）

原文：

> **系统提示**
> 浙江大学后勤集团网站已升级改版，10 秒后自动跳转到首页

跳转目标（meta refresh）：`http://zulg.zju.edu.cn/`

其余路径行为一致：`/index.php`、`/index.php?s=/index/index`、`/api/index`、`/canteen` **全部返回同一张 1682B 页**
（ThinkPHP 的兜底路由）。`/mobile` 返回 301 → `/mobile/`。

### `/mobile/` —— 微信公众号应用（这才是活的业务）

`GET /mobile` → 301 → `/mobile/` → 302 → 微信 OAuth2：

```
https://open.weixin.qq.com/connect/oauth2/authorize
  ?appid=wx76332f060ee4d976
  &redirect_uri=http%3A%2F%2Fwe.zju.edu.cn%2Fmobile%2Findex.php%3Fc%3Daccount%26a%3Dauto
  &response_type=code&scope=snsapi_base&state=STATE#wechat_redirect
```

- **appid**：`wx76332f060ee4d976`
- **scope**：`snsapi_base`（静默授权，只拿 openid，不弹授权页——但**必须在微信内置浏览器内**）
- **回调**：`/mobile/index.php?c=account&a=auto`

`GET /mobile/index.php?c=account&a=auto`（浏览器直连、无 code）→ **200**，4426B，title「用户中心」。
但页面里的模板是「**微信账户出错！**」错误态（`tpl_home` 里写着 `weui_msg_title: 消息提醒 / weui_msg_desc: 微信账户出错！`），
且带一个「扫码须知」弹窗原文：

> 感谢您使用桌面扫码功能。为提高服务质量，凡「浙大后勤」注册用户，后台将记录您的个人联系方式，
> 扫码后若未能在现场与您沟通，将与您进行电话联系。

→ **这是一个「浙大后勤」微信公众号的 mobile 站，含桌面扫码点餐/服务功能。** 需要微信 OAuth 身份。

### `zulg.zju.edu.cn` —— 后勤集团主站（跳转目标）

- `GET /` → **302** → `https://zulg.zju.edu.cn/index.htm`
- `GET /index.htm` → **200，55890B**，title「**浙江大学后勤集团**」
- `robots.txt` → 404（1693B 的自定义 404 页）
- 主站首页正文里 **搜「就餐」「指数」均 0 命中**（`grep 就餐`=0 行，`grep 指数`=0 行）

## 「就餐指数」去哪了

三重证据表明**当前无公开免登录入口**：

1. `we.zju.edu.cn/` 只剩跳转公告，无任何「就餐指数」内容。
2. `zulg.zju.edu.cn/index.htm`（跳转目标）首页正文**不含「就餐」也不含「指数」**。
3. `we.zju.edu.cn/mobile/` 是微信公众号应用，需 `snsapi_base` 授权（微信内打开）。

**CC98 帖 6316630 说「zjuers 轻首页新增了就餐指数」，回复说「好像以前在钉钉看到过，感觉不是很准」。**
与本轮实测对照：现在既不在轻首页可达路径（zjuers 已探索，是静态导航），也不在 we 域名公开面。
很可能迁入**浙大钉/浙大后勤微信公众号**内的封闭入口——这与「以前在钉钉看到过」的回忆一致。

**判定：blocked。** 不是站点死了，是入口搬进了需要微信/钉钉授权域的封闭面。
详见末节「blocked 说明」。

## 接口表

| method | path | 用途 | 鉴权 | 关键响应 |
|---|---|---|---|---|
| GET | `/` | 跳转公告页（**唯一稳定可见内容**） | 无 | 200，1682B，`<title>系统提示</title>`，`meta refresh 10;url=http://zulg.zju.edu.cn/` |
| GET | `/mobile/` | 微信公众号入口 | **微信 OAuth2** | 302 → `open.weixin.qq.com/connect/oauth2/authorize?appid=wx76332f060ee4d976&scope=snsapi_base` |
| GET | `/mobile/index.php?c=account&a=auto` | 用户中心（无 code 时） | 免登录但为错误态 | 200，4426B，title「用户中心」，模板含「微信账户出错！」 |
| GET | `/mobile/index.php?c=index&a=index` | 移动端首页 | 需 openid | **302，12B**（空 body 重定向） |
| GET | `/mobile/index.php?c=canteen&a=index` | **疑似就餐相关控制器** | 需 openid | **302，0B**（重定向，验证了需授权） |

**注意**：`c=canteen` 这个控制器名返回 302（而不是 200 错误页或 404），说明**路由存在**、只是被鉴权拦住。
这为「就餐功能在 /mobile 下」提供了一个间接证据，但**未能实证**（无微信 code）。

## 坑

1. **必须用 HTTP 探，不能用 HTTPS。** 443 是 TCP 层超时，`https://` 一律 TIMEOUT——
   这是最容易误判成「站点下线」的地方。
2. **所有未知路径都回同一张 1682B 跳转页**（ThinkPHP 兜底），HTTP 200。
   不能按「200 就是页面存在」判断，要按 **content-length=1682 且 title=系统提示** 认出兜底。
3. **`/api/index`、`/canteen` 这类「看起来该有接口」的路径回 200 而不是 404**，同样是因为兜底页。
   真正的 API 前缀未发现。
4. **`/mobile` 无尾斜杠会 301**，带斜杠才 302 到微信。写脚本时注意归一化。
5. **`access-control-allow-origin: *` 头存在**，容易误以为接口开放；实际是全线兜底页上的头，无意义。
6. **`zulg.zju.edu.cn` 是 https 的**（`http://zulg.zju.edu.cn/` 会 302 到 `https://`），而 `we.zju.edu.cn` 只有 http。
   两个域名的协议行为不同，别串。
7. **`server` 头在 zulg 上被抹成 `**********`**（实测），别据此判断 server 类型。

## blocked 说明：还缺什么

要真正拿到「就餐指数」的实时数据，还缺：

1. **微信 OAuth code**（appid `wx76332f060ee4d976`，scope `snsapi_base`）。
   `snsapi_base` 是静默授权、无需用户点「同意」，但**必须在微信内置浏览器或微信 JS-SDK 环境**下发起。
   现有工具链（playwright + campus-sso）无法伪造微信客户端环境。
2. **或浙大钉（钉钉）内的入口**。CC98 回复提到「以前在钉钉看到过」；浙大钉是独立 APP，
   其 H5 微应用通常也要 dd 的免登 code。
3. **或者知道 `/mobile/index.php?c=<controller>&a=<action>` 里就餐对应的确切 controller/action**。
   本次只探到 `c=canteen` 会 302（路由存在），但参数结构未知。

**建议的下一步**（不在本次授权范围内）：让用户在微信里打开 `we.zju.edu.cn/mobile/`，
或者直接问用户「就餐指数」在浙大钉里的具体入口路径。

## 本次探了什么

DNS/TCP80/TCP443 三层诊断；`/`、`/index.php`、`/index.php?s=/index/index`、`/api/index`、`/canteen`、`/mobile`
（含 301 归一化）；`/mobile/` 微信 OAuth 重定向链全跳；`/mobile/index.php?c=account&a=auto`（200 错误态）；
`/mobile/index.php?c=index&a=index`、`c=canteen`（均 302）；`zulg.zju.edu.cn` 的重定向链与首页全文关键词检索。
