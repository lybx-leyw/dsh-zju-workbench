/**
 * 浙大体艺数据源的行为测试。
 *
 * ⚠️ 本文件夹具按上游注释与实现推断（`tyys/venue.ts`、`client.ts`、`sign.ts`、
 * `rollcall.ts` 的字段名与判据），**未经真实响应验证**。
 *
 * # 测什么
 *
 * 三块：
 *   1. **纯函数**：时间换算、日期/时段校验、两个签名（场馆 md5 与 App 的 AES+sha256）、
 *      须知解析与放号推算、时段解析、订单解析、考勤统计；
 *   2. **客户端**：登录两次换令牌、401 重登一次再重放、250 当「没放号」、
 *      写接口硬拦、超时、限流、形状漂移；
 *   3. **宿主入口**：`provide` 的服务名、路由路径、非法 action、注入校验。
 *
 * 全部用假 `request` —— 两个站在公网但需要 CAS，测试不该联网。
 *
 * # 断言口径
 *
 * 每个断言都给**具体值**。表格与计数类的断言同时钉住 `length`，避免
 * 「空数组上 `every()` 永远为真」这种真空真。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  APP_BASE, APP_LOGIN_SERVICE, ATTENDANCE_STATUS, PROTOCOL_PATH, PTM_BASE, REQUEST_TIMEOUT_MS,
  TyysApp, TyysError, VENUE_BASE, VENUE_LOGIN_SERVICE, VenueClient,
  addDays, atDate, beijingDate, canonicalize, decodeEntities, history, htmlToText,
  listOrders, listVenues, localTime, matchSites, nearbyTimes, orderView, parseDay,
  parseNotice, parseOrder, parseTokens, readOrders, releaseAt, releaseTime, signRequest,
  signingMaterial, siteName, targetDate, timeRange, venueSignature,
} from '../../../packages/source/tyys/src/tyys.js';
import { ROUTE_PATH, apply } from '../../../packages/source/tyys/src/index.js';

/* ────────────────────────────── 夹具常量 ── */

/**
 * 固定的「现在」：2026-11-10 10:00（北京时间）。
 *
 * 用固定值而不是 `Date.now()`，否则「今天已经过了放号时刻」这类分支会
 * 随运行时刻翻面，测试时绿时红。
 */
const NOW = Date.parse('2026-11-10T10:00:00+08:00');

/**
 * 一份签名材料（32 字节）。
 *
 * 对应的令牌第 4 段由独立脚本按上游 `sign.ts:8-14` 的格式算出：
 * `[4 字节长度 BE][16 字节 IV][32 字节密文]`，AES-256-CBC、无填充。
 * 硬编码它而不是在测试里重新加密，是为了让「解密逻辑被改坏」真的红灯。
 */
const MATERIAL_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const TOKEN4 = 'AAAANAECAwQFBgcICQoLDA0ODxDBysDtvahqwHMh4vUc0WYfcZQ0f3bT93/n610JQ5SYyQ==';

/** 造一个 5 段 App 令牌。 */
function makeToken({ sub = '3230100000', exp = Math.floor(NOW / 1000) + 3600, token4 = TOKEN4 } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, exp })).toString('base64url');
  return [header, payload, 'SIGNATURE', token4, 'TAIL'].join('.');
}

/** 造一个按 URL 分派的假 `request`，并把每次调用记下来。 */
function fakeRequest(routes) {
  const calls = [];
  const request = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    for (const [match, reply] of routes) {
      if (String(url).includes(match)) {
        const value = typeof reply === 'function' ? reply(String(url), init, calls.length) : reply;
        // 支持「按调用次数返回不同响应」：函数返回数组时按次数取。
        return Array.isArray(value) ? value[Math.min(calls.filter((c) => c.url === String(url)).length - 1, value.length - 1)] : value;
      }
    }
    return { status: 404, text: '' };
  };
  return { request, calls };
}

/** 成功信封。 */
const envelope = (data, extra = {}) => ({ status: 200, text: JSON.stringify({ code: 200, message: 'OK', data, ...extra }) });

/* ────────────────────────────── 时间 ── */

test('beijingDate / localTime：按北京时间格式化，不受运行环境时区影响', () => {
  // UTC 的 2026-11-10T02:00Z 是北京时间 10:00 同一天。
  assert.equal(beijingDate(Date.parse('2026-11-10T02:00:00Z')), '2026-11-10');
  // UTC 的 2026-11-10T16:30Z 已经跨到北京时间次日。
  assert.equal(beijingDate(Date.parse('2026-11-10T16:30:00Z')), '2026-11-11');
  assert.equal(localTime(Date.parse('2026-11-10T02:00:00Z')), '2026-11-10 10:00:00');
  assert.equal(localTime(Date.parse('2026-11-10T16:30:00Z')), '2026-11-11 00:30:00');
});

test('atDate：显式 +08:00，换个时区解释也不会平移', () => {
  assert.equal(atDate('2026-11-12'), Date.parse('2026-11-11T16:00:00Z'));
  assert.equal(atDate('2026-11-12', '09:30'), Date.parse('2026-11-12T01:30:00Z'));
});

test('addDays：跨月、跨年都对，且只看北京时间日期', () => {
  assert.equal(addDays('2026-11-30', 2), '2026-12-02');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  // 23:30 的北京时间加 1 天，不能因为 UTC 还是同一天就少加。
  assert.equal(addDays('2026-11-10', 1), '2026-11-11');
});

/* ────────────────────────────── 日期与时段校验 ── */

test('targetDate：相对写法按北京时间换算', () => {
  assert.equal(targetDate('今天', NOW), '2026-11-10');
  assert.equal(targetDate('明天', NOW), '2026-11-11');
  assert.equal(targetDate('后天', NOW), '2026-11-12');
  assert.equal(targetDate('2天后', NOW), '2026-11-12');
  assert.equal(targetDate('0天后', NOW), '2026-11-10');
  assert.equal(targetDate('2026-11-13', NOW), '2026-11-13');
  // 去掉首尾空白后仍认。
  assert.equal(targetDate('  明天 ', NOW), '2026-11-11');
});

test('targetDate：超出今天至三天后的窗口时抛 CONFIG，且不自动换日期', () => {
  // 11-14 是第 4 天（今天 +4），窗口只有今天..11-13。
  assert.throws(() => targetDate('2026-11-14', NOW), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /2026-11-10/);
    assert.match(error.message, /2026-11-13/);
    return true;
  });
  // 已经过去的日期也拒绝（不悄悄改成今天）。
  assert.throws(() => targetDate('2026-11-09', NOW), { code: 'CONFIG' });
  assert.throws(() => targetDate('4天后', NOW), { code: 'CONFIG' });
});

test('targetDate：bounded=false 时可以看历史日期', () => {
  assert.equal(targetDate('2026-09-01', NOW, false), '2026-09-01');
  assert.equal(targetDate('30天后', NOW, false), '2026-12-10');
});

test('targetDate：不是日期就抛 CONFIG（含 2 月 30 日这种不存在的日期）', () => {
  assert.throws(() => targetDate('2026-02-30', NOW, false), { code: 'CONFIG' });
  assert.throws(() => targetDate('2026-1-1', NOW, false), { code: 'CONFIG' });
  assert.throws(() => targetDate('下周一', NOW, false), { code: 'CONFIG' });
  assert.throws(() => targetDate('', NOW, false), { code: 'CONFIG' });
});

test('timeRange：单个时刻与区间都认，结束不晚于开始要拒绝', () => {
  assert.deepEqual(timeRange('21:00'), { start: '21:00' });
  assert.deepEqual(timeRange('09:00-10:30'), { start: '09:00', end: '10:30' });
  assert.deepEqual(timeRange('00:00-23:59'), { start: '00:00', end: '23:59' });
  assert.throws(() => timeRange('21:00-21:00'), { code: 'CONFIG' });
  assert.throws(() => timeRange('22:00-21:00'), { code: 'CONFIG' });
  assert.throws(() => timeRange('24:00'), { code: 'CONFIG' });
  assert.throws(() => timeRange('9:00'), { code: 'CONFIG' });
  assert.throws(() => timeRange('21:60'), { code: 'CONFIG' });
});

/* ────────────────────────────── 场馆签名 ── */

test('venueSignature：与上游 md5 公式逐位相同', () => {
  // 期望值由独立脚本按 venue.ts:60-64 的公式算出。
  assert.equal(
    venueSignature('/api/reservation/day/info', { venueSiteId: '101', searchDate: '2026-11-12', nocache: '1700000000000' }, '1700000000000'),
    '32e08c1ef3c5df2c79a23dc7bac04950',
  );
});

test('venueSignature：参数顺序不影响结果（按参数名排序）', () => {
  const a = venueSignature('/api/x', { b: 2, a: 1, c: 3 }, '1700000000000');
  const b = venueSignature('/api/x', { c: 3, a: 1, b: 2 }, '1700000000000');
  assert.equal(a, b);
});

test('venueSignature：跳过 null 与对象，但不跳过 0 和空串以外的值', () => {
  const base = venueSignature('/api/x', { a: 1, b: 0 }, '1700000000000');
  // null 被跳过 → 与只有 a、b 的结果相同。
  assert.equal(venueSignature('/api/x', { a: 1, b: 0, drop: null }, '1700000000000'), base);
  // 对象被跳过。
  assert.equal(venueSignature('/api/x', { a: 1, b: 0, obj: { x: 1 } }, '1700000000000'), base);
  // 空串被跳过。
  assert.equal(venueSignature('/api/x', { a: 1, b: 0, empty: '' }, '1700000000000'), base);
  // ⚠️ 但 `0` 必须参与 —— 跳过它会让「size=0」这类参数签名对不上。
  assert.notEqual(base, venueSignature('/api/x', { a: 1 }, '1700000000000'));
});

test('venueSignature：时间戳与路径都进签名', () => {
  const one = venueSignature('/api/x', { a: 1 }, '1700000000000');
  assert.notEqual(one, venueSignature('/api/x', { a: 1 }, '1700000000001'));
  assert.notEqual(one, venueSignature('/api/y', { a: 1 }, '1700000000000'));
  // 上游公式里时间戳后面还跟了 `" " + salt`，删掉这段就与真机签名不一致。
  assert.equal(one.length, 32);
});

/* ────────────────────────────── App 签名 ── */

test('signingMaterial：解出 32 字节材料（与独立加密的结果相同）', () => {
  const material = signingMaterial(TOKEN4);
  assert.equal(material.length, 32);
  assert.equal(material.toString('hex'), MATERIAL_HEX);
});

test('signingMaterial：长度或首 4 字节不对时抛 SHAPE', () => {
  assert.throws(() => signingMaterial('AAAA'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /令牌格式异常/);
    return true;
  });
  // 长度对、首 4 字节声明成 53（与真实长度 52 不符）。
  const wrong = Buffer.from(TOKEN4, 'base64');
  const broken = Buffer.from(wrong);
  broken.writeUInt32BE(99, 0);
  assert.throws(() => signingMaterial(broken.toString('base64')), { code: 'SHAPE' });
});

test('canonicalize：先表单解码，再按键与值排序后拼 k+v', () => {
  // 空查询串 → 只有路径。
  assert.equal(canonicalize('/api/l/v6/termlist', ''), '/api/l/v6/termlist');
  // 路径不在 /api/ 下 → 拒绝。
  assert.equal(canonicalize('/api/x', 'b=2&a=1'), '/api/xa1b2');
  // 同名参数按「值」排序，不是按出现顺序。
  assert.equal(canonicalize('/api/x', 'x=b&x=a'), '/api/xxaxb');
  // `+` 要解成空格（表单解码），不解就会与真机签名不同。
  assert.equal(canonicalize('/api/x', 'a=1+2'), '/api/xa1 2');
  // 百分号编码同理。
  assert.equal(canonicalize('/api/x', 'a=%E4%B8%AD'), '/api/xa中');
});

test('canonicalize：非 /api/ 路径或带 ? # 换行时抛 CONFIG', () => {
  assert.throws(() => canonicalize('/ptm/api/x', ''), { code: 'CONFIG' });
  assert.throws(() => canonicalize('api/x', ''), { code: 'CONFIG' });
  assert.throws(() => canonicalize('/api/x?a=1', ''), { code: 'CONFIG' });
  assert.throws(() => canonicalize('/api/x#a', ''), { code: 'CONFIG' });
  assert.throws(() => canonicalize('/api/x\n', ''), { code: 'CONFIG' });
});

test('signRequest：与上游 sha256 + 插字算法逐位相同', () => {
  const material = Buffer.from(MATERIAL_HEX, 'hex');
  const { sign, timestamp } = signRequest(material, '/api/l/v6/termlist', '', 1700000000000);
  // 期望值由独立脚本按 sign.ts:24-34 的算法算出。
  assert.equal(timestamp, '1493082625297211257');
  assert.equal(sign, '8f67ee6a0f011dc9641e929b0e739df95fd196sc089914b4e2c0cb73catcb8fb3abe4');
  // 64 位 hex + 5 个插入字符 = 69。
  assert.equal(sign.length, 69);
});

test('signRequest：带查询串时签名随规范化结果变化', () => {
  const material = Buffer.from(MATERIAL_HEX, 'hex');
  const { sign } = signRequest(material, '/api/l/v6/student/courselist', 'schoolYear=2025&termId=11&uid=3230100000', 1700000000000);
  assert.equal(sign, '85ae3a83ef8e1aeca02b21a913e093414fa09es5a152732d7672ac65aet61acac419e');
  // 参数顺序换了，签名必须不变（规范化里排过序）。
  assert.equal(
    signRequest(material, '/api/l/v6/student/courselist', 'uid=3230100000&schoolYear=2025&termId=11', 1700000000000).sign,
    sign,
  );
});

