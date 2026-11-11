/**
 * 校内通知公告数据源的行为测试。
 *
 * ⚠️ 本文件夹具按上游注释推断，未经真实响应验证。
 *
 * 上游 `packages/vendor/zju-assistant/core/zju/lib/notice/adapters/webplus.ts` 的
 * 文件头描述了网站群的页面结构（`#wp_paging_w<n>` 分页条、`<em class="all_pages">`
 * 计数、条目是「分页条之前紧挨着的一组同级元素」、文章地址 `/<年>/<月日>/c<栏目>a<文章号>/page.htm`）。
 * 下面的夹具按**那段描述**写，不是按本仓实现写的 —— 但上游没有留下真实页面样本，
 * 所以**它们仍然是推断的**：真实站点的类名、嵌套层级、日期写法可能不同。
 * 这一点已写进 README 的「已知限制」。
 *
 * 测试全部用假 `request`，不联网：这些站点在校内，且一部分站点质量参差（会超时）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAS_HOST, NoticeError, NoticeSource, QUICK_MS, SLOW_MS, SOURCES, ZDBK_HOST,
  abbreviates, articleId, catalogInfo, collegeCatalog, collegeSources, dateOf, decodeEntities,
  describePicks, detailUrl, elementsOf, extractLinks, findCollege, hostTable, htmlToText,
  isAttachment, isInternalAddress, keywordTerms, kyjsNotice, listColumn, listQuery, listZdbk,
  mapLimit, mergeNotices, networkOf, normalizeProfile, parseArticle, parseHtml, parseItem,
  parseList, patiently, rawText, sameNotice, selectSources, sourceOf, splitPhrases,
  titleKey, withFullTitles, withTimeout,
} from '../../../packages/source/notice/src/notice.js';
import { ROUTE_PATH, apply } from '../../../packages/source/notice/src/index.js';

/* ────────────────────────────── 假请求 ── */

/**
 * 造一个按路由表应答的假 `request`。
 *
 * 路由表是 `[匹配片段, 应答]`；应答可以是对象或函数。没有命中的一律 404 ——
 * **不给默认的 200 空页**：那样会让「忘了写路由」表现成「页面解析成功但空」，
 * 恰好是最难查的一种假绿。
 *
 * @param routes - 路由表。
 * @returns `{ request, calls }`。
 */
/**
 * 假请求的路由命中方式。
 *
 * 支持字符串（子串包含）与函数（拿整个 call 判）两种，**返回 `hit`**。
 * 早先这里写成 `return typeof reply === 'function' ? reply(entry) : reply` ——
 * 把**应答函数**当成了「命中判据函数」，于是「用函数当匹配器」的路由永远命中，
 * 那条 CAS 登录测试的 302 从来没生效过。
 */
function matches(match, entry) {
  if (typeof match === 'function') return match(entry) === true;
  if (match instanceof RegExp) return match.test(entry.url);
  return entry.url.includes(match);
}

function fakeRequest(routes = []) {
  const calls = [];
  const request = async (url, init = {}) => {
    const entry = { url: String(url), method: (init.method ?? 'GET').toUpperCase(), body: init.body, headers: init.headers };
    calls.push(entry);
    for (const [match, reply] of routes) {
      if (!matches(match, entry)) continue;
      return typeof reply === 'function' ? reply(entry) : reply;
    }
    return { status: 404, headers: new Map(), text: 'not found' };
  };
  return { request, calls };
}

/** 一个 200 的 HTML 应答。 */
const page = (html) => ({ status: 200, headers: new Map(), text: html });

/* ────────────────────────────── 网站群列表页夹具 ── */

/**
 * 造一个网站群栏目列表页。
 *
 * 结构照上游描述：一个容器里一串同级 `<li>`，每个里面包含 `<a href="/2026/0930/c76425a12345/page.htm">`
 * 与一个只放日期的 `<span>`；容器之后是分页条 `#wp_paging_w1`。
 *
 * @param options - `{ entries, total?, per?, curr?, pages?, base? }`。
 * @returns HTML。
 */
