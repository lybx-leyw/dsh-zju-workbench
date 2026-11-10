/**
 * 电子图书数据源的行为测试。
 *
 * # 测什么
 *
 * 两个来源各自的解析、合并、交错、以及「一个来源失败时仍给另一个的结果」。
 * 全部用合成 HTML / JSON —— 两个站都按 IP 认证，测试环境拿不到登录态，
 * 真实请求必然被转到登录页。
 *
 * 而「被转到登录页」这件事本身也要测：那是 `LOGIN_REQUIRED` 的来源。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NAVIGATOR_HOST, CHAOXING_HOST, NAVIGATOR_NAME, CHAOXING_NAME,
  EbookError, REQUEST_TIMEOUT_MS, chaoxingRecord, interleave, merge, parseNavigator, searchEbooks,
} from '../packages/source/ebook/src/ebook.js';

/** 一段导航结果页：一本书、两个平台。 */
const NAVIGATOR_HTML = `<div class="SS_ResultsCount">42</div>
<div class="SS_Holding">
  <span class="SS_JournalTitle"><strong>算法导论</strong></span>
  <span class="SS_BookISBN">(7-111-40701-8, 978-7-111-40701-0)</span>
  <span class="SS_Authors">Cormen</span>
  <span class="SS_Edition">3rd</span>
  <span class="SS_Publisher">机械工业出版社</span>
  <span class="SS_Date">01/01/2013</span>
  <a href="/log?x=1&U=https%3A%2F%2Fexample.edu%2Fbook%2F1" class="SS_JournalHyperLink">科学文库</a>
  <a href="/log?x=1&U=https%3A%2F%2Fexample.edu%2Fbook%2F2" class="SS_JournalHyperLink">书递</a>
</div>`;

/** 超星的一条结果。 */
const CHAOXING_ITEM = {
  bookName: '算法导论',
  author: 'Cormen',
  publisher: '出版社：机械工业出版社',
  date: '2013-01-01',
  isbn: '9787111407010',
  ssid: 'SS1',
  bookCardD: 'D1',
  cnFenlei: 'TP',
  isFromBW: true,
};

/** 造一个按 URL 分派的假 request。 */
function fakeRequest(routes) {
  const calls = [];
  const request = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    for (const [match, reply] of routes) {
      if (String(url).includes(match)) return typeof reply === 'function' ? reply(String(url)) : reply;
    }
    return { status: 404, text: '' };
  };
  return { request, calls };
}

const okNavigator = (html = NAVIGATOR_HTML) => ({ status: 200, text: html });
const okChaoxing = (items = [CHAOXING_ITEM], total = 1) => ({
  status: 200,
  text: JSON.stringify({ success: true, data: { result: items, total } }),
});

test('导航页解析：书名、ISBN 取 13 位那个、两个平台都收', () => {
  const parsed = parseNavigator(NAVIGATOR_HTML);
  assert.equal(parsed.total, 42);
  assert.equal(parsed.records.length, 1);

  const book = parsed.records[0];
  assert.equal(book.title, '算法导论');
  assert.equal(book.isbn, '9787111407010', '括号里两个号要取 13 位的');
  assert.equal(book.author, 'Cormen');
  assert.equal(book.publisher, '机械工业出版社');
  assert.equal(book.year, '2013', '从「01/01/2013」里取年份');
  assert.equal(book.links.length, 2);
  assert.equal(book.links[0].platform, '科学文库');
  assert.equal(book.links[0].url, 'https://example.edu/book/1');
  // 平台用法说明只在站点写明的平台上加。
  assert.match(book.links[0].access, /注册并登录/);
  assert.match(book.links[1].access, /统一身份认证/);
});

test('导航页要求登录时抛 LOGIN_REQUIRED（校外出口的症状）', () => {
  assert.throws(
    () => parseNavigator('<title>Serials Solutions Authentication</title>'),
    (error) => {
      assert.equal(error.code, 'LOGIN_REQUIRED');
      assert.match(error.message, /不是从学校的地址出去的/);
      return true;
    },
  );
});

test('导航页没有结果计数时抛 SHAPE，不当成空结果', () => {
  // 空结果与「页面结构变了」是两回事：前者 total=0 且条目为空，
  // 后者连计数都找不到。混为一谈会让「查不到」变成假象。
  assert.throws(() => parseNavigator('<div>nothing</div>'), (error) => {
    assert.equal(error.code, 'SHAPE');
    return true;
  });
});

