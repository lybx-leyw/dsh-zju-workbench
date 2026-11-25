# 电气工程学院官网（ee.office.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 电气工程学院 |
| 栏目 | 最新通知 |
| 列表地址 | `http://ee.office.zju.edu.cn/88740/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site ee.office.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 九个精确公开栏目（2026-11-22）

- http://ee.office.zju.edu.cn/88758/list.htm：本科生教育 › 教学事务（大类 本科生教育），14 条，外链 4；CMS 声明 903 条 / 65 页
- http://ee.office.zju.edu.cn/88757/list.htm：本科生教育 › 信息公告（大类 本科生教育），14 条，外链 6；CMS 声明 3410 条 / 244 页
- http://ee.office.zju.edu.cn/88775/list.htm：研究生教育 › 信息公告（大类 研究生教育），14 条，外链 5；CMS 声明 1266 条 / 91 页
- http://ee.office.zju.edu.cn/88748/list.htm：管理服务 › 通知公告（大类 管理服务），14 条，外链 1；CMS 声明 233 条 / 17 页
- http://ee.office.zju.edu.cn/88780/list.htm：研究生教育 › 培养过程（大类 研究生教育），14 条，外链 1；CMS 声明 134 条 / 10 页
- http://ee.office.zju.edu.cn/88736/list.htm：研究生教育（大类 研究生教育），2 条，外链 0；CMS 声明 2 条 / 1 页
- http://ee.office.zju.edu.cn/88808/list.htm：学生工作 › 奖助事务（大类 学生工作），14 条，外链 3；CMS 声明 355 条 / 26 页
- http://ee.office.zju.edu.cn/88784/list.htm：研究生教育 › 学籍管理（大类 研究生教育），8 条，外链 6；CMS 声明 8 条 / 1 页
- http://ee.office.zju.edu.cn/88891/list.htm：通知公告 › 就业服务（大类 通知公告），14 条，外链 10；CMS 声明 293 条 / 21 页

- 身份：li.col_path 完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名。
- 版面：div.col_news_list > div.jzlb（内 div.btt3 > a 标题、div.fbsj4 日期）；不是常见的 ul/li 结构。
- 别名不一致：/88740 末项自认 /88804/、/88759 自认 /88765/，均标 identity-mismatch 不开放。
- 注意 /88759 的页面标题是「专业确认」而目录标签是「本科生教育·学籍管理」，属标签与标题不同，不是别名问题。
- 复用：node sites/zju-notices/crawler-columns.mjs column ee.office.zju.edu.cn /88758/list.htm --summary。
