# 计算机科学与技术学院官网 csen 子站（www.cs.zju.edu.cn）

- 站点走公开 HTTP；内容在 /csen/ 子站，与 cspo.zju.edu.cn 是不同 host。

## 两个精确公开栏目（2026-11-22）

- http://www.cs.zju.edu.cn/csen/zdts/list.htm：重点提示 › 重点提示（14 条，外链 0；CMS 声明 456 条 / 33 页）
- http://www.cs.zju.edu.cn/csen/xsjz/list.htm：学术讲座 › 学术讲座（14 条，外链 3；CMS 声明 15 条 / 2 页）

- 身份：li.col_path 完整链路 + span.Column_Anchor 大类名 + li.col_title 的 h2 标题。
- 版面：div.col_news_list > div.jzlb（内 div.btt3 > a 标题、div.fbsj4 日期），每页 14 条。
- 注意：与 cspo.zju.edu.cn（计算机学院另一站）是不同 host 与目录体系，须分别核对。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.cs.zju.edu.cn /csen/zdts/list.htm --summary。