test('signRequest：插入的 5 个字符在固定偏移上（"199st"）', () => {
  const material = Buffer.from(MATERIAL_HEX, 'hex');
  const { sign } = signRequest(material, '/api/x', '', 1);
  const chars = sign.split('');
  // 依次在 12/28/36/38/58 处插入 "199st" 的五个字符（数组会随之变长）。
  assert.equal(chars[12], '1');
  assert.equal(chars[28], '9');
  assert.equal(chars[36], '9');
  assert.equal(chars[38], 's');
  assert.equal(chars[58], 't');
  // 其余位置仍是原始 hex 字符（十六进制）。
  assert.equal(/^[0-9a-z]+$/.test(sign), true);
});

test('signRequest：材料长度不对或时间非法时抛 CONFIG', () => {
  assert.throws(() => signRequest(Buffer.alloc(31), '/api/x', '', 1), { code: 'CONFIG' });
  assert.throws(() => signRequest('not a buffer', '/api/x', '', 1), { code: 'CONFIG' });
  assert.throws(() => signRequest(Buffer.alloc(32), '/api/x', '', -1), { code: 'CONFIG' });
  assert.throws(() => signRequest(Buffer.alloc(32), '/api/x', '', 1.5), { code: 'CONFIG' });
});

/* ────────────────────────────── 令牌 ── */

test('parseTokens：解出授权头、材料、uid 与过期时间', () => {
  const token = makeToken({ sub: '3230100000', exp: Math.floor(NOW / 1000) + 3600 });
  const parsed = parseTokens(token, '3230100000');
  assert.equal(parsed.uid, '3230100000');
  assert.equal(parsed.material.toString('hex'), MATERIAL_HEX);
  assert.equal(parsed.expires, (Math.floor(NOW / 1000) + 3600) * 1000);
  // 授权头是前 3 段，不含签名材料与尾段 —— 带上它们只会暴露材料。
  assert.equal(parsed.authorization.split('.').length, 3);
  assert.equal(parsed.authorization, token.split('.').slice(0, 3).join('.'));
});

test('parseTokens：令牌里的账号与本次要读的账号不符时抛 AUTH_EXPIRED', () => {
  // 上游注释：「Login identity comes from JWT sub」—— 不核对就会读别人的考勤。
  const token = makeToken({ sub: '3230100001' });
  assert.throws(() => parseTokens(token, '3230100000'), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    assert.match(error.message, /另一个账号/);
    return true;
  });
  // 账号以数字形式给出也应比得上。
  assert.equal(parseTokens(makeToken({ sub: 3230100000 }), '3230100000').uid, '3230100000');
});

test('parseTokens：段数、payload、材料任一处不对都抛 SHAPE', () => {
  assert.throws(() => parseTokens('a.b.c.d', 'x'), { code: 'SHAPE' });
  assert.throws(() => parseTokens('', 'x'), { code: 'SHAPE' });
  // 4 段。
  const four = makeToken().split('.').slice(0, 4).join('.');
  assert.throws(() => parseTokens(four, '3230100000'), { code: 'SHAPE' });
  // payload 没有 exp。
  const header = Buffer.from('{}').toString('base64url');
  const noExp = Buffer.from(JSON.stringify({ sub: '3230100000' })).toString('base64url');
  assert.throws(() => parseTokens([header, noExp, 'S', TOKEN4, 'T'].join('.'), '3230100000'), { code: 'SHAPE' });
  // payload 没有 sub。
  const noSub = Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url');
  assert.throws(() => parseTokens([header, noSub, 'S', TOKEN4, 'T'].join('.'), '3230100000'), { code: 'SHAPE' });
});

/* ────────────────────────────── HTML 与须知 ── */

test('decodeEntities：命名、十进制、十六进制都解', () => {
  assert.equal(decodeEntities('a&amp;b'), 'a&b');
  assert.equal(decodeEntities('&lt;p&gt;'), '<p>');
  assert.equal(decodeEntities('&#20013;'), '中');
  assert.equal(decodeEntities('&#x9053;'), '道');
  assert.equal(decodeEntities('&hellip;'), '…');
  // 不认识的实体原样保留（不吞掉它，让人看见问题）。
  assert.equal(decodeEntities('&nosuch;'), '&nosuch;');
});

test('htmlToText：块级标签换成换行，行内空白折叠，实体解开', () => {
  const html = '<p>第一行&nbsp;甲</p><p>  第二行  乙 </p><div>第三行</div>'
    + '<script>var x = 1;</script><style>.a{}</style>';
  // ⚠️ 块级标签的**开与闭**都换成换行，所以段落之间是一个空行 ——
  // 这与上游 core/html.ts 的 htmlToText 一致（它也只把连续 3 个以上换行压成 2 个）。
  assert.equal(htmlToText(html), '第一行 甲\n\n第二行 乙\n\n第三行');
  assert.equal(htmlToText(''), '');
  assert.equal(htmlToText(null), '');
});

/**
 * 一段须知 HTML。
 *
 * 按上游注释的写法构造：校区名 + 可选场馆 + 破折号 + 「每天 HH:mm」，
 * 一条一行；有全角破折号与「、」并列校区。
 */
const NOTICE_HTML = `<h3>场馆预约须知</h3>
<p>1. 紫金港校区体育馆羽毛球-每天 20:00 开放次日场地。</p>
<p>2. 玉泉校区、华家池校区-每天 21:00 开放次日场地。</p>
<p>3. 紫金港校区风雨操场（膜顶）羽毛球－每天 9:30 开放次日场地。</p>
<p>4. 每个账户单天最多可预约1场次，每场次一小时。</p>`;

test('parseNotice：正文转纯文本，放号规则按校区拆成多条', () => {
  const notice = parseNotice({ title: '预约须知', content: NOTICE_HTML }, NOW);
  assert.equal(notice.title, '预约须知');
  assert.equal(notice.fetchedAt, '2026-11-10 10:00:00');
  assert.equal(notice.source, VENUE_BASE + PROTOCOL_PATH);
  assert.match(notice.content, /场馆预约须知/);
  // 富文本标签不能留下来。
  assert.equal(/<p>/.test(notice.content), false);

  assert.equal(notice.releaseTimes.length, 4);
  assert.deepEqual(notice.releaseTimes[0], { scope: '紫金港校区体育馆羽毛球', time: '20:00' });
  // 「、」并列 → 拆成两条，时刻相同。
  assert.deepEqual(notice.releaseTimes[1], { scope: '玉泉校区', time: '21:00' });
  assert.deepEqual(notice.releaseTimes[2], { scope: '华家池校区', time: '21:00' });
  // 全角破折号也认；一位数的小时要补成 HH。
  assert.deepEqual(notice.releaseTimes[3], { scope: '紫金港校区风雨操场（膜顶）羽毛球', time: '09:30' });
  // 「每个账户…」那条不带「每天 HH:mm」，不该被当成放号规则。
  assert.equal(notice.releaseTimes.filter((item) => item.scope.includes('账户')).length, 0);
});

test('parseNotice：正文为空时抛 SHAPE（不返回一条空须知）', () => {
  assert.throws(() => parseNotice({ content: '' }, NOW), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /正文是空的/);
    return true;
  });
  assert.throws(() => parseNotice({ content: '<p>  </p>' }, NOW), { code: 'SHAPE' });
  assert.throws(() => parseNotice(null, NOW), { code: 'SHAPE' });
});

test('siteName 与 matchSites：全角/半角与「校区」二字不影响匹配', () => {
  const sites = [
    { id: '101', campus: '紫金港校区', venue: '体育馆', name: '羽毛球1号场', sport: '羽毛球', maxSlots: 2 },
    { id: '102', campus: '紫金港校区', venue: '体育馆', name: '羽毛球2号场', sport: '羽毛球', maxSlots: 2 },
    { id: '201', campus: '玉泉校区', venue: '邵体馆', name: '网球场', sport: '网球', maxSlots: 1 },
  ];
  assert.equal(siteName(sites[0]), '紫金港校区体育馆羽毛球1号场');
  assert.deepEqual(matchSites(sites, {}).map((s) => s.id), ['101', '102', '201']);
  assert.deepEqual(matchSites(sites, { sport: '羽毛球' }).map((s) => s.id), ['101', '102']);
  assert.deepEqual(matchSites(sites, { venue: '玉泉' }).map((s) => s.id), ['201']);
  // 带「校区」二字也匹配（normalize 里去掉了）。
  assert.deepEqual(matchSites(sites, { campus: '紫金港校区' }).map((s) => s.id), ['101', '102']);
  assert.deepEqual(matchSites(sites, { campus: '紫金港' }).map((s) => s.id), ['101', '102']);
  // 运动名匹配的是 `sport + name`：平台有时把运动名放在场地名里。
  assert.deepEqual(matchSites([{ id: '9', campus: 'X', venue: 'Y', name: '游泳馆浅水区', sport: '', maxSlots: 1 }], { sport: '游泳' }).map((s) => s.id), ['9']);
  assert.deepEqual(matchSites(sites, { campus: '海宁' }), []);
});

test('releaseTime：校区 + 运动都对上才给时刻', () => {
  const notice = parseNotice({ content: NOTICE_HTML }, NOW);
  const badminton = { id: '101', campus: '紫金港校区', venue: '体育馆', name: '羽毛球1号场', sport: '羽毛球' };
  assert.equal(releaseTime(badminton, notice), '20:00');
  const tennis = { id: '201', campus: '玉泉校区', venue: '邵体馆', name: '网球场', sport: '网球' };
  // 「玉泉校区、华家池校区-每天 21:00」这条不含运动名 → 不能当成网球的放号时刻。
  assert.equal(releaseTime(tennis, notice), undefined);
  // 校区对不上。
  assert.equal(releaseTime({ ...badminton, campus: '海宁校区' }, notice), undefined);
  // 运动对不上（游泳不在任何规则里）。
  assert.equal(releaseTime({ ...badminton, sport: '游泳', name: '游泳池' }, notice), undefined);
});

test('releaseTime：同一场馆命中两个不同时刻时不猜', () => {
  const notice = parseNotice({ content: '<p>紫金港校区羽毛球-每天 20:00</p><p>紫金港校区羽毛球-每天 21:00</p>' }, NOW);
  assert.equal(releaseTime({ id: '1', campus: '紫金港校区', venue: '', name: '羽毛球1号场', sport: '羽毛球' }, notice), undefined);
  // 两个规则给同一个时刻则不算歧义。
  const same = parseNotice({ content: '<p>紫金港校区羽毛球-每天 20:00</p><p>紫金港校区羽毛球-每天 20:00</p>' }, NOW);
  assert.equal(releaseTime({ id: '1', campus: '紫金港校区', venue: '', name: '羽毛球1号场', sport: '羽毛球' }, same), '20:00');
});

test('releaseTime：「膜顶」规则只对膜顶场地生效', () => {
  // 一份**只有膜顶规则**的须知，这样「非膜顶场地不该拿到它」才是可判定的
  // （若用 NOTICE_HTML，非膜顶场馆同时命中两条规则，只能得到 undefined，
  //   那测不出这条判据 —— 见下一条测试）。
  const notice = parseNotice({ content: '<p>紫金港校区风雨操场（膜顶）羽毛球－每天 9:30</p>' }, NOW);
  const roofed = { id: '1', campus: '紫金港校区', venue: '风雨操场（膜顶）', name: '羽毛球1号场', sport: '羽毛球' };
  assert.equal(releaseTime(roofed, notice), '09:30');
  // 同一个校区的非膜顶羽毛球场地不该拿到这条时刻。
  assert.equal(releaseTime({ id: '2', campus: '紫金港校区', venue: '体育馆', name: '羽毛球2号场', sport: '羽毛球' }, notice), undefined);
});

test('releaseTime：非膜顶规则对所有场地生效，于是一个膜顶场地会命中两条不同时刻 → 不猜', () => {
  // NOTICE_HTML 里紫金港羽毛球既有「体育馆-每天 20:00」又有「风雨操场（膜顶）-每天 9:30」。
  // 膜顶场地两条都命中 → 时刻不唯一 → 必须返回 undefined，而不是挑一个。
  const notice = parseNotice({ content: NOTICE_HTML }, NOW);
  const roofed = { id: '1', campus: '紫金港校区', venue: '风雨操场（膜顶）', name: '羽毛球1号场', sport: '羽毛球' };
  assert.equal(releaseTime(roofed, notice), undefined);
  // 非膜顶场馆只命中 20:00 那条。
  assert.equal(releaseTime({ id: '2', campus: '紫金港校区', venue: '体育馆', name: '羽毛球2号场', sport: '羽毛球' }, notice), '20:00');
});

test('releaseAt：目标日期已在窗口内时不给放号时刻', () => {
  const notice = parseNotice({ content: NOTICE_HTML }, NOW);
  const site = { id: '101', campus: '紫金港校区', venue: '体育馆', name: '羽毛球1号场', sport: '羽毛球' };
  // days = 3 → 窗口是 11-10..11-12。11-12 已在窗口内。
  assert.equal(releaseAt(site, '2026-11-12', 3, notice, NOW), undefined);
  assert.equal(releaseAt(site, '2026-11-10', 3, notice, NOW), undefined);
});

test('releaseAt：窗口外的日期按「每天放一天」推算，且今天还没到点就用今天', () => {
  const notice = parseNotice({ content: NOTICE_HTML }, NOW);
  const site = { id: '101', campus: '紫金港校区', venue: '体育馆', name: '羽毛球1号场', sport: '羽毛球' };
  // 现在 10:00，放号 20:00 → 今天还没放，11-13 是窗口后的第 1 天 → 今晚 20:00。
  assert.equal(releaseAt(site, '2026-11-13', 3, notice, NOW), atDate('2026-11-10', '20:00'));
  // 11-15 是窗口后的第 3 天 → 11-12 20:00。
  assert.equal(releaseAt(site, '2026-11-15', 3, notice, NOW), atDate('2026-11-12', '20:00'));
});

