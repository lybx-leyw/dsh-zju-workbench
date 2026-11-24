# 控制科学与工程学院官网（www.cse.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 控制科学与工程学院 |
| 栏目 | 科研学术 |
| 列表地址 | `http://www.cse.zju.edu.cn/39312/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.cse.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 五个精确公开栏目（2026-11-22）

- http://www.cse.zju.edu.cn/39322/list.htm：本科生教育·最新消息（父栏 本科生教育），title 最新消息，20 条，外链 0；CMS 声明 2274 条 / 114 页
- http://www.cse.zju.edu.cn/39333/list.htm：研究生教育·最新消息（父栏 研究生教育），title 最新消息，20 条，外链 1；CMS 声明 979 条 / 49 页
- http://www.cse.zju.edu.cn/39342/list.htm：日常通告（父栏 学生思政），title 日常通告，20 条，外链 0；CMS 声明 1593 条 / 80 页
- http://www.cse.zju.edu.cn/39351/list.htm：相关通知（父栏 就业指导），title 相关通知，20 条，外链 0；CMS 声明 122 条 / 7 页
- http://www.cse.zju.edu.cn/39353/list.htm：通知公告（父栏 对外交流），title 通知公告，20 条，外链 17；CMS 声明 812 条 / 41 页

- 边界：仅公开 HTTP 单页 GET，无凭据、不跟跳转、不重试；HTTPS 443 拒绝连接。
- 身份：title 与「当前位置」末两段（父栏目、子栏目）路径和文字需同时匹配；「最新消息」在本科/研究生两栏重名。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.cse.zju.edu.cn /39322/list.htm --summary。

## 补充：补七个栏目（2026-11-22）

- http://www.cse.zju.edu.cn/39344/list.psp：评奖评优（20 条 / 744 总 / 38 页）
- http://www.cse.zju.edu.cn/39345/list.psp：勤工资助（20 条 / 360 总 / 18 页）
- http://www.cse.zju.edu.cn/39343/list.psp：学生党建（20 条 / 878 总 / 44 页）
- http://www.cse.zju.edu.cn/73393/list.htm：学生团建（20 条 / 153 总 / 8 页）
- http://www.cse.zju.edu.cn/xjgl/list.htm：学籍管理（19 条 / 19 总 / 1 页）
- http://www.cse.zju.edu.cn/39334/list.htm：学位管理（20 条 / 27 总 / 2 页）
- http://www.cse.zju.edu.cn/73491/list.htm：在职硕士（单证）·最新消息（20 条 / 42 总 / 3 页）

- 其中 /39344、/39345、/39343 的 .htm 会 301 到同站 .psp，按 .psp 记录有效地址。
