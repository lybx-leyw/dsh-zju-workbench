/**
 * 浙江大学大学生素质拓展数智平台（`sztz.zju.edu.cn/dekt`）：第二、三、四课堂的
 * 活动、项目、记点与成绩单。
 *
 * # 分层（D17）
 *
 * 本包**只读**。上游的 `signUp`（报名）、`cancelSignUp`（取消报名）、
 * `setFavorite`（收藏开关）三个写方法归 `packages/tool/*`，不在这里。
 *
 * # 接口事实（照上游 `sztz/index.ts` 的实测记录）
 *
 * - 主机只解析到校内地址（`10.203.15.167`），所以 `network: campus`，校外要经 WebVPN；
 * - 登录：`GET login/getLoginUrl?returnUrl=<BASE>/` 返回 CAS 地址（`service=<BASE>/`），
 *   走完 CAS 回跳后会话生效；
 * - 接口都在 `<BASE>/` 下，GET 带查询串、POST 为表单；
 * - 响应 `{code, msg, data, extend, count, totalPages}`，**`code=0` 才是成功**；
 * - **时间字段是 UTC 的 ISO 串**，对外要换成北京时间；
 * - 未登录时个人接口返回 `code=-1` 且 `msg` 含「访问权限」，活动列表可匿名读
 *   但负责人信息是 `****`、不带本人报名状态 —— 这两种情况都要登录后重取一次。
 *
 * # 一处容易踩的判据
 *
 * 「已结束」以**活动结束时间**为准，不是开始时间。上游注释写着「平台上有开始时间
 * 填错年份的活动」—— 用开始时间判断会把还没结束的活动误判成已结束。
 */

/** 站点主机。 */
export const HOST = 'sztz.zju.edu.cn';
/** 二课平台根。 */
export const BASE = `https://${HOST}/dekt`;

/** 每页条数。 */
const PAGE = 50;
/** 最多翻几页。 */
const MAX_PAGES = 20;
/**
 * 往回读多少天前的活动。
 *
 * 活动按开始时间由新到旧排；找「还没结束」的活动时要往回读到这么多天前才停 ——
 * 长期活动的开始时间可能很早，但它仍然没结束。
 */
const BACK_DAYS = 90;

/** 活动状态（顺序即展示优先级）。 */
export const STATUSES = Object.freeze(['报名中', '未开始报名', '报名已截止', '进行中', '已结束']);

/** 本包的统一错误形状。 */
export class SztzError extends Error {
  /**
   * @param code - 稳定错误码。
   * @param message - 给人看的一句话。
   * @param details - 附加信息。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SztzError';
    this.code = code;
    this.details = details;
  }
}

/**
 * ISO 串转北京时间 `YYYY-MM-DD HH:mm`。
 *
 * 站点给的是 UTC 的 ISO；直接上屏会让用户看到差 8 小时的时间。
 *
 * @param iso - ISO 字符串。
 * @returns 北京时间，或 undefined（值不可解析时）。
 */
export function beijing(iso) {
  if (typeof iso !== 'string' || !Number.isFinite(Date.parse(iso))) return undefined;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(iso));
}

/** 去标签、压空白。 */
const clean = (html) => (typeof html === 'string'
  ? html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
  : '');

/** 记点范围：起点与终点相同时只写一个数。 */
export const points = (project) => (project?.zxfs === project?.zdfs ? String(project?.zxfs ?? '') : `${project?.zxfs}–${project?.zdfs}`);

/** 分类：项目分类 · 项目类别。 */
export const category = (project) => [project?.xmfl?.mc, project?.xmlb?.mc].filter(Boolean).join('·');

/**
 * 算一个活动/项目的状态。
 *
 * ⚠️ 「已结束」看 `hdjssj`（结束时间）而不是 `hdkssj`（开始时间）——
 * 平台上有开始时间填错年份的记录。
 *
 * @param project - 含四个时间字段的记录。
 * @param now - 当前毫秒时间戳。
 * @returns 状态字符串。
 */