test('超星记录：阅读方式从来源标记推断', () => {
  const [book] = chaoxingRecord(CHAOXING_ITEM);
  assert.equal(book.title, '算法导论');
  assert.equal(book.isbn, '9787111407010');
  assert.equal(book.publisher, '机械工业出版社', '要把「出版社：」前缀去掉');
  assert.equal(book.year, '2013');
  assert.match(book.links[0].url, /ssid=SS1/);
  assert.match(book.links[0].url, /d=D1/);
  assert.match(book.links[0].url, /websiteId=383503/, '缺 websiteId 会 500');
  assert.match(book.links[0].access, /PDF/);
});

test('超星记录：缺 ssid 或 bookCardD 时丢弃，不拼出坏链接', () => {
  assert.deepEqual(chaoxingRecord({ ...CHAOXING_ITEM, ssid: undefined }), []);
  assert.deepEqual(chaoxingRecord({ ...CHAOXING_ITEM, bookCardD: undefined }), []);
  assert.deepEqual(chaoxingRecord({ ...CHAOXING_ITEM, bookName: '' }), []);
});

test('合并：同一 ISBN 的两条并成一本，平台都保留', () => {
  const merged = merge([
    { title: '算法导论', isbn: '9787111407010', links: [{ platform: 'A', url: 'u1' }] },
    { title: '算法导论（第3版）', isbn: '9787111407010', author: 'Cormen', links: [{ platform: 'B', url: 'u2' }] },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].platforms.length, 2);
  assert.equal(merged[0].author, 'Cormen', '空字段要从另一条补上');
});

test('合并：没有 ISBN 时按书名+著者+出版社合并', () => {
  const merged = merge([
    { title: 'X', author: 'Y', publisher: 'Z', links: [{ platform: 'A', url: 'u1' }] },
    { title: 'X', author: 'Y', publisher: 'Z', links: [{ platform: 'B', url: 'u2' }] },
  ]);
  assert.equal(merged.length, 1);
});

test('合并：同一条链接不重复', () => {
  const merged = merge([
    { title: 'X', isbn: '1', links: [{ platform: 'A', url: 'same' }] },
    { title: 'X', isbn: '1', links: [{ platform: 'A', url: 'same' }] },
  ]);
  assert.equal(merged[0].platforms.length, 1);
});

test('交错：两个来源轮流取', () => {
  assert.deepEqual(interleave([['a1', 'a2'], ['b1']]), ['a1', 'b1', 'a2']);
});

/* ────────────────────────────── 查询 ── */

test('查询：两个来源都成功时结果合并', async () => {
  const { request } = fakeRequest([
    [NAVIGATOR_HOST, okNavigator()],
    [CHAOXING_HOST, okChaoxing()],
  ]);
  const result = await searchEbooks({ request, title: '算法导论' });

  assert.equal(result.count, 1, '同一 ISBN 合并成一本');
  assert.equal(result.books[0].platforms.length, 3, '导航两个平台 + 超星一个');
  assert.equal(result.found[NAVIGATOR_NAME], 42);
  assert.equal(result.found[CHAOXING_NAME], 1);
  assert.match(result.note, /学校订购的电子图书/);
});

test('查询：一个来源失败时仍给另一个的结果，并记下 sourceErrors', async () => {
  const { request } = fakeRequest([
    [NAVIGATOR_HOST, { status: 500, text: '' }],
    [CHAOXING_HOST, okChaoxing()],
  ]);
  const result = await searchEbooks({ request, title: '算法导论' });

  assert.equal(result.count, 1);
  assert.equal(result.sourceErrors.length, 1);
  assert.equal(result.sourceErrors[0].source, NAVIGATOR_NAME);
  assert.match(result.note, /只来自另一个来源/);
});

test('查询：两个来源都失败时抛出（不返回空列表假装查过了）', async () => {
  const { request } = fakeRequest([
    [NAVIGATOR_HOST, { status: 500, text: '' }],
    [CHAOXING_HOST, { status: 500, text: '' }],
  ]);
  await assert.rejects(() => searchEbooks({ request, title: 'X' }), (error) => {
    assert.ok(error instanceof EbookError);
    return true;
  });
});

