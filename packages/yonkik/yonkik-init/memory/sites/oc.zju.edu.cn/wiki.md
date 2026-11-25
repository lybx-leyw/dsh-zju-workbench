# 海洋学院官网（oc.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 海洋学院 |
| 栏目 | 通知公告 |
| 列表地址 | `http://oc.zju.edu.cn/tzgg/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site oc.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 两个精确公开栏目（2026-11-22）

- http://oc.zju.edu.cn/tzgg/list.htm：学院动态 › 通知公告（目录「学院动态·通知公告」），20 条，外链 0；CMS 声明 471 条 / 24 页
- http://oc.zju.edu.cn/86050/list.htm：学院动态 › 学术活动（目录「学术活动」），20 条，外链 0；CMS 声明 130 条 / 7 页

- 身份：div.weizhi 内 h1 栏目标题 + 「父栏目」span + 页面脚本自报的 var url（须等于清单路径）。
- 版面：div#wp_news_wNN > div.news_con > ul > li，嵌套 a（外层无文字、内层带 title），日期在紧随 span。
- 复用：node sites/zju-notices/crawler-columns.mjs column oc.zju.edu.cn /tzgg/list.htm --summary。
