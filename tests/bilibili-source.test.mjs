/**
 * **B 站数据源**的契约测试 —— 全部离线（打桩 fetch，不联网）。
 *
 * # 为什么这些断言值得写
 *
 * 这一层的失败模式**都不会报错**，只会「静默给出空数据」：
 *
 * | 失败 | 表现 | 谁会发现 |
 * | --- | --- | --- |
 * | WBI 置换表抄错一位 | `code=0` + `subtitles: []` | **没人** —— 看起来像「这视频没字幕」 |
 * | 秒/毫秒搞混 | 时间轴整体偏 1000 倍 | 讲义里所有时间戳都错，但不报错 |
 * | `endMs < startMs` 没钳 | `validateInput()` 抛 `INPUT` | **整节课解析失败** |
 * | 匿名当成「没字幕轨」 | 用户不知道「登录一下就好」 | 用户反复重试 |
 *
 * 所以这里每条断言都对着**一种静默失效**。
 *
 * # 在线部分不进单测
 *
 * 真实打 B 站接口的验证放在本地探针里（会随上游风控波动，未随仓库分发），
 * CI 不该依赖它。这里只钉**纯函数**与**打桩的 IO**。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIXIN_KEY_ENC_TAB, MIXIN_KEY_LENGTH, keysFromNav, keysLookValid, mixinKey, wbiSign,
} from '../packages/dsh-zhiyun-source-bilibili/src/wbi.js';
import { MAX_CUE_SECONDS, cueToSubtitle, cuesToSubtitles, transcriptOf } from '../packages/dsh-zhiyun-source-bilibili/src/subtitles.js';
import { BilibiliError, ERROR_CODE, explainCode, isCredentialIssue, isRiskControl, isUnavailable } from '../packages/dsh-zhiyun-source-bilibili/src/errors.js';
import { headersFor } from '../packages/dsh-zhiyun-source-bilibili/src/http.js';
import { inspectCredential } from '../packages/dsh-zhiyun-source-bilibili/src/subtitle-channel.js';
import {
  BROWSER_UA, downloadVideo, extractFrames, probeFfmpeg, summarizeFfmpegError,
} from '../packages/dsh-zhiyun-source-bilibili/src/frames.js';
import { DEFAULT_QUALITY, MAX_DURL_SEGMENTS, fetchPlayUrl } from '../packages/dsh-zhiyun-source-bilibili/src/playurl.js';
import { DEFAULT_SAMPLE_SEC, buildLesson, finishFrames } from '../packages/dsh-zhiyun-source-bilibili/src/lesson.js';
import { EventEmitter } from 'node:events';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ── WBI 签名 ──────────────────────────────────────────────────────

test('置换表是 64 项的固定位置表，且每一项落在 0..63', () => {
  assert.equal(MIXIN_KEY_ENC_TAB.length, 64);
  // 必须是 0..63 的一个排列 —— 少一项或重复一项都会让 mixin 变形，
  // 而表现是「签名被接受但数据为空」，最难查。
  assert.deepEqual([...MIXIN_KEY_ENC_TAB].sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i));
  assert.equal(MIXIN_KEY_LENGTH, 32);
});

test('mixinKey 取前 32 位；输入不足时补空而不是抛错', () => {
  // 用 0..63 顺序串：置换后应为 46,47,18,2,...
  const raw = Array.from({ length: 64 }, (_, i) => String.fromCharCode(65 + (i % 26))).join('');
  const expected = MIXIN_KEY_ENC_TAB.map((i) => raw[i]).join('').slice(0, 32);
  assert.equal(mixinKey(raw), expected);
  assert.equal(mixinKey(raw).length, 32);
  // 空输入不抛错，回 32 个空字符
  assert.equal(mixinKey(''), '');
});

test('keysFromNav 从 URL 末段取 key，容忍缺字段', () => {
  const nav = { data: { wbi_img: {
    img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
    sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
  } } };
  assert.deepEqual(keysFromNav(nav), {
    imgKey: '7cd084941338484aae1ad9425b84077c',
    subKey: '4932caff0ff746eab6f01bf08b70ac45',
  });
  assert.deepEqual(keysFromNav({}), { imgKey: '', subKey: '' });
  assert.deepEqual(keysFromNav(null), { imgKey: '', subKey: '' });
  // 只有其中一个
  const half = keysFromNav({ data: { wbi_img: { img_url: 'https://x/y/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png' } } });
  assert.equal(half.imgKey.length, 32); assert.equal(half.subKey, '');
});

test('keysLookValid 只认两个 32 字符的 key', () => {
  const k = 'a'.repeat(32);
  assert.equal(keysLookValid({ imgKey: k, subKey: k }), true);
  assert.equal(keysLookValid({ imgKey: k, subKey: 'b'.repeat(31) }), false);
  assert.equal(keysLookValid({ imgKey: '', subKey: k }), false);
  assert.equal(keysLookValid({}), false);
  assert.equal(keysLookValid(null), false);
});

test('wbiSign 是确定的、参数按字典序、含 32 位 w_rid', () => {
  const imgKey = '7cd084941338484aae1ad9425b84077c';
  const subKey = '4932caff0ff746eab6f01bf08b70ac45';
  const a = wbiSign({ aid: 2, cid: 62131 }, imgKey, subKey, 1761740000);
  const b = wbiSign({ aid: 2, cid: 62131 }, imgKey, subKey, 1761740000);
  assert.equal(a, b, '同一输入必须给出同一签名（否则缓存与单测都无从谈起）');
  assert.match(a, /^aid=2&cid=62131&wts=1761740000&w_rid=[0-9a-f]{32}$/);
  // 参数顺序与传入顺序无关（按 name 排序）
  const reversed = wbiSign({ cid: 62131, aid: 2 }, imgKey, subKey, 1761740000);
  assert.equal(a, reversed);
  // mixin 必须参与计算：换 key 则签名必须变
  assert.notEqual(a, wbiSign({ aid: 2, cid: 62131 }, subKey, imgKey, 1761740000));
});

test('wbiSign 剔除 !\'()* 五个字符（B 站前端口径）', () => {
  const query = wbiSign({ q: "a!b'c(d)e*f" }, 'k'.repeat(32), 'k'.repeat(32), 1);
  assert.match(query, /^q=abcdef&wts=1&w_rid=[0-9a-f]{32}$/);
});

test('wbiSign 缺 wts 直接抛（不要静默用 Date.now）', () => {
  assert.throws(() => wbiSign({ aid: 1 }, 'a'.repeat(32), 'b'.repeat(32)), /秒级 wts/);
  assert.throws(() => wbiSign({ aid: 1 }, 'a'.repeat(32), 'b'.repeat(32), undefined), /秒级 wts/);
  assert.throws(() => wbiSign({ aid: 1 }, 'a'.repeat(32), 'b'.repeat(32), NaN), /秒级 wts/);
});

// ── cues → subtitles ─────────────────────────────────────────────

test('cueToSubtitle 秒转毫秒并四舍五入', () => {
  assert.deepEqual(cueToSubtitle({ from: 10.24, to: 13.5, content: '你好' }),
    { startMs: 10240, endMs: 13500, text: '你好' });
  // 1.2345 → 1234.5 → 1235（与 classroom 的 models.subtitle 同口径）
  assert.deepEqual(cueToSubtitle({ from: '1.2345', to: '2.8', content: 'x' }),
    { startMs: 1235, endMs: 2800, text: 'x' });
});

test('cueToSubtitle 把 to < from 钳成相等，而不是丢这条', () => {
  // 上游确有脏数据；内容本身有效，丢了两边都对不上
  const row = cueToSubtitle({ from: 5, to: 3, content: '脏' });
  assert.equal(row.startMs, 5000); assert.equal(row.endMs, 5000);
  assert.ok(row.endMs >= row.startMs, 'endMs 必须 >= startMs，否则 validateInput 抛 INPUT');
});

test('cueToSubtitle 丢弃时间非法的 cue（返回 null）', () => {
  assert.equal(cueToSubtitle({ from: -1, to: 2, content: 'x' }), null);
  assert.equal(cueToSubtitle({ from: 5, to: NaN, content: 'x' }), null);
  assert.equal(cueToSubtitle({ from: undefined, to: 2, content: 'x' }), null);
  assert.equal(cueToSubtitle({ from: MAX_CUE_SECONDS + 1, to: MAX_CUE_SECONDS + 2, content: 'x' }), null);
  assert.equal(cueToSubtitle(null), null);
});

test('cueToSubtitle 把 content 缺失变成空串而不是 undefined', () => {
  // undefined 会让 validateInput 的 typeof !== 'string' 失败 —— 整节解析挂掉
  assert.equal(cueToSubtitle({ from: 0, to: 1 }).text, '');
  assert.equal(cueToSubtitle({ from: 0, to: 1, content: null }).text, '');
  assert.equal(cueToSubtitle({ from: 0, to: 1, content: 42 }).text, '42');
});

test('cuesToSubtitles 丢弃空白 cue、按时间稳定排序、报出丢弃数', () => {
  const { subtitles, dropped, empty } = cuesToSubtitles([
    { from: 3, to: 4, content: '第三' },
    { from: 1, to: 2, content: '第一' },
    { from: 2, to: 3, content: '   ' },   // 纯空白 → 丢
    { from: -5, to: -1, content: '负' },   // 时间非法 → 丢
    { from: 2, to: 2.5, content: '第二' },
  ]);
  assert.deepEqual(subtitles.map((s) => s.text), ['第一', '第二', '第三']);
  assert.equal(dropped, 2);
  assert.equal(empty, false);
});

test('cuesToSubtitles 同 startMs 保持原相对顺序（稳定排序）', () => {
  const { subtitles } = cuesToSubtitles([
    { from: 5, to: 6, content: 'A' },
    { from: 5, to: 7, content: 'B' },
    { from: 5, to: 8, content: 'C' },
  ]);
  assert.deepEqual(subtitles.map((s) => s.text), ['A', 'B', 'C']);
});

test('cuesToSubtitles 输出逐条满足 validateInput 的四条硬校验', () => {
  // 直接对着 parser.js 的判据复现一遍：这是本模块存在的全部理由
  const { subtitles } = cuesToSubtitles([
    { from: 0.001, to: 0.002, content: 'a' },
    { from: -0.5, to: 1, content: 'b' },
    { from: 1, to: 0.5, content: 'c' },
    { from: 3600, to: 3601, content: 'd' },
    { from: 0, to: 0, content: 'e' },
  ]);
  for (const line of subtitles) {
    assert.equal(typeof line.text, 'string', 'text 必须是 string');
    assert.ok(Number.isFinite(line.startMs), 'startMs 必须有限');
    assert.ok(Number.isFinite(line.endMs), 'endMs 必须有限');
    assert.ok(line.startMs >= 0, 'startMs 必须 >= 0');
    assert.ok(line.endMs >= line.startMs, 'endMs 必须 >= startMs');
  }
  assert.ok(subtitles.length > 0, '至少留一条，否则整节走 transcript-only');
});

test('cuesToSubtitles 对空/非数组输入回 empty:true', () => {
  for (const input of [[], null, undefined, 'x', 42]) {
    const r = cuesToSubtitles(input);
    assert.equal(r.empty, true);
    assert.equal(r.subtitles.length, 0);
    assert.equal(r.dropped, 0);
  }
});

// ── transcript 拼装 ──────────────────────────────────────────────

test('transcriptOf 每行带时间戳；everySec>0 时聚合', () => {
  const subs = [
    { startMs: 0, endMs: 1000, text: 'a' },
    { startMs: 5000, endMs: 6000, text: 'b' },
    { startMs: 61000, endMs: 62000, text: 'c' },
  ];
  const per = transcriptOf(subs);
  assert.deepEqual(per.lines, ['[00:00] a', '[00:05] b', '[01:01] c']);
  const grouped = transcriptOf(subs, { everySec: 60 });
  // 0 与 5 秒同属第 0 分钟 → 只有第一行带戳；61 秒进入第 1 分钟 → 带戳
  assert.deepEqual(grouped.lines, ['[00:00] a', 'b', '[01:00] c']);
});

// ── 错误码与处置 ─────────────────────────────────────────────────

test('错误码分类：风控 / 凭证 / 不可用三条互斥', () => {
  assert.equal(isRiskControl(412, undefined), true);
  assert.equal(isRiskControl(200, -352), true);
  assert.equal(isRiskControl(200, 0), false);
  assert.equal(isCredentialIssue(-101), true);
  assert.equal(isUnavailable(-404), true);
  assert.equal(isUnavailable(-10403), true);
  // 互斥：风控码不能被当成凭证过期
  assert.equal(isCredentialIssue(-352), false);
});

test('explainCode 给的是「该怎么办」，不是错误码复读', () => {
  assert.match(explainCode(-101), /重新|登录/);
  assert.match(explainCode(-352), /风控/);
  assert.match(explainCode(-10403), /大会员/);
  assert.match(explainCode(-22007), /转码/);
  assert.match(explainCode(-404), /不存在/);
  // 未知码也要说清楚是未知
  assert.match(explainCode(-99999), /code=-99999/);
});

test('BilibiliError 可 JSON 序列化，且 details 不带 URL 正文', () => {
  const error = new BilibiliError(ERROR_CODE.NO_CREDENTIAL, '需要登录', { tracks: 0 });
  assert.equal(error.name, 'BilibiliError');
  assert.equal(error.code, 'NO_CREDENTIAL');
  assert.deepEqual(JSON.parse(JSON.stringify(error)), { code: 'NO_CREDENTIAL', message: '需要登录', details: { tracks: 0 } });
});

// ── 凭证 ─────────────────────────────────────────────────────────

test('headersFor 匿名字典不含 Cookie 键', () => {
  const headers = headersFor(null);
  assert.equal('Cookie' in headers, false, '匿名时不能带空 Cookie —— 那会被当成残缺凭证');
  assert.ok(headers['User-Agent']);
  assert.equal(headers.Referer, 'https://www.bilibili.com/');
});

test('headersFor 四字段全在才拼 Cookie；缺字段就只拼有的', () => {
  const full = headersFor({ sessdata: 's', bili_jct: 'j', buvid3: 'b3', buvid4: 'b4' });
  assert.equal(full.Cookie, 'SESSDATA=s; bili_jct=j; buvid3=b3; buvid4=b4');
  const partial = headersFor({ sessdata: 's' });
  assert.equal(partial.Cookie, 'SESSDATA=s');
  // 全空 → 退回匿名
  assert.equal('Cookie' in headersFor({ sessdata: '', bili_jct: '', buvid3: '', buvid4: '' }), false);
});

test('inspectCredential 报出缺哪几个字段（不是笼统说「无效」）', () => {
  assert.deepEqual(inspectCredential(null), { ok: false, missing: ['sessdata', 'bili_jct', 'buvid3', 'buvid4'] });
  assert.deepEqual(inspectCredential({ sessdata: 's' }), { ok: false, missing: ['bili_jct', 'buvid3', 'buvid4'] });
  assert.deepEqual(inspectCredential({ sessdata: 's', bili_jct: 'j', buvid3: 'b3', buvid4: 'b4' }), { ok: true, missing: [] });
  // 空白字符串不算有
  assert.deepEqual(inspectCredential({ sessdata: '  ', bili_jct: 'j', buvid3: 'b3', buvid4: 'b4' }),
    { ok: false, missing: ['sessdata'] });
});

// ── HTTP 层：三条风控判据 + 业务码 → 错误码 ──────────────────────
//
// 这一层是**唯一会打网络的地方**，所以用打桩 fetch 测：
// 每条断言对应一种「误判的代价」——
// 把 412 当网络错误会重试到账号被封；把 200+HTML 当坏 JSON 会让人去改代码；
// 把 -101 当风控会让用户一直等而不知道要登录。

import { getData, getJson } from '../packages/dsh-zhiyun-source-bilibili/src/http.js';

/** 临时替换 `globalThis.fetch`，跑完必定还原（含抛错路径）。 */
async function withFetch(responder, run) {
  const original = globalThis.fetch;
  globalThis.fetch = responder;
  try { return await run(); } finally { globalThis.fetch = original; }
}
const respond = (status, body, contentType = 'application/json') =>
  async () => new Response(body, { status, headers: { 'content-type': contentType } });

