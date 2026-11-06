# dsh-zhiyun-source-zdbk

浙大**教务系统**（`zdbk.zju.edu.cn/jwglxt`）数据源：成绩与 GPA、考试安排、课表。
纯 JavaScript（ESM，无 TypeScript），本仓原生实现。

## 能力

| 方法 | 作用 | 主要参数 |
| --- | --- | --- |
| `zdbk.grades` | 成绩列表 + 该范围的 GPA 汇总 | `academic_year` / `semester` / `major_only` |
| `zdbk.gpaSummary` | 总体 / 专业 / 分学期 GPA | 无 |
| `zdbk.exams` | 考试安排（期中 + 期末） | `academic_year` / `semester` / `upcoming_only` |
| `zdbk.timetable` | 课表（按星期与节次排好） | `academic_year` / `term` |

`method` 一律是 `zdbk.<函数名>`。这是 omni 时代的调用口径，**刻意保留**：
「今天」页与脚本里已经写着 `zdbk.timetable`，改名的收益不够抵一次全线改名。

### GPA 口径（必须按这个读）

`gpaOf` 完整搬自 omni，一条没简化：

- **五分制**：直接取教务给的绩点（`jd`），按学分加权；
- **4.3 制**：`5.0→4.3`、`4.8→4.2`、`4.5→4.1`、`4.2→4.0`，**其余封顶 4.0**。
  注意「其余封顶」不是按比例缩放 —— `4.9` 在这套口径下是 4.0，不是 4.21；
- **弃修 / 待录 / 缓考 / 无效**：不计学分，也不进 GPA；
- **合格 / 不合格**（二级制）：计学分，但**不计 GPA**；
- 校选修网络课（课号含 `xtwkc`）：计学分，不进 GPA；
- 空集合返回 `null` 而不是 `0` —— `0` 会被界面画成一条贴底的曲线，
  而真相是「还没有成绩」。

`average_score`（学分加权百分制均分）是**本仓自己**的参考指标，等级制按一张
常用折算表换算；它**不参与**上面两个 GPA —— 否则折算表一换，两个 GPA 都会跟着变。

### 学期

浙大按「秋 / 冬 / 春 / 夏」分学期，秋冬属第 1 学期、春夏属第 2 学期。
课表接口必须显式给学年学期，调用方没给时按**上海日历**推断：

| 时间 | 推断 |
| --- | --- |
| 8 月 ~ 10 月，及 11 月 15 日前 | 秋 |
| 11 月 15 日起 ~ 次年 2 月 | 冬 |
| 3 月 ~ 4 月 | 春 |
| 5 月 ~ 7 月 | 夏 |

学年在 8 月切换（3 月属于上一学年）。返回值里带 `inferred_term`：推断可能是错的
（寒暑假、补课周），所以如实标注，页面据此可以提示用户，而不是让人以为系统认错了课表。

## 认证

用**「浙大一卡通」**（学号 + 统一身份认证密码）登录，凭据与学在浙大、智云课堂共用一份：

```js
import { readCard } from 'dsh-zhiyun-source-card';
const account = await readCard(ctx); // { username, password } 或 null
```

写入方是「设置 → 浙大一卡通」，本包**只读不写** —— 一个数据包不该替用户保存密码，
否则「设置里配的是什么」和「实际在用的是什么」迟早分叉。

### ⚠️ 教务的 CAS **必须带 `service`**，这与学在浙大相反

这是本包与 `dsh-zhiyun-source-campus` 唯一的实质差别，也是最容易照抄错的一处：

| | 学在浙大（campus） | 教务（zdbk，本包） |
| --- | --- | --- |
| `service` 参数 | **不带** | **必须带** |
| 为什么 | CAS 把票种在 `zjuam` 域上，业务站的 CAS 过滤器自己认出身份 | `/jwglxt` 等的是**服务端回调** `login_ssologin.html`，没人把 ticket 送回去就永远未登录 |

所以本包**不 import** campus 的 `cas/login.js`，自己实现 `src/cas.js`：

```text
https://zjuam.zju.edu.cn/cas/login?service=<encodeURIComponent(https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html)>
```

`service` 只能**编码一次**。重复编码会让 CAS 回跳到一个 404 页，
而 CAS 那一跳本身仍是"成功"的 —— 日志里看不出问题。

RSA 加密照搬学校 `login.js` / `security.js` 的打包方式：
**反转 UTF-16 单元 → 小端塞成大整数 → 按模长分块**（`encryptCasPassword`）。
换成「看起来更标准」的做法，服务端解出来就是乱码，现象是密码被拒。
这套打包**拒绝非 ASCII 密码**：单元值大于 `0xFF` 会溢出、丢高位，
学校前端同样如此 —— 与其提交一个必然失败的密文让用户以为密码错了，
不如在提交前停下并说清原因。

判据是**有没有拿到 SSO 票**，不是 HTTP 状态码：CAS 登录失败通常回
`200 + 登录页`。被拒或要求验证码就立刻停，**密码最多提交一次**。

## 数据路由

`/api/zhiyun-zdbk`（走宿主的 `connection.fetch`，与 study / vault / notes 同一条受鉴权通道）

```text
GET  /api/zhiyun-zdbk   → { ok: true, value: { methods: [...] } }        自描述
POST /api/zhiyun-zdbk   → { type:'client-request', rpcId, method:'zdbk.timetable', payload:{ academic_year:'2025-2026', term:'秋' } }
                        ← { type:'server-response', rpcId, result:{ ok:true, value:{…} } }
```