test('releaseAt：今天已经过了放号时刻就顺延到明天', () => {
  const notice = parseNotice({ content: NOTICE_HTML }, NOW);
  const site = { id: '101', campus: '紫金港校区', venue: '体育馆', name: '羽毛球1号场', sport: '羽毛球' };
  // 21:00 已经过了 20:00 → 下一次放号是明天 20:00。
  const later = Date.parse('2026-11-10T21:00:00+08:00');
  assert.equal(releaseAt(site, '2026-11-13', 3, notice, later), atDate('2026-11-11', '20:00'));
  // 边界：正好 20:00 时「已经到点」，不算还没放。
  const exactly = atDate('2026-11-10', '20:00');
  assert.equal(releaseAt(site, '2026-11-13', 3, notice, exactly), atDate('2026-11-11', '20:00'));
});

test('releaseAt：days 不是正整数或不知道放号时刻时返回 undefined', () => {
  const notice = parseNotice({ content: NOTICE_HTML }, NOW);
  const site = { id: '101', campus: '紫金港校区', venue: '体育馆', name: '羽毛球1号场', sport: '羽毛球' };
  assert.equal(releaseAt(site, '2026-11-20', NaN, notice, NOW), undefined);
  assert.equal(releaseAt(site, '2026-11-20', 0, notice, NOW), undefined);
  assert.equal(releaseAt(site, '2026-11-20', 2.5, notice, NOW), undefined);
  // 场馆没有任何放号规则 → 算不出来。
  assert.equal(releaseAt({ ...site, sport: '游泳', name: '游泳池' }, '2026-11-20', 3, notice, NOW), undefined);
});

/* ────────────────────────────── 时段解析 ── */

/**
 * 一天的时段响应。
 *
 * 按上游 `parseDay` 的读法构造：`reservationDateSpaceInfo` 是「日期 → 场地数组」，
 * 场地对象除了 `id` / `spaceName`，还以**时段 id 为键**挂着
 * `{ startDate, endDate, reservationStatus }`。
 */
const DAY_PAYLOAD = {
  token: 'day-token-abc',
  advanceReservationDays: 3,
  notReserveType: 0,
  reservationDateList: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'],
  reservationDateSpaceInfo: {
    '2026-11-12': [
      {
        id: 501,
        spaceName: '1号场',
        9001: { startDate: '2026-11-12 09:00:00', endDate: '2026-11-12 10:00:00', reservationStatus: 1 },
        9002: { startDate: '2026-11-12 10:00:00', endDate: '2026-11-12 11:00:00', reservationStatus: 0 },
      },
      {
        id: 502,
        spaceName: '2号场',
        9001: { startDate: '2026-11-12 09:00:00', endDate: '2026-11-12 10:00:00', reservationStatus: 1 },
        9002: { startDate: '2026-11-12 10:00:00', endDate: '2026-11-12 11:00:00', reservationStatus: 1 },
      },
    ],
    '2026-11-11': [],
  },
};

test('parseDay：抽出全部时段、场地与状态', () => {
  const day = parseDay(DAY_PAYLOAD, '2026-11-12');
  assert.equal(day.date, '2026-11-12');
  assert.equal(day.open, true);
  assert.equal(day.days, 3);
  assert.equal(day.weekStart, '2026-11-09', '周起始日取 reservationDateList 的第一个');
  assert.equal(day.token, 'day-token-abc');
  assert.equal(day.message, '目标日期已开放');
  assert.equal(day.slots.length, 4);

  assert.deepEqual(day.slots[0], { spaceId: '501', space: '1号场', timeId: '9001', start: '09:00', end: '10:00', status: 1 });
  assert.deepEqual(day.slots[1], { spaceId: '501', space: '1号场', timeId: '9002', start: '10:00', end: '11:00', status: 0 });
  assert.equal(day.slots[2].spaceId, '502');
  assert.equal(day.slots[2].status, 1);
  // 场地自身的 id / spaceName 键不能被当成时段（它们没有 reservationStatus）。
  assert.equal(day.slots.filter((s) => s.timeId === 'id' || s.timeId === 'spaceName').length, 0);
});

test('parseDay：目标日期已开放但没有时段 → open:false（不当作已约满）', () => {
  const day = parseDay(DAY_PAYLOAD, '2026-11-11');
  assert.equal(day.open, false);
  assert.equal(day.slots.length, 0);
  assert.equal(day.message, '目标日期暂未发布时段');
});

test('parseDay：notReserveType=1 是「没有权限」，不是「没有空场」', () => {
  assert.throws(() => parseDay({ ...DAY_PAYLOAD, notReserveType: 1 }, '2026-11-12'), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /权限/);
    return true;
  });
});

test('parseDay：缺目标日期或字段不完整时抛 SHAPE（不返回空 slots）', () => {
  // 日期不在响应里。
  assert.throws(() => parseDay(DAY_PAYLOAD, '2026-11-13'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /2026-11-13/);
    return true;
  });
  // 缺 reservationDateList。
  const { reservationDateList, ...withoutList } = DAY_PAYLOAD;
  assert.throws(() => parseDay(withoutList, '2026-11-12'), { code: 'SHAPE' });
  // 某个时段缺结束时间。
  const broken = {
    ...DAY_PAYLOAD,
    reservationDateSpaceInfo: {
      '2026-11-12': [{ id: 501, spaceName: '1号场', 9001: { startDate: '2026-11-12 09:00:00', reservationStatus: 1 } }],
    },
  };
  assert.throws(() => parseDay(broken, '2026-11-12'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /字段不完整/);
    return true;
  });
});

test('parseDay：status 不是数字时抛 SHAPE', () => {
  const broken = {
    ...DAY_PAYLOAD,
    reservationDateSpaceInfo: {
      '2026-11-12': [{ id: 501, spaceName: '1号场', 9001: { startDate: '2026-11-12 09:00:00', endDate: '2026-11-12 10:00:00', reservationStatus: 'x' } }],
    },
  };
  assert.throws(() => parseDay(broken, '2026-11-12'), { code: 'SHAPE' });
});

test('nearbyTimes：按与目标时刻的距离取最近 3 个，再按先后排', () => {
  const day = {
    date: '2026-11-12',
    slots: [
      { spaceId: '501', space: '1号场', timeId: 'a', start: '09:00', end: '10:00', status: 1 },
      { spaceId: '502', space: '2号场', timeId: 'a', start: '09:00', end: '10:00', status: 1 },
      { spaceId: '503', space: '3号场', timeId: 'a', start: '09:00', end: '10:00', status: 0 },
      { spaceId: '501', space: '1号场', timeId: 'b', start: '10:00', end: '11:00', status: 1 },
      { spaceId: '501', space: '1号场', timeId: 'c', start: '11:00', end: '12:00', status: 1 },
      { spaceId: '501', space: '1号场', timeId: 'd', start: '14:00', end: '15:00', status: 1 },
      { spaceId: '501', space: '1号场', timeId: 'e', start: '20:00', end: '21:00', status: 1 },
    ],
  };
  const result = nearbyTimes(day, { start: '10:00' }, NOW);
  // 只留最近 3 个（09 与 11 与目标同距，14/20 更远）。
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((item) => item.start), ['09:00', '10:00', '11:00']);
  // 09:00 有三个场地，但只有 2 个是可约状态。
  assert.equal(result[0].availableCourts, 2);
  assert.equal(result[1].availableCourts, 1);
});

test('nearbyTimes：已经开始的时段不算候选', () => {
  const day = {
    date: '2026-11-12',
    slots: [
      { spaceId: '501', space: '1号场', timeId: 'a', start: '09:00', end: '10:00', status: 1 },
      { spaceId: '501', space: '1号场', timeId: 'b', start: '20:00', end: '21:00', status: 1 },
    ],
  };
  // 「现在」是 11-12 12:00，09:00 已过去。
  const noon = Date.parse('2026-11-12T12:00:00+08:00');
  assert.deepEqual(nearbyTimes(day, { start: '09:00' }, noon).map((item) => item.start), ['20:00']);
});

/* ────────────────────────────── 订单 ── */

test('parseOrder：字段在 orderInfo 里时从内层取', () => {
  const order = parseOrder({
    orderInfo: {
      id: 7,
      tradeNo: 'TY20261112001',
      venueSiteId: 101,
      campusName: '紫金港校区',
      venueName: '体育馆',
      siteName: '羽毛球1号场',
      reservationStartDate: '2026-11-12 20:00:00',
      reservationEndDate: '2026-11-12 21:00:00',
      reservationDateDetail: '晚场',
      orderStatus: 1,
      payStatus: 2,
      amountFee: '0.00',
      expireTime: '2026-11-10 20:15:00',
    },
    venueInfoBean: { venueSiteId: 999 },
  });
  assert.equal(order.id, '7');
  assert.equal(order.number, 'TY20261112001');
  assert.equal(order.siteId, '101', '内层的 venueSiteId 优先于 venueInfoBean');
  assert.equal(order.venue, '紫金港校区体育馆羽毛球1号场');
  assert.equal(order.date, '2026-11-12');
  assert.equal(order.start, '20:00');
  assert.equal(order.end, '21:00');
  assert.equal(order.status, 1);
  assert.equal(order.payStatus, 2);
  assert.equal(order.amount, '0.00');
  assert.equal(order.expires, '2026-11-10 20:15:00');
});

test('parseOrder：字段在外层时从外层取，siteId 回落到 venueInfoBean', () => {
  const order = parseOrder({
    tradeNo: 'TY2',
    reservationStartDate: '2026-11-12 09:00:00',
    reservationEndDate: '2026-11-12 10:00:00',
    orderStatus: 2,
    payStatus: 0,
    venueInfoBean: { venueSiteId: 202 },
  });
  assert.equal(order.number, 'TY2');
  assert.equal(order.siteId, '202');
  assert.equal(order.status, 2);
  assert.equal(order.payStatus, 0);
  assert.equal(order.amount, '');
});

test('parseOrder：带时区的服务端时间换成北京时间，不带时区的不动', () => {
  // UTC 12:00 = 北京时间 20:00。
  const utc = parseOrder({ tradeNo: 'A', reservationStartDate: '2026-11-12T12:00:00Z', reservationEndDate: '2026-11-12T13:00:00Z' });
  assert.equal(utc.date, '2026-11-12');
  assert.equal(utc.start, '20:00');
  assert.equal(utc.end, '21:00');
  // 带 +08:00 的 ISO。
  const offset = parseOrder({ tradeNo: 'B', reservationStartDate: '2026-11-12T09:00:00+08:00', reservationEndDate: '2026-11-12T10:00:00+08:00' });
  assert.equal(offset.start, '09:00');
  // 数字毫秒。
  const numeric = parseOrder({ tradeNo: 'C', reservationStartDate: Date.parse('2026-11-12T09:00:00+08:00'), reservationEndDate: Date.parse('2026-11-12T10:00:00+08:00') });
  assert.equal(numeric.date, '2026-11-12');
  assert.equal(numeric.start, '09:00');
});

test('parseOrder：没有开始时间时用 reservationDate 兜日期，时间留空', () => {
  const order = parseOrder({ tradeNo: 'D', reservationDate: '2026-11-12 00:00:00', reservationDateDetail: '全天' });
  assert.equal(order.date, '2026-11-12');
  assert.equal(order.start, '');
  assert.equal(order.end, '');
  // orderView 此时退回显示 description。
  assert.equal(orderView(order).time, '全天');
});

test('orderView：状态与付款状态直译成中文', () => {
  const base = { number: 'N', venue: '紫金港体育馆', date: '2026-11-12', start: '20:00', end: '21:00', description: '', amount: '0.00', expires: '2026-11-10 20:15:00' };
  assert.equal(orderView({ ...base, status: 1, payStatus: 2 }).status, '正常');
  assert.equal(orderView({ ...base, status: 1, payStatus: 2 }).payment, '已支付或已零元确认');
  assert.equal(orderView({ ...base, status: 2, payStatus: 0 }).status, '已取消');
  assert.equal(orderView({ ...base, status: 0, payStatus: 1 }).status, '待核对');
  assert.equal(orderView({ ...base, status: 0, payStatus: 1 }).payment, '未支付');
  assert.equal(orderView({ ...base, status: 1, payStatus: 0 }).payment, '退款或待核对');
  assert.equal(orderView({ ...base, status: 1, payStatus: 2, expires: '' }).expiresAt, null);
});

/* ────────────────────────────── 订单分页 ── */

/** 造一个只会应答「本人订单」的假客户端。 */
function orderClient(pages) {
  const calls = [];
  return {
    calls,
    async request(method, endpoint, params) {
      calls.push({ method, endpoint, params });
      if (endpoint !== '/api/orders/mine') throw new Error(`意外的接口 ${endpoint}`);
      return pages[params.page];
    },
  };
}

test('readOrders：last=true 时就是读全了', async () => {
  const client = orderClient([{ content: [{ tradeNo: 'A' }, { tradeNo: 'B' }], last: true }]);
  const { orders, complete } = await readOrders(client, { wait: async () => {} });
  assert.equal(complete, true);
  assert.deepEqual(orders.map((order) => order.number), ['A', 'B']);
  assert.equal(client.calls.length, 1);
  // 分页参数照上游：page 从 0 起，size=50。
  assert.deepEqual(client.calls[0].params, { page: 0, size: 50 });
});

