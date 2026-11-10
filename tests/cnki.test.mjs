/**
 * 知网数据源的行为测试。
 *
 * # 测什么
 *
 * 检索式拼装、结果表格解析、IP 登录状态机。这三块都是纯逻辑，用合成 HTML / JSON
 * 就能测死；真实检索需要校内 IP 与有效登录，测试环境不具备。
 *
 * 「被带去滑块验证」这条也要测 —— 那是知网最典型的失败方式。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  IP_LOGIN, CnkiError, CnkiSession, allOf, parseExpire, parseJsonp, parseGrid, queryJson, sameTitle, searchPapers, titleWords,
} from '../packages/source/cnki/src/cnki.js';

/* ────────────────────────────── 检索式 ── */

test('allOf：空格隔开的几个词都要出现', () => {
  assert.equal(allOf('算法 调度'), '算法 * 调度');
  assert.equal(allOf('算法、调度，优化'), '算法 * 调度 * 优化');
});

test('allOf：带运算符的词要加引号', () => {
  assert.equal(allOf('C++ 编程'), "'C++' * 编程");
  assert.equal(allOf('a/b'), "'a/b'");
});

test('allOf：单个词不加引号', () => {
  assert.equal(allOf('算法'), '算法');
});

test('allOf：检索框 120 字上限，超出的词不再加', () => {
  const many = Array.from({ length: 80 }, (_, i) => `词${i}`).join(' ');
  const built = allOf(many);
  assert.ok(built.length <= 120, `检索式长度 ${built.length} 超过上限`);
});

test('allOf：只剩运算符的词被跳过', () => {
  assert.equal(allOf('* + 算法'), '算法');
});

test('titleWords：按标点拆段', () => {
  assert.equal(titleWords('基于深度学习的调度算法研究'), '基于深度学习的调度算法研究');
  assert.equal(titleWords('A Study on Scheduling: Part 2'), 'A Study on Scheduling Part 2');
});

test('sameTitle：忽略标点与大小写比对', () => {
  assert.equal(sameTitle('A Study, Part 2'), sameTitle('A study part 2'));
  assert.notEqual(sameTitle('A'), sameTitle('B'));
});

test('queryJson：四种条件各成一行', () => {
  const body = JSON.parse(queryJson({ keyword: '算法', author: '张三' }));
  const subject = body.QNode.QGroup.find((group) => group.Key === 'Subject');
  assert.equal(subject.ChildItems.length, 2);
  assert.equal(subject.ChildItems[0].Items[0].Field, 'SU');
  assert.equal(subject.ChildItems[1].Items[0].Field, 'AU');
});

test('queryJson：主题用 TOPRANK 算子，其余用 DEFAULT', () => {
  const body = JSON.parse(queryJson({ keyword: '算法', title: '调度' }));
  const subject = body.QNode.QGroup.find((group) => group.Key === 'Subject');
  assert.equal(subject.ChildItems[0].Items[0].Operator, 'TOPRANK');
  assert.equal(subject.ChildItems[1].Items[0].Operator, 'DEFAULT');
});

test('queryJson：年份进控制组，起止补齐到整年', () => {
  const body = JSON.parse(queryJson({ keyword: '算法', years: [2020, 2024] }));
  const control = body.QNode.QGroup.find((group) => group.Key === 'ControlGroup');
  const date = control.ChildItems[0].Items[0];
  assert.equal(date.Operator, 'BETWEEN');
  assert.equal(date.Value, '2020-01-01');
  assert.equal(date.Value2, '2024-12-31');
});

test('queryJson：来源类别进控制组，每个一个勾选', () => {
  const body = JSON.parse(queryJson({ keyword: '算法', core: ['SCI', '北大核心'] }));
  const control = body.QNode.QGroup.find((group) => group.Key === 'ControlGroup');
  const checklist = control.ChildItems.find((group) => group.Key === '.extend-tit-checklist');
  assert.equal(checklist.Items.length, 2);
  assert.equal(checklist.Items[0].Field, 'SI');
  assert.equal(checklist.Items[1].Field, 'HX');
  assert.equal(checklist.Items[0].Value, 'Y');
});

