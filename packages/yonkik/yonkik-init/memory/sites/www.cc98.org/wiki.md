# CC98 论坛 (www.cc98.org)

## 本页索引

<!-- yonkik:toc -->
> 按节读，不要整篇加载：先看标题，再 grep -n "^## <标题>" wiki.md 取行号，只读那一节。

- 概览
- 鉴权
- 限流
- 接口（详见 endpoints.json）
- 坑
- 脚本用法
- 调查发现（2026-11-17，8 关键词×15 条初步样本）
- 待探（unverified）
- 坑的修正（2026-11-19）
- AI 订阅与梯子的舆论（2026-11-20 检索）
- 电子书来源调查（2026-11-20）

---
## 概览
浙大 CC98 论坛，React SPA v3.5.0。入口 https://www.cc98.org（直连可达，无需 webvpn）。
www 域名对所有路由返回同一 SPA 空壳；真实数据 API 在独立 host https://api.cc98.org。

## 鉴权
OAuth password grant：POST https://openid.cc98.org/connect/token
（client_id 为前端 JS 公开值，client_secret 已在 site.json 脱敏为占位符；scope=cc98-api openid offline_access）。
返回 access_token（约 3600s）+ refresh_token，存 state.json。API 请求带 Authorization: Bearer。
登录脚本 scripts/login.mjs（从磁盘读凭据，不回显，单次尝试防锁号）。token 过期重跑 login。
凭据键 cc98（键一=账号，键二=密码）。

## 限流
无真实 robots.txt（返回 SPA 壳），无 Crawl-delay 证据 → 保守默认间隔 2s、并发 1。
本次未触发 429。批量调查用脚本串行，勿并发。

## 接口（详见 endpoints.json）
| id | method path | 用途 | 脚本操作 |
|---|---|---|---|
| board-all | GET /board/all | 全部版块（分组嵌套） | boards |
| topic-search | GET /topic/search?keyword=&size=&from= | 全站搜主题 | search |
| topic-search-board | GET /topic/search/board/{id} | 版块内搜 | searchBoard |
| topic-detail | GET /topic/{id} | 主题详情 | topic |
| topic-hot | GET /topic/hot-{period} | 热门主题 | hot |

写操作（签到/发帖/收藏/关注/转账/私信/配置更新）一律不调，见 endpoints.json unverified。

## 坑
- **【最重要】列表接口是按 `lastPostTime`（末次回复）降序，不是发帖时间 `time`。**
  `/board/{id}/topic?from=&size=` 与 `/topic/search/board/{id}/tag?tag1=&from=&size=` 皆然。
  若按 `time` 过滤翻页，会漏掉大量「早先发出、至今仍在被讨论」的帖子——
  实测同一窗口按 `time` 只抓到 28 条，按 `lastPostTime` 是 1290 条，**差 46 倍**。
  做时间窗统计时，边界判定一律用 `lastPostTime`，并清醒「窗口是活跃窗而非发帖窗」。
- `/topic/search/board/{id}/tag` 返回 `{count, topics:[...]}`（不是裸数组）；
  `/board/{id}/topic` 与 `/topic/search` 返回裸数组。`count` 是该标签历史累计总量（如 tag1=92 → 7.2 万），
  不是本窗数量。
- 楼层接口未开放：`/topic/{id}/post` → **401**（需更高权限），`/post/topic/{id}` → **404**。
  普通 token 拿不到楼层正文，只能靠列表里的 `lastPostContent`（末帖摘要）作满足度代理。不要尝试绕过。
- **人工判定不可省。** 纯正则统计在「求课程资源」上有系统性偏差：会漏「思考题/裸名词标题
  （如『工图习题集答案』）/误挂在资源标签下的索要帖」三类，也会误收「打卡/刷课/组队捞人」。
  实测正则候选 68 条中约 40% 需人工剔除、另有约 30% 需人工补入。
