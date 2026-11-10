/**
 * 拼题A 的站点常量（`pintia.cn`）。
 *
 * # 为什么单独一份，而不是从 campus 借
 *
 * 这些常量原先在 `packages/source/campus/src/hosts.js`，与学在浙大、CAS、
 * WebVPN 的主机表混在一起。拆包分两步：`campus` 的那一份**原样保留**
 * （学在浙大那一半还在用它），本包**复制**一份自己的。
 *
 * 两份重复是有意的过渡态：拆包期间两个包都必须是可独立运行的，
 * 谁先删谁就把对方弄坏。等 `campus` 退役时，那一份里的 `PTA_*` 一并消失。
 *
 * # 与 campus 的 `CAMPUS_HOSTS` 的区别
 *
 * campus 那份是「登录链路会碰到的主机」合集（CAS / WebVPN / 学在浙大 / 拼题A），
 * 因为它一个 `Transport` 要管三条链路。本包**只碰拼题A**，所以主机表刻意收窄到
 * 三个域 —— `Transport` 只对白名单主机读写 cookie，多列一个就多一份无谓的暴露面。
 */

/** 拼题A 主站域名。 */
export const PTA_HOST = 'pintia.cn';

/** 主站地址（拼题A 全站走 HTTPS）。 */
export const PTA_BASE = `https://${PTA_HOST}`;

/** 登录态所在的域。与主站不同域，但 cookie 以 `.pintia.cn` 为域下发。 */
export const PTA_LOGIN_HOST = 'passport.pintia.cn';

/**
 * 本包会碰的**全部**主机。
 *
 * ⚠️ 这份清单直接决定「cookie 会不会被发出去 / 存下来」—— `Transport` 只对
 *    命中它的请求读写 cookie。少一个主机，那条链路上的会话就永远是空的，
 *    而且**不会报错**，只表现为"刚粘的 Cookie 立刻又像没配"。
 */
export const PTA_HOSTS = new Set([PTA_HOST, PTA_LOGIN_HOST, 'www.pintia.cn']);

/**
 * 这个主机名是否属于拼题A。
 *
 * 点边界匹配，与 `@lybx-leyw/dsh-zju-source-webvpn` 的 `isPublicHost` 同口径：
 * 朴素的 `endsWith('pintia.cn')` 会让 `evilpintia.cn` 命中。
 *
 * @param hostname - 主机名。
 * @returns 是否拼题A 的域。
 */
export function isPtaHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return host === PTA_HOST || host.endsWith(`.${PTA_HOST}`);
}
