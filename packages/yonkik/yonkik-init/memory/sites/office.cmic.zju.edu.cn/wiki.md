# 传媒与国际文化学院官网（office.cmic.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 传媒与国际文化学院 |
| 栏目 | 最新通知 |
| 列表地址 | `http://office.cmic.zju.edu.cn/zxtz_40722/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site office.cmic.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 十一个精确公开栏目（2026-11-22）

- http://office.cmic.zju.edu.cn/zxtz_40722/list.htm：学生思政 › 最新通知（大类 学生思政），25 条，外链 0；CMS 声明 3329 条 / 134 页
- http://office.cmic.zju.edu.cn/40748/list.htm：其他 › 通知公告 › 重要通知（大类 其他），25 条，外链 0；CMS 声明 2225 条 / 89 页
- http://office.cmic.zju.edu.cn/40523/list.htm：学生思政 › 学生资助（大类 学生思政），25 条，外链 0；CMS 声明 486 条 / 20 页
- http://office.cmic.zju.edu.cn/40505/list.htm：研究生教育 › 教学培养（大类 研究生教育），20 条，外链 1；CMS 声明 20 条 / 1 页
- http://office.cmic.zju.edu.cn/40520/list.htm：学生思政 › 学生团建（大类 学生思政），25 条，外链 0；CMS 声明 334 条 / 14 页
- http://office.cmic.zju.edu.cn/40496/list.htm：本科教育 › 最新通知（大类 本科教育），25 条，外链 0；CMS 声明 841 条 / 34 页
- http://office.cmic.zju.edu.cn/40524/list.htm：学生思政 › 思政教育（大类 学生思政），25 条，外链 0；CMS 声明 114 条 / 5 页
- http://office.cmic.zju.edu.cn/40454/list.htm：学生思政（大类 学生思政），25 条，外链 0；CMS 声明 38 条 / 2 页
- http://office.cmic.zju.edu.cn/40521/list.htm：学生思政 › 就业信息（大类 学生思政），25 条，外链 0；CMS 声明 902 条 / 37 页
- http://office.cmic.zju.edu.cn/40465/list.htm：党政管理 › 最新通知（大类 党政管理），25 条，外链 0；CMS 声明 316 条 / 13 页
- http://office.cmic.zju.edu.cn/40529/list.htm：国际合作 › 通知公示（大类 国际合作），25 条，外链 6；CMS 声明 120 条 / 5 页

- 身份：div.cg-position 完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名。
- 版面：ul.cg-news-list#arthd > li，标题在 a（title 属性有值，正文可能被截断），日期在 span.art-date；每页 25 条。
- 复用：node sites/zju-notices/crawler-columns.mjs column office.cmic.zju.edu.cn /zxtz_40722/list.htm --summary。
