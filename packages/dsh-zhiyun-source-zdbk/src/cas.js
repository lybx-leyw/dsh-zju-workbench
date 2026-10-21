/**
 * 教务系统的 CAS 登录：**带 `service` 的统一认证**。
 *
 * # 为什么不复用 `dsh-zhiyun-source-campus` 的登录链（重要）
 *
 * campus 的 `cas/login.js` 文件头写得很明确：学在浙大「**不要带 `service` 参数**」，
 * 直接把 SSO 票种在 `zjuam` 域上，再带着它去访业务页。那是学在浙大的口径。
 *
 * 教务这边**正好相反**：`zdbk.zju.edu.cn/jwglxt` 不是一个会自己跟 CAS 握手的业务站，
 * 它等着一个**服务端回调**（`/xtgl/login_ssologin.html?ticket=…`）。不带 `service`，
 * CAS 登完就停在首页，没有人把 ticket 送回那个接收端 —— 于是 `/jwglxt` 下永远是未登录。
 *
 * 所以这里**不 import campus 的登录链**，而是把 `service` 一路带着跑完全程。
 * 两个包共用的是更下面那层：`Transport` / `SessionStore` / `ClassroomError`
 * （见 `dsh-zhiyun-source-campus/http`）。这也正是共享层刻意**不**包含
 * CAS 流程的原因 —— 一旦把某一方的策略钉进去，另一方就得绕开它。
 *
 * # 三处踩过的坑（都写在对应代码旁边）
 *
 * 1. **`getPubKey` 只认 JSON 的 `Accept`**，给它 `text/html` 会回 406 加一页 Tomcat 报错；
 * 2. **`service` 只能编码一次**，重复编码会回跳到一个 404 页，而 CAS 那一跳仍是"成功"的；
 * 3. **登录失败通常回 200 + 登录页**（不是 4xx），所以判据是「有没有票」，不是状态码。
 */

import { ClassroomError } from 'dsh-zhiyun-source-campus/http';

import { CAS_HOST, ZDBK_CAS_ENTRY, ZDBK_HOST, ZDBK_HOSTS } from './hosts.js';

const PUBKEY_URL = `https://${CAS_HOST}/cas/v2/getPubKey`;

/** 跳转上限。链路上正常只有 3~5 跳，留足余量但绝不无限跟。 */
const MAX_HOPS = 15;

/**
 * 解析一个 HTML 标签上的属性。
 *
 * 允许单引号与双引号两种写法：浙大 CAS 的页面在不同版本里混用，
 * 只认双引号的话会漏掉 `execution`，表现是「登录页缺少 execution 字段」。
 *
 * @param {string} tag - 形如 `<input name="execution" value="e1">` 的标签原文。
 * @returns {Record<string, string>} 小写属性名 → 解码后的值。
 */
function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map((m) => [m[1].toLowerCase(), (m[2] ?? m[3]).replace(/&amp;/g, '&').replace(/&quot;/g, '"')]),
  );
}

/**
 * 造一个「只允许跳去这几个主机」的地址校验器。
 *
 * # 为什么跳转要校验而不是直接跟
 *
 * 认证链路上任何一跳的 `Location` 都是**服务端给的**。不校验就等于允许远端
 * 把本包的请求（连同手里的 cookie）带去任意主机 —— 包括 `http://` 的明文地址。
 * 所以这里做三件事：强制 https、拒绝 URL 内嵌账号密码、主机必须在白名单里。
 *
 * `upgradeHttpHosts` 是白名单里**允许 http 被升到 https** 的那几个：正方偶尔
 * 回 `http://zdbk.zju.edu.cn/...` 的 service 回调，直接跟过去会被站点拒绝。
 *
 * @param {Iterable<string>} hosts - 允许的主机。
 * @param {Iterable<string>} upgradeHttpHosts - 允许 http→https 升级的主机。
 * @returns {(value: string|URL, base?: string|URL) => URL} 校验器（不合法即抛）。
 */
