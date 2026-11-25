# 公共卫生学院官网（www.phs.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 公共卫生学院 |
| 栏目 | 通知公告 |
| 列表地址 | `http://www.phs.zju.edu.cn/93989/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.phs.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 八个精确公开栏目（2026-11-22）

- http://www.phs.zju.edu.cn/94008/list.htm：人才培养 › 研究生培养（大类 人才培养），14 条，外链 7；CMS 声明 22 条 / 2 页
- http://www.phs.zju.edu.cn/94009/list.htm：人才培养 › 本科生培养 › 培养管理（大类 人才培养），6 条，外链 0；CMS 声明 6 条 / 1 页
- http://www.phs.zju.edu.cn/94011/list.htm：人才培养 › 本科生培养 › 对外交流（大类 人才培养），2 条，外链 0；CMS 声明 2 条 / 1 页
- http://www.phs.zju.edu.cn/94014/list.htm：人才培养 › 研究生培养 › 通知公告（大类 人才培养），14 条，外链 6；CMS 声明 23 条 / 2 页
- http://www.phs.zju.edu.cn/94017/list.htm：人才培养 › 研究生培养 › 学位授予（大类 人才培养），4 条，外链 3；CMS 声明 4 条 / 1 页
- http://www.phs.zju.edu.cn/94021/list.htm：交流合作 › 国际合作 › 通知公告（大类 交流合作），14 条，外链 0；CMS 声明 55 条 / 4 页
- http://www.phs.zju.edu.cn/94024/list.htm：交流合作 › 国际合作 › 国际交流（大类 交流合作），14 条，外链 5；CMS 声明 29 条 / 3 页
- http://www.phs.zju.edu.cn/94033/list.htm：学生工作 › 学生活动（大类 学生工作），14 条，外链 11；CMS 声明 58 条 / 5 页

- 身份：li.col_path 完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名 + li.col_title 的 h2 标题，三者一致。
- 版面：ul.news_list.list2 > li，标题在 span.news_title > a，日期在 span.news_meta（YYYY-MM-DD）。
- 别名不一致：/93961 末项自认 /94007、/93964 自认 /94032，均标 identity-mismatch 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.phs.zju.edu.cn /94033/list.htm --summary。
