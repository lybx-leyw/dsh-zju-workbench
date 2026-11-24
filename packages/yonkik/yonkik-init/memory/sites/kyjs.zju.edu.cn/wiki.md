# 学科竞赛管理系统（kyjs.zju.edu.cn）

> **本页索引**：这是什么 · 登录与鉴权形态 · 业务模块（从 bundle 读出） · 坑 · 状态

**状态**：done（2026-11-20）｜**鉴权**：需登录｜**限流**：串行 2s
**性质**：**接口已定位、业务模块已枚举，但未登录进站读数据**（无可用账号，见「未闭环」）

---

## 这是什么

浙大**学科竞赛管理系统**。学生在这里报名竞赛、提交作品、查获奖与创新学分；
教师在 `lectureManage` / `teacherPoints` 里管宣讲与教师积分；管理端有审批与获奖分配。

技术栈：**RuoYi（若依）后端 + Vue 3 + Element Plus 前端**，Vite 打包，纯 SPA。

## 登录与鉴权形态

首页 `/` 只回 514 字节的 SPA 壳（`<div id="app"></div>` + `assets/index-*.js`），
**所有路径都返回同一个壳** —— 不能用 HTTP 状态判断页面是否存在。

接口前缀从 bundle 里读出：**`/prod-api`**（Vite 的 dev proxy 约定名，生产环境由 nginx 转发）。

实测（2026-11-20）：

| 请求 | 结果 | 说明 |
|---|---|---|
| `GET /prod-api/` | 404 JSON | `{"status":404,"error":"Not Found","path":"/"}` —— 后端在，路由根没有映射 |
| `GET /prod-api/getInfo` | 200 但 `code:401` | 「认证失败，无法访问系统资源」 |
| `POST /prod-api/login` | 200 但 `code:1` | 「系统繁忙，请稍后再试！」—— 缺参数时的兜底文案，不是系统真忙 |
| `GET /prod-api/captchaImage` | 200 但 `code:401` | 验证码接口也要认证（RuoYi 常见配置） |

**这是 RuoYi 的标准鉴权回包**：HTTP 一律 200，业务码在 JSON 的 `code` 字段
（`401` = 未认证，`1` = 通用失败）。**只看 HTTP 状态会全盘误判成「接口都能用」**。

## 业务模块（从路由表读出）

bundle 里带了完整路由，按登录与否分成两组：

**需登录（`isLogin: !0`）**

| 路径 | 用途 |
|---|---|
| `/home/homepage` | 首页 |
| `/home/myCompetition` | 我的竞赛 |
| `/home/achievement` | 我的成果 |
| `/home/achievementReport` | 成果上报 |
| `/home/reward` | 我的获奖 |
| `/home/approval` | 我的审批 |
| `/home/innovationCredit` | 创新学分 |
| `/home/creditIdentify` | 学分认定 |
| `/home/project` | 项目 |
| `/home/setUser` | 个人信息 |
| `/dashboard` | 工作台 |

**免登录/特殊（`isLogin: !1`）**

| 路径 | 用途 |
|---|---|
| `/redirect/login` | 疑似 SSO 跳转入口 |
| `/home/login` | 同上（带 home 前缀） |
| `/neibu/login` | 内网登录（`hidden: true`） |
| `/401` | 未授权页 |

**管理端**（`competiotionExecute` 系列，注意官方拼写就是 `competiotion`，不是 `competition`）：
`pushCompetiotion`（发布）、`closingItem`（结项）、`signData`（报名数据）、
`divideAwards`（获奖分配）、`basicInfo`（基础信息）；另有 `reward/rewardBaseSet`（获奖基数设置）、
`teacherPoints/basePointSet`（教师积分基数）。

## 坑

- **SPA fallback 吃掉一切路径**：`/kyjs`、`/home`、`/redirect/login` 全返回 200 + 同一个 514 字节壳。
  判「接口存在」只能看 `/prod-api/*` 的 JSON 回包，不能看页面路径。
- **路由拼写**：`competiotion`（多一个 t）。照 `competition` 拼会 404。
- **`code:1` 不是「系统真的忙」**，是参数不全。别据此判断站点故障。
- **`captchaImage` 也 401** 说明该站把验证码接口放在认证之后（与常见 RuoYi 默认不同）。

## 未闭环

- **没登录进站读数据**：本机 `campus-sso` 是浙大一卡通，但该站是 `redirect/login` 还是独立账号体系未验证；
  直接拿一卡通去试 `POST /prod-api/login` 有锁号风险，且登录参数（username/password/code/uuid）未确认，所以**没有尝试**。
- **CAS 接入方式**：`/redirect/login` 是否跳到 `zjuam` 未探（需浏览器跟随）。
- **数据接口清单**：只拿到前端路由，`/prod-api/` 下的真实业务端点（竞赛列表、报名、获奖）未枚举。

## 复用建议

要真正打通，正确路径是：

1. 浏览器打开 `http://kyjs.zju.edu.cn/`，看它把用户送到哪里（`/redirect/login` → CAS？还是自建登录页？）
2. 若是 CAS → 用 `campus-sso` 走既有 CAS 流程（参考 `sites/courses.zju.edu.cn/login.mjs` 的两阶段 CAS）
3. 若是自建 → 先在设置里配独立凭据，别用一卡通
4. 登录后抓 `/prod-api/*` 的真实 XHR，再决定要不要脚本化

**不要盲目 POST `/prod-api/login` 试密码** —— RuoYi 常有失败计数锁定。

## 本科生院引用的公开新闻详情（2026-11-22）

通过本科生院实践交流官方首屏同一标题外链取得公开 newsId=10310，不猜号。HTTP GET /prod-api/<路径段>/detail?newsId=10310 不发 Cookie 或凭据，200 JSON 且业务 code=0，与外链标题/编号一致。正文可转纯文本，附件 1 个只计数；不下载、不跟外链。JSON 发布日 11-06、栏上展示日 11-09，分别标注，不拿一处覆盖另一处。crawler.mjs 只开放这条校验通过的样本。既有 401/业务系统需登录判断不外推到新闻接口。站点 robots 路径返回普通 SPA HTML，不是有效规则。
