# 研究生教育管理信息系统 yjsy.zju.edu.cn

## 本页索引

<!-- yonkik:toc -->
> grep -n "^## <标题>" wiki.md 取行号，只读该节。

- 一句话结论（含真实 hostname 判定）
- 站点身份
- 鉴权
- 免登录公开区 /dataapi/open/（本页最有价值）
- 需登录区
- 接口
- 限流
- 坑
- CC98 主张核实
- 未探候选

---
**状态：done（2026-11-20）** —— hostname 已确定，免登录公开区已实测跑通（含研究生课程字典）。

## 一句话结论（含真实 hostname 判定）

**「研究生信息管理系统」的真实 hostname = `yjsy.zju.edu.cn`**，title 正是「**研究生教育管理信息系统**」。

**判定依据（不是猜的）**：
1. `GET https://yjsy.zju.edu.cn/` → 200，9,068B，`<title>研究生教育管理信息系统</title>`。
2. 前端 bundle `js/app.f1271222.js`（26MB）里硬编码：
   ```js
   l.a.prototype.API_BASE_URL = "https://yjsy.zju.edu.cn/dataapi"
   window._CONFIG["casPrefixUrl"] = "https://zjuam.zju.edu.cn/cas"
   ```
3. bundle 里出现的研究生域链接：`yjsy.zju.edu.cn/bks`、`yjsy.zju.edu.cn/open/zsss/ZsssBksmOpenList`、`yjsybg.zju.edu.cn`（研究生院办公网，是**内容站**不是系统）。

**同时证伪两个易混的候选**：
- `grs.zju.edu.cn` → 301 到 `www.grs.zju.edu.cn`，是**研究生招生网**（内容站），不是管理系统。
- `yjsybg.zju.edu.cn` → 研究生院**办公网**（webplus 内容站，同 bksy 结构）。

CC98 帖 5660205/5718567/6009585 说的都不是本站（那是大仪平台，见 `yqgx.hic.zju.edu.cn`）。研究生系统相关的帖是 6658969「怎么提交奖学金申请」、5678907「登不了一点」、5512082「重定向次数太多」、5819581「学位论文模块能否重新提交」、5384393「登录显示没有权限」。

## 站点身份

- **jeecg-boot** 后端 + **Vue2 / ant-design-pro-vue** 前端，nginx。
- 两个 API 前缀并存：
  | 前缀 | 性质 | 匿名响应 |
  |---|---|---|
  | `/dataapi` | **前端实际使用的业务 API** | `{success:true,message:"Token失效，请重新登录!",code:401}` |
  | `/api` | 另一套网关（响应格式不同） | `{"code":401,"msg":"invalid token"}` |
- 除 `/dataapi/**` 外，**所有路径都会被 SPA catch-all 接住**返回同一个 9KB 壳（包括 `/api/`、`/open/...`、`/sys/...`）。所以「返回 200 且是 HTML」= 你打到了壳。

## 鉴权

```
CAS（zjuam，campus-sso）→ Token（header 携带）→ /dataapi/**
```

- `casPrefixUrl = https://zjuam.zju.edu.cn/cas`
- 401 响应：`{success:true,message:"Token失效，请重新登录!",code:401,result:null}` —— **注意 `success:true` 和 `code:401` 同时出现**。
- **⚠️ 判据必须是 `body.code`，不是 HTTP 状态码**：HTTP 恒 200。
- 登录方式：CAS（campus-sso 一卡通）。未见本地账密表单。

## 免登录公开区 /dataapi/open/（本页最有价值）

**`/dataapi/open/**` 是整个站唯一免登录可读区，且内容比预期丰富得多。** 全部实测 200 + `code:200`：

