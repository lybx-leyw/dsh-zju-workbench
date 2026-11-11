/**
 * 拼题A：**题集**读取器。
 *
 * # 这份文件从哪来
 *
 * 逐字搬自 `@lybx-leyw/dsh-zju-source-campus` 的 `src/pta.js`（拆包，不是重写）。
 * 唯一的改动是：站点常量改由本包的 `hosts.js` 提供（内容相同），以及文件末尾
 * 多了 `normalizePta` / `translatePtaError` 两个纯函数（原先在 campus 的
 * `src/index.js` 里，它们只服务拼题A，所以跟着搬过来）。
 *
 * 实现口径来自本仓的 Flutter 版（`zhiyun-pro` 的 `pta_data_source.dart`），
 * 那里已经把接口行为摸清了。要点：
 *
 * # 端点与参数
 *
 * ```text
 * GET https://pintia.cn/api/problem-sets
 *     ?limit=100&order_by=END_AT&asc=true
 *     &filter={"endAtAfter":"<昨天 UTC 零点>"}
 *     Referer: https://pintia.cn/problem-sets/dashboard
 * ```
 *
 * # 三处必须照抄的细节
 *
 * 1. **404 = Cookie 失效**，回包是 `{"error":{"code":"USER_NOT_FOUND"}}`。
 *    PTA 用 404 表示"用户不存在"，也就是身份已失效 —— 不是"题集不存在"。
 *    报错时必须说"Cookie 已失效"，不能让用户以为是没配。
 * 2. **`filter` 只编码一次**。让 URL 构造器做 percent-encoding；
 *    手工 `encodeURIComponent` 之后再塞进查询串会变成双重编码，PTA 直接回 **400**
 *    （实测：单编码 200 / 双编码 400）。
 * 3. **服务端排序不保证**（实测返回里混着已截止的），所以本地再按 `endAt` 排一次。
 *    本地排序才是最终口径。
 *
 * # 没有 N+1
 *
 * 不逐题集补 `/exams`。那个端点只为了拿 `score` / `status` 这类考试详情，
 * 列表页不需要 —— 而它是 omni 那条链路上最慢的一段（12 个题集 13 个请求）。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';
import { PTA_BASE } from './hosts.js';

/** 列表单页上限（与 Flutter 版一致）。 */
export const PTA_PAGE_LIMIT = 100;

/** 服务端排序字段。 */
export const PTA_ORDER_BY = 'END_AT';

/**
 * 拼题A 的题型枚举与中文标签。
 *
 * 顺序照抄上游：`problems()` 在不指定题型时按这个顺序挑第一个可用的，
 * 编程题优先 —— 那是最常见的一类。
 */
export const PTA_PROBLEM_TYPES = [
  'PROGRAMMING',
  'CODE_COMPLETION',
  'MULTIPLE_FILE',
  'TRUE_OR_FALSE',
  'MULTIPLE_CHOICE',
  'MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER',
  'FILL_IN_THE_BLANK',
  'FILL_IN_THE_BLANK_FOR_PROGRAMMING',
  'SUBJECTIVE',
];

export const PTA_TYPE_LABELS = {
  PROGRAMMING: '编程题',
  CODE_COMPLETION: '函数题',
  MULTIPLE_FILE: '多文件编程',
  TRUE_OR_FALSE: '判断题',
  MULTIPLE_CHOICE: '单选题',
  MULTIPLE_CHOICE_MORE_THAN_ONE_ANSWER: '多选题',
  FILL_IN_THE_BLANK: '填空题',
  FILL_IN_THE_BLANK_FOR_PROGRAMMING: '程序填空题',
  SUBJECTIVE: '主观题',
};

/**
 * 校验并归一 id。
 *
 * PTA 的 id 是纯数字串。放任何其它字符进去都会被服务端当成另一条路径 ——
 * 提前拦住比让它打出去更安全（也避免把 `../` 之类混进 URL）。
 *
 * @param value - 原始值。
 * @param label - 出错时告诉用户这是哪个字段。
 * @returns 归一后的数字串。
 */
export function ptaId(value, label = 'ID') {
  const text = String(value ?? '').trim();
  if (!/^[0-9]{1,24}$/.test(text)) {
    throw new ClassroomError('INVALID_ID', `拼题A ${label} 应为数字串（取自题集或题目网址）`);
  }
  return text;
}

/** Referer 必须是 dashboard，否则可能被拒。 */
const PTA_REFERER = `${PTA_BASE}/problem-sets/dashboard`;