test('readOrders：totalPages 判据下的两页', async () => {
  const client = orderClient([
    { content: [{ tradeNo: 'A' }], totalPages: 2 },
    { content: [{ tradeNo: 'B' }], totalPages: 2 },
  ]);
  const { orders, complete } = await readOrders(client, { wait: async () => {} });
  assert.equal(complete, true);
  assert.deepEqual(orders.map((order) => order.number), ['A', 'B']);
  assert.equal(client.calls.length, 2);
});

test('readOrders：既无 last 也无 totalPages 时抛 SHAPE（不能把第一页当全部）', async () => {
  const client = orderClient([{ content: [{ tradeNo: 'A' }] }]);
  await assert.rejects(() => readOrders(client, { wait: async () => {} }), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /分页/);
    return true;
  });
});

test('readOrders：content 不是数组时抛 SHAPE', async () => {
  const client = orderClient([{ content: null, last: true }]);
  await assert.rejects(() => readOrders(client, { wait: async () => {} }), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /没有列表/);
    return true;
  });
});

test('readOrders：订单缺订单号时抛 SHAPE', async () => {
  const client = orderClient([{ content: [{ tradeNo: '' }], last: true }]);
  await assert.rejects(() => readOrders(client, { wait: async () => {} }), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /订单号/);
    return true;
  });
});

test('readOrders：同一笔订单跨页重复时按订单号去重', async () => {
  const client = orderClient([
    { content: [{ tradeNo: 'A' }, { tradeNo: 'B' }], totalPages: 2 },
    { content: [{ tradeNo: 'B' }, { tradeNo: 'C' }], totalPages: 2 },
  ]);
  const { orders } = await readOrders(client, { wait: async () => {} });
  assert.deepEqual(orders.map((order) => order.number), ['A', 'B', 'C']);
});

test('readOrders：一页里没有新订单就停，并标为未读全', async () => {
  const client = orderClient([
    { content: [{ tradeNo: 'A' }], totalPages: 5 },
    { content: [{ tradeNo: 'A' }], totalPages: 5 },
  ]);
  const { orders, complete } = await readOrders(client, { wait: async () => {} });
  assert.equal(complete, false);
  assert.deepEqual(orders.map((order) => order.number), ['A']);
  assert.equal(client.calls.length, 2);
});

test('readOrders：翻到上限还没读完时 complete=false', async () => {
  const pages = [];
  for (let page = 0; page < 20; page += 1) pages.push({ content: [{ tradeNo: `N${page}` }], totalPages: 999 });
  const client = orderClient(pages);
  const { orders, complete } = await readOrders(client, { wait: async () => {} });
  assert.equal(complete, false);
  assert.equal(orders.length, 10, '上限 10 页');
  assert.equal(client.calls.length, 10);
});

test('listOrders：不给日期只看今天及以后，读不全时状态是 partial', async () => {
  const today = beijingDate(NOW);
  const page = {
    content: [
      { tradeNo: 'OLD', reservationStartDate: '2020-01-01 09:00:00' },
      { tradeNo: 'TODAY', reservationStartDate: `${today} 20:00:00` },
    ],
    totalPages: 5,
  };
  // 第二页全是重复订单 → 没有新增 → 提前停，且 complete=false。
  const client = orderClient([page, page]);
  const result = await listOrders(client, {}, NOW);
  assert.equal(result.status, 'partial');
  assert.match(result.message, /还没取全/);
  assert.deepEqual(result.orders.map((order) => order.number), ['TODAY']);
  assert.equal(result.observedAt, '2026-11-10 10:00:00');
});

test('listOrders：按日期与场馆名筛选（场馆名忽略「校区」与空白）', async () => {
  const client = orderClient([{
    content: [
      { tradeNo: 'A', campusName: '紫金港校区', venueName: '体育馆', siteName: '羽毛球1号场', reservationStartDate: '2026-11-13 20:00:00', reservationEndDate: '2026-11-13 21:00:00' },
      { tradeNo: 'B', campusName: '玉泉校区', venueName: '邵体馆', siteName: '网球场', reservationStartDate: '2026-11-13 20:00:00', reservationEndDate: '2026-11-13 21:00:00' },
    ],
    last: true,
  }]);
  const byDate = await listOrders(client, { date: '2026-11-13' }, NOW);
  assert.equal(byDate.status, 'listed');
  assert.equal(byDate.orders.length, 2);
  const byVenue = await listOrders(client, { date: '2026-11-13', venue: '紫金港 体育馆' }, NOW);
  assert.deepEqual(byVenue.orders.map((order) => order.number), ['A']);
  const none = await listOrders(client, { date: '2026-11-14' }, NOW);
  assert.deepEqual(none.orders, []);
  assert.equal(none.message, '找到 0 笔符合条件的本人预约');
});

/* ────────────────────────────── 场馆客户端：登录 ── */

/** 场馆平台的登录应答：`/api/login` 给初步令牌与角色，`/roleLogin` 给正式令牌。 */
const loginRoutes = (extra = []) => [
  ['/api/login', () => envelope({ token: { access_token: 'initial-token' }, roles: [{ id: 3 }, { id: 4 }], username: '3230100000', name: '张三' })],
  ['/roleLogin', () => envelope({ token: { access_token: 'final-token' }, username: '3230100000', name: '张三', userId: 42 })],
  ...extra,
];

/** 造一个场馆客户端（带登录回调）。 */
function venueClient(routes, options = {}) {
  const { request, calls } = fakeRequest(routes);
  const logins = [];
  const client = new VenueClient({
    request,
    acquireLogin: async ({ service }) => { logins.push(service); return { url: `http://tyys.zju.edu.cn/x?oauth_token=OT-123` }; },
    username: '3230100000',
    now: () => NOW,
    ...options,
  });
  return { client, calls, logins };
}

test('VenueClient：没注入登录回调时抛 CONFIG，文案指向设置入口', async () => {
  const { request } = fakeRequest([]);
  const client = new VenueClient({ request, now: () => NOW });
  await assert.rejects(() => client.identity(), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /设置/);
    assert.match(error.message, /浙大一卡通/);
    // 不能出现只对插件作者有意义的内部名词。
    assert.equal(/setLoginProvider/.test(error.message), false);
    return true;
  });
});

test('VenueClient：CAS 回跳地址里没有 oauth_token 时抛 AUTH_EXPIRED', async () => {
  const { request } = fakeRequest(loginRoutes());
  const client = new VenueClient({
    request,
    acquireLogin: async () => ({ url: 'http://tyys.zju.edu.cn/venue-server/sso/manageLogin' }),
    username: '3230100000',
    now: () => NOW,
  });
  await assert.rejects(() => client.identity(), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    assert.match(error.message, /oauth_token/);
    return true;
  });
});

test('VenueClient：登录接口业务码非 200 时抛 AUTH_EXPIRED', async () => {
  const { request } = fakeRequest([['/api/login', () => ({ status: 200, text: JSON.stringify({ code: 500, message: '系统繁忙' }) })]]);
  const client = new VenueClient({
    request,
    acquireLogin: async () => ({ url: 'http://x/?oauth_token=A' }),
    username: '3230100000',
    now: () => NOW,
  });
  await assert.rejects(() => client.identity(), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    assert.match(error.message, /500/);
    return true;
  });
});

test('VenueClient：账号没有学生预约角色（id=3）时抛 REJECTED', async () => {
  const { request } = fakeRequest([
    ['/api/login', () => envelope({ token: { access_token: 'initial-token' }, roles: [{ id: 1 }, { id: 4 }] })],
  ]);
  const client = new VenueClient({
    request,
    acquireLogin: async () => ({ url: 'http://x/?oauth_token=A' }),
    username: '3230100000',
    now: () => NOW,
  });
  await assert.rejects(() => client.identity(), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /学生预约/);
    return true;
  });
});

test('VenueClient：roleLogin 失败或没有令牌时抛错', async () => {
  const failing = fakeRequest([
    ['/api/login', () => envelope({ token: { access_token: 'i' }, roles: [{ id: 3 }] })],
    ['/roleLogin', () => ({ status: 200, text: JSON.stringify({ code: 401 }) })],
  ]);
  const a = new VenueClient({ request: failing.request, acquireLogin: async () => ({ url: 'http://x/?oauth_token=A' }), username: '3230100000', now: () => NOW });
  await assert.rejects(() => a.identity(), { code: 'AUTH_EXPIRED' });

  const empty = fakeRequest([
    ['/api/login', () => envelope({ token: { access_token: 'i' }, roles: [{ id: 3 }] })],
    ['/roleLogin', () => envelope({ token: {} })],
  ]);
  const b = new VenueClient({ request: empty.request, acquireLogin: async () => ({ url: 'http://x/?oauth_token=A' }), username: '3230100000', now: () => NOW });
  await assert.rejects(() => b.identity(), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /访问令牌/);
    return true;
  });
});

test('VenueClient：登录成功后有令牌、有身份，且并发登录只走一次 CAS', async () => {
  const { client, calls, logins } = venueClient(loginRoutes([['/api/orders/mine', () => envelope({ content: [], last: true })]]));
  const [first, second] = await Promise.all([client.identity(), client.identity()]);
  assert.equal(first.username, '3230100000');
  assert.equal(second.name, '张三');
  assert.equal(logins.length, 1, '并发登录要合并成一次 CAS');
  assert.equal(logins[0], VENUE_LOGIN_SERVICE);
  assert.equal(client.loggedIn, true);
  // 两个 POST：/api/login 与 /roleLogin。
  assert.deepEqual(calls.filter((call) => call.method === 'POST').map((call) => call.url.replace(VENUE_BASE, '')), ['/api/login', '/roleLogin']);
});

test('VenueClient：登录返回的是另一个账号时抛 AUTH_EXPIRED', async () => {
  const { request } = fakeRequest([
    ['/api/login', () => envelope({ token: { access_token: 'i' }, roles: [{ id: 3 }], username: '3230199999' })],
    ['/roleLogin', () => envelope({ token: { access_token: 'f' }, username: '3230199999' })],
  ]);
  const client = new VenueClient({ request, acquireLogin: async () => ({ url: 'http://x/?oauth_token=A' }), username: '3230100000', now: () => NOW });
  await assert.rejects(() => client.identity(), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    assert.match(error.message, /另一个账号/);
    return true;
  });
  assert.equal(client.loggedIn, false, '对不上账号的令牌必须丢掉');
});

/* ────────────────────────────── 场馆客户端：请求 ── */

test('VenueClient：GET 带 app-key / timestamp / sign / cgAuthorization，且 nocache 参与签名', async () => {
  const { client, calls } = venueClient(loginRoutes([['/api/orders/mine', () => envelope({ content: [], last: true })]]));
  await client.request('GET', '/api/orders/mine', { page: 0, size: 50 });
  const get = calls.at(-1);
  assert.equal(get.method, 'GET');
  assert.equal(get.headers['app-key'], '8fceb735082b5a529312040b58ea780b');
  assert.equal(get.headers.timestamp, String(NOW));
  assert.equal(get.headers.cgAuthorization, 'final-token');
  // 查询串里有 nocache。
  const url = new URL(get.url);
  assert.equal(url.origin + url.pathname, VENUE_BASE + '/api/orders/mine');
  assert.equal(url.searchParams.get('nocache'), String(NOW));
  assert.equal(url.searchParams.get('page'), '0');
  assert.equal(url.searchParams.get('size'), '50');
  // 签名必须覆盖 nocache —— 用同一份参数独立重算一遍。
  const expected = venueSignature('/api/orders/mine', { page: 0, size: 50, nocache: String(NOW) }, String(NOW));
  assert.equal(get.headers.sign, expected);
  // 漏掉 nocache 会得到另一个签名（这正是真机上最常见的错法）。
  assert.notEqual(expected, venueSignature('/api/orders/mine', { page: 0, size: 50 }, String(NOW)));
});

test('VenueClient：POST 的参数进表单体，且带 Content-Type', async () => {
  const { client, calls } = venueClient(loginRoutes([['/api/reservation/order/info', () => envelope({ venueInfoBean: { buddyNumMin: 0 }, phone: '13800000000', isCaptchaCheck: 0 })]]));
  await client.preview({ venueSiteId: '101', date: '2026-11-12', weekStartDate: '2026-11-09', token: 'tk', slots: [{ spaceId: '501', timeId: '9001' }] });
  const post = calls.at(-1);
  assert.equal(post.method, 'POST');
  assert.equal(post.headers['Content-Type'], 'application/x-www-form-urlencoded');
  // POST 不加 nocache。
  assert.equal(post.url, VENUE_BASE + '/api/reservation/order/info');
  assert.match(post.body, /venueSiteId=101/);
  assert.match(post.body, /reservationDate=2026-11-12/);
  assert.match(post.body, /schoolType=1/);
  assert.match(post.body, /token=tk/);
  // reservationOrderJson 是 JSON 串，里面的 venueSpaceGroupId 是 null。
  const json = new URLSearchParams(post.body).get('reservationOrderJson');
  assert.deepEqual(JSON.parse(json), [{ spaceId: '501', timeId: '9001', venueSpaceGroupId: null }]);
});

test('VenueClient：写接口一律拦下（这是 D17 的分层防线）', async () => {
  const { client, calls } = venueClient(loginRoutes());
  for (const endpoint of ['/api/reservation/order/submit', '/api/venue/finances/order/pay', '/api/venue/finances/order/cancel']) {
    await assert.rejects(() => client.request('POST', endpoint, {}), (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /写操作/);
      return true;
    });
  }
  // 一个业务请求都没发出去（登录也没发生）。
  assert.equal(calls.length, 0);
});

test('VenueClient：只读白名单之外的 POST 也拒绝', async () => {
  const { client, calls } = venueClient(loginRoutes());
  await assert.rejects(() => client.request('POST', '/api/orders/mine', {}), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /不支持对这个接口用 POST/);
    return true;
  });
  assert.equal(calls.length, 0);
});

