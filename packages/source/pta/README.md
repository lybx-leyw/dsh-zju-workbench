# @lybx-leyw/dsh-zju-source-pta

拼题A（**pintia.cn**）数据源：**题集列表、题集详情、题目列表、题面原文、做题进度**。

纯只读（D17），`auth: own`，`network: public`。

## 这是什么

一个 Cordis 插件 + 一条同源数据路由（`/api/zhiyun-pta`），把拼题A 上「我有哪些题集、
每个题集里有哪些题、我还差几题没做」读出来，交给规划页 / 脚本去消费。

**它不重写任何接口知识**：这份实现原先住在 `@lybx-leyw/dsh-zju-source-campus`
（那个包同时装着学在浙大）。本包是**拆包**的结果，`src/pta.js` 逐字搬来。

## 与 `zhiyun-pro` 的 `pta_data_source.dart` 的关系

> **实现口径来自本仓的 Flutter 版**（`zhiyun-pro` 的 `pta_data_source.dart`），
> 那里已经把接口行为摸清了。**不是**从上游 `zju-assistant` 移植的。

三条口径逐条对应（都能在 `src/pta.js` 的头注释里找到出处）：

| 口径 | 为什么 |
| --- | --- |
| `filter` **只编码一次** | 手工 `encodeURIComponent` 再塞进查询串会双重编码，拼题A 直接回 **400**（实测：单编码 200 / 双编码 400） |
| **404 = Cookie 失效** | 拼题A 用 404 表示"用户不存在"（`USER_NOT_FOUND`），不是"题集不存在"。报错必须说"Cookie 已失效"，不能让用户以为是没配 |
| **本地再按 `endAt` 排一次** | 服务端 `order_by=END_AT` 不保证，实测返回里混着已截止的。本地排序才是最终口径 |

另外两条工程口径：

- **没有 N+1**：不逐题集补 `/exams`。那是列表页最慢的一段（上游 12 个题集 13 个请求）。
- **题面支持分页**：`offset` / `maxCharacters`，不截断成摘要 —— 题面可能是几十 KB 的
  原始 Markdown（含 LaTeX）。

## 能力表

### 读取（4 个动作，全部只读）

| `action` | 方法 | 作用 | 返回要点 |
| --- | --- | --- | --- |
| `problemSet` | `PtaApi.problemSet(id)` | 题集详情 | `{ id, name, description, problemTypes[], progress }` |
| `problems` | `PtaApi.problems(id, opts)` | 某题型的题目列表（分页） | `{ problems[], typeLabel, total, nextPage }`，每条带 `myStatus` |
| `problem` | `PtaApi.problem(setId, problemId)` | 题面**原文** | `{ content, nextOffset, totalCharacters, timeLimitMs, … }` |
| `progress` | `PtaApi.progress(id)` | 我的做题进度 | `{ total, accepted, byStatus }`，没有数据时 `null` |

动作名走**白名单**（`READ_ACTIONS`），不做任意属性访问：这条路由是给同源页面用的，
不该成为一个能拨动插件进程内部对象的口子。

### 状态与凭据（3 个客户端动作）

| 方法与路由 | 作用 |
| --- | --- |
| `ptaStatus()` / `GET /api/zhiyun-pta` | 回了 `{ configured, names }` —— **只报键名，不回值**，不发网络请求 |
| `saveCookie(raw)` / `POST ?cookie` | 存 Cookie，回 `{ source, names, cleared }` |
| `saveCookie('')` / `clearCookie()` / `POST ?cookie {}` | 清除（**空串就是清除**，不是"没识别出 Cookie"） |

`?pta-cookie` / `?pta-read` 是拆包前的旧动作名，保留为别名。

### 待办（`core/planning` 依赖这一半）

```js
pta.todos()      // → { pta: { ok, rows, error } }
pta.ptaTodos()   // → { ok, rows, error }          （只要 pta 那一半）
pta.problemSets({ includeEnded, limit, now })  // → 原始形状，不归一
```

`rows` 是 `normalizePta()` 的结果：

```js
{ source: 'pta', sourceLabel: '拼题A', id, title, detail, due, dueText, url, kind: 'problemSet' }
```

`error.message` **已经翻译过**（`translatePtaError`），下游拿到直接上屏，不需要再按
`code` 映射一次 —— 这是 `tests/source-error-contract.test.mjs` 钉着的契约。

**`todos()` 绝不把错误抛到调用方**：一个来源的失败不该让另一个来源（学在浙大）也拿不到数据。

## 登录与会话