export function statusOf(project, now = Date.now()) {
  if (now > Date.parse(project.hdjssj)) return '已结束';
  if (now < Date.parse(project.bmkssj)) return '未开始报名';
  if (now <= Date.parse(project.bmjssj)) return '报名中';
  return now < Date.parse(project.hdkssj) ? '报名已截止' : '进行中';
}

/**
 * 只保留「还没结束」的活动。
 *
 * @param rows - 原始记录。
 * @param now - 当前时间。
 * @returns 过滤后的记录。
 */
export const unfinishedOnly = (rows, now) => rows.filter((row) => statusOf(row, now) !== '已结束');

/**
 * 把一条原始记录转成对外形状。
 *
 * 空字段不写键 —— 一堆 `place: ''` 会让调用方难以区分「没有地点」与「地点是空串」。
 *
 * @param project - 原始记录。
 * @param now - 当前时间。
 * @param mine - 本人已报名/已收藏的 id 集合。
 * @returns 对外对象。
 */
export function activityView(project, now, mine = { signedUp: new Set(), favorites: new Set() }) {
  const contact = [project.fzr, project.lxdh, project.dzyx].filter((v) => v && v !== '****').join(' ');
  const how = clean(project.jtbmfs);
  const intro = clean(project.lxsx);
  const notes = clean(project.hdzysx);
  return {
    name: String(project.mc ?? '').trim(),
    status: statusOf(project, now),
    ...(project.sfbm || mine.signedUp.has(project.id) ? { signedUp: true } : {}),
    ...(mine.favorites.has(project.id) ? { favorite: true } : {}),
    organizer: project.lxdw?.mc || project.flowStartUser || '',
    category: category(project),
    ...(project.xmlx?.mc ? { type: project.xmlx.mc } : {}),
    points: points(project),
    startTime: beijing(project.hdkssj),
    endTime: beijing(project.hdjssj),
    ...(project.hddd ? { place: project.hddd } : {}),
    signupOpens: beijing(project.bmkssj),
    signupCloses: beijing(project.bmjssj),
    signupMethod: project.bmfs?.label ?? '',
    ...(how ? { signupHow: how } : {}),
    ...(project.zmrs != null ? { quota: project.zmrs } : {}),
    ...(project.bmrs != null ? { signedCount: project.bmrs } : {}),
    ...(intro ? { intro } : {}),
    ...(notes && notes !== '无' ? { notes } : {}),
    ...(contact ? { contact } : {}),
  };
}