test('查询：title 与 isbn 必须给一个', async () => {
  const { request } = fakeRequest([]);
  await assert.rejects(() => searchEbooks({ request }), { code: 'CONFIG' });
  await assert.rejects(() => searchEbooks({ request, title: 'a', isbn: '9787111407010' }), { code: 'CONFIG' });
});

test('查询：ISBN 格式不对时抛 CONFIG', async () => {
  const { request } = fakeRequest([]);
  await assert.rejects(() => searchEbooks({ request, isbn: 'abc' }), { code: 'CONFIG' });
});

test('查询：ISBN 时导航用 I_M、超星用 all，且只留 ISBN 相同的', async () => {
  const other = { ...CHAOXING_ITEM, isbn: '9780000000000', ssid: 'SS9', bookCardD: 'D9' };
  const { request, calls } = fakeRequest([
    [NAVIGATOR_HOST, okNavigator()],
    [CHAOXING_HOST, okChaoxing([CHAOXING_ITEM, other], 2)],
  ]);
  const result = await searchEbooks({ request, isbn: '978-7-111-40701-0' });

  assert.ok(calls.some((call) => call.url.includes('S=I_M')), '导航要按 ISBN 查');
  assert.ok(calls.some((call) => call.url.includes('field=all')), '超星要按全文查');
  assert.equal(result.count, 1, '超星里 ISBN 不同的那条要被滤掉');
});

test('查询：中文书名不追加「包含全部词」那次扫描（站点不响应）', async () => {
  const { request, calls } = fakeRequest([
    [NAVIGATOR_HOST, okNavigator('<div class="SS_ResultsCount">0</div>')],
    [CHAOXING_HOST, okChaoxing([], 0)],
  ]);
  await searchEbooks({ request, title: '算法导论' });
  assert.equal(
    calls.some((call) => call.url.includes('S=T_W_A')),
    false,
    '含汉字的查询用「包含所有词」会 35 秒无响应，不该发',
  );
});

test('查询：英文书名开头匹配不够数时按包含补', async () => {
  // 第一页返回 0 条、total 大，触发「不够数就再扫一次」。
  const { request, calls } = fakeRequest([
    [NAVIGATOR_HOST, (url) => (url.includes('S=A_T_B')
      ? okNavigator('<div class="SS_ResultsCount">100</div>')
      : okNavigator('<div class="SS_ResultsCount">5</div>'))],
    [CHAOXING_HOST, okChaoxing([], 0)],
  ]);
  await searchEbooks({ request, title: 'introduction' });
  assert.ok(calls.some((call) => call.url.includes('S=T_W_A')), '不含汉字的查询要补一次包含扫描');
});

test('查询：超星返回登录页时抛 LOGIN_REQUIRED', async () => {
  // 让导航也失败，这样整体会抛「第一个拒绝的原因」（按实现是导航）。
  // 但要验的是**超星那条**被正确识别成 LOGIN_REQUIRED —— 所以让导航也返回登录页，
  // 两边都判成登录问题，抛出来的就该是 LOGIN_REQUIRED 而不是 HTTP。
  const { request } = fakeRequest([
    [NAVIGATOR_HOST, { status: 200, text: '<title>Serials Solutions Authentication</title>' }],
    [CHAOXING_HOST, { status: 200, text: '<html>showlogin</html>' }],
  ]);
  await assert.rejects(() => searchEbooks({ request, title: 'X' }), (error) => {
    assert.equal(error.code, 'LOGIN_REQUIRED');
    return true;
  });
});

test('查询：超星判登录页即便导航成功（结果里带上该来源的错误）', async () => {
  const { request } = fakeRequest([
    [NAVIGATOR_HOST, okNavigator()],
    [CHAOXING_HOST, { status: 200, text: '<html>showlogin</html>' }],
  ]);
  const result = await searchEbooks({ request, title: '算法导论' });
  assert.equal(result.sourceErrors.length, 1);
  assert.equal(result.sourceErrors[0].source, CHAOXING_NAME);
  assert.match(result.sourceErrors[0].error, /要求登录/);
});

/* ────────────────────────────── 审核修复的回归守卫 ── */

