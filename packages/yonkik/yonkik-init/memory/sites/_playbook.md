# 跨站 Playbook

可迁移经验库。每条带证据+适用范围+来源站；由真实探索写回，不预填猜测。
格式见 references/artifacts.md。

## SPA 站点的「假 robots.txt」识别
- 模式：若 `GET /robots.txt` 返回 200 但 `content-type` 是 `text/html`、body 里是 `<div id="root">` 之类
  的 SPA 外壳，说明站点没有 robots 规则文件（被前端路由兜底了）。别把 HTML 当规则解析，直接标 `source: "default"`。
- 证据：`GET https://www.cc98.org/robots.txt` → 200，12172 bytes，body 以 `<!DOCTYPE html><html lang="zh-CN">
  <head><meta charset="utf-8"><title>CC98论坛</title>…<div id="root"></div>` 开头；与首页 HTML 完全一致。
- 适用范围：任意 SPA（React/Vue）站点；服务端渲染站点不适用（它们的 robots.txt 通常是真文本）。
- 来源站：www.cc98.org，2026-11-18

## 从 SPA bundle 反查 API 基址与鉴权参数
- 模式：SPA 的接口域常与页面域不同。三步走：
  1. 先看 `GET /static/config.json`（或 `/config.js`、`/env.json`）—— 很多站点把 `apiUrl`/`openIdUrl`
     写在这里，**一次请求就能拿到，比读 bundle 便宜得多**。
  2. 再看首页 HTML 引用的 `main-*.js`，在 bundle 里 grep `baseURL`、`apiUrl`、`http[s]?://.*(站点域)`、
     `/connect/token`、`client_id`。
  3. 登录逻辑（`grant_type`、`scope`、`client_id`、`client_secret`）通常明文写在登录组件里。
- 证据：`https://www.cc98.org/static/config.json` → `{"apiUrl":"https://api.cc98.org","openIdUrl":"https://openid.cc98.org"}`；
  `main-f76e0ae5.js` 中登录组件 `fetch(mn.config.openIdUrl + "/connect/token")`，body 含
  `client_id:"9a1fd200-…"`, `scope:"cc98-api openid offline_access"`。
- 适用范围：前后端分离的 SPA；bundle 未做字符串加密的站点。
- 来源站：www.cc98.org，2026-11-18

## Bearer token 站点接 lib/http.mjs 的补丁点
- 模式：`lib/http.mjs` 只自动导入 `state.json` 里的 **cookie**。若站点用 `Authorization: Bearer`，
  `crawler.mjs` 里要自己从 `state.json` 读 `access_token` 并给每个请求补 header。
  统一封装成 `const api = p => client.getJSON(API + p, H)` 后，各 op 只写路径，避免漏加。
- 证据：`node crawler.mjs byTag --board 68 --tag1 92` 未加头时 `401`；加了
  `{ headers: { Authorization: 'Bearer <state.access_token>' } }` 后 `200`（2026-11-18）。
- 适用范围：所有 OAuth2 password grant / JWT 鉴权的 `sites/<key>/`。
- 来源站：www.cc98.org，2026-11-18

## 论坛类站点的「标签」是最省的抽样维度
- 模式：Discuz/自研论坛普遍有版本标签（求助/资源/讨论/选课…）。先用 `/board/{id}/tag` 拿到 tag id 映射，
  再用 `/topic/search/board/{id}/tag?tag1=` 精确抽样。
  **比关键词搜索可靠**：关键词搜索按时间倒序且不含标签，容易漏；标签口径带 `count` 总数，可据此外推覆盖率。
- 证据：`GET /board/68/tag` → `[{layer:1,tags:[{id:85,name:"讨论"},{id:92,name:"求助"},{id:93,name:"资源"},…]}]`；
  `GET /topic/search/board/68/tag?tag1=92` → `{count:72407, topics:[…]}`，`tag1=93` → `count:17513`。
- 适用范围：有标签体系的论坛（CC98、Discuz 系、Flarum 标签扩展）。
- 来源站：www.cc98.org，2026-11-18

## 需求统计必须报「双口径」
- 模式：统计"大家在求什么"时，用户自挂标签普遍不准（该挂"求助"的挂了"讨论"）。做法：
  - 口径 A（严）：官方标签 ∧ 资源词 → 数量小但精确；
  - 口径 B（宽）：不限标签，标题含索要词 + 资源词 → 覆盖更全。
  两个数一起报，并说明差异来源。只报一个会系统性低估需求。
- 证据：CC98 学习天地 2026-10-19~11-18：口径 A = 44 帖，口径 B = 108 帖，相差 2.5 倍。
- 适用范围：任何依赖用户自填分类的 UGC 平台统计。
- 来源站：www.cc98.org，2026-11-18

## 论坛站规里的「反爬条款」必须先读
- 模式：校内/社区论坛的服务条款常明文禁止爬取数据并规定处罚。深探前先看置顶公告与版规，
  把条款原文和风险写进 `wiki.md` 的「坑」，后续会话据此约束批量行为。
- 证据：CC98 置顶公告 `/topic/6468737`（2026-04-05，回复 24，点赞 90）原文：
  「用户在论坛上使用 AI 实施违规行为（包括但不限于生成低质或虚假内容、爬取论坛数据），
  将被处以全站锁定 365 天以上的处罚；屡犯或情节严重者，将锁定其通行证下的全部账号」。
- 适用范围：所有需要登录的 UGC 站点。
- 来源站：www.cc98.org，2026-11-18

## 大厂内容平台的「免登录面」分层：列表可读、详情被风控锁
- 模式：抖音/小红书这类平台，免登录可得的不是「有没有」而是**哪一层**。按三层判：
  1. **列表层**（榜单/首页流/专题页）：通常免登录，用来做选题与趋势。
  2. **详情层**（单条内容、作者主页）：几乎都挂在前端风控后面。
  3. **搜索层**：通常要求登录（抖音直接返业务码 2483「请先登录」）。
  先测「详情接口无 cookie 能不能通」，能通则整站可脚本化；不能通就别继续投预算，直接转「只用列表层」。
- 证据：抖音 `aweme/v1/web/hot/search/list/` 无 cookie 200/65KB/`word_list=49`（列表层可用）；
  同站 `aweme/v1/web/aweme/detail/` → 403 `Blocked by ArgusSecurityPlugin Uifid Not Found`（详情层锁死）；
  `general/search/single/` → 200 但 `status_code=2483`「请先登录」。
- 适用范围：字节系（抖音/头条）、快手、B站、小红书等前端风控平台。
- 来源站：www.douyin.com，2026-11-20

## 「HTTP 200 但 body 0 字节」= 缺签名参数，不是空数据
- 模式：字节系接口在不带 `a_bogus`/`X-Bogus`/`msToken` 时，**返回 200 + 0 字节 body**，
  不报错、不给提示。极易被当成「该话题没有视频」。判据：看 `Content-Length` 与 `bytes`，
  0 字节一律标「签名缺失」，不要写进 unverified 的「正常响应」。
- 证据：抖音 `aweme/v1/web/tab/feed/`、`aweme/v1/web/hot/search/video/list/` 均 HTTP 200 而 body 长度 **0**；
  对比同域 `/hot/search/list/` 因该路径不做签名校验，正常返 65KB JSON。
- 适用范围：字节跳动系所有 `aweme/v1/web/*` 接口；B站 `wbi` 签名接口同理（返回空或 -412）。
- 来源站：www.douyin.com，2026-11-20

## 匿名 cookie ≠ 绕过风控
- 模式：有些平台会给未登录访客种「设备标识」cookie（ttwid、xx_uid 之类）。
  **有设备 cookie 不代表接口放行**——真实风控要的是「UIFID + 浏览器指纹」这类由 JS 运行时生成的凭据。
  正确做法：先看 cookie 里有没有 `sessionid`（登录态），没有就按「未登录」预期结果，别抱侥幸重试。
- 证据：抖音首页预热后拿到 8 个 cookie（`ttwid`、`_waftokenid`、`__ac_nonce`、`__ac_signature`、
  `x-web-secsdk-uid` 等），**无 `sessionid`**；带这套 cookie 打 `aweme/detail` 仍 **403 Uifid Not Found**。
- 适用范围：抖音、小红书、微博等有设备指纹体系的平台。
- 来源站：www.douyin.com，2026-11-20

## sitemap 是大平台唯一「主动授权」的免登录面
- 模式：内容平台给搜索引擎的 sitemap 通常**对普通 UA 也开放**（robots 里显式 `Allow: /sitemap-`）。
  这是合规拿「URL 清单」的正路。但必须同时确认：**sitemap 给的 URL 能否直接打开**——
  很多平台 sitemap 可读、正文页却 302 登录，此时资产价值只剩「ID 清单」。
  报价时要把「能枚举」和「能读内容」分成两个结论。
- 证据：小红书 `robots.txt` 对 bingbot/Baiduspider 组 `Disallow: /` 后显式 `Allow: /sitemap-notes-`；
  `sitemap-notes-0..12.xml.gz` 共 **500000 条** `/explore/<id>`（无 cookie 全量可下）；
  但 `GET /explore/<id>` 任何 UA 都 302 到 `rednote.com/login` → **只得 ID，不得内容**。
- 适用范围：小红书、知乎、B站等有 SEO 需求的 UGC 平台。
- 来源站：www.xiaohongshu.com，2026-11-20

## sitemap 的「.gz 后缀可能是假的」
- 模式：`sitemap.xml.gz` 返回的 `content-type` 若是 `application/xml`，且 `zlib.gunzipSync` 报
  `incorrect header check`，说明服务端**没压缩**。直接按纯文本解析，别浪费一轮排错。
- 证据：`GET https://www.xiaohongshu.com/sitemap-notes-0.xml.gz` → 200，`content-type: application/xml`，
  3720110 bytes，gunzip 失败但 5 秒内 regex 出 40000 条 `<loc>`。
- 适用范围：所有 sitemap 抓取脚本；先读 content-type 再决定是否解压。
- 来源站：www.xiaohongshu.com，2026-11-20

## 批量枚举必须做「去重 + 时间直方图」两道校验
- 模式：分片返回的 ID 清单，**文件大小完全相同极可能被误判为重复**。两道必做校验：
  1. **去重**：合并后 `Set.size` vs 原始条数，算真实重复率。
  2. **时间直方图**：ID 内嵌时间戳时，逐条算 min/max/月度分布——**只看首尾会严重误判覆盖区间**。
- 证据：小红书 13 份 sitemap，每份都是 3720110 bytes（第 12 份除外），一度判为「同一份重复」；
  实为 sha256 各异、去重后 **0 重复**的真切分。时间上 0 号文件首条 2023-12、末条 2025-10，
  初判「覆盖 3 年」；直方图显示 **2025-08 前仅 4 条、中间 380 天空档**，实际有效覆盖 **14.6 个月**。
- 适用范围：所有按偏移/分片导出的 ID 清单（sitemap 分片、评论区翻页、搜索结果导出）。
- 来源站：www.xiaohongshu.com，2026-11-20

# 【恢复】以下 36 条为本会话早前写入、2026-11-20 21:19 被并行会话覆盖丢失，现按原文重建。

## 校园 CAS SSO（zjuam）需浏览器 + 用户协助验证码
- 模式：zjuam 登录页字段 `username/password/authcode(验证码)/execution`，password 经 `CreateRatePasswdReq` RSA 加密，
  且**先把密码字符串反转**再加密。纯 HTTP 难以完成，应走浏览器登录 + 用户协助验证码。
- 防锁号纪律：每站单次尝试，验证码失败即停问用户。
- 来源站：zjuam.zju.edu.cn，2026-11-19

## 导航枢纽站一次 triage 映射多站
- 模式：学生导航站（`zjuers.com`）一篇页面即列出几十个校内系统入口，先抓它能把 triage 面缩到最小；
  但导航站的链接**不等于可访问**，必须逐站实测。
- 证据：zjuers.com 98 站目录 → 实测有相当一部分 pending/死链；「教师信息查询」指向 `person.zju.edu.cn`（官方主页，不是查老师）。
- 来源站：zjuers.com，2026-11-17

## TronClass（学在浙大）附件下载：活动详情 → upload 302 签名直链 → 裸 GET
- 模式：`/api/courses/{cid}/activities` **不返回附件**，真源在活动详情 `/api/activities/{id}` 的 `uploads[]`；
  再 `GET /api/uploads/{id}/blob` 拿 302 到独立媒体域（`tcmedia.<school>.edu.cn`，token 有时效），
  对该直链**裸 GET**（不带原站 cookie），用 `content-length` vs `uploads[].size` 校验。
- 证据：courses.zju.edu.cn 活动 1211667 → upload 22751836 (28,325,846B) → blob 302 → 长度精确匹配，zip 内 checksums.sha256 59 项全通过。
- 来源站：courses.zju.edu.cn，2026-11-19

## CAS 登录：验证码可能关闭，先探 getKaptchaStatus 再决定是否 OCR
- 模式：zjuam 登录页固定渲染 `#yzmPic`，但 `GET /cas/v2/getKaptchaStatus` 返回 `false` 时**不校验验证码**，
  账密可一次登录成功。**登录前先单发这一个只读 GET**，能省掉整个 OCR/视觉流程。
- 证据：2026-11-19 两次登录均 `false`，空验证码提交即跳转成功。
- 来源站：courses.zju.edu.cn，2026-11-19

## 正方 jwglxt 系教务：通知公告是免登录公开区，真分页必须 POST + queryModel.*
- 模式：`jwglxt` 系教务的通知公告**登录前可读**。列表接口是 **POST** 同路径 `?doType=query&time=0`，
  参数名来自 jqGrid `prmNames`：`queryModel.showCount / currentPage / sortName / sortOrder`。
  **关键坑**：GET 加 `page/rows/sidx/sord` 也回 200 但**分页被完全忽略**（每页恒 10 条）。
  另：该系登录页**没有账号密码表单**，只有 `#ssodl` SSO 按钮。
- 证据：zdbk.zju.edu.cn GET `page=2&rows=20` 与第 1 页相同；改 POST `queryModel.*` 后 rows=20 三页各 20 条，totalCount=575。
- 来源站：zdbk.zju.edu.cn，2026-11-19

## 苏迪 Coreplus 站的「pub 静态路径」绕过登录
- 模式：Coreplus/Webplus 首页常只是登录框，但业务轻应用挂在
  `/_web/_apps/lightapp/<app>/mobile/pc/pub/...`，**pub = public，免鉴权**；数据接口在 `.../api/lists.rst`，同样免登录。
  判据：triage 拿到 Coreplus 登录壳 → 先在 HTML/JS 里 grep `/_web/_apps/`。
- 证据：life.zju.edu.cn 首页是登录页，但 `busflight/api/lists.rst` 免 cookie 返回 165 条班次。
- 来源站：www.life.zju.edu.cn，2026-11-19

## 苏迪 lists.rst 的分页参数是「必须」的，不是可选
- 模式：`.../api/lists.rst` 缺 `state=1&page=0&rows=` 时返回 `{"resultCode":-1,"result":{}}`，
  看起来像「没数据/被禁」，其实只是必填参数没给。给全后 `rows` 可放大到 99999 一次取全量。
- 来源站：www.life.zju.edu.cn，2026-11-19

## 业务数据接口 ≠ 只用它的 SPA 页面
- 模式：SPA 页面背后常有独立 JSON/RST 接口，页面慢不代表接口不可用；反之页面能开也不代表接口公开。
  先找 XHR 里的真实接口，再判「要不要登录」。
- 来源站：service.zju.edu.cn，2026-11-20

## 本机代理 7993 的脾气：内网走不通、墙外走得通
- 模式：env 有 `HTTP_PROXY/HTTPS_PROXY=<本地代理>` 且 `NODE_USE_ENV_PROXY=1`；undici 的 `fetch` **启动时**就绑定该代理，
  运行期删 env 无效。该代理**出口在墙外，回不到 10.x 内网**。所以 CC98(10.10.98.98)、life、zdbk、service 用 fetch 一律
  `UND_ERR_CONNECT_TIMEOUT`，但 DNS/TCP/TLS 都正常 —— **这是假故障**。
  `node:https` / `https.request` **不读 env 代理**，直连内网正常。本库 `lib/http.mjs` 已改用 node:https。
- 附带：DuckDuckGo 经代理能连但返回 202 反爬挑战页，**别用 DDG 做站内检索**。
- 来源：本轮全组实测，2026-11-19

## 服务门户的「公开区 vs 登录区」二分：先探办事指南，别急着登 CAS
- 模式：校方服务的核心价值常在**免登录的办事指南面**（怎么办、找谁、电话、材料），
  真正「提交/办理」才需要登录。先穷尽公开面，能省掉整个登录流程。
- 证据：service.zju.edu.cn 首页 302 到 CAS，但 `mobile/loadServiceApps.rst` 免 cookie 返回 31KB / 49 应用；
  `s.zju.edu.cn/search/workGuide.do` 免登录返回 54 项办事指南（含窗口与电话）。
- 来源站：service.zju.edu.cn，2026-11-20

## 同一门户的多个「域名」可能只是别名：先测整站 301 再决定探不探
- 模式：`xwfw.zju.edu.cn` 整站 301 到 `service.zju.edu.cn/_s2/cs_bszx/main.psp`，是别名不是独立系统。
  判据：对两个域名各发一个 `GET /`，看是否同跳一处。
- 来源站：xwfw / service，2026-11-20

## 苏迪 lightapp `*.rst` 的 `parentCategoryId` 必须对，错值静默回空
- 模式：`loadServiceApps.rst` **只认 `parentCategoryId=36`**，传空串/17/11/35 全部回 `data:[]`，
  看着像「没权限」，其实只是参数不对。
- 来源站：service.zju.edu.cn，2026-11-20

## 页面 JS 里残留的废弃接口会把探索带偏：以实测为准
- 模式：`loadServiceApps.jsp` / `getServiceAppDetail.jsp` 在页面 JS 里还留着，但实测恒错（`result:'0'`）；
  真接口是 `/mobile/*.rst`。**页面 JS 引用的接口要先实测再信**。
- 来源站：service.zju.edu.cn，2026-11-20

## 细节页参数传错可能「不报错而是静默降级」
- 模式：`detailnew.html` 传 `dataId=Z1606` 不报错，而是**静默渲染默认事项**（在校本科生出国成绩单开具），
  极易误以为查到了。参数名是 `id`（数字 appId），且需要 `_p` 上下文。
- 来源站：service.zju.edu.cn，2026-11-20

## SPA 后端 SaaS 化时，接口命名空间常暴露供应商
- 模式：bundle 里出现 `auth.nsi.edu.cn` / `portal.nsi.edu.cn` / `hwh5-cloudonline.js`（华为 WeLink SDK）→
  可判定「这是第三方 SaaS 的部署实例，不是自研」，从而预判其登录方式与能力边界。
- 证据：form.zju.edu.cn 21MB bundle 内含 NSI、东华、南通、西北大学占位配置。
- 来源站：form.zju.edu.cn，2026-11-20

## 错误码 `ME...` / `Unknown Error` 多等于「参数不对」而非服务故障
- 模式：国产业务系统的兜底错误文案（「系统繁忙，请稍后再试」）通常是**参数缺失**，不是真故障。
- 证据：kyjs `/prod-api/login` POST `{}` → `{"code":1,"msg":"系统繁忙，请稍后再试！"}`。
- 来源站：kyjs.zju.edu.cn，2026-11-20

## 「站点死了」类传言必须实测证伪：跳转页 ≠ 死站
- 模式：CC98 说「某站进不去了」，实测常是渲染慢/空 title/登录态过期，不是下线。
- 证据：form.zju.edu.cn 被说「点开就是空白」，实测站是活的（formInfo.js 有在册表单、有人在自测、21MB 活跃 bundle）。
- 来源站：form.zju.edu.cn，2026-11-20

## 本机 headless 浏览器会被 WebVPN 劫持，别用浏览器判校园站可达性
- 模式：浏览器走了系统代理/WebVPN 时，内网站点的可达性判断与纯 HTTP 不一致；判「通不通」用 node:https 直连。
- 来源：本轮全组实测，2026-11-20

## 服务端脱敏是隐私判断的正例：掩码接口不算泄露
- 模式：接口只回掩码值（`138****1234`）或只回键存在性（`hasValue:true`）时，**属正常脱敏**，不是泄露。
  判泄露看「能否还原真实值」，不是「字段是否出现」。
- 证据：yonkik `/_dsh/yonkik/credcheck` 只回键名与 `hasValue`，值不回显。
- 来源：yonkik-tool，2026-11-20

## 苏迪门户（Webplus）的办事指南类栏目：无登录墙，正文即完整操作规程
- 模式：Webplus 站的办事指南/服务指南栏目正文**免登录**，且给的是「照做就行」的完整流程
  （含电话、地址、办公时间、收费标准、银行账号、窗口号）。
- 证据：libweb 的查收查引 / 文献传递 / 校外访问 / 开放时间四栏目全部免登录且正文完整。
- 来源站：libweb.zju.edu.cn，2026-11-20

## 鉴权头里 bearer 与 token 之间可能没有空格——照抄 SPA 的模板字符串
- 模式：`Authorization: Bearer${token}`（无空格）在某些实现里能被接受，带空格反而 401。照抄页面拼接方式最稳。
- 来源：本轮实测，2026-11-20

## 「HTTP 200 但 body 里 code=10001/201」——只看状态码会全盘误判
- 模式：国产业务系统常态是 **HTTP 200 + body 业务码**。判成功要读 body，不能只看 status。
- 证据：yjsy / booking / classroom 均如此。
- 来源：本轮全组实测，2026-11-20

## 镜像站：「已移除的源」要读公告，判「可用」要拉真实索引文件
- 模式：镜像站页面显示「可用」不代表索引真的在；要拉一次真实的 `dists/.../Release` 或索引文件才算。
- 来源站：mirrors.zju.edu.cn，2026-11-20

## 「实测 TIMEOUT」先分层，别写「站点下线」：443 不通不等于站点死
- 模式：分层排查 DNS → TCP(443/80) → TLS → HTTP。任一层失败写法不同，结论完全不同。
- 来源：本轮全组实测，2026-11-20

## CAS 家族有第三种形态：zjuam CAS-OAuth2.0（不是 ticket 回跳）
- 模式：CAS 家族除 `zjuam-form`、`identity-keycloak` 外，2026-11-20 新增 `zjuam-cas-oauth2`
  （classroom / yuque 用），带 `cas/oauth2.0/callbackAuthorize`。**按 302 目标判，别按站名猜**。
- 证据：classroom.zju.edu.cn 登录走 `/cas/oauth2.0/callbackAuthorize`。
- 来源站：classroom.zju.edu.cn，2026-11-20

## 「没有 API / 模型很老」这类对平台的能力判断，多半是「入口不在你以为的地方」
- 模式：被判定「没接口」的系统，常是把接口放在另一个域名或另一套命名空间里。
- 证据：chat.zju.edu.cn 初判「无模型列表 API」，实为 `/api/v1/models` 在另一个前缀下。
- 来源站：chat.zju.edu.cn，2026-11-20

## 前端懒加载分片是「接口地图」的最后一块：主 bundle 搜不到就去分片里搜
- 模式：Vite/webpack 的 SPA 主 bundle 里通常没有业务 API 路径，它们在 `assets/xxx-hash.js` 分片里。
- 证据：duoduo 主 bundle 1.5MB 抽出 9 条路由且无业务 API；`baseURL` 只在主 bundle 里。
- 来源站：www.duoduo.link，2026-11-20

## 「无账号体系」的准入服务：准入靠 UA 白名单 + 服务端 IP 识别，不靠登录
- 模式：判断某站「要不要账号」前，先试 UA 与 IP 两条隐含准入。
- 来源：本轮全组实测，2026-11-20

## 编码坑的上限形态：页面声明一个**不存在的**编码名
- 模式：`charset` 声明了浏览器/Node 都不认的名字时，按 `content-type` 回退，再回退 utf-8。
- 证据：tyys 部分页面声明 `gbk` 实为 `gb18030`，另有页面声明不存在的名字。
- 来源站：tyys.zju.edu.cn，2026-11-20

## 「详情页」可能是纯前端空壳，真数据在 JSONP：比 404 危险得多
- 模式：详情页对**任意 id 都返回同一份内容**，看起来能开、实际是硬编码默认值。
  判据：传两个不同 id，比对返回内容是否相同。
- 证据：service `detailnew.html` 对 483/546/206/2112 全返回「在校本科生出国成绩单开具」（编号写着占位符 `dddd`）。
- 来源站：service.zju.edu.cn，2026-11-20

## 业务码不统一：写「成功码白名单」必然误杀，要反着写「只拦真实失败信号」
- 模式：`success:0` 是成功、`result:1` 是成功、`code:200` 是成功……各站相反。
  写白名单必误杀；应写「只拦真实失败信号」（HTTP 4xx/5xx、明确错误文案、登录页特征串）。
- 证据：car.zju.edu.cn **`success:0` 才是成功**。
- 来源站：car.zju.edu.cn，2026-11-20

## 裸文件存储（bksy 类）：PDF 在属性里不在 href 里，站内搜索常匿名 403
- 模式：附件地址常在 `div[pdfsrc]` 这类自定义属性里，不在 `href`；PDF 直链可**无 cookie 直接下**且支持 206 Range。
- 证据：bksy 培养方案 PDF 直链裸下成功、支持 Range；`/_web/_search/api/search/new.rst` 匿名 403。
- 来源站：bksy.zju.edu.cn，2026-11-20

## 会话文件（state.json）不是资产，是缓存：含 PII 时应当直接删
- 模式：浏览器 state-save 的会话常含**可 base64 直接解出学号/姓名/手机号**的 JWT。
  正确做法：①不写进 wiki/endpoints ②不长期留在站点根 ③发现含明文 PII 就删，用 login.mjs 重建。
- **附加事实**：`~/.yonkik` **本身不是 git 仓库**，「state.json 已 gitignore」在此不成立。
- 来源：本轮全组实测，2026-11-20

## 同一站点内不同页面的编码可能不同：不能「一站一编码」
- 模式：逐页判才是唯一安全做法。判据：`content-type` 头 + 页面 meta 双读，任一命中 gb 系就上 gb18030。
- 证据：cscy 的三页中 `zdServiceDesc.html` 是 gb2312 而其余 UTF-8；tyys 整站 gb18030 但 cgyy 子路径 UTF-8。
- 来源站：cscy / tyys，2026-11-20

## 「管理门户」与「业务系统」是两层，别把子系统当成全校平台
- 模式：同一业务领域常有「行政门户（制度/公示/审批）」+「业务系统（预约/下单/台账）」两层，
  且业务系统可能只覆盖某个校区/中心。问「多少钱/怎么办」查门户；问「能不能约」才去业务系统。
- 证据：zjulab（设备处，全校制度+收费公示，已到第33批）vs yqgx.hic（科创中心自己的大仪系统，~75 台）。
- 反面：CC98 帖 5580983 把 yqgx.hic 当通用大仪入口，实际只覆盖杭州国际科创中心。
- 来源站：zjulab / yqgx / libweb / cscy，2026-11-20

## 第三方镜像站群「找活的那个」：先枚举镜像再断言「站点挂了」
- 模式：社区维护的服务常同时存在多个镜像域名，任一时刻只有部分存活。
  把出现过的域名**全部枚举探一遍**，并**顺带找带结构化 API 的那个**。
