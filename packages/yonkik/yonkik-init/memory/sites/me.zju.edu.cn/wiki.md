# 机械工程学院官网（me.zju.edu.cn）

- 站点只支持公开 HTTP：HTTPS 443 连接被拒、robots 404；不带凭据、不跟跳转、不重试。
- 六个公开通知栏已逐条验证（2026-11-22），各首屏 14 条。
- 「本科生教育·重要通知」与「学生工作·重要通知」显示标题相同，必须靠「当前位置」的父栏目路径与文字共同区分。
- 版面：div#wp_news_wNN > ul > li.column-news-item，标题在 span.column-news-title > a，日期在 span.column-news-date（YYYY-MM-DD）；部分条目指向外站（如 kyjs），只记地址不访问。
- 复用：node sites/zju-notices/crawler-columns.mjs column me.zju.edu.cn /meoffice/6427/list.htm --summary。

## 补充：补六个栏目（2026-11-22）

- http://me.zju.edu.cn/meoffice/6486/list.htm：党建与工会 › 学生党建（14 条 / 839 总）
- http://me.zju.edu.cn/meoffice/6492/list.htm：资产与安全 › 通知公告（14 条 / 51 总）
- http://me.zju.edu.cn/meoffice/6444/list.htm：研究生教育 › 学籍事务（14 条 / 45 总）
- http://me.zju.edu.cn/meoffice/zyxw/list.htm：研究生教育 › 专业学位（5 条 / 5 总）
- http://me.zju.edu.cn/meoffice/jxjypt/list.htm：学院简介 › 教育教学平台（2 条 / 2 总）
- http://me.zju.edu.cn/meoffice/sx/list.htm：实践教学 › 实习（14 条 / 22 总）
