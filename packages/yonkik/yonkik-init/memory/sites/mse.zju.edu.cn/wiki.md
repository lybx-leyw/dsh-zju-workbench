# 材料科学与工程学院官网（mse.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 材料科学与工程学院 |
| 栏目 | 消息公告 |
| 列表地址 | `https://mse.zju.edu.cn/50946/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site mse.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 十一个精确公开栏目（2026-11-22）

- https://mse.zju.edu.cn/51031/list.htm：学生思政 › 学生事务（大类 学生思政），20 条，外链 0；CMS 声明 545 条 / 28 页
- https://mse.zju.edu.cn/51043/list.htm：国际交流 › 外事通知（大类 国际交流），20 条，外链 3；CMS 声明 218 条 / 11 页
- https://mse.zju.edu.cn/50999/list.htm：教育教学 › 研究生教学 › 消息公告（大类 教育教学），20 条，外链 1；CMS 声明 902 条 / 46 页
- https://mse.zju.edu.cn/51029/list.htm：学生思政 › 学生党建（大类 学生思政），20 条，外链 0；CMS 声明 237 条 / 12 页
- https://mse.zju.edu.cn/50983/list.htm：教育教学 › 本科生教学 › 消息公告（大类 教育教学），20 条，外链 1；CMS 声明 569 条 / 29 页
- https://mse.zju.edu.cn/51001/list.htm：教育教学 › 研究生教学 › 学位申请（大类 教育教学），20 条，外链 1；CMS 声明 60 条 / 3 页
- https://mse.zju.edu.cn/50963/list.htm：党政综合 › 综合办公室 › 消息公告（大类 党政综合），20 条，外链 0；CMS 声明 89 条 / 5 页
- https://mse.zju.edu.cn/50982/list.htm：教育教学 › 研究生教学（大类 教育教学），14 条，外链 5；CMS 声明 14 条 / 1 页
- https://mse.zju.edu.cn/51027/list.htm：学生思政 › 最新消息（大类 学生思政），20 条，外链 0；CMS 声明 1768 条 / 89 页
- https://mse.zju.edu.cn/51050/list.htm：招生就业 › 就业工作（大类 招生就业），6 条，外链 0；CMS 声明 6 条 / 1 页
- https://mse.zju.edu.cn/50920/list.htm：学生思政（大类 学生思政），20 条，外链 1；CMS 声明 43 条 / 3 页

- 身份：li.col_path「当前位置」完整链路 + span.Column_Anchor 大类名，两者都要匹配。
- 版面：ul.news_list.list2 > li.news，标题在 span.news_title > a，日期在 span.news_meta，格式是 YYYY.MM.DD（点号），需转换。
- 容器页：/50918/list.htm 渲染「教育教学」大类导航，无列表与分页，不可解析，故不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column mse.zju.edu.cn /51031/list.htm --summary。
