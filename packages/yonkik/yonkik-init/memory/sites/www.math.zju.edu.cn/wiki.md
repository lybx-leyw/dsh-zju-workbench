# 数学科学学院官网（www.math.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 数学科学学院 |
| 栏目 | School Colloquium |
| 列表地址 | `http://www.math.zju.edu.cn/SchoolColloquium/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.math.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 十个精确公开栏目（2026-11-22）

- http://www.math.zju.edu.cn/38100/list.htm：评奖评优（父栏 党群学工），10 条，外链 0；CMS 声明 427 条 / 43 页
- http://www.math.zju.edu.cn/38101/list.htm：学生资助（父栏 党群学工），10 条，外链 0；CMS 声明 117 条 / 12 页
- http://www.math.zju.edu.cn/66212/list.htm：团学通知（父栏 党群学工），10 条，外链 0；CMS 声明 377 条 / 38 页
- http://www.math.zju.edu.cn/38088/list.htm：培养工作（父栏 研究生），10 条，外链 0；CMS 声明 39 条 / 4 页
- http://www.math.zju.edu.cn/38090/list.htm：毕业学位（父栏 研究生），10 条，外链 0；CMS 声明 43 条 / 5 页
- http://www.math.zju.edu.cn/38086/list.htm：研究生（父栏 研究生），10 条，外链 2；CMS 声明 153 条 / 16 页
- http://www.math.zju.edu.cn/38077/list.htm：本科生（父栏 本科生），10 条，外链 1；CMS 声明 100 条 / 10 页
- http://www.math.zju.edu.cn/dwjl/list.htm：对外交流（父栏 本科生），10 条，外链 0；CMS 声明 60 条 / 6 页
- http://www.math.zju.edu.cn/38102/list.htm：学生文件资料（父栏 党群学工），10 条，外链 1；CMS 声明 19 条 / 2 页
- http://www.math.zju.edu.cn/tmgztz/list.htm：免试研究生推荐（父栏 本科生），4 条，外链 0；CMS 声明 4 条 / 1 页

- 身份：本页没有「当前位置」面包屑；判据是「窗口22」里最后一段 r_link 的首链接（路径须等于本栏路径、文字须等于标题）＋ h2 标题＋「窗口05」父栏目名三者同时匹配。
- 版面：ul.news_list > div#wp_news_wNN > li.wow，日期被拆成 p.d（日）与 p.y（YYYY-MM）两段，需拼合后校验。
- 别名：/38081/ 的页面自认 /bylw/，/38080/ 自认 /zxzyqr/；数字路径与语义别名并存，未确认权威地址，不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.math.zju.edu.cn /38100/list.htm --summary。
