# 研在浙大（research.zju.edu.cn）

> **本页索引**：这是什么 · 已确认的入口 · 为什么只到 partial · 复用建议

**状态**：**partial**（2026-11-20）｜**鉴权**：匿名门户壳免登录，内容接口需登录

---

## 这是什么

浙大科研门户（苏迪 sopplus 平台的匿名版）。首页按学科分类（哲学/工学/经济学/农学/法学/医学/
教育学/军事学/文学/管理学/历史学/艺术学/理学/交叉学科）聚合科研资讯、科研活动、科研团队。

## 已确认的入口

免登录可达的只有一个**匿名门户壳**：

```
https://research.zju.edu.cn/sopplus/_web/customized/portalPages/anonymousIndex.jsp?_p=YXM9MiZ0PTUmZD0xNjYmcD0xJmY9NTAmbT1OJg__
```

18,694 字节，但**正文是空的** —— 所有内容由 `js/anonymousIndex.js`（40,271B）异步渲染。

从这个 JS 里读出的真实入口：

| 路径 | 用途 | 实测 |
|---|---|---|
| `portalPages/articleCenter.jsp?_p=…&siteId=1` | 资讯中心 | **301，无 Location** |
| `portalPages/serviceCenter/server.jsp?_p=…` | 服务大厅 | **301，无 Location** |
| `portalPages/serviceCenter/details.jsp?_p=…&id=` | 服务详情 | 未测 |
| `sopplus/mobile/openModule.do?_p=…` | 移动端模块 | 未测 |

## 为什么只到 partial

1. **内容接口全 301**：`articleCenter.jsp` 与 `serviceCenter.jsp` 直接 GET 都返回 301 且不带 `Location`，
   实际是重定向到登录页（HTTP 层看不到目标）。说明**匿名壳能打开，但里面没有匿名数据**。
2. **壳里的静态内容也已陈旧**：匿名页 HTML 里硬编码的示例数据显示 `2024-12-11`、
   「浙江大学地方科技合作平台2020年度工作研讨会」等，另有「暂无数据」占位。
   即便能取，时效性也不足以支撑「查最新科研资讯」这类需求。

**结论**：这不是「站挂了」，而是**它是一个登录后才有内容的系统，匿名页只是装饰**。
与 `service.zju.edu.cn`（办事指南免登录、办理才要登录）不同 —— 这站连资讯都不给匿名。

## 复用建议

**不要把它当科研资讯源**。真正免登录、能查科研信息的替代：

| 需求 | 去哪 |
|---|---|
| 科研政策/制度/收费公示 | `zjulab.zju.edu.cn`（设备处门户，已 done） |
| 科研办事指南 | `service.zju.edu.cn`（49 应用目录，已 done） |
| 学术文献检索 | `zju.summon.serialssolutions.com`（280 万级，已 done） |
| 科研团队/个人主页 | `person.zju.edu.cn`（教师主页，入口见下） |

### 顺带记：person.zju.edu.cn 的入口坑（已实测）

教师信息站的根路径行为很绕，实测（2026-11-20）：

| URL | 结果 |
|---|---|
| `http://person.zju.edu.cn/` | **502** |
| `https://person.zju.edu.cn/` | 302 → `http://person.zju.edu.cn/index` |
| `http://person.zju.edu.cn/index` | **502**（跟着那个 302 走会掉坑里） |
| `https://person.zju.edu.cn/index` | 301 → `https://person.zju.edu.cn/index/` |
| **`https://person.zju.edu.cn/index/`** | **200，1305B** —— 正确入口，**末尾斜杠不能丢** |

页面本身是 **Vue SPA**（`<div id=app>` + `/index/static/js/{manifest,vendor,app}.*.js`），
由 **`cemyun.com`（彩萌云）** 平台驱动，且加载了 `frms-fingerprint.js` **设备指纹 SDK**。

**所以**：根路径 502 是**站点配置问题**（HTTP→HTTPS 回落坏了），不是站挂了；
真正的入口必须带 `/index/` 且带末尾斜杠。指纹 SDK 的存在说明该站有反自动化措施，
脚本化检索需要谨慎（此处未做，只定位了入口）。

本站在 `_index.json` 里仍是 pending —— 这轮只定位了入口，没深探教师检索接口。

## 未闭环

- 登录后的科研数据（科研项目、成果、团队）未探，需账号。
- `serviceCenter/details.jsp` 与 `openModule.do` 未测。
- `person.zju.edu.cn` 的教师检索接口（按姓名/院系查主页）未做；设备指纹是否拦截纯 HTTP 未验证。
