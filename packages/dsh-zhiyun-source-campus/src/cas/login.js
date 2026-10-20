/**
 * 学在浙大登录：**ZJUAM 换 SSO 票 → 手动跟跳转链 → 收每一跳的 cookie**。
 *
 * 实现口径来自本仓的 Flutter 版（`zhiyun-pro` 的 `zjuam_client.dart` +
 * `courses_todo_data_source.dart` 的 `_loginCourses`）。那里的关键结论有三条，
 * 每条都是踩过的坑：
 *
 * # 1. **不要带 `service` 参数**
 *
 * 直接 `POST /cas/login`，不拼 `?service=…`。CAS 会自己把 `iPlanetDirectoryPro`
 * 种在 `zjuam` 域上；之后**带着这个 cookie 去访问业务页**，业务站点的 CAS 过滤器
 * 自然会认出身份并种下站点自己的 session。
 *
 * 早先那版拼了 `service` 并期待 CAS 302 回来，还自己去追 Location —— 那条链
 * 在票已经在手时行为并不稳定，表现是"登录成功但会话为空"。
 *
 * # 2. **必须手动跟跳转，不能用自动重定向**
 *
 * 自动重定向会**丢掉中间跳的 `Set-Cookie`**，而 CAS 的会话恰恰藏在那里
 * （Flutter 版文件头有同款说明）。所以每一跳都要 `redirect: 'manual'`，
 * 自己读 `Location`、自己收 `Set-Cookie`、自己决定下一跳。
 *
 * # 3. **每一跳的 cookie 要写进"出现过的每个域"**
 *
 * `iPlanetDirectoryPro` 属于 `zju.edu.cn`，站点的 `session` 属于
 * `courses.zju.edu.cn`。只写一个域的话，下次就还得重新登录。
 *
 * # CAS 单点会话
 *
 * 同一学号两次登录会互相作废 ticket（Flutter 版实测确认）。所以：
 * **先试已有会话，能用就不要重登**。
 */

import { ClassroomError } from './errors.js';
import { executionToken, rsaEncrypt } from './auth.js';

const CAS_BASE = 'https://zjuam.zju.edu.cn/cas';
const CAS_HOST = 'zjuam.zju.edu.cn';
const COURSES_BASE = 'https://courses.zju.edu.cn';
const COURSES_HOST = 'courses.zju.edu.cn';

/** 跳转链上限（与 Flutter 版一致）。 */
const MAX_HOPS = 20;

/**
 * 把 http 升到 https。
 *
 * CAS 的回调有时给 `http://courses.zju.edu.cn/...`，直接跟过去会被站点拒绝
 * 或触发一次多余的重定向。
 *
 * @param url - 原始地址。
 * @returns https 地址。
 */
export function upgrade(url, base = `${COURSES_BASE}/user/index`) {
  const parsed = new URL(url, base);
  if (!['http:', 'https:'].includes(parsed.protocol)
      || ![CAS_HOST, COURSES_HOST, 'identity.zju.edu.cn'].includes(parsed.hostname)
      || parsed.username || parsed.password || (parsed.port && !['80', '443'].includes(parsed.port))) {
    throw new ClassroomError('AUTH_REDIRECT', '登录跳转到未支持的站点');
  }
  if (parsed.protocol === 'http:') parsed.protocol = 'https:';
  return parsed.toString();
}

/**
 * 手动跟一跳，返回 `{ location, setCookies, status }`。
 *
 * @param transport - 带会话的 Transport。
 * @param url - 当前地址。
 * @param options - `{ signal, cookieHeader }`。
 * @returns 这一跳的结果。
 */
async function hop(transport, url, { signal, accept = 'text/html,application/xhtml+xml' } = {}) {
  const result = await transport.request(url, {
    // ⚠️ `Accept` 必须**逐请求可覆盖**。
    //    CAS 的 `/cas/v2/getPubKey` 是 JSON 接口，若收到
    //    `Accept: text/html,application/xhtml+xml` 会直接回 **HTTP 406 不可接收**，
    //    正文是一段 Tomcat 错误页 —— 于是解析 JSON 失败，报
    //    「公钥接口返回的不是 JSON」。登录页要 HTML、公钥要 JSON，
    //    两者不能共用一个写死的值。
    headers: { Accept: accept },
    signal,
  });
  return {
    url,
    status: result.status,
    // 自动重定向会把中间跳的 Set-Cookie 丢掉，所以 Transport 一律 manual，
    // 这里自己读 Location
    location: result.headers.get('location'),
    text: result.text,
  };
}

