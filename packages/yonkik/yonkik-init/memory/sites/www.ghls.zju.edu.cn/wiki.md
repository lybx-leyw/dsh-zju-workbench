# 光华法学院官网（www.ghls.zju.edu.cn）

- 站点走公开 HTTP；固定单页首屏、不带凭据、不跟跳转。

## 十二个精确公开栏目（2026-11-22）

- http://www.ghls.zju.edu.cn/ghlsbg/13767/list.htm：学生工作 › 评奖评优（横幅 学生工作），20 条，外链 0；CMS 声明 403 条 / 21 页
- http://www.ghls.zju.edu.cn/ghlsbg/13761/list.htm：学生工作 › 最新消息（横幅 学生工作），20 条，外链 0；CMS 声明 395 条 / 20 页
- http://www.ghls.zju.edu.cn/ghlsbg/13762/list.htm：学生工作 › 学生党建（横幅 学生工作），20 条，外链 0；CMS 声明 455 条 / 23 页
- http://www.ghls.zju.edu.cn/ghlsbg/13763/list.htm：学生工作 › 学生团建（横幅 学生工作），20 条，外链 0；CMS 声明 261 条 / 14 页
- http://www.ghls.zju.edu.cn/ghlsbg/13768/list.htm：学生工作 › 学生资助（横幅 学生工作），20 条，外链 0；CMS 声明 152 条 / 8 页
- http://www.ghls.zju.edu.cn/ghlsbg/13771/list.htm：学生工作 › 学生组织（横幅 学生工作），20 条，外链 0；CMS 声明 126 条 / 7 页
- http://www.ghls.zju.edu.cn/ghlsbg/13813/list.htm：重点提示（横幅 重点提示），20 条，外链 0；CMS 声明 5468 条 / 274 页
- http://www.ghls.zju.edu.cn/ghlsbg/13789/list.htm：对外交流 › 公告（横幅 对外交流），20 条，外链 0；CMS 声明 463 条 / 24 页
- http://www.ghls.zju.edu.cn/ghlsbg/13729/list.htm：对外交流（横幅 对外交流），20 条，外链 1；CMS 声明 29 条 / 2 页
- http://www.ghls.zju.edu.cn/ghlsbg/jyfw/list.htm：就业服务（横幅 就业服务），20 条，外链 11；CMS 声明 1032 条 / 52 页
- http://www.ghls.zju.edu.cn/ghlsbg/xsjz1/list.htm：学术讲座（横幅 学术讲座），20 条，外链 0；CMS 声明 307 条 / 16 页
- http://www.ghls.zju.edu.cn/ghlsbg/zxtz/list.htm：教育教学 › 最新通知（横幅 教育教学），19 条，外链 0；CMS 声明 19 条 / 1 页

- 身份：div.bread_crumb 的完整链路逐项比对，再加 h1 横幅栏目名复核；两者都不等于列表 title。
- 版面：div#wp_news_wNN > div.list_box > ul.list_ul > li，a 带 title 属性，日期在紧随的 span 里。
- 树状差异：「公告」是「对外交流」的子栏；「重点提示」「就业服务」「学术讲座」是一级栏；「最新通知」的父级链接指向站群共享的 /_s331/main.psp。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.ghls.zju.edu.cn /ghlsbg/13767/list.htm --summary。
