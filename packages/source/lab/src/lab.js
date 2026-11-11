/**
 * 实验课选课平台（`10.203.16.55`）：本人实验课、班次余量、已选、课表、公告。
 *
 * # 分层（D17）
 *
 * 本包**只读**：D17 规定写操作归 `packages/tool/*` 并注册成 AI 工具。
 * 上游的 `select` / `cancel` 两个写方法**不在这里**（见 README 的「写操作去哪了」）。
 *
 * # 这个平台的接口事实（照上游 `lab/index.ts` 2026-09-18 逆向 + 实测）
 *
 * - **两个端口**：86 是 Vue SPA 静态页；8098 是 API（`http://10.203.16.55:8098/lab-course/api/*`）；
 * - **私网 IP**：所以 `network: campus`。上游注释明确「走 WebVPN 重写 http-8098」——
 *   2026-11-10 本仓在校园网内实测：SPA 返回 200、API 根路径 404（服务端已响应）、
 *   登录端点用上游签名返回 `{"code":200,...,"data":"用户名或密码错误"}`，**协议逐项正确**；
 * - **每个请求都要签名**：`app_key` + `timestamp`（毫秒）+ `sign` 与业务参数混在一起
 *   （GET 进 query，POST 进**表单体**）；
 * - `sign = md5(secret + path + 排序后(按参数名)的 k+v（跳过空值和对象） + timestamp + " " + secret)`；
 * - 请求头 `Authorization: <token_type> <access_token>`（登录除外）；
 * - 响应信封 `{code, message, data}`：**200 成功**、401 无权限、408 token 失效；
 * - JWT 有效期 48 小时；多角色时默认切到学生角色（换发 token）。
 *
 * # ⚠️ 请求体必须是 form-urlencoded
 *
 * 用 JSON 会稳定拿到 `code:400 Bad Request`。这是我在实测时踩过的：先用 JSON 试，
 * 一直 400；换成 `application/x-www-form-urlencoded` 才拿到 200 与真实业务错误。
 */

import { createHash } from 'node:crypto';

/** 平台主机（私网 IP）。 */
export const LAB_HOST = '10.203.16.55';
/** API 端口。 */
export const API_PORT = 8098;
/** API 根。 */
export const API_BASE = `http://${LAB_HOST}:${API_PORT}/lab-course`;
/** SPA 地址（给人看的选课页）。 */
export const SITE_URL = `http://${LAB_HOST}:86/lab-course/selectCourse`;

/**
 * 平台前端 `app.js` 里混淆常量解码出来的 `app_key`。
 *
 * ⚠️ 这**不是用户凭据**：它是实验课平台那个 Vue SPA 自己带在页面里的客户端标识，
 * 任何打开选课页的人都能从 DevTools 里看到。真正的身份靠登录换来的 JWT。
 *
 * 值取自上游 `lab/index.ts:38`（逐字符相同），角色等同于「UA 里的产品名」。
 */
export const APP_KEY = 'eb8c68399de7483abb2d8abaea0d039f';

/**
 * 同上，签名用。
 *
 * 一个公开 web 客户端的共享密钥 —— 它在浏览器里能被读到，所以它在密码学意义上
 * 与 `app_key` 同级。**不要**把它误当成用户密码管理。
 */
export const APP_SECRET = '7cd476ab866b49d7a9788ad9f4789495';
/** 学生角色 id。 */
export const ROLE_STUDENT = 1;

/** JWT 剩余有效期不足这么久就重新登录（避免请求发到一半失效）。 */
const REFRESH_MARGIN_MS = 60_000;