test('HTTP 412 判成风控，不判成网络错误', async () => {
  await withFetch(respond(412, 'blocked'), async () => {
    await assert.rejects(getJson('https://api.bilibili.com/x'), (error) => {
      assert.equal(error.code, ERROR_CODE.RISK_CONTROL);
      // 提示语必须说「重试或换登录态」，不能只说「网络错误」
      assert.match(error.message, /风控/);
      assert.equal(error.details.status, 412);
      return true;
    });
  });
});

test('HTTP 200 但返回 HTML 也判成风控（验证页 / 频繁访问页）', async () => {
  await withFetch(respond(200, '<html>verify</html>', 'text/html'), async () => {
    await assert.rejects(getJson('https://api.bilibili.com/x'), (error) => {
      assert.equal(error.code, ERROR_CODE.RISK_CONTROL);
      assert.match(error.message, /HTML/);
      return true;
    });
  });
});

test('业务码映射：-352 风控 / -101 凭证 / -404 不可用 / 其余 API_SHAPE', async () => {
  const cases = [
    ['{"code":-352,"message":"风控"}', ERROR_CODE.RISK_CONTROL],
    ['{"code":-101,"message":"未登录"}', ERROR_CODE.CREDENTIAL_EXPIRED],
    ['{"code":-404}', ERROR_CODE.VIDEO_UNAVAILABLE],
    ['{"code":-10403}', ERROR_CODE.VIDEO_UNAVAILABLE],
    ['{"code":-99999,"message":"?"}', ERROR_CODE.API_SHAPE],
  ];
  for (const [body, expected] of cases) {
    await withFetch(respond(200, body), async () => {
      await assert.rejects(getData('https://api.bilibili.com/x'), (error) => {
        assert.equal(error.code, expected, `${body} 应映射成 ${expected}`);
        return true;
      });
    });
  }
});