test('queryJson：指定类型时用该库的 resource/classid，总库带 KuaKuCode', () => {
  const typed = JSON.parse(queryJson({ keyword: 'x', type: '期刊' }));
  assert.equal(typed.Resource, 'JOURNAL');
  assert.equal(typed.Classid, 'YSTT4HG0');
  assert.equal(typed.KuaKuCode, '', '指定类型时不带总库代码');

  const all = JSON.parse(queryJson({ keyword: 'x' }));
  assert.equal(all.Resource, 'CROSSDB');
  assert.ok(all.KuaKuCode.length > 0, '总库要带子库列表');
});

test('queryJson：一个条件都不给时抛 CONFIG', () => {
  assert.throws(() => queryJson({}), (error) => {
    assert.equal(error.code, 'CONFIG');
    return true;
  });
});

test('queryJson：未知类型/来源类别时抛 CONFIG', () => {
  assert.throws(() => queryJson({ keyword: 'x', type: '不存在' }), { code: 'CONFIG' });
  assert.throws(() => queryJson({ keyword: 'x', core: ['不存在'] }), { code: 'CONFIG' });
});

/* ────────────────────────────── 结果解析 ── */

/** 一段检索结果表格：一条期刊、一条学位论文。 */
const GRID = `<div>共找到<span><em>1,234</em></span>条结果</div>
<table><tbody>
<tr>
  <td class="name"><a href="/kcms2/article/abstract?v=abc">基于深度学习的调度算法</a></td>
  <td class="author"><a href="/x">张三</a><a href="/y">李四</a></td>
  <td class="source">计算机学报</td>
  <td class="date">2023-05-15</td>
  <td class="data">期刊</td>
  <td class="quote">42</td>
  <td class="download">1024</td>
</tr>
<tr>
  <td class="name"><a href="/kcms2/article/abstract?v=def">另一篇学位论文</a></td>
  <td class="author">王五;赵六</td>
  <td class="unit">浙江大学</td>
  <td class="date">2022-06-01</td>
  <td class="quote">7</td>
  <td class="download">88</td>
</tr>
</tbody></table>`;

test('parseGrid：解析出两条，字段各自对应', () => {
  const parsed = parseGrid(GRID);
  assert.equal(parsed.total, 1234, '总数从「共找到」里取，去逗号');
  assert.equal(parsed.papers.length, 2);

  const [first, second] = parsed.papers;
  assert.equal(first.title, '基于深度学习的调度算法');
  assert.deepEqual(first.authors, ['张三', '李四'], '作者是链接时就取链接文字');
  assert.equal(first.source, '计算机学报');
  assert.equal(first.date, '2023-05-15');
  assert.equal(first.cited, 42);
  assert.equal(first.downloads, 1024);

  assert.deepEqual(second.authors, ['王五', '赵六'], '作者不是链接时按分号拆');
  assert.equal(second.source, '浙江大学', '学位论文的来源列是 unit');
});

test('parseGrid：日期只留到天', () => {
  const html = GRID.replace('2023-05-15', '2023-05-15T10:30:00');
  assert.equal(parseGrid(html).papers[0].date, '2023-05-15');
});

test('parseGrid：会议来源列是 hy-name', () => {
  const html = GRID.replace('class="source"', 'class="hy-name"');
  assert.equal(parseGrid(html).papers[0].source, '计算机学报');
});

test('parseGrid：没有结果表格但站点说没数据时返回空，不抛错', () => {
  assert.deepEqual(parseGrid('<html>暂无数据</html>'), { total: 0, papers: [] });
  assert.deepEqual(parseGrid('<html>抱歉，没有找到相关内容</html>'), { total: 0, papers: [] });
});

test('parseGrid：结构不对时抛 SHAPE，并带页面片段', () => {
  assert.throws(() => parseGrid('<html><body>something else</body></html>'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.ok(typeof error.details.snippet === 'string');
    return true;
  });
});

test('parseGrid：没有「共找到」时总数取条数', () => {
  const html = GRID.replace(/共找到[\s\S]*?条结果/, '');
  assert.equal(parseGrid(html).total, 2);
});

/* ────────────────────────────── 登录状态 ── */

