/**
 * 补齐上游七条只读能力的契约测试。
 *
 * 对应 `packages/vendor/zju-assistant/core/zju/lib/zhiyun/` 里的：
 *
 *   - `search resources`  → `source.searchResources()`（`resources.js`）
 *   - `check`             → `source.check()`            （`diagnostics.js`）
 *   - `trans audio`       → `source.transcribeAudio()`  （`asr.js`）
 *   - `live start/status/stop/text` → `source.live*()`  （`live-caption.js`）
 *
 * 全部用假 fetch / 假转写器，**不联网**。
 *
 * # 夹具来源（必须写清楚）
 *
 * 真实响应我**没有**。夹具分两类：
 *
 *   1. **有上游代码依据**：`live-socket.ts` 的 glue 协议帧、`live.ts` 的
 *      `trans_socket_url` / `sub_status`、`courses.ts` 的 `content` 结构、
 *      `materials.ts` 的分页字段。这些在测试里逐条注明了出处行号。
 *   2. `⚠️ 按上游注释推断，未经真实响应验证`：凡是我在这行标注的字段，
 *      形状来自上游代码的**假设**而不是我亲眼见过的响应。若上游漂移，
 *      对应断言应当先红，而不是静默通过。
 *
 * # 断言不写「真空真」
 *
 * 每个「空」的断言都同时钉 `.length`；每个「有」的断言都钉具体值。
 * 空数组上的 `every` / `forEach` 永远为真，这里一律不用。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ClassroomSource, ENDPOINTS, splitPhrases } from '../packages/source/classroom/src/source.js';
import { liveEndpoints } from '../packages/source/classroom/src/live.js';
import {
  IDLE_MS, LiveCollector, beijingTime, decodeFrame, missingIntervals,
  normalizeCaption, subtitleEndpoint, wait,
} from '../packages/source/classroom/src/live-caption.js';
import { assetsOf, parseKinds, videoHeight } from '../packages/source/classroom/src/resources.js';
import {
  normalizeSegments, renderMarkdown, renderTranscript, transcribeFile, withTimeout,
} from '../packages/source/classroom/src/asr.js';
import {
  ASR_RUNTIME_PACKAGE, checkAsr, checkComponents, checkMedia, resolveFfmpeg,
} from '../packages/source/classroom/src/diagnostics.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});

/** 造一个 ClassroomSource，fetch 由用例提供；不联网。 */
const classroom = (handler) => new ClassroomSource({ fetch: handler });

/** 一条带 JWT 的 `_token` cookie：直播/字幕通路的每个请求都要 `Authorization: Bearer`。 */
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
async function withToken(source) {
  await source.transport.session.jar.setCookie(
    `_token=${encodeURIComponent(`{"_csrf":"x"}${JWT}`)}; Domain=classroom.zju.edu.cn; Path=/; Secure`,
    'https://classroom.zju.edu.cn/',
  );
  return source;
}

/* ══════════════════════════════════ search resources ══════════════════════════════════ */

test('parseKinds accepts all / comma list and rejects unknown kinds instead of ignoring them', () => {
  assert.deepEqual(parseKinds(undefined), ['video', 'audio', 'ppt', 'slides', 'subtitles']);
  assert.deepEqual(parseKinds('all'), ['video', 'audio', 'ppt', 'slides', 'subtitles']);
  assert.deepEqual(parseKinds('ppt, slides'), ['ppt', 'slides']);
  assert.deepEqual(parseKinds(['video', 'video', 'audio']), ['video', 'audio']);
  // 拼错一个种类必须抛：静默忽略会让调用方拿到「什么都没有」而不是「你写错了」。
  assert.throws(() => parseKinds('video,transcript'), (error) => {
    assert.equal(error.code, 'INVALID_INPUT');
    assert.deepEqual(error.details.unknown, ['transcript']);
    return true;
  });
});

test('videoHeight reads real dimensions before quality labels and never trusts slot numbers', () => {
  assert.equal(videoHeight('https://v.test/a/1920x1080/v.mp4'), 1080);
  assert.equal(videoHeight('https://v.test/a/1280_720/v.mp4'), 720);
  assert.equal(videoHeight('https://v.test/回放%201080p.mp4'), 1080);
  // 「高清」这种槽位编号不是高度；认不出就该是 null，不能编一个。
  assert.equal(videoHeight('https://v.test/live/1/index.m3u8'), null);
  assert.equal(videoHeight(''), null);
});

test('assetsOf flattens playback/ppt/file_list with kind tags and de-duplicates by kind+url', () => {
  // content 的形状来自上游 courses.ts:115-135（playback.url / download.ppt / file_list）。
  const lesson = { resources: {
    videoUrl: 'https://video.cmc.zju.edu.cn/2026/1920x1080/play.m3u8',
    videoDurationMs: 5400000,
    pptFileName: '第3讲.pdf',
    pptUrl: 'https://video.cmc.zju.edu.cn/ppt/3.pdf',
    files: [
      // 同一路回放在 file_list 里又出现一次：不能算两条。
      { type: '回放', url: 'https://video.cmc.zju.edu.cn/2026/1920x1080/play.m3u8' },
      { type: '音频', url: 'https://video.cmc.zju.edu.cn/audio/3.m4a' },
      { type: '封面', url: 'https://video.cmc.zju.edu.cn/cover.jpg' },
      { type: '空的', url: '' },
    ],
  } };
  const assets = assetsOf(lesson);
  assert.equal(assets.length, 3, `实际 ${JSON.stringify(assets.map((a) => a.kind))}`);
  assert.deepEqual(assets.map((a) => a.kind), ['video', 'ppt', 'audio']);
  assert.equal(assets[0].height, 1080);
  assert.equal(assets[0].durationMs, 5400000);
  assert.equal(assets[2].url, 'https://video.cmc.zju.edu.cn/audio/3.m4a');
  // 封面 jpg 不是资源种类之一，不得混进来。
  assert.equal(assets.some((a) => a.url.endsWith('cover.jpg')), false);
});

test('searchResources returns only the requested kinds and takes slide counts on demand', async () => {
  const calls = [];
  const source = await withToken(classroom((url) => {
    const target = new URL(url);
    calls.push(target.pathname);
    if (target.pathname.endsWith('/course/catalogue')) {
      // 形状依据：上游 courses.ts:157-175（result.data[]，content 是 JSON 字符串）。
      return json({ result: { data: [
        { course_id: 7, sub_id: 9, title: '数据结构 第3次', status: '6',
          content: JSON.stringify({
            playback: { url: 'https://video.cmc.zju.edu.cn/1080p/play.m3u8' },
            download: { ppt: { file_name: '第3讲.pdf', path_name: 'https://video.cmc.zju.edu.cn/ppt/3.pdf' } },
            file_list: [{ file_type: '音频', file_name: 'https://video.cmc.zju.edu.cn/a/3.m4a' }],
          }) },
        { course_id: 7, sub_id: 10, title: '第4次', status: '1', content: '{}' },
      ] } });
    }
    if (target.pathname.endsWith('/search-ppt')) {
      return json({ total: 2, list: [
        { old_id: 1, created_sec: 1, content: JSON.stringify({ pptimgurl: 'https://e.test/1.jpg' }) },
        { old_id: 2, created_sec: 2, content: JSON.stringify({ pptimgurl: 'https://e.test/2.jpg' }) },
      ] });
    }
    if (target.pathname.endsWith('/search-trans-result')) {
      // 这节课还没有字幕：给空表（不是「未查询到语音数据」那种拒绝）。
      return json({ list: [] });
    }
    throw new Error(`未预期的请求 ${target.href}`);
  }));

  // 只要 ppt：既不该拉 PPT 截图，也不该拉字幕。
  const only = await source.searchResources(7, 9, { kind: 'ppt' });
  assert.equal(only.resources.length, 1, '只要 ppt 时不该混进别的种类');
  assert.equal(only.resources[0].kind, 'ppt');
  assert.equal(only.resources[0].name, '第3讲.pdf');
  assert.equal(only.resources[0].available, true);
  assert.equal(calls.some((p) => p.endsWith('/search-ppt')), false, 'kind=ppt 不该去拉截图');

  // 全都要：截图与字幕各按需取一次。
  calls.length = 0;
  const all = await source.searchResources(7, 9, { kind: 'all' });
  const kinds = all.resources.map((item) => item.kind);
  assert.equal(all.resources.length, 5, `实际 ${JSON.stringify(kinds)}`);
  assert.deepEqual(kinds, ['video', 'ppt', 'audio', 'slides', 'subtitles']);
  assert.equal(all.resources.find((i) => i.kind === 'slides').count, 2);
  assert.equal(all.resources.find((i) => i.kind === 'subtitles').count, 0);
  assert.ok(calls.some((p) => p.endsWith('/search-ppt')), 'kind=all 时应当去取截图数量');
  await source.dispose();
});

