# 求是学术搜索（zju.summon.serialssolutions.com）

> Ex Libris **Summon 2.0** 聚合发现系统，浙大图书馆部署。站点自述名称 = `求是学术搜索`（取自 `/custom_data` 的 `site.title`）。
> 探索日期 2026-11-20。全部实测在校园网 IP 下、匿名（未登录 CAS）。

## 本页索引

- ## 一句话结论
- ## 入口与鉴权
- ## 接口（已实测）
- ## 「能不能检索所有图书馆数据库」的判定
- ## 坑
- ## 本次探了什么 / 还剩什么

---

## 一句话结论

**匿名就能做完整的聚合检索**：一次 `GET /api/search?q=...` 返回 2,826,632 条命中 + 25 条文档（含 DOI/摘要/OpenURL/全文链接），全程不用登录。
**这是本次五站里最值得做成检索资产的一站**（理由见末节）。

## 入口与鉴权

| 项 | 值 | 证据 |
|---|---|---|
| origin | `https://zju.summon.serialssolutions.com` | 200 |
| 站点标题 | `求是学术搜索` | `/custom_data` → `site.title` |
| libhash（机构 ID） | `GK4PB6YY8Y` | `/custom_data` → `info.libhash` |
| 机构码 | `86ZJU_INST` | `detail_page.ill_base_url` |
| 鉴权 | **无需登录**。IP 识别 + `rack.session` cookie | `info.authenticated=true`；`s.role=authenticated` 出现在每次查询串里 |
| CAS 登录时机 | 仅 `/library_card`（我的借阅）与 `/research_assistant` 前端路由标 `auth:!0` | application.js 路由表 |
| Cas service | `cas`，session 60 分钟 | `/custom_data` → `authentication.service / session_minutes` |
| WebVPN 提示 | 站点自己挂 banner 指向 `https://webvpn.zju.edu.cn/` | `site.vpn_banner_url` |
| 前端 | AngularJS 1.x SPA，所有数据走 `/api/*` JSON | 页面 12117B 壳 + `application.*.js`（701809B） |

**鉴权关键认知**：`info.authenticated` 是**服务端按 IP 段判定**的。也就是说在校园网内匿名即可享受完整检索与全文解析；离开校园网 IP，同一 URL 的 `s.role` 会掉到 guest，聚合结果与全文链接都会变。这不是登录问题，是网络位置问题。

## 接口（已实测）

全部 `GET`，串行，间隔 ≥2500ms。`site.json` 的 `rateLimit` 标 `source: default`（robots.txt 403，无明文条款）。

| # | method + path | 用途 | 鉴权 | 关键响应结构 |
|---|---|---|---|---|
| 1 | `GET /custom_data` | **元配置**：标题/libhash/字段/facet/OpenURL 地址 | 无 | `var __configData = {...}`，17010B。必先剥 `var __configData = ` 前缀再 `JSON.parse` |
| 2 | `GET /api/search?q=<q>&pn=<n>&raw=true` | **聚合检索** | 无 | `{recordCount, pageCount, documents[25], facetFields[], availabilityPath}` |
| 3 | `GET /api/databases?raw=true` | 机构可见数据库清单 | 无 | `facetFields[0].counts[]`，100/页，`hasMoreFacets:'yes'`，recordCount=1168758646 |
| 4 | `GET /api/facet_values?facet=<F>&pn=<n>&raw=true` | facet 下钻 | 无 | 同上结构，但 **pn 恒被忽略** |
| 5 | `GET /2.0.0/availability/<libhash>?s.id=..` | 馆藏可借状态 | 无 | `availabilityItems[{id, availabilities[{location,callNumber,status}]}]` |
| 6 | `GET /2.0.0/link/0/<opaque>` | **link resolver**，303 到全文/书目 | 无 | 303 链；见下 |

### documents[] 单条字段（实测）

`Title · Author[] · ContentType[] · PublicationYear[] · DOI[] · Abstract · Snippet · IsPeerReviewed[] · hasFullText · inHoldings · DatabaseTitle[] · DatabaseTitleList[] · Source[] · link · openUrl · SummonAdditionalLinks[{databaseName,dbid,providerName,link}] · LinkModel · DeliveryMethod`

