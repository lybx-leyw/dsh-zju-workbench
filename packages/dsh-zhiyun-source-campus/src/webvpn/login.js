/**
 * WebVPN 网关的登录。
 *
 * # 它和 CAS 是**两套**认证
 *
 * | | 统一身份认证（CAS） | WebVPN 网关 |
 * | --- | --- | --- |
 * | 账号 | 学号 | **上网账号**（通常也是学号，但不保证） |
 * | 密码 | 统一身份认证密码 | **上网密码**（可能是另一套） |
 * | 用途 | 课堂、学在浙大 | 只在**校外**访问校内站点时用 |
 *
 * 这两条经常被混为一谈，后果很具体：用户在校外看到"登录失败"，去改统一认证
 * 密码，然后还是失败。所以本模块的每条错误文案都要点明"这是上网账号"。
 *
 * # 会话归属
 *
 * 网关会话存在**自己的** jar 里（`webvpn.session`），与学在浙大 / 拼题A 的
 * 会话完全分开：网关过期与业务站点过期是两件事，混在一个 jar 里会让
 * "清除学在浙大登录"顺手把网关会话也清掉。
 */

import { ClassroomError } from '../cas/errors.js';
import {
  WEBVPN_ORIGIN, isWebvpnLoginUrl, parseWebvpnLoginPage, webvpnPassword, describeWebvpnFailure,
} from './protocol.js';

/** 网关登录页。 */
export const WEBVPN_LOGIN_URL = `${WEBVPN_ORIGIN}/login`;
/** 网关登录提交。 */
export const WEBVPN_DO_LOGIN_URL = `${WEBVPN_ORIGIN}/do-login`;

/**
 * 会话 jar 里是否已经有网关会话。
 *
 * 判据取"网关域上有没有 cookie"而不是某个具体名字：网关用过好几种会话
 * cookie 名，钉死一个名字会在它换名时静默失效。
 *
 * @param session - 带 jar 的会话对象。
 * @returns 有没有。
 */
export async function hasWebvpnSession(session) {
  try {
    const cookies = await session.jar.getCookies(`${WEBVPN_ORIGIN}/`);
    return cookies.some((cookie) => cookie.value);
  } catch {
    return false;
  }
}

/**
 * 登录网关，把会话收进 `session.jar`。
 *
 * 调用方必须保证 `transport` 的 `fetch` 是**直连**出口：网关自己不能被
 * WebVPN 改写（否则是网关的网关）。
 *
 * @param transport - 带会话的 Transport（`session.jar` 会被填充）。
 * @param credentials - `{ username, password }`，即**上网账号**。
 * @param options.signal - 取消信号。
 */
export async function webvpnLogin(transport, credentials, { signal } = {}) {
  const { username, password } = credentials ?? {};
  if (!username || !password) {
    throw new ClassroomError('WEBVPN_CREDENTIALS', '还没有配置 WebVPN 的「上网账号」与密码。');
  }

  /* ── 第 1 步：取登录页，拿 _csrf ──────────────────────────────── */
  const page = await transport.request(WEBVPN_LOGIN_URL, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
    signal,
  });
  if (page.status !== 200) {
    throw new ClassroomError('WEBVPN_UNAVAILABLE', `WebVPN 登录页返回 HTTP ${page.status}，网关可能暂时不可用。`);
  }
  const { csrf, captchaId } = parseWebvpnLoginPage(page.text);
  if (!csrf) {
    // 拿不到 _csrf 说明页面结构变了。把开头带出来便于排查，但**不做推断**。
    const preview = String(page.text ?? '').slice(0, 120).replace(/\s+/g, ' ');
    throw new ClassroomError('WEBVPN_SHAPE', `WebVPN 登录页里找不到 _csrf（页面结构可能变了）。页面开头：${preview}`);
  }

  /* ── 第 2 步：提交 ──────────────────────────────────────────── */
  const form = new URLSearchParams({
    _csrf: csrf,
    auth_type: 'local',
    sms_code: '',
    captcha: '',
    needCaptcha: 'false',
    captcha_id: captchaId,
    username,
    // 网关要求密码用**另一把**钥匙编码后提交，不是明文
    password: webvpnPassword(password),
  }).toString();

  const submitted = await transport.request(WEBVPN_DO_LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: WEBVPN_LOGIN_URL,
      Origin: WEBVPN_ORIGIN,
      Accept: 'application/json',
    },
    body: form,
    signal,
  });

  let result;
  try {
    result = JSON.parse(submitted.text);
  } catch {
    throw new ClassroomError(
      'WEBVPN_SHAPE',
      `WebVPN 登录接口返回的不是 JSON（HTTP ${submitted.status}）。响应开头：${String(submitted.text ?? '').slice(0, 120)}`,
    );
  }

  if (result?.success === true) {
    // 成功也验证一次：只有真的拿到会话，后面的改写才有意义。
    if (!(await hasWebvpnSession(transport.session))) {
      throw new ClassroomError('WEBVPN_NO_SESSION', 'WebVPN 说登录成功，但没有返回会话 cookie。');
    }
    return;
  }

  const failure = describeWebvpnFailure(result?.error);
  throw new ClassroomError(failure.code, failure.message);
}

/**
 * 一次请求的结果是不是"被踢回网关登录页"。
 *
 * 这是**网关会话过期**的唯一可靠信号：业务站点不会返回这个地址。
 *
 * @param location - 响应里的 `Location` 头（可能为 null）。
 * @returns 是不是。
 */
export function redirectedToWebvpnLogin(location) {
  if (!location) return false;
  try {
    return isWebvpnLoginUrl(new URL(String(location), WEBVPN_ORIGIN));
  } catch {
    return false;
  }
}