| 接口 | 返回 | 大小 | 用途 |
|---|---|---|---|
| `GET /dataapi/open/zsss/getCurrentZsnf` | `{result:"2027"}` | 86B | 当前招生年份 |
| `GET /dataapi/open/zsss/queryXyList?mllx=1&zsnf=2027` | `result:[{id,parentId,departName,departNameEn,orgCode,orgCategory,…}]` | **33,911B** | **全部研究生招生院系清单** |
| `GET /dataapi/open/zsss/queryXxfsList` | `[{value:1,text:全日制},{value:2,text:非全日制}]` | 209B | 学习方式字典 |
| `GET /dataapi/open/zsss/zsml?nf=&…` | 缺参报「报考院系、报考专业、研究方向必须选择一个查询」 | 147B | 招生目录（需三级联动参数） |
| `GET /dataapi/open/pyPyfa/listPyfaFz` | `[{id,fzmc:'8选3',zxsl:3,zdsl:8,…}]` | 2,293B | **研究生培养方案分组规则** |
| `GET /dataapi/open/pyPyfa/listPyBxxx` | `[{value:'必修'},{value:'选修'}]` | 201B | 必修/选修字典 |
| `GET /dataapi/open/config/listPyhj` | `[{id,dm,mc:'始毕业教育',sfkc,sfsx,mrxf,…}]` | 3,544B | **培养环节字典** |
| `GET /dataapi/open/config/listPykc` | `[{id,mc:'公共学位课',kcxz_dictText,sfkc,sfsx,xwlb,pylx,…}]` | **34,423B** | **完整研究生课程体系字典** |

**这意味着**：不登录就能拿到「研究生有哪些学院 / 有哪些课程 / 培养环节有哪些 / 选课分组规则是什么」。这正好回答 bksy wiki 里那条 CC98 帖「本科生能看直博的培养方案吗」—— 本科站看不到，但**研究生这边的课程字典是公开的**。

## 需登录区

`/dataapi/**` 下除 `open` 外的全部（含 `/sys/**`、`/py/**`、`/zysj/**`、`/online/**`）：

- 学籍、成绩、课表、培养方案明细、学位论文、奖学金申请、开题/中期/答辩流程
- **全部写操作**（save/edit/delete/submit/applyCheckScore/upload）—— **按安全契约一律不做**

## 接口

详见 `endpoints.json`（12 verified，2 unverified）。

关键：
| 名称 | 方法 | 路径 | 鉴权 |
|---|---|---|---|
| 招生年份 | GET | `/dataapi/open/zsss/getCurrentZsnf` | 无 |
| 招生院系 | GET | `/dataapi/open/zsss/queryXyList?mllx=1&zsnf=2027` | 无 |
| 培养方案分组 | GET | `/dataapi/open/pyPyfa/listPyfaFz` | 无 |
| **课程字典** | GET | `/dataapi/open/config/listPykc` | 无 |
| 培养环节 | GET | `/dataapi/open/config/listPyhj` | 无 |
| 任意业务 | GET/POST | `/dataapi/{module}/**` | **Token** |

## 限流

- `/robots.txt` → 200（返回的是 SPA 壳，等于没有 robots）。无 `X-RateLimit-*`。
- 保守默认：串行、并发 1、间隔 ≥2.1s。本次全程串行，0 次 429。

## 坑

1. **HTTP 200 携带 `code:401`** —— 判断鉴权看 `body.code`，看状态码会误判成「接口可用」。
2. **`success:true` 和 `code:401` 同时出现** —— 别只看 `success` 字段。
3. **SPA catch-all**：除 `/dataapi/**` 外所有路径返回同一个 9,068B 壳。`GET /open/zsss/ZsssBksmOpenList` 拿到 200 是**假象**（那是壳），真接口在 `/dataapi/open/...`。
4. **`/api/` 与 `/dataapi/` 是两套后端**，响应格式不同（`{code,msg}` vs `{success,message,code,result}`）。前端用 `/dataapi`。
5. **`queryById` 用 GET 打 404** —— 同族查询方法大概率要 POST + `mainId` 参数，本次未验证完。
6. bundle 26MB，`grep` 前先只取一次；不要反复下载。

## CC98 主张核实

