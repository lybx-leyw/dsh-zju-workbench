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
只能借 campus 的 `zwEgress` 服务：**一个数据包的能力被另一个业务包绑架** ——
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
| `doctor(opts)` | 网络诊断：公网 / 校园网 / 网关 / 会话四项分开问，每条给可执行的下一步 |
| `probeHost(host, opts)` | **单主机探测**：该直连还是走网关、要不要过 CAS。公共 DoH 解析 + TUN 检测 + `via` 外部实测 |
| `isPrivateAddress(ip)` / `tunInterfaces()` | 私网段判定、本机隧道接口检测（`probeHost` 的判据，单独给出便于复用） |
| `checkReachable(hosts, opts)` | **逐主机可达性**：并发探一组主机，TTL 缓存（默认内存，`cacheFile` 可选落盘） |
| `requireReachable(hosts, opts)` | 同上，但不通就抛 `TRANSPORT`，错误里带可行动的解释 |

子路径入口 `/protocol`、`/login`、`/egress`、`/probe`、`/reach` 也可用，给只想要一小块、或想在测试里单独打桩的调用方。

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
  package.json         包名、exports（./ / ./protocol / ./login / ./egress / ./hosts / ./doctor / ./probe / ./reach）
  cordis.patch.yml     insert 一行（做 Loader 条目用）
  src/index.js         宿主入口 + 统一导出面
  src/protocol.js      地址改写、AES 编解码、登录页解析、失败码文案
  src/login.js         网关登录流程、会话判定与探测、ticket 导入
  src/egress.js        出口策略：三级判定、升级重试、会话内降级
  src/hosts.js         主机归属表（campus / public / cas 三份名单）
  src/doctor.js        网络与网关诊断（本机处境）
  src/probe.js         单主机探测（这个站该直连还是绕网关、要不要 CAS）
  src/reach.js         逐主机可达性（访问前的闸门，带 TTL 缓存）
  src/errors.js        WebvpnError
  scripts/probe-hosts.mjs  重新生成 hosts.js 的实测部分（`src/probe.js` 的 CLI 包装）
```

## 主机归属表（`hosts.js`）

选路不再只看 `*.zju.edu.cn` 这一条后缀规则，而是查一张**逐主机的事实表**：

| 判定 | 含义 | 依据 |
| --- | --- | --- |
| `public` | 公网可达，**永远直连** | 各模块 `module.json` 的 `network` + 校外实测 |
| `campus` | 只在校内可达，校外经网关 | 同上 |
| `unknown` | 表里没有，**回退后缀规则** | `*.zju.edu.cn` 绕网关，其余直连 |

单后缀规则两个方向都会错：教务网 / 学在浙大 / 智云 / 体艺 / 研究生教务实测**公网可达**
却被强制绕道；而 `cc98.org`（不在该后缀下）与实验平台的私网 IP `10.203.16.55`
只在校内可达却被判直连，校外必然失败。

表是**一次实测的快照**（`HOSTS_GENERATED_AT`），会过期。重新生成：

```bash
npm run probe:hosts --prefix packages/source/webvpn
```

脚本会先自查是否在校园网内并在校内时拒绝运行 —— 在校园网里测，所有站点都可达，
表就没有意义了。它**不直接改写 `hosts.js`**：输出表格并用 `!` 标出与现值不一致的项，
由人确认后再改。

本机开着 Clash / ZJU Connect / Tailscale 之类 TUN 代理时，本机结论本来就不可信
（IP 直连也会被隧道带进校园网）。两种对策都能用：

```bash
# 1) 脚本会检测隧道接口并警告，但仍按本机结果跑
npm run probe:hosts --prefix packages/source/webvpn

# 2) 直接换到一台校外干净主机上测（ground truth）
node packages/source/webvpn/scripts/probe-hosts.mjs --via my-server
```

## 探测单个站点

表的维护靠脚本，但**「这个站该不该走网关」是一份数据，也是一个可调用的判定**。
设置页与 agent 需要后者：

```js
import { probeHost } from '@lybx-leyw/dsh-zju-source-webvpn'

const report = await probeHost('some-new-college.zju.edu.cn')
// → { host, resolver, addresses, privateAddress,
//     direct: { ip, reachable, status, final, ms },
//     suggested: { network: 'public'|'campus', auth: 'cas'|'unknown', casService? },
//     caveats: [...] }
```

判法跟着跳转走到底，看最后停在哪：

| 落点 | `network` | `auth` |
| --- | --- | --- |
| `zjuam.zju.edu.cn/cas/…` | `public` | `cas` |
| 200（首页） | `public` | `unknown` |
| `/nopermit_zjusub.jsp` | `campus` | — |
| 连不上 / 超时 / 403 / 5xx | `campus` | — |

解析走公共 DoH（阿里 / 腾讯），直连解析出的 **IP** 而不走系统 DNS —— 本机 DNS 与
hosts 都改不动结论。`caveats` 会把「有 TUN 接口，结果不可信」「无 A 记录」
「auth 需人工确认」这些话说清楚，**不静默给一个看起来确定的答案**。

## 逐主机可达性

`doctor()` 答的是「本机处境」，这个答的是「某几个站现在通不通」：

```js
import { checkReachable, requireReachable } from '@lybx-leyw/dsh-zju-source-webvpn'

// 只报告，不失败 —— 设置页的「测一下」按钮用这个
const results = await checkReachable(['zdbk.zju.edu.cn', 'cc98.org'])

// 不通就抛 TRANSPORT，错误里带可行动的解释 —— 访问前的闸门用这个
await requireReachable(['zdbk.zju.edu.cn'], { cacheFile: '/path/to/reach.json' })
```

结果按主机缓存 **10 分钟**，默认**只在内存**（不产生任何文件）；传 `cacheFile` 才落盘。
只缓存**成功**：一次失败可能只是瞬断，缓存它等于让用户在一次抖动后持续看到「不可达」。

## 会话内降级

某主机直连失败、或落到网站群的「无权访问」页（`/nopermit_zjusub.jsp`，HTTP 200），
本次运行里该主机改走网关并**记住**，之后不再先试直连。降级是**逐主机**的：
一个站失败不会牵连另一个本来能直连的站。换了网络调 `forget()` 清空。

## 诊断

```js
import { doctor } from '@lybx-leyw/dsh-zju-source-webvpn'

const report = await doctor({ fetch: sharedFetch(ctx), credentials })
// → { transport, direct: { campus, public, ms }, webvpn: { reachable, ms, credentials, sessionValid }, ok, advice[] }
```

`advice` 每条都是可执行的下一步。凭据**由调用方传入** —— 本包是 tier 0，
不知道凭据从哪来（那是 `source/login` 的事）。
