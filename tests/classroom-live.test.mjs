/**
 * 直播链路的两层契约。
 *
 * 直播这条路和回放**不是同一条**：回放靠 cookie 就够，直播网关要
 * `Authorization: Bearer <JWT>`；回放拿的是已录制地址，直播要先按时段找到
 * 「此刻在播的课」再换流清单。两层各自错一步，界面上的表现都是同一句话
 * ——「今天没有课」，最难查。所以这里分别钉住：
 *
 *   1. `LiveSource`：时段切分、多机位打包、不可播放类型的去留、Bearer 头的存在；
 *   2. `stream.js`：改写 m3u8、以及**拒绝**不该转发的目标（SSRF 边界）。
 *
 * 第二组是本仓唯一一个能按 URL 拉任意外网内容的入口，它的拒绝分支比放行
 * 分支更重要 —— 所以断言的重点在「拒绝」，不在「能播」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassroomSource } from '../packages/dsh-zhiyun-classroom/src/source.js';
import { LiveSource, cameraKey, mediaType } from '../packages/dsh-zhiyun-classroom/src/live.js';
import { checkTarget, rewritePlaylist } from '../packages/dsh-zhiyun-classroom/src/stream.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
/** 用假 fetch 造一个 ClassroomSource；直播走它共享的 transport。 */
function classroom(handler) { return new ClassroomSource({ fetch: handler }); }

/** 一条带 JWT 的 `_token` cookie，用于证明 Bearer 头确实被带上。 */
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
async function withToken(source) {
  await source.transport.session.jar.setCookie(
    `_token=${encodeURIComponent(`{"_csrf":"x"}${JWT}`)}; Domain=classroom.zju.edu.cn; Path=/; Secure`,
    'https://classroom.zju.edu.cn/',
  );
  return source;
}

test('mediaType keeps upstream priority: scheme first, then m3u8/flv, then push host', () => {
  // 顺序敏感：查询串里带 .flv 的 webrtc 地址必须仍判成 webrtc。
  assert.equal(mediaType('webrtc://x.test/a?f=.flv'), 'webrtc');
  assert.equal(mediaType('rtmp://x.test/live'), 'rtmp');
  assert.equal(mediaType('https://a.test/x.m3u8?auth_key=1'), 'hls');
  assert.equal(mediaType('https://a.test/x.flv'), 'flv');
  assert.equal(mediaType('https://mcloudpush.cmc.zju.edu.cn/live/abc'), 'flv');
  assert.equal(mediaType('https://a.test/x.mp4'), 'mp4');
  assert.equal(mediaType('https://a.test/x.jpg'), 'image');
  assert.equal(mediaType(''), 'unknown');
});

test('cameraKey maps both stream_type and type numbering onto four camera slots', () => {
  assert.equal(cameraKey('教师画面', undefined, undefined), 'teacher');
  assert.equal(cameraKey('', 3, undefined), 'teacher');
  assert.equal(cameraKey('PPT', undefined, 1), 'screen');
  assert.equal(cameraKey('板书', undefined, undefined), 'screen');
  assert.equal(cameraKey('学生全景', undefined, 4), 'student');
  assert.equal(cameraKey('teacher', undefined, undefined), 'extra');
});

test('listCurrent picks the quantum containing now and returns [] between classes', async () => {
  const quantums = [
    { id: 1, name: '第一时段', class_begin_time: '08:00', class_end_time: '09:30' },
    { id: 2, name: '第二时段', class_begin_time: '10:00', class_end_time: '11:30' },
  ];
  const seen = [];
  const source = await withToken(classroom(url => {
    const target = new URL(url);
    seen.push({ quantum: target.searchParams.get('quantum_id'), time: target.searchParams.get('search_time'), auth: undefined });
    if (target.searchParams.get('quantum_id') === '0') return json({ code: '0', list: quantums });
    return json({ code: '0', list: [{ course_id: 7, sub_id: 8, title: '高等数学', status_label: '直播中' }] });
  }));
  // 上海时间 10:30 → 第二时段。
  const during = await source.live.listCurrent({ now: new Date('2026-06-03T02:30:00Z') });
  assert.equal(during.items.length, 1);
  assert.equal(during.items[0].title, '高等数学');
  assert.equal(during.items[0].live, true);
  assert.equal(during.items[0].quantumId, 2);
  // search_time 必须是不补零的形态，补零上游会当成空日期。
  assert.equal(seen.at(-1).time, '2026-6-3');
  // 09:45 是课间 → 空列表，而不是「最近一节课」。
  const between = await source.live.listCurrent({ now: new Date('2026-06-03T01:45:00Z') });
  assert.deepEqual(between.items, []);
  await source.dispose();
});