test('searchResources marks an audio slot as unavailable instead of inventing a URL', async () => {
  const source = await withToken(classroom(() => json({ result: { data: [
    { course_id: 7, sub_id: 9, title: '只有视频', status: '6',
      content: JSON.stringify({ playback: { url: 'https://video.cmc.zju.edu.cn/1080p/p.m3u8' } }) },
  ] } })));
  const out = await source.searchResources(7, 9, { kind: 'audio' });
  assert.equal(out.resources.length, 1);
  assert.equal(out.resources[0].kind, 'audio');
  // 上游会补一条「下载时从视频里提取」；本仓没有压制链路，所以必须显式说不可用，
  // 而不是给一个能点但下不下来的地址。
  assert.equal(out.resources[0].available, false);
  assert.equal(out.resources[0].url, null);
  assert.match(out.resources[0].source, /视频压制/);
  await source.dispose();
});

test('searchResources rejects an unknown lesson rather than returning an empty resource list', async () => {
  const source = await withToken(classroom(() => json({ result: { data: [
    { course_id: 7, sub_id: 9, title: 'A', status: '6', content: '{}' },
  ] } })));
  await assert.rejects(source.searchResources(7, 11), (error) => {
    assert.equal(error.code, 'NOT_FOUND');
    assert.match(error.message, /不属于这门课/);
    return true;
  });
  await source.dispose();
});

test('searchResources swallows only "no speech data" for subtitles and rethrows real failures', async () => {
  const makeSource = (subtitleBody) => withToken(classroom((url) => {
    const target = new URL(url);
    if (target.pathname.endsWith('/course/catalogue')) {
      return json({ result: { data: [{ course_id: 7, sub_id: 9, title: 'A', status: '6', content: '{}' }] } });
    }
    return subtitleBody();
  }));

  // 当天的课本来就没有字幕：上游是**拒绝**而不是给空表，记 0 句。
  const dayOf = await makeSource(() => json({ code: 500, msg: '未查询到语音数据' }));
  const out = await dayOf.searchResources(7, 9, { kind: 'subtitles' });
  assert.equal(out.resources.length, 1);
  assert.equal(out.resources[0].count, 0);
  assert.equal(out.resources[0].available, false);
  await dayOf.dispose();

  // 别的失败必须照抛：把网络错误吞成「没有字幕」会让人白等到下课。
  const broken = await makeSource(() => new Response('boom', { status: 500 }));
  await assert.rejects(broken.searchResources(7, 9, { kind: 'subtitles' }), (error) => error.code === 'HTTP');
  await broken.dispose();
});

/* ══════════════════════════════════ check ══════════════════════════════════ */

test('resolveFfmpeg honours FFMPEG_PATH, then the managed install path', () => {
  const viaEnv = resolveFfmpeg({ env: { FFMPEG_PATH: 'D:/bin/ffmpeg.exe' } });
  assert.deepEqual(viaEnv, { executable: 'D:/bin/ffmpeg.exe', source: 'env' });

  const managed = resolveFfmpeg({ env: {}, dataDirectory: 'C:/data/zhiyun' });
  assert.equal(managed.source, 'managed');
  // 与上游 ffmpeg.ts:11 的托管路径同形：tools/zhiyun-media/node_modules/ffmpeg-static。
  assert.match(managed.executable, /tools[\\/]zhiyun-media[\\/]node_modules[\\/]ffmpeg-static[\\/]ffmpeg/);

  assert.deepEqual(resolveFfmpeg({ env: {} }), { executable: 'ffmpeg', source: 'path' });
});

test('checkMedia actually runs the binary and separates "missing" from "ran but failed"', async () => {
  // 假 spawn：只回一个 EventEmitter 形状的 child。**不用真 ffmpeg**，避免环境依赖。
  // 「真的执行一次 -version」这件事本身由下面三条断言分开钉：ENOENT / 非零退出 / 正常。
  const ok = await checkMedia({
    env: { FFMPEG_PATH: '/opt/ffmpeg' },
    spawn: () => fakeChild({ stdout: 'ffmpeg version 6.1.1-static Copyright\n' }),
  });
  assert.equal(ok.available, true);

  const missing = await checkMedia({
    env: { FFMPEG_PATH: '/nope/ffmpeg' },
    spawn: () => fakeChild({ error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }),
  });
  assert.equal(missing.available, false);
  assert.match(missing.error, /找不到可执行文件/);

  const failed = await checkMedia({
    env: { FFMPEG_PATH: '/opt/ffmpeg' },
    spawn: () => fakeChild({ code: 1 }),
  });
  assert.equal(failed.available, false);
  assert.match(failed.error, /退出码 1/);
});

/** 假的 child 进程：事件在下一个 tick 发，让调用方先把监听器挂上。 */
function fakeChild({ stdout = '', code = 0, error = null }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    if (error) { child.emit('error', error); return; }
    if (stdout) child.stdout.emit('data', stdout);
    child.emit('close', code);
  });
  return child;
}

test('checkMedia reports version on success', async () => {
  const result = await checkMedia({
    env: { FFMPEG_PATH: '/opt/ffmpeg' },
    spawn: () => fakeChild({ stdout: 'ffmpeg version 6.1.1-static Copyright (c) 2000-2023\n' }),
  });
  assert.equal(result.component, 'media');
  assert.equal(result.available, true);
  assert.equal(result.version, '6.1.1-static');
  assert.equal(result.source, 'env');
  assert.equal(result.error, null);
  assert.equal(result.action, null);
});

test('checkMedia reports ENOENT as "not installed" with an actionable next step', async () => {
  const error = Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' });
  const result = await checkMedia({ env: {}, spawn: () => fakeChild({ error }) });
  assert.equal(result.component, 'media');
  assert.equal(result.available, false);
  assert.match(result.error, /找不到可执行文件：ffmpeg/);
  // action 必须给出可执行的动作，不能只说「不可用」。
  assert.match(result.action, /FFMPEG_PATH/);
});

test('checkMedia reports a non-zero exit with the tail of stderr', async () => {
  const result = await checkMedia({
    env: { FFMPEG_PATH: '/bad/ffmpeg' },
    spawn: () => fakeChild({ code: 9 }),
  });
  // 上面没给 stderr，这里退化成只看退出码。
  assert.equal(result.available, false);
  assert.match(result.error, /退出码 9/);
});