/** 造一个假 request。 */
function fakeRequest(handler) {
  const calls = [];
  const request = async (url, init = {}) => {
    // 记录 method 与 body：检索请求的形态（POST + 表单）本身就是要断言的东西，
    // 只记 url 会让「用 GET ?kw= 代替 POST 表单」这个缺陷完全测不出来。
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body, headers: init.headers ?? {} });
    return handler(String(url), init);
  };
  return { request, calls };
}

/**
 * 造一个符合真实协议的 JSONP 登录响应。
 *
 * 上游读的是 `IsSuccess` / `Expire` / `ShowName`，且响应体是 `cb({...})` 形态 ——
 * 第一版夹具用的是自造的 `{success, institutionName, expireTime}`，
 * 正好是错的那些字段名，于是测试全绿也发现不了协议写错。
 *
 * @param options.ok - 是否登录成功。
 * @param options.expire - `Expire` 的北京时间字符串。
 * @returns 假响应。
 */
const loginResponse = ({ ok: succeeded = true, expire = '2026-11-10 18:00:00' } = {}) => ({
  status: 200,
  text: `cb(${JSON.stringify({ IsSuccess: succeeded, Expire: expire, ShowName: '浙江大学', UserName: 'zju' })})`,
});

test('会话：首次要 IP 登录（JSONP + 上游字段名），成功后记下有效期', async () => {
  const fixed = Date.parse('2026-11-10T17:00:00+08:00');
  const { request, calls } = fakeRequest(() => loginResponse());
  const session = new CnkiSession({ request, now: () => fixed });

  const login = await session.ensure();
  assert.equal(login.institution, '浙江大学', 'ShowName 才是机构名');
  // `Expire` 是北京时间字符串，要按 +08:00 解释，不能按本机时区。
  assert.equal(login.expiresAt, Date.parse('2026-11-10T18:00:00+08:00'));
  assert.match(calls[0].url, /callback=cb/, '要带 JSONP 的 callback');
});

test('会话：有效期内复用，不再登录', async () => {
  const fixed = Date.parse('2026-11-10T17:00:00+08:00');
  const { request, calls } = fakeRequest(() => loginResponse({ expire: '2026-11-10 18:00:00' }));
  const session = new CnkiSession({ request, now: () => fixed });

  await session.ensure();
  await session.ensure();
  assert.equal(calls.length, 1, '第二次不该再登录');
});

test('会话：过期后重新登录（时间前进 21 分钟）', async () => {
  let now = Date.parse('2026-11-10T17:00:00+08:00');
  const { request, calls } = fakeRequest(() => loginResponse({ expire: '2026-11-10 17:20:00' }));
  const session = new CnkiSession({ request, now: () => now });

  await session.ensure();
  now += 21 * 60_000;
  await session.ensure();
  assert.equal(calls.length, 2, '过了 Expire 之后要重登');
});

test('会话：距到期不足 60 秒就当作已过期（避免请求发到一半失效）', async () => {
  let now = Date.parse('2026-11-10T17:00:00+08:00');
  const { request, calls } = fakeRequest(() => loginResponse({ expire: '2026-11-10 17:20:00' }));
  const session = new CnkiSession({ request, now: () => now });

  await session.ensure();
  // 剩 30 秒：还没到期，但余量不足，应当重登。
  now += 19 * 60_000 + 30_000;
  await session.ensure();
  assert.equal(calls.length, 2, '余量不足要重登');
});

test('会话：从持久化记录恢复有效登录', async () => {
  const fixed = Date.parse('2026-11-10T17:00:00+08:00');
  const { request, calls } = fakeRequest(() => ({ status: 200, text: '{}' }));
  const session = new CnkiSession({
    request,
    now: () => fixed,
    load: () => ({ institution: '浙江大学', expiresAt: fixed + 10 * 60_000 }),
  });

  const login = await session.ensure();
  assert.equal(login.institution, '浙江大学');
  assert.equal(calls.length, 0, '持久化记录有效时不该发请求');
});

test('会话：IP 不被认时抛 LOGIN，并说明要经 WebVPN', async () => {
  const { request } = fakeRequest(() => loginResponse({ ok: false }));
  const session = new CnkiSession({ request });

  await assert.rejects(() => session.ensure(), (error) => {
    assert.equal(error.code, 'LOGIN');
    assert.match(error.message, /WebVPN/);
    return true;
  });
});

