// dsh-zhiyun-core-classroom-media 的装配与契约测试。
//
// 刻意覆盖四类断言（对应交付要求的三条 + 一条回归）：
//   1. `apply()` 永不抛（含：没有 studio、provide 会抛、上游全缺）；
//   2. `tts()` 在 provider 未配置时**返回**带 `code` 的领域错误，而不是抛未捕获异常；
//   3. `search()` / `fetchPage()` 用注入的假 fetch，断言请求 URL 与解析结果；
//   4. `parsePdf()` 缺可选依赖时也是同一形状的领域错误。
//
// 跑法：`node --test tests/classroom-media.test.mjs`
//
// 刻意**不**覆盖：真实 TTS/检索/PDF 云服务 —— 那要凭证，属于人工验证。

import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const PACKAGE_DIR = new URL('../packages/dsh-zhiyun-core-classroom-media/', import.meta.url);
const INDEX_URL = pathToFileURL(join(PACKAGE_DIR.pathname, 'src', 'index.js')).href;
const REPO_ROOT = new URL('..', import.meta.url).pathname;
const plugin = await import(INDEX_URL);

// ── 测试装置 ────────────────────────────────────────────────────────────────

/** 最小 Cordis 假 ctx：`provide` / `get` / `on` / `logger` 四个面。 */
function makeCtx({ services = {}, provideThrows = false } = {}) {
  const provided = new Map(Object.entries(services));
  const disposers = [];
  const logs = [];
  const ctx = {
    logger: {
      debug: (...args) => logs.push(['debug', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    get: (name) => provided.get(name),
    provide: (name, value) => {
      if (provideThrows) throw new Error(`service ${name} already registered`);
      provided.set(name, value);
      return () => provided.delete(name);
    },
    on: (event, handler) => {
      if (event === 'dispose') disposers.push(handler);
    },
  };
  return { ctx, provided, disposers, logs };
}

/** 假 fetch：记录每次调用，按 `handler(url, init)` 返回 Response。 */
function makeFetch(handler) {
  const calls = [];
  const impl = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    const result = await handler(url, init);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result.body ?? {}), {
      status: result.status ?? 200,
      headers: { 'content-type': result.contentType ?? 'application/json' },
    });
  };
  impl.calls = calls;
  return impl;
}

/** 装配一个带 studio 的服务实例。 */
async function mount({ providers = {}, fetch: fetchImpl } = {}) {
  const studio = {
    providers: {
      list: async () => ({ httpStatus: 200, body: {} }),
      set: async () => ({ httpStatus: 200, body: {} }),
    },
  };
  const { ctx, provided, disposers } = makeCtx({ services: { zhiyunClassroomStudio: studio } });
  const dispose = plugin.apply(ctx, { providers, fetch: fetchImpl });
  const media = provided.get('zhiyunClassroomMedia');
  assert.ok(media, 'apply() 之后应能从容器里取到 zhiyunClassroomMedia');
  return { media, ctx, dispose, disposers, provided };
}

// ── 1. apply 不抛 ───────────────────────────────────────────────────────────

test('apply() 在没有任何上游服务时不抛，并照常 provide', () => {
  const { ctx, provided } = makeCtx();
  assert.doesNotThrow(() => plugin.apply(ctx, {}));
  const media = provided.get('zhiyunClassroomMedia');
  assert.equal(typeof media.tts, 'function');
  assert.equal(typeof media.asr, 'function');
  assert.equal(typeof media.image, 'function');
  assert.equal(typeof media.search, 'function');
  assert.equal(typeof media.fetchPage, 'function');
  assert.equal(typeof media.parsePdf, 'function');
});

test('apply() 在 provide 抛错时也不抛（降级为"能力不可用"）', () => {
  const { ctx } = makeCtx({ provideThrows: true });
  assert.doesNotThrow(() => plugin.apply(ctx, {}));
});

