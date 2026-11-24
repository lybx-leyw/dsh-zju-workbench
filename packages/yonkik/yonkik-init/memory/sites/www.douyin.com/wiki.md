# 抖音（www.douyin.com）— 免登录可得面

> 探索时间：2026-11-20｜任务：**不登录能拿到什么**（不是批量抓取）｜状态：done（免登录面）

## 本页索引
- [一句话结论](#一句话结论)
- [免登录能拿到（已验证）](#免登录能拿到已验证)
- [免登录拿不到（已证伪）](#免登录拿不到已证伪)
- [坑](#坑)
- [复现命令](#复现命令)
- [下一步候选](#下一步候选)

## 一句话结论

**抖音是「可以免登录看，但不能免登录接」**：首页精选流、热点榜、热榜 JSON 都免登录可用；
一旦到**单个视频的内容**（详情/播放地址/搜索）就被 Argus 风控挡住，必须登录态或真实浏览器指纹。

分界线清楚：**列表层免登录，详情层不免登录。**

## 免登录能拿到（已验证）

| 能力 | 入口 | 形式 | 证据 |
|---|---|---|---|
| **抖音热榜（热搜榜）** | `GET /aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1&source=6` | **纯 JSON，无 cookie 直接可用** | HTTP 200 / 65316 B / status_code=0 / `word_list` 49 条 |
| 首页精选流 | 浏览器渲染 `https://www.douyin.com/` | DOM 卡片 | 21 张 `waterfall-videoCardContainer`，无需登录，含标题/时长/点赞/作者/日期 |
| 热点榜页面 | 浏览器渲染 `https://www.douyin.com/hot` | DOM + 无限滚动 | 滚动 2 次视频链接 0→19；页面内可见 2 个 `<video>` |
| 热点话题页 | `https://www.douyin.com/hashtag/<词>` | DOM | 渲染出 8 条视频卡（注意：多为 Baiduspider 来源的老视频） |

热榜 JSON 的字段足够做选题分析：`word` / `hot_value`（如 10986255）/ `position` / `sentence_id` /
`event_time` / `video_count` / `discuss_video_count` / `article_detail_count` / `label` /
`word_cover.url_list` / `word_type` / `is_n1`；另有 `data.trending_list`（5 条）与榜单头图。

## 免登录拿不到（已证伪）

| 想拿的 | 路径 | 实测结果 |
|---|---|---|
| **视频详情 / 播放地址** | `GET /aweme/v1/web/aweme/detail/` | **403** `Blocked by ArgusSecurityPlugin Uifid Not Found` |
| 同上（预热 cookie 后） | 先访首页拿匿名 `ttwid`/`_waftokenid`，再打详情接口 | **仍 403**（同一条 Uifid 拦截；匿名 cookie 不含 sessionid） |
| 视频详情页 | 浏览器 `https://www.douyin.com/video/<id>` | 长时间停在 `Please wait...`（18s 无进展），`<video>` 的 readyState=0 |
| **搜索** | `GET /aweme/v1/web/general/search/single/` | HTTP **200 但业务码 2483**「请先登录，再继续搜索吧」 |
| 搜索页 | 浏览器 `/search/<kw>` | 只出页面壳 + 触发安全验证 |
| 推荐流 | `GET /aweme/v1/web/tab/feed/` | 200 但 **body 0 字节**（缺 `a_bogus`/`X-Bogus` 签名） |
| 热点词视频列表 | `GET /aweme/v1/web/hot/search/video/list/` | 200 但 **body 0 字节**（缺签名） |
| 直播分区 | `GET live.douyin.com/webcast/web/partition/detail/room/` | **444**，`X-TT-System-Error: 3` |
| 旧分享页（经典免登录路） | `www.iesdouyin.com/share/video/<id>/`、`m.douyin.com/share/video/<id>` | **302 回 www.douyin.com/video/<id>**，已关闭 |
| sitemap 枚举 | `/sitemap.xml` | 只有 **12 条静态页**（首页/协议/入驻），**不含任何视频** |

## 坑

1. **「200 ≠ 拿到数据」**。抖音有三层返回：① 真数据 `status_code=0`；② 业务拒绝
   `status_code=2483` + 中文提示；③ **HTTP 200 但 body 0 字节**（缺签名参数的典型表现）。
   只看 HTTP 状态会把 ③ 误判成成功。
2. **纯 HTTP GET 首页只有 2397 bytes 的 SPA 壳**，内容全靠 JS 注入。无 cookie 直连拿到的
   105KB/850KB「大 HTML」也是浏览器运行时序列化的结果，**不带 `_ROUTER_DATA` / `aweme_detail` 等 SSR 数据块**——
   三次拉 HTML 实测：`RENDER_DATA` 脚本存在但为空壳，`awemeId` 命中仅 4 次且是骨架代码。
3. **匿名 cookie 不等于可访问**。首页能种 8 个 cookie（`__ac_nonce` / `_waftokenid` / `__ac_signature` /
   `ttwid` / `enter_pc_once` / `web_sign_token` / `UIFID_TEMP` / `x-web-secsdk-uid`），
   但**没有 `sessionid`**；带这套 cookie 打详情接口依然 403。
   风控要的是 **UIFID + 真实浏览器指纹**，不是设备 cookie。
4. **本机出口 IP 一致**：`fetch`（走 env 代理 `<本地代理>`）与 `node:https` 直连的出口 IP **都是同一个**
   （`<出口IP>`，已脱敏）。MEMORY.md 记的「代理出口在墙外回不到内网」对抖音/小红书不构成障碍，
   但**不要**据此以为两条路会有不同风控待遇——实测无差别。
5. **robots 是「按爬虫分类禁」**：30+ UA 被显式列出，`Disallow: *general_search*`、`*enter_from=*`、
   `*vid=*`、`/follow`；对 Baiduspider 另禁 `/video/` `/note/` `/search/` `/topic/`。
   **热榜路径不在任何 Disallow 里**——这是它成为唯一干净 JSON 口子的原因。
   若要做批量，按 robots 只该碰热榜，别碰搜索与详情。
6. **`hashtag` 页的视频卡大量带 `?source=Baiduspider`**——那是搜索引擎收录的旧快照，不代表当前热门。

## 复现命令

```bash
# 热榜 JSON（唯一稳定的免登录接口，单发；内置 2.5s 串行）
node sites/www.douyin.com/crawler.mjs hotlist --top 20
# 连通性自检
node sites/www.douyin.com/crawler.mjs health
```

> 首页/热点榜的**浏览器渲染探测**（滚动加载、卡片计数）本次用的是临时探针脚本，
> 已随 `_scratch/` 清理，**未封装进 crawler.mjs**——因为它是「验证性探针」而非可复用取数操作。
> 若后续需要，按本页「免登录能拿到」表格里的 DOM 选择器（`waterfall-videoCardContainer`、
> `a[href*="/video/"]`）重写即可。

## 下一步候选（本次未做）

- **直播**：`live.douyin.com` 页面本身免登录可看，但接口 444；页面 DOM 能否取到房间列表未探。
- **用户主页**：`https://www.douyin.com/user/<sec_uid>` 未探（需要真实 sec_uid；详情接口同样被 Argus 拦）。
- **合集/话题聚合页**：`/collection/<id>` 未探。
- **若登录**：登录后详情/搜索通，argus 签名由页面 JS 自动带；此时才值得谈「批量」。
- **合规前置**：批量前先读《用户服务协议》与 robots，本页第 5 条已给出 robots 边界。