- 证据：chalaoshi 系列 —— `dahua309.uk` 200、`chalaoshi.xhuya.cn` 200（有免鉴权 `/api/gpa`）、
  `chalaoshi.de` ENOTFOUND、`chalaoshi.netlify.app` 503 usage_exceeded。
- 来源站：chalaoshi.xhuya.cn / dahua309.uk，2026-11-20

## 验证码/滑块是「风控触发项」而不是「必过项」：先找开关，再决定要不要上视觉
- 模式：登录页渲染了验证码容器，**不等于**每次登录都要过它。多数实现是「服务端下发 needVcode/needCaptcha
  隐藏字段，值为 1 才弹」。直接写图像识别，可能是在解一道根本不会出现的题。
  顺序：① 打开登录页 ② 读隐藏字段初值 ③ 为空/0 就走纯表单 ④ 只有真为 1 才谈视觉。
  即便要过，**先把「识别不出来怎么办」定死**（截图 + 非零退出码交人工）。
- 证据：chaoxing `login.js`：`if (capInstance == null || $("#needVcode").val() != "1") { submit() } else { popUp() }`；
  本账号连续三次登录 `#needVcode` 均为空串，滑块从未出现。同类：zjuam 的 `getKaptchaStatus` 返回 false 时不校验。
- 反例边界：「从没触发」不等于「永不触发」，脚本必须保留 needVcode=1 分支并显式失败。
- 来源站：chaoxing.com，2026-11-20

## 页面自己会做加密时，别自己实现那个加密
- 模式：`t=true` 模式 —— 前端用 AES/RSA 加密账号密码再提交，密钥硬编码在页面 JS 里。
  正确做法是**填好输入框后点按钮**，让页面自己去加密。自己算出不同密文时，表现为「密码对的却登录失败」。
- 证据：chaoxing `encryptByAES(pwd, "u2oh6Vu^HWe4_AES")`，页面已加载 CryptoJS；Playwright 填表点击一次成功。
  对照：zjuam CAS 的密码要先**反转字符串**再 RSA。
- 来源站：chaoxing.com，2026-11-20

## 同一路径的 GET 与 POST 是两种接口：GET 回「合法空壳」比 404 危险
- 模式：同一 URL 按 HTTP 方法分流，**GET 返回结构正确但没有数据的壳**（HTTP 200、无报错、正文写「暂无数据」），
  POST 才真正查库。用 GET 会得到「这账号一条数据都没有」的**错误结论**，且不报错、不进 error 分支。
  排查：① 先试 POST ② 比对两次回包**字节数**（空壳常是固定小数字）③ 浏览器点真实入口抓一次请求。
- 证据：chaoxing `POST courselistdata` 返回 8832B / 3 门课；同路径 GET 返回 **1679B** 空壳，正文只有「暂无课程」。
  第一版脚本用 GET，输出 `[]` 且退出码 0。
- 与「HTTP 200 但 body 有错误码」的区别：那条读 body 能发现；这条**结构完全合法**，只能靠「数据本该有却没有」反推。
- 来源站：chaoxing.com，2026-11-20

## 第三方商业平台与校园 CAS 是两套身份体系，别用 campus-sso 硬套
- 模式：学校用的平台分两类 —— ①校方自建（zjuam/Keycloak 单点，`credentialKey=campus-sso` 直接可用）；
  ②第三方商业平台（学习通、智慧树、慕课，学校只是采购方，账号是学生自己在平台注册的）。
  对第②类拿一卡通去试是纯浪费；机构归属只体现在登录后的 `fid`/机构名上。
  判断手法：triage 看登录页有没有 CAS/SSO 跳转按钮。有 → 校园身份；只有账密+扫码+验证码 → 平台自建。
- 证据：chaoxing 登录页无 zjuam 跳转；用独立账号登录后 `var fid='469'`、落地页标题「浙江大学」。
- 顺带：**同一业务领域两个平台别混** —— 学习通（商业）vs 学在浙大（TronClass 自建），接口/鉴权/下载方式完全不同。
- 来源站：chaoxing.com，2026-11-20

## 通知/协作类接口常夹带第三方 PII：读到即投影，别落原始回包
- 模式：课程通知、群发消息、审批流回包里，除「你的那条」外往往还带**整个接收者名单**
  （`receiverArray`/`toNames`/`users`），一个班几十个真名+puid。这不是任务所需，属**他人个人信息**。
  做法：在返回层**字段投影**，只留 title/content/sender/time/attachments；不落原始回包。
  与「服务端脱敏是隐私判断的正例」互补：那条讲怎么判断，这条讲**自己别成为泄漏源**。
- 证据：chaoxing `getNoticeList` 单条通知里三处各带一份 20 人真名+puid。
- 来源站：chaoxing.com，2026-11-20

## Webplus 全站搜索：只有一个 `searchInfo` 参数，值是 base64 的 JSON 数组
- 模式：苏迪 Webplus 站群搜索接口 `POST /_web/_search/api/searchCon/create.rst?_p=<签名>&tt=<随机>`，
  **只接受一个表单参数 `searchInfo`**，值是 `base64(JSON.stringify([{field,value},...]))`。
  字段是定长九元组：`pageIndex / group / searchType / keyword / recommend / 4 / 5 / 6 / 7`。
  回包 `{linkSiteId, total, pages, data}`，`data` 是 **HTML 片段**不是结构化数组。
- **反面教训**：按常识拆成 `searchWord=&page=` 提交，接口回 200、`total=3605`，看起来「搜到很多」。
  实际 3605 是**全站总数**，返回的是与关键词无关的首页推荐。
  **判据**：换罕见关键词看 `total` 与结果是否变化；不变就是参数没生效。
- `_p` 从首页 `<form action="…&_p=XXX">` 抄，是搜索上下文标识不是凭证；站点换模板会变。
- 证据：ugrs 错参数 total=3605 且结果固定；正确协议后「培养方案」total=3、`pageIndex=2` 回 0 条（总数只有 3）。
  同日验证两站同协议不同签名：ugrs（培养方案 total=3）vs itc（VPN total=257、校园网 total=327）。
- 来源站：ugrs.zju.edu.cn，2026-11-20

## 「栏目不存在」有自己的回包特征：200 + 2KB 的「提示信息」页
- 模式：Webplus 栏目 URL 猜错时不是 404，而是 301 链后 **200**，正文是约 2.2KB 的
  「提示信息：访问地址无效，XXX找不到对应的栏目！」。照「200 就算成功」会当成抓到内容。
  **判据**：看回包大小（恒在 2KB 上下）+ 正文含「访问地址无效/找不到对应的栏目」。
  正确做法是**从首页列出的链接枚举栏目**，不要按语义猜路径名。
- 证据：ugrs `/tzgg/list.htm`（猜的）→ 200 2271B「提示信息」；首页真列出的 `/81372/list.htm` → 200 113593B 正常。
- 来源站：ugrs.zju.edu.cn，2026-11-20

## 「一个机构两个站」很常见：先判谁活谁死，别把旧站的陈旧数据当现状
- 模式：同机构常有「旧站仍在服务 / 新门户已上线」并存，两者标题可能**一模一样**。
  判据是**内容时效**：抓首页所有日期取最大值，与今天比。旧站特征：新闻停在几年前、链接指向新域名。
- 证据：心理中心 —— `www.xlzx.zju.edu.cn` 最新 **2026-11-20**（活站）；`www.xlfw.zju.edu.cn` 停在 **2021-03**（旧站）。两站 title 都叫「心理健康教育与咨询中心」。
- 延伸：同机构两站还常**编码不同**（xlzx UTF-8 / xlfw GB2312），按 host 定编码必错。
- 来源站：www.xlzx.zju.edu.cn / www.xlfw.zju.edu.cn，2026-11-20

## 根路径 502 不等于站点挂了：正确入口可能带 `/index/` 且末尾斜杠不能丢
- 模式：老 JSP/Vue 站根路径常 502 或空 302，容易被判「下线」。实际往往只是**根路径回落配置坏了**。
  排查：① 试 https 根 ② 跟 302 看它想跳哪 ③ 试跳转目标**加末尾斜杠** ④ 仍 502 就试 `http://` 原路径。
- 证据：`person.zju.edu.cn` —— `http://` 根 **502**；`https://` 根 302 →`http://…/index`（跟过去还是 502，是坑）；
  `https://…/index` 301 →`https://…/index/`；**`https://person.zju.edu.cn/index/` → 200 可用**。
  该站还是 Vue SPA + `frms-fingerprint.js` **设备指纹 SDK**（cemyun 平台），纯 HTTP 自动化前要先确认它拦不拦。
- 来源站：person.zju.edu.cn，2026-11-20

## RuoYi（若依）系站点：HTTP 一律 200，判活看 JSON 里的 `code`
- 模式：若依框架后端管理站**所有响应都是 HTTP 200**，失败信息在 `code`：`401`=未认证、`1`=通用失败
  （文案常是「系统繁忙，请稍后再试」）。`POST /login` 缺参数也回 200 + `code:1`，**不是系统真的忙**。
  接口前缀常是 `/prod-api`。另有 `captchaImage` 被放在认证之后的非默认配置。
- **登录前必做**：RuoYi 普遍有失败次数锁定。不要用「猜密码」或「拿一卡通硬试」探认证，
  先确认它是不是 CAS 跳转（看有没有 `/redirect/login` 这类路由）。
- 证据：kyjs —— `/prod-api/getInfo` → 200 `{"code":401}`；`/prod-api/login` POST `{}` → 200 `{"code":1,"msg":"系统繁忙"}`。
- 来源站：kyjs.zju.edu.cn，2026-11-20

## 服务端渲染的「日期拆成两段」：`<h3>19</h3><h6>2026.11</h6>`
- 模式：博达 VSB 系列表页把日期拆成两个元素：`<h3>` 日、`<h6>` 年月（点号分隔）。
  页面里**根本没有** `2026-11-19` 整串，按整串正则抓会得 0 条，且不报错，
  很容易误判成「列表是 JS 动态加载的」。
  **判据**：先确认列表容器（如 `ul.list5`）里有没有 `<li>`；有 li 却抓不到日期，就是格式问题不是渲染问题。
  正确做法：`h6.split('.')` 取年月 + 补零 + 拼 `h3` 的日。
- 附带：标题同时出现在 `title` 属性与 `h4` 文本里，**`title` 属性更干净**（`h4` 常带尾随空格）。
- 证据：`zulg.zju.edu.cn/notice/rctz.htm` 首版正则 0 条；改 h3+h6 组合后 15 条全出，日期正确。
- 来源站：zulg.zju.edu.cn，2026-11-20

## 同一套 CMS 协议可以跨站复用，但 `_p` 之类的上下文签名绝对不能
- 模式：Webplus 站群搜索**协议完全相同**，但每站有自己的 `_p`，**互不通用**。
  拿 A 站的 `_p` 打 B 站，会回 200 + 一堆**与关键词无关的结果**，看起来像「搜到了」。
  判据：换罕见关键词看 `total` 与结果是否变化。
- 证据：ugrs `_p=YXM9MzgmdD0zMDA2JmQ9MTQyODkmcD0xJm09U04m`（培养方案 total=3）；
  itc `_p=YXM9MTQ2JnQ9MzM0MyZkPTE2ODE2JnA9MSZtPVNO`（VPN total=257、校园网 total=327）。
- 价值：**发现一个 Webplus 站就等于发现全部**，只要知道去哪抓 `_p`。本库已复用：ugrs、itc。
- 来源站：itc.zju.edu.cn / ugrs.zju.edu.cn，2026-11-20

## 门户站内容「一半是外链」：抓列表时必须标记 external
- 模式：高校后勤、宣传类门户常把微信推文当内容，href 指向 `mp.weixin.qq.com`。
  只按 `<a href>` 抽会把「食堂推广」和「停电通知」等权处理。做法：解析时算 `external` 标记，让调用方过滤。
- 证据：`zulg` 日常通知 15 条里 5 条是微信外链（约 1/3）。
- 来源站：zulg.zju.edu.cn，2026-11-20

## 第三方学生社区（朵朵类）：主 bundle 里找不到 API 是正常的
- 模式：Vue/Vite 打包的 SPA，主 bundle 通常**没有业务 API 路径** —— 散在懒加载分片里。只扫主文件会得出「没有接口」。
  能拿到的确定信息：`baseURL` 与后端框架指纹。
- **框架指纹能省一半工作**：`GET /api/nonexistent` 回 `{"message":"Route … not found","statusCode":404}` 是 **Fastify** 格式，
  说明路由显式注册、可按词表枚举；若回 nginx/200 空壳，说明被 SPA fallback 吃掉。
- **要不要做**：第三方商业/社区站有用户协议与反爬，ROI 不如校方站。据此主动停在「定位到 api base」一层。
- 证据：duoduo 主 bundle 1,586,214B，抽出路由仅 9 条且无业务 API；`baseURL=https://api.duoduo.link/api`。
- 来源站：www.duoduo.link，2026-11-20

## 学院官网通知：用「日期锚点向前回溯 <a>」代替 li 块解析

- 模式：高校学院官网几乎都是博达 VSB / 苏迪 Webplus 模板，但**同一批站点的列表 DOM 各不相同**：
  标题/日期可能在 `span`、`div`、`h3`、`p` 里，`class` 名有 `news_title`/`cols_title`/`tit3` 等十几种。
  按 `li` 块 + 固定 class 写解析器，在 A 站能跑、B 站就 0 条。
  **稳健做法：以「日期正则」为锚点扫描全文，向前回溯最近的 `<a>` 标签**，取 `title` 属性（优先）或内文。
  这样不依赖任何 class 名与包裹层级，一套代码覆盖多种模板。
- 证据：2026-11-20 同一解析器跑 24 个学院站 ——
  `opt`（span+span）、`som`（div+div）、`ai`（h3+裸span）、`ced`（a>p+span 嵌套）四种结构**全部命中**，23/24 直接可用。
  对照：先用 `li` 块 + `class="news_title"` 的方案在 `som`/`ai`/`ced` 三站全返回 0 条。
- 附带两条：
  - **标题优先取 `title` 属性**，内文常带 `<font>` 高亮与多余空白。
  - **`.psp` 路径失效时试 `.htm`**：别人记录的 `xgb/53388/list.psp` 已跳登录页，换 `list.htm` 即正常。
- 适用范围：所有 VSB/Webplus 站群的列表页（高校门户、学院官网、部处网站）。
- 来源站：zju-notices 聚合（24 个学院站），2026-11-20

## 「别人探不通」不等于探不通：先确认自己的网络位置

- 模式：第三方项目常给站点标 `network: campus` + `status: 0`（探索者在校外，拿不到内网站）。
  但**如果你此刻在校园网内，这些站反而是可用的**，是相对外部项目的增量优势面。
  别直接照抄别人的 status 判定，要自己测一遍；判定时还要区分三种「不可用」：
  1. **502** —— 后端应用挂了（内网子站常见），DNS/TCP 可能都通；
  2. **首页仅几百字节** —— 站点已停维护或只剩框架壳，不是挂了；
  3. **栏目 301 到 `nopermit_zjusub.jsp` / 「IP并非校内地址」页** —— 是访问策略，换网络位置就能过。
- 证据：2026-11-20 对照 `dsh-zju-assistant` 的 `hosts.json`（69 源，18 个标 campus/status:0）——
  本机在校园网内实测，18 个里有 **9 个返回 200 且能解析出条目**；
  另有 15 个是 `*.office.zju.edu.cn` 子站真 502、15 个是首页几百字节的废弃站。
- 适用范围：任何「拿别人的站点清单来做增量探索」的场景。
- 来源站：zju-notices，2026-11-20

## 聚合类资产的索引口径：只有「有独立资产目录的」才能标 done

- 模式：做多站聚合时容易顺手把**每个子站**在 `_index.json` 里标成 `done`，但它们的 wiki/endpoints
  并不单独存在（都在聚合器那一份里）。一致性校验器会逐条报「索引标 done 但无资产目录」。
  正确口径：**聚合器是 done（有 wiki/script/endpoints），子站标 pending 但保留探明信息**
  （`aggSource` / `listUrl` / `latestNotice`），用字段表达「已知但无独立资产」。
- 证据：2026-11-20 一次登记 24 个子站为 done，校验器立刻报 24 处偏差；改成「聚合器 done + 子站 pending + 字段留证」后通过。
- 适用范围：所有多站聚合型资产（通知聚合、镜像站群、文档源集合）。
- 来源站：zju-notices，2026-11-20

## 同一批站点的 http/https 支持各不相同：不能「一刀切改协议」

- 模式：本机网络环境会变（校园网 / 校外 / 代理），而**每个站自己支持的协议是固定的**，
  不是「全网 https 都不通」或「全网都通」。同一时刻实测会出现三种并存：
  1. 只支持 **https**（http 回 301 跳 https）—— 最常见；
  2. 只支持 **http**（https 直接 ECONNRESET）—— 老站常见；
  3. 两者都通。
  **错误做法**：发现几个站 https 失败就批量把 `https://` 改成 `http://`，结果那批只认 https 的站全变成 301 死循环。
  **正确做法**：对**每个失败源单独**探 https 与 http，选真正回 200 的那个写回；
  并在代码里做「最多 3 跳跟随」，但**不要指望跟随能解决**（http 与 https 互跳时永不收敛，要按「重定向未收敛」报错）。
- 证据：2026-11-21 一次实测 —— `www.cst` 的 https ECONNRESET 而 http 200/39042B；
  `bms` 反过来（https 200、http 301 跳到 https）；同时 `www.baidu.com` 的 https 也 ECONNRESET，
  说明是**部分主机被重置**而不是全站。批量改 http 后 5 个源全 301，逐个测回 https 后 26/26 全通。
- 附带：**网络状态会跨小时变化**。同一批源在 11-20 全部 https 可用，11-21 部分被重置，
  11-22 又恢复。所以「探不通」的结论要带时间戳，别写成永久事实。
- 适用范围：所有多站聚合/批量探测；尤其跨越长时间会话（隔夜）后重跑时。
- 来源站：zju-notices（26 源），2026-11-21/22

## 同一学校的「统一身份认证」与「WebVPN 上网账号」是两套凭据，不能互换

- 模式：高校常同时存在两套账号 ——
  1. **统一身份认证（CAS/zjuam）**：学号 + 密码，用于教务、学在浙大等；
  2. **上网账号（校园网）**：用于 WebVPN、网络认证，账号可能是手机号或独立工号，**密码也常常不同**。
  WebVPN（深信服 WEngine）登录页 `auth_type` 默认是 **`local`**，即本地上网账号，
  不是 CAS。页面上虽然同时挂了 `cas` / `oidc` / `escience` / `dingding` / `auth_sms` 多种入口，
  但**默认值不是 cas**，所以拿统一身份认证的密码去登，成不成全看两个密码是否恰好相同。
- **如何避免误判**：① 读登录页的 `auth_type` 隐藏字段默认值；
  ② 看页面文案（本例明写「上网账号登录」）；
  ③ **先列出凭据桥接里到底有哪些键**（如 `webvpn` 与 `campus-sso` 并存时，各用各的）。
- **本次踩到的坑（真实事故）**：`login.mjs` 一开始写死 `loadCredentials('campus-sso')`，
  登录**成功了**——因为两个密码恰好一致。于是错误结论被「成功」掩盖，差点固化成资产前提。
  被用户指出后回查登录页才确认 `auth_type=local`、文案是「上网账号登录」，
  且凭据桥接里本来就有独立的 `webvpn` 键（描述「WebVPN 上网账号」）。
  **教训：登录成功不能反推「用对了凭据」。** 凭据选择要按站点声明的 auth_type 命中，
  而不是「哪个键能登进去就用哪个」。
- 正确写法：脚本里按 `webvpn` → 回退 `campus-sso` 的顺序解析，**回退时打印显式告警**，
  让「用错凭据」在日志里可见，而不是静默成功。
- 适用范围：所有「校园网/上网认证」类系统（WebVPN、RVPN、net3 上网认证、portal 登录页）。
- 来源站：webvpn.zju.edu.cn，2026-11-22

## 列表页的两种「反常规」日期写法：MM-DD+两位年份、日期在标题前

- 模式：除了常见的 `2026-11-20` 整串，还有两种会让「日期整串前溯 `<a>`」全盘失手：

  **A. 日期拆成 MM-DD + 两位年份**（如高分子系）
  ```html
  <div class="date fl"><p class="md">09-29</p><p class="year">26</p></div>
  <h3 title="标题">标题</h3>
  ```
  页面里**没有任何 4 位年份**，必须拼 `20` + 两位年份。

  **B. Tailwind/现代卡片站，外层 `<a>` 距离日期很远**（如 ai.office）
  ```html
  <a href="..." class="items-center p-6 ...">
    <div><span>内部公示</span><span class="font-mono">2026-11-20</span></div>
    <h3 class="font-bold">标题</h3>
  </a>
  ```
  `<a>` 在日期**前面且相距数百字符**，向前回溯 500 字符会找不到；标题在日期**后面**的 `<h3>` 里。

- **解法（已内置两种回退策略）**：
  - 策略 D：以 `>MM-DD<` 为全局锚点，向后 900 字符找 `class="year"`，向前 1000 字符找最近的 `<a>`；
    标题取段内 `h3[title]`。**不要用 `<li` 切段**——有的站 `<ul>` 里夹着未闭合容器，切段会整段错位。
  - 策略 E：以日期为锚，向后 900 字符找 `<h3>` 作标题，向前 2000 字符找最近的 `<a>` 作链接。
- 证据：2026-11-22 `ai.office.zju.edu.cn`（经 WebVPN 111KB）六种策略前五种全 0 条，加策略 E 后得 20 条；
  `office.polymer.zju.edu.cn` 加策略 D 后得 10 条。全程用同一份 HTML 逐策略计数定位，避免瞎猜。
- 适用范围：所有「日期非整串 / 标题在日期之后 / 现代前端重设计的学院站」。
- 来源站：ai.office / office.polymer（经 webvpn），2026-11-22

## WebVPN 穿透后：站点状态码要从「502 不可达」改成「需 webvpn」

- 模式：一批 `*.office.zju.edu.cn` 内网子站**直连 502**，很容易被记成「站点挂了」并长期标 pending/blocked。
  实际它们只是「仅校内 IP」——**经 WebVPN 全部 200 且有内容**。
  正确记法：`status: done` + `requires: ['webvpn']` + `viaVpn: true` + `directStatus: 502` + `vpnStatus: 200`。
  既保留「直连不可用」这个事实，又说明「怎么才能用」。
- 证据：2026-11-22 一次性验证 15 个内网子站（ygb / ai.office / bmsoa / che.cn / cspo / doe-oa /
  ee.office / office.cab / office.cas / office.chem / office.cmic / office.ls / office.polymer /
  saa.office / www.cls.office）——**15/15 经 WebVPN 全部 200**，日期数 10~85 不等。
  聚合器源总数从 26 提到 41，`health` 41/41 全通。
- 教训：**「探不通」要区分「站挂了」和「网络位置不对」**。前者记 blocked，后者记 done + requires。
  把后者长期留在 pending 里，等于让下一个人重新踩一遍 VPN 这坑。
- 适用范围：所有 `network: campus` 的站点清单。
- 来源站：15 个内网子站（经 webvpn），2026-11-22

## 索引状态必须跟着实测走：实测可用却留 pending 是债

- 模式：多站聚合时容易只维护聚合器（`done`），把底下几十个子站长期留在 `pending`。
  后果是下次有人查索引，会以为这些站**没探过**，于是重复探测。
  正确做法：**每个源都建独立资产目录**（哪怕只是薄页：`site.json` + 指向聚合器的 `wiki.md`），
  索引标 `done` 并写 `aggSource` 指回聚合器。这样「状态」与「资产」都真实。
  不要为了省事把子站留在 pending，也不要为了省事给它们编造独立 wiki。
- 证据：2026-11-22 审计发现 **39 个已实测可用的源仍标 pending**，另有 2 个完全未收录。
  为 41 个源各建薄页（site.json + 3 行 wiki 指向聚合器）后，索引 done 49 → 90，`verify-index` 通过。
- 附带：`_dir.md` 是 3 列表格（站点/状态/一句话），插入新行前先看表头列数，
  否则会插成 4 列把表格搞坏（本次就插错 41 行，已修）。
- 来源：yonkik 记忆区，2026-11-22

## 学院站群「代理伪造 IP 到 198.18.0.x」+「一半只有 HTTP」

- 模式：访问一批 `.zju.edu.cn` 学院/部门站时**全部 `ECONNRESET`**，看着像站点全挂。实测两层原因叠在一起：

  **第一层：代理伪造 IP（不是 DNS 污染）。** `dns.resolve4()` 把所有站返回 **`198.18.0.4` ~ `198.18.0.8`**——
  这是 RFC 2544 **基准测试保留段**（`198.18.0.0/15`），绝不可能是真实校园 IP。
  用 DoH（阿里 `223.5.5.5/resolve?name=&type=A`）查，真实 IP 是 **`210.32.x.x`**（浙大公网段）。
  **判据：看到 `198.18.` 开头就是代理伪造 IP（TUN 模式惯用段），不是站点问题、也不是 DNS 污染。**
  解法：DoH 取真实 IP，然后 `host: <IP>` + `Host: <域名>` 直连（`servername` 用域名，`rejectUnauthorized: false`）。

  **第二层：这些站一大半根本不开 443。** 直连真实 IP 后仍然 `ECONNRESET`——因为 TLS 那一步被 reset。
  实测 **62 个学院站里只有 9 个支持 HTTPS，37 个只有 HTTP(80)**。
  对只有 HTTP 的站，无论怎么改 SNI 都连不上（试过无 SNI、用 IP 当 SNI、默认 SNI，全 ECONNRESET）。

- 证据（2026-11-22 实测 62 站）：
  - `www.xgb.zju.edu.cn` → 443 ECONNRESET，**80 → 200 54,829B「浙江大学学工门户网」**
  - `www.lit.zju.edu.cn` → 443 ECONNRESET，**80 → 200 50,137B「浙江大学文学院」**
  - `www.cs.zju.edu.cn` → 443 ECONNRESET，**80 → 200 6,530B「计算机科学与技术学院」**
  - 支持 HTTPS 的 9 个：`ai` / `bms` / `ic` / `icsr` / `ls` / `mse` / `physics` / `polymer` / `www.phs`
  - 最终 **46/62 可达**（含 📢 通知栏目），14 个 DoH 也查不到 A 记录（真不存在或已下线）

- **操作建议**：探这类站群时写一个「DoH 取 IP → 先试 HTTPS → 失败降级 HTTP」的三段式探测，
  不要用 `https` 硬试也不要信本地 DNS。

- 适用范围：浙大各学院/学系/部门子站（`*.zju.edu.cn` 的二级三级域名）。校部主站（ugrs/grs/itc 等）多数两协议都通。
  其它高校的站群大概率同样存在「老站只开 80」的情况。

- 来源站：62 个 zju 学院站，2026-11-22

## Webplus 栏目号聚合：一个适配器吃下整站群

- 模式：苏迪 Webplus 站群的通知聚合**不需要每站写爬虫**。每个栏目就是一个 `/<栏目号>/list.htm`，
  例如 `bksy.zju.edu.cn/76425/list.htm`（学籍管理）、`www.xgb.zju.edu.cn/53388/list.htm`（最新通知）、
  `ygb.zju.edu.cn/31555/list.htm`（研工部通知公告）。
  所以配置层只需 `{base, columns:[{id, name}]}`，取列表 → 解析条目 → 拼详情链接，一套代码跑全部站。