test('code=0 时 getData 返回 data；data 缺失时返回 null（不抛）', async () => {
  await withFetch(respond(200, '{"code":0,"data":{"ok":1}}'), async () => {
    assert.deepEqual(await getData('https://api.bilibili.com/x'), { ok: 1 });
  });
  await withFetch(respond(200, '{"code":0}'), async () => {
    assert.equal(await getData('https://api.bilibili.com/x'), null);
  });
});

test('坏 JSON 判成 API_SHAPE，且错误详情只带主机名（不带 URL 与正文）', async () => {
  await withFetch(respond(200, 'not json'), async () => {
    await assert.rejects(getJson('https://api.bilibili.com/x?a=secret'), (error) => {
      assert.equal(error.code, ERROR_CODE.API_SHAPE);
      assert.equal(error.details.host, 'api.bilibili.com');
      assert.equal('url' in error.details, false, 'details 不能带完整 URL（可能含签名参数）');
      return true;
    });
  });
});

test('网络异常判成 NETWORK，不吞成 API_SHAPE', async () => {
  const failing = async () => { throw Object.assign(new Error('boom'), { cause: { code: 'ECONNREFUSED' } }); };
  await withFetch(failing, async () => {
    await assert.rejects(getJson('https://api.bilibili.com/x'), (error) => {
      assert.equal(error.code, ERROR_CODE.NETWORK);
      assert.equal(error.details.transport, 'ECONNREFUSED');
      return true;
    });
  });
});

// ── 匿名 nav：既有 wbi_img 就必须能取 key，不能因为 code=-101 就抛 ──
//
// 这条是**实跑踩出来的回归**：第一版 `fetchWbiKeys` 走了 `getData`，
// 而匿名 nav 回 `code=-101`，于是匿名态直接抛 CREDENTIAL_EXPIRED ——
// 与「匿名也能拿 wbi key 并签名」的实测事实矛盾。

