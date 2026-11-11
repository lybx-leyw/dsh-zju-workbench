/**
 * 浙大体艺（`tyys.zju.edu.cn`）的两个**只读**面：场馆平台与体艺 App。
 *
 * # 分层（D17）
 *
 * 本文件只做读取。上游 `tyys/` 里的写方法（`bookVenue` 预约、`cancelVenue` 取消、
 * 付款 `payAndVerify`）**不在这里**，归 `packages/tool/*`（见 README 的
 * 「写操作去哪了」）。本文件另有一条明确防线：`VenueClient.request` 遇到写接口
 * **直接拒绝**（`FORBIDDEN_WRITES`），即使调用方拼出了路径也发不出去。
 *
 * # 上游给的事实（照 `tyys/venue.ts`、`tyys/client.ts` 的注释与实现）
 *
 * ## 两个互不相干的接口面
 *
 * | 面 | 根 | 认证 | 用途 |
 * | --- | --- | --- | --- |
 * | 场馆平台 | `http://www.tyys.zju.edu.cn/venue-server` | CAS service 委托换 `oauth_token`，再换 `cgAuthorization` | 场馆、时段、须知、本人订单 |
 * | 体艺 App | `http://tyys.zju.edu.cn/cgapp-server` + `http://www.tyys.zju.edu.cn/ptm` | CAS service 委托拿 `jwtToken`（5 段） | 体育课考勤 |
 *
 * 两边的令牌**不能互换**：场馆平台认 `cgAuthorization`，App 认按请求签名的
 * `cgAuthorization` 加 `sign` 头。所以本文件是两个客户端，不是一个。
 *
 * ## 场馆平台的请求签名
 *
 * `sign = md5(salt + endpoint + 排序后(按参数名)的 k+v（跳过空值与对象） + timestamp + " " + salt)`，
 * 与 `app-key` / `timestamp` 一起放在**请求头**里；GET 的查询串另加一个
 * `nocache=<timestamp>`，而它**参与签名**。
 *
 * ## App 的请求签名
 *
 * 令牌 5 段，第 4 段（`parts[3]`）是 base64 的
 * `[4 字节长度][16 字节 IV][32 字节密文]`，用 AES-256-CBC 解出 32 字节签名材料；
 * 签名 = `sha256(材料 + 规范化路径与查询 + 8 字节毫秒时间 + 反序材料)` 的 hex，
 * 再在固定 5 个位置插入 `"199st"` 五个字符。
 *
 * ## 上游踩过的坑（都是照抄，不要「优化」掉）
 *
 * - **`isArt === 1` 或 `isSupportReservation !== 1` 的场地不是体育场馆**，要从目录里剔掉，
 *   否则用户会看到艺术团/不可预约的场地；
 * - **`code === 250` 且是 `/api/reservation/day/info`** 表示「目标日期还没放号」，
 *   这不是错误，要当成 `open: false` 返回；
 * - **场馆令牌 4 小时过期**（上游缓存 TTL 是 `4h - 30s`），过期要重新登录；
 * - **`notReserveType === 1`** 是平台在说「你没有权限约这一天」，不要当成「没有空场」；
 * - **考勤列表的 `lack` 把还没上的课也算进去**（2026-09 学期：应到 16、上了 3 次却报缺 13），
 *   所以到勤统计只能用 `detail` 里已发生的课次自己数；
 * - **时间是北京时间**，平台给的是不带时区的本地串，任何 `Date.parse` 都要显式加 `+08:00`。
 */

import { createDecipheriv, createHash } from 'node:crypto';

/* ────────────────────────────── 平台常量 ── */

/** 场馆平台根（`www.` 那个，与 App 的 `tyys.zju.edu.cn` 不是同一台）。 */
export const VENUE_BASE = 'http://www.tyys.zju.edu.cn/venue-server';
/** 场馆平台的 CAS service（走完统一身份认证后回到它，地址里带 `oauth_token`）。 */
export const VENUE_LOGIN_SERVICE = 'http://tyys.zju.edu.cn/venue-server/sso/manageLogin';
/** 预约须知接口（匿名可读）。 */
export const PROTOCOL_PATH = '/api/front/website/protocols/code/RESERVATION_PROTOCOL';
/** 体艺 App 接口根。 */
export const APP_BASE = 'http://tyys.zju.edu.cn/cgapp-server';
/** 体艺 App 的 PTM 接口根（考勤在这套接口下）。 */
export const PTM_BASE = 'http://www.tyys.zju.edu.cn/ptm';
/** App 的 CAS service（走完登录后正文里有 `jwtToken`）。 */
export const APP_LOGIN_SERVICE = 'http://www.tyys.zju.edu.cn/cgapp-server/cas/appLogin';

/**
 * 场馆平台公开的客户端标识。
 *
 * ⚠️ 这**不是用户凭据**：它是场馆平台那个网页前端自己带在请求头里的
 * 客户端标识，任何打开场馆页面的人都能从 DevTools 里看到。身份靠登录换来的
 * `cgAuthorization`。值与上游逐字符相同（`venue.ts:149`）。
 */
export const VENUE_APP_KEY = '8fceb735082b5a529312040b58ea780b';
/** 场馆平台签名用的固定盐（同上，公开前端常量）。 */
const VENUE_SALT = 'c640ca392cd45fb3a55b00a63a86c618';

/**
 * App 侧的公开常量：`app-key`、`v1`、`imei`。
 *
 * 同属公开客户端标识（上游 `client.ts:86-87`）。**不是**用户密码。
 */
export const APP_KEY = 'azk3t4jrcfm5772t';
const APP_V1 = 'd28da4a4ce6503e85af53079144efd3a';
const APP_IMEI = '00000000-0000-0000-0000-000000000000';

/**
 * App 签名材料的解密密钥。
 *
 * 上游注释写得很明白：「Public protocol constants recovered in zju-run;
 * no account secret is embedded.」——它是 App 客户端里的对称常量，不是账号秘密。
 */
const APP_SIGN_KEY = Buffer.from(
  'ad8dad2869c5e017303e5f48858db3129bf4d07a47d85beaaaa9d26f436d232a',
  'hex',
);

/**
 * 单个请求的超时。
 *
 * 上游没给这两个站单独设超时，它走 `openContext` 里的 `HttpClient` 默认值
 * `timeout: opts.timeout ?? 10000`（`webvpn/transport.ts:79`）。本仓沿用 10 秒。
 *
 * ⚠️ 本仓的 `sharedFetch` / `egress` **不读 `timeoutMs`**（`egress.js` 只透传
 * `method` / `signal`），所以超时必须自己 `Promise.race` 一个定时器 —— 见
 * `withTimeout`。只传 `signal` 不够：`request` 是调用方注入的，它未必监听 signal。
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/** 场馆令牌的有效期：上游 `SessionStore` 的 `4h - 30s`。 */
const VENUE_TOKEN_TTL_MS = 4 * 3600_000 - 30_000;
/** 场馆目录 / 须知的缓存：上游落盘缓存 1 天。本包只在内存里留一份。 */
const CATALOG_TTL_MS = 86400_000;

/** 订单分页：上游 `readOrders` 用 `page`（从 0 起）+ `size=50`，最多 10 页。 */
const ORDER_PAGE_SIZE = 50;
const ORDER_MAX_PAGES = 10;

/**
 * 上游允许用 POST 的**只读**接口。
 *
 * 上游原集合是四个（`order/info`、`captcha/check`、`vip/view/buddy_no`、
 * `vip/check/buddy_no`）。当前只有 `order/info` 在**读**路径上（预下单预览）；
 * 另外三个只服务于提交预约，所以放在 `writes.js` 的写路径里，不进这个集合。
 *
 * ⚠️ `captcha/check` 的取题与同伴校验（`vip/view/buddy_no` 一带）此前被写成
 * 「本包不搬运」，那是**未经裁决的自判**，已改正：验证码已实现（见 `captcha.js`），
 * 同伴参数**尚未实现**并已记进 `coverage-gaps.md`。
 */
const READ_POSTS = new Set(['/api/reservation/order/info']);

/**
 * 真正的写接口：**读路径永不放行**，列出来是为了给出可读的拒绝理由，
 * 而不是让调用方拿到一个笼统的 404。
 *
 * ⚠️ **`request()` 不是写操作的执行通道**。本包确实实现了一条写路径
 * （`writes.js` 的 `bookVenueExecute` / `cancelVenueExecute`），但它走
 * `submit()` —— 那条**不经过**这道闸。早先 `writes.js` 调的是 `client.request()`，
 * 于是「预约」和「取消预约」在任何情况下都被本包自己的闸挡死，
 * 报的还是「本数据源不提供」—— 看起来像分层设计，实际是死链
 * （`coverage-gaps.md` 的 X-3）。审批在 `tool/campus-write`，闸在那边。
 */
const FORBIDDEN_WRITES = new Set([
  '/api/reservation/order/submit',
  '/api/venue/finances/order/pay',
  '/api/venue/finances/order/cancel',
]);

/** 一天。 */
const DAY = 86400_000;

/* ────────────────────────────── 错误 ── */

/**
 * 本包的统一错误形状。
 *
 * 错误码都是**稳定的**，调用方可以据此分支；`details` 只放安全元数据
 * （路径、状态码、候选列表），不放响应正文，免得把令牌或个人数据带进日志。
 */
