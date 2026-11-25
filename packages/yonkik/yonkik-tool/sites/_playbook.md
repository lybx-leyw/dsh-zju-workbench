# 跨站 Playbook

可迁移经验库。每条带证据+适用范围+来源站；由真实探索写回，不预填猜测。
格式见 references/artifacts.md。

## SPA 站点的「假 robots.txt」识别
- 模式：若 `GET /robots.txt` 返回 200 但 `content-type` 是 `text/html`、body 里是 `<div id="root">` 之类
  的 SPA 外壳，说明站点没有 robots 规则文件（被前端路由兜底了）。别把 HTML 当规则解析，直接标 `source: "default"`。
- 证据：`GET https://www.cc98.org/robots.txt` → 200，12172 bytes，body 以 `<!DOCTYPE html><html lang="zh-CN">
  <head><meta charset="utf-8"><title>CC98论坛</title>…<div id="root"></div>` 开头；与首页 HTML 完全一致。
- 适用范围：任意 SPA（React/Vue）站点；服务端渲染站点不适用（它们的 robots.txt 通常是真文本）。
- 来源站：www.cc98.org，2026-11-18

## 从 SPA bundle 反查 API 基址与鉴权参数
- 模式：SPA 的接口域常与页面域不同。三步走：
  1. 先看 `GET /static/config.json`（或 `/config.js`、`/env.json`）—— 很多站点把 `apiUrl`/`openIdUrl`
     写在这里，**一次请求就能拿到，比读 bundle 便宜得多**。
  2. 再看首页 HTML 引用的 `main-*.js`，在 bundle 里 grep `baseURL`、`apiUrl`、`http[s]?://.*(站点域)`、
     `/connect/token`、`client_id`。
  3. 登录逻辑（`grant_type`、`scope`、`client_id`、`client_secret`）通常明文写在登录组件里。
- 证据：`https://www.cc98.org/static/config.json` → `{"apiUrl":"https://api.cc98.org","openIdUrl":"https://openid.cc98.org"}`；
  `main-f76e0ae5.js` 中登录组件 `fetch(mn.config.openIdUrl + "/connect/token")`，body 含
  `client_id:"9a1fd200-…"`, `scope:"cc98-api openid offline_access"`。
- 适用范围：前后端分离的 SPA；bundle 未做字符串加密的站点。
- 来源站：www.cc98.org，2026-11-18

## Bearer token 站点接 lib/http.mjs 的补丁点
- 模式：`lib/http.mjs` 只自动导入 `state.json` 里的 **cookie**。若站点用 `Authorization: Bearer`，
  `crawler.mjs` 里要自己从 `state.json` 读 `access_token` 并给每个请求补 header。
  统一封装成 `const api = p => client.getJSON(API + p, H)` 后，各 op 只写路径，避免漏加。
- 证据：`node crawler.mjs byTag --board 68 --tag1 92` 未加头时 `401`；加了
  `{ headers: { Authorization: 'Bearer <state.access_token>' } }` 后 `200`（2026-11-18）。
- 适用范围：所有 OAuth2 password grant / JWT 鉴权的 `sites/<key>/`。
- 来源站：www.cc98.org，2026-11-18

## 论坛类站点的「标签」是最省的抽样维度
- 模式：Discuz/自研论坛普遍有版本标签（求助/资源/讨论/选课…）。先用 `/board/{id}/tag` 拿到 tag id 映射，
  再用 `/topic/search/board/{id}/tag?tag1=` 精确抽样。
  **比关键词搜索可靠**：关键词搜索按时间倒序且不含标签，容易漏；标签口径带 `count` 总数，可据此外推覆盖率。
- 证据：`GET /board/68/tag` → `[{layer:1,tags:[{id:85,name:"讨论"},{id:92,name:"求助"},{id:93,name:"资源"},…]}]`；
  `GET /topic/search/board/68/tag?tag1=92` → `{count:72407, topics:[…]}`，`tag1=93` → `count:17513`。
- 适用范围：有标签体系的论坛（CC98、Discuz 系、Flarum 标签扩展）。
- 来源站：www.cc98.org，2026-11-18

## 需求统计必须报「双口径」
- 模式：统计"大家在求什么"时，用户自挂标签普遍不准（该挂"求助"的挂了"讨论"）。做法：
  - 口径 A（严）：官方标签 ∧ 资源词 → 数量小但精确；
  - 口径 B（宽）：不限标签，标题含索要词 + 资源词 → 覆盖更全。
  两个数一起报，并说明差异来源。只报一个会系统性低估需求。
- 证据：CC98 学习天地 2026-10-19~11-18：口径 A = 44 帖，口径 B = 108 帖，相差 2.5 倍。
- 适用范围：任何依赖用户自填分类的 UGC 平台统计。
- 来源站：www.cc98.org，2026-11-18

## 论坛站规里的「反爬条款」必须先读
- 模式：校内/社区论坛的服务条款常明文禁止爬取数据并规定处罚。深探前先看置顶公告与版规，
  把条款原文和风险写进 `wiki.md` 的「坑」，后续会话据此约束批量行为。
- 证据：CC98 置顶公告 `/topic/6468737`（2026-04-05，回复 24，点赞 90）原文：
  「用户在论坛上使用 AI 实施违规行为（包括但不限于生成低质或虚假内容、爬取论坛数据），
  将被处以全站锁定 365 天以上的处罚；屡犯或情节严重者，将锁定其通行证下的全部账号」。
- 适用范围：所有需要登录的 UGC 站点。
- 来源站：www.cc98.org，2026-11-18