test('status() 永不抛，且缺 studio 时 state=degraded', async () => {
  const { ctx, provided } = makeCtx();
  plugin.apply(ctx, {});
  const status = await provided.get('zhiyunClassroomMedia').status();
  assert.equal(status.state, 'degraded');
  assert.equal(status.detail.studio, 'missing');
  assert.equal(status.version, plugin.PACKAGE_VERSION);
});

// ── 2. 未配置 provider → 领域错误（返回值，不是未捕获异常）──────────────────

test('tts() 在 provider 未配置时返回带 code 的领域错误', async () => {
  const { media } = await mount();
  const result = await media.tts('同学们好', 'zh-CN-XiaoxiaoNeural');

  assert.equal(result.ok, false);
  assert.equal(typeof result.code, 'string');
  assert.equal(result.code, 'E_NOT_CONFIGURED');
  assert.equal(result.detail.capability, 'tts');
});

test('tts() 在文本为空时返回 E_INVALID_INPUT', async () => {
  const { media } = await mount();
  const result = await media.tts('   ');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'E_INVALID_INPUT');
});

test('tts() 在显式 provider 不存在时返回 E_UNSUPPORTED_PROVIDER', async () => {
  const { media } = await mount({ providers: { tts: { 'openai-tts': { apiKey: 'sk-test' } } } });
  const result = await media.tts('hi', { providerId: 'nope-tts' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'E_UNSUPPORTED_PROVIDER');
});

test('tts() 配好 OpenAI key 后打的是 /audio/speech，并把 Buffer 返回', async () => {
  const fakeAudio = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  const fetchImpl = makeFetch((url) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/speech');
    return { body: null, status: 200, contentType: 'audio/mpeg' };
  });
  // Response(body=null) 拿不到 audioBuffer，所以这里直接造一个二进制 Response。
  const impl = async (input, init) => {
    fetchImpl.calls.push({ url: input, init });
    return new Response(fakeAudio, { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  };
  impl.calls = fetchImpl.calls;

  const { media } = await mount({
    providers: { tts: { 'openai-tts': { apiKey: 'sk-test', model: 'gpt-4o-mini-tts', voice: 'alloy' } } },
    fetch: impl,
  });
  const result = await media.tts('同学们好');

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.format, 'mp3');
  assert.ok(Buffer.isBuffer(result.bytes));
  assert.equal(result.bytes.length, fakeAudio.length);
  assert.equal(impl.calls[0].url, 'https://api.openai.com/v1/audio/speech');
  const sent = JSON.parse(impl.calls[0].init.body);
  assert.equal(sent.input, '同学们好');
  assert.equal(sent.model, 'gpt-4o-mini-tts');
  assert.equal(impl.calls[0].init.redirect, 'manual');
});

// ── 3. search() / fetchPage()：URL 与解析结果 ───────────────────────────────

test('search() 用注入的假 fetch：断言 URL、请求体与解析结果', async () => {
  const fetchImpl = makeFetch((url) => {
    assert.equal(url, 'https://api.tavily.com/search');
    return {
      body: {
        answer: '光合作用把光能转成化学能。',
        query: '光合作用',
        response_time: 0.42,
        results: [
          { title: '光合作用 - 维基百科', url: 'https://zh.wikipedia.org/wiki/光合作用', content: '光合作用是指…', score: 0.97 },
          { title: '光合作用的意义', url: 'https://example.edu/photo', content: '植物…', score: 0.81 },
        ],
      },
    };
  });
  const { media } = await mount({
    providers: { search: { tavily: { apiKey: 'tvly-test' } } },
    fetch: fetchImpl,
  });

  const result = await media.search('光合作用', { maxResults: 2 });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.provider, 'tavily');
  assert.equal(result.answer, '光合作用把光能转成化学能。');
  assert.equal(result.sources.length, 2);
  assert.equal(result.sources[0].url, 'https://zh.wikipedia.org/wiki/光合作用');
  assert.equal(result.sources[1].score, 0.81);

  // 请求体也要对：query 透传、max_results 生效。
  const body = JSON.parse(fetchImpl.calls[0].init.body);
  assert.equal(body.query, '光合作用');
  assert.equal(body.max_results, 2);
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer tvly-test');
});