export class TyysError extends Error {
  /**
   * @param code - 稳定错误码：`SHAPE` 响应形状不对、`AUTH_EXPIRED` 登录态失效、
   *   `REJECTED` 平台拒绝、`CONFIG` 参数/配置问题、`UNREACHABLE` 连不上、
   *   `TIMEOUT` 超时、`RATE_LIMITED` 被限流。
   * @param message - 给人看的一句话，读者读完知道下一步做什么。
   * @param details - 附加信息（安全元数据）。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TyysError';
    this.code = code;
    this.details = details;
  }
}

/* ────────────────────────────── 小工具 ── */

/** 对象且不是数组才是「行」；其它一律空对象。 */
const row = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

/** 数组里每一项都按「行」处理；不是数组就是空数组。 */
const rows = (value) => (Array.isArray(value) ? value.map(row) : []);

/** null / undefined → 空串，其余 → 字符串。 */
const text = (value) => (value == null ? '' : String(value));

/**
 * 给一个注入的 `request` 套上超时。
 *
 * # 为什么不是「在 init 里写 timeoutMs」
 *
 * `sharedFetch` → `egress.fetch` → `undici.fetch` 这条链上没有任何一层读
 * `timeoutMs`，写进去是个假参数。所以这里**既传 signal**（好的实现能提前取消），
 * **也自己 race 一个定时器**（保证再差的实现也一定会结束）。
 *
 * @param request - `(url, init) => Promise<{status, text}>`。
 * @param url - 目标地址。
 * @param init - 原请求参数（`signal` 会被合并）。
 * @param timeoutMs - 超时毫秒。
 * @returns 响应。
 * @throws {TyysError} `TIMEOUT`。
 */
async function withTimeout(request, url, init, timeoutMs) {
  const controller = new AbortController();
  const outer = init?.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
  }
  let timer;
  const expired = new Promise((_, fail) => {
    timer = setTimeout(() => {
      controller.abort(new Error('timeout'));
      fail(new TyysError('TIMEOUT', `体艺平台 ${timeoutMs}ms 没有响应：稍后重试；若一直这样，检查网络（校外看场馆是否需要经 WebVPN）。`, { url, timeoutMs }));
    }, timeoutMs);
  });
  expired.catch(() => {});
  try {
    const pending = request(url, { ...init, signal: controller.signal });
    // race 输掉之后那一支的迟到拒绝没人接会变成 unhandledRejection，先挂一个空 catch。
    pending.catch(() => {});
    return await Promise.race([pending, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把注入的 `request` 抛出的网络错误翻成本包口径。
 *
 * @param error - 抛出来的错误。
 * @returns `TyysError`（已经是本包的则原样返回）。
 */
function translateNetwork(error) {
  if (error instanceof TyysError) return error;
  const code = error?.code;
  if (code === 'TIMEOUT') {
    return new TyysError('TIMEOUT', '体艺平台请求超时：稍后重试；校外访问场馆请确认网络。', { cause: code });
  }
  return new TyysError('UNREACHABLE', `连不上体艺平台：检查网络（校外看场馆是否需要经 WebVPN）后重试。原始错误：${error?.message ?? error}`, { cause: code });
}

/* ────────────────────────────── 时间 ── */

/** 北京时间的 `YYYY-MM-DD`。 */
export const beijingDate = (now = Date.now()) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);

/** 北京时间的 `YYYY-MM-DD HH:mm:ss`。 */
export const localTime = (now = Date.now()) => new Date(now + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');

/**
 * 平台给的「北京时间的本地串」转毫秒。
 *
 * ⚠️ 必须显式 `+08:00`：`new Date('2026-11-11T08:00:00')` 会按**运行环境的时区**
 * 解释，在别的时区跑出来的时间会整体平移。
 *
 * @param date - `YYYY-MM-DD`。
 * @param time - `HH:mm`（默认 `00:00`）。
 * @returns 毫秒时间戳。
 */
export const atDate = (date, time = '00:00') => Date.parse(`${date}T${time}:00+08:00`);

/** 日期加 n 天（按北京时间算，不受运行环境时区影响）。 */
export const addDays = (date, n) => beijingDate(atDate(date) + n * DAY);

/**
 * 把用户写的日期规整成 `YYYY-MM-DD`。
 *
 * 支持的写法：`今天` / `明天` / `后天` / `N天后` / `YYYY-MM-DD`。
 * 有边界（`bounded`）时只接受今天到三天后 —— 场馆平台的预约窗口就是这么开的，
 * **不会自动换一个日期**（换了就等于替用户做了决定）。
 *
 * @param input - 用户输入。
 * @param now - 当前时间。
 * @param bounded - 是否限制在今天至三天后（查订单历史时传 false）。
 * @returns `YYYY-MM-DD`。
 * @throws {TyysError} `CONFIG`。
 */
export function targetDate(input, now = Date.now(), bounded = true) {
  const today = beijingDate(now);
  const offsets = { 今天: 0, 明天: 1, 后天: 2 };
  const trimmed = String(input ?? '').trim();
  const matched = trimmed.match(/^(\d+)\s*天后$/);
  const offset = offsets[trimmed] ?? (matched ? Number(matched[1]) : undefined);
  if (offset !== undefined && (!Number.isSafeInteger(offset) || offset > (bounded ? 3 : 36500))) {
    throw new TyysError('CONFIG', bounded ? '场馆查询支持今天、明天、后天、0 至 3 天后，或 YYYY-MM-DD。' : '相对日期的天数超出可处理范围：改用 YYYY-MM-DD。');
  }
  const date = offset === undefined ? trimmed : addDays(today, offset);
  const stamp = /^\d{4}-\d{2}-\d{2}$/.test(date) ? atDate(date) : NaN;
  if (!Number.isFinite(stamp) || beijingDate(stamp) !== date) {
    throw new TyysError('CONFIG', '日期要写成今天、明天、后天、0 至 3 天后或 YYYY-MM-DD（例如 2026-11-12）。');
  }
  if (bounded && (date < today || date > addDays(today, 3))) {
    throw new TyysError('CONFIG', `场馆只开放今天（${today}）至 ${addDays(today, 3)} 的查询与预约，不会自动换一个日期。`);
  }
  return date;
}

/**
 * 把 `HH:mm` 或 `HH:mm-HH:mm` 解析成时段。
 *
 * @param input - 用户输入。
 * @returns `{ start, end? }`。
 * @throws {TyysError} `CONFIG`。
 */
export function timeRange(input) {
  const matched = String(input ?? '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?:-([01]\d|2[0-3]):([0-5]\d))?$/);
  if (!matched) throw new TyysError('CONFIG', '时间要写成 HH:mm 或 HH:mm-HH:mm（例如 21:00 或 21:00-22:00）。');
  const start = `${matched[1]}:${matched[2]}`;
  const end = matched[3] ? `${matched[3]}:${matched[4]}` : undefined;
  if (end && end <= start) throw new TyysError('CONFIG', '结束时间要晚于开始时间；暂不支持跨午夜的时段。');
  return { start, ...(end ? { end } : {}) };
}

/* ────────────────────────────── 签名 ── */

/**
 * 场馆平台一次请求的签名。
 *
 * 参数按**参数名排序**后拼 `k+v`，跳过 `null` / 空串 / 对象 —— 与上游逐字符一致。
 *
 * @param endpoint - 形如 `/api/reservation/day/info`。
 * @param params - 实际提交的参数（GET 时含 `nocache`）。
 * @param timestamp - 毫秒时间戳（字符串）。
 * @returns 32 位 md5 hex。
 */
export function venueSignature(endpoint, params, timestamp) {
  const values = Object.keys(params)
    .sort()
    .filter((key) => params[key] != null && params[key] !== '' && typeof params[key] !== 'object')
    .map((key) => key + String(params[key]))
    .join('');
  return createHash('md5').update(VENUE_SALT + endpoint + values + timestamp + ' ' + VENUE_SALT).digest('hex');
}

/**
 * 解出 App 请求签名用的 32 字节材料。
 *
 * 令牌第 4 段是 base64 的 `[4 字节长度][16 字节 IV][32 字节密文]`，总长必须是 52，
 * 且首 4 字节等于总长 —— 这是上游的完整性判据。
 *
 * @param token4 - 令牌第 4 段。
 * @returns 32 字节 Buffer。
 * @throws {TyysError} `SHAPE` 段格式不对。
 */
export function signingMaterial(token4) {
  const raw = Buffer.from(String(token4 ?? ''), 'base64');
  if (raw.length !== 52 || raw.readUInt32BE(0) !== raw.length) {
    throw new TyysError('SHAPE', '体艺登录返回的令牌格式异常，无法建立会话：请重新登录体艺 App 后再试。', { reason: 'token-material' });
  }
  const decipher = createDecipheriv('aes-256-cbc', APP_SIGN_KEY, raw.subarray(4, 20));
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(raw.subarray(20)), decipher.final()]);
}

/**
 * 把路径与查询串规范化成签名输入。
 *
 * 查询串要**先解码再按键、值排序**（`%20` 与 `+` 在这一步已经还原），
 * 拼成 `path + k1v1 + k2v2…`。
 *
 * @param path - 必须以 `/api/` 开头。
 * @param query - 原始查询串。
 * @returns 规范化字符串。
 * @throws {TyysError} `CONFIG` 路径非法。
 */
export function canonicalize(path, query) {
  if (!String(path ?? '').startsWith('/api/') || /[?#\r\n]/.test(path)) {
    throw new TyysError('CONFIG', '体艺签名路径必须是 /api/ 开头的相对路径。');
  }
  const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const parts = [...new URLSearchParams(query ?? '')].sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));
  return path + parts.map(([key, value]) => key + value).join('');
}

/**
 * 算一次 App 请求的签名。
 *
 * 算法照上游 `sign.ts` 逐行搬：`sha256(材料 + 规范化 + 8 字节毫秒 + 反序材料)` 的
 * hex，再在偏移 12/28/36/38/58 处插入 `"199st"` 五个字符（所以结果是 69 个字符）。
 *
 * @param material - 32 字节签名材料。
 * @param path - `/api/` 开头的路径。
 * @param query - 原始查询串。
 * @param epochMs - 毫秒时间戳（同时决定 `timestamp` 头）。
 * @returns `{ timestamp, sign }`。
 * @throws {TyysError} `CONFIG` 材料或时间非法。
 */
export function signRequest(material, path, query = '', epochMs = Date.now()) {
  if (!Buffer.isBuffer(material) || material.length !== 32 || !Number.isSafeInteger(epochMs) || epochMs < 0) {
    throw new TyysError('CONFIG', '体艺签名材料或时间无效。');
  }
  const mask = (1n << 64n) - 1n;
  const millis = BigInt(epochMs);
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(millis);
  let mixed = ((millis ^ (millis >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
  mixed = ((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn) & mask;
  mixed = (mixed ^ (mixed >> 31n)) & mask;
  const hex = createHash('sha256')
    .update(material)
    .update(canonicalize(path, query))
    .update(time)
    .update(Buffer.from(material).reverse())
    .digest('hex')
    .split('');
  [...'199st'].forEach((char, index) => hex.splice([12, 28, 36, 38, 58][index], 0, char));
  return { timestamp: String(mixed), sign: hex.join('') };
}

/**
 * 解析 App 的 5 段令牌。
 *
 * ⚠️ 这里有一处**账号校验**：令牌里的 `sub` 必须等于本次要读的账号。
 * 上游注释写明「Login identity comes from JWT sub. Attendance row uid is not an
 * account check.」—— 对不上就说明拿到了另一个人的会话，必须拒绝，
 * 否则会把别人的考勤读给现在的人。
 *
 * @param full - 完整令牌。
 * @param username - 期望的学号/工号。
 * @returns `{ full, authorization, material, uid, expires }`。
 * @throws {TyysError} `SHAPE` 格式异常、`AUTH_EXPIRED` 账号不符。
 */
export function parseTokens(full, username) {
  let parts;
  let payload;
  let material;
  try {
    parts = String(full ?? '').split('.');
    if (parts.length !== 5) throw new Error('parts');
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || !['string', 'number'].includes(typeof payload.sub) || !String(payload.sub).trim()
      || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp * 1000)) throw new Error('payload');
    material = signingMaterial(parts[3]);
  } catch (error) {
    if (error instanceof TyysError) throw error;
    throw new TyysError('SHAPE', '体艺登录返回的令牌格式异常，无法建立会话：请重新登录体艺 App 后再试。', { reason: 'token-format' });
  }
  if (String(payload.sub) !== String(username)) {
    throw new TyysError('AUTH_EXPIRED', '体艺登录返回了另一个账号的会话，不能用于当前账号：请重新登录后再试。', { reason: 'account-mismatch' });
  }
  return {
    full,
    authorization: parts.slice(0, 3).join('.'),
    material,
    uid: String(payload.sub),
    expires: Number(payload.exp) * 1000,
  };
}

/* ────────────────────────────── HTML 转文本 ── */

/** 实体表（HTML4 里书目/通知正文常见的那部分）。 */
const NAMED_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…',
  mdash: '—', ndash: '–', middot: '·', copy: '©', times: '×', deg: '°',
});

/**
 * 解 HTML 实体：命名实体 + 十进制 + 十六进制数字引用。
 *
 * @param input - 含实体的字符串。
 * @returns 解码后的字符串。
 */
export function decodeEntities(input) {
  return String(input ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => codePoint(parseInt(hex, 16), match))
    .replace(/&#(\d+);/g, (match, dec) => codePoint(Number(dec), match))
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/** 码点转字符；越界原样返回（不吞掉它，让人看见问题）。 */
function codePoint(value, fallback) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

/** 块级标签：这几个要换成换行，须知是一行一条放号规则。 */
const BLOCK_TAGS = /<\/?(?:p|div|br|tr|li|h[1-6]|table|ul|ol|section|article|blockquote|pre|hr)\b[^>]*>/gi;

/**
 * 富文本转纯文本。
 *
 * # 为什么必须保留换行
 *
 * 须知里「哪个校区哪个馆-每天几点放号」是一条一条写的，解析规则用 `[^。；\n]`
 * 限定在同一行内。把所有空白压成空格的话，两条规则会连成一句，
 * 放号时刻就会张冠李戴。
 *
 * @param html - 原始富文本。
 * @returns 纯文本（段落间保留换行）。
 */
export function htmlToText(html) {
  let value = String(html ?? '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  value = value.replace(/<\/(td|th)>/gi, '\t').replace(BLOCK_TAGS, '\n');
  value = decodeEntities(value.replace(/<[^>]+>/g, ''))
    // 不换行空格也当空格，否则 `\s` 在部分位置匹配不到它。
    .replace(/\u00a0/g, ' ');
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ────────────────────────────── 须知与放号 ── */

/** 放号规则里的校区名（上游那 7 个校区）。 */
const CAMPUSES = '紫金港|玉泉|华家池|西溪|之江|海宁|舟山';

/**
 * 解析预约须知，并从中抽出各场馆的放号时刻。
 *
 * 上游的正则是
 * `((?:校区)[^。；\n]*?)[-－—]\s*每天\s*(\d{1,2}:\d{2})`，命中后按 `、` 拆成多条
 * （「紫金港、玉泉体育馆-每天 20:00」是两个场馆各一条）。
 *
 * @param data - `/api/front/website/protocols/code/RESERVATION_PROTOCOL` 的 `data`。
 * @param now - 当前时间（写 `fetchedAt`）。
 * @returns `{ title, content, releaseTimes, fetchedAt, source }`。
 * @throws {TyysError} `SHAPE` 正文为空。
 */
export function parseNotice(data, now = Date.now()) {
  const record = row(data);
  const content = htmlToText(text(record.content));
  if (!content) {
    throw new TyysError('SHAPE', '预约须知正文是空的：平台可能改了接口，请稍后重试或到体艺平台网页上看须知。');
  }
  const releaseTimes = [...content.matchAll(new RegExp(`((?:${CAMPUSES})[^。；\\n]*?)[-－—]\\s*每天\\s*(\\d{1,2}:\\d{2})`, 'g'))]
    .flatMap((matched) => matched[1].split('、').map((scope) => ({ scope: scope.trim(), time: matched[2].padStart(5, '0') })));
  return {
    title: text(record.title),
    content,
    releaseTimes,
    fetchedAt: localTime(now),
    source: VENUE_BASE + PROTOCOL_PATH,
  };
}

/** 场馆名的比较口径：全角半角归一，去掉「校区」、空白与间隔号。 */
const normalize = (value) => String(value ?? '').normalize('NFKC').replace(/校区|[\s··]/g, '');

/** 一个场馆对外展示的完整名字。 */
export const siteName = (site) => `${site.campus}${site.venue}${site.name}`;

/**
 * 按运动、校区、场馆名过滤场馆目录。
 *
 * 运动匹配的是 `sport + name`（平台有时把运动名放在场地名里），
 * 场馆名匹配的是「校区+场馆+场地」的完整名。
 *
 * @param sites - 目录里的场馆。
 * @param filter - `{ sport?, campus?, venue? }`。
 * @returns 命中的场馆。
 */
export function matchSites(sites, filter = {}) {
  return sites.filter((site) => (!filter.campus || normalize(site.campus).includes(normalize(filter.campus)))
    && (!filter.sport || normalize(site.sport + site.name).includes(normalize(filter.sport)))
    && (!filter.venue || normalize(siteName(site)).includes(normalize(filter.venue))));
}

/**
 * 从须知里找出某个场馆的放号时刻。
 *
 * 匹配规则：须知条目的适用范围要包含该场馆的校区，且点名了该场馆的运动
 * （羽毛球/网球/游泳/足球/篮球）；提到「膜顶」的条目只对膜顶场地生效。
 *
 * 只有当所有命中条目的时刻**唯一**时才给答案 —— 给出两个不同时刻的任意一个
 * 等于替用户猜了一次，而放号时刻猜错的代价是白等一小时。
 *
 * @param site - 场馆。
 * @param notice - `parseNotice` 的结果。
 * @returns `HH:mm` 或 undefined（无法确定）。
 */
export function releaseTime(site, notice) {
  const campus = normalize(site.campus);
  const full = normalize(siteName(site));
  const matched = rows(notice?.releaseTimes).filter((item) => {
    const scope = normalize(item.scope);
    if (!scope.includes(campus)) return false;
    const sport = /羽毛球|网球|游泳|足球|篮球/.exec(scope)?.[0];
    return Boolean(sport) && (site.sport + site.name).includes(sport) && (!scope.includes('膜顶') || full.includes('膜顶'));
  });
  return new Set(matched.map((item) => item.time)).size === 1 ? matched[0].time : undefined;
}

/**
 * 算「目标日期什么时候放号」。
 *
 * `days` 是平台给的「今天起一共开放几天」（含今天）。目标日期超过这个窗口时，
 * 按「每天放一天」推算下一次放号时刻；**不重新解释用户给的日期**。
 *
 * @param site - 场馆。
 * @param date - 目标日期 `YYYY-MM-DD`。
 * @param days - `advanceReservationDays`。
 * @param notice - 须知。
 * @param now - 当前时间。
 * @returns 毫秒时间戳，或 undefined（算不出来）。
 */
export function releaseAt(site, date, days, notice, now = Date.now()) {
  const time = releaseTime(site, notice);
  if (!time || !Number.isInteger(days) || days < 1) return undefined;
  const today = beijingDate(now);
  const latest = addDays(today, days - 1);
  if (date <= latest) return undefined;
  const additions = Math.round((atDate(date) - atDate(latest)) / DAY);
  const nextDate = atDate(today, time) > now ? today : addDays(today, 1);
  return atDate(addDays(nextDate, additions - 1), time);
}

/* ────────────────────────────── 时段 ── */

/**
 * 解析某一天的时段表。
 *
 * 响应形状（照上游 `parseDay`）：`reservationDateSpaceInfo` 是「日期 → 场地数组」，
 * 每个场地除了 `id` / `spaceName`，还以**时段 id 为键**挂着
 * `{ startDate, endDate, reservationStatus }`。`reservationStatus === 1` 是可约。
 *
 * @param data - `/api/reservation/day/info` 的 `data`。
 * @param date - 目标日期。
 * @returns `{ date, open, days, weekStart, token, slots, message }`。
 * @throws {TyysError} `REJECTED` 无权限、`SHAPE` 字段不完整。
 */
export function parseDay(data, date) {
  const record = row(data);
  const dateMap = row(record.reservationDateSpaceInfo);
  const spaces = dateMap[date];
  if (Number(record.notReserveType) === 1) {
    throw new TyysError('REJECTED', '场馆平台提示这个账号没有权限预约这一天：请联系场地管理方确认预约资格。', { date, reason: 'not-reserve-type' });
  }
  if (!Array.isArray(spaces) || !Array.isArray(record.reservationDateList)) {
    throw new TyysError('SHAPE', `场馆时段响应里没有 ${date} 的场地表：无法判断是否有空场，请稍后重试（不要据此认为已经约满）。`, { date, reason: 'missing-date' });
  }
  const slots = [];
  for (const space of rows(spaces)) {
    for (const [timeId, value] of Object.entries(space)) {
      const item = row(value);
      if (item.reservationStatus == null) continue;
      const start = text(item.startDate).match(/(\d{2}:\d{2})(?::\d{2})?$/)?.[1];
      const end = text(item.endDate).match(/(\d{2}:\d{2})(?::\d{2})?$/)?.[1];
      if (!start || !end || !space.id || !Number.isFinite(Number(item.reservationStatus))) {
        throw new TyysError('SHAPE', '场馆时段字段不完整（缺开始时间、结束时间、场地号或状态）：本次不给出空场结论，请稍后重试。', { date, timeId });
      }
      slots.push({
        spaceId: text(space.id),
        space: text(space.spaceName),
        timeId,
        start,
        end,
        status: Number(item.reservationStatus),
      });
    }
  }
  return {
    date,
    open: slots.length > 0,
    days: Number(record.advanceReservationDays),
    weekStart: text(record.reservationDateList[0]),
    token: text(record.token),
    slots,
    message: slots.length ? '目标日期已开放' : '目标日期暂未发布时段',
  };
}

/**
 * 目标时刻附近可选的时段（最多 3 个，按先后排）。
 *
 * @param day - `parseDay` / `day()` 的结果。
 * @param time - 用户想要的时段。
 * @param now - 当前时间（已经开始的时段不算）。
 * @returns `[{ start, end, availableCourts }]`。
 */
export function nearbyTimes(day, time, now = Date.now()) {
  const groups = new Map();
  for (const slot of rows(day.slots).filter((item) => atDate(day.date, item.start) > now)) {
    const key = slot.start + slot.end;
    const value = groups.get(key) ?? { start: slot.start, end: slot.end, availableCourts: 0 };
    if (slot.status === 1) value.availableCourts += 1;
    groups.set(key, value);
  }
  const distance = (item) => Math.abs(atDate(day.date, item.start) - atDate(day.date, time.start));
  return [...groups.values()]
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, 3)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/* ────────────────────────────── 订单（只读） ── */

/**
 * 平台给的服务器时间串统一成 `YYYY-MM-DD HH:mm:ss`。
 *
 * 它可能是数字毫秒、带时区的 ISO、或 `YYYY-MM-DDTHH:mm:ss` 本地串。
 *
 * @param value - 原始值。
 * @returns 归一后的字符串（认不出来就原样返回前 19 个字符）。
 */
function serverTime(value) {
  // 数字就是毫秒时间戳，直接按北京时间格式化成同一形状。
  if (typeof value === 'number') return localTime(value);
  const raw = text(value);
  if (/Z$|[+-]\d\d:\d\d$/.test(raw) && Number.isFinite(Date.parse(raw))) return localTime(Date.parse(raw));
  return raw.replace('T', ' ').slice(0, 19);
}

/**
 * 解析一笔本人订单。
 *
 * 订单字段可能在外层，也可能在 `orderInfo` 里（列表接口与提交接口不一样），
 * 所以先看 `orderInfo` 有没有内容。
 *
 * @param value - 原始订单。
 * @returns 归一后的订单。
 */
export function parseOrder(value) {
  const outer = row(value);
  const record = Object.keys(row(outer.orderInfo)).length ? row(outer.orderInfo) : outer;
  const start = serverTime(record.reservationStartDate);
  const end = serverTime(record.reservationEndDate);
  return {
    id: text(record.id),
    number: text(record.tradeNo),
    siteId: text(record.venueSiteId ?? row(outer.venueInfoBean).venueSiteId),
    venue: [record.campusName, record.venueName, record.siteName].map(text).join(''),
    date: start.slice(0, 10) || text(record.reservationDate).slice(0, 10),
    start: start.slice(11, 16),
    end: end.slice(11, 16),
    description: text(record.reservationDateDetail),
    status: Number(record.orderStatus),
    payStatus: Number(record.payStatus),
    amount: record.amountFee == null ? '' : text(record.amountFee),
    expires: serverTime(record.expireTime),
  };
}

/**
 * 把订单转成对外形状（只做字段重命名与状态文案，不做任何判断）。
 *
 * ⚠️ 这里的「正常 / 已取消 / 待核对」是**照平台字段直译**，不是预约建议。
 * 预约与取消的判定归 tool 包。
 *
 * @param order - `parseOrder` 的结果。
 * @returns 对外对象。
 */
export function orderView(order) {
  return {
    number: order.number,
    venue: order.venue,
    date: order.date,
    time: order.start && order.end ? `${order.start}-${order.end}` : order.description,
    description: order.description,
    status: order.status === 2 ? '已取消' : order.status === 1 ? '正常' : '待核对',
    payment: order.payStatus === 2 ? '已支付或已零元确认' : order.payStatus === 1 ? '未支付' : '退款或待核对',
    amount: order.amount,
    expiresAt: order.expires || null,
  };
}

/**
 * 读完本人的全部订单。
 *
 * # 为什么必须区分「读全了」与「只读到一部分」
 *
 * 分页响应里有 `last` 或 `totalPages`。两者都没有时，当前页**不能**当成全部 ——
 * 「本人订单里没有这一笔」与「下一页还有」是完全不同的结论，
 * 拿后者当前者会让人以为预约没成功。
 *
 * @param client - 带 `request` 的客户端。
 * @param options.wait - 翻页之间的等待（默认 500ms，别把分页读成请求风暴）。
 * @returns `{ orders, complete }`。
 * @throws {TyysError} `SHAPE` 列表缺失、订单缺号、分页信息缺失。
 */
export async function readOrders(client, { wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const orders = [];
  const seen = new Set();
  for (let page = 0; page < ORDER_MAX_PAGES; page += 1) {
    const data = row(await client.request('GET', '/api/orders/mine', { page, size: ORDER_PAGE_SIZE }));
    if (!Array.isArray(data.content)) {
      throw new TyysError('SHAPE', '本人订单响应里没有列表：无法确认预约状态，请稍后重试（这不代表没有订单）。');
    }
    let added = 0;
    for (const item of data.content) {
      const order = parseOrder(item);
      if (!order.number) throw new TyysError('SHAPE', '本人订单缺少订单号：无法据此确认预约状态。');
      if (!seen.has(order.number)) {
        seen.add(order.number);
        orders.push(order);
        added += 1;
      }
    }
    const hasPages = Number.isInteger(data.totalPages) && Number(data.totalPages) >= 0;
    if (data.last === true || (hasPages && page + 1 >= Number(data.totalPages))) return { orders, complete: true };
    if (typeof data.last !== 'boolean' && !hasPages) {
      throw new TyysError('SHAPE', '本人订单缺少分页完整性信息：不能把当前页当成全部订单。');
    }
    if (!added) break;
    await wait(500);
  }
  return { orders, complete: false };
}

/**
 * 本人的场馆预约订单。
 *
 * 不给 `date` 时只看今天及以后（与上游一致：默认看「还没过去的预约」）。
 *
 * @param client - 带 `request` 的客户端。
 * @param filter - `{ date?, venue? }`。
 * @param now - 当前时间。
 * @returns `{ status, message, orders, observedAt }`。
 */
export async function listOrders(client, filter = {}, now = Date.now()) {
  const { orders, complete } = await readOrders(client);
  const selected = orders.filter((order) => (filter.date ? order.date === filter.date : order.date >= beijingDate(now))
    && (!filter.venue || (order.venue + order.description).replace(/校区|\s/g, '').includes(String(filter.venue).replace(/校区|\s/g, ''))));
  return {
    status: complete ? 'listed' : 'partial',
    message: complete ? `找到 ${selected.length} 笔符合条件的本人预约` : '订单还没取全：下面只是已经查到的记录，不能当作全部订单',
    orders: selected.map(orderView),
    observedAt: localTime(now),
  };
}

/* ────────────────────────────── 场馆客户端 ── */

/** 场馆平台响应里表示「会话失效」的业务码。 */
const VENUE_AUTH_CODE = 401;
/** 场馆平台响应里表示「目标日期还没放号」的业务码（只对 day/info 有意义）。 */
const VENUE_NOT_RELEASED_CODE = 250;

/**
 * 场馆平台只读客户端。
 *
 * 令牌与目录/须知缓存都在内存里；**不落盘**（调用方要持久化就自己存）。
 * 类里没有写方法：写接口被 `FORBIDDEN_WRITES` 拦在请求层。
 */
export class VenueClient {
  /**
   * @param options.request - `(url, init) => Promise<{status, text}>`，由调用方注入。
   * @param options.acquireLogin - `({ service }) => Promise<{ url, body }>`，
   *   走一遍统一身份认证并跟随回跳；`url` 里要带 `oauth_token`。
   * @param options.username - 期望的账号（可选）。给了就在登录后核对，
   *   避免把上一个账号的会话继续用下去。
   * @param options.timeoutMs - 单请求超时。
   * @param options.now - 取当前时间（测试注入）。
   */
  constructor({ request, acquireLogin = null, username = '', timeoutMs = REQUEST_TIMEOUT_MS, now = () => Date.now() }) {
    /**
     * ⚠️ 注入的函数必须存成 `this.fetch`，**不能**存成 `this.request`。
     *
     * 本类有一个 `request(method, endpoint, params)` 方法；把注入的函数也挂在
     * `this.request` 上，实例属性会覆盖掉原型上的方法 —— 于是
     * `client.request('GET', '/api/x')` 实际调用的是注入的 fetch，
     * 参数变成 `(url='GET', init='/api/x')`：一个请求都发不出去，
     * 失败形态却是一堆形状错误（`headers` 没了 → 响应是 `undefined`）。
     * 这个 bug 由 `tests/tyys.test.mjs` 的「GET 带 app-key…」一条钉住。
     */
    this.fetch = request;
    this.acquireLogin = acquireLogin;
    this.username = username;
    this.timeoutMs = timeoutMs;
    this.now = now;
    /** 当前令牌与它的过期时刻。 */
    this.token = '';
    this.tokenExpiresAt = 0;
    /** 登录后拿到的本人信息。 */
    this.user = {};
    /** 登录去重：并发的读取共用同一次登录。 */
    this.loginPromise = null;
    /** 串行化：一次只发一个请求（上游用队列避免批量读变成请求风暴）。 */
    this.queue = Promise.resolve();
    /** 目录与须知的进程内缓存。 */
    this.cachedCatalog = null;
    this.cachedNotice = null;
  }

  /** 令牌是否还有效。 */
  get loggedIn() {
    return Boolean(this.token) && this.tokenExpiresAt > this.now();
  }

  /** 丢掉令牌（换账号、或用户点了「重新登录」）。 */
  reset() {
    this.token = '';
    this.tokenExpiresAt = 0;
    this.user = {};
  }

  /**
   * 确保已登录（并发去重）。
   *
   * @param fresh - 强制重新登录。
   * @returns 本人信息。
   * @throws {TyysError} `CONFIG` 没接入登录、`AUTH_EXPIRED` / `REJECTED` 登录失败。
   */
  login(fresh = false) {
    if (!fresh && this.loggedIn) return Promise.resolve(this.user);
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.doLogin()
      .finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }

  /**
   * 真正的登录动作。
   *
   * 步骤照上游：CAS 回跳地址里的 `oauth_token` → `POST /api/login`（带
   * `oauth-token` 头）→ 拿 `token.access_token`；角色列表里必须有 id `3`
   * （场馆学生预约角色），再 `POST /roleLogin { roleid: 3 }` 换正式令牌。
   *
   * @returns 本人信息。
   * @throws {TyysError}
   */
  async doLogin() {
    this.reset();
    if (typeof this.acquireLogin !== 'function') {
      throw new TyysError('CONFIG', '体艺场馆还没接入统一身份认证：到「设置 → 浙大一卡通」填好学号和密码后重试。');
    }
    const front = await this.acquireLogin({ service: VENUE_LOGIN_SERVICE });
    let oauth = '';
    try {
      oauth = new URL(String(front?.url ?? '')).searchParams.get('oauth_token') ?? '';
    } catch {
      oauth = '';
    }
    if (!oauth) {
      throw new TyysError('AUTH_EXPIRED', '统一身份认证走完以后没有拿到场馆平台的授权票据（oauth_token）：请在浏览器里打开一次体艺场馆页面确认能进，再重试。', { reason: 'no-oauth-token' });
    }
    const first = await this.send('POST', '/api/login', {}, { 'oauth-token': oauth });
    if (Number(first.code) !== 200) {
      throw new TyysError('AUTH_EXPIRED', `场馆平台拒绝这次登录（code=${text(first.code) || '未知'}）：请确认统一身份认证账号能进体艺场馆，然后重试。`, { code: first.code });
    }
    const initial = row(first.data);
    const roles = rows(initial.roles);
    if (!roles.some((role) => text(role.id) === '3')) {
      throw new TyysError('REJECTED', '这个账号在体艺场馆平台没有「学生预约」角色：先在体艺 App 或场馆网页上确认能进「场馆预约」，再回来重试。', { reason: 'no-student-role' });
    }
    const role = await this.send('POST', '/roleLogin', { roleid: 3 });
    if (Number(role.code) !== 200) {
      throw new TyysError('AUTH_EXPIRED', `场馆平台拒绝切换到学生角色（code=${text(role.code) || '未知'}）：请重新登录后再试。`, { code: role.code });
    }
    const data = row(role.data);
    const token = text(row(data.token).access_token);
    if (!token) {
      throw new TyysError('SHAPE', '场馆平台登录响应里没有访问令牌：请到体艺平台网页确认账号可用，然后重试。', { reason: 'no-token' });
    }
    this.token = token;
    this.tokenExpiresAt = this.now() + VENUE_TOKEN_TTL_MS;
    // 上游注释：当前前端在 userInfo 缺失时用顶层身份字段，两边都收集。
    this.user = {
      name: data.name ?? initial.name,
      username: data.username ?? initial.username,
      userId: data.userId ?? initial.userId,
      ...row(initial.user),
      ...row(initial.userInfo),
      ...row(data.user),
      ...row(data.userInfo),
    };
    if (this.username && text(this.user.username) && text(this.user.username) !== String(this.username)) {
      this.reset();
      throw new TyysError('AUTH_EXPIRED', '场馆平台登录返回了另一个账号：请重新登录后再试。', { reason: 'account-mismatch' });
    }
    return this.user;
  }

  /**
   * 发一次场馆平台请求（不判断业务码）。
   *
   * GET 的参数进查询串并加 `nocache`；POST 的参数进**表单体**（两者的签名都以
   * 实际提交的参数为准，`nocache` 也参与）。
   *
   * @param method - `GET` / `POST`。
   * @param endpoint - `/api/...`。
   * @param params - 业务参数。
   * @param extra - 额外请求头（登录接口的 `oauth-token`）。
   * @returns 平台信封 `{ code, data, ... }`；HTTP/业务 401 时返回 `{ code: 401 }`。
   * @throws {TyysError} `SHAPE` / `RATE_LIMITED` / `UNREACHABLE` / `TIMEOUT` / `CONFIG`。
   */
  async send(method, endpoint, params = {}, extra = {}) {
    const timestamp = String(this.now());
    const values = Object.fromEntries(Object.entries(params).filter(([, value]) => value != null));
    if (method === 'GET') values.nocache = timestamp;
    const encoded = new URLSearchParams(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))).toString();
    const headers = {
      'app-key': VENUE_APP_KEY,
      timestamp,
      sign: venueSignature(endpoint, values, timestamp),
      ...(this.token ? { cgAuthorization: this.token } : {}),
      ...extra,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    };
    let response;
    try {
      response = await withTimeout(this.fetch, VENUE_BASE + endpoint + (method === 'GET' ? `?${encoded}` : ''), {
        method,
        headers,
        ...(method === 'POST' ? { body: encoded } : {}),
      }, this.timeoutMs);
    } catch (error) {
      throw translateNetwork(error);
    }
    let body;
    // 限流要在解析正文之前判：429 的正文常常是空的（网关直接回），
    // 先解析会让它变成一个误导性的「形状不对」。
    if (response.status === 429) {
      throw new TyysError('RATE_LIMITED', '场馆平台正在限制访问，本次已停止：等几分钟再试，不要连续刷新。', { endpoint, httpStatus: 429 });
    }
    try {
      body = JSON.parse(response.text);
    } catch {
      throw new TyysError('SHAPE', `场馆平台没有返回 JSON（HTTP ${response.status}）：多半是登录页或网关页面，请重试；校外访问请确认网络可达。`, { endpoint, httpStatus: response.status });
    }
    if (Number(body?.code) === 408) {
      throw new TyysError('RATE_LIMITED', '场馆平台正在限制访问，本次已停止：等几分钟再试，不要连续刷新。', { endpoint, httpStatus: response.status });
    }
    if (response.status === VENUE_AUTH_CODE || Number(body?.code) === VENUE_AUTH_CODE) return { code: VENUE_AUTH_CODE };
    if (!body || body.code == null || !Number.isFinite(Number(body.code)) || response.status < 200 || response.status >= 300) {
      throw new TyysError('SHAPE', `场馆平台响应没有有效的业务状态（HTTP ${response.status}）：无法确认请求结果，请稍后重试。`, { endpoint, httpStatus: response.status });
    }
    return body;
  }

  /**
   * 发出一次**只读**业务请求。
   *
   * 三处判据：
   * 1. 写接口一律拒绝（`FORBIDDEN_WRITES`）—— 这是本包的分层防线，
   *    路径拼对了也发不出去；
   * 2. 会话失效（业务码或 HTTP 401）时**重登一次再重放**。上游的收敛条件更细：
   *    只有 GET 且不是匿名接口才自动重放，POST 一律重登后交给调用方重试
   *    （上游注释：「场馆会话失效；写请求未自动重放」）。这里保留同一口径 ——
   *    只是把 POST 的情况改成抛错，因为本包只剩一个 POST 读接口；
   * 3. `250` + `day/info` 是「没放号」，返回 `{ notReleased: true }`，不是错误。
   *
   * @param method - `GET` / `POST`。
   * @param endpoint - `/api/...`。
   * @param params - 参数。
   * @returns `data`（`day/info` 没放号时是 `{ notReleased, message }`）。
   * @throws {TyysError}
   */
  async request_(method, endpoint, params = {}) {
    if (!/^\/api\/[A-Za-z0-9_/-]+$/.test(endpoint)) {
      throw new TyysError('CONFIG', `不是有效的场馆接口路径：${endpoint}。本包只认 /api/ 开头的只读路径。`, { endpoint });
    }
    if (FORBIDDEN_WRITES.has(endpoint)) {
      throw new TyysError('CONFIG', `「${endpoint}」是写操作（会改场馆上的预约记录），本数据源不提供：请在工具包里完成。`, { endpoint });
    }
    if (method === 'POST' && !READ_POSTS.has(endpoint)) {
      throw new TyysError('CONFIG', `本数据源不支持对这个接口用 POST：${endpoint}。`, { endpoint });
    }
    const publicRead = endpoint === PROTOCOL_PATH;
    if (!publicRead) await this.login();
    let result = await this.send(method, endpoint, params);
    if (Number(result.code) === VENUE_AUTH_CODE) {
      this.reset();
      // 匿名接口与 POST 都不自动重放：前者不该需要会话，后者重放会重复一次业务动作。
      if (method !== 'GET' || publicRead) {
        throw new TyysError('AUTH_EXPIRED', '场馆会话已失效，这次请求没有自动重放：重新登录后再试一次（若反复出现，先在浏览器里打开一次体艺场馆页面）。', { endpoint });
      }
      await this.login(true);
      result = await this.send(method, endpoint, params);
    }
    if (Number(result.code) === VENUE_AUTH_CODE) {
      this.reset();
      throw new TyysError('AUTH_EXPIRED', '重新登录后场馆平台仍然拒绝：请到体艺平台网页确认账号能进「场馆预约」，然后重试。', { endpoint });
    }
    if (Number(result.code) === VENUE_NOT_RELEASED_CODE && endpoint === '/api/reservation/day/info') {
      return { notReleased: true, message: text(result.message) };
    }
    if (Number(result.code) !== 200) {
      throw new TyysError('REJECTED', `场馆平台拒绝：${text(result.message) || `code=${text(result.code)}`}`, { code: result.code, endpoint });
    }
    return result.data;
  }

  /**
   * 串行化的请求入口。
   *
   * @param method - `GET` / `POST`。
   * @param endpoint - `/api/...`。
   * @param params - 参数。
   * @returns `data`。
   */
  request(method, endpoint, params = {}) {
    const pending = this.queue.then(() => this.request_(method, endpoint, params));
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  /**
   * 发一次**写**请求（`writes.js` 专用）。
   *
   * # 为什么需要第二个入口
   *
   * 只读入口 `request()` 有三道闸：拒写接口、只放行白名单里的 POST、
   * 会话失效不重放。前两道对写操作是**反的** —— 写操作的端点本来就在
   * `FORBIDDEN_WRITES` 里。
   *
   * 早先 `writes.js` 直接调 `client.request()`，于是 `bookVenue` / `cancelVenue`
   * 的 `execute()` 在任何情况下都抛「本数据源不提供：请在工具包里完成」。
   * 那不是分层防线，是死链（`coverage-gaps.md` 的 X-3）。
   *
   * 这个入口只做三件事：串行化、登录、把「业务码 ≠ 200」翻成错误。
   * **不做**只读白名单判断，**不自动重放**（重放一次写请求可能建两张单，
   * 或把刚取消的订单再取消一次 —— 会话失效时如实报错，由上层决定）。
   *
   * # 审批不在这里
   *
   * 本包不做审批：`tool/campus-write` 先调 `xxxPrepare`，问用户，再调
   * `xxxExecute`。这个方法是 `xxxExecute` 的实现细节。
   *
   * @param endpoint - 必须是 `/api/...`。
   * @param params - 表单参数（对象值会被 JSON 序列化由调用方负责）。
   * @returns `data`。
   * @throws {TyysError}
   */
  submit(endpoint, params = {}) {
    const run = async () => {
      if (!/^\/api\/[A-Za-z0-9_/-]+$/.test(endpoint)) {
        throw new TyysError('CONFIG', `不是有效的场馆接口路径：${endpoint}。`, { endpoint });
      }
      await this.login();
      const result = await this.send('POST', endpoint, params);
      if (Number(result.code) === VENUE_AUTH_CODE) {
        // 写请求不自动重放：会话失效时如实报错，让上层重新 Prepare（等于重新问用户）。
        this.reset();
        throw new TyysError(
          'AUTH_EXPIRED',
          '场馆会话已失效，这次写请求没有重放（重放可能重复建单）。请重新发起一次。',
          { endpoint },
        );
      }
      if (Number(result.code) !== 200) {
        throw new TyysError('REJECTED', `场馆平台拒绝：${text(result.message) || `code=${text(result.code)}`}`, { code: result.code, endpoint });
      }
      return result.data;
    };
    const pending = this.queue.then(run);
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  /** 本人信息（需要登录）。 */
  async identity() {
    await this.login();
    return this.user;
  }

  /**
   * 预约须知（含放号时刻）。
   *
   * 匿名可读；进程内缓存 1 天（上游落盘缓存 1 天）。
   *
   * @returns `parseNotice` 的结果。
   */
  async notice() {
    if (this.cachedNotice && this.now() - this.cachedNotice.at < CATALOG_TTL_MS) return this.cachedNotice.value;
    const value = parseNotice(await this.request('GET', PROTOCOL_PATH), this.now());
    this.cachedNotice = { at: this.now(), value };
    return value;
  }

  /**
   * 场馆目录。
   *
   * 目录是**树**：上游用「有 `siteName` 与 `id` 的节点才是场地，否则递归它的
   * 所有字段」来遍历，本包照抄。剔掉 `isArt === 1`（艺术团）与
   * `isSupportReservation !== 1`（不可预约）的节点。
   *
   * @returns `{ sites, maxSlots, fetchedAt }`。
   * @throws {TyysError} `SHAPE` 一个可预约场地都没有。
   */
  async catalog() {
    if (this.cachedCatalog && this.now() - this.cachedCatalog.at < CATALOG_TTL_MS) return this.cachedCatalog.value;
    const data = row(await this.request('GET', '/api/reservation/campus/venue/info'));
    const sites = [];
    const visit = (node) => {
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      const item = row(node);
      if (item.siteName != null && item.id != null) {
        if (Number(item.isArt) === 1 || Number(item.isSupportReservation) !== 1) return;
        sites.push({
          id: text(item.id),
          campus: text(item.campusName),
          venue: text(item.venueName),
          name: text(item.siteName),
          sport: text(item.sportName) || /羽毛球|网球|足球|篮球|游泳|健身|乒乓球/.exec(text(item.siteName))?.[0] || '',
          maxSlots: Number(item.reservationSpaceCount) || Number(data.reservationNumMax) || 1,
        });
        return;
      }
      Object.values(item).forEach(visit);
    };
    visit(data.venueSiteInfo);
    if (!sites.length) {
      throw new TyysError('SHAPE', '场馆目录里没有任何可预约的体育场地：平台可能改了目录结构，请稍后重试或到体艺平台网页上确认。', { reason: 'empty-catalog' });
    }
    const value = { sites, maxSlots: Number(data.reservationNumMax) || 1, fetchedAt: localTime(this.now()) };
    this.cachedCatalog = { at: this.now(), value };
    return value;
  }

  /**
   * 某场馆某天的时段。
   *
   * @param site - 目录里的一个场馆（要 `id`）。
   * @param date - `YYYY-MM-DD`。
   * @returns `DayInfo`；没放号时 `open: false`、`days: NaN`。
   */
  async day(site, date) {
    const data = await this.request('GET', '/api/reservation/day/info', { venueSiteId: site.id, searchDate: date });
    if (row(data).notReleased) {
      return { date, open: false, days: NaN, weekStart: '', token: '', slots: [], message: text(row(data).message) };
    }
    return parseDay(data, date);
  }

  /**
   * 预下单信息（**只读**：这一步不创建订单）。
   *
   * 上游把它算作读请求（`READ_POSTS`），因为真正建单的是
   * `/api/reservation/order/submit`。这里只解读三个对用户有意义的字段：
   * 账号上登记的电话、要不要过验证码、同伴人数要求。
   *
   * @param input - `{ venueSiteId, date, weekStartDate, slots: [{ spaceId, timeId }], token }`。
   * @returns `{ phone, captchaRequired, buddyMin, buddyMax }`。
   * @throws {TyysError} `SHAPE` 没有场馆规则。
   */
  async preview(input = {}) {
    const slots = Array.isArray(input.slots) ? input.slots : [];
    if (!input.venueSiteId || !input.date || !input.weekStartDate || !input.token || !slots.length) {
      throw new TyysError('CONFIG', '预下单需要场馆 id、日期、周起始日、时段凭据和至少一个时段：先用场馆查询拿到这些，再重新预下单。');
    }
    const data = row(await this.request('POST', '/api/reservation/order/info', {
      venueSiteId: input.venueSiteId,
      reservationDate: input.date,
      weekStartDate: input.weekStartDate,
      reservationOrderJson: JSON.stringify(slots.map((slot) => ({ spaceId: slot.spaceId, timeId: slot.timeId, venueSpaceGroupId: null }))),
      schoolType: 1,
      token: input.token,
    }));
    const rules = row(data.venueInfoBean);
    if (!Object.keys(rules).length) {
      throw new TyysError('SHAPE', '预下单没有返回场馆规则：无法判断费用与是否需要验证码，请稍后重试。', { reason: 'no-venue-rules' });
    }
    return {
      phone: text(data.phone),
      captchaRequired: Number(data.isCaptchaCheck) === 1,
      buddyMin: Number(rules.buddyNumMin) || 0,
      buddyMax: Number(rules.buddyNumMax) || 0,
    };
  }
}

/* ────────────────────────────── 体艺 App（考勤） ── */

/**
 * 体艺 App 只读客户端（体育课考勤）。
 *
 * 与场馆平台是两套令牌：这里用的是 5 段 `jwtToken` 加请求签名。
 */
export class TyysApp {
  /**
   * @param options.request - `(url, init) => Promise<{status, text}>`。
   * @param options.acquireLogin - `({ service }) => Promise<{ body }>`，走一遍
   *   统一身份认证，返回登录页正文（正文里有 `jwtToken`）。
   * @param options.username - 账号（令牌 `sub` 必须等于它）。
   * @param options.timeoutMs - 单请求超时。
   * @param options.now - 取当前时间（测试注入）。
   */
  constructor({ request, acquireLogin = null, username = '', timeoutMs = REQUEST_TIMEOUT_MS, now = () => Date.now() }) {
    /**
     * ⚠️ 注入的函数必须存成 	his.fetch，**不能**存成 	his.request。
     *
     * TyysApp 有一个 get()，没有同名方法，但为了与 VenueClient 一致、
     * 也为了让「注入的 request」与「方法」在代码里一眼可分，同样存成 	his.fetch。
     */
    this.fetch = request;
    this.acquireLogin = acquireLogin;
    this.username = username;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.tokens = null;
    this.pendingLogin = null;
    this.queue = Promise.resolve();
  }

  /** 令牌是否仍可用（留 5 秒余量）。 */
  get usable() {
    return Boolean(this.tokens) && this.tokens.expires > this.now() + 5000;
  }

  /** 丢掉令牌。 */
  reset() {
    this.tokens = null;
  }

  /**
   * 确保有会话（并发去重）。
   *
   * @param fresh - 强制重新登录。
   * @returns 无。
   * @throws {TyysError} `CONFIG` / `AUTH_EXPIRED` / `SHAPE`。
   */
  ensureSession(fresh = false) {
    if (!fresh && this.usable) return Promise.resolve();
    this.pendingLogin ??= this.establish(fresh).finally(() => { this.pendingLogin = null; });
    return this.pendingLogin;
  }

  /**
   * 建立会话：CAS 回跳页面正文里的 `jwtToken`。
   *
   * @param fresh - 强制重新登录。
   * @returns 无。
   */
  async establish(fresh) {
    if (!fresh && this.usable) return;
    this.reset();
    if (typeof this.acquireLogin !== 'function') {
      throw new TyysError('CONFIG', '体艺 App 还没接入统一身份认证：到「设置 → 浙大一卡通」填好学号和密码后重试。');
    }
    if (!this.username) {
      throw new TyysError('CONFIG', '看体育课考勤要指定学号（这个包不读凭据，账号由调用方传入）。');
    }
    const response = await this.acquireLogin({ service: APP_LOGIN_SERVICE });
    const body = String(response?.body ?? '');
    const full = body.match(/jwtToken["']?\s*:\s*["']([^"']+)/)?.[1];
    if (!full) {
      throw new TyysError('AUTH_EXPIRED', `体艺 App 登录没有返回令牌：确认这个账号能用体艺 App（HTTP ${text(response?.status) || '未知'}），然后重试。`, { reason: 'no-jwt-token' });
    }
    const tokens = parseTokens(full, this.username);
    if (tokens.expires <= this.now()) {
      throw new TyysError('AUTH_EXPIRED', '体艺登录返回的令牌已经过期：请重新登录后再试。', { reason: 'expired-token' });
    }
    this.tokens = tokens;
  }

  /**
   * 发一次 App 请求（带签名，不判断业务码）。
   *
   * `401` / 业务码 `2001` 都表示这套令牌失效（上游注释：部分 PTM 接口用
   * `2001` 作废 App 令牌，而同一个令牌对考勤接口仍然有效）。
   *
   * @param path - `/api/...`。
   * @param params - 查询参数。
   * @param app - 是否走 `cgapp-server`（默认走 `ptm`）。
   * @returns `{ code, message, data }` 或 undefined（会话失效）。
   * @throws {TyysError} `CONFIG` / `SHAPE` / `REJECTED` / `UNREACHABLE` / `TIMEOUT`。
   */
  async send(path, params = {}, app = false) {
    if (!/^\/api\/[A-Za-z0-9_./-]+$/.test(path) || path.includes('..')) {
      throw new TyysError('CONFIG', `不是有效的体艺接口路径：${path}。`, { path });
    }
    await this.ensureSession();
    const query = new URLSearchParams(params).toString();
    const tokens = this.tokens;
    const headers = {
      'app-key': APP_KEY,
      v1: APP_V1,
      imei: APP_IMEI,
      cgAuthorization: tokens.authorization,
      ...signRequest(tokens.material, path, query, this.now()),
      Accept: 'application/json',
    };
    let response;
    try {
      response = await withTimeout(this.fetch, (app ? APP_BASE : PTM_BASE) + path + (query ? `?${query}` : ''), { method: 'GET', headers }, this.timeoutMs);
    } catch (error) {
      throw translateNetwork(error);
    }
    if (response.status === 429) {
      throw new TyysError('RATE_LIMITED', '体艺接口正在限流，本次已停止：等几分钟再试。', { path, httpStatus: 429 });
    }
    // HTTP 401 可能带 HTML 或空正文，仍然要触发一次重登。
    if (response.status === 401) return undefined;
    let body;
    try {
      body = JSON.parse(response.text);
    } catch {
      throw new TyysError('SHAPE', `体艺 App 没有返回 JSON（HTTP ${response.status}）：多半是登录页，请重试；校外请确认网络可达。`, { path, httpStatus: response.status });
    }
    if ([401, 2001].includes(Number(body?.code))) return undefined;
    if (!body || Array.isArray(body) || body.code == null || !Number.isFinite(Number(body.code))) {
      throw new TyysError('SHAPE', `体艺 App 响应缺少业务状态码（HTTP ${response.status}）：无法确认结果，请稍后重试。`, { path, httpStatus: response.status });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new TyysError('REJECTED', `体艺 App 返回 HTTP ${response.status}：请稍后重试。`, { path, httpStatus: response.status });
    }
    return { code: Number(body.code), message: this.redact(typeof body.message === 'string' ? body.message : ''), data: body.data };
  }

  /** 把令牌从平台给的文案里抹掉（错误信息会进日志）。 */
  redact(message) {
    const sensitive = [this.tokens?.full, this.tokens?.authorization].filter(Boolean);
    return sensitive.reduce((out, value) => out.split(value).join('<redacted>'), message).slice(0, 500);
  }

  /**
   * 读一个 App 接口（会话失效时重登一次再重放）。
   *
   * @param path - `/api/...`。
   * @param params - 查询参数。
   * @param app - 是否走 `cgapp-server`。
   * @returns 平台信封。
   * @throws {TyysError} `AUTH_EXPIRED` 重登后仍失效。
   */
  async get(path, params = {}, app = false) {
    const run = async () => {
      let response = await this.send(path, params, app);
      if (response) return response;
      this.reset();
      await this.ensureSession(true);
      response = await this.send(path, params, app);
      if (response) return response;
      this.reset();
      throw new TyysError('AUTH_EXPIRED', '重新登录后体艺 App 仍然拒绝：请到体艺 App 里确认账号能用（比如能打开体育课），然后重试。', { path });
    };
    const pending = this.queue.then(run);
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  /**
   * 检查会话（上游 `checkSession`）。
   *
   * @returns 本人信息（`uid` / `name` 等，原样给出）。
   */
  async checkSession() {
    const response = await this.get('/api/l/v6/u/info', { xh: this.username }, true);
    if (Number(response.code) !== 200) {
      throw new TyysError('REJECTED', `体艺用户信息查询失败：${response.message || `code=${response.code}`}`, { code: response.code });
    }
    return row(response.data);
  }
}

/* ────────────────────────────── 考勤 ── */

/**
 * App 的考勤状态文案（`ClassAttendanceModel2.Status`）。
 *
 * `-1` 停课、`0` 未考勤、`1` 到、`2` 缺勤、`3` 早退、`4` 病假、
 * `5` 事假、`6` 迟到、`7` 未确认。
 */
export const ATTENDANCE_STATUS = Object.freeze({
  '-1': '停课', 0: '未考勤', 1: '到', 2: '缺勤', 3: '早退', 4: '病假', 5: '事假', 6: '迟到', 7: '未确认',
});

/** App 接口前缀。 */
const ATTENDANCE_API = '/api/l/v6';

/**
 * 取 `data`；业务码不是 200 就是拒绝。
 *
 * @param response - 平台信封。
 * @param what - 中文名（拼进错误文案）。
 * @returns `data`。
 * @throws {TyysError} `REJECTED`。
 */
function dataOf(response, what) {
  if (Number(response.code) !== 200) {
    throw new TyysError('REJECTED', `体艺${what}失败：${response.message || `code=${response.code}`}`, { code: response.code });
  }
  return response.data;
}

/**
 * 体育课历史考勤：各学期每次课的日期与到勤状态，最近的在前。
 *
 * # 两处必须照上游的算法
 *
 * - **`lack` 不能用来算缺勤**：它把还没上的课也算进去（2026-09 学期：应到 16、
 *   已上 3 次却报缺 13）。所以到勤次数只能用 `detail` 里已发生的课次自己数；
 * - **`course_times` 才给日期**：`detail` 只有 `teachingWeek`（第几次课），
 *   日期要从 `/api/l/v6/course_times` 的 `teachingWeek → date` 对上。
 *
 * @param client - `TyysApp`。
 * @param course - 课程名过滤（可省略）。
 * @returns `{ status, message, courses }`。
 */
export async function history(client, course) {
  const wanted = course == null ? undefined : String(course).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const terms = dataOf(await client.get(`${ATTENDANCE_API}/termlist`), '学期查询');
  const perTerm = await Promise.all(rows(terms).reverse().map(async (term) => {
    const list = dataOf(await client.get(`${ATTENDANCE_API}/student/courselist`, {
      uid: client.username, termId: String(term.termId), schoolYear: String(term.schoolYear),
    }), '课程查询');
    return rows(list).map((item) => ({ courseId: String(item.courseId), name: String(item.name), semester: String(term.name ?? '') }));
  }));
  const courses = perTerm.flat().filter((item) => !wanted || item.name.normalize('NFKC').replace(/\s+/g, '').toLowerCase().includes(wanted));
  const found = await Promise.all(courses.map(async (item) => {
    const [list, times] = await Promise.all([
      client.get(`${ATTENDANCE_API}/student/attendancelist`, { uid: client.username, courseId: item.courseId })
        .then((response) => dataOf(response, '考勤记录查询')),
      client.get(`${ATTENDANCE_API}/course_times`, { courseId: item.courseId })
        .then((response) => dataOf(response, '课次查询')),
    ]);
    const dates = new Map(rows(times).map((entry) => [String(entry.teachingWeek), String(entry.date ?? '').slice(0, 10)]));
    const records = rows(row(list).detail).map((entry) => ({
      session: Number(entry.teachingWeek),
      date: dates.get(String(entry.teachingWeek)) ?? '',
      status: (ATTENDANCE_STATUS[String(entry.status)] ?? `状态 ${entry.status}`)
        + (Number(entry.isEarly) === 1 && String(entry.status) !== '3' ? '（早退）' : ''),
    })).sort((a, b) => b.session - a.session);
    const signed = records.filter((entry) => entry.status.startsWith('到') || entry.status.startsWith('迟到')).length;
    return {
      course: item.name,
      semester: item.semester,
      planned: Number(row(list).shouldReach) || undefined,
      held: records.length,
      signed,
      records,
    };
  }));
  const missed = found.flatMap((item) => item.records
    .filter((entry) => !/^(到|迟到|停课)/.test(entry.status))
    .map((entry) => `${item.course} 第 ${entry.session} 次课${entry.date ? `（${entry.date}）` : ''} ${entry.status}`));
  const held = found.reduce((sum, item) => sum + item.held, 0);
  const signed = found.reduce((sum, item) => sum + item.signed, 0);
  const message = !courses.length
    ? (course ? `没有找到体育课“${course}”。` : '没有体艺课程。')
    : !held
      ? `${found.map((item) => item.course).join('、')}还没有考勤记录。`
      : `${found.length} 门体育课已有 ${held} 次考勤，到勤 ${signed} 次` + (missed.length ? `，未到：${missed.join('；')}。` : '，没有缺勤。');
  return { status: held ? 'found' : 'none', message, courses: found };
}

/* ────────────────────────────── 查空场 ── */

/**
 * 查场馆、并（在筛选唯一时）查某天的空场。
 *
 * 状态机照上游 `listVenues`：
 * `catalog`（没指定或命中多个，只列目录）→ `needs-time`（该时刻没有这个时段，
 * 给相邻可选）→ `not-released`（那天还没放号，能算就给放号时刻）→
 * `available` / `unavailable`。
 *
 * @param client - `VenueClient`（或测试替身，只要有 `catalog` / `day` / `notice`）。
 * @param filter - `{ sport?, campus?, venue?, date, time? }`。
 * @param now - 当前时间。
 * @returns 查询结果。
 * @throws {TyysError} `CONFIG` 日期缺失。
 */
export async function listVenues(client, filter = {}, now = Date.now()) {
  const date = filter.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) || !Number.isFinite(atDate(String(date)))) {
    throw new TyysError('CONFIG', '查空场要给日期，写成 YYYY-MM-DD（先用「今天/明天」这类写法换算）。');
  }
  const catalog = await client.catalog();
  const found = matchSites(catalog.sites, filter);
  const summaries = found.map((site) => ({ campus: site.campus, venue: site.venue, site: site.name, sport: site.sport }));
  if ((!filter.sport && !filter.campus && !filter.venue) || found.length !== 1) {
    return {
      status: 'catalog',
      message: found.length ? '已列出匹配的场馆；指定其中一个场馆后再查某天的空场' : '没有匹配的体育场馆：换个运动或校区名称试试',
      venues: summaries,
      fetchedAt: catalog.fetchedAt,
    };
  }
  const site = found[0];
  const day = await client.day(site, date);
  const notice = await client.notice();
  if (day.open && filter.time && !day.slots.some((slot) => slot.start === filter.time.start)) {
    return {
      status: 'needs-time',
      message: `这个场馆没有 ${filter.time.start} 开始的时段；下面是相邻的可选时段，请明确一个开始时间`,
      venue: summaries[0],
      date,
      alternatives: nearbyTimes(day, filter.time, now),
      observedAt: localTime(now),
    };
  }
  let release;
  if (!day.open && date > beijingDate(now)) {
    const days = Number.isFinite(day.days) ? day.days : (await client.day(site, beijingDate(now))).days;
    release = releaseAt(site, date, days, notice, now);
  }
  const slots = day.slots.filter((slot) => slot.status === 1
    && atDate(date, slot.start) > now
    && (!filter.time || (filter.time.end
      ? slot.start >= filter.time.start && slot.end <= filter.time.end
      : slot.start === filter.time.start)));
  const grouped = new Map();
  for (const slot of slots) {
    const key = slot.start + slot.end;
    const group = grouped.get(key) ?? { start: slot.start, end: slot.end, courts: [] };
    group.courts.push(slot.space);
    grouped.set(key, group);
  }
  return {
    status: !day.open ? 'not-released' : slots.length ? 'available' : 'unavailable',
    message: !day.open
      ? (release ? `目标日期还没放号；按须知和当前窗口预计 ${localTime(release)} 放号` : '目标日期还没发布时段，放号时刻暂时算不出来')
      : slots.length ? '已查到目标日期的空场' : '目标日期已开放，但没有符合条件的空场',
    venue: summaries[0],
    date,
    releaseAt: release ? localTime(release) : null,
    releaseTime: releaseTime(site, notice) ?? null,
    slots: [...grouped.values()].sort((a, b) => a.start.localeCompare(b.start)),
    observedAt: localTime(now),
  };
}
