# 化学工程与生物工程学院官网（che.cn.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 化学工程与生物工程学院 |
| 栏目 | 学生思政 |
| 列表地址 | `http://che.cn.zju.edu.cn/15222/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site che.cn.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 九个精确公开栏目（2026-11-22）

- http://che.cn.zju.edu.cn/15222/list.htm：学生工作 › 学生思政（大类 学生工作），20 条，外链 0；CMS 声明 150 条 / 8 页
- http://che.cn.zju.edu.cn/ygcgwjwgs/list.htm：国际交流 › 出国公示（大类 国际交流），20 条，外链 0；CMS 声明 758 条 / 38 页
- http://che.cn.zju.edu.cn/15188/list.htm：研究生教育 › 消息公告（大类 研究生教育），20 条，外链 3；CMS 声明 1015 条 / 51 页
- http://che.cn.zju.edu.cn/15198/list.htm：本科生教育 › 消息公告（大类 本科生教育），20 条，外链 2；CMS 声明 782 条 / 40 页
- http://che.cn.zju.edu.cn/15227/list.htm：学生工作 › 学生思政 › 学生事务（大类 学生工作），20 条，外链 0；CMS 声明 373 条 / 19 页
- http://che.cn.zju.edu.cn/15157/list.htm：学生工作（大类 学生工作），20 条，外链 0；CMS 声明 173 条 / 9 页
- http://che.cn.zju.edu.cn/15226/list.htm：学生工作 › 学生思政 › 学生党建（大类 学生工作），20 条，外链 0；CMS 声明 60 条 / 3 页
- http://che.cn.zju.edu.cn/xgtz/list.htm：国际交流 › 消息公告（大类 国际交流），20 条，外链 0；CMS 声明 225 条 / 12 页
- http://che.cn.zju.edu.cn/15154/list.htm：本科生教育（大类 本科生教育），20 条，外链 0；CMS 声明 156 条 / 8 页

- 身份：div.crumbs 内 h3 栏目标题 + 「当前位置」完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名，三者一致。
- 版面：div#wp_news_wNN > div.list > ul > li，标题在 a（常带 class="zd"），日期在紧随 span 且写成 [YYYY-MM-DD]。
- 复用：node sites/zju-notices/crawler-columns.mjs column che.cn.zju.edu.cn /15222/list.htm --summary。
