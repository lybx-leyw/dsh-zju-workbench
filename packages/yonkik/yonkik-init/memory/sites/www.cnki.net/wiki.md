# 中国知网 www.cnki.net

## 处置：只记元数据能力，不启用自动检索（2026-11-22）

| 探测 | 结果 |
|---|---|
| `https://www.cnki.net/` | 200，98,593B，标题「中国知网」 |
| `https://kns.cnki.net/kns8s/AdvSearch` | **302 → `/verify/home`**（高级检索先跳安全验证） |
| `https://kns.cnki.net/verify/home` | 200，2,355B，标题「安全验证」 |
| `https://login.cnki.net/TopLogin/api/loginapi/IpLoginFlush` | 200，JSON，**无凭据即返回** |

**机构会话观察**：该接口返回 `IsSuccess:true`、`ShowName:"浙江大学图书馆"`、`UserType:"bk"`，说明本环境出口 IP 被识别为浙大图书馆机构 IP 段。它同时下发会话令牌（Uid）——**本库不使用该令牌做任何检索或全文获取，也未把令牌写进档案**。

**明确不做**：不绕过 kns 的安全验证、不用机构会话批量检索、不下载正文/PDF。按浙大图书馆电子资源使用办法执行。

**结论**：能力层面「有机构权限」，但检索入口有独立的安全验证；本库只记录这一事实，不启用自动化。
