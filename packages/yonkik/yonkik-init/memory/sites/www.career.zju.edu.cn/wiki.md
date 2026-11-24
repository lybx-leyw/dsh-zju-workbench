# 就业服务平台 www.career.zju.edu.cn（91JOB）

## 本页索引

<!-- yonkik:toc -->
> 按节读：grep -n "^## <标题>" wiki.md 取行号。

- 结论速览
- 系统身份
- 入口与免登录边界
- 接口（全部已验证）
- 栏目树（免登录，13KB）
- 栏目树里能看到的功能 / 被别人问到的功能
- 坑
- 未探候选
- 一证多站

---
**状态：done（2026-11-20 只读探索）** —— 招聘会/宣讲会/双选会/公告/就业质量报告**全部免登录可读**（实测数据量大：宣讲会 9840、招聘会 728、空中双选会 135）。**未投递、未报名、未预约。**

## 结论速览

1. **免登录能读的量远超预期**：宣讲会 **9840** 条、线下招聘会 **728** 条、空中双选会 **135** 条、公告/就业质量报告全部可读。CC98 说「投了几十家没用」讲的是**投递**（需登录、属写），但**「有哪些会、什么时候、在哪」完全免登录**。
2. **分页参数是 `current`/`size`**（MyBatis-Plus），不是 `pageNum`/`pageSize`。用后者每页恒 10 条、翻页无效。
3. **`.zf` 老接口要 POST JSON**（不是表单）：`getZhZphQtListAjax.zf` 等，`code:0` 才表示成功（不是 200）。
4. **有实测 429**：连续同类 POST 会触发。间隔应 ≥2.5s，遇 429 退避 ≥10s。
5. **「历届去向查询」当前前端路由被注释掉**——不是权限问题，是功能下线。

## 系统身份
- 实名 **91JOB**（`<noscript>`：`We're sorry but 91JOB doesn't work properly without JavaScript enabled`），厂商级就业 SaaS。
- 前端 Vue2 + webpack，服务端 Tengine/2.1.2，`.zf` 老接口跑在 **Apache Tomcat/7.0.109**。
- 浙大在该 SaaS 内的站点主键 `wzid = 738C287EDD337810E0538713470A8F26`（用 `xxdm=10335` 换）。

## 入口与免登录边界

**所有前端路由都返回同一个 7874B SPA 壳**——所以「某路由 200」不能证明它存在。判断免登录/需登录的**权威依据是 app.js 里 Vue Router 的 meta**：

| meta | 含义 |
|---|---|
| `stationFrom: "home"` | 公开站，**免登录** |
| `stationFrom: "stu"` + `requireAuth: true` | 学生端，**需登录** |

免登录路由（`stationFrom:'home'`）：`/recruitment/{announcementList, announcementDetail, meetingList, positionList, unitList, policyPost, meetingDetail, jobDetails, companyDetails}`、`/lecture/{meetingList, detail}`、`/notification/{announcementList, detail}`、`/activityList`、`/searchList`、`/consultants`、`/contacts`、`/eventCalendar/list`、`/activity/detail`、`/schoolList`、`/issue`、`/file/list`、`/video/list`、`/video/detail`、`/recommend-jobs`。

需登录路由：所有 `/sc/*`（个人中心、我的简历、就业协议申请、选调生档案/报名/追踪、面试间预约、去向查询）。

**登录通道**：
- 学生：`/sc/register`、`/sc/forget`、`/login/:xxdm/:mode`、`POST /stu/auth/login`（本站学生账号体系）
- 用人单位：`/jyxt/web/login/dwSlogin.zf`
- 校友：`/jyxt/web/login/xsSlogin.zf`
- 就业管理：`/jyxt/xtgl/login/slogin.zf`
- OAuth：`/jyxt/oauth/getUserInfo`（token 由 `/pub/getAccessToken`）

