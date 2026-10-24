/**
 * 知识树基准台 —— **Node HTTP 服务**（替代原来的 Python 内嵌 HTML）。
 *
 * # 为什么从 Python 换到 Node
 *
 * 原来的做法是 Python 起服务、把整页 HTML 塞进 f-string 里。三个代价：
 *   1. **前端写不动**：几千行 CSS/JS 挤在 Python 字符串里，每次改样式都要
 *      跟 `{{}}` 转义搏斗，模板字符串里的反引号还会被提前截断（踩过好几次）；
 *   2. **调试靠猜**：浏览器报错行号指向生成后的整页，定位不到源文件；
 *   3. **两套语言**：解析是 JS，服务是 Python，同一个数据形状要在两边各写一遍。
 *
 * 现在：Node 起服务，前端是**真正的文件**（`ui/bench.html` / `.css` / `.js`），
 * 浏览器能直接调试、能热改、行号对得上。
 *
 * # 启动即清缓存
 *
 * 基准要测的是"这一次跑成什么样"，缓存命中会让第二次跑**根本不发模型调用**，
 * 于是看不到并发、看不到进度，还会以为代码没生效（这是我实跑踩过的坑）。
 * 所以启动时**默认清空**所有 `.run*` 缓存目录；要保留就显式加 `--keep-cache`。
 *
 * # 用法
 *
 *     node scripts/knowledge_tree_bench/bench.mjs
 *     node scripts/knowledge_tree_bench/bench.mjs --port 8800 --keep-cache
 *     node scripts/knowledge_tree_bench/bench.mjs --no-browser
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prefill } from './defaults.mjs';
import { readLog, fold, artifactOf, artifacts, summarize, PHASES } from './log.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(HERE, 'data');
const UI = path.join(HERE, 'ui');
/** 浏览器与 Node 共用的纯逻辑（demo 要 import `log-core`）。 */
const SHARED = path.join(HERE, 'shared');
/** 每次评测的日志落在这里。一份 `.jsonl` = 一次运行。 */
let LOGS = path.join(DATA, '.logs');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);
if (arg('logs-dir', '')) LOGS = path.resolve(ROOT, arg('logs-dir', ''));

/* ── 缓存清理 ────────────────────────────────────────────────────── */

/**
 * 删掉所有运行缓存（`.run` / `.run-lecture` / `.par-*` / `.rt*` …）。
 *
 * 这些目录都是 `data/` 下的**点目录**，与真数据（`86582-1975288/` 这种）区分得开。
 * 只删点目录是安全的：`data/.gitignore` 是文件不是目录。
 */
