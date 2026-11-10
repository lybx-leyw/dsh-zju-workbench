/**
 * 学校订购的电子图书：有没有某本书的电子版、在哪个平台，给出平台上的直达地址。
 *
 * # 分层（D17）
 *
 * 纯只读数据源：只查找，不下载、不打开全文。不注册 AI 工具、无写操作。
 *
 * # 两个来源（照上游 `ebook/index.ts` 的实测记录）
 *
 * **一、图书馆电子书刊导航**（Serials Solutions 360）
 *
 * `GET /?V=1.0&N=<每页条数>&tab=BOOKS&L=GK4PB6YY8Y&S=<方式>&C=<词>`，翻页加 `&sortby=SB_T&B=<起始>`。
 *
 * `S` 的取值：`A_T_B` 标题开头为、`A_T_M` 标题等于、`T_W_A` 标题包含所有词、`I_M` ISBN 等于。
 *
 * ⚠️ **含汉字的书名用「包含所有词」35 秒没有响应**（2026-10-07 实测四个词都如此），
 * 所以中文按开头匹配；不含汉字的开头匹配不够数时再按包含补。
 * 每页 100 条要 10 秒以上、20 条约 2.7 秒，所以一页取 20 条。
 *
 * **二、超星电子书**（`www.sslibrary.com`，汇雅）
 *
 * 导航的书目里没有它，所以单独查。
 * `GET /book/search/do?sw=<词>&field=<1 书名|all 全文>&page=1&pagesize=<n>`，
 * 返回 `{success, data:{result, total, maxpage}}`。书名是**包含**匹配，
 * 正好补上导航对中文只能按开头匹配的不足。
 *
 * # 两个站都按 IP 认证
 *
 * 校外出口分别被转到 Serials Solutions 的登录页和超星的登录页，所以 `network: campus`
 * —— 校外要经 WebVPN。这一点与上游声明一致。
 */

/** 电子书刊导航的主机（库代码 `GK4PB6YY8Y` 在 URL 里）。 */
export const NAVIGATOR_HOST = 'gk4pb6yy8y.search.serialssolutions.com';
/** 超星电子书。 */
export const CHAOXING_HOST = 'www.sslibrary.com';
/** 导航的库代码。 */
const LIBRARY = 'GK4PB6YY8Y';
/** 每页条数：100 条要 10 秒以上，20 条约 2.7 秒。 */
const PAGE = 20;
/** 最多翻几页。 */
const MAX_PAGES = 6;
/**
 * 单个请求的超时。
 *
 * 上游为这两个站设了 30 秒（index.ts:91-96），因为「站点在海外、链路不稳」；
 * 本仓沿用同值。**这个数必须有依据**：没有超时的话，本包自己注释里写的
 * 「含汉字用 T_W_A 35 秒无响应」会让连接无限挂起。
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/** 超星的站点号。 */
const CHAOXING_SITE = '383503';
/** 两个来源的展示名。 */
export const NAVIGATOR_NAME = '电子书刊导航';
export const CHAOXING_NAME = '超星电子书';

