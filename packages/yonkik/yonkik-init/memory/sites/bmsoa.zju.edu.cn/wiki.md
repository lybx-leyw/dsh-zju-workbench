# 基础医学系官网（bmsoa.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 基础医学系 |
| 栏目 | 内部公示 |
| 列表地址 | `http://bmsoa.zju.edu.cn/85937/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site bmsoa.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 内部公示（2026-11-22）

- https://bmsoa.zju.edu.cn/85937/list.htm：信息公开 › 内部公示（6 条 / 6 总 / 1 页）

- HTTP 同路径 301 到 HTTPS，按 HTTPS 记录。
- 与建筑工程学院同模板（news_list.list2 + Column_Anchor），复用 ccea-li 解析器。
- 本栏**无需登录即可读列表**；页面里的登录入口只是站点页头通用导航。
- 与 bms.zju.edu.cn（基础医学系官网）是不同 host。