## 接口（全部已验证）
Base `https://www.career.zju.edu.cn`。**核心钥匙链：`/pub/getXxxxList` → `xxdm=10335` → `/web/wsjysc/wzsy/getWzid` → `wzid` → `/web/wsjysc/wzsy/getXwlm` → 各 `lmid` → 列表接口。**

### 基础数据（`/pub/*`，免登录）
| 接口 | 方法 | 返回 |
|---|---|---|
| `/pub/getXxxxList` | GET | 学校：`[{XXDM:'10335', XXMC:'浙江大学'}]` |
| `/pub/getXyxxList` | GET | 学院 2.7KB `[{MC,DM}]` |
| `/pub/getXlxxList` | GET | 学历 `博士/硕士/本科` |
| `/pub/getJybzyList` | GET | **专业目录 235KB** |
| `/pub/getMgrUrl` | GET | 管理端 URL `…/management/` |
| `/pub/hqpz` | **POST** | 站点加密配置 blob（GET 会 405） |

### 站点与栏目（`/web/wsjysc/wzsy/*`，免登录，GET）
| 接口 | 返回 |
|---|---|
| `/getWzid?xxdm=10335&wzlx=0` | `wzid` 字符串 |
| `/getXwlm?wzid=<wzid>&xxdm=10335` | **13.3KB 栏目树**（含嵌套 `model`） |
| `/getLbt?wzid=<wzid>` | 首页轮播 13 条 |
| `/getKjdh?wzid=<wzid>` | **9KB 快捷导航（按角色分组的全站功能地图）** |
| `/getWzsz?wzid=<wzid>` | 站点主题配置 |
| `/getYqlj?wzid=<wzid>` | 友情链接（实测 `[]`） |

### 列表与详情（`/web/wsjysc/lbxq/*`）
| 接口 | 方法 | 返回 |
|---|---|---|
| `/getTzggPageList` | **POST** `{current,size,lmid}` | 栏目文章分页（**只传 lmid 即可**） |
| `/getTzggxq/{xwid}` | GET（**路径参数**） | 文章详情 |

### 招聘会/宣讲会（`/jyxt/wzsy/*.zf`，免登录，**POST JSON**）
| 接口 | total | 字段 |
|---|---|---|
| `/getZhZphQtListAjax.zf` | **728** | `zphbh zphmc zphkssj zphjssj cdmc djl ztmc(未开始/已结束) ywlx sjlx tzljdz` |
| `/getZphQtListAjax.zf` | 585 | 同上但字段少 |
| `/getKzzpQtListAjax.zf` | **135** | 空中双选会：`yddws zpgws bmrs` |
| `/getXjhQtListAjax.zf` | **9840** | 宣讲会：`xjhbh xjhmc dwmc dwxxid xjhrq xjhcdmc djl fbzt` |
| `/getZhXjhQtListAjax.zf` | — | **实测 429**（限流） |

body 统一 `{"current":1,"size":20,"xxdm":"10335"}`。**返回 `code:0` = 成功**（不是 200）。

实测样本（2026-11-20）：
```
线下招聘会 728 条 →
  「工信部就业-中博汇 高层次人才洽谈会 2026 年度秋季全国巡回招聘会浙江大学博士/博后专场」
   2026-11-23 14:00~16:30，紫金港校区尧坤楼二楼招聘大厅，未开始，djl=1385
  「浙江大学2027届毕业生秋季招聘会暨在校生实习双选会（重要媒体和科技传媒、文化传播类企业专场）」
   2026-12-05 13:30~16:30，tzljdz=https://mp.weixin.qq.com/s/0-eAJcCEokvE1OKjgls_wA
宣讲会 9840 条 →
  「苏州金合盛控股有限公司2026年秋季校园招聘宣讲会」2026-11-23 18:30，永谦学生活动中心B108
  「奇塑科技2027届校园招聘宣讲会」2026-11-24 18:00，紫金港校区尧坤楼222传化厅
```

