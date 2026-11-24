# 农业与生物技术学院官网（office.cab.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 农业与生物技术学院 |
| 栏目 | 最新通知 |
| 列表地址 | `http://office.cab.zju.edu.cn/28947/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site office.cab.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 五个精确公开栏目（2026-11-22）

- http://office.cab.zju.edu.cn/28876/list.htm：学生工作（大类 学生工作），14 条，外链 0；CMS 声明 64 条 / 5 页
- http://office.cab.zju.edu.cn/28972/list.htm：本科生教育 › 教学培养（大类 本科生教育），13 条，外链 9；CMS 声明 13 条 / 1 页
- http://office.cab.zju.edu.cn/28974/list.htm：本科生教育 › 对外交流（大类 本科生教育），10 条，外链 0；CMS 声明 10 条 / 1 页
- http://office.cab.zju.edu.cn/28985/list.htm：研究生教育 › 海外交流（大类 研究生教育），14 条，外链 2；CMS 声明 58 条 / 5 页
- http://office.cab.zju.edu.cn/29000/list.htm：国际合作与交流 › 师生交流（大类 国际合作与交流），14 条，外链 0；CMS 声明 389 条 / 28 页

- 身份：li.col_path 完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名 + li.col_title 的 h2 标题。
- 版面：ul.wp_article_list > li.list_item，标题在 span.Article_Title > a（a 的 title 属性也完整），日期在 span.Article_PublishDate。
- 标题差异：页面 <title> 与 h2 可能不同（/28949 是「国际合作与交流」对「通知公告」），校验只比 h2。
- 别名不一致：/28946 末项自认 /28971、/28947 自认 /28979、/28949 自认 /28999，均标 identity-mismatch 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column office.cab.zju.edu.cn /28876/list.htm --summary。
