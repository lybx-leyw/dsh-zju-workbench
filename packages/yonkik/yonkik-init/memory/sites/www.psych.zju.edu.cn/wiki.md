# 心理与行为科学系官网（www.psych.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 心理与行为科学系 |
| 栏目 | 更多 |
| 列表地址 | `http://www.psych.zju.edu.cn/27575/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.psych.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 四个精确公开栏目（2026-11-22）

- http://www.psych.zju.edu.cn/27565/list.htm：学生天地，20 条，外链 0；CMS 声明 1125 条 / 57 页
- http://www.psych.zju.edu.cn/27568/list.htm：国际交流，20 条，外链 2；CMS 声明 242 条 / 13 页
- http://www.psych.zju.edu.cn/27572/list.htm：研究生教育，20 条，外链 8；CMS 声明 23 条 / 2 页
- http://www.psych.zju.edu.cn/27573/list.htm：本科生教育，20 条，外链 0；CMS 声明 41 条 / 3 页

- 边界：仅公开 HTTP 单页 GET，无凭据、不跟跳转、不重试；HTTPS 443 拒绝连接。
- 身份：本站无独立面包屑，改用 p.title（窗口5）中的链接序列校验：末项路径须等于本栏路径、文字须等于列表标题。
- 版面：div#wp_news_wNN > ul > li 内 a + span.time(YYYY-MM-DD)；外链只记地址不访问。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.psych.zju.edu.cn /27565/list.htm --summary。
