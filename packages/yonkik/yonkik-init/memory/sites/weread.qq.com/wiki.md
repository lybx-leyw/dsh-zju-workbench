# 微信读书 weread.qq.com

## 上游四端点：路由全部确认存在（2026-11-22）

| 端点 | 无登录返回 | 含义 |
|---|---|---|
| `/web/shelf/sync` | `{"errCode":-2010,"errMsg":"用户不存在"}` | 书架同步（含书架中的公众号） |
| `/web/mp/articles` | 同上 -2010 | 公众号文章列表 |
| `/web/mp/content` | `{"errCode":400,"errMsg":"reviewId is required"}` | 公众号正文；**明确要求 reviewId** |
| `/api/store/search` | **204**，空 body | 站内按名搜索 |

**判定**：四条路由全部存在，统一表现为**业务错误码而非 404**。缺的是微信登录态。

其中 `/web/mp/content` 的报错最有信息量——它直接说了参数名 `reviewId`，比笼统的「未登录」更能确认接口契约。

## 与 wechat-mp 的分工

- `mp.weixin.qq.com`（见 `sites/wechat-mp/`）：正文读取依赖**微信客户端**登录态。
- `weread.qq.com`（本页）：依赖**微信读书**登录态。
- 两者不能互借凭据。

## 明确不做

- 不模拟微信登录、不复用他人 cookie。
- 不猜 reviewId 穷举文章。
- **不采集书架中的个人阅读数据**——书架/阅读记录属个人数据；即便日后有登录态，也只应在用户明确请求下读取其本人指定内容，不做批量采集。
