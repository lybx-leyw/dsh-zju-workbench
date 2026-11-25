# ZJUers 轻首页 (zjuers.com)

## 本页索引

<!-- yonkik:toc -->
> 按节读，不要整篇加载：先看标题，再 grep -n "^## <标题>" wiki.md 取行号，只读那一节。

- 概览
- 鉴权
- 限流
- 站点目录（按问题类别）
- 坑
- 复用

---
## 概览
静态导航枢纽，聚合 98 个站点链接，无需登录。是浙多校园站的入口索引。
首页 17KB 静态 HTML，一次 GET 即可提取全部外链。

## 鉴权
枢纽本身无登录。成员站多用 zjuam CAS（cred-1）或 identity Keycloak，见 _sso.json。

## 限流
robots.txt 禁部分搜索引擎爬虫，无 Crawl-delay → 默认 2s。静态页轻量。

## 站点目录（按问题类别）
- 课程/选课：courses 学在浙大、zdbk 教务(本)、yjsy 教务(研)、classroom 智云课堂、pan 云盘、yuque 语雀
- 奖学金：cwcx 计财处、service 服务平台、xwfw 校务服务、sztz 素质拓展
- 设施地点：map 校园地图、zhfw 黄页/综合服务、itc 信息技术中心、person 教师查询、mapp 紧急电话
- 图书馆：libweb 图书馆、booking.lib 预约、summon 求是学术搜索、cnki/WOS
- 科研升学：research 研在浙大、person 教师信息、career 就业、kyjs 竞赛
- 生活：zulg 后勤、we 就餐指数、life 班车、net3 上网认证、myvpn 网费、zjuem 邮箱
- 资源/社区：cc98（已跑通）、nexushd、duoduo 朵朵校友圈

## 坑
- zulg/person 直连 fetch failed，需 webvpn。
- zdbk/cwcx 首页极小（68/318B），是跳转/框架壳，需进一步抓真实入口。
- service → zjuam CAS（验证码+RSA）；courses → identity Keycloak。

## 复用
- question-site-map.md：56 问→站点→信息映射。
- scripts/triage.mjs：多站批量 triage，可复用。