/** 本包的统一错误形状。 */
export class EbookError extends Error {
  /**
   * @param code - 稳定错误码。
   * @param message - 给人看的一句话。
   * @param details - 附加信息。
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EbookError';
    this.code = code;
    this.details = details;
  }
}

/**
 * 图书馆导航页对这几个平台写明的用法（2026-10-07 摘录）。
 *
 * 没写明的平台不加说明 —— 编一句「怎么用」比不说更糟。
 */
const ACCESS = Object.freeze({
  科学文库: '要先在平台注册并登录，登录后可以下载',
  书递: '用统一身份认证登录，校内外都能打开；在线阅读，每本限 5 人同时',
});

/**
 * 去标签、解实体、压空白。
 *
 * # 为什么不能只写几条 replace
 *
 * 手写 `&amp;` / `&lt;` / `&gt;` / `&quot;` / `&#39;` 五条会漏掉 HTML 里实际存在的
 * 大类：**数字字符引用**（`&#20043;`、`&#x9053;`）与命名实体（`&ldquo;`、`&middot;`、
 * `&ensp;`、`&mdash;`、`&hellip;`）。中文书名与著者里这些都不罕见，漏掉就会在
 * 结果里留下字面量 `&#20043;`。
 *
 * 还有一个更隐蔽的错：**`&amp;` 必须先处理**，否则 `&amp;lt;b&amp;gt;` 会被
 * 后面的 `&lt;` → `<` 规则解成 `<b>`（双重解码）。所以顺序是
 * 「先 `&amp;` 占位 → 解其它 → 还原占位」。
 *
 * @param html - 原始 HTML 片段。
 * @returns 纯文本。
 */
const text = (html) => decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

/** 常见命名实体表（HTML4 全集里书目字段会用到的那部分）。 */
const NAMED = Object.freeze({
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  ldquo: '\u201C', rdquo: '\u201D', lsquo: '\u2018', rsquo: '\u2019',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', middot: '\u00B7',
  ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', bull: '\u2022',
  copy: '\u00A9', reg: '\u00AE', trade: '\u2122', deg: '\u00B0',
  times: '\u00D7', divide: '\u00F7', plusmn: '\u00B1', frac12: '\u00BD',
  laquo: '\u00AB', raquo: '\u00BB', sbquo: '\u201A', bdquo: '\u201E',
});

/**
 * 解 HTML 实体：命名实体 + 十进制 + 十六进制数字引用。
 *
 * `&amp;` 用占位符法避免双重解码 —— 先把它换成不可能出现在正文里的哨兵，
 * 其余规则跑完再换回来。
 *
 * @param input - 含实体的字符串。
 * @returns 解码后的字符串。
 */
export function decodeEntities(input) {
  const GUARD = '\u0000AMP\u0000';
  return String(input ?? '')
    .replace(/&amp;/gi, GUARD)
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => codePoint(parseInt(hex, 16), match))
    .replace(/&#(\d+);/g, (match, dec) => codePoint(Number(dec), match))
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name) => NAMED[name.toLowerCase()] ?? match)
    .replaceAll(GUARD, '&');
}

/**
 * 把码点转字符；越界或非法时原样返回（不吞掉它，让用户看见问题）。
 *
 * @param value - 码点。
 * @param fallback - 原样返回的字符串。
 * @returns 字符或 fallback。
 */
function codePoint(value, fallback) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

/** 是否含汉字。 */
const cjk = (value) => /\p{Script=Han}/u.test(value);

/**
 * 取 13 位 ISBN；不足 13 位的不要。
 *
 * @param value - 原始字符串。
 * @returns ISBN，或 undefined。
 */
const isbn13 = (value) => {
  const digits = String(value ?? '').replace(/[^\dXx]/g, '');
  return digits.length === 13 ? digits : undefined;
};

/** 组装一条书目记录，空字段不写键（避免一堆 `author: ''`）。 */
const record = (fields) => {
  const out = { title: fields.title };
  for (const key of ['isbn', 'author', 'edition', 'publisher', 'year']) {
    if (fields[key]) out[key] = fields[key];
  }
  out.links = fields.links;
  return out;
};

/**
 * 解析导航的一页 HTML。
 *
 * 每条是一个 `div.SS_Holding`；书名在 `.SS_JournalTitle > strong`，
 * 平台链接是 `a.SS_JournalHyperLink`（文字是平台名，地址里的 `U=` 参数是平台上的地址）。
 *
 * @param html - 页面 HTML。
 * @returns `{ records, total }`。
 * @throws {EbookError} 被要求登录、或页面结构不对。
 */
