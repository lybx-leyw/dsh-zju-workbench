# 历史学院官网 ls.zju.edu.cn

- HTTP 同路径 301 到 HTTPS。

## 一个精确公开栏目（2026-11-22）

- https://ls.zju.edu.cn/65203/list.htm：学生思政 › 风采动态（14 条，全部微信公众号外链；CMS 声明 62 条 / 5 页）

- 身份：div.weizhi 两级面包屑（父级与末项同为本路径，文字分别为「学生思政」「风采动态」）+ div.title 侧栏 h3 大类名。
- 版面：ul.list > div#wp_news_wNN > li.list-item，标题在 p，日期在紧随 span。
- 复用：node sites/zju-notices/crawler-columns.mjs column ls.zju.edu.cn /65203/list.htm --summary。
