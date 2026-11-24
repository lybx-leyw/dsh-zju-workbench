# 信息与电子工程学院官网（www.isee.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 信息与电子工程学院 |
| 栏目 | 更多 >> |
| 列表地址 | `http://www.isee.zju.edu.cn/xsbg/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.isee.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 七个精确公开栏目（2026-11-22）

- http://www.isee.zju.edu.cn/51190/list.psp：通知公告 › 全部通知，20 条，外链 0；CMS 声明 13070 条 / 654 页
- http://www.isee.zju.edu.cn/51191/list.psp：通知公告 › 公示公告，20 条，外链 0；CMS 声明 624 条 / 32 页
- http://www.isee.zju.edu.cn/51193/list.psp：通知公告 › 本科生教学，20 条，外链 0；CMS 声明 2642 条 / 133 页
- http://www.isee.zju.edu.cn/51194/list.psp：通知公告 › 研究生教学，20 条，外链 2；CMS 声明 865 条 / 44 页
- http://www.isee.zju.edu.cn/51195/list.psp：通知公告 › 学生工作，20 条，外链 0；CMS 声明 4076 条 / 204 页
- http://www.isee.zju.edu.cn/51199/list.psp：通知公告 › 对外交流，20 条，外链 0；CMS 声明 34 条 / 2 页
- http://www.isee.zju.edu.cn/51200/list.psp：通知公告 › 就业实习，20 条，外链 0；CMS 声明 3040 条 / 152 页

- 身份：div.list-top_pos「您的位置」完整链路（末项须等于本栏路径）+ span.titl 栏目标题。
- 版面：ul.list_top > li.list_guild，日期被拆成 div.time 内 h3（日）+ p（YYYY-MM），需拼合；标题在 p.title > a。
- 别名不一致：/21056 末项自认 /21061、/21057 自认 /21064、/50891 自认 /50899，均标 identity-mismatch 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.isee.zju.edu.cn /51190/list.htm --summary。
