# 启真在线 / 启真平台（qzonline.zju.edu.cn）

## 本页索引

<!-- yonkik:toc -->

- 概览
- 鉴权
- 限流
- 接口（详见 endpoints.json）
- 场馆实况（2026-11-20 实测）
- 「启真在线可以开盒」—— 实测结论
- CC98 主张的实测验证
- 坑
- 脚本用法（crawler.mjs + login.mjs）
- 本次探了什么 / 还剩什么

---
## 概览

`qzonline.zju.edu.cn` = **启真在线 / 启真平台**，浙大师生活动空间共享服务。
`/` → `/hom/uni`（Vue2 SPA，4.3KB 壳），页面 meta 自称「**魔点开放平台**」——
后端是**魔点（MoDian）SaaS**，接口命名空间 `/uni/harvardweb/*`。

**它管两件事：**

| 功能 | 入口路由 | 实测规模（2026-11-20） |
|---|---|---|
| **公共场馆预约**（会议室/报告厅/学生活动用房/剧场/体育场馆/室外广场） | `#/venue/list` | 紫金港 **296 个**可约空间 / 30 页 |
| **自习空间查询**（占座率实时） | `#/selfRoom/list` | 紫金港 **161 间**教室 |

> **CC98 帖子 6304967（2025-10）「在一个不为人知的角落，启真在线悄悄地死了」—— 证伪。**
> 2026-11-20 实测活着，且数据新鲜：场馆可约时段正常、自习室实时占座率在更新。

## 鉴权

- **SPA 壳免登录**：`GET /hom/uni` 200，首屏渲染出「自习空间查询 / 图书馆 / 公共场馆预约」菜单。
- **所有数据接口 401**：未登录调 `POST /uni/harvardweb/*` 一律
  `{result:'n_e_401_001', message:'登录失效，请重新登录'}`。
- **登录链路 = CAS OAuth2**（不是普通 CAS service 跳转）：
  ```
  GET https://zjuam.zju.edu.cn/cas/oauth2.0/authorize
      ?response_type=code
      &client_id=SO5PrSEqSOVcVaCR4p
      &redirect_uri=https%3A%2F%2Fqzonline.zju.edu.cn%2Fhom%2Funi%2F
    → CAS 登录页 → 回跳 /hom/uni/?code=ST-xxx
    → POST /uni/harvardweb/account/user/login/auth  换本地会话
  ```
- **验证码关闭**：`GET https://zjuam.zju.edu.cn/cas/v2/getKaptchaStatus` → `false`（实测），
  playwright 填 `#username`/`#password` 点 `#dl` 一次通过。凭据键 `campus-sso`。
- 会话保存为 `state.json`（playwright storageState），`_scratch/api.mjs` 会读它并转发 cookie。

## 限流

- `robots.txt` → 404；无 `X-RateLimit-*`。
- 保守默认：**串行、间隔 ≥2s、并发 1**。本次未触发 429。
- 场馆/自习数据变化慢（预约状态按分钟级），不要轮询；查一次够用。

## 接口（详见 endpoints.json）

**全部 POST + JSON body，前缀 `https://qzonline.zju.edu.cn/uni`，除 `checkLogin` 外全部需登录。**

| 接口 | 用途 |
|---|---|
| `PUT /custom/checkLogin` | 会话探针（唯一免登录，PUT 方法） |
| `POST /harvardweb/space/campus/alllist` | 校区列表（10 个） |
| `POST /harvardweb/space/building/alllist` | 楼宇列表（`{campusId, roomType:1}`，紫金港 59 栋） |
| `POST /harvardweb/spacereserve/space/list` | 资源类型（会议室/活动用房/剧场/体育/室外广场） |
| `POST /harvardweb/spacereserve/resourceForUser/list` | **可约场馆列表**（分页） |
| `POST /harvardweb/spacereserve/space/resource/detailForCUser` | 场馆详情（开放时间/活动类型/管理单位电话） |
| `POST /harvardweb/spacereserve/reserve/multiPeriodQuery` | **某场馆整周可约/已约时段** |
| `POST /harvardweb/selfstudyroom/selfroom/list/forstudentv2` | **自习教室 + 占座率** |
| `POST /harvardweb/space/baseconfig/list` | 自习筛选词表（插座/饮水机/咖啡吧…） |
| `POST /harvardweb/space/building/allList/forSelfStudy` | 自习楼宇列表 |

