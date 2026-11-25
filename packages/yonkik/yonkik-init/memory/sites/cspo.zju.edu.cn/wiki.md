# 计算机科学与技术学院官网（cspo.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 计算机科学与技术学院 |
| 栏目 | 评奖评优 |
| 列表地址 | `http://cspo.zju.edu.cn/27179/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site cspo.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 四个精确公开栏目（2026-11-22）

- http://cspo.zju.edu.cn/27169/list.htm：研究生教育 › 最新通知（大类 研究生教育），15 条，外链 2；CMS 声明 879 条 / 59 页
- http://cspo.zju.edu.cn/27173/list.htm：研究生教育 › 学位管理（大类 研究生教育），2 条，外链 0；CMS 声明 2 条 / 1 页
- http://cspo.zju.edu.cn/27225/list.htm：发展联络 › 最新通知（大类 发展联络），15 条，外链 0；CMS 声明 17 条 / 2 页
- http://cspo.zju.edu.cn/27181/list.htm：学生工作 › 学生活动（大类 学生工作），15 条，外链 0；CMS 声明 221 条 / 15 页

- 身份：li.col_path 完整链路（末项须等于本栏路径）+ span.Column_Anchor 大类名。
- 版面：div.col_news_list > div.jzlb（内 div.btt3 > a 标题、div.fbsj4 日期），每页 15 条。
- 别名不一致：/27179 末项自认 /27183、/27110 自认 /27175、/27108 自认 /29529、/27109 自认 /27169，均标 identity-mismatch 不开放。
- 说明：/27169 的链路末项与父级同为本路径，但文字不同（研究生教育 › 最新通知），属正常形态。
- 复用：node sites/zju-notices/crawler-columns.mjs column cspo.zju.edu.cn /27181/list.htm --summary。

## 补充：/27111 与 /27180 也判为别名不一致（2026-11-22）

- /27111（就业工作·最新通知）：末项自认 /27197/。
- /27180（本科生学生组织）：末项自认 /27186/。

至此计算机学院 cspo 站 10 个目录路径全部处置完毕：4 栏开放、6 栏别名不一致。
