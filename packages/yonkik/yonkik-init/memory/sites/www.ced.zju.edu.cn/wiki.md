# 教育学院官网（www.ced.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 教育学院 |
| 栏目 | 研究生培养 |
| 列表地址 | `http://www.ced.zju.edu.cn/26970/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.ced.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 十二个精确公开栏目（2026-11-22）

- http://www.ced.zju.edu.cn/cedoffice/26836/list.htm：学生思政 › 信息公告，14 条，外链 0；CMS 声明 960 条 / 69 页
- http://www.ced.zju.edu.cn/cedoffice/26841/list.htm：学生思政 › 评奖评优，14 条，外链 0；CMS 声明 435 条 / 32 页
- http://www.ced.zju.edu.cn/cedoffice/26808/list.htm：本科生教育 › 信息公告，14 条，外链 10；CMS 声明 1002 条 / 72 页
- http://www.ced.zju.edu.cn/cedoffice/26840/list.htm：学生思政 › 学生资助，14 条，外链 1；CMS 声明 251 条 / 18 页
- http://www.ced.zju.edu.cn/cedoffice/26794/list.htm：学院党政 › 信息公告，14 条，外链 0；CMS 声明 284 条 / 21 页
- http://www.ced.zju.edu.cn/jldt/list.htm：交流合作 › 国际交流 › 交流动态，14 条，外链 7；CMS 声明 47 条 / 4 页
- http://www.ced.zju.edu.cn/cedoffice/26831/list.htm：国际合作 › 信息公告，14 条，外链 3；CMS 声明 328 条 / 24 页
- http://www.ced.zju.edu.cn/cedoffice/26845/list.htm：学生思政 › 公示专区，14 条，外链 0；CMS 声明 362 条 / 26 页
- http://www.ced.zju.edu.cn/cedoffice/26822/list.htm：研究生教育 › 学位管理，14 条，外链 0；CMS 声明 184 条 / 14 页
- http://www.ced.zju.edu.cn/26970/list.htm：人才培养 › 研究生培养，14 条，外链 0；CMS 声明 15 条 / 2 页
- http://www.ced.zju.edu.cn/cedoffice/26782/list.htm：研究生教育，14 条，外链 10；CMS 声明 1300 条 / 93 页
- http://www.ced.zju.edu.cn/cedoffice/gsl/list.htm：本科生教育 › 公示栏，14 条，外链 0；CMS 声明 16 条 / 2 页

- 身份：div.nr_top 内「当前位置」完整链路逐项比对，加 h4 栏目标题复核。
- 版面：div#wp_news_wNN > a（内含 i.dian 图标、p.tit3 标题、span 日期）；日期是 YYYY/MM/DD 格式，需转换后校验。
- 四栏同名「信息公告」：学生思政 / 本科生教育 / 学院党政 / 国际合作各一条，只能靠父级区分。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.ced.zju.edu.cn /cedoffice/26836/list.htm --summary。
