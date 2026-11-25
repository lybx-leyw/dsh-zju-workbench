# 学在浙大 courses.zju.edu.cn（TronClass）

## 本页索引

<!-- yonkik:toc -->
> 按节读，不要整篇加载：先看标题，再 grep -n "^## <标题>" wiki.md 取行号，只读那一节。

- 鉴权（关键：一证多站，且**当前不弹验证码**）
- 接口（全部纯 HTTP + cookie，无需 token header）
- 待办（待办数据源）（`/api/todos` 一条打通，含 `is_locked` 坑）
- 附件下载两步法（本页最重要的坑）
- **提交作业（写操作，必须先经用户许可）** ← 2026-11-22 实测打通

- 限流
- 脚本

---
**状态：done（登录可用、课程/活动/附件/下载接口已验证，2026-11-19）**

## 鉴权（关键：一证多站，且**当前不弹验证码**）
- 链路：`courses.zju.edu.cn/user/index` → 302 `identity.zju.edu.cn`(Keycloak realm zju, client `TronClass`) → 303 Keycloak broker → 302 `zjuam.zju.edu.cn/cas/login`（统一身份认证平台）。
- 凭据：`campus-sso`（键一=学号，键二=统一身份认证密码）。**不需要独立密码。**
- `/cas/v2/getKaptchaStatus` 实测返回 `false` → 当前验证码关闭，账号+密码直接登录成功。若日后打开，登录页 `#yzmPic` 的 src 为 `cas/kaptcha?time=...`，可下载图片走视觉识别。
- 密码提交由前端 JS 处理（`js/login/login.js`）：先 `GET cas/v2/getPubKey` 取 modulus/exponent，把**密码字符串反转**后用 RSA 加密填入 `#password` 再 submit `#fm1`。**用浏览器点 `#dl` 即可，不要手写 RSA。**
- 登录脚本：`login.mjs`，两阶段 `prep` / `submit [验证码]`。成功后写 `state.json`（playwright storage state），`lib/http.mjs` 自动导入 cookie。

## 接口（全部纯 HTTP + cookie，无需 token header）
Base：`https://courses.zju.edu.cn`

| 接口 | 用途 | 备注 |
|---|---|---|
| `GET /api/profile` | 当前用户信息 | 200 |
| `GET /api/my-courses?page=N&page_size=100` | 我的课程列表 | 200，返回 `{courses:[...]}`，含 `id/name/course_code/semester/instructors` |
| `GET /api/courses/{cid}` | 课程详情（含 course_outline 大纲） | 200 |
| `GET /api/courses/{cid}/modules` | 课程章节模块 | 200，`{modules:[{id,name,sort}]}` |
| `GET /api/courses/{cid}/activities?page=N&page_size=100` | 课程下全部活动（材料/作业） | 200，**列表项 `data` 只有 publish_time，没有 uploads** |
| `GET /api/courses/{cid}/exams` | 考试 | 200（本科课多为空数组） |
| `GET /api/activities/{activityId}` | **活动详情（附件真源）** | 200，见下节 |
| `GET /api/uploads/{uploadId}/blob` | **下载入口** | 302 → `tcmedia.zju.edu.cn/download/file/{key}?timestamp&nonce&token&name` |

## 待办（待办数据源）
**一句话：`GET /api/todos` 就是要的东西，无参数、无分页、一次返回全部待办。**