## 栏目树（免登录，13KB）

`getXwlm` 实测完整结构（lmid = 栏目 ID，几乎所有列表接口都要它）：

```
部门介绍 738CE59CBC2F7490E0538713470A7BA2
  学校概况 / 中心黄页 / 院系联络 / 专业介绍 / 工会活动
新闻公告 738CE59CBC307490E0538713470A7BA2
  新闻动态 739BEBB72A072B25E0538713470A6C41 / 活动通知 739BEBB72A0B2B25E0538713470A6C41
  学院动态 / 公示公告
生涯规划 738CE59CBC317490E0538713470A7BA2
  指导活动 / 职规课程（本科生职规课 / 研究生职规课 / 网络慕课 / 师资培训）
  经验分享 / 职规大赛
  生涯资讯 → 新生生涯攻略 / 就业创业指南 / **就业去向查询 77AE49D4D06D240BE055000000000001** / 就业质量报告
  平台资源 → **求职宝典 197A570E9BF05941E0653A68DD0E9B18** / 就创业直播平台
            / 咨询预约 77A06565F6731505E055000000000001 / 行业导师预约（内测中） / 职业测评
招聘资讯 738CE59CBC357490E0538713470A7BA2
  综合招聘信息 A188D7448980110BE055134CA39C9BD7 / **招聘岗位信息 2B2921EE10ED2DE8E0653A68DD0E9B18**
  单位招聘信息 A1899A980FD1110DE055134CA39C9BD7 / **宣讲会 A19195EA8BF93090E055134CA39C9BD7**
  **双选会 EB867FA0734E6234E053871D470A7037** / 实习实践 / 地方人才招聘信息 / 院系招聘活动
综合服务 738CE59CBC397490E0538713470A7BA2
  就业须知 / 用人单位（招聘安排/邀请函/场地信息/校企合作/生源信息）/ 表格下载 / 政策介绍 / 统计资料
就业引导 7531BF87175E0C78E055000000000001
  国际组织（介绍/实习就业资讯/浙大国际声音/常用链接）/ 重点单位 / **基层选调 7531BF8717640C78E055000000000001** / 西部就业
学院网站 A479004F0B646F40E055134CA39C9BD7
```

## 栏目树里能看到的功能 / 被别人问到的功能

| CC98 提到 | 实测对应 | 判定 |
|---|---|---|
| 投简历（6312174） | `/sc/myResume`、`/sc/recommendation`（requireAuth） | **需登录，属写** |
| 签约信息没了 / 串号（6424592） | `/sc/paper_protocol_apply`、`/sc/teminateContract`（requireAuth） | **需登录**；「支持本科/研究生多账号」无法从公开层证实 |
| 两方协议登记（6510474） | `/sc/paper_protocol_apply` | **需登录** |
| 历年就业去向（6515971） | 栏目「就业去向查询」lmid=`77AE49D4D06D240BE055000000000001` **存在**，但**前端路由 `/sc/whereabouts` 被整段注释掉**；该 lmid 的列表接口返回 `records:[],total:0` | **功能下线**（不是权限问题） |
| 浙大钉「就业服务」攻略（6357423） | 与本平台同源的移动端封装（未验证） | 未证实 |
| 报名选调（5991467） | `/sc/selected_student/signup` | **需登录，且路由已注释** |
| 面试间预约全无法预约（6284093） | `/sc/reserveRoom` | **路由已注释** |
| 网上预约在哪（6279226） | `/sc/reserveRoom`、`/sc/advisoryReservation`、`/sc/onlineSignup` | **需登录** |
| **招聘会有哪些、什么时候、在哪** | `getZhZphQtListAjax.zf`（728）+ `getXhhQtListAjax`（9840） | **完全免登录，可批量读** |
| **毕业生就业质量报告** | lmid=`16C0456B72044BFAE0653A68DD0E9B18`，2021→2025 五份，含 PDF 直链 | **免登录** |

