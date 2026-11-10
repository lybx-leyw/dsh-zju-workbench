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

import { WebvpnError } from './errors.js';
import {
  WEBVPN_HOST, WEBVPN_ORIGIN, isWebvpnLoginUrl, parseWebvpnLoginPage, webvpnPassword, describeWebvpnFailure,
} from './protocol.js';

/** 网关登录页。 */
export const WEBVPN_LOGIN_URL = `${WEBVPN_ORIGIN}/login`;
/** 网关登录提交。 */
export const WEBVPN_DO_LOGIN_URL = `${WEBVPN_ORIGIN}/do-login`;
/**
 * 二次确认提交。
 *
 * 网关在「同账号已在别处登录」时回 `NEED_CONFIRM`，要求再 POST 一次这个地址
 * （同一份 form）才放行。**这一步会踢掉别处那台设备的网关会话**。
 */
export const WEBVPN_CONFIRM_LOGIN_URL = `${WEBVPN_ORIGIN}/do-confirm-login`;

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
 * @param options.onConfirm - `NEED_CONFIRM` 触发二次确认时的回调（用于留日志）。
 *   这一步会踢掉别处那台设备的网关会话，所以调用方**必须**有地方记下来。
 */
export async function webvpnLogin(transport, credentials, { signal, onConfirm: warnedConfirm } = {}) {
  const { username, password } = credentials ?? {};
  if (!username || !password) {
    throw new WebvpnError('WEBVPN_CREDENTIALS', '还没有配置 WebVPN 的「上网账号」与密码。');
  }

  /* ── 第 1 步：取登录页，拿 _csrf 与加密用的 key/iv ───────────── */
  const page = await transport.request(WEBVPN_LOGIN_URL, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
    signal,
  });
  if (page.status !== 200) {
    throw new WebvpnError('WEBVPN_UNAVAILABLE', `WebVPN 登录页返回 HTTP ${page.status}，网关可能暂时不可用。`);
  }
  const { csrf, captchaId, key, iv } = parseWebvpnLoginPage(page.text);
  if (!csrf) {
    // 拿不到 _csrf 说明页面结构变了。把开头带出来便于排查，但**不做推断**。
    const preview = String(page.text ?? '').slice(0, 120).replace(/\s+/g, ' ');
    throw new WebvpnError('WEBVPN_SHAPE', `WebVPN 登录页里找不到 _csrf（页面结构可能变了）。页面开头：${preview}`);
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
    // 网关要求密码编码后提交。key/iv 优先用登录页里的那份（W5）：
    // 它们是页面决定的常量，写死一个值在网关换 key 时会表现为「密码怎么都不对」。
    password: webvpnPassword(password, { key, iv }),
  }).toString();

  const submit = (url) => transport.request(url, {
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

  let submitted = await submit(WEBVPN_DO_LOGIN_URL);

  let result;
  try {
    result = JSON.parse(submitted.text);
  } catch {
    throw new WebvpnError(
      'WEBVPN_SHAPE',
      `WebVPN 登录接口返回的不是 JSON（HTTP ${submitted.status}）。响应开头：${String(submitted.text ?? '').slice(0, 120)}`,
    );
  }

  /* ── 第 3 步：需要二次确认时再提交一次（W6） ──────────────────── */
  //
  // 网关在检测到「同一账号已在别处登录」时回 `NEED_CONFIRM`，要再 POST 一次
  // `/do-confirm-login`（同一份 form）才真正放行。上游就是这么做的
  // （`client.ts:180-181`）。
  //
  // ⚠️ 这一步会**踢掉别处那台设备的网关会话**。这是网关的语义，不是我们能选的；
  // 但**必须留下日志**，否则用户会莫名其妙发现另一台机器被登出。
  if (result?.error === 'NEED_CONFIRM') {
    warnedConfirm?.();
    submitted = await submit(WEBVPN_CONFIRM_LOGIN_URL);
    try {
      result = JSON.parse(submitted.text);
    } catch {
      throw new WebvpnError(
        'WEBVPN_SHAPE',
        `WebVPN 二次确认接口返回的不是 JSON（HTTP ${submitted.status}）。响应开头：${String(submitted.text ?? '').slice(0, 120)}`,
      );
    }
  }

  if (result?.success === true) {
    // 成功也验证一次：只有真的拿到会话，后面的改写才有意义。
    if (!(await hasWebvpnSession(transport.session))) {
      throw new WebvpnError('WEBVPN_NO_SESSION', 'WebVPN 说登录成功，但没有返回会话 cookie。');
    }
    return;
  }

  const failure = describeWebvpnFailure(result?.error);
  throw new WebvpnError(failure.code, failure.message);
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

/**
 * 网关的会话 cookie 名。
 *
 * 这个**必须**写死一个具体名字：`importTicket` 要往 jar 里塞一个能顶替登录结果的
 * cookie，塞错名字等于什么都没做。而 `hasWebvpnSession` 刻意**不**用具体名字判断
 * （见它自己的注释：网关换过名），两者口径不同是故意的。
 */
export const WEBVPN_TICKET_COOKIE = 'wengine_vpn_ticketwebvpn_zju_edu_cn';

/**
 * 网关会话是否仍然被服务端接受（W7）。
 *
 * 判据与上游 `client.ts:142-148` 一致：
 *   - `GET /` 返回 200 且页面里**没有** `name="_csrf"` → 已登录（登录页才有 csrf）；
 *   - 或者 3xx 跳转且目标**不是** `/login` → 也算有效。
 *
 * ⚠️ `Transport.request()` 返回的是 `{ status, headers, text }` —— **没有**
 * `isRedirect` / `location` 字段（那是上游 `HttpClient` 的形状）。重定向地址在
 * `headers.location` 里。照上游代码抄 `response.isRedirect` 会永远拿到 `undefined`，
 * 让整个 3xx 分支变成死代码。
 *
 * 只看缓存里的 cookie 不够：cookie 可能过期了但还在 jar 里。这个方法会真的发一次
 * 请求，所以调用方要接受它慢（一次往返）。
 *
 * @param transport - 带会话的 Transport。
 * @param options.signal - 取消信号。
 * @returns 会话是否有效。
 */
export async function probeWebvpnSession(transport, { signal } = {}) {
  if (!(await hasWebvpnSession(transport.session))) return false;
  let response;
  try {
    response = await transport.request(`${WEBVPN_ORIGIN}/`, { signal });
  } catch {
    // 发不出去不等于会话失效（可能只是网络抖动）。按「不知道」处理成无效，
    // 让调用方走登录路径 —— 登录内部会先 probe 再决定是否复用，不会多付代价。
    return false;
  }
  if (response.status === 200) return !/name="_csrf"/.test(String(response.text ?? ''));
  if (response.status >= 300 && response.status < 400) {
    // 重定向地址在头里。取不到就当作「不知道」，保守判无效。
    const location = readLocation(response.headers);
    if (!location) return false;
    return !/\/login/.test(location);
  }
  return false;
}

/**
 * 从响应头里取 `Location`（大小写不敏感）。
 *
 * `headers` 可能是 `Headers` 实例，也可能是普通对象 —— 两者都要认，
 * 因为 `Transport` 现在传的是前者，换实现时不该连带改这里。
 *
 * @param headers - 响应头。
 * @returns 地址，取不到就是空串。
 */
function readLocation(headers) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get('location') ?? '');
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'location') return String(value ?? '');
  }
  return '';
}