- **栏目号从哪来**：打开该站首页，导航链接里 `/\d{4,6}/list.htm` 的数字就是栏目号。
- **价值**：这是「广度」的正确做法。我们之前是「一站一 crawler」，遇到 60 个学院站就是 60 份工作量；
  按栏目号聚合只需 1 份代码 + 1 张配置表。
- 配套字段（来自 dsh-zju-campus 的设计，值得抄）：
  - `audience: undergrad|grad` —— 只面向本科生/研究生的栏目要按使用者分
  - `feed: true` —— 增量扫描集（不是所有栏目都值得高频轮询）
  - `unordered: true` —— 有些栏目不按时间排序，别假设「第一条最新」
  - `default: true` —— 不指名来源时也读
- 证据：2026-11-22 用上述栏目号实测 `www.xgb` / `www.lit` / `www.cs` 三站列表页均 200 且能解析出条目。
- 来源站：bksy / www.xgb / ygb / 62 学院站，2026-11-22

## `198.18.0.x` 不是「DNS 劫持」而是「本地透明代理」：公网通、内网不通

- 现象：`dns.resolve4()` 把**所有**域名都返回 `198.18.0.4` ~ `198.18.0.13`（RFC 2544 保留段）。
  一开始误判为「DNS 被劫持，所有站都拿不到」，但实测**公网站点全部正常**：

  | 域名 | 解析 | 结果 | 服务器 |
  |---|---|---|---|
  | `chalaoshi.de` | 198.18.0.9 | **200 16,264B** | cloudflare |
  | `chalaoshi.xhuya.cn` | 198.18.0.12 | **200 69,264B** | Vercel |
  | `github.com` | 198.18.0.13 | **200 537,374B** | github.com |
  | `www.xgb.zju.edu.cn` | 198.18.0.5 | **ECONNRESET** | — |
  | `bksy.zju.edu.cn` | 198.18.0.4 | **ECONNRESET** | — |
  | `www.cs.zju.edu.cn` | 198.18.0.7 | **ECONNRESET** | — |

- **正确解释**：这是本机**代理软件（Clash/Surge 类）的 TUN/伪造 IP 模式**——它把所有域名解析到一个
  虚拟网段（198.18.0.0/15 是这类工具的惯用选择），由代理进程按域名分流。
  **公网站走代理出口正常，校内站因为出口在墙外回不到 210.32.x.x 内网段，连接被 reset。**

- **这不是「DNS 污染」也不是「站点挂了」**，是「代理分流把内网站也代理出去了」。

- **解法**：对校内站**绕过代理直连真实 IP**：
  1. 用 DoH（阿里 `223.5.5.5`）查真实 IP → `210.32.x.x`
  2. 用 `host: <真实IP>` + `Host: <域名>` 直连，**不走系统代理**
  3. 若仍 ECONNRESET，再试 HTTP(80)（学院站 37/62 只有 80）

- **判据速查**：
  - 解析到 `198.18.x` / `198.19.x` → 代理伪造 IP，**去查 DoH 拿真实 IP**
  - DoH 查到 `210.32.x.x` → 浙大真实地址，直连
  - 直连后 HTTPS reset 但 HTTP 通 → 该站没开 443，用 HTTP

- **与既有条目的关系**：`_playbook.md` 原有两条「本机代理 7993 的脾气」「实测 TIMEOUT 先分层」讲的是**显式 HTTP_PROXY 环境变量**；
  本条讲的是 **TUN/伪造 IP 模式**，两者是不同的拦截层，但**结论一致：内网站必须绕开代理**。

- 证据：2026-11-22 同一轮内实测 6 个域名，公网 3/3 通（含 537KB 的 GitHub 首页），校内 3/3 reset；
  同一批校内站改用 DoH+直连后 `ugrs`/`physics`/`www.lit`/`www.cs` 等 46 站全部 200。

- 来源站：跨站（chalaoshi / github / 62 学院站），2026-11-22

## 深层嵌套的列表页：正则必然漏，必须上 DOM

- 模式：用正则从 HTML 抓列表条目（`<a href>` + `[\s\S]{0,N}` 兜内文）在**深层嵌套**结构上必然漏，
  而且**不报错**——表现为「只抓到几条」「数量和实际对不上」，极易误判成「页面就这么多条」。
  典型结构：`<li><a href><div class=content><div class=date>…</div><div class=info><p class=title>标题</p></div></div></a></li>`
  —— `<a>` 内套三四层，N 给小了够不到标题，N 给大了贪婪吞掉相邻条目。

- **判据（最快的一步）**：先 `querySelectorAll('a[href*=X]').length` 数出「应该有几条」，
  再比正则抓到的条数。两者差得多就是解析漏了，与页面无关。

- **做法**：用真实 DOM。Node 侧最省事的是 **`linkedom`**（纯 JS、免编译、API 兼容标准 DOM）：

  ```js
  const { DOMParser } = await import('…/node_modules/.pnpm/linkedom@0.18.15/node_modules/linkedom/esm/index.js')
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('a[href*="page.htm"]')   // 标准 DOM API
  ```

  它常被其它包间接装进 `node_modules/.pnpm`，**先找现成的，不必单独 npm i**。
  同类可选：`htmlparser2`、`parse5`（纯解析器，无 DOM API）、`cheerio`（若有）。

- **linkedom 的坑**：
  - `document.textContent` 返回 **null**（不是空串），取正文要 `doc.body.textContent`
  - `document.querySelector('title')` 返回 Element，取文字要 `.textContent`
  - `a.closest('li')` 可用

- 证据：`zju-colleges` 的 `www.lit.zju.edu.cn/tzgg/list.htm`（76,914B）——
  **正则版 4/14 条，DOM 版 13 条**（另 1 条是页脚重复链接），差 3 倍。
  同一份 DOM 解析器在 46 个学院站上跑通，批量拿到 31 站 / 215 条。

- **附带收益**：DOM 版顺带解决了「标题在 `<p class="title">` 而非 `title` 属性」「日期在兄弟节点 `.date`」
  这类正则很难优雅表达的事——`el.closest('li').querySelector('.date')` 一行就行。

- 适用范围：所有 CMS 模板化列表页（Webplus、VSB、WordPress、Drupal 等）。
  **凡是「列表 + 摘要 + 日期 + 缩略图」多元素组合，都别用正则。**

- 来源站：zju-colleges（46 个学院站），2026-11-22

## 「公共 DNS 无 A 记录」= 纯内网主机，不是站点下线

- 模式：一批 `.edu.cn` 子站（`*.office.xxx`、`ygb`、`cspo`、`doe-oa` 等）本地解析到**代理伪造 IP**（`198.18.0.x`），
  请求 `ECONNRESET`。此时很容易判「站点已下线/后端不对外」。
  **正确做法：用公共 DNS（DoH）查一次** ——
  - DoH **有** A 记录（如 `210.32.x.x`）→ 站点在线，只是本机代理挡住了，直连真实 IP
  - DoH **完全无 A 记录** → **纯内网专有主机**，只在校园网内部 DNS 里存在，外部永远访问不到

- **两者的处置完全不同**：前者「换个路就能通」，后者「除非进校园网/WebVPN，否则不用试」。
  把后者在设计里显式标出来（如 `requiresVpn: true`），脚本遇到**直接报错而不是发请求**——
  省掉一整轮必然失败的扫描（本例 15 个站 × 2 协议 = 30 次无效请求）。

- 证据（2026-11-22，15 个站全部如此）：

  ```
  ygb.zju.edu.cn          local=198.18.0.6     DoH=无 A 记录
  ai.office.zju.edu.cn    local=198.18.0.14    DoH=无 A 记录
  office.cmic.zju.edu.cn  local=198.18.0.23    DoH=无 A 记录
  ```

  对照组（在线但被代理挡）：`www.xgb.zju.edu.cn` DoH=`210.32.8.34` → 直连 HTTP 200 / 54,829B。

- 适用范围：所有「内网子站」场景 —— `*.office.xxx`、`*-oa.xxx`、部门内部公示系统。
  这类站往往恰恰是**信息最有用**的（评奖公示、内部通知），值得为它单独准备 WebVPN 通道。

- 来源站：zju-notices / zju-colleges 合并，2026-11-22

## 日期解析：三种写法都见过，且都会骗人

- 模式：从列表页抽日期，会依次撞到三个坑：

  1. **只有年月**：`<p class="y">2026-10</p>`。补全成「某天」是造假，只能如实返回 `2026-10`。
  2. **取年月时被 URL 骗**：`/2026/1104/` 用 `(20\d{2})[-/.](\d{1,2})` 会匹配成 `2026` + `20`（`1104` 前两位），
     产出 `2026-20` 这种垃圾。修法：月份必须 `1..12` **且** `(?!\d)` 保证后面不紧跟数字。
  3. **列表页根本不显示日期**：这时唯一的日期源是 URL —— Webplus 的 `/yyyy/mmdd/cNNNaNNN/page.htm` 里
     `2026/1119` 就是 2026-11-19。**必须以 URL 兜底**，否则这些条目永远无日期、排序永远错。

- **排序的隐性坑**：空日期 `''` 用 `localeCompare` 比任何日期都小，会导致「无日期条目排最前」，
  看起来像「最新通知」其实是脏数据。**空日期必须沉底**，不能交给默认比较。

- 证据：`www.psych.zju.edu.cn` 列表页 —— 修前 20 条日期为空、部分显示 `2026-20`、`2026-11-19` 排在第 20 位；
  修后 32 条全带精确日期且严格倒序。

- 另一条：**写正则用 `new RegExp('...')` 字符串构造更稳**。
  字面量正则 `/\/(20\d{2})\/(\d{2})(\d{2})\//` 在多层文件读写/模板转义里，反斜杠很容易被吃成 `//(20\d{2})//`
  （变成空正则）——报错位置还不在原行，极难查。字符串构造只需一层转义。

- 来源站：zju-notices 合并，2026-11-22

## 命名空间猜错是「接口 404」的头号原因：点名在 radar 不在 courses

- 模式：同一个平台的接口常按**功能域**分命名空间，而不是按资源嵌套。
  看到 `/api/<资源>/{id}/<子资源>` 返回 404，先别急着判「接口不存在」——
  它很可能在另一个命名空间下，如 `/api/radar/rollcalls`（点名）、`/api/<模块>/<动作>`。
- **判据**：404 回包的 **content-type 与 body 形状**会暴露它是不是「路由不存在」。
  - 返回 `{"message":"未找到资源"}`（JSON）→ **应用层 404，路由框架在，路径不对**
  - 返回 `nginx` 的 HTML 404 页 → **反代层 404，整段前缀都不存在**
  两者含义完全不同：前者「换路径」，后者「换主机/端口」。
- 证据：学在浙大 2026-11-22 ——
  `/api/courses/105338/rollcalls` → **404 JSON `{"message":"未找到资源"}`**（应用层，路径错）
  `/api/radar/rollcalls` → **200 `{"rollcalls":[]}`**（正确）
  对比 `/api/uploads` → 404 JSON（同样应用层，但需具体 id：`/api/uploads/{id}/blob`）
- 来源站：courses.zju.edu.cn，2026-11-22

## 「跳转页」比 404 更容易骗人：142B 的 `location.href` 壳

- 模式：一些站的**根路径只是个跳转壳**，返回 200 + 100~200 字节的
  `<script>location.href='/dekt/'</script>`。看起来像「站点是空壳/已停维护」，
  实际真站在子路径上且完全正常。
- **判据**：正文含 `location.href=` 且字节数极小（<300B）→ 跳转页，跟过去再看。
  与「框架页」（`<frameset>`、1-2KB）和「SPA 壳」（`<div id=app>`）区分开：
  三者都「看起来没内容」，但处置不同 —— 跳转页跟一下就行，框架页要进 frame，SPA 要跑 JS。
- 证据：二课 `sztz.zju.edu.cn/` → **200 / 142B / 「正在跳转...」**；
  真站 `sztz.zju.edu.cn/dekt/` → **200 / 3,161B / 「浙江大学大学生素质拓展数智平台」**。
  同类：`me.zju.edu.cn`（879B）→ `/mecn/`；`www.cs`（6,530B，4 个 a 标签）→ `/csen/`。
- 来源站：sztz / courses / zju-colleges，2026-11-22

## 原站未必有镜像站的 API：别把镜像站的能力当成原站的

- 模式：社区站常有「原站 + 若干镜像/增强站」，**结构化 API 往往只有某个镜像站提供**。
  把 A 站的接口路径套到 B 站，会得到 404；这不是「站点改版」也不是「接口下线」。
- 判据：同一路径在镜像站 200 有数据、在原站 404 —— 就是「能力差异」，不是「故障」。
- 证据：查老师 2026-11-22 ——
  `chalaoshi.xhuya.cn/api/gpa` → **200 有结构化数据**（一次给同课全部老师均绩）
  `chalaoshi.de/api/gpa` → **404**（Apache）；`api.chalaoshi.de/api/gpa` → **404**（Flask）
  原站 `chalaoshi.de` 本身 **200 / 16,267B 正常**（Cloudflare），只是没有那个 API。
- **附带教训**：早前把 `chalaoshi.de` 记为「DNS ENOTFOUND / 被墙」是**当时网络环境**导致的误判。
  域名一直在，DoH 查得到 `104.21.33.250`。**「当时连不上」不等于「站点不存在」，
  凡记 ENOTFOUND 的条目，换环境后应复核一次。**
- 来源站：chalaoshi.xhuya.cn，2026-11-22

## WebVPN 是本机访问内网站的**唯一**通道：15/15 实测全通

- 模式：一批校园站「公共 DNS 无 A 记录」（纯内网主机），本机怎么试都 `ECONNRESET`。
  只要**有 WebVPN 上网账号**，就能全通 —— 本轮 15/15 实测可达，最大 169,958B。
  这类站往往是**办公网**（`*.office.xxx`），信息密度比公开站高（评奖评优、内部公示、人事）。

- 用法（深信服规则，公开且固定）：

  ```
  https://webvpn.zju.edu.cn/<scheme>/<enc(host)><path>?vpn-12-o2-<host>
  enc(host) = hex("wrdvpnisthebest!") + hex(AES-128-CFB(host, key=iv="wrdvpnisthebest!"))
  ```

  需要先登录拿 `wengine_vpn_ticketwebvpn_zju_edu_cn` 票据。

- **两个必踩的坑**：

  1. **协议写 https**。WebVPN 会把 `http` 重写入口 **301 到 https**。用 http 起会多一跳；
     更麻烦的是如果脚本不跟 301，只会拿到 **162B 的 nginx 301 页**，让人误判成「站点不通」或「登录态失效」。
     **判据：162B + `301 Moved Permanently` = 跟 Location 就对了**，不是权限问题。
  2. **VPN 返回的 HTML 里 `href` 常用单引号**：`href='/2026/1117/c31555a3228402/page.htm'`。
     正则只匹配双引号会**一条都抓不到**（且不报错）。用 DOM 的 `querySelectorAll('a[href]')` 不受影响。

- **凭据口径**：WebVPN 默认 `auth_type=local`，用的是**上网账号**（校园网账号），
  **不是统一身份认证（CAS）**。两者不总一致 —— 早前误用 `campus-sso` 能登进去纯属两个密码恰好相同。
  凭据键应用 `webvpn`，别用 `campus-sso`。

- 证据：2026-11-22 —— `ygb.zju.edu.cn` 经 VPN 200/15,301B（183 条通知）；
  `www.cls.office.zju.edu.cn` 169,958B；15 站逐一实测全部 200。
  同一批站不经 VPN 全部 `ECONNRESET`。

- 来源：zju-notices / webvpn，2026-11-22

## Webplus 的文章 id 与栏目号：去重键只能取 `a` 号

- 模式：Webplus 的文章 URL 形如

  ```
  /2026/1119/c39312a3229329/page.htm
           └──┬──┘└──┬───┘
           栏目号   文章 id
  ```

  **`c` 后面是栏目号**（同一栏目的所有文章都相同），**`a` 后面才是文章 id**（唯一）。

- **踩过的坑**：跨站去重时写 `/[ca](\d{5,})/`，正则从左往右先命中 `c39312`，
  于是「同一栏目的所有文章」被当成重复合并 —— 406 条变 51 条（**降 87%**），
  近 7 天从 17 条掉到 9 条。修成优先匹配 `a(\d{6,})` 后恢复正常（只去掉 1 条真重复）。

- **判据**：去重前后数量骤降（>30%）几乎一定是键选错了，不是「真的重复多」。
  正确做法是抽样几条被合并的记录，看它们的 URL 差异在哪一段。

- 另一条：VSB（博达）站的文章 id 在 `/info/NNNN/NNNNN.htm` 的**最后一段**，
  与 Webplus 的 `a` 号是两套体系，去重时两条都要认。

- 来源：zju-notices，2026-11-22

## 假分页：`?page=2` 返回 200 但内容与首页一模一样

- 模式：给列表页加 `?page=2` 这类参数，服务器**返回 200**，看起来成功了，
  但**字节数与首页完全相同** —— 内容根本没变。用状态码判断会漏掉。
- **判据（最快）**：`r.len === first.len` → 假分页。更严一点：比对首条条目的 href 是否相同。
- 同批试错的四种形态（Webplus 站，实测 4 站一致）：

  | 形态 | 结果 |
  |---|---|
  | **`list2.htm` / `listN.htm`** | ✅ 正确，200 且内容不同 |
  | `list_2.htm` | ❌ **301**（下划线形态是别的 CMS 的）|
  | `?page=2` | ❌ **200 但内容相同**（假分页，最隐蔽）|
  | `index_2.htm` | ❌ 404 |

- 教训：**分页形态没法靠猜，也没法只看状态码**。要同时看「状态 + 字节数 + 首条 href」。
- 来源站：zju-notices（ygb / www.lit / www.cs / opt / oc），2026-11-22

## 页面声明的页数不可信：以「遇到 301/404 就停」为准

- 模式：Webplus 列表页底部的「尾页」链接里有 `listN.htm`，它的 N **不是真实页数**。

  | 站 | 页面声明 | 实际末页 |
  |---|---|---|
  | `ygb.zju.edu.cn` | 19 页 | **10 页** |
  | `www.lit.zju.edu.cn` | 17 页 | **10 页** |
  | `opt.zju.edu.cn` | 26 页 | **10 页** |

  原因是**每页条数被调大过**：`ygb` 写「总共 183 记录」，按 14 条/页算得出 19 页，
  但现在实际 20 条/页，所以只到 10 页。**声明值是按旧配置算的，没跟着更新。**

- **做法**：声明页数只当**上限**，真实边界靠「遇到 301/404 就停」。
  返回值里分清 `declaredPages`（声明，不可信）与 `fetchedPages`（实抓，可信）。

- 同类现象可推广到：**任何由服务端渲染的「总页数/总条数」都可能是陈旧的**，
  以实际迭代到失败为止为准。

- 来源站：zju-notices，2026-11-22

## 内部函数返回值上的 `slice` 会静默吃掉数据

- 模式：`fetchOne()` 为了输出好看返回 `items.slice(0, 40)`，上层 `aggregate()` 直接用它 ——
  分页明明抓了 134 条，聚合只有 60 条（差 74 条），而**两边都不报错**。
- **判据**：单站抓取数与聚合后条数对不上，先查返回值上有没有 `slice`/`limit`/`take`。
  这类截断在「只取首屏」时看不出来，一加分页立刻暴露。
- 修法：内部函数返回完整数据，**只在最终输出层截断**；或把上限设得足够大（本例 500）。
- 验证方式：**同一份数据用两条路径取，比对条数**（`fetch <host> --pages 0` vs `all --site <kw> --pages 0`）。
- 来源站：zju-notices，2026-11-22

## 「某个 CMS 没适配」多半是没核实：先数一遍实际有几个站用它

- 本轮真实教训：上一轮我记「VSB（博达）站分页未适配，`list_2.htm` 是 301，翻页形态没摸」。
  这一轮**扫了 47 个可达站首页**去找 VSB 站 —— **结果 0 个**。
  30 个站全部是 Webplus（`/yyyy/mmdd/cNNNaNNN/page.htm`），包括我原以为的 VSB 站
  （`www.math` / `www.neuroscience` / `www.chem`）。
  **所谓「未适配的 CMS」根本不存在，上一轮是凭 `list_2.htm` 返回 301 就推断「这是另一套 CMS」。**

- **判据**：下结论「X 类站没适配」之前，先在全部目标站里**数一遍 X 类有几个**。
  一条 `grep -c '/info/[0-9]'` 就能把 30 个站判完，成本几秒，能省掉一整轮白工。

- 反面模式（我犯的）：**从一个失败现象反推体系**。
  `list_2.htm` 301 → 推断「下划线形态是别的 CMS」→ 推断「有一批 VSB 站要单独适配」。
  实际 `list_2.htm` 301 只说明**那个 URL 不存在**，跟 CMS 种类无关。

- 同类可推广：遇到「某类站点行为不同」时，先统计**它到底有几个**，别先写适配器。

- 来源站：zju-notices / zju-colleges（47 站扫描），2026-11-22

## 深页 301 不等于「末页」：跟一下可能就是内容

- 模式：分页翻到第 N 页返回 **301**，很容易判「越过末页，停」。
  实测 Webplus 的**深页用 .psp 扩展名、浅页用 .htm**，所以 .htm → .psp 的 301 是**正常跳转**：

      /tzgg/list11.htm → 301 → /tzgg/list11.psp   （跟过去 200，14 条）

  代价：不跟这一跳，www.lit 只拿到 10/17 页，ygb 只拿到 10/19 页（**少约 40% 数据**）。

- **判据**：301 的 Location 指向**同一栏目、同样式、只是换扩展名**的 URL → 跟。
  指向站点首页 / 登录页 / 错误页 → 才是真的到头了。
  **别只看状态码是 3xx 就 break。**

- **经代理/VPN 时 Location 会被重写**，判断要兼容两种：

      直连：  http://host/tzgg/list11.psp
      VPN：   https://webvpn.host/https/<hex>/31555/list11.psp?vpn-…

  从 VPN 的 Location 里要用正则剥出 /https/<hex>(/真实path) 那一段。
  **只判 hostname === 原站 会漏掉全部 VPN 站。**

- 同类可推广：**CMS 对深浅页用不同扩展名/不同路由**很常见（.htm/.psp/.jsp/.do）。
  遇到深页异常先怀疑「换了个入口」，而不是「没有这一页」。

- 来源站：zju-notices（www.lit / www.math / ygb），2026-11-22

## 同站 .htm 向 HTTP .psp 跳转：先验证 HTTPS 的目标路径

- 团委 2026-11-22：HTTPS /tzgg/list.htm 和正文 page.htm 回 301 到同主机的 HTTP .psp；直接请求 HTTPS 的相同 .psp 路径是可解析列表/正文，不需要降级、盲跟或将 301 当末页。HTTPS /main.psp 同理。只归一经验证的同站同路径模式；不同主机、登录墙或 401/403 停止。
- 证据：sites/zjutw.zju.edu.cn/wiki.md 和 endpoints.json，通知总栏第 2 页 14 条。配置表以 method + host + column + page path 对齐，不能按 host 一键覆盖多个栏目。

## 精确栏目通路不能退回同主机另一个栏目

证据：2026-11-22，团委 8 栏、本科生院 2 栏，并存于 sites/zju-notices/columns.json；旧按主机单键会覆盖。将历史路径、有效 HTTPS 路径、栏目场景与页面实测分开；标题和 curr_page 校验不通过就报错。去重仅依据可靠 URL 并保留多个来源；不同主机同编号不合并。

## Webplus 父栏目可能展示默认子栏目标题

2026-11-22 学工部实证：/53395/list.psp 与 /53396/list.psp 都返回 title=重要通知、各 14 条；面包屑末端却分别是 53395→53397、53396→53400。必须校验期望的父/子栏目路径，不能用同名 title 或首页导航代替，也不能把两栏合并。证据：sites/www.xgb.zju.edu.cn/endpoints.json，解析见 sites/zju-notices/crawler-columns.mjs。

## 公开主页与栏目鉴权分别验证

ITC 2026-11-22 实证：公开门户和检索不证明 /90618/ 通知公告免登录，旧扩展名 301 的同站目标 /90618/list.psp 单发显示 302 到 CAS。保留协议与鉴权每跳证据；不把栏目只见 HTML、非空导航或登录壳判成可读。

## 用官方索引链接给公开 JSON 单条读提供来源

2026-11-22：本科生院实践交流首屏明确链接 kyjs 新闻详情 10310，与 JSON 接口返回的 title/newsId 对齐；业务 code=0，与旧业务模块 code=401 需分开判。在公开列表取真实资源引用，不猜 ID，不以文章校验扩大到报名、附件或个人信息。

## 同一 URL 的不同查询参数可能是不同业务场景

素拓 2026-11-22：相同 getXmList 路由，lx=1 是项目，lx=2 是活动，不是第二/第三课堂类别。校验时同时保留方法、参数、标题/日期结构及成功业务码；另一个公告路由则只是既有通知能力的替代。附件元数据不等于已取得公开文件。证据：sites/sztz.zju.edu.cn/endpoints.json。

## 官网公开场馆规定不能替代实时预约须知

体艺 2026-11-22：官网 WESCMS 的场馆规定和 APP 说明能公开读；不同应用的 /venue-server 会返回 200 JSON，但 code=400 无业务数据。分别记录公开内容、业务边界和可确认的日期。不要拿旧子系统的 404 推断新前缀，也不要把业务 400 解释为已确认的登录机制。

## 年度文件的年份不是记录日期的年份

holiday-cn 实证：2019 年元旦公告文件含 2018-12-29 补班、12-30/31 放假；12 月需同时核对本年与次年。布尔 false 是补班，不能当无记录。镜像 404、空数组和网络失败不能被读成“没有节假日”。证据：sites/cdn.jsdelivr.net/endpoints.json。

## 同一列表标题可属于多个父栏目

控制学院 2026-11-22：/39322/ 与 /39333/ 的 title 都是「最新消息」，分属本科生教育与研究生教育；只比 title 会混为一栏。判据是「当前位置」末两段路径与文字同时匹配。旧标签也可能错：台账称 /39351 为科研学术，实为就业指导·相关通知。证据：sites/www.cse.zju.edu.cn/endpoints.json。

## 没有独立面包屑时用什么证明栏目归属

心理系 2026-11-22：整页没有 dqwz/col_path/「当前位置」，只有 p.title（frag=窗口5）里「首页 > 本栏」两个链接。判据退化为「该链接序列末项的路径必须等于本栏路径、文字必须等于列表标题」；仅凭 title 或侧边导航同名条目不足以确认栏目。同一站四个栏目版面一致，可复用同一解析器，但仍逐栏校验。证据：sites/www.psych.zju.edu.cn/endpoints.json。

## 同一站内两个同名栏目需按父栏区分

机械学院 2026-11-22：/meoffice/6427/ 与 /meoffice/6469/ 的列表标题都是「重要通知」，分属本科生教育与学生工作。判据仍是「当前位置」末两段路径＋文字同时匹配；本条与 R9 控制学院的同名案例互证，说明这不是单站偶发。证据：sites/me.zju.edu.cn/endpoints.json。

## 目录路径与页面自认的栏目路径可能不是一个

数学学院 2026-11-22：清单里的 /38081/list.htm 与 /38080/list.htm 都能正常返回，但页面 r_link 自认的栏目路径是 /bylw/ 与 /zxzyqr/。这种情况下「能打开」不等于「就是这个栏目」，同一内容存在两个地址。做法：把差异记录成 identity-mismatch，不开放通路，等确认权威地址；不要为了凑覆盖率任选一个。

