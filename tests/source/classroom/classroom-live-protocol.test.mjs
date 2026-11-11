/**
 * 实时字幕的 **comet 协议层** 测试。
 *
 * # 为什么单独一个文件
 *
 * `classroom-live.test.mjs` 测的是「live 地址怎么解析」，而 `live-caption.js`
 * 里那套 **HTTP comet 长轮询协议**（建会话 → 订阅 → 收帧 → 心跳 → 退订）
 * 一行都没被测到。
 *
 * 这个文件是补那个缺口时发现的：把 `if (response === 't') continue;` 删掉，
 * `classroom-live.test.mjs` 14 条**全绿** —— 说明那条判据当时没有任何守卫。
 *
 * ⚠️ 夹具按 `live-caption.js` 文件头记录的协议形状写（那一节是照上游
 * `live-socket.ts` 的实测记录整理的），**未经真实频道验证**。
 */

import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADDRESS_RETRY_MS, IDLE_MS, LESSON_GRACE_MS, LESSON_LEAD_MS, PING_TIMEOUT_MS, RECONNECT_MAX_MS,
  beijingTime, decodeFrame, missingIntervals, normalizeCaption, subtitleEndpoint,
} from '../../../packages/source/classroom/src/live-caption.js';

/* ────────────────────────────────────────────── 常量（实测值） */

test('协议常量照上游实测值，不是拍的', () => {
  assert.equal(IDLE_MS, 35_000, '空闲 35 秒推一次 pi');
  assert.equal(PING_TIMEOUT_MS, 8_000, 'pi 之后 8 秒没帧就作废');
  assert.equal(LESSON_GRACE_MS, 5 * 60_000, '课后宽限 5 分钟');
  assert.equal(LESSON_LEAD_MS, 5 * 60_000, '课前提前 5 分钟');
  assert.equal(ADDRESS_RETRY_MS, 10_000, '取地址重试 10 秒');
  assert.equal(RECONNECT_MAX_MS, 30_000, '重连上限 30 秒');
});

/* ────────────────────────────────────────────── decodeFrame */

test('decodeFrame：cd 帧按长度前缀切出频道与 JSON', () => {
  const payload = JSON.stringify({ text: '你好' });
  // `cd<size>&m<json>`：size 是**频道字符数**（这里是 1），不是 JSON 长度
  const frame = `cd1&m${payload}`;
  const decoded = decodeFrame(frame);
  assert.equal(decoded.command, 'cd');
  assert.equal(decoded.data.text, '你好');
});

test('decodeFrame：非 m 频道明确标成 other-channel，不当成字幕', () => {
  assert.deepEqual(decodeFrame('cd2&xx'), { command: 'other-channel' });
});

test('decodeFrame：握手帧必须有 socketID', () => {
  assert.deepEqual(decodeFrame('in{"socketID":"abc"}'), { command: 'in' });
  assert.throws(() => decodeFrame('in{"socketID":""}'), (e) => e.code === 'API_SHAPE');
  assert.throws(() => decodeFrame('in{}'), (e) => e.code === 'API_SHAPE');
});

test('decodeFrame：心跳与生命周期帧原样认', () => {
  for (const frame of ['pi', 'po', 'cl', 'dr', 'iv']) {
    assert.deepEqual(decodeFrame(frame), { command: frame });
  }
});

test('decodeFrame：未知帧与坏 JSON 都抛 API_SHAPE，不静默忽略', () => {
  assert.throws(() => decodeFrame('zz'), (e) => e.code === 'API_SHAPE');
  assert.throws(() => decodeFrame('cd1&m{坏的了'), (e) => e.code === 'API_SHAPE');
  assert.throws(() => decodeFrame('cd9&m{}'), (e) => e.code === 'API_SHAPE', '长度超过余下内容要报');
});

/* ────────────────────────────── 那个当年没被守住的判据 */