test('VenueClient：非法路径抛 CONFIG', async () => {
  const { client } = venueClient(loginRoutes());
  await assert.rejects(() => client.request('GET', '/sso/manageLogin'), { code: 'CONFIG' });
  await assert.rejects(() => client.request('GET', 'api/x'), { code: 'CONFIG' });
  await assert.rejects(() => client.request('GET', '/api/x?y=1'), { code: 'CONFIG' });
});

test('VenueClient：会话失效时重登一次并重放（GET）', async () => {
  let mineCalls = 0;
  const { client, calls, logins } = venueClient([
    ['/api/login', () => envelope({ token: { access_token: 'initial-token' }, roles: [{ id: 3 }], username: '3230100000' })],
    ['/roleLogin', () => envelope({ token: { access_token: `final-${logins.length}` }, username: '3230100000' })],
    ['/api/orders/mine', () => {
      mineCalls += 1;
      return mineCalls === 1 ? { status: 200, text: JSON.stringify({ code: 401 }) } : envelope({ content: [{ tradeNo: 'A' }], last: true });
    }],
  ]);
  const { orders, complete } = await readOrders(client, { wait: async () => {} });
  assert.equal(complete, true);
  assert.deepEqual(orders.map((order) => order.number), ['A']);
  assert.equal(mineCalls, 2, '401 之后要重放一次');
  assert.equal(logins.length, 2, '重放前要重新登录一次');
  assert.equal(calls.filter((call) => call.url.includes('/api/orders/mine')).length, 2);
});

test('VenueClient：重登后仍然 401 时抛 AUTH_EXPIRED（不死循环）', async () => {
  const { client, logins } = venueClient([
    ['/api/login', () => envelope({ token: { access_token: 'i' }, roles: [{ id: 3 }], username: '3230100000' })],
    ['/roleLogin', () => envelope({ token: { access_token: 'f' }, username: '3230100000' })],
    ['/api/orders/mine', () => ({ status: 200, text: JSON.stringify({ code: 401 }) })],
  ]);
  await assert.rejects(() => client.request('GET', '/api/orders/mine'), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    assert.match(error.message, /仍然拒绝/);
    return true;
  });
  assert.equal(logins.length, 2, '最多重登一次');
});

test('VenueClient：POST 遇到 401 时不自动重放（避免重复一次业务动作）', async () => {
  const { client, calls, logins } = venueClient([
    ['/api/login', () => envelope({ token: { access_token: 'i' }, roles: [{ id: 3 }], username: '3230100000' })],
    ['/roleLogin', () => envelope({ token: { access_token: 'f' }, username: '3230100000' })],
    ['/api/reservation/order/info', () => ({ status: 200, text: JSON.stringify({ code: 401 }) })],
  ]);
  await assert.rejects(
    () => client.preview({ venueSiteId: '101', date: '2026-11-12', weekStartDate: '2026-11-09', token: 'tk', slots: [{ spaceId: '1', timeId: '2' }] }),
    (error) => {
      assert.equal(error.code, 'AUTH_EXPIRED');
      assert.match(error.message, /没有自动重放/);
      return true;
    },
  );
  assert.equal(calls.filter((call) => call.url.includes('/api/reservation/order/info')).length, 1);
  assert.equal(logins.length, 1);
});

test('VenueClient：匿名接口（须知）遇 401 也不重登', async () => {
  const { client, logins } = venueClient([
    [PROTOCOL_PATH, () => ({ status: 200, text: JSON.stringify({ code: 401 }) })],
  ]);
  await assert.rejects(() => client.notice(), { code: 'AUTH_EXPIRED' });
  assert.equal(logins.length, 0, '匿名接口不该触发登录');
});

test('VenueClient：250 + day/info 是「没放号」，不是错误', async () => {
  const { client } = venueClient([
    ...loginRoutes(),
    ['/api/reservation/day/info', () => ({ status: 200, text: JSON.stringify({ code: 250, message: '该日期还未开放预约' }) })],
  ]);
  const day = await client.day({ id: '101' }, '2026-11-20');
  assert.equal(day.date, '2026-11-20');
  assert.equal(day.open, false);
  assert.equal(day.slots.length, 0);
  assert.equal(day.message, '该日期还未开放预约');
  assert.equal(Number.isNaN(day.days), true, '没放号时不知道窗口天数');
});

test('VenueClient：250 出现在别的接口上是拒绝，不是「没放号」', async () => {
  const { client } = venueClient([
    ...loginRoutes(),
    ['/api/orders/mine', () => ({ status: 200, text: JSON.stringify({ code: 250, message: '格式不对' }) })],
  ]);
  await assert.rejects(() => client.request('GET', '/api/orders/mine'), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /格式不对/);
    return true;
  });
});

test('VenueClient：业务码 200 之外的拒绝带平台给的原因', async () => {
  const { client } = venueClient([
    ...loginRoutes(),
    ['/api/orders/mine', () => ({ status: 200, text: JSON.stringify({ code: 500, message: '系统维护中' }) })],
  ]);
  await assert.rejects(() => client.request('GET', '/api/orders/mine'), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /系统维护中/);
    assert.equal(error.details.code, 500);
    return true;
  });
});

test('VenueClient：响应不是 JSON 时抛 SHAPE（不猜结果）', async () => {
  const { client } = venueClient([
    ...loginRoutes(),
    ['/api/orders/mine', () => ({ status: 200, text: '<html>登录</html>' })],
  ]);
  await assert.rejects(() => client.request('GET', '/api/orders/mine'), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /没有返回 JSON/);
    return true;
  });
});

test('VenueClient：缺 code 或 HTTP 非 2xx 时抛 SHAPE', async () => {
  const noCode = venueClient([
    ...loginRoutes(),
    ['/api/orders/mine', () => ({ status: 200, text: JSON.stringify({ data: [] }) })],
  ]);
  await assert.rejects(() => noCode.client.request('GET', '/api/orders/mine'), { code: 'SHAPE' });

  const bad = venueClient([
    ...loginRoutes(),
    ['/api/orders/mine', () => ({ status: 502, text: JSON.stringify({ code: 200, data: [] }) })],
  ]);
  await assert.rejects(() => bad.client.request('GET', '/api/orders/mine'), { code: 'SHAPE' });
});

test('VenueClient：HTTP 429 与业务码 408 都是限流', async () => {
  const http = venueClient([
    ...loginRoutes(),
    ['/api/orders/mine', () => ({ status: 429, text: '' })],
  ]);
  await assert.rejects(() => http.client.request('GET', '/api/orders/mine'), (error) => {
    assert.equal(error.code, 'RATE_LIMITED');
    assert.match(error.message, /限制访问/);
    return true;
  });

  const business = venueClient([
    ...loginRoutes(),
    ['/api/orders/mine', () => ({ status: 200, text: JSON.stringify({ code: 408 }) })],
  ]);
  await assert.rejects(() => business.client.request('GET', '/api/orders/mine'), { code: 'RATE_LIMITED' });
});

test('VenueClient：请求一直不返回时超时抛 TIMEOUT（不是永久挂住）', async () => {
  const client = new VenueClient({
    // 故意给一个永不 resolve 的 request：这模拟「注入的 request 完全不看 signal」。
    request: () => new Promise(() => {}),
    acquireLogin: async () => ({ url: 'http://x/?oauth_token=A' }),
    username: '3230100000',
    now: () => NOW,
    timeoutMs: 20,
  });
  await assert.rejects(() => client.identity(), (error) => {
    assert.equal(error.code, 'TIMEOUT');
    assert.match(error.message, /20ms/);
    return true;
  });
  assert.equal(REQUEST_TIMEOUT_MS, 10_000, '默认值取上游 HttpClient 的 10 秒');
});

test('VenueClient：传输层抛错翻成 UNREACHABLE', async () => {
  const client = new VenueClient({
    request: async () => { throw new Error('ECONNRESET'); },
    acquireLogin: async () => ({ url: 'http://x/?oauth_token=A' }),
    username: '3230100000',
    now: () => NOW,
  });
  await assert.rejects(() => client.identity(), (error) => {
    assert.equal(error.code, 'UNREACHABLE');
    assert.match(error.message, /ECONNRESET/);
    return true;
  });
});

/* ────────────────────────────── 目录与须知（缓存） ── */

/** 目录响应：树里混了艺术团与不可预约节点。 */
const CATALOG_PAYLOAD = {
  reservationNumMax: 2,
  venueSiteInfo: {
    紫金港: {
      体育馆: [
        { id: 101, siteName: '羽毛球1号场', campusName: '紫金港校区', venueName: '体育馆', sportName: '羽毛球', reservationSpaceCount: 3, isSupportReservation: 1, isArt: 0 },
        { id: 102, siteName: '羽毛球2号场', campusName: '紫金港校区', venueName: '体育馆', sportName: '羽毛球', isSupportReservation: 1 },
        // 艺术团 → 剔除。
        { id: 103, siteName: '舞蹈房', campusName: '紫金港校区', venueName: '体育馆', sportName: '舞蹈', isSupportReservation: 1, isArt: 1 },
        // 不可预约 → 剔除。
        { id: 104, siteName: '器材室', campusName: '紫金港校区', venueName: '体育馆', sportName: '器材', isSupportReservation: 0 },
      ],
    },
    玉泉: [{ id: 201, siteName: '网球场', campusName: '玉泉校区', venueName: '邵体馆', sportName: '网球', isSupportReservation: 1 }],
  },
};

test('VenueClient.catalog：递归读树，剔掉艺术团与不可预约的场地', async () => {
  const { client } = venueClient([
    ...loginRoutes(),
    ['/api/reservation/campus/venue/info', () => envelope(CATALOG_PAYLOAD)],
  ]);
  const catalog = await client.catalog();
  assert.deepEqual(catalog.sites.map((site) => site.id), ['101', '102', '201']);
  assert.equal(catalog.maxSlots, 2);
  assert.equal(catalog.fetchedAt, '2026-11-10 10:00:00');
  // 有 reservationSpaceCount 就用它，没有就用目录的 maxSlots。
  assert.equal(catalog.sites[0].maxSlots, 3);
  assert.equal(catalog.sites[1].maxSlots, 2);
  assert.equal(catalog.sites[2].sport, '网球');
});

test('VenueClient.catalog：目录为空时抛 SHAPE（不当成「没有任何场地」）', async () => {
  const { client } = venueClient([...loginRoutes(), ['/api/reservation/campus/venue/info', () => envelope({ venueSiteInfo: {} })]]);
  await assert.rejects(() => client.catalog(), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /没有任何可预约/);
    return true;
  });
});

test('VenueClient.catalog / notice：第二次读走缓存，不再发请求', async () => {
  const { client, calls } = venueClient([
    ...loginRoutes(),
    ['/api/reservation/campus/venue/info', () => envelope(CATALOG_PAYLOAD)],
    [PROTOCOL_PATH, () => envelope({ title: '须知', content: NOTICE_HTML })],
  ]);
  await client.catalog();
  await client.catalog();
  await client.notice();
  await client.notice();
  assert.equal(calls.filter((call) => call.url.includes('/api/reservation/campus/venue/info')).length, 1);
  assert.equal(calls.filter((call) => call.url.includes(PROTOCOL_PATH)).length, 1);
});

test('VenueClient.notice：匿名可读，不需要登录也不带令牌', async () => {
  const { request, calls } = fakeRequest([[PROTOCOL_PATH, () => envelope({ title: '须知', content: NOTICE_HTML })]]);
  const client = new VenueClient({ request, now: () => NOW });
  const notice = await client.notice();
  assert.equal(notice.title, '须知');
  assert.equal(notice.releaseTimes.length, 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.cgAuthorization, undefined);
});

test('VenueClient.preview：公布电话、验证码要求与同伴人数', async () => {
  const { client } = venueClient([
    ...loginRoutes(),
    ['/api/reservation/order/info', () => envelope({ venueInfoBean: { buddyNumMin: 1, buddyNumMax: 1 }, phone: '13800000000', isCaptchaCheck: 1 })],
  ]);
  const preview = await client.preview({ venueSiteId: '101', date: '2026-11-12', weekStartDate: '2026-11-09', token: 'tk', slots: [{ spaceId: '501', timeId: '9001' }] });
  assert.deepEqual(preview, { phone: '13800000000', captchaRequired: true, buddyMin: 1, buddyMax: 1 });
});

test('VenueClient.preview：缺参数抛 CONFIG，缺场馆规则抛 SHAPE', async () => {
  const { client } = venueClient([
    ...loginRoutes(),
    ['/api/reservation/order/info', () => envelope({ phone: '1' })],
  ]);
  await assert.rejects(() => client.preview({}), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /场馆 id/);
    return true;
  });
  await assert.rejects(() => client.preview({ venueSiteId: '1', date: '2026-11-12', weekStartDate: '2026-11-09', token: 't', slots: [{ spaceId: '1', timeId: '2' }] }), (error) => {
    assert.equal(error.code, 'SHAPE');
    assert.match(error.message, /场馆规则/);
    return true;
  });
});

test('VenueClient.request：串行化，一次只发一个（不把批量读变成请求风暴）', async () => {
  let active = 0;
  let peak = 0;
  const { request } = fakeRequest([['/api/orders/mine', async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return envelope({ content: [], last: true });
  }], ['/api/login', () => envelope({ token: { access_token: 'i' }, roles: [{ id: 3 }], username: '3230100000' })],
  ['/roleLogin', () => envelope({ token: { access_token: 'f' }, username: '3230100000' })]]);
  const client = new VenueClient({ request, acquireLogin: async () => ({ url: 'http://x/?oauth_token=A' }), username: '3230100000', now: () => NOW });
  await Promise.all([client.request('GET', '/api/orders/mine'), client.request('GET', '/api/orders/mine')]);
  assert.equal(peak, 1);
});

