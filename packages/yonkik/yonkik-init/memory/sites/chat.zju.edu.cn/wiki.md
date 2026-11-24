# chat.zju.edu.cn · 浙大「晓浙 / 浙晓智」AI 问答平台

> 探索日期 2026-11-20。苏迪（sudytech）wdzsk 底座 + 自研前端 `/chat/`。
> 与 `courses`/`classroom` 同属浙大 CAS 家族，凭据 `campus-sso` 一证通。

## 本页索引

- [一句话结论](#一句话结论)
- [入口与跳转链](#入口与跳转链)
- [鉴权](#鉴权)
- [接口](#接口)
- [模型与 API 真相](#模型与-api-真相)
- [智能体广场](#智能体广场)
- [坑](#坑)
- [本次探了什么 / 还剩什么](#本次探了什么--还剩什么)

## 一句话结论

可达、可登录、可只读。**不是「没 API 只能网页版」**——平台把 API 拆到了独立的开发者平台
`dev.zju.edu.cn`（申请审批制），审批后的调用走 `api.zju.edu.cn`；本体 SPA 里另有一套自己的
API Key 体系（`/aiqa/px/_web/apps/agent/token/*`，能自助建 `sk-` 密钥）。

## 入口与跳转链

```
https://chat.zju.edu.cn/
  --301 (nginx)--> https://zjuam.zju.edu.cn/cas/login?service=http%3A%2F%2Fchat.zju.edu.cn%2Fcommoncallback%2F
  --POST 账密--> http://chat.zju.edu.cn/commoncallback/?ticket=ST-xxxx
  --307--> https://chat.zju.edu.cn/commoncallback/?ticket=ST-xxxx
  --301--> https://chat.zju.edu.cn/   (SPA, base=/chat/, title=浙晓智)
```

- **注意 `service` 参数是 `http://`**（明文），不是 https，但它会 307 升级回来，不影响登录。
- 登录成功写入 cookie：`aiqa@chat.zju.edu.cn`（业务会话）、`_sop_session_@chat.zju.edu.cn`、
  `iPlanetDirectoryPro@.zju.edu.cn`（CAS SSO 票）。
- SPA 静态资源免登录：`/chat/js/*`、`/chat/static/*`、`/wdzsk/_upload/*`。

## 鉴权

| 类别 | 行为 |
|---|---|
| `/aiqa/ai-helper/*` | 未登录 → **301** 到 zjuam CAS |
| `/aiqa/px/_web/apps/agent/*` | 未登录 → **200** + `{"resultCode":2010,"errorMsg":"???","result":null}`（不是 301！） |
| `/chat/js/*`、`/chat/static/*` | 完全免登录 |
| `/wdzsk/_upload/*` | 免登录（静态图） |

**廉价登录探针**：`GET /aiqa/px/_web/apps/agent/model/categories.rst` —— 2010 = 未登录，0 = 已登录。
不会 301、不会挑站，比打 `/aiqa/` 省事。

CAS 验证码：`GET https://zjuam.zju.edu.cn/cas/v2/getKaptchaStatus` → `false`（2026-11-20），
无需 OCR，账密直接点 `#dl` 即可（密码由页面 `js/login/login.js` 做 RSA 后提交）。

## 接口

完整机读清单见 [endpoints.json](endpoints.json)。核心几条：

| method | path | 用途 | 鉴权 |
|---|---|---|---|
| GET | `/aiqa/ai-helper/model/token` | 个人可用模型 + token 用量（**最重要的能力自证**） | 登录 |
| GET | `/aiqa/ai-helper/model/category` | 模型大类：llm/embedding/rerank/asr/tts | 登录 |
| GET | `/aiqa/px/_web/apps/agent/model/square.rst?state=1&page=0&rows=200` | 模型广场（含 context/参数量/部署位置） | 登录 |
| GET | `/aiqa/px/_web/apps/agent/model/options.rst` | 模型下拉选项 | 登录 |
| GET | `/aiqa/px/_web/apps/agent/token/list.rst?state=1&page=0&rows=50` | 我的 API Key（**含明文 sk-**） | 登录 |
| GET | `/aiqa/ai-helper/znt/list?categoryId=` | 智能体广场清单（24 个） | 登录 |
| GET | `/aiqa/ai-helper/znt/category` | 智能体分类 | 登录 |
| GET | `/aiqa/ai-helper/znt/skills?zntId=1` | 智能体技能清单 | 登录 |
| GET | `/aiqa/px/_web/apps/agent/model/apply_list.rst` | 我的模型申请记录 | 登录 |
| GET | `/chat/js/chat-ui-config.js` | **免登录**：整站配置（接口前缀/菜单/外链/开关） | 无 |
| GET | `/chat/static/js/main.893cff95.js` | **免登录**：完整 XHR 路由表 + 内嵌模型价目目录 | 无 |

响应格式统一 `{resultCode, errorMsg, result}`（`resultCode:0` = 成功）。
苏迪 `.rst` 层多一层 `{errorMsg, result:{data,total}, resultCode}`。

### 实测样本（`/aiqa/ai-helper/model/token`）

```json
{"resultCode":0,"errorMsg":null,"result":{"data":{
  "qa":[{"models":["deepseek-r1-safe-671b-128k-local","qwen3.5-27b-256k-local"],
         "name":"general_qa","token_id":<id>,"unlimited_quota":true,
         "used_quota":<用量>,"remain_quota":-1}],
  "user":[{"name":"1","token_id":<id>,"unlimited_quota":false,
            "remain_quota":10000,"used_quota":0,"models":[]}]
},"total":-1}}
```

## 模型与 API 真相

### 本体平台（chat.zju.edu.cn）能申请到的模型

`model/square.rst` 只返回 **5 条**（`total:5`，`rows` 参数被忽略）：

| modelId | 类别 | context | 参数量 | 部署 |
|---|---|---|---|---|
| `qwen3.6-27b-64k-local` | llm 通用对话 | **64k** | 27b | 本地 |
| `qwen3-reranker-4b-32k-local` | rerank | 32k | 4b | 本地 |
| `qwen3-embedding-4b-32k-local` | embedding | 32k | 4b | 本地 |
| `bge-reranker-v2-m3-0.5b-0.5k-local` | rerank | 0.5k | 0.5b | 本地 |
| `bge-m3-0.5b-8k-local` | embedding | 8k | 0.5b | 本地 |

而 `model/token` 里该实测账号的 `general_qa` 实际挂着的是
`deepseek-r1-safe-671b-128k-local` + `qwen3.5-27b-256k-local` ——**两个接口口径不同**：
`square` 是「可申请的广场」，`token` 是「已授权的实例」。别拿前者推断后者。

### 模型即服务（`mxfw` 菜单）是第三方供应商矩阵

前端内嵌了一个 67,221B 的价目表 JSON（`main.js` 偏移 ~1,245,506 起，`JSON.parse('[...]')`），
覆盖 OpenAI / Google / Anthropic / xAI / Moonshot / 智谱 / 字节 / DeepSeek / 阿里 / 快手 / 生数
全量模型与折扣价。供应商两家「已接入」：

- **赛尔国际**（cerintl）：`https://ai.cerintl.com/sso/zju`，教程在语雀
- **阿里百炼（中源云汇 / ZY Hub）**：`https://aliyun.wisejob.cn/syedu/api/v1/identity/sso/login?tenant=3524&target=developer`

矩阵里有 `deepseek-v4-flash`（中源云汇 ¥1/¥2 每百万 token，9 折；赛尔 ¥1.5/¥4.5，8 折）、
`deepseek-v4-pro`、`qwen3.5/3.6/3.7/3.8`、`kimi-k2.5~2.7`、`glm-5~5.2`、`claude-opus-5`、
`gpt-5.6-*`、`gemini-3.6-flash`、`grok-4.3`、`kling-v3`、`sora-2`、`veo-3.1` 等。
**所以「模型老」这条在 2026-11 已不成立**——最新一代基本都在价目表里，只是多数要钱/要审批。

### API 在哪

官方（`itc.zju.edu.cn/ydxw/2026/0520/c91702a3164800/page.htm`「中心大模型申请指南」，2026-05-20）：

> 平台官方地址：**https://dev.zju.edu.cn/**
> 流程：登录平台 → 个人空间 → 创建/迁入应用（**需审批**）→ 为应用申请 AI 大模型接口（**需审批**）→ 完成模型调用授权
> 接口审批通过后，可以通过 **https://api.zju.edu.cn** 查看对应模型的调用示例。

- `dev.zju.edu.cn` = 苏迪 sframe「开发者网站」，SPA 路由 `/login` `/pub` `/user/*`，
  统一 API 入口 `POST /service/v1/DoAction.action`（需 action 名 + 登录 token，实测无 body 返回
  `code:-1, info:"req is null"`）。
- `api.zju.edu.cn` = nginx/1.18.0，根路径回同一套「开发者网站」SPA；
  `/v1/models`、`/v1/chat/completions`、`/chat/completions`、`/models`、`/health`、`/v1/audio/speech`
  **全部 404 `{"error":"Not Found"}`**（OpenAI 网关风格的错误体，说明对，路径没猜中）。
- 另一条自助通道：SPA 的「模型即服务」页能**直接建 sk- 密钥**
  （`token/list.rst` 实测该账号有一条明文 `sk-` 密钥，quota 1/1；密钥值不落盘）。但该密钥对应的 base_url 未在前端出现，
  需要登录后在「模型即服务」页面上看。

## 智能体广场

`znt/list?categoryId=` 返回 24 个已上架智能体（2026-11-20）：
WPS灵犀、伏羲万象时空计算大模型、口腔医学辅助诊疗、医小研、AI辅导员·启小真、国小合（测试版）、
PBL 项目式教学、实验报告批改助手、启发式讨论、批判性思维引导与训练、辅助编程、公式识别、
小财问答助理、材料与化学品采购管理平台助手、科研工作台、浙大体育AI助手、浙小本、校园时光机、
慧学外语、课程AI助教、总务小管家、学生生涯导师·小叶、心灵树洞、低温之舟。

左侧菜单六项（`chat-ui-config.js` 的 `meaus`）：浙大智搜 / 知识库中心 / 科研工作台 / 智能体开发 /
模型即服务 / 算力服务。外部链接：
- 浙大智搜 → `https://ai-search.zju.edu.cn`
- 科研工作台 → `https://research.zju.edu.cn/sopplus/_web/customized/portalPages/bohriumNav.jsp?_p=...`
- 算力服务 → **启真算力中心** `https://hpc.zju.edu.cn/welcome`（自建 24×4090D + 16×5090 集群，
  4090D 按量 ¥1.5/卡时、5090 ¥2.35/卡时，包月 ¥860 / ¥1350）
- 求是引擎 → `https://qiushi.zju.edu.cn/login`（配置注释写「暂未配置」）

## 坑

1. **浏览器必须 `--no-proxy-server`**。本机 `HTTP_PROXY=<本地代理>` 出口在墙外，
   Chromium 默认吃系统代理 → `chat.zju.edu.cn` 直接 `ERR_CONNECTION_CLOSED`。
   而 `node:https`（lib/http.mjs 已改造）不受影响。这条会浪费很多时间，先加参数。
2. **`service` 参数是 http**，登录后 307 才升 https。写登录脚本别据 `http://` 判断失败。
3. **`rows` 参数对 `model/square.rst` 无效**，恒 5 条。别以为「只有 5 个模型可申请」是分页问题，
   它就是全部。
4. **`/aiqa/ai-helper/init` 直接 GET 会 1002「地址无效」**，它不是 REST 端点而是 SPA 首屏专用
   XHR。要拿初始化数据就走浏览器，别硬打。
5. **两层 resultCode 不要混**：`/aiqa/ai-helper/*` 用 `resultCode`（0 成功，1002 地址无效，2010 未登录）；
   `/aiqa/px/*` 的苏迪层用 `resultCode` 但错误体是 `{errorMsg, result, resultCode}`，
   有些子路径 `result.total` 与 `result.data.total` 都在，取数时两个都要看。
6. **`token/list.rst` 回明文 `sk-` 密钥**。只读探测可以，但**绝不能写进 wiki/endpoints/crawler**，
   也不能贴聊天。本 wiki 已全程脱敏。
7. **`api.zju.edu.cn` 根路径不是 API**，是 SPA 壳（和 dev 同一套）。判 404 不要当「服务不存在」，
   是路径没对上；错误体 `{"error":"Not Found"}` 是网关风格。
8. **`/wdzsk/_upload/*` 免登录**能直取他人上传的智能体图标/logo（UUID 命名，不可枚举），
   属公开静态资源。

## 本次探了什么 / 还剩什么

**已验证可用（免登录 2 条 + 登录 10 条）**：见 endpoints.json 的 `verified`。

**未探（有意留着）**：
- `api.zju.edu.cn` 的真实调用路径 —— 需要在 `dev.zju.edu.cn` 登录并走完应用审批，本次无权限。
  候选形态：`/v1/chat/completions`（标准 OpenAI）、`/api/v1/*`。**下一个 agent 从这里接。**
- `/wsqa/qa` WebSocket 对话协议 —— 语义是发起推理（消耗额度 + 写会话），按安全契约不调用。
- GBI 分析系列 14 个接口（`/aiqa/pxgbi/api/gbi/*`）—— `query_sql` 语义不明且可能昂贵，未调用。
- `dev.zju.edu.cn/service/v1/DoAction.action` 的 action 名清单 —— 需登录后的 JS 分片。

## API 入口的实测边界（2026-11-20）

这一节记录「到底哪些 API 路径试过了、结果如何」，防止下一个 agent 重复猜。

### `dev.zju.edu.cn`（开发者平台，官方指引里的申请入口）

| path | 结果 |
|---|---|
| `/` | 200，675B，title=「开发者网站」，SPA 挂 `#sframeindex` |
| `/pub`、`/pub/**/list` | 200，**回同一份 675B 壳**（前端路由） |
| `/js/index.js` | 200，2555B，**免登录可读**。路由表：`/`→`/pub`、`/login`、`/pub`、`/pub/cms/:node/:item/:id`、`/user`（含 `:child(.*)`）；Vue 模块：`Login.vue` `pub/PubHomePage.vue` `cms/pub/CmsPage.vue` `user/UserHomePage.vue` `user/UserIndex.vue` |
| `/js/chunk-common.js` | 200，244,187B。含 `j()` 封装：base `/service/v1`，唯一动作入口 `POST {base}/DoAction.action`，body 带 `token`；登录走 `POST /service/v1/LoginFun/User/login`，参数 `{username, password(RSA), rzid, rzcode}`；另有 `/LoginFun/User/logout`、`/LoginFun/User/islogin` |
| `POST /service/v1/DoAction.action`（无 body） | 200，`{"code":"-1","result":"error","info":"Cannot invoke "zju.sframe.core.common.RequestData.getIp()" because "req" is null","serverId":"00005c39f71a"}` → **证明该 action 入口真实存在**，只是缺 action 名与 body |
| `/api/zjuam/login`、`/v1/models` | 404 `{"error":"Not Found"}` |

### `api.zju.edu.cn`（审批后的调用网关）

| path | 结果 |
|---|---|
| `/` | 200，673B，与 dev **同一套「开发者网站」SPA 壳**（nginx/1.18.0） |
| `/v1/models` | 404 `{"error":"Not Found"}` |
| `/v1/chat/completions` | 404 同 |
| `/chat/completions` | 404 同 |
| `/models` | 404 同 |
| `/health` | 404 同 |
| `/v1/audio/speech` | 404 同 |
| `/service/v1/DoAction.action` | 404 同 |

**结论**：`api.zju.edu.cn` 的 404 body 是网关风格的 `{"error":"Not Found"}`（不是 SPA 壳），
说明路由层在、但 **OpenAI 兼容路径不是 `/v1/*` 这种标准形态**。真实调用路径只有登录
开发者平台后看「接口调用示例」页面才能拿到（官方指引原文：「接口审批通过后，可以通过
https://api.zju.edu.cn 查看对应模型的调用示例」——注意是**看示例**，不是直接打）。
**这条是本页最大的未解项**，下一个 agent 应从 `dev.zju.edu.cn/login` 的 CAS 登录切入。

### 本体平台自带的 API Key 通道

「模型即服务」页能**自助建 sk- 密钥**（`POST /aiqa/px/_web/apps/agent/token/create.rst`，只读侧
`token/list.rst` 已实测返回明文 `sk-` 串，仅记「存在」不入档）。这条通道**不需要走 dev 平台审批**，
拿到密钥后对应的 `base_url` 需登录后在页面「模型即服务」里看（前端 bundle 未硬编码）。