/**
 * 这一段守审核查出的三处缺陷（I-1/I-2 实体解码、I-3 超时、I-4 结构漂移静默）。
 *
 * 每一条都先复现缺陷、再断言修好 —— 只断言「修好之后的样子」抓不到回退。
 */

test('实体解码：命名实体与数字引用都要解，不能只解五条', () => {
  // 审核实测的原始输入。
  const html = `<div class="SS_ResultsCount">1</div>
<div class="SS_Holding">
  <span class="SS_JournalTitle"><strong>&ldquo;C++&#20043;&#x9053;&rdquo;</strong></span>
  <span class="SS_Authors">A&middot;B</span>
  <a href="/log?U=https%3A%2F%2Fx.edu%2F1" class="SS_JournalHyperLink">平台</a>
</div>`;
  const parsed = parseNavigator(html);
  assert.equal(parsed.records[0].title, '\u201CC++\u4E4B\u9053\u201D', '命名实体 + 十进制 + 十六进制都要解');
  assert.equal(parsed.records[0].author, 'A\u00B7B', '&middot; 要解');
});

test('实体解码：&amp; 不被二次解码（&amp;lt; 应得 &lt; 而不是 <）', () => {
  const html = `<div class="SS_ResultsCount">1</div>
<div class="SS_Holding">
  <span class="SS_JournalTitle"><strong>x &amp;lt;b&amp;gt;</strong></span>
  <a href="/log?U=https%3A%2F%2Fx.edu%2F1" class="SS_JournalHyperLink">平台</a>
</div>`;
  // `&amp;lt;` 解一层应当是字面量 `&lt;`，不是 `<`。
  assert.equal(parseNavigator(html).records[0].title, 'x &lt;b&gt;');
});

test('超时：请求不返回时抛 TIMEOUT，不会无限挂起', async () => {
  // 一个永不 resolve 的请求，模拟半开连接。
  const request = () => new Promise(() => {});
  const started = Date.now();
  await assert.rejects(
    () => searchEbooks({ request, title: 'x', timeoutMs: 30 }),
    (error) => {
      assert.equal(error.code, 'TIMEOUT');
      assert.match(error.message, /没有响应/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 2000, '必须在超时后很快失败');
});

test('超时：超时值可传，默认值是 30 秒（上游同值）', async () => {
  assert.equal(REQUEST_TIMEOUT_MS, 30_000);
  let seen = null;
  const request = (url, init) => {
    seen = init?.signal;
    return new Promise(() => {});
  };
  await assert.rejects(() => searchEbooks({ request, title: 'x', timeoutMs: 20 }));
  assert.ok(seen instanceof AbortSignal, '必须把 signal 传下去 —— 否则底层根本收不到取消');
});

test('结构漂移：报告有 42 条但一条没解析出来时，返回 drift 而不是静默 0 本', async () => {
  // 页面结构与预期不符：有 SS_ResultsCount，但没有 SS_Holding 块。
  const drifted = '<div class="SS_ResultsCount">42</div><div class="changed-layout">...</div>';
  const { request } = fakeRequest([
    [NAVIGATOR_HOST, { status: 200, text: drifted }],
    [CHAOXING_HOST, okChaoxing([], 0)],
  ]);
  const result = await searchEbooks({ request, title: '算法导论' });

  assert.equal(result.books.length, 0);
  assert.equal(result.found[NAVIGATOR_NAME], 42, '总数仍然如实报出');
  assert.ok(Array.isArray(result.drift) && result.drift.length === 1, '必须标出漂移');
  assert.equal(result.drift[0].source, NAVIGATOR_NAME);
  assert.equal(result.drift[0].reported, 42);
  assert.match(result.note, /不代表没有这本书/, 'note 必须说清「0 本」不等于没这本书');
});

test('结构漂移：真的 0 条时不报 drift', async () => {
  const empty = '<div class="SS_ResultsCount">0</div>';
  const { request } = fakeRequest([
    [NAVIGATOR_HOST, { status: 200, text: empty }],
    [CHAOXING_HOST, okChaoxing([], 0)],
  ]);
  const result = await searchEbooks({ request, title: '不存在的书' });
  assert.equal(result.drift, undefined, '真空结果不是漂移');
  assert.match(result.note, /不代表没有纸质书/);
});
