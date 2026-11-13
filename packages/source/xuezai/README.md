# @lybx-leyw/dsh-zju-source-xuezai

学在浙大（`courses.zju.edu.cn`）数据源：**待办、课程活动、作业、课件、我的提交**。

纯只读（D17），`auth: cas`，`network: public`，`writes: false`。

## 这个包是什么

学在浙大是浙大的 TronClass 部署：学期 → 课程 → 课内活动/测验/课件/作业。
本包把「这门课有什么待办」与「点进一门课看细节」两件事做成一个数据源，
供规划页、脚本与 AI 工具消费。

**它是从 `@lybx-leyw/dsh-zju-source-campus` 拆出来的，不是新建。**
那个包原先同时装着学在浙大与拼题A，两者的凭据体系、错误码表、会话文件、
写入面都不一样，却共用一份 `apply()`、一条路由、一个服务：

| 问题 | 后果 |
| --- | --- |
| 装拼题A 就连带装上学在浙大的整套 CAS 与逐课抓取 | 依赖面与攻击面都被动扩大 |
| 两边要加能力都改同一个 924 行的 `index.js` | 一次改动同时影响两个平台的可用性 |
| `dsh.capability` 只能写一份 | `auth` / `network` / `writes` 都是并集，声明失去意义 |

现在学在浙大是本包，拼题A 归 `@lybx-leyw/dsh-zju-source-pta`。

## 能力（读取 + 下载）

服务名 `zwXuezai`，路由 `/api/zw-xuezai`。

| 方法 | 作用 | 端点 |
| --- | --- | --- |
| `todos()` | 待办清单（作业 + 测验 + 课堂互动） | `/api/todos?no-intercept=true`（默认）或 `5N` 个逐课端点 |
| `xzzdRead({action:'activities'})` | 课程活动列表 | `/api/courses/<id>/activities` |
| `xzzdRead({action:'assignments'})` | 作业列表（可逐条补提交状态） | `/api/courses/<id>/homework-activities` |
| `xzzdRead({action:'activity'})` | 单条活动详情（含附件与说明） | `/api/activities/<id>` |
| `xzzdRead({action:'materials'})` | 课件材料 | `/api/course/<id>/coursewares`（**单数** `course`） |
| `xzzdRead({action:'submission'})` | 我在某条作业上的提交 | `/api/activities/<id>/{students\<uid>,groups\<gid>}/submission_list` |
| `xzzdDownload({action:'materials'})` | **下载课件附件** | `/api/uploads/<id>/url` → 存储域 |
| `xzzdDownload({action:'homework'})` | **下载作业附件 / 本人提交 / 老师批改** | 同上（三类文件都走 `uploads/<id>/url`） |
| `downloadDir()` | 下载根目录（绝对路径） | — |
| `fingerprint()` | 会话指纹（换账号时变化） | — |
| `egress()` | 出口状态（校园网判定、是否经 WebVPN） | — |
| `loginProfile()` | 上次登录的分段耗时（诊断） | — |
| `reset()` / `invalidate()` | 丢本地会话 / 让待办缓存失效 | — |

路由动作（`POST` 需带头 `x-zw-xuezai: 1`）：

| 动作 | 方法 | 说明 |
| --- | --- | --- |
| `GET /api/zw-xuezai` | GET | `{ todos, egress }` |
| `?xzzd-read` | POST | 上面五个深入读取动作，参数走 body |
| `?xzzd-download` | POST | 两个下载动作，参数走 body |
| `?reprobe` | POST | 重新探测出口 |
| `?reset` | POST | 丢掉本地会话，下次调用重新走 CAS |
| 其它 | — | `400 未知动作` |

### 下载：落盘位置与安全边界

**目录由装配层定，调用方传不进路径。** 根是 `config.downloadDir`，默认
`<数据目录>/downloads`（`data/zw-xuezai/downloads`）；往下的层级由
`src/downloads.js` 按「课程 → 类别 → 作业」拼：

```text
<根>/数据结构/课件/第一讲.pdf
<根>/数据结构/第三次作业/题目.pdf          ← 老师给的附件
<根>/数据结构/第三次作业/我的答案.pdf      ← 本人最近一次提交
<根>/数据结构/第三次作业/老师批改/批注版.pdf
```

这条边界与 `source/cc98` 的 `topicDownload` 同口径：**让调用方传路径，等于让
平台上一份别人起的文件名决定本机写到哪。** 所以工具层的参数里连 `dir` 都没有。

文件名来自平台（老师能把它起名叫 `../../../.ssh/authorized_keys`），因此有两道：

1. `safeFileName()` 把分隔符、冒号、控制字符换成 `_`，剥掉结尾的点与空格，
   限长 180，Windows 保留设备名加前导 `_`；