### 响应约定
- 成功 `result: "0"` + `message: "Operation Success"`。
- 失败 `result: "n_e_401_001"`（未登录）/ `"ME01130000000"`（Unknown Error，多为**参数缺失**）。
- 分页统一在 `data.paginator`（自习室在 `data.responsePageList.paginator`）。

### 两个最常用的调用
```bash
# 场馆列表（紫金港）
curl -s -X POST 'https://qzonline.zju.edu.cn/uni/harvardweb/spacereserve/resourceForUser/list' \
  -H 'content-type: application/json' -b @cookies.txt \
  -d '{"buildingIdList":null,"campusId":"1759975326139547648","openDate":"2026-11-20","peopleCapacity":"","resourceName":"","spaceTypeId":"","baseConfigIdList":[],"paginator":{"pageNum":1,"pageSize":10},"limit":""}'

# 某场馆整周时段
curl -s -X POST 'https://qzonline.zju.edu.cn/uni/harvardweb/spacereserve/reserve/multiPeriodQuery' \
  -H 'content-type: application/json' -b @cookies.txt \
  -d '{"startDate":"2026-11-16","endDate":"2026-11-22","spaceResourceId":"1759764812637667343"}'
```

## 场馆实况（2026-11-20 实测）

- **资源类型 5 类**：会议室(报告厅)、学生活动用房、剧场、体育场馆、室外广场。
- **紫金港 296 个可约空间 / 30 页**，覆盖东五教学楼、南华园、白沙综合楼、成均苑9幢（公管大楼）、
  和同苑1-5幢（化工大楼）等。
- 每馆带：可容纳人数、是否需审批（`approval`）、可预约时长范围（`minReserveTime`～`maxReserveTime`，
  15 分钟～24 小时不等）、开放时段（`openStartTime`～`openEndTime`）、设备（话筒等）、宣传图。
- **多条带「(限用)」标记**，且原文有「仅限化工教师预约！学生勿约」这类硬限制——查场地时必须读全名称，别只看房号。
- **自习教室 161 间**，分「空闲(占座率<30%)/忙碌(30-60%)/拥挤(>60%)/待开放」四档；
  待开放（占座率超阈值智能开放）占多数（145 间）。
- 已占时段只暴露 `activityName`（如「工作会议」「学院合作交流」这类通用活动名）。

## 「启真在线可以开盒」—— 实测结论

**CC98 帖子 6044387「我突然发现启真在线可以开盒」—— 在场馆/自习这两个面上，证伪。**

按「只读地看一次公开列表页、不遍历不猜 ID」的要求实测：

| 检查对象 | 结果 |
|---|---|
| 场馆列表 `resourceForUser/list` | 20 个字段，**零个人信息**。只有场馆属性（位置/容量/审批/时段/设备/图片） |
| 场馆详情 `detailForCUser` | 有 `principal` / `principalMobile`，但值是**管理单位 + 办公电话**（「会务中心 / 87073129、88981975」），不是个人手机 |
| 已占时段 `multiPeriodQuery` | 只给 `activityName`（活动名）+ 起止时间戳。**不含预约人姓名/学号** |
| 自习教室 `forstudentv2` | 只有房间状态/占座率/容量，无人员字段 |

**结论：在本组实测的两个只读面上拿不到他人身份信息。**
「开盒」如果真实存在，更可能在**未测的**接口里 —— 具体是无从确认的候选，本页不臆测：
`reserve/listInitiated`、`reserve/listInvited`、`initiatedReserveDetail`（这些是「我的预约」，
返回字段名提示含发起人/受邀人，但属个人数据，本次按安全契约未取），
以及 `spacereserve/reserve/audit/*`（审批侧）、`member/memberList`、`dept/members`（通讯录类）。
**要复核这一点，需要单独授权的定向测试，不能靠遍历。**

## CC98 主张的实测验证

