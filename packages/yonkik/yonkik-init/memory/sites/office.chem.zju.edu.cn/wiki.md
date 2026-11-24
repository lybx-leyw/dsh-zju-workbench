# 化学系官网（office.chem.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 化学系 |
| 栏目 | 信息公告 |
| 列表地址 | `http://office.chem.zju.edu.cn/34507/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site office.chem.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 十二个精确公开栏目（2026-11-22）

- http://office.chem.zju.edu.cn/34507/list.htm：学生工作 › 信息公告，10 条，外链 1；CMS 声明 1131 条 / 114 页
- http://office.chem.zju.edu.cn/34510/list.htm：学生工作 › 奖助学金，10 条，外链 0；CMS 声明 661 条 / 67 页
- http://office.chem.zju.edu.cn/34509/list.htm：学生工作 › 学生活动，10 条，外链 4；CMS 声明 515 条 / 52 页
- http://office.chem.zju.edu.cn/34490/list.htm：研究生教育 › 信息公告（目录标签「研究生教育」），10 条，外链 1；CMS 声明 847 条 / 85 页
- http://office.chem.zju.edu.cn/52029/list.htm：就业服务 › 通知公告，10 条，外链 6；CMS 声明 88 条 / 9 页
- http://office.chem.zju.edu.cn/55184/list.htm：本科生教育 › 实践竞赛，10 条，外链 0；CMS 声明 33 条 / 4 页
- http://office.chem.zju.edu.cn/55192/list.htm：国际交流 › 公示公告，10 条，外链 0；CMS 声明 17 条 / 2 页
- http://office.chem.zju.edu.cn/55195/list.htm：国际交流 › 交流项目，10 条，外链 2；CMS 声明 97 条 / 10 页
- http://office.chem.zju.edu.cn/bksjy/list.htm：本科生教育 › 本科生教育，10 条，外链 0；CMS 声明 922 条 / 93 页
- http://office.chem.zju.edu.cn/xgtw/list.htm：学生工作 › 学生工作，10 条，外链 0；CMS 声明 146 条 / 15 页
- http://office.chem.zju.edu.cn/55185/list.htm：本科生教育 › 文件汇编（目录标签「党政综合·本科生教育」），7 条，外链 1；CMS 声明 7 条 / 1 页
- http://office.chem.zju.edu.cn/55193/list.htm：国际交流 › 办事指南（目录标签「国际交流」），10 条，外链 4；CMS 声明 14 条 / 2 页

- 身份：a.catalog（窗口15）给出大类名，li.selected 的左侧导航给出本栏，h2 复核标题；三者要一致。
- 父容器页：/bksjy、/xgtw 本身就是大类页，页面没有选中的子项，此时用「缺失 selected 才是正常」来校验。
- 版面：div#wp_news_wNN > li.wow > a（span.circle 图标 + span.item 标题 + span.date 日期）。
- 目录标签差异：/55185 页面标题是「文件汇编」、/55193 是「办事指南」，与上游目录标签不一致，按页面记录。
- 复用：node sites/zju-notices/crawler-columns.mjs column office.chem.zju.edu.cn /34507/list.htm --summary。