test('live requests carry an Authorization Bearer taken from the _token cookie', async () => {
  const headers = [];
  const source = await withToken(classroom((url, options) => {
    headers.push(options.headers.authorization ?? null);
    const target = new URL(url);
    if (target.searchParams.get('quantum_id') === '0') return json({ code: '0', list: [{ id: 1, name: 'A', class_begin_time: '08:00', class_end_time: '09:30' }] });
    return json({ code: '0', list: [] });
  }));
  await source.live.listCurrent({ now: new Date('2026-06-03T00:30:00Z') });
  assert.ok(headers.length >= 2);
  // 直播网关不认 cookie，只认 Bearer；缺了它的表现是「今天没有课」。
  for (const value of headers) assert.equal(value, `Bearer ${JWT}`);
  await source.dispose();
});

test('live requests omit the Bearer header entirely when no token is present', async () => {
  const headers = [];
  const source = classroom((url, options) => {
    headers.push(options.headers.authorization ?? null);
    const target = new URL(url);
    if (target.searchParams.get('quantum_id') === '0') {
      return json({ code: '0', list: [{ id: 1, name: 'A', class_begin_time: '08:00', class_end_time: '09:30' }] });
    }
    return json({ code: '0', list: [{ course_id: 7, sub_id: 8, title: '课' }] });
  });
  await source.live.listCurrent({ now: new Date('2026-06-03T00:30:00Z') });
  assert.ok(headers.length >= 2);
  // 宁可不带，也不要编一个空 Bearer 把上游的真实拒绝盖成 401。
  for (const value of headers) assert.equal(value, null);
  await source.dispose();
});

test('a non-zero business code fails loudly instead of reading as an empty day', async () => {
  // 用 500 而不是 401/403：后两者会被 transport 先判成 SESSION_EXPIRED，
  // 这里要钉的是「业务码非 0 必须抛」，不是会话过期的分类。
  const source = await withToken(classroom(() => json({ code: 500, msg: '服务异常' })));
  await assert.rejects(source.live.listLiveDay('2026-06-03'), error => error.code === 'BUSINESS');
  await source.dispose();
});

test('a session-expired business code is classified as SESSION_EXPIRED, not swallowed', async () => {
  const source = await withToken(classroom(() => json({ code: 401, msg: '未登录' })));
  // transport 对 401/403 业务码先判会话过期 —— 这条分类必须优先于 BUSINESS，
  // 否则界面会把「该重新登录」显示成「上游服务异常」。
  await assert.rejects(source.live.listLiveDay('2026-06-03'), error => error.code === 'SESSION_EXPIRED');
  await source.dispose();
});

test('resolveStreams packs cameras, drops unplayable ones and merges m3u8 with play duplicates', async () => {
  const source = await withToken(classroom(url => {
    const target = new URL(url);
    if (target.pathname === '/courseapi/index.php/v2/meta/getscreenstream') {
      return json({ result: { data: [
        { stream_name: '教师', stream_m3u8: 'https://v.cmc.zju.edu.cn/t.m3u8?auth_key=1', stream_play: 'https://v.cmc.zju.edu.cn/t.flv' },
        { stream_name: '屏幕', stream_m3u8: 'https://v.cmc.zju.edu.cn/s.m3u8', stream_play: 'https://v.cmc.zju.edu.cn/s.flv' },
        // 北教部分教室只给 webrtc：浏览器放不了，但必须留痕而不是让机位凭空消失。
        { stream_name: '教室', stream_m3u8: 'webrtc://v.cmc.zju.edu.cn/w' },
      ] } });
    }
    // 走 getscreenstream 的分支：sub_content 里只有 stream_id，没有直出地址。
    return json({ code: '0', list: [{ sub_content: JSON.stringify({ streams: [{ stream_id: 99 }] }) }] });
  }));
  const packed = await source.live.resolveStreams(7, 8);
  assert.equal(packed.source, 'live');
  // 同一路流的 m3u8 与 flv 是两套封装，不能各算一个机位。
  assert.equal(packed.streams.length, 2);
  assert.deepEqual(packed.streams.map(s => s.key), ['teacher', 'screen']);
  assert.match(packed.streams[0].watchUrl, /\.m3u8/);
  // watchUrl 与 recordUrl 同源（都取 m3u8 优先的那一个）：拆成两个地址会让
  // 「边看边录」拿到的和用户看到的不是同一路流。
  assert.equal(packed.streams[0].recordUrl, packed.streams[0].watchUrl);
  assert.equal(packed.dropped.length, 1);
  assert.equal(packed.dropped[0].type, 'webrtc');
  // dropped 只留安全元数据，不能把流地址本体回传给页面。
  assert.equal(packed.dropped[0].host, 'v.cmc.zju.edu.cn');
  assert.ok(!JSON.stringify(packed.dropped).includes('webrtc://'));
  await source.dispose();
});

