# 马克思主义学院官网（marx.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 马克思主义学院 |
| 栏目 | 教学改革 |
| 列表地址 | `http://marx.zju.edu.cn/23459/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site marx.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 十二个精确公开栏目（2026-11-22）

- http://marx.zju.edu.cn/marxbg/23602/list.htm：学生思政 › 评奖评优（大类 学生思政），20 条，外链 0；CMS 声明 164 条 / 9 页
- http://marx.zju.edu.cn/marxbg/xsh/list.htm：学生思政 › 学生会（大类 学生思政），20 条，外链 0；CMS 声明 28 条 / 2 页
- http://marx.zju.edu.cn/marxbg/23588/list.htm：研究生教育 › 最新通知（大类 研究生教育），20 条，外链 0；CMS 声明 387 条 / 20 页
- http://marx.zju.edu.cn/marxbg/23604/list.htm：学生思政 › 就业指导（大类 学生思政），20 条，外链 2；CMS 声明 292 条 / 15 页
- http://marx.zju.edu.cn/marxbg/23524/list.htm：学生思政 › 最新通知（大类 学生思政），20 条，外链 1；CMS 声明 175 条 / 9 页
- http://marx.zju.edu.cn/marxbg/23522/list.htm：思政教学 › 最新通知（大类 思政教学），20 条，外链 3；CMS 声明 232 条 / 12 页
- http://marx.zju.edu.cn/marxbg/bksjy/list.htm：本科生教育 › 最新通知（大类 本科生教育），20 条，外链 1；CMS 声明 60 条 / 3 页
- http://marx.zju.edu.cn/marxbg/23541/list.htm：党政管理 › 信息公告（大类 党政管理），20 条，外链 0；CMS 声明 53 条 / 3 页
- http://marx.zju.edu.cn/marxbg/23583/list.htm：思政教学 › 现场教学（大类 思政教学），20 条，外链 0；CMS 声明 365 条 / 19 页
- http://marx.zju.edu.cn/marxbg/szry/list.htm：学生思政 › 思政荣誉（大类 学生思政），3 条，外链 0；CMS 声明 3 条 / 1 页
- http://marx.zju.edu.cn/marxbg/23593/list.htm：研究生教育 › 对外交流（大类 研究生教育），14 条，外链 6；CMS 声明 14 条 / 1 页
- http://marx.zju.edu.cn/marxbg/jxpy/list.htm：本科生教育 › 教学培养（大类 本科生教育），16 条，外链 0；CMS 声明 16 条 / 1 页

- 身份：div.cg-position「当前位置」完整链路逐项比对 + h2 大类名复核。
- 版面：ul.cg-news-list#arthd > li，标题在 a 的文本里（title 属性是空串，不能当标题），日期在 span.art-date。
- 父栏渲染子栏：/marxbg/23524、/marxbg/23522、/marxbg/bksjy 三个地址的链路末项都是子栏「最新通知」，请求路径只作为父级出现。
- 复用：node sites/zju-notices/crawler-columns.mjs column marx.zju.edu.cn /marxbg/23602/list.htm --summary。
