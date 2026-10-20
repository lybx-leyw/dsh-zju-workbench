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
    const params = new URLSearchParams({
      limit: String(limit),
      order_by: PTA_ORDER_BY,
      asc: 'true',
    });
    if (!includeEnded) {
      params.set('filter', JSON.stringify({ endAtAfter: yesterdayUtcMidnight(now()) }));
    }
    const target = `${PTA_BASE}/api/problem-sets?${params.toString()}`;

    const result = await this.transport.request(target, {
      headers: {
        Accept: 'application/json;charset=UTF-8',
        'Accept-Language': 'zh-CN',
        Referer: PTA_REFERER,
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
