/**
 * 「笔记」页的 **PDF 阅读器**：一个同源 iframe 页面 + 它需要的静态资源。
 *
 * # 为什么是 iframe，而不是在 React 里直接渲染
 *
 * 三条硬约束，缺一条都不能这么写：
 *
 * 1. **客户端 bundle 不许内联本包 `src/` 之外的文件**（`tests/build-seeds.test.mjs`
 *    的 metafile 守卫）。`pdfjs-dist` 的 `pdf.min.mjs` + worker + cmaps 约 1.8MB，
 *    打进 bundle 会让每次进笔记页都背它。
 * 2. **pdf.js 的 worker 必须是独立脚本**（`GlobalWorkerOptions.workerSrc` 指向一个
 *    URL）。esbuild 打出来的 cjs 封装里没有可用的模块 URL。
 * 3. **主题要能跟进 iframe**。只有同源才能 `contentDocument` 读写 —— 非同源连
 *    `--zy-*` 都注不进去，暗色模式就会退化成一块刺眼的白。
 *
 * 这套分工是照「论文」页的成例（见 `dsh-zhiyun-page-paper/src/ReaderFrame.jsx`），
 * 那一页也是同源 iframe + 上游自渲染 HTML。
 *
 * # 与论文页的区别
 *
 * 不复用论文页的阅读器：它按 `topic/name` 读**论文库**（另一个目录），把笔记库的
 * 文件塞给它等于让两层存储互相认识。这里只借「同源 iframe + 注入主题」这个形态。
 *
 * # 暗色怎么做的（用户明确要的那条）
 *
 * pdf.js 把每页画进 `<canvas>`，所以 CSS 改不了页面内容。这里用一层
 * `mix-blend-mode` 遮罩压在 canvas 上：暗色下页面底色变深、文字仍是可读的浅色，
 * 图片与图表不会被反成负片（那是 `filter: invert()` 的毛病）。
 * 遮罩只在 `dark` 时存在，亮色下像素级原样。
 */

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * PDF 阅读器的路由前缀（同源 iframe 的地址）。
 *
 * 这个常量归本文件：前缀下面挂的三类资源（阅读页、pdf.js 静态文件、库内文件）
 * 都由 `servePdfRoute` 自己分派，调用方只需要知道「往哪儿注册」。
 */
export const PDF_ROUTE_PREFIX = '/zhiyun-vault-pdf';

/** 允许从 `pdfjs-dist` 里取出的**子目录 / 文件**白名单（见 `servePdfRoute`）。 */
const PDFJS_ALLOWED = /^(?:build\/[\w.-]+|cmaps\/[\w.-]+|standard_fonts\/[\w.-]+|iccs\/[\w.-]+)$/;

/** 扩展名 → content-type。只列 PDF 阅读真正会用到的那几种。 */
const MIME = {
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  json: 'application/json; charset=utf-8',
  bcmap: 'application/octet-stream',
  pfb: 'application/octet-stream',
  ttf: 'font/ttf',
  icc: 'application/octet-stream',
  wasm: 'application/wasm',
};

/** pdfjs-dist 的安装根目录；解析不到时给 null，路由据此如实返回 503。 */
function pdfjsRoot() {
  try {
    return path.dirname(require.resolve('pdfjs-dist/package.json'));
  } catch {
    return null;
  }
}