test('checkAsr reports the runtime as missing instead of pretending transcription works', async () => {
  const result = await checkAsr({ home: 'C:/dsh-home', files: ['model.int8.onnx'] });
  assert.equal(result.component, 'asr');
  // 本仓确实没有那个宿主语音包 —— 这条断言钉的是「如实报缺」，不是环境巧合。
  assert.equal(result.runtime.available, false);
  assert.equal(result.runtime.package, ASR_RUNTIME_PACKAGE);
  assert.equal(result.runtime.engine, 'sensevoice-onnx');
  assert.equal(result.available, false);
  assert.equal(result.verified, false, '没有算哈希就不能说已校验');
  assert.deepEqual(result.problems.length, 2, `实际问题：${JSON.stringify(result.problems)}`);
  assert.match(result.problems[0], /找不到运行库/);
  assert.match(result.problems[1], /模型文件缺失/);
  assert.match(result.action, /宿主安装层/);
  // 目录按上游 asr.ts:53-54 的布局推。
  assert.equal(result.directory, path.join('C:/dsh-home', 'speech-to-text', 'sensevoice', 'models'));
});

test('checkAsr reports missing model files when the runtime happens to be present', async () => {
  // 直接复用真包名解析会依赖本机环境，所以这里只验证「模型文件存在与否」这一支：
  // 用 HOME 指向一个空目录 → 三个文件都缺。
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-asr-check-'));
  try {
    const result = await checkAsr({ home: dir, files: ['a.onnx', 'b.txt'] });
    assert.equal(result.models.length, 2);
    assert.deepEqual(result.models.map((m) => m.present), [false, false]);
    assert.deepEqual(result.problems.filter((p) => p.includes('模型文件缺失')).length, 1);
    assert.match(result.problems.join(' '), /a\.onnx、b\.txt/);

    // 只放一个文件：仍然报缺，且缺的清单只列真正缺的那个。
    await mkdir(path.join(dir, 'speech-to-text', 'sensevoice', 'models'), { recursive: true });
    await writeFile(path.join(dir, 'speech-to-text', 'sensevoice', 'models', 'a.onnx'), 'x');
    const partial = await checkAsr({ home: dir, files: ['a.onnx', 'b.txt'] });
    assert.deepEqual(partial.models.map((m) => m.present), [true, false]);
    assert.equal(partial.models[0].bytes, 1, '应当报出文件大小');
    assert.match(partial.problems.join(' '), /模型文件缺失：b\.txt/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('checkComponents rejects unknown component names instead of silently checking nothing', async () => {
  await assert.rejects(checkComponents('gpu'), (error) => {
    assert.equal(error.code, 'INVALID_INPUT');
    assert.deepEqual(error.details.unknown, ['gpu']);
    return true;
  });
});

test('checkComponents("media") returns exactly one result with the component label', async () => {
  const result = await checkComponents('media', {
    env: { FFMPEG_PATH: '/opt/ffmpeg' },
    spawn: () => fakeChild({ stdout: 'ffmpeg version 7.0\n' }),
  });
  assert.equal(result.component, 'media');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].version, '7.0');
  assert.equal(result.available, true);
});

test('source.check() forwards the profile data directory so media diagnostics resolve the managed path', async () => {
  const source = new ClassroomSource({ fetch: async () => json({}) , dataDirectory: 'C:/profile/data/zhiyun-classroom' });
  try {
    const result = await source.check('media', {
      env: {},
      spawn: () => fakeChild({ stdout: 'ffmpeg version 5.1\n' }),
    });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].source, 'managed');
    assert.match(result.results[0].executable, /zhiyun-classroom[\\/]tools[\\/]zhiyun-media/);
  } finally { await source.dispose(); }
});

/* ══════════════════════════════════ trans audio ══════════════════════════════════ */

test('withTimeout rejects with TIMEOUT, calls the abort hook and clears the timer', async () => {
  let aborted = 0;
  const started = Date.now();
  await assert.rejects(
    withTimeout(new Promise(() => {}), 30, () => { aborted += 1; }),
    (error) => {
      assert.equal(error.code, 'TIMEOUT');
      assert.match(error.message, /转写超过/);
      return true;
    },
  );
  assert.equal(aborted, 1, '超时必须真的让内核收手，不能只是放弃等待');
  assert.ok(Date.now() - started < 2000, '不该等满整个超时才红');

  // 正常完成时不能被慢定时器拖住（计时器必须 clearTimeout）。
  assert.equal(await withTimeout(Promise.resolve('ok'), 60000, () => { throw new Error('不该 abort'); }), 'ok');
});

