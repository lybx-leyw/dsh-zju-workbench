/**
 * 拼题A：**题集**读取器。
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

import { ClassroomError } from './cas/errors.js';
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
  async get(path, { query = null, referer = PTA_REFERER, signal } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/api/') || path.includes('..')) {
      throw new ClassroomError('INVALID_PATH', '只允许拼题A 的 /api/ 接口路径');
    }
    const target = `${PTA_BASE}${path}${query ? `?${new URLSearchParams(query).toString()}` : ''}`;
    const result = await this.transport.request(target, {
      headers: {
        Accept: 'application/json;charset=UTF-8',
        'Accept-Language': 'zh-CN',
        Referer: referer,
        'User-Agent': USER_AGENT,
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
      // 400 往往意味着查询串被双重编码了 —— 把这条线索写进错误里
      throw new ClassroomError('BAD_REQUEST', '拼题A 返回 400：多半是查询串编码有问题', { status: 400 });
    }
    if (result.status === 403) {
      throw new ClassroomError('FORBIDDEN', '拼题A 拒绝访问', { status: 403 });
    }
    if (result.status === 429) {
      throw new ClassroomError('RATE_LIMITED', '拼题A 请求过于频繁，请稍后再试', { status: 429 });
    }
    if (result.status >= 400) {
      throw new ClassroomError('HTTP', `拼题A 返回 HTTP ${result.status}`, { status: result.status });
    }

    let data;
    try {
      data = JSON.parse(result.text);
    } catch {
      if (/^\s*</.test(result.text)) {
        throw new ClassroomError('COOKIE_EXPIRED', '拼题A 返回了网页而不是 JSON，登录态可能已失效');
      }
      throw new ClassroomError('API_SHAPE', '拼题A 返回的 JSON 无法解析');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ClassroomError('API_SHAPE', '拼题A 返回的不是对象');
    }
    // 业务错误包在 200 里
    if (data.error && typeof data.error === 'object') {
      const code = String(data.error.code ?? '');
      if (/USER_NOT_FOUND|UNAUTHORIZED|LOGIN|SESSION/i.test(code)) {
        throw new ClassroomError('COOKIE_EXPIRED', '拼题A Cookie 已失效，请重新登录后粘贴');
      }
      throw new ClassroomError('PLATFORM_REJECTED', `拼题A 拒绝请求：${data.error.message ?? code}`);
    }
    return data;
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
  async problemSet(problemSetId, { signal } = {}) {
    const id = ptaId(problemSetId, '题集 ID');
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

    return {
      id,
      name: String(detail?.problemSet?.name ?? '').trim() || null,
      description: String(detail?.problemSet?.description ?? '').trim() || null,
      problemTypes,
      progress,
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
export function parsePtaCookie(input) {
  const text = String(input ?? '').replace(/\r\n?/g, '\n').trim();
  if (!text) return null;

  const ATTRS = new Set(['path', 'domain', 'expires', 'max-age', 'secure', 'httponly',
    'samesite', 'priority', 'partitioned', 'size', 'hostonly', 'host-only']);
  const HEADERS = new Set(['name', 'value', '名称', '值', 'cookie']);

  const pairs = [];
  const push = (name, value) => {
    const key = String(name ?? '').trim();
    const val = String(value ?? '').trim();
    if (!/^[\w-]{1,80}$/.test(key)) return;
    if (ATTRS.has(key.toLowerCase()) || HEADERS.has(key.toLowerCase())) return;
    if (HEADERS.has(val.toLowerCase())) return;
    if (!val || val.length > 512) return;
    pairs.push([key, val]);
  };

  const curl = /(?:--header|-H)\s+['"]?\s*cookie\s*:\s*([^'"\n]+)['"]?/i.exec(text)
    ?? /(?:--cookie|-b)\s+['"]([^'"]+)['"]/i.exec(text);
  const source = curl
    ? 'curl 命令'
    : /^\s*(?:[-*]\s*)?cookie\s*:/im.test(text)
      ? '请求头'
      : text.includes('\n') ? 'DevTools 表格' : 'Cookie 字符串';
  const body = curl?.[1] ?? /^\s*(?:[-*]\s*)?cookie\s*:\s*(.+)$/im.exec(text)?.[1] ?? text;

  for (const line of body.split('\n')) {
    const cells = line.includes('\t') ? line.split('\t') : line.trim().split(/\s{2,}|,(?=\s)/);
    if (cells.length >= 2 && !/[=;]/.test(cells[0])) {
      push(cells[0], cells[1]);
      continue;
    }
    for (const part of line.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0) push(part.slice(0, eq), part.slice(eq + 1));
    }
  }

  if (pairs.length === 0) return null;
  const seen = new Map();
  for (const [key, value] of pairs) seen.set(key, value);
  const cookie = [...seen].map(([name, value]) => `${name}=${value}`).join('; ');
  return { cookie, source, names: [...seen.keys()] };
}
