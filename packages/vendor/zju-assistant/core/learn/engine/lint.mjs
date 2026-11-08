// 版面自查：不看图，让程序找出越界、重叠、字太小、报错和空画面，只把有问题的帧截下来。
//   node engine/lint.mjs <这一集的目录>                  全片
//   node engine/lint.mjs <这一集的目录> --scene <场景id>  只查一个场景；--cols 1|2|3 总览图每行几格
// 先自动打包，再在无界面浏览器里把每一句求两帧（说到一半、说完时）。打包时在引擎后面插一个记录器：它包住 V 的绘图函数
// 和 canvas 的绘制调用，记下场景画出的每段文字、每个图形的包围盒、字号、不透明度。记录器只存在于这次自查的临时成品里。
// 报告五种问题：① 场景画的东西越出 V.SAFE（章节标签和字幕是播放器画的，不算）② 两段文字明显重叠 ③ 字号小于 26
// ④ 场景抛异常 ⑤ 整帧是空的。②③只看不透明度不低于 0.35 的；①②③只看已经停稳的东西，移动、淡入淡出途中的不算。
// 同一个问题连着出现在很多句上时合并成一条。有问题的帧拼成 <这一集>/build/shots/lint-NN.png，框出了出问题的地方。
// 退出码：没有问题 0，有问题 1，没跑成 2。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';

const engineDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true; };
const lessonDir = resolve(args[0] || '');
if (!args[0] || args[0].startsWith('--') || !existsSync(join(lessonDir, 'script.js'))) { console.error('用法: node engine/lint.mjs <这一集的目录> [--scene <场景id>] [--cols 1|2|3]'); process.exit(2); }
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(existsSync);
if (!edge) { console.error('找不到 Edge 或 Chrome'); process.exit(2); }

/* 记录器，在成品页面里运行，排在引擎之后、场景之前。平时的成品里没有它。
   LINT.frame(t) 求出 t 时刻的一帧，返回 { items, error }。items 的每一项是一段文字或一个图形：
   { kind: 'text' | 'shape', fn: 哪个绘图函数, str: 文字, size: 字号, box: [x0, y0, x1, y1]（画布像素）, alpha, own: 哪个场景画的（播放器画的为 null） }。
   一次 V.txt / rich / line… 调用算一项：里面的上下标、逐个字形、预渲染公式的轮廓（它的盒子在 Path2D 的 box 上）都并在一起。 */
