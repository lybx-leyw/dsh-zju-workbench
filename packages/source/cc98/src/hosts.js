/**
 * CC98 的站点常量。
 *
 * 单独一层而不是塞进 `index.js`：`token.js`（令牌端点）、`client.js`（REST 端点）
 * 与 `index.js`（主机白名单、路由）都要用这些地址，写在一起就成循环导入。
 * 常量最没有依赖，独立成文件最省事。
 */

/** CC98 REST API。所有数据方法都落在 `${CC98_API}/<path>`。 */
export const CC98_API = 'https://api.cc98.org';

/**
 * OAuth2 令牌端点。
 *
 * 与 `api.cc98.org` 是**两个域**：openid 域只负责发/续令牌，
 * 业务请求带 `Authorization: Bearer` 打 api 域。所以本包要碰的主机有两个，
 * 见 `CC98_HOSTS`。
 */
export const TOKEN_URL = 'https://openid.cc98.org/connect/token';

/** 论坛网页端。只用来拼给用户/模型看的可点链接，本包**不抓网页**。 */
export const CC98_WEB = 'https://www.cc98.org';

/**
 * 请求时带的 Referer。
 *
 * CC98 的 API 对来源有基本校验（第三方客户端都这么带）。写成论坛首页而不是
 * 具体帖子：帖子链接要按 id 拼，而 Referer 在这里只是身份声明，没有信息量。
 */
export const REFERER = `${CC98_WEB}/`;

/**
 * 本包会碰的**全部**主机。
 *
 * ⚠️ `Transport` 只对命中这份白名单的主机读写 cookie。CC98 的认证走
 *    Bearer 令牌、**不依赖 cookie**，所以这里少写一个主机不会出现学在浙大那种
 *    「登录成功但会话永远是空的」—— 但仍是显式传全更好：
 *    `Transport` 的默认白名单是智云课堂那一套（`classroom.zju.edu.cn` 等），
 *    与本包毫无关系，不传就等于把「发不发 cookie」交给一个不相干的默认值。
 *
 *    把 `www.cc98.org` 也列进来，是为了响应里出现站点 cookie（CDN/风控）时
 *    能被正常保存，而不是每次请求都从零开始。
 */
export const CC98_HOSTS = new Set(['api.cc98.org', 'openid.cc98.org', 'www.cc98.org']);