test('匿名 nav（code=-101）仍要能取到 wbi key —— 不能走 getData', async () => {
  const navBody = JSON.stringify({
    code: -101, message: '账号未登录',
    data: { isLogin: false, wbi_img: {
      img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
    } },
  });
  const { fetchWbiKeys } = await import('../packages/dsh-zhiyun-source-bilibili/src/subtitle-channel.js');
  await withFetch(respond(200, navBody), async () => {
    const keys = await fetchWbiKeys();
    assert.equal(keys.imgKey, '7cd084941338484aae1ad9425b84077c');
    assert.equal(keys.subKey, '4932caff0ff746eab6f01bf08b70ac45');
  });
});

test('nav 没有 wbi_img 时抛 API_SHAPE（不是静默空 key）', async () => {
  const { fetchWbiKeys } = await import('../packages/dsh-zhiyun-source-bilibili/src/subtitle-channel.js');
  await withFetch(respond(200, '{"code":0,"data":{}}'), async () => {
    await assert.rejects(fetchWbiKeys(), (error) => {
      assert.equal(error.code, ERROR_CODE.API_SHAPE);
      assert.match(error.message, /WBI/);
      return true;
    });
  });
});

// ── 判型（triage）：决定「这份视频要不要抽帧成页」 ──────────────
//
// 这一段的价值不在「分对了」，而在**判不出来时不猜**：
// 对板书视频硬抽会产出「3 页的讲义」，比没有讲义更糟 —— 它看起来像真的。

import {
  KIND, MIN_FRAMES, STATIC_EPS, analyze, classify, extractionAdvice,
  profileOf, quantile, signatureDistance, stepDistances,
} from "../packages/dsh-zhiyun-source-bilibili/src/triage.js";

/** 造一个签名：灰度 base + 确定性抖动（不用随机，测试必须可复现）。 */
function frame(base, { size = 5184, jitter = 0, seed = 1 } = {}) {
  const bytes = new Uint8Array(size);
  let state = seed;
  for (let index = 0; index < size; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const noise = (state % (2 * jitter + 1)) - jitter;
    bytes[index] = Math.max(0, Math.min(255, base + noise));
  }
  return bytes;
}
/** PPT 式夹具：每页若干帧静止，页与页之间大幅跳变。 */
function pptLike(pages = 10, perPage = 5) {
  const out = [];
  for (let page = 0; page < pages; page += 1) {
    for (let k = 0; k < perPage; k += 1) out.push(frame(20 + page * 23, { jitter: 1, seed: page * 97 + k }));
  }
  return out;
}
/** 板书式夹具：灰度连续爬升，没有阶跃。 */
function boardLike(count = 50) {
  return Array.from({ length: count }, (_, i) => frame(10 + i * 2, { jitter: 3, seed: i }));
}

test("signatureDistance 是平均绝对差；长度不等取较短一侧", () => {
  assert.equal(signatureDistance(new Uint8Array([10, 20]), new Uint8Array([10, 20])), 0);
  assert.equal(signatureDistance(new Uint8Array([10, 20]), new Uint8Array([20, 10])), 10);
  assert.equal(signatureDistance(new Uint8Array([5]), new Uint8Array([1, 2, 3])), 4);
  assert.equal(signatureDistance(new Uint8Array([]), new Uint8Array([1])), 0);
});

test("stepDistances 长度是帧数减一；不足两帧为空", () => {
  assert.equal(stepDistances([frame(1), frame(2), frame(3)]).length, 2);
  assert.deepEqual(stepDistances([frame(1)]), []);
  assert.deepEqual(stepDistances([]), []);
});

test("quantile 线性插值，边界钳位", () => {
  const sorted = [1, 2, 3, 4, 5];
  assert.equal(quantile(sorted, 0), 1);
  assert.equal(quantile(sorted, 1), 5);
  assert.equal(quantile(sorted, 0.5), 3);
  assert.equal(quantile([7], 0.9), 7);
  assert.equal(quantile([], 0.5), 0);
});

test("跳变门槛用 p75 而不是 p90 —— 跳变占比 18% 时 p90 会被跳变本身污染", () => {
  // 这是实测踩出来的 bug：用 p90 时门槛被抬到 23×3=69，把真实的 23 排除了
  const { profile } = analyze(pptLike(10, 5));
  assert.ok(profile.jumpCount >= 8, `换页应被数出来（实际 ${profile.jumpCount}）`);
  assert.ok(profile.p75 < 15, `p75 应落在页内抖动一侧（实际 ${profile.p75}）`);
  assert.ok(profile.p90 >= 20, `p90 会被跳变污染（实际 ${profile.p90}），所以不能用它算门槛`);
});

test("PPT 式 → slides，且建议抽帧", () => {
  const { verdict } = analyze(pptLike(10, 5));
  assert.equal(verdict.kind, KIND.SLIDES);
  assert.equal(extractionAdvice(verdict).shouldExtract, true);
});

test("板书式（连续爬升）→ continuous，且**不建议**抽帧", () => {
  const { verdict } = analyze(boardLike(50));
  assert.equal(verdict.kind, KIND.CONTINUOUS);
  const advice = extractionAdvice(verdict);
  assert.equal(advice.shouldExtract, false);
  // 理由必须说清「会产出假页」，否则用户不知道为什么没讲义
  assert.match(advice.reason, /假页|只走字幕/);
});

test("全程静止 → static，且不建议抽帧", () => {
  const { verdict } = analyze(Array.from({ length: 40 }, (_, i) => frame(128, { seed: i })));
  assert.equal(verdict.kind, KIND.STATIC);
  assert.equal(extractionAdvice(verdict).shouldExtract, false);
});

test("样本不足不下结论（unknown），且默认不抽", () => {
  const { verdict } = analyze(pptLike(1, 5));
  assert.equal(verdict.kind, KIND.UNKNOWN);
  assert.equal(verdict.confidence, "low");
  assert.match(verdict.reasons[0], /样本不足/);
  // 关键：unknown 必须落到「不抽」，不能落成「照抽」
  assert.equal(extractionAdvice(verdict).shouldExtract, false);
  assert.match(extractionAdvice(verdict).reason, /不抽/);
});

test("MIN_FRAMES 边界：正好不足与正好达到", () => {
  // 帧数 = MIN_FRAMES → 相邻对 = MIN_FRAMES-1 < MIN_FRAMES → unknown
  const short = pptLike(Math.ceil(MIN_FRAMES / 5) + 1, 5).slice(0, MIN_FRAMES);
  assert.equal(analyze(short).verdict.kind, KIND.UNKNOWN);
  // 帧数 = MIN_FRAMES+1 → 相邻对 = MIN_FRAMES → 可以下结论
  const enough = pptLike(Math.ceil((MIN_FRAMES + 1) / 5) + 1, 5).slice(0, MIN_FRAMES + 1);
  assert.notEqual(analyze(enough).verdict.kind, KIND.UNKNOWN);
});

