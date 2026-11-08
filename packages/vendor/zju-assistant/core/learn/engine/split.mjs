// 把 lessons/<主题>/plan/narration.md 按停顿切成字幕行：句号、问号处断开，太长的句子再在分号、逗号、冒号处断开。文字不改。
//   node engine/split.mjs lessons/<主题>/film
// 在成片的 build/ 下写出 script.skel.js（写 script.js 时照着分场的骨架，〔画面〕行留在原位当注释）和 cues.json（编号 → 文字）。
// 编号是“第几幕的字母 + 幕内的序号”。这一集已经有 script.js 时，文字没变的句子保留原来的编号，
// 新加或改过的句子接在前一句后面编号（e17 之后是 e17b、e17c），所以改了讲稿重切，画面里写的编号不会错位。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

if (!process.argv[2]) { console.error('用法: node engine/split.mjs lessons/<主题>/film'); process.exit(1); }
const here = resolve(process.argv[2]), narration = join(here, '..', 'plan', 'narration.md');
// 先看讲稿在不在，再建成片的文件夹：目录给错了（比如当前目录不是讲解目录）时，不在别处留下一串空文件夹。
if (!existsSync(narration)) { console.error(`找不到讲稿：${narration}\n在讲解目录里运行，或者把这一集的目录写成完整路径。`); process.exit(1); }
mkdirSync(here, { recursive: true });
const md = readFileSync(narration, 'utf8').split(/\r?\n/);
const LIMIT = 27, SHORT = 7;

// 公式按排出来大概占几个字算
const width = s => { const t = s.replace(/\$[^$]*\$/g, m => 'x'.repeat(Math.ceil(m.replace(/\\[a-zA-Z]+|[{}$_^\\\s]/g, '').length * 1.1) + 1)); let w = 0; for (const c of t) w += c.charCodeAt(0) < 128 ? 0.55 : 1; return w; };      // 英文字母和数字算半个字

// 在 $…$ 和引号外面的标点处切开，标点留在前一段
function cut(text, marks) {
  const out = []; let buf = '', math = false, quote = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; buf += c;
    if (c === '$') math = !math;
    else if (c === '“') quote++;
    else if (c === '”') quote = Math.max(0, quote - 1);
    if (!math && !quote && marks.includes(c)) {
      while ('”）'.includes(text[i + 1] || '\0')) buf += text[++i];
      out.push(buf); buf = '';
    }
  }
  if (buf.trim()) out.push(buf);
  return out.map(s => s.trim()).filter(Boolean);
}

// 几段文字怎么并成行：行数最少，其次各行长短最接近。单独一段就超长的不再管
function pack(parts, marks) {
  const n = parts.length; let best = null;
  for (let mask = 0; mask < 1 << (n - 1); mask++) {
    const rows = []; let cur = parts[0], cost = 0, ok = true;
    for (let i = 1; i < n; i++) { if (mask >> (i - 1) & 1) { rows.push(cur); cur = parts[i]; } else cur += parts[i]; }
    rows.push(cur);
    for (const r of rows) { const w = width(r); if (w > LIMIT && cut(r, marks).length > 1) ok = false; cost += w * w + (w < SHORT ? 200 : 0); }
    if (!ok) continue;
    cost += rows.length * 2000;
    if (!best || cost < best.cost) best = { rows, cost };
  }
  return best.rows;
}

// 一段话切成行：先在句号、问号处，句子太长再在分号处，还长再在逗号、冒号处
function lines(paragraph) {
  const out = [];
  for (const sentence of cut(paragraph, '。？！')) {
    if (width(sentence) <= LIMIT) { out.push(sentence); continue; }
    for (const row of pack(cut(sentence, '；'), '；')) {
      if (width(row) <= LIMIT) out.push(row); else out.push(...pack(cut(row, '，：'), '，：'));
    }
  }
  return out;
}

// 已有的编号：按幕的字母分开，各自按原来的先后排
const old = {};
if (existsSync(join(here, 'script.js'))) {
  const SCRIPT = new Function(readFileSync(join(here, 'script.js'), 'utf8') + '\nreturn SCRIPT;')();
  for (const sc of SCRIPT) for (const [id, text] of sc.lines) (old[id[0]] = old[id[0]] || []).push({ id, text });
}
const taken = new Set(Object.values(old).flat().map(o => o.id)), kept = [], fresh = [];
const after = id => { const m = id.match(/^(.*?\d+)([a-z]*)$/); let k = m[2] ? m[2].charCodeAt(0) - 96 : 1, next; do next = m[1] + String.fromCharCode(96 + ++k); while (taken.has(next)); return next; };

const cues = [], skel = ["// 由 split.mjs 从 plan/narration.md 切出来，文字不要改；要改先改讲稿再重切。"];
let act = 0, n = 0, prev = '', at = 0;
for (const raw of md) {
  const l = raw.trim();
  if (!l || l.startsWith('# ')) continue;
  const head = l.match(/^## (\d+) (.*)$/);
  if (head) { act = +head[1]; n = 0; at = 0; prev = String.fromCharCode(96 + act) + '0'; skel.push('', `// ==== ${act} ${head[2]} ====`); continue; }
  if (!act) continue;
  if (l.startsWith('〔')) { skel.push('// ' + l); continue; }
  for (const text of lines(l)) {
    const had = old[prev[0]]; let id;
    if (!had) id = prev[0] + (++n);                                   // 这一幕以前没有：从 1 编起
    else {
      const hit = had.findIndex((o, k) => k >= at && o.text === text);
      if (hit >= 0) { id = had[hit].id; at = hit + 1; kept.push(id); } else { id = after(prev); fresh.push(id); }
    }
    taken.add(id); prev = id;
    cues.push({ id, act, text });
    skel.push(`['${id}', '${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'],`);
  }
}
mkdirSync(join(here, 'build'), { recursive: true });
writeFileSync(join(here, 'build', 'cues.json'), JSON.stringify(Object.fromEntries(cues.map(c => [c.id, c.text])), null, 1));
writeFileSync(join(here, 'build', 'script.skel.js'), skel.join('\n') + '\n');
const per = {}; cues.forEach(c => (per[c.act] = (per[c.act] || 0) + 1));
console.log(`${cues.length} 句；各幕 ${Object.values(per).join('、')}；最长 ${Math.round(Math.max(...cues.map(c => width(c.text))))} 字，最短 ${Math.round(Math.min(...cues.map(c => width(c.text))))} 字`);
if (Object.keys(old).length) {
  const gone = Object.values(old).flat().map(o => o.id).filter(id => !kept.includes(id));
  console.log(`对照已有的 script.js：${kept.length} 句编号不变` + (fresh.length ? `；新编号 ${fresh.join(' ')}` : '') + (gone.length ? `；不再有的编号 ${gone.join(' ')}` : ''));
}
