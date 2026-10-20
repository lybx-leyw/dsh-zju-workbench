/**
 * WebVPN：把「校内地址」改写成网关地址，并完成网关自身的登录。
 *
 * # 它解决什么
 *
 * 学在浙大、拼题A 都只在**校园网内**可达。人在校外时，直连必然失败；这时
 * 浙大提供的 WebVPN 网关（`webvpn.zju.edu.cn`）可以对内转发：
 *
 * ```text
 *   https://courses.zju.edu.cn/api/…        ← 逻辑地址（本包其余代码只认这个）
 *   https://webvpn.zju.edu.cn/https/<hex>/api/…   ← 物理地址（真正发出去的）
 * ```
 *
 * 本文件只负责这两件事的**协议部分**（加解密、地址改写、登录页解析、登录请求）。
 * 「什么时候走它」由 `egress.js` 决定，两者刻意分开：协议是死的，策略是要调的。
 *
 * # 算法（照浙大网关的现行实现）
 *
 * `https://<scheme>/<hex>` 里那段 hex 是 `AES-128-CFB` 密文，key 与 IV **都是**
 * `wrdvpnisthebest!` 的 ASCII 字节，前面再拼上 key 本身的 hex 当版本前缀。
 * 这不是加密意义上的安全措施（key 是公开常量），只是一层地址编码。
 *
 * # ⚠️ 两条边界
 *
 * 1. **只转发 HTTP(S)**。别的 scheme 没有意义，直接拒。
 * 2. **网关登录用「上网账号」，与统一身份认证是两套系统。**
 *    用户的统一认证密码很可能登不上网关 —— 这一点必须如实告诉用户，
 *    而不是让他以为是密码打错了（那正是本包此前踩过的坑）。
 *
 * 实现口径参考本仓 `dsh-zhiyun-omni` 的 `src/auth/webvpn.ts`（同仓，移植自
 * MIT 的 cc98-mcp）。这里**重写**而不是 import：omni 那份绑在它的
 * `Transport` / `ToolError` 上，而本包有自己的传输层与错误码。
 */

import { createCipheriv, createDecipheriv } from 'node:crypto';
// `errors.js` 在 `../cas/` 下：它是从 classroom 复制来的那一套，全包共用一份错误类型。
import { ClassroomError } from '../cas/errors.js';

/** 网关本身。它自己不走改写（否则会无限递归）。 */
export const WEBVPN_HOST = 'webvpn.zju.edu.cn';
export const WEBVPN_ORIGIN = `https://${WEBVPN_HOST}`;

/** 地址编码用的公开常量。 */
const URL_KEY = 'wrdvpnisthebest!';
/** 登录表单里密码字段用的另一把钥匙。 */
const PASSWORD_KEY = 'wrdvpnisawesome!';

/**
 * AES-128-CFB。key 与 IV 同值 —— 网关就是这么实现的，改不得。
 *
 * @param key - 16 字节 ASCII 常量。
 * @param data - 输入。
 * @param decrypt - 是否解密。
 * @returns 输出。
 */
