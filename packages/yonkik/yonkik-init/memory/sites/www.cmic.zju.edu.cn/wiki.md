# 传媒与国际文化学院官网（www.cmic.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 传媒与国际文化学院 |
| 栏目 | 学院动态 |
| 列表地址 | `http://www.cmic.zju.edu.cn/35554/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.cmic.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。
## 本轮实测与修正（2026-11-22）
- **索引曾写 `endpointCount=1`，但本目录没有 `endpoints.json`** —— 薄页本就不该有独立端点，已改为 0。
- `http://www.cmic.zju.edu.cn/35554/list.htm` 实测：**200**，页面标题「信息速递」，共 80 页。
- ⚠️ 本页「栏目」一栏写的「学院动态」，与页面标题「信息速递」不一致；按上游清单标签保留，页面标题如实记录。