## 父栏地址渲染子栏时，以标题命中项定位本栏

经济学院 2026-11-22：/xssz/list.htm 的标题区是「首页 > 学生思政 > 重要通知」，chip 指向 /zytz/list.htm。判断办法是先在 main-header 链接里按显示标题定位 chip，再取它前一项作父栏；不能假定「请求路径 == 栏目路径」，也不能只用末项。

## 同名栏目的层级数与文字都要比

哲学学院 2026-11-22：三处「最新通知」分别挂在教育教学›本科生教育、教育教学›研究生教育、学生思政之下，其中两条是三级、一条是两级。只比末项或只比末两项都会串栏；正确做法是把整条「当前位置」（去掉首页）逐项比对，并要求层级数相等。证据：sites/www.philosophy.zju.edu.cn/endpoints.json。

## 面包屑里可能出现同一个 href 的父子两项

公共管理学院 2026-11-22：/spaoffice/zxtz/list.htm 的「当前位置」是 本科教育 › 最新通知，两项 href 完全相同。只比对路径会误判成同一级或遗漏父级；必须同时比对文字与层级数。

## 同校多模板：class 名不同但判据可以一致

艺术与考古学院 2026-11-22：面包屑是 div.column-path / span.path-name，标题是 h2.column-title，列表是 ul.cols_list + span.cols_title/cols_meta，与哲学学院的 col_path/col_title/news_title 全不同名。判据仍是「完整链路逐项比对 + 标题复核」，只按本站 DOM 取对容器，不复用他站 class 名。

## 横幅大类 + 面包屑栏目名是两层不同信息

光华法学院 2026-11-22：页面 h1 横幅写「学生工作」，面包屑末项才是「评奖评优」，列表 title 同末项。只校验面包屑能过，但「公告」这类子栏（对外交流 › 公告）与一级栏的区分要靠横幅，故两者都要验。另有父级链接指向站群共享入口 /_s331/main.psp 的情况，不能据此判为错栏。

## 日期格式不同不代表数据缺失

教育学院 2026-11-22：列表日期是 YYYY/MM/DD 斜杠格式，而站群多数是 YYYY-MM-DD。解析时先统一成 ISO 再校验，否则会把正常条目当成「无日期」丢弃。另注意 /jldt/list.htm 缺分页计数块，属单页列表，不能把「必须有 all_count」当通用前置条件。

## 空 title 属性不是标题

马克思主义学院 2026-11-22：列表锚点写成 title=""，完整标题只在链接文本里。若沿用「优先取 title 属性」的策略会拿到空标题并整栏丢弃；正确做法是「属性非空才用，否则用文本」。这与光华法学院（属性有值但文本被截断）正好相反，两种形态都要兼容。

## 目录标签可能和页面标题不一致

化学系 2026-11-22：上游目录把 /55185 标为「党政综合·本科生教育」、/55193 标为「国际交流」，实际页面标题是「文件汇编」「办事指南」。这类差异要如实并列记录（目录标签 + 实测标题），不擅自改名，也不因此判为错栏——身份仍由页面内的大类、选中项与标题三者自洽来确认。

## 去重与「条目少了」的区分

地球科学学院 2026-11-22：/34774 首屏抽出 20 个候选却只余 19 条，因为模板里同一条公告的链接出现两次（URL 完全相同）。这类「候选数 > 条目数」是去重而非漏解析；判断依据是 unidentified 仍为 0 且重复项 URL 一致，不能拿「候选数 ≠ 典型每页条数」当成错栏信号。

## 实测有效 ≠ 应扩基线

地球科学学院 2026-11-22：/gsxx/ 与 /35056/ 的 .htm 301 到同站 .psp 且内容可解析，但上游 418 行清单并未列这两条。把它们作为旁证写进证据文件即可；一旦新增目录行，行数与请求键数就会偏离既定基线（418/417）并让回归断言失效。做法是「内容证据照记，行数口径不动」。

## 协议升级与跳错站要分开

材料学院 2026-11-22：http://mse.zju.edu.cn/<栏目>/list.htm 一律 301 到同一主机同一路径的 https 版本。这属于协议升级，可以按 HTTPS 记录有效地址并保留原清单路径；但若 301 换了主机或换了路径，就不能这么处理。另：日期写成 YYYY.MM.DD（点号分隔），解析时统一成 ISO 再校验。

## 同一模板也可能每页条数不同

建筑工程学院 2026-11-22：DOM 结构与材料学院一致（col_path / Column_Anchor / news_list.list2），但每页 14 条，材料学院是 20 条。判断「解析是否完整」不能拿别的站的每页条数当基准，只能以本站 CMS 声明的 per_count 与实际解析数对照。

## 把「末项必须等于请求路径」写成硬校验

航空航天学院 2026-11-22：/66964/list.htm 与 /dwjl/list.htm 都能打开、标题也正常，但「当前位置」末项分别自认 /67668/ 与 /tzgg_70387/。与其逐站人工判断，不如在解析器里直接要求「面包屑末项路径 == 请求路径」，不满足就报错——这样别名不一致会立刻暴露，而不是悄悄按错路径入库。

## 同源 DOM 结构不等于同源取值策略

传媒学院与马克思主义学院都用 ul.cg-news-list#arthd，但前者锚点 title 属性有完整值、正文可能截断，后者 title 是空串、正文完整。「属性非空才用，否则用正文」这一条策略能同时覆盖两者；如果一边倒取属性或一边倒取正文，都会在其中一站拿到空标题或被截断标题。

## 列表不一定是 ul/li

电气学院 2026-11-22：栏目列表由 div.col_news_list 下若干 div.jzlb 块组成，每块含 div.btt3 > a 与 div.fbsj4 日期。只按 li 匹配会整栏解析为 0 条；正确做法是先按列表容器切块，再在块内分别取标题与日期。

## 同名栏目超过三个时，靠大类名分组

集成电路学院 2026-11-22：五个栏目都有「通知公告」这个标题，分属学生思政、教学招生、综合服务、教工之家四个大类。此时只看标题毫无区分度，必须把「当前位置」整条链路（含父级）与大类名一起比对；只比末两级仍会串栏。

## .htm 301 到同站 .psp 是扩展名迁移

生命科学学院 2026-11-22：清单里所有 /list.htm 都 301 到同一主机、同一目录下的 /list.psp，内容正常。这与「跳错站」不同，可以按 .psp 记录有效地址并保留原清单路径；判据是同主机且仅扩展名不同。若目录不一致或主机变了，就不能这么处理。

## 面包屑父级与末项同路径也要看文字

外国语学院 2026-11-22：/12577、/12609 两栏的「当前位置」是「本科教育 › 最新通知」「对外交流 › 最新通知」，但父级与末项 href 都是本栏路径。这类形态只能比对文字与层级数；同时末项必须等于请求路径的硬校验仍然有效，不会误杀。

## 页面自报地址是路径别名的第三判据

海洋学院 2026-11-22：每页脚本里有 `var url = "/pjpy/list.htm"`，这是 CMS 自己记录的栏目地址。配合 h1 标题和父栏目名，可三向确认身份；若自报地址与清单路径不符，就是别名不一致，应停止而不是任选其一。

## 学院站的数字目录也常是别名

计算机学院 2026-11-22：/27179、/27110、/27108、/27109 四个目录路径都能打开且标题正确，但面包屑末项分别指向 /27183、/27175、/29529、/27169。这类「数字目录 ≠ 页面自认栏目」在同一站很常见，用「末项必须等于请求路径」一条硬校验即可批量识别，不必逐个人工核对。

## 日期被拆成日与年月两段

信电学院 2026-11-22：列表里日期是 div.time 内 h3=「20」+ p=「2026-10」，拆成两段。解析时必须拼成 YYYY-MM-DD 再校验，否则会把全部条目当成无日期；这类拆分形态与已见过的 p.d/p.y、YY-MM-DD 都不同，需按站点实测。

## 三重校验不是冗余

公共卫生学院 2026-11-22：本站同时有「当前位置」链路、Column_Anchor 大类名、col_title 标题三处信息。三者一致才开放，看似冗余，但正因如此才能识破「页面标题正确、面包屑末项却指向另一路径」的别名情形——单看任何一项都会误判为可用。

## 默认子栏、父子同路径、真别名要分开

历史学院 2026-11-22 同站并存三种形态：①父栏地址渲染默认子栏（/65251 → 「学生思政 › 最新通知」，末项即本路径）；②父子链接同路径但文字不同（/65280、/65292）；③真别名（末项指向另一路径，本站本批未出现）。判据统一为「末项路径 == 请求路径」+「整条链路文字逐项匹配」，不需要为每种形态写特例。

## 学院「办公网」域的 .htm 也可能整目录换名

能源工程学院 2026-11-22：/75435（团委）页面标题正确，但面包屑末项指向 /tw/，说明这个数字目录是语义目录的别名。学院办公网常见「数字目录 = 别名、语义目录 = 权威」，遇到就按 identity-mismatch 记录，不要两者都开放。

## 日期可能带方括号

化工学院 2026-11-22：列表日期写成 `[2026-11-19]`，方括号是页面文字的一部分。解析用 `\[\s*(\d{4}-\d{2}-\d{2})\s*\]` 不吃括号本身、只取内部日期；若直接按 `20\d\d-` 匹配也可能命中，但会在「同页既有裸日期又有括号日期」时产生歧义。

## 同一个站里扩展名也可能混用

光电学院 2026-11-22：8 个栏目里 3 个的 /list.htm 301 到同站 /list.psp，另 5 个 /list.htm 直接返回 200。不能按站点统一假设一种扩展名，必须逐栏记录有效地址；白名单也要允许「.htm 或等价 .psp」两种取值，而不是二选一。

## 页面 title 与栏目标题可以不同

农学院 2026-11-22：/28949 的 <title> 是「国际合作与交流」，而页内 h2 与清单栏目名都是「通知公告」。清单标签记的是层级+栏目，页面 title 有时会退化成父栏名。校验必须钉在页内 h2（真正渲染的栏目标题），不能拿 title 顶替。

## ul.wp_subcolumn_list 是容器页标志

动物科学学院 2026-11-22：/15889 页面看着像普通列表（CMS 声明 19 条 / 1 页），但内容由多个子栏各一段拼成，标志是出现了 ul.wp_subcolumn_list 与多条 h3.sublist_title。这种页面不能当单一栏目开放——总数是子栏之和，去重和分页都会失真。解析器直接按「容器页」拒绝，再逐个子栏验证。

## 被注释掉的日期不是日期

高分子系 2026-11-22：/sjjx 每条的日期块整段包在 HTML 注释里，页面根本不显示。若解析器不先剥离注释，会读出页面上不存在的日期，把无日期列表伪装成有日期列表。正确做法是解析前先剥离 HTML 注释，再如实按无日期列表处理并在台账里写明。

## 大类名可能挂在侧栏标题上

生仪学院 2026-11-22：页面没有全局 Column_Anchor，大类名（学生工作 / 国际交流 / 教育教学）在侧栏 div.m1 > h2 里。这不是导航栏标题而是栏目属性块，可以作为大类判据；但必须先确认它在简单栏目属性窗口（simpleColumnAttri）内，否则会与菜单标题混淆。

## 同源模板也可能少一项判据

脑科学与脑医学系与信电学院用的是同一套 list_top/list_guild 模板（含 h3+p 两段日期），但脑科学系没有 Column_Anchor 大类名。同源不等于同判据：开放前必须实测该页到底有哪些身份线索，缺哪一项就不能假装有。

## 栏目地址也可能只是一篇文章

软件学院 2026-11-22：/36192 在导航里和别的栏目并列，但打开只有 div.wp_column_article 一篇正文，没有列表、没有分页、没有 CMS 总数。这类「栏目壳 + 单篇正文」不能当列表开放，也不能假装解析成功；正确处置是标 container-only 并注明 list-not-applicable。

## 模板重写会换掉所有类名

人工智能学院 2026-11-22：整站被 Tailwind 重写，原先依赖的 col_path / news_list / Column_Anchor 全都不存在，列表项变成 a.w-full.p-6，日期在 span.font-mono。写解析器前必须先确认该类名在新模板里是否存在，不能假设「同一 CMS 就有同一 DOM」；但 CMS 输出的 all_count/all_pages 仍在，计数校验可以继续用。

## 面包屑要用可见文字锚定

动物科学学院 2026-11-22：面包屑在 frag=窗口22 / 23 两个块里各出现一次，且两个块内部还有嵌套 div。按 div 层级去切会提前截断，导致父级信息丢失、所有栏目都被判成链路不匹配。可靠做法是用页面可见的「当前位置：」文字做锚点，向后取到下一个 </div>。

## 没有面包屑时用导航选中项

文学院 2026-11-22：整站没有「当前位置」面包屑，唯一能证明「我打开的是哪个栏目」的线索是左侧导航里的 `li.menu-item.selected`——它的 href 必须等于请求路径、文字必须等于清单标签。若某栏目不在该导航里（如办公网的 /rcpy），就没有 selected 项可核，此时应判为无法确认身份、不开放，而不是退回用页面标题凑数。

## 同一学院可能有两个站，各自独立核对

能源工程学院 2026-11-22：doe-oa.zju.edu.cn（办公网）与 www.doe.zju.edu.cn（官网）是同一学院的两个不同站点，列表结构都是 jzlb 但目录体系与面包屑完全不同。已收录其中一个站，不代表另一个站可以套用同样结论——每个 host 都要独立核对目录与身份判据。

## 主机名相近不代表同一个站

化工学院 2026-11-22：che.cn.zju.edu.cn 与 che.zju.edu.cn 只差一个 .cn，但一个是独立站、一个是 /checn/ 子站，目录体系和栏目编号完全不同。按 host 记录时必须以完整 host 为键，不能因为名字像就复用前一个站的结论。

## 面包屑与导航选中项可以互为补充

物理学院 2026-11-22：两栏页面标题都是「最新消息」，面包屑父级与末项又指向同一路径，光靠面包屑无法区分。此时左侧导航 `menu-item.selected` 的 href 提供了第三条独立证据；把它和面包屑、侧栏大类名一起比对即可唯一定位。

## 同学院两个 host 共用模板但要分别入库

海洋学院 2026-11-22：oc.zju.edu.cn 与 oca.zju.edu.cn 共用 weizhi + 嵌套 a 的模板，但栏目集合与路径完全不同。模板相同只说明解析策略可复用，不代表栏目结论可复用——每个 host 仍需独立取首屏并核对。

## 父级与末项同名同目录时靠完整路径比对

计算机学院官网 2026-11-22：/csen/zdts 的面包屑是「重点提示（/csen/26710）› 重点提示（/csen/zdts）」，父级与末项文字完全相同、只有路径不同。此时候选路径必须逐项比对，只比文字会误判为同一层。

## 相邻数字/字母目录常互为别名

网安学院 2026-11-22：/xsjl/list.htm 与 /xsjz/list.htm 只差一个字母（l/z），前者可访问但页面自认后者。这类「字母近似的目录」在网络学院站点里常见，靠末项路径校验能直接识别，不要因为「内容看起来对」就放行。

## 一个栏目可能同时命中「标签≠标题」和「别名」

基础医学系 2026-11-22：/85097 既不是标签与页面标题一致（清单写「教育教学」，页面是「本科生教育教学」），也不是末项路径一致（页面自认 /85146/）。两种问题叠加时，如实记录两条证据，处置结论仍是不开放——不要因为其中一个问题「看起来无害」就放行。

## 把「整站处置完毕」作为收尾标准

计算机学院 cspo 站 2026-11-22：不是「能开的都开了」就算完成，而是 10 个目录路径每一条都有明确结论（开放或别名不一致）。收尾时在 wiki 与目录表里写明「N 栏开放 / M 栏别名不一致」，比只报开放数更能反映真实覆盖。

## 父栏渲染默认子栏，声明地址会指向子栏

经济学院 2026-11-22：/yjssz 与 /dwjl1 都是父栏地址，但页面 div.main-header 的栏目链末项指向子栏（/jdgz_36461、/zxxx_36164）。这类页面标题也跟着变成子栏名。判据仍是「声明的栏目地址 == 请求路径」，不等即别名，记清楚「请求的是父栏、渲染的是子栏」，不要直接开放。

## 老站的面包屑可能藏在 con1rtr 里

控制学院 cse 站 2026-11-22：面包屑不在常见的 col_path / list-top_pos，而在 div.con1rtr[portletmode=simpleColumnPosition] 内一段纯文本「当前位置：…」，需要按文字锚定再取链接。同一站点里 .htm 与 .psp 混用（部分目录 .htm 直接 200、部分 301 到 .psp），必须逐栏记录有效地址。

## 父栏路径要读页面，不要按目录编号猜

机械学院 2026-11-22：六个待补栏目的父栏分别是 djygh（党建与工会）、zcyaq（资产与安全）、yjspy（研究生教育）、6498（学院简介）、6435（实践教学）——混合了语义目录和数字目录，无法从子栏编号推断。逐页读「当前位置」倒数第二项才可靠。

## 清单标签可能等于父栏名

历史学院 2026-11-22：清单把 /65203 记作「学生思政」，但页面标题与面包屑末项都是「风采动态」，父级才叫「学生思政」。即清单标签取的是父栏名而非本栏名。这种情况要同时记录「清单标签 / 页面标题 / 父栏名」三者，校验时用页面标题，不拿清单标签当本栏标题。

## 面包屑可能没有独立父级

研工部 2026-11-22：/31546 的「当前位置」只有「首页 › 奖助事务」两项，父级就是本路径，没有独立父栏可核。这种页面只能做末项路径 + 标题 + 大类名三项校验；把 parentPath 记为 null 并写明原因，比硬凑一个「父栏」可信。

## 同一站可能只有 .psp 有效

地球科学学院 2026-11-22：清单里的 /gsxx/list.htm、/35056/list.htm 全部 301 到同站 .psp，.htm 无任何直接响应。这类站应按 .psp 记录有效地址，并在台账里保留原清单路径，便于回溯。

## 每页条数可能只有 5 条

管理学院 2026-11-22：per_count=5，CMS 声明 1623 条 / 325 页，正好对得上。已收录站点每页条数从 5 到 25 不等；判断「解析是否完整」只能拿本站的 per_count 对照，不能用经验值。其日期格式是 [YYYY/MM/DD]（方括号 + 斜杠），与前几批都不同。

## 一级栏目的面包屑只有一项

电气学院官网 2026-11-22：/jzhd 是一级栏目，面包屑为「首页 › 讲座活动」，去掉首页后只剩本路径。此时「末项路径 == 请求路径」+「文字 == 页面标题」已足够确认身份，不必强求两级。

## 同院一级栏目可直接复用院内解析器

建筑工程学院 2026-11-22：/xsgz 与院内其他栏同模板，只是面包屑只有一项（一级栏目）。复用同一解析器、只调 trail 长度即可，不必为单级面包屑另写分支。

## 处置数为 0 也是有效进展

高分子学系独立站 2026-11-22：唯一待核栏目 /36748 请求的是父栏、渲染的是默认子栏 /36753，结论是「不开放」。这类轮次 `usable` 不增加，但台账里多了一条有证据的处置记录——把每一条待核路径都给出结论，比只统计开放数更接近完成。

## 整栏全是公众号外链也能开放

生命科学学院 2026-11-22：学生活动首屏 10 条全部指向 mp.weixin.qq.com。只要栏目身份（面包屑末项 + 层级）核实无误、条数与 CMS 声明一致，就应正常开放，外链只记地址、不取正文。不要因为「不是站内链接」就判为无效。

## 复用解析器要同时更新两处白名单

生工食品学院 2026-11-22：模板与建筑工程学院一致，可以复用 ccea-li 解析器，但 validateCatalog 里有**两处**需要放开——协议/host 组合的白名单，以及该 parser 自己的 host guard。只改一处会在写入台账时抛「只接受逐条核对的公开 HTTP 栏目」。

## 清单标签与面包屑某一层同名也算线索

环境与资源学院 2026-11-22：清单标签「信息公告」其实是页面渲染出来的子栏名（/cercn/xxgg），请求路径 /cercn/rcpy 在面包屑里叫「招生教育」。可见清单标签可能取自子栏，与路径所属层级不同名——所以不能拿「标签与页面标题一致」当成身份通过的理由，末项路径必须单独核。

## 完成口径要报多类计数

农生学院 2026-11-22 处置后，418 行只剩 2 行 unverified，且是同一条 zdbk 路径（需 StuId 登录）挂了两个清单标签。另有多条属别名不一致、容器页、需认证场景。「未验证清零」不等于「全部开放」：真正的完成口径是每条路径都有明确结论，报告时须同时给出各类计数。

## 完全没有面包屑时的三重页内证据

药学院 2026-11-22：/58875 既无 col_path 也无 weizhi/position。此时不要退回页面标题——标题可能来自模板横幅。可用三项互相独立的页内证据：（1）脚本自报的栏目地址（`var url`），须等于请求路径；（2）顶部横幅的栏目名，须等于页面标题；（3）条目链接里的栏目 ID（`c<ID>a<文章ID>`），须与路径中的 ID 一致。三项同时成立才开放，任一项不足即须另找证据或标为未验证。

## 日期只到月时不要伪造成精确日

人文学院 2026-11-22：/rcpy 的每条只有月粒度日期（形如 2026-10），没有日。归档时按当月 1 日写入以便排序，但必须在 observation 里标 datePrecision 为 month-only，并在 wiki 写明。把月当日子报出去会让「最新一条是哪天」失真。

## 页面有登录入口不等于需要登录

基础医学系办公网 2026-11-22：/85937 页面页头带登录入口，但栏目列表 6 条全部公开返回 200、无需会话。判断是否属「需授权」要看正文是否可取，而不是看页面上有没有登录按钮。把这种误判为 auth-required 会白白丢掉一条通路。

## 认证场景要逐跳记录跳转链

itc / zdbk 2026-11-22：两处都是 301 与 302 交替后才落到登录页（itc 甚至是 https → http → https → CAS 四跳）。只写「需要登录」无法复现；逐跳记录状态码与目标地址，日后持凭据时可直接从最后一跳接续，也能证明我们没有绕过认证。

## 人机校验是边界，不是障碍

person.zju.edu.cn 2026-11-22：入口 302/301 后落到一个只有 iframe 的页面，iframe 指向第三方 WAF（bangruitech）的 asValidate，正文写着「请验证以继续访问」。这类校验与统一身份认证不同——它不认账号，只认「你是不是浏览器」。只读侦察纪律下正确做法是**立刻停止并如实归档为 blocked**：不提交校验、不猜 token、不伪造 UA/cookie、不请求那个第三方域名、也不去缓存或搜索引擎捞快照。把它记成「blocked-by-waf-verification」比记成「需登录」准确，因为处置路径完全不同。

## 404 与 ENOTFOUND 不是一回事，且都不能推出「站点下线」

mapp / net3 / vpn 2026-11-22：mapp 的四个候选路径全部 404（名字能解析、端口有响应、只是没有该路径），net3 与 vpn 直接 getaddrinfo ENOTFOUND（本环境代理无法解析）。两种失败含义不同，都不能当作「站点已下线」的证据。补充观察：本环境把 speedtest/rvpn/webvpn/myvpn 等七个域名全部解析到 198.18.0.0/15（IANA 保留的基准测试网段），说明解析走本地代理网关——**在本环境里 DNS 结果本身不可用于判断站点存活**。遇到这种情况如实记 unreachable-in-this-environment，不猜替代域名、不扫路径字典。

## 学院目录是 JS 数据，不是 DOM 链接

www.zju.edu.cn/xywxw/list.htm 2026-11-22：页面由 sui-app（Webplus）渲染，学院条目写在脚本里的对象数组（`{ id, title, link, children }`），DOM 里一个 `<a>` 都没有——按链接正则解析会得到 0，容易误判成「空页」。这类页面只能按数据结构解析。它同时是**学院主机清单的权威来源**：54 条里含学部与相对路径，筛出 46 个学院 host，可用来发现索引漏项（本轮据此补了 chem/cmm/sociology 三个）。

## 站内搜索可能是别人的搜索

zhfw.zju.edu.cn 2026-11-22：页面里的搜索框 action 指向 `https://s.zju.edu.cn/search/all.do`——本站根本没有自己的搜索后端。顺着 form 的 action 找到真正的入口后，还顺带把索引里误标为 blocked 的 `s.zju.edu.cn` 更正为 done。教训：找「站内搜索」先读 form 的 action，别按 Webplus 的 `/_web/search/*` 猜；猜出来的路径 403/超时往往不是权限问题，是本来就不存在。

## 规模数字要对得上，但口径要先分清

2026-11-22：上游清单给了 418 栏 / 417 路径 / 65 主机 / 392 学院栏 / 56 学院主机 / 44 个系，本地台账逐项复算全部吻合——这是基线无缺项的最好证据。但同时发现「学院目录页 46 主机」与「学院 56 个栏目主机」并存：目录页含学部与无通知栏的学院站，主机多但栏目少。**两个口径都正确，不能互相否证**，报告时要写清各自统计的是什么。

## 有机构权限 ≠ 可以自动检索

www.cnki.net 2026-11-22：`login.cnki.net/TopLogin/api/loginapi/IpLoginFlush` 无凭据即返回 `IsSuccess:true`、`ShowName:"浙江大学图书馆"`——本环境出口 IP 就在浙大机构段内。但同一个库的高级检索入口 `kns8s/AdvSearch` 会 302 到 `/verify/home`（人机安全验证）。两件事要分开记：**权限是有的，访问控制也还在**。拿到会话令牌不等于获得批量检索的许可；按图书馆使用办法，这类站只记「能力存在」，不落地自动化，也不把令牌写进档案。

## 候选占位要么补，要么明确出局

2026-11-22：索引里躺着 55 个 `pending`，全是早期批次留下的第三方工具站/内容平台，既不在上游清单业务范围内，也没有任何磁盘资产。让它们一直 `pending` 有两个害处：完成度虚低、真缺口被淹没。正确做法是分类登记 + 留证据（本轮抽查 6 个站点）+ 一次性标为清单外，而不是逐个建立空目录假装「已探」。特别注意 `sci-hub.ru`：抽查 200 可达，但可达不等于应做，按政策主动排除并写明理由。

## 200 加统一错误码说明路由存在

体育考勤 2026-11-22：`tyys.zju.edu.cn/ptm/api/l/v6/` 下四个端点在无会话时返回 HTTP 200 且 body 是业务错误码 2002「非法的请求参数」。这不是失败——404 才说明路径不存在；200 加业务错误码说明路由在、只是缺会话或参数。归档时要把「路由已确认」与「数据已取到」分开写。

同轮发现一个 TLS 坑：`www.tyys.zju.edu.cn` 是两级子域，而证书只覆盖 `*.zju.edu.cn`，HTTPS 直接报 ERR_TLS_CERT_ALTNAME_INVALID；换单级域 `tyys.zju.edu.cn` 才通。多级子域站点要留意证书层级。

## 无会话时三种「路由存在」的信号，含一种假阳性

2026-11-22 批量核对上游 7 个未记端点，观察到三种「路由存在」的表现，要分清：
1. **401 + JSON 错误体**（学在浙大、PTA exam-draft）：最干净，路由在、缺登录。
2. **200 + 业务错误码**（物理实验 code:400、体育 code:2002）：路由在、缺参数。
3. **302 到登录页**（超星 passport2）：路由在、需账密。