test('无数据帧 "t" 不能被当成新 token（口径：它不是帧）', () => {
  // `live-caption.js` 里是 `if (response === 't') continue;` —— 服务端 hold 到
  // 超时就回一个 `t`，token 不前进。把 `t` 当帧解会落进 decodeFrame 的未知分支。
  //
  // 这条钉的是「`t` 必须单独判」这件事本身：它不该能通过 decodeFrame。
  assert.throws(() => decodeFrame('t'), (e) => e.code === 'API_SHAPE',
    't 不是协议帧；调用方必须在自己那层先判掉它');
});

test('换 token 的帧是 "token&frame" 两段', () => {
  // 协议：`"<token2>&<frame>"` —— 先换 token，再解 frame。
  const composite = 'tok2&cd1&m{"text":"a"}';
  const [nextToken, ...rest] = composite.split('&');
  assert.equal(nextToken, 'tok2');
  const frame = rest.join('&');
  assert.equal(decodeFrame(frame).data.text, 'a', '切掉 token 之后才是合法帧');
});

/* ────────────────────────────────────────────── 其它纯函数 */

test('subtitleEndpoint：只收 qlite2 上单段路径的地址，并自己拼 /glue/ajax', () => {
  // 收的是**完整 URL**；路径必须**单段** `/[A-Za-z0-9_-]+`（不是已含 /glue/ajax 的地址）。
  const good = subtitleEndpoint('https://qlite2.cmc.zju.edu.cn/ch1');
  assert.equal(good, 'https://qlite2.cmc.zju.edu.cn/ch1/glue/ajax', '自己拼上 /glue/ajax');
  assert.equal(subtitleEndpoint('https://qlite2.cmc.zju.edu.cn/ch1/'), good, '尾斜杠归一');

  // 主机白名单：别的主机必须拒，否则等于把 Bearer 送去任意域。
  assert.throws(() => subtitleEndpoint('https://evil.example.com/ch1'),
    (e) => e.code === 'API_SHAPE', '别的主机必须拒');
  // 路径多段也要拒 —— 那不是频道地址
  assert.throws(() => subtitleEndpoint('https://qlite2.cmc.zju.edu.cn/a/b'),
    (e) => e.code === 'API_SHAPE');
  assert.throws(() => subtitleEndpoint(''), (e) => e.code === 'API_SHAPE');
  assert.throws(() => subtitleEndpoint('不是地址'), (e) => e.code === 'API_SHAPE');
});

test('beijingTime：毫秒时间戳转东八区可读时间', () => {
  const text = beijingTime(Date.parse('2026-11-10T00:00:00Z'));
  assert.match(String(text), /2026-11-10/, 'UTC 零点在上海仍是同一天 08:00');
  assert.match(String(text), /08:00/);
});

test('missingIntervals：按 (start, end, intervals, now) 报缺口区间', () => {
  // 签名是 `(start, end, intervals, now)`，intervals 里每项是 `{start, end?}`。
  const gaps = missingIntervals(0, 5000, [{ start: 1000, end: 2000 }], 5000);
  assert.equal(gaps.length, 2, '1 段已采集 → 两段缺口');
  assert.deepEqual(gaps[0], { start: 0, end: 1000 });
  assert.deepEqual(gaps[1], { start: 2000, end: 5000 });
});

test('missingIntervals：全部覆盖时没有缺口', () => {
  assert.deepEqual(missingIntervals(0, 5000, [{ start: 0, end: 5000 }], 5000), []);
});

test('normalizeCaption：空文本返回 null（静音段不是错误）', () => {
  const result = normalizeCaption(
    { sourcetext: '   ', end_time: 1, text_begin_time: 0, text_end_time: 1000, time: 0 },
    { receivedAt: 1000, startsAt: 0, endsAt: 10_000, subId: 's1' },
  );
  assert.equal(result, null, '静音段不是错误');
});

test('normalizeCaption：时间顺序翻转时取 min/max 并记下 fieldOrder', () => {
  // 文件头写着：`text_end_time < text_begin_time` 真实存在。
  const result = normalizeCaption(
    { sourcetext: '一句话', end_time: 1, text_begin_time: 5000, text_end_time: 2000, time: 5000 },
    { receivedAt: 6000, startsAt: 0, endsAt: 60_000, subId: 's1' },
  );
  assert.equal(result.fieldOrder, 'reversed', '要记下字段顺序反了');
  assert.equal(result.startMs, 2000, '取 min');
  assert.equal(result.endMs, 5000, '取 max');
  assert.ok(result.endMs >= result.startMs, '区间必须正立');
});