/**
 * 判断登录页是否**要求人工介入**（图形验证码、二次验证、扫码）。
 *
 * 这类要求一旦出现，脚本式登录就**必然失败**——不是密码错，也不是代码错。
 * 在提交之前先检测，可以避免"每次都白提交一次、还累加失败计数"。
 *
 * @param html - 登录页 HTML。
 * @returns 需要人工介入时返回原因字符串，否则 null。
 */
/**
 * ⚠️ 这里**曾经**有一个 `detectNeedsHuman()`，靠"登录页 HTML 里有没有
 * `#kaptcha` / `authcode` 字段"来判断"是否要求人工验证"。**那是错的，已删除。**
 *
 * 错在哪：`#kaptcha` 与 `authcode` 是浙大 CAS 登录页的**固定结构**（一直存在、
 * 平时由前端隐藏），并不表示这一次登录真的要求验证码。把静态结构当成运行时要求，
 * 后果是我把一次普通的登录失败归因成"需要人工验证"，并让页面显示"自动登录走不通"——
 * 而实际情况是浙大**没有**启用验证码场景。
 *
 * 教训写在这里而不是删干净：这类"从 HTML 里找特征就下结论"的推断很容易再犯，
 * 而且它的错误方向很危险 —— 会把一个可修的问题说成"做不到"。
 */

/**
 * 从 CAS 登录页里取出**站点自己写的**错误文案。
 *
 * # 为什么必须精确取 `#msg`，不能用宽松正则
 *
 * 这里有过一次真实的误判。原先的实现是：
 *
 * ```js
 * text.match(/(?:auth_error|errorMsg|error_message|错误提示)[^<]{0,120}/i)
 * ```
 *
 * 浙大 CAS 的错误提示容器是 `<p id="errormsg" …><span id="msg">用户名或密码错误</span></p>`。
 * 上面那个正则里的 `errorMsg`（忽略大小写）**先匹配到了属性名 `id="errormsg"`**，
 * 而 `[^<]{0,120}` 接着吃掉了后面的 `" role="heading">`，于是返回的"错误文案"是：
 *
 * ```
 * errormsg" role="heading">
 * ```
 *
 * 再往上，调用方把所有 `AUTH_REJECTED` 一律翻译成"学号或密码不对"。结果就是：
 * **一次彻头彻尾的网络失败，被报成了"你的密码错了"**，用户于是反复去改密码，
 * 而真正该做的是换出口。
 *
 * 教训：从 HTML 里找文案必须**按元素取文本**，不能拿属性名当锚点。
 *
 * @param html - 登录页 HTML。
 * @returns 站点写的错误文案；没有就 null。
 */
