# 浙江大学研究生院门户

研究生院门户全部公告：公开 HTTP 单页 14 条；HTTPS 443 连接拒绝（robots 样本）。与 yjsy 教务无关。

- HTTP /qbgg/list.htm 首屏校验 title=全部公告 与同路径「当前位置」，CMS 声明 1569 条 / 113 页，实得 14 条（只读标题、日期和地址）。
- 日期在 div.date，为两位年；读取 li.list-item 的 h3 而不是整段 p。深页、详情和附件未验证。
- 复用 sites/zju-notices/crawler-columns.mjs column www.grs.zju.edu.cn /qbgg/list.htm --summary。