export function parseNavigator(html) {
  // 登录页的判据要**宽松**：站点换模板时，字符串措辞会变，但「这是认证页」这件事不变。
  // 上游用的是 `Serials Solutions Authentication Service`（带 Service），
  // 而实际页面可能只是 `Serials Solutions Authentication` —— 用更短的片段更稳。
  if (/Serials Solutions Authentication/i.test(html)) {
    throw new EbookError('LOGIN_REQUIRED', '电子书刊导航要求登录：这次请求不是从学校的地址出去的');
  }
  const count = /class="SS_ResultsCount"[^>]*>\s*(\d+)/.exec(html)?.[1];
  if (count === undefined) throw new EbookError('SHAPE', '电子书刊导航没有返回检索结果页');

  const records = html.split(/<div class="SS_Holding">/).slice(1).flatMap((block) => {
    const part = (name) => text(new RegExp(`class="${name}"[^>]*>([\\s\\S]*?)</span>`).exec(block)?.[1]) || undefined;
    const title = text(/class="SS_JournalTitle"[^>]*>\s*<strong>([\s\S]*?)<\/strong>/.exec(block)?.[1]);
    const links = [...block.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*class="SS_JournalHyperLink"[^>]*>([\s\S]*?)<\/a>/g)]
      .flatMap((match) => {
        const target = /[?&](?:amp;)?U=([^&"]+)/.exec(match[1])?.[1];
        const platform = text(match[2]);
        try {
          return target ? [{ platform, url: decodeURIComponent(target), ...(ACCESS[platform] ? { access: ACCESS[platform] } : {}) }] : [];
        } catch {
          // 单个链接的 URL 解不开不值得让整页失败。
          return [];
        }
      });
    if (!title || !links.length) return [];
    // ISBN 有时写成「(7-302-62729-0, 978-7-302-62729-6)」：取 13 位的那个。
    const isbn = (part('SS_BookISBN') ?? '').replace(/[()]/g, '').split(/,\s*/).map(isbn13).find(Boolean);
    return [record({
      title,
      isbn,
      author: part('SS_Authors'),
      edition: part('SS_Edition'),
      publisher: part('SS_Publisher'),
      year: /\d{4}/.exec(part('SS_Date') ?? '')?.[0],
      links,
    })];
  });
  return { records, total: Number(count) };
}

/**
 * 把超星的一条书目转成本包的记录形状。
 *
 * 阅读方式看来源标记（与它的结果页模板一致）：`isFromNewLib` 或 `isFromZX` 有 EPUB，
 * `isFromBW` 有 PDF，`isFromBK` 有图像阅读。
 *
 * @param book - 超星返回的一条。
 * @returns 记录数组（缺 ssid 或 bookCardD 时为空）。
 */
export function chaoxingRecord(book) {
  const title = String(book?.bookName ?? '').replace(/\s+/g, ' ').trim();
  if (!title || !book.ssid || !book.bookCardD) return [];
  const formats = [
    book.isFromNewLib || book.isFromZX ? 'EPUB' : '',
    book.isFromBW ? 'PDF' : '',
    book.isFromBK ? '图像' : '',
  ].filter(Boolean);
  // 只带 ssid 会报 500，必须凑齐这几个参数。
  const url = `https://${CHAOXING_HOST}/book/card?cnFenlei=${encodeURIComponent(book.cnFenlei ?? '')}`
    + `&ssid=${book.ssid}&d=${book.bookCardD}&isFromBW=${book.isFromBW ?? ''}&fromType=&websiteId=${CHAOXING_SITE}`;
  return [record({
    title,
    isbn: isbn13(book.isbn),
    author: book.author?.trim(),
    publisher: String(book.publisher ?? '').replace(/^[^：:]*[：:]\s*/, '').trim(),
    year: /^\d{4}/.exec(String(book.date ?? ''))?.[0],
    links: [{ platform: CHAOXING_NAME, url, ...(formats.length ? { access: `在线阅读（${formats.join('、')}）` } : {}) }],
  })];
}

/**
 * 同一本书在几个平台各有一条：按 ISBN 合并；没有 ISBN 的按书名、著者、出版社合并。
 *
 * @param records - 原始记录。
 * @returns 合并后的书目（`links` 改名为 `platforms`）。
 */
export function merge(records) {
  const books = new Map();
  for (const item of records) {
    const key = item.isbn ?? [item.title, item.author ?? '', item.publisher ?? ''].join('|').toLowerCase();
    const had = books.get(key);
    if (!had) {
      books.set(key, { ...item, links: [...item.links] });
      continue;
    }
    for (const field of ['author', 'edition', 'publisher', 'year']) {
      if (!had[field] && item[field]) had[field] = item[field];
    }
    for (const link of item.links) {
      if (!had.links.some((existing) => existing.url === link.url)) had.links.push(link);
    }
  }
  return [...books.values()].map((book) => {
    const out = { title: book.title };
    for (const field of ['author', 'publisher', 'year', 'edition', 'isbn']) {
      if (book[field]) out[field] = book[field];
    }
    out.platforms = book.links;
    return out;
  });
}

/**
 * 两个来源的结果轮流取，免得一个来源把条数占满。
 *
 * @param lists - 若干数组。
 * @returns 交错后的数组。
 */
export function interleave(lists) {
  const out = [];
  for (let i = 0; lists.some((list) => i < list.length); i += 1) {
    for (const list of lists) if (i < list.length) out.push(list[i]);
  }
  return out;
}

/**
 * 查「学校订购的电子图书里有没有这本书、在哪个平台」。
 *
 * @param options.request - `(url, init) => { status, text }`，由调用方注入。
 * @param options.title - 书名或书名里的词；与 isbn 二选一。
 * @param options.isbn - ISBN，可以带连字符；与 title 二选一。
 * @param options.limit - 条数，默认 10。
 * @returns 查询结果（含 `books`、`found`、`hasMore`、`matchedBy`、`note`）。
 * @throws {EbookError} 参数不合法，或两个来源都失败。
 */
export async function searchEbooks({ request, title, isbn, limit = 10, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  const cleanIsbn = typeof isbn === 'string' ? isbn.trim() : '';
  if (Boolean(cleanTitle) === Boolean(cleanIsbn)) throw new EbookError('CONFIG', 'title 和 isbn 给一个');
  if (cleanIsbn && !/^[\dXx -]{10,17}$/.test(cleanIsbn)) {
    throw new EbookError('CONFIG', 'ISBN 应为 10 位或 13 位数字，可以带连字符');
  }
  const term = cleanIsbn || cleanTitle;

  /**
   * 给每个请求套上超时。
   *
   * # 为什么必须自己竞争，而不是只传 signal
   *
   * `sharedFetch` → `egress.fetch` → `undici.fetch` 这条链上**没有任何一层读
   * `timeoutMs`**（`egress.js` 只透传 `init` 里的 `method`/`signal`）。所以
   * 「在 init 里写 timeoutMs」是个假参数 —— 上游专门为这两个站设了 30 秒超时，
   * 本仓若不加，半开连接会无限挂起，路由连 `res.end()` 都到不了。
   *
   * ⚠️ 而且**只传 `signal` 不够**：`request` 是调用方注入的，它未必监听 signal。
   * 本仓的测试就用一个「永远不 resolve」的 request 复现了这一点 —— 那种实现下
   * `controller.abort()` 什么也不会发生，超时形同虚设。
   *
   * 所以这里做两件事：**既传 signal（让好的实现能提前取消），也自己 race 一个
   * 定时器**（保证再差的实现也一定会超时）。
   *
   * @param url - 目标地址。
   * @param init - 原请求参数（其 `signal` 会被合并进来）。
   * @returns 响应。
   * @throws {EbookError} 超时。
   */
  const withTimeout = async (url, init = {}) => {
    const controller = new AbortController();
    const outer = init.signal;
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason);
      else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
    }

    let timer;
    const timedOut = new Promise((_, fail) => {
      timer = setTimeout(() => {
        controller.abort(new Error('timeout'));
        fail(new EbookError('TIMEOUT', `请求 ${new URL(url).hostname} 超过 ${timeoutMs}ms 没有响应`, { url, timeoutMs }));
      }, timeoutMs);
    });
    // 请求正常返回时定时器那一支会迟到拒绝，同样要有人接。
    timedOut.catch(() => {});

    try {
      // race：谁先来算谁。底层若真的响应 signal，就会走 request 那一支；
      // 若它完全无视 signal，定时器这一支仍然会结束等待。
      //
      // ⚠️ 给 request 那一支挂一个空 catch：race 输掉之后它的迟到拒绝
      // 没人接，会变成 unhandledRejection（在测试里表现为进程级告警）。
      const pending = request(url, { ...init, signal: controller.signal });
      pending.catch(() => {});
      return await Promise.race([pending, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  };

  /** 导航的一页。 */
  const navigatorPage = async (mode, offset) => {
    const suffix = offset ? `&sortby=SB_T&B=${offset}` : '';
    const url = `https://${NAVIGATOR_HOST}/?V=1.0&N=${PAGE}&tab=BOOKS&L=${LIBRARY}`
      + `&S=${mode}&C=${encodeURIComponent(term)}${suffix}`;
    const response = await withTimeout(url);
    if (response.status !== 200) throw new EbookError('HTTP', `${NAVIGATOR_HOST} HTTP ${response.status}`);
    return parseNavigator(response.text);
  };

  /** 从导航读到够数；一种匹配方式不够时按包含补（仅对不含汉字的查询）。 */
  const fromNavigator = async () => {
    const records = [];
    const scan = async (mode) => {
      let total = 0;
      let read = 0;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const got = await navigatorPage(mode, page * PAGE);
        total = got.total;
        read += got.records.length;
        records.push(...got.records);
        if (!got.records.length || page * PAGE + PAGE >= total || merge(records).length > limit) break;
      }
      return { total, more: read < total };
    };
    let { total, more } = await scan(cleanIsbn ? 'I_M' : 'A_T_B');
    let matchedBy = cleanIsbn ? 'ISBN' : '书名开头';
    if (!cleanIsbn && !cjk(term) && merge(records).length < limit) {
      const wider = await scan('T_W_A');
      total = Math.max(total, wider.total);
      more = more || wider.more;
      matchedBy = '书名开头，不够时按书名包含全部词';
    }
    return { records, total, more, matchedBy };
  };

  /** 超星：书名包含匹配。ISBN 走全文检索，只留 ISBN 确实相同的。 */
  const fromChaoxing = async () => {
    const size = Math.min(Math.max(limit, 10), 40);
    const field = cleanIsbn ? 'all' : '1';
    const url = `https://${CHAOXING_HOST}/book/search/do?sw=${encodeURIComponent(term)}&allsw=&bCon=&field=${field}&searchtype=&page=1&pagesize=${size}`;
    const response = await withTimeout(url, { headers: { Referer: `https://${CHAOXING_HOST}/book/search` } });
    if (response.status !== 200) throw new EbookError('HTTP', `${CHAOXING_HOST} HTTP ${response.status}`);
    let reply;
    try {
      reply = JSON.parse(response.text);
    } catch {
      throw new EbookError(
        'LOGIN_REQUIRED',
        /登录页|showlogin/.test(response.text)
          ? '超星电子书要求登录：这次请求不是从学校的地址出去的'
          : '超星电子书没有返回检索结果',
      );
    }
    if (!reply?.success || !Array.isArray(reply.data?.result)) {
      throw new EbookError('SHAPE', '超星电子书的检索结果格式不对');
    }
    const records = reply.data.result.flatMap(chaoxingRecord);
    if (!cleanIsbn) return { records, total: Number(reply.data.total ?? 0) };
    const wanted = cleanIsbn.replace(/[^\dXx]/g, '');
    const same = records.filter((item) => item.isbn === wanted);
    return { records: same, total: same.length };
  };

  // 两个来源并行：任一成功就能给出结果，都失败才抛。
  const [navigator, chaoxing] = await Promise.allSettled([fromNavigator(), fromChaoxing()]);
  if (navigator.status === 'rejected' && chaoxing.status === 'rejected') throw navigator.reason;

  const reason = (result) => (result.reason instanceof Error ? result.reason.message : String(result.reason));
  const sourceErrors = [
    ...(navigator.status === 'rejected' ? [{ source: NAVIGATOR_NAME, error: reason(navigator) }] : []),
    ...(chaoxing.status === 'rejected' ? [{ source: CHAOXING_NAME, error: reason(chaoxing) }] : []),
  ];
  const nav = navigator.status === 'fulfilled' ? navigator.value : undefined;
  const cx = chaoxing.status === 'fulfilled' ? chaoxing.value : undefined;
  const books = merge(interleave([nav?.records ?? [], cx?.records ?? []]));
  const total = (nav?.total ?? 0) + (cx?.total ?? 0);

  /**
   * 结构漂移检测。
   *
   * # 为什么需要它
   *
   * `parseNavigator` 对每个 `div.SS_Holding` 用正则抠书名与平台链接。站点改版
   * （属性换序、class 多一个后缀、`<strong>` 上加属性）会让**每一块都匹配失败**，
   * 于是 `records` 变成空数组 —— 而 `total` 仍然是从 `SS_ResultsCount` 里读到的真数。
   *
   * 结果就是「有 42 条，返回 0 本」，而且下游看到的 `total` 是 42，
   * 所以「没有结果说明没这本书」那句提示**也不会出现**（它只在 `total === 0` 时拼）。
   * 用户看到的是「0 本」且没有任何解释。
   *
   * 这里把「计数说有、实际解析出 0」这件事显式标出来，让调用方能区分
   * 「真的没有这本书」与「这个来源这次没解析到东西」。
   */
  const drift = [];
  if (nav && nav.total > 0 && nav.records.length === 0) {
    drift.push({ source: NAVIGATOR_NAME, reported: nav.total, parsed: 0, reason: '页面结构与预期不符，未解析出任何书目' });
  }
  if (cx && cx.total > 0 && cx.records.length === 0) {
    drift.push({ source: CHAOXING_NAME, reported: cx.total, parsed: 0, reason: '结果结构与预期不符，未解析出任何书目' });
  }

  return {
    books: books.slice(0, limit),
    count: Math.min(books.length, limit),
    found: {
      ...(nav ? { [NAVIGATOR_NAME]: nav.total } : {}),
      ...(cx ? { [CHAOXING_NAME]: cx.total } : {}),
    },
    hasMore: books.length > limit || Boolean(nav?.more) || (cx ? cx.total > cx.records.length : false),
    matchedBy: cleanIsbn ? 'ISBN' : `${NAVIGATOR_NAME}按${nav?.matchedBy ?? '书名开头'}，${CHAOXING_NAME}按书名包含`,
    ...(sourceErrors.length ? { sourceErrors } : {}),
    ...(drift.length ? { drift } : {}),
    note: '这是学校订购的电子图书：platforms 是有这本书全文的平台，url 是它在平台上的地址，'
      + '在校内网络或登录学校 WebVPN 后用浏览器打开，阅读或下载在平台上进行。'
      + 'access 是这个平台上怎么看，没有这一项的平台按它页面上的提示操作。'
      + 'found 是两个来源各自查到的条数，导航里同一本书在几个平台各算一条。'
      + (sourceErrors.length ? 'sourceErrors 里的来源这次没查到，结果只来自另一个来源。' : '')
      + (drift.length
        ? 'drift 里的来源**报告有条目但一条也没解析出来**，通常是页面改版 —— 这时的「0 本」不代表没有这本书，请把它当成一次失败而不是一次查询结果。'
        : '')
      + (total === 0 && !sourceErrors.length && !drift.length
        ? '没有结果说明学校订购的电子图书里没有按这个写法登记的书，不代表没有纸质书；'
          + '中文书名在导航里只按开头匹配，可以换个写法或用 ISBN 再试。'
        : ''),
  };
}