function webplusListHtml({ entries, total, per, curr = 1, pages = 1, base = 'c76425' }) {
  const items = entries.map((entry) => `        <li class="news-item">
          <a href="${entry.href ?? `/2026/${entry.monthDay ?? '0930'}/${base}a${entry.id}/page.htm`}" title="${entry.title}">${entry.title}</a>
          <span class="date">${entry.shown ?? entry.date}</span>
        </li>`).join('\n');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>学籍管理</title></head>
<body>
  <div class="nav"><a href="/index.htm">首页</a><a href="/76425/list.htm">学籍管理</a></div>
  <div class="content">
      <ul class="news-list">
${items}
      </ul>
  </div>
  <div id="wp_paging_w1">
    <em class="all_pages">${pages}</em>
    <em class="all_count">${total ?? entries.length}</em>
    <em class="per_count">${per ?? entries.length}</em>
    <em class="curr_page">${curr}</em>
    <a href="list.htm">上一页</a>
  </div>
</body>
</html>`;
}

/** 三条标准条目。 */
const THREE = [
  { id: '12345', title: '关于2026年秋冬学期学籍异动办理的通知', date: '2026-09-30' },
  { id: '12346', title: '关于本科生学籍信息核对的通知', date: '2026-09-28' },
  { id: '12347', title: '关于2026级新生学籍注册的通知', date: '2026-09-25' },
];

/* ────────────────────────────── 纯函数：实体与文本 ── */

test('decodeEntities：命名实体、十进制、十六进制都要解，且 &amp; 不能双重解码', () => {
  assert.equal(decodeEntities('&amp;'), '&');
  assert.equal(decodeEntities('&#20043;&#x9053;'), '之道');
  assert.equal(decodeEntities('&ldquo;通知&rdquo;'), '\u201C通知\u201D');
  assert.equal(decodeEntities('&nbsp;'), ' ');
  // 关键：这条如果实现成「先解 &lt; 再解 &amp;」就会得到 '<b>'，那是双重解码。
  assert.equal(decodeEntities('&amp;lt;b&amp;gt;'), '&lt;b&gt;');
  // 不认识的实体原样留着，不吞掉。
  assert.equal(decodeEntities('&notarealentity;'), '&notarealentity;');
  // 越界码点原样返回。
  assert.equal(decodeEntities('&#1114112;'), '&#1114112;');
});

test('parseHtml：能建出父子与兄弟关系，且容忍未闭合标签', () => {
  const root = parseHtml('<div><p>一<p>二</div><span>三</span>');
  const div = elementsOf(root).find((node) => node.tag === 'div');
  assert.ok(div, '要有 div');
  const ps = div.children.filter((node) => node.tag === 'p');
  // <p> 隐含关闭：两个 p 是兄弟而不是嵌套。
  assert.equal(ps.length, 2);
  assert.equal(htmlToText(ps[0]), '一');
  assert.equal(htmlToText(ps[1]), '二');
  // 第二个 p 的父节点仍是 div（不是第一个 p）。
  assert.equal(ps[1].parent.tag, 'div');
});

test('parseHtml：注释、script 里的尖括号、单引号属性、裸 < 都不崩', () => {
  const root = parseHtml(`<!-- <div>注释里的标签</div> -->
<script>if (a < b && c > d) { document.write('<p>x</p>'); }</script>
<a href='/x/1.htm' title='单引号'>链接</a>
<p>a < b</p>`);
  const anchor = elementsOf(root).find((node) => node.tag === 'a');
  assert.equal(anchor.attrs.href, '/x/1.htm');
  assert.equal(anchor.attrs.title, '单引号');
  // script 内容不进文本
  assert.ok(!htmlToText(root).includes('document.write'));
  // 裸 `<` 保留成文本
  assert.ok(htmlToText(root).includes('a < b'), `实际是 ${JSON.stringify(htmlToText(root))}`);
});

test('htmlToText：块级换行、<br> 换行、压空白、去 script/style', () => {
  const text = htmlToText(parseHtml('<div><p>第一段</p><p>第  二段<br>换行</p><style>.a{}</style></div>'));
  // 块级标签前后各一个换行（于是段落之间是空行）；<br> 只是**一个**换行。
  assert.equal(text, '第一段\n\n第 二段\n换行');
});

test('rawText：不插块级换行（日期判断依赖这一点）', () => {
  assert.equal(rawText(parseHtml('<li><span>2026</span>-<span>09</span></li>')), '2026-09');
  assert.equal(rawText(parseHtml('<li><em>置顶</em><span>正文</span></li>')), '置顶正文');
});

/* ────────────────────────────── 纯函数：附件与链接 ── */

test('isAttachment：下载接口与文档后缀；普通页面不算', () => {
  assert.equal(isAttachment('https://x/file_download.html?a=1'), true);
  assert.equal(isAttachment('https://x/downloadatt?id=2'), true);
  assert.equal(isAttachment('https://x/a.PDF'), true);
  assert.equal(isAttachment('https://x/a.docx'), true);
  assert.equal(isAttachment('https://x/a.zip?x=1'), true);
  assert.equal(isAttachment('https://bksy.zju.edu.cn/76425/list.htm'), false);
  assert.equal(isAttachment('https://x/2026/0930/c76425a1/page.htm'), false);
  // 后缀在路径中间不算（`a.pdf/list.htm` 是网页）。
  assert.equal(isAttachment('https://x/a.pdf/list.htm'), false);
});

test('extractLinks：相对路径按 base 补全；javascript: 与 # 跳过；图片记成 [图片]', () => {
  const root = parseHtml(`<div>
    <a href="/a/1.htm">甲</a>
    <a href="b/2.htm">乙</a>
    <a href="javascript:void(0)">丙</a>
    <a href="#">丁</a>
    <img src="../img/x.png">
  </div>`);
  const links = extractLinks(root, 'https://x.zju.edu.cn/2026/list.htm');
  assert.deepEqual(links.map((link) => link.text), ['甲', '乙', '[图片]']);
  assert.equal(links[0].url, 'https://x.zju.edu.cn/a/1.htm');
  assert.equal(links[1].url, 'https://x.zju.edu.cn/2026/b/2.htm');
  assert.equal(links[2].url, 'https://x.zju.edu.cn/img/x.png');
});

/* ────────────────────────────── 纯函数：文章号与日期 ── */

test('articleId：网站群文章取 wp-<文章号>；外链与附件用链接本身', () => {
  assert.equal(articleId('https://bksy.zju.edu.cn/2026/0930/c76425a12345/page.htm'), 'wp-12345');
  assert.equal(articleId('https://x/2026/0930/czxtz_1a999/page.psp'), 'wp-999');
  assert.equal(articleId('https://kyjs.zju.edu.cn/#/news?id=7'), 'https://kyjs.zju.edu.cn/#/news?id=7');
  assert.equal(articleId('https://x/f.pdf'), 'https://x/f.pdf');
});

test('dateOf：四种写法都要认（全日期 / 两位年 / 只有年月 / 年月与日分开）', () => {
  const make = (inner) => parseHtml(`<li>${inner}</li>`).children[0];
  // 1. 标准全日期，三种分隔符
  assert.equal(dateOf(make('<a href="/a">t</a><span>2026-09-30</span>'), 'https://x/a'), '2026-09-30');
  assert.equal(dateOf(make('<a href="/a">t</a><span>2026.09.30</span>'), 'https://x/a'), '2026-09-30');
  assert.equal(dateOf(make('<a href="/a">t</a><span>2026年9月30日</span>'), 'https://x/a'), '2026-09-30');
  // 2. 两位年
  assert.equal(dateOf(make('<a href="/a">t</a><span>22-09-05</span>'), 'https://x/a'), '2022-09-05');
  // 3. 只有年月：日从文章地址取（同月时，**地址里的日优先**）
  const url = 'https://x/2026/0912/c76425a7/page.htm';
  assert.equal(dateOf(make('<a href="/a">t</a><span>2026-09</span>'), url), '2026-09-12');
  // 3b. 地址里的月份和页面写的不一致时，才退回页面上单独成段的「日」
  assert.equal(
    dateOf(make('<a href="/a">t</a><span>2026-10</span><span class="day">07</span>'), url),
    '2026-10-07',
    '月份不同 → 用页面上那个「07」，而不是地址里的 0912',
  );
  // 3c. 连「日」都没有时退回 1 号，而不是编一个日期
  assert.equal(dateOf(make('<a href="/a">t</a><span>2026-10</span>'), url), '2026-10-01');
  // 4. 年月与日拆成两个元素：`2026` + `9-30`
  assert.equal(dateOf(make('<a href="/a">t</a><span>2026</span><span>9-30</span>'), 'https://x/a'), '2026-09-30');
  // 越界日期不给日期，而不是给一个假日期
  assert.equal(dateOf(make('<a href="/a">t</a><span>2026-13-40</span>'), 'https://x/a'), undefined);
});

test('dateOf：链接文字里的日期不该被当成条目日期前缀残留', () => {
  // 上游 parseItem 会去掉链接文字末尾的日期；这里只验日期本身仍然读得到。
  const item = parseHtml('<li><a href="/2026/0930/c76425a5/page.htm">关于选课的通知 2026-09-30</a><span>2026-09-30</span></li>').children[0];
  assert.equal(dateOf(item, 'https://x/2026/0930/c76425a5/page.htm'), '2026-09-30');
});

/* ────────────────────────────── 网站群适配器：分页与条目 ── */

test('parseList：按分页条算条数，解析出全部条目', () => {
  const html = webplusListHtml({ entries: THREE });
  const result = parseList(html, 'https://bksy.zju.edu.cn/76425/list.htm');
  assert.equal(result.items.length, 3);
  assert.equal(result.pages, 1);
  assert.equal(result.total, 3);
  assert.deepEqual(result.items.map((item) => item.id), ['wp-12345', 'wp-12346', 'wp-12347']);
  assert.equal(result.items[0].title, '关于2026年秋冬学期学籍异动办理的通知');
  assert.equal(result.items[0].date, '2026-09-30');
});

test('parseList：最后一页的条数是 total - per*(pages-1)，不是 per', () => {
  // 3 页、每页 2 条、共 5 条 → 第 3 页只有 1 条。若实现误用 `per`（2），会去找 2 条兄弟，
  // 找不到就抛错 —— 这条测试就是用来区分「算对了」与「照抄 per」的。
  const html = webplusListHtml({
    entries: [{ id: '90001', title: '最后一页唯一的一条通知', date: '2026-01-05' }],
    total: 5,
    per: 2,
    curr: 3,
    pages: 3,
  });
  const result = parseList(html, 'https://x/list3.htm');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].date, '2026-01-05');
});

test('parseList：条数对不上 → DRIFT（不是静默返回空列表）', () => {
  // 页面说本页 3 条，但 DOM 里只有 2 个条目。真实场景就是「站点改版」。
  const html = webplusListHtml({ entries: THREE.slice(0, 2), total: 3, per: 3 });
  assert.throws(() => parseList(html, 'https://x/list.htm'), (error) => {
    assert.equal(error.code, 'DRIFT', '必须是 DRIFT，不是 SHAPE：页面说有、实际解析不出来');
    assert.match(error.message, /2|3/);
    return true;
  });
});

test('parseList：页面说 2 条、却一条也没解析出来 → DRIFT（ebook 式的结构漂移检测）', () => {
  // 分页条说 2 条，但条目容器里只有纯文本、没有链接。绝不能返回空数组让用户以为「没有通知」。
  const html = `<!DOCTYPE html><html><body>
    <div class="content">
      <div class="news-list"><div>关于甲的通知</div><div>关于乙的通知</div></div>
    </div>
    <div id="wp_paging_w1">
      <em class="all_pages">1</em><em class="all_count">2</em><em class="per_count">2</em><em class="curr_page">1</em>
    </div>
  </body></html>`;
  assert.throws(() => parseList(html, 'https://x/list.htm'), (error) => {
    assert.equal(error.code, 'DRIFT');
    assert.match(error.message, /一条也没解析出来|找不到/);
    return true;
  });
});

test('parseList：没有分页条 → SHAPE，且文案说清「无法确认条目范围」', () => {
  assert.throws(() => parseList('<html><body><div>nothing</div></body></html>', 'https://x/list.htm'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /分页/);
    return true;
  });
});

test('parseList：网站群的错误提示页要说出来是哪一页', () => {
  const html = '<html><body><div class="wp_error_msg">该栏目不存在或已删除</div></body></html>';
  assert.throws(() => parseList(html, 'https://x/99999/list.htm'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /该栏目不存在或已删除/);
    assert.equal(error.details.url, 'https://x/99999/list.htm');
    return true;
  });
});

test('parseItem：标题缺日期时抛 SHAPE 并带上条目链接', () => {
  const item = parseHtml('<li><a href="/c1a2/page.htm">没有日期的通知标题足够长</a></li>').children[0];
  assert.throws(() => parseItem(item, 'https://x/list.htm'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /标题或日期/);
    assert.equal(error.details.href, '/c1a2/page.htm');
    return true;
  });
});

/* ────────────────────────────── listColumn：翻页与筛选 ── */

test('listColumn：单页按关键词与日期筛选，按日期由新到旧', async () => {
  const html = webplusListHtml({ entries: THREE });
  const { request } = fakeRequest([['/76425/list.htm', page(html)]]);
  const source = { id: 'bksy', name: '本科生院', adapter: 'webplus', base: 'https://bksy.zju.edu.cn' };
  const column = { id: '76425', name: '学籍管理' };

  const all = await listColumn({
    get: async (url) => ({ ...(await request(url)), url }),
    source,
    column,
    query: { terms: [], limit: 10 },
  });
  assert.equal(all.notices.length, 3);
  assert.deepEqual(all.notices.map((notice) => notice.date), ['2026-09-30', '2026-09-28', '2026-09-25']);
  assert.equal(all.notices[0].source, '本科生院·学籍管理');
  assert.equal(all.notices[0].sourceId, 'bksy');

  const filtered = await listColumn({
    get: async (url) => ({ ...(await request(url)), url }),
    source,
    column,
    query: { terms: ['学籍信息核对'], limit: 10 },
  });
  assert.equal(filtered.notices.length, 1);
  assert.equal(filtered.notices[0].date, '2026-09-28');

  const windowed = await listColumn({
    get: async (url) => ({ ...(await request(url)), url }),
    source,
    column,
    query: { terms: [], since: '2026-09-26', limit: 10 },
  });
  assert.equal(windowed.notices.length, 2);
  assert.ok(windowed.notices.every((notice) => notice.date >= '2026-09-26'), '全部在窗口内');
});

test('listColumn：limit 会截断，且 hasMore 为 true（不能只靠 items.every）', async () => {
  const html = webplusListHtml({ entries: THREE });
  const { request } = fakeRequest([['/76425/list.htm', page(html)]]);
  const result = await listColumn({
    get: async (url) => ({ ...(await request(url)), url }),
    source: { id: 'bksy', name: '本科生院', adapter: 'webplus', base: 'https://bksy.zju.edu.cn' },
    column: { id: '76425', name: '学籍管理' },
    query: { terms: [], limit: 2 },
  });
  assert.equal(result.notices.length, 2, '长度必须有断言 —— 只写 every() 在空数组上永真');
  assert.equal(result.hasMore, true);
});

test('listColumn：unordered 栏目要读完全部页（顺序不代表时间）', async () => {
  const first = webplusListHtml({
    entries: [{ id: '1', title: '甲通知足够长的标题内容', date: '2026-09-01' }],
    total: 3,
    per: 1,
    curr: 1,
    pages: 3,
  });
  const second = webplusListHtml({
    entries: [{ id: '2', title: '乙通知足够长的标题内容', date: '2026-09-05' }],
    total: 3,
    per: 1,
    curr: 2,
    pages: 3,
  });
  const third = webplusListHtml({
    entries: [{ id: '3', title: '丙通知足够长的标题内容', date: '2026-08-20' }],
    total: 3,
    per: 1,
    curr: 3,
    pages: 3,
  });
  const seen = [];
  const result = await listColumn({
    get: async (url) => {
      seen.push(url);
      if (url.endsWith('list.htm')) return { ...page(first), url };
      if (url.endsWith('list2.htm')) return { ...page(second), url };
      if (url.endsWith('list3.htm')) return { ...page(third), url };
      return { status: 404, text: '', url };
    },
    source: { id: 'bksy', name: '本科生院', adapter: 'webplus', base: 'https://bksy.zju.edu.cn' },
    column: { id: '76425', name: '学籍管理', unordered: true },
    query: { terms: [], limit: 10 },
  });
  assert.deepEqual(seen, [
    'https://bksy.zju.edu.cn/76425/list.htm',
    'https://bksy.zju.edu.cn/76425/list2.htm',
    'https://bksy.zju.edu.cn/76425/list3.htm',
  ], 'unordered 必须读完全部页');
  assert.deepEqual(result.notices.map((notice) => notice.date), ['2026-09-05', '2026-09-01', '2026-08-20'], '读完之后仍按日期排序');
});

/* ────────────────────────────── 正文解析 ── */

/** 网站群的一篇正文页（照上游描述的 portletmode 窗口 + wp_articlecontent）。 */
function webplusArticleHtml({ title, body, publisher = '本科生院', time = '2026-09-30' }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="ArticleTitle" content="${title}">
</head><body>
<div portletmode="simpleArticleAttri">
  <h2>${title}</h2>
  <div class="arti_metas"><span>发布人：${publisher}</span><span>发布时间：${time}</span><span>浏览次数：12</span></div>
</div>
<div class="wp_articlecontent">
  <p>${body}</p>
  <p><a href="/_upload/附件一.pdf">附件一</a></p>
</div>
</body></html>`;
}

test('parseArticle：网站群正文页取标题、发布者、时间、正文与附件', () => {
  const html = webplusArticleHtml({
    title: '关于2026年秋冬学期学籍异动办理的通知',
    body: '各学院：现将本学期学籍异动办理安排通知如下。',
  });
  const detail = parseArticle('wp-12345', html, 'https://bksy.zju.edu.cn/2026/0930/c76425a12345/page.htm');
  assert.equal(detail.title, '关于2026年秋冬学期学籍异动办理的通知');
  assert.equal(detail.publisher, '本科生院');
  assert.equal(detail.publishedAt, '2026-09-30');
  assert.match(detail.text, /学籍异动办理安排/);
  assert.equal(detail.contentStatus, 'full');
  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.attachments[0].text, '附件一');
  // 附件不能在 links 里重复出现（noticeView 会再滤一次，但源头就该干净）。
  assert.equal(detail.links.filter((link) => !link.attachment).length, 0);
});

