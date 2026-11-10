# 数据源审核结果 · source/yjsy

**审核代理**：`65d9111d`
**结论**：**有严重问题，必须修** —— 解析层质量很高（`timetable` 返回结构**逐字段零差异**），但宿主入口层有一个**让整个包一次真实请求也发不出去**的缺陷。

---

## 阻断级（1 条，已实测复现）

### B1 · `src/index.js:78` 传了 `jar: null`，所有真实请求必失败

```js
session: { jar: null, epoch: 0, save: async () => {} },
```

**机制**：`Transport.request` 在 `http/src/transport.js:96` 无条件执行
`(await this.session.jar.getCookies(url))` → `jar: null` 抛 `TypeError`
→ 落到同文件 `:129-132` 的 catch → `combined.aborted` 为假
→ 抛 `new ClassroomError('NETWORK', '无法连接智云服务')`。

**代理实测（只读，内联构造，未落盘）**：

| 配置 | 结果 |
| --- | --- |
| `session: { jar: null, ... }`（本包现状） | `THREW ClassroomError \| code=NETWORK \| msg=无法连接智云服务` |
| `session: { jar: new CookieJar(), ... }`（其余不变） | **`OK 200 {}`** |

**缺陷唯一来自 `jar: null`，与网络无关。**

**为什么其它包没这个问题**：
- `zdbk/src/index.js:176-183` 传真实 `SessionStore`
- `classroom/src/source.js:53` 传 `new SessionStore(...)`

**修法**（代理给的）：
```js
import { SessionStore } from '@lybx-leyw/dsh-zju-source-http';
session: new SessionStore(),   // 无 file ⇒ load/save 都是空操作
```
`SessionStore` 无 `file` 时 `load()` 直接 return（`session.js:48`），语义正好是「一次性内存 jar」。

---

## 重要（9 条）

| # | 问题 | 位置 | 后果 |
| --- | --- | --- | --- |
| **I1** | Transport 的错误码**没被翻译**，且文案说「智云」 | `index.js:107-113` | `NETWORK`/`TIMEOUT`/`DISPOSED`/`CANCELLED` 原样穿透，message 是**错站点名**；而 README 承诺 message 可直接上屏 |
| **I2** | **token 缓存不看 username** → 换账号返回上一个人的课表 | `index.js:75` | **隐私泄露**。`zdbk:223-238` 花整段注释记过这个教训，本包复发 |
| **I3** | 没有登录串行化，并发会互相作废 CAS 票 | `index.js:71-94` | `campus/src/cas/login.js:30` 明写「同一学号两次登录会互相作废 ticket」→ 两页同刷即复现「偶发 AUTH_EXPIRED」 |
| **I4** | `CONFIG` 文案是开发者话术 | `index.js:72-74` | 「集成层」「setTokenProvider」是内部名词，用户读完不知道做什么 |
| **I5** | `methods: ['yjsy.timetable']` 与路由只认 `'timetable'` **不一致** | `index.js:121` vs `:156` | 照 `methods` 发请求会得到 `不认识的操作：yjsy.timetable`；README 两处自相矛盾 |
| **I6** | 逐入口 catch 把「没配凭据」降级成「站点拒绝」 | `yjsy.js:379-382` | 吞掉 `code`/`details`；「压根没配账号」与「站点真拒绝」是同一个码 |
| **I7** | 宿主入口 `src/index.js` **零覆盖** | `tests/yjsy.test.mjs:16-18` | 21 条全部只 import `yjsy.js`。**B1/I1/I2/I3 全在那个未测文件里 —— 这不是巧合** |
| **I8** | `setTokenProvider` **全仓无调用方**，且 `validateLogin` **本仓未实现** | 全仓 grep 仅 2 处命中 | **即使修好 B1，这个包也换不到 token** |
| I9 | 未装配进 profile，也不在 lockfile | `profiles/.../package.json`、`package-lock.json`（`yjsy` 命中 0） | `npm ci` 不会装它 |

### I8 是最深的问题

代理指出：`campus/src/cas/login.js` **明确不带 `service`**（`:8-14`），而 `zdbk/src/cas.js:307` 的 `casLogin` 能带 `entry` 但那是 **tier 1 业务包** —— 让 yjsy 或集成层依赖它**违反「tier 1 不得依赖 tier 1」**。

**代理的建议**：把「CAS 取 service ticket」抽到 tier 0（`source/http` 或新的 `source/cas`），再由集成层实现 `acquireToken`。

**这是设计缺口，不是本包代码 bug，但它决定「可用/不可用」。**

---

## 次要（10 条，摘要）