| # | CC98 主张（帖子 id） | 实测（2026-11-20） | 判定 |
|---|---|---|---|
| 1 | 5699865（2023-09）上线公告「『启真在线』师生活动空间共享服务平台」 | 站点活着，标题「启真平台」/「启真在线」；功能=公共场馆预约 + 自习空间查询，与「活动空间共享」描述一致 | ✅ 证实 |
| 2 | 6304967（2025-10）「在一个不为人知的角落，**启真在线悄悄地死了**」 | **站点正常**：`/hom/uni` 200，登录后场馆列表回 **296 个**、自习室 **161 间**、时段数据实时（当日有已约记录） | ❌ **证伪**（站点存活且数据新鲜） |
| 3 | 6619986（2026-09）「启真在线**丹青场地预约不了**」 | 场馆总数 296、覆盖紫金港多楼宇；**未逐一验证「丹青」具体场馆**。可确认的是站点整体可预约，非全面故障 | ⚠️ 无法直接验证（未定位到「丹青」场馆条目） |
| 4 | 6465961「启真在线平台**提前多久可以预约**公共场馆」 | 接口实测：每馆有 `minReserveTime` / `maxReserveTime`（可约时长 15 分钟～24 小时）与 `preMin` / `preMax`（提前量字段）。**「提前多少天」的全局规则未在接口里显式给出** | ⚠️ 部分验证（有时长与提前量字段，未确证天数上限） |
| 5 | 5768311「求问**尧坤楼**哪里有面试场地，**启真在线没有找到**」 | 场馆列表按 `buildingIdList` / `resourceName` 过滤；紫金港 59 栋楼宇里是否含「尧坤楼」本次未逐个核对。场馆目录确实以**会议室 / 活动用房 / 剧场 / 体育 / 室外广场**为主，**普通面试用的小房间未必收录** | ⚠️ 部分验证（目录偏正式场馆，与「找不到面试场地」不矛盾） |
| 6 | 6044387「我突然发现**启真在线可以开盒**」 | 只读核查两个公开面（场馆列表 20 字段、场馆详情、整周已占时段、自习室列表）：**均无他人身份信息**；已占时段只给 `activityName`。`principalMobile` 是管理单位办公电话 | ❌ **在本组实测面上证伪**（未测的 `listInitiated` / `listInvited` 等个人面未取，见「开盒」节） |

## 脚本用法（crawler.mjs + login.mjs）

两个脚本配套：**先登录拿会话，再查询**。

```bash
# 1) 登录（首次 / 会话过期后；TTL 实测约 30 分钟）
yonkik run sites/qzonline.zju.edu.cn/login.mjs
yonkik run sites/qzonline.zju.edu.cn/login.mjs --check   # 只验失效，不重登

# 2) 查询
node crawler.mjs --list
node crawler.mjs campuses                        # 10 个校区
node crawler.mjs spaces --campus 紫金港 --size 5  # 可约场馆（296 个/30 页）
node crawler.mjs spaces --all --campus 玉泉        # 全量翻页（上限 40 页）
node crawler.mjs spaces --type 会议室             # 按资源类型过滤
node crawler.mjs slots --space <spaceResourceId>  # 该馆整周时段
node crawler.mjs slots --space <id> --start 2026-11-16 --end 2026-11-22
node crawler.mjs selfstudy --campus 紫金港        # 自习室 + 实时占座率（161 间）
node crawler.mjs selfstudy --busy                 # 只看占座率 ≥30%（忙/拥挤）
node crawler.mjs detail --space <spaceResourceId> # 场馆详情
```

| op | 底层接口 | 已验证 |
|---|---|---|
| `campuses` | `POST /space/campus/alllist` | ✅ 10 个校区 |
| `spaces` | `POST /spacereserve/resourceForUser/list` | ✅ 紫金港 total=296 / 99 页（size=3） |
| `slots` | `POST /spacereserve/reserve/multiPeriodQuery` | ✅ 整周 7 天，含已约活动名 |
| `selfstudy` | `POST /selfstudyroom/selfroom/list/forstudentv2` | ✅ 161 间，占座率实时（19%/16%） |
| `detail` | `POST /spacereserve/space/resource/detailForCUser` | ✅ 含管理单位/活动类型/收费说明 |

### login.mjs 做了什么
1. 打开 `#/venue/list` 触发 CAS OAuth2 跳转
2. 先探 `GET /cas/v2/getKaptchaStatus` —— `false` 才自动填账密（`true` 直接 exit 2 要求人工）
3. 填 `#username`/`#password` 点 `#dl`（密码由页面 JS 做 RSA+反转，不能手写 POST）
4. 回跳 `/hom/uni/?code=ST-…` → 前端换本地会话
5. `storageState → state.json`，再用 lib 复核一次接口确认可用