function recorder() {
  const P = CanvasRenderingContext2D.prototype, R = window.LINT = { on: false, dry: false, items: [], group: null, scene: null, error: null, load: [] };
  const grow = (b, c, x, y) => { const m = c.getTransform(), X = m.a * x + m.c * y + m.e, Y = m.b * x + m.d * y + m.f; if (X < b[0]) b[0] = X; if (Y < b[1]) b[1] = Y; if (X > b[2]) b[2] = X; if (Y > b[3]) b[3] = Y; return b; };
  const rect = (c, x0, y0, x1, y1, b = [Infinity, Infinity, -Infinity, -Infinity]) => { grow(b, c, x0, y0); grow(b, c, x1, y0); grow(b, c, x0, y1); return grow(b, c, x1, y1); };
  const scale = c => { const m = c.getTransform(); return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); };
  const push = (c, kind, box, more) => { if (box[2] >= box[0] && c.globalAlpha > 0) (R.group ? R.group.parts : R.items).push({ kind, box, alpha: c.globalAlpha, own: R.scene, ...more }); };
  let path = null;                                                // 当前路径的包围盒
  const pt = (c, x, y) => { path = grow(path || [Infinity, Infinity, -Infinity, -Infinity], c, x, y); };
  const hook = (name, note, paints) => { const orig = P[name]; P[name] = function (...a) { if (R.on) { note(this, a); if (paints && R.dry) return; } return orig.apply(this, a); }; };
  hook('beginPath', () => { path = null; });
  hook('moveTo', (c, [x, y]) => pt(c, x, y)); hook('lineTo', (c, [x, y]) => pt(c, x, y));
  hook('rect', (c, [x, y, w, h]) => { path = rect(c, x, y, x + w, y + h, path || undefined); }); hook('roundRect', (c, [x, y, w, h]) => { path = rect(c, x, y, x + w, y + h, path || undefined); });
  hook('bezierCurveTo', (c, a) => { for (let i = 0; i < 6; i += 2) pt(c, a[i], a[i + 1]); }); hook('quadraticCurveTo', (c, a) => { pt(c, a[0], a[1]); pt(c, a[2], a[3]); }); hook('arcTo', (c, a) => { pt(c, a[0], a[1]); pt(c, a[2], a[3]); });
  hook('ellipse', (c, [x, y, rx, ry]) => { const r = Math.max(rx, ry); path = rect(c, x - r, y - r, x + r, y + r, path || undefined); });
  hook('arc', (c, [x, y, r, a0, a1]) => {
    if (Math.abs(a1 - a0) >= Math.PI * 2 - 0.01) { path = rect(c, x - r, y - r, x + r, y + r, path || undefined); return; }
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.2)); for (let i = 0; i <= n; i++) { const q = a0 + (a1 - a0) * i / n; pt(c, x + r * Math.cos(q), y + r * Math.sin(q)); }
  });
  const shape = stroked => (c, a) => {
    if (a[0] instanceof Path2D) { const b = a[0].box; if (b) push(c, 'text', rect(c, b[0], b[1], b[2], b[3]), { str: '', size: b[4] * scale(c) }); return; }
    if (!path || (!stroked && typeof c.fillStyle !== 'string')) return;          // 渐变填充是光晕，不算画了东西
    const pad = stroked ? c.lineWidth * scale(c) / 2 : 0; push(c, 'shape', [path[0] - pad, path[1] - pad, path[2] + pad, path[3] + pad]);
  };
  hook('fill', shape(false), true); hook('stroke', shape(true), true);
  hook('fillRect', (c, [x, y, w, h]) => push(c, 'shape', rect(c, x, y, x + w, y + h)), true); hook('strokeRect', (c, [x, y, w, h]) => push(c, 'shape', rect(c, x, y, x + w, y + h)), true);
  const text = (c, [str, x, y]) => { const m = c.measureText(str); push(c, 'text', rect(c, x - m.actualBoundingBoxLeft, y - m.actualBoundingBoxAscent, x + m.actualBoundingBoxRight, y + m.actualBoundingBoxDescent), { str: String(str), size: parseFloat((/([\d.]+)px/.exec(c.font) || [0, 0])[1]) * scale(c) }); };
  hook('fillText', text, true); hook('strokeText', text, true);

  // V 的绘图函数：一次调用里画出的东西并成一项。ALL：里面的线条也是文字的一部分（分数线、根号）；其余的图形是文字自己的底板
  const NAME = { txt: a => a[0], rich: a => a[0].map(r => r.t).join('') }, ALL = { txt: 1 };
  const join = (parts, more) => { const box = [Infinity, Infinity, -Infinity, -Infinity]; let alpha = 0, size = 0; for (const p of parts) { box[0] = Math.min(box[0], p.box[0]); box[1] = Math.min(box[1], p.box[1]); box[2] = Math.max(box[2], p.box[2]); box[3] = Math.max(box[3], p.box[3]); alpha = Math.max(alpha, p.alpha); size = Math.max(size, p.size || 0); } return { box, alpha, size, own: parts[0].own, ...more }; };
  for (const fn of ['txt', 'rich', 'line', 'arrow', 'circle', 'rrect', 'poly', 'curve']) {
    const orig = V[fn];
    V[fn] = function (...a) {
      if (!R.on || R.group) return orig.apply(this, a);
      const g = R.group = { parts: [] };
      try { return orig.apply(this, a); } finally {
        R.group = null;
        const words = g.parts.filter(p => p.kind === 'text'), rest = g.parts.filter(p => p.kind !== 'text');
        if (words.length) R.items.push(join(ALL[fn] ? g.parts : words, { kind: 'text', fn, str: V.plain(String(NAME[fn](a))) }));
        if (rest.length && !(words.length && ALL[fn])) R.items.push(join(rest, { kind: 'shape', fn, size: undefined }));
      }
    };
  }
  // 场景函数：记下是谁在画，异常照样抛给播放器
  V.SCENES = new Proxy({}, { set(all, id, draw) { if (typeof draw !== 'function') { all[id] = draw; return true; } all[id] = function (t) { const was = R.scene; R.scene = id; try { return draw.call(this, t); } catch (e) { if (R.on) R.error = { scene: id, message: String((e && e.message) || e) }; throw e; } finally { R.scene = was; } }; return true; } });
  addEventListener('error', e => R.load.push(String(e.message)));
  R.frame = t => { R.items = []; R.error = null; R.group = null; path = null; R.on = true; try { film.seek(t); } finally { R.on = false; } return { items: R.items, error: R.error }; };
}

