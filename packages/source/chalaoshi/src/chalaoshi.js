/**
 * 查老师（`chalaoshi.de`）：教师评分与课程绩点。
 *
 * # 分层（D17）
 *
 * 纯只读数据源，`auth: none`，不注册 AI 工具、无写操作。
 *
 * # 站点结构（照上游 `chalaoshi/index.ts` 的实测记录）
 *
 * 站点**没有搜索接口**：首页把 `/static/json/search.json`（约 1 MB、一万多位教师）
 * 整个下载后在浏览器里过滤。本包照做 —— 索引缓存在本地，用 `ETag` /
 * `Last-Modified` 做条件 GET（304 不传体），搜索纯本地。只有教师详情、
 * 评论、课程绩点表才打站点。
 *
 * # ⚠️ 这个站点在国内被墙
 *
 * 上游 2026-09-17 在外部主机实测：`chalaoshi.de` 与两个 `ip6.arpa` 镜像都不通。
 * **WebVPN 帮不上忙**（它不是校内站）。所以本包在国内网络下**只能读缓存**，
 * 首次拉索引会失败。
 *
 * 2026-11-10 在本仓开发机复测：站点、索引、API 三个地址全部连接失败，与上游记录一致。
 *
 * 因此 `search` 在**有缓存时**能离线工作（这是本包的主要价值），
 * 没有缓存时如实报「需要能出海」而不是假装没有数据。
 */

/** 站点根。 */
export const SITE = 'https://chalaoshi.de';
/** 评论等接口的子域。 */
export const API = 'https://api.chalaoshi.de';

/** 索引文件路径（相对站点）。 */
const INDEX_PATH = '/static/json/search.json';

/** 索引在本地视为新鲜多久。上游用 7 天。 */
export const INDEX_TTL_MS = 7 * 24 * 3600 * 1000;

