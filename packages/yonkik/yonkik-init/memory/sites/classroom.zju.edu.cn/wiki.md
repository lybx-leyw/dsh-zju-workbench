# classroom.zju.edu.cn · 智云课堂

> 探索日期 2026-11-20。浙大课堂教学视频平台（CMC 系，含 TronClass 血统）。登录用 `campus-sso`（一卡通）。

## 本页索引

- [一句话结论](#一句话结论)
- [入口与登录跳转链](#入口与登录跳转链)
- [鉴权分层](#鉴权分层)
- [接口](#接口)
- [字幕与课件接口（已定位）](#字幕与课件接口已定位)
- [子域矩阵](#子域矩阵)
- [CC98 主张核对](#cc98-主张核对)
- [坑](#坑)
- [crawler 操作验证](#crawler-操作验证)
- [本次探了什么 / 还剩什么](#本次探了什么--还剩什么)

## 一句话结论

可达、可登录、**登录后几乎是全开的数据源**（课程目录/课表/回放清单/公告/使用说明 PDF 全可读）。
**匿名访问业务 API 确凿 403/401**（CC98 那条是真的）。字幕/PPT 走播放器内部 + WebSocket，
不在主 bundle 里，需另找懒加载分片；本次按安全契约未触发播放。

## 入口与登录跳转链

```
https://classroom.zju.edu.cn/            (SPA 200, 15329B, title=智云课堂; 匿名可开)
  → https://zjuam.zju.edu.cn/cas/oauth2.0/authorize
      ?response_type=code
      &client_id=ObXIv4FvjcC1e9hVcS
      &redirect_uri=https://tgmedia.cmc.zju.edu.cn/index.php?r=auth/get-info&url=https://classroom.zju.edu.cn/
  → /cas/login?service=http://zjuam.zju.edu.cn/cas/oauth2.0/callbackAuthorize   (CAS 表单)
  → /cas/oauth2.0/callbackAuthorize?ticket=ST-xxxx
  → tgmedia.cmc.zju.edu.cn/index.php?r=auth/get-info   (PHP 中转, 落 JWT)
  → https://classroom.zju.edu.cn/
```

**注意**：这条链**不是** `identity.zju.edu.cn` Keycloak broker（`courses.zju.edu.cn` 才是）。
`_sso.json` 把 classroom 归到 identity-keycloak 家族**是错的**——实测走 zjuam CAS 的
**CAS-OAuth2.0** 端点（`/cas/oauth2.0/authorize`），回调中转站是 CMC 自己的 PHP。

登录后关键 cookie（都在 `.zju.edu.cn` 域，classroom / yjapi / tgmedia 共享）：
`JWTUser` `_token` `login_cmc_id` `login_cmc_tid` `group_code` `login_cmc_type` `cmc_version`
`tenant_code` `iPlanetDirectoryPro`（CAS SSO）。

## 鉴权分层

| 路径 | 匿名行为 |
|---|---|
| `/`（SPA 外壳）、`/static/*` | 200，可直接开 |
| `/static/config.js` | 200 —— **免登录就能拿到所有子域** |
| `/userapi/v1/infosimple` | **403**（空 body） |
| `/cmsapi/v1/nav/lists` | **403** `Auth Forbidden`（14B） |
| `/cmsapi/v1/portal-setting/get-tenant-modules` | 200 但 `data.code=1001 未传入租户` |
| `/cmsapi/v1/menus/get-login-menus` | 200 但 `data.err=-1 用户信息解析错误` |
| `/courseapi/v3/course-apply/get-learn-pdf` | **200 且返回真链**（免登录可用） |
| `yjapi.../courseapi/v3/course2/click` | **401** `invalid credentials` |
| `yjapi.../localeapi/localeGetLanguages` | 200 无鉴权 |

判「是否登录」的廉价探针：`GET /cmsapi/v1/nav/lists` —— 403 = 未登录，200 = 已登录。

## 接口

完整机读清单见 [endpoints.json](endpoints.json)。核心：

| method | host + path | 用途 | 鉴权 |
|---|---|---|---|
| GET | `classroom/userapi/v1/infosimple` | 用户身份/院系/租户 | 登录 |
| GET | `classroom/courseapi/v3/o-course/recent-learning?page=1&per-page=4` | 最近学习的课+小节 | 登录 |
| GET | `classroom/courseapi/v3/multi-search/get-course-detail?course_id=&student=` | **课程详情 + 完整目录 sub_list** | 登录 |
| GET | `classroom/courseapi/v2/play-template/get-config?tenant_id=112&sub_id=` | **播放器模板 + 模块清单（字幕开关）** | 登录 |
| GET | `classroom/courseapi/v2/schedule/get-week-schedules?user_id=&tenant_id=112&start_at=&end_at=` | 周课表（教室/回放状态） | 登录 |
| GET | `classroom/courseapi/index.php/v2/course/get-term-years?tenant=112` | 全部学期 | 登录 |
| GET | `classroom/courseapi/v3/multi-search/get-course-list?...&per_page=12&tenant=112` | 课程广场检索（107096 门） | 登录 |
| GET | `classroom/courseapi/index.php/v2/course/get-late-courses?tenant=112` | 近期热门课程 | 登录 |
| GET | `classroom/cmsapi/v1/web-notice/get-notice-list?tenant=112` | 公告列表 | 登录 |
| GET | `classroom/cmsapi/v1/web-notice/get-notice-detail?notice_id=` | 公告 HTML 全文 | 登录 |
| GET | `classroom/cmsapi/v1/website/info?tenant=112` | 门户导航配置 | 登录 |
| GET | `classroom/courseapi/v3/course-apply/get-learn-pdf` | 使用说明 PDF 签名直链 | **无** |
| GET | `classroom/static/config.js?version=498441` | **全站子域配置** | **无** |
| GET | `interactivemeta.cmc.zju.edu.cn/static/config.js` | 互动课堂子站配置 | **无** |

响应壳有三种，别混：
- `{success, result:{err, errMsg, data}}` —— courseapi 新版（`err:200` 才是成功）
- `{success, data:{code, msg, list/info}}` —— cmsapi
- `{code:200, message:"查询成功", params:{...}}` —— userapi（**字段叫 `params` 不是 `data`**）

### 实测样本（`play-template/get-config`）

```json
{"success":true,"data":{"code":200,"data":{"sub_id":"1996107","template_id":"27217",
  "name":"ai数字教师","type":"course_live","modules":[
    {"code":"one_videos_live_liu","name":"1号视频流"},
    {"code":"ppt_live_liu","name":"AI识别(PPT)"},
    {"code":"captions_live_gn","name":"字幕"},
    {"code":"voice_live_gn","name":"语音识别"},
    {"code":"knowledge_graph_live_gn","name":"知识图谱"},
    {"code":"ai_teacher_live_gn","name":"AI数字教师"},
    {"code":"transmission_live_gn","name":"同声传译"}]}}}
```

**这就是「字幕接口 2026-11 起要登录」的机制解释**：字幕是播放器的一个模块
（`captions_live_gn`），数据在播放会话建立后才按需拉；而建立播放会话需要登录 cookie
→ 匿名 403。不是「字幕接口单独加了鉴权」，是**整个播放上下文都要鉴权**。

## 字幕与课件接口（已定位）

> 2026-11-20 第二轮：从 42 个懒加载分片（`manifest.js`，共 7.3MB）里挖出。
> **只读单发验证通过，未触发播放。**

### 字幕 / 同传文本（CC98 问的那个）

```
GET https://classroom.zju.edu.cn/courseapi/v3/web-socket/search-trans-result
    ?sub_id=<sub_id>&format=json
```

| 项 | 值 |
|---|---|
| 定位来源 | chunk `27.49c5676f853e8c0ff9a6.js`（18,702B）方法 `getVideoTransResult()` |
| 鉴权 | **登录 cookie**。匿名 = **403 `Auth Forbidden`**（14B），已实测 |
| 依赖播放会话？ | **不依赖**。纯 GET，参数只有 `sub_id` + `format`，无签名、无 ticket。`OPEN_PLAY_AUTH=true` 只管**视频流**，不管字幕数据 |
| 响应体量 | 174,615B（一节 2.5 小时课） |

响应结构：
```json
{
  "code": 0,              // 0 = 成功
  "msg": "获取同传结果成功",
  "total": 1,
  "list": [{
    "sub_id": "1996107",
    "resource_guid": "...",
    "trans_type": "ai",    // "ai" 走 AI 字幕分支；否则走人工同传分支
    "zh_num": ..., "en_num": ..., "en_rate": ...,
    "all_content": [
      { "BeginSec": 255, "EndSec": 289, "Text": "没考虑。",        "TransText": "" },
      { "BeginSec": 289, "EndSec": 293, "Text": "嗯，不明白。",    "TransText": "" },
      { "BeginSec": 396, "EndSec": 400, "Text": "喂喂，好，那个我们开始上课…", "TransText": "" }
    ],
    "trans_content": ...
  }]
}
```

**两种字幕格式，看 `trans_type` 分支**（前端代码里的判定）：
- `trans_type === "ai"` → 用 `all_content[].time`（字符串时间）+ `Text`，**没有** `BeginSec/EndSec`
- 否则（人工同传）→ 用 `all_content[].BeginSec / EndSec / Text / TransText`（`TransText` 是英文翻译）

本机实测的这条是 `ai` 型但字段是 `BeginSec/EndSec` 形态，`TransText` 全空 —— 对应
CC98 说的「字幕有但英文翻译没识别」（6703839 那条 bug 的**数据层证据**）。

### PPT 页面文本（附带挖到，比字幕更有价值）

```
GET https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt
    ?course_id=<course_id>&sub_id=<sub_id>&page=1&per_page=N
```

| 项 | 值 |
|---|---|
| 定位来源 | 同一 chunk 的 `searchPPTList()` 方法 |
| 鉴权 | **登录 cookie**；匿名 **403**（空 body）。已实测 |
| 依赖播放会话？ | **不依赖**。纯 GET |
| **坑** | **`per_page` 被忽略**：传 3 仍返回 **74 条**（36,430B）。前端自己按 `per_page=100` 翻页，实测一次就给全 |

响应结构：
```json
{ "code": 0, "total": 74, "list": [{
    "course_id": "86159", "sub_id": "1996107",
    "created_sec": 5,        // PPT 翻页时刻（秒，相对开课）
    "default": 1, "old_id": 0,
    "content": "{"detecttype":"ppt","is_key":false,"pptimgurl":"https://video.cmc.zju.edu.cn/ai3/ppt/20261116/<uuid>/1794806517000.jpg","pptthumb":"...","status":"running"}"
}] }
```

**`content` 是「JSON 字符串套 JSON」**（`JSON.parse` 两次）。里面 `pptimgurl` 是 AI 识别出的
PPT 页面截图直链（`video.cmc.zju.edu.cn/ai3/ppt/...`），`is_key` 标记重点页。
**这就是 `ppt_live_liu`（AI 识别 PPT）模块的数据端**，不需要 WebSocket、不需要播放。

### 其他新发现的端点前缀

除已记录的 `cmsapi/userapi/courseapi/consoleapi`，分片里还露出 **`/pptnote`** 这个新前缀
（PPT 笔记，即上面那条）。同期出现的写操作端点（**未调用，仅登记**）：
`/courseapi/v2/course/record-create`、`/courseapi/v2/learn-record/learn-record`、
`/courseapi/v3/course-learn-log/log`、`/courseapi/v2/q-a/commit-answer`、
`/courseapi/v2/sign/sign`、`/courseapi/v2/collect/sub-click`、`/courseapi/v2/jump/log-add`。
**这些都是「学习进度上报 / 答题 / 签到 / 收藏」，属写操作，全程未碰。**

## 子域矩阵

全部来自 `/static/config.js`（免登录可读）：

| 子域 | 角色 |
|---|---|
| `classroom.zju.edu.cn` | 主站（SPA + cmsapi/userapi/courseapi/consoleapi） |
| `yjapi.cmc.zju.edu.cn` | **大量读接口的真实宿主**（courseapi/cmsapi/sourceapi/localeapi/casapi） |
| `tgmedia.cmc.zju.edu.cn` | 登录中转（`index.php?r=auth/get-info`）+ CASAPI + 登出 |
| `api.cmc.zju.edu.cn` | `cmcApiDomain`（`/cmc`），`login_cmc_id/tid` cookie 域 |
| `console.cmc.zju.edu.cn` | 管理台 |
| `passport.cmc.zju.edu.cn` | 个人中心（302 → tgmedia） |
| `education.cmc.zju.edu.cn` | 教育业务服务平台 =「我的学习」真正落地页 |
| `resource.cmc.zju.edu.cn` | 资源/附件 CDN（`/play/{n}/{group_id}/...`） |
| `interactivemeta.cmc.zju.edu.cn` | **互动课堂**（答题/弹幕/签到等课堂互动元数据） |
| `screen.cmc.zju.edu.cn` | 合屏/投屏 |
| `goim.cmc.zju.edu.cn` | `wss://goim.cmc.zju.edu.cn/ws` —— **PPT 实时推送**（自研二进制协议：16 字节包头，op=7 auth、op=2 心跳、op=9 多包） |
| `socketioapp.cmc.zju.edu.cn` | socket.io 服务 |
| `mcloudpush.cmc.zju.edu.cn:10443` | SRS 推流网关（`webrtc://.../live/`） |
| `yumi-intelligentsubtitle.cmc.zju.edu.cn` | **语音转译/字幕编辑工具**（`isTranslate+isRecognize`；SPACE 播放暂停、M 打点、Ctrl+S 保存 —— 编辑端，属写） |
| `yjsrs.chinamcache.com` | webrtc 视频流 |
| `exam.cmc.zju.edu.cn` | 考试外链（**实测 503**，2026-11-20 挂了） |
| `livepgc.cmc.zju.edu.cn` | 海外直播（`/pgc/`） |
| `image.cmc.zju.edu.cn` | 头像 |

`interactivemeta` 是什么：一套独立 SPA（title=`interactive-meta`，14791B），配同一套
`casapi`/`socketioapp`/SRS，`OPEN_PLAY_AUTH=true`，`CLASSROOM_DOMAIN=classroom.zju.edu.cn`。
它是**课堂互动功能（弹幕/答题/举手/签到）的数据端**，而非主站的一部分。

## CC98 主张核对

| 主张（帖子） | 实测 | 判定 |
|---|---|---|
| 登录方式 = identity Keycloak broker → zjuam CAS（会话预设） | **错**。实测 zjuam `/cas/oauth2.0/authorize` CAS-OAuth2 直连，回调经 `tgmedia.cmc.zju.edu.cn` PHP 中转；identity 的 broker 端点只回 `400 非法的请求` | **证伪** |
| 字幕接口 2026-11 起需登录、匿名 403（6690026/6701948） | **对，且机制更清楚**：字幕是播放器模块 `captions_live_gn`，建立播放会话需登录；匿名打任意业务 API 实测 403/401 | **证实（补充机制）** |
| 回放已生成但字幕没识别是多年 bug（6703839） | 数据本身无法只读验证；但 `play-template/get-config` 显示字幕模块**默认在启用列表里**，说明不是「功能未上线」而是「识别产出问题」 | **部分证实（间接）** |
| 变得像腾讯会议，显示谁在线、能开摄像头麦克风（6706742） | 租户配置含 `rtcMaxStreams:8`、`rtcStudentStream:1`、`rtcInteract:0`、`rtcScreenType:merge`；`interactivemeta` 配 SRS+SocketIO 支持学生推流 | **证实（配置层）** |
| 北教紫色「智慧课堂」、能看谁在看直播、能检索老师说过的话（6706742） | `TRANS_RESULT_SEARCH:1`（开放语音识别搜索）+ `captions_live_gn`/`voice_live_gn` + `yumi-intelligentsubtitle` 转译站。「紫色标记」属前端样式，只读接口无法验证 | **部分证实** |
| 播放记录老师看得到吗（6695534） | `NEW_STUDY_COUNT:true`（开启最新观看统计）；接口有 `learn_at`/`learn_record_num`/`course-learn-stumbleupon/experience`，课程详情同时给 `student_num`（选课人数）与 `learn_num`（已学人数）。**进度是服务端记录的** | **证实** |
| `interactivemeta.cmc.zju.edu.cn` 是互动课堂域 | 是。独立 SPA + `CLASSROOM_DOMAIN` 互指 + 同租户 112 | **证实** |

> **state.json 已被有意删除**（2026-11-20）：该文件内含可 base64 解出明文学号/姓名的会话 JWT。
> 需要会话时重跑 `login.mjs` 即可（约 30 秒）。同一原则适用于其它站：**state.json 只是缓存，不是资产**。

## 坑

1. **`/robots.txt` 返回 SPA 外壳**（15329B HTML）。SPA fallback 吃掉所有未知路径，
   **不能靠 404 判断接口是否存在**——真 API 只在 `cmsapi/userapi/courseapi/consoleapi` 前缀下。
2. **`/courseCenter`、`/coursedetail/86159`、`/play/1996107` 都是 SPA 路由回退**（200 但正文只有页头页脚）。
   正确形式是 **query 参数**：`/coursedetail?course_id=86159`、`/coursevideo?course_id=&sub_id=`。
   注意 `/coursevideo?...` 实测会被弹回首页 `/?tenant_code=112`（播放页做了权限判定）。
3. **`courseapi` 与 `yjapi` 双宿主，匿名行为不同**：`classroom/.../course2/click` 匿名可调；
   `yjapi.../course2/click` 匿名 **401**。写脚本时统一用哪个要想清楚。
4. **三种响应壳**（见上）。尤其 `userapi` 用 `params` 而不是 `data`。
5. **浏览器必须 `--no-proxy-server`**（同 chat 站；本机 7993 代理出口在墙外，Chromium 默认吃系统代理 → `ERR_CONNECTION_CLOSED`）。
6. **登录后 cookie 落在 `.zju.edu.cn` 顶层域**，所以 `classroom`/`yjapi`/`tgmedia` 共享同一份登录态；
   但 `PHPSESSID` 单独在 `tgmedia.cmc.zju.edu.cn`。
7. **`/courseapi/v3/course-collect/lists?per-page=500` 会被服务端压回 50**，别按传入值算页数。
8. **`exam.cmc.zju.edu.cn` 当前 503**，别当网络问题。
9. **`cmsapi` 的匿名 200 陷阱**：`portal-setting/get-tenant-modules` 与 `menus/get-login-menus` 匿名都回 200，
   但 body 里是 `code:1001 未传入租户` / `err:-1 用户信息解析错误`。**只看状态码会误判「免登录可读」**。

## crawler 操作验证

> 2026-11-20 第二轮逐个单发验证，**16/16 通过**。串行 >=2s，均只读。

| # | op | 结果 | 关键字段 |
|---|---|---|---|
| 1 | check-auth | ✅ | status=200 loggedIn=true |
| 2 | me | ✅ | id=<用户id> role=student 院系=<院系> |
| 3 | recent | ✅ | err=200 total=58 返回=3 |
| 4 | terms | ✅ | err=0 学期组=23 |
| 5 | course | ✅ | code=0 返回选课数与已学数（数值随个人选课变化） |
| 6 | catalog | ✅ | 小节数=15 首节=1966457 |
| 7 | week | ✅ | code=200 天=7 首日=2026-11-16 |
| 8 | play-config | ✅ | code=200 模板=ai数字教师 模块=19 |
| 9 | transcripts | ✅ | code=0 trans_type=ainew 段数=983 英文段=75 |
| 10 | ppt | ✅ | code=0 total=74 返回=74 首帧=5s 有图=true |
| 11 | search | ✅ | code=0 total=250 返回=2 |
| 12 | latest | ✅ | err=0 条数=10 |
| 13 | notices | ✅ | code=0 公告=3 |
| 14 | notice | ✅ | code=0 正文字节=3372 |
| 15 | learn-pdf | ✅ | code=1000 有直链=true（免登录） |
| 16 | download-learn-pdf | ✅ | bytes=1536175 isPdf=true（免登录） |

### 本轮修掉的两个真 bug（别重犯）

**bug 1 - 成功码白名单太窄，误杀 6 个正常接口。** 本站 `courseapi` 成功码根本不统一，实测四种并存：
`err:0`（terms/latest）、`code:200`（week/play-config）、`code:0`（transcripts/ppt/notices）、
`code:1000`（learn-pdf，是业务码不是错误码）。第一版按白名单判，6 个正常接口全判失败。
**正解：只拦真实失败信号，不枚举成功码。** 现在 `assertBusinessOk()` 只判四类：
`success===false` / 任意层级 code 或 err 为**负数** / 错误信息非空**且**载荷为空 / body 是 HTML 或非 JSON。
另注：`msg:"success"` 之类是正常回显，不能当错误信息（已加 `BENIGN_MSG` 白名单）。

**bug 2 - 下载 op 的二进制被外层 `--out` 逻辑覆盖。** crawler 尾部统一把 op 返回值写进 `--out` 文件，
而 download op 内部已经把 PDF 落到同一路径 -> 结果得到 59 字节的 JSON 假文件（本轮实测踩过）。
**正解：** download op 自己用 `pipeline` 落盘并回 `{written:true}`，外层见到该标记就只打印元数据、不再写文件；
下载目标参数改名 **`--dest`**，避免与「结果落盘」的 `--out` 语义冲突。

### body 级判定的具体落点

`getChecked()` 是所有 op 的唯一出口，依次检查：
1. HTTP 非 2xx -> 抛错带 body 片段
2. body 以 `<!doctype`/`<html` 开头 -> 判 SPA fallback（本站未知路径恒 200 回壳）
3. body 非 JSON -> 抛错
4. `assertBusinessOk()` -> 上面那四类失败信号

这样 `cmsapi` 那两个「匿名 200 但 `code:1001 未传入租户` / `err:-1 用户信息解析错误`」的假成功会被拦下；
而 `err:0`、`code:200`、`code:1000` 这些真成功不会被误杀。

## 本次探了什么 / 还剩什么

**已验证**：见 endpoints.json `verified`（登录 12 条 + 免登录 4 条）。

**知道存在但没调（有意留着）**：
- ~~字幕接口真实路径~~ → **已找到，见「字幕与课件接口」节**：
  `GET /courseapi/v3/web-socket/search-trans-result?sub_id=&format=json`，登录可用、不依赖播放会话。
- `yumi-intelligentsubtitle.cmc.zju.edu.cn` 的转译 API（编辑端，写语义，不调）。
- `goim.cmc.zju.edu.cn/ws` PPT 推送协议（直播场景用；**录播取 PPT 不需要它**，走 `/pptnote/v1/schedule/search-ppt`）。
- `yjapi.../courseapi/v2/course/video-and-live-promission-by-user-id`（POST，权限判定）。
- `consoleapi/v2/user/group-user`（返回 8525B，疑似用户组配置，未细看）。

## CMC 端点补全（2026-11-22，按 dsh-zju-assistant 清单）

对照结论：**我们的子域覆盖比 assistant 广**（我们 20 个子域 vs 它 4 个），
但 assistant 用了两个我们没记录的 courseapi 端点。本次补上，并顺带确认了它们的必需参数。

### 新增 1：`/courseapi/v3/portal-home-setting/get-sub-info` —— 身份与 JWT

```
GET https://yjapi.cmc.zju.edu.cn/courseapi/v3/portal-home-setting/get-sub-info
```

无需参数。返回体里直接带 **JWT 明文**：

```json
{ "code": 0, "msg": "token合法", "token": "<JWT>" }
```

JWT payload 解出来：

```json
{
  "account": "<学号>",
  "cmcGroupCode": "1800000448",
  "cmcGroupId": "f18b8f4ee40bcd0765cfe987ca82046e",
  "currentRole": "student",
  "exp": 1795401089,
  "loginType": "default",
  "mroles": [ … ]
}
```

**价值**：这是判断「当前登录角色」与拿 `cmcGroupCode` 的最省事方式（一个请求，不用解析页面）。
`currentRole=student` 说明这个 token 是学生身份。

### 新增 2：`/courseapi/v2/course-live/get-my-course-day` —— 按天查课

```
GET https://yjapi.cmc.zju.edu.cn/courseapi/v2/course-live/get-my-course-day?day=YYYY-MM-DD
```

**参数名是 `day`，不是 `date`、不是 `tenant`。** 传错参数不报错，只回空列表：

| 参数 | 结果 |
|---|---|
| 无参 | `{"code":0,"msg":"success","list":[]}` 36B |
| `?day=2026-11-16` | **200 2482B，按上午/下午分组的课程** |
| `?date=2026-11-16` | 36B 空 |
| `?tenant=112` | 36B 空 |

返回按时间戳分组：

```json
{ "list": { "1794758400": { "section": "上午", "course": [] },
            "1794801600": { "section": "下午", "course": [ { course_studen… } ] } } }
```

**这是「今天/某天有什么课」最快的接口**，比拉整周课表再过滤省事。
**注意：参数错时静默回空**——这类「不报错只回空」的接口最容易误判成「今天没课」。

### 顺带修正：`/courseapi/v2/course/catalogue` 需要 `course_id`

我们 endpoints.json 里原本有这条但没记参数。实测：

| 参数 | 结果 |
|---|---|
| 无参 / `tenant=112` / `tenant_id=112` | `{"code":400,"msg":"参数错误"}` 51B |
| **`?course_id=86159`** | **200 30,711B，章节目录树** |

返回 `data[]`，每项有 `sub_id`、`lecturer`、`lecturer_name`（逗号分隔的教师名）、`type` 等。

### 回归：我们已有端点全部仍可用（2026-11-22）

| 端点 | 结果 |
|---|---|
| `/courseapi/v3/multi-search/get-course-list` | 200 **30,436B，`total: "107097"`**（十万级课程库） |
| `/courseapi/v2/schedule/get-week-schedules` | 200 4,365B，含 `room_name/lecturer_name/status_label/is_live` |
| `/courseapi/v3/web-socket/search-trans-result` | 200 **174,615B 字幕全文**（含 `BeginSec/EndSec/Text`） |

### 鉴权要点（再次确认）

`yjapi.cmc.zju.edu.cn` 的 `courseapi/*` 全部**要登录态 cookie**。无 cookie 时统一回：

```
403 text/html 14B
Auth Forbidden
```

**注意它是 403 + `text/html` + 纯文本 `Auth Forbidden`，不是 JSON。** 看到这三件套就是「没登录」，不是「接口不存在」。
需要的 cookie：`JWTUser`（主凭据）、`_token`、`login_cmc_id`、`login_cmc_tid`、`group_code`、
`tenant_code`、`cmc_version`。

## 上游三个未记项的核对（2026-11-22）

- **`pptnote/v1/searchlist`（按课名或教师检索课次）**：试了 `/pptnote/v1/searchlist` 与 `/pptnote/v1/schedule/searchlist`，**均 403、空 body**。与同站其他登录态接口一致，说明路由存在但需登录；成功结果未验证。
- **`vlabpassportapi/account-profile/course`（我的课程）**：宿主是 `education.cmc.zju.edu.cn`，本轮未请求。本站已有等价数据源 `/courseapi/v3/o-course/recent-learning` 与 `get-week-schedules`。
- **`trans_socket_url` 实时字幕订阅**：未实测。实时订阅与回放字幕是两回事；回放字幕与 PPT 文本均已在本站验证。

## 两处留白的实测结果（2026-11-22）

### 1. `education.cmc.zju.edu.cn` 的「我的课程」

| 探测 | 结果 |
|---|---|
| `GET https://education.cmc.zju.edu.cn/` | **200**，862B —— 主机可达 |
| `GET …/personal/courseapi/vlabpassportapi/v1/account-profile/course` | **403**，14B，`Auth Forbidden` |

**结论**：容器可达、端点存在，匿名不可读。响应体（14 字节 `Auth Forbidden`）与本站其他登录态接口**完全一致**，说明是同一套鉴权。

→ 「未实测」这一项可以撤销；「已有等价数据源」的说法仍成立。

### 2. `play-template/get-config` 竟然匿名可读

`GET /courseapi/v2/play-template/get-config?tenant_id=112&sub_id=1996107` → **200 且返回真实数据**。

这条此前被当登录态接口（同批的 `get-config` 之外多为 403），实测**匿名可读**。返回的是某课次的播放器模块清单：

- `name`：`ai数字教师`，`type`：`course_live`
- `modules`：**19 个功能模块**，含 `one_videos_live_liu`（视频流）、`ppt_live_liu`（AI 识别 PPT）、`voice_live_gn`（语音识别）、`knowledge_graph_live_gn`（知识图谱）、`barrage_live_gn`（弹幕）等

这解释了为什么 PPT 文本端点 `/pptnote/v1/schedule/search-ppt` 会存在——播放器本来就有 `ppt_live_liu` 模块。

**但 `trans_socket_url` 不在这个响应里**。清单提到的实时字幕 ws 地址不在 get-config，因此「实时字幕未实测」的留白**仍然成立**。

**边界**：不因单个 `sub_id=1996107` 可读就推广为「所有课次可读」；不批量枚举 sub_id。

## 实时字幕：来源接口已定位（2026-11-22）

清单说实时字幕的 ws 地址来自 `get-sub-info` 的 `trans_socket_url`。本轮把它查到底：

| 探测 | 结果 |
|---|---|
| `/courseapi/v3/multi-search/get-sub-info` | **403**，14B，`Auth Forbidden` |
| `/courseapi/v3/get-sub-info` | **403**，14B，`Auth Forbidden` |
| `/courseapi/v2/play-template/get-config`（对照） | 200 可读，但 **`temp_config` 是空对象**，全响应无 socket/trans/asr 字段 |

**结论**：

1. `get-sub-info` **路由存在，但匿名 403**——与你站其他登录态接口同款响应，所以 `trans_socket_url` 确实只能登录后取得。
2. 上一轮我曾怀疑它可能藏在 `get-config` 里；实测 `temp_config` 是空对象、响应无 socket 类字段，**这个可能性被排除**。

因此这一项的留白状态从「未实测」升级为「**已定位：来源接口存在且需登录，不在匿名可读接口内**」。这不是取到了地址，而是把「不知道在哪」变成「知道在哪、也知道为什么取不到」。

**不做**：不建立 WebSocket 订阅（属实时会话）、不猜 auth token 拼参数。