**会话失效时 crawler 会明确报错**：`会话已过期（401）。先跑: yonkik run sites/qzonline.zju.edu.cn/login.mjs`，
不会静默返回空数据。

### 本脚本的安全边界
- **没有实现任何 reserve / cancel / apply / audit 操作。**
- 脚本里的 POST 全部是「读取型查询」（该后端把查询建模成 POST + JSON body），不改变服务端状态。
- `client` 来自 `lib/http.mjs`，能力面只有 `get/post/download` —— put/patch/delete 不存在。

### 实现细节（都已在脚本里处理）
1. `selfstudy` 接口**按楼宇分组**返回（`list[].userEduSelfRoomDtoList[]`），脚本已摊平成房间级。
2. 占座率字段是 `useRatio`（整数百分比），分档口径：<30 空闲 / 30–60 忙碌 / >60 拥挤。
3. `slots` 的时间是 **UTC 毫秒字符串**，脚本已 +8h 转成东八区 HH:MM 显示（实测 13:00-16:00 与页面一致）。
4. 校区名支持**模糊匹配**（`紫金港` → 紫金港校区），匹配不到唯一项时报错并列出可选值。
5. 两个分页对象位置不同（场馆 `data.paginator` / 自习室 `data.responsePageList.paginator`），已分别处理。

## 坑

1. **接口全 POST，`GET` 不行。** 拼 `GET /uni/harvardweb/space/campus/alllist` 会 404/405。唯一例外是 `checkLogin` 用 **PUT**。
2. **`multiPeriodQuery` 要 `startDate`+`endDate`，不是单个 `date`。** 传 `{date:'2026-11-20'}` 回 `ME01130000000 Unknown Error`——报错信息不说缺什么，极易误判成「接口坏了」。
3. **`building/alllist` 不带 `campusId` 回空数组**（`data:[]`），不是无权限。同理 `roomType` 也不可省。
4. **`ME01130000000 Unknown Error` 基本等于「参数不对」**，不是服务故障。遇到先回去对 body 字段名（用浏览器抓真实请求最快）。
5. **校区 ID 是雪花 ID 字符串，不是数字/拼音。** 紫金港 `1759975326139547648`，玉泉 `1759976030514184362`。别用数字或 `zjg` 之类去猜。
6. **两个「列表」接口的 paginator 位置不同**：场馆在 `data.paginator`，自习室在 `data.responsePageList.paginator`。写通用分页器会踩。
7. **`/hom/uni` 是 history 之外的 hash 路由**（`#/venue/list`）。直接 `page.goto('#/venue/list')` 有时会先渲染首页再跳 CAS——要等 `waitForTimeout` 足够长（实测 10s+）。
8. **CAS OAuth 的 `client_id` 是硬编码在 JS 里的公开值**（`SO5PrSEqSOVcVaCR4p`），`redirect_uri` 必须精确 `https://qzonline.zju.edu.cn/hom/uni/`（带尾斜杠）。手工拼歪会 `redirect_uri` 不匹配。
9. **`principalMobile` 不是泄露的个人手机**，是管理单位对外办公电话。别据此判定站点泄露隐私。

## 本次探了什么 / 还剩什么

**已探（done）**：SPA 结构、CAS OAuth2 全链路（含 client_id/redirect_uri）、getKaptchaStatus、登录成功、
10 个校区、紫金港 59 栋楼宇、5 类资源、296 个场馆、161 间自习室、场馆详情、整周时段、
「开盒」两个只读面的字段级核查（无个人信息）。

**未探（unverified）**：
- **写操作全部未执行**：`reserve/add`、`reserve/zju/add`、`cancelReserve`、`cache/update` 一律未调用。
- 「我的预约」类只读接口（`listInitiated`/`listInvited`/`initiatedReserveDetail`）—— 属个人数据，
  本任务不需要，未取。**开盒复核若要做，从这里起手**（需单独授权）。
- `spacereserve/space/detail`、`space/queryparam` 正确参数未定（恒回 Unknown Error）。
- 图书馆座位预约（`bodyText` 里「图书馆 前往进行座位预约」）——已跳转到 `booking.lib.zju.edu.cn`
  之类的独立系统，不在本站接口内，未探。
