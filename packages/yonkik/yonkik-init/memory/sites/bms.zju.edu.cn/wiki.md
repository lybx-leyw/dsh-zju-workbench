# 基础医学系官网（bms.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 基础医学系 |
| 栏目 | 研究院公告 |
| 列表地址 | `https://bms.zju.edu.cn/85174/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site bms.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 一个精确公开栏目（2026-11-22）

- https://bms.zju.edu.cn/85147/list.htm：教育教学 › 研究生教育教学（20 条，外链 16；CMS 声明 119 条 / 6 页）

- 身份：div.list-top_pos 全链路 + Column_Anchor 大类名 + span.titl 栏目标题。
- 版面：div#wp_news_wNN > ul.list_top > li.list_guild，标题在 a（title 属性完整），日期在紧随 span，每页 20 条。
- 别名不一致：/85097 末项自认 /85146，且清单标签「教育教学」与页面「本科生教育教学」不同，标 identity-mismatch。
- 复用：node sites/zju-notices/crawler-columns.mjs column bms.zju.edu.cn /85147/list.htm --summary。