但还有**假阳性**：PTA `problem-status` 返回 HTTP 200 且 content-type 是 text/html，body 是一个完整页面——这不是「接口可用」，而是无考试会话时回落到前端页面。判断标准不能只看状态码，要同时看 content-type 与 body 形态：**JSON 端点回 HTML 就说明没进业务层**。

## 「已有路径记录」可能已经失效

CC98 2026-11-22：旧记录把 `/board/{id}/topic` 标为「已有路径记录」，本轮实测是 **401 `cannot_entry_board`**——该板块对匿名不可进。同一轮里 `/topic/{id}/isfavorite`、`/user/name/{name}`、`/board/{id}/tag-v2` 三条却是**免鉴权可用**的新发现。因此「清单里写有」不能当结论：老记录可能对应旧权限状态或另一个板块，必须逐条实测，且要区分「路径存在」与「匿名可读」。

## 双重 JSON：parse 一次得到的是字符串

汇雅 `www.sslibrary.com/book/search/do` 2026-11-22：响应 content-type 是 text/html，body 却是一个被引号包住的 JSON 字符串；`JSON.parse` 一次拿到的是 string，必须再 parse 一次才是对象。表现是「解析成功但 keys 全是 0,1,2…」——那不是业务字段，是字符串的下标。遇到 keys 是连续数字时先怀疑双重编码。

另记：书目检索可用 ≠ 全文可用。`isBlock`/`isauthorized` 是授权位，`maxpage` 是单查询页码上限；拿到目录不代表可以批量翻页或取正文。

## 参数名就藏在错误信息里

weread 2026-11-22：`/web/mp/content` 无参返回 `{"errCode":400,"errMsg":"reviewId is required"}`——直接把必填参数名告诉了调用方。这比笼统的「未登录」有用得多：不用猜参数、不用穷举。探测时优先看**业务错误码里的 msg**，它常能替代一轮试错。

## 认证基础设施要单列，不能混进业务源

zjuam 2026-11-22：`/cas/login` 是全校 CAS 入口，被 zdbk/courses/classroom/pintia/s1 共同引用。它**不产出任何业务数据**，只发会话——所以索引状态应记 done（结构已摸清），而不是当业务站去「探索功能」。另外它的 `username` 字段同时接受学号/邮箱/别名，这解释了为什么不同站点的登录跳转有时带 `?service=` 有时带账号提示。验证码是硬性人工环节，自动登录属绕过访问控制，不做。

## 整族一致的错误码说明「路由族存在」，但别替它编原因

tyys 场馆 2026-11-22：`/venue-server` 下四个端点全部返回 HTTP 200 + 业务码 400「Bad Request」、都是 46 字节。四个完全一致，可以放心说「整族路由存在，不是个别 404」；但**不能**据此判断是缺登录、缺签名还是缺参数——通用 Bad Request 不携带这个信息。档案里应止步于「待授权会话的业务端点」，把猜测和事实分开写。

## 用路径集合做交叉校验，比逐条肉眼核对可靠

2026-11-22：把上游通知目录 418 条 `` `host/path` `` 全部解析出来，与本地 columns.json 的 host+path 建索引后精确比对，**418/418 命中、0 未匹配**。这是一次性证明「两套清单是同一路径集合」的最快办法——比逐条读表可靠得多。同时也说明：目录里「未找到同路径」这类旧判定只代表**当时的**本地状态，必须按当前台账重算，不能直接引用。

## 定期复核 blocked 结论的时效性

2026-11-22：对 9 个真实 blocked 节点做了一轮复核，抽查 `we.zju.edu.cn`（HTTP 200 / 1604B 跳转页）与 `research.zju.edu.cn`（根路径 301 到匿名壳），均与档案一致。blocked 不是「一次性结论」——环境（DNS、代理、证书）会变，但**结论是否过期必须靠实测判断，不能靠感觉**。复核时优先挑「理由写得不具体」的那几条。

## 公网 DoH 能拆开「不存在」和「本地不可达」，但它自己也会骗人

2026-11-22：用阿里 `223.5.5.5` 的 DoH 作独立解析源，一次性把此前含混的「本环境不可达」拆清楚了——mapp 与 vpn **公网有真实 A 记录**（mapp → CNAME mucp → 210.32.159.211；vpn → 210.32.129.102），说明域名存在、只是本地 DNS 被代理改写为 198.18.0.0/15 保留网段。

但**别把 DoH 当权威**：`speedtest.zju.edu.cn` 和 `s.zju.edu.cn` 在公网 DoH 里都是 NXDOMAIN，本地却实测 200 可访问——浙大域名做了 **split-horizon**，公网视图和校内视图本来就不一样。所以：公网 NXDOMAIN **不能**用来推翻本地实测可达，也不能用来判定站点下线。三件事必须分开记：域名在公网 DNS 是否存在、本地能否解析、HTTP 是否真的通。

## 直连 IP 的实验必须带对照组

2026-11-22：DNS 被代理改写成 198.18.0.x 后，很自然会想「用公网真实 IP + Host 头直连绕过去」。实测 mapp/vpn/sociology 三个 210.32.x.x 全部超时——但**单看这个结果无法判断是站点不通还是链路被禁**。加上对照组（`www.tyys.zju.edu.cn` → `210.32.157.101`，该站经域名实测 HTTP 200）后，对照组同样超时，才能确认是**本地出站链路**的问题。

教训：任何「绕过某层」的尝试，都要配一个明知能通的对照。否则得出的结论只是「这次没成」，不能归因。

## 把一次性复验固化成可复跑脚本

2026-11-22：抽 12 个已开放栏目现网重抓，12/12 通过、条数与台账一致。但真正有价值的不是这一次的结果，而是把过程写成 `sites/zju-notices/spot-check.mjs`——按 host 均匀抽样、复用同一 parsePage、失败非零退出。这样「台账是否仍然有效」随时可验，不必每次临场写脚本。一次性动作要尽量沉淀成工具。

## 审计脚本自己也会错，先怀疑工具再怀疑数据

2026-11-22：一致性审计报「缺失 ledger `_upstream-numbers.md`」，看起来像是 R80 说了写到却没落盘。核实后发现文件**在 `sites/zju-notices/` 下**，是审计脚本把路径当成根目录——**工具 bug，不是数据缺失**。教训：审计报出问题时，先验证问题本身是否真实，别急着「修数据」。另外把 MEMORY 里几条当轮快照（「仍缺结论的 host」）加了过期标注，避免被后续引用当作现状。

## 「还缺」清单要区分「未做」与「有意的未做」

2026-11-22：把上游「还缺的业务读取」18 项逐条对齐，16 项已落到档案、3 项留白。关键是把留白写清理由：zdbk 评教状态是读写同前缀无法静态区分、智云 vlabpassport 已有等价源、实时字幕与回放字幕不是一回事。**「留白」和「遗漏」在验收时长得一样，只有写清理由才能区分。**

## 「待补」清单必须逐项销账，不能只写「已推进」

2026-11-22：MEMORY 里那条「待补：其余通知…」列了 16 个方向。十几轮下来每轮都写「已推进」，但那行字一直没变——看起来像还有 16 件事没做。正确处理是**逐项销账**：把每个方向的最终结论写出来（开放 / 需授权 / 按政策不做），并替换掉原始的待办描述。否则完成度会被自己写的历史文字长期低估。

## 文档之间的交叉引用会悄悄断掉

2026-11-22：`_status-summary.md` 里写着「详见 `sites/zju-notices/_upstream-numbers.md`」，但该文件其实在 `sites/zju-notices/` 下——**阅读时完全看不出这是断链**。这类错误只能靠机器扫描：提取所有反引号包裹的路径、逐个 `existsSync`。已固化为 `scripts/verify-refs.mjs`（141 份文档、38 处引用、0 断链）。交付物越多，引用的正确性越不能靠人眼。

## 「同批接口都 403」不能推广成「这一条也 403」

智云课堂 2026-11-22：`play-template/get-config` 与同批其他接口一起被记为「登录态」，实测却**匿名返回 200 和真实数据**（19 个播放器模块清单）。教训：鉴权结论要**逐端点**验证，尤其当同一前缀下接口混用时。反过来说，单条样本可读也不能推广成「全量可读」——边界要双向写清。

## 留白也分等级：「不知道在哪」和「知道在哪但取不到」

智云实时字幕 2026-11-22：先查了 `get-config`（匿名可读）——`temp_config` 是空对象、无 socket 字段，排除；再直接打 `get-sub-info` 两个候选路径，均 403。于是这项从「未实测」升级为「已定位：来源接口存在且需登录」。

两者差别很大：前者是还没做，后者是**做到底了，结论是取不到**。归档时应当把这种升级写出来——否则「未实测」三个字会和「忘了做」混为一谈。

## 别名不一致要再分一层：父子 vs 悬空

2026-11-22：44 行 `identity-mismatch` 里 3 行的「自认地址」其实就是台账里已开放的另一个行。查子栏行的 `direct.trail` 倒数第二项，正好等于那个父栏路径——**证据链闭合**。

所以判别名之后还要再问一句：末项地址在台账里吗？是不是已经开放了？
- 是 → 父子关系，子栏已有通路，父栏不必单独找权威地址；
- 否 → 悬空别名，确实还有未知。

这两类的后续动作完全不同，混在一起会让「别名不一致」这个分类失去指导意义。

## 「打不开」与「没列入」是两件事

2026-11-22：40 行悬空别名里抽测 10 个目标路径，**8 个返回 200 且带完整条数**，2 个 301（协议升级）。也就是说这些路径**不是坏页，只是上游清单没列**。

此时正确做法是**保持不收录**：418 是上游来源的规模，把这些实测可读的路径塞进去，会破坏 418/417/65 的可核对性。但要在 observation 里记下「实测可读 + 条数」，这样日后若上游扩充清单，可直接取用而不必重测。**「不收录」与「不知道」要区分开。**

## 抽样之后要把样本补全

2026-11-22：R102 每 4 行抽 1（10/40），本轮把剩余 32 个测完。**只有全量测完，「40 行全部非 404」才是结论；抽样只能叫「样本显示」**。抽样阶段的措辞必须留有余地，全量之后才能下断言。

## 「标签与标题不同」多半是层级差，不是错误

2026-11-22：13 处清单标签与页面标题不同，逐条看下来几乎都是**标签取上级栏目名、标题取本级栏目名**（研究生教育→最新通知、国际交流→交流动态、学籍管理→主修专业确认）。第一反应想改标签是错的：标签是上游清单原文，改了就没法和上游逐项核对。正确做法是**两个名字都记**——标签用于对上外部清单，页面标题用于按内容检索。

## 存疑要当天结清，别留给下一轮

2026-11-22：R104 把 `www.cas /caschinese/15911` 标为「可能清单配置错误」留待观察。R105 直接把两个邻居页都打开——15907 是「国际交流 › 交流项目」、15911 是「国际交流 › 本科生」，**并列子栏，根本不是错误**。同时发现该站 HTTPS 443 拒连、只能走 HTTP。

记一条「存疑」的成本很低，但它会一直挂在档案里被后来者反复揣测；**能当轮验掉的就当轮验掉**。另外：判为「配置错误」前，先把相邻路径也打开看一眼。

## 薄页的 endpointCount 应该是 0，不是 1

2026-11-22：`www.cmic` / `ai.zju.edu.cn` / `saa.zju.edu.cn` 三个薄页索引写着 `endpointCount=1`，但目录里**没有 endpoints.json**——薄页按设计就不存端点（解析器在 zju-notices）。这个矛盾在索引检查器里查不出来（它只查 done 节点有没有 wiki/目录，不查 endpointCount 与文件是否对应），只能靠**自己拿 endpointCount 和磁盘比对**才能发现。

顺带：这三个 `listUrl` 此前从未实测，本轮各打一次全部 200——「写在档里」和「验过」是两回事。

## 新增校验必须做负向自测，否则你测的是「什么都没发生」

2026-11-22：给索引检查器补了「声明 endpointCount 就必须有 endpoints.json」的规则，跑真实状态通过——**看起来成了**。做负向注入时才发现：第一次注入的节点本来就有 endpoints.json，不触发分支，检查器返回 0。换到真正缺文件的节点上才报错。

如果只跑正向就收工，这条校验对「最需要防的场景」其实是哑的。**任何新校验都要问：我有没有构造一个必然违规的输入，看它是否真的报错？** 顺便这次负向测试还暴露出 `thinPage` 判据写成 `node.thinPage && node.thinPage.verifiedListUrl !== undefined` 时，`thinPage === true` 会让整条规则失效——同样是负向测试才看得见。

## 负向自测要分清「哪条断言响的」

2026-11-22：给 verify-columns 注入 4 类故障，全都报错——但其中「非法 status」那次的报错**来自另一条通用断言**，而不是它该有的 status 校验。继续追查才发现：`validateCatalog` 只校验 `first-page-verified` 的行，其他 status 值会被静默跳过。加了 status 白名单后重测，才真正精确报错。

所以负向自测不能只看「有没有报错」，还要看**报错来自哪条断言**。碰巧被旁边的断言接住，和真正有保护，是两回事。

## 引用检查漏掉了「裸相对路径」

2026-11-22：`verify-refs.mjs` 的正则只匹配 `` `sites/…` `` 开头的引用，而文档里大量写的是 `` `<子目录>/<文件名>.md` 这样的裸相对路径 `` 这种裸相对路径——**从未被扫描过**。R98 手修的两处断链正是这种写法，当时以为是工具抓到的，其实不是。

扩展扫描后一次报 15 处，逐条核实**全是误报**（仓库代码、外部仓库产物、上游文件、已删除的历史记录）。所以「多报」不一定是发现更多问题，可能只是判据太糙；加排除规则后归零，再做负向自测确认能抓真问题才算完。

另记：负向测试有一次「失败」是测试脚本自己替换错了文件（目标文件里没有该引用），等于没注入。**「没抓到」与「没注入」外观相同，先验证注入是否生效。**

## 抽样工具无法验证特定行，必须能定向

2026-11-22：给 spot-check 做负向注入，退出码 0——不是没报错，是**随机抽样根本没抽到注入的那一行**。抽样工具的通过结果只对样本负责，对特定行无能为力。已加 `--host` / `--path` 两个参数。

定向一跑立刻暴露隐藏问题：15 行的 `direct` 里没有 `scheme`，工具拼出 `undefined://` 直接崩。这些行因为校验器不要求 scheme 而一直静默存在。**想直接补数据也不行**——那些 host 不在 scheme 白名单里，补了校验器就报错。正确做法是让工具容错（https → http 依次尝试），不动数据。

## 同一个缺陷在不同工具里影响面不同

2026-11-22：R110 发现 15 行缺 `direct.scheme`，`spot-check` 拼 URL 时崩了。本轮回头查 `column` 命令——它早已写成「scheme 为空时默认 https」，5 个站点全正常。**同样的数据缺陷，一个有兜底一个没有，结果完全不同**。

所以修完一个缺陷后要问一句：别处也用到这份数据吗？那边有没有兜底？不能假定全坏，也不能假定全好。

另记 CLI 参数解析的教训：位置参数和 `--flag` 混在一个数组里按固定下标取，早晚会错位。把 `--` 开头的单独滤出来，是根治而不是补丁。

## 抽样覆盖率要算清楚，20% 不等于全覆盖

2026-11-22：此前 spot-check 抽 12 个 host 就宣布「12/12 全通」，但那只是 60 个 host 的 20%。本轮把 60 个 host 全跑一遍，仍是 60/60 通过——结论没变，但证据强度完全不同。

注意这里说的是 **host 级覆盖**：每个 host 只验第一个栏目。368 栏全验要 368 次请求，是另一件事。报告时必须写清是哪一级覆盖，否则「全通」会被读成「全部栏目都没问题」。

## 全量复验才是「数字本身可信」的证据

2026-11-22：368 个已开放栏目逐个现网重抓，368/368 通过、零失败，耗时约 14 分钟。

此前「368」是逐轮累积的结果，最新一条可能来自几十轮前；抽样 12 或 60 个 host 都只能说明「样本没问题」。全量跑完之后，「368」这个数字本身才是经过现网确认的。

代价是 14 分钟，所以不该作为默认行为——把它当作**阶段性体检**：交付前、大改后、或隔一段时间跑一次。日常用抽样或定向即可。

## 「解析成功」不等于「内容没变」

2026-11-22：368 栏全量复验虽然 368/368 都能解析，但再比对条数后发现 `zhfw_zdts` 从 10 条变成了 9 条——如果只看「解析成功」，这个漂移永远不会被发现。

判据很关键：该栏 CMS 声明的 `all_count` **同步**从 10 降到 9。如果只有解析条数变而 `all_count` 没变，那才是解析器出了问题。**两个数字一起看，才能区分「站点删了内容」和「我少解析了一条」。**

360 栏可比对，仅 1 处漂移（0.28%），说明台账的记录质量是可靠的。

## 条数不变，内容也会换

2026-11-22：条数比对只能发现「多了/少了」。若有新内容把旧内容挤下去而总数不变，条数比对完全看不出。首条 ID 比对补上了这个盲区——343 栏比对，342 栏一致，唯一变化是 `www.ced` 公示专区新增一条导致首条前移。

三种漂移检测各有边界：
- 能否解析 → 抓不到改版导致的结构失效；
- 条数一致 → 抓不到「等量替换」；
- 首条一致 → 抓不到中间条目的变化。

三层叠加才接近「内容可信」，单靠任何一层都不够。

## 「看起来有」和「实际能用」差得很远

2026-11-22：台账里 315 个栏目都记着 `pages: 58` 这样的分页数，但 `direct.pages` **一栏都没填过**——`column` 取第 2 页永远报「这一页未单独验证」。这个限制一直被我当成「保护机制」，实际上它是**能力从未建立**。

补齐后又发现索引偏移：`pages` 从 0 开始，第 2 页在 `pages[1]`，代码却读 `pages[page]`。修完才对。

验证分页是否真的生效，不能只看「有没有报错」——**要比对不同页的首条 ID**。如果三页返回同一个 firstId，说明始终在读第 1 页，这种 bug 不会报错，极难肉眼发现。

## 「按规律推导 + 抽样验证」会骗你

2026-11-22：分页地址按 `listN` 规律给 315 栏推导，抽样 2 个站点验证通过，看着没问题。全量实测后 **6 栏失败（1.9%）**——比例不高，但足以让「全部可用」失真。

更麻烦的是这 6 个失败原因**互不相同**：站点只走 HTTP、扩展名是 `.psp` 不是 `.htm`、分页后标题/面包屑变化触发身份校验。若只看到「6 个失败」就统一归因，会修错东西。

两条经验：
1. 推导出来的字段，要么全量验，要么在字段里写明「推导未全验」。
2. 失败要逐个看原因，别按同一类处理。

## 先怀疑自己的探测脚本，再怀疑解析器

2026-11-22：查 `www.cps /58875` 第 3 页失败，第一反应是解析器有问题。实际是两个自己的 bug 叠在前面：①硬编码 `gb18030` 解码（该站是 UTF-8），产生「横幅名不一致」的假象；②HTTPS 拒连但脚本默认 https。

真正的原因在第三层：该页有 2 条**微信公众号外链**，解析器的栏目 ID 校验拒绝它们是**正确行为**。

排查顺序应当是：**我的脚本对不对 → 网络/协议对不对 → 页面结构变没变 → 最后才是解析器逻辑**。反过来先怀疑解析器，容易把正确的保护当成缺陷改掉。

## 「分页可用」和「能安全放行」是两件事

2026-11-22：复核 5 个被标为不可分页的栏目。逐字段对照后发现：`all_count`、`all_pages`、`curr_page`、`per_count` **全部正确**，只有 `<title>` 不同（分页页取子栏名）。「尾页」链接也证实 `listN.htm` 规律是对的。

所以分页**技术上确实能用**。但解析器的身份校验用 `<title>` 判「是不是同一栏目」，而 `<title>` 恰恰是最不可靠的依据——为分页放宽它，等于为了便利放弃身份判断。

结论：能用 ≠ 能安全放行。把差异写进诊断字段（哪个字段不一致、哪个字段全对），比单纯标「不支持」有用得多。

## 全门禁要一次跑完，别靠记忆挑

2026-11-22：把四项校验收成 `scripts/verify-all.mjs`。第一次跑就抓到一处假断链——playbook 里举例用的 形如 `<子目录>/<文件名>.md` 的裸相对路径 被当成了真实引用。

这类问题在单项检查里很难被发现，因为它依赖「同时跑多项」才会暴露。记下两点：
- 交付前一次跑完，不要想起来哪个跑哪个；
- 文档里举路径例子时用占位描述（如 `<子目录>/<文件名>.md`），别写成像真路径的样子，否则会被自己的检查器抓。

## 「未做某事」的否定声明也要有证据

2026-11-22：核对上游清单第 4 节的 6 条「未做」声明（未搬验证码、未自动签到、未批量下载……）。这类声明**没有产物可查**，只能反证。做法是：给出扫描模式、在 490 个文件里统计命中数、再逐处打开看上下文。

结果全部成立——命中的「签到」「批量下载」「captcha」全都是**边界声明**或**采集到的论坛原文**，没有一处代码真在做那些事。

如果只写「本库不批量下载」，一年后没人知道是否还成立。**给出扫描方式和命中数，否定性声明才可核查。**

## 对照表产出即开始过期

2026-11-22：R96 的「18 项对照表」写着「3 项留白」，而 R99/R100 早已补掉 2 项——表没跟着改。这类过期**不报错、不显形**，读者无从判断哪句是现状。

已建 `scripts/verify-freshness.mjs` 专门扫这类表述，接入 `verify-all` 成为第 5 道门禁。首次审计 16 处，其中 13 处是引述历史或讲方法论（已排除），**3 处是真问题**（六个站其实早已适配、字幕缺「已定位」这层、措辞不明确）。

规律：**凡是「N 项 X」这种计数型陈述，都要么带时间戳，要么在相关结论变化时同步更新。** 否则它会安静地变成错的。

## 审计价值取决于范围定义

2026-11-22：给时效性审计补范围说明。`sites/` 交付文档要审（它们是当前结论载体）；MEMORY 的 67 条进度行**不审**（历史记录，数字本就该停在当时）；上游清单原文**不审**（参照基线，改了就没法对照）。

三者混在一起时，「过期」这个词就失去意义——历史记录当然「过期」，那正是它的作用。**工具要写明自己审什么、不审什么，以及为什么。**

另补：MEMORY 头部原来没有「怎么读」说明，67 条带计数的进度行容易被误读成现状。已插入表格指明「当前状态看哪几个文件」。

## 字段缺失与「未查」在数据里长得一样

2026-11-22：44 行别名不一致里有 1 行没有 `claimedColumnPath`。看起来像漏查，实际是**它根本没有自认地址**。做了对照才确认：同站已开放栏目 `selectedCount=1`，而该页 `selectedCount=0` 且左侧导航不含它——站点自己都不承认这个栏目。

补齐字段时统一了原则：**跳过的也要写 `skipped` + `reason`**。因为
- 字段不存在 = 未知；
- 字段存在但 skipped = 已知不需要查。

这两者在验收时外观相同，只有写明理由才能区分。

## 非开放状态也要有统一字段

2026-11-22：418 行里 50 行不开放，此前各写各的（note / chain / claimedColumnPath），**没有一个统一字段回答「为什么它不在 368 里」**。补了 `disposedReason`，格式 `<类型>: <说明>`，7 种类型可枚举，并写成 `validateCatalog` 的硬不变式（负向测试已验）。

顺便看到一个有意思的比例：**40/50 是 `aliased-path`，占 80%**。学院站群的主要形态不是「打不开」，而是「清单给的路径 ≠ 页面自认的路径」。这个比例本身值得记。

差别在于：「有 50 行没算进去」 vs 「那 50 行各有明确、可枚举、不可含糊的处置依据」。后者才叫完成。

## 一个计数就能证伪自己的假设

2026-11-22：分析 40 行 `aliased-path` 时，我一度以为语义是「页面自认路径与请求一致，但面包屑不认」。写进档案前做了个统计：`claimedColumnPath === path` 的行数是 **0**——40 行全部是「页面自报**另一个**地址」。假设当场被证伪。

如果没查就写进档案，后来人会基于错误前提做决策。**定性结论写进文档前，找一个能证伪它的计数验一下。**

另外这轮的实质结论：31 个可读别名路径合计 14,310 条内容，但都不是「漏掉」——它们不在上游 418 栏清单范围内，按不扩基线原则保持不收。

## 处置完毕 ≠ 内容全覆盖

2026-11-22：40 行别名里 9 行的栏目其实已通过同 host 另一路径开放（冗余），但 **31 行的目标栏目完全不在 418 行台账内**——它们的内容确实可读（合计 14,310 条），却没被任何台账行覆盖。

这不能含糊过去。正确说法是：「418 行全部有处置结论」+「其中 31 行的目标栏目内容未被台账覆盖，属已知边界」。

「处置完毕」和「全覆盖」是两件事。把边界写清楚比喊完成更诚实，也更有用——后来人知道哪里要继续。

## 先找结构性差异，再逐行验证

2026-11-22：31 行「目标栏目不在台账内」，逐行查会很慢且容易中途放弃。改按 host 分组看扩展名分布——立刻发现两个 host 的已开放栏目**全是 `.psp`**，而清单给的是 `.htm`。一个观察就定位了 7 行（站点改版）。

顺序应该是：先看聚合层面的异常模式（扩展名、状态、host 分布），再对命中的行做逐个验证。反过来一行一行啃，效率低且容易在第 5 行就放弃。

另记：写映射关系时必须标「这是语义推断还是站点声明」。`www.cls.office` 有三个栏目都映射到同一个 `/25820`——说得通，但确实是推断。

## 用「异常子集」定位，而不是逐行筛查

2026-11-22：剩余 24 行没有清晰模式。改按 host 的已开放栏目数排序，发现 3 个 host **已开放数为 0**——覆盖最薄，优先查。其中 2 个证实是「父栏与子栏条目集合逐条相同」（`www.cab` 的父栏页面里直接出现 `c11167a…` 子栏 ID，是硬证据）。

方法上的共同点：R128 靠「扩展名分布」定位站点改版，本轮靠「已开放数为 0」定位薄覆盖。**先找结构上异常的子集，再深挖**，比逐行筛查高效且不易疲劳。

另记一条纪律：`www.cers`/`www.cab` 内容不缺，但身份仍未确认（无 parser 可用、面包屑不匹配）。**「内容存在」和「身份已确认」是两个判断，不能互相推断。**

## 同名是最弱的证据

2026-11-22：找 3 个「同 host 同名栏目」候选想判为已覆盖，逐条比对后**全部证伪**——条目零重叠，CMS 总量还差一个量级（`office.polymer` 1129 vs 9078）。

我此前隐含假设「同 host 同名 = 同一栏目」，数据直接否掉了它。同一个学院站可以有多个都叫「最新通知」的不同栏目。

教训：**同名是最弱的证据**。判定「已覆盖」必须用条目重叠率来验，不能靠标题匹配。本轮若不验就直接判，会得到假进展（31→22→19），而且是错的。

## 基于命名相似性的结论必须尽快用内容验证

2026-11-22：R127 判定「9 行已由同名栏目覆盖」，措辞很肯定。三轮后做条目重叠率复核，**7 行零重叠、总量差一个量级**——全部判错；另 2 行两页都解析出 0 条。未覆盖数从 22 回到 29。

