# @lybx-leyw/dsh-zju-source-zdbk

浙大**教务系统**（`zdbk.zju.edu.cn/jwglxt`）数据源：成绩与 GPA、考试安排、课表、
培养方案、自主选课的查询与写操作。纯 JavaScript（ESM，无 TypeScript），本仓原生实现。

**读方法 + 写方法都在本包，但写方法只能经 `packages/tool/campus-write` 批准后调用。**
见下面 [写操作去哪了](#写操作去哪了)。

> ⚠️ 这一行早先写的是「**只读**」。那与代码直接矛盾：`src/writes.js` 实现了
> `selectCourse` / `dropCourse` / `reorderCourse`，`src/index.js:498` 的
> `writeMethods` 把它们注册在服务面上，`readOnly` 是 `false`。
> 分层结果是「写方法的**审批**在 tool 层」，不是「数据包里没有写方法」。

## 能力

| 方法 | 作用 | 主要参数 |
| --- | --- | --- |
| `zdbk.grades` | 成绩列表 + 该范围的 GPA 汇总；评教没做完时多一个 `evaluationPending` 说明**为什么本学期成绩是空的** | `academic_year` / `semester` / `major_only` |
| `zdbk.gpaSummary` | 总体 / 专业 / 分学期 GPA | 无 |
| `zdbk.exams` | 考试安排（期中 + 期末） | `academic_year` / `semester` / `upcoming_only` |
| `zdbk.timetable` | 课表（按星期与节次排好） | `academic_year` / `term` |
| `zdbk.planList` | 某年级的培养方案列表 | `year` / `college` / `major` |
| `zdbk.planView` | 本人（或指定专业）的培养方案 + PDF 链接 | `year` / `major` |
| `zdbk.selectionContext` | 当前选课学期、可填志愿数、页签列表 | 无 |
| `zdbk.selectionCourses` | 某个页签下的课程（自动翻页取全） | `category` / `name` |
| `zdbk.selectionSearch` | 按条件搜索本学期开设的课 | `keyword` / `field` / `conditions` / `relation` / `only_available` |
| `zdbk.selectionSections` | 一门课的教学班（教师/时间/地点/余量） | `course` / `pool` / `category` / `search` |
| `zdbk.selectionSelected` | 本人已选上的课与待筛选的志愿 | `with_credits` |
| `zdbk.selectionCredits` | 选课系统汇总的本学期学分 | 无 |

`method` 一律是 `zdbk.<函数名>`。这是 omni 时代的调用口径，**刻意保留**：
「今天」页与脚本里已经写着 `zdbk.timetable`，改名的收益不够抵一次全线改名。

方法名与路由 action 名是**同一份**（`src/index.js` 里的 `READ_METHODS` 数组，
一个来源）。这条曾经出过错：表里叫 `selectionContext`、文档里写 `selection.context`，
于是「文档能用、代码报 INVALID_METHOD」。

### 会话（对应上游 `zdbk session login` / `status` / `logout`）

登录态**不在**上面那张数据方法表里 —— 那张表走的是「每次调用都读一次业务数据」
那条链，把「查登录状态」塞进去会让它触发一次 CAS 登录，正好是这条接口要避免的事。
它们挂在同一个服务（`zwZdbk`）上：

```js
await zdbk.status();  // 不联网：{ logged_in, account_known, account, session_file, … }
await zdbk.login();   // 真登一次 + 读一次业务接口（force 默认 true）
await zdbk.logout();  // 清本地会话（{ cleared: true }），不碰凭据
await zdbk.hasSession(); // 只看 jar 里有没有 JSESSIONID
```

`logout` 走 `session.clear({ persist: true })`：**立即落盘**。`SessionStore.clear()`
默认是延迟落盘的（为了登录前那次清空不必白等一次 DPAPI 子进程）；登出若也跟着延迟，
进程恰好退出时磁盘上的旧会话就会「复活」—— 那是安全问题，不是性能问题。

## 写操作在哪、谁来批准

D17 分层：**读进数据包，写操作的注册与审批进 `packages/tool/`**。
写方法的**实现**留在本包（它需要 `ZdbkClient` 的单次写请求语义、`pool`/`category` 解析、
志愿组顺序计算），`campus-write` 只负责「Prepare → 审批 → Execute」。
教务这边对应上游 `vendor/zju-assistant/core/zju/lib/zdbk/xsxk.ts` 里的三个方法：

| 上游 provides | 归哪 | 为什么 |
| --- | --- | --- |
| `zdbk selection select` | **`packages/tool/campus-write`** | 提交一个教学班志愿，会改学校的选课数据 |
| `zdbk selection reorder` | **`packages/tool/campus-write`** | 调整志愿顺序，同样服务端有状态 |
| `zdbk selection drop` | **`packages/tool/campus-write`** | 退选，可能让别人抢走位置，不可逆 |

这三条的**接口**是 `zdbk.selectCoursePrepare` / `selectCourseExecute` 这样成对的方法
（`index.js:498` 的 `writeMethods`），**只能由 `tool/campus-write` 在审批通过后调用**；
它们不在 `READ_METHODS` 表里，路由也不会暴露成读动作。

> ⚠️ 这段早先写的是「这三条在**本包不存在**」。那是错的：三处都不实 ——
> `writes.js` 完整实现了它们，`index.js` 注册到了服务面，`client.js` 的 `postOnce`
> 就是单次写请求语义。

`packages/tool/campus-write` 已经建成（7 个工具 / 22 条写操作），但**没有挂进
profile 也不在 preset 里**，所以实机上还没有入口。
另有两条参数契约断裂：`drop` / `reorder` 工具层不传 `section`，会在 prepare 抛错
（`coverage-gaps.md` 的 Y-7）。

## 培养方案（plan view / plan list）

| 上游 | 本包 | 差别 |
| --- | --- | --- |
| `plan list`（`findPlans`） | `zdbk.planList` | 同：某年级方案 + 按学院/专业名本地筛 |
| `plan view`（`viewPlan`） | `zdbk.planView` | **本包只给 PDF 链接，不下载文件** |

两处要写清楚的：

1. **年级默认是「本人年级」，那要走一次选课首页**。正方的培养方案接口要
   `nj` + `zydm`，而这两个值**只**出现在选课首页的隐藏 input 里 —— 没有
   「我是谁」的独立接口。代价是它在非选课期可能不可用，所以两个方法都允许
   显式给 `year`：给了就完全不碰选课首页。
2. **不下载 PDF**。上游会 `fs.writeFileSync` 把 PDF 存到 `paths.output()` 再返回路径。
   本包只返回 `pdf_url`（绝对地址，可直接交给浏览器）：
   `Transport` 返回的是 `response.text()`，PDF 是二进制，为一条链接加一条二进制通道
   不划算，也让一个只读数据包多出「写本地文件」的职责。

学院/专业筛选在**本地**做（与上游一致）：服务端那两个参数要的是**代码**，
而用户手里是「计算机科学与技术」这种名字。

## 自主选课（6 条查询）

| 上游 | 本包 |
| --- | --- |
| `selection context` | `zdbk.selectionContext` |
| `selection courses` | `zdbk.selectionCourses` |
| `selection search` | `zdbk.selectionSearch` |
| `selection sections` | `zdbk.selectionSections` |
| `selection selected` | `zdbk.selectionSelected` |
| `selection credits` | `zdbk.selectionCredits` |

### 这一族的响应形态与成绩那族**不一样**

| | 成绩 / 考试 / 课表 | 自主选课 |
| --- | --- | --- |
| 响应外壳 | jqGrid `{ items, totalResult }` | **裸数组** `[{ xkkh, kcmc, … }]` |
| 分页 | `queryModel.showCount` / `currentPage` | **行号区间** `kspage` / `jspage` |
| 条件位置 | 表单体 | 表单体（相同） |

所以用到 `ZdbkClient.postArray`（只收数组），而不是 `post`（只收对象）。
把 `postOnce` 放宽成「对象或数组都收」最省事，但那样成绩/课表那一族的
形态校验就一起失效了 —— 它们**必须**是对象。

### 几个必须按原样处理的坑

- **`xkzyfz` 是志愿组号**（同课多志愿）。没有组号时本色自成一组
  （`preferenceGroup`）。不分组会让「同课三个志愿」看起来像三门不同的课。
- **`sxbj` 只有 `1`（已选上）/ `0`（待筛选）是已知的**，其余一律 `未知`。
  猜一个「待筛选」会让用户以为还有希望，猜「已选上」更糟。
- **`order` 是组内志愿次序**，不是全局序号。
- **容量是 `"余量/容量"` 一个字符串**（`5/60`）。拆错的表现是「余量显示成 60」——
  页面上看不出错，只是课满了照显示有位置。
- **教学班响应里没有 `kcdm`**。那不是异常，正方只在那条查询的上下文里知道
  「这是哪门课的教学班」，所以要把本次查询的课程代码当兜底传下去。
- **课号带学年学期**（`(2025-2026-1)-CS1001G-0012345-1`）。拿上学期的号去提交/查询，
  正方不报错、只回空列表 —— 所以 `assertSelectionTerm` 在**发请求之前**就拦。
- **页签要从 `onclick` 里取，不能从 `data-dl`**。部分页签的 `data-dl` 与真正传给
  `categroyClick()` 的参数不一样；按 `data-dl` 取会让「点这个页签看到的课」与
  「这个接口返回的课」差一整类，而且不报错。
- **分页会回退**（数据变动时第 3 页可能返回第 2 页的内容）。所以逐页查重，
  命中重复就报 `PAGINATION_UNSTABLE`：**宁可说「结果不完整」，也不给半份数据**。
- **空数组是「没有」**，不是错误（这门课这学期确实没开教学班）。
  与成绩那族的「缺 `items` 字段 = 接口变了」正好相反 —— 别把两边的判据混了。

### 三种页签三种走法，`special` 明确未接入

`selectionContext` 返回的每个页签带 `kind`：

- `courses` → 走 `selectionCourses`；
- `search`（`xk_9`）→ 走 `selectionSearch`；
- `special`（`xk_1_1` 补考、`iconyjsxk` 研究生选课、`xk_7`）→ **未接入，明确报错**。

报错而不是回空列表：空列表会被读成「这学期没有这种课」，一个看起来正常的谎。

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
import { readCard } from '@lybx-leyw/dsh-zju-source-login';
const account = await readCard(ctx); // { username, password } 或 null
```

写入方是「设置 → 浙大一卡通」，本包**只读不写** —— 一个数据包不该替用户保存密码，
否则「设置里配的是什么」和「实际在用的是什么」迟早分叉。

### ⚠️ 教务的 CAS **必须带 `service`**，这与学在浙大相反

这是本包与 `@lybx-leyw/dsh-zju-source-campus` 唯一的实质差别，也是最容易照抄错的一处：

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

`/api/zw-zdbk`（走宿主的 `connection.fetch`，与 study / vault / notes 同一条受鉴权通道）

```text
GET  /api/zw-zdbk   → { ok: true, value: { methods: [...] } }        自描述
POST /api/zw-zdbk   → { type:'client-request', rpcId, method:'zdbk.timetable', payload:{ academic_year:'2025-2026', term:'秋' } }
                        ← { type:'server-response', rpcId, result:{ ok:true, value:{…} } }
```

POST 的 `method` 既接受**顶层**（本包约定的形态），也接受 `payload.method`
（omni 时代的口径）—— 两种信封都已在用的调用方不该为一个字段改名。

宿主侧也可以直接拿服务：

```js
const zdbk = ctx.get('zwZdbk');
await zdbk.timetable({ academic_year: '2025-2026', term: '秋' });
await zdbk.gpaSummary();
await zdbk.planList({ year: '2025', college: '计算机' });
await zdbk.selectionContext();
await zdbk.selectionSelected({ with_credits: false });
await zdbk.status();       // 不联网
await zdbk.hasSession();   // 只看 cookie，不发请求、不登录
await zdbk.logout();       // 清本地会话
```

⚠️ 服务上的方法名与 `describe()` 里的 `method` 表（`dsh.` 前缀之后那一段）
必须一一对应 —— 有一条测试逐条比对这两份东西。

## 复用的共享层（**不复制**）

```js
import { Transport, SessionStore, ClassroomError } from '@lybx-leyw/dsh-zju-source-http';
import { readCard } from '@lybx-leyw/dsh-zju-source-login';
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

### 上游覆盖度（17 条 provides 逐条对账）

上游 `vendor/zju-assistant/core/zju/lib/zdbk/module.json` 声明 17 条 provides。
**不允许第三态** —— 每条都在下面这四类之一：

| 上游 provides | 状态 | 落在哪 |
| --- | --- | --- |
| `zdbk timetable` | **本仓已有** | `zdbk.timetable` |
| `zdbk exams` | **本仓已有** | `zdbk.exams` |
| `zdbk grades` | **本仓已有** | `zdbk.grades` |
| `zdbk plan view` | **本次新增** | `zdbk.planView`（只给 PDF 链接，不下载） |
| `zdbk plan list` | **本次新增** | `zdbk.planList` |
| `zdbk selection context` | **本次新增** | `zdbk.selectionContext` |
| `zdbk selection courses` | **本次新增** | `zdbk.selectionCourses` |
| `zdbk selection search` | **本次新增** | `zdbk.selectionSearch` |
| `zdbk selection sections` | **本次新增** | `zdbk.selectionSections` |
| `zdbk selection selected` | **本次新增** | `zdbk.selectionSelected` |
| `zdbk selection credits` | **本次新增** | `zdbk.selectionCredits` |
| `zdbk selection select` | **归 tool** | `packages/tool/campus-write`（本次未建） |
| `zdbk selection reorder` | **归 tool** | `packages/tool/campus-write`（本次未建） |
| `zdbk selection drop` | **归 tool** | `packages/tool/campus-write`（本次未建） |
| `zdbk session login` | **本仓已有** | 服务面 `zwZdbk.login()`（= 上游 `verify`：真登 + 真读一次） |
| `zdbk session status` | **本仓已有**（本次补成独立方法） | 服务面 `zwZdbk.status()`（不联网）+ 既有 `hasSession()` |
| `zdbk session logout` | **本仓已有**（本次补成独立方法） | 服务面 `zwZdbk.logout()`（`persist: true`） |

**明确丢弃：0 条。**

上游 `module.json` 里 `"writes": true`，本包 `package.json` 的
`dsh.capability.writes` 是 **`false`** —— 那是分层的结果，不是声明漏了。

另外上游 `pyfagl.ts` 有三个**不在 provides 里**的辅助函数，本仓的处理是：

| 上游函数 | 本仓 | 理由 |
| --- | --- | --- |
| `listPlans` / `listMajors` / `getMyPlanId` | `plansOfYear` / `myPlanIdentity`（内部） | 它们不是 provides，是 `findPlans`/`viewPlan` 的零件。`listMajors`（专业下拉）本仓**未实现** —— 它只服务于「按代码填筛选框」那条交互，而本包的筛选走名字。 |
| `downloadPdf` | **丢弃** | 见已知限制 5：本包只给 `pdf_url`。 |

## 已知取舍（如实说明，别当成已完成）

1. **网络出口走共享层，自动分域。** 本包不再自己配出口：请求经
   `sharedFetch(ctx)` 借 `@lybx-leyw/dsh-zju-source-campus` 提供的 `zwEgress` 服务 ——
   校内直连、校外自动绕 WebVPN，并**绕开宿主为 LLM 配的全局代理**
   （浙大站点经那个代理基本必失败）。出口只有一份，各包共用同一个 undici
   dispatcher 与同一份 WebVPN 会话（各自登录会互相踢掉）。
   campus 没装时退回 `globalThis.fetch`：仍能直连，但校外会失败。
2. **`average_score` 的等级制折算表是本仓的**，不是学校公布的换算表。
   它只影响这一个参考指标，不影响 `gpa_5` / `gpa_4_3`。
3. **节次时间表写死在 `PERIOD_TIMES`**（紫金港常规作息）。正方只给节次号、
   不给时间；换校区（如海宁、舟山）作息不同的话需要按校区覆盖。
4. **不提供成绩单导出 / 排名 / 学分预警**。

### 培养方案的已知限制

5. **`planView` 不下载 PDF**，只给 `pdf_url`。上游会存到本地再返回路径；
   本包的 `Transport` 是文本通道，PDF 是二进制。要「把文件拿到手」应该由
   `packages/tool/` 一侧做（它本来就有写本地文件的职责）。
6. **本人方案的年级/专业只能从选课首页推**。正方没有「我是谁」的独立接口，
   这两个值只出现在 `/xsxk/zzxkghb_cxZzxkGhbIndex.html` 的隐藏 input 里。
   所以不给 `year` 时，非选课期可能整条链不可用 —— 显式给 `year` 可绕开。
7. **学院/专业筛选是本地名字包含匹配**，不是服务端筛选。服务端那两个参数要代码。
   代价是一次要把整个年级取回来（约 150 条，`showCount=500` 一页够）。

### 选课查询的已知限制

8. **补考 / 研究生选课 / `xk_7` 特殊页签未接入**（`kind: 'special'`）。
   这些走独立流程，本包明确报 `UNSUPPORTED`，**不回空列表**。
9. **不做「选课窗口是否开放」的判断**。`selectionContext` 只回答「系统里现在挂着
   哪个学期」，那个开关在服务端，正方不通过这个页面暴露它。
10. **`selectionContext` 每次现取，不缓存**。选课期与志愿数会变，缓存一份旧上下文
    会让后面的查询带着过期的学期去问。
11. **`selectionSections` 要求回传 `pool`（课程号）而不是 `code`（课程代码）**。
    教学班接口按「这次查询的课程池」展开；只给课程代码服务端不知道在哪个池里找，
    回一份空列表 —— 不报错。
12. **页码上限 100 / 查询上限 20 个条件**：这是防守值，不是业务上限。超了直接报错，
    不静默截断。

### 上游不明确、本包按推测实现的地方（读的时候要留心）

13. **`kclab` 的 `kcbs` 空值语义**：`parseSelectionContext` 保留空串（不省成
    `undefined`），因为「没有这个参数」和「这个参数是空」在正方那边不一定等价。
    这一点**没有真实响应佐证**。
14. **`ylxs`（培养年限）原样回传到教学班接口**：上游是这么做的，本仓照搬，
    但**没有验证**过省略它会不会有不同结果。
15. **选课分页的 `size` 用 50**（正方允许的 1–50 上界）。上游也是 50，
    但没有实测过「一页取满 50 条时服务端是否稳」。
16. **`planList` 的翻页上限 20 页**是本仓加的防守（防止 `totalResult` 回成天文数字
    导致死循环），上游没有这个上限。正常一个年级是 1 页。

## 文件

```text
src/index.js      Cordis 插件（name / inject / apply）+ 数据路由 + 服务面
src/hosts.js      ZDBK_HOST / BASE / SERVICE / CAS_ENTRY / HOSTS / PATHS
                  + ZDBK_MODULES / ZDBK_PLAN_PATHS / ZDBK_SELECTION_PATHS / planPdfUrl
src/cas.js        带 service 的 CAS 登录 + RSA 打包 + 错误文案转述
src/client.js     ZdbkClient：post / postArray / html / grid + 状态码口径
src/parse.js      个人数据解析 + GPA 计算 + 学期推断 + 节次表（不碰网络）
src/plan.js       培养方案解析（不碰网络）
src/selection.js  选课解析：上下文、记录、容量、分页、搜索表单、视图（不碰网络）
src/match.js      按名字唯一定位（保留歧义，不挑第一个）
src/reads.js      ZdbkReader：12 个只读方法（编排）
src/errors.js     ZdbkError / fault（读取层也要抛，避免 import index.js 成环）
```

分层是「换掉任一层，另外几层不用动」：测试里塞一个假的 `ZdbkClient`
（实现 `post` / `postArray` / `html` / `grid` 四个通道）就能把整条读取链路
跑通，完全不碰网络与登录。

## 测试

```sh
node tests/zdbk.test.mjs
```

用 `node:test` + `node:assert/strict`，全部离线（假 `fetch` + fixture 数据）。
覆盖 GPA 的三种口径、学期推断、解析器形状、带 `service` 的入口 URL 构造、
以及「登录 + 真实业务读取」这条端到端链路。

本轮新增（培养方案 + 选课查询）的夹具**按上游注释推断，未经真实响应验证** ——
见测试文件里那一大段标注。它们能守住解析口径、错误码、分页/去重、消歧义这些
**逻辑**；不能证明「真实响应能被解析」。

⚠️ 测试**不碰 DPAPI**：`SessionStore` 要么不传 `file`（只存内存），
要么传一个自定义 `protect`。DPAPI 会 spawn 一个 PowerShell 子进程，
本机沙箱禁止 spawn。

⚠️ `manifest 与 bundle patch` 那条**基线就是红的**：`cordis.patch.yml` 里包名
带双引号（`name: "@lybx-leyw/…"`），而断言用的正则没算引号。不是本轮引入的，
按任务约定**不修**。