/* 第一遍，在页面里运行：每句求帧、判断，把找到的问题写进页面，由 --dump-dom 带出来。 */
function probe(opt) {
  const D = 0.1, TOL = 10, FAINT = 0.35, SMALL = 26;             // 擦边的不报：越界不到 10 像素、字号四舍五入够 26 的都放过
  const run = () => {
    const R = window.LINT, TL = film.timeline, S = V.SAFE, cv = document.getElementById('film');
    const u = Math.min(cv.width / V.W, cv.height / V.H), ox = (cv.width - V.W * u) / 2, oy = (cv.height - V.H * u) / 2;
    const grab = t => { const f = R.frame(t); for (const it of f.items) { const b = it.box; it.box = [(b[0] - ox) / u, (b[1] - oy) / u, (b[2] - ox) / u, (b[3] - oy) / u]; if (it.size) it.size /= u; } return f; };
    const near = (a, b, e) => a.box.every((v, i) => Math.abs(v - b.box[i]) <= e);
    const round = b => b.map(Math.round);
    const look = t => {
      const before = grab(t - D), now = grab(t), found = [], err = now.error || before.error;
      if (err) found.push({ rule: 'error', str: err.message, scene: err.scene });
      const mine = now.items.filter(it => it.own !== null), onstage = it => it.box[2] > 0 && it.box[0] < V.W && it.box[3] > 0 && it.box[1] < V.H;
      const layered = TL.scenes.some(sc => t >= sc.s && t < sc.e && typeof V.SCENES[sc.id] === 'object');      // 自带图层的场景不在画布上画，这里看不到它画了什么
      if (!err && !layered && !mine.some(it => it.alpha > 0.02 && onstage(it))) found.push({ rule: 'empty' });
      // 停稳的：0.1 秒前就在同一个位置、同样深浅。同一段字画了两遍的只留一份
      const was = new Map(); for (const it of before.items) { const k = it.kind + it.str; (was.get(k) || was.set(k, []).get(k)).push(it); }
      const still = mine.filter(it => it.alpha >= FAINT && onstage(it) && (was.get(it.kind + it.str) || []).some(b => Math.abs(b.alpha - it.alpha) <= 0.03 && near(it, b, 1.5)));
      const words = still.filter((it, i) => it.kind === 'text' && !still.slice(0, i).some(b => b.kind === 'text' && b.str === it.str && near(it, b, 3)));
      for (const it of still) {
        if (it.kind === 'text' && !words.includes(it)) continue;
        const b = it.box, out = [S.x0 - b[0], S.y0 - b[1], b[2] - S.x1, b[3] - S.y1], over = Math.max(...out);
        const backdrop = it.kind === 'shape' && b[0] <= S.x0 && b[1] <= S.y0 && b[2] >= S.x1 && b[3] >= S.y1;          // 铺满整幅的底色不算
        if (over > TOL && !backdrop) found.push({ rule: 'safe', kind: it.kind, fn: it.fn, str: it.str, box: round(b), over: Math.round(over), side: ['左', '上', '右', '下'][out.indexOf(over)] });
        if (it.kind === 'text' && Math.round(it.size) < SMALL) found.push({ rule: 'small', str: it.str, size: Math.round(it.size * 10) / 10, box: round(b) });
      }
      for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
        const a = words[i].box, b = words[j].box, w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
        if (w < 4 || h < 4 || w * h < 0.15 * Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))) continue;
        found.push({ rule: 'overlap', str: words[i].str, other: words[j].str, box: round([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]), boxes: [round(a), round(b)] });
      }
      return found.slice(0, 80);
    };
    R.dry = true;
    const frames = [];
    TL.cues.forEach((c, i) => {
      if (opt.scene && c.scene !== opt.scene) return;
      const nx = TL.cues[i + 1], sc = TL.scenes.find(s => s.id === c.scene), times = { mid: (c.s + c.e) / 2, end: (nx && nx.scene === c.scene ? nx.s : sc.e - sc.fadeOut) - 0.03 };
      for (const at of ['mid', 'end']) { const found = look(times[at]); if (found.length) frames.push({ i, key: c.key, at, t: times[at], found }); }
    });
    const out = { cues: TL.cues.map(c => [c.key, V.plain(c.show), c.scene]), frames, load: R.load, safe: S };
    const text = encodeURIComponent(JSON.stringify(out)), done = () => { document.documentElement.innerHTML = '<body><pre id="lint">' + text + '</pre></body>'; };
    if (opt.report) fetch(opt.report, { method: 'POST', mode: 'no-cors', body: text }).then(done, done); else done();
  };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(run, 60));
}

