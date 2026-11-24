# 浙大邮箱 zjuem.zju.edu.cn（Coremail XT5）

## 本页索引

<!-- yonkik:toc -->
> 按节读：grep -n "^## <标题>" wiki.md 取行号。

- 结论速览
- 两个域名的分工（zjuem vs mail）
- 鉴权：二次验证 + 客户端专用密码
- IMAP / SMTP / POP3 官方配置（原文摘录）
- 端口实测（只握手，未登录）
- 「收不到外部验证码」的机制判定
- 接口（全部已验证）
- 坑
- 未探候选

---
**状态：done（2026-11-20 只读探索）** —— 只到**协议/端口/官方文档**层。**未登录、未读任何邮件、未发信、未改设置。**

系统身份：Coremail XT5（`index_cmxt50_default.jsp`），前置 `Server: cmproxy`。

## 结论速览

1. **SMTP 的 SSL 端口是 994，不是 465**；465 与 587 实测全 TIMEOUT。这是 CC98 反复出现的「配不上」的头号原因。
2. **客户端必须用「客户端专用密码」（16 位随机）**，不能用网页登录密码——这是 2026 年起启用的二次验证体系。
3. **真正登录域名是 `mail.zju.edu.cn`**，`zjuem.zju.edu.cn` 只是入口壳。
4. **有反垃圾网关**：SMTP banner 直接写 `Anti-spam GT for Coremail System`。
5. 官方帮助中心把 IMAP/SMTP 配置、二次验证、六种客户端逐步配置全写清楚了，**免登录可读**。

## 两个域名的分工（zjuem vs mail）

| 域名 | 角色 | 证据 |
|---|---|---|
| `zjuem.zju.edu.cn` | 入口壳 / 跳转（`cmproxy`）、帮助中心所在 | 首页 21.8KB Coremail 登录壳；`/coremail/help/*` 全在此域 |
| **`mail.zju.edu.cn`** | **真正的登录与业务域** | `sso.jsp` → CAS OAuth2 `redirect_uri=https://mail.zju.edu.cn/coremail/cmcu_addon/sso.jsp`；2FA 文档全文都写「网页端 https://mail.zju.edu.cn」 |

**别把配置里的服务器填成 zjuem.zju.edu.cn** —— IMAP/SMTP/POP3 各自有独立主机名（见下）。

## 鉴权：二次验证 + 客户端专用密码

来源：`/coremail/help/2fa_zh_CN.html`（官方文档，最后更新 **2026 年 1 月 27 日**），原文要点：

> 为应对近期频发的邮箱安全风险…浙江大学邮件系统现已启用**二次验证和客户端专用密码**功能。

> 邮箱开启二次验证后的**密码说明**：
> - **客户端**（如 Foxmail、Outlook、设备自带邮件 App 等）：**必须**使用**客户端专用密码**登录；
> - **网页端**（https://mail.zju.edu.cn）：仍使用您**自定义的密码**并配合验证码登录。

四种二次验证方式：
| 方式 | 约束（原文） |
|---|---|
| 短信 | **仅支持中国大陆手机号** |
| 微信 | 需确保手机与电脑时间完全同步 |
| 浙大钉 | **仅限浙大组织内人员使用** |
| 第三方 OTP | 不受地域限制；多人共享可截图二维码给他人扫 |

设置路径：`设置 → 安全设置 → 二次验证设置`；专用密码在 `设置 → 安全设置 → 客户端专用密码`。

**客户端专用密码规则（原文）**：
- **随机 16 位**，**无空格**，**区分大小写**
- **仅显示一次**，需立即复制
- **最多可设置 6 个**，同一密码可在多台设备同时使用
- 忘记只能在设置里删除后重新生成

> 若开启二次验证后客户端仍使用原网页密码，客户端将提示「**账号信息错误**」等报错。

## IMAP / SMTP / POP3 官方配置（原文摘录）

来源 `/coremail/help/clientoption.jsp`（**官方帮助页**），Foxmail / Outlook 段原文：

