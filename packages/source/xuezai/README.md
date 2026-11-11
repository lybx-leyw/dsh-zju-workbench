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

## 能力（7 个只读方法）

服务名 `zhiyunXuezai`，路由 `/api/zhiyun-xuezai`。

| 方法 | 作用 | 端点 |
| --- | --- | --- |
| `todos()` | 待办清单（作业 + 测验 + 课堂互动） | `/api/todos?no-intercept=true`（默认）或 `5N` 个逐课端点 |
| `xzzdRead({action:'activities'})` | 课程活动列表 | `/api/courses/<id>/activities` |
| `xzzdRead({action:'assignments'})` | 作业列表（可逐条补提交状态） | `/api/courses/<id>/homework-activities` |
| `xzzdRead({action:'activity'})` | 单条活动详情（含附件与说明） | `/api/activities/<id>` |
| `xzzdRead({action:'materials'})` | 课件材料 | `/api/course/<id>/coursewares`（**单数** `course`） |
| `xzzdRead({action:'submission'})` | 我在某条作业上的提交 | `/api/activities/<id>/{students\<uid>,groups\<gid>}/submission_list` |
| `fingerprint()` | 会话指纹（换账号时变化） | — |
| `egress()` | 出口状态（校园网判定、是否经 WebVPN） | — |
| `loginProfile()` | 上次登录的分段耗时（诊断） | — |
| `reset()` / `invalidate()` | 丢本地会话 / 让待办缓存失效 | — |

路由动作（`POST` 需带头 `x-zhiyun-xuezai: 1`）：

| 动作 | 方法 | 说明 |
| --- | --- | --- |
| `GET /api/zhiyun-xuezai` | GET | `{ todos, egress }` |
| `?xzzd-read` | POST | 上面五个深入读取动作，参数走 body |
| `?reprobe` | POST | 重新探测出口 |
| `?reset` | POST | 丢掉本地会话，下次调用重新走 CAS |
| 其它 | — | `400 未知动作` |

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
`zhiyunXuezai` 与 `zhiyunPta`）。

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
| `xuezai material download` | ❌ | 只给附件元数据与 `allow_download`，不下载文件 |
| `xuezai homework list` | ✅ | `assignments` |
| `xuezai homework view` | ✅ | `activity` + `submission`（说明、附件、我的提交、分数、评语） |
| `xuezai homework download` | ❌ | 同上，不下载 |
| `xuezai homework submit` | ❌ | **写操作，归 `packages/tool/campus-write`** |
| `xuezai homework retract` | ❌ | 同上 |
| `xuezai rollcall` | ❌ | 点名签到是**写操作**：`packages/tool/campus-write` |
| `xuezai rollcall number` | ❌ | 同上（还要字幕识别，属工具层） |
| `xuezai rollcall all` | ❌ | 同上 |
| `xuezai rollcall status` / `history` | ❌ | 严格说历史是只读，但上游把它和签到绑定；本包未实现 |
| `xuezai session login` / `status` / `logout` | ⚠️ 部分 | 登录在 `openTransport()` 里自动发生；有 `reset()`；**没有**独立的 status/logout 动作 |

## 「写操作去哪了」

上游 `xuezai` 的写能力（**提交作业、撤回提交、点名签到、雷达点名解算**）
按 D17 归 `packages/tool/campus-write`，**不在本包**。

本包的全部请求都是 `GET`；`todos()` 与五个 `xzzdRead` 动作没有任何提交路径。
`dsh.capability.writes` 因此是 `false` —— 这条声明与代码一致，
`tests/source-capability.test.mjs` 会检查 `requires` 与 import 的一致性，
`tests/xuezai.test.mjs` 里另有一条断言「深入读取全程只发 GET」。

## 登录与会话

凭据**只读不写**：唯一的权威来源是「设置 → 浙大一卡通」写入的那一份记录
（`@lybx-leyw/dsh-zju-source-login` 的 `readCard`）。本包每次现读、不缓存 ——
凭据服务可能晚于本包就绪，缓存 `null` 的后果是「配了也一直说没配」。

会话落在 `data/zhiyun-xuezai/xzzd.session`（Windows DPAPI 加密、按用户绑定）。

**拆包迁移**：首次装配时若新文件不存在而旧文件
`data/zhiyun-campus/xzzd.session` 存在，**按字节复制**过去（同一台机器、
同一个 Windows 用户，DPAPI 密文原样可解）。只复制，不删除旧文件 ——
campus 的退役由 OWNER 统一处理。

若智云课堂（`zhiyunClassroom`）恰好已有一张 SSO 票，就拿来用，省掉一整条 CAS。
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
   在本仓与上游传了几手，但**从未有数据**。`ZHIYUN_TODOS=diff` 会两条都跑并
   输出差异（`diffTodos()` 按 `courseId:type:id` 比对），要核实随时可跑。
   已知的结构性差异：聚合端点不返回**课堂互动**（`classroom` 类），
   以及不做「满分即完成」的过滤。

4. **`materials` 依赖 `conditions` 参数口径**（按章节排序、排除 `lesson` 类型）。
   这条照抄上游，未独立验证「不传会混进课堂互动」这个断言。

5. **没有课程模块（module/章节）树。** 上游的 `listModules` / `courseTree` 没有搬。
   影响：无法按章节组织材料，只能平铺。

6. **不下载文件。** 附件只给元数据（`id` / `name` / `size` / `mimeType` /
   `allowDownload`），不给下载流。`allow_download` 只做**透传标记**，
   本包不据此拦截 —— 因为它既不下载也不代理，标记是给消费方看的。

7. **`egress()` 只是转述。** 出口策略与 WebVPN 会话都在 tier 0 的
   `@lybx-leyw/dsh-zju-source-http` / `source-webvpn` 里，本包不改它、也不
   自己登录网关。没装那个服务时如实返回 `{ mode: 'unavailable', reason }`。

8. **`loginProfile` 只在 `ZHIYUN_PROFILE_TODOS=1` 时收集。** 生产不带这个变量，
   所以它是 `null`。

9. **离线验收覆盖不到真实契约。** 全部测试用假 `request` / 假 `api`，
   端点单复数、字段名、过滤口径都是照既有实现钉住的 —— 平台改字段时，
   这些测试不会替你发现，只会发现「本包自己改了」。

## 测试

```powershell
node --test tests/xuezai.test.mjs
```

全部离线：假 `ctx`、假 `Transport`、假 `XzzdApi`。不联网、不读凭据、不写磁盘。
集成层（`apply()`）用最小 cordis 替身验证服务名、路由路径、动作分派与错误分支。