test('会话：纯 JSON（非 JSONP）也要能解析', async () => {
  const fixed = Date.parse('2026-11-10T17:00:00+08:00');
  const { request } = fakeRequest(() => ({
    status: 200,
    text: JSON.stringify({ IsSuccess: true, Expire: '2026-11-10 18:00:00', ShowName: '浙江大学' }),
  }));
  const session = new CnkiSession({ request, now: () => fixed });
  assert.equal((await session.ensure()).institution, '浙江大学');
});

test('parseExpire：解不出时按 15 分钟兜底（不猜单位）', () => {
  const now = Date.parse('2026-11-10T17:00:00+08:00');
  assert.equal(parseExpire(undefined, now), now + 15 * 60_000);
  assert.equal(parseExpire('', now), now + 15 * 60_000);
  assert.equal(parseExpire('不是时间', now), now + 15 * 60_000);
  // 已过期的也按兜底 —— 「登录成功但立刻过期」不合理。
  assert.equal(parseExpire('2020-01-01 00:00:00', now), now + 15 * 60_000);
});

test('会话：登录返回非 JSON 时抛 SHAPE', async () => {
  const { request } = fakeRequest(() => ({ status: 200, text: '<html>' }));
  const session = new CnkiSession({ request });
  await assert.rejects(() => session.ensure(), { code: 'SHAPE' });
});

test('会话：登录 HTTP 非 200 时抛 LOGIN', async () => {
  const { request } = fakeRequest(() => ({ status: 502, text: '' }));
  const session = new CnkiSession({ request });
  await assert.rejects(() => session.ensure(), { code: 'LOGIN' });
});

/* ────────────────────────────── 检索 ── */

test('检索：正常返回时解析出文献', async () => {
  const { request } = fakeRequest((url) => {
    if (url.includes(IP_LOGIN)) return loginResponse();
    return { status: 200, text: GRID };
  });
  const session = new CnkiSession({ request });
  const result = await searchPapers({ session, query: { keyword: '算法', limit: 10 } });

  assert.equal(result.total, 1234);
  assert.equal(result.papers.length, 2);
  assert.match(result.matchedBy, /主题：算法/);
});

test('检索：limit 生效，且上限 50', async () => {
  // 造 60 行结果。表格结构与 GRID 相同，行数更多。
  const row = (index) => `<tr><td class="name"><a href="/a${index}">文${index}</a></td>`
    + '<td class="author">作者</td><td class="source">刊</td><td class="date">2023-01-01</td></tr>';
  const many = `<table><tbody>${Array.from({ length: 60 }, (_, i) => row(i)).join('')}</tbody></table>`;

  const { request, calls } = fakeRequest((url) => (url.includes(IP_LOGIN)
    ? loginResponse()
    : { status: 200, text: many }));
  const session = new CnkiSession({ request });

  const capped = await searchPapers({ session, query: { keyword: 'x', limit: 999 } });
  assert.equal(capped.papers.length, 50, '客户端裁剪到 50');
  // ⚠️ 关键：`pageSize` 必须真的发给站点。只做客户端 slice 时，
  // 站点按默认 20 条返回，`limit: 999` 实际只拿到 20 条却「看起来对了」。
  const searchCall = calls.find((call) => call.url.includes('/brief/grid'));
  assert.match(searchCall.body, /pageSize=50/, '超过 20 条时必须向站点索要 50 条');
});

test('检索：被带去滑块验证时抛 NEEDS_USER，不返回空列表', async () => {
  const { request } = fakeRequest((url) => (url.includes(IP_LOGIN)
    ? loginResponse()
    : { status: 200, text: '<html><div class="verify-box">请拖动滑块</div></html>' }));
  const session = new CnkiSession({ request });

  await assert.rejects(() => searchPapers({ session, query: { keyword: 'x' } }), (error) => {
    assert.equal(error.code, 'NEEDS_USER');
    assert.match(error.message, /滑块/);
    return true;
  });
});