test('search() 在上游 401 时返回 E_UPSTREAM_ERROR 且 retryable=false', async () => {
  const fetchImpl = makeFetch(() => ({ body: { error: 'invalid key' }, status: 401 }));
  const { media } = await mount({
    providers: { search: { tavily: { apiKey: 'bad' } } },
    fetch: fetchImpl,
  });
  const result = await media.search('x');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'E_UPSTREAM_ERROR');
  assert.equal(result.detail.retryable, false);
});

test('fetchPage() 用内置读取器：断言 URL、标题与 Markdown 抽取', async () => {
  const html = `<!doctype html><html><head><title>课堂讲义 · 第一章</title>
    <style>.x{color:red}</style><script>window.__x=1</script></head>
    <body><nav>导航不该出现</nav><article>
      <h1>第一章 光合作用</h1>
      <p>光合作用是<strong>植物</strong>把光能转成化学能的过程。</p>
      <ul><li>光反应</li><li>暗反应</li></ul>
      <p><a href="https://example.edu/a">延伸阅读</a></p>
      <pre>6CO2 + 6H2O</pre>
      <p>${'补充说明。'.repeat(60)}</p>
    </article></body></html>`;

  const fetchImpl = makeFetch((url) => {
    assert.equal(url, 'https://example.edu/lesson/1');
    return { body: null, status: 200, contentType: 'text/html' };
  });
  const impl = async (input, init) => {
    fetchImpl.calls.push({ url: input, init });
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  impl.calls = fetchImpl.calls;

  const { media } = await mount({ fetch: impl });
  const result = await media.fetchPage('https://example.edu/lesson/1', { minChars: 10 });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.provider, 'builtin');
  assert.equal(result.title, '课堂讲义 · 第一章');
  assert.equal(result.contentType, 'text/html');
  assert.match(result.markdown, /^# 第一章 光合作用/m);
  assert.match(result.markdown, /- 光反应/);
  assert.match(result.markdown, /\[延伸阅读\]\(https:\/\/example\.edu\/a\)/);
  assert.match(result.markdown, /```\n6CO2 \+ 6H2O\n```/);
  // 脚本/样式/导航都不该进正文（这是自研抽取器与 Readability 的差别之处）。
  assert.doesNotMatch(result.markdown, /window\.__x/);
  assert.doesNotMatch(result.markdown, /color:red/);
  assert.doesNotMatch(result.markdown, /导航不该出现/);
  assert.equal(impl.calls[0].init.redirect, 'manual');
});

test('fetchPage() 遇到不支持的内容类型时返回错误而不是空正文', async () => {
  const impl = async () => new Response('binary', { status: 200, headers: { 'content-type': 'image/png' } });
  const { media } = await mount({ fetch: impl });
  const result = await media.fetchPage('https://example.edu/x.png');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'E_UPSTREAM_ERROR');
  assert.equal(result.detail.reason, 'unsupported_content_type');
});

// ── 4. PDF：本地解析与缺依赖时的形状 ────────────────────────────────────────
//
// 本仓已把 `unpdf` 装进 media 包（`packages/dsh-zhiyun-core-classroom-media/node_modules`），
// 所以「装了能解析」是要断言的主路径；「没装要明说」用隔离目录验证 ——
// ESM 的 bare specifier 按**模块自身位置**解析，把 src 复制到没有 node_modules 的
// 临时目录再导入，才能真的制造出「依赖不在」的状态（而不是假装它不在）。

test('parsePdf() 用 unpdf 解析真实 PDF（本地、无网络）', async () => {
  const { media } = await mount();
  const buffer = await readFile(join(REPO_ROOT, 'fixtures', 'classroom-material', 'lecture-fourier.pdf'));
  const result = await media.parsePdf(buffer, { fileName: 'lecture-fourier.pdf', textOnly: true });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'unpdf');
  assert.match(result.text, /Fourier Transform/);
  assert.match(result.text, /Convolution in time equals multiplication in frequency/);
  // textOnly：不转图（转图要 sharp，本仓没装，也不该因缺 sharp 让解析失败）
  assert.deepEqual(result.images, []);
});

