// 只改解说词的节奏，不动字幕：给某几句设 min（这句的画面最少需要几秒）或 gap（句后停顿）。
//   node engine/timing.mjs <这一集的目录> e5.min=5.8 e3.min=2.6 a7.gap=1.0
// 选项里带别的东西（tts、show: { … } 这种套着花括号的）也认得，只换 min、gap 这一项，别的原样留着。
// 写入前后会把整份解说词求值比较：除了这次要设的几项，只要有一处不一样就放弃，不写文件。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [dir, ...sets] = process.argv.slice(2);
if (!dir || !sets.length) { console.error('用法: node engine/timing.mjs <这一集的目录> <句子编号>.min=<秒> <句子编号>.gap=<秒> ...'); process.exit(2); }
const file = join(resolve(dir), 'script.js');
const orig = readFileSync(file, 'utf8');
let src = orig;
const load = s => new Function(`${s}\nreturn SCRIPT;`)();
const want = {};                                        // 句子编号 → { min, gap }：这次要设的
// 除了要设的那几项，解说词的其余部分（编号、字幕、别的选项、场景的设定）
const rest = s => JSON.stringify(load(s).map(sc => ({ ...sc, lines: sc.lines.map(([key, text, o]) => { const keep = { ...o }; for (const f in want[key] || {}) delete keep[f]; return [key, text, keep]; }) })));

// 从 at 处的开括号起，找到和它配对的闭括号。引号和反引号里的括号不算
function close(s, at) {
  let depth = 0;
  for (let i = at; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') { for (i++; i < s.length && s[i] !== c; i++) if (s[i] === '\\') i++; }
    else if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c) && --depth === 0) return i;
  }
  return -1;
}
// 选项对象 { … } 里最外一层的各项：[{ name, from, to }]，from 到 to 是这一项的原文（不含分隔的逗号）
function fields(s, open, end) {
  const out = []; let from = open + 1;
  for (let i = open + 1; i <= end; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') { for (i++; i < end && s[i] !== c; i++) if (s[i] === '\\') i++; }
    else if ('{[('.includes(c)) i = close(s, i);
    else if (c === ',' || i === end) { const text = s.slice(from, i); if (text.trim()) out.push({ name: (/^\s*(?:'([^']*)'|"([^"]*)"|([\w$]+))\s*:/.exec(text) || []).slice(1).find(Boolean), from, to: i }); from = i + 1; }
  }
  return out;
}

const captions = Object.fromEntries(load(orig).flatMap(sc => sc.lines.map(l => [l[0], l[1]]))), told = [];
for (const set of sets) {
  const m = set.match(/^([A-Za-z]\w*)\.(min|gap)=([\d.]+)$/);
  if (!m) { console.error(`看不懂 ${set}，应写成 e5.min=5.8`); process.exit(2); }
  const [, key, field, value] = m, text = `${field}: ${Number(value)}`;
  // 这一句在源码里的开头：['编号', '字幕'。别处也可能有长得像的数组，字幕对得上的才是
  const head = [...src.matchAll(new RegExp(`\\[\\s*(['"])${key}\\1\\s*,\\s*('(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*")`, 'g'))].find(h => new Function('return ' + h[2])() === captions[key]);
  if (!head) { console.error(`找不到句子 ${key}`); process.exit(2); }
  const lineOpen = head.index, lineEnd = close(src, lineOpen), after = head.index + head[0].length;
  const tail = /^\s*,\s*\{/.exec(src.slice(after, lineEnd));
  if (!tail) {                                          // 这一句还没有选项
    if (src.slice(after, lineEnd).trim()) { console.error(`${key} 的选项不是写成 { … } 的，改不了`); process.exit(2); }
    src = src.slice(0, after) + `, { ${text} }` + src.slice(lineEnd);
  } else {
    const open = after + tail[0].length - 1, end = close(src, open), all = fields(src, open, end), old = all.find(f => f.name === field);
    if (old) src = src.slice(0, old.from) + (/^\s*/.exec(src.slice(old.from, old.to))[0] || '') + text + (/\s*$/.exec(src.slice(old.from, old.to))[0] || '') + src.slice(old.to);
    else if (all.length) { const last = all[all.length - 1], stop = last.from + src.slice(last.from, last.to).trimEnd().length; src = src.slice(0, stop) + `, ${text}` + src.slice(stop); }
    else src = src.slice(0, open) + `{ ${text} }` + src.slice(end + 1);
  }
  (want[key] = want[key] || {})[field] = Number(value); told.push(set);
}
let before, after;
try { before = rest(orig); after = rest(src); } catch (e) { console.error(`改完以后 script.js 读不出来了（${e.message}），放弃，没有写入`); process.exit(1); }
const got = Object.fromEntries(load(src).flatMap(sc => sc.lines.map(l => [l[0], l[2] || {}])));
if (after !== before || Object.entries(want).some(([key, o]) => Object.entries(o).some(([f, v]) => (got[key] || {})[f] !== v))) { console.error('除了要设的节奏以外还有别的地方变了，或者没有设上，放弃，没有写入'); process.exit(1); }
writeFileSync(file, src);
console.log(`已写入 ${told.length} 处节奏：${told.join(' ')}。字幕和别的选项都没有变。`);
