# 能源工程学院官网（www.doe.zju.edu.cn）

- 站点走公开 HTTP；与 doe-oa（办公网）是同一学院的两个站。

## 两个精确公开栏目（2026-11-22）

- http://www.doe.zju.edu.cn/74397/list.htm：学生工作 › 科创竞赛（大类 学生工作），2 条，外链 2；CMS 声明 2 条 / 1 页
- http://www.doe.zju.edu.cn/74389/list.htm：研究生教育 › 信息公告（大类 研究生教育），20 条，外链 2；CMS 声明 122 条 / 7 页

- 身份：li.col_path 完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名。
- 版面：div.col_news_list > div.jzlb（内 div.btt3 > a 标题、div.fbsj4 日期），每页 20 条。
- 别名：/74364 与 /74397 渲染同一栏目内容，页面末项自认 /74397，按 /74397 记录，/74364 标 identity-mismatch。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.doe.zju.edu.cn /74389/list.htm --summary。
