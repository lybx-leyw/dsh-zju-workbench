# pan.zju.edu.cn · 浙大云盘

> **只读侦察。** 只做了登录 + 只读列出，**未上传/未下载用户文件/未删除/未分享/未改名**。
> 探索日期 2026-11-20。nginx，IP `10.203.3.172`（校内网段，必须绕过 env 代理）。

## 本页索引

- [一句话结论](#一句话结论)
- [「离校停用」公告：原文与出处](#离校停用公告原文与出处)
- [入口与鉴权](#入口与鉴权)
- [免登录能看到什么](#免登录能看到什么)
- [登录后能读到什么](#登录后能读到什么)
- [接口表](#接口表)
- [坑](#坑)

## 一句话结论

**纯 CAS，没有本地账号体系**；后端不是自研，是 **Fangcloud（亿方云）** SaaS 的私有化/租户实例。
免登录只有登录页 + 两份 PDF（使用手册、管理办法，共约 2.9MB）可读，**看不到任何文件数据**。
登录后可见 5GB 配额、文件列表、账号信息。CC98 上「下载速度比免费网盘快」的说法**无法从接口证实**（那属于网络链路体感，不是接口可测量的量）。

## 「离校停用」公告：原文与出处

**这是本次最关键的一条事实。原文逐字如下：**

> 温馨提示
> 云盘在您办理离校手续后将被停用，请提前处理云盘里的文件！

- **出处 URL**：`https://pan.zju.edu.cn/zjusso/login`
- **页面位置**：登录框下方 `<h6 class="login-tips">`，HTML 第 48 行
- **原文 HTML**：`<h6 class="login-tips">温馨提示 <br/> 云盘在您办理离校手续后将被停用，请提前处理云盘里的文件！</h6>`
- **可见性**：**免登录可见**（登录页即显示，无需账号）
- **技术支持**：浙江大学信息技术中心；咨询电话 88273255；咨询 QQ 群 752433305
- **PDF 佐证**：`https://pan.zju.edu.cn/zjusso/management-measures.pdf`（《使用管理办法》，146,446B，Last-Modified 2019-04-04）

**注意措辞**：「办理离校手续后**将被停用**」——不是「立即删除」，但也明确说了「请提前处理文件」。
CC98 帖 5654532「自从知道了浙大语雀、浙大网盘毕业要收回账号」与此一致：**账号收回/停用是真的，有官方页面原文。**

## 入口与鉴权

### 重定向链（实测逐跳）

```
0. 302  https://pan.zju.edu.cn/                → https://pan.zju.edu.cn/sso/login              [set-cookie x2]
1. 302  /sso/login                             → /zjusso/login?service=https%3A%2F%2Fpan.zju.edu.cn%2Fsso%2Fcas%2Fpostlogin%3FstateID%3D_<random>   [set-cookie x1]
2. 200  /zjusso/login                          (登录页，4546B)
```

### 关键事实：没有本地账密表单

`/zjusso/login` 的 HTML 里，用户名/密码输入框**被注释掉了**：

```html
<!--<div class="username">-->
    <!--<input type="text" name="username" id="username" placeholder="教工号或学号" onfocus="clearErrMsg()">-->
<!--</div>-->
<!--<div class="password">-->
    <!--<input type="password" name="password" id="password" onfocus="clearErrMsg()">-->
<!--</div>-->
```

页面上只剩一个 `<button id="login_submit" onclick="login()">点击统一身份认证登录</button>`，
而 `login.js` 的 `login()` **只做一件事**：

```js
window.location.href = "https://zjuam.zju.edu.cn/cas/login?service="+service;
```

所以：**抓表单 POST 账密这条路在本站不存在**，必须走 CAS。
（这与 playbook 里 zdbk 的 `#ssodl` 是同一模式。）

### CAS service 与 postlogin

- service：`https://pan.zju.edu.cn/sso/cas/postlogin`
- 手工直接访问 `/sso/cas/postlogin`（不带 stateID）会 302 到：
  `https://pan.zju.edu.cn/auth/show_login_error?from=from_web&msg=BADREQUEST('Missing stateID parameter.')`
  → 说明 **stateID 是必须的**，正常流程里由 `/sso/login` 生成并带在 service 里。

## 免登录能看到什么

| 资源 | 状态 | 说明 |
|---|---|---|
| `/zjusso/login` | 200，4546B | 登录页（含「离校停用」公告） |
| `/zjusso/js/login.js` | 200，2868B | 登录逻辑，可读 |
| `/zjusso/user_guide.pdf` | 200，**2,765,002B** | 《使用手册》，Last-Modified 2019-05-16 |
| `/zjusso/management-measures.pdf` | 200，**146,446B** | 《使用管理办法》，Last-Modified 2019-04-04 |
| 客户端安装包 | 链接可读 | `app/sync/zju/zjuInstaller.{exe,dmg}`、`app/android/zju/zju-android-latest.apk`、iOS App Store id1189424473 |

**免登录拿不到任何文件、目录、配额数据。** 所有 `/apps/*`、`/galaxy/*`、`/poseidon/*` 都要 cookie。

### 两份 PDF 很有价值

**《使用管理办法》** 是理解账号生命周期与合规的唯一权威文本，且**完全免登录可下**。
（本次只确认了状态码与大小，未逐字解析 PDF 正文——这是下次的候选。）

## 登录后能读到什么

| 接口 | 内容 | 实测 |
|---|---|---|
| `GET /apps/users/account` | 账号+配额 | `{id:<用户ID>, name, user_group:'user', space_total:5368709120(5GB), is_space_limited:true, space_used:0, storage:{storage_id:'174', alias:'oss存储'}, has_platform_user:true}` |
| `GET /galaxy/list/items?folder_id=0&enterprise_id=73274` | 文件列表 + 我的权限集 | `{success:true, children:[], permissions:[item_upload,item_download,item_preview,item_view,item_share,item_delete,...], sort_by:'date'}` |
| `GET /trumpet/messages/get_unread_message_count_for_user` | 未读消息数 | `{data:0, isLogin:true}` |
| `GET /token/` | csrf/xsrf token | `{success:true, xsrf_token:'<base64>', csrf_token:'<32字符>'}` |
| `GET /enterprises/get_expiration_reminder` | 套餐到期提醒 | `{need_remind:false}` |
| `GET /apps/frequently_used_items/get_space_info` | 空间使用情况 | `{has_own:false, has_collab:false}` |
| `GET /apps/space_groups/get_space_group_list` | 空间组 | `{groups:[]}` |
| `GET /apps/templates/folders` | 模板文件夹 | `{folders:[], total:0}` |
| `GET /alive/link` | 各端下载链接 + websocket host | `wss://pan.zju.edu.cn/websocket_proxy/` |
| `POST /poseidon/main_page/data` | 首页数据（企业配置） | 企业 id=73274，`language_type:'education'`，`disk` 相关策略 |

**企业信息**：`enterprise.id=73274`，`name='浙江大学'`，`language_type='education'`，
`is_virus_scan_enabled:true`，`is_dlp_server_enabled:false`。

**用户身份**：`login='<学号>@zju.edu.cn'`（已脱敏），`user_group='user'`（非管理员），
`company_plan_id=8`，`created=<时间戳>`。

## 接口表

### 免登录

| method | path | 用途 | 关键响应 |
|---|---|---|---|
| GET | `/zjusso/login` | 登录页（含离校停用公告） | HTML 4546B |
| GET | `/zjusso/user_guide.pdf` | 使用手册 | PDF 2.77MB |
| GET | `/zjusso/management-measures.pdf` | 使用管理办法 | PDF 146KB |

### 需登录（cookie：`fc_session` 等，域名 `pan.zju.edu.cn`）

| method | path | 用途 | 鉴权 | 关键响应 |
|---|---|---|---|---|
| GET | `/apps/users/account` | 账号+配额 | cookie | `space_total/space_used/storage` |
| GET | `/galaxy/list/items?method_type=query_permission&folder_id=<id>&enterprise_id=73274` | 列目录 + 权限集 | cookie（部分需 csrf） | `children[]`, `permissions[]` |
| GET | `/galaxy/list/kanban?parent_id=0&folder_type=own&enterprise_id=73274` | 看板视图 | cookie | `kanban_file_data` |
| GET | `/token/` | 取 xsrf/csrf | cookie | `{xsrf_token, csrf_token}` |
| GET | `/trumpet/messages/get_unread_message_count_for_user` | 未读数 | cookie | `{data:0}` |
| POST | `/poseidon/main_page/data` | 首页企业配置 | cookie | 企业策略对象（只读语义） |

**csrf 用法**：带 `X-Requested-With: XMLHttpRequest` 的请求（浏览器里 csrf 列显示 `XMLHttpRequest`）
会走 csrf 校验；纯 GET 拿 `X-Requested-With` 就能过，不需要显式带 csrf_token（实测 `/galaxy/list/items` 与 `/apps/users/account` 均 200）。

## 坑

1. **没有本地账密表单**（输入框被 HTML 注释掉了）。别去 `#username` 找输入框——它不存在。
   只能点按钮跳 CAS，或者直接 goto CAS URL。
2. **CAS service 必须带 stateID**，否则 `/sso/cas/postlogin` 回
   `show_login_error?msg=BADREQUEST('Missing stateID parameter.')`。
   所以**不能自己拼 service**，要从 `/zjusso/login?service=...` 那一跳拿到的完整 URL 里取。
3. **登录后落到 `/atlas-web/chat`（AI 助手首页），不是网盘首页。**
   真网盘在 `https://pan.zju.edu.cn/atlas-web/desktop/files?desktop=%2Fdesktop%2Ffiles%2Fown`
   或点侧栏「Cloud Drive」。
4. **首次进入有 ant-modal 欢迎弹窗拦截点击**。用 `.ant-modal-close` 或 `.ant-modal-wrap button` 关掉，
   否则 `getByText('Cloud Drive').click()` 会报「intercepts pointer events」超时。
5. **`/api/v1/*` 是死路**。`/api/v1/user/current` 回 401 `authentication_failed`，
   `/api/v1/files` 回 400 `bad_api_resource`。**真 API 不含 `/api/v1` 前缀**，直接 `/apps/*`、`/galaxy/*`、`/poseidon/*`。
6. **`/kbase/user/info` 用裸 cookie 会 403**，但在浏览器里回 200 —— 说明它需要额外的 header 或
   `/atlas-web` 上下文。别用裸 cookie 判「接口坏了」。
7. **写接口与只读接口共用前缀**（`/apps/*` 里既有 `users/account` 也有 `upload`）。
   按前缀批量判断读写会出事，必须逐个看语义。
8. **页面里混入大量第三方埋点**：`/qidian/*`（腾讯企点客服）、`/qdas/s.htm`、`/hm.gif`、
   `/marketing_track/track`、`/collect/*`。抓包时会被这些噪声淹没，要按 host+path 过滤。
   其中 `/marketing_track/track?corp_id=ww4942374d9cd4a2f0` 返回 `{"msg":"第三方应用的使用时间已到期","code":4002}`。
9. **`/apps/users/update_user_guide_settings` 是 POST 写操作**（更新引导设置），出现在页面加载流里，
   但它改的是用户偏好，不是文件。侦察时若复现页面流要把它排除。

## 本次探了什么 / 还剩什么候选

**已探**：重定向链全跳、登录页 HTML+JS、两份 PDF 状态、CAS 全流程登录、
`/apps/users/account`、`/galaxy/list/items`、`/token/`、`/trumpet/*`、`/poseidon/main_page/data`、`/kbase/user/info`。

**候选（未探）**：
- `management-measures.pdf` 的正文（账号生命周期、离校流程、保留期限的权威条文）。
- 文件版本历史接口（`/galaxy/*` 下疑似有 version 相关路径）。
- 分享链接的匿名访问形态（**注意：这会涉及创建分享链接=写操作，不能做**；只能探「已存在的公开分享如何读」）。
- 回收站（`/galaxy/list/items?folder_type=recycle` 之类，疑似只读）。
- 搜索接口（`/apps/items/search` 之类）。