async function clearCaches() {
  const entries = await fs.readdir(DATA, { withFileTypes: true }).catch(() => []);
  const removed = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('.')) continue;
    /* ⚠️ `.logs` 是**评测产物**，不是缓存 —— 清掉它就等于把"演示"的原料删了。 */
    if (entry.name === '.logs') continue;
    await fs.rm(path.join(DATA, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

/* ── 数据集 ──────────────────────────────────────────────────────── */

async function listDatasets() {
  const manifestPath = path.join(DATA, 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
  catch { return []; }

  const out = [];
  for (const section of manifest.sections ?? []) {
    const key = section.key;
    if (!key) continue;
    const dir = path.join(DATA, key);
    const files = await fs.readdir(dir).catch(() => []);
    const images = files.filter((f) => /\.jpg$/i.test(f)).length;
    let subtitles = 0;
    try { subtitles = JSON.parse(await fs.readFile(path.join(dir, 'subtitles.json'), 'utf8')).length; }
    catch { subtitles = 0; }
    out.push({
      key, title: section.title ?? '', images, subtitles,
      ok: images > 0 && subtitles > 0,
    });
  }
  return out;
}

/* ── 执行一次评测（子进程 + 事件流）────────────────────────────────── */

/**
 * 跑 `run.mjs`，把它的 `@@EV@@` 事件逐条转发给 `onEvent`。
 *
 * 参数走 **stdin**（含 apiKey），不进 argv —— argv 在本机的进程列表里可见。
 */
async function runBench(payload, onEvent, signal, onLogId) {
  /* 日志文件名：时间戳 + 节次，便于在列表里认出是哪次跑的。 */
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logId = `${stamp}_${String(payload.sectionKey ?? 'run').replace(/[^\w-]/g, '_')}`;
  const logFile = path.join(LOGS, `${logId}.jsonl`);
  await fs.mkdir(LOGS, { recursive: true });
  /* ★ **在开跑之前**就把 logId 交给前端。
   *
   * 早先是 `await runBench(...)` 之后才发 `log` 事件 —— 但那时 `done` 已经
   * 被前端处理完了，于是"跑完显示演示入口"永远不触发（`lastLogId` 还是 null）。
   * 这类错的症状是"看起来一切正常，就是入口不出现"，极难查。
   */
  onLogId?.(logId);

  const args = {
    logFile,
    baseUrl: payload.baseUrl ?? '',
    apiKey: payload.apiKey ?? '',
    model: payload.model ?? '',
    visionModel: payload.visionModel ?? '',
    sectionKey: payload.sectionKey ?? '',
    maxPages: Number(payload.maxPages) || 0,
    splitLine: Number(payload.splitLine) || 1200,
    concurrency: Number(payload.concurrency) || 3,
    skipLecture: Boolean(payload.skipLecture),
  };

  const child = spawn(process.execPath, [path.join(HERE, 'run.mjs')], {
    cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderr = '';
  let buffer = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr += c; });

  const abort = () => { try { child.kill(); } catch { /* 已结束 */ } };
  signal?.addEventListener('abort', abort, { once: true });

  child.stdout.setEncoding('utf8');
  const done = new Promise((resolve) => {
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const text = line.trim();
        if (!text.startsWith('@@EV@@')) continue;
        try { onEvent(JSON.parse(text.slice(6))); }
        catch { /* 半行/坏行，跳过 */ }
      }
    });
    child.on('close', () => {
      if (buffer.trim().startsWith('@@EV@@')) {
        try { onEvent(JSON.parse(buffer.trim().slice(6))); } catch { /* 忽略 */ }
      }
      resolve();
    });
  });

  child.stdin.write(JSON.stringify(args));
  child.stdin.end();
  await done;
  signal?.removeEventListener('abort', abort);

  const code = child.exitCode;
  if (code !== 0 && stderr.trim()) {
    onEvent({ kind: 'error', code: 'RUNNER_FAILED', message: stderr.trim().slice(-1200) });
  }

  /* 把日志 id 交回给调用方 —— 前端拿它进"演示"模式（读这份日志逐帧重放）。 */
  return { logId };
}

/* ── 页面拼装 ────────────────────────────────────────────────────── */

/**
 * 拼出评测页：`ui/bench.html` + 注入默认值与 token。
 *
 * 早先这里还要把演示页的 body（65 个 id 的舞台）拼进来，因为那时"评测页"
 * 就是演示页本身。现在两者分开了：
 *   · 评测页只跑、只显示进展（`ui/bench.html`）；
 *   · 演示页读日志重放（`ui/demo/demo.html`）。
 * 所以这里只剩两处替换。
 */
