# 海洋学院官网（oca.zju.edu.cn）

- HTTP 同路径 301 到 HTTPS；固定单页首屏、不带凭据、不跟跳转。

## 十个精确公开栏目（2026-11-22）

- https://oca.zju.edu.cn/pjpy/list.psp：学生工作 › 评奖评优（目录「评奖评优」），20 条，外链 0；CMS 声明 502 条 / 26 页
- https://oca.zju.edu.cn/xszz/list.psp：学生工作 › 学生资助（目录「学生资助」），20 条，外链 0；CMS 声明 223 条 / 12 页
- https://oca.zju.edu.cn/xstj/list.psp：学生工作 › 学生团建（目录「学生团建」），20 条，外链 0；CMS 声明 395 条 / 20 页
- https://oca.zju.edu.cn/xsgz/list.psp：学生工作 › 信息公告（目录「学生工作」），20 条，外链 0；CMS 声明 1164 条 / 59 页
- https://oca.zju.edu.cn/dwxxgg/list.htm：对外合作 › 信息公告（目录「对外合作·信息公告」），20 条，外链 0；CMS 声明 1398 条 / 70 页
- https://oca.zju.edu.cn/xxgg_29992/list.psp：人才培养 › 信息公告（目录「人才培养·信息公告」），20 条，外链 12；CMS 声明 350 条 / 18 页
- https://oca.zju.edu.cn/rcjx/list.psp：人才培养 › 日常教学（目录「日常教学」），20 条，外链 6；CMS 声明 75 条 / 4 页
- https://oca.zju.edu.cn/rcpy/list.psp：人才培养 › 最新消息（目录「人才培养」），20 条，外链 2；CMS 声明 756 条 / 38 页
- https://oca.zju.edu.cn/tzgg/list.psp：图书信息 › 服务通知（目录「图书信息·通知公告」），20 条，外链 1；CMS 声明 141 条 / 8 页
- https://oca.zju.edu.cn/jzyg_68302/list.psp：图书信息 › 讲座预告（目录「讲座预告」），20 条，外链 17；CMS 声明 71 条 / 4 页

- 身份：div.weizhi 内 h1 栏目标题 + 「父栏目」span；页面还用 `var url = "/<栏目>/list.htm"` 声明自认地址，须与清单路径一致。
- 版面：div#wp_news_wNN > div.news_con > ul > li，是嵌套 a（外层 a 无标题文字、内层 a 带 title 属性），标题取 title，日期在紧随 span。
- 扩展名：目录写 .htm，多数栏目有效地址是同站 .psp（/dwxxgg 例外，.htm 直接可用）。
- 复用：node sites/zju-notices/crawler-columns.mjs column oca.zju.edu.cn /pjpy/list.htm --summary。
