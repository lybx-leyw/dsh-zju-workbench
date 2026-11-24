# 集成电路学院官网（ic.zju.edu.cn）

> 本页是**薄页**：抓取逻辑统一由 `sites/zju-notices/` 的聚合器承载，
> 站点认知与解析细节见 [zju-notices 的 wiki](../zju-notices/wiki.md)。

## 基本信息

| 项 | 值 |
|---|---|
| 单位 | 集成电路学院 |
| 栏目 | 通知公告 |
| 列表地址 | `https://ic.zju.edu.cn/tzgg_54532/list.htm` |
| 鉴权 | 免登录 |
| 抓取方式 | `node sites/zju-notices/crawler.mjs list --site ic.zju.edu.cn` |

## 为什么不单独写解析

这批学院/部处站共用同一套多策略解析器（日期锚点前溯 a / a 内含日期 / MM-DD+两位年份 / 日期后跟标题等），
逐站复制会带来维护负担。所以统一放在 `zju-notices`，本站只记录元信息。

## 九个精确公开栏目（2026-11-22）

- https://ic.zju.edu.cn/54032/list.htm：学生思政 › 评奖评优（大类 学生思政），14 条，外链 0；CMS 声明 107 条 / 8 页
- https://ic.zju.edu.cn/54029/list.htm：学生思政 › 通知公告（大类 学生思政），14 条，外链 0；CMS 声明 169 条 / 13 页
- https://ic.zju.edu.cn/54033/list.htm：学生思政 › 困难资助（大类 学生思政），14 条，外链 0；CMS 声明 22 条 / 2 页
- https://ic.zju.edu.cn/54036/list.htm：合作交流 › 国际交流（大类 合作交流），8 条，外链 2；CMS 声明 8 条 / 1 页
- https://ic.zju.edu.cn/54026/list.htm：教学招生 › 培养管理（大类 教学招生），14 条，外链 0；CMS 声明 80 条 / 6 页
- https://ic.zju.edu.cn/54027/list.htm：教学招生 › 学位管理（大类 教学招生），14 条，外链 0；CMS 声明 32 条 / 3 页
- https://ic.zju.edu.cn/tzgg/list.htm：教学招生 › 通知公告（大类 教学招生），14 条，外链 0；CMS 声明 238 条 / 17 页
- https://ic.zju.edu.cn/tzgg_54532/list.htm：综合服务 › 通知公告（大类 综合服务），14 条，外链 0；CMS 声明 70 条 / 5 页
- https://ic.zju.edu.cn/tzgg_81346/list.htm：教工之家 › 通知公告（大类 教工之家），14 条，外链 0；CMS 声明 39 条 / 3 页

- 身份：div.position「当前位置」完整链路（末项须等于本栏路径）+ h3 大类名。
- 版面：div#wp_news_wNN > ul.nlist > li.nlist_item，a 内 p.academic_title 标题 + span 日期；a 的 title 属性也有完整标题。
- 别名不一致：/53663 末项自认 /tzgg_54534/、/54034 自认 /tzgg_87720/，均标 identity-mismatch 不开放。
- 复用：node sites/zju-notices/crawler-columns.mjs column ic.zju.edu.cn /54032/list.htm --summary。