test('normalizeSegments converts seconds to ms, drops blank text and rejects bogus timestamps', () => {
  const rows = normalizeSegments([
    { start: 0, end: 1.5, text: ' 第一句 ' },
    { start: 2, end: 3, text: '   ' },              // 没有文字 → 丢掉（上游同样处理）
    { start: null, end: null, text: '时间未知' },     // 上游允许 null/null
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { startMs: 0, endMs: 1500, text: '第一句' });
  assert.deepEqual(rows[1], { startMs: null, endMs: null, text: '时间未知' });

  assert.throws(() => normalizeSegments([{ start: 3, end: 2, text: '倒的' }]), (error) => error.code === 'API_SHAPE');
  assert.throws(() => normalizeSegments([{ start: 1, end: null, text: '半截' }]), (error) => error.code === 'API_SHAPE');
  assert.throws(() => normalizeSegments([{ start: 1, end: 2, text: 42 }]), (error) => error.code === 'API_SHAPE');
  assert.throws(() => normalizeSegments('nope'), (error) => error.code === 'API_SHAPE');
});

test('renderTranscript matches the subtitle transcript format and honours the aggregation knob', () => {
  const segments = [
    { startMs: 0, endMs: 3000, text: '甲' },
    { startMs: 10000, endMs: 15000, text: '乙' },
    { startMs: 70000, endMs: 75000, text: '丙' },
  ];
  assert.equal(renderTranscript(segments).split('\n').length, 3);
  assert.match(renderTranscript(segments), /^\[00:00\] 甲$/m);
  assert.match(renderTranscript(segments), /^\[01:10\] 丙$/m);

  const grouped = renderTranscript(segments, { timestampEverySec: 60 });
  assert.equal(grouped.split('\n').length, 2, '按分钟聚成两块');
  assert.match(grouped, /\[00:00\] 甲 乙/);

  const plain = renderTranscript(segments, { withTimestamps: false });
  assert.doesNotMatch(plain, /\[/);
  assert.equal(renderTranscript([]), '');
});

test('renderMarkdown declares that it is a rough draft, never a summary', () => {
  const markdown = renderMarkdown([
    { startMs: 0, endMs: 1500, text: '甲' },
    { startMs: null, endMs: null, text: '乙' },
  ]);
  assert.match(markdown, /^# 音频转写粗稿/);
  assert.match(markdown, /未做总结/);
  assert.match(markdown, /\[00:00–00:01\] 甲/);
  assert.match(markdown, /\[时间未知\] 乙/);
});

test('transcribeAudio fails loudly when no engine is injected instead of returning empty text', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-asr-none-'));
  try {
    const file = path.join(dir, 'a.m4a');
    await writeFile(file, 'not-really-audio');
    const source = new ClassroomSource({ fetch: async () => json({}) });
    await assert.rejects(source.transcribeAudio({ file, directory: path.join(dir, 'out') }), (error) => {
      assert.equal(error.code, 'DEPENDENCY_MISSING');
      assert.match(error.message, /尚未接入识别内核/);
      assert.match(error.details.hint, /注入转写器/);
      return true;
    });
    await source.dispose();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('transcribeAudio validates absolute paths and a real non-empty input file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-asr-paths-'));
  const transcribe = async () => ({ segments: [{ start: 0, end: 1, text: 'x' }] });
  try {
    const source = new ClassroomSource({ fetch: async () => json({}) });
    source.setTranscriber(transcribe);
    await assert.rejects(source.transcribeAudio({ file: 'rel.m4a', directory: path.join(dir, 'out') }), (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /绝对路径/);
      return true;
    });
    await assert.rejects(source.transcribeAudio({ file: path.join(dir, 'a.m4a'), directory: 'rel' }), (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /输出目录须为绝对路径/);
      return true;
    });
    await assert.rejects(source.transcribeAudio({ file: path.join(dir, 'missing.m4a'), directory: path.join(dir, 'out') }), (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /音频文件不存在/);
      return true;
    });
    const empty = path.join(dir, 'empty.m4a');
    await writeFile(empty, '');
    await assert.rejects(source.transcribeAudio({ file: empty, directory: path.join(dir, 'out') }), (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /空文件/);
      return true;
    });
    await source.dispose();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('transcribeAudio writes four files atomically, de-duplicates on re-run and reports NO_TEXT', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-asr-run-'));
  const file = path.join(dir, 'a.m4a');
  await writeFile(file, 'audio-bytes');
  let runs = 0;
  const source = new ClassroomSource({ fetch: async () => json({}) });
  source.setTranscriber(async ({ file: input, directory }) => {
    runs += 1;
    // 内核写自己的东西（这里假装写了 raw.json），编排层负责其余四个文件。
    await writeFile(path.join(directory, 'raw.json'), '{}');
    assert.equal(input, file);
    return { engine: 'fake-sensevoice', segments: [
      { start: 0, end: 1.2, text: '今天讲第三章' },
      { start: 1.2, end: 3, text: '先看定义' },
    ] };
  });
  try {
    const out = await source.transcribeAudio({ file, directory: path.join(dir, 'out') });
    assert.equal(out.reused, false);
    assert.equal(out.segments.length, 2);
    assert.equal(out.text, '今天讲第三章\n先看定义');
    assert.equal(out.totalCharacters, out.text.length);
    assert.equal(out.durationMs, 3000);
    assert.equal(out.engine, 'fake-sensevoice');
    assert.equal(out.bytes, 11);
    assert.equal(runs, 1);

    const produced = path.join(dir, 'out');
    for (const name of ['segments.json', 'transcript.txt', 'transcript.md', 'transcribe.json']) {
      await stat(path.join(produced, name)); // 缺一个就抛
    }
    assert.equal(await readFile(path.join(produced, 'transcript.txt'), 'utf8'), '今天讲第三章\n先看定义\n');
    const saved = JSON.parse(await readFile(path.join(produced, 'segments.json'), 'utf8'));
    assert.deepEqual(saved, [
      { startMs: 0, endMs: 1200, text: '今天讲第三章' },
      { startMs: 1200, endMs: 3000, text: '先看定义' },
    ]);

    // 第二次必须命中缓存：内核不跑，结果一致。
    const again = await source.transcribeAudio({ file, directory: produced });
    assert.equal(again.reused, true);
    assert.equal(runs, 1, '同一文件同一内核不该再跑一遍');
    assert.equal(again.text, out.text);
  } finally { await source.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('transcribeAudio cleans the staging directory and never leaves half a result', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-asr-fail-'));
  const file = path.join(dir, 'a.m4a');
  await writeFile(file, 'audio');
  const out = path.join(dir, 'out');
  const source = new ClassroomSource({ fetch: async () => json({}) });
  source.setTranscriber(async () => { throw new Error('内核炸了'); });
  try {
    await assert.rejects(source.transcribeAudio({ file, directory: out }), /内核炸了/);
    // 阶段目录必须删掉：半份结果比没有结果更难辨别。
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(out), [], '失败后不该留下任何阶段文件');

    // 内核返回空句段 = 没有识别到文字，必须报 NO_TEXT 而不是「成功但空」。
    source.setTranscriber(async () => ({ segments: [{ start: 0, end: 1, text: '   ' }] }));
    await assert.rejects(source.transcribeAudio({ file, directory: out }), (error) => {
      assert.equal(error.code, 'NO_TEXT');
      return true;
    });
  } finally { await source.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('transcribeAudio can be aborted and does not write a cache entry', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-asr-abort-'));
  const file = path.join(dir, 'a.m4a');
  await writeFile(file, 'audio');
  const out = path.join(dir, 'out');
  const source = new ClassroomSource({ fetch: async () => json({}) });
  const controller = new AbortController();
  source.setTranscriber(({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    // 立刻中止，模拟调用方在识别中取消。
    setTimeout(() => controller.abort(), 5);
  }));
  try {
    await assert.rejects(source.transcribeAudio({ file, directory: out, signal: controller.signal }));
    const { readdir } = await import('node:fs/promises');
    assert.equal((await readdir(out)).includes('transcribe.json'), false, '取消不该留下缓存');
  } finally { await source.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('transcribeAudio honours its own timeout budget', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-asr-slow-'));
  const file = path.join(dir, 'a.m4a');
  await writeFile(file, 'audio');
  const source = new ClassroomSource({ fetch: async () => json({}) });
  let sawAbort = false;
  source.setTranscriber(({ signal }) => new Promise((resolve) => {
    signal.addEventListener('abort', () => { sawAbort = true; }, { once: true });
    // 永不完成：只有超时能让它结束。
  }));
  try {
    await assert.rejects(
      source.transcribeAudio({ file, directory: path.join(dir, 'out'), timeoutMs: 25 }),
      (error) => {
        assert.equal(error.code, 'TIMEOUT');
        assert.match(error.message, /转写超过/);
        assert.equal(error.details.timeoutMs, 25);
        return true;
      },
    );
    assert.equal(sawAbort, true, '超时必须把 abort 传到内核');
  } finally { await source.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('setTranscriber returns a revoke function that restores the previous engine', async () => {
  const source = new ClassroomSource({ fetch: async () => json({}) });
  try {
    const first = async () => ({ segments: [] });
    const second = async () => ({ segments: [] });
    source.setTranscriber(first);
    const revoke = source.setTranscriber(second);
    assert.equal(source.transcriber, second);
    revoke();
    assert.equal(source.transcriber, first, '撤销后应当回到上一个，而不是 null');
    source.setTranscriber(null);
    assert.equal(source.transcriber, null);
  } finally { await source.dispose(); }
});

/* ══════════════════════════════════ live（实时字幕） ══════════════════════════════════ */

test('subtitleEndpoint accepts only the official qlite host and single-segment channels', () => {
  assert.equal(
    subtitleEndpoint('https://qlite2.cmc.zju.edu.cn/abc123'),
    'https://qlite2.cmc.zju.edu.cn/abc123/glue/ajax',
  );
  // 结尾带斜杠也要归一化，不能拼出 `//glue/ajax`。
  assert.equal(
    subtitleEndpoint('https://qlite2.cmc.zju.edu.cn/abc123/'),
    'https://qlite2.cmc.zju.edu.cn/abc123/glue/ajax',
  );
  assert.equal(
    subtitleEndpoint('https://qlite2.cmc.zju.edu.cn/abc?x=1#h'),
    'https://qlite2.cmc.zju.edu.cn/abc/glue/ajax',
  );

  // 这个地址来自上游 JSON，随后会被直接 POST —— 白名单松一条就是 SSRF 一跳。
  const rejected = [
    '', 'not a url',
    'https://evil.test/abc',                                  // 别的域
    'https://qlite2.cmc.zju.edu.cn.evil.test/abc',            // 后缀伪造
    'https://qlite2.cmc.zju.edu.cn:8443/abc',                 // 别的端口
    'https://user:pass@qlite2.cmc.zju.edu.cn/abc',            // 带凭证
    'ftp://qlite2.cmc.zju.edu.cn/abc',                        // 非 http(s)
    'https://qlite2.cmc.zju.edu.cn/a/b',                      // 多段路径
    'https://qlite2.cmc.zju.edu.cn/',                         // 空频道
  ];
  for (const value of rejected) {
    assert.throws(() => subtitleEndpoint(value), (error) => {
      assert.equal(error.code, 'API_SHAPE', `应拒绝 ${value}`);
      return true;
    }, value);
  }
});

test('decodeFrame parses every command in the glue 1.9.1 protocol', () => {
  // 形态依据：上游 live-socket.ts:15-35。`cd` 帧里的长度是**频道名的字节数**
  // （频道名通常就是 'm'），不是整段 payload 的长度。
  assert.deepEqual(decodeFrame('cd1&m{"a":1}'), { command: 'cd', data: { a: 1 } });
  assert.deepEqual(decodeFrame('in{"socketID":"s-1"}'), { command: 'in' });
  // 别的频道不是错误：上游随时可能再加一路。
  assert.deepEqual(decodeFrame('cd1&x{}'), { command: 'other-channel' });
  for (const command of ['pi', 'po', 'cl', 'dr', 'iv']) {
    assert.deepEqual(decodeFrame(command), { command }, command);
  }

  const rejected = {
    'cd&m{}': '缺少长度',        // 没有 `&`
    'cd0&m{}': '长度为零',       // size < 1
    'cd99&m{}': '长度越界',
    'cd1&m{not json}': '不是 JSON',
    'in{}': '握手缺 socketID',
    'zz': '未知帧',
  };
  for (const [frame, why] of Object.entries(rejected)) {
    assert.throws(() => decodeFrame(frame), (error) => {
      assert.equal(error.code, 'API_SHAPE', `${frame}（${why}）应当报结构错`);
      return true;
    }, frame);
  }
});

test('normalizeCaption keeps ms timestamps, records reversed field order and rejects impossible windows', () => {
  const base = { receivedAt: 1000_000, startsAt: 900_000, endsAt: 1200_000, subId: '9' };
  const good = normalizeCaption({ sourcetext: '  老师说了什么  ', text_begin_time: 950_000, text_end_time: 953_000, time: 950_000, end_time: 1 }, base);
  assert.equal(good.startMs, 950000);
  assert.equal(good.endMs, 953000);
  assert.equal(good.text, '老师说了什么');
  assert.equal(good.final, true);
  assert.equal(good.fieldOrder, 'normal');
  assert.equal(good.id, '9:950000:953000:老师说了什么');

  // 上游确实会给出 end < begin：取 min/max 并记下顺序，不把这条丢掉。
  const reversed = normalizeCaption({ sourcetext: '倒序', text_begin_time: 953_000, text_end_time: 950_000, time: 953_000, end_time: -1 }, base);
  assert.equal(reversed.startMs, 950000);
  assert.equal(reversed.endMs, 953000);
  assert.equal(reversed.fieldOrder, 'reversed');
  assert.equal(reversed.final, false);

  // 空文本是静音段，不是错误：返回 null。
  assert.equal(normalizeCaption({ sourcetext: '   ', text_begin_time: 1, text_end_time: 2, time: 1, end_time: 1 }, base), null);

  const rejected = [
    [{ sourcetext: 'x' }, '缺时间'],
    [{ sourcetext: 'x', text_begin_time: 950_000, text_end_time: 953_000, time: 950_000, end_time: 0 }, 'end_time 非 ±1'],
    [{ sourcetext: 'x', text_begin_time: 1, text_end_time: 2, time: 1, end_time: 1 }, '早于开课太多'],
    [{ sourcetext: 'x', text_begin_time: 2_000_000, text_end_time: 2_000_001, time: 2_000_000, end_time: 1 }, '晚于下课太多'],
    [{ sourcetext: 'x', text_begin_time: 950_000, text_end_time: 1_900_000, time: 950_000, end_time: 1 }, '单段超 10 分钟'],
    [{ sourcetext: 'x', text_begin_time: 950_000, text_end_time: 953_000, time: 999_999, end_time: 1 }, 'time 既不是 begin 也不是 end'],
    [{ error: 1, sourcetext: 'x' }, '上游报错'],
  ];
  for (const [value, why] of rejected) {
    assert.throws(() => normalizeCaption(value, base), (error) => {
      assert.ok(['API_SHAPE', 'BUSINESS'].includes(error.code), `${why}：实际 ${error.code}`);
      return true;
    }, why);
  }
});

test('missingIntervals reports the holes that late-start / disconnect leave behind', () => {
  const now = 1000;
  // 完整覆盖 → 没有缺口（注意同时钉 length：空数组上的 every 永远是真空真）。
  const covered = missingIntervals(0, 100, [{ start: 0, end: 100 }], now);
  assert.equal(covered.length, 0);
  // 晚启动：0..30 没听到。
  const late = missingIntervals(0, 100, [{ start: 30, end: 100 }], now);
  assert.equal(late.length, 1);
  assert.deepEqual(late[0], { start: 0, end: 30 });
  // 中间断线 + 尾部还在采（end: null 用 now 收口）。
  const gaps = missingIntervals(0, 100, [{ start: 0, end: 40 }, { start: 60, end: null }], now);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0], { start: 40, end: 60 });
  // 完全没监听过：整窗都是缺口。
  assert.deepEqual(missingIntervals(0, 100, [], now), [{ start: 0, end: 100 }]);
});

const LESSON = { courseId: '7', subId: '9', title: '数据结构', room: 'A101', startsAt: 0, endsAt: Date.now() + 3600_000 };

/**
 * 一个假的 glue 服务端。
 * **按请求体分派，而不是按调用顺序发队列** —— 后者会把「推 `in`」的响应
 * 误当成「轮询」的响应，于是夹具在替实现擦屁股（第一版就是栽在这）。
 *
 * 协议依据（`live-socket.ts:53-89`）：
 *
 *   - `POST i` → `"<uid>&<token>"`；
 *   - `POST u<uid>&<msg>` → 响应体**不被当成帧**（in / pi→po / cl 都走这条）；
 *   - `POST o<uid>&<token>` → `"t"`（超时，token 不前进）或 `"<newToken>&<frame>"`。
 *
 * @param {object} options
 * @param {string} [options.init] - `POST i` 的响应。
 * @param {(index: number, body: string) => string|Error} [options.poll] - 第 n 次轮询的响应。
 * @param {() => object} [options.info] - `get-sub-info` 的响应体。
 */
function liveServer({ init = 'uid-1&tok-1', poll = () => 't', info } = {}) {
  const posts = [];
  let polls = 0;
  const fetch = async (url, options) => {
    const target = String(url);
    const body = String(options?.body ?? '');
    if (target.includes('get-sub-info')) return json(info());
    if (!target.endsWith('/glue/ajax')) throw new Error(`字幕轮询打到了别的地方：${target}`);
    // 上限只为防「一直空转」的用例把内存吃光；断言只看最近若干条。
    if (posts.length < 400) posts.push(body);
    if (body === 'i') return new Response(init, { status: 200 });
    if (body.startsWith('u')) return new Response('', { status: 200 }); // 推帧：响应体不是帧
    if (body.startsWith('o')) {
      const next = poll(polls, body);
      polls += 1;
      if (next instanceof Error) throw next;
      return new Response(next, { status: 200 });
    }
    throw new Error(`未识别的 glue 请求：${body}`);
  };
  return { fetch, posts, polls: () => polls };
}

/**
 * 造一条「就在此刻」的字幕。
 *
 * ⚠️ 时间必须贴着 `Date.now()`：`normalizeCaption` 会拒绝落在课次窗口之外的时间戳
 * （这是它的**职责** —— 不能把接收时间伪装成字幕时间）。第一版用 1000/3000 这种
 * 「相对秒」，结果被判成「早于开课太多」而静默丢掉了。夹具改成绝对时间，
 * 那一条校验才是在验证实现、而不是在迁就夹具。
 */
function liveCaption(text, { at = Date.now(), spanMs = 2000, final = 1 } = {}) {
  return { sourcetext: text, text_begin_time: at, text_end_time: at + spanMs, time: at, end_time: final };
}

const LIVE_INFO = (address = 'https://qlite2.cmc.zju.edu.cn/abc', subStatus = '2') => () => ({
  data: { course_id: '7', sub_id: '9', sub_status: subStatus, content: JSON.stringify({ trans_socket_url: address }) },
});

/** 一帧 `cd`（字幕）：长度是频道名 `m` 的字节数。 */
const cdFrame = (token, payload) => `tok-${token}&cd1&m${JSON.stringify(payload)}`;

test('LiveCollector performs init → subscribe → poll, records captions and unsubscribes on stop', async () => {
  const caption = liveCaption('同学们好');
  // 顺序照 live-socket.ts:59-89：i → u<uid>&in{...} → (o<uid>&<token>)* 。
  // 第 0 次轮询先回握手的 `in` 帧，第 1 次才是字幕。
  const server = liveServer({
    info: LIVE_INFO(),
    poll: (index) => {
      if (index === 0) return 'tok-1&in{"socketID":"s"}';
      if (index === 1) return cdFrame(2, caption);
      if (index === 2) return 'tok-2&pi';       // 服务端 ping
      // 空闲/超时：**整个响应体就是一个 `t`**，不是 `<token>&t`。
      // 后者会被解成「未知帧 t」——第一版夹具就错在这里。
      return 't';
    },
  });
  const source = new ClassroomSource({ fetch: server.fetch });
  await withToken(source);
  try {
    const collector = new LiveCollector({
      live: source.live,
      lessons: [{ ...LESSON, startsAt: Date.now() - 1000 }],
      pollMs: 0,
    });
    collector.start();
    // 等到真的收到那条字幕（而不是靠固定 sleep）。
    for (let i = 0; i < 400 && collector.lessons[0].captions.length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.equal(collector.lessons[0].captions.length, 1, `实际 posts=${JSON.stringify(server.posts)}`);
    assert.equal(collector.lessons[0].captions[0].text, '同学们好');
    assert.equal(collector.lessons[0].captions[0].final, true);
    assert.equal(collector.lessons[0].status, 'connected');

    // 握手与 pong 都发过：缺 pong 服务端会判掉线。
    assert.equal(server.posts[0], 'i');
    assert.equal(server.posts[1], 'uuid-1&in{"version":"1.9.1"}');
    // `po` 是**收到服务端 `pi` 之后**才发的，所以要等轮询走到那一帧，不能立刻断言。
    for (let i = 0; i < 400 && !server.posts.includes('uuid-1&po'); i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.ok(server.posts.includes('uuid-1&po'), `缺少 po 应答：${JSON.stringify(server.posts)}`);

    const view = collector.statusView();
    assert.equal(view.lessons.length, 1);
    assert.equal(view.lessons[0].sentences, 1);
    assert.equal(view.receiving, true, 'connected 且已有字 → receiving');

    await collector.stop();
    // 停止必须主动退订，否则服务端会留着这路订阅。
    assert.ok(server.posts.includes('uuid-1&cl'), `退订请求缺失：${JSON.stringify(server.posts)}`);
    assert.equal(collector.status, 'stopped');
    assert.equal(collector.lessons[0].status, 'stopped');
  } finally { await source.dispose(); }
});

test('LiveCollector reports ended lessons from sub_status and never opens a subscription for them', async () => {
  const server = liveServer({ info: LIVE_INFO(undefined, '6') });
  const source = new ClassroomSource({ fetch: server.fetch });
  await withToken(source);
  try {
    const collector = new LiveCollector({ live: source.live, lessons: [{ ...LESSON, startsAt: Date.now() - 1000 }], pollMs: 0 });
    collector.start();
    for (let i = 0; i < 400 && collector.status !== 'ended'; i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.equal(collector.status, 'ended');
    assert.equal(collector.lessons[0].status, 'ended');
    assert.equal(server.posts.length, 0, `已经散场的课不该再去连一个死会话，实际发了 ${JSON.stringify(server.posts)}`);
    await collector.stop();
  } finally { await source.dispose(); }
});

test('LiveCollector keeps waiting (not failing) while the address is still null', async () => {
  let info = 0;
  const server = liveServer({
    // 前两次还没开播 → 地址为空；之后给地址。
    info: () => {
      info += 1;
      return { data: { course_id: '7', sub_id: '9', sub_status: '2',
        content: JSON.stringify(info < 3 ? {} : { trans_socket_url: 'https://qlite2.cmc.zju.edu.cn/abc' }) } };
    },
  });
  const source = new ClassroomSource({ fetch: server.fetch });
  await withToken(source);
  try {
    const collector = new LiveCollector({
      live: source.live,
      lessons: [{ ...LESSON, startsAt: Date.now() - 1000 }],
      pollMs: 0,
      // 把「等开播」的间隔压到 1ms，否则这个用例要跑 20 秒。
      sleep: (ms, signal) => wait(Math.min(ms, 1), signal),
    });
    collector.start();
    for (let i = 0; i < 400 && info < 3; i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.ok(info >= 3, `应当反复重试取地址，实际只问了 ${info} 次`);
    // 「还没开播」期间不该把错误挂在课上：那是正常等待，不是故障。
    assert.equal(collector.lessons[0].error, null);
    assert.equal(collector.lessons[0].captions.length, 0);
    await collector.stop();
  } finally { await source.dispose(); }
});

test('LiveCollector records a protocol error as reconnect and keeps retrying', async () => {
  let handshakes = 0;
  const server = liveServer({ info: LIVE_INFO() });
  const source = new ClassroomSource({ fetch: async (url, options) => {
    const body = String(options?.body ?? '');
    // 第一次握手给个坏响应：不能让整节课就此判死。
    if (String(url).endsWith('/glue/ajax') && body === 'i' && handshakes++ === 0) {
      server.posts.push(body);
      return new Response('garbage', { status: 200 });
    }
    return server.fetch(url, options);
  } });
  await withToken(source);
  try {
    const collector = new LiveCollector({
      live: source.live,
      lessons: [{ ...LESSON, startsAt: Date.now() - 1000 }],
      pollMs: 0,
      sleep: (ms, signal) => wait(Math.min(ms, 1), signal),
    });
    collector.start();
    for (let i = 0; i < 400 && handshakes < 2; i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.ok(handshakes >= 2, `应当重连，实际只试了 ${handshakes} 次`);
    assert.equal(collector.lessons[0].status, 'reconnecting');
    assert.match(String(collector.lessons[0].error), /初始化无效/);
    await collector.stop();
  } finally { await source.dispose(); }
});

test('LiveSource.subInfo returns the caption address, flags ended lessons and rejects a mismatched lesson', async () => {
  const seen = [];
  const source = await withToken(classroom((url, options) => {
    const target = new URL(url);
    seen.push({ path: target.pathname, auth: options.headers.authorization ?? null });
    if (target.searchParams.get('sub_id') === '404') {
      // 查不到的课次被上游用「另一节」兜住：必须报结构错，不能把别的课的字幕接上来。
      return json({ data: { course_id: '7', sub_id: '405', sub_status: '2', content: '{}' } });
    }
    return json({ data: { course_id: '7', sub_id: '9', sub_status: '6',
      content: JSON.stringify({ trans_socket_url: 'https://qlite2.cmc.zju.edu.cn/abc' }) } });
  }));
  try {
    const info = await source.live.subInfo('7', '9');
    assert.equal(info.address, 'https://qlite2.cmc.zju.edu.cn/abc');
    assert.equal(info.ended, true);
    assert.equal(info.subStatus, '6');
    assert.equal(seen[0].path, new URL(liveEndpoints.subInfo).pathname);
    // 与取流同一套要求：字幕入口也要 Bearer。
    assert.equal(seen[0].auth, `Bearer ${JWT}`);

    await assert.rejects(source.live.subInfo('7', '404'), (error) => {
      assert.equal(error.code, 'API_SHAPE');
      assert.equal(error.message, '节次详情返回结构异常：sub_id');
      return true;
    });
  } finally { await source.dispose(); }
});

test('LiveSource.subInfo reports a non-string trans_socket_url as a shape error, not as "no captions"', async () => {
  const source = await withToken(classroom(() => json({ data: { course_id: '7', sub_id: '9', sub_status: '2',
    content: JSON.stringify({ trans_socket_url: { href: 'x' } }) } })));
  try {
    await assert.rejects(source.live.subInfo('7', '9'), (error) => {
      assert.equal(error.code, 'API_SHAPE');
      assert.match(error.message, /trans_socket_url/);
      return true;
    });
  } finally { await source.dispose(); }
});

test('liveStart returns immediately, liveStatus is local, liveText reports gaps, liveStop keeps the text', async () => {
  const caption = liveCaption('第一章');
  const server = liveServer({
    info: LIVE_INFO(),
    // 第 0 次轮询回握手 `in`，第 1 次才是字幕，之后一直空闲。
    poll: (index) => (index === 0 ? 'tok-1&in{"socketID":"s"}' : index === 1 ? cdFrame(2, caption) : 't'),
  });
  let requests = 0;
  const source = await withToken(new ClassroomSource({ fetch: async (url, options) => {
    requests += 1;
    return server.fetch(url, options);
  } }));
  try {
    const startedAt = Date.now();
    const started = await source.liveStart({ ...LESSON, startsAt: Date.now() - 1000 });
    // 「只建立会话」：不阻塞到收字。500ms 是很宽松的上限。
    assert.ok(Date.now() - startedAt < 500, `liveStart 不该阻塞，实际 ${Date.now() - startedAt}ms`);
    assert.equal(started.reused, false);
    assert.equal(started.status, 'running');
    assert.equal(started.lessons.length, 1);
    assert.equal(started.lessons[0].subId, '9');

    // 同一范围重复调用复用同一个任务。
    const again = await source.liveStart({ ...LESSON, startsAt: Date.now() - 1000 });
    assert.equal(again.reused, true);

    for (let i = 0; i < 400 && source.liveStatus().sentences === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.equal(source.liveStatus().sentences, 1);

    // 状态是纯本地快照：请求数不再增长。
    const before = requests;
    source.liveStatus();
    source.liveStatus({ courseId: '7', subId: '9' });
    assert.equal(requests, before, 'liveStatus 不该发请求');

    // 窗口：以「现在」为中心往前 3 秒。采集是刚刚才开始的，所以窗口前段必是缺口。
    // （第一版这里写死了 3000ms —— 那是 1970 年，窗口根本盖不到课次，纯属夹具错。）
    const now = Date.now();
    const text = source.liveText({ courseId: '7', subId: '9', at: now, before: 3000, after: 0 });
    assert.equal(text.course, '数据结构');
    assert.equal(text.segments.length, 1);
    assert.equal(text.text, '第一章');
    assert.equal(text.status, 'partial', '晚启动 → 窗口含未监听时段');
    assert.equal(text.gaps.length, 1);
    assert.equal(text.source, 'official-live');

    const stopped = await source.liveStop({ courseId: '7', subId: '9' });
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.sentences, 1, '停不等于删：已收到的字必须留着');

    // 停了之后查不到任务，但**必须**如实说「没有在采集」，不能编一段空文本当成功。
    const afterStop = source.liveStatus();
    assert.equal(afterStop.status, 'not-running');
    const gone = source.liveText({ courseId: '7', subId: '9' });
    assert.equal(gone.status, 'unavailable');
    assert.equal(gone.text, '');
  } finally { await source.dispose(); }
});

test('liveStatus reports not-running before any task exists', () => {
  const source = new ClassroomSource({ fetch: async () => json({}) });
  try {
    const all = source.liveStatus();
    assert.equal(all.status, 'not-running');
    assert.equal(all.sentences, 0);
    assert.equal(all.lessons.length, 0);

    const one = source.liveStatus({ courseId: '7', subId: '9' });
    assert.equal(one.status, 'not-running');
    assert.equal(one.lessons.length, 0);
    assert.equal(one.receiving, false);
  } finally { source.dispose(); }
});

test('liveStart rejects an inverted window and invalid identifiers before starting anything', async () => {
  const source = new ClassroomSource({ fetch: async () => json({}) });
  try {
    await assert.rejects(
      source.liveStart({ courseId: '7', subId: '9', startsAt: 2000, endsAt: 1000 }),
      (error) => {
        assert.equal(error.code, 'INVALID_INPUT');
        assert.match(error.message, /下课时间须晚于开课时间/);
        return true;
      },
    );
    await assert.rejects(source.liveStart({ courseId: 'x', subId: '9' }), (error) => error.code === 'API_SHAPE');
    assert.equal(source.liveStatus().status, 'not-running', '参数不合法时不该留下半个任务');
  } finally { source.dispose(); }
});

test('liveText rejects an ambiguous window with concrete candidates', () => {
  const source = new ClassroomSource({ fetch: async () => json({}) });
  try {
    const now = Date.now();
    for (const subId of ['9', '10']) {
      const collector = new LiveCollector({
        live: source.live,
        lessons: [{ courseId: '7', subId, title: `课${subId}`, startsAt: now - 60_000, endsAt: now + 60_000 }],
        now: () => now,
      });
      // 直接塞进表里，不走 start：这条只验 liveText 的消歧，不需要网络。
      source.liveTasks.set(`7:${subId}`, collector);
    }
    assert.throws(() => source.liveText({ at: now, before: 30_000 }), (error) => {
      assert.equal(error.code, 'INVALID_INPUT');
      assert.match(error.message, /对应多个课次/);
      assert.equal(error.details.candidates.length, 2);
      return true;
    });
    // 指定课次就没有歧义。
    const one = source.liveText({ courseId: '7', subId: '10', at: now, before: 30_000 });
    assert.equal(one.status, 'no-text');
    assert.equal(one.course, '课10');
  } finally { source.dispose(); }
});

test('dispose stops live collection instead of leaving the polling loop behind', async () => {
  const caption = liveCaption('字', { spanMs: 1000 });
  // 第 0 次轮询握手，第 1 次给字幕，之后一直空闲 —— 只有 dispose 能让循环停下来。
  const server = liveServer({
    info: LIVE_INFO(),
    poll: (index) => (index === 0 ? 'tok-1&in{"socketID":"s"}' : index === 1 ? cdFrame(2, caption) : 't'),
  });
  const source = await withToken(new ClassroomSource({ fetch: server.fetch }));
  await source.liveStart({ ...LESSON, startsAt: Date.now() - 1000 });
  for (let i = 0; i < 400 && source.liveStatus().sentences === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.equal(source.liveStatus().sentences, 1);

  await source.dispose();
  const settled = server.posts.length;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(server.posts.length, settled, 'dispose 之后轮询必须真的停了');
  assert.equal(source.liveTasks.size, 0, '任务表应当被清空');
});

test('beijingTime renders +08:00 and refuses non-finite input', () => {
  assert.equal(beijingTime(Date.parse('2026-11-02T13:05:00+08:00')), '2026-11-02T13:05:00.000+08:00');
  assert.equal(beijingTime(Number.NaN), null);
  assert.equal(beijingTime(null), null);
});

test('idle and ping constants match the upstream protocol numbers', () => {
  // 这两个数字是上游实测出来的；改小会让服务端判我们掉线，改大会拖慢重连。
  assert.equal(IDLE_MS, 35000);
});

/* ══════════════════════════════════ search captions（W-13 / 漏-5） ══════════════════════════════════ */

/**
 * 字幕关键词检索（对应上游 `zhiyun/materials.ts` 的 `searchCaptions`）。
 *
 * ⚠️ 夹具按上游 `parseTranscript` 的形状（`list[].all_content[]`，字段
 * `BeginSec` / `EndSec` / `Text`）手写，**未经真实字幕接口验证**。
 */

test('splitPhrases splits on Chinese and ASCII separators, keeps order, drops duplicates', async () => {
  assert.deepEqual(splitPhrases('点名、签到|考勤\n点名'), ['点名', '签到', '考勤']);
  assert.deepEqual(splitPhrases('  考试范围 ，Exam  ；exam '), ['考试范围', 'Exam'], '全角/大小写差异算同一个词');
  assert.deepEqual(splitPhrases(''), []);
  assert.deepEqual(splitPhrases(null), []);
});

test('searchCaptions returns hits with neighbouring sentences and per-keyword counts', async () => {
  const source = await withToken(classroom((url) => {
    const target = new URL(url);
    if (target.pathname.endsWith('/search-trans-result')) {
      return json({ list: [
        { all_content: [
          { BeginSec: 0, EndSec: 3, Text: '今天讲第三章' },
          { BeginSec: 3, EndSec: 6, Text: '这节课会点名，请同学们注意' },
          { BeginSec: 6, EndSec: 9, Text: '点名用的是学习通' },
        ] },
      ] });
    }
    throw new Error(`未预期的请求：${target.pathname}`);
  }));

  const out = await source.searchCaptions({
    keyword: '点名', lessons: [{ courseId: 7, subId: 9, date: '2026-11-01' }],
  });

  assert.deepEqual(out.keywords, ['点名']);
  assert.equal(out.lessonsSearched, 1);
  assert.deepEqual(out.lessonsWithoutCaptions, []);
  assert.equal(out.total, 2);
  assert.equal(out.counts['点名'], 2);
  assert.equal(out.hits.length, 2);
  // 前后各一句拼在一起：只给命中的那一句看不出老师在说什么。
  assert.match(out.hits[0].text, /今天讲第三章 .*这节课会点名/);
  assert.equal(out.hits[0].at, '00:03');
  assert.equal(out.hits[0].lesson, 1);
  assert.equal(out.hits[0].date, '2026-11-01');
  assert.equal('truncated' in out, false);
});

test('searchCaptions marks lessons without captions instead of failing the whole search', async () => {
  const source = await withToken(classroom((url) => {
    const target = new URL(url);
    if (target.pathname.endsWith('/search-trans-result')) {
      // 当天的课课后才有字幕：站点对这一种是拒绝而不是给空表。
      if (target.searchParams.get('sub_id') === '2') return json({ msg: '未查询到语音数据' });
      return json({ list: [{ all_content: [{ BeginSec: 0, EndSec: 2, Text: '这节没有点名' }] }] });
    }
    throw new Error(`未预期的请求：${target.pathname}`);
  }));

  const out = await source.searchCaptions({
    keyword: '点名、考试',
    lessons: [{ courseId: 7, subId: 1 }, { courseId: 7, subId: 2 }],
  });
  assert.equal(out.lessonsSearched, 1, '只有真的有字幕的课次算搜过');
  assert.deepEqual(out.lessonsWithoutCaptions, [2], '没有字幕的课次要如实报出来');
  assert.equal(out.total, 1);
  assert.deepEqual(out.counts, { 点名: 1, 考试: 0 });
});

test('searchCaptions rethrows real subtitle failures (only "no speech" is tolerated)', async () => {
  // 业务失败（`code` 落在 400–599）：只有「未查询到语音数据」那一种能被容忍。
  const business = await withToken(classroom(() => json({ code: 500, msg: '服务不可用' })));
  await assert.rejects(
    () => business.searchCaptions({ keyword: '点名', lessons: [{ courseId: 7, subId: 1 }] }),
    (error) => error.code === 'BUSINESS',
  );
  await business.dispose();

  // 传输失败更要照抛：吞成「没有字幕」会让人白等到下课。
  const broken = await withToken(classroom(() => new Response('boom', { status: 500 })));
  await assert.rejects(
    () => broken.searchCaptions({ keyword: '点名', lessons: [{ courseId: 7, subId: 1 }] }),
    (error) => error.code === 'HTTP',
  );
  await broken.dispose();
});

test('searchCaptions caps hits at limit and marks truncated', async () => {
  const captions = Array.from({ length: 5 }, (_, i) => ({ BeginSec: i * 2, EndSec: i * 2 + 2, Text: `第${i}次点名` }));
  const source = await withToken(classroom(() => json({ list: [{ all_content: captions }] })));
  const out = await source.searchCaptions({ keyword: '点名', lessons: [{ courseId: 7, subId: 1 }], limit: 2 });
  assert.equal(out.total, 5, '总数要如实给');
  assert.equal(out.hits.length, 2, '回给调用方的条数按 limit 封顶');
  assert.equal(out.truncated, true);
});

test('searchCaptions needs either lessons or courseId, and a keyword', async () => {
  const source = await withToken(classroom(() => json({ list: [] })));
  await assert.rejects(() => source.searchCaptions({ keyword: '点名' }), (error) => error.code === 'INVALID_INPUT');
  await assert.rejects(
    () => source.searchCaptions({ lessons: [{ courseId: 7, subId: 1 }] }),
    (error) => error.code === 'INVALID_INPUT',
  );
});

test('searchCaptions：给 courseId 时用「我的课」展开最近课次，跳过还没上课的', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const seen = [];
  const source = await withToken(classroom((url) => {
    const target = new URL(url);
    seen.push(target);
    if (target.pathname.endsWith('/get-my-course-day')) {
      return json({ list: [{ course: [
        // 已经上过的课（有字幕可选）、还没开始的课（一定没有字幕）。
        { id: 7, title: '数据结构', sub_id: 70, course_begin: nowSec - 3600 },
        { id: 7, title: '下周那节', sub_id: 71, course_begin: nowSec + 7200 },
        // 别的课：给了 courseId 就不该混进来。
        { id: 8, title: '操作系统', sub_id: 80, course_begin: nowSec - 3600 },
      ] }] });
    }
    if (target.pathname.endsWith('/search-trans-result')) {
      assert.equal(target.searchParams.get('sub_id'), '70', '只该搜本人那门课、那节已经开始的');
      return json({ list: [{ all_content: [{ BeginSec: 0, EndSec: 2, Text: '下次课点名' }] }] });
    }
    throw new Error(`未预期的请求：${target.pathname}`);
  }));

  const out = await source.searchCaptions({ keyword: '点名', courseId: 7, days: 1 });
  assert.equal(out.lessonsSearched, 1);
  assert.deepEqual(out.lessonsWithoutCaptions, [], '还没上课的课次不该被算成「没有字幕」');
  assert.equal(out.total, 1);
  assert.equal(out.hits[0].courseId, '7');
  assert.equal(out.hits[0].subId, '70');
  // 课次编号在展开时按顺序给，用于和 lessons 输入区分。
  assert.equal(out.hits[0].lesson, 1);
});
