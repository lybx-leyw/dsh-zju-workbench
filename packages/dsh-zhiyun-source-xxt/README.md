# dsh-zhiyun-source-xxt

学习通（超星 / [chaoxing.com](https://chaoxing.com)）数据源：**课程、作业、截止时间、考试、通知、课表**。
纯 JavaScript（ESM），只读，不做自动登录。

## 为什么有这个包

`dsh-zhiyun-source-omni` 是从上游 [Vita0818/ZJU-Omni](https://github.com/Vita0818/ZJU-Omni)（MIT）
移植来的，六个平台塞在一个 TypeScript 包里。本仓正在按平台拆成独立的纯 JS 包，
xxt 这一块拆出来时顺带修了三处**落在用户可见路径上**的问题：

| 问题 | 具体表现 | 本包怎么处理 |
| --- | --- | --- |
| **macOS 残留** | `pbpaste \| npm run cli -- xxt-cookie` 印在错误提示里。本仓跑在 Windows 上，用户照着敲只会得到「不是内部或外部命令」 | 文案改成跨平台的中性说法：在浏览器登录后复制任一请求的 Cookie，粘贴到本机终端导入 |
| **Cookie 域写死** | 上游只认 `chaoxing.com` 一个域。学习通的接口分在 `i` / `mooc1` / `mooc2-ans` / `mooc1-api` 等分片域上，作业详情链接还可能指向 `mooc1-3.chaoxing.com` 这类按负载分配的主机名 | 白名单按**后缀**判定（带点边界，`evilchaoxing.com` 不算），并由 `Transport` 统一收发 Cookie |
| **自定义传输层** | 上游自带 `HttpClient` / `CookieJar` / 限流器，与本仓那套平行 | 直接用共享层 `Transport` / `SessionStore`：会话加密落盘（Windows DPAPI）、Cookie 域判定都是共享层的职责 |

## 能力

`/api/zhiyun-xxt` 上的 9 个**只读**方法，方法名即 `xxt.<名字>`：

| 方法 | 作用 | 请求 |
| --- | --- | --- |
| `courses` | 全部课程（原始形状，5 分钟缓存） | 2 次 GET |
| `listCourses` | 课程清单（`course_id` / `class_id` / `name` / `teacher`） | 复用上面的缓存 |
| `findCourse` | 按 id / 全名 / 名字片段找一门课 | 复用上面的缓存 |
| `homework` | 一门课的作业列表 + 进度 | 2 次 GET |
| `listHomework` | 作业清单（带 `pending`，去掉签名 URL） | 同上 |
| `deadlines` | 所有课**未完成**作业的截止时间聚合 | 2×课程数 + 每条未完成作业 1 次 |
| `exams` | 考试列表 | 1 次 GET |
| `notices` | 通知（支持未读 / 关键词过滤，最多 5 页） | 每页 1 次 POST |
| `schedule` | 我的课表（按星期与节次排好） | 1 次 POST |

外加三个**客户端动作**（不在读取方法里，因为它们是配置而不是数据）：
`xxt.status`（配了没、缺哪个键）、`xxt.importCookie`（存 Cookie）、`xxt.checkLogin`（探一次登录态）。

### 为什么 `deadlines` 这么贵，以及为什么还是这么做

作业列表页**不显示截止时间**，时间只在每条作业的详情页里。学习通没有"一次给出所有 DDL"的
JSON 接口 —— 列表页是服务端渲染的 HTML。所以要让用户看到「什么时候到期」，只能逐条读详情。
控制成本的三个手段：只看**未完成**的作业、`max_courses` 限制扫描课程数（默认 30）、
`horizon_days`（默认 90）之外的不输出。

单门课没有作业功能（`HOMEWORK_UNAVAILABLE`）是**正常情况**，不记错误；其他失败记进
`errors` 并让 `complete: false`。所以「读了 29 门，1 门超时」仍然给出 29 门的数据，
同时如实说明不完整。

## Cookie 导入（不做自动登录）

学习通网页登录要**扫码或过滑块验证码**。任何"自动化登录"最终都变成维护一个验证码识别器，
每几周失效一次，而失效的表现是「密码明明对的却登不上」。所以本包的口径是：

```
浏览器登录学习通 → 复制任一 chaoxing.com 请求的 Cookie（或它的 cURL）→ 导入一次
```

判定顺序：

1. 环境变量 `CHAOXING_COOKIE`（临时覆盖，不写进会话文件）；
2. 已导入的会话（`<profile>/data/zhiyun-xxt/xxt.session`，DPAPI 密文）。

### 接受的四种粘贴形态

| 形态 | 例子 |
| --- | --- |
| cURL 命令 | `curl 'https://mooc1.chaoxing.com/…' -H 'Cookie: UID=…; _uid=…; fid=…'` |
| 请求头 | `Cookie: UID=…; _uid=…; fid=…` |
| DevTools Cookies 表格 | 从 Name / Value / Domain … 整表复制 |
| 裸 Cookie 字符串 | `UID=…; _uid=…; fid=…` |

解析**复用** `dsh-zhiyun-source-campus` 的 `parsePtaCookie`（纯函数）：同一套规则，
踩过的坑都写在那份的注释里 —— DevTools 表头（`Name` / `Value`）与 RFC 6265bis 属性行
（`Path /`、`HttpOnly ✓`、`SameSite Lax`）必须排除，否则会存进「名为 Path 的假 Cookie」，
鉴权看起来过了但接口回空。

### 必需键

`UID` / `_uid` / `fid`。缺一个不报错，只表现成「导入成功了但什么都读不到」——
所以 `status` 会把缺哪个键算出来，`importCookie` 也一并返回。

## 只读边界

这是**产品口径**，不是实现细节：

- 9 个方法全部只做**查询**；
- 学习通里「交作业」「开始考试」「签到」这类动作**没有**对应方法 —— 那是用户自己的决定，
  一个数据包替用户点下去是不可逆的；
- 唯一的写操作是 `xxt.importCookie`，它写的是**本机会话文件**，不是学习通的数据。

## 数据路由

`/api/zhiyun-xxt`，与 `/api/zhiyun-campus`、`/api/zhiyun-omni` 并列。

```http
GET  /api/zhiyun-xxt
→ { ok: true, value: { route, platform, methods, actions, note } }

POST /api/zhiyun-xxt
{ "type": "client-request", "rpcId": "…", "payload": { "method": "xxt.deadlines", "args": { "horizon_days": 30 } } }
→ { "type": "server-response", "rpcId": "…", "result": { "ok": true, "value": … } }
```

信封与 study-core / omni / vault 完全一致。`method` 可以省略 `xxt.` 前缀（路由本身已经把范围
限死在 xxt 上），但别的平台前缀一律拒。

方法名按**静态白名单**校验，不做任意属性访问 —— 这条路由是给同源页面用的，不该成为一个
能拨动插件进程内部对象的口子（`constructor` / `__proto__` 会被 `/api/zhiyun-xxt` 直接拒）。

## 会话存在哪

`<profile>/data/zhiyun-xxt/xxt.session` —— **一份**，不是三份（学习通只有一个登录态）。
Windows 上走 DPAPI，只有同一台机器的同一 Windows 用户能解开。会话文件坏掉不会让插件起不来，
按「未配置」处理并记一行日志：重新导入一次比让用户去删文件友好。

## 复用与来源

| 复用 | 来源 |
| --- | --- |
| `Transport` / `SessionStore` / `ClassroomError` | `dsh-zhiyun-source-campus/http`（**不复制**，直接 import） |
| `parsePtaCookie` | `dsh-zhiyun-source-campus` 的根导出（纯函数） |
| HTML / JSON 解析口径 | 上游 `ZJU-Omni` 的 `platforms/xxt/reads.ts`，它自己来自 [zju-chaoxing](https://github.com/wsdjeg/zju-chaoxing)（MIT） |

**行为与上游一致**：字段名、过滤规则、时间解释都没有"顺手改好"。唯一放宽的一处是课程名的
教师名提取 —— 上游只认 `class="overHidden2"`，而另一种模板写作 `class="overHidden2 fl"`，
照抄的结果是在那个模板上**静默**取不到教师名。现在两种都认，对上游那种页面是同一个结果。

## 验证

```bash
node --test tests/xxt.test.mjs tests/xxt-route.test.mjs
```

`tests/xxt.test.mjs` 覆盖解析与读取逻辑（61 项），`tests/xxt-route.test.mjs` 覆盖路由信封（10 项）。
测试**不连外网、不碰 DPAPI**：`XxtClient` 的 `fetch` 与 `SessionStore` 的 `file` 都可注入，
夹具全在 `tests/fixtures/xxt-*.html`。

钉住的行为里，有几条是踩出来的，值得单独说：

- **课程列表去重**：同一门课在页面上出现两次（卡片 + 「继续学习」按钮），必须只算一门；
- **`&amp;` 两种转义**：链接里 `&` 与 `&amp;` 在真机页面上都出现过，正则要同时认；
- **教师名不能取成课程名**：卡片里 `overHidden2` 既可能是老师也可能是课名，与课名相同的要跳过；
- **完成判定不能用 `includes('完成')`**：`未完成` 里含「完成」，那会把待办直接清零；
- **截止时间的年份**：`MM-DD HH:MM` 不带年份，按「最接近今天」补全，并且**拒绝不存在的日期**
  （`02-30` 不能让 `Date.parse` 滚到 3 月 2 日）；
- **详情地址要 `decodeURIComponent` 之后再 `unescapeHtml`**，顺序反了会得到带 `%26` 的坏 URL；
- **JSON 里的「用户登录」不算失效**：通知正文里完全可能出现这四个字，只有非 JSON 的回包才按
  登录页处理。
