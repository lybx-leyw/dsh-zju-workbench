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
]);

