# 文学院官网（literature.zju.edu.cn）

- HTTP 同路径 301 到 HTTPS；固定单页首屏、不带凭据。

## 三个精确公开栏目（2026-11-22）

- https://literature.zju.edu.cn/bksjy_65102/list.htm：人才培养 › 本科生教育，14 条，外链 0；CMS 声明 66 条 / 5 页
- https://literature.zju.edu.cn/yjsjy/list.htm：人才培养 › 研究生教育，14 条，外链 1；CMS 声明 34 条 / 3 页
- https://literature.zju.edu.cn/zxtz/list.htm：党政管理 › 最新通知，7 条，外链 1；CMS 声明 7 条 / 1 页

- 身份：**本站没有面包屑**，判据改为「左侧导航 li.menu-item.selected 的 href 与文字」+「div.menu-header 内 h3 大类名」。
- 版面：ul.notice > div#wp_news_wNN > li.list-item，日期在 p.time，标题在 div.title。
- /rcpy（人才培养（办公网））不在左侧导航里，没有 selected 项可核，标 identity-mismatch 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column literature.zju.edu.cn /bksjy_65102/list.htm --summary。