### 接口
| 项 | 值 |
|---|---|
| 路径 | `GET /api/todos` |
| 鉴权 | 仅 cookie（同其他 /api/*，无需 token header） |
| 参数 | **无**。`page`/`page_size`/`status`/`filter=finished`/`finished=1`/`include_finished`/`course_id` 全部**被忽略**，响应逐字节相同（len=34503） |
| 分页 | 无。无 `x-total-count`/`link` 头，无分页字段 |
| 响应 | `{"todo_list":[...]}`，**唯一顶层键就是 `todo_list`** |

### 响应结构（列表项，字段很少）
```
course_code, course_id, course_name, course_type,
end_time,            // ISO8601 UTC，截止时间
title,               // 作业名
id,                  // = activity id，可直接拼 /api/activities/{id}
type,                // 实测全部 "homework"
is_locked,           // 关键字段，见下「坑1」
is_student, prerequisites
```
**注意：列表项没有 `status`/`is_finished`/`submitted`/`start_time` 任何状态字段。** 状态只能自己算：
- 过期与否：`Date.parse(end_time) < Date.now()`
- 已提交与否：**`/api/todos` 本身已过滤掉已提交/已关闭的作业**（实测：某课程有 5 个 homework，其中 1 个 `is_closed=true` 的旧作业不在 todo_list 里；另一门课多份 `is_closed=false` 的作业里，`user_submit_count=1` 的已提交作业也不在 todo_list 里）。所以**出现在 todo_list 里 = 还没交**。

### 坑1：`is_locked=true` 的条目拿不到详情（403）
物理实验这类「预习报告 → 实验报告」链式作业，后一项挂在**前置条件**上。
- todo_list 里 `is_locked=true` 表示前置未完成、活动尚未解锁。
- 此时 `GET /api/activities/{id}` 返回 **403** `{"message":"该学习活动尚未解锁"}`（不是 404，别误判成接口挂了）。
- 前置信息就在 todo_list 项自带的 `prerequisites[]` 里，不用再请求：
```
prerequisites: [{ activity_id, activity_type, title, key,
  completion_criterion: { completion_info, completion_key, criterion_text,
                          criterion_value, has_completed, is_in_progress, published } }]
```
  `has_completed` / `completion_info`（如「未提交」）即可判定前置状态。**只读待办清单时根本不需要调详情接口。**
- 实测：待办中既有 `is_locked=false` 也有 `is_locked=true`（后者多为「…实验报告」，前置为对应的「…预习报告」）——锁的数量随个人提交进度变化，不宜写死。

### 坑2：物理实验课所有作业共用同一个 end_time
实测某门实验课的数十条待办 `end_time` 全部相同（=学期末缓交线），**不是各次实验的真实截止日**。按 end_time 排序会把它们全部堆到最后，看起来「不急」——实际应按实验周次推进。判据：同一课程内 end_time 高度雷同 = 该课用了统一缓交线，真实节奏需看课程公告/实验安排。

### 404 的接口（别再试）
`/api/my-todos`、`/api/todo`、`/api/user/todos`、`/api/my-activities`、`/api/notifications` → 404「未找到资源」。
`/api/activities?filter=todo` → 500 HTML 错误页（不是 JSON）。
提交状态专用接口 `/api/activities/{id}/{my-submission,submission,score}`、`/api/homeworks/{id}/submissions` → 全 404；判断是否已交靠「是否出现在 /api/todos」即可。

### 用法
```js
const todos = (await (await client.get('/api/todos', { headers: { accept: 'application/json' } })).json()).todo_list
// 截止时间转北京时间：new Date(Date.parse(end_time) + 8*3600e3).toISOString()
```
脚本：`todo-final.mjs`（拉取 + 排序 + 按锁/未锁分组，落盘 `todos-current.json`）。

## 附件下载两步法（本页最重要的坑）
1. 从活动详情取 `uploads[]`：`{id, key, name, size, type, status}`。
2. `GET /api/uploads/{id}/blob`（带 cookie，`redirect:'manual'`）拿 302 的**签名直链**（host `tcmedia.zju.edu.cn`，token 有时效）。
3. 对这个直链**裸 GET（不要带 courses 的 cookie，不要带 Referer）**流式落盘；响应 `content-type: application/zip`、`content-disposition: attachment;filename=...`、`content-length` 应与 `uploads[].size` 一致。

**404 的接口（别再试）**：`/api/courses/{cid}/{assignments,coursewares,chapters,students,rollcalls}`、`/api/uploads/{id}/{download,file}`、`/api/activities/{id}` 以外的 `/api/activity/{id}`、`/api/materials/{id}`、`/api/attachments/{id}`。
**403**：`/api/courses`（全局课程表，学生无权）、`/api/user`。

## 提交作业（写操作，必须先经用户许可）

> ⚠️ **本节的流程属于写操作。**
> 提交作业会改变用户在校内的真实学业记录，不可撤销（只能再交一次覆盖，旧记录留在交付历史里）。
> **硬约束：必须由用户明确许可后才能执行；用 `playwright-cli` 直接操作页面完成，
> 不为提交动作落盘脚本、不封装成可复用的提交资产、不直接对后端写接口发 POST。**

### 为什么不能像读接口那样用 HTTP 直接发

读接口（`/api/todos`、`/api/activities/{id}`）都是纯 cookie GET，很省事。
但提交是**前端表单拼装 + 上传件绑定 + 交付动作**三步，中间夹着 Angular 的弹窗状态机，
直接猜 POST 极易产生「看似 200、实际没绑上文件」或重复提交。2026-11-22 实测走页面点选一次成功，无需反编译提交协议。

### 前置：登录态

```powershell
playwright-cli -s=<session> open "https://courses.zju.edu.cn/user/index"
playwright-cli -s=<session> state-load "<YONKIK_HOME>\sites\courses.zju.edu.cn\state.json"
playwright-cli -s=<session> goto "https://courses.zju.edu.cn/user/index"
```
- `state-load` 必须在 `goto` 之后再用一次，否则首个 `goto` 已经跳 CAS 登录页。
- 用已有 `state.json` 可完全避开 CAS 验证码风控；cookie 有效期以实际会话为准，过期重跑 `login.mjs` 即可。

### 三步定位到可提交的作业

1. **拿到 activity id**：`/api/todos` 里按 `title` 匹配。
   `is_locked=false` 才能进；`is_locked=true`（前置未完成）详情接口直接 403。
2. **进课程内容页找条目**（比直接拼详情 URL 稳）：
   `https://courses.zju.edu.cn/course/{cid}/content`
   章节按实验名分组，每组下「…预习报告」「…实验报告」两条。
   ⚠️ `/course/{cid}/homework/{aid}`、`/course/{cid}/learning-activity/{aid}` 都返回「找不到资源」，别走这两条。
3. **点条目进详情**，URL 形如 `/course/{cid}/learning-activity/full-screen#/{aid}`：
   ```powershell
   playwright-cli -s=<s> find "<该实验>预习报告"   # 拿 ref，标题按实际课程内容填
   playwright-cli -s=<s> click "<ref>"                       # 注意 ref 要带完整前缀（形如 f70e1190xxxx），不能只写后几位
   ```
   详情页出现「作业内容 / 我的作业」两个 tab，切到**我的作业** →
   未交时显示「你尚未交付该作业，请尽快交付」+ **写作业** 按钮。

### 上传附件的关键坑：`添加文件` 不是系统文件选择器

点「添加文件」打开的是 Angular 弹窗 `#file-select`（`upload requires an open file chooser` 会一直报错，
`page.waitForEvent('filechooser')` 也永远等不到 —— **没有 filechooser 事件**）。

弹窗里三件事，顺序不能乱：

| 步 | 动作 | 说明 |
|---|---|---|
| 1 | 切到「**本地上传**」 | 默认停在「个人资源库」，那里是历史文件列表。切过去后页面才出现 accept 为空的 `input[type=file]` |
| 2 | `setInputFiles` 传文件 | 不是 `upload` 命令。传完文件进「个人资源库」，`已选: 资源 1` |
| 3 | **勾选该文件行** → 点「确认」 | 不勾选时「确认」是 `disabled`；勾上才可点 |

定位可见输入框：
```js
async (page) => {
  const inputs = page.locator("input[type=file]");
  for (let i = 0; i < await inputs.count(); i++) {
    const info = await inputs.nth(i).evaluate(el => ({ accept: el.accept, visible: !!el.offsetParent }));
    if (info.visible && info.accept === "") {
      await inputs.nth(i).setInputFiles("<桌面绝对路径>");
      break;
    }
  }
}
```
页面另有 3 个 `accept="image/*"` 的隐藏输入（富文本插图用），不要误选。
勾选行用 `[ng-repeat]` 容器按文件名过滤，再 `.check({force:true})`。

### 交付与验证

```powershell
playwright-cli -s=<s> run-code --filename <同上片段，点 getByRole("button",{name:"交付作业"})>
```
成功标志：页面出现 `作业已经交付`，返回我的作业后变 `已交付`，
交付历史多一行「交付时间 / 不公布」（具体时间属个人操作记录，不记）。

**三重验证（缺一不可，只看页面文字不够）：**

| 验证 | 判据 |
|---|---|
| 页面 | reload 后仍 `已交付`（不是 toast 残留） |
| 服务端 | `GET /api/activities/{aid}` → `user_submit_count: 1` |
| 待办 | `GET /api/todos` 总数减 1，该条目从 todo_list 消失 |

实测：待办总数减 1；对应「实验报告」那条同时从 `is_locked:true` 变 `false`（前置已完成，链式作业解锁）。

### 收尾

```powershell
playwright-cli -s=<s> close
```
清掉 cwd 下的 `.playwright-cli/`（console/page 快照，含页面文本，别留）。
**不保留提交脚本**；下次照本节流程重走一遍即可，不要为了复用把流程固化成文件。

### 已确认不存在的提交相关端点（别再试）

`/api/activities/{aid}/{submissions,my-submission,submission}`、`/api/homework/{aid}/submissions` → 全 404「未找到资源」。
判断是否已交**只认**「是否还在 `/api/todos`」+ `user_submit_count`。

## 限流
未发现 `X-RateLimit-*` 头，服务条款未给出明确自动化条款。沿用保守默认：间隔 1.5–2s、并发 1。本次全程串行单发，未触发 429。

## 脚本
- `login.mjs` — 两阶段 CAS 登录，写 `state.json`。
- `crawler.mjs` — `courses` / `activities <cid>` / `materials <cid>` 只读操作。
- `download-upload.mjs <uploadId> <dest>` — 两步法下载附件并校验字节数。
- `list-courses.mjs` / `list-activities.mjs` / `inspect-activity.mjs <id>` — 探索期用的枚举与字段展平工具。
- `todo-final.mjs` — 拉 `/api/todos`，按截止时间排序、按 `is_locked` 分组，落盘 `todos-current.json`。

## 点名接口校正（2026-11-22，按 dsh-zju-assistant 清单核对）

本 wiki 第 99 行原记：`/api/courses/{cid}/rollcalls` 是 404。**这条是对的**，但只说了「错的那条」。
真相是点名走另一个命名空间：

| 路径 | 结果 | 说明 |
|---|---|---|
| **`/api/radar/rollcalls`** | **200 `{"rollcalls":[]}`** | **正确接口**（命名空间是 radar，不是 courses） |
| `/api/courses/{cid}/rollcalls` | 404 `{"message":"未找到资源"}` | 不存在，别再试 |

实测带不带 `?course_id=` 返回相同（17B 空数组），说明该接口按当前登录用户返回，不按课程过滤。
本账号当前无点名记录，故为空 —— **空数组是正常返回，不是接口失效**。

### 顺带复核的其余端点（2026-11-22）

| 端点 | 结果 | 大小 |
|---|---|---|
| `/api/my-courses` | 200 | 33,510B（课程数以个人选课情况为准，不建议写死） |
| `/api/todos` | 200 | 34,503B（含作业与学习活动 DDL） |
| `/api/my-semesters` | 200 | 1,005B |
| `/api/uploads` | **404** | 需具体 upload id 路径（`/api/uploads/{id}/blob` 才是真接口） |

> 登录脚本是**两阶段**：`login.mjs prep` 只取验证码并落盘，`login.mjs submit` 才提交账密。
> 验证码当前关闭（`needKaptcha: false`），可直接 `submit`。**`prep` 单独跑会让人误以为登录没做完。**

## 上游作业/考勤端点路由确认（2026-11-22）

上游清单第 45 行的两条按课程端点：

| 端点 | 无会话返回 | 判定 |
|---|---|---|
| `/api/courses/{cid}/homework-activities` | **401**，`{"message":""}` | 路由存在，需登录 |
| `/api/course/{cid}/student/{uid}/rollcalls` | **401**，`{"message":""}` | 路由存在，需登录 |

注意第二条用的是**单数 `course`**（不是 `courses`），是本人历史考勤。两条与已收录的 `/api/todos`（跨课程汇总）、`/api/radar/rollcalls` 互补。