拼题A 网页登录要过**短信验证码**，脚本无法完成。任何"自动化登录"最终都变成维护一个
验证码识别器，每隔几周失效一次，而失效表现是"密码明明对的却登不上"。所以口径是：

> 浏览器登录 → 复制 Cookie（或它的 cURL）→ 粘进「设置 → 拼题A」。过期了再粘一次。

`parsePtaCookie` 认四种粘贴形态：Cookie 字符串 / cURL / `Cookie:` 请求头 / DevTools 表格，
并排除两类会让鉴权"看起来过了但接口返回空"的行：**DevTools 表头**（`Name`/`Value`/`名称`/`值`）
与 **RFC 6265bis 属性行**（`Path /`、`HttpOnly ✓`、`SameSite Lax`）。

它实现在 tier 0 的 `@lybx-leyw/dsh-zju-source-http`（多个数据源共用同一套识别规则），
本包只 re-export。

会话落在 `data/zhiyun-pta/pta.session`，默认走 Windows DPAPI 加密。

## 写操作去哪了

按 **D17，写操作归 `packages/tool/`**。上游 `lib/pta/module.json` 声明了 4 个写能力，
本包**一行都没有**：

| 上游能力 | 现在在哪 |
| --- | --- |
| `pta homework start`（开始答题，建 exam 记录） | `packages/tool/campus-write`（未实现） |
| `pta homework finish`（交卷） | 同上 |
| `pta problem save`（暂存答案） | 同上 |
| `pta problem submit`（提交答案/代码） | 同上 |

**唯一的写操作是 `saveCookie`** —— 它写的是**本机的会话文件**，不是拼题A 的数据，
与 `source/xxt` 的 `importCookie` 同一性质。

## 主机与出口

`PTA_HOSTS` 只有三个域：`pintia.cn`、`passport.pintia.cn`、`www.pintia.cn`。

⚠️ **必须显式传给 `Transport`**。`Transport` 的默认白名单是 classroom 那一套，
里面没有 `pintia.cn`；而它只在主机命中白名单时才读写 cookie —— 漏传的后果是
请求一个 cookie 都不带、回来的 `Set-Cookie` 也一个都不存，表现为"刚粘完 Cookie 又像没配"，
且**不报错**。

出口走共享的 `zhiyunEgress`（`sharedFetch(ctx)`）：拼题A 是公网域，判定为**直连** ——
关键作用是绕开宿主为 LLM 配的**全局代理**（国内站点经代理基本必失败）。

## 没有设置分区

`auth: own` 但 Cookie 由用户在设置里粘贴，本包**没有自己的客户端半边**
（`src/client.jsx`）。设置入口目前仍由 `source/campus` 的「拼题A」分区承担，
拆包完成后要迁过来 —— 在那之前需要进 `tests/source-settings.test.mjs` 的
`NO_SETTINGS` 白名单。

## 已知限制

- **没有任何真机验证落在本包的改动上**：`pta.js` 是逐字搬来的（内容与 campus 那份
  逐行相同，只换了站点常量的来源），所以原有接口口径的可信度不变；但**新的
  `index.js`（会话文件位置、路由路径、`WRITE_HEADER` 改名）只在测试里跑过**，
  没有用真实 Cookie 打过 `pintia.cn`。
- **`WRITE_HEADER` 从 `x-zhiyun-campus` 改成了 `x-zhiyun-pta`**。旧前端
  （`source/campus/src/client.jsx`）还在发旧头，**在它迁过来之前写动作会 403**。
  读取（`GET`）不受影响。
- **会话文件位置变了**（`data/zhiyun-campus/pta.session` → `data/zhiyun-pta/pta.session`）。
  用户升级后需要**重新粘一次 Cookie** —— 因为密文由 DPAPI 按用户绑定，不能直接搬。
  *(推测：也可以写一段迁移逻辑去读旧路径，但那要在 campus 退役时一起做。)*
- **只覆盖「看题」这一层**：提交记录（`listSubmissions` / `getSubmission` /
  `lastSubmission`）、考试详情（`/exams`）都不在本包 —— 前者属于写链路，
  后者是被刻意去掉的 N+1（列表页不需要 `score` / `status`）。
- **`problemSet()` 的详情端点失败会被吞掉**（`name` 变 `null`），只保留题型分布。
  这是原实现的取舍：题型比标题重要，且多一次失败不该让整次读取失败。
- **没有翻页**：`problemSets()` 只取一页（`limit=100`）。上游会循环翻页并在
  总数字对不上时抛错；本仓按「一个学期的题集不会超过 100 个」取舍，超了会静默少列。
