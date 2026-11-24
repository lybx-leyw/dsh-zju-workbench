# 光电科学与工程学院官网（opt.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 光电科学与工程学院 |
| 栏目 | 通知公告 |
| 列表地址 | `http://opt.zju.edu.cn/72701/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site opt.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 八个精确公开栏目（2026-11-22）

- http://opt.zju.edu.cn/73609/list.psp：对外交流 › 出国出境公示（大类 对外交流），20 条，外链 0；CMS 声明 363 条 / 19 页
- http://opt.zju.edu.cn/72740/list.psp：学生工作 › 评奖评优（大类 学生工作），20 条，外链 0；CMS 声明 55 条 / 3 页
- http://opt.zju.edu.cn/72768/list.htm：通知公告 › 重点提示（大类 通知公告），20 条，外链 1；CMS 声明 4424 条 / 222 页
- http://opt.zju.edu.cn/72701/list.htm：综合服务 › 通知公告（大类 综合服务），20 条，外链 0；CMS 声明 518 条 / 26 页
- http://opt.zju.edu.cn/72724/list.psp：本科生教育 › 学籍管理（大类 本科生教育），20 条，外链 0；CMS 声明 65 条 / 4 页
- http://opt.zju.edu.cn/72739/list.htm：学生工作 › 团学组织（大类 学生工作），20 条，外链 0；CMS 声明 130 条 / 7 页
- http://opt.zju.edu.cn/tzgg/list.htm：发展联络 › 通知公告（大类 发展联络），20 条，外链 14；CMS 声明 31 条 / 2 页
- http://opt.zju.edu.cn/72735/list.htm：对外交流 › 通知公告（大类 对外交流），20 条，外链 1；CMS 声明 390 条 / 20 页

- 身份：li.col_path 完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名 + li.col_title 的 h2 标题。
- 版面：ul.news_list.list2 > li，标题在 span.news_title > a，日期在 span.news_meta（YYYY-MM-DD），每页 20 条。
- 扩展名：/73609、/72740、/72724 的 .htm 301 到同站 .psp；其余 .htm 直接可用。
- 复用：node sites/zju-notices/crawler-columns.mjs column opt.zju.edu.cn /72701/list.htm --summary。
