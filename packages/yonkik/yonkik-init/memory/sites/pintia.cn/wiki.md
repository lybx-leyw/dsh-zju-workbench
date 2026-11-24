# pintia.cn · PTA 拼题A

> 探索日期 2026-11-20（首探 blocked）；**2026-11-20 二次探索：登录已打通，待办/互评/提交全部可取**。
> 杭州百腾教育运营的公网商业平台，Spring Boot + React SPA。

## 本页索引

- [一句话结论](#一句话结论)
- [入口](#入口)
- [鉴权（已打通）](#鉴权已打通)
- [接口（登录后 verified）](#接口登录后-verified)
- [互评（PEER_REVIEW）结构](#互评peer_review结构)
- [坑](#坑)
- [本次探了什么 / 还剩什么](#本次探了什么--还剩什么)

## 一句话结论

**登录已打通，只读数据全可取。** 账号密码在凭据键 `PTA凭证`（键一=登录名，键二=密码，均已桥接）。
登录后能拿到：全部题目集（109 条）、未截止待办（6 条）、每个题目集的开放/关闭时间、
我的答题状态与得分、互评的四档截止时间与进度、公开提交记录、未读通知。

**关键入口是 `/api/problem-sets/{id}/exams`**，不是 `/api/problem-sets/{id}`——
后者对普通学生 403 `PERMISSION_DENIED`，前者 200 并返回 `problemSet` + `exam` + `homework` 三块。

## 入口

```
https://pintia.cn/                 → 200, 9161B, React SPA（#sparkling-daydream）
  登录页：https://pintia.cn/auth/login（200, 8843B）
  内联 SERVER_CONFIG = {EDITION:"MAIN", PTA_URL, CDN_URL:"//static.pintia.cn/sparkling-daydream/",
                         IMAGE_URL:"//images.ptausercontent.com/", GIT_COMMIT_HASH:"680067d"}
  主包 https://static.pintia.cn/sparkling-daydream/main.045e0ae3ca76bb63.js (767KB)
  备用线路：https://pintia.cn/?proxyCDN=1
```

## 鉴权（已打通）

| 项 | 值 |
|---|---|
| 认证域 | `https://passport.pintia.cn`（Spring Boot，`/` 回 JSON 404） |
| 会话 cookie | **`PTASession`**（UUID），domain=`.pintia.cn` |
| 主站 cookie | `JSESSIONID`（domain=`pintia.cn`） |
| 登录端点 | `POST https://passport.pintia.cn/api/users/sessions` |
| 凭据键 | **`PTA凭证`**（`键一`=登录名/邮箱/手机，`键二`=密码） |
| 验证码 | **腾讯 TCaptcha（滑块）**，仅风险触发；正常账密直登不弹 |
| MFA | `/api/users/mfa/init` → `.../{uuid}/sms` → `.../sms-check(/login)` |

**登录脚本 `login.mjs`（playwright，最稳）**：
打开 `https://pintia.cn/auth/login` → 填第 1 个 input（电子邮箱或手机号码）+ 第 2 个 input（密码）
→ 点 `button.pc-button`（文案「登录」）→ 成功跳 `/problem-sets/dashboard` → `ctx.storageState()` 落 `state.json`。

**为什么必须用 playwright 而不是纯 HTTP**：`POST /api/users/sessions` 裸调返回
`400 {"error":{"code":"GATEWAY_WRONG_CAPTCHA"}}`——前端会先带 TCaptcha 的 ticket。
浏览器里正常账密就能过（2026-11-20 实测，未弹滑块）。若日后触发，需要接 TCaptcha 回调。

**`campus-sso` 不适用**：主包里搜 `zjuam|zju.edu.cn` 为 0，PTA 与浙大统一身份认证无关，
是百腾教育自有账号体系。所以「忘密码」不能靠一卡通找回。

## 接口（登录后 verified）

Base：`https://pintia.cn`，带上 `state.json` 的 cookie 即可，**无需 Authorization header**。

| method | path | 用途 | 实测 |
|---|---|---|---|
| GET | `/api/problem-sets?limit=100&page=N&order_by=END_AT&asc=false` | 我的全部题目集 | 200，109 条，分页 100/页 |
| GET | `/api/problem-sets?filter={"endAtAfter":"<ISO>"}&limit=50&order_by=END_AT&asc=true` | **未截止题目集（待办主接口）** | 200，按关闭时间升序 |
| GET | **`/api/problem-sets/{id}/exams`** | **题目集详情 + 我的答题 + 互评配置** | 200，见下节，**这是详情真源** |
| GET | `/api/problem-sets/{id}/submissions?limit=200` | 公开提交记录（含他人） | 200，可按 `userId` 过滤出自己 |
| GET | `/api/notifications?filter={"onlyUnread":true,...}&page=0&limit=50` | 未读通知 | 200，当前 total=0 |
| GET | `/api/problem-sets/always-available` | 常驻题目集（教材题集） | 200 |
| GET | `/api/statics` | 站点统计（题量/用户数） | 200 |
| GET | `/api/content/dashboard` | 首页 dashboard 配置 | 200 |

**403 / 404（别再试）**：
- `/api/problem-sets/{id}` —— 403 `PERMISSION_DENIED`（普通学生无权，用 `/exams` 代替）
- `/api/problem-sets/{id}/problems` —— 403（做题页在答题会话里按需加载，非静态列表）
- `/api/user-groups` —— 403 `PERMISSION_DENIED`
- `/api/problem-sets?limit=200&order_by=CREATE_AT` —— **400**（`order_by` 只接受 `END_AT`）
- `/api/course-classes` —— 406
- `/api/problem-sets/{id}/exams/problems`、`/api/exams/{id}/problems` —— 406

## 互评（PEER_REVIEW）结构

`/api/problem-sets/{id}/exams` 对 PEER_REVIEW 型返回 `homework.peerReviewConfig`，
四个截止时间**各不相同**，这是最容易误判的地方：

| 字段 | 含义 |
|---|---|
| `submitDeadline` | 提交自己作业的截止 |
| `reviewDeadline` | **互评别人作业的截止**（比关闭时间早 1 天） |
| `complainDeadline` | 申诉截止 |
| `feedbackDeadline` | 反馈截止 |
| `reviewAmount` | 每人要评几份（实测 2） |
| `maxReviewScore` | 单份上限（实测 40 分） |

进度在 `homework.result`：`submitResult` / `reviewResult` / `feedbackResult` 三个布尔。
`/api/problem-sets/{id}/exams` 里 `status` 是**题目集状态**（READY / PROCESSING / END），
`exam.status` 是**我的答题状态**（PROCESSING / END），两者别混。

## 坑

1. **详情不要用 `/api/problem-sets/{id}`**，普通学生 403。正确是 `/api/problem-sets/{id}/exams`。
2. **`order_by` 只接受 `END_AT`**，传 `CREATE_AT` 直接 400。分页用 `limit` + `page`（0-based）。
3. **SPA fallback 吃掉一切 GET**：不存在的路径回 200 + 9161B HTML 壳。「200 就是可用」在这里失效，
   判据是 content-type 与 body 是不是 JSON。
4. **401/403 的 content-type 也报 `text/html`**（body 却是 JSON）。别用 content-type 判 JSON。
5. **裸 HTTP 登录被 CAPTCHA 网关拦**（`GATEWAY_WRONG_CAPTCHA`），必须走浏览器。
6. **`/api/problem-sets/{id}/submissions` 返回所有人的提交**（不只自己的），按 `userId` 过滤。
7. **前端有 UA 拦截**：Chrome<94 / Firefox<121 会插 `#unsupported-browser`；`OMSClient` UA 例外。
8. 没有 robots.txt / sitemap.xml（都是 Whitelabel 404）。限流保守默认 ≥2s，实测全程串行未触发 429。

## 本次探了什么 / 还剩什么

**已验证**（2026-11-20 二次探索）：
- 登录链路（playwright + `PTA凭证`）→ `state.json`
- 待办主接口 `/api/problem-sets?filter=endAtAfter`、全量 `/api/problem-sets`（109 条）
- 详情真源 `/api/problem-sets/{id}/exams`（含互评四档截止 + 进度）
- 提交记录 `/api/problem-sets/{id}/submissions`（可按 userId 过滤）
- 未读通知 `/api/notifications`

**脚本**：
- `login.mjs` —— playwright 登录，写 `state.json`（会话失效重跑即可）
- `crawler.mjs` —— 只读 op：`ps`（未截止待办）/ `all`（全量）/ `detail <id>` / `subs <id>` / `notif`
- `fetch.mjs` / `_scratch/*` —— 探索期工具，可清

**知道存在但没调（写语义，不做）**：
- `POST /api/problem-sets/{id}/exams`（开始答题）、`POST .../submissions`（提交代码）
- 互评的 `POST .../reviews`、`.../complaints`
- `/api/user-storage/*`（用户存储同步）

**仍未闭环**：
- 答题页里的逐题状态（哪些题过了、哪些没过）——在答题会话内的按需 chunk 里，
  静态接口 `/problems` 403。要拿需要进 `POST /exams` 建立会话，属写操作，未做。
- 排行榜/得分明细（`hideScoreboard=true` 的题目集里本就不可见）。

## 上游逐题状态/草稿端点（2026-11-22）

| 端点 | 无会话返回 | 判定 |
|---|---|---|
| `/api/problem-sets/problems/{pid}/exam-draft` | **401**，`USER_NOT_LOGGED_IN` | 路由存在，需登录 |
| `/api/problem-sets/{set}/problem-status` | **200 但返回 HTML 页面** | 需考试会话；不视为可用接口 |

`problem-status` 的 HTML 回落说明它依赖答题会话——与既有结论「读操作不能替用户开考」一致，**不建立考试会话**。