/* ────────────────────────────── listVenues 状态机 ── */

/** 造一个假的场馆客户端（只实现 listVenues 用到的三个方法）。 */
function fakeVenueFor({ catalog, day, notice }) {
  return {
    async catalog() { return catalog; },
    async day() { return day; },
    async notice() { return notice; },
  };
}

const SITES = [
  { id: '101', campus: '紫金港校区', venue: '体育馆', name: '羽毛球1号场', sport: '羽毛球', maxSlots: 2 },
  { id: '102', campus: '紫金港校区', venue: '体育馆', name: '羽毛球2号场', sport: '羽毛球', maxSlots: 2 },
  { id: '201', campus: '玉泉校区', venue: '邵体馆', name: '网球场', sport: '网球', maxSlots: 1 },
];
const CATALOG = { sites: SITES, maxSlots: 2, fetchedAt: '2026-11-10 10:00:00' };
const NOTICE = parseNotice({ content: NOTICE_HTML }, NOW);

/** 让所有时段都在未来的 TEST_DAY。 */
const TEST_DAY = '2026-11-12';

test('listVenues：没指定筛选时只列目录', async () => {
  const client = fakeVenueFor({ catalog: CATALOG });
  const result = await listVenues(client, { date: TEST_DAY }, NOW);
  assert.equal(result.status, 'catalog');
  assert.equal(result.venues.length, 3);
  assert.equal(result.fetchedAt, '2026-11-10 10:00:00');
  assert.match(result.message, /指定其中一个场馆/);
});

test('listVenues：筛选命中多个时也回目录（不替用户挑一个）', async () => {
  const client = fakeVenueFor({ catalog: CATALOG });
  const result = await listVenues(client, { sport: '羽毛球', date: TEST_DAY }, NOW);
  assert.equal(result.status, 'catalog');
  assert.deepEqual(result.venues.map((venue) => venue.site), ['羽毛球1号场', '羽毛球2号场']);
});

test('listVenues：筛选命中 0 个时说清是没匹配上', async () => {
  const client = fakeVenueFor({ catalog: CATALOG });
  const result = await listVenues(client, { sport: '游泳', date: TEST_DAY }, NOW);
  assert.equal(result.status, 'catalog');
  assert.deepEqual(result.venues, []);
  assert.match(result.message, /没有匹配/);
});

test('listVenues：日期不是 YYYY-MM-DD 时抛 CONFIG', async () => {
  const client = fakeVenueFor({ catalog: CATALOG });
  await assert.rejects(() => listVenues(client, { date: '明天' }, NOW), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /YYYY-MM-DD/);
    return true;
  });
  await assert.rejects(() => listVenues(client, {}, NOW), { code: 'CONFIG' });
});

test('listVenues：有空场时聚合成「时段 + 场地名单」', async () => {
  const day = parseDay(DAY_PAYLOAD, TEST_DAY);
  const client = fakeVenueFor({ catalog: CATALOG, day, notice: NOTICE });
  const result = await listVenues(client, { venue: '邵体馆', date: TEST_DAY }, NOW);
  // 邵体馆是网球场，配 DAY_PAYLOAD 的时段（假数据，只为验证聚合逻辑）。
  assert.equal(result.status, 'available');
  assert.equal(result.date, TEST_DAY);
  assert.deepEqual(result.venue, { campus: '玉泉校区', venue: '邵体馆', site: '网球场', sport: '网球' });
  // 只算 status=1 且还没开始的：09:00-10:00 两个场地都空、10:00-11:00 只有 2 号场。
  assert.equal(result.slots.length, 2);
  assert.deepEqual(result.slots[0], { start: '09:00', end: '10:00', courts: ['1号场', '2号场'] });
  assert.deepEqual(result.slots[1], { start: '10:00', end: '11:00', courts: ['2号场'] });
  assert.equal(result.observedAt, '2026-11-10 10:00:00');
});

test('listVenues：已开放但没有可约时段时 status=unavailable（不是 not-released）', async () => {
  const day = { date: TEST_DAY, open: true, days: 3, weekStart: '2026-11-09', token: 't', slots: [
    { spaceId: '1', space: '1号场', timeId: 'a', start: '20:00', end: '21:00', status: 0 },
  ], message: '已开放' };
  const client = fakeVenueFor({ catalog: CATALOG, day, notice: NOTICE });
  const result = await listVenues(client, { venue: '邵体馆', date: TEST_DAY }, NOW);
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.slots, []);
  assert.match(result.message, /没有符合条件的空场/);
  assert.equal(result.releaseAt, null);
});

test('listVenues：未开放时按须知给出预计放号时刻', async () => {
  const day = { date: '2026-11-15', open: false, days: 3, weekStart: '', token: '', slots: [], message: '未发布' };
  const client = fakeVenueFor({ catalog: CATALOG, day, notice: NOTICE });
  const result = await listVenues(client, { venue: '邵体馆', date: '2026-11-15' }, NOW);
  assert.equal(result.status, 'not-released');
  // 网球场没有任何放号规则 → 算不出来，必须如实说「算不出来」。
  assert.equal(result.releaseAt, null);
  assert.equal(result.releaseTime, null);
  assert.match(result.message, /暂时算不出来/);
});

test('listVenues：未开放且场馆有放号规则时给出时刻与放号点', async () => {
  // 紫金港体育馆羽毛球 → 每天 20:00。
  const day = { date: '2026-11-14', open: false, days: 3, weekStart: '', token: '', slots: [], message: '未发布' };
  const client = fakeVenueFor({ catalog: CATALOG, day, notice: NOTICE });
  const result = await listVenues(client, { venue: '紫金港体育馆羽毛球1号场', date: '2026-11-14' }, NOW);
  assert.equal(result.status, 'not-released');
  // 窗口是 11-10..11-12（days=3），11-14 落后 2 天：
  // 11-10 20:00 放到 11-13，11-11 20:00 才放到 11-14。
  assert.equal(result.releaseTime, '20:00');
  assert.equal(result.releaseAt, '2026-11-11 20:00:00');
  assert.match(result.message, /2026-11-11 20:00:00/);
});

test('listVenues：未开放且当天的 day 没给天数时会再查今天', async () => {
  const days = ['2026-11-10', '2026-11-14'];
  let call = 0;
  const client = {
    async catalog() { return CATALOG; },
    async day(_site, date) {
      call += 1;
      if (date === '2026-11-10') return { date, open: true, days: 3, weekStart: 'x', token: 't', slots: [], message: '' };
      return { date, open: false, days: NaN, weekStart: '', token: '', slots: [], message: '未发布' };
    },
    async notice() { return NOTICE; },
  };
  const result = await listVenues(client, { venue: '紫金港体育馆羽毛球1号场', date: '2026-11-14' }, NOW);
  assert.equal(call, 2, '一次查目标日、一次查今天补天数');
  // 今天的 days=3 → 窗口 11-10..11-12；11-14 落后 2 天 → 11-11 20:00 放号。
  assert.equal(result.releaseAt, '2026-11-11 20:00:00');
  assert.deepEqual(days.sort(), ['2026-11-10', '2026-11-14']);
});

test('listVenues：目标时刻没有这个时段时给相邻可选', async () => {
  const day = { date: TEST_DAY, open: true, days: 3, weekStart: 'w', token: 't', slots: [
    { spaceId: '1', space: '1号场', timeId: 'a', start: '09:00', end: '10:00', status: 1 },
    { spaceId: '1', space: '1号场', timeId: 'b', start: '11:00', end: '12:00', status: 1 },
  ], message: '' };
  const client = fakeVenueFor({ catalog: CATALOG, day, notice: NOTICE });
  const result = await listVenues(client, { venue: '邵体馆', date: TEST_DAY, time: { start: '10:00' } }, NOW);
  assert.equal(result.status, 'needs-time');
  assert.match(result.message, /10:00/);
  assert.deepEqual(result.alternatives.map((item) => item.start), ['09:00', '11:00']);
});

test('listVenues：给了区间时只留完全落在区间内的时段', async () => {
  const day = { date: TEST_DAY, open: true, days: 3, weekStart: 'w', token: 't', slots: [
    { spaceId: '1', space: '1号场', timeId: 'a', start: '09:00', end: '10:00', status: 1 },
    { spaceId: '1', space: '1号场', timeId: 'b', start: '11:00', end: '12:00', status: 1 },
    { spaceId: '1', space: '1号场', timeId: 'c', start: '14:00', end: '15:00', status: 1 },
  ], message: '' };
  const client = fakeVenueFor({ catalog: CATALOG, day, notice: NOTICE });
  const result = await listVenues(client, { venue: '邵体馆', date: TEST_DAY, time: { start: '11:00', end: '15:00' } }, NOW);
  assert.deepEqual(result.slots.map((slot) => slot.start), ['11:00', '14:00']);
});

/* ────────────────────────────── 体艺 App ── */

/** 造一个 App 客户端（令牌由 `acquireLogin` 给）。 */
function appClient(routes, options = {}) {
  const { request, calls } = fakeRequest(routes);
  const logins = [];
  const token = makeToken();
  const client = new TyysApp({
    request,
    acquireLogin: async ({ service }) => { logins.push(service); return { status: 200, body: `<script>var cfg = {"jwtToken":"${token}"};</script>` }; },
    username: '3230100000',
    now: () => NOW,
    ...options,
  });
  return { client, calls, logins, token };
}

test('TyysApp：没注入登录回调时抛 CONFIG', async () => {
  const { request } = fakeRequest([]);
  const client = new TyysApp({ request, username: '3230100000', now: () => NOW });
  await assert.rejects(() => client.checkSession(), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /浙大一卡通/);
    return true;
  });
});

test('TyysApp：没有账号时抛 CONFIG（本包不读凭据）', async () => {
  const { request } = fakeRequest([]);
  const client = new TyysApp({ request, acquireLogin: async () => ({}), now: () => NOW });
  await assert.rejects(() => client.checkSession(), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /学号/);
    return true;
  });
});

test('TyysApp：登录页正文里没有 jwtToken 时抛 AUTH_EXPIRED', async () => {
  const { request } = fakeRequest([]);
  const client = new TyysApp({
    request,
    acquireLogin: async () => ({ status: 200, body: '<html>登录失败</html>' }),
    username: '3230100000',
    now: () => NOW,
  });
  await assert.rejects(() => client.checkSession(), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    assert.match(error.message, /没有返回令牌/);
    return true;
  });
});

test('TyysApp：令牌已过期时抛 AUTH_EXPIRED', async () => {
  const expired = makeToken({ exp: Math.floor(NOW / 1000) - 10 });
  const { request } = fakeRequest([]);
  const client = new TyysApp({
    request,
    acquireLogin: async () => ({ status: 200, body: `{"jwtToken":"${expired}"}` }),
    username: '3230100000',
    now: () => NOW,
  });
  await assert.rejects(() => client.checkSession(), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    assert.match(error.message, /过期/);
    return true;
  });
});

test('TyysApp：请求头带 app-key / v1 / imei / 3 段授权 / 签名', async () => {
  const { client, calls, logins, token } = appClient([['/api/l/v6/u/info', () => envelope({ uid: 3230100000, name: '张三' })]]);
  const info = await client.checkSession();
  assert.equal(info.name, '张三');
  assert.equal(logins[0], APP_LOGIN_SERVICE, 'App 面的 CAS service 与场馆面不同');

  const call = calls.at(-1);
  assert.equal(call.url.startsWith(APP_BASE), true, 'u/info 走 cgapp-server');
  assert.equal(call.headers['app-key'], 'azk3t4jrcfm5772t');
  assert.equal(call.headers.v1, 'd28da4a4ce6503e85af53079144efd3a');
  assert.equal(call.headers.imei, '00000000-0000-0000-0000-000000000000');
  assert.equal(call.headers.cgAuthorization, token.split('.').slice(0, 3).join('.'));
  // 签名随查询串变化（这里是 uid=xh）。
  const query = new URL(call.url).search;
  assert.equal(query, '?xh=3230100000');
  const expected = signRequest(Buffer.from(MATERIAL_HEX, 'hex'), '/api/l/v6/u/info', query.slice(1), NOW);
  assert.equal(call.headers.sign, expected.sign);
  assert.equal(call.headers.timestamp, expected.timestamp);
});

test('TyysApp：默认走 PTM 根，app=true 走 cgapp-server', async () => {
  const { client, calls } = appClient([
    ['/api/l/v6/termlist', () => envelope([])],
    ['/api/l/v6/u/info', () => envelope({ uid: 1 })],
  ]);
  await client.get('/api/l/v6/termlist');
  assert.equal(calls.at(-1).url.startsWith(PTM_BASE), true);
  await client.get('/api/l/v6/u/info', { xh: 'x' }, true);
  assert.equal(calls.at(-1).url.startsWith(APP_BASE), true);
});

test('TyysApp：HTTP 401 时重登一次再重放', async () => {
  let tries = 0;
  const { client, logins } = appClient([['/api/l/v6/termlist', () => {
    tries += 1;
    return tries === 1 ? { status: 401, text: '' } : envelope([{ termId: 11 }]);
  }]]);
  const response = await client.get('/api/l/v6/termlist');
  assert.equal(response.code, 200);
  assert.deepEqual(response.data, [{ termId: 11 }]);
  assert.equal(tries, 2);
  assert.equal(logins.length, 2);
});

test('TyysApp：业务码 2001 也算会话失效（PTM 会用它作废 App 令牌）', async () => {
  let tries = 0;
  const { client, logins } = appClient([['/api/l/v6/termlist', () => {
    tries += 1;
    return tries === 1 ? { status: 200, text: JSON.stringify({ code: 2001, message: 'token invalid' }) } : envelope([]);
  }]]);
  const response = await client.get('/api/l/v6/termlist');
  assert.equal(response.code, 200);
  assert.equal(tries, 2);
  assert.equal(logins.length, 2);
});