/**
 * 从浏览器导入网关会话（W7）—— 验证码过不去时的逃生口。
 *
 * # 为什么需要它
 *
 * 「WebVPN 要求验证码或二次验证」这条错误（`protocol.js` 的
 * `WEBVPN_CHALLENGE_REQUIRED`）的文案已经写着「请先在浏览器登录一次
 * webvpn.zju.edu.cn，再回来重试」。在补上这个方法之前，那句话是**空头承诺**：
 * 用户照做了，本包没有任何机制接收那个会话。
 *
 * # 用户怎么拿到 ticket
 *
 * 浏览器登录网关后，开发者工具 → Application → Cookies → `webvpn.zju.edu.cn`
 * → 复制 `wengine_vpn_ticketwebvpn_zju_edu_cn` 的值。有 `route` 的话一并复制。
 *
 * @param transport - 带会话的 Transport（`session.jar` 会被写入）。
 * @param input.ticket - ticket cookie 的值。
 * @param input.route - 可选的 `route` cookie 值。
 * @returns 导入后立即探测的结果（`valid`）。
 */
export async function importWebvpnTicket(transport, { ticket, route } = {}, { signal } = {}) {
  const value = String(ticket ?? '').trim();
  if (!value) {
    throw new WebvpnError('WEBVPN_TICKET', '没有给 ticket。请在浏览器登录 webvpn.zju.edu.cn 后，从开发者工具里复制 wengine_vpn_ticketwebvpn_zju_edu_cn 的值。');
  }
  // 只放网关自己域上的 cookie。jar 是共享的（业务站点也用它），不指定域会串到别处。
  await transport.session.jar.setCookie(`${WEBVPN_TICKET_COOKIE}=${value}; Domain=${WEBVPN_HOST}; Path=/; Secure`, `${WEBVPN_ORIGIN}/`);
  const routeValue = String(route ?? '').trim();
  if (routeValue) {
    await transport.session.jar.setCookie(`route=${routeValue}; Domain=${WEBVPN_HOST}; Path=/; Secure`, `${WEBVPN_ORIGIN}/`);
  }
  // 立即验证：导入了不等于能用，cookie 可能已经过期。让用户当场知道结果，
  // 而不是等到下一次请求失败。
  return { imported: true, valid: await probeWebvpnSession(transport, { signal }) };
}