「就业质量报告」实测条目（`getTzggPageList`）：
- 2025 届 → `https://mp.weixin.qq.com/s/xWiQacIGdd0ro1YgYDhKHA`
- 2024 届 → `https://mp.weixin.qq.com/s/M3AeVmuHyrT85EsbQHXiPA`
- 2023 届 → `https://mp.weixin.qq.com/s/KljlVkQDC185jT4I1FtVAQ`
- 2022 届 → **`…/pub/file/preview?filePath=%2Fxwzd%2Feditor%2F…浙江大…2022年毕业生就业质量报告.pdf`（PDF 直链）**

## 坑
1. **`/robots.txt` 和 `/sitemap.xml` 都是假的**：SPA fallback 把它们吃掉，返回 7874B HTML 首页壳。别以为有 robots。
2. **分页参数是 `current`/`size`，不是 `pageNum`/`pageSize`**。用后者每页恒 10 条、翻页仍是第 1 页（实测 11 页全是同一批 10 条，`total=91` 却只拿到 10 个不同 id 的同类现象）。
3. **`{success:false,message:'系统异常',code:500}` = 参数不满足，不是接口不存在**。接口不存在会是 404 `{status:404,error:'Not Found'}` 或 405 `Method Not Allowed`。区分清楚再判断。
4. **`.zf` 接口要 POST JSON，不是表单**。用 `application/x-www-form-urlencoded` 会 415 Unsupported Media Type；GET 会 400。
5. **`.zf` 返回 `code:0` 是成功**，不是 `code:200`。
6. **`getTzggxq` 的 id 是路径参数**：`/getTzggxq/{xwid}`，写成 `?xwid=` 会失败。
7. **栏目接口必须带 `lmid`**：不传 lmid 时 `getTzggPageList` 回「系统异常」。
8. **`wzid` 必须先取**：`getXwlm`/`getLbt`/`getKjdh`/`getWzsz` 不带 wzid 都回「系统异常」。
9. **实测 429 限流**：`getZhXjhQtListAjax.zf` 连续请求触发 429（0 字节）。同类 `.zf` 接口密集调用会中招。**间隔 ≥2.5s，遇 429 退避 ≥10s。**
10. **`/jetbrains/download.html` 那类「404 页面」不存在于本站**；本站未匹配路径一律 200 SPA 壳，所以**不能用状态码判断路由存在**，必须读 app.js 的 router 表。
11. **`getZphQtListAjax` 与 `getZhZphQtListAjax` total 不同（585 vs 728）**：是两个口径，别混用做计数。

## 未探候选
- **`getZpgwPageList`（招聘岗位）已通但返回空**（`records:[],total:0`，不是报错）。下一位可从 `/js/29.*.js` 里 PositionList 的完整 body 构造：`{...query, nrbq, current, size, xxdm, lmid}`，query = `{keyword, byzd4, dwxzdm, dwhydm, zwlbdm, zpdxdm, zpxldm, nrbq}`。可能 `xxdm=10335` 或需带 `nrbq`。
- `getZpggPageList`（招聘公告）：同族但回「系统异常」，参数待定。
- `getZpdwPageList`（单位列表）：未单发。
- 详情族：`getZpgwxq`（岗位详情）、`getZphxq`（招聘会详情，实测回「系统异常」）、`getZpgwxqDwxq`（单位详情）、`getXjhxq/{id}`（宣讲会详情）。
- `/stu/auth/login` 的真实登录流程（需账号密码，或以 CAS 兜底）。
- `chat.career.zju.edu.cn`（AI 生涯导师小叶，独立子域）。

## 一证多站
学生端有 `/sc/register` 自助注册与 `/login/:xxdm/:mode`；是否接 zjuam CAS 未在公开层证实。**若要登录，优先试 `campus-sso` + CAS 兜底**，但注意本站主账号体系可能是 91JOB 自己的学生账号（注册制），而非一卡通直登。
