# booking.lib.zju.edu.cn · 图书馆空间预约系统

> **只读侦察，未做任何预约/取消操作。** 登录是唯一允许的写操作（campus-sso，验证码已关闭）。
> 探索日期 2026-11-20。Apache/2.4.43，IP `10.203.60.21`（校内网段，必须绕过 env 代理）。

## 本页索引

- [一句话结论](#一句话结论)
- [入口与可达性](#入口与可达性)
- [鉴权：CAS + JWT，两个必踩的坑](#鉴权cas--jwt两个必踩的坑)
- [免登录能看到什么（这是最值钱的部分）](#免登录能看到什么这是最值钱的部分)
- [登录后能读到什么](#登录后能读到什么)
- [接口表](#接口表)
- [预约规则原文（含「违约三次」）](#预约规则原文含违约三次)
- [坑](#坑)

## 一句话结论

**不是纯 SPA 空壳。** `/api/index/notice`、`/api/index/booking_rules`（51KB 全套规则）、`/api/Seminar/tree`（30KB 馆舍-楼层-房间树）
三个接口**完全免登录**，把「制度 + 空间目录」都给出去了。真正的座位实时数据（`/reserve/index/quickSelect` 的 free_num）
才需要登录，且登录后**只能读到自己**的预约记录——不能遍历他人（`/api/Member/*` 只回本人）。

## 入口与可达性

| 项 | 值 | 证据 |
|---|---|---|
| `GET /` | **302**（0B） | 实测，跳 `/h5/` |
| `GET /h5/` | 200，1875B，title「图书馆空间预约系统」 | 实测，SPA 壳（`<div id="app">` + 一个 `index.1782805514175.js` 3.3MB） |
| `GET /h5/#/login` | SPA 路由，**异步**跳 CAS | 实测 |
| Apache | `Apache/2.4.43` | 响应头 |
| TLS | TLSv1.3，DigiCert，`cn=*.lib.zju.edu.cn` | 实测 |
| `robots.txt` | 站点未提供（`/api/*` 之外一律 404 页） | 实测 |

`/h5/` 是 **Vue 3 + Vant + vue-router hash 模式**的 H5 SPA。`<body class="deepblue">`，
入口 JS `https://booking.lib.zju.edu.cn/h5/assets/index.1782805514175.js`（3,315,642B）。
所有接口 baseURL 是 `"/"`（同源），axios 带 `withCredentials:true`。

## 鉴权：CAS + JWT，两个必踩的坑

### 流程（实测跑通）

```
1. GET  http://zjuam.zju.edu.cn/cas/login?service=https%3A%2F%2Fbooking.lib.zju.edu.cn%2Fapi%2Fcas%2Fcas
2. 填 #username / #password → 点 #dl（**不是 submit 按钮**）
3. 页面 login.js 用 getPubKey 做 RSA 加密密码（并把密码字符串反转），不要手写 RSA
4. 302 回 https://booking.lib.zju.edu.cn/h5/index.html#/cas/?cas=<ticket>
5. SPA 用 ticket 换 JWT，写进 sessionStorage.token
6. 后续请求带 header `authorization: bearer<JWT>`（**无空格**）+ body.authorization
```

### 坑 A：`bearer` 后面没有空格

SPA 源码原文：

```js
if(token){ if(config.headers.authorization=`bearer${to...`  // ← 模板字符串直接拼接，无空格
```

所以正确头是 `authorization: bearer<JWT>`（无空格拼在一起），**不是** `Bearer <JWT>`（带空格）。写成标准 Bearer 会得到
`{"code":10001,"msg":"您尚未登录"}`——极易误判成「token 失效」。

### 坑 B：body 里也要带 authorization

`/reserve/index/*` 这组接口是 **POST + JSON body**，且 body 里必须带 `authorization` 字段。
只给 header 不够（实测 `quickSelect` 只给 header → `code` 非 0；header+body 双给 → 成功）。

### 坑 C：`/h5/#/login` 的 CAS 跳转是异步的

`page.goto('/h5/#/login')` 之后立刻判断 URL，会看到还停在 `#/login`；CAS 实际在几百毫秒后才跳。
**必须轮询等**（见 `login.mjs` 的 `waitFor`）。直接 `waitForSelector('#username')` 会在页面导航中超时。

### 验证码状态

```
GET https://zjuam.zju.edu.cn/cas/v2/getKaptchaStatus → false
```
（2026-11-20 实测。登录页仍渲染 `#authcode` 输入框和 `/cas/kaptcha` 图，但服务端不校验。）

## 免登录能看到什么（这是最值钱的部分）

**完全不需要账号**就能拿到三类数据：

### 1. 制度全文 —— `GET /api/index/booking_rules`（200，51563B）

返回 24 个字段的 HTML 规则：`seat_rule` / `seminar_rule` / `activity_rule` / `discussion` /
`locker_rule` / `seat_declare` / `seminar_declare` 及各自 `_en` 英文版。
**「违约三次」的原文就在这里**（见下节）。

### 2. 空间目录 —— `GET /api/Seminar/tree`（200，30491B）

4 个馆舍 → 楼层 → 具体房间树的完整目录，每级带 `id/name/enname/nameMerge/image_url(楼层平面图)`：

| 馆舍 | id | 子节点 |
|---|---|---|
| 主馆 | 53 | 4 层（二层/三层/四层/五层） |
| 基础馆 | 18 | 1 层 |
| 农医馆 | 37 | 2 层 |
| 方闻馆 | 171 | 0 |

房间名形如「206(8人间)」，`image_url` 是 `http://booking.lib.zju.edu.cn/upload/area/54/floor.jpg`（楼层平面图，匿名可下）。

### 3. 公告与元数据

| 接口 | 内容 |
|---|---|
| `GET /api/index/notice` | 13 条公告（`total:13`），含「考试周临时阅览区」「24小时学习空间清洁消毒」「单人多日研习间调整」「座位预约系统维护」等，带 `id/title/create_time` |
| `GET /api/index/noticeDetail?id=<id>` | 公告正文 HTML。实测 id=40「关于座位预约系统维护的通知」2024-10-28 全文可读 |
| `GET /api/Study/libinfo` | 12 个馆舍下拉：基础馆/西溪馆/农医馆/玉泉馆/之江馆/华家池馆/舟山校区/海宁国际校区/方闻馆/紫金港主馆/紫金港主馆24小时/古籍馆 |
| `GET /api/index/time` | 服务器时间 `{time:52059734859}` |
| `GET /api/seat/label` | 6 个座位标签（电源 等） |
| `GET /api/index/lang` | 中英文案字典（38721B），可反推 UI 全部字段含义 |

**注意**：`/api/index/category`（座位/空间/常用/清柜四类）、`/api/Member/*`、`/api/index/subscribe`
匿名访问返回 `{"code":10001,"msg":"您尚未登录"}`。这是设计如此，不是故障。

## 登录后能读到什么

| 能读 | 内容 | 证据 |
|---|---|---|
| 本人资料 | `/api/Member/my` → `{id, name, card, mobile, email, roleName(本科生), deptName, joinTime, qrcode, date}` | 实测 1093B |
| 本人违约记录 | `/api/Member/reneges` → `{code:1, data:[]}` | 实测 20B |
| 本人座位预约历史 | `/api/Member/seat` → 分页 `{total, per_page:10, last_page}`（total 随个人使用量变化，不入档） | 实测 11744B |
| 本人研讨间预约历史 | `/api/Member/seminar` → `{total, per_page:10, last_page}`（同上） | 实测 11665B |
| 本人空间预约 | `/api/Member/room` → 空数组 | 实测 20B |
| 本人邀请 | `/api/Member/invitations` → `{seminar:0, count:0}` | 实测 41B |
| 本人设备预约 | `/reserve/device/mylist` → `{total:0}` | 实测 84B |

**不能读他人**：没有「按学号查别人预约」的接口。`/api/Member/*` 全部是「我的」，无参数可指向他人。
唯一带 `open_id` 的是 `/api/cas/user`，也是回自己。**这是设计上的隐私边界，侦察时不应尝试绕过。**

### 座位实时余量（登录后，最有用的数据）

```
POST /reserve/index/quickSelect
body: {"id":"1","date":"2026-11-20","premisesIds":["53"],"members":0,"authorization":"<JWT>"}
→ {code:0, data:{date:["2026-11-20","2026-11-21"], premises:[...], storey:[...], area:[...]}}
```

实测返回：主馆 `total_num:1024`，`free_num` 随时间变化；按楼层、按区域都有 `total_num/free_num`。
**这就是 CC98 上「预约的座位好找吗」类问题的量化答案来源。**

## 接口表

### 匿名可读（verify：HTTP 单发已确认）

| method | path | 用途 | 鉴权 | 关键响应 |
|---|---|---|---|---|
| GET | `/api/index/notice` | 公告列表 | 无 | `{code:1,data:{total,per_page,current_page,last_page,data:[{id,title,displayNo,create_time,ROW_NUMBER}]}}` |
| GET | `/api/index/noticeDetail?id=<id>` | 公告正文 | 无 | `{code:1,data:{id,title,content(HTML),displayNo,inputTime}}` |
| GET | `/api/index/booking_rules` | **全套预约规则** | 无 | `{code:1,msg,data:{seat,seat_rule,seminar_rule,seminar_declare,activity_rule,discussion,locker_rule,...,*_en}}` |
| GET | `/api/Seminar/tree` | 馆舍/楼层/房间树 | 无 | `{code:1,data:[{id,name,parentId,image_url,children:[...]}]}` 4 馆舍递归 |
| GET | `/api/Study/libinfo` | 12 馆舍下拉 | 无 | `{code:1,msg:"馆舍下拉列表",data:[{libPlace,description}]}` |
| GET | `/api/index/time` | 服务器时间 | 无 | `{code:1,data:{time}}` |
| GET | `/api/seat/label` | 座位标签字典 | 无 | `{code:1,data:[{id,name,ROW_NUMBER}]}` 6 条 |
| GET | `/api/index/lang` | 中英文案字典 | 无 | `{code:0,data:{zh:{...},en:{...}}}` 38721B |
| GET | `/api/index/config` | 前端配置 | 无 | `{code:1,data:"<混淆串>"}` 1075B |

### 需登录（Bearer JWT，header + body 双带）

| method | path | 用途 | 关键响应 |
|---|---|---|---|
| GET | `/api/Member/my` | 本人资料 | `{code:1,data:{id,name,card,mobile,roleName,qrcode,date}}` |
| GET | `/api/Member/reneges` | 本人违约记录 | `{code:1,data:[]}` |
| GET | `/api/Member/seat` | 本人座位预约历史 | 分页 |
| GET | `/api/Member/seminar` | 本人研讨间历史 | 分页 |
| GET | `/api/Member/room` | 本人空间预约 | 数组 |
| POST | `/reserve/index/index` | 预约首页元数据 | `{code:0,data:{premises,category,storey,noise,boutique,date}}` |
| POST | `/reserve/index/quickSelect` | **各区域实时余量** | `{code:0,data:{date,premises,storey,area}}` 各带 `total_num/free_num` |
| POST | `/reserve/index/list` | 区域列表（分页） | `{code:0,data:{page,size,list:[{id,name,premisesName,storeyName,total_num,free_num,firstimg,img[]}]}}` |
| POST | `/reserve/index/detail` | 单区域详情 | `{code:0,data:{id,name,total_num,free_num,noise[],boutique[],is_reducible}}` |

`premisesIds` 实测取值：`53`=主馆、`18`=基础馆、`37`=农医馆、`1`=玉泉馆、`218`=古籍馆。
`date` 只接受「今天 / 明天」（`data.date` 回 `["2026-11-20","2026-11-21"]`）。

### 未验证 / 未调用（写语义，**禁止**）

`/api/Seat/confirm`、`/api/Space/cancel|checkout|leave|signin`、`/api/Seminar/confirm|submit|roomCancel|roomConfirm`、
`/reserve/index/confirm`、`/api/Study/StudyAreaBook|StudyAreaCancel|StudyOrder`、`/reserve/activity/submit|confirm|partake|like`、
`/reserve/locker/*`、`/apiLocker/*`、`/reserve/smartDevice/set*`。
**本次一次都没调用。**

## 预约规则原文（含「违约三次」）

以下为 `GET /api/index/booking_rules` → `data.seat_rule` 去标签后的**逐字原文**：

> （1）本预约座位系统面向浙江大学在校师生用户使用。实行预约入座制的阅览室座位，使用者需对号入座，未预约者不得使用座位。
> （2）可预约时间：当日及次日 8:30-22:30；每天早上 7:00，系统开放次日座位预约
> （主馆二楼全天学习空间仅提供当日预约，24 小时开放；次日零点后，如继续使用座位，需再次扫码预约。）。
> （3）预约生效及失效：当日预约即时生效，当天有效。预约次日则次日 8:30 生效，全日段有效。
> 每人每天仅可取消一次已生效未签到的预约；预约生效后，需在 30 分钟内刷卡入馆。
> 30 分钟内未刷卡入馆，预约自动失效，预约人记违约一次。馆内当日预约，实时生效，无须刷卡。
> （4）座位保留：中途刷卡出馆，座位自动保留 20 分钟；午餐时段 10:30-13:00 及晚餐时段 16:30-19:00 出馆，
> 座位自动保留 1 小时。过时自动释放座位，如需使用请重新预约。
> （5）**违约处罚：违约累计 3 次，座位预约资格冻结一周。以上违约处罚将于每个自然年首日自动清零。**
> （6）为了更好地利用座位资源，如需离馆不再使用座位者，建议主动操作「提前离座」或「释放座位」，
> 图书馆将采取积极开放的机制鼓励文明离馆，方便他人。

**「连续三次违约停一个礼拜」这个 CC98 说法，官方规则是「累计 3 次，冻结一周」+「每年首日清零」。**
差别：**是累计不是连续**，且**自然年清零**。见下方 CC98 对照表。

### 研讨间 / 研习间规则（`data.seminar_rule`，摘要）

- 多人研讨间：可约当日或次日，**每次 1-4 小时**，开放 8:30-22:30；预约开始前 30 分钟可取消。
- 8 人或 10 人间除申请人外**还需至少 3 位参与人学工号**；14 人间需至少 6 位，且**需人工审核**。
- **每人每日可使用（含预约与参与）研讨间 2 次。**
- 违约：**累计 3 次暂停所有空间预约权限 7 天**。触发情形：预约开始 30 分钟后签到人数不足、使用后未复原场地、未关门窗电源。
- 签到方式（原文）：**「钉钉扫码 / 人脸识别 / 刷校园卡」三选一，在预约房间门口屏幕签到**。
- 单人研习间：每日 7:00 开放，可约当日或次日，**生效后 60 分钟内签到**；中途出馆当日始终保留。
- 单人多日研习间：**仅 5SC07(E)-5SC08(E) 共 2 间**；每周一 7:00 开放，可约本自然周 1-7 天；每日需 9:30 前签到一次。
- 媒体工坊（试开放）：每周五，演播室/录音室/多功能摄影室；**提前 7 天**（前一週五 7:00）开放；每人次 1-2 小时；电话 0571-88206071。
- 基础馆三楼 IC 空间（蓝绿红三研讨空间）：提前 5 天开放，开放 8:00-22:00，**至少 4 人刷卡签到**。

## 坑

1. **`bearer` 无空格**（见上）。这是本站最大坑，会把「已登录」误判成「未登录」。
2. **`/h5/#/login` 的 CAS 跳转是异步的**，goto 后不能立刻判 URL。
3. **CAS 的 `#dl` 是 `<button type="button">`，不是 submit**。用 `input[type=submit]` 选择器会点空。
4. **回跳是 http 而 service 是 https**：登录后落到 `https://booking.lib.zju.edu.cn/h5/index.html#/cas/?cas=<ticket>`，
   注意 path 从 `/h5/` 变成 `/h5/index.html`，hash 变成 `#/cas/?cas=`。脚本里不能硬编码 `/h5/#/` 等它。
5. **`/api/Seat/tree`、`/api/Seat/date` 永远 500/code201**（无论 GET/POST、带不带 token、带不带 `libPlace`）。
   它们是 SPA 里的**废弃路径**，真数据走 `/reserve/index/quickSelect`。别在这两个上浪费时间。
6. **`/api/Seat/seat` 报「请选择区域不能为空」**，但其参数名在 bundle 里查不到——同样是被 `/reserve/index/detail` 取代的旧接口。
7. **`/api/Help/index` 返回 20B 空**，`/api/Help/detail` 返回 500 HTML「系统发生错误」。
8. **免登录也返回 HTTP 200**：业务错误在 body 的 `code` 里（`10001`=未登录，`201`=服务器异常，`0`=成功但有 0 和 1 两种语义）。
   只看 HTTP 状态码会全盘误判。注意：`/api/index/notice` 用 `code:1` 表示成功，`/reserve/index/index` 用 `code:0` 表示成功——**同一个站里两套约定**。
9. **登录态在 sessionStorage，不在 cookie**。`ctx.storageState()` 只存 cookie，所以 JWT 必须另存。
   **落盘位置固定为 `_scratch/token.txt`**（可随时清空、不入索引），并在新页面 `addInitScript` 注入 `sessionStorage.token`。
   跑完 `crawler.mjs` 后请删 `_scratch/`。
10. **JWT 是个人凭据，不是普通字符串**。它的 payload 可 **base64 直接解出学号 / 姓名 / 手机号 / 院系**。
   硬规矩：**绝不写进站点根目录**（`site.json`/`endpoints.json`/`wiki.md`/任何 .txt 都不行），
   也不要把 `UserInfo` 整段 echo 到日志。日志只报「有没有 / 长度」。

## 本次探了什么 / 还剩什么候选

**已探**：首页/SPA 壳、CAS 全流程登录、9 个匿名只读接口、4 个本人数据接口、4 个需登录的座位查询接口、
`booking_rules` 全套规则原文、`Seminar/tree` 全馆舍目录、13 条公告标题。

**候选（未探）**：
- 研讨间实时可约时段（`/api/Seminar/v1seminar`、`/api/Seminar/date`）——需登录，`date` 已能返回日期数组，`v1seminar` 匿名报未登录。
- 活动场地预约（`/reserve/activity/*`，`monitor`/`mylist` 可能是只读）。
- 储物柜（`/reserve/locker/getLongTermLockerOrderInfo` 疑似只读）。
- 自助打印/设备（`/reserve/device/deviceInfoByTime` 需正确参数，本次未摸到参数名）。
- `/api/Study/*` 考研专座（`StudyOpenTime` 返回空数组 `data:[]`，可能当前无考研预约期数）。
