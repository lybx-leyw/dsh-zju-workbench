# 生命科学学院官网（www.cls.office.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 生命科学学院 |
| 栏目 | 最新通知 |
| 列表地址 | `http://www.cls.office.zju.edu.cn/25820/list.htm` |
| 鉴权 | **需 WebVPN**（内网子站，直连 502） |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site www.cls.office.zju.edu.cn` |

## 注意：必须经 WebVPN

该站**直连返回 502**（仅校内 IP 可访问）。必须经 WebVPN 代理：
先跑 `node sites/webvpn.zju.edu.cn/login.mjs`，聚合器会自动把 `viaVpn: true` 的源重写成 VPN 地址。

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 七个精确公开栏目（2026-11-22）

- http://www.cls.office.zju.edu.cn/25820/list.psp：科室信息 › 科研合作 › 最新通知，14 条，外链 14；CMS 声明 501 条 / 36 页
- http://www.cls.office.zju.edu.cn/cggs/list.psp：科室信息 › 国际交流 › 出国公示，14 条，外链 0；CMS 声明 452 条 / 33 页
- http://www.cls.office.zju.edu.cn/25875/list.psp：科室信息 › 本科生教育 › 海外交流，14 条，外链 3；CMS 声明 110 条 / 8 页
- http://www.cls.office.zju.edu.cn/25812/list.psp：科室信息 › 信息公开 › 安全教育，14 条，外链 6；CMS 声明 81 条 / 6 页
- http://www.cls.office.zju.edu.cn/gsgg_80891/list.psp：科室信息 › 研究生教育 › 公示公告，6 条，外链 0；CMS 声明 6 条 / 1 页
- http://www.cls.office.zju.edu.cn/gsgg_80892/list.psp：科室信息 › 本科生教育 › 公示公告，14 条，外链 0；CMS 声明 30 条 / 3 页
- http://www.cls.office.zju.edu.cn/gsgg_80890/list.psp：科室信息 › 科研合作 › 公示公告，6 条，外链 1；CMS 声明 6 条 / 1 页

- 身份：ol.breadcrumb 完整链路（末项须等于本栏路径）+ h3 大类名（本站恒为「科室信息」）。
- 版面：div.list[portletmode=simpleList] > ul > li.notice_li，a 内 div.content > span 标题、div.time > span 日期。
- 扩展名：目录写 .htm，实际一律 301 到同站 .psp，按 .psp 记录有效地址并保留原清单路径。
- 别名不一致：/25821、/25824、/gjjl_79410、/qctx1 的末项分别自认 /25871、/25888、/25900、/zzsz_84289，均标 identity-mismatch 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column www.cls.office.zju.edu.cn /25820/list.htm --summary。
