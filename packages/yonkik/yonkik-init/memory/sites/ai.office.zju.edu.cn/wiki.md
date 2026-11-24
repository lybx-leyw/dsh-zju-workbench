# 人工智能学院官网（ai.office.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 人工智能学院 |
| 栏目 | 内部公示 |
| 列表地址 | `http://ai.office.zju.edu.cn/nbgs/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site ai.office.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 五个精确公开栏目（2026-11-22）

- http://ai.office.zju.edu.cn/nbgs/list.htm：国际交流 › 教师国际交流 › 内部公示，20 条，外链 0；CMS 声明 111 条 / 6 页
- http://ai.office.zju.edu.cn/90093/list.htm：行政综合 › 行政综合-通知公告，3 条，外链 0；CMS 声明 3 条 / 1 页
- http://ai.office.zju.edu.cn/tzgg_89914/list.htm：教育教学 › 教育教学-通知公告，18 条，外链 0；CMS 声明 18 条 / 1 页
- http://ai.office.zju.edu.cn/tzgg_89915/list.htm：国际交流 › 国际交流-通知公告，2 条，外链 0；CMS 声明 2 条 / 1 页
- http://ai.office.zju.edu.cn/tzgg_92951/list.htm：学生工作 › 通知公告，2 条，外链 0；CMS 声明 2 条 / 1 页

- 身份：frag=窗口12 面包屑块（末项须等于本栏路径）+ h2.col_title 栏目标题。
- 版面：列表项是 a.w-full.p-6，日期在 span.font-mono，标题在 h3；没有 ul/li 结构。
- 该站是 Tailwind 重写版，但仍有 all_count / all_pages 隐藏分页数据，可继续用 CMS 计数校验。
- 复用：node sites/zju-notices/crawler-columns.mjs column ai.office.zju.edu.cn /nbgs/list.htm --summary。
