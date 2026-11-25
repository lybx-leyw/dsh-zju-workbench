# WebVPN 与 CAS 统一身份认证

高校常用 WebVPN（深信服等）把内网站点包装成公网可达的 URL。具体编码各家不同，
**以实测为准，不要背常量**。下文域名（`example.edu`）与 hex 均为占位示例，非真实目标。

## 识别包装 URL

常见形态（hex 段各厂商不同，此处仅示意）：

```
https://webvpn.example.edu/http/<源站host的hex编码>/path
https://webvpn.example.edu/https/<源站host的hex编码>/path
```

- `/http/` 或 `/https/` 后那串 hex 通常编码了源站主机名。
  试解码：`Buffer.from(hex, 'hex').toString('utf8')`。
- 解出可读 hostname → 那就是源站，`sites/<key>` 用**源站 host** 建 key，
  `site.json` 里 `origin` 填 WebVPN 包装后的实际可达 URL，`via` 记录网关：

```json
{
  "key": "lib.example.edu",
  "origin": "https://webvpn.example.edu/http/<hex>/",
  "via": { "type": "webvpn", "gateway": "https://webvpn.example.edu", "sourceHost": "lib.example.edu" }
}
```

- 解不出 → 别猜。用浏览器打开 WebVPN 导航页，点进目标站，
  `playwright-cli requests` 抓真实请求 URL，以抓到的为准。

## SSO 发现程序（用户只给了一套一卡通账号时）

用户往往不知道各站密码，只知道 SSO 一卡通账号。发现程序：

1. **双信号识别 SSO 入口**：
   - 机器信号：GET 站点，观察 302 链是否跳统一 IdP（如 passport.example.edu）。
   - 语义信号：`playwright-cli find "统一身份认证|SSO|CAS|一卡通|登录"`，
     布局看不准时 screenshot。登录页按钮文案/链接会暴露 IdP。
2. **登记家族**：识别出的 IdP 写进 `sites/_sso.json`（loginUrl、credentialKey、
   成员站），成员站 `requires` 指向 IdP/网关 key。
3. **免登试探优先**：对同家族新站，先带已有 state 访问
   （`state-load` + `reload`，见 docs/02）→ 200 即免登，跳过登录；
   否则才走 CAS 链。登录一次网关，成员站逐个试探，不重复登录。
4. **防锁号护栏**：每站最多用 SSO 凭据尝试**一次**；失败 → status blocked，
   记录并问用户要该站凭据。**绝不拿 SSO 密码去撞多个独立登录表单**——
   很多站是独立账号或需二次绑定，撞多了会锁账号。试错锁号的代价远大于多问一句。

## CAS 登录链

典型链路：目标站 → 302 到统一身份认证（如 passport.example.edu）→ 登录 →
带 ticket 302 回目标站 → 目标站种会话 cookie。

- 用 playwright-cli 走完整链路（填账号密码或让用户扫码），不要手工拼 ticket。
- 登录成功后 `state-save sites/<key>/state.json`。cookie 可能同时存在于
  **网关域**和**源站路径**下——lib 的 cookie jar 按 URL 的域+路径匹配，
  导入整个 state 即可，不要手工挑 cookie。
- 多个内网站点共用一套 CAS：登记进 `_sso.json` 家族，登录一次网关，
  其它站先做免登试探（见上方发现程序）。`auth.credentialKey` 指向同一个
  凭据键（如 `campus-sso`）。

## 双重限流

WebVPN 网关自己也会限流，且通常比源站更严。`rateLimit` 取**网关与源站中更严**
的值，evidence 里写明是哪一层的。网关 429 时整站停等，不是只停某个接口。

## 会话短命

WebVPN 会话普遍比直连短（几十分钟到几小时）。症状：接口突然 302 到登录页
或返回 HTML 而非 JSON。处理：重走登录阶段刷新 state.json，接口知识不用重探。
wiki 里记下实测会话寿命，方便下次预判。

## 电子书 / 文献站常见坑

- 下载链接多为时效 token（几分钟到几小时），记录获取流程，脚本现取现用。
- 并发下载限制常见 1–2，超了封会话——串行。
- 检索接口常是 POST + JSON，分页参数名五花八门（page/pageNum/curpage），
  以抓包为准，记进 endpoints.json。