/* 第二遍，在页面里运行：把有问题的帧画成总览图，框出问题所在。 */
function sheet(opt) {
  const { cells, COLS, TW, TH, BAR, safe } = opt;
  const run = () => {
    const src = document.getElementById('film'), page = document.createElement('canvas'); page.width = COLS * TW; page.height = Math.ceil(cells.length / COLS) * (TH + BAR);
    const g = page.getContext('2d'), k = TW / 1920; g.fillStyle = '#fff'; g.fillRect(0, 0, page.width, page.height);
    cells.forEach((cell, i) => {
      const x = (i % COLS) * TW, y = Math.floor(i / COLS) * (TH + BAR);
      film.seek(cell.t);
      const u = Math.min(src.width / 1920, src.height / 1080), sx = (src.width - 1920 * u) / 2, sy = (src.height - 1080 * u) / 2;
      g.drawImage(src, sx, sy, 1920 * u, 1080 * u, x, y + BAR, TW, TH);
      g.strokeStyle = '#bbb'; g.lineWidth = 1; g.setLineDash([]); g.strokeRect(x + 0.5, y + BAR + 0.5, TW - 1, TH - 1);
      if (cell.safe) { g.strokeStyle = '#d00'; g.setLineDash([6, 5]); g.strokeRect(x + safe.x0 * k, y + BAR + safe.y0 * k, (safe.x1 - safe.x0) * k, (safe.y1 - safe.y0) * k); g.setLineDash([]); }
      g.strokeStyle = '#e00'; g.lineWidth = 2;
      for (const b of cell.boxes) g.strokeRect(x + b[0] * k - 2, y + BAR + b[1] * k - 2, (b[2] - b[0]) * k + 4, (b[3] - b[1]) * k + 4);
      g.font = '20px "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#b00';
      const w = g.measureText(cell.tag + '  ').width; g.fillText(cell.tag, x + 8, y + BAR / 2);
      g.fillStyle = '#000'; let label = cell.label; while (g.measureText(label).width > TW - 16 - w && label.length > 4) label = label.slice(0, -2);
      g.fillText(label, x + 8 + w, y + BAR / 2);
    });
    document.body.innerHTML = ''; document.body.style.cssText = 'margin:0;background:#fff;overflow:hidden'; page.style.cssText = 'display:block'; document.body.appendChild(page);
  };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => setTimeout(run, 60));
}