/** 一条记点记录（成绩单里的一行）。 */
export function recordView(record) {
  const note = clean(record.qksm);
  return {
    name: record.xm?.mc?.trim() ?? '',
    category: record.xm ? category(record.xm) : '',
    ...(record.xm?.xmlx?.mc ? { type: record.xm.xmlx.mc } : {}),
    points: record.jd ?? 0,
    ...(record.cyrshzt?.label ? { status: record.cyrshzt.label } : {}),
    ...(record.xm ? { activityTime: beijing(record.xm.hdkssj) } : {}),
    recordedAt: beijing(record.czsj),
    ...(record.sfyc ? { hiddenOnTranscript: true } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * 算「上次查看之后新出现了哪些还能报名的活动」。**不联网。**
 *
 * 报名已截止、进行中的不算新 —— 它们不会再变回能报名的。
 *
 * @param rows - 当前未结束的活动。
 * @param seen - 已读记录：`{ 活动id: 报名截止时间 }`。
 * @param now - 当前时间。
 * @returns `{ fresh, seen }`，`seen` 是读完后的新记录。
 */
export function freshActivities(rows, seen = {}, now = Date.now()) {
  const open = rows.filter((row) => {
    const status = statusOf(row, now);
    return status === '报名中' || status === '未开始报名';
  });
  // 报名截止超过 7 天的从已读记录里清掉，免得越积越多。
  const KEEP_MS = 7 * 86_400_000;
  const kept = Object.entries(seen).filter(([, closes]) => Date.parse(closes) >= now - KEEP_MS);
  return {
    fresh: open.filter((row) => !(String(row.id) in seen)),
    seen: Object.fromEntries([...kept, ...open.map((row) => [String(row.id), row.bmjssj])]),
  };
}

/**
 * 二课平台的客户端。
 *
 * 登录由调用方通过 `acquireSession()` 提供 —— 本包不知道 CAS 凭据从哪来
 * （D18 之后 CAS 流程在 `source/login`）。
 */
export class Sztz {
  /**
   * @param options.request - `(url, init) => { status, text }`，由调用方注入。
   * @param options.acquireSession - `() => Promise<void>`；走一遍 CAS 让会话生效。
   * @param options.now - 取当前时间（测试注入）。
   */
  constructor({ request, acquireSession, now = () => Date.now() }) {
    this.request = request;
    this.acquireSession = acquireSession;
    this.now = now;
    /** 登录去重：并发调用共用同一个 Promise。 */
    this.loginPromise = null;
  }

  /**
   * 发一次请求（不判断业务码）。
   *
   * @param method - `GET` / `POST`。
   * @param path - 相对 `BASE` 的路径。
   * @param params - 参数。
   * @param resend - 连接失败时是否重发。**写请求必须传 false**。
   * @returns 平台信封。
   * @throws {SztzError} HTTP 非 200、或响应不是 JSON。
   */
  async send(method, path, params = {}, resend = true) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) form.set(key, String(value));
    const query = form.toString();

    const once = async () => {
      const url = method === 'GET' ? `${BASE}/${path}${query ? `?${query}` : ''}` : `${BASE}/${path}`;
      const init = method === 'GET'
        ? { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
        : {
          method,
          body: query,
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          },
        };
      return this.request(url, init);
    };

    let response;
    try {
      response = await once();
    } catch (error) {
      // 查询（包括这里的 POST）在连接断开时可以重发；写请求靠 `resend=false` 排除。
      if (resend) response = await once();
      else throw new SztzError('NETWORK', `素质拓展平台请求失败：${error?.message ?? error}`, { path });
    }

    if (response.status !== 200) {
      throw new SztzError('HTTP', `素质拓展平台 HTTP ${response.status}`, { path, status: response.status });
    }
    let reply;
    try {
      reply = JSON.parse(response.text);
    } catch {
      throw new SztzError('SHAPE', '素质拓展平台没有返回 JSON', { path, body: String(response.text ?? '').slice(0, 120) });
    }
    if (!reply || typeof reply.code !== 'number') {
      throw new SztzError('SHAPE', '素质拓展平台的响应不是 {code, msg, data} 形状', { path });
    }
    return reply;
  }

  /** 未登录的判据：`code=-1` 且 msg 含「访问权限」。 */
  static denied(reply) {
    return reply?.code === -1 && /访问权限/.test(reply?.msg ?? '');
  }

  /** 登录（并发去重）。 */
  async signIn() {
    this.loginPromise ??= (async () => {
      if (typeof this.acquireSession !== 'function') {
        throw new SztzError('CONFIG', '素质拓展平台需要统一身份认证：还没接入登录，到「设置 → 浙大一卡通」配置后重试');
      }
      await this.acquireSession();
    })().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }

  /**
   * 业务调用：未登录时登录后重试一次；业务失败抛出平台给的原因。
   *
   * @param method - `GET` / `POST`。
   * @param path - 路径。
   * @param params - 参数。
   * @returns 平台信封。
   * @throws {SztzError} 登录后仍拒绝、或业务码非 0。
   */
  async call(method, path, params = {}) {
    let reply = await this.send(method, path, params);
    if (Sztz.denied(reply)) {
      await this.signIn();
      reply = await this.send(method, path, params);
      if (Sztz.denied(reply)) {
        throw new SztzError('AUTH_EXPIRED', '登录后素质拓展平台仍然拒绝访问，这个账号可能不是在读学生', { path });
      }
    }
    if (reply.code !== 0) {
      throw new SztzError('REJECTED', `素质拓展平台：${reply.msg ?? '请求失败'}`, { path, code: reply.code });
    }
    return reply;
  }

  /**
   * 逐页读取。
   *
   * @param params - 查询参数。
   * @param stop - `(all, page) => boolean`，返回 true 时提前停。
   * @returns `{ rows, total, complete }`。
   */
  async projectPages(params, stop = () => false) {
    const rows = [];
    for (let page = 1; ; page += 1) {
      const reply = await this.call('GET', 'student/home/getXmList', { ...params, page, limit: PAGE, finished: 'false' });
      const got = reply.data ?? [];
      rows.push(...got);
      if (!got.length || page >= (reply.totalPages ?? 1)) return { rows, total: reply.count ?? rows.length, complete: true };
      if (stop(rows, got) || page >= MAX_PAGES) return { rows, total: reply.count ?? rows.length, complete: false };
    }
  }

  /**
   * 本人的某个列表。
   *
   * @param action - 0 报名的、1 收藏的、2 已认定的。
   * @returns 原始记录。
   */
  async myList(action) {
    const rows = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const reply = await this.call('POST', 'student/home/getWdhdList', { action, page, limit: PAGE });
      rows.push(...(reply.data ?? []));
      if (page >= (reply.totalPages ?? 1)) break;
    }
    return rows;
  }

  /** 本人已报名 + 已收藏的 id 集合。 */
  async mineOf() {
    const [signedUp, favorites] = await Promise.all([this.myList(0), this.myList(1)]);
    return {
      signedUp: new Set(signedUp.map((row) => row.id)),
      favorites: new Set(favorites.map((row) => row.id)),
    };
  }

  /**
   * 还没结束的活动（原始记录）。
   *
   * @returns 原始记录。
   */
  async unfinished() {
    const now = this.now();
    const floor = now - BACK_DAYS * 86_400_000;
    const { rows } = await this.projectPages({ keyword: '', lx: 2 }, (_all, page) => Date.parse(page.at(-1).hdkssj) < floor);
    return unfinishedOnly(rows, now);
  }

  /* ────────────────────────── 只读接口 ── */

  /**
   * 活动中心。
   *
   * 默认只给还没结束的（报名中、未开始报名、报名已截止、进行中），按
   * 报名截止早的在前排列。
   *
   * @param options.keyword - 关键词。
   * @param options.date - `YYYY-MM-DD`。
   * @param options.includeEnded - 是否包含已结束。
   * @param options.limit - 条数，默认 30。
   * @returns 活动列表与统计。
   */
  async listActivities({ keyword = '', date, includeEnded = false, limit = 30 } = {}) {
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))) {
      throw new SztzError('CONFIG', '日期应为 YYYY-MM-DD');
    }
    const now = this.now();
    const floor = now - BACK_DAYS * 86_400_000;
    const params = { keyword, ...(date ? { date } : {}), lx: 2 };
    const stop = (all, page) => (date ? false
      : includeEnded ? all.length >= limit : Date.parse(page.at(-1).hdkssj) < floor);

    // 先读本人的两个列表：它们是个人接口，没登录时会在这里登录，
    // 后面的活动列表就带负责人信息了。
    const mine = await this.mineOf();
    let read = await this.projectPages(params, stop);
    // 匿名读到的列表负责人是 `****`：登录后重取一次。
    if (read.rows.some((row) => row.fzr === '****')) {
      await this.signIn();
      read = await this.projectPages(params, stop);
    }

    const order = (project) => STATUSES.indexOf(statusOf(project, now));
    const when = (project) => {
      const status = statusOf(project, now);
      if (status === '报名中') return Date.parse(project.bmjssj);
      if (status === '未开始报名') return Date.parse(project.bmkssj);
      if (status === '已结束') return -Date.parse(project.hdkssj);
      return Date.parse(project.hdkssj);
    };
    const matched = read.rows
      .filter((project) => includeEnded || statusOf(project, now) !== '已结束')
      .sort((a, b) => order(a) - order(b) || when(a) - when(b));
    const byStatus = Object.fromEntries(STATUSES
      .map((status) => [status, matched.filter((project) => statusOf(project, now) === status).length])
      .filter(([, count]) => count));

    return {
      activities: matched.slice(0, limit).map((project) => activityView(project, now, mine)),
      count: Math.min(matched.length, limit),
      matched: matched.length,
      byStatus,
      hasMore: matched.length > limit || (Boolean(includeEnded) && !read.complete),
      currentTime: beijing(new Date(now).toISOString()),
      note: '按报名中（截止早的在前）、未开始报名、报名已截止、进行中排列；points 是参加可得的记点范围。'
        + 'signupMethod 为「不在本平台报名」的按 signupHow 或联系人报名；'
        + 'signedUp、favorite 是本人已报名、已收藏。'
        + (includeEnded ? '' : '已结束的活动没有列出。'),
    };
  }

  /**
   * 项目库：可以申请认定记点的项目（学科竞赛、社会实践等）。
   *
   * @param options.keyword - 关键词。
   * @param options.category - 分类过滤。
   * @returns 项目列表。
   */
  async listProjects({ keyword = '', category: wanted = '' } = {}) {
    const { rows } = await this.projectPages({ keyword, nj: '', lx: 1 }, () => false);
    const filter = String(wanted ?? '').trim();
    const matched = rows.filter((project) => !filter
      || [category(project), project.xmlx?.mc ?? ''].some((value) => value.includes(filter)));
    return {
      projects: matched.map((project) => {
        const intro = clean(project.lxsx);
        const notes = clean(project.hdzysx);
        return {
          name: String(project.mc ?? '').trim(),
          category: category(project),
          ...(project.xmlx?.mc ? { type: project.xmlx.mc } : {}),
          points: points(project),
          ...(project.ksqnj ? { grades: project.ksqnj } : {}),
          ...(project.bmrs != null ? { applicants: project.bmrs } : {}),
          ...(intro ? { intro } : {}),
          ...(notes && notes !== '无' ? { notes } : {}),
        };
      }),
      count: matched.length,
      note: '这些是自己提交材料申请认定的项目，不是报名参加的活动；'
        + 'points 是认定后可得的记点范围，grades 是可以申请的年级。申请在平台网页上办理。',
    };
  }

  /**
   * 上次查看之后新出现的、还能报名的活动。
   *
   * 只读活动列表，不读本人的报名与收藏 —— 所以**不需要登录**统一身份认证。
   *
   * @param options.seen - 已有的已读记录。
   * @returns `{ activities, count, seen, lastChecked? }`。
   */
  async newActivities({ seen = {} } = {}) {
    const now = this.now();
    const { fresh, seen: updated } = freshActivities(await this.unfinished(), seen, now);
    return {
      activities: fresh
        .sort((a, b) => Date.parse(a.bmjssj) - Date.parse(b.bmjssj))
        .map((project) => ({
          id: project.id,
          name: String(project.mc ?? '').trim(),
          status: statusOf(project, now),
          organizer: project.lxdw?.mc || project.flowStartUser || '',
          category: category(project),
          points: points(project),
          startTime: beijing(project.hdkssj),
          endTime: beijing(project.hdjssj),
          ...(project.hddd ? { place: project.hddd } : {}),
          signupOpens: beijing(project.bmkssj),
          signupCloses: beijing(project.bmjssj),
          signupMethod: project.bmfs?.label ?? '',
          url: `${BASE}/#/index/hdzx?xmmc=${encodeURIComponent(String(project.mc ?? '').trim())}&xmId=${project.id}`,
        })),
      count: fresh.length,
      seen: updated,
      note: '报名截止早的在前；只有概要，要看简介、注意事项和联系人用 listActivities 带 keyword。',
    };
  }

  /**
   * 本人二、三、四课堂的记点与学分，和成绩单里的每一条记录。
   *
   * @returns `{ summary, records, count, note }`。
   */
  async myCredits() {
    const reply = await this.call('GET', 'student/home/getMyInfo');
    const info = reply.extend?.myInfo ?? {};
    const records = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const chunk = await this.call('POST', 'student/home/getZdySqjl', { pageIndex: page, pageSize: 100 });
      records.push(...(chunk.data ?? []));
      if (page >= (chunk.totalPages ?? 1)) break;
    }
    const row = (pts, credits, level, passed) => ({
      points: pts ?? 0, credits: credits ?? 0, level: level ?? '', passed: Boolean(passed),
    });
    return {
      summary: {
        second: row(info.dektJf, info.dektXf, info.dektDj, info.dektTg),
        third: row(info.dsktJf, info.dsktXf, info.dsktDj, info.dsktTg),
        fourth: row(info.dsiktJf, info.dsiktXf, info.dsiktDj, info.dsiktTg),
        aestheticPassed: Boolean(info.myTg),
        laborPassed: Boolean(info.lyTg),
      },
      records: records.map(recordView),
      count: records.length,
      note: 'summary 里 second、third、fourth 是第二、三、四课堂：points 是累计记点，'
        + 'credits 是折算出的学分，level 是等级，passed 是平台判定是否达标；'
        + 'aestheticPassed、laborPassed 是美育、劳育是否达标。'
        + '达标要求以培养方案和平台为准，这里只转述平台给出的结果。',
    };
  }

  /**
   * 本人报名的、收藏的和已认定的活动。
   *
   * @returns `{ signedUp, favorites, recognized, counts, note }`。
   */
  async myActivities() {
    const now = this.now();
    const lists = [await this.myList(0), await this.myList(1), await this.myList(2)];
    const mine = {
      signedUp: new Set(lists[0].map((row) => row.id)),
      favorites: new Set(lists[1].map((row) => row.id)),
    };
    const view = (rows) => rows.map((project) => activityView(project, now, mine));
    const signedUp = view(lists[0]);
    const favorites = view(lists[1]);
    const recognized = view(lists[2]);
    return {
      signedUp,
      favorites,
      recognized,
      counts: { signedUp: signedUp.length, favorites: favorites.length, recognized: recognized.length },
      note: 'signedUp 是在平台上报了名的，favorites 是收藏的，recognized 是已经认定记点的；'
        + '不在平台报名的活动不会出现在 signedUp 里。',
    };
  }

  /**
   * 平台通知：审核时间、记点申请流程等。
   *
   * @returns `{ notices, count }`。
   */
  async listBulletins() {
    const reply = await this.call('GET', 'student/tzgg/ajaxList', { pageIndex: 1, pageSize: 100, mc: '' });
    return {
      notices: (reply.data ?? []).map((bulletin) => {
        const names = String(bulletin.fjmc ?? '').split(',').map((name) => name.trim()).filter(Boolean);
        const ids = String(bulletin.fjid ?? '').split(',').map((id) => id.trim()).filter(Boolean);
        return {
          title: String(bulletin.mc ?? '').trim(),
          date: beijing(bulletin.fbsj),
          text: clean(bulletin.nr),
          ...(ids.length
            ? { attachments: ids.map((id, index) => ({ text: names[index] ?? '附件', url: `${BASE}/common/file/download?id=${id}` })) }
            : {}),
        };
      }),
      count: reply.data?.length ?? 0,
    };
  }
}
