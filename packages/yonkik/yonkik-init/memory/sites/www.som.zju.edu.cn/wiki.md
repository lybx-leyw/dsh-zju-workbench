# 管理学院官网（www.som.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 管理学院 |
| 栏目 | 更多>> |
| 列表地址 | `http://www.som.zju.edu.cn/xwdt/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.som.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 讲座活动（2026-11-22）

- http://www.som.zju.edu.cn/xshd/list.htm：新闻中心 › 讲座活动（5 条 / 1623 总 / 325 页）

- 每页只有 5 条（per_count=5），远少于其他站的 14–20 条。
- 日期写成 [YYYY/MM/DD]。
- 首屏 1 条指向微信公众号外链，属正常采集。
