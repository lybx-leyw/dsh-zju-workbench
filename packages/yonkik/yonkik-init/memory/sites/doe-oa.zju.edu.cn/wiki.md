# 能源工程学院官网（doe-oa.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 能源工程学院 |
| 栏目 | 学工 |
| 列表地址 | `http://doe-oa.zju.edu.cn/75536/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site doe-oa.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 六个精确公开栏目（2026-11-22）

- http://doe-oa.zju.edu.cn/75472/list.htm：人力资源 › 信息公告（大类 人力资源），14 条，外链 0；CMS 声明 581 条 / 42 页
- http://doe-oa.zju.edu.cn/75509/list.htm：研究生教育 › 课程培养 › 通知公告（大类 研究生教育），14 条，外链 0；CMS 声明 34 条 / 3 页
- http://doe-oa.zju.edu.cn/75516/list.htm：研究生教育 › 论文答辩 › 答辩通知（大类 研究生教育），14 条，外链 0；CMS 声明 74 条 / 6 页
- http://doe-oa.zju.edu.cn/75536/list.htm：学生工作 › 学工（大类 学生工作），14 条，外链 0；CMS 声明 552 条 / 40 页
- http://doe-oa.zju.edu.cn/77471/list.htm：研究生教育 › 专业实践 › 通知公告（大类 研究生教育），11 条，外链 0；CMS 声明 11 条 / 1 页
- http://doe-oa.zju.edu.cn/jxgg/list.htm：本科生教育 › 教学改革（大类 本科生教育），14 条，外链 0；CMS 声明 59 条 / 5 页

- 身份：li.col_path 完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名 + li.col_title 的 h2 标题，三者一致。
- 版面：ul.news_list.list2 > li，标题在 span.news_title > a，日期在 span.news_meta（YYYY-MM-DD）。/75435 的页面标题带前导空格，需去空白后比对。
- 别名不一致：/75431 末项自认 /75479、/75435 自认 /tw、/75436 自认 /75545，均标 identity-mismatch 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column doe-oa.zju.edu.cn /75536/list.htm --summary。