2. `underRoot()` resolve 之后再核一次真实路径仍在根之下 —— 过滤是字符级的，
   越界是**路径语义级**的，只有 resolve 一遍才能发现。

**同名文件永不覆盖**，三档：

| 情形 | 处置 |
| --- | --- |
| 目标已存在、大小与平台一致 | **复用**（课件发布后不会换内容） |
| 目标已存在、大小不同或不知道 | 另存 `名字 (1).ext`，**不覆盖** |
| 同一批里两个文件本来同名 | 名字后带平台 id（`课件 (11).pdf`），**结果与平台返回顺序无关** |

提交类文件（本人提交、老师批改）每次都重下且**从不复用**：重交后同名内容会变，
而复用判据只有大小。

> ⚠️ 发布用 `link()` 而不是 `rename()`。**这个区别只在竞态下才看得见**：
> 检查通过之后、发布之前，目标可能被另一个进程建出来。`rename()` 会静默替换它，
> 两次都显示成功；`link()` 抛 `EEXIST`，于是「不覆盖」是内核保证的。
> `tests/source/xuezai/downloads.test.mjs` 里有一条专门制造这个竞态的用例。

`allow_download: false` 的文件**不下载**，也不去换签名地址 —— 那个标记是老师设的，
而本包正好是把字节变成本机文件的地方。

### `todos()` 的返回形状（下游需要按这个写）

```js
{
  xzzd: { ok: true, rows: [...], error: null },
  pta:  {
    ok: false, rows: [], notInThisPackage: true,
    providedBy: '@lybx-leyw/dsh-zju-source-pta',
    error: { code: 'NOT_IN_THIS_PACKAGE', message: '…' },
  },
}
```

**⚠️ `pta` 这一半不在本包。** 拆包前 `campus.todos()` 同时返回两半，而
`core/planning` 期待的是一份**合并结果**。合并由集成层做（它同时持有
`zwXuezai` 与 `zwPta`）。

`pta` 键**保留**而不是删掉，理由是可识别性：合并方据此丢弃这一半，
而不是把它当成「拼题A 读取失败」显示给用户。若直接删掉，合并方就得写
`if ('pta' in result)` 之类的判断，而漏判的表现是页面**静默少掉一整类待办**
—— 比一个能被识别的哨兵更糟。

`rows` 的每一项：

```js
{ source: 'xzzd', sourceLabel: '学在浙大', id, title, detail, due, dueText, url, kind: 'todo' }
```

### 几处「宁可报错也不猜」的地方

- **课程 id 只认纯数字**：`'7.9'` 会被 `Number()` 静默截成 7，于是拿错 id 的调用方
  会去读**另一门课**的数据且不报错。本包判非法（`INVALID_INPUT`）。
- **当前学生 id 从「谁读过」反推**：拿到多个不同 id 时报 `IDENTITY_UNAVAILABLE`，
  **不猜** —— 猜一个就是去查别人的提交（既是错的，也是越权的）。
- **单个端点 403 只丢那一类**：一门课某个栏目没权限不等于整门课挂了。
  但 `SESSION_EXPIRED` / `RATE_LIMITED` / `API_SHAPE` 必须抛 —— 降级成空
  会让用户以为「没有作业」。
- **`unknown` 与 `unsubmitted` 严格分开**：取不到提交状态时说「不知道」，
  不说「未提交」。
- **CAS 失败时不猜原因**：只转述站点**明确写出**的文案；页面没写就如实说没写。
  这里有过一次真实误判（把网络失败报成「密码错了」），复盘在
  [`src/cas/login.js`](src/cas/login.js) 的 `casErrorMessage()` 上。
- **附件「禁止下载」有否决权**：任一来源标 `allow_download: false`，结果就是禁止。

## 与上游 `xuezai` 模块的关系（如实陈述）

上游指 `packages/vendor/zju-assistant/core/zju/lib/xuezai/`（10 文件 128 KB，
`module.json` 声明 `auth: cas`、`network: public`、`writes: true`、18 条 provides）。

**本包不是上游的移植。** 两边是对着同一个平台、同一批端点各自独立实现：

| | 上游 | 本包 |
| --- | --- | --- |
| 出身 | 独立实现 | **本仓原生实现**，从 `source/campus` 拆出 |
| 代码来源 | 自己的 `client.ts` / `homework.ts` / `materials.ts` … | 本仓的 `xzzd.js`（717 行）+ `xzzd-reads.js`（518 行） |
| 与上游的代码关系 | — | **无复制关系**；接口契约来自对平台 XHR 的观察，以及本仓 Flutter 版的实测口径 |
| 登录 | 自己做 CAS | 复用本仓 `cas/login.js`（从 campus 逐字搬来） |
| 传输 | 自己的 `client.ts` | `@lybx-leyw/dsh-zju-source-http` 的 `Transport` |
| 数据 | 登录后数据，**非公开** | 同上 |