- `Title` 里带高亮标记 `<mark>...</mark>`，抓取时要剥。
- `openUrl` 是 **Z39.88 OpenURL 查询串**（不是 URL），可拼到任意 resolver 上。
- `link` 是 Summon 自己的 opaque resolver URL。
- `SummonAdditionalLinks` 才是**出版社全文直链**（如 Springer `10.1007/...`、O'Reilly）。

### link resolver 实测两种落点

1. **无全文** → `303 http://opac.zju.edu.cn/F/-?func=find-b&find_code=SYS&request=000689554&local_base=ZJU09` → 200，约 42KB，标题 `Quantum machine learning : - 西文文献库 - 浙江大学图书馆书目系统`。即**落到 Aleph 书目系统**。
2. **有出版社全文**（走 `SummonAdditionalLinks[].link`）→ 303 `link.springer.com/10.1007/978-1-4842-7098-1` → 301 → 303 idp.springer.com → 302 → 最终 `https://link.springer.com/book/10.1007/978-1-4842-7098-1` **200，275887B**，Springer 图书页正常渲染。

换句话说：**Summon 只负责“路由到出版社/书目系统”，PDF 正文由出版社侧决定是否有权（Springer 那次是开放访问页，不是机构订阅解密）。**

## 「能不能检索所有图书馆数据库」的判定

CC98 主张（帖 5683732）：*「理论上是可以的，但是不是实时更新的」*。实测判定如下。

**前半句「可以检索所有数据库」——部分证实，但要限定口径。**

| 维度 | 实测 |
|---|---|
| 单次检索索引规模 | `recordCount = 2,826,632`（q=machine learning），覆盖 1000+ 万级记录 |
| 数据库 facet 有记录的上限 | `/api/databases` 的 `recordCount = 1,168,758,646`（11.7 亿**数据库内记录计数之和**，不是去重后的条目数，别直接当“11 亿文献”引用） |
| 首屏可见数据库 | 100 个，`hasMoreFacets: yes`（说明还有更多页） |
| 已见的重量级库 | Elsevier Scopus、Web of Science、Elsevier SD ScienceDirect、EBSCO_Academic Search Premier、维普_期刊、万方系、Westlaw Classic、OCLC_MEDLINE、PubMed、DOAJ、Gale、ABI/INFORM、欧洲专利 |
| 是否含**图书馆自建书目** | 是。`Source: ExLibris Aleph`，`Library` facet 直接给到 `玉泉图书馆300`、`紫金港基础图书馆二层南` 等**具体馆藏地+索书号** |

**所以：它确实是一个跨库统一索引，书目 + 全文库 + 专利 + 文献库都在同一个 query 下。** 但「所有」有三个真实边界：

1. **只能检索“已接入 Summon 索引”的库。** 浙大采购的库若未做 Summon 索引（部分中文库、部分试用库、部分仅 OPAC 的西文库），搜不到。这不是隐藏功能，是产品机制。
2. **`hasMoreFacets: yes` 说明库清单本身分页**，且 pn 被忽略 → **无法用匿名接口枚举出“全部”库**（见坑 2）。要拿完整库表得走图书馆的电子资源导航（libweb）而不是 Summon。
3. **“不是实时更新”这半句成立**：`s.dailyCatalog=t` 出现在查询串里，说明书目增量按日批处理；聚合库（Scopus/WoS）本身也比出版社侧滞后。

**最终判定**：CC98 那个回复是**基本正确的，但表述过宽**。准确说法是「能检索已经接入 Summon 统一索引的那部分馆藏，覆盖面和实时性都有限」。

### 数据库清单实证（`/api/databases` 首屏 100 个，2026-11-20）

这是回答「所有数据库」最硬的一份证据。前 20 名按记录数排序：