test('parsePdf() 在没有 unpdf 的环境里返回 E_DEPENDENCY_MISSING', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'zyc-media-nodeps-'));
  try {
    await cp(join(PACKAGE_DIR.pathname, 'src'), join(dir, 'src'), { recursive: true });
    const isolated = await import(pathToFileURL(join(dir, 'src', 'pdf', 'parse.js')).href);
    const result = await isolated.parsePDF(
      {},
      { providerId: 'unpdf', textOnly: true },
      Buffer.from('%PDF-1.4\n%%EOF\n'),
      { fileName: 'x.pdf' },
    );
    assert.fail(`应当抛 E_DEPENDENCY_MISSING，实际返回 ${JSON.stringify(result).slice(0, 120)}`);
  } catch (error) {
    assert.equal(error.code, 'E_DEPENDENCY_MISSING');
    assert.equal(error.detail?.dependency, 'unpdf');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parsePdf() 拒绝空 buffer', async () => {
  const { media } = await mount();
  const result = await media.parsePdf(Buffer.alloc(0));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'E_INVALID_INPUT');
});

// ── 5. 时间轴 ───────────────────────────────────────────────────────────────

test('timeline() 按 WAV 头排时间轴，并对非 WAV 片段保留"时长未知"', async () => {
  // 24 kHz / mono / 16-bit：1 秒 = 48000 字节 PCM。
  const { pcmS16leMonoToWav } = await import(
    pathToFileURL(join(PACKAGE_DIR.pathname, 'src', 'audio', 'wav.js')).href
  );
  const oneSecond = Buffer.from(pcmS16leMonoToWav(Buffer.alloc(48_000), 24_000));
  const { media } = await mount();

  const result = media.timeline([
    { bytes: oneSecond, text: '第一句' },
    { bytes: oneSecond, text: '第二句' },
    { text: '没有音频' },
  ]);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.timeline.segments.length, 3);
  assert.equal(result.timeline.segments[0].durationMs, 1000);
  assert.equal(result.timeline.segments[1].startMs, 1000);
  assert.equal(result.timeline.segments[2].durationKnown, false);
  assert.equal(result.timeline.totalMs, 2000);
  // 有一段的字节缺失（"没有音频"），所以不产出单文件音轨 —— 这正是上游"不拼字节"的约定。
  assert.equal(result.track, null);
  assert.match(result.trackNote, /非 WAV/);

  const onlyWav = media.timeline([
    { bytes: oneSecond, text: '第一句' },
    { bytes: oneSecond, text: '第二句' },
  ]);
  assert.equal(onlyWav.ok, true);
  assert.ok(onlyWav.track, '全 WAV 时应产出单文件音轨');
  assert.equal(onlyWav.track.format, 'wav');
  // 两段 1 秒拼起来仍是 2 秒。
  assert.equal(onlyWav.track.durationSeconds, 2);
});

test('providers() 列出全部 TTS 分支（证明没有只留一个）', async () => {
  const { media } = await mount({ providers: { tts: { 'openai-tts': { apiKey: 'sk' } } } });
  const result = await media.providers('tts');
  assert.equal(result.ok, true);
  const ids = result.providers.map((entry) => entry.id);
  for (const id of [
    'openai-tts',
    'azure-tts',
    'glm-tts',
    'qwen-tts',
    'voxcpm-tts',
    'doubao-tts',
    'elevenlabs-tts',
    'minimax-tts',
    'google-tts',
    'lemonade-tts',
    'browser-native-tts',
  ]) {
    assert.ok(ids.includes(id), `缺少 provider 分支：${id}`);
  }
  const configured = result.providers.filter((entry) => entry.configured).map((entry) => entry.id);
  assert.deepEqual(configured, ['openai-tts']);
});
