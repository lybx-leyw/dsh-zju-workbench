# 软件学院官网（www.cst.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 软件学院 |
| 栏目 | 公告公示 |
| 列表地址 | `http://www.cst.zju.edu.cn/gggs/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.cst.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 四个精确公开栏目（2026-11-22）

- http://www.cst.zju.edu.cn/zytz_49383/list.htm：旧版栏目 › 校园服务 › 重要通知（大类 旧版栏目），14 条，外链 0；CMS 声明 21 条 / 2 页
- http://www.cst.zju.edu.cn/36233/list.htm：旧版栏目 › 实习就业 › 最新通知（大类 旧版栏目），14 条，外链 0；CMS 声明 304 条 / 22 页
- http://www.cst.zju.edu.cn/36191/list.htm：旧版栏目 › 教学管理（大类 旧版栏目），14 条，外链 0；CMS 声明 24 条 / 2 页
- http://www.cst.zju.edu.cn/36216/list.htm：旧版栏目 › 教学管理 › 教务信息（大类 旧版栏目），14 条，外链 0；CMS 声明 69 条 / 5 页

- 身份：li.col_path 完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名（本站四栏同属「旧版栏目」）。
- 版面：ul.news_list.list2 > li.news > a.news_link，日期在 div.news_date（YYYY.MM.DD 点分隔），标题在 div.news_title。
- 单篇文章页：/36192（思政工作）内容区只有 div.wp_column_article 一篇正文，无列表无分页无总数，标 container-only 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.cst.zju.edu.cn /36233/list.htm --summary。