这不是退步，之前那个 22 是假的。同类错误差点再犯：本轮第一反应也是按标题匹配找覆盖候选，还好先做了比对。

纪律：命名相似、路径相似、语义合理都只是**推断**；判定「内容已覆盖」的唯一可靠判据是**条目重叠率**。

## 命名相似性几乎没有预测力（第三次验证）

2026-11-22：对 R128/R129 的「已覆盖」判定做反向审计，结果：

| 轮次 | 判据 | 结果 |
|---|---|---|
| R127 | 栏目名相同 | 9 行中 7 行证伪 |
| R128 | 扩展名全 .psp + 语义对应 | 7 行全部证伪 |
| R130 | 页面标题相同 | 3 行全部证伪 |

**三次都是「命名/语义相似 → 判为已覆盖」，三次全错。** `www.isee` 的「培养方案」33 条与「本科生教学」2642 条零重叠；`www.cls.office` 三个旧路径直接 301。

规律：在这个数据集里，**命名相似性几乎没有预测力**。同站可以有多个同名栏目；改版后新旧命名对应也不可靠。唯一可靠判据是**条目重叠率**——取两页条目 URL 集合算交集。

写台账时的教训：任何「已覆盖」判定，没做条目比对就不能写成结论，只能写「疑似」并标注待验。

## 502 不等于站点挂

2026-11-22：`www.cls.office` 的同一路径，第一次测到 **502**，几分钟后重测变成 **301**，跟到 HTTPS 则 443 拒连。**CDN 边缘节点状态不一致是常态**，单次 5xx 不能作为「站点故障」的证据。

另外一条更重要的：

**「让数字变小」和「让数字变准」是两件事。** R127→R132 六轮里，未覆盖数从 31 一路涨到 38。前几轮数字在降，但降的部分全是未验证推断（同名、迁移语义），R130 之后改成条目重叠率验证，数字就一路上升。

38 才是可靠下界。追求更小的数字而放松判据，是在骗自己。

## 把「无法收录」变成「可检索清单」

2026-11-22：38 行确认「目标栏目不在台账内」之后，如果只把这个结论写在每一行的字段里，它其实**不可用**——想知道「总共有多少内容没纳入、都是什么」，得逐个翻字段。

改成一个导出文件 `_out-of-catalog-targets.md`：按 CMS 总量排序、附 host 分布、取用步骤、以及为什么不能直接并进台账。这样「不收录」就不是一句免责声明，而是**一份可以按需取用的清单**。

原则：**「不做某事」的决定，也要产出可用的东西**，否则它只是把问题挂起来。

## 「能抓」和「能解析」之间隔着身份校验

2026-11-22：29 个清单外地址全部 HTTP 200、页面有 1–18 条可见条目（合计 368 条），但用同 host 解析器全部失败——25 行面包屑链路不匹配、4 行路径与标题不匹配。

这说明身份校验不是摆设：它拦下的不是坏页，而是**无法证明「这就是它声称的那个栏目」的页面**。台账的判据是「页面自己承认这个路径就是本栏目」，不是「页面有内容」。

所以「可读」「内容未覆盖」「无法安全入库」三个结论可以同时成立。三者都确认之后，「不收录」才是判断，而不是推脱。

## 借用配置去测另一个对象，测出的是配置的不匹配

2026-11-22：R134 用「兄弟行的 parser」测 29 个目标页，全部失败，写成结论「不可解析」。复查发现：这些 parser 的校验是拿**页面面包屑**比 **`r.direct.trail`（台账里这一行自己的记录）**。借来的是另一行的 trail，当然对不上。

实测目标页面包屑末项就是自身路径（`/21061/`、`/94007/`、`/29529/`），它们本身没问题。

R126 已经犯过一次同样的错，R134 又犯并写成了正式结论。教训：**判断某方法是否适用前，确认它的输入是不是它本来就该收到的那些。**

更正后第三条结论没变（不收录），但理由从「技术不可行」改为「口径决定不建基线条目」——这两者区别很大，不能混。

## 更正一个结论，要顺着它的引用链改下去

2026-11-22：R135 更正了「29 行不可解析」这个结论，但只改了 `columns.json` 的 `parserAttempt` 字段。R136 回头查才发现：
- `_out-of-catalog-parseability.md` 整篇仍以错误结论为核心；
- 29 行的 `caution` 字段还在引用 R126 的错误归因。

一个结论会散落在：正文文档、结构化字段、派生清单、playbook 引用。**改一处不算更正，要顺着引用链改完。**

做法：更正后立刻 grep 关键词（本例是「不可解析」「0 / 29」「解析器拒绝」），逐个确认。

## 「页面报错」和「请求方式错」长得一样

2026-11-22：连续三轮出现同一类假失败：

| 轮次 | 假失败原因 |
|---|---|
| R118 | 硬编码 `gb18030`（该站 UTF-8） |
| R132 | 先测 502、再测 301 |
| R137 | 硬编码 `http://`（该站要 HTTPS，HTTP 会 301） |

三次报错都像「页面结构不对」，实际都是我的请求方式不对。区分方法：**先看该站已开放行用什么 scheme / 编码 / parser，照抄。**

R137 尤其典型：`zjutw` 那 8 行本身没有 `scheme` 字段（这正是它们「证据弱」的原因），脚本于是用默认值——而默认值对这个站是错的。**缺字段的代价，是要在每个调用方各自猜。**

## 同一份缺失数据，三种默认策略

2026-11-22：15 行缺 `scheme` 字段。查下来发现各调用方的应对各不相同：

| 调用方 | 缺失时行为 |
|---|---|
| `crawler-columns.mjs` | `scheme ?? 'https'` |
| `spot-check.mjs` | `https → http` 依次试 |
| 临时脚本 | 硬编码 `http://`（R137 翻车） |

**同一份数据，三种默认策略。** 只要有人写第四个脚本，就可能再翻一次车。

修法不是「统一默认值」，而是让**数据层保证有据可查**：加不变式——每个可运行行必须有 `scheme` 或 `schemeProbe`。这样调用方不再需要猜。

## 补字段前先问「缺了会不会出问题」

2026-11-22：审计可运行行的字段完整性，发现 16 行缺 `displayTitle`。没有直接补——先查这 16 行的 parser 是否强制校验它。结果：51 个 parser 要求该字段，而这 16 行所属的 5 个 parser（`bksy-li`/`grs-li`/`youth-div`/`zhfw-li`/`libweb-news`）**无一在列**。

所以缺失不影响功能，但仍补齐了——因为它属于「这一栏叫什么」的唯一记录，缺了调用方只能退回不可靠的 `<title>`。

顺序是：**先判影响面，再决定补不补、补多急**。看到缺失就一股脑补，容易把精力花在不影响的地方；只补影响功能的，又会积累结构性缺口。

## 条数变少时，要分「删末尾」还是「删开头」

2026-11-22：`zhfw_zdts` 第二次减量（10→9→8）。只看条数会不知道发生了什么。加上首条 ID 就能区分：

| 情况 | 首条 ID |
|---|---|
| 删末尾 | **不变** |
| 删开头 | 变成第二条的 ID |

实测首条仍为 `3229711`，与台账一致——删的是末尾。**一个字段就能定性。**

另记：大改数据结构后必须跑全量回归。R137–R139 动了 39 行、加了 3 条硬校验，本轮 368/368 通过才算确认没改坏。

## 变化速率和内容分布是两个不同的维度

2026-11-22：用 R113 的全量快照与今日逐行比对——368 栏里**只有 1 栏变了 1 条，零栏增加**。变化速率极低。

但同时统计出分布高度集中：**42 栏（11%）承载 72% 的内容量**，最大单栏 63,990 条、最小 2 条，差四个数量级。

两个数字合起来才有指导意义：变化慢意味着不必频繁全量体检；分布集中意味着如果要做加权抽样，那 42 个大栏目代表的是一大半内容。但**不能因此少验**——小栏目失效也是失效，只是知道该往哪看。

## 覆盖率必须写出来，否则会被误读

2026-11-22：算了一下——368 栏首屏合计 5,396 条，CMS 总量 245,925 条，**覆盖率 2.19%**。

这个数字不写出来，会有两种误读：
- 「368 栏已验证」被当成「内容都在本地」；
- 「覆盖率太低，台账没用」。

都不对。台账是**通路与结构台账**，不是**内容仓库**。它保证的是「这一栏能读、结构对、身份确认」，这是抓全量的前提。

另一个发现：覆盖率随栏目规模急剧下降——≤100 条的栏目覆盖 36%，而 >10000 条的 3 个栏目只用 68 条代表 92,263 条（0.1%）。因为首屏永远是 20–25 条。

**指标要看分母。** 「368」和「245,925」是同一件事的两个面。

## 分页深度不等于覆盖率

2026-11-22：把分页从 3 页扩到 10 页，覆盖率 5.87% → 15.48%。但要说清：**15.48% 依然只是「抽样更深」，不是「把内容抓下来」**。超大栏目（`zhfw_jsgx` 63,990 条 / 2,667 页）再多 7 页也只到 0.4%。

两个概念不能混：
- **分页深度** = 单个栏目能看多深；
- **覆盖率** = 相对全库实际看了多少。

另外踩了个坑：`select()` 用的是 `r.path`（清单原路径）而非 `r.direct.path`（实际路径）。`www.isee` 清单给 `.htm`、实际跑 `.psp`，传错路径会报「未列入已验证通路」——看起来像分页坏了，实际是参数不对。

## 验分页要验最深页，还要验 curr_page

2026-11-22：全量验证 257 栏的 10 页扩展。**必须验最深页**——如果站点在某页之后换命名，抽样前几页发现不了。结果 255/257。

更关键的一步：光看「200 且能解析」不够，万一服务器对任何 `listN` 都返回第 1 页呢？所以额外比对 CMS 自己声明的 `curr_page`——**255/255 全部等于请求页码**，这才证明地址真的指向第 N 页。

两次推导-验证（R117 扩 3 页 1.9% 例外、R145 扩 10 页 0.8% 例外）说明：例外的比例不高，但足以让「全部可用」变成假话。**推导出来的东西，抽样只是安慰。**

## 报数要报能兑现的那个

2026-11-22：R144 给覆盖率 15.48%，但那是「每栏都能翻 10 页」的理论值。按各栏实际可达深度重算，实测 **15.23%**（差 600 条 / 0.25 个百分点，全部来自 6 个栏）。

差别不大，但方向重要：**对外该报 15.23%**，理论值只在讨论「如果都能翻 10 页」时成立。

而且那 6 栏不分页是有理由的（分页页 `<title>` 不可靠、301 后身份不一致）——不能为了数字好看去放宽身份校验。**模型的乐观不能盖过实测的结果。**

## 多个数字并存时，必须声明口径

2026-11-22：库里同时用 418（清单）、368（可用）、50（未开放）、245,925（内容量）、37,462（实际获取）。此前 11 份文档直接用比值却没说是哪个分母，读者很容易把「368/418」当成完成度，或把「368 栏」当成内容都拿到了。

补了 `_denominator-guide.md` 统一说明，并加门禁：**含比值的文档必须声明口径**。

规律：**同一体系里数字超过三个，就一定会有人混读。** 与其每次都口头解释，不如写一份口径表并让机器检查引用。

## 抄了一份数据到别处，就要有检查保证副本跟随源

2026-11-22：把 418/368/50 等权威数字写进 `_index.json` 的 meta，方便程序读取。但这立刻引入风险：**索引成了第二份真相**，台账一改就不同步。

同时加了 `verify-meta-numbers.mjs`，把 meta 声明的 6 个数字与台账实时重算值逐一比对，不一致即失败（负向测试已验）。

这个模式本项目已经出现过四次：`verify-freshness`（过期表述）、`verify-corrections`（作废说法）、`verify-denominators`（口径未声明）、`verify-meta-numbers`（声明数字漂移）。

**凡是「抄了一份数据到别处」，就要有检查保证副本跟随源。** 否则副本迟早变成独立真相。

## 负向测试要看「是否命中」，不能只看退出码

2026-11-22：给 meta 数字门禁补两项校验，跑负向测试时 `coverageRatio` 篡改「没被抓到」。查下来是我写了个 `let bad` 声明在使用之后的 bug，脚本直接崩了、退出码 1——**被我误读成「抓到了」**。

看输出里有没有 `❌ coverageRatio` 那行，才发现是崩溃。

教训：**脚本崩溃也是非 0 退出。** 验证负向测试是否有效，必须检查输出里有没有那条具体的错误信息。

另一条：门禁要覆盖**全部**声明数字。这次漏了 `itemsRetrieved`/`coverageRatio`，因为它们是「需要计算」的，而那 6 项是「数一下就有」的——**图省事跳过了要算的，恰恰是最该自动校验的**。

## 「有门禁」和「门禁会拦住」是两件事

2026-11-22：`verify-freshness` 一直报告「未标注的过期表述 1 处」，但退出码始终是 0——因为它只在 `--strict` 下才设 exitCode，而 `verify-all` 从没传过这个参数。**这个门禁加入后 28 轮，一次都没失败过。**

修复后严格模式一开，立刻暴露出那处问题。

检查门禁是否有效的三条：
1. **单独跑一次**——只看 `verify-all` 的「✅通过」看不出门禁是否哑了；
2. **退出码是否与报告的问题数一致**，而不只是「非零」；
3. **有没有崩溃堆栈**——崩溃也是非零，会伪装成「抓到了」（R149 踩的）。

门禁也会坏，而且坏的时候看起来和好的时候一样。

## 让「门禁是否会失败」本身变成门禁

2026-11-22：R149 发现崩溃被误读成命中，R150 发现有个门禁 28 轮从未失败。修完之后的新问题是：**怎么知道其他门禁不是同样的问题？**

静态检查失败机制（`process.exit` / `exitCode` / `assert`）不够——那只能证明「代码看起来会失败」。改成实测：对每个门禁注入一次必然违规的状态，要求三条同时满足：

1. **退出码非零**（排除「从不失败」）；
2. **输出含具体错误信息**（能定位）；
3. **不是崩溃堆栈**（排除 R149 那类假命中）。

然后把这个检查本身接入 `verify-all` 作为第 9 道门禁。

**前两轮都是「发现问题、修好」；这轮是「让这类问题以后不可能悄悄发生」。**

## 清单本身也可能写了「排除」

2026-11-22：核对上游 19 个模块时，「微信聊天/钉钉聊天」在索引里找不到节点。差点当成遗漏，翻清单原文发现第 78 行明确写着「没有把……本机客户端私密数据读取视为应搬入 YONKIK 的候选」。

**上游自己就排除了它。** 不建节点正是遵循清单口径。

教训：核对「有没有漏做」时，要先确认**清单是否已经排除了这一项**。否则会把「按规则不做」误判成「遗漏」，再花时间去补一个不该做的东西。

## 「上游跳过」不等于「本地也该跳过」

2026-11-22：核对通知目录的「上游明确跳过」2 站。医学院 www.cmm.zju.edu.cn 上游跳过（读不出可用通知栏），但本地实测**可访问、首页 91 个栏目**，记为 done 是恰当的。

两者目标不同：
- 上游问「有可用的通知栏吗」——没有就跳过；
- 本地问「站点结构与规模清楚吗」——清楚就 done。

另一个发现：sociology 的 blockedReason 只写「本环境不可达」，容易被读成「域名不存在」；而 R92 的 DoH 已证公网有真实 A 记录。**「不可达」必须写清是本地网络问题还是站点下线。**

## 「不可达」不是一个原因，是一个待拆解的观察

2026-11-22：vpn / net3 / mapp 三站的 blocked 理由共用一个表述「404 或 DNS 无法解析」。实测后三者完全不同：

| 站 | 本地症状 | 公网 DoH | 性质 |
|---|---|---|---|
| vpn | ENOTFOUND | A 记录 210.32.129.102 | DNS 被劫持 |
| net3 | ENOTFOUND | NXDOMAIN | split-horizon 不可判 |
| mapp | 四路径 404 | A 记录 → 210.32.159.211 | 服务器活着，路径不存在 |

**404 和 DNS 失败是两件完全不同的事**：前者说明服务器有响应，后者说明根本没连上。混写等于没记录。

「不可达」至少要拆成四类：DNS 失败 / TCP 失败 / 服务器返回 4xx-5xx / 需登录。四种情况后续动作完全不同。

## 描述让人读懂，分类让人统计

2026-11-22：R154 把「不可达」拆成四类，但 9 个 blocked 节点的理由仍然只是一段描述，没有归入任何一类。补上 `blockedCategory` + `blockedSubtype` 后，立刻能看出分布：**9 个里没有一个是真的「站点挂了」**——授权类 4/9、DNS 类 3/9（其中 2 个公网明明有 A 记录）、其余是 HTTP 错误与 TCP 超时。

这组分布本身就是结论：本项目的 blocked 绝大多数不是能力问题，是授权或环境问题。**光有描述得不出这个结论。**

写进门禁：每个 blocked 节点必须有枚举内的分类和子类型。

## 信息在一个地方有，在另一个地方没有

2026-11-22：55 个清单外候选在索引里**共用同一句理由**「清单外候选，未建立资产」。但 `_candidates-out-of-scope.json` 里其实早就分好了 6 组（online-tool 23、third-party-community 17、scholarly-database 8…）。

**分类依据早就存在，只是没回写到被读取的位置。** 读索引的人只看得到那句统一理由，于是以为这 55 个都是同一性质——实际其中只有 1 个（sci-hub.ru）是政策排除，其余只是不在范围。

修法不是重新分析，而是把已有结论**回写到消费侧**，再用门禁保证不再丢失。这和前几轮「结论散落在多处、只改一处不算更正」是同一类问题。

## 一半有、一半没有的字段，是「后来没补」不是「不需要」

2026-11-22：done 节点里 54 个有 `type`、69 个没有。如果这个字段没用，不会有一半人填；如果必填，不会有一半空着。**真实原因是早期填了、后来没补。**

补齐后分布很有信息量：学院/部处官网 64（52%）、业务系统 24、行政门户 10、基础设施 6。其中「基础设施 6 个」解释了一件事——`zjuam` 为什么记 done 却没有业务数据：它的定位本就是基础设施。

补的时候区分了「显式映射」与「从 label 推导」，后者标 `typeSource: inferred-from-label`，不冒充人工判断。

## 同一字段两种形状，比缺字段更隐蔽

2026-11-22：profile.facets 里 55 个节点是对象数组（含 covers/confidence/evidence），92 个是纯字符串数组。**每个节点「都有」这个字段**，所以字段检查会通过——但数据结构对不上，程序无法统一读取（想统计「高置信度能力」时，那 92 个根本没有 confidence）。

原因是对象形状后来才引入，历史数据没回改。归一化时**没有伪造置信度**：字符串标签转成对象后 confidence 设 0 并注明「未验证」，另记 facetsOriginalShape 便于追溯。

区别在于：补字段是加数据，统一形状是**改数据结构**，后者必须保留追溯信息。

## 统计脚本的呈现方式也会误导判断

2026-11-22：扫字段形状时看到 `requires` 有「35 个字符串数组 + 88 个 array」，以为又是 R158 那种两种形状问题。深查发现那 88 个是**空数组**——形状完全一致。

原因是我第一版脚本把 `array` 和 `array[string]` 分开计数，自己看错了。**统计结果的第一层呈现未必是真相，下钻一层再判断。**

另外加了一条门禁：不只查 label 是否存在，还查它**是否形如 host**——填成 host 能通过字段检查，但对人毫无意义。**字段存在 ≠ 字段有意义。**

## 套话的本质不是「短」，是「多个节点说同一句」

2026-11-22：R159 补的 54 条 summary 全是同一模板（只换站名和分类）。改写时先写了个校验器判「无解释性内容」，结果**误报 79 个**——包括技术细节丰富的 summary，因为它们不含「因为/由于」这类因果词。

改进判据后准确了：实质内容可以是因果解释，也可以是**具体技术细节**（路径、数字、协议名）。而套话的判据不该是「短」，而是**同一段 body 出现在 ≥3 个节点上且不含技术细节**。

四轮走了四个层次：R157 字段存在吗 → R158 形状一致吗 → R159 字段有意义吗 → R160 内容有意义吗。

## 校验器判据：先写候选，人工看一遍，再收紧

2026-11-22：检查 facet covers 质量时，第一版判据误报 72 个——把「公告正文」「个人主页」这类合格描述也标记了。收窄到「无中文 + 短 + kebab-case」后精确命中 30 个真实问题。

这已是连续第二轮同类问题（R160 也曾误报 79 个）。共同点：**一开始就想用一个正则把所有情况覆盖**。

更稳的顺序是：先跑一个宽松判据得到候选集，人工扫一遍，看清真正的问题长什么样，再收紧正则。**判据是从数据里长出来的，不是凭空写的。**

## 「把失败原因当能力」是一种隐蔽的数据污染

2026-11-22：facets 里有 209 个 confidence=0 的条目，其中 118 个属于 blocked / 清单外节点——内容是「本环境不可达」「被 WAF 拦截」「清单外候选」。

**这些是状态标签，不是能力。** 把它们放在 facets（能力列表）里，等于把「做不到」写成了「能做什么」。而且同样的信息已在 blockedCategory 与 summary 里，属重复。

清空后逐个验证：63 个节点的分类、理由、summary 全部完好——**信息没有丢，只是从错误的位置移到了正确的位置**。

另一类（done 节点的 91 条）是粗标签（「医学院」「公开 HTTP」），用 summary 重建为实质能力描述，confidence 设 1（有建档但无逐端点实测）。

现在 confidence 只有 1 与 2 两档，都反映真实验证强度。

## 修一个问题会引入新问题，改完要回头看副作用

2026-11-23：R162 为清掉 209 个 confidence=0，把 31 个 done 节点的多条 facets **合并成一条长句**。伪能力是清掉了，但**信息结构退化了**——`courses` 有 6 条清晰能力，而重建后的 `cnki` 只有一条揉在一起的段落。

本轮按分号边界把 21 个重新拆开。剩下的 54 个单 facet 节点逐个确认合理（47 个是学院站，本质只有通知列表一项能力）。

顺带抓到一个真矛盾：`zju-ebook` 的 facet 里 covers 写「未本机验证」，evidence 却写「本机证实 302」，而实际已本机实测（status 200）。已重写。

规律：**深度清理时，每一轮的改动都要在下一轮接受检查。** 前六轮查的是数据，这一轮查的是前六轮自己做的事。

## 元数据本身也会不一致

2026-11-23：R157–R163 七轮改动在索引里留下 12 个来源标记（typeSource、facetsMovedTo 等）。这些标记是好设计——记录「这个值是哪里来的」——但标记多了以后，**标记与数据之间也会不一致**。

检查发现 1 处：research.zju.edu.cn 是 blocked 却仍有 facets。查证后**这是对的**，因为它记录的是实测结论（两接口均 301），不是伪能力。问题在我的规则——R162 把「blocked 不该有 facets」当成硬规则，但那规则是为清伪能力设的，不该一刀切。判断依据应是**有没有实测证据**，而非节点状态。

另记：写负向测试时第一版规则漏了 typeSource==explicit 的情况，删 type 不会被抓到。**规则要覆盖所有取值，不能只覆盖自己想到的那一种。**

## 索引说 done，磁盘上真的有东西吗

2026-11-23：前八轮查的都是索引内部字段（类型/摘要/能力/置信度），都是「描述」。本轮查描述与实际资产是否对应——123 个 done 节点里，1 个缺 site.json（www.zju.edu.cn，其余文件都在）。

两类漂移的严重度不同：索引字段写得含糊只是影响可读性；**索引说 done 但磁盘没资产，是索引在骗人**。后者才是真正的漂移，值得单独设门禁。

补 site.json 时顺手记下该节点的真实价值——它不是普通业务站，而是提供「学院目录权威映射」的核对依据。**补齐资产时顺便把「这个节点为什么存在」写进档案**，比只填模板有用。

## 一个状态值承载两种语义，迟早会混

2026-11-23：索引里 `status: blocked` 同时表示两类完全不同的东西——55 个清单外候选（没做）和 9 个真实受阻（做了、进不去）。前者无目录无证据，后者有目录有 blockedCategory。**混在同一状态值里，读的人分不清「没做」和「做不通」。**

加一个正交的 `dispositionKind`（built / out-of-scope-candidate / blocked-with-evidence）后立刻清晰，且可以用门禁校验「语义与资产是否匹配」。

另一条：查漂移不能只查一个方向。R165 查「索引有但磁盘没有」，本轮查「磁盘有但索引没记」——孤儿目录。**反向漂移同样会让索引失真。**

还有个自省：孤儿目录检查最初用 `!d.startsWith('_')` 排除内部目录，结果注入的 `_ghost-probe` 也被排除了。**排除规则写得宽，等于给自己留了后门。**改为只排除已知内部目录才生效。

## 描述「现在如何」的数字要变，描述「当时如何」的不该变

2026-11-23：R145 把有分页的栏目从 311 改成 310，但三份文档还写着 311。逐份看语境才判得准：

- `_coverage-ratio.md`「有 direct.pages 的栏目 311/368」是**当前状态断言** → 该改；
- `_pagination-full-verify.md`「311 栏保留 direct.pages」是**R117 的处置记录** → 不该改。

**改错方向同样有害**：把历史记录改成当前值等于篡改历史。所以门禁要带「历史语境白名单」，而不是无差别扫描。

还有个实现细节：注入测试第一次没抓到，因为我在同一行加了「R145 后 311 → 310」的注记，正则先匹配到了那句话里的 311。**文档里同时有当前值和历史值时，正则必须锚定语境（表格单元格），不能只认数字。**

## 「含正确值才检查」在值出错时必然失效

2026-11-23：给派生数字门禁加「内容量数字」校验时，第一版写成：

```js
if (doc.includes('245,925') && actual !== 245925) { 报错 }
```

意思是「文档里出现了这个正确值，才去比对台账」。结果注入测试立刻打脸：把文档改成 `245,000` 后，`includes` 变 false，**整个检查被跳过、门禁报通过**——恰好在最该报错的时候失效。

改为白名单式：文档里出现的**每个**千分位数字都必须在可核实真值集合内（真值由台账现算，加上分层统计、明确标注的估算、表格边界值）。

教训：**检查的触发条件不该依赖被检查的值本身。** 门禁写完必须跑一次「故意改错能否被抓」的验证，否则不知道它是真检查还是摆设。

## 门禁的负向验证要覆盖到每一个

2026-11-23：`verify-gates-effective` 只对 4 个门禁做负向验证，而门禁总数 22 个——**大部分门禁「会不会失败」从没被验证过**。前面三轮已经反复踩过这个坑（R149 崩溃被当命中、R150 有个门禁 28 轮从不失败、R168 检查逻辑在值出错时被跳过），三次都是「以为有保护，实际没有」。

本轮把负向验证扩到 14 个门禁，每个注入一次必然违规状态，要求三条同时满足：非零退出、输出含具体位置、无崩溃堆栈。14/14 全部命中。加上 R151 的 4 个，实际覆盖 18/22，未覆盖的 4 个都有明确理由（自测门禁、编排器、R168 刚深度验过的）。

另一个要注意的点：**负向测试会改真实的 `_index.json`**。如果 finally 块写错，测试本身就成了破坏源。所以注入后必须还原，并再跑几个关键门禁证明还原成功。

## 统计口径出错会让「已验证」变成空话

2026-11-23：R169 声称负向验证覆盖 18/22，但那是我**推断**的——正则只匹配到 14 条，剩下 4 个我以为「R151 加过，应该还在」。实际重写脚本时它们被丢掉了，真实覆盖是 14。