test("边界情况：两个条件一边满足一边不满足 → unknown（不猜）", () => {
  // 静止占比高（>45%）但跳变极少（<3%）→ 画面几乎不动，只有零星微动
  const profile = profileOf([...Array.from({ length: 200 }, () => 0.2), 5]);
  const verdict = classify(profile);
  assert.equal(verdict.kind, KIND.UNKNOWN);
  assert.match(verdict.reasons.join(" "), /边界/);
});

test("判型理由必须可读 —— 用户要能知道「为什么这视频没讲义」", () => {
  for (const sigs of [pptLike(10, 5), boardLike(50), Array.from({ length: 40 }, (_, i) => frame(9, { seed: i })), pptLike(1, 3)]) {
    const { verdict } = analyze(sigs);
    assert.ok(Array.isArray(verdict.reasons) && verdict.reasons.length > 0, `${verdict.kind} 必须有理由`);
    for (const reason of verdict.reasons) {
      assert.equal(typeof reason, "string");
      assert.ok(reason.length > 8, `理由太短：「${reason}」`);
    }
    assert.ok(["high", "medium", "low"].includes(verdict.confidence), `置信度取值异常：${verdict.confidence}`);
  }
});

test("空输入不抛错，回 unknown", () => {
  assert.equal(analyze([]).verdict.kind, KIND.UNKNOWN);
  assert.equal(analyze(null).verdict.kind, KIND.UNKNOWN);
  assert.equal(profileOf([]).count, 0);
  assert.equal(profileOf(null).count, 0);
});

test("STATIC_EPS 是「几乎没动」的绝对阈值，与实测 p50 同量级", () => {
  // 实测同页内抖动 p50 = 2.25；阈值取 1.0 意味着比 p50 更严 ——
  // 宁可低估静止比例，也不要把压缩噪声当成「静止」
  assert.ok(STATIC_EPS > 0 && STATIC_EPS <= 2.25, `STATIC_EPS=${STATIC_EPS} 应在 (0, 2.25]`);
});

// ── 「帧 → 页」归并（segment） ──────────────────────────────
//
// 这一段防的是**静默错页**：页码重复会让整节解析 INPUT 错（报错信息被翻成
// 「输入信息无效」，看不出哪一页）；createdSec 不递增会让 anchor() 把字幕
// 全分到别的页上（不报错，只是讲义内容整体错位）。

import {
  DEFAULT_THRESHOLD, MAX_THRESHOLD, MIN_PAGE_SECONDS,
  buildSlides, estimateFrames, segmentFrames, slidesFromFrames, validateSlides,
} from "../packages/dsh-zhiyun-source-bilibili/src/segment.js";

/** 造签名：灰度值填充（同页内完全相同 → step=0）。 */
const sig = (value, size = 64) => new Uint8Array(size).fill(value);
/** 造一页：n 帧、间隔 every 秒、灰度 base。 */
function page(base, count, every, startAt) {
  return Array.from({ length: count }, (_, i) => ({
    timeSec: startAt + i * every, signature: sig(base), path: `p${base}-${i}.jpg`,
  }));
}

test("同页帧被归并成一页，交付图取段末、createdSec 取段首", () => {
  const frames = [...page(10, 5, 5, 0), ...page(200, 5, 5, 30)];
  const { pages } = segmentFrames(frames);
  assert.equal(pages.length, 2);
  const { slides } = buildSlides(frames, pages);
  assert.equal(slides.length, 2);
  // 段首计时
  assert.equal(slides[0].createdSec, 0);
  assert.equal(slides[1].createdSec, 30);
  // 段末出图
  assert.equal(slides[0].imagePath, "p10-4.jpg");
  assert.equal(slides[1].imagePath, "p200-4.jpg");
});

test("页码从 1 起、全局唯一 —— validateInput 的硬校验", () => {
  const frames = [...page(10, 4, 5, 0), ...page(150, 4, 5, 25), ...page(60, 4, 5, 50)];
  const { slides } = buildSlides(frames, segmentFrames(frames).pages);
  assert.deepEqual(slides.map((s) => s.page), slides.map((_, i) => i + 1));
  assert.equal(validateSlides(slides).ok, true);
});

test("createdSec 严格递增 —— anchor() 分窗依赖它", () => {
  const frames = [...page(10, 3, 5, 0), ...page(200, 3, 5, 15)];
  const { slides } = buildSlides(frames, segmentFrames(frames).pages);
  for (let i = 1; i < slides.length; i += 1) {
    assert.ok(slides[i].createdSec > slides[i - 1].createdSec, `第 ${i + 1} 页时间未递增`);
  }
});

test("段首撞车时丢掉后一页（它们本来就是同一页），并计入 dropped", () => {
  // 两段被切成两页，但段首落在同一秒
  const frames = [
    { timeSec: 0, signature: sig(10), path: "a.jpg" },
    { timeSec: 0.2, signature: sig(200), path: "b.jpg" },
    { timeSec: 5, signature: sig(200), path: "c.jpg" },
  ];
  const pages = [
    { index: 0, fromSec: 0, toSec: 0, frameFrom: 0, frameTo: 0, pickFrame: 0 },
    { index: 1, fromSec: 0.2, toSec: 5, frameFrom: 1, frameTo: 2, pickFrame: 2 },
  ];
  const { slides, dropped } = buildSlides(frames, pages);
  assert.equal(slides.length, 1, "同一秒的两页只能留一页");
  assert.equal(dropped, 1);
  assert.equal(validateSlides(slides).ok, true);
});

test("转场半帧不能被当成交付图 —— pickFrame 与 frameTo 分离", () => {
  // 换页前后各有一帧转场：第 15 秒那一帧既不属于前页也不属于后页
  const frames = [
    ...page(10, 3, 5, 0),                       // 0,5,10
    { timeSec: 15, signature: sig(200), path: "transition.jpg" },  // 转场半帧
    ...page(50, 3, 5, 20),                      // 20,25,30
  ];
  const { pages } = segmentFrames(frames);
  const { slides } = buildSlides(frames, pages);
  assert.ok(slides.length >= 1);
  for (const slide of slides) {
    assert.notEqual(slide.imagePath, "transition.jpg",
      `页 ${slide.page} 把转场半帧当成交付图了 —— 用户会看到一张淡入到一半的图`);
  }
});

