// 打包时用本机的 TeX 把公式排好：latex 出 DVI，dvisvgm 转成字形轮廓，整理成一张表嵌进成品，播放时直接填充轮廓。
//   prerender(公式源码数组, 缓存目录) → { table: { em, g, f }, rows: [{ src, how: 'tex' | 'cache' | 'fallback', why }], seconds, bin, why }
// 找不到 TeX、或者某条公式 TeX 排不出来，那一条就不进表，播放时由 engine.js 里的后备排版来画；这里从不抛错。
// 排好的结果按公式内容的哈希存在缓存目录下（打包时给的是 <成片>/build/tex/），公式没变就不再跑 latex。
// 先看环境变量 LEARN_TEX_BIN（latex 和 dvisvgm 所在的目录；写 off 表示不用 TeX），再看 PATH，再看 E:\texlive\*\bin\windows。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const VERSION = 1;                       // 改了下面的导言区或存的格式就加一，旧缓存自动作废
const K = 72 / 72.27, EM = 10 * K;       // dvisvgm 的单位是 bp，公式按 10pt 排：一个 em 是 9.963 个单位
const HEAD = ['\\documentclass{article}', '\\usepackage{amsmath,amssymb}',
  '\\newcommand{\\F}[1]{\\setbox0\\hbox{$\\displaystyle #1$}\\typeout{DIM|\\the\\wd0|\\the\\ht0|\\the\\dp0|}\\shipout\\box0 }', '\\begin{document}',
  '\\F{\\vrule width 10pt height 10pt depth 0pt}'];    // 第一页是一块 10pt 见方的黑块，用来核对原点和单位
// 直接打进公式里的 Unicode 符号换成命令；换完还有非 ASCII 字符（比如 \text{中文}）的不交给 TeX
const UNI = { '−': '-', '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '≈': '\\approx ', '·': '\\cdot ', '×': '\\times ', '÷': '\\div ', '±': '\\pm ', '→': '\\to ', '∞': '\\infty ', '∈': '\\in ', '…': '\\dots ',
  α: '\\alpha ', β: '\\beta ', γ: '\\gamma ', δ: '\\delta ', ε: '\\varepsilon ', θ: '\\theta ', λ: '\\lambda ', μ: '\\mu ', π: '\\pi ', ρ: '\\rho ', σ: '\\sigma ', τ: '\\tau ', φ: '\\varphi ', ω: '\\omega ',
  Γ: '\\Gamma ', Δ: '\\Delta ', Θ: '\\Theta ', Λ: '\\Lambda ', Σ: '\\Sigma ', Φ: '\\Phi ', Ω: '\\Omega ' };