test('parseArticle：信息技术中心的模板把导航栏也叫 news_con，正文要以 wp_articlecontent 为准', () => {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>通知公告</title></head><body>
  <div class="news_con"><a href="/">首页</a><a href="/90618/list.htm">通知公告</a><a href="/about">关于</a></div>
  <div class="wp_articlecontent"><p>这是真正的正文，讲的是网络维护安排。</p></div>
  </body></html>`;
  const detail = parseArticle('wp-7', html, 'https://itc.zju.edu.cn/2026/0930/c90618a7/page.htm');
  assert.match(detail.text, /真正的正文/);
  // 关键：导航栏不能进正文
  assert.ok(!detail.text.includes('首页'), `正文里混进了导航：${JSON.stringify(detail.text)}`);
  assert.equal(detail.contentStatus, 'full');
});

test('parseArticle：认不出正文容器时标 summary-only，绝不把整页当全文', () => {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="description" content="这是摘要，只有一句话。">
  <title>某通知</title></head><body><div class="nav">导航</div><div class="footer">页脚</div></body></html>`;
  const detail = parseArticle('x', html, 'https://x/a');
  assert.equal(detail.contentStatus, 'summary-only');
  assert.equal(detail.text, '这是摘要，只有一句话。');
  assert.ok(!detail.text.includes('页脚'));
});

test('parseArticle：正文容器在但没有文本时标 unavailable（不是 full）', () => {
  const html = `<html><head><meta charset="utf-8"><title>空正文</title></head><body>
  <div class="wp_articlecontent"></div></body></html>`;
  const detail = parseArticle('x', html, 'https://x/a');
  assert.equal(detail.contentStatus, 'unavailable');
  assert.equal(detail.text, '');
});

test('parseArticle：只有附件、没有文字 → attachment-only', () => {
  // 链接文字为空：正文一个字都没有，只有附件。上游的判据是 `body && text ? full`，
  // 所以「链接有字」算正文 —— 这里刻意把链接写成空的，才能覆盖 attachment-only 那一支。
  const html = `<html><head><meta charset="utf-8"><title>附件通知</title></head><body>
  <div class="wp_articlecontent"><a href="/f/a.pdf"></a></div></body></html>`;
  const detail = parseArticle('x', html, 'https://x/a');
  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.text, '');
  assert.equal(detail.contentStatus, 'attachment-only');
});

test('parseArticle：链接有文字时算 full（附件仍单列在 attachments）', () => {
  const html = `<html><head><meta charset="utf-8"><title>附件通知</title></head><body>
  <div class="wp_articlecontent"><a href="/f/a.pdf">点此下载</a></div></body></html>`;
  const detail = parseArticle('x', html, 'https://x/a');
  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.contentStatus, 'full');
});

test('parseArticle：网站群的错误页要抛出来，而不是解析成一条空通知', () => {
  const html = '<html><body><div class="wp_error_msg">您无权查看该内容</div></body></html>';
  assert.throws(() => parseArticle('x', html, 'https://x/a'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /无权查看/);
    return true;
  });
});

test('parseArticle：缺标题时抛 SHAPE，不编一个标题', () => {
  assert.throws(() => parseArticle('x', '<html><body><div class="wp_articlecontent"><p>正文</p></div></body></html>', 'https://x/a'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /缺少标题/);
    return true;
  });
});

test('parseArticle：webplus 的 pdfsrc 内嵌 PDF 要算成附件', () => {
  const html = `<html><head><meta charset="utf-8"><title>内嵌 PDF</title></head><body>
  <div class="wp_articlecontent"><p>正文在这里。</p><div pdfsrc="/_upload/x.pdf"></div></div></body></html>`;
  const detail = parseArticle('x', html, 'https://x/2026/0930/c1a2/page.htm');
  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.attachments[0].url, 'https://x/_upload/x.pdf');
  assert.equal(detail.attachments[0].text, 'PDF 附件');
});

/* ────────────────────────────── 竞赛管理系统适配器 ── */

test('kyjsNotice：不是 kyjs 链接时返回 undefined（让调用方继续走别的分支）', async () => {
  const { request } = fakeRequest([]);
  assert.equal(await kyjsNotice(request, 'https://bksy.zju.edu.cn/2026/0930/c76426a1/page.htm'), undefined);
  // 是 kyjs 但没有 newsId → 也返回 undefined
  assert.equal(await kyjsNotice(request, 'https://kyjs.zju.edu.cn/#/news'), undefined);
});

test('kyjsNotice：有 newsId 时读 JSON 接口，正文与附件都取到', async () => {
  const { request, calls } = fakeRequest([[
    '/prod-api/home/news/detail',
    {
      status: 200,
      headers: new Map(),
      text: JSON.stringify({
        code: 0,
        data: {
          title: '关于举办2026年大学生创新创业训练计划的通知',
          content: '<p>现启动本年度大创项目申报。</p><p><a href="https://x.zju.edu.cn/a">详情</a></p>',
          publishTime: '2026-09-29 10:00:00',
          accountName: '本科生院',
          files: [{ fileName: '申报书.docx', fileUrl: 'https://oss.example/申报书.docx' }],
        },
      }),
    },
  ]]);
  const detail = await kyjsNotice(request, 'https://kyjs.zju.edu.cn/news/detail?newsId=77');
  assert.equal(detail.title, '关于举办2026年大学生创新创业训练计划的通知');
  assert.equal(detail.publisher, '本科生院');
  assert.equal(detail.publishedAt, '2026-09-29 10:00:00');
  assert.match(detail.text, /大创项目申报/);
  assert.equal(detail.contentStatus, 'full');
  assert.equal(detail.attachments.length, 1);
  assert.equal(detail.attachments[0].text, '申报书.docx');
  // 请求打到的是接口，不是页面本身
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /newsId=77$/);
});

test('kyjsNotice：业务码非 0 时抛 SHAPE 并带上游 msg', async () => {
  const { request } = fakeRequest([['/prod-api/home/news/detail', {
    status: 200, headers: new Map(), text: JSON.stringify({ code: 500, msg: '系统维护' }),
  }]]);
  await assert.rejects(() => kyjsNotice(request, 'https://kyjs.zju.edu.cn/news/detail?newsId=1'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /系统维护/);
    return true;
  });
});

test('kyjsNotice：返回的不是 JSON 时抛 SHAPE', async () => {
  const { request } = fakeRequest([['/prod-api/home/news/detail', page('<html>登录页</html>')]]);
  await assert.rejects(() => kyjsNotice(request, 'https://kyjs.zju.edu.cn/news/detail?newsId=1'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /不是 JSON/);
    return true;
  });
});

/* ────────────────────────────── 教务网适配器 ── */

/**
 * 教务网 jqGrid 的一页**解析后的 JSON**。
 *
 * ⚠️ 注意这不是 HTTP 响应：`listZdbk` 收的 `post` 是**已经 parse 过**的对象
 * （HTTP 与 JSON 的判定在 `NoticeSource.postJson` 那一层）。早先这里返回的是
 * `{status, text}` 的响应形状，于是 `data.items` 恒为 undefined、结果恒为空。
 */
function zdbkPage(rows, { total = rows.length, totalPage = 1 } = {}) {
  return { items: rows, totalResult: String(total), totalPage };
}

/** 一行教务网记录。 */
const zdbkRow = (overrides = {}) => ({
  xwbh: '1001',
  xwbt: '关于2026年秋冬学期选课的通知',
  fbr: '教务处',
  fbsj: '2026-09-30 09:00',
  gglb: '本科生院通知公告',
  sfzd: '0',
  ...overrides,
});

/** 造一个教务网 `post`。 */
function zdbkPost(handler) {
  const calls = [];
  const post = async (url, form) => {
    calls.push({ url, form });
    return handler(url, form, calls.length);
  };
  return { post, calls };
}

test('listZdbk：POST 到通知列表接口，条件在表单体里，排序按 fbsj 而不是置顶', async () => {
  const { post, calls } = zdbkPost(() => zdbkPage([zdbkRow()]));
  const result = await listZdbk({
    post,
    categories: ['本科生院通知公告'],
    query: { terms: [], limit: 10 },
    fetchDetail: async () => { throw new Error('不该取详情'); },
  });
  assert.equal(result.notices.length, 1);
  assert.equal(result.notices[0].source, '教务网·本科生院通知公告');
  assert.equal(result.notices[0].sourceId, 'zdbk');
  assert.equal(result.notices[0].id, '1001');

  const call = calls[0];
  assert.match(call.url, /^https:\/\/zdbk\.zju\.edu\.cn\/jwglxt\/xtgl\/xwgl_cxXwListAlltzgg\.html\?doType=query&gnmkdm=index$/);
  assert.equal(call.form['queryModel.sortName'], 'fbsj', '排序必须按发布日期，不能用默认的「置顶优先」');
  assert.equal(call.form['queryModel.sortOrder'], 'desc');
  assert.equal(call.form.gglb, '本科生院通知公告');
});

test('listZdbk：两个类别都选时不按类别筛（gglb 为空串），且只发一次请求', async () => {
  const { post, calls } = zdbkPost(() => zdbkPage([zdbkRow()]));
  await listZdbk({
    post,
    categories: ['本科生院通知公告', '各院系通知公告'],
    query: { terms: [], limit: 10 },
    fetchDetail: async () => { throw new Error('不该取详情'); },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].form.gglb, '');
});

test('listZdbk：pinned 按 sfzd 判定，截断标题标 titleTruncated', () => {
  const rows = [
    zdbkRow({ xwbh: '2001', xwbt: '关于公布2026年推荐免试研究生...', sfzd: '1' }),
    zdbkRow({ xwbh: '2002', xwbt: '关于2026年校历调整的通知', fbsj: '2026-09-29 08:00' }),
  ];
  const { post } = zdbkPost(() => zdbkPage(rows));
  let fetched = 0;
  return listZdbk({
    post,
    categories: ['本科生院通知公告'],
    query: { terms: [], limit: 10 },
    fetchDetail: async (notice) => {
      fetched += 1;
      return {
        id: notice.id, title: '关于公布2026年推荐免试研究生拟录取名单的通知',
        publisher: '教务处', publishedAt: '2026-09-30', text: '正文', links: [], attachments: [], url: notice.url, contentStatus: 'full',
      };
    },
  }).then((result) => {
    assert.equal(result.notices.length, 2);
    // 不带关键词时**不**为了补标题去逐条取详情（那会把列表读成 N 次请求）。
    // 完整标题由 `list()` 在补正文时顺带换上（见下一个测试）。
    assert.equal(fetched, 0);
    const pinned = result.notices.find((notice) => notice.id === '2001');
    assert.equal(pinned.pinned, true);
    assert.equal(pinned.titleTruncated, true, '以 ... 结尾要标出来');
    assert.equal(pinned.externalUrl, undefined);
    const normal = result.notices.find((notice) => notice.id === '2002');
    assert.equal(normal.pinned, false);
    assert.equal(normal.titleTruncated, false);
  });
});

test('list：截断的教务网标题由正文页换成完整标题（补正文时顺带换）', async () => {
  const { source } = mountSource([
    [(entry) => entry.url.includes('xwgl_cxXwListAlltzgg'), {
      status: 200,
      headers: new Map(),
      text: JSON.stringify({
        items: [{
          xwbh: '3001',
          xwbt: '关于公布2026年推荐免试研究生...',
          fbr: '教务处',
          fbsj: '2026-09-30 09:00',
          gglb: '本科生院通知公告',
          sfzd: '0',
        }],
        totalResult: '1',
        totalPage: 1,
      }),
    }],
    ['xwgl_ckXw.html', page(`<html><head><meta charset="utf-8">
      <meta name="ArticleTitle" content="关于公布2026年推荐免试研究生拟录取名单的通知"></head><body>
      <div class="news_con"><p>名单见附件。</p></div></body></html>`)],
  ]);
  const result = await source.list({ source: '教务网', limit: 5, profile: { level: 'undergrad' } });
  assert.equal(result.count, 1);
  assert.equal(result.notices[0].title, '关于公布2026年推荐免试研究生拟录取名单的通知', '列表里的截断标题要换成完整标题');
  // noticeView 只在为真时写 `pinned`（一堆 `pinned: false` 是噪声）。
  assert.equal(result.notices[0].pinned, undefined);
});