// 打包到自己专用的文件里，带上记录器
const outDir = join(lessonDir, 'build', 'shots');
mkdirSync(outDir, { recursive: true });
const tmp = name => join(outDir, `.lint-${process.pid}-${name}`), bundle = tmp('build.html'), hookFile = tmp('hook.js');
writeFileSync(hookFile, `(${recorder})();`);
const built = spawnSync(process.execPath, [join(engineDir, 'build.mjs'), lessonDir], { encoding: 'utf8', env: { ...process.env, LEARN_OUT: bundle, LEARN_HOOK: hookFile } });
rmSync(hookFile, { force: true });
const said = built.stdout.split('\n').filter(l => /^(提示|警告|错误)/.test(l));
process.stdout.write(said.join('\n') + (said.length || built.stderr ? '\n' : ''));
if (built.stderr) process.stderr.write(built.stderr);
if (!existsSync(bundle)) { console.error('打包没有成功，查不了'); process.exit(2); }
const html = readFileSync(bundle, 'utf8');
rmSync(bundle, { force: true });
// 浏览器用自己的用户目录。机器上开着 Edge 时，新起的无界面进程会把活儿转交出去、自己立刻返回：
// 标准输出收不到，截图要过一会儿才写好。所以结果由页面发回本机的一个临时端口（loose），截图则等文件出现（wait）。
const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const wait = file => { for (let i = 0; i < 150 && !existsSync(file); i++) nap(200); nap(300); return existsSync(file); };
// 浏览器的用户目录放在系统的临时目录里：它有几百个文件夹，浏览器退出后还会占一会儿，常常删不干净，不能留在这一集的目录下
const profile = join(tmpdir(), `learn-lint-${process.pid}`);
const tidy = () => { for (const f of [profile, ...readdirSync(outDir).filter(f => /^\.lint-\d+-page\.html$/.test(f)).map(f => join(outDir, f))]) try { rmSync(f, { recursive: true, force: true }); } catch { /* 浏览器还占着 */ } };
tidy(); process.on('exit', tidy);
const browse = (fn, opt, more, loose) => {
  const page = tmp('page.html');
  writeFileSync(page, html.replace('</body>', () => `<script>
(${fn})(${JSON.stringify(opt)});
</script>
</body>`));
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--virtual-time-budget=6000', `--user-data-dir=${profile}`, ...more, pathToFileURL(page).href + '?bare=1'];
  return loose ? spawn(edge, args, { stdio: 'ignore' }) : spawnSync(edge, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
};

// 第一遍：找问题
const scene = flag('scene') === true ? undefined : flag('scene');
const report = await new Promise(done => {
  const finish = body => { clearTimeout(timer); server.close(); done(body); };
  const server = createServer((req, res) => { let body = ''; req.on('data', d => { body += d; }); req.on('end', () => { res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }); res.end(); finish(body); }); });
  const timer = setTimeout(() => finish(''), 120000);
  server.listen(0, '127.0.0.1', () => browse(probe, { scene, report: `http://127.0.0.1:${server.address().port}/` }, ['--window-size=1920,1080'], true));
});
const got = report ? [report, report] : null;
if (!got) { console.error('没有拿到自查结果（浏览器没有跑完）'); process.exit(2); }
const data = JSON.parse(decodeURIComponent(got[1])), cues = data.cues, S = data.safe;
const checked = cues.filter(c => !scene || c[2] === scene).length;
if (!checked) { console.error(`没有场景 ${scene}。可用：${[...new Set(cues.map(c => c[2]))].join(' ')}`); process.exit(2); }