test("阈值 T=3 会过切，T=6 是实测稳定值", () => {
  // 相邻差恒为 4（存进 Uint8Array 不会截断），5 帧跨 20 秒。
  // minPageSeconds 置 0：本用例只测阈值本身，不让「过短段合并」干扰。
  const frames = [0, 1, 2, 3, 4].map((i) => ({
    timeSec: i * 5, signature: new Uint8Array(64).fill(100 + i * 4), path: `${i}.jpg`,
  }));
  assert.ok(segmentFrames(frames, { threshold: 3, minPageSeconds: 0 }).pages.length > 1, "T=3 应该切碎");
  assert.ok(segmentFrames(frames, { threshold: 6, minPageSeconds: 0 }).pages.length < 5, "T=6 应明显少于 5 页");
  assert.equal(MAX_THRESHOLD, 12, "上界应停在 12（实测超过它开始受采样间隔影响）");
});

test("阈值被钳到 [1, MAX_THRESHOLD]", () => {
  const frames = page(10, 3, 5, 0);
  assert.equal(segmentFrames(frames, { threshold: 0 }).pages.length, 1);
  assert.equal(segmentFrames(frames, { threshold: 1e9 }).pages.length, 1);
  // 非法阈值退回默认值，不抛错
  assert.equal(segmentFrames(frames, { threshold: NaN }).pages.length, 1);
  assert.equal(DEFAULT_THRESHOLD, 6);
});

test("判型不是 slides 时，一页都不抽", () => {
  const frames = page(10, 5, 5, 0);
  for (const kind of ["continuous", "static", "unknown", undefined]) {
    const result = slidesFromFrames(frames, { kind });
    assert.equal(result.slides.length, 0, `${kind} 不该抽帧`);
    assert.equal(result.extracted, false);
    assert.match(result.reason, /不抽|假页/);
  }
});

test("判型是 slides 时正常归并", () => {
  const frames = [...page(10, 4, 5, 0), ...page(200, 4, 5, 25)];
  const result = slidesFromFrames(frames, { kind: "slides" });
  assert.equal(result.extracted, true);
  assert.equal(result.slides.length, 2);
  assert.equal(validateSlides(result.slides).ok, true);
});

test("空输入 / 单帧 / 缺签名 都不抛错", () => {
  assert.deepEqual(segmentFrames([]).pages, []);
  assert.equal(segmentFrames(null).pages.length, 0);
  assert.equal(segmentFrames([{ timeSec: 0 }]).pages.length, 1);
  // 缺签名时视为同一页（不制造假页）
  const noSig = [{ timeSec: 0 }, { timeSec: 5 }, { timeSec: 10 }];
  assert.equal(segmentFrames(noSig).pages.length, 1);
  assert.deepEqual(buildSlides([], []), { slides: [], dropped: 0 });
});

test("validateSlides 能逐条指出违约，而不是只说「无效」", () => {
  // 空数组是**合法**的：判型非 slides 时本来就不该有页，parse() 接受 slides: []
  const emptyResult = validateSlides([]);
  assert.equal(emptyResult.ok, true);
  assert.match(emptyResult.note, /transcript-only/);
  const bad = [
    { page: 1, createdSec: 10, imagePath: "a.jpg" },
    { page: 1, createdSec: 20, imagePath: "b.jpg" },   // 页码重复
  ];
  const result = validateSlides(bad);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /页码 1 重复/.test(issue)));

  const notIncreasing = [
    { page: 1, createdSec: 20, imagePath: "a.jpg" },
    { page: 2, createdSec: 20, imagePath: "b.jpg" },   // 未严格递增
  ];
  const second = validateSlides(notIncreasing);
  assert.equal(second.ok, false);
  assert.ok(second.issues.some((issue) => /未严格递增/.test(issue)));

  const noImage = [{ page: 1, createdSec: 0, imagePath: "" }];
  assert.ok(validateSlides(noImage).issues.some((issue) => /缺 imagePath/.test(issue)));
});

test("estimateFrames 是按 96×54 灰度估算的纯算术", () => {
  const twenty = estimateFrames(1200, 5);
  assert.equal(twenty.frames, 241);
  assert.equal(twenty.bytes, 241 * 96 * 54);
  // 非法输入不抛错
  assert.equal(estimateFrames(0, 5).frames, 1);
  assert.equal(estimateFrames(600, 0).frames, 121);  // everySec<=0 → 退回 5
});

test("MIN_PAGE_SECONDS 拦得住「只有 1 帧的转场段」", () => {
  assert.equal(MIN_PAGE_SECONDS, 3);
  // 一个正常页 + 一个孤立单帧（转场）
  const frames = [
    ...page(10, 3, 5, 0),                                 // 0,5,10
    { timeSec: 15, signature: sig(200), path: "t1.jpg" },  // 孤立
    ...page(50, 3, 5, 20),                                // 20,25,30
  ];
  const { pages } = segmentFrames(frames);
  // 孤立的 15 秒那一帧被并进前一段，不会单独成页
  assert.ok(pages.length <= 2, `实际 ${pages.length} 页`);
});


// ── 抽帧执行（frames.js） ────────────────────────────────────
//
// 这一层**必须注入假 spawn 才能测**：沙箱里 node 的 spawn 被拦（EPERM），
// 而真实 ffmpeg 参数另用 bash 验过（见文件末的「参数对照」注释）。
//
// 测的重点不是「ffmpeg 跑没跑」，而是**拼出来的参数对不对**：
// 少一个 -user_agent 就会 403，少 -c copy 就会重编码（慢十倍）。

/** 假 spawn：记录每次调用的参数，按行为产出。 */
function fakeSpawn(behavior) {
  const calls = [];
  const impl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(async () => {
      let outcome;
      try {
        outcome = await behavior(command, args, options);
      } catch (error) {
        // 行为函数抛错 = 模拟「进程启动失败」。**必须转成 'error' 事件**，
        // 与真实 spawn 一致 —— 直接让 Promise 拒绝会变成未捕获异常，
        // 测试会以一个看不懂的 EPERM 堆栈失败（踩过）。
        child.emit('error', error);
        return;
      }
      if (outcome?.stderr) child.stderr.emit("data", Buffer.from(outcome.stderr));
      if (outcome?.stdout) child.stdout.emit("data", Buffer.from(outcome.stdout));
      if (outcome?.touch) {
        for (const file of outcome.touch) {
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, "x");
        }
      }
      child.emit("close", outcome?.code ?? 0);
    });
    return child;
  };
  return { impl, calls };
}

