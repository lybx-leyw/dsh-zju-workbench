# 公共管理学院官网（www.spa.zju.edu.cn）

- 站点只支持公开 HTTP：robots 404；不带凭据、不跟跳转、不重试。

## 十二个精确公开栏目（2026-11-22）

- http://www.spa.zju.edu.cn/spaoffice/14508/list.htm：学生思政 › 学生团建，14 条，外链 0；CMS 声明 706 条 / 51 页
- http://www.spa.zju.edu.cn/spaoffice/14509/list.htm：学生思政 › 学工事务，14 条，外链 0；CMS 声明 1048 条 / 75 页
- http://www.spa.zju.edu.cn/spaoffice/14507/list.htm：学生思政 › 学生党建，14 条，外链 0；CMS 声明 116 条 / 9 页
- http://www.spa.zju.edu.cn/spaoffice/13987/list.htm：研究生教育 › 最新通知，14 条，外链 0；CMS 声明 2369 条 / 170 页
- http://www.spa.zju.edu.cn/spaoffice/14473/list.htm：国际事务 › 学生交流，14 条，外链 0；CMS 声明 116 条 / 9 页
- http://www.spa.zju.edu.cn/spaoffice/zxtz/list.htm：本科教育 › 最新通知，14 条，外链 0；CMS 声明 802 条 / 58 页
- http://www.spa.zju.edu.cn/spachinese/jzhd_75663/list.htm：新闻中心 › 讲座活动，14 条，外链 0；CMS 声明 295 条 / 22 页
- http://www.spa.zju.edu.cn/spaoffice/14486/list.htm：专业学位教育 › 最新通知，14 条，外链 1；CMS 声明 44 条 / 4 页
- http://www.spa.zju.edu.cn/spaoffice/14746/list.htm：党政管理 › 最新通知，14 条，外链 2；CMS 声明 368 条 / 27 页
- http://www.spa.zju.edu.cn/spaoffice/14511/list.htm：学生思政 › 就业指导，14 条，外链 0；CMS 声明 1075 条 / 77 页
- http://www.spa.zju.edu.cn/spaoffice/14513/list.htm：学生思政 › 心理资助，14 条，外链 0；CMS 声明 33 条 / 3 页
- http://www.spa.zju.edu.cn/spaoffice/13991/list.htm：研究生教育 › 学位管理，14 条，外链 0；CMS 声明 121 条 / 9 页

- 身份：「当前位置」col_path 完整链路逐项比对，加 col_title 的 h2 复核。
- 同路径父子：/spaoffice/zxtz/ 既当「本科教育」又当「最新通知」，须比对文字而非只比 href。
- 版面：ul.news_list.list2 > li > span.news_title > a + span.news_meta；笔记：讲座活动栏的 h2 跨行，需去空白后比对。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.spa.zju.edu.cn /spaoffice/14508/list.htm --summary。
