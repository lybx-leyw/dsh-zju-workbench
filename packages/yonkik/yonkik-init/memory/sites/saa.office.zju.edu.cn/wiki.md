# 航空航天学院官网（saa.office.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 航空航天学院 |
| 栏目 | 通知公告 |
| 列表地址 | `http://saa.office.zju.edu.cn/tzgg_70388/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site saa.office.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 十个精确公开栏目（2026-11-22）

- http://saa.office.zju.edu.cn/tzgg_70388/list.htm：学生工作 › 通知公告（大类 学生工作），14 条，外链 0；CMS 声明 1732 条 / 124 页
- http://saa.office.zju.edu.cn/66850/list.htm：党政综合 › 通知公告（大类 党政综合），14 条，外链 8；CMS 声明 677 条 / 49 页
- http://saa.office.zju.edu.cn/tzgg_70383/list.htm：本科生教育 › 通知公告（大类 本科生教育），14 条，外链 3；CMS 声明 1226 条 / 88 页
- http://saa.office.zju.edu.cn/tzgg_70384/list.htm：研究生教育 › 通知公告（大类 研究生教育），14 条，外链 3；CMS 声明 571 条 / 41 页
- http://saa.office.zju.edu.cn/66861/list.htm：本科生教育 › 实践教学（大类 本科生教育），14 条，外链 0；CMS 声明 223 条 / 16 页
- http://saa.office.zju.edu.cn/66866/list.htm：研究生教育 › 培养过程（大类 研究生教育），14 条，外链 0；CMS 声明 148 条 / 11 页
- http://saa.office.zju.edu.cn/67666/list.htm：学生工作 › 奖助贷补（大类 学生工作），14 条，外链 1；CMS 声明 41 条 / 3 页
- http://saa.office.zju.edu.cn/66921/list.htm：国际交流 › 经费资助（大类 国际交流），14 条，外链 1；CMS 声明 64 条 / 5 页
- http://saa.office.zju.edu.cn/66920/list.htm：国际交流 › 交流活动（大类 国际交流），14 条，外链 3；CMS 声明 267 条 / 20 页
- http://saa.office.zju.edu.cn/66773/list.htm：研究生教育（大类 研究生教育），6 条，外链 0；CMS 声明 6 条 / 1 页

- 身份：li.col_path 完整链路（含末项必须等于本栏路径）+ span.Column_Anchor 大类名。
- 版面：ul.news_list.list2 > li.news，标题在 span.news_title > a，日期在 span.news_meta（YYYY-MM-DD）。/66861 的页面标题带前导空格，需去空白后比对。
- 别名不一致：/66964 末项自认 /67668/、/dwjl 末项自认 /tzgg_70387/，同栏目两个地址，均标 identity-mismatch 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column saa.office.zju.edu.cn /tzgg_70388/list.htm --summary。
