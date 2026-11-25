# 物理学院官网（physics.zju.edu.cn）

- HTTP 同路径 301 到 HTTPS。

## 两个精确公开栏目（2026-11-22）

- https://physics.zju.edu.cn/zxxx_69701/list.htm：研究生教育 › 最新消息（大类 研究生教育），15 条，外链 1；CMS 声明 24 条 / 2 页
- https://physics.zju.edu.cn/zxxx/list.htm：本科生教育 › 最新消息（大类 本科生教育），15 条，外链 3；CMS 声明 20 条 / 2 页

- 身份：span.weizhi「当前位置」全链路 + 左侧导航 menu-item.selected 的 href + div.menu-header 内 h3 大类名。
- 版面：div#wp_news_wNN > li.list-item > a > div.content，日期拆成 span.d（日）与 span.y（YYYY-MM），标题在 div.info > h3。
- 两栏同名「最新消息」（本科生教育 / 研究生教育），靠左侧导航选中项区分。
- 复用：node sites/zju-notices/crawler-columns.mjs column physics.zju.edu.cn /zxxx/list.htm --summary。