// 合并：同一个问题（同一段字、同一个位置）连着出现的句子并成一段；同一段句子上的同一种问题并成一条；
// 同样的一组问题隔了些句子又出现的，还是这一条，写上各段的范围
const RULES = [['safe', '越出可用区域', `场景画的东西越出了 V.SAFE（x ${S.x0}–${S.x1}，y ${S.y0}–${S.y1}）`], ['overlap', '文字重叠', '两段文字的包围盒明显重叠'], ['small', '字号小于 26', '不透明度不低于 0.35 的文字，字号小于 26'], ['error', '场景报错', '场景抛出了异常'], ['empty', '空画面', '整帧除了章节标签和字幕什么都没有']];
const idOf = f => f.rule === 'small' ? f.str + '|' + Math.round(f.size) : f.rule === 'safe' ? [f.kind, f.fn, f.str, f.side, ...f.box.map(v => Math.round(v / 8))].join('|') : f.rule === 'overlap' ? [f.str, f.other, ...f.box.map(v => Math.round(v / 8))].join('|') : f.rule === 'error' ? f.scene + '|' + f.str : '';
const seen = new Map();                                 // 规则|问题 → [{ i, at, t, f }]
for (const fr of data.frames) for (const f of fr.found) { const k = f.rule + '\n' + idOf(f); (seen.get(k) || seen.set(k, []).get(k)).push({ i: fr.i, at: fr.at, t: fr.t, f }); }
const spans = new Map();                                // 规则|起句|止句 → 这一段句子上连着出现的各个问题
for (const [k, hits] of seen) {
  let run = [];
  const close = () => { if (!run.length) return; const id = [k.split('\n')[0], run[0].i, run[run.length - 1].i].join('|'); (spans.get(id) || spans.set(id, []).get(id)).push({ k, hits: run }); run = []; };
  for (const h of hits.sort((a, b) => a.i - b.i || (a.at < b.at ? 1 : -1))) { if (run.length && h.i - run[run.length - 1].i > 2) close(); run.push(h); }      // 中间隔一两句没报（正好在动）也算连着
  close();
}
const kinds = new Map();                                // 规则 + 这一组问题 → 它出现的各段句子
for (const [id, runs] of spans) { const [rule, a, b] = id.split('|'), sig = rule + '\n' + runs.map(r => r.k).sort().join('\n'); (kinds.get(sig) || kinds.set(sig, []).get(sig)).push({ a: +a, b: +b, runs: runs.map(r => r.hits) }); }
const q = s => `“${String(s).length > 18 ? String(s).slice(0, 17) + '…' : s}”`, list = (a, total = a.length, n = 5) => a.slice(0, n).join('、') + (total > Math.min(n, a.length) ? ` 等 ${total} 段` : '');
const span = b => `x ${b[0]}–${b[2]}，y ${b[1]}–${b[3]}`, hull = bs => [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))];
const entries = [];
for (const [sig, parts] of kinds) {
  parts.sort((x, y) => x.a - y.a);
  const rule = sig.split('\n')[0], { a, b, runs } = parts[0], every = parts.flatMap(p => p.runs.flat()), first = runs.map(r => r.find(h => h.at === 'end') || r[0]).sort((x, y) => x.i - y.i || (x.at < y.at ? 1 : -1))[0];
  const here = runs.flatMap(r => { const now = r.filter(h => h.i === first.i && h.at === first.at); return now.length ? now : [r[0]]; }).map(h => h.f), sentences = new Set(every.map(h => h.i)).size, uniq = v => [...new Set(v)];   // 取作代表的那一帧上的各处
  const ranges = parts.map(p => (p.a === p.b ? cues[p.a][0] : `${cues[p.a][0]}–${cues[p.b][0]}`));
  const where = ranges.slice(0, 8).join('、') + (ranges.length > 8 ? ` 等 ${ranges.length} 段` : '') + (sentences > 1 ? `（${ranges.length > 1 ? '共 ' : ''}${sentences} 句）` : ''), strs = uniq(here.map(f => f.str).filter(s => s !== undefined && s !== ''));
  let what;
  if (rule === 'small') { const sizes = every.map(h => h.f.size), lo = Math.min(...sizes), hi = Math.max(...sizes); what = `${list(strs.map(q), here.length)}  字号 ${lo === hi ? lo : lo + '–' + hi}  位置 ${span(hull(here.map(f => f.box)))}`; }
  else if (rule === 'safe') { const texts = here.filter(f => f.kind === 'text'), shapes = here.filter(f => f.kind !== 'text'); what = `${[texts.length ? '文字 ' + list(uniq(texts.map(f => q(f.str))), texts.length) : '', shapes.length ? `图形 ${uniq(shapes.map(f => f.fn || 'canvas')).join('、')} ${shapes.length} 个` : ''].filter(Boolean).join('，')}  ${uniq(here.map(f => f.side)).join('、')}边超出 ${Math.max(...here.map(f => f.over))} px  位置 ${span(hull(here.map(f => f.box)))}`; }
  else if (rule === 'overlap') what = here.slice(0, 3).map(f => `${q(f.str)} 和 ${q(f.other)} 重叠 ${f.box[2] - f.box[0]}×${f.box[3] - f.box[1]} px，在 ${span(f.box)}`).join('；') + (here.length > 3 ? `；等 ${here.length} 对` : '');
  else if (rule === 'error') what = `场景 ${here[0].scene}：${here[0].str}`;
  else what = `${first.at === 'mid' ? '说到一半时' : '说完时'}只有章节标签和字幕`;
  entries.push({ rule, a, b, where, what, shot: first, boxes: rule === 'overlap' ? here.flatMap(f => f.boxes) : here.map(f => f.box).filter(Boolean) });
}
entries.sort((x, y) => RULES.findIndex(r => r[0] === x.rule) - RULES.findIndex(r => r[0] === y.rule) || x.a - y.a || x.b - y.b);
entries.forEach((e, n) => { e.no = n + 1; });

