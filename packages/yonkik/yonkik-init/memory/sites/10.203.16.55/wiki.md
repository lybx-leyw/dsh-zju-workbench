# 浙江大学实验选课系统（10.203.16.55:86）

> 状态：**done（2026-11-20 二次探索打通）** —— 登录成功、课表全量取到。
> 首次探索因凭据被平台拒绝而 blocked；凭据更新后一次登录成功。
> 只读探索，未做任何选课/退课/提交/改密码。

## 本页索引

- [一句话结论](#一句话结论)
- [坑 1：本机 env 代理劫持（最耗时，必读）](#坑-1本机-env-代理劫持最耗时必读)
- [坑 2：HTTP 200 ≠ 成功](#坑-2http-200--成功)
- [坑 3：端口分裂 86 / 8098](#坑-3端口分裂-86--8098)
- [坑 4：SPA fallback 吃掉任意路径](#坑-4spa-fallback-吃掉任意路径)
- [鉴权机制（已复刻，可复用）](#鉴权机制已复刻可复用)
- [学生课表取数链路](#学生课表取数链路)
- [登录被拒的排查结论](#登录被拒的排查结论)
- [资产](#资产)

---

## 一句话结论

**已打通。** 凭据可用时，`POST /api/login` 一次登录成功（无需验证码、无需浏览器）。
三跳链路取到完整课表：
`GET /api/terms` → 挑 `currentTerm==1`（本期 id=15）
→ `GET /api/courses/uid` → `GET /api/course/lab/students/full`

本期结果：1 门课（courseId=270），**12 个实验**，
每个都有实验名 / 教师 / 教室 / 日期 / 周次 / 分数。

⚠️ **最容易踩的新坑：本 API 返回 snake_case，不是前端 camelCase。** 见「字段映射」节。

---

## 坑 1：本机 env 代理劫持（最耗时，必读）

本机 env：
```
HTTP_PROXY=http://<本地代理>
HTTPS_PROXY=http://<本地代理>
NODE_USE_ENV_PROXY=1
NO_PROXY=<内网地址>,.local,localhost,127.0.0.1,::1,[::1]
```

**`NODE_USE_ENV_PROXY=1` 让 `node:http` / `node:https` 也在进程启动时绑定全局代理**，
而该代理出口在墙外，回不到 10.x 内网。表现：

```
GET /lab-course/login → 502，body 长度 0
响应头：{"connection":"keep-alive","proxy-connection":"keep-alive","content-length":"0"}
```

`proxy-connection` 这个头就是**代理返回的铁证**（nginx 不会发它）。极易误判成「站点挂了」。

**解法（三种，任选）**：
1. **每个请求显式 `agent: false`** ← 推荐，本资产全部脚本已内置
2. 请求前 `delete process.env.HTTP_PROXY` 等 —— 对**已经建好的**全局 agent 无效，需在 require 前删
3. raw `net.connect` 手写 HTTP 报文（本探索中用于交叉验证，确认 node:http 也能通后弃用）

⚠️ 注意 `NO_PROXY` 白名单里**没有** `10.203.16.55`，所以必须显式绕开。

---

## 坑 2：HTTP 200 ≠ 成功

全站统一信封 `{ code, message, data }`，**HTTP 状态恒 200**（连 API 404 也是 HTTP 200 + `code:404`）。

**最阴的一点**：`/api/login` 登录失败时 `code` 仍是 **200**，
只有 `data` 变成字符串错误消息（成功时 `data` 是对象）。

```jsonc
// 登录失败 —— code 是 200！
{"code":200,"message":"OK","data":"用户名或密码错误"}
```

**判定规则：成功 ⇔ `code===200 && typeof data === 'object'`。**
本探索第一版 `login.mjs` 只看 `code===200` 就报了「登录成功」，是错的（已修正）。

其他 code：
- `400` = Bad Request，缺必填参数（如只传 username 不传 password）
- `401` = Unauthorized，签名错/缺三参数，或 token 无效

---

## 坑 3：端口分裂 86 / 8098

| 端口 | 角色 | 证据 |
|---|---|---|
| **:86** | Nginx 1.18.0 (Ubuntu)，**只服务 SPA 静态资源** | `GET /` → 1120B index.html；`GET /lab-course/api/*` → 也返回 index.html（fallback） |
| **:8098** | 后端 API | `GET :8098/lab-course/` → `{"code":404,"message":"No handler found for GET /lab-course/"}` |

API base 硬编码在前端 app.js 里：
```js
v = "/lab-course", g = "http://10.203.16.55:8098/lab-course"
```
用户给的登录地址 `:86/lab-course/login` 只是**静态壳**，真实 API 在 8098。
**只打 86 会以为「所有接口都返回 HTML」**。

---

## 坑 4：SPA fallback 吃掉任意路径

`:86` 上任意未匹配路径都回 index.html（1120 字节，`<div id=myApp>`）。
实测这些**全是假的 200**，不代表接口存在：
- `/lab-course/loginto` → 200 + index.html
- `/lab-course/cas` → 200 + index.html
- `/lab-course/sso` → 200 + index.html

判真假的方法：**看响应体是不是那段 1120 字节的 index.html**，或改打 8098。

---

## 鉴权机制（已复刻，可复用）

前端 jQuery `$.ajax` 前会插入三个参数（`emitAjax` 函数 N）：

```
app_key   = hex(base64(reverse("==wnD0g6" + "6qYL7" + "qDSn3" + "ZOox4" + "6")))
X         = hex(base64("fNR" + "2q4Z" + "rSde" + "peIr" + "Z9H" + "iUlQ" + "=" + "="))
timestamp = Date.parse(new Date())   // 毫秒
token     = localStorage.Authorization（Bearer）

sign = MD5( X + path + Σ_{k∈sorted(data)} (k + v) + timestamp + " " + X )
```

- `path` 是**不含 `/lab-course` 前缀**的接口路径，如 `/api/login`
- 只拼标量值，跳过 `''`/`null`/`undefined`/对象/File
- 参数排序按 `Object.keys(data).sort()`

**实测验证（用假账号，不碰真实密码）**：

| 用例 | 结果 | 结论 |
|---|---|---|
| sign 正确 | `code:200` + `data:"用户名或密码错误"` | 签名通过，进入业务层 |
| sign 全 0 | `code:401 Unauthorized` | 服务端**确实校验** sign |
| app_key 错 | `code:401` | app_key 也校验 |
| 三参数都不带 | `code:400 Bad Request` | 缺参拦截 |

→ **签名算法复刻 100% 正确**，无需再怀疑编码/时间戳问题。

还有一个前端「弱登录标记」`loginKey = "eubhq659jx77cepp"` + `loginDiff = 1100210`，
只用来写 cookie `dataEight`/`dataNine` 判断登录态，**不参与服务端校验**，可忽略。

---

## 学生课表取数链路

前端组件 `studentCourse`（title「我的课表」）的真实取数顺序：

```
1. GET /api/terms               → 找 currentTerm==1 的期次
2. GET /api/courses/uid         → params: termId, uid(学号), page:-1, size:-1
                                  返回该期次下「我的课程」列表
3. GET /api/course/lab/students/full
                                → params: termId, uid, courseId, page:-1, size:-1
                                  返回 { content[], totalPages }：每门课的实验明细
4. GET /api/courseLabTimes/date → params: courseId, courseLabId
                                  返回 weekDate：周次→具体上课日期
5. GET /api/courseLabTimes      → params: courseLabId, page:-1, size:-1
                                  某实验课的上课周次清单（仅源码确认，未实测）
```

表格列（从 render 函数读出）：**课程名称 / 实验名称 / 周次 / 教师 / 分数 / 操作**。
还有一列「上课日期」，来自 `courseLabTimes`。

**这 5 个接口全部未取到数据**（都返回 401，因为 token 拿不到）。
链路结构来自 app.js 源码反混淆，属**推断而非实测**，凭据恢复后应逐步验证。

---

## 登录被拒的排查结论

已排除的可能（都实测过）：

| 假设 | 验证方式 | 结论 |
|---|---|---|
| 网络不通 | TCP 86/8098 均通，返回真实响应 | ❌ 站可达 |
| 签名算法错 | 伪造 sign → 401，正确 sign → 业务层 | ❌ 签名正确 |
| 字段名错（如 user/pass） | 缺字段 → `code:400`，全字段 → 业务提示 | ❌ 字段名正确，是 `username`/`password` |
| 需要验证码 | 登录页仅 3 个 input（用户名/密码/记住帐号），无 img、无 captcha 关键词 | ❌ 无验证码 |
| 密码有空格/全角/不可见字符 | 按常见空白/全角/编码问题逐项排查 | ❌ 已排除 |
| 浏览器环境差异 | Playwright 真实 UI 填表点击，同一错误 | ❌ 非环境问题 |
| 应走 CAS 单点 | 源码里是 `sso_token` cookie 方案，但 86 端口无 SSO 入口（只有 fallback） | ⚠️ 需人工确认 |
| 密码是别的（campus-sso 的凭据） | 用 campus-sso 凭据试一次 → 同样被拒 | ❌ 不是这个 |
| 表单编码/特殊字符 | 验证 form-urlencoded 往返一致（含常见保留字符情形） | ❌ 编码正确 |
| body 格式（JSON vs form） | JSON body → `code:400 Bad Request`；form → 到达业务层 | 确认必须 form-urlencoded |

**仍在的可能**：
1. **密码本身已过期/被改过**（像被强制重置过的临时密码）
2. 该平台**不用学号登录**，而用别的账号名（可能是学号前缀形式，也可能完全不同的用户名）
3. 账号**尚未在该平台注册**（登录页明写「如果没有帐号，请联系实验中心值班老师注册帐号」）
4. 需先通过 `campus-sso` CAS 跳转建立 `sso_token`，而该跳转入口在**别的系统**（如教务/学在浙大）里

**未做**：没有暴力尝试其它密码组合（避免触发账号锁定）。

---

## 资产

| 文件 | 用途 |
|---|---|
| `site.json` | 站点定义：origin、api.baseUrl、auth、trap 说明 |
| `login.mjs` | 签名算法 + 登录 + state.json；`--force` 强制重登；失败退出码 2 |
| `crawler.mjs` | 7 个只读 op：whoami/terms/courses/schedule/weekdates/notices/health |
| `endpoints.json` | 13 个已验证端点 + 5 个「见过但绝不调用」的写端点 |
| `state.json` | 会话（**当前无效**，登录被拒未生成有效 token） |

**复用方式**：凭据修好后直接 `node login.mjs --force && node crawler.mjs schedule`。

**厂商指纹**：页脚「创高软件」，`/api/logout` 302 跳 `chc.appdemo.chingo.cn` → 本系统是**创高 chc 实验选课产品**的浙大部署实例。

---

## 字段映射（2026-11-20 实测，最容易踩）

**这个 API 返回 snake_case，不是前端 camelCase。** 用 camelCase 取值会全部是 null ——
首版 crawler 就因此把 12 个实验的 labName/teacher/week 全渲染成空，而接口本身是 200 成功。

`/api/courses/uid` 的关键字段：

| 字段 | 说明 |
|---|---|
| `id` | courseId（本期 270） |
| `courseName` | 课程名（**这个偏偏是 camelCase**） |
| `count` | 实验数（14，含未选的） |
| `startDate` / `endDate` | 毫秒时间戳 |
| `teacherNames` | 字符串，实测为空 |

`/api/course/lab/students/full` 的 `data.content[]` 关键字段：

| 字段 | 说明 |
|---|---|
| `lab_name` | 实验名称 |
| `teacher_name` | 教师 |
| `teacher_id` | 教师工号 |
| `select_week` | 所选周次，如 `1,2` |
| `dates` | **实际上课日期**，逗号分隔（两周一节时是两个日期） |
| `times` | 时间，如 `10:00` |
| `address` | 教室，如 `东四302-1`（**尾部可能带逗号，要 strip**） |
| `is_must` | 1=必做 |
| `total_score` / `final_score` | 实验总分 / 终评分（未出分时 null） |
| `lab_final_score` / `course_lab_final_score` | 更细粒度的评分项，实测均 null |
| `choose_date` | 学生选课操作时间 |
| `open_week` | 该实验可选周次（JSON 字符串数组） |
| `is_answer` | 1=已作答/已录入 |

---

## 本期实测结果（termId=15）

本次取到 1 门课（courseId=270）的 **12 个实验**，每个实验都带实验名 / 教师 / 教室 / 日期 / 周次 / 分数 / 必做标记。
**具体课程名、任课教师、教室与分数属个人学业记录，已从本档移除**；只保留「该链路经实测可完整取数」这一结论。

结构结论：一节实验课在 `data.content[]` 里对应一条记录，链式作业（预习报告 → 实验报告）与实验周次由 `select_week` / `dates` 区分；
已出分与未出分由 `total_score` 是否为 null 判定。

---

## 脚本

- `login.mjs` —— 账密登录，写 `state.json`。凭据被拒时退出码 2（`--force` 强制重登）。
- `crawler.mjs` —— 只读 op：`whoami` / `terms` / `courses` / `schedule` / `table` / `weekdates` / `notices` / `health`。
- `schedule.json` —— 本期 12 个实验的扁平快照。

## 上游班次/余量端点路由确认（2026-11-22）

API 基址 `http://10.203.16.55:8098/lab-course`。

| 端点 | 返回 | 判定 |
|---|---|---|
| `/api/course/labs/status` | 200，业务码 400「Bad Request」 | **路由存在**，缺必填参数 |
| `/api/course/open_status` | 200，业务码 400「Bad Request」 | **路由存在**，缺必填参数 |

这两个是「周次余量」与「开放窗口/可选数」，此前本地只有课表与通知，属实缺项；现在升级为「路由已确认、待参数或会话」。

**刻意不做**：不猜 courseId 穷举；同路径的 **POST** 是选班写操作，绝不触碰。

### 补测：`/api/courseId/270/course/labs`（2026-11-22）

- 用档内已知的 `courseId=270` 实测：**200 + 业务码 400 Bad Request**，46B。
- 判定：路由存在，但还需要其他参数（很可能是学期/周次），**不是路径不存在**。与同族 `labs/status`、`open_status` 表现一致。

## 课件下载链路（2026-11-22 打通，只读）

写教案/预习报告的原始素材就在这儿，**不需要猜 URL**：

| 步骤 | 端点 | 参数 | 返回 |
|---|---|---|---|
| 1 | `GET /api/course/wares` | `courseLabId` | `data.content[]`：`id` / `fileOrginName` / `url` / `downloadTimes` |
| 2 | `GET /api/course/wares/full` | `termId, courseId, page:-1, size:-1` | 同上，但带 `lab_name`，一次拿全课程 47 条 |
| 3 | `GET /api/course/wares/all` | `courseLabId` | 全库 154 条，字段是 snake_case（`file_orgin_name`），**无 id** |

**真实下载必须走 `/api/course/wares/export`**，不能直接拼 `/lab-course/uploads/...`：

```
GET /api/course/wares/export?courseWareId=<id>   (+ app_key/timestamp/sign, Authorization)
→ 200 application/x-msdownload，Content-Disposition: attachment;filename=...
```

- 直接拼 `:86/lab-course/<url>` → 返回 1120B 的 index.html（SPA fallback 假 200）；
- 直接拼 `:8098/lab-course/<url>` → 404 空 body。
- `export` 必须带 token：不带 token 时是 `{code:401}`。
- 大文件（实测 266 MB 的 pptx）能一次拿全，超时给足 120 s。

**坑**：`Content-Disposition` 里的中文文件名是 GBK 乱码，别信它，用第 1 步的 `fileOrginName` 命名。
