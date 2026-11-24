# 网络空间安全学院官网（icsr.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 网络空间安全学院 |
| 栏目 | 招生公告 |
| 列表地址 | `https://icsr.zju.edu.cn/zsgg/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site icsr.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 一个精确公开栏目（2026-11-22）

- https://icsr.zju.edu.cn/xsgz/list.htm：人才培养 › 学生工作（14 条，外链 0；CMS 声明 35 条 / 3 页）

- 身份：li.col_path 完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名 + li.col_title 的 h2 标题。
- 版面：ul.news_list.list2 > li，标题在 span.news_title > a，日期在 span.news_meta，每页 14 条。
- 别名不一致：/xsjl（学术讲座）末项自认 /xsjz/，标 identity-mismatch 不开放；同目录下 /xsjz 才是页面自认的地址，但清单未列、未验证。
- 复用：node sites/zju-notices/crawler-columns.mjs column icsr.zju.edu.cn /xsgz/list.htm --summary。