test('TyysApp：重登后仍然失效时抛 AUTH_EXPIRED', async () => {
  const { client, logins } = appClient([['/api/l/v6/termlist', () => ({ status: 401, text: '' })]]);
  await assert.rejects(() => client.get('/api/l/v6/termlist'), (error) => {
    assert.equal(error.code, 'AUTH_EXPIRED');
    assert.match(error.message, /体艺 App/);
    return true;
  });
  assert.equal(logins.length, 2, '最多重登一次');
});

test('TyysApp：业务码非 200 时抛 REJECTED 并带上平台给的原因', async () => {
  const { client } = appClient([['/api/l/v6/termlist', () => ({ status: 200, text: JSON.stringify({ code: 500, message: '服务异常' }) })]]);
  // get() 只在「会话失效」时抛，其余原样返回；拒绝由调用方（dataOf）判定。
  const response = await client.get('/api/l/v6/termlist');
  assert.equal(response.code, 500);
  assert.equal(response.message, '服务异常');
});

test('TyysApp：429 限流、非 JSON、缺 code、HTTP 非 2xx 各自抛对应错误', async () => {
  const limited = appClient([['/api/l/v6/termlist', () => ({ status: 429, text: '' })]]);
  await assert.rejects(() => limited.client.get('/api/l/v6/termlist'), (error) => {
    assert.equal(error.code, 'RATE_LIMITED');
    assert.match(error.message, /限流/);
    return true;
  });

  const html = appClient([['/api/l/v6/termlist', () => ({ status: 200, text: '<html>' })]]);
  await assert.rejects(() => html.client.get('/api/l/v6/termlist'), { code: 'SHAPE' });

  const noCode = appClient([['/api/l/v6/termlist', () => ({ status: 200, text: JSON.stringify({ data: [] }) })]]);
  await assert.rejects(() => noCode.client.get('/api/l/v6/termlist'), { code: 'SHAPE' });

  const bad = appClient([['/api/l/v6/termlist', () => ({ status: 500, text: JSON.stringify({ code: 200 }) })]]);
  await assert.rejects(() => bad.client.get('/api/l/v6/termlist'), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /HTTP 500/);
    return true;
  });
});

test('TyysApp：非法路径与超时', async () => {
  const { client } = appClient([]);
  await assert.rejects(() => client.send('/ptm/api/x'), { code: 'CONFIG' });
  await assert.rejects(() => client.send('/api/../x'), { code: 'CONFIG' });

  const hanging = new TyysApp({
    request: () => new Promise(() => {}),
    acquireLogin: async () => ({ body: `{"jwtToken":"${makeToken()}"}` }),
    username: '3230100000',
    now: () => NOW,
    timeoutMs: 20,
  });
  await assert.rejects(() => hanging.checkSession(), (error) => {
    assert.equal(error.code, 'TIMEOUT');
    return true;
  });
});

test('TyysApp：平台的错误文案里若混进令牌，会被抹掉', async () => {
  const { client, token } = appClient([
    ['/api/l/v6/termlist', () => ({ status: 200, text: JSON.stringify({ code: 500, message: `bad token ${token}` }) })],
  ]);
  const response = await client.get('/api/l/v6/termlist');
  assert.equal(response.message.includes(token), false);
  assert.match(response.message, /<redacted>/);
});

/* ────────────────────────────── 考勤 ── */

/**
 * 一个学期的考勤夹具。
 *
 * ⚠️ 这里**故意**把 `lack` 填成 13（上游注释里的真实值：2026-09 学期应到 16、
 * 上了 3 次课却报缺 13）。若实现改用 `lack` 算缺勤，断言会立刻红灯。
 */
const TERM = { termId: 11, schoolYear: 2026, name: '2026-2027 秋冬' };
const COURSE = { courseId: 9001, name: '羽毛球（初级）' };
const ATTENDANCE = {
  shouldReach: 16,
  lack: 13,
  detail: [
    { teachingWeek: 1, status: '1', isEarly: 0 },
    { teachingWeek: 2, status: '2', isEarly: 0 },
    { teachingWeek: 3, status: '6', isEarly: 1 },
  ],
};
const COURSE_TIMES = [
  { teachingWeek: 1, date: '2026-09-15 08:00:00' },
  { teachingWeek: 2, date: '2026-09-22 08:00:00' },
  // 第 3 次课在课次表里缺日期 —— 不能猜。
];

/** 造一个假 App 客户端（history 只用 `get` 与 `username`）。 */
function attendanceClient({ terms = [TERM], courses = [COURSE], attendance = ATTENDANCE, times = COURSE_TIMES, code = 200 } = {}) {
  const calls = [];
  return {
    username: '3230100000',
    calls,
    async get(path, params = {}) {
      calls.push({ path, params });
      if (code !== 200) return { code, message: '接口不可用', data: null };
      if (path.endsWith('/termlist')) return { code: 200, message: '', data: terms };
      if (path.endsWith('/student/courselist')) return { code: 200, message: '', data: courses };
      if (path.endsWith('/student/attendancelist')) return { code: 200, message: '', data: attendance };
      if (path.endsWith('/course_times')) return { code: 200, message: '', data: times };
      throw new Error(`意外的接口 ${path}`);
    },
  };
}

test('history：按课次倒序，状态译成中文，日期从课次表对上', async () => {
  const client = attendanceClient();
  const result = await history(client);
  assert.equal(result.status, 'found');
  assert.equal(result.courses.length, 1);
  const course = result.courses[0];
  assert.equal(course.course, '羽毛球（初级）');
  assert.equal(course.semester, '2026-2027 秋冬');
  assert.equal(course.planned, 16, 'planned 用 shouldReach');
  assert.equal(course.held, 3, 'held 是 detail 的条数');
  // 到勤只算「到」与「迟到」—— 缺勤不算。
  assert.equal(course.signed, 2);

  assert.deepEqual(course.records.map((record) => record.session), [3, 2, 1], '最近的在前');
  assert.deepEqual(course.records[0], { session: 3, date: '', status: '迟到（早退）' });
  assert.deepEqual(course.records[1], { session: 2, date: '2026-09-22', status: '缺勤' });
  assert.deepEqual(course.records[2], { session: 1, date: '2026-09-15', status: '到' });
});

test('history：缺勤统计不看 lack（上游注释里 lack 把没上的课也算进去）', async () => {
  const result = await history(attendanceClient());
  const course = result.courses[0];
  // 用 lack=13 算的话会是「到勤 -10」或「缺勤 13」；正确口径是 held 3、signed 2。
  assert.equal(course.held, 3);
  assert.equal(course.signed, 2);
  assert.equal(course.records.filter((record) => record.status === '缺勤').length, 1);
  // 汇总文案里的数字也必须来自已经发生的课次。
  assert.match(result.message, /3 次考勤/);
  assert.match(result.message, /到勤 2 次/);
  assert.match(result.message, /第 2 次课（2026-09-22） 缺勤/);
});

test('history：isEarly=1 且状态已经是「早退」时不重复标注', async () => {
  const client = attendanceClient({
    attendance: { shouldReach: 4, detail: [{ teachingWeek: 1, status: '3', isEarly: 1 }] },
  });
  const result = await history(client);
  assert.equal(result.courses[0].records[0].status, '早退');
});

test('history：未知状态码写成「状态 N」，不猜成到勤', async () => {
  const client = attendanceClient({ attendance: { detail: [{ teachingWeek: 1, status: '99' }] } });
  const result = await history(client);
  assert.equal(result.courses[0].records[0].status, '状态 99');
  assert.equal(result.courses[0].signed, 0);
});

test('history：课程名过滤做全角半角与空白归一', async () => {
  const twoCourses = [{ courseId: 9001, name: '羽毛球（初级）' }, { courseId: 9002, name: '网球' }];
  const withTerm = attendanceClient({ courses: twoCourses });
  const filtered = await history(withTerm, '羽毛球');
  assert.equal(filtered.courses.length, 1);
  assert.equal(filtered.courses[0].course, '羽毛球（初级）');
  // 带空格也能匹配。
  const spaced = await history(attendanceClient({ courses: twoCourses }), ' 网球 ');
  assert.equal(spaced.courses[0].course, '网球');
});

test('history：过滤后没有课程时说清是没这门课', async () => {
  const result = await history(attendanceClient(), '游泳');
  assert.equal(result.courses.length, 0);
  assert.equal(result.status, 'none');
  assert.match(result.message, /没有找到体育课“游泳”/);
});

test('history：一门课都没有时的文案', async () => {
  const result = await history(attendanceClient({ courses: [] }));
  assert.equal(result.status, 'none');
  assert.equal(result.message, '没有体艺课程。');
});

test('history：有课程但没有考勤记录时的文案', async () => {
  const result = await history(attendanceClient({ attendance: { shouldReach: 16, detail: [] } }));
  assert.equal(result.status, 'none');
  assert.equal(result.courses[0].held, 0);
  assert.match(result.message, /还没有考勤记录/);
});

test('history：多个学期时都读，学期名跟着课程走', async () => {
  const client = {
    username: '3230100000',
    calls: [],
    async get(path, params = {}) {
      this.calls.push({ path, params });
      if (path.endsWith('/termlist')) return { code: 200, message: '', data: [{ termId: 11, schoolYear: 2026, name: '秋冬' }, { termId: 12, schoolYear: 2026, name: '春夏' }] };
      if (path.endsWith('/student/courselist')) return { code: 200, message: '', data: [{ courseId: params.termId * 10, name: `课${params.termId}` }] };
      if (path.endsWith('/student/attendancelist')) return { code: 200, message: '', data: { detail: [] } };
      if (path.endsWith('/course_times')) return { code: 200, message: '', data: [] };
      throw new Error('意外');
    },
  };
  const result = await history(client);
  assert.deepEqual(result.courses.map((course) => course.course).sort(), ['课11', '课12']);
  // 两个学期各读一次课程列表（用 termId 与 schoolYear 作参数）。
  const courseCalls = client.calls.filter((call) => call.path.endsWith('/student/courselist'));
  assert.equal(courseCalls.length, 2);
  // 上游对学期列表做了 reverse（最近的学年学期先读），两个学期都要读到。
  assert.deepEqual(courseCalls.map((call) => call.params.termId).sort(), ['11', '12']);
  assert.deepEqual(courseCalls[0].params.uid, '3230100000');
  assert.deepEqual(courseCalls[0].params.schoolYear, '2026');
});

test('history：业务码不是 200 的接口抛 REJECTED 并点名是哪一步', async () => {
  await assert.rejects(() => history(attendanceClient({ code: 500 })), (error) => {
    assert.equal(error.code, 'REJECTED');
    assert.match(error.message, /学期查询/);
    assert.match(error.message, /接口不可用/);
    return true;
  });
});

test('ATTENDANCE_STATUS 与上游的 9 个状态一一对应', () => {
  assert.deepEqual({ ...ATTENDANCE_STATUS }, {
    '-1': '停课', 0: '未考勤', 1: '到', 2: '缺勤', 3: '早退', 4: '病假', 5: '事假', 6: '迟到', 7: '未确认',
  });
});


/* ══════════════════════════════ 宿主入口层（src/index.js） ══════════════════════════════ */

/**
 * # 为什么必须单独测入口
 *
 * 上面测的都是 `src/tyys.js` 的纯逻辑与客户端。入口层有三类只有装上插件才暴露的错：
 *
 *   1. `provide` 的服务名 / 路由路径写错 —— 页面永远拿不到数据，纯逻辑测试全绿；
 *   2. 注入面（`setLoginProvider` / `setAccountProvider`）静默接受非法值，
 *      调用方以为注入成功，直到下一次请求才报「还没接入登录」；
 *   3. 换账号不重建客户端 —— 会把上一个人的考勤/订单读给现在的人（隐私泄露）。
 */

/**
 * 造一个最小的 cordis 风格 ctx。
 *
 * `effect` 立刻执行回调并返回清理函数；`provide` 记录服务；`inject` 的回调
 * 立刻执行（模拟服务已在位），`webServer.register` 记录注册项。
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
      // 本包只需要 webServer：别的宿主服务一概不碰。
      assert.deepEqual(names, ['webServer']);
      callback({ webServer: { register(entry) { routes.push(entry); return () => {}; } } });
    },
  };
  return { ctx, services, routes };
}

/** 装配一次并返回服务面。 */
function mount() {
  const { ctx, services, routes } = fakeCtx();
  apply(ctx);
  return { tyys: services.get('zwTyys'), routes, services, ctx };
}