| 主张（帖 id） | 实测 | 判定 |
|---|---|---|
| 6658969「怎么提交奖学金申请」 | `/dataapi/**` 奖学金相关接口需 Token；从 bundle 提取到申请/评审路由（`/gygl/qsgl/**` 等） | **证实入口在登录区**；本次按契约**未做任何提交** |
| 5678907「真是登不了一点」 | 匿名访问业务接口 → `code:401 Token失效`；CAS 登录链正常（`casPrefixUrl` 可达） | **无法复现登录失败**（本次未尝试 CAS 登录给研究生系统）。若用户遇到，先查 CAS 侧 |
| 5512082「重定向次数太多」 | `zjuam.zju.edu.cn/cas/logout?service=` 在 bundle 里有；登录回跳链是 CAS 一次性 ticket | **未复现**。ERR_TOO_MANY_REDIRECTS 通常=CAS ticket 回跳环，属会话 cookie 问题，非站点挂 |
| 5819581「学位论文模块能否重新提交」 | 学位论文相关路由在 `/dataapi/zysj/**`、`/py/**`，需登录；是否有「重新提交」开关属业务规则 | **无法从公开区判定**，需登录后看模块状态 |
| 5384393「登录显示没有权限」 | 业务接口 401 与「无权限」是两层（Token 无效 vs Token 有效但角色不足） | **合理**：jeecg 的 role/permission 体系决定。需登录后看 `/sys/role/list` |

## 未探候选

1. **`/dataapi/open/pyPyfa/{queryPyPyfaHjByMainId, queryPyPyfaDetailByMainId, queryPyPyfaKcByMainId}`** —— 培养方案明细（课程/学分/方向）。需 `mainId`，疑似 POST。**这是下一个最高价值目标**（先用 `listPyfaFz` 拿方案 id）。
2. `/dataapi/open/zsss/zsml` 的完整三级联动（院系→专业→方向），可拼出完整招生目录。
3. `/dataapi/open/zsss/queryZyList`（专业列表）—— 从 bundle 看到，未单发。
4. `/dataapi/open/dsfc/**`（导师风采墙）—— bundle 有 `wall`/`home`/`countByField`，实测 `/open/dsfc/home` 与 `/open/dsfc/wall` 都 404，说明路径形态不对，需从页面抠真实参数。
5. 登录后的只读区（成绩/课表/培养方案明细）—— 需 CAS 登录，本次未做。

## 一证多站

CAS（zjuam）→ `campus-sso`。本站在 `_sso.json` 的 `zjuam-cas` 家族名单内。见 `sites/_sso.json`。

## 登录区与课表（2026-11-22 新探，已闭环）

原 wiki 的「未探候选」说「登录区未探、只有 `/dataapi/open/**` 免登录」。本次补齐了 **CAS 登录 + token 机制 + 教学日历 + 课表**。

### 脚本

```bash
node sites/yjsy.zju.edu.cn/login.mjs            # CAS 登录，拿 JWT 存 token.json（约 15 秒）
node sites/yjsy.zju.edu.cn/crawler.mjs me       # 登录身份（判断本科生/研究生）
node sites/yjsy.zju.edu.cn/crawler.mjs cal 2026 12   # 教学日历 + 节次表
node sites/yjsy.zju.edu.cn/crawler.mjs kb 2026 12    # 登录用户课表（需研究生身份）
node sites/yjsy.zju.edu.cn/crawler.mjs open     # 免登录区总览
```

### 鉴权：短 token + `X-Access-Token`

```
CAS 给 service 签 ticket
  → GET /dataapi/sys/cas/client/validateLogin?ticket=<ST-…>&service=https%3A%2F%2Fyjsy.zju.edu.cn%2F
  → { success: true, result: { token, userInfo } }
后续请求头：X-Access-Token: <JWT>
```

实测登录后落地 `https://yjsy.zju.edu.cn/dashboard/analysis?ticket=<ST-ticket>`，
`login.mjs` 从网络层捕获 `validateLogin` 回包，token 写入 `token.json`。