补回 4 个文档类门禁（改 Markdown 而非 JSON，为此加了 `mdPatch` 机制）后达到 18/18。

更重要的改动：**让覆盖率本身受检**。脚本末尾检查每个 `verify-*.mjs` 要么被负向验证覆盖、要么在豁免名单里并写明理由，否则直接失败。造一个 `verify-zzz-probe.mjs` 验证过，确实会被拦下。

这样「新增门禁忘了写负向验证」这件事，以后会被自动发现，不需要靠人记得。

## 清单正文之外还有内容

2026-11-23：上游清单四节早就逐项核对过（模块 / 业务读取 / 通知栏目 / 证据排除）。本轮回头扫正文，发现第 35 行有一句「工具边界」——列出插件注册的 **11 个助手工具**——它**不在任何一节里**，四节核对都覆盖不到。

逐项核对后：3 个是本地产物（profile / note / context，不涉及上游）、2 个是上游组合（课表 / 通知，依赖的站都已 done）、1 个部分覆盖（读邮件：入口记了，内部接口按纪律不探）、2 个只读纪律排除、2 个清单自身排除、1 个分派入口。

**「按章核对」容易漏掉章节之间的说明性文字。** 核对完后要回头扫一遍全文，尤其是不成节的那几句。

顺带一个观察：11 个工具里 3 个是本地产物，这解释了为什么「165 个公开命令」不能当 165 个只读 API——里面本来就混着大量本地能力。

## 清单记的是「当时的差集」，不是「当前的差集」

2026-11-23：逐行扫清单说明文字，核对第 64–65 行那份**具体缺口清单**——上游当时列出「学工部缺 4 栏」「研工部未见 31546」「本科生院两栏未做」等。逐条查台账，**全部已补齐**：学工部 5 栏全在、研工部 31546 在、本科生院两栏在、综合服务网 3 栏已验证、图书馆 2 栏已升级，合计 23 栏全部 first-page-verified。

关键是这个区分：清单写的是**上游在基线时刻看到的差集**，不是**当前的差集**。两种误读都错：
- 「清单说缺 5 处，所以现在还缺」——错，已补齐；
- 「清单过时了不用看」——也错，它是当时的精确记录，且正是补漏的依据。

所以要补一条记录说明「这份缺口清单已全部落实」，否则读者会一直以为还缺。

另一处：第 33 行的 `huggingface.co` 在清单里指「资源安装（ASR 模型）」，在 `_platforms-report` 里指「RVPN 可达下游站点」——**同一域名两处提及讲的是不同的事**，容易误判成重复或缺漏。

## 「讲方法」不等于「不可验证」

2026-11-23：R172 把清单第 66–68 行标成「方法说明，非可验证断言」，理由是它们看起来在讲方法论。本轮逐行看，**这个判断错了**：

| 行 | 表面看是 | 实际含 |
|---|---|---|
| 66 | 讲 Webplus 路径规则 | 三个具体路径模式，可逐一核对 |
| 67 | 讲产品能力差异 | 四项具体能力，可逐项确认 |
| 68 | 讲只读边界 | **两个具体端点 + 一个副作用**，可查证 |

第 68 行因此抓到一个**真缺口**：清单说 `xwgl_ckXw.html?doType=save` 会标已读，而本地 `sites/zdbk.zju.edu.cn/endpoints.json` 里根本没有这个端点，也没记录「标已读」这个写副作用。已补入 `policyExcluded`。

教训：**只要一句话里有具体的端点、路径或能力名，它就是可验证的。** 判断「是否可验证」要看有没有具体名词，不看行文语气。

另一条：本库记录了「哪些端点能读」，但此前没系统记录「某个端点会写入副作用」。这类**副作用记录**比端点本身更重要——调用它就不是只读了。

## 用整串 JSON 正则判断「字段是否存在」，会被残留字符串骗过

2026-11-23：写「端点写副作用」门禁时，第一版用整串 JSON 正则判断站点是否有只读说明。负向测试时我只删了 policyExcluded 数组，却留了 policyExcludedReason 字符串——正则照样命中，门禁放行。

改为**结构化判定**（检查 Array.isArray + length，或字段类型），重扫后立刻多暴露 4 个此前被宽松正则放过的站点。

规律：**判断字段是否真的存在要看结构，不要看序列化后的字符串。**

另一条：门禁只查「被记录为可用的端点」会漏掉「本来就该被排除的端点」。两类都要查——前者查有没有越界，后者查排除理由是否写清。

## 「只记数量不记去向」是半个记录

2026-11-23：台账里 141 个栏目记了 externalLinks 计数（共 581 条），但只有 2 个说明外链去哪。读者只能知道「有几个外链」，无法判断安全性与可读性。

实测抽样 12 个，发现两类：mp.weixin.qq.com 公众号文章（主要），以及 http://10.203.3.207:8080 这类**内网 IP**——记成「外链」但校外根本打不开。另有 7 个栏目计数非零但实测可解析外链为 0（计数来自候选条目）。

补齐时**不假装**：5 个已核实域名的写明分布，129 个没核实的明说「仅计数未核实」。

顺带：加入负向验证后门禁立刻崩了（读未定义字段）。**正是 R149 的教训——崩溃也是非零退出，会被误判成「抓到了」。** 不是门禁有效性自测区分了 crashed=true，这个 bug 会一直藏着。

## 「补说明」和「核实数字」是两件事

2026-11-23：R175 发现 141 个栏目只记了 externalLinks 数量、没记去向，于是补了说明。本轮挑外链最多的 15 个去核实，**发现那个数量本身就是错的**——7 个栏目记录 10-17 条，实测全是 0；15 个合计记录 198、实测 81。

查遍所有脚本，**没有任何代码生成这个字段**。它是口径不明、来源不明、与实测不符的计数。

教训：只补说明不核实数字，会把错数字包装得更像真的。**说明是给数字加注，不是替代对数字的验证。**

门禁因此加强：每个 externalLinks 必须有 externalLinkScope（domain-verified 或 count-only-not-domain-verified），不能再有来源不明的计数。

另外顺带发现外链类型不止「公众号 + 内网」两种——`www.ced` 的是 edm.eduwest.com 邮件营销平台。**小样本概括容易漏掉例外。**

## 代码溯源只能回答「它从哪来」，回答不了「它对不对」

2026-11-23：R176 发现 externalLinks 字段没有任何生成代码、实测严重不符，判定为坏字段。本轮顺手查其他同类字段时，差点把这个结论泛化。

实测 firstDate（出现 350 次，同样不在解析器里）：连续 6 个全对、分散 10 个中 9 个对，**15/16 准确**。唯一不一致的是站点新增内容导致日期前移，属正常漂移。

两个字段都不在代码里，一个错一个对。说明：**「无生成代码」只能说明无法溯源，不能说明数据错。** 有些是历史人工填的，填得很准。

正确推理链应该是：无生成脚本 → 来源不明 → **抽样实测** → 才知道可不可信。R176 跳过了最后一步就下了结论，本轮补上。

教训：**审计字段可信度，唯一依据是实测。** 代码溯源回答的是「它从哪来」，回答不了「它对不对」。

## 「每页多少条」要听 CMS 的，不是听解析器数出几条

2026-11-23：规模字段自洽检查报了 1 处矛盾——gs.zju.edu.cn/34774 的 count=19、pages=75、total=1495，19×75=1425 差 70 条。

直接读页面 HTML 的 CMS 字段才发现：**per_count=20**（不是 19），1495÷20=74.75→75 页，与 all_pages 完全吻合。所以矛盾出在 count——首屏首条被置顶或特殊排版，少解析了 1 条。查该站其他 11 个栏目 count 都是 20，佐证是页面特性。

门禁因此改用 cmsPerCount 优先。规律：**解析器数出的条数会受置顶、特殊排版、外部链接影响；「每页多少条」这种页面属性应该以 CMS 自报为准。**

另一个细节：我本想实测第 75 页，结果被解析器的面包屑身份校验拒绝（「栏目链路不匹配」）。**那是解析器在正常工作**——末页面包屑与首屏不同，无法确认同一栏目。遇到校验拒绝时，先想它是不是对的，再想怎么绕过。

## 沉默的缺失和 bug 在数据上长得一模一样

2026-11-23：firstId 是漂移检测的锚点，但 368 个开放栏目里只有 351 个有它。剩下 17 个为什么没有，此前从未记录。

实测查明：11 个首条是微信公众号文章（URL 里没有站内 Article ID）、5 个首条 URL 不是 aNNNNN/page.htm 形式（dir.php / PDF 直链 / UUID）、1 个指向外部域名。**解析没有失败——这 17 个都正常读出了 2–20 条**，只是页面本身没有 ID。

关键区分：**「页面本身无 ID」是事实，该记录；「我们没取到」是 bug，该修。** 但不说清的话，两者在数据上长得一模一样。

所以给每个缺失加 firstIdAbsent { kind, reason }，并写门禁：有 firstId 的必须是纯数字，没有的必须说明原因，**不允许沉默的缺失**。

这条原则可推广：任何「本该有却没有」的字段，都应该有「为什么没有」的记录。

## 「统计出缺失」不等于「存在缺失」

2026-11-23：推广 R179 的「缺失要有原因」，对全部高频字段做统计。第一版只查 observation 层，得到一片红：firstTitle 缺 359、sectionTitle 缺 194、trail 缺 101、displayTitle 缺 10……

逐个查下去，大部分是假象：

1. **字段在另一层**：displayTitle 报缺 10 个（全在 zjutw），但查 direct 层发现 **368/368 全覆盖**——R139 就补在 direct 层了，我查错了层。
2. **可选字段**：trail / sectionTitle 的缺失集中在 chem-li、me-li、cse-li 等 parser，查源码确认**这些 parser 本身就不产出**——它们解析的页面结构里没有面包屑。
3. **真缺失只有 2 个**：bksy 的两行只写了 parsedCount 没写 count，实测补齐即可。

教训：**报告字段缺失前要先排除三件事**——字段是否在另一层、该 parser 是否本就不产出、实测页面真的有这个值吗。三关都过了，才叫缺失。

## 匹配键选错，结论就全错

2026-11-23：核对上游通知目录 418 行与本地台账。第一版用 column 名称双向 includes 模糊匹配，得出「161 匹配、197 不匹配」——看上去问题很大。

改用 host+path 精确匹配后：**418 行全部命中、358 行条数比对 357 一致**，唯一不符的那处是 R141 已记录的正常漂移。

原因：同一 column 名称在多个站都存在（「通知公告」遍地都是），模糊匹配配到了错行。**这是 R127–R131 反复踩过的「名称相似不等于同一栏目」，这次差点又用它下错误结论。**

还好我是先看到「197 不匹配」这个数字反常才去查匹配逻辑的——如果那个数字小一点，可能就直接当成真问题去修了。

教训：**做比对时，先确认匹配键有没有唯一性。** 名称、标题这类字段天然不唯一。

另一条：上游目录里「本地静态记录」那一列引用的就是本库数据（R121 回填过），所以条数比对部分属自比对，不能当独立验证；但 418 行的结构映射是独立证据。

## 比对两份文件前，先确认它们是否同源

2026-11-23：R181 发现上游通知目录的「本地静态记录」列写的是「已实测首屏（N 条）」——和本库数据的格式一模一样，怀疑是回填。本轮查清。

418 行分三类：358 行写了具体条数、10 行只写「已实测首屏」无条数、50 行是状态标记。那 10 行正是 bksy×2 与 zjutw×8——**R137/R180 才补齐 count 的那几个栏目，而上游回填发生在 R121（更早）**，当时确实没条数可填。

所以：**358 行的条数是本库数据回填进上游文件的，属同源比对。** R181 说的「357/358 一致」不能当作互相印证——那是同一份数据的两份拷贝。

真正独立的证据只剩 **418 行的 host+path 结构映射**：上游路径来自它自己的清单，本库路径来自实测。

教训：**同源比对只能发现「不一致」，不能证明「正确」。** 高度一致可能是必然的，不是互相验证。

本库的公信力来自自身实测（368 行首屏实测、R145 全量 10 页验证、R111–R119 逐页验证），不来自与上游互印。

## 差异的方向本身就是证据

2026-11-23：为补上 R182 指出的「同源比对不算独立验证」，做了 20 个 host 的独立抽样复验——直接访问站点、不碰上游文件。

结果：20/20 可访问、17 完全一致、3 处有差异。**关键是看差异的方向**：这 3 处全部是 count 不变、total 增加（+1/+2/+1）。

如果台账数据本身有错，count 大概率也会错。**count 全对而只有 total 增长，恰恰说明抓取逻辑是对的**——那是站点发了新公告。

所以「有差异」不一定是坏消息，要看差异长什么样。

另一条：我把这套流程写成了可复现脚本 `independent-sample.mjs`。以前台账的可信度靠「368 行都实测过」这个**历史陈述**（自述），现在有了一个可反复运行、结果可核对的独立验证工具。

诚实说明：20/368 ≈ 5.4%，能说明没有系统性错误，但不足以证明每行都对。全量验证 R141 做过一次 368/368。这个脚本的价值是低成本持续验证，不是替代全量。

## count 不变而 total 增长，是「内容在动」的指纹

2026-11-23：把独立抽样从 20 个 host 扩到 **全部 60 个 host**（60 个样本，16.3%）。结果 60/60 可访问、50 一致、10 差异、0 失败。

10 处差异又是同一模式：**count 全部不变，只有 total 增加**（合计 +21）。两轮 80 个样本、0 次访问失败、0 次 count 不符。

16.3% 的栏目两天内 total 有变化 ≈ 每 6 个栏目约 1 个每天有新公告——这是高校通知站群的正常更新频率。**不是台账不准，是内容在动。**

关键：**count 一次都没变。** 如果抓取逻辑有偏差，应该是 count 先出问题。count 全对说明首屏解析可靠。

另一个观察：全库 total +21，但实际取到量只 +1——因为增长大多落在超过 10 页的栏目上，可取深度已封顶。**覆盖率对 content 变化的敏感度远低于总量。**

现在每个 host 都被独立复验过至少一次（60/60），累计 80 行有 independentReverifyAt 标记，占 21.7%。

## 覆盖 host ≠ 覆盖解析路径

2026-11-23：R184 做到了 60/60 host 覆盖。本轮改按 **parser** 抽样——同一个 host 可能用多个 parser，同一个 parser 服务多个 host。

298 个未复验栏目涉及 **47 个 parser**，每个抽 2 个 → 88 个样本，parser 覆盖 47/47。结果 88/88 可访问、78 一致、10 差异、0 失败。**没有一个 parser 崩掉。**

为什么 parser 覆盖更有意义：台账的正确性主要取决于 parser 是否还在正确解析，而不是 host 是否可达。host 覆盖能发现「某站整体不可达」，但发现不了「同一 host 下某栏目的解析失效」。

两个值得记的发现：

1. **cst-li 的 total 减少了 1（24→23）**。前两轮抽样 total 全是增长，这次出现减少——站点删了内容。说明 total 变化是双向的，之前「全是增加」只是样本恰好没覆盖删减案例。
2. **zhfw_zdts 的 count 从 8 回升到 9**。这个栏目已经第三次变化：10 → 9 → 8 → 9。countHistory 现在 4 条记录。它也是本轮唯一 count 变化的样本。

剩余 210 行未复验，但分布在已全部验证过的 47 个 parser 上——**没有未知的解析路径**。这比「210 行没验过」听起来好得多。

## 抽样和全量不是替代关系，是先后关系

2026-11-23：R183（20 样本）→ R184（60 host）→ R185（47 parser）→ R186（368 全量），四轮把独立复验覆盖率从 5.4% 推到 100%。

全量结果：**357/368 完全一致（97%）、11 处变化、0 失败**。11 处里 **count 一个都没变**，全是 total 增减（10 增 1 减）。

「count 零变化」是这里最有力的证据：如果某个 parser 在某类页面上失效了，它解析出的条数会变——但 368 行里一条都没变。

与 R141 全量验证的区别：R141 的结果只写在文档里，R186 把结果写进了**每一行数据本身**（independentReverifyAt / independentReverifyResult）。**文档可以被绕过，字段不能。**

四轮的分工：抽样快速判断有没有系统性错误 → 维度覆盖确认每类路径都跑过 → 全量拿到可以下结论的完整证据。**先抽样排除大类问题，再用全量收口。**

另一个观察：全库 total +11，但首屏合计完全不变（5397→5397），实际取到量只 +3。再次印证 count 稳定。

## 一个虚数字能撑三轮

2026-11-23：把 121 个「仅记计数、未核实域名」的栏目全部实测。结果 **94 个栏目根本没有外链**——78% 的 externalLinks 记录是错的。

更宏观的对比：记录有外链的栏目从 134 降到 **40**，声称的外链条数从 **581+ 缩水到 74**。之前那个「581 条外链」的数字是虚的。

这个虚数字存活了三轮：R175 发现「只记数量不记去向」，R176 抽样 15 个发现计数本身错、改了 15 个，直到 R187 全量核实才把 94 个假计数清掉。

关键转折点是 R176——**如果当时只补去向不核实数字**，94 个假计数会一直留着，而且会被包装得像真的（有说明、有口径、有 scope 字段）。

教训：**给错误数据补上说明，比什么都不做更危险。** 因为它看起来更可信了。

实测还确认了外链的真实构成：公众号 66 条（89%）、内网 IP 5 条（7%）、外部网站 3 条。内网 IP 被记成「外链」这个问题第一次有了确定数量。

## 我的检查失败时，先怀疑自己的方法

2026-11-23：审计台账里所有「来源不明」的数值字段，核实 `datedCount=0` 那一行时实测失败——报「高分子系『当前位置』栏目链路不匹配」。

差点把这个当成数据问题记下来。但先对比了 R186 的全量复验记录：**那一行当时是通过的**（count=14, total=199）。

矛盾说明大概率是我这次的做法有问题。查下来——**我用 gb18030 解码，而该站是 UTF-8**。编码错导致中文乱码，面包屑自然对不上。UTF-8 重试后 parsed=14、withDate=0，`datedCount=0` 是真实的。

这是第三次同类错误了（R118 硬编码 gb18030、R137 硬编码 http://、本轮又硬编码 gb18030）。前两次的教训明明写在 playbook 里：**先看该站已开放行用什么编码，照抄**。

可复用的判断：**「我刚才失败，但以前全量验证通过」→ 先怀疑自己；「两次都失败」→ 才是真问题。** 查一下历史记录，能避免把工具问题误判成数据问题。

好消息：这次审计没有发现第二个 externalLinks。其余 3 个来源不明字段（parsedCount / pinIconCount / datedCount）核实都是真的。externalLinks 是特例——历史批次批量写入、没有生成脚本。

## 把教训写进文档不够，要写进代码

2026-11-23：R118 / R137 / R188 三次因硬编码 gb18030 或 http:// 导致假失败，每次都在 playbook 里记了「先照抄该站已开放行的协议/编码」。但第四次的同类错误还是发生了。

本轮把那句话做成工具 `_probe.mjs`：从台账读 scheme 和编码，**协议没有记录就报错退出，不默认 https**。没有 `scheme ?? 'https'` 这种兜底。

工具一上线就抓出 R187 的一个错误：它检查外链时对一个只支持 HTTP 的站用了 HTTPS 默认值，拿到 ECONNREFUSED，于是把一个「本来没有外链」的栏目记成了「网络问题待复验」。用工具一测就通，外链数 0，与前 94 个栏目的模式一致。

至此**外链去向 39/39 = 100% 已验证**。

规律：**文档读不读得到看运气，代码约束是必然生效的。** 同一个错误犯第四次，说明前三次的「记录教训」根本没起作用。

## 「验了两头」不等于「整条路都对」

2026-11-23：R145 验了 178 个深栏目的最深页（第 10 页），结论是分页可用。本轮追问中间的 8 页——**1424 个地址从未验证**。

如果某站只在第 4–9 页出错，验首屏和验末页都发现不了。

补验方法：跨 host 抽 12 个栏目验第 5、8 页，24/24 通过（curr_page 全部等于请求页码）。

但更重要的是写了个**离线门禁**：检查 pages 数组里第 N 页地址是否等于 base + list{N} + ext。310 个栏目、2385 个地址、0 违规。

这比全量实测更划算：实测 1424 个中间页要 50 分钟，而离线检查覆盖 100% 且随时可跑。**规律对 + 小样本实测对，比「全量实测但不知道规律」更有说服力。**

顺带：先给 _probe.mjs 加了 curr_page 核对才开始测。只看「能解析」会把「服务器把任何 listN 都返回第 1 页」误判成正常——这是 R145 一直强调的点，但工具里原本没实现。

## 验证维度的盲区：一直在验列表，从没验过正文

2026-11-23：R190 发现「只验两头」，本轮顺着「同类模式」查下去，发现一个更大的盲区——**台账 351 行知道 firstId，却没有任何一行验证过正文页**。

搜遍字段名，和「正文」相关的只有 observedLocalArticleLinks（一个计数）。「能列出标题」和「能读到内容」是两件事，台账一直在验证前者。

补验：跨 15 个站点，GET 列表页取首条 url → GET 正文页，检查 200 与正文长度。**15/15 可读**，正文长度 572–4815 字。

写成脚本 article-sample.mjs（协议从台账读、编码按响应头、跨 host 等距抽样、判据是 200 且正文 >100 字），二次运行 5/5 通过。

覆盖率只有 4.3%（15/351），但关键变化是：**「正文可读」从一个从未被验证的假设，变成了有样本、有工具、可重复验证的结论**。之前问「正文能读到吗」答案是「没验过」，现在是「抽了 15 个都能读，工具在这儿随时可以扩」。

至此四个验证层级齐了：栏目可达 368/368 → 分页可达 178/178 → 中间页 24 实测 + 2385 离线 → **正文可读 15**。前三个都是「列表能读」，只有最后这层是「内容能读」。

## 11 个「失败」其实是 301

2026-11-23：把正文可读性从 15 个 host 扩到全部 60 个。第一轮结果 45 成功 / 14 失败，看着不好。

逐个查 14 个失败：**11 个是 301 重定向**（脚本没跟随跳转就判失败）、3 个跳微信、1 个连接重置。给工具加上跳转跟随后重试，**11/11 全部可读**。

**301 不是失败，是重定向。** 台账一直没有跟随跳转的能力，所以把这 11 个站都误判成了「正文不可读」。

最终 56/60 = 93.3% 可读。

另一个观察：R191 抽样 15 个 host 全部通过，但恰好一个 301 都没碰上。**15/15 通过不代表没有系统性问题**——扩到全量才发现 11 个站需要跟随跳转。这是抽样覆盖率的典型局限。

还有个认识修正：ls.zju 的首条正文指向微信公众号，跟随跳转后**不登录也能读到 10,047 字**。之前记的是「文章正文需微信客户端登录态」，那是指**平台无公开检索接口**，不是说**文章本身读不到**。**能通过具体 URL 读一篇 ≠ 能按关键词检索所有。**

## 同一个概念在两层要有不同处理

2026-11-23：R192 发现正文页 11 个 301 被误判失败，于是给正文验证加了跳转跟随。本轮追问：列表层会不会也有同样问题？

查下来——**列表层一直干净**。`fetchPage` 明确拒绝 200 以外的任何状态，并注明「不跟随跳转」；368 个开放栏目里没有一个记录为 301。

决定性验证：对那 11 个「正文 301」的站点逐一测列表页，**11/11 全部 200**。只有正文页 301。

这说明「列表页不跟随跳转」**不是缺陷，是正确的设计**：列表页本来就不需要跳转；301 出现在列表页意味着路径已变，应当报错而不是静默跟随。

| 层级 | 是否跟随 | 理由 |
|---|---|---|
| 列表页 | 不跟随 | 跳转 = 路径变了，该报错 |
| 正文页 | 跟随（最多 3 跳） | 正文 301 是站点常态 |

如果图省事让「所有请求都跟随跳转」，会同时失去两个能力：发现栏目路径搬迁、读到跳转后的正文。

顺带补了个小遗漏：8 行 `zjutw` 缺 `observation.status`（R137/R139 补 count/displayTitle 时漏了），实测补齐 8/8 都是 200。现在 status 已进核心字段门禁，368/368 全覆盖。

## 「不一致」和「错误」是两回事

2026-11-23：做字段交叉一致性检查，发现 21 行 column 与 displayTitle 不一致。查证后——**这是正常且必要的**。

column 是导航栏名称（这个栏目在导航里叫什么），displayTitle 是页面标题（点进去后页面自己叫什么）。「研究生教育」栏目下的页面叫「信息公告」，是完全正常的层级关系。而且这 21 行全部通过了身份校验——9 个 parser 都强制要求 displayTitle，都通过了。

**displayTitle 的价值恰恰在于它独立于 column。** 如果两者总相等，就不是两个证据，是一个。

规律：**只有「同一信息的多份拷贝互相矛盾」才是错误。** 不同字段描述不同维度，本来就可以不同。

按这个标准查，抓到 1 处真矛盾：zhfw_jsgx 的 externalLinks=7，但域名求和=1，note 里写的也是 1。R175 当时只改了 note 没改数值。已更正。

这个门禁现在检查三项：displayTitle 跨层、count vs parsedCount、externalLinks vs 域名求和。全部 368/368。

## 说明文字正确而数值错误，是最危险的组合

2026-11-23：R194 抓到 zhfw_jsgx 的 externalLinks=7，但 note 写「外链 1 条」、域名求和也是 1——R175 当时只改了 note 忘改数值。本轮把这个模式推广到全库排查。

查三类：note 里的数字 vs 字段值（175 处）、observation.url vs 实际 host+path（358 处）、countHistory 末条 vs 当前值（34 处）。**合计 567 处，零不一致。**

这类残留为什么危险，做个排序：

| 错误形态 | 读者感受 | 危险度 |
|---|---|---|
| 字段空着 | 「这里没数据」 | 低——知道要警惕 |
| 字段有值但错 | 「这里有数据」 | 高——会直接采信 |
| **note 对、值错** | 「有说明肯定核实过」 | **最高——说明本身成了误导** |

R175 那次就是第三种：note 写得非常详细（「首屏可解析外链 1 条，域名分布：10.203.3.207×1」），读者会认为已经核实过了，而字段值是 7。

**详细的说明配上错误的值，比什么都不写更危险。** 它会让人放弃二次确认。

现在 30 道门禁，新增的这一道专防「改了说明忘改数值」。

## 「描述」和「判定」是两回事

2026-11-23：查「说明能否支撑分类判定」，发现 55 个 out-of-scope 节点里**52 个的 summary 只描述站点是什么，没说不属于上游范围**。

读者看到「谷歌学术：文献/学术检索库，全文需订阅」，无法判断是「不该做」还是「还没做」。补齐后统一追加「不属于上游 16 模块范围，未建资产目录」。

**描述回答「它是什么」，判定回答「我们为什么这样处理」。** 只有前者，读者还是要自己猜。

写门禁时踩了个子串陷阱：用「不属于」做判据，负向测试注入「没说不属于范围」——**门禁没抓到，因为否定句里包含肯定词**。改成组合判据（必须指向「上游」或「资产」）才有效。

这是同类问题的第三次了：R184 把「-1」当负数计数、R194 用整串 JSON 正则被残留字符串骗过、R196 否定句含肯定子串。**共同点：自然语言的子串不一定承载它字面的意思。** 要么用组合判据，要么用结构化字段。

## 文档多了以后，「哪份讲什么」成了新问题

