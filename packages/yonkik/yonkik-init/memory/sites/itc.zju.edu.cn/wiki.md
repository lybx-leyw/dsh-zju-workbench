# 信息技术中心（itc.zju.edu.cn）

> **本页索引**：这是什么 · 能力 · 搜索协议（与 ugrs 同款） · 专栏清单 · 坑 · 只读边界

**状态**：done（2026-11-20）｜**鉴权**：**全站免登录**｜**限流**：串行 2s
**脚本**：`crawler.mjs`（search / page / health）｜苏迪 Webplus 平台

---

## 这是什么

浙大信息技术中心（ITC）门户。管的是**校园网、VPN/RVPN、邮箱、正版软件、网络安全**这些「上网相关」的事，
以及各类服务的**收费标准**和**办理指南**。

学生实际会查的：校园网怎么开、网费多少、RVPN 怎么连、邮箱怎么配、软件在哪下。

**与相邻站的分工**：

| 站 | 管什么 |
|---|---|
| `itc.zju.edu.cn` | IT 服务的**政策、通知、收费标准、办理指南**（门户，免登录） |
| `net3.zju.edu.cn` | 上网认证（**实测 502，已挂**） |
| `myvpn.zju.edu.cn` | 网费管理（已 done） |
| `vpn.zju.edu.cn` | aTrust VPN 客户端入口（302 到 aTrust 2.0） |
| `webvpn.zju.edu.cn` | WebVPN 网页版（302） |
| `ms.zju.edu.cn` | 正版软件目录 + MD5（已 done） |
| `zjuem.zju.edu.cn` | 浙大邮箱（SMTP **994**，已 done） |

## 能力

```bash
node sites/itc.zju.edu.cn/crawler.mjs health
node sites/itc.zju.edu.cn/crawler.mjs search "VPN"
node sites/itc.zju.edu.cn/crawler.mjs search "校园网" 2
node sites/itc.zju.edu.cn/crawler.mjs page /90618/list.htm
```

实测（2026-11-20）：`VPN` → **257 条**，`校园网` → **327 条**，结果带创建者/发布时间/目录。

最新一条相关通知是 **2026-10-15《信息技术中心关于RVPN系统升级的通知》**。

## 搜索协议（与 ugrs 完全同款）

**这是本轮最有复用价值的发现**：`itc` 与 `ugrs` 是同一套 Webplus 检索引擎，协议一模一样，只是 `_p` 签名不同。

```
POST https://itc.zju.edu.cn/_web/_search/api/searchCon/create.rst?_p=<itc的签名>&tt=<随机>

searchInfo = base64(JSON.stringify([{field:'pageIndex',value:1},{field:'keyword',value:'VPN'},...]))
```

`itc` 的 `_p` = `YXM9MTQ2JnQ9MzM0MyZkPTE2ODE2JnA9MSZtPVNO`
（`ugrs` 的是 `YXM9MzgmdD0zMDA2JmQ9MTQyODkmcD0xJm09U04m`）—— **两者不通用，各用各的**。

回包结构、`data` 是 HTML 片段、九元组字段顺序，全部见 `sites/ugrs.zju.edu.cn/wiki.md` 的详细说明，此处不重复。

## 专栏清单（从首页导航抓，均为 list.htm 型）

| 专栏 | 路径 |
|---|---|
| 个人服务办理 | `/90650/list.htm` |
| 单位服务办理 | `/90651/list.htm` |
| 中心概况 | `/90608/list.htm` |
| 中心介绍 | `/90641/list.htm` |
| 机构设置 | `/90642/list.htm` |
| **中心黄页** | `/90644/list.htm` |
| 规章制度 | `/90610/list.htm` |
| 政策法规 | `/90628/list.htm` |
| 学校制度 | `/90629/list.htm` |
| 新闻资讯 | `/90617/list.htm` |
| **通知公告** | `/90618/list.htm` |
| 网络安全 | `/90612/list.htm` |
| 网安权威发布 | `/90647/list.htm` |
| 网安资讯站 | `/90619/list.htm` |
| 网安互动吧 | `/90817/list.htm` |
| 工会活动 | `/90820/list.htm` |
| 党群工作 | `/90609/list.htm` |

另有两个跨站指向值得记：
- **网安训练营** → `https://courses.zju.edu.cn/course/59743/content#/`（学在浙大课程，需登录）
- **党建工作** → `https://itc.zju.edu.cn/dangzb/`（子站）

## 坑

- **`_p` 不能跨站复用**。itc 与 ugrs 协议相同但签名不同，串用会拿到与关键词无关的结果。
- **搜索结果里「收费标准」条目重复多条**（不同 `c94xxx` 栏目下同名），是站方栏目结构问题，不是脚本 bug。
- **标题里有零宽字符**：如「​信息技术中心关于RVPN系统升级的通知」开头带 `\u200b`。
  按标题做精确匹配或去重时要先 strip 掉零宽字符（`\u200b\u200c\u200d\ufeff`）。
- **`net3.zju.edu.cn`（上网认证）实测 502** —— 它跟 itc 是两个独立的站，不要因为 itc 好着就以为上网认证也能用。

## 只读边界

`search` 与 `page` 都是查询。不提供任何办理、缴费、开网操作。

## 未闭环

- **收费标准正文**：搜索能定位到条目，但「多少钱」在详情页正文里，没逐条展开。
  真要知道具体金额，`search "收费标准"` 后取 `href` 再 `page` 抓。
- **服务办理的在线入口**：个人服务办理多在 `service.zju.edu.cn`（已 done），itc 这边只是说明页。
- **首页 147KB** 里可能还有更多子站链接没枚举（只取了前 22 个）。

## 通知公告与公开门户的鉴权差异（2026-11-22）

/90618/list.htm 301 到 HTTP .psp；直接试同站 HTTPS /90618/list.psp 则 302 到校园 CAS。公开首页与全站搜索的历史证据不变，但这个栏目匿名访问不成立；未登录、未验证数据内容。

## 通知公告需 CAS（2026-11-22）

完整跳转链（逐跳取证）：
- https://itc.zju.edu.cn/90618/list.htm -> 301 http://itc.zju.edu.cn/90618/list.psp
- http://itc.zju.edu.cn/90618/list.psp -> 301 https://itc.zju.edu.cn/90618/list.psp
- https://itc.zju.edu.cn/90618/list.psp -> 302 https://zjuam.zju.edu.cn/cas/login

- 终点是统一身份认证登录页，未持凭据无法取得内容与条数。
- 归档为「认证后可访问的独立场景」，不计入公开通路。
