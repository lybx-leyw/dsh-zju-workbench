# 高分子科学与工程学系官网（office.polymer.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 高分子科学与工程学系 |
| 栏目 | 消息公告 |
| 列表地址 | `http://office.polymer.zju.edu.cn/37282/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site office.polymer.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 五个精确公开栏目（2026-11-22）

- http://office.polymer.zju.edu.cn/37282/list.htm：系务动态 › 消息公告（大类 系务动态），10 条（有日期 10），外链 0；CMS 声明 9078 条 / 908 页
- http://office.polymer.zju.edu.cn/sjjx/list.htm：本科生教育 › 实践教学（大类 本科生教育），14 条（有日期 0），外链 0；CMS 声明 199 条 / 15 页
- http://office.polymer.zju.edu.cn/xsh/list.htm：学生工作 › 学生会（大类 学生工作），10 条（有日期 10），外链 0；CMS 声明 453 条 / 46 页
- http://office.polymer.zju.edu.cn/xtw/list.htm：学生工作 › 系团委（大类 学生工作），10 条（有日期 10），外链 0；CMS 声明 364 条 / 37 页
- http://office.polymer.zju.edu.cn/37264/list.htm：学生工作（大类 学生工作），3 条（有日期 3），外链 0；CMS 声明 3 条 / 1 页

- 身份：div.position「当前位置」完整链路（末项须等于本栏路径）+ 页首 div.banner 内大类名。
- 版面：ul.list > div#wp_news_wNN > li.list-item > a，标题在 h3（title 属性有完整值），日期在 div.date 的 p.md（月-日）与 p.year（两位年）。
- 无日期列表：/sjjx 把日期块整段注释掉，页面上看不到日期；解析器先剥离 HTML 注释再取，因此该栏按「无日期列表」开放，datedCount=0。
- 别名不一致：/37259 末项自认 /xxgg/，标 identity-mismatch 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column office.polymer.zju.edu.cn /37282/list.htm --summary。