/** 浏览器 UA。PTA 对非浏览器 UA 有时会给出不同的回包。 */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * 昨天 UTC 零点。
 *
 * 用"昨天"而不是"现在"，是为了兜住服务端过滤口径的边界差异 ——
 * 昨天截止但还没到今天的条目也要能拿到，本地再按 `endAt > now` 筛。
 *
 * @param now - 当前时间。
 * @returns ISO 串。
 */
export function yesterdayUtcMidnight(now = new Date()) {
  const at = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0,
  );
  return new Date(at).toISOString();
}

/**
 * 拼题A 用 **Unix 纪元**表示"没有截止时间"。直接显示会变成"1970 年过期"。
 *
 * @param value - 原始时间串。
 * @returns `{ iso, text }`；无截止时间时 `iso` 为 null。
 */
export function normalizeDeadline(value) {
  if (value == null || value === '') return { iso: null, text: null };
  const raw = String(value);
  if (/^1970-01-01T/.test(raw)) return { iso: null, text: null };
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return { iso: null, text: raw };
  return { iso: new Date(at).toISOString(), text: raw };
}

/**
 * 把时间字段归成 `{ iso, text }`，**并认数字时间戳**。
 *
 * `normalizeDeadline` 只认能被 `Date.parse` 解成字符串的时间；提交记录的
 * `submitAt` 是**毫秒时间戳**（数字或数字串），`Date.parse('1762345678000')`
 * 是 `NaN` —— 直接复用会让每一条提交都显示「时间未知」。
 *
 * @param value - 原始值（ISO 串、毫秒时间戳、秒级时间戳的字符串）。
 * @returns `{ iso, text }`；认不出时 `iso` 为 null 并保留原文。
 */
export function normalizeTimestamp(value) {
  if (value == null || value === '') return { iso: null, text: null };
  const numeric = typeof value === 'number' ? value : (/^\d{10,}$/.test(String(value).trim()) ? Number(value) : null);
  if (numeric === null) return normalizeDeadline(value);
  // 秒级与毫秒级都有人用：小于 1e12 的当作秒。这条判据在 2286 年前都成立。
  const at = numeric < 1e12 ? numeric * 1000 : numeric;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return { iso: null, text: String(value) };
  return { iso: date.toISOString(), text: String(value) };
}

/**
 * 判一条题集是不是"还要做的事"。
 *
 * @param row - 原始题集。
 * @param now - 当前时间。
 * @param includeEnded - 是否保留已截止的。
 * @returns 要不要留下。
 */
export function isPendingProblemSet(row, now = new Date(), includeEnded = false) {
  if (!row || typeof row !== 'object') return false;
  const endAt = normalizeDeadline(row.endAt);
  // 没有 DDL 的**保留**：PTA 上那种是长期开放的练习集，不是"过期了"
  if (endAt.iso == null) return true;
  if (includeEnded) return true;
  return Date.parse(endAt.iso) > now.getTime();
}

/**
 * 拼题A 客户端。
 *
 * Cookie 是**整串**认证（不是单个 cookie 名），由调用方装进 transport。
 */
export class PtaApi {
  /**
   * @param transport - 带 Cookie 的 Transport。
   */
  constructor(transport) {
    if (typeof transport?.request !== 'function') {
      throw new ClassroomError('CONFIG', '拼题A 客户端需要一个 Transport');
    }
    this.transport = transport;
  }

