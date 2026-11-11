/**
 * 中国知网（`kns.cnki.net`）：**检索**（本包只做到检索为止）。
 *
 * # 分层（D17）
 *
 * 纯只读数据源：**不注册 AI 工具**、无写操作。
 *
 * # 全文下载：尚未实现（不是裁决）
 *
 * 早先这里的文件头写着「检索与全文下载」，但 `src/` 下**没有任何下载代码** ——
 * 那是一条不实声明，它会让接手的人以为下载已经做完、不去查。
 * 现状如实记录为：全文 PDF / CAJ 下载**尚未实现**，已记进 `coverage-gaps.md` 的
 * **W-10**。落盘按 D21 归 `packages/core/*`，而那个承接方目前也不存在
 * （见 `.work/abandoned.md` 的 A-1 ~ A-3，位于
 * `docs/contributing/skills/lossless-plugin-fusion/`）。
 *
 * # 没有账号，按 IP 认机构
 *
 * 知网按出口 IP 认机构（浙江大学图书馆）。所以 `network: campus` —— 校外要经 WebVPN，
 * 否则拿到的会是未订阅的检索结果。
 *
 * # 必须先 IP 登录再检索
 *
 * 没有登录过的会话打检索站会被带去**滑块验证**。登录约 20 分钟有效，
 * 有效期内直接复用、不再登录。
 *
 * 滑块**求解器**不搬：那是绕过人机校验，属本仓硬约束明确不做的一类
 * （见 `.work/abandoned.md` N-2）。本包只做到「检测到滑块 → 如实报」。
 *
 * # 检索式的事实（照上游 `cnki/index.ts`）
 *
 * 知网检索式里空格和 `* + - ( ) / % =` 是运算符，带这些字符的词要用**引号**括起来。
 * 检索框上限 120 字，超出的词不再加。
 */

/** 检索站（kns8s 是现行版本）。 */
export const KNS = 'https://kns.cnki.net/kns8s';
/** IP 登录端点。 */
export const IP_LOGIN = 'https://login.cnki.net/TopLogin/api/loginapi/IpLoginFlush';

/** 文献类型 → 知网的资源名与库代码。不指定类型时查总库。 */
export const TYPES = Object.freeze({
  期刊: { resource: 'JOURNAL', classid: 'YSTT4HG0' },
  学位论文: { resource: 'DISSERTATION', classid: 'LSTPFY1C' },
  博士: { resource: 'DISSERTATION', classid: 'RMJLXHZ3' },
  硕士: { resource: 'DISSERTATION', classid: 'JQIRZIYA' },
  会议: { resource: 'CONFERENCE', classid: 'JUP3MUPD' },
  报纸: { resource: 'NEWSPAPER', classid: 'MPMFIG1A' },
});

/** 站点一页能返回的最大条数。 */
const MAX_PAGE_SIZE = 50;

/** 总库。 */
const ALL = Object.freeze({ resource: 'CROSSDB', classid: 'WD0FTY92' });
/** 总库默认勾选的子库，与网页上一致。 */
const CROSS = 'YSTT4HG0,LSTPFY1C,JUP3MUPD,MPMFIG1A,WQ0UVIAA,BLZOG7CK,PWFIRAGL,EMRPGLPA,NLBO1Z6R,NN3FJMUV';

/** 期刊来源类别 → 检索字段。 */
export const CORE = Object.freeze({ SCI: 'SI', EI: 'EI', 北大核心: 'HX', CSSCI: 'CSI', CSCD: 'CSD' });

/** 排序方式 → 知网的排序码。 */
export const SORTS = Object.freeze({ relevance: 'FFD', date: 'PT', cited: 'CF', downloads: 'DFR' });

