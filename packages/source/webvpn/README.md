# @lybx-leyw/dsh-zju-source-webvpn

浙大 **WebVPN 通路**：把校内地址改写成网关地址，并完成网关自身的登录。

**供所有 zju 专属数据源共用**，零第三方依赖（只用 `node:crypto`）。

## 它解决什么

学在浙大、拼题A、教务、CC98 等站点只在**校园网内**可达。人在校外时直连必然失败，
浙大提供的 WebVPN 网关可以对内转发：

```text
https://courses.zju.edu.cn/api/…              ← 逻辑地址（业务包只认这个）
https://webvpn.zju.edu.cn/https/<hex>/api/…   ← 物理地址（真正发出去的）
```

`<hex>` 是 `AES-128-CFB` 密文，key 与 IV 都是公开常量 `wrdvpnisthebest!`。
**这是地址编码，不是加密** —— 不要把它当安全措施描述。

## 为什么独立成包

这份协议原先内嵌在 `@lybx-leyw/dsh-zju-source-campus/src/webvpn/`。它和 campus 的业务
（学在浙大待办、拼题A 题集）没有任何关系，是**所有 zju 数据源共用**的通路。
留在 campus 里，别的包想用只能复制一份代码，然后两份各自漂移。

拆出来后 `@lybx-leyw/dsh-zju-source-campus` 改为 `import` 本包，内部 `src/webvpn/` 已删除。

## 三层边界（重要）

| 层 | 由谁决定 | 本包的角色 |
| --- | --- | --- |
| **要不要走** WebVPN | 调用方的 `egress` 策略 | 不判断，只照做 |
| **怎么改写**地址、**怎么登录**网关 | 本包 | 实现 |
| **出口**用哪个 dispatcher | 调用方 | **完全不管** |

最后一条是刻意的：本包不碰 `undici` / `globalThis.fetch`。登录网关时调用方
**必须**传直连出口 —— 网关自己不能被改写，否则是「网关的网关」，会无限递归。

## 三层结构

```text
各数据源（campus / zdbk / cc98 …）
     │  用 createEgress()
     ▼
策略层（egress.js）：探测 → 判定 → 选路 → 失败升级
     │  需要改写地址时
     ▼
协议层（protocol.js / login.js）：地址改写、网关登录
```

### 为什么策略层也在这里

判定规则只有一条真源：「`*.zju.edu.cn` 在校外时需要网关」。它对**每一个**
zju 数据源都成立 —— 学在浙大、教务、学习通、智云课堂用的都是同一套校园域名。

在拆出来之前，它躺在 `@lybx-leyw/dsh-zju-source-campus` 里，于是 `cc98` / `zdbk` 想用
只能借 campus 的 `zhiyunEgress` 服务：**一个数据包的能力被另一个业务包绑架** ——
campus 不装，它们就退回 `globalThis.fetch`，而那条路会走全局代理
（实测同一个 `api.cc98.org` 请求：全局代理 10.7 秒失败，共享出口 97ms 成功）。

### 业务知识留在业务包

「拼题A 走公网」是**业务事实**，不是校园网事实，所以由调用方通过
`directSuffixes` 传入：

```js
// campus/src/egress.js
export function createEgress(options = {}) {
  return createSharedEgress({ ...options, directSuffixes: ['pintia.cn'] });
}
```

共享层因此不需要认识任何具体业务站点。

## 导出面

| 导出 | 作用 |
| --- | --- |
| `toWebvpnUrl(url)` | 逻辑地址 → 网关地址。已是网关地址时**原样返回**（防递归） |
| `fromWebvpnUrl(url)` | 网关地址 → 逻辑地址；不是网关地址返回 `null` |
| `isWebvpnLoginUrl(url)` | 这一跳是不是网关自己的登录/门户页（= 网关会话失效） |
| `parseWebvpnLoginPage(html)` | 取 `_csrf` 与 `captcha_id`（按 `name="…"` 整词匹配） |
| `webvpnLogin(transport, credentials, opts)` | 登录网关，会话收进 `transport.session.jar` |
| `hasWebvpnSession(session)` | 会话里是否已有网关 cookie |
| `redirectedToWebvpnLogin(location)` | 响应是否被踢回网关登录页 |
| `describeWebvpnFailure(code)` | 网关失败码 → 一句用户能照做的事 |
| `WebvpnError` | 错误类型，形状与 campus 的 `ClassroomError` 一致（`code`/`message`/`details`） |
| `createEgress(opts)` | **策略**：建一份出口。`mode` 为 `auto` / `direct` / `webvpn`，`directSuffixes` 传业务侧的公网后缀 |
| `needsCampusNetwork(host, opts)` | 这个主机是否必须走校园网（网关自己与 `directSuffixes` 都返回 false） |
| `isCampusHost(host)` | 是否是 `*.zju.edu.cn`（要求点边界，`evilzju.edu.cn` 不命中） |
| `isPublicHost(host, suffixes)` | 命中 `directSuffixes` 里的后缀 |
| `CAMPUS_PROBE_URL` / `interpretCampusProbe` / `MODES` / `loadUndici` | 探测端点、探测结果解释、模式枚举、undici 惰性装载 |

子路径入口 `/protocol`、`/login`、`/egress` 也可用，给只想要一小块、或想在测试里单独打桩的调用方。

## ⚠️ 两套认证，别混

| | 统一身份认证（CAS） | WebVPN 网关 |
| --- | --- | --- |
| 账号 | 学号 | **上网账号**（通常也是学号，但不保证） |
| 密码 | 统一身份认证密码 | **上网密码**（可能是另一套） |
| 用途 | 课堂、学在浙大 | 只在**校外**访问校内站点时 |

混为一谈的后果很具体：用户在校外看到"登录失败"，去改统一认证密码，然后还是失败。
所以每条错误文案都点明"这是上网账号"。

## 客户端的 agent tool

本包是**纯库**，没有客户端半边、不注册路由、不 provide 服务。agent 的 tool
要取校园数据时走的是各数据源包（它们内部再 import 本包），不需要单独接这里。

## 目录

```text
packages/source/webvpn/
  package.json         包名、exports（./ / ./protocol / ./login）
  cordis.patch.yml     insert 一行（做 Loader 条目用）
  src/index.js         宿主入口 + 统一导出面
  src/protocol.js      地址改写、AES 编解码、登录页解析、失败码文案
  src/login.js         网关登录流程、会话判定
  src/errors.js        WebvpnError
```