test('withFullTitles：详情页给不出标题时保留截断标题（降级但不崩）', async () => {
  const notices = [
    { id: '3001', title: '关于公布拟录取名单...', titleTruncated: true },
    { id: '3002', title: '完整标题不需要补', titleTruncated: false },
  ];
  const cache = new Map();
  let calls = 0;
  const result = await withFullTitles(notices, {
    fetchDetail: async (notice) => {
      calls += 1;
      if (notice.id === '3001') throw new Error('取不到');
      return { title: '不该被调用', contentStatus: 'full' };
    },
    cache,
  });
  assert.equal(calls, 1, '只对截断标题取详情');
  assert.equal(result[0].title, '关于公布拟录取名单...', '取不到就保留原样');
  assert.equal(result[1].title, '完整标题不需要补');
  assert.equal(cache.size, 0);
});

test('postJson：会话失效（返回登录页 HTML）判成 AUTH_REQUIRED，不是 HTTP 或 SHAPE', async () => {
  // 正方在会话过期时不回 3xx，而是 200 + 登录页 HTML。按状态码判会把这种情况
  // 当成「解析失败」，然后一路报「JSON 无法解析」—— 归因完全错了。
  const { request } = fakeRequest([[/jwglxt\/x$/, { status: 200, headers: new Map(), text: '<html>登录页</html>' }]]);
  const source = new NoticeSource({ request });
  await assert.rejects(() => source.postJson('https://zdbk.zju.edu.cn/jwglxt/x', {}), (error) => {
    assert.equal(error.code, 'AUTH_REQUIRED');
    assert.match(error.message, /重新登录/);
    return true;
  });
});

test('postJson：401/901/902 都是 AUTH_REQUIRED（正方的非标准码）', async () => {
  for (const status of [401, 901, 902]) {
    const { request } = fakeRequest([['x', { status, headers: new Map(), text: '' }]]);
    const source = new NoticeSource({ request });
    await assert.rejects(() => source.postJson('https://zdbk.zju.edu.cn/jwglxt/x', {}), (error) => {
      assert.equal(error.code, 'AUTH_REQUIRED', `HTTP ${status} 应当判成会话失效`);
      return true;
    }, `status=${status}`);
  }
  // 其它非 200 是 HTTP
  const { request } = fakeRequest([['x', { status: 500, headers: new Map(), text: '' }]]);
  await assert.rejects(() => new NoticeSource({ request }).postJson('https://zdbk.zju.edu.cn/jwglxt/x', {}), { code: 'HTTP' });
});

test('detailUrl：带上 xwbh 且 doType=save', () => {
  assert.equal(
    detailUrl('1001'),
    'https://zdbk.zju.edu.cn/jwglxt/xtgl/xwgl_ckXw.html?xwbh=1001&doType=save',
  );
  // 编号里有特殊字符要编码
  assert.match(detailUrl('a b&c'), /\?xwbh=a%20b%26c&doType=save$/);
});

/* ────────────────────────────── 合并与去重 ── */

test('titleKey：去省略号、去【】前缀、去标点空白、去单位前缀', () => {
  assert.equal(titleKey('关于选课的通知...'), '关于选课的通知');
  assert.equal(titleKey('【置顶】关于选课的通知'), '关于选课的通知');
  assert.equal(titleKey('本科生院关于选课的通知'), '关于选课的通知');
  assert.equal(titleKey('浙江大学 关于选课的通知'), '关于选课的通知');
  assert.equal(titleKey('关于“选课”的通知（二）'), '关于选课的通知二');
});

test('sameNotice：短标题整段出现在长标题里 + 两周内 → 同一条', () => {
  const keys = new Map();
  const long = { sourceId: 'youth', date: '2026-09-30', title: '关于组织2026年暑期社会实践总结评比工作的通知' };
  const short = { sourceId: 'zdbk', date: '2026-09-28', title: '关于组织2026年暑期社会实践总结...' };
  assert.equal(sameNotice(long, short, keys), true);

  // 同一来源内不比标题 —— 即便标题一模一样也不算重复（那是两篇，编号不同）。
  const sameSource = { ...short, sourceId: 'youth' };
  assert.equal(sameNotice(long, sameSource, keys), false);

  // 超过两周不算
  const late = { ...short, date: '2026-10-20' };
  assert.equal(sameNotice(long, late, keys), false);

  // 短标题不足 8 个字不参与比较（太容易误并）
  const tiny = { sourceId: 'zdbk', date: '2026-09-28', title: '关于选课...' };
  assert.equal(sameNotice({ ...long, title: '关于选课的通知全文' }, tiny, keys), false);
});

test('mergeNotices：编号相同只留一条；跨来源近似标题按来源表顺序留先出现的', () => {
  const first = [
    { id: 'wp-1', sourceId: 'bksy', date: '2026-09-30', title: '关于组织2026年暑期社会实践总结评比工作的通知' },
    { id: 'wp-2', sourceId: 'bksy', date: '2026-09-29', title: '另一条通知' },
  ];
  const second = [
    // 同一条通知，来源不同、标题被截断
    { id: 'wp-9', sourceId: 'youth', date: '2026-09-29', title: '关于组织2026年暑期社会实践总结...' },
    // 完全不同的编号与标题
    { id: 'wp-3', sourceId: 'youth', date: '2026-09-28', title: '第三条通知' },
  ];
  const { notices, dropped } = mergeNotices([first, second]);
  assert.equal(notices.length, 3, '四条里并掉一条');
  assert.deepEqual(notices.map((notice) => notice.date), ['2026-09-30', '2026-09-29', '2026-09-28']);
  assert.equal(notices.find((notice) => notice.id === 'wp-1') !== undefined, true, '留排在前面的那条');
  assert.equal(dropped.get(first[0]).length, 1);
  assert.equal(dropped.get(first[0])[0].id, 'wp-9');
});

test('mergeNotices：空输入给空数组（不是 undefined）', () => {
  const { notices, dropped } = mergeNotices([]);
  assert.deepEqual(notices, []);
  assert.equal(dropped.size, 0);
});

/* ────────────────────────────── 关键词与查询条件 ── */

test('splitPhrases：四种分隔符都认，去重不分大小写', () => {
  assert.deepEqual(splitPhrases('学工部、团委|教务'), ['学工部', '团委', '教务']);
  assert.deepEqual(splitPhrases('A，a；B'), ['A', 'B']);
  assert.deepEqual(splitPhrases('  '), []);
});

test('keywordTerms：简称自动展开成全称（推免→免试，大创→创新训练）', () => {
  assert.deepEqual(keywordTerms('推免'), ['推免', '免试']);
  assert.deepEqual(keywordTerms('大创'), ['大创', '创新训练']);
  // 不含简称时原样
  assert.deepEqual(keywordTerms('选课'), ['选课']);
  // 多说法
  assert.deepEqual(keywordTerms('选课、考试'), ['选课', '考试']);
  assert.deepEqual(keywordTerms(undefined), []);
});

test('keywordTerms：超过 8 个说法抛 CONFIG', () => {
  assert.throws(() => keywordTerms('一、二、三、四、五、六、七、八、九'), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /最多 8 个/);
    return true;
  });
});

test('listQuery：日期必须是真日期，起始不能晚于结束，limit 在 1–200', () => {
  assert.deepEqual(listQuery({}), { terms: [], limit: 10 });
  assert.deepEqual(listQuery({ limit: 3, since: '2026-09-01' }), { terms: [], since: '2026-09-01', limit: 3 });

  for (const bad of ['2026-02-30', '2026-13-01', '2026/09/01', '2026-9-1', '不是日期']) {
    assert.throws(() => listQuery({ since: bad }), (error) => {
      assert.equal(error.code, 'CONFIG');
      return true;
    }, `${bad} 应该被拒`);
  }
  assert.throws(() => listQuery({ since: '2026-09-30', until: '2026-09-01' }), { code: 'CONFIG' });
  for (const limit of [0, 201, 1.5, -1]) {
    assert.throws(() => listQuery({ limit }), { code: 'CONFIG' }, `limit=${limit} 应该被拒`);
  }
});

/* ────────────────────────────── 数据文件 ── */

test('hosts.json 能加载，形状正确，条目有必需字段', () => {
  const table = hostTable();
  assert.equal(typeof table, 'object');
  assert.equal(Array.isArray(table.hosts), false, 'hosts 是对象（主机 → 标注），不是数组');
  assert.match(table.generatedAt, /^\d{4}-\d{2}-\d{2}$/);
  const hosts = Object.keys(table.hosts);
  // 数量写「大于 N」而不是精确值 —— 上游会继续加站点。
  assert.ok(hosts.length > 40, `主机表只有 ${hosts.length} 条，像是没读到`);
  for (const host of hosts.slice(0, 5)) {
    const entry = table.hosts[host];
    assert.ok(['public', 'campus'].includes(entry.network), `${host} 的 network 取值不对：${entry.network}`);
    assert.equal(typeof entry.cas, 'boolean', `${host} 缺 cas`);
    assert.ok(Array.isArray(entry.sites), `${host} 缺 sites`);
  }
});

test('networkOf：表里标 public 的直连，没标的按 campus（校外猜公网会让用户必然超时）', () => {
  assert.equal(networkOf('https://zhfw.zju.edu.cn/zhfw_jyjx/list.htm'), 'public');
  assert.equal(networkOf('http://bksy.zju.edu.cn/76425/list.htm'), 'campus');
  // 表里没有的主机 → campus
  assert.equal(networkOf('https://not-in-the-table.example.com/x'), 'campus');
  // 坏地址也不崩
  assert.equal(networkOf('not a url'), 'campus');
});

test('colleges.json 能加载，形状正确，栏目有必需字段', () => {
  const catalog = collegeCatalog();
  assert.ok(Array.isArray(catalog.colleges));
  assert.ok(catalog.colleges.length > 20, `学院只有 ${catalog.colleges.length} 个，像是没读到`);
  assert.equal(typeof catalog.generatedAt, 'string');

  const first = catalog.colleges[0];
  for (const field of ['id', 'name', 'faculty', 'home']) {
    assert.equal(typeof first[field], 'string', `学院缺 ${field}`);
    assert.ok(first[field].length > 0, `学院的 ${field} 是空的`);
  }
  assert.ok(Array.isArray(first.columns));
  assert.ok(first.columns.length > 0);
  for (const column of first.columns) {
    assert.equal(typeof column.id, 'string');
    assert.equal(typeof column.base, 'string');
    assert.equal(typeof column.name, 'string');
    assert.ok(['all', 'undergrad', 'grad'].includes(column.audience), `audience 取值不对：${column.audience}`);
  }
  // skipped 是「官网读不了的学院」，要给用户看
  assert.ok(Array.isArray(catalog.skipped));
});

test('collegeSources：把一个学院摊成 webplus 来源，栏目 base 优先于来源 base', () => {
  const sources = collegeSources();
  assert.ok(sources.length > 20);
  const one = sources[0];
  assert.match(one.id, /^college-/);
  assert.equal(one.adapter, 'webplus');
  // home 是 main.htm 这类页面地址，base 要是 origin
  assert.match(one.base, /^https?:\/\/[^/]+$/);
  assert.ok(one.columns.every((column) => typeof column.base === 'string' && column.base.length > 0));
});

