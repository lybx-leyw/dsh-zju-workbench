# 动物科学学院官网（office.cas.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 动物科学学院 |
| 栏目 | 研究生事务 |
| 列表地址 | `http://office.cas.zju.edu.cn/15927/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site office.cas.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 六个精确公开栏目（2026-11-22）

- http://office.cas.zju.edu.cn/15927/list.htm：学子在线 › 研究生事务（大类 学子在线），20 条，外链 0；CMS 声明 681 条 / 35 页
- http://office.cas.zju.edu.cn/15893/list.htm：国际交流 › 通知公告（大类 国际交流），19 条，外链 17；CMS 声明 52 条 / 3 页
- http://office.cas.zju.edu.cn/15929/list.htm：学子在线 › 就业工作（大类 学子在线），20 条，外链 2；CMS 声明 416 条 / 21 页
- http://office.cas.zju.edu.cn/16447/list.htm：本科生教育 › 实践竞赛 › 实践教学（大类 本科生教育），12 条，外链 0；CMS 声明 12 条 / 1 页
- http://office.cas.zju.edu.cn/16449/list.htm：本科生教育 › 实践竞赛 › 学科竞赛（大类 本科生教育），10 条，外链 0；CMS 声明 10 条 / 1 页
- http://office.cas.zju.edu.cn/15925/list.htm：学子在线 › 学生党建（大类 学子在线），20 条，外链 0；CMS 声明 185 条 / 10 页

- 身份：li.col_path 完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名 + li.col_title 的 h2 标题。
- 版面：div.col_news_list > ul.news_list.list2 > li.news，标题在 span.news_title > a，日期在 span.news_meta，每页 20 条。
- 容器页：/15889（实践竞赛）把三个子栏各渲染成一段 ul.wp_subcolumn_list 拼在一页，CMS 总数 19 是子栏之和；已标 container-only，不开放。子栏 /16447、/16449 单独验证，/16448 科研训练未验证。
- 重复链接：/15893 首屏 20 个候选里 1 个是同一 URL 的重复项，去重后 19 条。
- 复用：node sites/zju-notices/crawler-columns.mjs column office.cas.zju.edu.cn /15927/list.htm --summary。