export function casErrorMessage(html) {
  const text = String(html ?? '');

  /** 取某个 `id` 元素里的纯文本（去标签、压空白）。 */
  const textOfId = (id) => {
    const pattern = new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>([\\s\\S]*?)</\\1\\s*>`, 'i');
    const match = pattern.exec(text);
    if (!match) return '';
    return match[2]
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // 浙大 CAS 现行结构：<p id="errormsg"><span id="msg">…</span></p>
  const fromMsg = textOfId('msg');
  if (fromMsg) return fromMsg;
  const fromWrapper = textOfId('errormsg');
  if (fromWrapper) return fromWrapper;

  // 兼容旧页面：某些版本把文案直接放在 `auth_error` 类的元素里。
  const legacy = text.match(/<(?:span|div|p)\b[^>]*class\s*=\s*["'][^"']*\bauth_error\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div|p)>/i);
  if (legacy) {
    const cleaned = legacy[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned) return cleaned;
  }

  /**
   * 最后一道兜底：页面上确实写出了"用户名或密码错误"这类**站点文案**。
   *
   * ⚠️ 这里匹配的是**中文正文**，不是属性名。上面那个误判就是因为拿
   *    `errorMsg` 这种属性名当锚点。所以这条兜底只认几种站点真的会印在
   *    页面上的成句文案，且要求它出现在标签之外（`>…<` 之间）。
   */
  const bodyText = text
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  const inText = bodyText
    .replace(/<[^>]*>/g, '\u0000')          // 标签压成哨兵，避免跨标签拼接出假句子
    .split('\u0000')
    .map((piece) => piece.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const known = /^(?:用户名或密码错误|错误密码[^。]{0,40}|账号或密码错误|密码错误|用户不存在|账号已锁定|账号已被暂时锁定)$/;
  const hit = inText.find((piece) => known.test(piece));
  return hit ?? null;
}

/**
 * 把一次失败的 CAS 提交**如实描述**出来，不猜原因。
 *
 * 只转述页面**明确写出**的错误文案；没有就如实说没有，不推断。
 *
 * @param submitted - POST 的响应（`{ status, text }`）。
 * @returns 给用户看的一句话。
 */
export function describeAuthFailure(submitted) {
  const text = String(submitted?.text ?? '');
  const status = submitted?.status ?? '?';

  const siteError = casErrorMessage(text);
  if (siteError) return siteError;

  if (/name=["']execution["']/i.test(text)) {
    // 只有登录表单、没有任何错误文案：**这是最常见的情况**，如实说。
    // ⚠️ 不要在这里补一句"可能是密码错了" —— 那正是本次误判的来源。
    return `CAS 返回了登录页但没有给出错误文案（HTTP ${status}）。`
      + '这不等于密码错误：也可能是网络异常、会话问题或页面结构变化。';
  }
  return `CAS 登录未成功（HTTP ${status}），返回的不是登录页。`;
}

/**
 * 登录并换出学在浙大会话。
 *
 * @param transport - 带会话的 Transport（`session.jar` 会被填充）。
 * @param credentials - `{ username, password }`。
 * @param options - `{ signal }`。
 */
export async function xzzdLogin(transport, credentials, { signal } = {}) {
  const { username, password } = credentials ?? {};
  if (!username || !password) throw new ClassroomError('CREDENTIALS', '请先在「设置 → 浙大一卡通」填入学号与密码');

  // A previous attempt may have completed CAS but stopped during business
  // redirects. Continue that ticket; do not invalidate it with another POST.
  const existing = await transport.session.jar.getCookies(`${CAS_BASE}/login`);
  if (existing.some(cookie => cookie.key === 'iPlanetDirectoryPro' && cookie.value)) {
    try { return await xzzdAuthorize(transport, { signal }); }
    catch (error) {
      if (error.code !== 'AUTH_EXPIRED') throw error;
      for (const cookie of existing.filter(c => c.key === 'iPlanetDirectoryPro')) {
        await transport.session.jar.setCookie(cookie.cookieString() + '; Max-Age=0; Path=' + cookie.path + (cookie.hostOnly ? '' : '; Domain=' + cookie.domain), CAS_BASE + '/login');
      }
    }
  }

  /* ── 第 1 步：CAS 登录页 → execution token ───────────────────── */
  const loginUrl = `${CAS_BASE}/login`;
  const page = await hop(transport, loginUrl, { signal });

  const execution = executionToken(page.text);
  if (!execution) {
    // 页面不是登录页，可能是网络劫持/门户页。把开头一小段带出来便于排查。
    const preview = String(page.text ?? '').slice(0, 120).replace(/\s+/g, ' ');
    throw new ClassroomError('AUTH_SHAPE', '统一认证登录页缺少 execution 字段，请检查站点是否可正常打开');
  }

  /* ── 第 2 步：取 RSA 公钥 ────────────────────────────────────── */
  const keyPage = await hop(transport, `${CAS_BASE}/v2/getPubKey`, {
    signal,
    // 这个接口只认 JSON 的 Accept，给它 HTML 会回 406
    accept: 'application/json',
  });
  if (keyPage.status !== 200) {
    throw new ClassroomError('AUTH_SHAPE', `取 RSA 公钥失败（HTTP ${keyPage.status}）`);
  }
  let key;
  try {
    key = JSON.parse(keyPage.text);
  } catch {
    throw new ClassroomError('AUTH_SHAPE', '统一认证公钥接口返回的不是 JSON');
  }
  if (!key?.modulus || !key?.exponent) {
    throw new ClassroomError('AUTH_SHAPE', 'RSA 公钥接口缺少 modulus / exponent');
  }

  /* ── 第 3 步：RSA 加密密码 ──────────────────────────────────── */
  let encrypted;
  try {
    encrypted = rsaEncrypt(password, String(key.modulus), String(key.exponent));
  } catch {
    throw new ClassroomError('AUTH_SHAPE', 'RSA 公钥格式异常，无法加密密码');
  }

  /* ── 第 4 步：POST /cas/login → SSO 票 ──────────────────────── */
  const form = new URLSearchParams({
    username,
    password: encrypted,
    execution,
    _eventId: 'submit',
    rememberMe: 'true',
  }).toString();

  const submitted = await transport.request(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html,application/xhtml+xml',
    },
    body: form,
    signal,
  });

  // CAS 登录失败通常回 200 + 登录页（带错误提示），而不是 4xx。
  // 所以判据是"有没有票"，不是状态码。
  const ssoCookies = await transport.session.jar.getCookies(`${CAS_BASE}/login`);
  const sso = ssoCookies.find((cookie) => cookie.key === 'iPlanetDirectoryPro');
  if (!sso?.value) {
    /**
     * ⚠️ **不能**只凭"返回了登录页"就断定密码错。
     *
     * 浙大 CAS 在以下情况都会回登录页，且都不代表密码错：
     *   - **要求图形验证码**（页面含 `#kaptcha` 与 `authcode` 字段）——
     *     脚本拿不到验证码，提交必然失败；
     *   - 账号因多次失败被临时限制；
     *   - 要求二次验证 / 扫码确认。
     *
     * 早先这里写死成「学号或密码错误（CAS 返回了登录页）」，把上面几种
     * 全归因成密码问题 —— 用户于是去反复改密码，而真正该做的是换登录方式。
     * 这里改成**如实列出观测到的证据**，让调用方与用户自己能判断。
     */
    throw new ClassroomError('AUTH_REJECTED', describeAuthFailure(submitted), {
      status: submitted.status,
    });
  }

  /* ── 第 5 步：带着 SSO 票访问业务页，收站点会话 ──────────────── */
  // 从 /user/index 起步，一路跟到站点不再重定向为止。
  // 每一跳都经过 Transport，它会按 hosts 白名单把 Set-Cookie 收进 jar。
  return xzzdAuthorize(transport, { signal });
}