> 若选择"IMAP"则接收服务器："**imap.zju.edu.cn**" 端口：**143**，勾选 SSL 端口：**993**；
> 若选择"POP3"则接受服务器："**pop3.zju.edu.cn**"；端口：**110**，勾选 SSL 端口：**995**；
> **发送服务器都为：smtp.zju.edu.cn。端口：25，勾选 SSL 端口：994**。

Outlook Express 段（补充 pop 写法）：
> pop: pop3.zju.edu.cn 端口：110 使用 SSL：995；smtp: smtp.zju.edu.cn 端口：25 使用 SSL：**994**

登录用户名：**完整邮箱地址**（如 `test@zju.edu.cn`），不是学号。

### 汇总表
| 协议 | 主机 | 明文端口 | SSL 端口 |
|---|---|---|---|
| IMAP | `imap.zju.edu.cn` | 143 | **993** |
| POP3 | `pop3.zju.edu.cn` | 110 | **995** |
| SMTP | `smtp.zju.edu.cn` | 25 | **994** ← 非标准 |

**465 / 587 均不通**（实测 TIMEOUT）。所以任何把 SMTPS 默认成 465 的客户端都必须手改成 994。

## 端口实测（只握手，未登录）

2026-11-20 实测（**仅 TCP/TLS 握手 + 读 banner，未发任何协议命令、未登录、未读信**）：

```
imap.zju.edu.cn:993  TLS ok  * OK Coremail System IMap Server Ready(zju.edu.cn[...])
imap.zju.edu.cn:143  TCP ok  同 banner
smtp.zju.edu.cn:994  TLS ok  220 zju.edu.cn Anti-spam GT for Coremail System (zju.edu.cn[20260918])
smtp.zju.edu.cn:25   TCP ok  同上
smtp.zju.edu.cn:465  TIMEOUT   ← 标准 SMTPS 不通
smtp.zju.edu.cn:587  TIMEOUT   ← STARTTLS 不通
pop3.zju.edu.cn:995  TLS ok  +OK Welcome to coremail Mail Pop3 Server (zju.edu.cns[...])
pop3.zju.edu.cn:110  TCP ok
```

**SMTP banner 里的 `Anti-spam GT` 是本站第二个重要事实**：反垃圾网关挂在 SMTP 上，等于「外域来信被判定」这一层是真实存在的。

## 「收不到外部验证码」的机制判定

**结论：社区多项独立观察一致指向网关拦截/延迟，机制未公开。**

实测证据链：
1. SMTP banner 明写 `Anti-spam GT for Coremail System` —— **反垃圾网关确实存在**（服务端侧，实测）。
2. 官方帮助中心**没有任何**「境外邮件白名单/放行申请」的公开说明（`help/index.jsp` 全部条目已枚举，无此类目）。
3. CC98 多项独立观察一致（见下），但**都是用户侧经验，不是官方口径**。

CC98 侧（供交叉参考，非实测）：
- 帖 6661224「为什么我的浙大邮箱收不到 GLaDOS 验证码」（11 回复）：回复给出「网关拦截邮件看看」「垃圾箱里面」「垃圾邮件里有吗」三种排查。
- 同帖 8L 及帖 6662926 标题：「注册用自己的非校园邮箱哦」「没收到邮件可能是浙大邮箱的问题？**建议不填 zju 邮箱**」。

→ **可复用的操作结论**：用第三方服务注册时优先用非 zju 邮箱；必须用 zju 邮箱时先查「垃圾邮件」文件夹，再等 10+ 分钟。**「一定是坏了」是过度归因**——本机无法验证单封邮件的投递结果（那需要读邮件，禁止）。

## 接口（全部已验证）
| 接口 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `/` · `/coremail/` | GET | 21.8KB Coremail 登录壳 | 免登录 |
| `/coremail/common/index_cmxt50_default.jsp` | GET | 同上（无 base 标签版） | 免登录 |
| `/coremail/cmcu_addon/sso.jsp` | GET | **302 到 CAS OAuth2**（client_id `dhcjnYjB1X8o15hDqh`） | 免登录 |
| `/coremail/changepwd.jsp` | GET | 忘记/重置密码页 | 免登录 |
| `/coremail/help/index.jsp` | GET | **帮助中心索引** | 免登录 |
| `/coremail/help/2fa_zh_CN.html` | GET | **二次验证与专用密码官方说明**（60KB） | 免登录 |
| `/coremail/help/clientoption.jsp` | GET | **IMAP/POP3/SMTP 端口官方原文** | 免登录 |
| `/coremail/help/login_guide_zh_CN.html` | GET | 《邮箱登录失败怎么办？》 | 免登录 |
| `/coremail/s/json?func=<mod>:<method>` | GET | Coremail JSON 通道（返回 202 + FR_INVALID_REQUEST 表示通道存在、方法不存在） | 免登录 |