test('stream relay accepts only https on zju hosts and rejects everything else', () => {
  for (const good of ['https://v.cmc.zju.edu.cn/a.m3u8', 'https://VIDEO.CMC.ZJU.EDU.CN/x', 'https://classroom.zju.edu.cn/a?auth_key=1'])
    assert.equal(checkTarget(good).ok, true, good);
  const rejected = {
    '': 400, 'not a url': 400, [`https://a.zju.edu.cn/${'x'.repeat(5000)}`]: 400,
    'http://v.cmc.zju.edu.cn/a': 403, 'https://user:pass@v.cmc.zju.edu.cn/a': 403,
    // 后缀匹配必须是「.zju.edu.cn」结尾，这几种常见绕过都必须拒。
    'https://evil.com/a': 403, 'https://zju.edu.cn.evil.com/a': 403, 'https://evilzju.edu.cn/a': 403,
    'https://127.0.0.1/a': 403, 'https://169.254.169.254/latest': 403,
  };
  for (const [bad, status] of Object.entries(rejected)) {
    const actual = checkTarget(bad);
    assert.equal(actual.ok, false, bad);
    assert.equal(actual.status, status, bad);
  }
});

test('rewritePlaylist rewrites both segments and URI= attributes against the playlist URL', () => {
  const target = 'https://v.cmc.zju.edu.cn/live/index.m3u8?auth_key=1';
  const text = ['#EXTM3U', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"', '#EXTINF:2.0,', 'seg-1.ts', '', '../v3/seg-2.ts?auth_key=2'].join('\n');
  const actual = rewritePlaylist(text, target);
  const lines = actual.split('\n');
  assert.equal(lines[0], '#EXTM3U');
  // 相对 URI 以播放列表地址为基准解析，否则 KEY 会指到本站根下。
  assert.match(lines[1], /^#EXT-X-KEY:METHOD=AES-128,URI="\/zhiyun-live\/hls\?u=/);
  assert.match(decodeURIComponent(lines[1]), /https:\/\/v\.cmc\.zju\.edu\.cn\/live\/key\.bin/);
  assert.equal(lines[2], '#EXTINF:2.0,');
  assert.match(lines[3], /^\/zhiyun-live\/hls\?u=/);
  assert.match(decodeURIComponent(lines[3]), /https:\/\/v\.cmc\.zju\.edu\.cn\/live\/seg-1\.ts$/);
  assert.equal(lines[4], '');
  // `../` 必须被正确归一化。
  assert.match(decodeURIComponent(lines[5]), /https:\/\/v\.cmc\.zju\.edu\.cn\/v3\/seg-2\.ts\?auth_key=2$/);
  // 分片本身也要经过转发，且必须重新过一遍白名单（由 handler 对每个请求再做）。
  for (const line of [lines[3], lines[5]]) assert.match(decodeURIComponent(line), /^\/zhiyun-live\/hls\?u=https:/);
});

test('stream relay surfaces the route prefix shared with the host wiring', async () => {
  const { STREAM_ROUTE_PREFIX, createStreamHandler } = await import('../packages/dsh-zhiyun-classroom/src/stream.js');
  assert.equal(STREAM_ROUTE_PREFIX, '/zhiyun-live');
  // handler 的签名必须是 (req, res)：宿主 WebRoute.handler 用 Node 响应所有权模型，
  // 不是 Fetch 的 Request => Response。写错的表现是请求挂死到超时。
  assert.equal(typeof createStreamHandler(), 'function');
  assert.equal(createStreamHandler().length, 2);
});


test('gateway aggregate quantum zero does not invalidate real live windows', async () => {
  const source = classroom(async url => {
    const q = new URL(url).searchParams.get('quantum_id');
    return json({code: 0, list: q === '0' ? [
      {id: 93, class_begin_time: '08:00', class_end_time: '09:30'},
      {id: 0, name: 'aggregate', list: []},
      {quantum_id: '0', list: []},
    ] : [{course_id: '101', sub_id: '202', title: 'Fixture'}]});
  });
  try {
    const current = await source.live.listCurrent({now: new Date('2026-01-05T00:30:00Z')});
    assert.equal(current.items.length, 1);
    assert.equal(current.items[0].quantumId, 93);
    assert.equal((await source.live.listLiveDay('2026-01-05')).items.length, 1);
  } finally { await source.dispose(); }
});

test('malformed nonaggregate quantum still reports a schema error', async () => {
  const source = classroom(async () => json({code: 0, list: [{name: 'missing id'}]}));
  try { await assert.rejects(source.live.listQuantum('2026-01-05'), {code: 'API_SHAPE'}); }
  finally { await source.dispose(); }
});


test('selected quantum response retains grouped courses and ignores other windows', async () => {
  const source = classroom(async url => {
    const q = new URL(url).searchParams.get('quantum_id');
    return json({code: 0, list: q === '0' ? [
      {id: 93, class_begin_time: '08:00', class_end_time: '09:30', list: []},
      {id: 0, list: []}
    ] : [
      {id: 93, list: [{course_id: 101, sub_id: 202, title: 'Fixture'}]},
      {id: 94, list: [{course_id: 303, sub_id: 404}]},
      {id: 0, list: []}
    ]});
  });
  try {
    const current = await source.live.listCurrent({now: new Date('2026-01-05T00:30:00Z')});
    assert.deepEqual(current.items.map(x => x.courseId), ['101']);
    assert.equal((await source.live.listLiveDay('2026-01-05')).items.length, 1);
  } finally { await source.dispose(); }
});
