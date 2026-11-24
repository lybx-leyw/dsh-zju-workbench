# 研工部官网（ygb.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 研工部 |
| 栏目 | 通知公告 |
| 列表地址 | `http://ygb.zju.edu.cn/31555/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site ygb.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 两个精确公开栏目（2026-11-22）

- https://ygb.zju.edu.cn/31555/list.htm：通知公告（10 条 / 183 总 / 19 页）
- https://ygb.zju.edu.cn/31546/list.htm：奖助事务（3 条 / 3 总 / 1 页）

- 身份：div.position_dqwz「当前位置」链路 + span.Column_Anchor 大类名。
- 版面：ul > li > a（带 title）+ span.date。
- /31546 的面包屑只有两项（父级即本路径），无法比对独立父栏，只校验末项与标题。