/** 本包的统一错误形状。 */
export class ChalaoshiError extends Error {
  /**
   * @param code - 稳定错误码。
   * @param message - 给人看的一句话。
   * @param details - 附加信息。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ChalaoshiError';
    this.code = code;
    this.details = details;
  }
}

/** 索引里的一位教师。字段名取站点 JSON 的原样短名，省一次映射。 */
export function teacherFromIndex(entry, colleges) {
  return {
    id: entry.id,
    name: entry.name,
    pinyin: entry.py,
    initials: entry.sx,
    college: colleges.get(entry.xy) ?? '',
    rating: parseRate(entry.rate),
    hot: entry.hot,
  };
}

/**
 * 把站点给的评分字符串转成数字。
 *
 * 站点有三种值：`"9.4"`（有评分）、`"0.0"`（无评分）、`"N/A"`（没有数据）。
 * 后两种都返回 `null` —— 区分它们对调用方没有意义，而 `0` 会被误读成「很差」。
 *
 * @param rate - 站点给的字符串。
 * @returns 评分数字，或 null。
 */
export function parseRate(rate) {
  const value = Number(rate);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** 归一化：NFKC、小写、去空白。中文姓名与拼音走同一套比较。 */
const norm = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/**
 * 按顺序出现但可不连续（`"王辉"` ⊂ `"王伟辉"`）。
 *
 * 只用于 ≥2 个汉字的查询 —— 单字做子序列匹配会命中太多。
 *
 * @param query - 归一化后的查询。
 * @param target - 归一化后的姓名。
 * @returns 是否命中。
 */
function isSubsequence(query, target) {
  let i = 0;
  for (const ch of target) if (ch === query[i] && ++i === query.length) return true;
  return false;
}

/**
 * 单个 token 对单个教师的匹配得分（0 = 不匹配）。
 *
 * 分档对应「用户到底想找谁」：全等最高，开头次之，包含再次，拼音与首字母另有一套。
 * 分数是相对的，不对外承诺 —— 排序稳定比数值精确重要。
 *
 * @param teacher - 索引里的教师。
 * @param query - 归一化后的 token。
 * @returns `{ score, match }` 或 null。
 */
function scoreToken(teacher, query) {
  const name = norm(teacher.name);
  if (name === query) return { score: 100, match: 'name' };
  const ascii = /^[a-z0-9]+$/.test(query);
  if (!ascii) {
    if (name.startsWith(query)) return { score: 80, match: 'name-prefix' };
    if (name.includes(query)) return { score: 60, match: 'name-part' };
    if (query.length >= 2 && /^\p{Script=Han}+$/u.test(query) && isSubsequence(query, name)) {
      return { score: 30, match: 'name-fuzzy' };
    }
    return null;
  }
  const initials = String(teacher.sx ?? '').toLowerCase();
  const pinyin = String(teacher.py ?? '').toLowerCase();
  if (pinyin === query) return { score: 90, match: 'pinyin' };
  if (initials === query) return { score: 70, match: 'initials' };
  // 外教的英文名直接写在 name 里。
  if (name.includes(query)) return { score: 60, match: 'name-part' };
  if (pinyin.startsWith(query)) return { score: query.length >= 4 ? 55 : 45, match: 'pinyin-prefix' };
  if (initials.startsWith(query)) return { score: 40, match: 'initials-prefix' };
  if (query.length >= 4 && pinyin.includes(query)) return { score: 25, match: 'pinyin-part' };
  return null;
}

/**
 * 把查询拆成 token，并把「能对上学院名」的部分转成学院过滤。
 *
 * 这样 `"王伟 数学"`、`"ww 计算机"` 都能用。判据（照上游）：
 * 多 token 时 ≥2 字对上学院名就当学院过滤；单 token ≥3 字对上学院名就是
 * 「按学院浏览」，不再当姓名。
 *
 * @param index - 索引。
 * @param raw - 用户输入的查询。
 * @returns `{ tokens, collegeIds? }`。
 */
export function splitQuery(index, raw) {
  const parts = String(raw ?? '')
    .normalize('NFKC')
    .split(/[\s,，、/|]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const tokens = [];
  let collegeIds;
  for (const part of parts) {
    const hit = index.colleges.filter((college) => college.name.includes(part));
    if (hit.length && ((parts.length > 1 && part.length >= 2) || (parts.length === 1 && part.length >= 3))) {
      collegeIds = new Set([...(collegeIds ?? []), ...hit.map((college) => college.id)]);
      continue;
    }
    tokens.push(norm(part));
  }
  return { tokens: tokens.filter(Boolean), ...(collegeIds ? { collegeIds } : {}) };
}

/**
 * 在本地索引里搜教师。
 *
 * 打分制：每个 token 取最佳匹配方式的分，多 token 全部要命中（取均值）；
 * 再加小额加成（有评分 +3、人气按 0–3、评分越高 +0–2），同分档时把好老师排前。
 *
 * @param index - 索引。
 * @param raw - 查询（姓名 / 拼音 / 首字母，可带学院）。
 * @param options.sort - `score`（默认）/ `rate` / `hot` / `name`。
 * @param options.limit - 条数。
 * @param options.ratedOnly - 只要有评分的。
 * @returns 命中列表。
 */
export function searchIndex(index, raw, { sort = 'score', limit = 20, ratedOnly = false } = {}) {
  const { tokens, collegeIds } = splitQuery(index, raw);
  if (!tokens.length && !collegeIds) return [];
  const colleges = new Map(index.colleges.map((college) => [college.id, college.name]));
  const hits = [];

  /**
   * 索引里的最高人气值，用来把 `hot` 归一到 0–3。
   *
   * ⚠️ 这**不能写死成 `/10`**。上游是 `(hot / maxHot) * 3`（`index.ts:247,267`）——
   * 热度是个长尾分布，绝大多数教师的热度在个位数到几十，而最热的可能上千。
   * 用固定除数时 `hot >= 30` 会一律封顶 3 分，人气差异被完全抹平，
   * 「谁被查得多」这条本来有用的排序信号就失效了。
   */
  const maxHot = Math.max(1, ...index.teachers.map((entry) => Number(entry.hot) || 0));

  for (const entry of index.teachers) {
    if (collegeIds && !collegeIds.has(entry.xy)) continue;
    const rating = parseRate(entry.rate);
    if (ratedOnly && rating === null) continue;

    let total = 0;
    let best = null;
    let matchedAll = true;
    for (const token of tokens) {
      const hit = scoreToken(entry, token);
      if (!hit) { matchedAll = false; break; }
      total += hit.score;
      if (!best || hit.score > best.score) best = hit;
    }
    // 只有学院过滤、没有姓名 token 时（按学院浏览），命中即入选。
    if (!matchedAll) continue;
    if (!tokens.length && !collegeIds) continue;

    const base = tokens.length ? total / tokens.length : 0;
    // 加成三项：有评分 +3、人气按 maxHot 归一到 0–3、评分越高 +0–2。
    // 与上游 `(hot/maxHot)*3` 等价（`Math.min(3, ...)` 只是防御 maxHot 为 0 的边界）。
    const hotBonus = Math.min(3, ((Number(entry.hot) || 0) / maxHot) * 3);
    const bonus = (rating !== null ? 3 : 0) + hotBonus + (rating !== null ? Math.min(2, rating / 5) : 0);
    hits.push({
      ...teacherFromIndex(entry, colleges),
      match: best?.match ?? 'name',
      exact: tokens.length === 1 && norm(entry.name) === tokens[0],
      score: base + bonus,
      url: `${SITE}/teacher/${entry.id}`,
    });
  }

  const compare = {
    score: (a, b) => b.score - a.score || (b.rating ?? 0) - (a.rating ?? 0),
    rate: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.score - a.score,
    hot: (a, b) => (b.hot ?? 0) - (a.hot ?? 0) || b.score - a.score,
    name: (a, b) => a.name.localeCompare(b.name, 'zh'),
  }[sort] ?? ((a, b) => b.score - a.score);

  return hits.sort(compare).slice(0, limit);
}

/**
 * 索引缓存：读、写、判断新鲜度。
 *
 * 缓存由调用方持有（通常是宿主数据目录下的一个 json），本模块只管形状与判据 ——
 * 它不碰文件系统，这样单测不需要临时目录。
 */
export class IndexCache {
  /**
   * @param options.load - `() => object | undefined`，读缓存的原始 JSON。
   * @param options.save - `(index) => void | Promise<void>`，写缓存。
   * @param options.now - 取当前时间（测试注入）。
   */
  constructor({ load, save, now = () => Date.now() }) {
    this.load = load;
    this.save = save;
    this.now = now;
  }

  /**
   * 读出可用的索引；形状不对的当作没有。
   *
   * @returns 索引对象，或 undefined。
   */
  read() {
    const raw = this.load();
    if (!raw || raw.version !== 1 || !Array.isArray(raw.teachers) || !Array.isArray(raw.colleges)) return undefined;
    return raw;
  }

  /**
   * 缓存是否还在新鲜期内。
   *
   * @param index - 索引。
   * @param maxAgeMs - 时限，默认 7 天。
   * @returns 是否新鲜。
   */
  fresh(index, maxAgeMs = INDEX_TTL_MS) {
    return Boolean(index) && this.now() - index.fetchedAt < maxAgeMs;
  }

  /**
   * 写入一份索引。
   *
   * @param index - 索引对象。
   * @returns 写入结果。
   */
  async write(index) {
    await this.save(index);
    return index;
  }
}

/**
 * 拉一次索引（条件 GET）。
 *
 * 有缓存时带上 `If-None-Match` / `If-Modified-Since`；304 只更新 `fetchedAt`，
 * 不重写整份数据 —— 那是 1 MB。
 *
 * @param options.request - `(url, init) => { status, headers, text }`，由调用方注入。
 * @param options.cached - 现有缓存（可为 undefined）。
 * @param options.fresh - 强制重下（忽略条件请求）。
 * @returns `{ index, sync }`。
 * @throws {ChalaoshiError} 拉不到且没有缓存。
 */
export async function fetchIndex({ request, cached, fresh = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (cached && !fresh) {
    if (cached.etag) headers['If-None-Match'] = cached.etag;
    if (cached.lastModified) headers['If-Modified-Since'] = cached.lastModified;
  }

  let response;
  try {
    response = await request(`${SITE}${INDEX_PATH}`, { headers, timeoutMs: 30000 });
  } catch (error) {
    // 拉不到但**有缓存**时沿用缓存，并如实说明。这是本包在国内网络下的主要工作方式。
    if (cached) {
      return { index: cached, sync: { source: 'cache', teachers: cached.teachers.length, fetchedAt: cached.fetchedAt, degraded: String(error?.message ?? error) } };
    }
    throw new ChalaoshiError(
      'UNREACHABLE',
      `查老师的索引拉不到（${error?.message ?? error}）。这个站点在国内公网不可达，`
      + '需要本机能出海；WebVPN 帮不上忙（它不是校内站）。',
    );
  }

  if (response.status === 304 && cached) {
    const refreshed = { ...cached, fetchedAt: Date.now() };
    return { index: refreshed, sync: { source: 'not-modified', teachers: refreshed.teachers.length, fetchedAt: refreshed.fetchedAt } };
  }
  if (response.status !== 200) {
    throw new ChalaoshiError('HTTP', `查老师索引 HTTP ${response.status}`, { status: response.status });
  }

  let body;
  try {
    body = JSON.parse(response.text);
  } catch {
    throw new ChalaoshiError('SHAPE', '查老师索引不是 JSON');
  }
  if (!body || !Array.isArray(body.teachers) || !Array.isArray(body.colleges)) {
    throw new ChalaoshiError('SHAPE', '查老师索引不是预期的 {colleges, teachers}');
  }

  const index = { version: 1, fetchedAt: Date.now(), colleges: body.colleges, teachers: body.teachers };
  const etag = headerOf(response.headers, 'etag');
  const lastModified = headerOf(response.headers, 'last-modified');
  if (etag) index.etag = etag;
  if (lastModified) index.lastModified = lastModified;
  return { index, sync: { source: 'downloaded', teachers: index.teachers.length, fetchedAt: index.fetchedAt } };
}

/**
 * 解析「某门课所有任课老师的平均绩点」表格。
 *
 * # 它的输入是一张 HTML 表
 *
 * `api.chalaoshi.de/gpa?course=` 回的是一张服务端渲染的表，每行一位老师：
 * 姓名、平均绩点（可能带 `±标准差`）、样本人数（`500+` 这种约数）。
 * 没有任何 JSON 版本 —— 上游也是照这张表解析的。
 *
 * # 为什么用正则而不是 parse5
 *
 * 这张表的结构是**平**的：一行三个固定 `<td>`，没有嵌套。用 DOM 反而多一层
 * 依赖，且这里与 `chalaoshi.js` 其余部分（纯正则 + 纯函数）保持一致。
 *
 * 样本人数保留原文（`500+`）并另给一个去掉 `+` 的数字：`+` 是「至少这么多」，
 * 抹成 500 会让人以为精确。
 *
 * @param {string} html - 表格 HTML。
 * @returns {Array<{teacher: string, gpa: number, sd: number|null, sampleText: string, sample: number}>}
 */
export function parseGpaTable(html) {
  const out = [];
  const text = String(html ?? '');
  for (const match of text.matchAll(/<tr[^>]*>\s*<td class="course_name">([^<]*)<\/td>\s*<td>([\d.]+)(?:<span[^>]*>±([\d.]+)<\/span>)?<\/td>\s*<td>(\d+\+?)<\/td>/g)) {
    out.push({
      teacher: unescapeEntities(match[1]),
      gpa: Number(match[2]),
      sd: match[3] !== undefined ? Number(match[3]) : null,
      sampleText: match[4],
      sample: Number(match[4].replace('+', '')),
    });
  }
  return out;
}

/**
 * 反转义表格里会出现的几个实体。
 *
 * 上游用的是同一套替换（`&amp;` / `&nbsp;` / 引号 / 尖括号）。这里只收这几个：
 * 姓名里不会出现别的。
 *
 * @param {string} value - 原始片段。
 * @returns {string}
 */
function unescapeEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * 取一门课所有任课老师的平均绩点（对应上游 `chalaoshi course`，审计 W-14）。
 *
 * # 为什么它不该留给消费方
 *
 * 上游的 `teacher` 命令顺带给了「这位老师教过的课与各课绩点」，但「这门课
 * 所有老师谁给分高」是另一条链路（`api /gpa?course=`）。本包原先把它写成
 * 「解析留给消费方」—— 那不是裁决，等于把上游一条能力丢给每个调用方各写一遍。
 *
 * # 站点在国内不可达
 *
 * 与 `teacher` 一样：它**必须联网**（索引缓存帮不上忙）。失败时照实抛：
 * 404 → `NOT_FOUND`（查老师里没有这门课），其余状态码 → `HTTP`。
 * 传输层自身的失败（连不上）原样上抛，不在这里改写成别的码 —— 调用方
 * 已经能从 `UNREACHABLE` / `NETWORK` 认出「要出海」这件事。
 *
 * @param {object} options
 * @param {(url: string, init?: object) => Promise<{status: number, headers?: object, text: string}>} options.request - 注入的请求函数。
 * @param {string} options.course - 课程名（要与页面写法一致，如 `微积分（甲）Ⅰ`）。
 * @returns {Promise<{course: string, count: number, teachers: Array<object>}>}
 */
export async function fetchCourseGpa({ request, course } = {}) {
  const name = String(course ?? '').trim();
  if (!name) throw new ChalaoshiError('INVALID_INPUT', 'course 需要课程名（与查老师页面的写法一致）。');
  const url = `${API}/gpa?course=${encodeURIComponent(name)}`;
  const response = await request(url, { headers: { Accept: 'text/html' } });
  if (response.status === 404) {
    throw new ChalaoshiError('NOT_FOUND', `查老师里没有课程「${name}」的绩点数据。`, { course: name });
  }
  if (response.status !== 200) {
    throw new ChalaoshiError('HTTP', `查老师绩点表 HTTP ${response.status}`, { status: response.status, url });
  }
  const teachers = parseGpaTable(response.text);
  return { course: name, count: teachers.length, teachers };
}

/**
 * 取一个响应头（大小写不敏感，`Headers` 与普通对象都认）。
 *
 * @param headers - 响应头。
 * @param name - 头名（小写）。
 * @returns 值，取不到是空串。
 */
function headerOf(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) ?? '');
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return String(value ?? '');
  }
  return '';
}

/**
 * 查一位教师的详情页（含评论）。
 *
 * 只在用户真的要看某位老师时才调 —— 搜索完全走本地索引。
 *
 * @param options.request - 注入的请求函数。
 * @param options.id - 教师 id。
 * @returns `{ id, url, html }`。
 */
export async function fetchTeacherPage({ request, id } = {}) {
  const url = `${SITE}/teacher/${encodeURIComponent(String(id))}`;
  const response = await request(url, { headers: { Accept: 'text/html' } });
  if (response.status !== 200) throw new ChalaoshiError('HTTP', `查老师教师页 HTTP ${response.status}`, { status: response.status, url });
  return { id, url, html: response.text };
}
