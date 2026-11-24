# 浙江大学团委

## 本页索引
- [入口与限流](#入口与限流)
- [已验证的只读接口](#已验证的只读接口)
- [用法与边界](#用法与边界)

## 入口与限流
- 2026-11-22：不带 Cookie 登录态，HTTPS `/robots.txt` → 404；主页未见 API 文档/自动化条款入口。保守间隔 ≥2 秒、并发 1，遇限流停止，不自动翻页。
- 入口 HTTPS `/` 返回 301，给出相同主机 HTTP 的 `/main.psp`；**该路径在 HTTPS 上可直接 200**，无需降级至 HTTP。源码目录路线和站点首页菜单各列出同一批 8 栏。

## 已验证的只读接口

| 栏目 | HTTPS 首屏 | CMS 声明的条目 / 页数 |
|---|---|---:|
| 通知公告 | /tzgg/list.psp | 4253 / 304 |
| 实践志愿 | /shsjhzyz_32442/list.psp | 1148 / 82 |
| 素质拓展 | /st_49186/list.psp | 67 / 5 |
| 创新创业 | /xskj_32440/list.psp | 599 / 43 |
| 校园文化 | /wt_32438/list.psp | 246 / 18 |
| 学生社团 | /st_32443/list.psp | 461 / 33 |
| 学生会 | /xsh_44064/list.psp | 244 / 18 |
| 青马工程 | /qmgc/list.psp | 117 / 9 |

- 以上各首屏实际 HTTP 200，title 与栏目吻合，有 Webplus 分页标记。单栏不代表全站抓取；条目总数是 CMS 声明，不是本地枚举。
- 总栏 `/tzgg/list.htm` 实测 301 到同主机 HTTP `/tzgg/list.psp`，直接 HTTPS 200； `/tzgg/list2.psp` 实测 `curr_page=2`，解析 14 条。
- 样例正文 `/2026/1103/c32290a3222398/page.psp` 200，正文容器 `div.wp_articlecontent`，593 个正文字符；旧 `page.htm` 发出同站 HTTP .psp 重定向，脚本固定读取已验证的 HTTPS .psp。
- 条目标题在 `div.a.left.el > a`，日期跟在 `div.time.right`。分类、总栏可能指向同文章，文章 ID 取 URL 的 a 号；去重只在同一站/页，不丢栏目归属。

## 用法与边界
- `crawler.mjs --list`：列出八栏目和操作，不联网。
- `crawler.mjs notices tzgg 2 --summary`：单栏单页，页码不可省略后紧接 --summary。栏目也接受中文名。
- `crawler.mjs article '<从列表得到的本站文章地址>' [--summary]`：仅允许本站路径，外站链接不跟随，附件仅列元数据，不下载。
- `crawler.mjs health`：总栏首屏健康检查。外链正文及图片 OCR 未实现；只对正文样例实测。未合并进按主机单值的旧聚合器，否则其同主机多栏目会互相覆盖。
- 上游清单证据：[固定通知来源](https://github.com/Anchorite-no/dsh-zju-assistant/blob/aaf602aabf52f3f337cb2449a4495b685b9f5b07/core/zju/lib/notice/sources.ts#L36-L47)。站点本身的实测证据见 endpoints.json。