| # | 数据库 | 记录数 |
|---|---|---|
| 1 | ABI/INFORM Collection | 337,613,032 |
| 2 | Gale_Business Insights: Global | 292,581,810 |
| 3 | 欧洲专利 | 165,499,214 |
| 4 | Research Library | 139,641,625 |
| 5 | Elsevier_Scopus | 104,679,690 |
| 6 | Web of Science | 73,172,288 |
| 7 | Gale In Context: Opposing Viewpoints | 65,575,085 |
| 8 | Gale_World History In Context | 65,366,842 |
| 9 | BiblioSHS - CNRS | 59,343,162 |
| 10 | Freely available e-journals | 56,107,086 |
| 11 | **维普_期刊** | 50,343,912 |
| 12 | Westlaw Classic | 45,415,492 |
| 13 | OCLC_MEDLINE | 30,523,389 |
| 14 | Thomson Reuters_MEDLINE | 30,523,389 |
| 15 | DOAJ Directory of Open Access Journals | 28,560,168 |
| 16 | Health & Medical Collection | 27,471,760 |
| 17 | Journals@Ovid | 25,590,415 |
| 18 | Elsevier SD ScienceDirect Available Journals | 25,026,995 |
| 19 | Elsevier_ScienceDirect期刊 | 24,845,113 |
| 20 | EBSCO_Academic Search Premier | 22,362,730 |

第 21-100 名里能看到：IngentaConnect_期刊（NSTL购买）、NCBI_PubMed Central（免费）、SpringerLink_现刊、Wiley_期刊、国家哲学社会科学文献中心、ProQuest Ebook Central、J-STAGE Free、美国专利_1/_2、万方数据_学位论文、IEL、JSTOR 各专辑、OUP/CUP/SAGE/BMJ/ACS/AIP/LWW 各刊库、HeinOnline_法律期刊（光华法学院购买）、龙源期刊、CAIRN、Project MUSE。

**这里藏着回答「所有数据库」的关键 nuance：**

清单里大量标注了资金来源，且**不全是浙大自己买的**：

- Wiley_过刊（NSTL购买，NSTL平台） · SpringerLink_过刊（NSTL购买） · OUP_牛津大学出版社过刊（NSTL购买） · BMJ_英国医学会过刊（NSTL购买，NSTL平台） · LWW_医学过刊（NSTL购买，Ovid平台） · Taylor & Francis_科技期刊回溯库（NSTL订购） · IngentaConnect_期刊（NSTL购买）
- CUP_剑桥大学出版社过刊（国图购买） · SAGE_过刊（国图购买）
- ACS_美国化学学会期刊（与NSTL共建） · AIP_美国物理联合会现刊（与NSTL共建） · Periodicals Archive Online (PAO)（与CASHL共建）
- HeinOnline_法律期刊（光华法学院购买）

即 **Summon 索引的范围 = 浙大 IP 可触达的整个资源池（含 NSTL/国图/CASHL 共建、院系单独采购、免费 OA 库），而不只是「浙大图书馆自己订的那几个库」**。这既扩大了检索面，也意味着**「检得到」不等于「有权看全文」** —— 比如 NSTL 平台上的 Wiley 过刊，Summon 能索引到元数据，但拿全文要跳 NSTL 平台，浙大 IP 未必有权。

**这正好解释 CC98 6061448「pdf 格式下载、在线浏览都加载不出来」**：命中存在、链条存在，但落地权限不在 Summon 手上。

另附：`/api/facet_values?facet=Discipline` 实测返回 **60 个学科**、`hasMoreFacets:"no"`（这个 facet 不分页，可一次取全，与 DatabaseName 的行为不同）。

## 坑