export function authUrlGuard(hosts, upgradeHttpHosts = []) {
  const allowed = new Set([CAS_HOST, 'identity.zju.edu.cn', ...hosts]);
  const upgrade = new Set(upgradeHttpHosts);
  return (value, base) => {
    let url;
    try {
      url = new URL(value, base);
    } catch {
      throw new ClassroomError('AUTH_REDIRECT_REJECTED', '统一认证返回了无法解析的跳转地址，已停止认证。');
    }
    if (url.protocol === 'http:' && upgrade.has(url.hostname)) url = new URL(`https:${url.href.slice('http:'.length)}`);
    if (url.protocol !== 'https:' || url.username || url.password || !allowed.has(url.hostname)) {
      throw new ClassroomError('AUTH_REDIRECT_REJECTED', '统一认证跳转到未配置的站点，已停止认证。', { hostname: url.hostname });
    }
    return url;
  };
}

/**
 * 从登录页里抠出提交用的表单信息。
 *
 * 校验点是**密码只能提交到已验证的浙大 CAS 接口**：`action` 必须落在
 * `zjuam.zju.edu.cn/cas/` 下。登录页的 `action` 是页面内容，不是我们写的常量，
 * 一个被篡改/劫持的页面足以让它指向别处 —— 那时把密码交出去就是灾难。
 *
 * # `service` 的补回
 *
 * 有的页面版本把 `action` 写成裸 `/cas/login`（不带查询串）。此时若直接 POST
 * 到它，`service` 就丢了 —— CAS 会登成功，但**不会回调教务**，表现是
 * 「密码明明对，登录完还是未登录」。所以这里在 `action` 缺 `service` 时，
 * 从登录页自己的 URL 上把它补回去。
 *
 * @param {string} html - 登录页 HTML。
 * @param {string|URL} url - 登录页地址（带着 `?service=…`）。
 * @param {(value: string|URL, base?: string|URL) => URL} guard - 地址校验器。
 * @returns {{ action: string, execution: string }} 提交地址与 execution token。
 */
export function casForm(html, url, guard = authUrlGuard([])) {
  const forms = [...html.matchAll(/<form\b[^>]*>/gi)].map((m) => attributes(m[0]));
  const form = forms.find((f) => f.id === 'fm1') || forms[0];
  const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map((m) => attributes(m[0]));
  const execution = inputs.find((i) => i.name === 'execution')?.value;
  if (!execution || !form) throw new ClassroomError('AUTH_FLOW_CHANGED', '统一认证页面未提供预期的登录表单。');

  const page = guard(url);
  const action = guard(form.action || String(page), page);
  if (action.hostname !== CAS_HOST || !action.pathname.startsWith('/cas/')) {
    throw new ClassroomError('AUTH_FORM_REJECTED', '密码只能提交到已验证的浙大统一认证接口。');
  }
  const service = page.searchParams.get('service');
  if (service && !action.searchParams.has('service')) action.searchParams.set('service', service);
  return { action: action.toString(), execution };
}

