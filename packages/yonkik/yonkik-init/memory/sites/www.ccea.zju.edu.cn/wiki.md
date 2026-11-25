# 建筑工程学院官网（www.ccea.zju.edu.cn）

- 站点走公开 HTTP；固定单页首屏、不带凭据、不跟跳转。

## 十个精确公开栏目（2026-11-22）

- http://www.ccea.zju.edu.cn/gsgg_77254/list.htm：国际交流 › 公示公告（大类 国际交流），14 条，外链 0；CMS 声明 1322 条 / 95 页
- http://www.ccea.zju.edu.cn/18459/list.htm：学生工作 › 学生事务（大类 学生工作），14 条，外链 0；CMS 声明 434 条 / 31 页
- http://www.ccea.zju.edu.cn/18461/list.htm：学生工作 › 学生组织（大类 学生工作），14 条，外链 0；CMS 声明 269 条 / 20 页
- http://www.ccea.zju.edu.cn/19119/list.htm：学生工作 › 学生事务 › 评奖评优（大类 学生工作），14 条，外链 0；CMS 声明 1153 条 / 83 页
- http://www.ccea.zju.edu.cn/19120/list.htm：学生工作 › 学生事务 › 学生资助（大类 学生工作），14 条，外链 0；CMS 声明 440 条 / 32 页
- http://www.ccea.zju.edu.cn/zpxx/list.htm：就业工作 › 通知公告 › 就业信息（大类 就业工作），14 条，外链 4；CMS 声明 3517 条 / 252 页
- http://www.ccea.zju.edu.cn/xytz/list.htm：就业工作 › 通知公告 › 学院通知（大类 就业工作），14 条，外链 3；CMS 声明 83 条 / 6 页
- http://www.ccea.zju.edu.cn/12261/list.htm：国际交流 › 交流资助 › 公派资助（大类 国际交流），14 条，外链 8；CMS 声明 63 条 / 5 页
- http://www.ccea.zju.edu.cn/18417/list.htm：教育教学 › 研究生教育 › 学籍管理（大类 教育教学），14 条，外链 0；CMS 声明 66 条 / 5 页
- http://www.ccea.zju.edu.cn/18418/list.htm：教育教学 › 研究生教育 › 学位申请（大类 教育教学），14 条，外链 1；CMS 声明 81 条 / 6 页

- 身份：li.col_path 完整链路 + span.Column_Anchor 大类名。
- 版面：ul.news_list.list2 > li.news，标题在 span.news_title > a，日期在 span.news_meta（YYYY-MM-DD）。
- 别名不一致：/18403/list.htm 标题是教学教务，但面包屑末项指向 /18410/，两个地址同栏目，未开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.ccea.zju.edu.cn /18459/list.htm --summary。

## 学生工作（2026-11-22）

- http://www.ccea.zju.edu.cn/xsgz/list.htm：学生工作（14 条 / 18 总 / 2 页）

- 一级栏目，面包屑只有「首页 › 学生工作」。
- 版面与院内其他栏一致：ul.news_list.list2，标题在 span.news_title > a，日期在 span.news_meta。
