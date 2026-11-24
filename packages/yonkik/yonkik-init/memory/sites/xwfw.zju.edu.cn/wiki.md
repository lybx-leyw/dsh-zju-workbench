# 校务服务网（xwfw.zju.edu.cn）

## 本页索引

<!-- yonkik:toc -->

- 概览
- 鉴权
- 与 service.zju.edu.cn 的关系（本页唯一要点）
- 接口
- 坑
- 本次探了什么 / 还剩什么

---
## 概览

**本域没有独立系统。** 它对任意路径（含 `/`）一律 **301** 到
`https://service.zju.edu.cn/_s2/cs_bszx/main.psp`，页面标题「我的浙大」。

所以学生对「校务服务网」的所有描述（查证明办理流程、借教室、研究生请假销假、
对话式打卡、待办提醒），**实际操作对象都是 `service.zju.edu.cn`**。

## 鉴权

本域不出登录页。鉴权发生在跳转后的 service：`302 → zjuam.zju.edu.cn/cas/login`
（凭据键 `campus-sso`，验证码当前关闭）。
**但公开面（服务目录 / 办事指南 / 窗口电话 / 自助服务点）在 service 上免登录可读。**

## 与 service.zju.edu.cn 的关系（本页唯一要点）

| 事实 | 证据（2026-11-20 实测） |
|---|---|
| `xwfw` 是 `service` 的**整站别名** | `GET https://xwfw.zju.edu.cn/` → 301 → `https://service.zju.edu.cn/_s2/cs_bszx/main.psp`，169B nginx 默认 301 页 |
| 连 `/robots.txt` 都 301 | `GET https://xwfw.zju.edu.cn/robots.txt` → 同样 301 到同一目标 |
| 没有记录级/接口级路由 | 所有子路径都吃同一条 301，不存在 `/api/`、`/_web/` 等分流 |
| 登录后进入的是 service 的会话 | 跳转后标题「我的浙大」、`JSESSIONID`/`route`/`language` 由 service 下发 |

**结论：把 xwfw 当 service 的一个入口别名即可，不要为它单独写爬虫或单独维护接口表。**

## 接口

无独立接口。`endpoints.json` 里只登记了那条 301。
要取数据 → 用 `sites/service.zju.edu.cn/endpoints.json`（同一套后台，完全适用）。

核心复述（详见 service 站 wiki）：

```
GET https://service.zju.edu.cn/mobile/loadServiceApps.rst?parentCategoryId=36   # 服务目录 49 项
GET https://s.zju.edu.cn/search/workGuide.do?words=<关键词>                     # 办事指南（免登录）
GET https://service.zju.edu.cn/_s2/anonymous_fwzn/main.psp                      # 窗口电话表
```

## 坑

1. **别把 xwfw 当成第二套系统去「对比」。** 它是同一套后台的别名，301 目标就是 `service/_s2/cs_bszx/main.psp`。看到「两个站都能办同一件事」不是冗余，是同一个站。
2. **301 是整站级的**，包括 robots.txt——所以本域**没有可爬的 robots 规则**，限流按 service 的保守默认来（串行 ≥2s）。
3. **`curl -L` 会把 Host 换成 service**，之后所有 cookie 属于 service 域。写脚本时注意 cookie 归属，别在 xwfw 域上等 cookie。
4. 本域 `server: nginx/1.16.1`，service 是 `openresty/1.15.8.1` —— **server 头不一致是正常的**（xwfw 只是前置 nginx 做跳转），不代表两套系统。

## 本次探了什么 / 还剩什么

**已探（done）**：裸域、robots、301 链路、目标页标题与 cookie。结论是本域无独立内容。

**未探**：无（本域没有可探的东西）。