// 报告
for (const f of readdirSync(outDir)) if (/^lint-\d+\.png$/.test(f)) rmSync(join(outDir, f), { force: true });     // 上一次的总览图不留
console.log(`版面自查：${scene ? '场景 ' + scene + '，' : ''}${checked} 句，每句看说到一半和说完时两帧`);
for (const m of data.load) console.log(`场景脚本加载时报错：${m}`);
if (!entries.length && !data.load.length) { console.log('没有发现版面问题'); process.exit(0); }
for (const [rule, name, means] of RULES) {
  const mine = entries.filter(e => e.rule === rule); if (!mine.length) continue;
  console.log(`\n${name}（${means}）：${mine.length} 处`);
  for (const e of mine) console.log(`  #${e.no}  ${e.where}  ${e.what}`);
}
console.log('\n合计：' + RULES.map(([rule, name]) => `${name} ${entries.filter(e => e.rule === rule).length}`).join('，'));

// 第二遍：每条问题取它最早出现的那一帧，同一帧上的几条画在一格里
const cols = Math.max(1, Math.min(3, Number(flag('cols')) || 3)), rows = cols === 1 ? 1 : cols === 2 ? 2 : 3, TW = 1920 / cols, TH = 1080 / cols, BAR = 44;
const cells = [];
for (const e of entries) {
  const spec = cues[e.shot.i][0] + (e.shot.at === 'mid' ? '@mid' : '');
  const cell = cells.find(c => c.spec === spec) || cells[cells.push({ spec, t: e.shot.t, tag: '', label: `${spec}  ${cues[e.shot.i][1]}`, boxes: [], safe: false }) - 1];
  cell.tag += '#' + e.no + ' '; cell.boxes.push(...e.boxes); if (e.rule === 'safe') cell.safe = true; e.cell = cell;
}
const per = cols * rows, files = [];
for (let n = 0; n * per < cells.length; n++) {
  const part = cells.slice(n * per, (n + 1) * per), out = join(outDir, `lint-${String(n + 1).padStart(2, '0')}.png`), height = Math.ceil(part.length / cols) * (TH + BAR);
  rmSync(out, { force: true });
  browse(sheet, { cells: part, COLS: cols, TW, TH, BAR, safe: S }, [`--window-size=1920,${Math.max(1080, height)}`, `--screenshot=${out}`]);
  if (wait(out)) { files.push(out); console.log(`${out}  （${part.map(c => c.tag.trim().replace(/ /g, '') + ' ' + c.spec).join('，')}）`); }
  else console.error(`没截到：${part.map(c => c.spec).join(' ')}`);
}
process.exit(1);
