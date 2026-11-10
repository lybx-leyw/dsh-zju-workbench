/**
 * 站点常量。
 *
 * 单独一个文件而不是放在 `index.js`：`xzzd.js` / `pta.js` 都要用这些地址，
 * 而 `index.js` 又要引用那两个模块 —— 放一起就成循环导入。
 * 常量最没有依赖，单独一层最省事。
 */

/** 学在浙大。 */
export const XZZD_HOST = 'courses.zju.edu.cn';
export const XZZD_BASE = `https://${XZZD_HOST}`;

/** 拼题A：题集在 `pintia.cn`，登录态在 `passport.pintia.cn`。 */
export const PTA_BASE = 'https://pintia.cn';
export const PTA_HOST = 'pintia.cn';

/** CAS 统一认证（登录链路会走到这里）。 */
export const CAS_HOST = 'zjuam.zju.edu.cn';

/** WebVPN 网关（校外时登录它，再经它访问校内站点）。 */
export const WEBVPN_HOST = 'webvpn.zju.edu.cn';

/**
 * 本包会碰的**全部**主机。
 *
 * ⚠️ 这份清单直接决定「cookie 会不会被发出去 / 存下来」—— `Transport` 只对
 *    命中它的请求读写 cookie。少一个主机，那条链路上的会话就永远是空的，
 *    而且**不会报错**，只是表现为"登录成功但立刻又未登录"。
 *
 *    从 classroom 复制来的 `Transport` 默认白名单只含智云课堂的域名，
 *    所以这里必须把本包要用的都列全，并在构造 `Transport` 时传进去。
 */
export const CAMPUS_HOSTS = new Set([
  CAS_HOST,
  'identity.zju.edu.cn',
  XZZD_HOST,
  PTA_HOST,
  'passport.pintia.cn',
  'www.pintia.cn',
  WEBVPN_HOST,
]);

/**
 * 网关登录用的主机白名单 = 业务域 + 网关自己。
 *
 * # 为什么要单独一份
 *
 * `Transport` 只对白名单主机读写 cookie。业务请求与网关登录需要的域**不同**：
 * 业务请求永远够不到 `webvpn.zju.edu.cn`，而网关登录必须能收下它的 ticket。
 *
 * 历史上两者共用 `CAMPUS_HOSTS`，而那份清单**漏了网关** —— 后果是网关
 * `do-login` 回了 200 和 ticket，cookie 被 `Transport` 静默丢弃，
 * `hasWebvpnSession()` 恒为 false，登录必然报 `WEBVPN_NO_SESSION`。
 * 2026-11-10 实测：不含网关 → ticket 数 0 且抛错；含网关 → 登录成功。
 *
 * 现在 `CAMPUS_HOSTS` 也含网关（保证任何路径都不会再踩这个坑），
 * 而这一份是**显式**给网关登录用的 —— 两份都含是刻意的冗余，
 * 因为「漏一个主机」这个错误不报错、不打日志，只在真正登录时才发作。
 */
export const WEBVPN_HOSTS = new Set([...CAMPUS_HOSTS, WEBVPN_HOST]);