M1 `HTTP 401/403` 落到 `SHAPE`，没提示「可能要重新登录」
M2 `fresh` 路径替换缓存时**旧 transport 不关闭** → 每次 AUTH_EXPIRED 重试漏一个
M3 缺 `./yjsy` 子路径导出，入口不 re-export → 单测只能穿相对路径
M4 `acquireToken` 的签名**三处三种**（注释 `(entry)`、实现 `(entry, service)`、README `({entry, service, username})`）
M5 README:74 引用**不属于自己的实测数据**且归因错（那是 `campus/src/egress.js:17` 的「本机代理」，不是海外代理）
M6 同一模块两条 import（其余包都是单条）
M7 **丢了两条上游来源信息** —— 尤其「字段语义来自前端组件 `PyGrkb`/`kcb`」，那是站点改版时唯一能回溯字段语义的线索
M8 比上游多 `.trim()`（改进）但未记录，且**边界位数无测试**（`{7,11}` 改错照样绿）
M9 `setTokenProvider` 传非函数时静默置 null
M10 **测试覆盖缺口**：`dqxq='11'` 分支、断开节次 `[1,2,5]`、`kcbjId` 回落键、`undergraduate`/`pending` 两个 README 明确承诺的字段**一条断言都没有**

---

## 上游覆盖度对账（代理做得极细）

### 6 个运行时导出 —— **6/6 有对应物，0 条第三态**

| 上游 | 本仓 | 判定 |
| --- | --- | --- |
| `HOST` | `yjsy.js:37` 同值 | 对应 |
| `requirements` | `package.json` 的 `dsh.capability` | 对应（换载体） |
| `class Yjsy` | `yjsy.js:107-151`，改 DI | 对应（签名有意改写） |
| `openYjsy` | `yjsy.js:368-385` | 对应 |
| `resolveTerm` | `yjsy.js:180-208` | **逐行同构** |
| `timetable` | `yjsy.js:225-353` | **逐行同构** |

**3 项显式丢弃 + 可核查理由**：`signIn`（D17 分层，但见 I8 无实现）、TS 类型、`runtime` 字段。

### `timetable()` 返回结构：**逐字段完全一致，0 处改名、0 处改结构、0 处增删**

代理逐字段核对了 `term.*`、`entry`、`timezone`、`periodTimes[]`、`count`、`courses[]` 及其全部子字段、`meetings[]` 全部 7 个字段。

**「这条没得挑，且比多数包做得好。」**

### 上游坑点保留情况：19 条里 17 条保留

**最完整的三条**：
- 「本科账号在研究生入口换 token 返 500 无效用户信息」—— 代码 + 注释 + 测试三处都有
- 「第 14 节官方页面写 22:05」—— 连「不照接口写」的原因都保留了
- 「冬夏学期周次接着秋春数」—— 含反直觉理由

**唯一实质遗漏**：字段语义来自前端组件代码 `js/app.*.js` 的 `PyGrkb`/`kcb`（M7）。

---

## 做得对的地方（代理列了 10 条）

其中最有价值的三条：

1. **`timetable()` 返回结构零差异** —— 「跨仓移植里最容易漂的地方，这里没漂」
2. **测试对「夹具自己会造出假阳性」有自觉** —— `tests/yjsy.test.mjs:180-188` 特意按 `pkxq` 分岔，避免同一假响应被两个小学期各读一遍。代理评价：「这句注释本身就是价值」
3. **`openYjsy` 的双入口兜底与双原因报错比上游更实在** —— 上游 `signIn` 遇 `AuthExpired` 会直接中断循环，本仓两个入口都试完再拼出两边原话

---

## 三个包的横向对比

| | cnki | chalaoshi | **yjsy** |
| --- | --- | --- | --- |
| 测试数 | 31 | 23 | 21 |
| 全绿 | ✅ | ✅ | ✅ |
| 阻断 | 5 | 2 | **1** |
| 缺陷位置 | 数据层（传输/登录/cookie） | 数据层（hot 公式、缓存） | **宿主入口层（`jar: null`）** |
| 解析层质量 | 高（`queryJson` 逐字段一致） | 高（10 档逐档一致） | **很高（返回结构零差异）** |
| 共同根因 | **夹具配合实现** | **夹具配合实现** | **只测纯函数、不测装配** |

**一个新出现的模式（yjsy 特有）**：
前两个包的缺陷都在**被测过的代码里**（数据层有测试，但测错了方向）；
yjsy 的缺陷在**完全没被测的代码里**（`index.js` 零覆盖）。

这两类病因不同，修法也不同：
- cnki/chalaoshi → **换夹具、补集成测试**
- yjsy → **给 `apply()` 补测试**（这个包的数据层其实很好）

---

## 修复优先级

| P0 | 项 |
| --- | --- |
| | **B1 `jar: null`** —— 一行修好，但决定包是否可用 |
| | **I2 缓存不看 username** —— 隐私泄露 |
| | **I8 CAS 取票件缺失** —— 决定「能不能真的拿到 token」 |
| P1 | I1 错误码翻译、I3 并发串行化、I5 methods/action 不一致、I7 补集成测试 |
| P2 | M1/M2/M3/M4/M5/M7/M10 |