test('normalizeCaption：时间串了要报错，不把接收时间伪装成字幕时间', () => {
  // 文件头的原话：宁可丢这一条并报错，也不要让「第几分钟说的」永久错位。
  assert.throws(() => normalizeCaption(
    { sourcetext: 'x', end_time: 1, text_begin_time: 0, text_end_time: 1000, time: 999 },
    { receivedAt: 2000, startsAt: 0, endsAt: 60_000, subId: 's1' },
  ), (e) => e.code === 'API_SHAPE', 'time 既不是 begin 也不是 end → 异常');

  // 比接收时间还晚 60 秒以上：字段串了。`LESSON_LEAD_MS` 有 5 分钟宽限，
  // 所以用「超出 receivedAt 一分钟」这条判据来构造，比课次窗口更直接。
  assert.throws(() => normalizeCaption(
    { sourcetext: 'x', end_time: 1, text_begin_time: 0, text_end_time: 1_000, time: 0 },
    { receivedAt: -100_000, startsAt: 0, endsAt: 200_000, subId: 's1' },
  ), (e) => e.code === 'API_SHAPE', '字幕时间晚于接收时间一分钟以上 → 异常');
});

test('normalizeCaption：缺少 sourcetext 或定稿标识非法都报错', () => {
  assert.throws(() => normalizeCaption({ end_time: 1 }, {}), (e) => e.code === 'API_SHAPE');
  assert.throws(() => normalizeCaption(
    { sourcetext: 'x', end_time: 0, text_begin_time: 0, text_end_time: 1, time: 0 }, {},
  ), (e) => e.code === 'API_SHAPE', 'end_time 只认 1/-1');
});

/* ────────────────────────────── 轮询循环里的两条判据 */

/**
 * 轮询循环（`LiveCollector` 内部）的两条判据，用**源码断言**守住。
 *
 * # 为什么不用行为测试
 *
 * 驱动 `LiveCollector` 要造一整套假 `post`/`sleep`/`signal`，并且它自己带
 * 心跳、重连、退订三条定时器分支 —— 那种测试写出来比被测代码还长，
 * 而且一旦内部重构就会成片失败。
 *
 * 但这两条判据**错了会静默坏掉**：
 *   - `'t'` 不 `continue` → 超时响应被当成「令牌+帧」，token 变成一个字母，
 *     之后每轮都 `API_SHAPE`，订阅实际已经死了；
 *   - `'c'` 不抛 → 服务端关连接被当成正常响应继续解帧。
 *
 * 本仓已有同类先例（`tests/source-error-contract.test.mjs` 也是断言源码文本），
 * 所以这里沿用它，而不是强行造一个脆弱的行为测试。
 */
test('轮询循环：超时响应 "t" 必须原样 continue，不前进 token', async () => {
  const source = await readFile(
    new URL('../../../packages/source/classroom/src/live-caption.js', import.meta.url), 'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /if \(response === 't'\) continue;/,
    '超时响应 `t` 必须直接 continue —— token 不前进，否则订阅会静默死掉');
});

test('轮询循环：服务端关闭 "c" 必须抛，不能当正常响应解帧', async () => {
  const source = await readFile(
    new URL('../../../packages/source/classroom/src/live-caption.js', import.meta.url), 'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /if \(response === 'c'\) throw/,
    '服务端关闭必须显式抛错，不能继续解帧');
});

test('轮询循环：令牌只认 [A-Za-z0-9_-]+，坏令牌要报错', async () => {
  const source = await readFile(
    new URL('../../../packages/source/classroom/src/live-caption.js', import.meta.url), 'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // 断言「有一段对 next 做 [A-Za-z0-9_-]+ 校验」，不逐字符对正则转义 ——
  // 那会让这条守卫在格式化改动时误红。
  assert.ok(/\[A-Za-z0-9_-\]\+/.test(code) && /\.test\(next\)/.test(code),
    '令牌格式校验不能省');
});
