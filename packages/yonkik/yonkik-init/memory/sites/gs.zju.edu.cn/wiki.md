# 地球科学学院官网（gs.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 地球科学学院 |
| 栏目 | 通知公告 |
| 列表地址 | `http://gs.zju.edu.cn/35109/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site gs.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 十二个精确公开栏目（2026-11-22）

- http://gs.zju.edu.cn/34774/list.htm：通知公告 › 重要通知（大类 通知公告），19 条，外链 12；CMS 声明 1495 条 / 75 页
- http://gs.zju.edu.cn/35100/list.htm：学生工作 › 通知公告（大类 学生工作），20 条，外链 0；CMS 声明 729 条 / 37 页
- http://gs.zju.edu.cn/35103/list.htm：学生工作 › 奖助贷补（大类 学生工作），20 条，外链 0；CMS 声明 465 条 / 24 页
- http://gs.zju.edu.cn/35102/list.htm：学生工作 › 团学建设（大类 学生工作），20 条，外链 0；CMS 声明 213 条 / 11 页
- http://gs.zju.edu.cn/35122/list.htm：就业指导 › 通知公告（大类 就业指导），20 条，外链 0；CMS 声明 168 条 / 9 页
- http://gs.zju.edu.cn/35081/list.htm：教育教学 › 本科生教育 › 信息公告（大类 教育教学），20 条，外链 0；CMS 声明 43 条 / 3 页
- http://gs.zju.edu.cn/35088/list.htm：教育教学 › 研究生教育 › 通知公告（大类 教育教学），18 条，外链 9；CMS 声明 18 条 / 1 页
- http://gs.zju.edu.cn/35089/list.htm：教育教学 › 研究生教育 › 培养管理（大类 教育教学），12 条，外链 2；CMS 声明 12 条 / 1 页
- http://gs.zju.edu.cn/35091/list.htm：教育教学 › 研究生教育 › 学位管理（大类 教育教学），6 条，外链 2；CMS 声明 6 条 / 1 页
- http://gs.zju.edu.cn/35109/list.htm：国际交流 › 通知公告（大类 国际交流），20 条，外链 9；CMS 声明 25 条 / 2 页
- http://gs.zju.edu.cn/gsxx/list.psp：通知公告 › 公示信息（大类 通知公告），20 条，外链 0；CMS 声明 321 条 / 17 页
- http://gs.zju.edu.cn/35056/list.psp：学院党政 › 通知公告（大类 学院党政），6 条，外链 0；CMS 声明 6 条 / 1 页

- 身份：span.Column_Anchor 大类名 + 「当前位置」完整链路 + span.Column_Name 标题，三者一致。
- 版面：div#wp_news_wNN > li.list_guild（img 图标 + a + span 日期）；/34774 首屏 20 个候选中有一条重复链接，去重后 19 条。
- .htm 与 .psp 并存：/gsxx/ 和 /35056/ 的 /list.htm 301 到同站 /list.psp，实测内容有效；但上游清单未列这两条，按「不扩基线」原则只作旁证记录，不新增目录行、不开放通路。
- 复用：node sites/zju-notices/crawler-columns.mjs column gs.zju.edu.cn /34774/list.htm --summary。

## 补充两栏（2026-11-22）

- http://gs.zju.edu.cn/gsxx/list.psp：通知公告 › 公示信息（20 条 / 321 总 / 17 页）
- http://gs.zju.edu.cn/35056/list.psp：学院党政 › 通知公告（6 条 / 6 总 / 1 页）