/**
 * 造一个最小的请求对象：监听器注册完就异步触发 `data` / `end`。
 *
 * @param body - 请求体。
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

test('index：apply() 真的 provide 了 zwTyys，且只注册一条同源路由', () => {
  const { tyys, routes } = mount();
  assert.ok(tyys, '必须 provide zwTyys');
  assert.equal(routes.length, 1, '必须注册一条路由');
  assert.equal(routes[0].path, '/api/zw-tyys');
  assert.equal(routes[0].path, ROUTE_PATH);
  assert.equal(routes[0].kind, 'exact');
});

test('index：方法表与实现对齐，写方法与只读方法分开列', () => {
  // ⚠️ 这条原名是「服务面声明只读……且没有写方法」，在接写操作时改过。
  // 现在 readOnly 是 false，写方法是 `bookVenuePrepare/Execute` 那一对 ——
  // 但**只读方法表 `methods` 不变**，写方法单独列在 `writeMethods` 里。
  // 这个分离是有意的：混在一起会让「能力清单里有 10 条读取」这种误解成立。
  const { tyys } = mount();
  assert.equal(tyys.readOnly, false);
  assert.equal(tyys.platform, 'tyys');
  assert.deepEqual(tyys.methods, [
    'tyys.venues', 'tyys.slots', 'tyys.notice', 'tyys.orders',
    'tyys.attendance', 'tyys.session', 'tyys.identity',
  ]);
  for (const name of tyys.methods) {
    const key = name.slice('tyys.'.length);
    assert.equal(typeof tyys[key], 'function', `声明了 ${name} 却没有实现`);
  }
  // 写方法成对出现，且都在 `writeMethods` 里（不在 `methods` 里）。
  assert.deepEqual(tyys.writeMethods, [
    'tyys.bookVenuePrepare', 'tyys.bookVenueExecute',
    'tyys.cancelVenuePrepare', 'tyys.cancelVenueExecute',
  ]);
  for (const name of tyys.writeMethods) {
    const key = name.slice('tyys.'.length);
    assert.equal(typeof tyys[key], 'function', `声明了 ${name} 却没有实现`);
    // 写方法不能再出现在只读方法表里
    assert.equal(tyys.methods.includes(name), false, `${name} 不该出现在只读 methods 里`);
  }
});

test('index：代码里没有注册 AI 工具（D17 的硬规则）', async () => {
  const source = await readFile(new URL('../../../packages/source/tyys/src/index.js', import.meta.url), 'utf8');
  assert.equal(/ctx\.tools\.register/.test(source), false);
  assert.equal(/defineTool/.test(source), false);
  // 注释里会提到这些名字，所以只断言代码里的调用形态。
  assert.equal(/ctx\.tool\s*\./.test(source), false);
});

test('index：setLoginProvider / setAccountProvider 传非函数时立刻抛错（不静默置 null）', () => {
  const { tyys } = mount();
  assert.throws(() => tyys.setLoginProvider('not a function'), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /setLoginProvider/);
    return true;
  });
  assert.throws(() => tyys.setAccountProvider(42), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /setAccountProvider/);
    return true;
  });
});

test('index：两个注入都可以撤销，撤销函数幂等', () => {
  const { tyys } = mount();
  const undoLogin = tyys.setLoginProvider(async () => ({}));
  const undoAccount = tyys.setAccountProvider(async () => '3230100000');
  assert.doesNotThrow(() => undoLogin());
  assert.doesNotThrow(() => undoLogin());
  assert.doesNotThrow(() => undoAccount());
  assert.doesNotThrow(() => tyys.setLoginProvider(null));
  assert.doesNotThrow(() => tyys.setAccountProvider(null));
  assert.equal(tyys.ready(), false);
});

test('index：ready() 反映是否已注入登录回调', () => {
  const { tyys } = mount();
  assert.equal(tyys.ready(), false);
  tyys.setLoginProvider(async () => ({}));
  assert.equal(tyys.ready(), true);
  tyys.reset();
});

test('index：没有注入账号时，需要账号的读取抛 CONFIG，文案指向设置入口', async () => {
  const { tyys } = mount();
  tyys.setLoginProvider(async () => ({}));
  await assert.rejects(() => tyys.attendance({}), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /设置/);
    assert.match(error.message, /浙大一卡通/);
    // 不能出现只对插件作者有意义的内部名词。
    assert.equal(/setAccountProvider/.test(error.message), false);
    return true;
  });
});

test('index：没有注入登录时，需要登录的读取抛 CONFIG', async () => {
  const { tyys } = mount();
  tyys.setAccountProvider(async () => '3230100000');
  await assert.rejects(() => tyys.venues({}), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /统一身份认证/);
    return true;
  });
});

test('index：换账号必须重建客户端（防把上一个人的考勤读给现在的人）', async () => {
  const { tyys } = mount();
  let account = 'A';
  let logins = 0;
  tyys.setAccountProvider(async () => account);
  tyys.setLoginProvider(async () => { logins += 1; throw new Error('故意失败'); });

  await assert.rejects(() => tyys.identity());
  const afterA = logins;
  assert.ok(afterA > 0, 'A 必须触发登录');

  account = 'B';
  await assert.rejects(() => tyys.identity());
  assert.ok(logins > afterA, '换账号必须重新走登录，不能复用 A 的客户端');
});

test('index：同一个账号重复读取只登录一次（客户端复用）', async () => {
  // 这条要一次**成功**的登录：登录失败时令牌会被清掉，下一次重试本来就会重登
  // —— 那测不出「复用」。所以这里把宿主的 fetch 换成假的（仍然不联网）。
  const original = globalThis.fetch;
  const hits = [];
  globalThis.fetch = async (url) => {
    const target = String(url);
    hits.push(target);
    if (target.includes('/api/login')) {
      return new Response(JSON.stringify({ code: 200, data: { token: { access_token: 'i' }, roles: [{ id: 3 }], username: '3230100000' } }), { status: 200 });
    }
    if (target.includes('/roleLogin')) {
      return new Response(JSON.stringify({ code: 200, data: { token: { access_token: 'f' }, username: '3230100000', name: '张三' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 200, data: {} }), { status: 200 });
  };
  try {
    const { tyys } = mount();
    let logins = 0;
    tyys.setAccountProvider(async () => '3230100000');
    tyys.setLoginProvider(async () => { logins += 1; return { url: 'http://x/?oauth_token=A' }; });

    const first = await tyys.identity();
    assert.equal(first.name, '张三');
    assert.equal(logins, 1);
    const afterFirst = hits.length;
    assert.equal(afterFirst, 2, '一次 /api/login + 一次 /roleLogin');

    const second = await tyys.identity();
    assert.equal(second.name, '张三');
    assert.equal(logins, 1, '同账号第二次不该重新走 CAS');
    assert.equal(hits.length, afterFirst, '也不该再发登录请求');
  } finally {
    globalThis.fetch = original;
  }
});

test('index：重新注入账号提供者也会重建客户端', async () => {
  const { tyys } = mount();
  let logins = 0;
  tyys.setAccountProvider(async () => 'A');
  tyys.setLoginProvider(async () => { logins += 1; throw new Error('故意失败'); });
  await assert.rejects(() => tyys.identity());
  const after = logins;
  tyys.setAccountProvider(async () => 'B');
  await assert.rejects(() => tyys.identity());
  assert.ok(logins > after, '换注入也要重建');
});

test('index：slots 缺 venueSiteId 时抛 CONFIG（不发请求）', async () => {
  const { tyys } = mount();
  tyys.setAccountProvider(async () => '3230100000');
  tyys.setLoginProvider(async () => ({}));
  await assert.rejects(() => tyys.slots({}), (error) => {
    assert.equal(error.code, 'CONFIG');
    assert.match(error.message, /venueSiteId/);
    return true;
  });
});

test('index：venues / orders 的日期参数在发请求前就被校验', async () => {
  const { tyys } = mount();
  tyys.setAccountProvider(async () => '3230100000');
  tyys.setLoginProvider(async () => ({}));
  // 超出窗口的日期不该白等一次网络。
  await assert.rejects(() => tyys.venues({ date: '2020-01-01' }), { code: 'CONFIG' });
  await assert.rejects(() => tyys.venues({ date: '明天', time: '25:00' }), { code: 'CONFIG' });
  await assert.rejects(() => tyys.orders({ date: '不是日期' }), { code: 'CONFIG' });
});

test('路由：未知 action 返回 ok:false + CONFIG', async () => {
  const { routes } = mount();
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, 'CONFIG');
      assert.match(parsed.error.message, /不认识的操作/);
    },
  };
  await routes[0].handler(makeReq(JSON.stringify({ action: '不存在的动作' })), res);
});

test('路由：空 body 也给出可读的错误', async () => {
  const { routes } = mount();
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, false);
      assert.match(parsed.error.message, /\(空\)/);
    },
  };
  await routes[0].handler(makeReq(''), res);
});

test('路由：status 不需要账号或登录', async () => {
  const { routes } = mount();
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, true);
      assert.deepEqual(parsed.value, { ready: false, readOnly: true });
    },
  };
  await routes[0].handler(makeReq(JSON.stringify({ action: 'status' })), res);
});

test('路由：attendance 在没有账号时返回 ok:false + CONFIG', async () => {
  const { routes } = mount();
  const res = {
    writeHead() {},
    end(payload) {
      const parsed = JSON.parse(payload);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, 'CONFIG');
    },
  };
  await routes[0].handler(makeReq(JSON.stringify({ action: 'attendance', input: {} })), res);
});

test('路由：写操作名不在动作表里（D17）', async () => {
  const { routes } = mount();
  for (const action of ['book', 'cancel', 'submit', 'pay']) {
    const res = {
      writeHead() {},
      end(payload) {
        const parsed = JSON.parse(payload);
        assert.equal(parsed.ok, false, `${action} 不该可用`);
        assert.equal(parsed.error.code, 'CONFIG');
      },
    };
    await routes[0].handler(makeReq(JSON.stringify({ action })), res);
  }
});

test('清理后服务被摘掉、路由被注销（不泄漏）', async () => {
  const { ctx, services } = fakeCtx();
  const dispose = apply(ctx);
  assert.ok(services.get('zwTyys'));
  await assert.doesNotReject(async () => { await dispose?.(); });
});

/* ══════════════════════════════════════════════════════════════════════
 * 写操作的**执行路径**：预约与取消真的能发出请求
 *
 * 这一组守的是 X-3 那类缺陷：`writes.js` 的 `execute()` 走的是只读入口
 * `client.request()`，而那条入口把写接口列在 `FORBIDDEN_WRITES` 里
 * **直接拒绝**。症状是「审批通过了、`execute()` 抛『本数据源不提供』」——
 * 看起来像分层设计，实际两个写动作在任何情况下都不可用。
 *
 * 之前没有任何一条测试跑过 `bookVenueExecute` / `cancelVenueExecute`：
 * `tests/campus-write.test.mjs` 用的是假 source（一个空函数就够），
 * 而本文件的写测试只测到 `prepare()`，所以缺陷全绿。
 * ══════════════════════════════════════════════════════════════════════ */

/** 造一个「读到空场、预下单成功、写请求成功」的场馆客户端，并记录它发了什么。 */
function bookingClient({ orders = [] } = {}) {
  const calls = [];
  const client = new VenueClient({
    request: async (url, init = {}) => {
      const path = String(url).slice(VENUE_BASE.length);
      calls.push({ method: init.method ?? 'GET', path });
      if (path === '/api/reservation/order/submit' || path === '/api/venue/finances/order/cancel') {
        return envelope({ orderId: 'NEW-1' });
      }
      if (path.startsWith('/api/orders/mine')) return envelope({ content: orders, last: true });
      throw new Error(`本夹具没准备 ${path}`);
    },
    acquireLogin: async () => ({ url: `http://tyys.zju.edu.cn/x?oauth_token=OT-123` }),
    username: '3230100000',
    now: () => NOW,
  });
  // 登录与空场查询都走现成实现太啰嗦：这两步已在别处测过，这里只钉执行路径。
  client.login = async () => { client.token = 'tk'; };
  client.day = async () => ({
    open: true,
    token: 'day-token',
    weekStart: '2026-11-09',
    slots: [{ start: '19:00', end: '20:00', status: 1, spaceId: '501', timeId: '9001', fee: 10 }],
  });
  client.preview = async () => ({ captchaRequired: false, buddyMin: 0, phone: '13800000000' });
  return { client, calls };
}

test('bookVenueExecute：审批通过后真的把订单提交出去（X-3 死链）', async () => {
  const { createTyysWrites } = await import('../../../packages/source/tyys/src/writes.js');
  const { client, calls } = bookingClient();

  const writes = createTyysWrites(client);
  const summary = await writes.bookVenue.prepare({
    venue: 'v-1', date: '2026-11-12', start: '19:00', end: '20:00',
  });
  assert.match(summary, /预约场馆/);

  const result = await writes.bookVenue.execute();
  assert.deepEqual(result, { orderId: 'NEW-1' });

  // 断言「请求真的发了」，而不是「没抛错」—— 死链的形态正是「抛了一个
  // 听起来像设计决定的错」，所以只看 rejects 会把它当成预期行为。
  const posted = calls.filter((call) => call.method === 'POST');
  assert.deepEqual(posted.map((call) => call.path), ['/api/reservation/order/submit']);
});

test('cancelVenueExecute：取消预约也真的发得出去（同一个死链的另一半）', async () => {
  const { createTyysWrites } = await import('../../../packages/source/tyys/src/writes.js');
  const { client, calls } = bookingClient({
    orders: [{ tradeNo: 'O-1', id: '1', campusName: '紫金港', venueName: '网球场', siteName: '1号场',
      reservationStartDate: '2026-11-13 19:00:00', reservationEndDate: '2026-11-13 20:00:00', orderStatus: 1, payStatus: 1 }],
  });

  const writes = createTyysWrites(client);
  await writes.cancelVenue.prepare({ order: 'O-1' });
  assert.deepEqual(await writes.cancelVenue.execute(), { orderId: 'NEW-1' });

  assert.deepEqual(
    calls.filter((call) => call.method === 'POST').map((call) => call.path),
    ['/api/venue/finances/order/cancel'],
  );
});

test('只读入口仍然拒绝写接口（修死链不能拆掉分层防线）', async () => {
  const { client, calls } = bookingClient();
  for (const endpoint of ['/api/reservation/order/submit', '/api/venue/finances/order/cancel']) {
    await assert.rejects(() => client.request('POST', endpoint, {}), (error) => {
      assert.equal(error.code, 'CONFIG');
      assert.match(error.message, /写操作/);
      return true;
    });
  }
  assert.deepEqual(calls, [], '读入口不该把请求发出去');
});