  /**
   * 发一次 GET 并解出 JSON —— 错误分类**只有这一处**。
   *
   * 抽出来是因为看题、题目列表、做题进度、题集详情的失败语义与题集列表
   * 完全一样（404=Cookie 失效、400=双重编码、200 里包业务错误……）。
   * 早先每个方法各写一遍，改一条就要改四处，迟早漂移。
   *
   * @param path - 以 `/api/` 开头的路径。
   * @param options.query - 查询参数（由 URLSearchParams 编码一次）。
   * @param options.referer - 覆盖 Referer（看题页与 dashboard 不同）。
   * @param options.signal - 中止信号。
   * @returns 解析后的 JSON 对象。
   */
  /**
   * 发一次请求并做统一的失败分类。**读写共用**。
   *
   * # 为什么把错误分类抽在这里
   *
   * 拼题A 的错误信号散在四处：HTTP 状态码、404 的特殊含义（用户不存在）、
   * 403 的两种原因、以及**包在 200 里**的业务错误。写操作与读操作遇到的
   * 失败是同一批，所以分类只写一份 —— 复制到 `writes.js` 里必然漂移。
   *
   * # 写操作额外看什么
   *
   * `submit: true` 时多判一件事：**业务错误里的 `PLATFORM_REJECTED`**。
   * 答题提交被拒（答案格式不对、题目类型不符）是**业务失败**，不是网络问题，
   * 那种情况重试没有意义，要让调用方看到平台的原话。
   *
   * @param path - 只允许 `/api/` 接口路径。
   * @param options.method - HTTP 方法（默认 GET）。
   * @param options.body - 请求体（对象会被 JSON 序列化）。
   * @param options.query - 查询串。
   * @param options.referer - Referer。
   * @param options.signal - 取消信号。
   * @returns 解析后的响应体。
   */
  async send(path, { method = 'GET', body, query = null, referer = PTA_REFERER, signal } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/api/') || path.includes('..')) {
      throw new ClassroomError('INVALID_PATH', '只允许拼题A 的 /api/ 接口路径');
    }
    const target = `${PTA_BASE}${path}${query ? `?${new URLSearchParams(query).toString()}` : ''}`;
    const result = await this.transport.request(target, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        Accept: 'application/json;charset=UTF-8',
        'Accept-Language': 'zh-CN',
        Referer: referer,
        'User-Agent': USER_AGENT,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json;charset=UTF-8' }),
      },
      signal,
    });

    // 404 是"用户不存在" = Cookie 失效，不是"没有题集"
    if (result.status === 404) {
      throw new ClassroomError('COOKIE_EXPIRED', '拼题A 返回 404（USER_NOT_FOUND）——Cookie 已失效，请重新登录 pintia.cn 并粘贴一份新的');
    }
    if (result.status === 401 || (result.status >= 300 && result.status < 400)) {
      throw new ClassroomError('COOKIE_EXPIRED', '拼题A 登录已失效，请重新粘贴 Cookie', { status: result.status });
    }
    if (result.status === 400) {
      // 400 在写请求上通常是答案格式不对；在读请求上多半是查询串编码问题。
      throw new ClassroomError('BAD_REQUEST', '拼题A 返回 400：请求格式不被接受（读请求多半是查询串编码，写请求多半是答案格式）', { status: 400 });
    }
    if (result.status === 403) {
      // 403 有两种完全不同的原因，别让用户猜：
      //   - **Cookie 失效 / 未登录**：拼题A 对匿名请求也可能回 403（而不是 401）；
      //   - **真的无权**：该题集未开放、未开始，或当前账号没被加入。
      // 判据：这一次请求有没有带上 Cookie。没带 → 先让他去配；带了还被拒 → 是权限。
      const hasCookie = await (async () => {
        try {
          return (await this.transport.session.jar.getCookies(`${PTA_BASE}/`)).length > 0;
        } catch {
          return false;
        }
      })();
      if (!hasCookie) {
        throw new ClassroomError('COOKIE_EXPIRED',
          '拼题A 拒绝访问（403），且这次请求没有带上 Cookie —— 请先登录 pintia.cn 并粘贴一份 Cookie', { status: 403 });
      }
      throw new ClassroomError('FORBIDDEN',
        '拼题A 拒绝访问（403）。Cookie 已带上，所以多半是权限问题：'
        + '该题集可能未开放 / 未开始，或这个账号没被加入。换一道题集或问问老师。', { status: 403 });
    }
    if (result.status === 429) {
      throw new ClassroomError('RATE_LIMITED', '拼题A 请求过于频繁，请稍后再试', { status: 429 });
    }
    if (result.status >= 400) {
      throw new ClassroomError('HTTP', `拼题A 返回 HTTP ${result.status}`, { status: result.status });
    }

    // 有些写接口成功时不返回 JSON（204 / 空体）。那不是错误。
    if (result.status === 204 || result.text === '' || result.text === 'null') return null;

    let data;
    try {
      data = JSON.parse(result.text);
    } catch {
      if (/^\s*</.test(result.text)) {
        throw new ClassroomError('COOKIE_EXPIRED', '拼题A 返回了网页而不是 JSON，登录态可能已失效');
      }
      // 写接口可能回纯文本（如 `"ok"`）。
      if (method !== 'GET') return { raw: result.text };
      throw new ClassroomError('API_SHAPE', '拼题A 返回的 JSON 无法解析');
    }
    if (data === null) return null;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      // 写接口可能回一个数组或标量；读接口只认对象。
      if (method !== 'GET') return { raw: data };
      throw new ClassroomError('API_SHAPE', '拼题A 返回的不是对象');
    }
    // 业务错误包在 200 里
    if (data.error && typeof data.error === 'object') {
      const code = String(data.error.code ?? '');
      if (/USER_NOT_FOUND|UNAUTHORIZED|LOGIN|SESSION/i.test(code)) {
        throw new ClassroomError('COOKIE_EXPIRED', '拼题A Cookie 已失效，请重新登录后粘贴');
      }
      throw new ClassroomError('PLATFORM_REJECTED', `拼题A 拒绝请求：${data.error.message ?? code}`, { code });
    }
    return data;
  }

  /**
   * 读一个拼题A 接口。
   *
   * 薄薄一层 —— 错误分类在 `send` 里，读写共用。
   *
   * @param path - 接口路径。
   * @param options - 同 `send`。
   * @returns 解析后的响应体。
   */
  async get(path, options = {}) {
    return this.send(path, { ...options, method: 'GET' });
  }

  /**
   * 拉题集列表。
   *
   * @param options.includeEnded - 是否保留已截止的（默认否）。
   * @param options.limit - 单页上限。
   * @param options.now - 注入当前时间（测试用）。
   * @param options.signal - 中止信号。
   * @returns `{ problemSets, total }`。
   */
  async problemSets({ includeEnded = false, limit = PTA_PAGE_LIMIT, now = () => new Date(), signal } = {}) {
    // ⚠️ 用 URLSearchParams 让 URL 自己编码一次。手工 encodeComponent 会双重编码 → 400。
    const query = {
      limit: String(limit),
      order_by: PTA_ORDER_BY,
      asc: 'true',
    };
    if (!includeEnded) {
      query.filter = JSON.stringify({ endAtAfter: yesterdayUtcMidnight(now()) });
    }

    const data = await this.get('/api/problem-sets', { query, signal });

    const rows = data.problemSets;
    if (!Array.isArray(rows)) {
      // 契约变了要如实说 —— 当成"没有题集"会让用户以为自己没作业
      throw new ClassroomError('API_SHAPE', '拼题A 题集列表缺少 problemSets');
    }

    const at = now();
    const problemSets = rows
      .filter((row) => isPendingProblemSet(row, at, includeEnded))
      .map((row) => {
        const endsAt = normalizeDeadline(row.endAt);
        return {
          id: row?.id == null ? '' : String(row.id),
          name: String(row?.name ?? '').trim() || '(无标题)',
          organization: row?.organizationName ? String(row.organizationName) : null,
          status: row?.status ? String(row.status) : null,
          startsAt: normalizeDeadline(row.startAt),
          endsAt,
          // 由 ends_at 推出来，不额外请求
          ended: endsAt.iso == null ? null : Date.parse(endsAt.iso) <= at.getTime(),
          url: row?.id == null ? null : `${PTA_BASE}/problem-sets/${row.id}/exam/problems`,
        };
      })
      // 服务端排序不保证，本地再排一次（无 DDL 的排最后）
      .sort((a, b) => {
        const av = a.endsAt.iso ? Date.parse(a.endsAt.iso) : Infinity;
        const bv = b.endsAt.iso ? Date.parse(b.endsAt.iso) : Infinity;
        return av - bv;
      });

    return { problemSets, total: rows.length };
  }

  /* ──────────────────────────────── 看题 ──────────────────────────────── */

  /**
   * 题集详情：题型分布、我的进度、描述。
   *
   * **一次请求拿到"这题集里有哪些题型、各多少题"** —— `problem-summaries`
   * 按题型聚合，比逐题型翻页问一遍便宜得多。
   *
   * @param problemSetId - 题集 id。
   * @param options.signal - 中止信号。
   * @returns `{ id, name, description, problemTypes, progress }`。
   */
  /**
   * 题集的**答题实例**（对应上游 `query.ts:13` 的 `getExam`）。
   *
   * # 为什么需要它
   *
   * 「保存 / 提交答案」都要求先有一个 `exam`（答题实例）：提交接口的路径是
   * `/api/exams/{exam.id}/exam-submissions`。没有实例 = 用户还没在网页上点
   * 「开始作业」，写操作必须停。
   *
   * `serverTime` 也在这里拿 —— 判「是否超过截止时间」要用**服务端**的时间，
   * 用本机时钟会在时区或时间漂移时判错。
   *
   * @param problemSetId - 题集 id。
   * @param options.signal - 中止信号。
   * @returns `{ problemSet, exam, serverTime, status }`；`exam` 可能是 `null`。
   */
  async getExam(problemSetId, { signal } = {}) {
    const id = ptaId(problemSetId, '题集 ID');
    const data = await this.get(`/api/problem-sets/${id}/exams`, { signal });
    // 形状校验照上游：`problemSet.id` 必须回指同一题集，否则说明响应串了。
    const returnedId = data?.problemSet?.id == null ? null : String(data.problemSet.id);
    if (returnedId !== null && returnedId !== id) {
      throw new ClassroomError('API_SHAPE', `题集响应与目标不符：要 ${id}，回来的是 ${returnedId}`);
    }
    return {
      problemSet: data?.problemSet ?? { id },
      exam: data?.exam ?? null,
      serverTime: data?.serverTime ?? null,
      status: data?.status ?? null,
    };
  }

  async problemSet(problemSetId, { signal } = {}) {    const id = ptaId(problemSetId, '题集 ID');
    const detail = await this.get(`/api/problem-sets/${id}/exam-problems`, { signal }).catch(() => null);
    const summaries = await this.get(`/api/problem-sets/${id}/problem-summaries`, { signal });

    const bucket = summaries?.summaries;
    const problemTypes = bucket && typeof bucket === 'object' && !Array.isArray(bucket)
      ? Object.entries(bucket).map(([type, value]) => ({
        type,
        label: PTA_TYPE_LABELS[type] ?? type,
        total: value?.total ?? null,
        totalScore: value?.totalScore ?? null,
      }))
      : [];

    // 进度要 Cookie；拿不到不算失败（题集仍可读）
    let progress = null;
    try {
      progress = await this.progress(id, { signal });
    } catch {
      progress = null;
    }

    // 答题实例：写操作要它，读侧也用得上（页面要显示「还没开始 / 进行中」）。
    // 拿不到不算失败 —— 没开始的题集本来就没有实例，题集详情仍然可读。
    let examInfo = null;
    try {
      examInfo = await this.getExam(id, { signal });
    } catch {
      examInfo = null;
    }

    return {
      id,
      name: String(detail?.problemSet?.name ?? '').trim() || null,
      description: String(detail?.problemSet?.description ?? '').trim() || null,
      problemTypes,
      progress,
      /**
       * 答题实例（`null` 表示还没开始）。
       *
       * ⚠️ 这个字段是**后补的**：先前 `problemSet()` 只返回前四个字段，
       * 而 `writes.js` 的 `examOf()` 从这里读 `exam` —— 于是写操作
       * 「无条件报『题集还没开始作答』」，与用户是否真的开始过无关。
       * 那是死链，靠补这个字段修好。
       */
      exam: examInfo?.exam ?? null,
      /** 服务端时间（判截止用）。没有时写操作回落到本机时钟。 */
      serverTime: examInfo?.serverTime ?? null,
      /** 题集作答状态（`start` 之前是 `null`）。 */
      examStatus: examInfo?.status ?? null,
    };
  }

  /**
   * 题集里某个题型的题目列表（分页），**带上我的提交状态**。
   *
   * 提交状态来自另一个端点（`exam-problem-status`），它允许匿名读题但
   * 认不出"我做没做" —— 所以拿不到时 `myStatus` 为 null，而不是当成"没做"。
   *
   * @param problemSetId - 题集 id。
   * @param options.problemType - 题型；省略时按 summaries 里第一个可用题型。
   * @param options.page - 页码（从 1 开始）。
   * @param options.limit - 单页条数。
   * @param options.signal - 中止信号。
   * @returns `{ problems, typeLabel, total, nextPage }`。
   */
  async problems(problemSetId, { problemType = null, page = 1, limit = 50, signal } = {}) {
    const id = ptaId(problemSetId, '题集 ID');
    let type = problemType;
    if (!type) {
      const summaries = await this.get(`/api/problem-sets/${id}/problem-summaries`, { signal });
      const available = Object.keys(summaries?.summaries ?? {});
      type = ['PROGRAMMING', 'CODE_COMPLETION', ...available].find((t) => available.includes(t)) ?? null;
      if (!type) return { problemSetId: id, problemType: null, typeLabel: null, total: null, problems: [], nextPage: null };
    }

    const data = await this.get(`/api/problem-sets/${id}/exam-problem-list`, {
      query: { problem_type: type, page: page - 1, limit },
      signal,
    });
    if (!Array.isArray(data.problemSetProblems)) {
      throw new ClassroomError('API_SHAPE', '拼题A 题目列表缺少 problemSetProblems');
    }

    let statuses = new Map();
    try {
      const status = await this.get(`/api/problem-sets/${id}/exam-problem-status`, { signal });
      if (Array.isArray(status.problemStatus)) {
        statuses = new Map(status.problemStatus.map((row) => [String(row.id), String(row.problemSubmissionStatus ?? '')]));
      }
    } catch {
      // 匿名可读题集拿不到状态：留空，不当成"未做"
    }

    const problems = data.problemSetProblems.map((row) => ({
      id: String(row.id),
      label: row.label ? String(row.label) : null,
      title: String(row.title ?? '').trim(),
      score: row.score ?? null,
      deadline: normalizeDeadline(row.deadline),
      acceptCount: row.acceptCount ?? null,
      submitCount: row.submitCount ?? null,
      myStatus: statuses.get(String(row.id)) || null,
    }));

    const total = Number(data.total);
    const more = Number.isFinite(total) ? page * limit < total : problems.length >= limit;
    return {
      problemSetId: id,
      problemType: type,
      typeLabel: PTA_TYPE_LABELS[type] ?? type,
      total: Number.isFinite(total) ? total : null,
      problems,
      nextPage: more ? page + 1 : null,
    };
  }

  /**
   * 题目详情：**完整题面**（原始 Markdown，含 LaTeX）。
   *
   * 题面可能很长，所以支持 `offset` / `maxCharacters` 分页读取 ——
   * 一次全塞给调用方既费内存也容易撑爆上下文。
   *
   * ⚠️ 只读：不提交代码、不创建提交记录。
   *
   * @param problemSetId - 题集 id。
   * @param problemId - 题目 id。
   * @param options.offset - 从第几个字符开始。
   * @param options.maxCharacters - 本次最多返回多少字符。
   * @param options.signal - 中止信号。
   * @returns 题目详情与 `nextOffset`。
   */
  async problem(problemSetId, problemId, { offset = 0, maxCharacters = 16000, signal } = {}) {
    const id = ptaId(problemSetId, '题集 ID');
    const pid = ptaId(problemId, '题目 ID');
    const data = await this.get(`/api/problem-sets/${id}/exam-problems/${pid}`, {
      referer: `${PTA_BASE}/problem-sets/${id}/exam/overview`,
      signal,
    });
    const row = data.problemSetProblem;
    if (!row || typeof row !== 'object') {
      throw new ClassroomError('API_SHAPE', '拼题A 题目详情缺少 problemSetProblem');
    }

    const config = row.problemConfig?.programmingProblemConfig
      ?? row.problemConfig?.codeCompletionProblemConfig
      ?? row.problemConfig?.multipleFileProblemConfig
      ?? null;
    const content = String(row.content ?? '');
    const type = String(row.type ?? '');

    return {
      problemSetId: id,
      id: pid,
      label: row.label ? String(row.label) : null,
      title: String(row.title ?? '').trim(),
      type: type || null,
      typeLabel: PTA_TYPE_LABELS[type] ?? null,
      score: row.score ?? null,
      author: row.author ? String(row.author) : null,
      organization: data.organization?.name ? String(data.organization.name) : null,
      timeLimitMs: config?.timeLimit ?? null,
      memoryLimitKb: config?.memoryLimit ?? null,
      codeSizeLimitKb: config?.codeSizeLimit ?? null,
      compiler: row.compiler ? String(row.compiler) : null,
      deadline: normalizeDeadline(row.deadline),
      content: content.slice(offset, offset + maxCharacters),
      nextOffset: offset + maxCharacters < content.length ? offset + maxCharacters : null,
      totalCharacters: content.length,
      url: this.problemUrl(id, pid, type),
    };
  }

  /**
   * 我的做题进度：总数、通过数、按状态分布。
   *
   * @param problemSetId - 题集 id。
   * @param options.signal - 中止信号。
   * @returns `{ total, accepted, byStatus }`，没有数据时 null。
   */
  async progress(problemSetId, { signal } = {}) {
    const id = ptaId(problemSetId, '题集 ID');
    const data = await this.get(`/api/problem-sets/${id}/exam-problem-status`, { signal });
    if (!Array.isArray(data.problemStatus)) return null;
    const byStatus = {};
    for (const row of data.problemStatus) {
      const key = String(row.problemSubmissionStatus ?? '') || 'UNKNOWN';
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }
    return {
      total: data.problemStatus.length,
      accepted: byStatus.PROBLEM_ACCEPTED ?? 0,
      byStatus,
    };
  }

  /**
   * 我对这份题集的**提交记录**（对应上游 `pta submission list`，审计 W-9）。
   *
   * # 为什么它是纯读
   *
   * `GET /api/exams/{examId}/problem-sets/{setId}/submissions` —— 只查自己交过
   * 什么、判到哪一步。上游把它和保存/提交放在同一个 CLI 组里，审计据此判成
   * 「写链路的一部分」并整条丢掉；那是**归类错误**，不是能力缺失。
   *
   * # 没有答题实例时不是错误
   *
   * 还没在网页上点「开始作业」就没有 `exam`，也就没有任何提交。这时按空表返回
   * 并带 `examStarted: false`，让调用方说「还没开始」，而不是抛一个看起来像
   * 权限问题的错。
   *
   * @param problemSetId - 题集 id。
   * @param options.before - 从这个提交 id 往前翻（分页游标）。
   * @param options.limit - 单页条数（默认 30，与上游一致）。
   * @param options.problemId - 只看某道小题的提交。
   * @param options.signal - 中止信号。
   * @returns `{ examStarted, submissions, page }`。
   */
  async submissions(problemSetId, { before, limit = 30, problemId, signal } = {}) {
    const id = ptaId(problemSetId, '题集 ID');
    if (!Number.isInteger(limit) || limit < 1) {
      throw new ClassroomError('INVALID_INPUT', 'limit 要是正整数');
    }
    const info = await this.getExam(id, { signal });
    if (!info.exam) return { examStarted: false, submissions: [], page: { before: null, limit, nextBefore: null } };

    const filter = { userId: info.exam.userId };
    if (problemId !== undefined) filter.problemSetProblemId = ptaId(problemId, '题目 ID');
    const data = await this.get(`/api/exams/${ptaId(info.exam.id, '答题实例 ID')}/problem-sets/${id}/submissions`, {
      query: {
        ...(before !== undefined ? { before: ptaId(before, '提交记录 ID') } : {}),
        limit: String(limit),
        // `filter` 只能编码一次 —— 手工 encodeURIComponent 会双重编码，PTA 直接 400
        // （与题集列表的 `filter` 同一条实测结论）。
        filter: JSON.stringify(filter),
      },
      signal,
    });

    const rows = Array.isArray(data?.submissions) ? data.submissions : [];
    if (!Array.isArray(data?.submissions)) {
      // 「没有提交过」是空数组，不是缺字段。缺字段说明契约变了，要如实报。
      throw new ClassroomError('API_SHAPE', '拼题A 提交记录响应缺少 submissions');
    }
    return {
      examStarted: true,
      submissions: rows.map((row) => ({
        id: row?.id == null ? '' : String(row.id),
        problemSetProblemId: row?.problemSetProblemId == null ? null : String(row.problemSetProblemId),
        problemType: row?.problemType ? String(row.problemType) : null,
        status: row?.status ? String(row.status) : null,
        submittedAt: normalizeTimestamp(row?.submitAt ?? row?.createdAt),
        score: row?.score ?? null,
      })),
      // 上游用这两个布尔告诉调用方「还能往前翻 / 有没有更新的」。
      page: {
        before: before ?? null,
        limit,
        nextBefore: data?.hasBefore === true ? (rows.length ? rows[rows.length - 1].id : null) : null,
      },
    };
  }

  /**
   * 一条提交记录的**详情**（代码、判题结果、逐测试点）。
   *
   * 与 `submissions()` 一样是纯读。归属校验照上游：记录必须属于**本人**、
   * 且属于**这份题集** —— 不校验的话，一个猜出来的 id 就能读到别人的代码。
   *
   * @param problemSetId - 题集 id。
   * @param submissionId - 提交记录 id。
   * @param options.signal - 中止信号。
   * @returns 平台原样的详情对象。
   */
  async submission(problemSetId, submissionId, { signal } = {}) {
    const id = ptaId(problemSetId, '题集 ID');
    const sid = ptaId(submissionId, '提交记录 ID');
    const info = await this.getExam(id, { signal });
    if (!info.exam) {
      throw new ClassroomError('NO_EXAM', '还没开始作答这份题集，所以没有提交记录。先在网页上点「开始」。');
    }
    const data = await this.get(`/api/exams/${ptaId(info.exam.id, '答题实例 ID')}/submissions/${sid}`, { signal });
    const row = data?.submission;
    if (!row || typeof row !== 'object') {
      throw new ClassroomError('API_SHAPE', '拼题A 提交详情缺少 submission');
    }
    if ((row.userId != null && String(row.userId) !== String(info.exam.userId))
      || (row.problemSetId != null && String(row.problemSetId) !== id)) {
      throw new ClassroomError('API_SHAPE', '这条提交记录不属于本人当前题集，拒绝返回');
    }
    return data;
  }

  /**
   * 题目在 PTA 网页上的地址 —— 便于用户跳过去提交。
   *
   * @param problemSetId - 题集 id。
   * @param problemId - 题目 id。
   * @param type - 题型（决定页码 type 参数）。
   * @returns 网址。
   */
  problemUrl(problemSetId, problemId, type) {
    const pageType = type === 'PROGRAMMING' ? 7 : type === 'CODE_COMPLETION' ? 6 : null;
    return problemId && pageType
      ? `${PTA_BASE}/problem-sets/${problemSetId}/exam/problems/type/${pageType}?problemSetProblemId=${problemId}`
      : `${PTA_BASE}/problem-sets/${problemSetId}/exam/overview`;
  }
}