- 自动化浏览器（Chrome for Testing / 内置浏览器）被站点拒绝（ERR_CONNECTION_CLOSED），
  但 node HTTP 可达 → 全程纯 HTTP，不要试图绕浏览器指纹。
- www.cc98.org/api/* 是 SPA fallback（返回 HTML 壳），不是 API；API 在 api.cc98.org，
  路由无 /api 前缀（/topic/search 而非 /api/topic/search）。
- apiUrl/openIdUrl 来自 /static/config.json + config.Production.json；
  路由从 main bundle 的 Ua() 调用提取。
- Git Bash 会把以 / 开头的命令行参数转成 Windows 路径 → 跑 probe 时设 MSYS_NO_PATHCONV=1。
- 搜索 keyword 需 encodeURIComponent；size=每页条数，from=偏移。

## 脚本用法
```
node scripts/login.mjs www.cc98.org           # 登录/刷新 token
node sites/www.cc98.org/crawler.mjs --list
node sites/www.cc98.org/crawler.mjs search --keyword 资源 --size 20 --out r.json
node sites/www.cc98.org/crawler.mjs survey --keywords 资源,选课,奖学金 --size 15 --out s.json
node sites/www.cc98.org/search-sweep.mjs --keywords gemini,梯子 --size 20 --out sweep.json
node sites/www.cc98.org/search-sweep.mjs --keywords gemini --floors --max 40 --out out.json  # 附带 Top6 楼层
```

## 调查发现（2026-11-17，8 关键词×15 条初步样本）
学生关于学校资源的提问主要集中在：
1. 课程学习资源（最高频，学习天地板）：课程资料/历年卷/考试复习整理。
2. 选课与课程信息：选课/退课求助、考核方式、给分制度（等级制/百分制）。
3. 奖学金：申请渠道（院设/外设）、发放、资格。
4. 校园设施与地点定位（校园信息板）：打印机/教学科/计算中心在哪。
5. 图书馆服务：检索证明（EI）、空间环境。
6. 科研升学资源：实验室/导师推荐、学习项目资源。
7. 生活资源：宿舍（电话/钥匙/收纳）、二手交易；食堂多为评价吐槽而非资源询问。
相关版块：学习天地(68)、校园信息、科研学术、医学院、求职广场、日用交易。
样本文件 _survey.json；扩大样本用 survey 操作（脚本串行限流）。

## AI 订阅与梯子的舆论（2026-11-20 检索）

检索口径：`search-sweep.mjs --keywords gemini,Gemini,订阅,梯子,VPN,科学上网 --size 20`（14 词扩检去重 206 帖，
落盘 `ai-subscription-vpn-sweep.json`；逐帖读楼层 `/topic/{id}/post`）。全部为**用户自述**，非官方信息，不可当作可靠性背书。

**订阅获取（真实共识，按提及频次）**
1. **淘宝/闲鱼买 Gemini 学生认证（SheerID）**：30~50 元过认证，年付学生价。多名用户实测「一天/几个月仍可用」。
   坑：商家普遍**无质保**；认证后仍需绑卡（另买「代绑卡」）；学生版在 Antigravity 里**模型用不全**（6705121#6、6704577#12「只有 paid pro 才能用」）。
2. **日区/土区自开号 + 学生认证**：日区 Pro 约 ¥30/月、可用约 4 年（6706077#6、6708653#8「日区学生优惠 30r/月」）；
   土区新号约 24r/月但**仅 3 个月**（6708653#6）。需外币卡（「去申请一张外币卡很快」6708653#4）。
3. **拼车/家庭组**：Gemini Pro 家庭组、AI Ultra 20x 拼车帖高频出现（6709406、6709390、6706897、6705414 送坑位）。
4. **代充/发卡聚合站**：priceai.cc、16688.com.cn 等被点名（6704577#4 自带免责声明、6708653#3、6706077#3 「17块3个月」）。
   常态是「**不知道能活多久**」（6706077#3/#5）。
5. **Pixel 手机赠送会员**：十几元买「一年的 Pixel 赠送」，被称「免费 AI Pro 中权益最好的，可用 Argon/Hydrogen」（6704577#5）。

**风控与风险（用户实证，值得优先相信的部分）**
- **万人骑号 = 设备被远程恢复出厂**：6704873 楼主登入群里抽的 Gemini 20x 共享号后，安卓机被「找回丢失的设备」**远程恢复出厂设置**，
  Google Play 被删。教训：不要把来源不明的共享 Google 账号登到自己的主力设备/手机上。
- **Google 账号封号**：6704893「一登录 Claude 就提示被封」，申诉是唯一路径；6706077#0「买了个 24 个月的账号不到 24min 就封了，
  又买了个 6 个月老账号弹手机验证登不上」。**买来的老号/白号寿命以分钟计**是常态。
- **代充是灰色产业**：6708422 复盘文下最高赞质疑是「灰产创业吗，有互联网经营服务许可证吗」（#6）；楼内自评「好像有点（灰）」（#2）。
- 支付换区**不保证生效**：6703196 万事达日区、地址日本，Play 商店 country 仍显示 China，等 72h 无效。

**梯子（学生实际在用的，全部带邀请返利，须自行去魅）**
- 被点到名的：nexi（¥120/月，被吐槽 HK 节点常挂、>100ms，6669050）、魔戒、flyintpro（¥35/月 150G 三设备，6671119）、
  nanocloud、okgg、mojie、mesl、glados、feifeigo、smjcgw（¥13/年 120G）、三元店、良心云。
- **几乎每条推荐都带 aff 邀请码/返利**（6669050#8/#12、6671119#13/#15/#18、6707387#0/#7）。荐者自述「有返利」，
  这是本站此类帖的结构性偏差：**推荐密度不等于质量**。
- **「自己搭」是高频且被认可的回答**：6669050#1「自己搭服务器」、#3「一个月 120 都能自己搭出很好的体验」、
  #7 楼主最终「买 vps 自己搭了」。想稳定的人最后都走向自建 + 静态 IP（#2「买个静态 IP 吧」）。
- **不稳定是常态且可观测**：6708663「三个平台（okgg/mojie/ssone）都没几个节点能用」，#7「这几天一直在 tcp 阻断」；
  6709070 glados 无节点、当日 09:05「已修复」。客户端差异也影响（#5「换商家的应用就没问题了，手机端小火箭一直没出过问题」）。
- **校内相关**：RVPN/aTrust/WebVPN 是校方通道（6709255、6708861），与商业机场不是一回事，别混为一谈。

**检索坑补充**
- `size` 传字符串会 400（必须 number）；上限 20。
- 部分关键词直接 403（如「代充」），属站点词表/风控限制，换同义词即可，不要重试。
- 搜「翻墙」返回 0 条，但「科学上网」「梯子」「机场」命中很多 —— **该站用委婉语，检索要用站内惯用语**。

## 待探（unverified）
- 取主题全部楼层的路由（/post/topic/... 待抓包确认）。
- board-search / topic-top 已发现未单独实现。

## 坑的修正（2026-11-19）
- **楼层接口 `/topic/{id}/post` 现在可用**（当初 401 需更高权限，如今普通 token 可读正文+全部回复）。
  参数：`from` + `size`，**size 上限 20**（>20 返回 `invalid_from_or_size` 400）。
- **单帖接口 `/topic/{id}` 不含正文**，只有 `lastPostContent`（末帖摘要）。正文必须走楼层接口。
- **fetch 在本机不可用**：env 代理出口在墙外，CC98 是 10.10.98.98 内网 → fetch 必 timeout。
  必须用 node:https 或 `lib/http.mjs`（已改造为 https）。详见 MEMORY.md「本机网络陷阱」。
- **API 在 api.cc98.org**，site.json 的 origin 是 www.cc98.org。相对路径会打到 SPA 壳返回 HTML。
  必须写全 `https://api.cc98.org/...`。
- token 有效期 3600s，过期重跑 `scripts/login.mjs www.cc98.org`（该脚本也已从 fetch 改为 node:https）。

## 电子书来源调查（2026-11-20）

**问题**：「大家电子书一般从哪些网站找到的？」

**可复跑脚本（无网络、只读本地证据集）**：
- `node sites/www.cc98.org/ebook-stats.mjs` —— 从证据集重算各来源提及帖数（`--json` 出机读）
- `node sites/www.cc98.org/ebook-solve-rate.mjs` —— 「求电子书」类帖的 0 回复率/实质应答率
- `node sites/www.cc98.org/verify.mjs` —— 校验报告中每个 `帖id#楼层` 锚点都真实存在于证据集
- `node sites/www.cc98.org/full-floor0.mjs <帖id>` —— 打印某帖主楼全文（清洗 HTML）
- `node sites/www.cc98.org/batch-floors.mjs <id,id,…> <max> <out.json>` —— 批量抓楼层（串行 2s，需 token）
- `node sites/www.cc98.org/probe-ebook-hosts.mjs` —— 电子书站可达性单发探测（无凭据）
**产物**：`ebook-sources.md`（结论+规律+合规说明）、`ebook-sources.evidence.json`（84 帖楼层原文证据）。

**方法**：`/topic/search` 7 轮 108 关键词（1123 条命中）→ 合并去重 84 帖 → `/topic/{id}/post` 读楼层正文。
串行 ≥2s、零写操作。临时脚本与中间数据在 `_scratch/`（batch-floors / search-sweep / probe* / rank*.mjs）。

**核心结论**（分母 71 条来源相关帖）：

| 来源 | 提及帖 | 备注 |
|---|---|---|
| Z-Library 及镜像 | **39** | 断层第一；话题核心是「网址」不是「站」 |
| 淘宝/闲鱼代找 | 11 | 2–3 元/本；上游就是 ucdrs + 图书互助油猴脚本 |
| 超星/读秀/汇雅 | 11 | 校内包库；下载得 PDG 非 PDF |
| 维基/官方 X/GitHub 查地址 | 11 | **能力层**，社区公认最可靠的防李鬼手段 |
| GitHub 课程资料库/合集 | 10 | 浙大特色，教材+课件打包 |
| 文献传递/馆际互借 | 7 | 当天到，学校补贴；中文古早书的核心场景 |
| Tor/onion | 7 | 通道 |
| Anna's Archive | 6 | 更全但慢；读秀资源已大量同步过去 |
| 网盘转存 | 6 | 二次分发，链接易失效 |
| LibGen | 5 | 不用注册的补充位 |
| 全国图书馆参考咨询联盟 | 4 | 50 页/次，多邮箱拼整本 |

**最值钱的一条规律**：书的出版年份决定该去哪一层——今年刚换版的新教材，影子图书馆和淘宝**双无解**
（6625253#3、6433029#9），只有纸质/问学长/文献传递；旧书则 3–5 楼内解决。

**可达性实测（2026-11-20 20:40–20:55，本机直连）**：
- 导航站 `zlib.wwwnav.com` / `zz.sodanav.com` / `getzlib.com` 均 **200**（比「正规域名」更易直连，因为它们本就为被墙用户设计）。
- `z-lib.by` **503 Cloudflare JS 挑战**（域名活着，非宕机）；`1lib.sk` 超时；`singlelogin.re` ECONNRESET。
- `zh.den101.ru` / `zh.fin101.ru` / `zh.laoshihao.ru` / `intl.su` **四个历史域名现在 301 到同一个 z-lib.by**（镜像收敛）。
- `annas-archive.is/.gl/.pk` **200**；`.org` 超时；`.vg` 证书过期。`libgen.li` **200**；`.rs/.is/.gs` 挂。
- `open-slum.org` **200**（影子图书馆在线监控，可用于交叉验证）。`jiumo.org` **200**（自报 17,629 本）。
- `duxiu.com` **200**（跳 login，三入口）；`ucdrs.superlib.net` **200**；`cadal.edu.cn` ECONNRESET。

**坑（增补）**：
- 「Google 搜 Z-Library」是**最容易踩李鬼**的路径（5876876#0）；已知李鬼 `z-lib.io/.is/.id`、`zlib.app`。
  判据：李鬼书目少 + 要开会员；正主域名一律从维基/官方 X/GitHub 取。
- 每日下载额度样本**互相矛盾**（5 本 / 10 本 / 无限），不可当准数。
- 检索委婉语补充：搜「电子书」命中杂（阅读器/推书），**「zlib」「安娜」「代找」「教材电子版」命中率更高**。

## 限流精确值（2026-11-22，按 dsh-zju-assistant 清单核对）

本 wiki 早前只写「保守默认 2s / 并发 1，未触发 429」。补上更精确的一组数字：

| 接口类型 | 服务端限制 | 建议间隔 | 撞限流退避 |
|---|---|---|---|
| **搜索接口** | **1 次/秒**，超出回 403 `last_search_in_1_seconds` | **≥ 1.1s** | 0.75s → 1.25s → 2s |
| 其它读接口 | 无明确证据 | ≥ 250ms | 同上 |

来源：`dsh-zju-campus` 的 `cc98/api.ts` 注释（2026-11 核对），本机无法复核（见下）。

### 本机无法复核的原因（实测）

2026-11-22 实测三个入口全部 `ECONNRESET`：

```
https://api.cc98.org/                     → ECONNRESET
https://api.cc98.org/topic/search?...     → ECONNRESET
https://www.cc98.org/                     → ECONNRESET
```

DoH 查真实 IP：**`10.10.98.98`** —— 这是 **RFC1918 私有地址**（`10.0.0.0/8`），
即 CC98 **整体部署在校内网**。本机代理出口在墙外，直连私有地址必然不通。

**结论**：上面那组限流数字是**外部已知信息，非本机实测**。要用需先有校内网络通道（WebVPN 或校园网）。
这与本 wiki 第 139 行的既有结论一致（「fetch 在本机不可用，CC98 是 10.10.98.98 内网」）。

### 为什么仍然值得记

限流值是**使用纪律**，不必本机复核也该遵守：

- 搜索按 **1.1s/次** 打，不要 2s 一刀切（浪费时间）也不要 <1s（必撞限流）
- 撞到 403 `last_search_in_1_seconds` 时按 0.75/1.25/2 指数退避，**不要立刻重试**（会延长封禁）
- 站务公告明确禁止爬取论坛数据，违者全站锁定 365 天以上 —— **这条比技术限流更硬**

## 上游剩余端点的核对（2026-11-22）

### 新增 3 条免鉴权 GET

| 端点 | 返回 | 说明 |
|---|---|---|
| `GET /board/{id}/tag-v2` | 200，`{layers,tags:[{id,name,subTags}]}` | 板块标签树；`/board/68/tag-v2` 实测含「讨论/求助/资源」 |
| `GET /user/name/{name}` | 200，1,147B | 用户公开资料（`postCount/prestige/privilege/registerTime` 等） |
| `GET /topic/{id}/isfavorite` | 200，`false` | 匿名恒 false；登录后才有意义 |

### 实测为需登录（与旧记录不符的要更正）

| 端点 | 实测 | 备注 |
|---|---|---|
| `GET /board/{id}/topic` | **401 `cannot_entry_board`** | 旧记录写「已有路径记录」，但匿名进不去该板块 |
| `GET /topic/{id}/hot-post` | 401 | 需登录 |
| `GET /user/{id}/recent-topic` | 401 | 需登录（可能还要求本人） |

### 按纪律不请求

- `/post/topic/specific-user`：按作者过滤，牵涉用户行为画像，不批量试。
- `/post/{id}/original`：只对「有权编辑的本人楼层」有意义，属本人侧。
- `/notification/*`：本人通知，需登录。
- `file.cc98.org` 附件直链：按不批量取附件纪律不做。