/** 登录页上有没有 `execution` 字段（即「这是一张要填的表单」而不是成功页）。 */
export function hasCasForm(html) {
  return /<input\b[^>]*name\s*=\s*["']execution["']/i.test(html);
}

/**
 * 按浙大 `login.js` / `security.js` 的打包方式做 RSA 加密。
 *
 * # 这套打包为什么不能换成「普通 RSA」
 *
 * 学校的实现是：把密码按 **UTF-16 单元**逐个取出、**整体反转**、再**小端**
 * 塞进大整数、最后按模长**分块**加密，块之间用空格拼。这既不是 UTF-8 也不是
 * 常见的填充方式；换成「看起来更标准」的做法，服务端解出来就是一串乱码，
 * 现象是密码被拒 —— 而用户会去改一个本来正确的密码。
 *
 * 反转是**整串反转**而不是逐块反转：`password.split('').reverse()` 后再分块。
 *
 * # 为什么拒绝非 ASCII 密码
 *
 * 上面的打包按 UTF-16 单元塞进 8 位宽的槽位，单元值一旦大于 0xFF（汉字、
 * 全角符号都在此列）就会溢出、丢高位。学校前端同样是这个行为 —— 也就是说
 * 非 ASCII 密码在这套编码下本来就是**不可能登上的**。与其提交一个必然失败的
 * 密文让用户以为「密码错了」，不如在提交前就明确停下并说清原因。
 *
 * @param {string} password - 明文密码（必须全 ASCII）。
 * @param {string} modulusHex - 公钥 modulus（hex）。
 * @param {string} exponentHex - 公钥 exponent（hex）。
 * @returns {string} 分块密文（每块 hex，空格分隔）。
 */
export function encryptCasPassword(password, modulusHex, exponentHex) {
  if (/[^\x00-\x7f]/.test(password)) {
    throw new ClassroomError('AUTH_PASSWORD_ENCODING_UNSUPPORTED', '当前已验证的统一认证编码支持 ASCII 密码。非 ASCII 口令的学校兼容编码尚待适配，已在提交前停止。');
  }
  if (!/^[a-f\d]{128,1024}$/i.test(modulusHex || '') || !/^[a-f\d]{1,8}$/i.test(exponentHex || '')) {
    throw new ClassroomError('AUTH_KEY_INVALID', '统一认证 RSA 公钥格式无法识别。');
  }
  const modulus = BigInt(`0x${modulusHex}`);
  const exponent = BigInt(`0x${exponentHex}`);
  // 每块能装多少个字符：模长（hex 位数）换算成 2 的幂后除以 8 位/字符。
  const chunkSize = 2 * Math.floor((modulus.toString(16).length - 1) / 4);
  if (modulus.toString(16).length < 128 || exponent < 3n || password.length > 4096) {
    throw new ClassroomError('AUTH_KEY_INVALID', '密码长度或公钥参数不受支持。');
  }
  const units = password.split('').reverse().map((c) => c.charCodeAt(0));
  const chunks = [];
  for (let start = 0; start < units.length; start += chunkSize) {
    let message = 0n;
    // 小端：高位先算，最后一位（下标 start）落在最低字节。
    for (let i = Math.min(start + chunkSize, units.length) - 1; i >= start; i--) message = message * 256n + BigInt(units[i]);
    let result = 1n;
    let factor = message;
    let power = exponent;
    while (power > 0n) {
      if (power & 1n) result = (result * factor) % modulus;
      factor = (factor * factor) % modulus;
      power >>= 1n;
    }
    const hex = result.toString(16);
    // 每块补齐到 4 的倍数：服务端按固定分组解密，长度不齐会解析失败。
    chunks.push(hex.padStart(Math.ceil(hex.length / 4) * 4, '0'));
  }
  return chunks.join(' ');
}

/**
 * 从 CAS 页面里取出**站点自己写的**错误文案。
 *
 * ⚠️ 必须**按元素取文本**，不能拿属性名当锚点。这是一次真实误判的教训
 * （完整复盘见 `dsh-zhiyun-source-campus/src/cas/login.js` 的 `casErrorMessage`）：
 * 用 `errorMsg` 这类宽松正则去找文案，会先命中 `id="errormsg"` 这个**属性名**，
 * 于是"错误文案"变成了一串标签残渣，再往上就被翻译成「学号或密码不对」——
 * 一次网络失败被报成密码错，用户于是反复改密码。
 *
 * @param {string} html - 页面 HTML。
 * @returns {string|null} 站点写的文案；没有就是 null（**不编造**）。
 */
export function casErrorMessage(html) {
  const text = String(html ?? '');
  const textOfId = (id) => {
    const pattern = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>([\\s\\S]*?)</\\1\\s*>`, 'i');
    const match = pattern.exec(text);
    if (!match) return '';
    return match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  // 浙大 CAS 现行结构：<p id="errormsg"><span id="msg">…</span></p>
  const fromMsg = textOfId('msg');
  if (fromMsg) return fromMsg;
  const fromWrapper = textOfId('errormsg');
  if (fromWrapper) return fromWrapper;
  return null;
}

/**
 * 把一次失败的 CAS 提交**如实描述**出来。
 *
 * 只转述页面明确写出的文案；没有就如实说没有，不推断「大概是密码错」。
 *
 * @param {{status: number, text: string}} submitted - POST 的响应。
 * @returns {string} 给用户看的一句话。
 */
export function describeAuthFailure(submitted) {
  const text = String(submitted?.text ?? '');
  const status = submitted?.status ?? '?';
  const siteError = casErrorMessage(text);
  if (siteError) return siteError;
  if (hasCasForm(text)) {
    return `CAS 返回了登录页但没有给出错误文案（HTTP ${status}）。`
      + '这不等于密码错误：也可能是网络异常、会话问题或页面结构变化。';
  }
  return `CAS 登录未成功（HTTP ${status}），返回的不是登录页。`;
}

/**
 * 跟一跳（`Transport` 一律 `redirect: 'manual'`，所以这里自己读 `Location`）。
 *
 * @param {import('dsh-zhiyun-source-campus/http').Transport} transport - 带会话的传输层。
 * @param {string|URL} url - 当前地址。
 * @param {{signal?: AbortSignal, accept?: string}} options - 逐请求选项。
 * @returns {Promise<{url: URL, status: number, location: string|null, text: string}>} 这一跳的结果。
 */
async function hop(transport, url, { signal, accept = 'text/html,application/xhtml+xml' } = {}) {
  const target = String(url);
  const result = await transport.request(target, {
    // ⚠️ `Accept` 必须**逐请求可覆盖**：`getPubKey` 只认 JSON，给它 HTML 会回 406。
    headers: { Accept: accept },
    signal,
  });
  return { url: new URL(target), status: result.status, location: result.headers.get('location'), text: result.text };
}

/**
 * 跟着 `Location` 与 `<meta http-equiv="refresh">` 走到底。
 *
 * `stopAtCas` 为真时，一旦落在 CAS 上就立刻返回（登录页要拿 `execution`，
 * 不能再往下跟）。为假时一路跟到不再重定向为止 —— 那是 SSO 回调的落点。
 *
 * @param {import('dsh-zhiyun-source-campus/http').Transport} transport - 传输层。
 * @param {URL} first - 起始地址（已校验）。
 * @param {(value: string|URL, base?: string|URL) => URL} guard - 地址校验器。
 * @param {boolean} stopAtCas - 是否在 CAS 上停下。
 * @param {AbortSignal} [signal] - 取消信号。
 * @returns {Promise<{url: URL, html: string}>} 落点与页面。
 */
async function follow(transport, first, guard, stopAtCas, signal) {
  let url = guard(first);
  for (let count = 0; count < MAX_HOPS; count++) {
    const response = await hop(transport, url, { signal });
    if (response.status >= 300 && response.status < 400 && response.location) {
      url = guard(response.location, url);
      continue;
    }
    if (response.status !== 200) {
      throw new ClassroomError('AUTH_NETWORK_ERROR', `认证链路返回 HTTP ${response.status}。`, { hostname: url.hostname, http_status: response.status });
    }
    const html = response.text;
    if (stopAtCas && url.hostname === CAS_HOST) return { url, html };
    // 有的中间跳用 meta refresh 而不是 302（学校旧版页面就是这样）。
    const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attributes(m[0])).find((a) => /refresh/i.test(a['http-equiv'] || ''));
    const target = meta?.content?.match(/url\s*=\s*(.+)$/i)?.[1]?.replace(/^['"]|['"]$/g, '');
    if (target) {
      url = guard(target, url);
      continue;
    }
    return { url, html };
  }
  throw new ClassroomError('AUTH_REDIRECT_LIMIT', '认证跳转超过限制，已停止。');
}

/**
 * 跑完一次真实的统一身份认证，把教务会话装进 `transport.session.jar`。
 *
 * 密码**最多提交一次**：被拒或被要求验证码就立刻停，不重试。重试只会：
 *   - 让账号的失败计数累加（学校会临时锁定）；
 *   - 在一个本该换出口/换登录方式的问题上反复消耗用户耐心。
 *
 * 若 jar 里已有 CAS 票（上一次登录成功但没走到教务），就直接续跑不回跳，
 * 因为**同号再登一次会作废前一张票**。
 *
 * @param {import('dsh-zhiyun-source-campus/http').Transport} transport - 传输层。
 * @param {object} options - 选项。
 * @param {string} [options.entry] - CAS 入口（已带 `service`）。
 * @param {string[]} [options.hosts] - 业务主机白名单。
 * @param {string[]} [options.upgradeHttpHosts] - 允许 http→https 的主机。
 * @param {() => Promise<{username: string, password: string}>} options.credentials - 凭据读取器（每次现读）。
 * @param {AbortSignal} [options.signal] - 取消信号。
 * @returns {Promise<{url: URL, html: string, passwordSubmitted: boolean}>} 落点。
 */
export async function casLogin(transport, options) {
  const entry = options?.entry ?? ZDBK_CAS_ENTRY;
  const hosts = options?.hosts ?? [ZDBK_HOST];
  const guard = authUrlGuard(hosts, options?.upgradeHttpHosts ?? [ZDBK_HOST]);
  const signal = options?.signal;

  const landing = await follow(transport, new URL(entry), guard, true, signal);
  // 已经登过：CAS 直接把票换成了 service 回调，压根没停在登录页。
  if (landing.url.hostname !== CAS_HOST) return { url: landing.url, html: landing.html, passwordSubmitted: false };

  if (!hasCasForm(landing.html)) {
    // 落在 CAS 但不是登录表单（例如「已登录」中转页）：再跟一跳看看。
    const done = await follow(transport, landing.url, guard, false, signal);
    if (done.url.hostname !== CAS_HOST) return { url: done.url, html: done.html, passwordSubmitted: false };
  }

  const form = casForm(landing.html, landing.url, guard);
  const account = await options.credentials();
  if (!account?.username || !account?.password) {
    throw new ClassroomError('CREDENTIALS', '请先在「设置 → 浙大一卡通」填入学号与密码');
  }

  /* ── 取 RSA 公钥 ──────────────────────────────────────────────── */
  const keyResponse = await hop(transport, PUBKEY_URL, { signal, accept: 'application/json' });
  let key;
  try {
    if (keyResponse.status !== 200) throw new Error('status');
    key = JSON.parse(keyResponse.text);
  } catch {
    throw new ClassroomError('AUTH_KEY_INVALID', '无法取得统一认证公钥。');
  }

  const body = new URLSearchParams({
    username: account.username,
    password: encryptCasPassword(account.password, key?.modulus ?? '', key?.exponent ?? ''),
    execution: form.execution,
    _eventId: 'submit',
    authcode: '',
  }).toString();

  const submitted = await transport.request(form.action, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml',
      Origin: `https://${CAS_HOST}`,
      Referer: landing.url.toString(),
    },
    signal,
  });

  /* ── 判据是「有没有票」，不是状态码 ────────────────────────────── */
  // CAS 登录失败通常回 200 + 登录页（带错误提示）而不是 4xx，
  // 所以看状态码会把每次失败都判成成功。
  const sso = (await transport.session.jar.getCookies(`https://${CAS_HOST}/cas/login`))
    .find((cookie) => cookie.key === 'iPlanetDirectoryPro');
  if (!sso?.value) {
    if (!(submitted.status >= 300 && submitted.status < 400)
      && !/用户名或密码错误|密码错误|账号或密码/.test(submitted.text ?? '')
      && /验证码|captcha|二次验证|短信|动态码/i.test(submitted.text ?? '')) {
      throw new ClassroomError('AUTH_CHALLENGE_REQUIRED', '统一认证要求验证码或二次验证。请先在浏览器完成一次登录后再试；不会自动重试。', { http_status: submitted.status });
    }
    throw new ClassroomError('AUTH_REJECTED', describeAuthFailure(submitted), { http_status: submitted.status });
  }

  /* ── 跟着 SSO 回调回到教务 ────────────────────────────────────── */
  if (submitted.status >= 300 && submitted.status < 400 && submitted.headers.get('location')) {
    const done = await follow(transport, guard(submitted.headers.get('location'), form.action), guard, false, signal);
    if (done.url.hostname === CAS_HOST) {
      throw new ClassroomError('AUTH_REJECTED', '统一认证流程停留在登录页，未返回教务系统。', { hostname: done.url.hostname });
    }
    return { url: done.url, html: done.html, passwordSubmitted: true };
  }

  // 没有 Location 的 200：不是预期形态，但票已经拿到了。
  // 这里不假装知道教务侧的状态 —— 由调用方的 preflight（真实业务读取）来验证，
  // 那才是有证据的判据。
  return { url: landing.url, html: submitted.text, passwordSubmitted: true };
}

export { CAS_HOST, ZDBK_CAS_ENTRY, ZDBK_HOSTS };