/** Continue an existing SSO ticket without submitting the password again. */
export async function xzzdAuthorize(transport, { signal } = {}) {
  let url = `${COURSES_BASE}/user/index`;
  for (let hops = 0; hops < MAX_HOPS; hops += 1) {
    const step = await hop(transport, url, { signal });

    // 会话失效/未登录时站点会 302 去 CAS —— 那是登录没成功，不是"再跟一跳"
    const next = step.location ? upgrade(step.location, url) : null;
    if (!next) {
      if (new URL(url).hostname === CAS_HOST && executionToken(step.text)) {
        throw new ClassroomError('AUTH_EXPIRED', '统一认证会话已过期');
      }
      if (step.status !== 200 || new URL(url).hostname !== COURSES_HOST) {
        throw new ClassroomError('AUTH_INCOMPLETE', '学在浙大业务授权没有完成');
      }
      // 不再重定向：这就是落点
      const cookies = await transport.session.jar.getCookies(`${COURSES_BASE}/user/index`);
      if (!cookies.some((cookie) => cookie.key === 'session' && cookie.value)) {
        throw new ClassroomError('AUTH_INCOMPLETE', '登录流程走完，但学在浙大没有返回 session cookie');
      }
      return;
    }
    url = next;
  }
  throw new ClassroomError('AUTH_LOOP', '学在浙大登录跳转超过上限');
}

export { CAS_HOST, COURSES_HOST };