async function buildPage({ token, datasets }) {
  const tpl = await fs.readFile(path.join(UI, 'bench.html'), 'utf8');
  /* `</` 必须转义：JSON 里出现 `</script>` 会提前结束脚本块。 */
  const json = (v) => JSON.stringify(v).replace(/<\//g, '<\\/');
  return tpl
    .replace('/*__DEFAULTS__*/{}', json(prefill()))
    .replace("window.__BENCH_TOKEN__ = '/*__TOKEN__*/';",
      `window.__BENCH_TOKEN__ = ${JSON.stringify(token)};`
      + `\nwindow.__BENCH_DATASETS__ = ${json(datasets)};`);
}

/* ── HTTP ────────────────────────────────────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-store' });
  res.end(body);
}

async function main() {
  const port = Number(arg('port', '0')) || 0;
  const keepCache = has('keep-cache');
  const openBrowser = !has('no-browser');

  if (!keepCache) {
    const removed = await clearCaches();
    if (removed.length) console.log(`  已清缓存：${removed.join(', ')}`);
  }

  const datasets = await listDatasets();
  const ready = datasets.filter((d) => d.ok);
  const token = randomBytes(24).toString('hex');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`);

    // 只认回环，防 DNS rebinding
    const host = (req.headers.host ?? '').split(':')[0].trim().toLowerCase();
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) {
      return sendJson(res, 403, { ok: false, error: '只接受本机访问' });
    }

    // 静态文件
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      if (url.searchParams.get('t') !== token) {
        return sendText(res, 403, '需要带 token 的链接（启动时打印的那个）');
      }
      const page = await buildPage({ token, datasets });
      return sendText(res, 200, page, MIME['.html']);
    }

    /* 静态文件：`/ui/*` → `ui/`，`/shared/*` → `shared/`（demo 要 import core）。
     *
     * ⚠️ 用 `path.normalize` + 前缀校验挡掉 `../` 穿越；只认这两个目录。 */
    if (req.method === 'GET' && (url.pathname.startsWith('/ui/') || url.pathname.startsWith('/shared/'))) {
      const roots = { '/ui/': UI, '/shared/': SHARED };
      const prefix = url.pathname.startsWith('/ui/') ? '/ui/' : '/shared/';
      const rel = decodeURIComponent(url.pathname.slice(prefix.length));
      const root = roots[prefix];
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root + path.sep) && file !== root) {
        return sendText(res, 403, 'forbidden');
      }
      const text = await fs.readFile(file, 'utf8').catch(() => null);
      if (text === null) return sendText(res, 404, 'not found');
      return sendText(res, 200, text, MIME[path.extname(file)] ?? 'text/plain; charset=utf-8');
    }

    /* 演示页：读一份日志逐帧重放。 */
    if (req.method === 'GET' && url.pathname === '/demo') {
      const html = await fs.readFile(path.join(UI, 'demo', 'demo.html'), 'utf8').catch(() => null);
      if (html === null) return sendText(res, 404, 'demo.html 不在');
      return sendText(res, 200, html, MIME['.html']);
    }

    // 演示引擎（从 docs/show 抽出的三个文件）
    /* ── 日志接口 ──────────────────────────────────────────────
     *
     * 这三个是"演示"的数据来源：跑评测时只落日志，动画读日志重放。
     * 同一份日志既放动画、又追查产物 —— 不会出现"动画说 30、日志说 29"。
     */

    /* 列出所有运行（时间倒序）。只给概览，不读全量事件。 */
    if (req.method === 'GET' && url.pathname === '/api/logs') {
      const files = await fs.readdir(LOGS).catch(() => []);
      const runs = [];
      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue;
        const id = name.replace(/\.jsonl$/, '');
        const { records } = await readLog(path.join(LOGS, name));
        if (!records.length) continue;
        runs.push({ id, ...summarize(records) });
      }
      runs.sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')));
      return sendJson(res, 200, { ok: true, runs });
    }

    /* 读一份日志的全部记录。 */
    if (req.method === 'GET' && url.pathname === '/api/log') {
      const id = url.searchParams.get('id') ?? '';
      // 只认安全文件名：id 来自 URL，直接拼路径会被 ../ 穿越出去。
      if (!/^[\w.-]{1,120}$/.test(id)) return sendJson(res, 400, { ok: false, error: 'id 不合法' });
      const { records, broken, missing } = await readLog(path.join(LOGS, id + '.jsonl'));
      if (missing) return sendJson(res, 404, { ok: false, error: '没有这份日志' });

      /* ★ 日志**完整性**要一起交出来（审查第 30 条）。
       *
       * 用户会把"能读到的部分"当成"完整回放"。所以这里明确给出：
       *   · `broken`       —— 读不懂的行数（写盘中断/手工改过）
       *   · `writeFailures`—— 写入时失败过几次
       *   · `hasEnd`       —— 有没有 end 元信息（没有 = 没跑完或崩了）
       *   · `endedWithError` —— 是不是以异常结束
       */
      const end = records.find((r) => r.kind === 'meta' && r.what === 'end');
      const errorMeta = records.find((r) => r.kind === 'meta' && r.what === 'error');
      return sendJson(res, 200, {
        ok: true, id, broken, records,
        integrity: {
          broken,
          writeFailures: end?.writeFailures ?? 0,
          writeError: end?.writeError ?? null,
          hasEnd: Boolean(end),
          endedWithError: Boolean(errorMeta),
          errorMessage: errorMeta?.message ?? null,
          events: records.filter((r) => r.kind === 'event').length,
        },
      });
    }

    /* 某一阶段的产物快照 —— "点节点探针"用的就是它。 */
    /* 原图：验收识别质量时要能对照原图（审查第 15 条）。
     *
     * 图片不进日志（会撑爆），另存在 `.media/<id>/p<页>.jpg`。
     * 这里按需读出；`id` 与 `page` 都走白名单校验。 */
    if (req.method === 'GET' && url.pathname === '/api/media') {
      const id = url.searchParams.get('id') ?? '';
      const page = url.searchParams.get('page') ?? '';
      if (!/^[\w.-]{1,120}$/.test(id) || !/^\d{1,5}$/.test(page)) {
        return sendJson(res, 400, { ok: false, error: 'id 或 page 不合法' });
      }
      const file = path.join(LOGS, '.media', id, `p${page}.jpg`);
      const bytes = await fs.readFile(file).catch(() => null);
      if (!bytes) return sendJson(res, 404, { ok: false, error: '这一页没有存原图' });
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': bytes.length,
        'cache-control': 'private, max-age=3600',
      });
      return res.end(bytes);
    }

    if (req.method === 'GET' && url.pathname === '/api/artifact') {
      const id = url.searchParams.get('id') ?? '';
      const phase = url.searchParams.get('phase') ?? '';
      if (!/^[\w.-]{1,120}$/.test(id)) return sendJson(res, 400, { ok: false, error: 'id 不合法' });
      const { records, missing } = await readLog(path.join(LOGS, id + '.jsonl'));
      if (missing) return sendJson(res, 404, { ok: false, error: '没有这份日志' });

      const state = fold(records);
      if (phase === 'all') return sendJson(res, 200, { ok: true, artifacts: artifacts(state) });
      const artifact = artifactOf(state, phase);
      if (artifact === null) return sendJson(res, 404, { ok: false, error: '没有这个阶段：' + phase });
      return sendJson(res, 200, { ok: true, phase, artifact });
    }
    if (req.method === 'GET' && url.pathname === '/api/datasets') {
      return sendJson(res, 200, { ok: true, sections: await listDatasets() });
    }

    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      res.writeHead(204); return res.end();
    }

    // 跑一次评测（SSE）
    if (req.method === 'POST' && url.pathname === '/api/run') {
      if (url.searchParams.get('t') !== token) {
        return sendJson(res, 403, { ok: false, error: 'token 不对' });
      }
      let body = '';
      for await (const chunk of req) body += chunk;
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch { return sendJson(res, 400, { ok: false, error: '请求体不是 JSON' }); }

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'close',
      });
      const write = (event) => {
        try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* 客户端断了 */ }
      };

      const controller = new AbortController();
      /* ⚠️ 监听 **res** 的 close，不是 req 的。
       *
       * Node 里 `req.on('close')` 在**请求体读完**时就会触发（不是因为连接断了）。
       * 用它会立刻 abort，把子进程杀掉 —— 症状是"事件只来了一部分就完成"，
       * 而且看日志像跑成功了（因为子进程被 SIGTERM 之后 stderr 是空的）。
       * `res.on('close')` 才是"客户端真的断开"。
       */
      res.on('close', () => controller.abort());

      try {
        await runBench(payload, write, controller.signal, (logId) => write({ kind: 'log', id: logId }));
      } catch (error) {
        write({ kind: 'error', code: 'SERVER', message: String(error?.message ?? error).slice(0, 600) });
      } finally {
        write({ kind: 'eof' });
        res.end();
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = server.address().port;
  const link = `http://127.0.0.1:${actual}/?t=${token}`;

  console.log('');
  console.log('  知识树基准台  ·  真实课程离线测评');
  console.log('  ' + '─'.repeat(58));
  if (!ready.length) {
    console.log('  data/ 里没有可用数据集');
    console.log('  先拉一次原稿：node scripts/knowledge_tree_bench/fetch-raw.mjs');
  } else {
    console.log(`  数据集 ${ready.length} 节：`);
    for (const d of ready) {
      console.log(`    ${d.key.padEnd(18)} ${String(d.images).padStart(3)} 图 · ${String(d.subtitles).padStart(5)} 句   ${(d.title ?? '').slice(0, 30)}`);
    }
  }
  console.log('  ' + '─'.repeat(58));
  console.log('  打开这个地址（带一次性 token）：');
  console.log(`    ${link}`);
  console.log('');
  console.log('  · 凭证只在内存里，不落盘、不进日志');
  if (!keepCache) console.log('  · 启动时已清空缓存（要保留加 --keep-cache）');
  console.log('  · Ctrl+C 结束');
  console.log('');

  if (openBrowser) {
    const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const argv = process.platform === 'win32' ? ['/c', 'start', '', link] : [link];
    spawn(cmd, argv, { stdio: 'ignore', detached: true }).unref();
  }

  const shutdown = () => { server.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(String(error?.stack ?? error));
  process.exitCode = 1;
});