test('检索：HTTP 非 200 时抛 HTTP', async () => {
  const { request } = fakeRequest((url) => (url.includes(IP_LOGIN)
    ? loginResponse()
    : { status: 503, text: '' }));
  const session = new CnkiSession({ request });
  await assert.rejects(() => searchPapers({ session, query: { keyword: 'x' } }), { code: 'HTTP' });
});

/* ────────────────────────────── 审核修复的回归守卫 ── */

/**
 * 这一段守审核查出的三个阻断问题。每条都**先复现缺陷的判据**，再断言修好。
 */

test('请求形态：POST 表单 + QueryJson，不是 GET ?kw=', async () => {
  const { request, calls } = fakeRequest((url) => (url.includes(IP_LOGIN) ? loginResponse() : { status: 200, text: GRID }));
  const session = new CnkiSession({ request });
  await searchPapers({ session, query: { keyword: '算法' } });

  const call = calls.find((entry) => entry.url.includes('/brief/grid'));
  assert.equal(call.method, 'POST', '必须是 POST —— GET ?kw=<JSON> 会让检索式全部失效');
  assert.match(String(call.url), /\/brief\/grid$/, 'URL 上不该再有查询串');
  assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');

  // 11 个字段里最关键的几个。
  assert.match(call.body, /boolSearch=true/);
  assert.match(call.body, /QueryJson=/);
  assert.ok(!call.body.includes('kw='), '不能把 JSON 塞进 kw');
  assert.match(call.body, /sortField=FFD/, '默认按相关度');
  assert.match(call.body, /dstyle=listmode/);
});

test('请求形态：sort 参数真的接到 sortField 上（不再静默丢弃）', async () => {
  const { request, calls } = fakeRequest((url) => (url.includes(IP_LOGIN) ? loginResponse() : { status: 200, text: GRID }));
  const session = new CnkiSession({ request });
  await searchPapers({ session, query: { keyword: 'x', sort: 'cited' } });
  assert.match(calls.find((entry) => entry.url.includes('/brief/grid')).body, /sortField=CF/);
});

test('登录：JSONP 响应体要能解析', () => {
  assert.deepEqual(parseJsonp('cb({"IsSuccess":true,"Expire":"2026-11-10 18:00:00"})'), {
    IsSuccess: true, Expire: '2026-11-10 18:00:00',
  });
  assert.deepEqual(parseJsonp('cb({"a":1});'), { a: 1 });
  // 纯 JSON 也认。
  assert.deepEqual(parseJsonp('{"a":1}'), { a: 1 });
  assert.equal(parseJsonp('not json at all'), undefined);
});

test('登录：字段名用 IsSuccess / Expire / ShowName（不是 success / expireTime）', async () => {
  const fixed = Date.parse('2026-11-10T17:00:00+08:00');
  const { request } = fakeRequest(() => ({
    status: 200,
    // 用上游的真实字段名。
    text: 'cb({"IsSuccess":true,"Expire":"2026-11-10 17:20:00","ShowName":"浙江大学"})',
  }));
  const session = new CnkiSession({ request, now: () => fixed });
  const login = await session.ensure();

  assert.equal(login.institution, '浙江大学');
  // 20 分钟后 —— 第一版的 `ttl > 1000 ? ttl : ttl*1000` 会算成「1.2 秒」。
  assert.equal(login.expiresAt, Date.parse('2026-11-10T17:20:00+08:00'));
  assert.ok(login.expiresAt - fixed === 20 * 60_000, '必须正好 20 分钟，不能是 1.2 秒');
});

test('检索参数校验在网络之前：未知类型不触发一次登录', async () => {
  const { request, calls } = fakeRequest(() => loginResponse());
  const session = new CnkiSession({ request });
  await assert.rejects(() => searchPapers({ session, query: { keyword: 'x', type: '不存在的类型' } }), { code: 'CONFIG' });
  assert.equal(calls.length, 0, '纯参数错误不该先登一次录');
});

test('core 只对期刊有效：学位论文 + 北大核心 时抛 CONFIG', () => {
  assert.throws(
    () => queryJson({ keyword: 'x', type: '学位论文', core: ['北大核心'] }),
    (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /只对期刊有效/);
      return true;
    },
  );
  // 期刊 + core 正常。
  assert.doesNotThrow(() => queryJson({ keyword: 'x', type: '期刊', core: ['北大核心'] }));
});