### 上游覆盖度：本包缺哪些

| 上游能力 | 本包 | 说明 |
| --- | --- | --- |
| `xuezai todos` | ✅ | `/api/todos`（1 请求）与逐课（5N 请求）两条路 |
| `xuezai course list` | ✅ 内部 | `XzzdApi.activeSemesterIds()` / `courses()`，未单独暴露 |
| `xuezai course view` | ⚠️ 部分 | 有 `activities` / 材料；**没有**课程模块（module）树/章节目录 |
| `xuezai material list` | ✅ | `materials` |
| `xuezai material download` | ✅ | `xzzdDownload({action:'materials'})`：按名字 / id 挑，或显式 `all` |
| `xuezai homework list` | ✅ | `assignments` |
| `xuezai homework view` | ✅ | `activity` + `submission`（说明、附件、我的提交、分数、评语） |
| `xuezai homework download` | ✅ | `xzzdDownload({action:'homework'})`：附件 / 本人提交 / 老师批改三类 |
| `xuezai homework submit` | ❌ | **写操作，归 `packages/tool/campus-write`** |
| `xuezai homework retract` | ❌ | 同上 |
| `xuezai rollcall` | ✅ | `writes.js` 的 `rollcall`：雷达走 13 个参考点，数字走另一条端点 |
| `xuezai rollcall number` | ✅ | 合进上面的 `rollcall`（给 `code` 即数字点名） |
| `xuezai rollcall all` | ✅ | `rollcall-batch.js` 的 `createRollcallBatch`：自己列当前点名、逐个签（W-5） |
| `xuezai rollcall status` / `history` | ✅ history | `rollcallHistory()`（纯 GET）；**没有**独立的 status 动作 |
| `xuezai session login` / `status` / `logout` | ⚠️ 部分 | 登录在 `openTransport()` 里自动发生；有 `reset()`；**没有**独立的 status/logout 动作 |

## 「写操作去哪了」

上游 `xuezai` 的写能力（**提交作业、撤回提交、单次签到、批量签到**）中，
**审批与 tool 注册**按 D17 归 `packages/tool/xuezai`（`campus_homework` / `campus_checkin`）。
但**写方法本身在本包** —— 它们需要本包的会话、端点判定与 13 个参考点常量，
搬到 tool 层等于把那套知识抄一遍。

所以「本包只发 GET」这句话是**错的**，`dsh.capability.writes` 是 `false` 也不是
因为代码里没有写请求：

| 写动作 | 实现位置 | 平台接口 |
| --- | --- | --- |
| 交作业 / 撤回 | `writes.js` `submitHomework` / `retractHomework` | `POST …/submissions`、`DELETE …/submissions/{id}` |
| 单次签到 | `writes.js` `rollcall` | `PUT /api/rollcall/{id}/answer`（数字走 `answer_number_rollcall`） |
| 批量签到 | `rollcall-batch.js` `createRollcallBatch` | 同上的编排 + `GET /api/radar/rollcalls` |

`dsh.capability.writes: false` 与 `zdbk` / `tyys` / `sztz` 同一口径：那个标志判的是
**数据包自己会不会去改上游**，而写动作必须由 tool 层带着审批进来才发得出去。

### 批量签到与单次签到**不是同一个动作**

这是 `rollcall-batch.js` 文件头那条判据，README 也记一遍：

| | `rollcall`（单次） | `rollcallAll`（批量） |
| --- | --- | --- |
| 谁决定签哪个 | 调用方给 id / 课程名 | 它自己列当前点名、自己挑待签的 |
| 数量 | 1 个 | 0..N 个 |
| 时间形态 | 一次应答 | 可多轮扫（`passes`） |

把批量「简化」成给 `rollcall` 传个空参数，会造出一个**看起来有、实际只签一次**的
假能力 —— 而点名窗口只有几分钟，那正是最需要它自己找的时候。

## 登录与会话

凭据**只读不写**：唯一的权威来源是「设置 → 浙大一卡通」写入的那一份记录
（`@lybx-leyw/dsh-zju-source-login` 的 `readCard`）。本包每次现读、不缓存 ——
凭据服务可能晚于本包就绪，缓存 `null` 的后果是「配了也一直说没配」。

会话落在 `data/zw-xuezai/xzzd.session`（Windows DPAPI 加密、按用户绑定）。

**拆包迁移**：首次装配时若新文件不存在而旧文件
`data/zw-campus/xzzd.session` 存在，**按字节复制**过去（同一台机器、
同一个 Windows 用户，DPAPI 密文原样可解）。只复制，不删除旧文件 ——
campus 的退役由 OWNER 统一处理。

