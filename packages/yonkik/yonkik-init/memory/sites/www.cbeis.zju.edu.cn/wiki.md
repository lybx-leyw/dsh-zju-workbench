# 生物医学工程与仪器科学学院官网（www.cbeis.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 生物医学工程与仪器科学学院 |
| 栏目 | 通知公告 |
| 列表地址 | `http://www.cbeis.zju.edu.cn/tzgg/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.cbeis.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 六个精确公开栏目（2026-11-22）

- http://www.cbeis.zju.edu.cn/tzgg_65357/list.htm：学生工作 › 通知公告（大类 学生工作），14 条，外链 0；CMS 声明 394 条 / 29 页
- http://www.cbeis.zju.edu.cn/tzgg_65360/list.htm：国际交流 › 通知公告（大类 国际交流），14 条，外链 0；CMS 声明 120 条 / 9 页
- http://www.cbeis.zju.edu.cn/63901/list.htm：教育教学 › 本科生教育 › 通知公告（大类 教育教学），14 条，外链 0；CMS 声明 57 条 / 5 页
- http://www.cbeis.zju.edu.cn/xszz/list.htm：学生工作 › 学生组织（大类 学生工作），14 条，外链 0；CMS 声明 52 条 / 4 页
- http://www.cbeis.zju.edu.cn/tzgg/list.htm：教育教学 › 研究生教育 › 通知公告（大类 教育教学），14 条，外链 4；CMS 声明 198 条 / 15 页
- http://www.cbeis.zju.edu.cn/gsgg/list.psp：通知公告 › 公示公告（大类 通知公告），14 条，外链 0；CMS 声明 133 条 / 10 页

- 身份：div.dc-weizhi「当前位置」完整链路（末项须等于本栏路径）+ div.m1 内 h2 大类名。
- 版面：div#wp_news_wNN > li.list-item > a，日期在 span.time，标题在 span.p > p。
- 父子同路径：/tzgg（教育教学 › 研究生教育 › 通知公告）与 /63901（教育教学 › 本科生教育 › 通知公告）的父级与末项 href 相同、文字不同，须比对文字。
- 扩展名：/gsgg 的 .htm 301 到同站 .psp。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.cbeis.zju.edu.cn /xszz/list.htm --summary。