1. **`/custom_data` 返回的是 JavaScript 不是 JSON。** 内容是 `var __configData = {...};`，直接 `JSON.parse` 会炸。必须先剥前缀。这是本站最容易卡住的一步——但也是最高价值的一步，一次拿到 libhash / 字段表 / 数据库 facet 端点 / OpenURL 地址。
2. **`/api/facet_values` 的 `pn`（页码）被服务端忽略**，与 zdbk 的「GET 分页被忽略」是同一类假象：回 200、有数据、`pageNumber` 回显恒为 1、`counts` 恒 100 条。据此判断「库只有 100 个」是错的。
3. **`/api/document?id=...` 实测返回空 body（0B）**。文档详情其实已经在 `/api/search` 的 `documents[]` 里，不必单发。记为未验证。
4. **`/search?q=...` 的 HTML 是纯 SPA 壳（12165B），不含任何结果**。用 HTML 判断「有没有结果」一定误判。结果只在 `/api/search` 的 JSON 里。
5. **`robots.txt` 返回 403**（`nginx/1.22.1` 默认页）。不是站点挂了，是故意不提供。站点自己用 `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">` 声明不要抓。→ 因此限流只能取保守默认。
6. **自动补全接口 502**：`api.summon.serialssolutions.com/eautocomplete/suggest/search?q=...&site=zju&lang=zh` 返回 `Incomplete response received from application`（Rack 后端崩）。参数名可能不是 `q/site`，未继续试。别把它当检索接口用。
7. **`availability` 的 `status` 实测几乎全是 `unknown`**。原因写在 `/custom_data` 的 `info.dbs[].availabilityParserProperties`：它用 XPath 去 `opac.zju.edu.cn` 抓 `td[5]`，靠正则 `.*in stock.*` / `.*CHECKEDOUT.*` 判态。OPAC 页面结构一变，status 就全变 unknown。**别把 `status` 当成「在架/借出」的可靠信号**；要看 `displayString`（含索书号+馆藏地）。
8. **`availabilityPath` 不要自己拼**。它形如 `/2.0.0/availability/GK4PB6YY8Y?s.id=O7C+000649087&s.id=...`，`s.id` 数量与当页文档数绑定（25 个），`O7C` 是 Aleph base 代码。直接从 search 响应里取。
9. **本机必须用 `node:https`，不能用 `fetch`**。`fetch` 会吃 env 里的 `HTTP_PROXY=<本地代理>`。虽然本站是公网 IP（非 10.x），但为一致性统一用 `https.request` + 显式 Agent（见 MEMORY.md 网络陷阱）。
10. **首次请求偶发 timeout**（`crawler.mjs search` 第一次跑超时，重跑即通）。原因未查明，可能是冷启动/Rack 后端。重试一次即可，不要据此判定接口不可用。

## 本次探了什么 / 还剩什么

**已探（全部只读、单发）**：`/custom_data` · `/api/search`（2 次：machine learning、quantum computing）· `/api/databases` · `/api/facet_values`（DatabaseName pn=2）· availability · link resolver（无全文 1 次 + 有全文 1 次 + SummonAdditionalLinks 1 次）· robots.txt · 首页 · `/search` HTML · `application.js` 静态分析。合计约 12 次请求。

**剩余候选（记在 `endpoints.json` 的 unverified 区，未调用）**：
- `POST /api/bulk_export` — 导出结果集，语义可能产生服务端任务，按只读契约不调。
- `POST /2.0.0/event` — 埋点，明确是写。
- `/api/facet_values` 的完整翻页方案（`listValuesCommand` 只在前端指令里出现，未见实际 HTTP 请求）。
- `citations/cites`、`citations/citedby`、`related_items`（需 httpPost）、`reviews`、`ai_documents`。
- `/research_assistant`（需 CAS）。
- `/sierra_api/*`（`api_integration_enabled=false`，未启用）。

**脚本**：`crawler.mjs`，5 个 op（`search` / `databases` / `facets` / `availability` / `link`），已跑通 `--list` 与 `search`。

## 值不值得做成检索资产？—— 值得，但要认清它是什么

**值得。** 理由：
1. 匿名、纯 GET、无验证码、无 CSRF、单接口覆盖 282 万条命中；
2. 返回结构化 JSON 含 DOI/摘要/OpenURL/全文链，直接可喂下游；
3. `crawler.mjs` 已可复用，`search` 一个 op 就能拿到完整结果集；
4. 它是**浙大自有采购范围的权威视图** ——「这本期刊/会议录浙大有没有订」这件事，Summon 的 `Library` facet 比 Google Scholar 准。

**但不要把它当「全文下载器」。** 实测：`link` 无全文时落 Aleph 书目页（只有纸本馆藏），有全文时落出版社页（是否可见正文由出版社/机构 IP 决定）。Summon 本身不托管 PDF。想批量拿 PDF 得另配出版社侧逻辑，且要遵守各库条款。

**使用建议**：适合做「查某主题浙大有哪些可及文献 + 是否有纸本/电子本」的检索层；不适合做「批量下载」。