/**
 * 解析用户粘贴的 Cookie —— 接受 cURL、请求头、DevTools 表格、裸字符串四种形态。
 *
 * ⚠️ 两处必须排除，否则鉴权会"看起来过了但接口返回空"：
 *   1. **DevTools 表头**（`Name` / `Value` / `名称` / `值`）；
 *   2. **RFC 6265bis 属性行**（`Path /`、`HttpOnly ✓`、`SameSite Lax`）。
 *
 * @param input - 用户粘贴的原文。
 * @returns `{ cookie, source, names }`，或 null 表示没识别出来。
 */

// 实现已搬到 @lybx-leyw/dsh-zju-source-http（纯函数，多个数据源共用）。
// 这里保留 re-export，调用方与测试不必改 import。
export { parsePtaCookie } from '@lybx-leyw/dsh-zju-source-http';

/* ── 归一化与错误翻译（原先在 campus 的 `src/index.js` 里） ────────── */

/**
 * 拼题A 题集 → 页面统一形状。
 *
 * 形状与学在浙大待办那一半（`normalizeXzzd`）对齐，只差 `kind`：
 * 页面按 `kind` 分组，`source` 决定显示哪个来源标签。
 *
 * # 为什么跟着包走
 *
 * 它原先在 `campus/src/index.js` 里。拆包后拼题A 的行只能由本包产生，
 * 把映射留在校园包里等于让「读的人」去猜「写的人」的字段名 ——
 * 而这正是 `translateXzzdError` 那段注释记过的教训。
 *
 * @param rows - `PtaApi.problemSets()` 的结果（非数组按空处理）。
 * @returns 题集行数组（`source: 'pta'`、`kind: 'problemSet'`）。
 */