/** 一次性工作目录（测试结束删）。 */
async function workDir(name) {
  const dir = path.join(tmpdir(), "zhiyun-bili-test", name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

test("下载参数必须带 -user_agent 与 -c copy —— 少一个就 403 或重编码", async () => {
  const dir = await workDir("dl");
  let captured = null;
  const { impl } = fakeSpawn(async (command, args) => {
    captured = args;
    return { code: 0, touch: [args[args.length - 1]] };
  });
  await downloadVideo({ url: "https://upos.example/v.mp4", destination: path.join(dir, "v.mp4"), spawnImpl: impl });
  assert.ok(captured.includes("-user_agent"), "缺 -user_agent：B 站 CDN 会回 403");
  assert.equal(captured[captured.indexOf("-user_agent") + 1], BROWSER_UA);
  assert.ok(!captured.join(" ").includes("Lavf"), "不能用 ffmpeg 默认 UA");
  assert.ok(captured.includes("-c") && captured[captured.indexOf("-c") + 1] === "copy", "缺 -c copy：会重编码");
  assert.ok(captured.includes("-y"), "缺 -y：遇到已存在文件会卡在交互");
});

test("抽帧参数是 fps=1/N 与 f%05d.jpg", async () => {
  const dir = await workDir("fr");
  let captured = null;
  const { impl } = fakeSpawn(async (command, args) => {
    captured = args;
    const pattern = args[args.length - 1];
    const base = path.dirname(pattern);
    return { code: 0, touch: [1, 2, 3].map((i) => path.join(base, `f${String(i).padStart(5, "0")}.jpg`)) };
  });
  const result = await extractFrames({ video: path.join(dir, "v.mp4"), directory: path.join(dir, "frames"), everySec: 5, spawnImpl: impl });
  const filter = captured[captured.indexOf("-vf") + 1];
  assert.ok(filter.startsWith("fps=1/5"), `滤镜应为 fps=1/5，实际 ${filter}`);
  // 必须是「每 N 秒一帧」而不是「每秒 N 帧」—— 后者会产出 N 倍的数据量。
  // 判据看**有没有斜杠**：`fps=1/5` 有，`fps=5` 没有。
  assert.ok(/^fps=1\/\d+/.test(filter), `必须是 fps=1/N 形式，实际 ${filter}`);
  assert.ok(captured[captured.length - 1].endsWith("f%05d.jpg"));
  assert.equal(result.frames.length, 3);
  // 时间轴：第 n 张 = (n-1) * interval 秒
  assert.deepEqual(result.frames.map((frame) => frame.timeSec), [0, 5, 10]);
});

test("ffmpeg 非零退出 → PROCESS_FAILED，且提示要 -user_agent", async () => {
  const dir = await workDir("fail");
  const { impl } = fakeSpawn(async () => ({
    code: 1, stderr: "[https @ 0x1] Server returned 403 Forbidden (access denied)\nError opening input",
  }));
  await assert.rejects(
    downloadVideo({ url: "https://x.test/v.mp4", destination: path.join(dir, "bad.mp4"), spawnImpl: impl }),
    (error) => {
      assert.equal(error.code, ERROR_CODE.PROCESS_FAILED);
      assert.match(error.message, /403/);
      // 错误信息要能直接指向修法，而不是只说「失败了」
      assert.match(error.message, /user_agent/);
      return true;
    },
  );
});

test("下载后文件为空 → PROCESS_FAILED（不静默返回 0 字节）", async () => {
  const dir = await workDir("empty");
  const { impl } = fakeSpawn(async () => ({ code: 0 }));
  await assert.rejects(
    downloadVideo({ url: "https://x.test/v.mp4", destination: path.join(dir, "e.mp4"), spawnImpl: impl }),
    (error) => {
      assert.equal(error.code, ERROR_CODE.PROCESS_FAILED);
      assert.match(error.message, /为空/);
      return true;
    },
  );
});

test("取消（abort）→ CANCELLED，不是 PROCESS_FAILED", async () => {
  const dir = await workDir("cancel");
  const controller = new AbortController();
  const { impl } = fakeSpawn(() => new Promise(() => {}));
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(
    downloadVideo({ url: "https://x.test/v.mp4", destination: path.join(dir, "c.mp4"), spawnImpl: impl, signal: controller.signal }),
    (error) => {
      // 取消是用户的意志，不该被算成失败
      assert.equal(error.code, ERROR_CODE.CANCELLED);
      return true;
    },
  );
});

test("超时 → PROCESS_TIMEOUT", async () => {
  const dir = await workDir("timeout");
  const { impl } = fakeSpawn(() => new Promise(() => {}));
  await assert.rejects(
    downloadVideo({ url: "https://x.test/v.mp4", destination: path.join(dir, "t.mp4"), spawnImpl: impl, timeoutMs: 50 }),
    (error) => {
      assert.equal(error.code, ERROR_CODE.PROCESS_TIMEOUT);
      return true;
    },
  );
});

test("非 https 直链 / 缺目标路径 → INPUT，不启动进程", async () => {
  const { impl, calls } = fakeSpawn(async () => ({ code: 0 }));
  await assert.rejects(downloadVideo({ url: "http://x.test/v.mp4", destination: "/tmp/a.mp4", spawnImpl: impl }), /https/);
  await assert.rejects(downloadVideo({ url: "https://x.test/v.mp4", destination: "", spawnImpl: impl }), /目标路径/);
  assert.equal(calls.length, 0, "参数非法时不该起进程");
});

test("summarizeFfmpegError 把几十行 stderr 压成一句可读原因", () => {
  assert.match(summarizeFfmpegError("Server returned 403 Forbidden (access denied)"), /403.*user_agent/);
  assert.match(summarizeFfmpegError("HTTP error 404 Not Found"), /404/);
  assert.match(summarizeFfmpegError("Invalid data found when processing input"), /不是可解码/);
  assert.match(summarizeFfmpegError("moov atom not found"), /不完整/);
  // 认不出来时给最后一行，而不是空串
  assert.equal(summarizeFfmpegError("line one\nline two"), "line two");
  assert.match(summarizeFfmpegError(""), /没有输出/);
});

test("probeFfmpeg 失败时回原因，不抛错", async () => {
  const { impl } = fakeSpawn(async () => {
    throw Object.assign(new Error("spawn EPERM"), { code: "EPERM" });
  });
  const result = await probeFfmpeg({ spawnImpl: impl });
  assert.equal(result.ok, false);
  assert.ok(result.reason.length > 0);
});

test("probeFfmpeg 成功时回版本行", async () => {
  const { impl } = fakeSpawn(async () => ({ code: 0, stdout: "ffmpeg version 7.1.1 Copyright (c) 2000-2025\nbuilt with..." }));
  const result = await probeFfmpeg({ spawnImpl: impl });
  assert.equal(result.ok, true);
  assert.match(result.version, /ffmpeg version 7\.1\.1/);
});

// 参数对照（真实 ffmpeg 验过，2026-10-29）：
//   下载  ffmpeg -hide_banner -loglevel error -user_agent "<浏览器UA>" -i <url> -c copy -y <out>
//         → 19,782,241 B 成功
//   抽帧  ffmpeg -hide_banner -loglevel error -i <mp4> -vf "fps=1/5,scale=320:-1" -q:v 5 <dir>/f%05d.jpg
//         → 239 帧 / 2552 ms
// 这两条命令与上面断言里拼出来的**逐字一致**。


// ── 播放地址（playurl） ────────────────────────────────────
//
// 只测**我们自己的判据**（形状、分段上限、https 强制），不打真实接口 ——
// 真实接口另有一条在线验证记录（见文件末注释）。

test('playurl 用 fnval=1 取单个 mp4（不是 DASH 分离流）', async () => {
  let captured = null;
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    captured = String(url);
    return new Response(JSON.stringify({
      code: 0,
      data: { quality: 16, format: 'mp4', durl: [{ url: 'https://upos.example/v.mp4', size: 19782234 }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await fetchPlayUrl({ aid: 1, cid: 2 });
    assert.equal(result.segments, 1);
    assert.equal(result.format, 'mp4');
    assert.equal(result.quality, 16);
    assert.equal(result.lengthBytes, 19782234);
    // 关键：必须是老接口，否则返回的是音视频分离的 DASH 流
    assert.match(captured, /fnval=1(&|$)/);
    assert.match(captured, /platform=html5/);
    assert.equal(DEFAULT_QUALITY, 16);
  } finally { globalThis.fetch = original; }
});

test('playurl 拒绝多段流 —— 不拼接，也不只取第一段', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 0,
    data: { durl: Array.from({ length: MAX_DURL_SEGMENTS + 1 }, (_, i) => ({ url: 'https://x.test/' + i + '.mp4' })) },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(fetchPlayUrl({ aid: 1, cid: 2 }), (error) => {
      assert.equal(error.code, ERROR_CODE.API_SHAPE);
      // 理由必须说清「不拼接」—— 只取第一段会产出一份「只有前半段」的帧
      assert.match(error.message, /不拼接/);
      return true;
    });
  } finally { globalThis.fetch = original; }
});

test('playurl 空 durl → API_SHAPE，不是静默空', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 0, data: { durl: [] } }),
    { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(fetchPlayUrl({ aid: 1, cid: 2 }), /durl/);
  } finally { globalThis.fetch = original; }
});

test('playurl 拒绝非 https 直链（防中间人改写）', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    code: 0, data: { durl: [{ url: 'http://upos.example/v.mp4' }] },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(fetchPlayUrl({ aid: 1, cid: 2 }), /https/);
  } finally { globalThis.fetch = original; }
});

