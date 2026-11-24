# 外国语学院官网（www.sis.zju.edu.cn）

- 站点走公开 HTTP；固定单页首屏、不带凭据、不跟跳转。

## 八个精确公开栏目（2026-11-22）

- http://www.sis.zju.edu.cn/sischinese/12596/list.htm：学生思政 › 评奖评优，14 条，外链 0；CMS 声明 349 条 / 25 页
- http://www.sis.zju.edu.cn/sischinese/12597/list.htm：学生思政 › 学生资助，14 条，外链 0；CMS 声明 293 条 / 21 页
- http://www.sis.zju.edu.cn/sischinese/12600/list.htm：学生思政 › 学生组织，14 条，外链 3；CMS 声明 44 条 / 4 页
- http://www.sis.zju.edu.cn/sischinese/12610/list.htm：对外交流 › 国际交流，14 条，外链 0；CMS 声明 371 条 / 27 页
- http://www.sis.zju.edu.cn/sischinese/12587/list.htm：研究生教育 › 教学教务，14 条，外链 7；CMS 声明 67 条 / 5 页
- http://www.sis.zju.edu.cn/sischinese/12554/list.htm：党政管理 › 最新通知，14 条，外链 8；CMS 声明 472 条 / 34 页
- http://www.sis.zju.edu.cn/sischinese/12577/list.htm：本科教育 › 最新通知，14 条，外链 0；CMS 声明 957 条 / 69 页
- http://www.sis.zju.edu.cn/sischinese/12609/list.htm：对外交流 › 最新通知，14 条，外链 1；CMS 声明 378 条 / 27 页

- 身份：div.dqwzdd「当前位置」完整链路（末项须等于本栏路径）+ div.dqwzlm 栏目标题。
- 版面：ul.news_list.list2 > li.news，标题在 span.news_title > a，日期在 span.news_meta（YYYY-MM-DD）。
- 父子同路径：/12577、/12609 的面包屑里父级和末项都是本路径，只是文字不同，须比对文字。
- 别名不一致：/12541 末项自认 /12584、/12542 自认 /12593，均标 identity-mismatch 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.sis.zju.edu.cn /sischinese/12596/list.htm --summary。