**与 zdbk 的关键差别**：yjsy 是标准 JWT 头鉴权，**不需要浏览器管 cookie**，
`node:https` 直接带 `X-Access-Token` 就能用（zdbk 那边必须走浏览器上下文）。
所以 `crawler.mjs` 是纯 HTTP，比 zdbk 的轻得多。

### 教学日历（本页最有价值的新增）

```
GET /dataapi/system/sysJxrlXqsj/getJxrlByXnxq?xn=2026&xq=12&sfqr=1
```

实测返回：

```
开学 2026-09-14   结束 2027-01-15
总周数 18   排课周数 16   考试周数 2   下半学期起始周 9
```

**节次表（14 节精确起止，这是解析任何课表文本的钥匙）**：

| 节 | 起 | 止 | 节 | 起 | 止 |
|---|---|---|---|---|---|
| 1 | 08:00 | 08:45 | 8 | 15:05 | 15:50 |
| 2 | 08:50 | 09:35 | 9 | 16:15 | 17:00 |
| 3 | 10:00 | 10:45 | 10 | 17:05 | 17:50 |
| 4 | 10:50 | 11:35 | 11 | 18:50 | 19:35 |
| 5 | 11:40 | 12:25 | 12 | 19:40 | 20:25 |
| 6 | 13:25 | 14:00 | 13 | 20:30 | 21:15 |
| 7 | 14:15 | 15:00 | 14 | 21:20 | 22:30 |

**注意两个坑**：
1. **节次时间是 4 位整数**（`800` = 08:00，`1325` = 13:25），**不是秒数也不是分钟数**。
   直接当数字用会得到荒谬结果。
2. **第 14 节是 21:20-22:30**（71 分钟），比其他节的 45 分钟长 —— 别硬编码「每节 45 分钟」。

这套节次表能直接喂给 zdbk 课表里的 `sksj` 文本（如「周二第6,7,8节」），把 6/7/8 换算成 13:25-15:50。

### 课表：本科生为空是预期

```
GET /dataapi/py/pyKcbj/queryXskbByLoginUser?xn=2026&pkxq=12
→ { result: { kcbMap: { 星期1..7: { 节次: [课程…] } }, sjddList: [] } }
```

**本机实测五个参数组合（xn 2026/2025 × pkxq 11/12/13/14）全部返回 `kcbMap:{}`，课程条目 0。**

原因不是接口坏，而是**测试账号的身份是本科生**：

```
GET /dataapi/sys/user/getUserInfo
→ userInfo.orgName = 本科生院, orgCategory = 2, userIdentity = 1
```

研究生课表只对研究生身份有数据。`crawler.mjs kb` 会在空结果时把这条写进 `note`，
避免下次误判成「接口失效」。**这是本页最容易被误读的一处。**

### 参数语义

| 参数 | 含义 | 取值 |
|---|---|---|
| `xn` | 学年的**头一年** | `2026` = 2026-2027 学年 |
| `xq` | **大学期**（教学日历用） | `11`=春夏、`12`=秋冬 |
| `pkxq` | **小学期**（课表用） | `11`=春、`12`=秋、`13`=冬、`14`=夏 |

**`xq` 和 `pkxq` 的编码不是一个体系，别混用**。当前学年学期用
`GET /dataapi/system/sysApp/queryByDm?dm=py_xsxk` 的 `dqxn`/`dqxq`（实测 `2026`/`12`）。

### 身份分流

`/bks` 是本科生入口（实测返回 9,078B 的 SPA 壳，存在）。
助理项目注释提到「本科生账号在研究生入口换 token 返回 500『无效的用户信息』」，
实测**没有复现**——本科生身份直接从 `/` 入口也拿到了 token（`userInfo.orgName=本科生院`）。
所以按学号猜入口这件事目前不必做，先试 `/` 最省事。

### 其他

- `/dataapi/sys/user/getUserInfo` 回包 **214KB**（含部门树、角色、权限），只要身份时只取 `result.userInfo`。
- 免登录 open 区在本次回归中**依然全部可用**（`listPykc` 72 门课程字典仍免登录）。
