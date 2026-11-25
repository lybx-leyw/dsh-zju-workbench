# 经济学院官网（www.cec.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 经济学院 |
| 栏目 | 会议通知 |
| 列表地址 | `http://www.cec.zju.edu.cn/hytz_36106/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.cec.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 六个精确公开栏目（2026-11-22）

- http://www.cec.zju.edu.cn/bkssz/list.htm：本科生思政（父栏 学生思政），10 条，外链 0；CMS 声明 785 条 / 79 页
- http://www.cec.zju.edu.cn/xssz/list.htm：学生思政（父栏 学生思政，实际展示「重要通知」），10 条，外链 0；CMS 声明 908 条 / 91 页
- http://www.cec.zju.edu.cn/jxyjw/list.htm：教学与教务（父栏 本科生教育），10 条，外链 0；CMS 声明 67 条 / 7 页
- http://www.cec.zju.edu.cn/pygl/list.htm：培养管理（父栏 研究生教育），10 条，外链 0；CMS 声明 751 条 / 76 页
- http://www.cec.zju.edu.cn/dwjl_36145/list.htm：对外交流（父栏 研究生教育），10 条，外链 2；CMS 声明 94 条 / 10 页
- http://www.cec.zju.edu.cn/zxxx_36129/list.htm：研究生教育（父栏 研究生教育，实际展示「最新消息」），10 条，外链 1；CMS 声明 2154 条 / 216 页

- 身份：「窗口14」main-header 内链接序列；按标题命中定位本栏 chip，再取前一项作父栏，两者路径与文字都要匹配。
- 父栏渲染子栏：/xssz/list.htm 的 chip 是 /zytz/list.htm「重要通知」，属父栏默认展示子栏，不是错栏。
- 版面：div#wp_news_wNN > ul.list-items > li（span.square + a + i 日期）。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.cec.zju.edu.cn /bkssz/list.htm --summary。

## 补充：四个新栏目开放、两个默认子栏不开放（2026-11-22）

- http://www.cec.zju.edu.cn/xwgl/list.htm：研究生教育 › 学位管理（10 条，CMS 842 条 / 85 页）
- http://www.cec.zju.edu.cn/bsszqkh/list.htm：研究生教育 › 博士生中期考核（10 条，CMS 28 条 / 3 页）
- http://www.cec.zju.edu.cn/xjgl_36132/list.htm：研究生教育 › 学籍管理（10 条，CMS 111 条 / 12 页）
- http://www.cec.zju.edu.cn/tjmsyjs/list.htm：本科生教育 › 推荐免试研究生（10 条，CMS 87 条 / 9 页）

- /yjssz（研究生思政）：页面自认栏目地址 /jdgz_36461，渲染的是默认子栏「党团建设」，不开放。
- /dwjl1（国际交流）：页面自认栏目地址 /zxxx_36164，渲染的是默认子栏「最新消息」，不开放。