帮助中心另有这些子页（未逐页读，按需接）：`mobile.jsp`、`multiSecurity.jsp`（邮件加密/锁屏）、`search.jsp`（用户自助查询）、`maildefer.jsp`（待办邮件）、`importantmail.jsp`、`recallmail.jsp`（邮件召回）、`option.jsp`（邮箱共享/假期自动回复）、`fulltextsearch.jsp`。

## 坑
1. **SMTP SSL = 994，不是 465**。465/587 实测 TIMEOUT。所有「配不上」先查这里。（CC98 6646659 楼主专门指出，官方 `clientoption.jsp` 也写 994，双向确认。）
2. **两个域名混用会失败**：入口是 `zjuem.zju.edu.cn`，**真正登录在 `mail.zju.edu.cn`**。SSO 的 `redirect_uri` 指向 mail。
3. **客户端不能用网页密码**：必须「客户端专用密码」（16 位、无空格、区分大小写、仅显示一次）。用网页密码会报「账号信息错误」。
4. **`/robots.txt` 是 404**（Coremail 错误页，gb2312 编码，按 UTF-8 读会乱码）。
5. **`/coremail/help/help.jsp`、`/help/`、`/help` 全部 404**——帮助中心正确路径是 `/coremail/help/index.jsp`。
6. **JSON 通道返回 202 不是错误**：`{code:'FR_INVALID_REQUEST'}` 表示「通道在、方法名不对」，别当站点故障。
7. **`/coremail/s/json?func=...` 是 GET**，Coremail 的老式 JSON 接口，不是 REST。
8. **邮箱正文是隐私区**：本 wiki 刻意不含任何登录后接口。要查邮件必须走用户本人操作，不是侦察脚本。

## 未探候选
- `mail.zju.edu.cn` 的网页登录流程（Coremail 前端是 AJAX 登录还是 CAS OAuth 回跳）——需登录，禁止。
- 单封/容量限制：帮助中心索引里未见配额说明；可能在登录后的「设置 → 账号」里（隐私区，不探）。
- 内容过滤/敏感词提示（CC98 6686810「说我有不适当内容」）的规则说明——公开文档未收录。

## 邮件系统校正（2026-11-22，按 dsh-zju-assistant 清单）

### 两个域名指同一套系统

| 域名 | DoH 真实 IP | 结果 |
|---|---|---|
| `zjuem.zju.edu.cn` | **210.32.2.5** | 200，**21,815B**，title「浙江大学邮件系统」 |
| `mail.zju.edu.cn` | 210.32.2.x | 200，**21,813B**，同标题 |

两者页面字节数只差 2 字节，是**同一套邮件系统的两个入口域名**。

**注意**：本地 DNS 都返回 `198.18.x`（代理伪造），必须 DoH 取真实 IP 直连。

### 登录要素

页面含登录表单（`登录`/`login`/`password` 关键词命中）。

**但它不是 CAS**：邮件系统是独立的邮箱账号体系（`学号@zju.edu.cn` + 邮箱密码），
与 `campus-sso` 统一身份认证不是同一套。

### 与既有记录的关系

本 wiki 早前只记了「SMTP **994**」（加密 SMTP 端口），这是首次记录 **Webmail 入口**。

### 未闭环

- **Webmail 内部接口完全未探**：收信列表、读信、附件下载都需要登录后抓 XHR。
- 邮件系统是否支持 IMAP/POP3（除 SMTP 994 外）未验证。
- **按只读原则**：本库只做「Webmail 入口可达性」记录，**不做自动收发信**
  （发信是写操作，且会以用户身份对外发件，属于不可逆动作）。