test('catalogInfo：给出学院名单与读不了的学院', () => {
  const info = catalogInfo();
  assert.ok(info.colleges.length > 20);
  assert.ok(info.unsupported.length > 0, '上游确实有读不出来的学院，这里应当非空');
  assert.ok(info.colleges.every((name) => typeof name === 'string' && name.length > 0));
});

test('findCollege：全称、部分、简称都能找到；太短的名字不给结果', () => {
  // 全称
  const exact = findCollege('计算机科学与技术学院');
  assert.ok(exact.length >= 1);
  assert.equal(exact[0].adapter, 'webplus');
  // 部分
  assert.ok(findCollege('计算机').length >= 1);
  // 太短
  assert.deepEqual(findCollege('计'), []);
  // 完全不存在的
  assert.deepEqual(findCollege('不存在的学院名称'), []);
});

test('abbreviates：简称按字序匹配，至少两个字', () => {
  assert.equal(abbreviates('计院', '计算机科学与技术学院'), true);
  assert.equal(abbreviates('公管', '公共管理学院'), true);
  assert.equal(abbreviates('计', '计算机科学与技术学院'), false, '一个字不算简称');
  assert.equal(abbreviates('管公', '公共管理学院'), false, '字序必须一致');
});

/* ────────────────────────────── 来源选择 ── */

test('SOURCES：来源表形状正确，含 zdbk 与 webplus 两种 adapter', () => {
  assert.ok(SOURCES.length > 8);
  const adapters = new Set(SOURCES.map((source) => source.adapter));
  assert.deepEqual([...adapters].sort(), ['webplus', 'zdbk']);
  for (const source of SOURCES) {
    assert.equal(typeof source.id, 'string');
    assert.equal(typeof source.name, 'string');
    assert.match(source.base, /^https?:\/\//);
    assert.ok(source.columns.length > 0, `${source.name} 没有栏目`);
  }
  // 每个栏目必须有 default 或 feed 之一，否则它只能被指名读到 —— 那是允许的，
  // 但至少「默认集」不能为空。
  const defaults = SOURCES.flatMap((source) => source.columns.filter((column) => column.default === true));
  assert.ok(defaults.length > 5);
});

test('selectSources：不给名字时取默认集，本科生与研究生拿到不同的栏目', () => {
  const under = selectSources(undefined, { level: 'undergrad' });
  const grad = selectSources(undefined, { level: 'grad' });
  const sourcesOf = (selection) => selection.picks.map((pick) => pick.source.name);
  const columnsOf = (selection, name) => selection.picks
    .filter((pick) => pick.source.name === name)
    .flatMap((pick) => pick.columns.map((column) => column.name));

  // 来源层面就有区分：研究生拿到研工部与研究生院，本科生拿到学工部与本科生院
  assert.ok(sourcesOf(under).includes('学工部'));
  assert.ok(!sourcesOf(under).includes('研工部'), '本科生不该拿到研工部');
  assert.ok(sourcesOf(grad).includes('研工部'));
  assert.ok(!sourcesOf(grad).includes('学工部'), '研究生不该拿到学工部');

  // 栏目层面：教务网两类都只给本科生
  assert.deepEqual(columnsOf(under, '教务网'), ['本科生院通知公告', '各院系通知公告']);
  assert.deepEqual(columnsOf(grad, '教务网'), []);

  // 两侧都必须非空
  assert.ok(under.picks.length > 3);
  assert.ok(grad.picks.length > 2);
  // 默认集里不该有「即时更新」（那是 feed 档）
  assert.ok(!under.picks.flatMap((pick) => pick.columns.map((column) => column.name)).includes('即时更新'));
});

test('selectSources：feed 作用域只取 feed 栏目（卫生部的「即时更新」只在 feed 里）', () => {
  const feed = selectSources(undefined, { level: 'undergrad' }, { scope: 'feed' });
  const columns = feed.picks.flatMap((pick) => [pick.source.name, ...pick.columns.map((column) => column.name)]);
  assert.ok(columns.includes('即时更新'), '综合服务网的即时更新是 feed');
  const normal = selectSources(undefined, { level: 'undergrad' });
  const normalColumns = normal.picks.flatMap((pick) => pick.columns.map((column) => column.name));
  assert.ok(!normalColumns.includes('即时更新'), '默认集不该含「即时更新」');
});

test('selectSources：本人学院排最前（合并时留学院的那条）', () => {
  const selection = selectSources(undefined, { level: 'undergrad', college: '计算机科学与技术学院' });
  assert.ok(selection.picks.length > 0);
  assert.match(selection.picks[0].source.id, /^college-/, '本人学院必须排在第一位');
  assert.equal(selection.who.college.name, '计算机科学与技术学院');
});

test('selectSources：学院名对不上时给 hint，而不是静默不含学院', () => {
  const selection = selectSources(undefined, { level: 'undergrad', college: '不存在的学院' });
  assert.equal(selection.who.college, null);
  assert.match(selection.who.hint, /不存在的学院/);
  assert.equal(selection.picks.every((pick) => !pick.source.id.startsWith('college-')), true);
});

test('selectSources：按来源名、别名、栏目名、学院名都能选中', () => {
  const bySource = selectSources('学工部', { level: 'undergrad' });
  assert.deepEqual(bySource.picks.map((pick) => pick.source.name), ['学工部']);
  assert.equal(bySource.picks[0].columns.length, 5);

  const byAlias = selectSources('奖学金', { level: 'undergrad' });
  assert.deepEqual(byAlias.picks.map((pick) => pick.source.name), ['学工部']);
  assert.deepEqual(byAlias.picks[0].columns.map((column) => column.name), ['评奖评优']);

  const byCollege = selectSources('计算机科学与技术学院', { level: 'undergrad' });
  assert.match(byCollege.picks[0].source.id, /^college-/);

  const multi = selectSources('学工部、团委', { level: 'undergrad' });
  assert.equal(multi.picks.length, 2);
});

test('selectSources：「全部」给所有来源的栏目，加上本人学院（学院排在来源之后，与上游一致）', () => {
  const all = selectSources('全部', { level: 'undergrad', college: '计算机科学与技术学院' });
  const columns = all.picks.flatMap((pick) => pick.columns);
  const catalogColumns = SOURCES.flatMap((source) => source.columns);
  assert.equal(all.picks.length, SOURCES.length + 1);
  // ⚠️ 与默认集相反：「全部」把本人学院排在**最后**。这是上游 `select()` 的行为
  //（默认集 `[...college, ...SOURCES]`，全部集 `[...SOURCES, ...college]`），
  // 本仓照抄 —— 合并优先级因此在两种模式下不同。已在 README 的已知限制里写明。
  assert.equal(all.picks[all.picks.length - 1].source.id.startsWith('college-'), true);
  assert.equal(columns.length, catalogColumns.length + all.picks[all.picks.length - 1].columns.length,
    '「全部」= 来源表的全部栏目 + 本人学院的栏目');
});

test('selectSources：没有这个来源时抛 CONFIG，文案列出已接入的', () => {
  assert.throws(() => selectSources('不存在的地方', { level: 'undergrad' }), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /没有叫「不存在的地方」/);
    assert.match(error.message, /学工部/);
    return true;
  });
});

test('selectSources：说「学院」但没配学院 → CONFIG 且指向设置项', () => {
  assert.throws(() => selectSources('学院', { level: 'undergrad' }), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /个人档案|学院全称/);
    return true;
  });
});

test('normalizeProfile：level 只认两个值，缺省按本科生；college 空串归一成 null', () => {
  assert.deepEqual(normalizeProfile(undefined), { level: 'undergrad', college: null });
  assert.deepEqual(normalizeProfile({ level: 'grad' }), { level: 'grad', college: null });
  assert.deepEqual(normalizeProfile({ level: '瞎写' }), { level: 'undergrad', college: null });
  assert.deepEqual(normalizeProfile({ level: 'grad', college: '  ' }), { level: 'grad', college: null });
  assert.deepEqual(normalizeProfile({ college: ' 文学院 ' }), { level: 'undergrad', college: '文学院' });
});

test('describePicks：整个来源只写名字，部分栏目列出栏目名，本人学院加标注', () => {
  const selection = selectSources('学工部', { level: 'undergrad' });
  assert.deepEqual(describePicks(selection), ['学工部']);

  const partial = selectSources('奖学金', { level: 'undergrad' });
  assert.deepEqual(describePicks(partial), ['学工部：评奖评优']);

  const mine = selectSources(undefined, { level: 'undergrad', college: '计算机科学与技术学院' });
  assert.match(describePicks(mine)[0], /^计算机科学与技术学院（本人学院）/);
});

/* ────────────────────────────── 超时与并发 ── */

/**
 * ⚠️ `timeout` 不是装饰：如果 `withTimeout` 退回「只传 signal、不自己 race」，
 * 那个永远不 resolve 的 request 会让**测试进程挂住**（实测过：整轮 `node --test`
 * 卡在 120 秒不动）。挂住比红灯更糟 —— CI 只会超时，看不出是哪条。
 * 加上这个上限之后，「没 race」会变成一条明确的失败。
 */