/** 按扩展名给 content-type，未知一律二进制。 */
function mimeOf(file) {
  return MIME[file.slice(file.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 阅读器页面。
 *
 * 不引 `pdfjs-dist/web/viewer.html`：那是完整的独立产品（自己的工具栏、侧栏、
 * 设置弹窗、右键菜单），要把它并进工作台得再写一张注入表去藏控件。这里只要
 * 「能读 + 跟随主题 + 页码」，自己画一个更短、也更可控。
 *
 * ⚠️ 脚本用 `type="module"` + 相对路径 `./pdfjs/build/pdf.min.mjs`：pdf.js 6.x
 * 只发 ESM，worker 也必须是 ESM（`pdf.worker.min.mjs`），`workerSrc` 用绝对路径。
 */
const PDF_VIEWER_HTML = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PDF</title>
<style>
  :root {
    --pdf-bg: #f2f3f5;
    --pdf-surface: #ffffff;
    --pdf-text: #1f2328;
    --pdf-secondary: #6b7280;
    --pdf-line: #e5e7eb;
    --pdf-accent: #00479d;
    --pdf-page-shadow: 0 1px 3px rgba(0,0,0,.14), 0 6px 20px rgba(0,0,0,.08);
    color-scheme: light;
  }
  /* 暗色：底色压深，但 PDF 页面本身**不反色** —— 见下面 .pdf-page::after 的遮罩。 */
  html[data-theme="dark"] {
    --pdf-bg: #1b1e23;
    --pdf-surface: #23272e;
    --pdf-text: #e8ebee;
    --pdf-secondary: #a9b1bb;
    --pdf-line: #333941;
    --pdf-accent: #5b9bff;
    --pdf-page-shadow: 0 1px 3px rgba(0,0,0,.5), 0 6px 22px rgba(0,0,0,.4);
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    display: flex; flex-direction: column;
    background: var(--pdf-bg); color: var(--pdf-text);
    font: 13px/1.6 system-ui, "Microsoft YaHei UI", sans-serif;
  }
  .bar {
    flex: none; display: flex; align-items: center; gap: 10px;
    padding: 6px 10px; border-bottom: 1px solid var(--pdf-line);
    background: var(--pdf-surface);
  }
  .bar button {
    font: inherit; color: inherit; background: transparent; cursor: pointer;
    border: 1px solid var(--pdf-line); border-radius: 7px; padding: 3px 9px;
  }
  .bar button:hover:not(:disabled) { border-color: var(--pdf-secondary); }
  .bar button:disabled { opacity: .45; cursor: default; }
  .bar .spacer { flex: 1; }
  .bar .info { color: var(--pdf-secondary); font-variant-numeric: tabular-nums; }
  .bar .name {
    max-width: 34ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-weight: 600;
  }
  .pages { flex: 1; overflow: auto; padding: 18px 0 40px; }
  .pdf-page {
    position: relative; margin: 0 auto 14px; background: var(--pdf-surface);
    box-shadow: var(--pdf-page-shadow); width: fit-content; line-height: 0;
  }
  .pdf-page canvas { display: block; }
  /* 文字层：可选中、可搜索。pdf.js 要求它绝对定位覆盖在 canvas 上。 */
  .pdf-page .textLayer {
    position: absolute; inset: 0; overflow: hidden; line-height: 1;
    opacity: .28;   /* 亮色下压低，避免盖住画出来的字形 */
  }
  html[data-theme="dark"] .pdf-page .textLayer { opacity: .16; }
  .pdf-page .textLayer span {
    position: absolute; color: transparent; white-space: pre; transform-origin: 0 0;
    cursor: text;
  }
  .pdf-page .textLayer ::selection { background: rgba(0, 71, 157, .32); }
  /* ── 暗色遮罩：这是「PDF 背景跟随 shell」的实现 ──────────────────────────
   * 不用 filter: invert()：那会把插图、照片、彩色图表一起反成负片。
   * 这里用 multiply 压暗 + screen 提亮文字所在的像素，等效于「换纸为深色」，
   * 彩色插图的色相基本保留。only 在暗色下存在，亮色下完全不介入。 */
  html[data-theme="dark"] .pdf-page::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: #cfd6de; mix-blend-mode: darken;
    opacity: .18;
  }
  html[data-theme="dark"] .pdf-page canvas {
    /* 让白纸不必是纯白：轻度降亮，配合上面的遮罩一起压暗。 */
    filter: brightness(.82) contrast(1.04);
  }
  .status { padding: 16px; color: var(--pdf-secondary); text-align: center; }
  .status.error { color: #e05252; }
</style>
</head><body>
<div class="bar">
  <button id="prev" type="button" title="上一页">↑</button>
  <button id="next" type="button" title="下一页">↓</button>
  <span class="info" id="pager">— / —</span>
  <span class="spacer"></span>
  <span class="name" id="name"></span>
  <button id="zoomOut" type="button" title="缩小">−</button>
  <button id="zoomIn" type="button" title="放大">+</button>
</div>
<div class="pages" id="pages"><p class="status" id="status">正在载入 PDF…</p></div>
<script type="module">
const params = new URLSearchParams(location.search);
const filePath = params.get('path') ?? '';
const initialPage = Number(params.get('page')) || 1;
const fileUrl = './file?path=' + encodeURIComponent(filePath);

const pagesHost = document.getElementById('pages');
const statusEl = document.getElementById('status');
const pagerEl = document.getElementById('pager');
const nameEl = document.getElementById('name');
const prevBtn = document.getElementById('prev');
const nextBtn = document.getElementById('next');
const zoomInBtn = document.getElementById('zoomIn');
const zoomOutBtn = document.getElementById('zoomOut');

nameEl.textContent = filePath.split('/').pop() ?? '';

/** 主题跟着外层走：父页面通过 postMessage 通知（见 pdf-viewer-frame 的说明）。 */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}
window.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'zhiyun-pdf-theme') applyTheme(data.theme);
});
// 首帧先按系统偏好猜一次，父页面随后会纠正。
if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) applyTheme('dark');