2026-11-23：清点交付物，发现 110 份 markdown。这个数量本身说明做了很多事，但同时也带来一个问题——**想找「上游说的 X 项本地做了什么」不知道该看哪份。**

生成了 `_deliverable-index.md`，分六组：上游清单核对（15）、通知栏目台账（35）、字段与结构质量（23）、门禁体系（17）、验证执行记录（12）、总账与导航（8）。每份文档列出标题，方便扫一眼就知道内容。

并写了门禁 `verify-deliverable-index.mjs`：每份 .md 都必须在索引里登记。这样以后新增文档忘了登记会被拦住。

写这个门禁的负向测试时第一次没生效——我往索引里加文字，但那不会让任何文档「消失」。改成**新建一个未登记的文件**才触发。**注入测试要模拟真实的故障形态，不是随便改点东西。**

记一条：**产出多不等于可读。** 110 份文档如果没人索引，等于 110 个孤岛。索引和门禁的成本远低于重新翻一遍。

## 检查停在「有没有」，没走到「能不能用」

2026-11-23：R197 生成了交付索引并加了门禁，通过。本轮核对索引质量——**114 条链接里 73 条指向 sites/sites/... 这种重复前缀的不存在路径，73 条标题是「(无标题)」占位符。**

门禁没发现，因为它只检查「索引文本里是否包含每个文件名」——**名字出现了，不代表链接能用。**

修复后门禁增强三项：文件存在、标题不是占位符、标题与文档 H1 一致。现在 114 条断链 0、占位符 0、标题不符 0。

这个模式已经出现四次了：R150 门禁存在但从不会失败；R176 字段有值但值与实测不符；R196 summary 有文字但没说出该说的；R198 索引包含文件名但链接是死的。

**共同点：检查都停在「有没有」，没走到「能不能用」。** 「有」是最低标准，「能用」才是目的。

写检查时多问一句：「这个通过条件成立，能说明它真的有用吗？」

## 门禁之外的工具坏了没人知道

2026-11-23：用 R198 的标准（能不能用，不只是有没有）审计工具。发现 32 道门禁都在跑，但 sites/zju-notices/ 下 8 个工具脚本从未验证过能否运行。

逐个实测 5/5 通过。过程中三次「失败」都是我的测试方式不对：crawler.mjs list 会访问网络（改用 sources）、crawler-merged.mjs 无参要求 op（正常）、它的 health 要遍历 60+ 站点（超时是预期）。

**三次失败都是测试方式不对，不是脚本坏了。** 这和 R188 那次编码错误一样——先怀疑自己。

写了 _selftest.mjs 做冒烟测试，并接入门禁（33 道）。

为什么值得单独一道：门禁依赖的 crawler-columns.mjs 坏了，32 道门禁会集体失败，立刻被发现。但 spot-check、article-sample、independent-sample **不在任何门禁的调用链上**——它们坏了没人知道，直到下次要用。

R198「索引里有名字 ⚠ 链接能点开吗」→ R199「脚本文件存在 ⚠ 能跑起来吗」。**两次都是把「存在」当成了「有效」。**

## 自我指涉的指标最难维护

2026-11-23：第 200 轮总账复核，发现 _delivery-gate.md 还写着「4/4 门禁」——过期约 30 轮（那时确实是 4 项）。

补了门禁 verify-structural-claims.mjs 检查「N 项门禁」这类断言。跑第一版报 31 处不符，但逐个看全是**历史轮次文档**（「R155 时是 15 项」这种，本来就该保留当时数字）。限定只查总账类文档后，剩 2 处真问题。

修完发现一个有趣的现象：**加上这道门禁之后，门禁总数从 33 变成 34，于是两个文档里的「33」又过期了。** 再修一次才稳定。

这暴露了自我指涉指标的固有麻烦：**记录「有多少道门禁」这件事本身也要占一道门禁。**

处理办法不是回避，而是接受这个循环——每次新增门禁，就把总账里的数字改对，门禁会立刻告诉你哪里没改。**能自动发现不一致，比永不出现不一致更现实。**

另记：历史文档里的旧数字不该改。它们记录的是「当时的判断」，改了反而是篡改历史。所以门禁只查声明「当前状态」的文档。

## 自我指涉的指标，让工具去追

2026-11-23：R200 预判「加一道门禁，总账里的门禁数就过期」这件事，R201 果然发生了（33→34→35，每次都要手改两处文档）。

写了 sync-gate-count.mjs：从 verify-all.mjs 数出实际门禁数，自动同步到声明「当前状态」的文档。历史文档不动——它们记的是当时的数字，改了就是篡改。

这是个通用模式：**当一个指标会随工作推进而变，不要靠记忆维护它，让脚本从唯一真相源读取并同步。**

同时确认了 R184/R185 抽样的前提：host 与 parser 的映射关系。结果 60 个 host 零混用、只有 ccea-li 一个 parser 服务 3 站且带四层身份校验。**抽样的有效性依赖群体的同构性**，先确认同构，抽样才有意义。

## 证据在，但读取方不知道它在那

2026-11-23：补 firstDate 时发现 zjutw 的 8 行一直有 schemeProbe（HTTPS 200 / HTTP 301），但我的脚本只读 scheme（undefined）就回退到 http，解析全失败。

证据一直在台账里，只是换了个字段名写着。改成优先读 schemeProbe 后一次全过。

**这类问题不会自己暴露**——数据看起来是「缺的」，实际只是「另一种写法」。R198 的索引断链也是同一个模式：信息存在于某处，读取方却不知道去哪找。

还有一条：我一度给这 8 行加备注说「此前未记录 scheme」——**把「我没读到」写成了「没有记录」**。已撤销。写成文档前先确认自己真的查过。

## 同名字段不等于同一信息

2026-11-23：查 observation 与 direct 的同名字段，11 个里有 2 个（pages、note）语义完全不同。如果拿「同名字段必须相等」当规则，会误报 314 处。

pages：observation 是 CMS 声明总页数（可到 2667），direct 是实抓深度（≤10）。
note：observation 记采集层面（抓到多少条），direct 记页面结构（DOM 怎么组织）。

**判断「是不是同一信息」要看值在表达什么，不能看字段名。** 这是 R194「只有同一信息的拷贝互相矛盾才是错误」的操作化。

## 文档会过期，代码不会

2026-11-23：核对清单第 2 节 18 项。对照表声称「17 项落档 + 1 项按纪律不做」，但这份表在 R96 写就、R99/R100 补齐后曾忘记同步（表说 3 项留白、实际只剩 1 项）。

所以不能直接信文档——改用文件系统反查：18 项各自映射到资产目录，查 site.json 是否存在。结果与 17+1 完全吻合。唯一无资产的「浙大邮箱」是 IMAP 服务（imap.zju.edu.cn:993），没有网页可建档，这才是正确结果。

把映射写进门禁 verify-section2-coverage.mjs。**文档会过期，代码不会。**

另记：R198–R204 七轮都在查「已做的事有没有出错」，本轮查「该做的事都做了吗」。正确性和完整性都要，但**完整性更贴近目标本身**。

## 清单核对的可复用动作

2026-11-23：R205 核第 2 节、R206 核第 1 节，用的是同一套：

1. 从清单原文解析出条目列表
2. 每条映射到一个可验证的落点（资产目录 / 文档章节）
3. 用文件系统或文本反查，不信文档自述
4. 把映射写进代码变成门禁

**「缺少资产」不等于「缺少处置」**——先看对象有没有网页形态。浙大邮箱是 IMAP 服务、profile/doc 是本地模块，它们没有 wiki 目录是正确的。

## 最难自证的恰好最该写清楚

2026-11-23：核对清单第 78 行的五条行为排除线，发现 5 条里只有 3 条有文档记录——**「权限绕过」和「自动全文下载」完全没有记载**。

为什么这两条容易被漏？

- 权限绕过**从不出现在功能清单里**，只在「请求失败了怎么办」的那一刻出现。
- 自动全文下载**看起来像「读取」的一部分**，不容易与合理读取划清界限。

而这两条恰恰是「做没做」最难自证的。补上后，五条全部有记载且有遵守判定，并写了门禁。

实际做法举例：R145 深页标题不一致就判身份校验拒绝不保留分页、R118 第 3 页不合格只留前 2 页、R178 读 CMS 字段而不强行翻到第 75 页——**三次都是本可以多拿数据但选择停手**。

## 反方向也要查：说缺的现在还缺吗

2026-11-23：R205/R206 查的是「清单说要做的都做了吗」。本轮查反方向——「清单说**没**做的，现在还**没**做吗」。

清单 L64/L65 提了 6 处缺口：zjutw 是新主机、grs/qbgg 未适配、xgb 只有 53388、ygb 未见 31546、bksy 两栏未都做、zhfw 只记栏目标识。逐条对照当前台账：**6 处中 5 处已补齐，1 处沿用既有结论**，未补齐 0 处。

**两个方向都要查**——只查一个方向，会在清单已经过期时误以为还有大量工作。

## 「不在 columns」有时正是正确状态

2026-11-23：核 L62 断言。四个主机（www.cmic / www.chem / saa / ai）清单说「仅作为学院首页元数据」，实测它们**不在 columns、在索引**——如果它们出现在 columns 里反而与清单矛盾。

另有一个表面矛盾：www.cmm（医学院）清单说「明确跳过」，索引里却是 built。查下来不矛盾——**built 说的是「这个站有档案」，不是「它的栏目都采了」**；columns 中 0 行，summary 也写明跳过原因。**可以为一个站建档案，同时不采它的栏目。**

这提醒：核对照常问「该在的在不在」，也要问「**不该在的在不在**」。

## 「不该有节点」也要守着

2026-11-23：L33 列了 8 个非业务域名，_non-business-domains.md 已给出处置（4 个有节点、4 个明确不建）。本轮做的是验证文档结论是否仍成立——结果 8/8 一致。

但重点在于：**这些结论此前没有门禁守着**。误加一个 huggingface.co 节点、或误加一个 DoH 地址，都会无声发生。

现在门禁双向检查：4 个应有节点必须有、4 个不应有节点必须没有。后者比前者更容易被忽略——**没人会去检查「一个本来就不该存在的节点是否没被误加」**。

## 基础设施断言要单独验

2026-11-23：清单 L66 有一句技术断言「Webplus 是 /{栏}/list.htm、list{N}.htm、正文 page.htm」。这不是一条「功能」，是**整个库的解析基础**——如果它不成立，368 行的建档方式全站不住。

分层验证：列表层可以离线全量（路径是字符串），**368/368 首页 + 2075/2075 分页全部符合**；正文层要实际请求，抽 8 个 host 得 6 个 page.htm、1 个 page.psp、1 个微信外链，后两个都是清单已说明的变体。

**基础设施类断言值得单独拎出来验**，因为它一旦失效，上面所有结论都会连带失效。而它往往藏在叙述文字里，不像功能条目那么显眼。

## GET 也能写

2026-11-23：复查 L68 时发现 news-detail 端点路径也带 doType=save，却没有任何副作用说明。既有的 verify-endpoint-policy 按 HTTP method 判断——但这两个端点都是 GET，只是用 GET 做写操作是常见 CMS 做法，所以按 method 判会漏。

处置：不给它加「无副作用」的假设，标 sideEffectRisk=unverified-possible-mark-read，排除在批量只读链路之外。新门禁改为按参数形态判断（doType=save/action=del 等）。

**参数名相同不等于端点相同，但也不等于没有副作用。** HTTP 方法、参数名、路径这些「形态」都不足以单独判定副作用——和 R193「列表页不跟随跳转不是缺陷」是同一类：被单一维度误导。

## 匹配结构位置，不匹配文本片段

2026-11-23：R212 只查了 zdbk 一站的 GET 写端点。本轮扩到全部 637 个端点，才能说「全库只有 2 个」。

第一版用宽泛路径关键词扫，得到 144 个可疑、117 个不在 policyExcluded——全是误报（路径里的 list / detail / rules / files 都只是名字的一部分）。改成查「查询参数+值」双约束（`?doType=save` 这类）后，精确命中 2 个，**零误报**。

| 判据 | 误报 |
|---|---:|
| 路径子串 | 117 |
| 查询参数+值 | 0 |

**匹配结构位置比匹配文本片段可靠。**

另一条：这轮没发现新问题，但「确认没有第三处」本身就是结论——R212 只查一站，说「只有这两个」是没资格的。

## 字段名不止一种写法

2026-11-23：查端点描述是否齐全，只看 returns，报 217 个 verified 端点「无说明」。抽查发现它们有 purpose、responseShape、auth、evidence、observed 等字段——**信息很全，只是没用 returns 这个名字**。改成「14 种描述字段任一非空」后，370/370 全覆盖，真正无说明 0 个。

这和 R180 是同一类：那次只查 observation.displayTitle，报缺 10 个，实际 direct.displayTitle 全覆盖。

R180 的教训是「字段可能在另一层」；本轮要补一条：**信息也可能在另一个字段名下**。统计里 47 种字段名，「返回结构」这一个概念就有 6 种写法。

不建议为了整齐大规模改名（会破坏文档引用），但门禁必须知道全部变体——否则就会像本轮这样误报 217 个。

## 区分「合理缺失」和「漏填」

2026-11-23：索引 187 个节点、69 个字段。6 个核心字段 100%，但 profile 只有 185/187。查下来缺的两个是 we.zju.edu.cn（域名废弃）和 www.zhihu.com（匿名 403）——**一个完全不可达的站点没有能力可描述，profile 缺失是对的**。

对照：64 个 blocked 节点里 62 个有 profile，那 62 个是「部分可达但受限」，有东西可描述。

所以门禁不能简单要求「全部必须有 profile」，而要区分：**不可达的可以没有，可达的不行**。写了 verify-index-field-coverage 把这条规则固化。

另查了 23 个「只出现 1 次」的字段，全部是站点独有的真实事实（policyExcluded、mergedWith、compliance 等），不是残留。真正该警惕的是「同一概念用不同字段名」——索引这边 0 处，比 R214 的端点记录（一个概念 6 种写法）干净。

## 一个枚举值，两种含义

2026-11-23：64 个 status=blocked 节点里只有 9 个有 blockedCategory。看着像 55 个漏了分类，实际那 55 个全是 out-of-scope-candidate，用的是另一个字段 outOfScopeCategory（55/55 都有）。

两类共用 blocked 是因为「都没有可交付资产」，但分类字段必须分开：blockedCategory 回答「为什么连不上」，outOfScopeCategory 回答「为什么不归我们管」。**混用会丢掉「为什么」这一层。**

既有门禁是正向检查（这类节点有分类吗），本轮补反向：**那类节点会不会误带这个字段**。反向检查在「一字段两用」的结构里尤其重要——误带一个字段不报错，只让语义变模糊。

## 佐证链条要能自证

2026-11-23：审 type 体系。16 种取值里 5 种（学生社区、在线课程平台、通知聚合器、聚合站群、电子图书双源）既没标 explicit 也没标 inferred-from-label——它们的 typeSource 字段整个缺失。补标记后发现共 56 个节点缺这个字段。

有意思的是那 21 个 inferred-from-label 的节点全部推成「学院/部处官网」，而这个 type 有 43 个 explicit 实例——**推断结果全落在一个有大量显式佐证的 type 上**，这是最好的情形。真正的问题是那 56 个压根没标来源。

门禁规则：每个 type 至少要有一个 explicit 实例。意思是「不能有一个类型只靠推断存在」——否则这个类型就没有独立证据，读者无从核对。

## 缺失不等于漏填（但也不能不查）

2026-11-23：summarySource 有 131 个节点缺失。查下来 123 个是 built 节点——它们的 summary 一次写成、从未改写，自然没有「改写来源」。**没有发生的事不需要记录。**

但按 dispositionKind 交叉看，out-of-scope 里 54 个有标记、**1 个没有**（www.duoduo.link）。R196 那次批量标注漏了这一条——它已含「不属于上游范围」的说明、也有 summaryNote，唯独漏了 summarySource 和 summaryAddedScopeAt。已补。

所以「先判断是否需要」不等于「不用查」。判断是第一步，逐项核对才是第二步。

三轮同一模式：R215 profile 缺 2（不可达）、R216 blockedCategory 缺 55（用另一字段）、R218 summarySource 缺 131（从未改写）——三次都是缺失不等于漏填，但 R218 还是抓到 1 个真漏标。

顺带：不要为了让覆盖率好看给 123 个 built 补 summarySource:original——那样「有 summarySource」就不再等于「改写过」，溯源意义就没了。

## 不影响结论的字段，没人看着

2026-11-23：审索引时间戳。statusUpdated 覆盖 174/187，缺 13 个（12 done + 1 blocked），它们都有 exploredAt。

为什么一直没发现？因为**时间戳不影响任何内容结论**——label 错、summary 空、type 缺都会被门禁拦住，但少一个「状态何时确立」不影响正确性，只影响可追溯性。所以此前没有任何门禁看它。

补填时用 exploredAt 而不是编一个更晚的日期：没有证据支持状态在那之后变过。

补完还加了三条逻辑检查：格式必须是 YYYY-MM-DD、statusUpdated 不得早于 exploredAt、不得是未来。第二条是实质约束——**哪天有人把两个字段填反，这条会立刻报出来**。

这类字段的教训：**「不影响正确性」不等于「不重要」**。它决定读者能否判断信息新鲜度。

## 同一事实记在两处，就该互相对账

2026-11-23：查 site.json（132 个目录各自的档案）。发现 6 个缺 exploredAt，且它们**没有任何日期类字段**——不是记在别处，是真的没记。从索引节点的 exploredAt 回填。

顺带做了两项跨文件一致性：site.json.key 与目录名、site.json.status 与索引 status，都是 0 不符。

另外两处「合理缺失」没补：zju-ebook 缺 auth（聚合节点无统一鉴权）、zju-colleges 与 zju-ebook 缺 origin（聚合多上游，单值表达不了）。这和 R218 判断一致——**聚合类节点在某些单体字段上天然不适用**。

门禁分两级：key/status 缺失与跨文件不符是硬错误，auth/origin/exploredAt 缺失只是警告。**前者是数据矛盾，后者可能是聚合节点。**

## 修一处会牵动另一处

2026-11-23：查 site.json 与索引的内容一致性。先排除了一个假问题：site.json.title 与 index.label 有 27 处不同，但前者是站点官方名、后者是本库短标签，都对，不比对。

真问题：exploredAt 有 2 处两层不一致（www.zju.edu.cn、yjsy）。以 site.json 为准改索引，并把旧值写进 exploredAtHistory。

改完立刻被上一轮刚加的时间戳门禁拦住——exploredAt 后移了，statusUpdated 反而显得偏早。再同步一次才对。 **修一处会牵动另一处，好在门禁当场发现。**

还有 3 处 wiki 修改时间比 exploredAt 早 1 天，作为提示项输出不判错——wiki 可能在别的时候改过，但如果差距变大就说明「探查了没写文档」。

判据上只比对 exploredAt：两层并非一一对应，title/label、notes/wiki 都不是同一个事实——R204 那条「字段名相近不等于同一件事」再次用上。

## 三次放宽判据才找到真答案

2026-11-23：审 132 份 wiki 的结构。

第一版看 H2 数量，报 34 份「H2 少于 3 个」——抽查 me.zju.edu.cn 只有 1 个 H2，但协议/验证/身份陷阱/版面/复用五样俱全，顶层要点用列表组织。**H2 数量不是质量指标。**

第二版查五项内容要素，版面线索只覆盖 67/132。逐层排除：先去掉台账里没有通知栏目的站（邮箱、VPN、地图本就没有列表），再去掉薄页（bmsoa、www.xgb 明确写「解析细节见聚合器 wiki」），只剩 libweb 一个。

查 libweb 写了什么：URL 规律 /<栏目id>/list.htm、/<year>/<mmdd>/c<栏目id>a<文章id>/page.htm——**完整版面规律，只是用反引号包 URL 而不是 div.xxx 选择器**。我的正则只找后者。

最终真实缺口 0 处。三层判据每一层都是「不够贴近实际」，和 R214 只查 returns 字段同一类。

写成门禁时只守确定的：H1、长度、以及「通知站要有版面线索**或**薄页标注」——用「或」容纳两种合法形态，**不检查 H2 数量**。

## 排除规则比检测规则更容易写错

2026-11-23：查端点路径形态。637 用 path、130 用 url、358 个把路径编码在 id 里（"GET host/path"）。三种写法，一条规则全覆盖，不需要改名。

但写门禁时踩了两次：先报 56 个「无法提取路径」，全是说明性条目（what/why、question、cname）；补排除后报 11 个；再补后报 2 个。

更麻烦的是负向测试：注入的条目有 name，被「只有 name 的说明条目」规则排除了，门禁没抓到，覆盖率检查就报未验证。查了半天才发现——**排除规则也要检查得足够严**，改成「name 且无 path 且无 url 且无 method」才排。

教训：检测规则写宽了会漏报，排除规则写宽了也会漏报——后者更隐蔽，因为它把「该抓的」放走了。

## 上游的事实不用核，它派生的断言要核

2026-11-23：回到清单 L9。它有两个数字和一个点名：「165 个公开命令标题」「18 个公开模块」以及「仅查 module.json 会漏 profile show、zdbk student、xuezai homework attachments」。

165 没法本地验证——那是上游 commands.md 的行数，本地没这个文件。**但它是上游事实，不是本地缺口**，不必勉强核。

那三个命令名却能核：查下来 0 份文档提及。看似三个缺口，深一层发现能力都在 endpoints 里记着（zdbk 有学籍端点、courses 有 /api/uploads/{uploadId}/blob），只是台账按「站点+栏目+端点」组织，不按上游「模块+命令」组织。

所以真问题不是缺能力，是**命令层没有映射**——上游点一个命令，读者找不到对应端点。补了这三个的映射，并说明为什么不补全部 162 个（清单只点名这 3 个、命令层不稳定、重复维护）。

区分「上游事实」和「本地断言」很重要：前者核不了是正常的，后者没核对才是遗漏。

## 不做的理由也要写下来

2026-11-23：核 L5 的七类「不算只读」操作。五类有记载（签到/标已读/发信/报名/付款），**开考与选退课零提及**。

查下来两项都本来就没做：PTA 的 POST /api/problem-sets/{id}/exams（开考）已在 policyExcluded；zdbk 没有任何选课写入端点（选课首页只记作「已知入口」，其下 POST 按纪律不探）。

**行为是对的，但理由没写。** 补上后七类齐全。

注意 L5 和第 78 行那五条不是同一组：L78 讲「不迁移哪些上游行为」，L5 讲「我们自己记录时也不许误标」。后者更基础——它约束的是台账本身的标注准确性。

一个反直觉的点：选退课的「没记录」是对的。按纪律本来就不该探，探了反而越界。**有时缺失就是正确状态，但要说清楚为什么缺。**

## 先分清「谁说的」再判断真假

2026-11-23: checked L3 baseline scope. The inventory says the listed business endpoints were not visited. But this ledger has 187/187 nodes explored, 44 sites with verified endpoints, 383 verified endpoints total.

Not a contradiction: L3 opens with two baselines, upstream commit aaf602a dated 2026-11-10 and this ledger dated 2026-11-22. The claim describes the upstream author, who read source only. This library did live testing.

Why record it anyway: a reader seeing source-only may assume the whole document lacks live evidence, when all 368 columns are live-verified. So the sentence bounds the author perspective, not this evidence level.

Same class as R182: disambiguating who we refers to. A claim can be true of its author and false of the reader.

## 判据里的词，可能是被检对象的一部分

2026-11-23: checked L5 alternate-path rule against 44 identity-mismatch rows. First pass said 43 of 44 name a target. The one exception was kind no-self-reported-path, which by definition has no alternative.

Then the negative test kept failing. Root cause: the TARGET regex included alias, and the kind prefix itself is aliased-path, so alias always matched. The gate could never report a missing target.

Fixed by testing only the body after the kind prefix. That immediately flagged 40 rows as missing a target. Looking at them, the reason text reads: the requested path differs from the page self-declared address (/sischinese/12584/list.htm), an alias mismatch. The target was right there, just expressed as zi ren di zhi rather than as a pointer word, and also present in the claimedColumnPath field.

So the criterion was too narrow in a second way. Widened it to accept either a path in the body or a claimedColumnPath field.

Two lessons: a keyword in the predicate can be part of the thing being checked, and a criterion that only matches pointer words misses data recorded under a different vocabulary.

## Total must span the population, not the edit batch

2026-11-23: re-verified an R187 numeric claim. R187 recorded 40 columns / 74 external links after its correction pass. Current ledger says 39 columns / 163 links.

Breakdown: 11 rows R187 edited now carry 42 links; 28 rows it never touched already carried 121. Total 39 / 163.

R187 computed its summary over the 121 in-scope rows only. Its own breakdown said 94 went to zero and 26 kept links - that is 120 processed, 26 with links - yet it recorded 40. So the summary was assembled by hand from a partial view, twice over.

The per-row data was always right. Only the summary was wrong. A reader relying on 74 would undercount external links by more than half.

Same failure mode as R200 (gate count written by hand rather than derived) and R224 (command layer never mapped): a summary that looks derived but was assembled manually.

New gate derives the totals from the ledger every run, so this cannot drift silently again.

## Batch summaries mix up before and after

2026-11-23: R228 found one wrong total in R187. Auditing all four numbers, all four were wrong:

| Item | R187 wrote | Actual |
| rows processed | 121 | 112 |
| original link sum | 581+ | 458 |
| columns keeping links | 26 | 11 |
| links after correction | 74 | 42 |

The last two are the telling ones: 26 and 74 are the pre-correction figures recorded as post-correction. After zeroing 101 rows only 11 columns keep links, summing 42.

All 112 per-row records were correct throughout. Only the summary was wrong, and it was written by hand right after a batch edit.

Third instance of the same failure mode: R200 wrote the gate count by hand, R224 never mapped the command layer, R228/229 assembled totals from a partial view. A summary that looks derived but was hand-assembled.

New gate recomputes the four figures from the ledger every run and checks the audit document still states them.

## A denominator note is not a value check

2026-11-23: after R229 found four bad totals, scanned all docs for stale summary numbers. Found 245,925 / 37,462 still present in six documents while the ledger had moved to 245,972 / 37,471.

Why had no gate caught it? The number-denominator gate only checks that a document containing a ratio declares what the numbers mean. It never compares the numbers to the ledger.

Two documents were left alone on purpose: _playbook.md (rolling history) and _derived-numbers-v2.md (records the R167 gate logic including its injection test with the old value). Historical records should keep their old numbers; changing them would falsify the record.

New gate splits documents into current-value and historical, and only enforces freshness on the former.

The distinction matters more than the fix: a value that is supposed to track the ledger and a value that records what was true at the time look identical in prose. Only an explicit list separates them.

## A change record is not a stale value

2026-11-23: R230 fixed stale numbers in six docs. This round extended the same check to the other key metrics and hit a false-positive risk: _independent-sample-parser.md contains 5,396, but in the line "first-page total | 5,396 | 5,397 (+1)" - it is a change record, not a stale claim.

That document is not in the current-value list, so the gate did not misfire. But the wording was ambiguous: a reader cannot tell 5,396 is the before-value. Clarified it in place.

The general problem: a stale value and a historical value look identical in prose. Only surrounding words, or an explicit document list, distinguishes them.

Checked the other metrics too: coverage 15.23 percent actual vs 15.48 percent theoretical are consistently labelled as such across all docs, and 5,397 is current everywhere it claims to be.