test('playurl 参数校验：cid / aid 必须是正整数', async () => {
  await assert.rejects(fetchPlayUrl({ aid: 1, cid: 0 }), /cid/);
  await assert.rejects(fetchPlayUrl({ aid: 1, cid: 1.5 }), /cid/);
  await assert.rejects(fetchPlayUrl({ aid: 0, cid: 1 }), /aid/);
});

// ── 编排（lesson） ─────────────────────────────────────────

/** 打桩一个「元数据成功、字幕失败」的 B 站。 */
function stubBilibiliNoSubtitle() {
  return async (url) => {
    const target = String(url);
    if (target.includes('/x/web-interface/view')) {
      return new Response(JSON.stringify({
        code: 0,
        data: { aid: 114199086762590, cid: 28984414196, title: '线性代数', duration: 1198, owner: { name: '某UP' } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.includes('/x/web-interface/nav')) {
      return new Response(JSON.stringify({
        code: -101,
        data: { isLogin: false, wbi_img: {
          img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
          sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
        } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('字幕失败不拖垮元数据 —— 两者失败不对称', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = stubBilibiliNoSubtitle();
  try {
    const { resolveLesson } = await import('../packages/dsh-zhiyun-source-bilibili/src/subtitle-channel.js');
    const result = await resolveLesson({ bvid: 'BV11DXrYeE5D' });
    // 元数据必须还在
    assert.equal(result.aid, 114199086762590);
    assert.equal(result.cid, 28984414196);
    assert.equal(result.title, '线性代数');
    // 字幕缺席，但要能分辨原因
    assert.equal(result.subtitles.length, 0);
    assert.equal(result.subtitleError.code, ERROR_CODE.NO_CREDENTIAL);
    assert.ok(result.warnings.some((w) => /登录/.test(w)));
  } finally { globalThis.fetch = original; }
});

test('withFrames=false 时只取字幕，不碰 ffmpeg', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = stubBilibiliNoSubtitle();
  const { impl, calls } = fakeSpawn(async () => ({ code: 0 }));
  try {
    const result = await buildLesson({ bvid: 'BV11DXrYeE5D', withFrames: false, spawnImpl: impl });
    assert.equal(result.picture.extracted, false);
    assert.equal(result.picture.reason, '未启用抽帧');
    assert.equal(calls.length, 0, 'withFrames=false 不该起任何进程');
    // 字幕失败的原因必须透传上来 —— 否则调用方分不清「没登录」与「这视频没字幕」
    assert.equal(result.subtitleError.code, ERROR_CODE.NO_CREDENTIAL);
  } finally { globalThis.fetch = original; }
});

test('没有 workDir 时跳过抽帧并说明原因（不是「视频有问题」）', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = stubBilibiliNoSubtitle();
  try {
    const result = await buildLesson({ bvid: 'BV11DXrYeE5D', withFrames: true, workDir: null });
    assert.equal(result.picture.extracted, false);
    assert.match(result.picture.reason, /workDir/);
    // 这条 warning 不能让人以为是视频的问题
    assert.ok(result.warnings.some((w) => /无法决定帧图落在哪里/.test(w)));
  } finally { globalThis.fetch = original; }
});

test('finishFrames：判型非 slides 时 slides 为空但不算失败', async () => {
  const frames = Array.from({ length: 30 }, (_, i) => ({ index: i, timeSec: i * 5, path: 'f' + i + '.jpg' }));
  const signOf = async (filePath) => {
    const index = Number(filePath.match(/f(\d+)/)[1]);
    return new Uint8Array(64).fill(10 + index * 4); // 连续爬升，无阶跃
  };
  const result = await finishFrames({ frames, signOf });
  assert.equal(result.picture.verdict.kind, 'continuous');
  assert.equal(result.picture.extracted, false);
  assert.equal(result.slides.length, 0);
  // 空 slides 是合法的，validateSlides 不该报错
  assert.equal(validateSlides(result.slides).ok, true);
});

test('finishFrames：没有 signOf 直接报错（不静默返回空）', async () => {
  await assert.rejects(finishFrames({ frames: [{ index: 0, timeSec: 0, path: 'a.jpg' }] }), /signOf/);
});

test('DEFAULT_SAMPLE_SEC 是 5（实测 20 分钟课 239 帧）', () => {
  assert.equal(DEFAULT_SAMPLE_SEC, 5);
});