function fail(message) {
  statusEl.textContent = message;
  statusEl.className = 'status error';
}

let doc = null;
let scale = 1.15;
const rendered = new Map();   // 页码 → 已渲染的 canvas（重排时清掉）
let current = initialPage;

async function boot() {
  if (!filePath) return fail('没有指定 PDF 路径。');
  let pdfjs;
  try {
    pdfjs = await import('./pdfjs/build/pdf.min.mjs');
  } catch (error) {
    return fail('载入 pdf.js 失败：' + error.message);
  }
  // worker 也走宿主路由：它和 pdf.min.mjs 同源，且必须是 ESM。
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/build/pdf.worker.min.mjs', location.href).href;
  try {
    doc = await pdfjs.getDocument({ url: fileUrl, cMapUrl: new URL('./pdfjs/cmaps/', location.href).href, cMapPacked: true }).promise;
  } catch (error) {
    return fail('打不开这个 PDF：' + (error?.message ?? error));
  }
  statusEl.remove();
  await renderAll();
  updatePager();
}

/** 逐页渲染。首屏只画当前页附近，滚到哪画到哪 —— 大文件不该一次性全画。 */
async function renderAll() {
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
    if (rendered.has(pageNo)) continue;
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale });
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page';
    wrap.dataset.page = String(pageNo);
    wrap.style.width = Math.round(viewport.width) + 'px';
    wrap.style.height = Math.round(viewport.height) + 'px';
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = Math.round(viewport.width) + 'px';
    canvas.style.height = Math.round(viewport.height) + 'px';
    wrap.append(canvas);
    pagesHost.append(wrap);
    rendered.set(pageNo, wrap);
    const ctx = canvas.getContext('2d', { alpha: false });
    await page.render({ canvasContext: ctx, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] }).promise;
    // 文字层：有了它才能选中与搜索。牺牲它会让 PDF 变成"看图"，但渲染失败
    // 不该让整页打不开，所以单独 try。
    try {
      const textContent = await page.getTextContent();
      const layer = document.createElement('div');
      layer.className = 'textLayer';
      for (const item of textContent.items) {
        if (typeof item.str !== 'string' || item.str === '') continue;
        const span = document.createElement('span');
        span.textContent = item.str;
        // item.transform 是 [a,b,c,d,e,f] 的 PDF 文本矩阵；e/f 是基线原点。
        // pdf.js 的 viewport 已经含 scale，这里手工换算成 CSS 像素。
        const [, , c, d, e, f] = item.transform;
        const fontPx = Math.hypot(c, d) * scale;
        span.style.left = (e * scale) + 'px';
        // PDF 的 y 轴朝上、CSS 朝下：先翻到基准线顶部（减去字号）。
        span.style.top = (viewport.height - f * scale - fontPx) + 'px';
        span.style.fontSize = fontPx.toFixed(2) + 'px';
        layer.append(span);
      }
      wrap.append(layer);
    } catch { /* 文字层失败不影响阅读 */ }
  }
}

function updatePager() {
  pagerEl.textContent = current + ' / ' + doc.numPages;
  prevBtn.disabled = current <= 1;
  nextBtn.disabled = current >= doc.numPages;
}

function scrollToPage(pageNo) {
  current = Math.min(Math.max(1, pageNo), doc.numPages);
  rendered.get(current)?.scrollIntoView({ block: 'start' });
  updatePager();
}

prevBtn.onclick = () => scrollToPage(current - 1);
nextBtn.onclick = () => scrollToPage(current + 1);

/** 重排：清空后按新 scale 重画，并保持当前页在视野里。 */
async function rescale(next) {
  scale = Math.min(Math.max(0.4, next), 4);
  const keep = current;
  rendered.clear();
  pagesHost.textContent = '';
  await renderAll();
  current = keep;
  scrollToPage(keep);
}

zoomInBtn.onclick = () => { void rescale(scale * 1.15); };
zoomOutBtn.onclick = () => { void rescale(scale / 1.15); };

// 键盘：与笔记页主页面一致（↑/↓ 翻页，PgUp/PgDn 翻页）。
// ⚠️ 这里不能拦 ↑/↓ 的默认滚动 —— iframe 自己有滚动条，原生更好用。
// 只在按住修饰键或目标在输入区时不管；本页没有输入区，所以直接翻页。
window.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'PageDown' || (event.key === 'ArrowDown' && event.shiftKey)) { event.preventDefault(); scrollToPage(current + 1); }
  else if (event.key === 'PageUp' || (event.key === 'ArrowUp' && event.shiftKey)) { event.preventDefault(); scrollToPage(current - 1); }
});