export function normalizePta(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    source: 'pta',
    sourceLabel: '拼题A',
    id: row.id,
    title: row.name,
    // 「已结束 / 未结束」而不是「有 DDL / 没 DDL」：后者是内部口径，
    // 用户看不出区别。无截止时间时 `ended` 是 null，所以落到 else 分支。
    detail: row.ended === true ? '已结束' : '未结束',
    due: row.endsAt?.iso ?? null,
    dueText: row.endsAt?.text ?? null,
    url: row.url ?? null,
    kind: 'problemSet',
  }));
}

/**
 * 拼题A 的错误码 → 用户能照做的一句。
 *
 * # 为什么不能与学在浙大共用一张表
 *
 * 拼题A 的答案是「粘 Cookie」而不是「登录」（它要短信验证，无法自动登录）。
 * 学在浙大那张表写的是「去设置填学号密码」，对拼题A 是**错的指路**。
 *
 * # 为什么翻译在数据源里
 *
 * `tests/source-error-contract.test.mjs` 钉着这条契约：数据源返回的 `error`
 * 其 `message` 必须能直接上屏，页面只透传、不做码表。页面抄一份的后果是
 * 「设置分区改名时只改了 source、页面还指旧入口」。
 *
 * @param error - 任意 `{ code, message }`。
 * @returns `{ code, message }`，或 null（没有错误）。
 */
export function translatePtaError(error) {
  if (!error) return null;
  const code = error.code ?? 'PTA_FAILED';
  if (code === 'COOKIE_IMPORT_REQUIRED' || code === 'COOKIE_EXPIRED') {
    return {
      code: 'COOKIE_IMPORT_REQUIRED',
      message: '拼题A 需要在「设置 → 拼题A」粘贴一次 Cookie（它登录要短信验证，无法自动登录）。',
    };
  }
  return { code, message: typeof error.message === 'string' ? error.message : String(error.message ?? code) };
}
