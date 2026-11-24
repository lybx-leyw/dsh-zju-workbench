# 哲学学院官网（www.philosophy.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 哲学学院 |
| 栏目 | 最新通知 |
| 列表地址 | `http://www.philosophy.zju.edu.cn/64649/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.philosophy.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 十二个精确公开栏目（2026-11-22）

- http://www.philosophy.zju.edu.cn/64683/list.htm：学生思政 › 评奖评优，14 条（本页），外链 0；CMS 声明 185 条 / 14 页
- http://www.philosophy.zju.edu.cn/64684/list.htm：学生思政 › 学生资助，14 条（本页），外链 1；CMS 声明 153 条 / 11 页
- http://www.philosophy.zju.edu.cn/gggs_65461/list.htm：国际合作 › 公告公示，14 条（本页），外链 0；CMS 声明 315 条 / 23 页
- http://www.philosophy.zju.edu.cn/zxtz/list.htm：教育教学 › 本科生教育 › 最新通知，14 条（本页），外链 3；CMS 声明 115 条 / 9 页
- http://www.philosophy.zju.edu.cn/64672/list.htm：学术研究 › 学术活动，14 条（本页），外链 2；CMS 声明 218 条 / 16 页
- http://www.philosophy.zju.edu.cn/zxtz_65348/list.htm：教育教学 › 研究生教育 › 最新通知，14 条（本页），外链 2；CMS 声明 149 条 / 11 页
- http://www.philosophy.zju.edu.cn/64679/list.htm：学生思政 › 最新通知，14 条（本页），外链 0；CMS 声明 172 条 / 13 页
- http://www.philosophy.zju.edu.cn/dwjl/list.htm：教育教学 › 研究生教育 › 对外交流，14 条（本页），外链 1；CMS 声明 59 条 / 5 页
- http://www.philosophy.zju.edu.cn/64670/list.htm：学术研究 › 最新通知，14 条（本页），外链 9；CMS 声明 39 条 / 3 页
- http://www.philosophy.zju.edu.cn/64681/list.htm：学生思政 › 学生团建，14 条（本页），外链 0；CMS 声明 44 条 / 4 页
- http://www.philosophy.zju.edu.cn/xwgl/list.htm：教育教学 › 研究生教育 › 学位管理，14 条（本页），外链 1；CMS 声明 15 条 / 2 页
- http://www.philosophy.zju.edu.cn/64676/list.htm：国际合作 › 国际交流，7 条（本页），外链 1；CMS 声明 7 条 / 1 页

- 身份：「当前位置」col_path 完整链路（去掉首页）逐项比对，加 col_title 的 h2 复核。
- 三栏同名「最新通知」：本科生教育、研究生教育、学生思政各一条，只能靠链路层级区分。
- 版面：div#wp_news_w6 > ul.news_list.list2 > li.news，标题在 span.news_title > a，日期在 span.news_meta。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.philosophy.zju.edu.cn /64683/list.htm --summary。