POST 的 `method` 既接受**顶层**（本包约定的形态），也接受 `payload.method`
（omni 时代的口径）—— 两种信封都已在用的调用方不该为一个字段改名。

宿主侧也可以直接拿服务：

```js
const zdbk = ctx.get('zhiyunZdbk');
await zdbk.timetable({ academic_year: '2025-2026', term: '秋' });
await zdbk.gpaSummary();
await zdbk.hasSession();   // 只看 cookie，不发请求、不登录
```

## 复用的共享层（**不复制**）

```js
import { Transport, SessionStore, ClassroomError } from 'dsh-zhiyun-source-campus/http';
import { readCard } from 'dsh-zhiyun-source-card';
```

`Transport` 的构造参数是 `{ session, fetch, timeoutMs, log, hosts, referer, cookieFilter }`，
`request(url, { method, body, headers, signal, timeoutMs })` 返回 `{ status, headers, text }`。

⚠️ **必须把教务的全部主机传进 `hosts`**（`ZDBK_HOSTS` = `zjuam` + `identity` + `zdbk`）。
`Transport` 只在主机命中白名单时才读写 cookie，而它的默认白名单是智云课堂那一套，
里面没有 `zdbk.zju.edu.cn`。漏传的后果**不报错**：请求一个 cookie 都不带、
回来的 `Set-Cookie` 也一个都不存 —— 登录「成功」，会话永远是空的。

## 与 omni 的关系

`dsh-zhiyun-source-omni` 是从 [ZJU-Omni](https://github.com/Vita0818/ZJU-Omni)（MIT）
移植的 TypeScript 数据层，为 macOS 写。本包是它 `src/platforms/zdbk/` 那一块的
**纯 JS 重写**，接口契约与 GPA 口径照搬，其余换成本仓自己的层：

| 方面 | omni | 本包 |
| --- | --- | --- |
| 语言 | TypeScript（运行时靠宿主类型剥离） | **纯 JavaScript（ESM）** |
| HTTP / Cookie | `core/http.ts` 自建 `HttpClient` + 自建 `CookieJar` | **共享层 `Transport`**（tough-cookie） |
| 会话落盘 | `core/store.ts` 的 JSON | **共享层 `SessionStore`**（Windows DPAPI） |
| CAS | `auth/cas.ts`（带 `service`） | `src/cas.js`（逻辑照搬，改用 `Transport`） |
| 凭据 | macOS 钥匙串 + 环境变量 + 自己的 DPAPI | **`readCard(ctx)`**（设置页写入的那一份） |
| 失败缓存 | 一次失败封锁 **15 分钟** | **不缓存失败**，下一次照常再试 |
| 认证层 webvpn 分支 | 每次取数前可能先探测网络模式 | 不在认证层里（见下面的已知取舍） |
| 暴露面 | `omni.invoke('zdbk.grades')` | `zdbk.grades`（服务方法 + 数据路由） |

移植后 **omni 可以删掉**，教务这块由本包接住。

## 已知取舍（如实说明，别当成已完成）

1. **网络出口走共享层，自动分域。** 本包不再自己配出口：请求经
   `sharedFetch(ctx)` 借 `dsh-zhiyun-source-campus` 提供的 `zhiyunEgress` 服务 ——
   校内直连、校外自动绕 WebVPN，并**绕开宿主为 LLM 配的全局代理**
   （浙大站点经那个代理基本必失败）。出口只有一份，各包共用同一个 undici
   dispatcher 与同一份 WebVPN 会话（各自登录会互相踢掉）。
   campus 没装时退回 `globalThis.fetch`：仍能直连，但校外会失败。
2. **`average_score` 的等级制折算表是本仓的**，不是学校公布的换算表。
   它只影响这一个参考指标，不影响 `gpa_5` / `gpa_4_3`。
3. **节次时间表写死在 `PERIOD_TIMES`**（紫金港常规作息）。正方只给节次号、
   不给时间；换校区（如海宁、舟山）作息不同的话需要按校区覆盖。
4. **不提供成绩单导出 / 排名 / 学分预警**。只做上面四个读取方法。

## 文件

```text
src/index.js    Cordis 插件（name / inject / apply）+ 数据路由 + 服务面
src/hosts.js    ZDBK_HOST / ZDBK_BASE / ZDBK_SERVICE / ZDBK_CAS_ENTRY / ZDBK_HOSTS / ZDBK_PATHS
src/cas.js      带 service 的 CAS 登录 + RSA 打包 + 错误文案转述
src/client.js   ZdbkClient：post(path, { query, form, allowNull }) + 状态码口径
src/parse.js    解析 + GPA 计算 + 学期推断 + 节次表（不碰网络）
src/reads.js    ZdbkReader：grades / gpaSummary / exams / timetable
```

三层分界是「换掉任一层，另外两层不用动」：测试里塞一个假的 `ZdbkClient.post`
就能把整条读取链路跑通，完全不碰网络与登录。

## 测试

```sh
node tests/zdbk.test.mjs
```

用 `node:test` + `node:assert/strict`，全部离线（假 `fetch` + fixture 数据）。
覆盖 GPA 的三种口径、学期推断、四个解析器、带 `service` 的入口 URL 构造、
以及「登录 + 真实业务读取」这条端到端链路。

⚠️ 测试**不碰 DPAPI**：`SessionStore` 要么不传 `file`（只存内存），
要么传一个自定义 `protect`。DPAPI 会 spawn 一个 PowerShell 子进程，
本机沙箱禁止 spawn。