若智云课堂（`zwClassroom`）恰好已有一张 SSO 票，就拿来用，省掉一整条 CAS。
这是**运行时软依赖**（`ctx.get`），没装 classroom 时整体跳过。
同号两次 CAS 登录会互相作废 ticket，所以能复用就复用。

## 已知限制

1. **没有设置分区。** 凭据在 `@lybx-leyw/dsh-zju-source-login` 的「浙大一卡通」
   分区里（与智云课堂共用一份），本包自身没有任何用户可配置项 ——
   与 `yjsy` / `zdbk` / `classroom` 同口径。**需要在
   `tests/source-settings.test.mjs` 的 `NO_SETTINGS` 里加一行。**

2. **没有客户端半边（`src/client.jsx`）。** 拆包时 campus 的客户端半边
   只服务拼题A 的 Cookie 设置；学在浙大没有设置项，所以没有对应 UI。

3. **`/api/todos` 与逐课两条路的口径没有定论。** 「`/api/todos` 会漏」这句话
   在本仓与上游传了几手，但**从未有数据**。`ZW_TODOS=diff` 会两条都跑并
   输出差异（`diffTodos()` 按 `courseId:type:id` 比对），要核实随时可跑。
   已知的结构性差异：聚合端点不返回**课堂互动**（`classroom` 类），
   以及不做「满分即完成」的过滤。

4. **`materials` 依赖 `conditions` 参数口径**（按章节排序、排除 `lesson` 类型）。
   这条照抄上游，未独立验证「不传会混进课堂互动」这个断言。

5. **没有课程模块（module/章节）树。** 上游的 `listModules` / `courseTree` 没有搬。
   影响：无法按章节组织材料，只能平铺。

6. **下载与 `core/*` 的关系（D21 的更正口径）。** D21 的原文是「下载由
   `packages/core/*` 执行；`source/*` 只暴露下载所需的全部参数」。它的原文曾被
   转述成「`source/*` 不碰文件系统」，而**用户从未这样裁决过** —— 2026-11-12
   已更正（见 `.work/abandoned.md` 1.1）。所以本包落盘不违规。

   而 `packages/core/` 里至今**没有**下载执行方，所以选择在 source 补齐：
   「upload id → 签名 URL」「哪个 id 属于哪条活动」「`allow_download` 要不要尊重」
   都是站点知识，只有数据源知道；真正与业务无关的字节搬运那一层已经上移到
   tier 0 的 `@lybx-leyw/dsh-zju-source-http` 的 `download()`。core 将来若要接，
   接的是那个函数，不是再抄一遍协议。

7. ~~**共享下载器暂时有两份。**~~ → **2026-11-12 已合并**：
   `source/classroom` 删掉了自己那份 `src/download.js`，改为引用
   `source/http/src/download.js`（`package.json` 加依赖、`dsh.capability.requires`
   加一项）。现在**全仓只有一份下载器**，`classroom` 的下载测试
   （`classroom-download.test.mjs`）作为回归网。

   合并时 `classroom` 顺带获得了本文件的两项能力：跟随重定向、只允许 HTTPS
   （回环地址例外）。它原先不跳转，多跟几次没有坏处。

8. **没有做并发下载。** 一批文件顺序下。学在浙大对同一会话的并发请求本就排队
   处理（`xzzd.js` 有实测），并发只会让「第几个失败」不可复现，而失败信息
   恰恰是下载最要紧的输出。

9. **`egress()` 只是转述。** 出口策略与 WebVPN 会话都在 tier 0 的
   `@lybx-leyw/dsh-zju-source-http` / `source-webvpn` 里，本包不改它、也不
   自己登录网关。没装那个服务时如实返回 `{ mode: 'unavailable', reason }`。

10. **`loginProfile` 只在 `ZW_PROFILE_TODOS=1` 时收集。** 生产不带这个变量，
    所以它是 `null`。

11. **离线验收覆盖不到真实契约。** 全部测试用假 `request` / 假 `api`，
    端点单复数、字段名、过滤口径都是照既有实现钉住的 —— 平台改字段时，
    这些测试不会替你发现，只会发现「本包自己改了」。

## 测试

```powershell
node --test "tests/source/xuezai/*.test.mjs"
```

全部离线：假 `ctx`、假 `Transport`、假 `XzzdApi`。不联网、不读凭据。
下载相关的用例把文件落到 `os.tmpdir()` 下的临时目录，用完删。
集成层（`apply()`）用最小 cordis 替身验证服务名、路由路径、动作分派与错误分支。

| 文件 | 覆盖 |
| --- | --- |
| `downloads.test.mjs` | 共享下载器（续传 / 不覆盖 / 路径穿越 / 失败隔离）与文件命名 |
| `download-wiring.test.mjs` | `apply()` → `xzzdDownload` → 路由，以及「目录由装配层定」 |