test('withTimeout：request 永不返回时也会超时（不靠 signal）', { timeout: 5000 }, async () => {
  // 这是 ebook 踩过的坑：只传 signal 不够 —— 注入的 request 未必监听它。
  const started = Date.now();
  await assert.rejects(
    () => withTimeout(() => new Promise(() => {}), 'https://x/a', {}, 50),
    (error) => {
      assert.equal(error.code, 'TIMEOUT');
      assert.match(error.message, /超过 50ms/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 2000, '必须在预算内返回');
});

test('withTimeout：正常返回时清掉定时器，不留下迟到拒绝', async () => {
  const result = await withTimeout(async () => ({ status: 200, text: 'ok' }), 'https://x/a', {}, 10_000);
  assert.equal(result.text, 'ok');
});

test('patiently：超时重发三次后放弃，并把最后一次的错误抛出来', async () => {
  let attempts = 0;
  await assert.rejects(() => patiently(async () => {
    attempts += 1;
    throw new NoticeError('TIMEOUT', '超时');
  }, { quickMs: 5 }), (error) => {
    assert.equal(error.code, 'TIMEOUT');
    return true;
  });
  assert.equal(attempts, 3);
});

test('patiently：非传输错误立刻抛出，不重试（CONFIG 重试只是把同一次失败打三遍）', async () => {
  let attempts = 0;
  await assert.rejects(() => patiently(async () => {
    attempts += 1;
    throw new NoticeError('CONFIG', '参数不对');
  }), { code: 'CONFIG' });
  assert.equal(attempts, 1);
});

test('patiently：NETWORK 会重试，但次数有上限（不会无限等下去）', async () => {
  let attempts = 0;
  await assert.rejects(() => patiently(async () => {
    attempts += 1;
    throw new NoticeError('NETWORK', '连不上');
  }, { pauseMs: 1 }), { code: 'NETWORK' });
  assert.equal(attempts, 3, '网络错误重试到上限后把最后一次的错误抛出来');
});

test('patiently：前两次用短超时，最后一次用默认长超时', async () => {
  const budgets = [];
  await patiently(async ({ timeoutMs }) => {
    budgets.push(timeoutMs);
    if (budgets.length < 3) throw new NoticeError('TIMEOUT', '超时');
    return { status: 200, text: 'ok' };
  });
  assert.deepEqual(budgets, [QUICK_MS, QUICK_MS, undefined]);
});

test('mapLimit：保持输入顺序，且并发不超过上限', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(peak <= 3, `并发峰值 ${peak} 超过上限`);
  assert.ok(peak >= 2, '应当真的并行，而不是串行');
});

test('mapLimit：空数组与 limit 大于长度都不崩', async () => {
  assert.deepEqual(await mapLimit([], 5, async () => 1), []);
  assert.deepEqual(await mapLimit([1, 2], 99, async (value) => value), [1, 2]);
});

/* ────────────────────────────── 内网地址 ── */

test('isInternalAddress：RFC1918 三段都算内网，公网地址不算', () => {
  assert.equal(isInternalAddress('http://10.1.2.3/x'), true);
  assert.equal(isInternalAddress('http://127.0.0.1/x'), true);
  assert.equal(isInternalAddress('http://192.168.1.5/x'), true);
  assert.equal(isInternalAddress('http://172.16.0.1/x'), true);
  // 上游那条正则把这一段写成 `2d`（从 2[0-9] 打错），于是 172.20–172.29 全漏。
  assert.equal(isInternalAddress('http://172.20.1.1/x'), true, '172.20 属于 RFC1918，必须算内网');
  assert.equal(isInternalAddress('http://172.29.1.1/x'), true);
  assert.equal(isInternalAddress('http://172.31.1.1/x'), true);
  // 172.32 不是私有段
  assert.equal(isInternalAddress('http://172.32.1.1/x'), false);
  // 公网站点
  assert.equal(isInternalAddress('https://bksy.zju.edu.cn/x'), false);
  assert.equal(isInternalAddress('not a url'), false);
});

/* ────────────────────────────── sourceOf ── */

test('sourceOf：按主机找来源，栏目号对得上时带栏目名', () => {
  const withColumn = sourceOf(new URL('https://bksy.zju.edu.cn/2026/0930/c76425a12345/page.htm'));
  assert.equal(withColumn.label, '本科生院·学籍管理');
  assert.equal(withColumn.source.id, 'bksy');

  const sourceOnly = sourceOf(new URL('https://bksy.zju.edu.cn/other/page.htm'));
  assert.equal(sourceOnly.label, '本科生院');

  const zdbk = sourceOf(new URL('https://zdbk.zju.edu.cn/jwglxt/xtgl/xwgl_ckXw.html?xwbh=1'));
  assert.equal(zdbk.label, '教务网');
  assert.equal(zdbk.source.id, 'zdbk');

  const unknown = sourceOf(new URL('https://example.com/a'));
  assert.equal(unknown.label, '');
  assert.equal(unknown.source, undefined);
});

/* ────────────────────────────── 集成：list / view / new / sources ── */

/**
 * 装配一个只用假 request 的 NoticeSource。
 *
 * @param routes - 假路由表。
 * @param options - 额外选项。
 * @returns `{ source, calls }`。
 */
function mountSource(routes, options = {}) {
  const { request, calls } = fakeRequest(routes);
  const source = new NoticeSource({ request, ...options });
  return { source, calls };
}

test('list：一条 webplus 栏目，给出正文、来源说明与 profile 回写', async () => {
  const listHtml = webplusListHtml({
    entries: [{ id: '12345', title: '关于2026年秋冬学期学籍异动办理的通知', date: '2026-09-30' }],
    base: 'c76425',
  });
  const articleHtml = webplusArticleHtml({
    title: '关于2026年秋冬学期学籍异动办理的通知',
    body: '各学院：现将本学期学籍异动办理安排通知如下。',
  });
  const { source, calls } = mountSource([
    ['bksy.zju.edu.cn/76425/list.htm', page(listHtml)],
    ['bksy.zju.edu.cn/2026/0930/c76425a12345/page.htm', page(articleHtml)],
  ]);

  // 只指名**一个栏目**（而不是整个「本科生院」）：这样任务正好一条，
  // 夹具不必为同来源的另一个栏目也造页面。
  const result = await source.list({
    source: '学籍管理',
    limit: 5,
    profile: { level: 'undergrad' },
  });

  assert.equal(result.count, 1);
  assert.equal(result.status, 'complete');
  assert.equal(result.incomplete, 0);
  assert.equal(result.notices[0].title, '关于2026年秋冬学期学籍异动办理的通知');
  assert.equal(result.notices[0].date, '2026-09-30');
  assert.equal(result.notices[0].source, '本科生院·学籍管理');
  assert.equal(result.notices[0].publisher, '本科生院');
  assert.equal(result.notices[0].contentStatus, 'full');
  assert.match(result.notices[0].text, /学籍异动办理安排/);
  assert.deepEqual(result.filters.sources, ['本科生院：学籍管理']);
  assert.equal(result.profile.level, '本科生');
  assert.equal(result.profile.college, null);
  // 列表 + 正文 = 两次请求
  assert.equal(calls.length, 2);
  assert.equal('sourceErrors' in result, false, '没有失败时不该写这个键');
});

test('list：一个栏目失败不影响其它栏目，但会出现在 sourceErrors 里且 status=partial', async () => {
  const goodHtml = webplusListHtml({
    entries: [{ id: '500', title: '学工部的一条通知标题', date: '2026-09-30' }],
    base: 'c53388',
  });
  const goodArticle = webplusArticleHtml({ title: '学工部的一条通知标题', body: '正文内容。' });
  const { source } = mountSource([
    ['xgb.zju.edu.cn/53388/list.htm', page(goodHtml)],
    ['xgb.zju.edu.cn/2026/0930/c53388a500/page.htm', page(goodArticle)],
    // 53403 直接 500
    ['xgb.zju.edu.cn/53403/list.htm', { status: 500, headers: new Map(), text: 'boom' }],
  ]);
  const result = await source.list({ source: '学工部、团委', limit: 10, profile: { level: 'undergrad' } });
  // 团委整个站点都 404 → 也在 sourceErrors 里
  assert.ok(result.sourceErrors.length >= 2, `期望至少 2 条来源错误，实际 ${JSON.stringify(result.sourceErrors)}`);
  assert.equal(result.status, 'partial');
  assert.ok(result.incomplete >= 2);
  // 学工部那 5 个栏目里至少有一个读到了正文
  assert.ok(result.notices.length >= 1);
  for (const entry of result.sourceErrors) {
    assert.equal(typeof entry.code, 'string');
    assert.equal(typeof entry.error, 'string');
    assert.ok(entry.error.length > 0, '错误文案不能是空的');
  }
});

test('list：结构漂移的栏目要单列进 drift（不能混成「没有通知」）', async () => {
  const broken = `<!DOCTYPE html><html><body>
    <div class="content"><div class="news-list"><div>只有文字没有链接</div><div>第二条文字</div></div></div>
    <div id="wp_paging_w1"><em class="all_pages">1</em><em class="all_count">2</em><em class="per_count">2</em><em class="curr_page">1</em></div>
  </body></html>`;
  const { source } = mountSource([
    ['xgb.zju.edu.cn/53388/list.htm', page(broken)],
    ['xgb.zju.edu.cn/53403/list.htm', page(broken)],
    ['xgb.zju.edu.cn/53395/list.htm', page(broken)],
    ['xgb.zju.edu.cn/53396/list.htm', page(broken)],
    ['xgb.zju.edu.cn/53405/list.htm', page(broken)],
  ]);
  const result = await source.list({ source: '学工部', limit: 10, profile: { level: 'undergrad' } });
  assert.equal(result.notices.length, 0);
  assert.equal(result.status, 'partial', '解析不出来不是 complete');
  assert.ok(Array.isArray(result.drift), 'drift 必须存在');
  assert.equal(result.drift.length, 5, '五个栏目都漂移');
  assert.equal(result.drift[0].source, '学工部·最新通知');
  assert.match(result.note, /站点改版/);
});

test('view：按链接取教务网正文，正文里的相对链接按最终地址补全', async () => {
  const articleHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <meta name="ArticleTitle" content="关于2026年寒假放假安排的通知">
  </head><body>
  <div class="news_title1">发布人：校长办公室　发布时间：2026-09-30　浏览次数：99</div>
  <div class="news_con"><p>现将寒假放假安排通知如下。</p><p><a href="/_upload/安排.pdf">下载</a></p></div>
  </body></html>`;
  const { source, calls } = mountSource([[
    'xwgl_ckXw.html',
    page(articleHtml),
  ]]);
  const result = await source.view({ url: 'https://zdbk.zju.edu.cn/jwglxt/xtgl/xwgl_ckXw.html?xwbh=42' });
  assert.equal(result.count, 1);
  assert.equal(result.notices[0].title, '关于2026年寒假放假安排的通知');
  assert.equal(result.notices[0].date, '2026-09-30', '列表没日期时用正文页的发布时间');
  assert.equal(result.notices[0].publisher, '校长办公室');
  assert.equal(result.notices[0].contentStatus, 'full');
  assert.equal(result.notices[0].attachments.length, 1);
  assert.equal(result.notices[0].attachments.length, 1);
  // URL 里的非 ASCII 会被序列化成百分号编码（`安排.pdf` → `%E5%AE%89%E6%8E%92.pdf`）：
  // 这是 WHATWG URL 的规范行为，不是编码错误。断言用同样方式算出来，避免把
  // 「序列化细节」当成「实现变了」。
  assert.equal(result.notices[0].attachments[0].url, new URL('https://zdbk.zju.edu.cn/_upload/安排.pdf').href);
  assert.match(result.notices[0].attachments[0].url, /\/_upload\/.*\.pdf$/);
  // ⚠️ 用户给的链接**原样**去取，不擅自补 `doType=save`：那个参数会把该条标为已读
  // （服务端副作用），只在「按编号自己拼地址」时才加（列表那条路径，见下一个测试）。
  assert.equal(calls[0].url, 'https://zdbk.zju.edu.cn/jwglxt/xtgl/xwgl_ckXw.html?xwbh=42');
});

test('view：用 detailUrl 拼出来的地址才带 doType=save（列表那条路径）', async () => {
  const articleHtml = `<html><head><meta charset="utf-8"><meta name="ArticleTitle" content="某通知"></head>
  <body><div class="news_con"><p>正文。</p></div></body></html>`;
  const { source, calls } = mountSource([[/xwgl_ckXw/, page(articleHtml)]]);
  await source.view({ url: detailUrl('42') });
  assert.match(calls[0].url, /xwbh=42&doType=save$/);
});

test('view：多个链接用竖线分隔，各取各的', async () => {
  const article = webplusArticleHtml({ title: '甲通知的标题', body: '甲正文。' });
  const { source } = mountSource([
    ['bksy.zju.edu.cn/2026/0930/c76425a1/page.htm', page(article)],
    ['bksy.zju.edu.cn/2026/0930/c76425a2/page.htm', page(webplusArticleHtml({ title: '乙通知的标题', body: '乙正文。' }))],
  ]);
  const result = await source.view({
    url: 'https://bksy.zju.edu.cn/2026/0930/c76425a1/page.htm|https://bksy.zju.edu.cn/2026/0930/c76425a2/page.htm',
  });
  assert.equal(result.count, 2);
  assert.equal(result.notices[0].title, '甲通知的标题');
  assert.equal(result.notices[1].title, '乙通知的标题');
});

test('view：链接指向内网地址 → 明确说读不到，不去等超时', async () => {
  const { source, calls } = mountSource([]);
  const result = await source.view({ url: 'http://10.1.2.3/notice/1.htm' });
  assert.equal(result.count, 1);
  assert.match(result.notices[0].error, /内网/);
  assert.equal(calls.length, 0, '不该发出任何请求');
});

test('view：附件链接不下载，直接标成附件通知', async () => {
  const { source, calls } = mountSource([]);
  const result = await source.view({ url: 'https://zdbk.zju.edu.cn/jwglxt/file_download.html?id=9' });
  assert.equal(result.notices[0].contentStatus, 'attachment-only');
  assert.equal(result.notices[0].attachments.length, 1);
  assert.equal(calls.length, 0, '附件不该被下载');
});

test('view：标题与链接都给或都不给 → CONFIG', async () => {
  const { source } = mountSource([]);
  await assert.rejects(() => source.view({}), { code: 'CONFIG' });
  await assert.rejects(() => source.view({ title: 'a', url: 'https://x/a' }), { code: 'CONFIG' });
});

test('view：链接不是有效 URL → CONFIG，文案带上那个链接', async () => {
  const { source } = mountSource([]);
  await assert.rejects(() => source.view({ url: '不是链接' }), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /不是有效 URL/);
    assert.equal(error.details.link, '不是链接');
    return true;
  });
  await assert.rejects(() => source.view({ url: 'ftp://x/a' }), { code: 'CONFIG' });
});

test('view：按标题找不到时抛 NEEDS_USER 并给出候选结构', async () => {
  // 所有栏目都给空列表 → 一条通知也找不到
  const emptyHtml = webplusListHtml({ entries: [], total: 0, per: 10 });
  const { source } = mountSource([
    ['bksy.zju.edu.cn/76425/list.htm', page(emptyHtml)],
    ['bksy.zju.edu.cn/76426/list.htm', page(emptyHtml)],
  ]);
  await assert.rejects(() => source.view({ title: '完全不存在的一条通知标题' }), (error) => {
    assert.equal(error.code, 'NEEDS_USER');
    assert.match(error.message, /未找到匹配通知/);
    assert.ok(Array.isArray(error.details.candidates));
    return true;
  });
});

test('view：按标题命中唯一一条时返回它的正文', async () => {
  const wanted = '关于2026年秋冬学期学籍异动办理的通知';
  const listHtml = webplusListHtml({
    entries: [{ id: '12345', title: wanted, date: '2026-09-30' }],
  });
  const articleHtml = webplusArticleHtml({ title: wanted, body: '正文在此。' });
  const { source } = mountSource([
    ['bksy.zju.edu.cn/76425/list.htm', page(listHtml)],
    ['bksy.zju.edu.cn/76426/list.htm', page(webplusListHtml({ entries: [], total: 0, per: 10 }))],
    ['bksy.zju.edu.cn/2026/0930/c76425a12345/page.htm', page(articleHtml)],
  ]);
  const result = await source.view({ title: wanted });
  assert.equal(result.count, 1);
  assert.equal(result.notices[0].title, wanted);
  assert.match(result.notices[0].text, /正文在此/);
});

/**
 * 增量扫描的时间基准。
 *
 * ⚠️ 必须注入而不是用真实「今天」：`new` 的语义是「最近 7 天 / 上次检查之后」，
 * 用真实时钟会让夹具里写死的 2026-09-30 随着时间推移掉出窗口 —— 测试会在某个月
 * 之后突然开始红，而代码一行没改。日期夹具与「现在」必须是同一个已知时刻。
 */
const FIXED_NOW = () => Date.parse('2026-10-02T00:00:00+08:00');

test('new：第一次给最近 7 天，返回 seen 供调用方持久化；第二次同一批不再算新', async () => {
  const listHtml = webplusListHtml({
    entries: [{ id: '777', title: '新发布的一条通知标题', date: '2026-09-30' }],
  });
  const routes = [
    [(entry) => entry.url.includes('zjutw.zju.edu.cn/tzgg/list.htm'), page(listHtml)],
  ];
  const { source } = mountSource(routes, { now: FIXED_NOW });

  const first = await source.new({ source: '团委', profile: { level: 'undergrad' } });
  assert.equal(first.count, 1);
  assert.equal(first.notices[0].title, '新发布的一条通知标题');
  assert.equal(first.notices[0].date, '2026-09-30');
  // 只有标题、日期、来源、链接 —— 不取正文
  assert.equal(first.notices[0].text, undefined);
  assert.ok(first.seen.sources['youth/tzgg'] !== undefined, 'seen 里要有这个栏目的键');
  assert.equal(Object.keys(first.seen.sources['youth/tzgg'].seen).includes('wp-777'), true);

  const second = await source.new({ source: '团委', seen: first.seen, profile: { level: 'undergrad' } });
  assert.equal(second.count, 0, '同一批不能算新');
});

test('new：最近 7 天之前的条目不算新（窗口是有下界的）', async () => {
  const listHtml = webplusListHtml({
    entries: [
      { id: '801', title: '窗口内的一条通知标题', date: '2026-09-30' },
      { id: '802', title: '窗口外的一条旧通知标题', date: '2026-08-01' },
    ],
  });
  const { source } = mountSource([['zjutw.zju.edu.cn/tzgg/list.htm', page(listHtml)]], { now: FIXED_NOW });
  const result = await source.new({ source: '团委', profile: { level: 'undergrad' } });
  assert.equal(result.count, 1, '只有窗口内那条算新');
  assert.equal(result.notices[0].title, '窗口内的一条通知标题');
});

test('new：reset 清空已读记录', async () => {
  const listHtml = webplusListHtml({
    entries: [{ id: '778', title: '另一条通知的标题内容', date: '2026-09-30' }],
  });
  const { source } = mountSource([['zjutw.zju.edu.cn/tzgg/list.htm', page(listHtml)]], { now: FIXED_NOW });
  const seen = { sources: { 'youth/tzgg': { checkedAt: '2026-09-30T00:00:00.000Z', seen: { 'wp-778': '2026-09-30' } } } };
  const before = await source.new({ source: '团委', seen, profile: { level: 'undergrad' } });
  assert.equal(before.count, 0);
  const after = await source.new({ source: '团委', seen, reset: true, profile: { level: 'undergrad' } });
  assert.equal(after.count, 1);
});

test('sinceOf：第一次取最近 7 天；之后从上次检查往前重叠 7 天；最多回看 45 天', () => {
  const { source } = mountSource([], { now: FIXED_NOW });
  const task = { key: 'youth/tzgg' };
  const now = FIXED_NOW();
  // 第一次：今天 - 7 天 = 2026-09-25
  assert.equal(source.sinceOf({ sources: {} }, task, now), '2026-09-25');
  // 上次检查是 2026-10-01 → 重叠 7 天 = 2026-09-24
  assert.equal(
    source.sinceOf({ sources: { 'youth/tzgg': { checkedAt: '2026-10-01T00:00:00+08:00', seen: {} } } }, task, now),
    '2026-09-24',
  );
  // 上次检查很旧（2026-01-01）→ 夹到 45 天上界（2026-08-18）
  assert.equal(
    source.sinceOf({ sources: { 'youth/tzgg': { checkedAt: '2026-01-01T00:00:00+08:00', seen: {} } } }, task, now),
    '2026-08-18',
  );
});

test('sources：不联网，给出来源、栏目、网络归属与学院名录', async () => {
  const { source, calls } = mountSource([]);
  const result = await source.sources({ profile: { level: 'undergrad', college: '计算机科学与技术学院' } });
  assert.equal(calls.length, 0, 'sources 不该发请求');
  assert.ok(result.sources.length > 8);
  const byName = new Map(result.sources.map((entry) => [entry.name, entry]));
  assert.equal(byName.get('学工部').network, 'public', 'www.xgb.zju.edu.cn 在主机表里标 public');
  assert.equal(byName.get('本科生院').network, 'campus', 'bksy.zju.edu.cn 在主机表里标 campus');
  assert.equal(byName.get('综合服务网').network, 'public');
  assert.ok(byName.get('学工部').default.includes('最新通知'));
  assert.ok(byName.get('综合服务网').new.includes('即时更新'));
  assert.ok(result.colleges.length > 20);
  assert.ok(Array.isArray(result.collegesNotReadable));
  assert.equal(result.myCollege.name, '计算机科学与技术学院');
  assert.match(result.note, /network/);
});

test('sources：没有学院时不写 myCollege 键（而不是写一个空对象）', async () => {
  const { source } = mountSource([]);
  const result = await source.sources({ profile: { level: 'undergrad' } });
  assert.equal('myCollege' in result, false);
  assert.equal(result.profile.college, null);
});

test('list：日期参数不合法时抛 CONFIG（在发请求之前）', async () => {
  const { source, calls } = mountSource([]);
  await assert.rejects(() => source.list({ since: '2026-13-01' }), { code: 'CONFIG' });
  assert.equal(calls.length, 0);
});

test('NoticeSource：没有 request 时构造就抛 CONFIG', () => {
  assert.throws(() => new NoticeSource({}), (error) => {
    assert.equal(error.code, 'CONFIG');
    return true;
  });
});

/* ────────────────────────────── 登录委托 ── */

test('落脚到 CAS 登录页时做一次该站点的委托登录，然后重取', async () => {
  const secret = '<html><body><div class="wp_paging_w1">不该看到</div></body></html>';
  const article = webplusArticleHtml({ title: '要登录才能看的通知', body: '登录后的正文。' });
  let loggedIn = false;
  const { source, calls } = mountSource([
    // 未登录时被引到 CAS 登录页（service 指回原页面）
    [(entry) => entry.url.includes('itc.zju.edu.cn/90618/list.htm') && !loggedIn,
      { status: 302, headers: new Map([['location', 'https://zjuam.zju.edu.cn/cas/login?service=https%3A%2F%2Fitc.zju.edu.cn%2F90618%2Flist.htm']]), text: '' }],
    ['itc.zju.edu.cn/90618/list.htm', page(webplusListHtml({
      entries: [{ id: '9', title: '要登录才能看的通知', date: '2026-09-30' }],
      base: 'c90618',
    }))],
    ['itc.zju.edu.cn/2026/0930/c90618a9/page.htm', page(article)],
  ]);
  source.acquireServiceLogin = async ({ service, host }) => {
    assert.equal(host, 'itc.zju.edu.cn', '回调要拿到站点主机');
    assert.match(service, /90618/);
    loggedIn = true;
  };
  void secret;

  const result = await source.list({ source: '信息技术中心', limit: 5, profile: { level: 'undergrad' } });
  assert.equal(result.count, 1);
  assert.equal(result.notices[0].title, '要登录才能看的通知');
  assert.ok(calls.length >= 3, '至少：跳到 CAS + 重取列表 + 取正文');
});

test('没有注入登录回调时，要登录的栏目抛 AUTH_REQUIRED 并指到设置页', async () => {
  const { source } = mountSource([[
    'itc.zju.edu.cn/90618/list.htm',
    { status: 302, headers: new Map([['location', 'https://zjuam.zju.edu.cn/cas/login?service=https%3A%2F%2Fitc.zju.edu.cn%2Fx']]), text: '' },
  ]]);
  const result = await source.list({ source: '信息技术中心', limit: 5, profile: { level: 'undergrad' } });
  // 栏目级错误不炸整个查询，而是进 sourceErrors
  assert.equal(result.notices.length, 0);
  assert.equal(result.status, 'partial');
  assert.equal(result.sourceErrors[0].code, 'AUTH_REQUIRED');
  assert.match(result.sourceErrors[0].error, /浙大一卡通/);
});

test('NoticeSource.serviceOf：只认 CAS 主机的 /cas/login', () => {
  assert.equal(
    NoticeSource.serviceOf('https://zjuam.zju.edu.cn/cas/login?service=https%3A%2F%2Fx'),
    'https://x',
  );
  assert.equal(NoticeSource.serviceOf('https://zjuam.zju.edu.cn/cas/v2/getPubKey'), null);
  assert.equal(NoticeSource.serviceOf('https://bksy.zju.edu.cn/cas/login?service=x'), null);
  assert.equal(NoticeSource.serviceOf('不是 url'), null);
  assert.equal(CAS_HOST, 'zjuam.zju.edu.cn');
});

/* ────────────────────────────── 超时的实际效果 ── */

test('一个挂死的栏目不会拖住整次查询：超时后其它栏目照常返回', { timeout: 15000 }, async () => {
  const goodHtml = webplusListHtml({ entries: [{ id: '901', title: '正常栏目的通知标题', date: '2026-09-30' }] });
  const article = webplusArticleHtml({ title: '正常栏目的通知标题', body: '正文。' });
  const { source } = mountSource([
    // 53388 永不返回 —— 真实症状是「校外连接卡住」
    ['xgb.zju.edu.cn/53388/list.htm', () => new Promise(() => {})],
    ['xgb.zju.edu.cn/53403/list.htm', page(goodHtml)],
    ['xgb.zju.edu.cn/53395/list.htm', page(webplusListHtml({ entries: [], total: 0, per: 10 }))],
    ['xgb.zju.edu.cn/53396/list.htm', page(webplusListHtml({ entries: [], total: 0, per: 10 }))],
    ['xgb.zju.edu.cn/53405/list.htm', page(webplusListHtml({ entries: [], total: 0, per: 10 }))],
    ['xgb.zju.edu.cn/2026/0930/c76425a901/page.htm', page(article)],
    ['xgb.zju.edu.cn/2026/0930/c76425a901/page.html', page(article)],
  ]);
  // 把短超时压到 30ms，免得测试等 QUICK_MS×3。
  const original = NoticeSource.prototype.send;
  NoticeSource.prototype.send = function send(url, options) {
    return patiently(async ({ timeoutMs }) => {
      const response = await withTimeout(this.request, url, {
        method: options?.method ?? 'GET',
        ...(options?.form === undefined ? {} : { body: new URLSearchParams(options.form).toString() }),
        headers: options?.headers,
      }, Math.min(timeoutMs ?? SLOW_MS, 30));
      return response;
    }, { quickMs: 20, pauseMs: 1 });
  };
  try {
    const result = await source.list({ source: '学工部', limit: 5, profile: { level: 'undergrad' } });
    assert.equal(result.status, 'partial');
    const timedOut = result.sourceErrors.filter((entry) => entry.code === 'TIMEOUT');
    assert.equal(timedOut.length, 1, `期望恰好一个超时，实际 ${JSON.stringify(result.sourceErrors.map((entry) => entry.code))}`);
    assert.equal(timedOut[0].source, '学工部·最新通知');
  } finally {
    NoticeSource.prototype.send = original;
  }
});

/* ────────────────────────────── 子资源导出 ── */

test('QUICK_MS 与 SLOW_MS 的关系：短超时在前、长超时在后', () => {
  assert.ok(QUICK_MS < SLOW_MS);
  assert.equal(QUICK_MS, 3500, '上游 read.ts 的实测值');
});

test('ZDBK_HOST 与详情地址指向教务网', () => {
  assert.equal(ZDBK_HOST, 'zdbk.zju.edu.cn');
  assert.match(detailUrl('1'), /^https:\/\/zdbk\.zju\.edu\.cn\/jwglxt\//);
});

test('NoticeError：code 与 details 都能读出来，name 固定', () => {
  const error = new NoticeError('DRIFT', '一句话', { source: 'x' });
  assert.equal(error.name, 'NoticeError');
  assert.equal(error.code, 'DRIFT');
  assert.equal(error.message, '一句话');
  assert.equal(error.details.source, 'x');
  assert.ok(error instanceof Error);
});

/* ────────────────────────────── 插件入口（src/index.js） ── */

/**
 * 造一个最小的 cordis 风格 ctx。
 *
 * `inject` 的回调立刻执行（模拟服务已在位），`webServer.register` 记录注册项。
 * 与 `tests/yjsy-host.test.mjs` 同一套桩 —— 那个文件说明了这层为什么必须有测试：
 * 纯解析测试全绿、而宿主入口一次请求都发不出去的事故，就是这么漏过去的。
 *
 * @returns `{ ctx, services, routes }`。
 */
function fakeCtx() {
  const services = new Map();
  const routes = [];
  const ctx = {
    effect(fn) { return fn() ?? (() => {}); },
    provide(name, value) { services.set(name, value); return () => services.delete(name); },
    inject(names, callback) {
      const scope = { webServer: { register(entry) { routes.push(entry); return () => {}; } } };
      callback(scope);
    },
  };
  return { ctx, services, routes };
}

/** 装配一次插件，返回服务面。 */
function mountPlugin() {
  const { ctx, services, routes } = fakeCtx();
  const dispose = apply(ctx);
  return { notice: services.get('zhiyunNotice'), routes, services, dispose };
}

test('apply() 真的 provide 了 zhiyunNotice，并注册了唯一的同源路由', () => {
  const { notice, routes } = mountPlugin();
  assert.ok(notice, '必须 provide zhiyunNotice');
  assert.equal(routes.length, 1, '必须注册恰好一条路由');
  assert.equal(routes[0].path, '/api/zhiyun-notice');
  assert.equal(routes[0].path, ROUTE_PATH);
  assert.equal(routes[0].kind, 'exact');
});

test('服务面自描述：只读、四个方法、平台名固定', () => {
  const { notice } = mountPlugin();
  assert.equal(notice.platform, 'notice');
  assert.equal(notice.readOnly, true);
  assert.equal(notice.label, '校内通知');
  assert.deepEqual(notice.methods, ['notice.list', 'notice.view', 'notice.new', 'notice.sources']);
  // D17：数据源不注册 AI 工具。服务上不该出现 tools / registerTool 这类口子。
  assert.equal('tools' in notice, false);
  assert.equal('registerTool' in notice, false);
});

test('路由：未知 action 返回 ok:false + CONFIG 且文案可操作', async () => {
  const { routes } = mountPlugin();
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, 'CONFIG');
      assert.match(parsed.error.message, /不认识的操作/);
      assert.match(parsed.error.message, /不存在的动作/);
    },
  };
  await routes[0].handler(makeReq(JSON.stringify({ action: '不存在的动作' })), res);
});

test('路由：空 action 也报 CONFIG（不是抛 TypeError）', async () => {
  const { routes } = mountPlugin();
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, 'CONFIG');
      assert.match(parsed.error.message, /\(空\)/);
    },
  };
  await routes[0].handler(makeReq(''), res);
});

test('路由：sources 动作返回来源清单，且不联网', async () => {
  const { routes } = mountPlugin();
  let payload;
  const res = { writeHead() {}, end(value) { payload = JSON.parse(value); } };
  await routes[0].handler(makeReq(JSON.stringify({ action: 'sources' })), res);
  assert.equal(payload.ok, true);
  assert.ok(Array.isArray(payload.value.sources));
  assert.ok(payload.value.sources.length > 8);
  assert.ok(Array.isArray(payload.value.colleges));
});

test('路由：status 动作给出 ready 与路由自身信息', async () => {
  const { routes } = mountPlugin();
  let payload;
  const res = { writeHead() {}, end(value) { payload = JSON.parse(value); } };
  await routes[0].handler(makeReq(JSON.stringify({ action: 'status' })), res);
  assert.equal(payload.ok, true);
  assert.equal(payload.value.ready, false);
  assert.equal(payload.value.routePath, '/api/zhiyun-notice');
});

test('路由：list 的参数错误以 ok:false + CONFIG 返回（不是 500）', async () => {
  const { routes } = mountPlugin();
  let payload;
  const res = { writeHead() {}, end(value) { payload = JSON.parse(value); } };
  await routes[0].handler(makeReq(JSON.stringify({ action: 'list', input: { since: '2026-13-01' } })), res);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'CONFIG');
});

test('setProfile：传非对象时抛 CONFIG（不静默清空）', () => {
  const { notice } = mountPlugin();
  assert.throws(() => notice.setProfile('计算机学院'), (error) => {
    assert.equal(error.code, 'CONFIG');
    return true;
  });
  // null 是合法的「取消」
  assert.doesNotThrow(() => notice.setProfile(null));
});

test('setServiceLoginProvider：非函数抛 CONFIG；null 可取消；撤销函数幂等', () => {
  const { notice } = mountPlugin();
  assert.throws(() => notice.setServiceLoginProvider('x'), { code: 'CONFIG' });
  const undo = notice.setServiceLoginProvider(async () => {});
  assert.doesNotThrow(() => undo());
  assert.doesNotThrow(() => undo());
  assert.doesNotThrow(() => notice.setServiceLoginProvider(null));
});

test('ready() 反映是否注入了统一身份认证', () => {
  const { notice } = mountPlugin();
  assert.equal(notice.ready(), false);
  notice.setServiceLoginProvider(async () => {});
  assert.equal(notice.ready(), true);
  notice.setServiceLoginProvider(null);
  assert.equal(notice.ready(), false);
});

test('setSeenStore：已读记录由调用方持久化（noticeNew 先 load，成功后才 save）', async () => {
  const { notice } = mountPlugin();
  const seen = { sources: {} };
  const saved = [];
  let loaded = 0;
  notice.setSeenStore({ load: () => { loaded += 1; return seen; }, save: (value) => { saved.push(value); } });

  // 用一个必然失败的来源（说不存在的学院）走到 select 之后失败 —— 这条验证的是
  // **失败时不能 save**：把空记录写回去会丢掉用户上一次的已读状态。
  await assert.rejects(
    () => notice.noticeNew({ source: '学院', profile: { level: 'undergrad' } }),
    { code: 'CONFIG' },
  );
  assert.equal(loaded, 1, 'noticeNew 必须先 load 已读记录');
  assert.equal(saved.length, 0, '失败时不该 save');
});

test('reset() 不会抛（换账号时的清理入口）', () => {
  const { notice } = mountPlugin();
  assert.doesNotThrow(() => notice.reset());
});

test('卸载后服务与路由都被收回', async () => {
  const { ctx, services } = fakeCtx();
  const dispose = apply(ctx);
  assert.ok(services.get('zhiyunNotice'));
  await assert.doesNotReject(async () => { await dispose?.(); });
  assert.equal(services.has('zhiyunNotice'), false, '卸载后服务应当被摘掉');
});

test('插件不 import 任何 tier 1 业务包（只依赖 tier 0 的 source-http）', async () => {
  // 这条是 D17/tier 规则在**代码层面**的钉子。`tests/source-capability.test.mjs`
  // 检查的是 package.json 的声明与裸 import 的一致性；这里额外钉住「不依赖 zdbk」，
  // 因为上游的 requires 里有 zdbk，很容易顺手 import 进来。
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../../packages/source/notice/src/index.js', import.meta.url), 'utf8');
  const bare = [...source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'));
  assert.deepEqual([...new Set(bare)], ['@lybx-leyw/dsh-zju-source-http']);
  assert.equal(bare.some((specifier) => specifier.includes('zdbk')), false, '不得 import zdbk 包');
});

/**
 * 造一个最小的请求对象。
 *
 * 监听器注册完就异步触发 `data` / `end` —— 与真实可读流一致：`on` 是同步注册，
 * 事件在之后到达。
 *
 * @param body - 请求体（会被包成 Buffer）。
 * @returns 事件发射器形状的对象。
 */
function makeReq(body) {
  const handlers = new Map();
  const req = {
    on(event, fn) {
      handlers.set(event, fn);
      if (handlers.has('data') && handlers.has('end') && !req.scheduled) {
        req.scheduled = true;
        setImmediate(() => {
          handlers.get('data')?.(Buffer.from(body, 'utf8'));
          handlers.get('end')?.();
        });
      }
      return req;
    },
  };
  return req;
}