const OFF = /^(off|none|0)$/i.test(process.env.LEARN_TEX_BIN || '') && 'LEARN_TEX_BIN 设成了不用 TeX';     // 连缓存也不读
function find() {
  const exe = process.platform === 'win32' ? '.exe' : '', dirs = [process.env.LEARN_TEX_BIN, ...(process.env.PATH || '').split(delimiter)];
  try { for (const year of readdirSync('E:/texlive').sort().reverse()) dirs.push(`E:/texlive/${year}/bin/windows`); } catch { /* 没有这个盘或目录 */ }
  const dir = dirs.find(d => d && existsSync(join(d, 'latex' + exe)) && existsSync(join(d, 'dvisvgm' + exe)));
  return dir ? { dir, latex: join(dir, 'latex' + exe), dvisvgm: join(dir, 'dvisvgm' + exe) } : { why: '没找到 latex 和 dvisvgm（LEARN_TEX_BIN、PATH、E:\\texlive 都看过）' };
}
function texify(src) {
  const tex = [...src].map(ch => UNI[ch] || ch).join('').trim();
  if (/[^\x20-\x7E]/.test(tex)) return { why: '含中文或 TeX 这边不认的字符' };
  let depth = 0;
  for (let i = 0; i < tex.length && depth >= 0; i++) { if (tex[i] === '\\') i++; else if (tex[i] === '{') depth++; else if (tex[i] === '}') depth--; }
  return depth ? { why: '花括号不配对' } : tex ? { tex } : { why: '是空的' };
}
const attr = (tag, name) => { const m = new RegExp(`\\b${name}=(['"])(.*?)\\1`).exec(tag); return m ? m[2] : undefined; };
const round = v => Math.round(v * 1000) / 1000;
// 一页 SVG → { g: [[轮廓, x, y], …], r: [x, y, w, h, …] }，坐标以这一页盒子的左端、基线为原点
function page(svg, x0, y0) {
  const defs = {}, body = svg.slice(svg.search(/<g id=['"]page/));
  for (const m of svg.matchAll(/<path\b[^>]*>/g)) if (attr(m[0], 'id')) defs[attr(m[0], 'id')] = attr(m[0], 'd');
  if (/<(?!\/?g\b|use\b|rect\b|\/svg)|transform=|fill=|stroke=|clip-path=/.test(body)) return null;
  const g = [], r = [];
  for (const m of body.matchAll(/<use\b[^>]*>/g)) { const d = defs[(attr(m[0], 'xlink:href') || attr(m[0], 'href') || '').slice(1)]; if (!d) return null; g.push([d, round(attr(m[0], 'x') - x0), round(attr(m[0], 'y') - y0)]); }
  for (const m of body.matchAll(/<rect\b[^>]*>/g)) r.push(round(attr(m[0], 'x') - x0), round(attr(m[0], 'y') - y0), round(+attr(m[0], 'width')), round(+attr(m[0], 'height')));
  return { g, r };
}
// 把 list（[{ hash, tex }]）排出来，结果写进 done[hash]：排好的是 { w, h, d, g, r }，排不出来的是 { why }
function run(bin, list, work, done) {
  const env = { ...process.env, PATH: bin.dir + delimiter + (process.env.PATH || '') }, opt = { cwd: work, env, encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 26 };
  let todo = list.slice(), out = '';
  for (let pass = 0; todo.length; pass++) {
    writeFileSync(join(work, 'f.tex'), [...HEAD, ...todo.flatMap(x => [`\\F{${x.tex}}`, '']), '\\end{document}', ''].join('\n'));
    const r = spawnSync(bin.latex, ['-interaction=nonstopmode', '-halt-on-error', 'f.tex'], opt); out = r.stdout || '';
    if (r.status === 0) break;
    // 报错的那一条摘出去重排。认不出是哪一条，或者一条条摘了太多次，就全部不排
    const why = (/^! (.*)$/m.exec(out) || [])[1], line = Number((/^l\.(\d+)/m.exec(out.slice(out.search(/^! /m))) || [])[1]), at = Math.floor((line - HEAD.length - 1) / 2);
    if (!why || !(at >= 0 && at < todo.length) || pass >= 40) { for (const x of todo) done[x.hash] = { skip: true, why: why ? 'TeX 报错太多，这一批没有排' : r.error ? '运行 latex 失败：' + r.error.message : 'latex 没有正常结束' }; return; }
    done[todo[at].hash] = { why: 'TeX 报错：' + why.replace(/\.$/, '') }; todo.splice(at, 1);
  }
  if (!todo.length) return;
  const dims = [...out.matchAll(/DIM\|(-?[\d.]+)pt\|(-?[\d.]+)pt\|(-?[\d.]+)pt\|/g)].map(m => m.slice(1, 4).map(Number));
  const r = spawnSync(bin.dvisvgm, ['--no-fonts', '--exact-bbox', '--relative', '--precision=3', '-p', '1-', '-o', 'p-%p.svg', 'f.dvi'], opt);
  const pages = {}; for (const f of readdirSync(work)) { const m = /^p-0*(\d+)\.svg$/.exec(f); if (m) pages[m[1]] = readFileSync(join(work, f), 'utf8'); }
  const mark = /<rect\b[^>]*>/.exec(pages[1] || ''), fail = why => { for (const x of todo) done[x.hash] = { why, skip: true }; };   // skip：环境的毛病，不记进缓存
  if (r.status !== 0 || !mark || dims.length !== todo.length + 1) return fail(r.error ? '运行 dvisvgm 失败：' + r.error.message : 'dvisvgm 没有正常结束');
  if (Math.abs(attr(mark[0], 'width') / 10 - K) > 0.005) return fail('dvisvgm 输出的单位和预期的不一样');
  todo.forEach((x, i) => {
    const [wd, ht, dp] = dims[i + 1], p = pages[i + 2] && page(pages[i + 2], +attr(mark[0], 'x'), +attr(mark[0], 'y') + ht * K);
    done[x.hash] = p ? { w: round(wd * K), h: round(ht * K), d: round(dp * K), ...p } : { why: 'dvisvgm 的输出里有画不了的东西' };
  });
}

export function prerender(sources, cache) {
  const t0 = Date.now(), rows = [], want = [], done = {};
  for (const src of sources) {
    const t = OFF ? { why: OFF } : texify(src), row = { src, ...t, hash: t.tex && createHash('sha1').update(VERSION + '\n' + HEAD.join('\n') + '\n' + t.tex).digest('hex').slice(0, 16) };
    rows.push(row);
    if (!row.hash || row.hash in done) continue;
    try { done[row.hash] = JSON.parse(readFileSync(join(cache, row.hash + '.json'), 'utf8')); row.cached = true; } catch { done[row.hash] = null; want.push(row); }
  }
  let bin = null;
  if (want.length) {
    bin = find();
    if (bin.why) for (const x of want) done[x.hash] = { why: bin.why, skip: true };
    else {
      const work = join(cache, 'run-' + process.pid);
      mkdirSync(work, { recursive: true });
      try { run(bin, want, work, done); } catch (e) { for (const x of want) done[x.hash] = done[x.hash] || { why: '排版出错：' + e.message, skip: true }; }
      rmSync(work, { recursive: true, force: true });
      for (const x of want) if (done[x.hash] && !done[x.hash].skip) writeFileSync(join(cache, x.hash + '.json'), JSON.stringify({ tex: x.tex, ...done[x.hash] }));
    }
  }
  // 字形轮廓全片共用一份，每条公式只记“第几个轮廓、放在哪”
  const table = { em: round(EM), g: [], f: {} }, seen = new Map();
  for (const row of rows) {
    const e = row.hash && done[row.hash];
    if (!e || e.why) { row.how = 'fallback'; row.why = row.why || (e && e.why) || '没有排出来'; continue; }
    row.how = row.cached || rows.some(x => x !== row && x.hash === row.hash && x.cached) ? 'cache' : 'tex';
    table.f[row.src] = [e.w, e.h, e.d, e.g.flatMap(([d, x, y]) => { if (!seen.has(d)) { seen.set(d, table.g.length); table.g.push(d); } return [seen.get(d), x, y]; }), e.r];
  }
  return { table, rows, seconds: (Date.now() - t0) / 1000, ran: want.length && bin && !bin.why ? want.length : 0, why: OFF || (bin && bin.why) };
}
