import { ClassroomError } from './errors.js';
import { AUTH_HOSTS } from './transport.js';

const CAS = 'https://zjuam.zju.edu.cn/cas';
const CLASSROOM = 'https://classroom.zju.edu.cn/';
// 两个入口的差别只有「从哪起跑」和「表单之后往哪续跑」，中间的 CAS 表单
// （execution → getPubKey → RSA → POST）完全同构，因此只写一份。
// cas：既有行为，起点固定是 tgmedia 的业务登录页。
const CAS_ENTRY = 'https://tgmedia.cmc.zju.edu.cn/index.php?r=auth%2Flogin&forward=https%3A%2F%2Fclassroom.zju.edu.cn%2F';
// oauth：classroom 自己的 casapi 入口，服务端先跳 cas/oauth2.0/authorize 走授权码
// 链路，再由回调在 _token cookie 里写入 JWT，最后 302 到 classroom。
// 保留这里是为了「入口坏了能一眼看出是哪条链」，别把两者混成一个 URL 拼接函数。
const OAUTH_ENTRY = `https://yjapi.cmc.zju.edu.cn/casapi/index.php?r=auth/login&forward=${encodeURIComponent(CLASSROOM)}&tenant_code=112`;

export function rsaEncrypt(plaintext, modulusHex, exponentHex) {
  if (!/^[\da-f]+$/i.test(modulusHex) || !/^[\da-f]+$/i.test(exponentHex)) throw new TypeError('RSA 公钥格式异常');
  const modulus = BigInt(`0x${modulusHex}`), exponent = BigInt(`0x${exponentHex}`);
  if (modulus <= 0n || exponent <= 0n) throw new TypeError('RSA 参数须为正整数');
  const hex = Buffer.from(plaintext, 'utf8').toString('hex');
  let base = (hex ? BigInt(`0x${hex}`) : 0n) % modulus, power = exponent, result = 1n;
  while (power > 0n) { if (power & 1n) result = result * base % modulus; power >>= 1n; base = base * base % modulus; }
  return result.toString(16).padStart(128, '0');
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m => [m[1].toLowerCase(), m[2] ?? m[3]]));
}
export function executionToken(html) {
  for (const tag of html.match(/<input\b[^>]*>/gi) ?? []) { const a = attributes(tag); if (a.name === 'execution') return a.value; }
  return null;
}
export function nextLocation(result, url) {
  let next = result.headers.get('location');
  if (!next) for (const tag of result.text.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attributes(tag);
    if (a['http-equiv']?.toLowerCase() === 'refresh') next = a.content?.match(/url\s*=\s*(.+)$/i)?.[1]?.replace(/^["']|["']$/g, '');
    if (next) break;
  }
  if (!next) return null;
  const target = new URL(next.replaceAll('&amp;', '&'), url);
  if (target.protocol === 'http:') target.protocol = 'https:';
  if (target.protocol !== 'https:' || !AUTH_HOSTS.has(target.hostname) || target.username || target.password) throw new ClassroomError('AUTH_REDIRECT', '登录跳转到未支持的站点');
  return target.href;
}
// 两个入口共用的跳转跟随：消费 Location 与 meta refresh，直到某一跳不再重定向。
// ⚠ 强制 https、AUTH_HOSTS 白名单、拒绝 URL 内嵌 username/password 这三条严格校验
// 全部仍由 nextLocation() 独占负责；这里只做循环，所以第二个入口不可能漏掉其中任何一条。
async function follow(transport, start, { signal, label }) {
  let url = start;
  for (let hop = 0; hop < 20; hop++) {
    const result = await transport.request(url, { signal });
    if (result.status >= 400) throw new ClassroomError('AUTH_HTTP', `${label}请求失败`, { status: result.status, hop });
    const next = nextLocation(result, url);
    if (!next) return { url, result, hop };
    url = next;
  }
  throw new ClassroomError('AUTH_LOOP', '登录跳转次数超限');
}
// 终点判定沿用原逻辑：落在 classroom 且没有下一跳才算成功，随后落盘会话。
async function finishAtClassroom(transport, { url, hop }) {
  const host = new URL(url).hostname;
  if (host !== 'classroom.zju.edu.cn') throw new ClassroomError('AUTH_INCOMPLETE', '智云业务登录未完成', { host, hop });
  await transport.session.save();
}
// CAS 表单提交：两个入口唯一的分叉是「第一页从哪来」。
async function submitCasForm(transport, { username, password }, { signal, entry }) {
  const landing = entry === 'oauth'
    // oauth 入口的第一页由服务端 302 领过来：casapi → oauth2.0/authorize → cas/login。
    ? await follow(transport, OAUTH_ENTRY, { signal, label: '登录页' })
    // cas 入口保持既有行为：直接取 CAS 登录页，不额外追随（现状就是这么跑的）。
    : { url: `${CAS}/login`, result: await transport.request(`${CAS}/login`, { signal }) };
  const execution = executionToken(landing.result.text);
  if (!execution) throw new ClassroomError('AUTH_SHAPE', '登录页缺少 execution');
  const key = await transport.json(`${CAS}/v2/getPubKey`, '登录公钥', { signal });
  let encrypted;
  try { encrypted = rsaEncrypt(password, key.modulus, key.exponent); } catch { throw new ClassroomError('AUTH_SHAPE', '登录公钥格式异常'); }
  const body = new URLSearchParams({ username, password: encrypted, execution, _eventId: 'submit', rememberMe: 'true' });
  // 回投到表单页自己的地址：oauth 链路的登录页带 ?service=…，丢了它 CAS 不会回调。
  const login = await transport.request(landing.url, { signal, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const sso = (await transport.session.jar.getCookies(`${CAS}/login`)).find(c => c.key === 'iPlanetDirectoryPro');
  // 两个入口都必须拿到 CAS 的 SSO 票：没有它就等于密码被拒，后面怎么跑都没意义。
  if (!sso?.value) throw new ClassroomError('AUTH_REJECTED', '登录未成功，请检查凭据或官网验证提示', { status: login.status });
  return { login, form: landing.url };
}
// 从 cookie 里取 _token 再抠出 JWT。入参故意只收「Cookie 头/Set-Cookie 行字符串」
// 或「[{key,value}] 这类纯数据数组」，不收 transport —— 这样解析逻辑能脱离网络单独
// 测试，也不会把会话对象（连同其它会话 cookie）带进一个纯字符串函数。
export function jwtFromTokenCookie(jar) {
  const raw = tokenCookieValue(jar);
  if (raw == null) return null;
  let value = raw;
  // Yii 的 _token 通常是 URL 编码的（签名 + {"...JWT..."}）；也有已解码的形态。
  // decodeURIComponent 遇到裸 % 会抛错，此时按原文继续匹配即可。
  try { value = decodeURIComponent(raw); } catch { /* 保留原文 */ }
  return /eyJ[\w-]+\.[\w-]+\.[\w-]+/.exec(value)?.[0] ?? null;
}
function tokenCookieValue(jar) {
  if (typeof jar === 'string') {
    // 值的侧边界只取 ';'：Yii 签名里可能出现 JSON 的引号/逗号/花括号。
    const match = /(?:^|;\s*)_token=([^;]*)/.exec(jar);
    return match ? match[1].trim() : null;
  }
  if (!Array.isArray(jar)) return null;
  for (const item of jar) {
    if (typeof item === 'string') { const found = tokenCookieValue(item); if (found != null) return found; continue; }
    // tough-cookie 的 Cookie 用 key，浏览器侧对象用 name。
    if (item && typeof item === 'object' && (item.key === '_token' || item.name === '_token')) return String(item.value ?? '');
  }
  return null;
}
// 只解析 payload，不校验签名！这个结论必须写在这里，因为它太容易被当成鉴权：
// 任何人随手拼三段 base64url 都能让它返回 present:true / expired:false。
// 它只适用于「会话还有多久」这类展示与诊断。exp 与当前时间比较。
export function inspectJwt(token) {
  const result = { present: false, exp: null, expiresAt: null, expired: null, malformed: false };
  if (typeof token !== 'string' || !token) return result;
  result.present = true;
  const parts = token.split('.');
  if (parts.length !== 3) { result.malformed = true; return result; }
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); }
  catch { result.malformed = true; return result; }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) { result.malformed = true; return result; }
  // 没有 exp 只是「不知道何时过期」，属于合法 JWT，不判畸形，也不用 null 冒充「未过期」。
  if (payload.exp == null) return result;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp)) return result;
  const at = new Date(exp * 1000);
  result.exp = exp;
  result.expiresAt = Number.isNaN(at.getTime()) ? null : at.toISOString();
  result.expired = Date.now() >= exp * 1000;
  return result;
}
export async function authenticate(transport, { username, password }, { signal, entry = 'cas' } = {}) {
  if (!username || !password) throw new ClassroomError('CREDENTIALS', '请提供浙大账号与密码');
  if (entry !== 'cas' && entry !== 'oauth') throw new ClassroomError('AUTH_ENTRY', '未知的登录入口');
  const { login, form } = await submitCasForm(transport, { username, password }, { signal, entry });
  // 表单之后两个入口的续跑起点不同：
  //   cas   —— 既有行为，固定去 tgmedia 的业务登录；
  //   oauth —— 跟着 CAS 的 302 回调走（authorize → *_token → classroom）。
  // 兜底仍是 tgmedia：万一回调没有 Location，此时 SSO 已在 jar 里，走旧链路等价。
  const start = entry === 'oauth' ? nextLocation(login, form) ?? CAS_ENTRY : CAS_ENTRY;
  await finishAtClassroom(transport, await follow(transport, start, { signal, label: '业务登录' }));
}
