# 脑科学与脑医学系官网（www.neuroscience.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 脑科学与脑医学系 |
| 栏目 | 通知公告 |
| 列表地址 | `http://www.neuroscience.zju.edu.cn/45530/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.neuroscience.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 六个精确公开栏目（2026-11-22）

- http://www.neuroscience.zju.edu.cn/45474/list.htm：教育思政，15 条，外链 2；CMS 声明 60 条 / 4 页
- http://www.neuroscience.zju.edu.cn/xssz/list.htm：教育思政 › 学生思政，15 条，外链 0；CMS 声明 56 条 / 4 页
- http://www.neuroscience.zju.edu.cn/gsgg_54816/list.psp：综合服务 › 公示公告，11 条，外链 0；CMS 声明 11 条 / 1 页
- http://www.neuroscience.zju.edu.cn/dwjl/list.htm：交流合作 › 国际交流，15 条，外链 13；CMS 声明 39 条 / 3 页
- http://www.neuroscience.zju.edu.cn/dxsxly_75666/list.htm：教育思政 › 大学生夏令营，9 条，外链 0；CMS 声明 9 条 / 1 页
- http://www.neuroscience.zju.edu.cn/bksjy/list.htm：教育思政 › 本科生教育，5 条，外链 3；CMS 声明 5 条 / 1 页

- 身份：div.list-top_pos「您的位置」完整链路（末项须等于本栏路径）+ span.titl 栏目标题。
- 版面：ul.list_top > div#wp_news_wNN > li.list_guild，日期拆在 div.time 的 h3（日）与 p（YYYY-MM），标题在 p.title > a。
- 扩展名：/gsgg_54816 的 .htm 301 到同站 .psp。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.neuroscience.zju.edu.cn /45474/list.htm --summary。
