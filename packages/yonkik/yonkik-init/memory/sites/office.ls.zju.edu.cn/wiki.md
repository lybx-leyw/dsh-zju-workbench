# 历史学院官网（office.ls.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 历史学院 |
| 栏目 | 评奖评优 |
| 列表地址 | `http://office.ls.zju.edu.cn/65256/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site office.ls.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 九个精确公开栏目（2026-11-22）

- http://office.ls.zju.edu.cn/65256/list.htm：学生思政 › 评奖评优（大类 学生思政），14 条，外链 0；CMS 声明 197 条 / 15 页
- http://office.ls.zju.edu.cn/65255/list.htm：学生思政 › 就业指导（大类 学生思政），14 条，外链 0；CMS 声明 125 条 / 9 页
- http://office.ls.zju.edu.cn/65257/list.htm：学生思政 › 学生资助（大类 学生思政），14 条，外链 0；CMS 声明 84 条 / 6 页
- http://office.ls.zju.edu.cn/65254/list.htm：学生思政 › 学生团建（大类 学生思政），14 条，外链 2；CMS 声明 143 条 / 11 页
- http://office.ls.zju.edu.cn/65259/list.htm：学生思政 › 公示专区（大类 学生思政），14 条，外链 0；CMS 声明 63 条 / 5 页
- http://office.ls.zju.edu.cn/65253/list.htm：学生思政 › 学生党建（大类 学生思政），14 条，外链 4；CMS 声明 20 条 / 2 页
- http://office.ls.zju.edu.cn/65251/list.htm：学生思政 › 最新通知（大类 学生思政），14 条，外链 0；CMS 声明 101 条 / 8 页
- http://office.ls.zju.edu.cn/65280/list.htm：教育教学 › 本科生教育 › 最新通知（大类 教育教学），14 条，外链 0；CMS 声明 82 条 / 6 页
- http://office.ls.zju.edu.cn/65292/list.htm：教育教学 › 研究生教育 › 最新通知（大类 教育教学），14 条，外链 3；CMS 声明 112 条 / 8 页

- 身份：div.position「当前位置」完整链路（末项须等于本栏路径）+ h3 大类名。
- 版面：div#wp_news_wNN > ul.list > li.list-item，a 内 p 标题 + span 日期。
- 默认子栏：/65251 的面包屑是「学生思政 › 最新通知」，末项即本路径，属正常渲染默认子栏，不是别名。
- 父子同路径：/65280、/65292 的链路里父级与末项同为各自路径，只差文字，须比对文字。
- 复用：node sites/zju-notices/crawler-columns.mjs column office.ls.zju.edu.cn /65256/list.htm --summary。