function cfb(key, data, decrypt = false) {
  const k = Buffer.from(key, 'ascii');
  const cipher = decrypt ? createDecipheriv('aes-128-cfb', k, k) : createCipheriv('aes-128-cfb', k, k);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/**
 * 加密一段明文，产出网关认的 hex。
 *
 * @param key - 钥匙。
 * @param plaintext - 明文。
 * @returns `key 的 hex` + `密文的 hex`。
 */
export function wrdEncrypt(key, plaintext) {
  return Buffer.from(key, 'ascii').toString('hex') + cfb(key, Buffer.from(plaintext, 'utf8')).toString('hex');
}

/**
 * 解回明文。前缀不对或 hex 不合法一律抛 —— 静默返回空串会让"改写错了"
 * 表现成"请求了根路径"，比直接失败难查得多。
 *
 * @param key - 钥匙。
 * @param value - 网关给的 hex。
 * @returns 明文。
 */
export function wrdDecrypt(key, value) {
  const prefix = Buffer.from(key, 'ascii').toString('hex');
  if (!value.startsWith(prefix) || !/^[0-9a-f]*$/i.test(value) || (value.length - prefix.length) % 2) {
    throw new ClassroomError('WEBVPN_URL', 'WebVPN 地址格式无法识别');
  }
  return cfb(key, Buffer.from(value.slice(prefix.length), 'hex'), true).toString('utf8');
}

/**
 * 逻辑地址 → 物理地址（网关地址）。
 *
 * 已经是网关地址的原样返回，**必须**如此：登录流程自己会请求网关页面，
 * 若那条路径也被改写，就会得到「网关的网关」并无限套下去。
 *
 * 端口要带进 scheme 段：`https-8443` 这种写法是网关的约定。
 *
 * @param url - 逻辑地址。
 * @returns 物理地址。
 */
export function toWebvpnUrl(url) {
  const target = url instanceof URL ? url : new URL(String(url));
  if (target.hostname === WEBVPN_HOST) return target;
  const scheme = target.protocol.replace(/:$/, '');
  if (scheme !== 'https' && scheme !== 'http') {
    throw new ClassroomError('WEBVPN_URL', 'WebVPN 只能转发 HTTP(S) 地址');
  }
  const property = target.port ? `${scheme}-${target.port}` : scheme;
  const host = wrdEncrypt(URL_KEY, target.hostname);
  return new URL(`${WEBVPN_ORIGIN}/${property}/${host}${target.pathname}${target.search}`);
}

/** 网关路径里的编码段。`/https-8443/<hex>/path` 三段都要认出来。 */
const ENCODED_PATH = /^\/(https?)(?:-(\d+))?\/([0-9a-f]{32,})(\/[^?#]*)?$/i;

/**
 * 物理地址 → 逻辑地址。不是网关地址就给 null（调用方据此判断"这一跳是网关自己"）。
 *
 * @param url - 物理地址。
 * @returns 逻辑地址，或 null。
 */
export function fromWebvpnUrl(url) {
  const target = url instanceof URL ? url : new URL(String(url));
  if (target.hostname !== WEBVPN_HOST) return null;
  const match = target.pathname.match(ENCODED_PATH);
  if (!match) return null;
  const host = wrdDecrypt(URL_KEY, match[3]);
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new ClassroomError('WEBVPN_URL', 'WebVPN 地址中的站点名无效');
  const port = match[2] ? `:${match[2]}` : '';
  return new URL(`${match[1]}://${host}${port}${match[4] || '/'}${target.search}`);
}

/**
 * 这一跳是不是网关自己的登录/门户页。
 *
 * 被重定向到这里 = **网关会话失效**，不是"业务站点说没登录"。这两件事的
 * 处理方式完全不同（前者要重新登网关，后者要重新登业务站点），所以必须分开。
 *
 * @param url - 物理地址。
 * @returns 是不是网关的登录相关页。
 */
export function isWebvpnLoginUrl(url) {
  const target = url instanceof URL ? url : new URL(String(url));
  return target.hostname === WEBVPN_HOST && /^\/(login|portal|do-login|logout)(\/|$)/.test(target.pathname);
}

/**
 * 登录表单里的密码字段：网关要求用另一把钥匙编码后提交。
 *
 * @param password - 上网账号的明文密码。
 * @returns 编码后的值。
 */
export function webvpnPassword(password) {
  return wrdEncrypt(PASSWORD_KEY, password);
}

/**
 * 从登录页里取 `_csrf` 与 `captcha_id`。
 *
 * ⚠️ 只按 `name="…"` 精确匹配。此前本包在 CAS 那边踩过一次：用宽松正则去找
 * "错误提示"，结果匹配到了 `id="errormsg"` 这个**属性名**，把一次网络失败
 * 说成了"密码不对"。这里同理 —— 字段名必须整词比对。
 *
 * @param html - 登录页 HTML。
 * @returns `{ csrf, captchaId }`，取不到就是空串。
 */
export function parseWebvpnLoginPage(html) {
  const attr = (name) => {
    for (const tag of String(html ?? '').match(/<input\b[^>]*>/gi) ?? []) {
      const fields = Object.fromEntries(
        [...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3]]),
      );
      if (fields.name === name) return fields.value ?? '';
    }
    return '';
  };
  return { csrf: attr('_csrf'), captchaId: attr('captcha_id') };
}

/**
 * 网关登录失败的响应 → 一句用户能照做的话。
 *
 * 每个分支都要说清**下一步做什么**。网关的 `NEED_CONFIRM`（已在别处登录）
 * 与 `AUTH_CHALLENGE_REQUIRED`（要验证码）都不是"密码错"，归成一类会让用户
 * 反复改密码。这一点是本包在 CAS 那边已经踩过的同一个坑。
 *
 * @param code - 网关回的 `error` 字段。
 * @returns `{ code, message }`。
 */
export function describeWebvpnFailure(code) {
  const platform = String(code ?? 'UNKNOWN');
  if (platform === 'NEED_CONFIRM') {
    return {
      code: 'WEBVPN_CONFIRM_REQUIRED',
      message: 'WebVPN 提示这个账号已在别的设备登录，需要先确认。为避免把那边踢下线，这里停下了；请先在浏览器里退出 WebVPN 再重试。',
    };
  }
  if (platform === 'CAPTCHA_FAILED' || platform === 'NEED_CAPTCHA' || platform.startsWith('NEED_TWO_STEP') || platform === 'WECHAT_BINDING') {
    return {
      code: 'WEBVPN_CHALLENGE_REQUIRED',
      message: 'WebVPN 要求验证码或二次验证，脚本无法自动通过。请先在浏览器登录一次 webvpn.zju.edu.cn，再回来重试。',
    };
  }
  if (platform === 'TOO_MANY_ATTEMPTS') {
    return { code: 'WEBVPN_BLOCKED', message: 'WebVPN 因为失败次数过多暂时拒绝了登录，请过一会儿再试。' };
  }
  if (platform === 'IP_FORBIDDEN') {
    return { code: 'WEBVPN_BLOCKED', message: 'WebVPN 拒绝了当前网络的登录请求，请换一个网络再试。' };
  }
  if (platform === 'WEEK_PASSWORD_FORBID') {
    return { code: 'WEBVPN_BLOCKED', message: 'WebVPN 以密码太弱为由拒绝登录，请先修改密码。' };
  }
  return {
    code: 'WEBVPN_REJECTED',
    message: `WebVPN 没有接受这次登录（网关给出的原因是 ${platform}）。注意 WebVPN 用的是「上网账号」，和统一身份认证是两套系统 —— 两者密码不一定相同。`,
  };
}