// 滚动时把「当前页」更新成视野里最靠上的那页。
pagesHost.addEventListener('scroll', () => {
  const top = pagesHost.scrollTop;
  let best = current;
  for (const [pageNo, el] of rendered) {
    if (el.offsetTop - 40 <= top) best = Math.max(best, pageNo);
  }
  if (best !== current) { current = best; updatePager(); }
});

boot();
</script>
</body></html>`;

/**
 * 伺服 PDF 阅读器相关资源。
 *
 * 三类资源共用这一个前缀，按 pathname 分派：
 *   - `/` 或 `/index.html` → 阅读器页面；
 *   - `/pdfjs/<相对路径>`  → `pdfjs-dist` 里的文件（**白名单**限定，见 `PDFJS_ALLOWED`）；
 *   - `/file?path=<相对路径>` → 库里的 PDF 字节。
 *
 * @param req - 原生请求。
 * @param res - 原生响应。
 * @param options.resolveFile - `(相对路径) => 绝对路径 | null`。由调用方注入，
 *   这样本文件不必知道笔记库的 `safePath` / `resolveIn` 规则，也不会为了拿它们
 *   去循环 import `index.js`。
 */
export async function servePdfRoute(req, res, { resolveFile }) {
  const send = (status, headers, body) => {
    res.writeHead(status, headers);
    res.end(body);
  };
  try {
    return await route(req, res, send, resolveFile);
  } catch (error) {
    // 路由自己兜住异常，不让它冒到宿主的 `handle()`：那边会 `res.writeHead(400)`
    // 甚至 `res.destroy()`，在 iframe 里表现为一次莫名其妙的断连，而真正的原因
    // （比如某个文件读不出）就丢了。这里如实返回 500 + 一句话。
    if (!res.headersSent) {
      send(500, { 'content-type': 'text/plain; charset=utf-8' }, `PDF 路由内部错误：${error?.message ?? error}`);
    } else {
      res.end();
    }
    return undefined;
  }
}

/**
 * `servePdfRoute` 的实际分派（外层只管兜异常）。
 * @param send - 已绑定的响应函数。
 */
async function route(req, res, send, resolveFile) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const sub = url.pathname.slice(PDF_ROUTE_PREFIX.length) || '/';

  if (sub === '/' || sub === '/index.html') {
    return send(200, {
      'content-type': MIME.html,
      // 阅读器页面每次都要拿最新：它含主题变量与 pdf.js 的版本绑定。
      'cache-control': 'no-store',
    }, PDF_VIEWER_HTML);
  }

  if (sub.startsWith('/pdfjs/')) {
    const root = pdfjsRoot();
    if (root === null) return send(503, { 'content-type': 'text/plain; charset=utf-8' }, 'pdfjs-dist 没有安装');
    const relative = decodeURIComponent(sub.slice('/pdfjs/'.length));
    // 白名单：只允许构建产物、字符映射、标准字体与色彩配置。
    // 不加这一道，`/pdfjs/../../.env` 就能把库外的文件读出去。
    if (!PDFJS_ALLOWED.test(relative)) return send(404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found');
    const abs = path.join(root, ...relative.split('/'));
    // 纵深防御：join 之后仍要确认没跑出 root。
    if (!abs.startsWith(root + path.sep)) return send(404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found');
    try {
      const body = await readFile(abs);
      return send(200, { 'content-type': mimeOf(abs), 'cache-control': 'public, max-age=86400' }, body);
    } catch {
      return send(404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found');
    }
  }

  if (sub === '/file') {
    const abs = resolveFile(url.searchParams.get('path') ?? '');
    if (abs === null) return send(400, { 'content-type': 'text/plain; charset=utf-8' }, '路径不合法');
    try {
      const body = await readFile(abs);
      return send(200, {
        // 只有 PDF 才声明 application/pdf；其余按二进制给，避免浏览器去猜。
        'content-type': /\.pdf$/i.test(abs) ? 'application/pdf' : 'application/octet-stream',
        'content-length': String(body.length),
        // 用户自己的文件，按会话缓存即可：不设长缓存，同名替换后要能看到新的。
        'cache-control': 'private, max-age=300',
      }, body);
    } catch {
      return send(404, { 'content-type': 'text/plain; charset=utf-8' }, '找不到这个文件');
    }
  }

  return send(404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found');
}

export { PDF_VIEWER_HTML };