/** 本包的统一错误形状。 */
export class LabError extends Error {
  /**
   * @param code - 稳定错误码。
   * @param message - 给人看的一句话。
   * @param details - 附加信息。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LabError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 算一次请求的签名。
 *
 * 参数按**参数名排序**后拼 `k+v`，跳过空值与对象。`timestamp` 是毫秒。
 *
 * @param path - 相对 `lab-course` 的路径，如 `/api/login`。
 * @param timestamp - 毫秒时间戳。
 * @param data - 业务参数。
 * @returns md5 hex。
 */
export function apiSign(path, timestamp, data = {}) {
  let text = APP_SECRET + path;
  for (const key of Object.keys(data).sort()) {
    const value = data[key];
    if (value !== '' && value !== undefined && value !== null && typeof value !== 'object') text += key + String(value);
  }
  text += timestamp + ' ' + APP_SECRET;
  return createHash('md5').update(text).digest('hex');
}

/**
 * 解 JWT 的 `exp`（秒 → 毫秒）。
 *
 * 解不开返回 undefined —— 那时调用方退回「48 小时」的默认假设。
 *
 * @param token - JWT。
 * @returns 毫秒时间戳，或 undefined。
 */
export function jwtExpiresAt(token) {
  const part = String(token ?? '').split('.')[1];
  if (!part) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 把一个班次的 `openWeek`（JSON 数组字符串，如 `["1,2","3,4"]`）解析成周次段数组。
 *
 * `selectWeek` 要取其中一个元素。解析失败返回空数组 —— 那意味着这个班次没有可选周次，
 * 而不是「周次是空字符串」。
 *
 * @param raw - 原始字段。
 * @returns 周次段数组。
 */
export function parseOpenWeek(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** 把可能换行分隔的日期字符串拆成数组。 */
const splitDates = (value) => String(value ?? '').split(/[\r\n,，;；]+/).map((s) => s.trim()).filter(Boolean);

/** 去标签、压空白（公告正文转纯文本）。 */
const htmlToText = (html) => String(html ?? '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

/**
 * 实验课平台的只读客户端。
 *
 * 登录由调用方通过 `credentials()` 提供（`{ username, password }`）——
 * 本包不碰凭据从哪来。会话（token）由调用方通过 `session` 持久化。
 */
export class LabCourse {
  /**
   * @param options.request - `(url, init) => { status, text }`，由调用方注入。
   * @param options.credentials - `() => Promise<{username, password}>`。
   * @param options.session - `{ load, save }`，读写缓存 token；可省略（纯内存）。
   * @param options.now - 取当前时间（测试注入）。
   */
  constructor({ request, credentials, session = null, now = () => Date.now() }) {
    this.request = request;
    this.credentials = credentials;
    this.session = session;
    this.now = now;
    /** 当前登录态：`{ username, name, role, token, tokenType, expiresAt }`。 */
    this.auth = null;
    /** 登录去重：并发的 `login()` 共用同一个 Promise。 */
    this.loginPromise = null;
  }

  /**
   * 复用缓存 token（如果还没过期）。
   *
   * @returns 是否有可用 token。
   */
  restore() {
    if (!this.session) return false;
    const cached = this.session.load();
    const token = typeof cached?.token === 'string' ? cached.token : undefined;
    const expiresAt = typeof cached?.expiresAt === 'number' ? cached.expiresAt : undefined;
    if (token && expiresAt && expiresAt > this.now() + REFRESH_MARGIN_MS) {
      this.auth = {
        username: String(cached.username ?? ''),
        name: String(cached.name ?? ''),
        role: Number(cached.role ?? ROLE_STUDENT),
        token,
        tokenType: String(cached.tokenType ?? 'bearer'),
        expiresAt,
      };
      return true;
    }
    return false;
  }

  /** 当前是否有可用 token。 */
  get hasToken() {
    return Boolean(this.auth) && this.auth.expiresAt > this.now() + REFRESH_MARGIN_MS;
  }

  /**
   * 登录（并发去重）。
   *
   * @param force - 强制重新登录。
   * @returns 登录态。
   */
  login(force = false) {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.doLogin(force).finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }

  /**
   * 真正的登录动作。
   *
   * @param force - 强制重登。
   * @returns 登录态。
   * @throws {LabError} 凭据缺失、平台拒绝、响应形状不对。
   */
  async doLogin(force) {
    if (this.auth && !force && this.hasToken) return this.auth;
    const account = await this.credentials();
    if (!account?.username || !account?.password) {
      throw new LabError('CREDENTIALS', '还没有配置实验课平台的账号。它默认同学号，密码在平台自己的页面注册。');
    }

    const data = await this.raw('/api/login', {
      username: account.username,
      password: account.password,
    }, 'POST', false);

    let auth = {
      username: account.username,
      name: String(data?.name ?? ''),
      role: Number(data?.role ?? 0),
      token: String(data?.token?.access_token ?? ''),
      tokenType: String(data?.token?.token_type ?? 'bearer'),
      expiresAt: jwtExpiresAt(data?.token?.access_token) ?? this.now() + 48 * 3600 * 1000,
    };
    if (!auth.token) throw new LabError('SHAPE', '实验课平台登录响应里没有 token');

    // 多角色时切到学生角色（换发 token）—— 否则后续接口按错误角色鉴权。
    if (Array.isArray(data?.roles) && data.roles.length > 1 && auth.role !== ROLE_STUDENT) {
      const switched = await this.raw('/api/change_role', {
        roles: ROLE_STUDENT, username: account.username,
      }, 'POST', false);
      auth = {
        ...auth,
        token: String(switched?.token?.access_token ?? auth.token),
        tokenType: String(switched?.token?.token_type ?? auth.tokenType),
        role: Number(switched?.role ?? ROLE_STUDENT),
        expiresAt: jwtExpiresAt(switched?.token?.access_token) ?? auth.expiresAt,
      };
    }

    this.auth = auth;
    await this.session?.save?.(auth);
    return auth;
  }

  /**
   * 发一次签名请求。
   *
   * GET 参数进 query；POST 参数进**表单体**（JSON 会 400）。
   * `code === 401 || 408` 时重登一次再重放（只重放一次，防死循环）。
   *
   * @param path - 相对路径。
   * @param data - 业务参数。
   * @param method - `GET` / `POST`。
   * @param withAuth - 是否带 `Authorization`（登录接口不带）。
   * @param retried - 内部用：是否已经重试过。
   * @returns `data` 字段。
   * @throws {LabError} 平台拒绝、token 失效、响应不是 JSON。
   */
  async raw(path, data = {}, method = 'GET', withAuth = true, retried = false) {
    const timestamp = this.now();
    const sign = apiSign(path, timestamp, data);
    const params = { app_key: APP_KEY, timestamp: String(timestamp), sign };
    for (const [key, value] of Object.entries(data)) {
      if (value !== '' && value !== undefined && value !== null) params[key] = String(value);
    }
    const query = Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');

    const headers = {};
    if (withAuth && this.auth) headers.Authorization = `${this.auth.tokenType} ${this.auth.token}`;

    const response = method === 'GET'
      ? await this.request(`${API_BASE}${path}?${query}`, { method, headers })
      : await this.request(`${API_BASE}${path}`, {
        method,
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: query,
      });

    let envelope;
    try {
      envelope = JSON.parse(response.text);
    } catch {
      throw new LabError('SHAPE', `实验课平台响应不是 JSON（HTTP ${response.status}）：${String(response.text ?? '').slice(0, 120)}`, { path });
    }

    if (envelope?.code === 200) return envelope.data;

    // token 失效：重登一次再重放。收敛条件 `retried` 保证最多重试一次。
    if ((envelope?.code === 401 || envelope?.code === 408) && withAuth && !retried) {
      this.auth = null;
      await this.login(true);
      return this.raw(path, data, method, withAuth, true);
    }
    if (envelope?.code === 401 || envelope?.code === 408) {
      throw new LabError('AUTH_EXPIRED', `实验课平台登录态失效（code=${envelope.code}${envelope.message ? ` ${envelope.message}` : ''}）`, { path });
    }
    throw new LabError('REJECTED', `实验课平台：${envelope?.message || `code=${envelope?.code}`}`, { path, code: envelope?.code });
  }

  /**
   * 确保已登录并返回用户名。
   *
   * # 为什么需要单独一个方法
   *
   * 那些带 `uid` 的接口要先把用户名拼进参数，再交给 `call()`。而 `call()` 内部才登录 ——
   * 参数在调用前就求值了，此时 `this.auth` 还是 null，直接读 `this.auth.username`
   * 会抛 `Cannot read properties of null`。这个错误只在**首次**调用时出现（登录后
   * 就有 auth 了），所以很容易被「第二次能跑通」掩盖过去。
   *
   * @returns 登录后的用户名。
   */
  async ensureLogin() {
    const auth = await this.login();
    return auth.username;
  }

  /** 带登录的读取。 */
  async call(path, data = {}, method = 'GET') {
    await this.login();
    return this.raw(path, data, method);
  }

  /* ────────────────────────── 只读接口 ── */

  /** 所有学期。 */
  async terms() {
    const data = await this.call('/api/terms');
    if (!Array.isArray(data?.content)) throw new LabError('SHAPE', '实验课学期响应缺少 content 数组');
    return data.content;
  }

  /**
   * 当前学期。
   *
   * **只认服务端唯一的 `currentTerm === 1` 标记**，不按列表顺序猜 ——
   * 猜错的后果是「用户看到的课表是另一个学期的」。
   */
  async currentTerm() {
    const list = await this.terms();
    if (!list.length) throw new LabError('SHAPE', '实验课平台没有学期数据');
    const current = list.filter((term) => term.currentTerm === 1);
    if (current.length !== 1) {
      throw new LabError('CONFIG', `实验课当前学期标记不唯一（${current.length} 个），请明确指定 term`);
    }
    return current[0];
  }

  /** 解析学期 id；不给则用当前学期。 */
  async termId(term) {
    if (term !== undefined && term !== '') return Number(term);
    return (await this.currentTerm()).id;
  }

  /** 我这个学期的实验课（选课页左侧课程列表）。 */
  async myCourses(term) {
    const id = await this.termId(term);
    const uid = await this.ensureLogin();
    const data = await this.call('/api/courses/uid', { page: -1, size: -1, termId: id, uid });
    if (!Array.isArray(data)) throw new LabError('SHAPE', '实验课程响应不是数组，不能视为没有课程');
    return data;
  }

  /** 某门课的实验班次；`openWeek` 解析成 `weeks`。 */
  async labs(courseId) {
    const data = await this.call(`/api/courseId/${Number(courseId)}/course/labs`);
    const list = Array.isArray(data) ? data : data?.content;
    if (!Array.isArray(list)) throw new LabError('SHAPE', '实验班次响应缺少数组，不能视为没有班次');
    return list.map((lab) => ({ ...lab, weeks: parseOpenWeek(lab.openWeek) }));
  }

  /**
   * 各班次各周次已选人数：`"班次id_周次段"` → 人数。
   *
   * 每个值都要是有限非负数，否则整份响应作废 —— **这份数据是用来判断余量的**，
   * 带着一个 `NaN` 进去会让「已满」被算成「有余」。
   */
  async weekStatus(term) {
    const id = await this.termId(term);
    const uid = await this.ensureLogin();
    const data = await this.call('/api/course/labs/status', { termId: id, studentUid: uid });
    const valid = data && typeof data === 'object' && !Array.isArray(data)
      && Object.values(data).every((value) => ['number', 'string'].includes(typeof value)
        && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0);
    if (!valid) throw new LabError('SHAPE', '实验班次人数响应异常，不能据此判断余量');
    return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, Number(value)]));
  }

  /** 我的已选实验。 */
  async mySelections(term) {
    const id = await this.termId(term);
    const uid = await this.ensureLogin();
    const data = await this.call('/api/course/lab/students', { termId: id, uid, page: -1, size: -1 });
    if (!Array.isArray(data?.content)) throw new LabError('SHAPE', '实验课已选列表缺少 content 数组，不能据此确认选课结果');
    return data.content;
  }

  /** 选课窗口 + 服务器毫秒时间戳（供定时执行校准时钟）。 */
  async openStatusWithClock() {
    const data = await this.call('/api/course/open_status');
    if (!Array.isArray(data?.openstatus)) throw new LabError('SHAPE', '实验课选课窗口缺少 openstatus 数组');
    return { windows: data.openstatus, ...(typeof data.timestamp === 'number' ? { timestamp: data.timestamp } : {}) };
  }

  /** 选课窗口（可按学期过滤）。 */
  async openStatus(term) {
    const { windows } = await this.openStatusWithClock();
    if (term === undefined || term === '') return windows;
    return windows.filter((window) => window.termId === Number(term));
  }

  /** 平台公告（正文转纯文本）。 */
  async notices() {
    const uid = await this.ensureLogin();
    const data = await this.call('/api/notices/student', { uid });
    if (!Array.isArray(data)) throw new LabError('SHAPE', '实验课通知响应不是数组');
    return data.map((notice) => ({
      ...notice,
      id: Number(notice.id),
      title: String(notice.title ?? ''),
      text: htmlToText(String(notice.content ?? '')),
      publishedAt: typeof notice.gmtCreate === 'number' ? new Date(notice.gmtCreate).toISOString() : undefined,
    }));
  }

  /**
   * 我的课表：每个已选实验展开成按日期的一次课。
   *
   * 行里缺 `dates` 时按网页的做法查 `/api/courseLabTimes/date`（键 `"班次id_周次段"`，
   * 多个日期换行分隔）。查不到日期的那条给 `date: null` —— 不猜一个日期出来。
   */
  async myTimetable(term) {
    const id = await this.termId(term);
    const uid = await this.ensureLogin();
    const courses = await this.myCourses(id);
    const rows = (await Promise.all(courses.map(async (course) => {
      const data = await this.call('/api/course/lab/students/full', {
        termId: id, uid, courseId: course.id, page: -1, size: -1,
      });
      if (!Array.isArray(data?.content)) throw new LabError('SHAPE', '实验课表响应缺少 content 数组，不能视为没有排课');
      return data.content;
    }))).flat();

    // 只对「缺日期」的课程查一次日期表，按课程去重。
    const dateMaps = new Map();
    for (const courseId of new Set(rows.filter((row) => !splitDates(row.dates).length).map((row) => Number(row.course_id)))) {
      dateMaps.set(courseId, (await this.call('/api/courseLabTimes/date', { courseId })) ?? {});
    }

    return rows.flatMap((row) => {
      const own = splitDates(row.dates);
      const dates = own.length ? own : splitDates(dateMaps.get(Number(row.course_id))?.[`${row.id}_${row.select_week}`]);
      const base = {
        start: String(row.times ?? ''),
        course: String(row.course_name ?? ''),
        experiment: String(row.lab_name ?? ''),
        room: String(row.address ?? '').replace(/[,，\s]+$/, ''),
        teacher: String(row.teacher_name ?? ''),
        sequence: String(row.select_week ?? ''),
      };
      return dates.length ? dates.map((date) => ({ date, ...base })) : [{ date: null, ...base }];
    }).sort((a, b) => `${a.date ?? '9999'} ${a.start}`.localeCompare(`${b.date ?? '9999'} ${b.start}`));
  }

  /** 个人资料（平台里的 `password` 是哈希，剥掉不外传）。 */
  async myInfo() {
    const uid = await this.ensureLogin();
    const data = await this.call(`/api/uid/${uid}/students`);
    if (data && typeof data === 'object') delete data.password;
    return data ?? {};
  }
}