/** 本包的统一错误形状。 */
export class CnkiError extends Error {
  /**
   * @param code - 稳定错误码。
   * @param message - 给人看的一句话。
   * @param details - 附加信息。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CnkiError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 把一个词包成检索式里的一项。
 *
 * @param term - 原始词。
 * @returns 加引号（必要时）的项。
 */
const quote = (term) => {
  const clean = String(term ?? '').replace(/['"]/g, '').trim();
  return /[\s*+\-()/%=]/.test(clean) ? `'${clean}'` : clean;
};

/**
 * 把「几个词都要出现」拼成检索式。
 *
 * 空格、顿号、逗号、分号隔开。检索框上限 120 字，**超出的词不再加** ——
 * 加了会让整条检索式被站点截断，反而搜不到。
 *
 * @param raw - 原始输入。
 * @returns 检索式，如 `算法 * 调度`。
 */
export function allOf(raw) {
  const terms = [];
  for (const word of String(raw ?? '').split(/[\s、，,；;]+/)) {
    // 纯运算符的词先剔掉：它们加引号之后就不再是运算符、也不是有意义的检索词，
    // 只会让检索式变成 `'*' * '+' * 算法` 这种站点不认的东西。
    if (!word || /^[*+\-()/%=]+$/.test(word)) continue;
    const term = quote(word);
    if (!term) continue;
    if ([...terms, term].join(' * ').length > 110) break;
    terms.push(term);
  }
  return terms.join(' * ');
}

/**
 * 把完整篇名按标点拆成几段、每段都要出现。
 *
 * 知网页面上的标点全半角与用户输入常不一致，整串匹配会找不到；
 * 拆段之后再比对整个篇名（`sameTitle`）才能确认是同一篇。
 *
 * @param title - 篇名。
 * @returns 检索式。
 */
export function titleWords(title) {
  return String(title ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
}

/**
 * 归一化篇名，用于「是不是同一篇」的比对。
 *
 * @param value - 篇名。
 * @returns 只留字母数字、NFKC、小写。
 */
export function sameTitle(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * 把查询对象编成知网的检索 JSON。
 *
 * 与网页的高级检索同构：每个条件是一行输入框，时间和来源类别在控制组里。
 *
 * @param query - `{ keyword?, title?, author?, source?, type?, years?, core? }`。
 * @returns 检索请求体（JSON 字符串）。
 * @throws {CnkiError} 四个条件一个都没给。
 */
export function queryJson(query = {}) {
  const db = query.type ? TYPES[query.type] : ALL;
  if (query.type && !TYPES[query.type]) throw new CnkiError('CONFIG', `未知的文献类型：${query.type}`);

  const fields = [
    ['主题', 'SU', 'TOPRANK', query.keyword && allOf(query.keyword)],
    ['篇名', 'TI', 'DEFAULT', query.title && allOf(query.title)],
    ['作者', 'AU', 'DEFAULT', query.author && quote(query.author)],
    ['文献来源', 'LY', 'DEFAULT', query.source && quote(query.source)],
  ];
  const item = (key, title, field, operator, value, value2 = '', logic = 0) => ({ Key: key, Title: title, Logic: logic, Field: field, Operator: operator, Value: value, Value2: value2 });
  const group = (key, title, items) => ({ Key: key, Title: title, Logic: 0, Items: items, ChildItems: [] });

  const subject = fields
    .filter((entry) => Boolean(entry[3]))
    .map(([title, field, operator, value], index) => {
      const key = `input[data-tipid=gradetxt-${index + 1}]`;
      return group(key, title, [item(key, title, field, operator, value)]);
    });
  if (!subject.length) {
    throw new CnkiError('CONFIG', '需要 keyword、title、author 或 source 中的至少一个');
  }

  const control = [];
  if (Array.isArray(query.years) && query.years.length === 2) {
    control.push(group('.tit-date-box', '', [
      item('.tit-date-box', '发表时间', 'PT', 'BETWEEN', `${query.years[0]}-01-01`, `${query.years[1]}-12-31`),
    ]));
  }
  if (Array.isArray(query.core) && query.core.length) {
    // 来源类别（SCI / 北大核心 …）**只对期刊有意义**。上游在 CLI 层拦这条
    // （`cnki/cli.ts:53`），但本仓按 D17 没有 CLI 层 —— 不在这里补，这个约束
    // 就整体消失了，调用方可以发出「学位论文 + 北大核心」这种站点不认的组合，
    // 而站点多半返回 0 条或干脆忽略勾选，用户会以为「真的没有」。
    if (query.type && query.type !== '期刊') {
      throw new CnkiError('CONFIG', `来源类别只对期刊有效，当前类型是「${query.type}」——请去掉 core，或把 type 改成「期刊」`);
    }
    for (const kind of query.core) {
      if (!CORE[kind]) throw new CnkiError('CONFIG', `未知的来源类别：${kind}`);
    }
    control.push(group('.extend-tit-checklist', '', query.core.map((kind, index) => item(index, kind, CORE[kind], 'DEFAULT', 'Y', '', 1))));
  }

  return JSON.stringify({
    Platform: '',
    Resource: db.resource,
    Classid: db.classid,
    Products: '',
    QNode: {
      QGroup: [
        { Key: 'Subject', Title: '', Logic: 0, Items: [], ChildItems: subject },
        { Key: 'ControlGroup', Title: '', Logic: 0, Items: [], ChildItems: control },
      ],
    },
    ExScope: '1',
    SearchType: 1,
    Rlang: 'CHINESE',
    KuaKuCode: query.type ? '' : CROSS,
    Expands: {},
    SearchFrom: 1,
  });
}

/** 去标签、解实体、压空白。 */
const plain = (html) => String(html ?? '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

/** 取一个 `<td class="name">` 单元格的内容。 */
const cell = (row, name) => row.match(new RegExp(`<td\\s+class=['"]${name}['"][^>]*>([\\s\\S]*?)</td>`))?.[1] ?? '';

/**
 * 检索结果表格 → 文献列表。
 *
 * 各库的列不同：来源列在期刊是 `source`、学位论文是 `unit`、会议是 `hy-name`；
 * 总库和学位论文另有「数据库」列。
 *
 * @param html - 结果页 HTML。
 * @param type - 指定的文献类型（结果里没有数据库列时用）。
 * @returns `{ total, papers }`。
 * @throws {CnkiError} 页面结构不对。
 */
export function parseGrid(html, type) {
  const body = html.match(/<tbody[\s\S]*?<\/tbody>/)?.[0];
  if (!body) {
    // 这三种措辞是站点的「没有结果」，与「结构变了」不同。
    if (/暂无数据|抱歉|没有找到/.test(html)) return { total: 0, papers: [] };
    throw new CnkiError('SHAPE', '知网检索结果不是预期的表格', { snippet: plain(html).slice(0, 200) });
  }

  const papers = [];
  for (const row of body.split(/<tr[\s>]/).slice(1)) {
    const name = cell(row, 'name');
    const anchor = name.match(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/);
    if (!anchor) continue;
    const author = cell(row, 'author');
    const linked = [...author.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((match) => plain(match[1])).filter(Boolean);
    papers.push({
      title: plain(anchor[2]),
      authors: linked.length ? linked : plain(author).split(/\s*[;；]\s*/).filter(Boolean),
      source: plain(cell(row, 'source') || cell(row, 'unit') || cell(row, 'hy-name')),
      date: plain(cell(row, 'date')).replace(/^(\d{4}-\d{2}-\d{2}).*$/, '$1'),
      type: plain(cell(row, 'data')) || type || '',
      cited: Number(plain(cell(row, 'quote'))) || 0,
      downloads: Number(plain(cell(row, 'download'))) || 0,
      // link 是**内部字段**：它是站点上的详情页地址，经 WebVPN 出网时会被网关
      // 改写成物理地址。它不该进 API 响应（上游的 paperRow 就是干这个的）。
      // 这里只留 path，请求侧自己拼 base。
      path: plain(anchor[1]),
    });
  }

  // 「共找到」与「条结果」之间的标记各版本不一（`</span><em>`、`<span><em>` 都见过），
  // 所以只锚两端、中间用 `[\s\S]*?` 放过。
  const counted = (html.match(/共找到[\s\S]*?<em>\s*([\d,]+)\s*<\/em>/)?.[1] ?? '').replace(/,/g, '');
  const total = Number(counted);
  return { total: Number.isFinite(total) && total > 0 ? total : papers.length, papers };
}

/**
 * 知网 IP 登录会话。
 *
 * # 两个必须照上游写的地方（都是我第一版写错过的）
 *
 * **一、登录接口返回的是 JSONP，不是 JSON。**
 *
 * 请求要带 `?callback=cb&_=<ts>`，响应体是 `cb({...})` 形态。直接 `JSON.parse`
 * 必然抛 `SHAPE`。上游用 `/(\{[\s\S]*\})/` 抠出花括号里的部分再解析（`index.ts:248`）。
 *
 * **二、字段名是 `IsSuccess` / `Expire` / `ShowName`，不是 `success` / `expireTime`。**
 *
 * `Expire` 是**北京时间字符串**（如 `"2026-10-05 17:45:40"`），不是秒数也不是毫秒数。
 * 我第一版读 `expireTime`/`expiresIn` —— 那两个字段在上游从不出现，
 * 于是恒为 `undefined`，永远走兜底；而兜底那行 `ttl > 1000 ? ttl : ttl * 1000`
 * 会把「1200 秒」当成「1200 毫秒」，**20 分钟变成 1.2 秒**。
 *
 * # 登录状态靠 Cookie，不是一个时间戳
 *
 * 上游的核心机制是：登录后 CAS 把票种进 `http.jar`，后续检索请求带着票。
 * 本仓通过 `Transport` 的 `SessionStore` 持有 cookie —— 所以 `transport.session.jar`
 * 必须是真的（`{ jar: null }` 会让 `Transport.request` 抛 TypeError）。
 */
export class CnkiSession {
  /**
   * @param options.request - `(url, init) => { status, text }`。
   * @param options.load - `() => object | undefined`，读持久化的登录记录。
   * @param options.save - `(login) => void | Promise<void>`。
   * @param options.now - 取当前时间（测试注入）。
   */
  constructor({ request, load = () => undefined, save = async () => {}, now = () => Date.now() }) {
    this.request = request;
    this.load = load;
    this.save = save;
    this.now = now;
    /** 当前登录记录：`{ institution, expiresAt }`。 */
    this.login = null;
  }

  /**
   * 读出上次的登录；没过期就用。
   *
   * 「没过期」留 60 秒余量 —— 剩 1 秒有效期的会话拿去发请求，必然发到一半失效。
   * 上游的 `usable()` 就是同一个判据（`index.ts:210`）。
   *
   * @returns 可用的登录记录，或 undefined。
   */
  current() {
    const usable = (expiresAt) => typeof expiresAt === 'number' && this.now() < expiresAt - USABLE_MARGIN_MS;
    if (this.login && usable(this.login.expiresAt)) return this.login;
    const stored = this.load();
    if (stored && usable(stored.expiresAt)) {
      this.login = stored;
      return stored;
    }
    return undefined;
  }

  /**
   * IP 登录（按出口 IP 认机构）。
   *
   * @param fresh - 强制重登。
   * @returns 登录记录。
   * @throws {CnkiError} 登录被拒。
   */
  async ensure(fresh = false) {
    if (!fresh) {
      const existing = this.current();
      if (existing) return existing;
    }

    // JSONP：不带 callback 时站点不给 JSON，带 `_` 防缓存。
    const url = `${IP_LOGIN}?callback=cb&_=${this.now()}`;
    const response = await this.request(url, {
      headers: {
        Accept: 'application/javascript, application/json, */*',
        Referer: 'https://www.cnki.net/',
      },
    });
    if (response.status !== 200) {
      throw new CnkiError('LOGIN', `知网 IP 登录 HTTP ${response.status}`, { status: response.status });
    }

    const reply = parseJsonp(response.text);
    if (!reply) {
      throw new CnkiError('SHAPE', '知网 IP 登录没有返回可解析的 JSON/JSONP', { snippet: String(response.text ?? '').slice(0, 160) });
    }
    // 字段名照上游：`IsSuccess`。没有这个字段时退回「有 Expire 就算成功」。
    const ok = typeof reply.IsSuccess === 'boolean' ? reply.IsSuccess : Boolean(reply.Expire);
    if (!ok) {
      throw new CnkiError(
        'LOGIN',
        '知网不认这个出口 IP：校外时要经 WebVPN，或者本机不在校园网里',
        { reply },
      );
    }

    const expiresAt = parseExpire(reply.Expire, this.now());
    const login = {
      institution: String(reply.ShowName ?? reply.UserName ?? ''),
      expiresAt,
    };
    this.login = login;
    // 落盘失败不该让一次**成功的**登录整体报错（内存里已经可用）。
    // 代价只是下次要重登一次 —— IP 登录零成本。
    try {
      await this.save(login);
    } catch { /* 落盘失败不影响本次会话 */ }
    return login;
  }
}

/** 会话到期前留的余量。 */
const USABLE_MARGIN_MS = 60_000;
/** 解析不出 `Expire` 时的兜底有效期（上游为 15 分钟，`index.ts:258`）。 */
const FALLBACK_TTL_MS = 15 * 60_000;

/**
 * 从响应体里取 JSON —— 兼容纯 JSON 与 JSONP 两种形态。
 *
 * @param text - 响应体。
 * @returns 解析出的对象，或 undefined。
 */
export function parseJsonp(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return undefined;
  // JSONP：`cb({...})` / `cb({...});` —— 抠出最外层花括号。
  const match = /(\{[\s\S]*\})/.exec(raw);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

/**
 * 把知网给的 `Expire` 转成毫秒时间戳。
 *
 * `Expire` 是**北京时间**的 `"YYYY-MM-DD HH:mm:ss"` 字符串。解析不出来时按
 * 15 分钟兜底（上游同值），而不是猜单位 —— 猜单位正是第一版的 bug。
 *
 * @param value - `Expire` 字段。
 * @param now - 当前时间。
 * @returns 毫秒时间戳。
 */
export function parseExpire(value, now = Date.now()) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // 有些部署直接给毫秒/秒时间戳：> 1e12 当毫秒，否则当秒。
    return value > 1e12 ? value : value * 1000;
  }
  const text = String(value ?? '').trim();
  if (!text) return now + FALLBACK_TTL_MS;
  // 显式按 +08:00 解释：`Date.parse("2026-10-05 17:45:40")` 会按本机时区算，
  // 在别的时区跑就偏了。
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}+08:00` : text;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return now + FALLBACK_TTL_MS;
  // 已经过期或明显不合理的，也按兜底（不可能「登录成功但立刻过期」）。
  return parsed > now ? parsed : now + FALLBACK_TTL_MS;
}

/**
 * 检索文献。
 *
 * # 请求形态（这是必须照上游写的地方）
 *
 * `POST ${KNS}/brief/grid`，`application/x-www-form-urlencoded`。表单里有 11 个字段：
 *
 * | 字段 | 值 |
 * | --- | --- |
 * | `boolSearch` | `true` —— 声明这是一次**布尔高级检索** |
 * | `QueryJson` | `queryJson()` 的产物 |
 * | `pageNum` / `pageSize` | 页码与每页条数 |
 * | `sortField` | `SORTS[sort]` |
 * | `sortType` | `desc` |
 * | `dstyle` | `listmode` |
 * | `productStr` / `aside` | 空串 |
 * | `searchFrom` | `资源范围：<类型>;` |
 * | `CurPage` | `1` |
 *
 * ⚠️ **不能改成 `GET ?kw=<JSON>`**。`kw` 是「普通检索框关键词」，`QueryJson` 是
 * 「高级检索布尔查询」，两者不是一回事 —— 把 JSON 塞进 `kw`，站点只会把它当成
 * 一个含 `{`、`"`、`[` 的普通词，检索式里那些 `Field` / `Operator` / `BETWEEN` /
 * `CORE` 全部不生效，而请求仍然返回 200，**看起来像搜到了东西**。
 *
 * 还有一个相关的事实：`pageSize` 必须真的发出去。只在客户端 `slice`，
 * 站点按默认一页 20 条返回，`limit: 50` 永远只能拿到 20 条。
 *
 * @param options.session - 已登录的 {@link CnkiSession}。
 * @param options.query - 查询对象。
 * @returns `{ total, papers, matchedBy }`。
 */
export async function searchPapers({ session, query = {} } = {}) {
  // 参数校验放在登录**之前**：纯参数错误（类型不认识、四个条件全空）不该先
  // 花一次 IP 登录，更不该被 LOGIN 的错误盖住、把用户引向「换网络」这个错误方向。
  const body = queryJson(query);
  // 知网一页上限是 50，所以 `limit` 也封顶在 50 —— 不是「请求 20 条但允许传 999」。
  // 不封顶的话调用方会以为自己拿到了 999 条（客户端 slice 一个更大的数组），
  // 而站点根本不会给那么多。
  const limit = Math.min(Math.max(Math.trunc(Number(query.limit)) || 20, 1), MAX_PAGE_SIZE);
  const db = query.type ? TYPES[query.type] : ALL;
  const sortField = SORTS[query.sort ?? 'relevance'] ?? SORTS.relevance;

  await session.ensure();

  const form = new URLSearchParams({
    boolSearch: 'true',
    QueryJson: body,
    pageNum: '1',
    // 站点一页最多 50 条：超过 20 就按 50 请求，否则按 20。
    pageSize: limit > 20 ? '50' : '20',
    sortField,
    sortType: 'desc',
    dstyle: 'listmode',
    productStr: '',
    aside: '',
    searchFrom: `资源范围：${query.type ?? '总库'};`,
    CurPage: '1',
  });

  const response = await session.request(`${KNS}/brief/grid`, {
    method: 'POST',
    body: form.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${KNS}/AdvSearch?classid=${db.classid}`,
      Origin: 'https://kns.cnki.net',
      Accept: 'text/html',
    },
  });

  if (response.status === 429) {
    throw new CnkiError('RATE_LIMIT', '知网限流了（HTTP 429）。等几分钟再试。', { status: 429 });
  }
  if (response.status !== 200) {
    throw new CnkiError('HTTP', `知网检索 HTTP ${response.status}`, { status: response.status });
  }
  // 被带去滑块验证时，页面上没有结果表格，而是验证组件。
  if (/滑块|slider|verify/i.test(response.text) && !/<tbody/i.test(response.text)) {
    throw new CnkiError('NEEDS_USER', '知网要求滑块验证。请先在浏览器里打开知网检索一次，再回来重试。');
  }

  const parsed = parseGrid(response.text, query.type);
  return {
    total: parsed.total,
    papers: parsed.papers.slice(0, limit),
    matchedBy: query.keyword ? `主题：${allOf(query.keyword)}` : describeQuery(query),
  };
}

/**
 * 把实际生效的检索条件写成一句话（用于 `matchedBy`）。
 *
 * `matchedBy` 只在 `keyword` 时给「主题：…」是上游行为，但那种写法对其他三种条件
 * 会退化成「见查询条件」——对调用方零信息量。这里改成列出真正用过的字段。
 *
 * @param query - 查询对象。
 * @returns 描述文本。
 */
function describeQuery(query) {
  const parts = [];
  if (query.title) parts.push(`篇名：${allOf(query.title)}`);
  if (query.author) parts.push(`作者：${query.author}`);
  if (query.source) parts.push(`来源：${query.source}`);
  if (query.type) parts.push(`类型：${query.type}`);
  if (query.years) parts.push(`年份：${query.years[0]}-${query.years[1]}`);
  if (query.core?.length) parts.push(`来源类别：${query.core.join('、')}`);
  return parts.length ? parts.join('，') : '见查询条件';
}
