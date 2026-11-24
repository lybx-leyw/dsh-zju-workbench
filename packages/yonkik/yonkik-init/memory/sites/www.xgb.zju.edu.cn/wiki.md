# 学工部官网（www.xgb.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 学工部 |
| 栏目 | 学风建设 |
| 列表地址 | `http://www.xgb.zju.edu.cn/xfjs/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.xgb.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 精确栏目首屏（2026-11-22）

- http://www.xgb.zju.edu.cn/53403/list.psp：14 条（外链 2；CMS 声明 804 条 / 58 页）
- http://www.xgb.zju.edu.cn/53395/list.psp：14 条（外链 1；CMS 声明 825 条 / 59 页）
- http://www.xgb.zju.edu.cn/53396/list.psp：14 条（外链 0；CMS 声明 1021 条 / 73 页）
- http://www.xgb.zju.edu.cn/53405/list.psp：10 条（外链 1；CMS 声明 10 条 / 1 页）

评奖评优 53395 与学生资助 53396 分别呈现子栏 53397、53400 的「重要通知」，均按面包屑确认。另有旧记录 /53388/list.htm，后续实测见下节。

## 最新通知已接入精确首屏（2026-11-22）

旧样本曾记录 .psp 返回登录页；本轮 HTTP .htm 301 到同栏 .psp，后者当下 200。标题、末端面包屑和 14 条列表皆核验；父级为党建工作，不是学风建设。仅一次 GET，无账号。
