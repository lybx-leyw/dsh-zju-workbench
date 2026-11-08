// 把一集讲解打成单个 HTML，并导出解说词清单和字幕。
//   node engine/build.mjs <这一集的目录>
// 目录里需要 script.js（LESSON 和 SCRIPT）和 scenes/*.js。
// 成品写到哪：lessons/<主题>/film 的成品是 <根目录>/dist/<主题> <标题>.html，所有讲解的成品都在那一个文件夹里；别的目录（试验）
// 的成品打在它自己的 build/ 下。工具生成的其余东西（解说词清单、字幕、公式缓存、截图、配音）一律在 <成片>/build/ 里，整个删掉可以重来。
// 成品自己不出声：DSH 插件默认只提供字幕和画面。有 build/audio/manifest.json 时把配音和它的真实时长嵌进去，
// 时间轴就按真实时长排，声音仍由朗读器来放（它从成品里取，不用再合成）。
// 字幕和画面文字里的 $…$ 是公式：本机有 TeX 就在这里排好嵌进去（见 tex.mjs），没有或排不出来的，播放时由引擎自带的后备排版来画。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prerender } from './tex.mjs';

const engineDir = dirname(fileURLToPath(import.meta.url));
const lessonDir = resolve(process.argv[2] || '');
if (!process.argv[2] || !existsSync(join(lessonDir, 'script.js'))) {
  console.error('用法: node engine/build.mjs <这一集的目录>（目录里要有 script.js）');
  process.exit(2);
}
const read = p => readFileSync(p, 'utf8');
const buildDir = join(lessonDir, 'build');
const engineSrc = read(join(engineDir, 'engine.js'));
const scriptSrc = read(join(lessonDir, 'script.js'));
const sceneDir = join(lessonDir, 'scenes');
const sceneFiles = existsSync(sceneDir) ? readdirSync(sceneDir).filter(f => f.endsWith('.js')).sort() : [];
const scenes = sceneFiles.map(f => ({ name: f, src: read(join(sceneDir, f)) }));
// lib/*.js：这一集用到的外部库（单文件的浏览器版），原样排在场景前面
const libDir = join(lessonDir, 'lib');
const libs = existsSync(libDir) ? readdirSync(libDir).filter(f => f.endsWith('.js')).sort().map(f => read(join(libDir, f))) : [];

// 用播放器同一份代码算时间轴
const { V, SCRIPT, LESSON } = new Function(`${engineSrc}\n${scriptSrc}\nreturn { V, SCRIPT, LESSON: typeof LESSON === 'undefined' ? {} : LESSON };`)();
// 场景文件也在这里试着加载一遍（只加载，不画）：它们用 V.need 声明的、运行时才拼出来的字符串，这样才拿得到。
// 加载时就去碰画布或页面的场景会在这里出错，不要紧，只是它声明的公式收不全
const declared = [], unloaded = [], gone = [];
for (const sc of scenes) {
  const from = V.needs.length;
  try { new Function('V', 'SCRIPT', 'LESSON', sc.src)(V, SCRIPT, LESSON); } catch (e) {
    if (/^V\.\w+ is not a function/.test(e.message)) gone.push(`${sc.name}：${e.message}`);
    else if (/\bneed\(/.test(sc.src)) unloaded.push(`${sc.name}（${String(e.message).slice(0, 60)}）`);
  }
  declared.push([sc.name, V.needs.slice(from)]);
}
// 场景一加载就调用了引擎里没有的函数，成品里这个文件的画面全都出不来。这种情况不打包，已有的成品留着不动
if (gone.length) { for (const g of gone) console.error(`错误：${g}。引擎里没有这个函数，没有打包`); process.exit(1); }

// 字幕始终是中文。配音读哪种语言，由朗读器跟着配音服务当前的音色定；服务没开或成品里没有那种语言，就读 LESSON.dub。
// 所以每种语言的朗读文本都嵌进去：中文读字幕（行里有 tts 读 tts，公式换成念得出来的说法），其他语言读 dub.<语言>.json 里逐句的译文
const dub = LESSON.dub || V.DUB_DEFAULT;
if (!V.DUB[dub]) { console.error(`不认识的配音语言 ${dub}，可用：${Object.keys(V.DUB).join(' ')}`); process.exit(2); }
const lines = SCRIPT.flatMap(sc => sc.lines.map(([key, text, o = {}]) => ({ key, text, tts: o.tts, scene: sc.id }))).filter(l => l.text);
const texts = { zh: Object.fromEntries(lines.map(l => [l.key, (l.tts || V.spoken(l.text)).trim()]).filter(x => x[1])) }, dubbed = {}, unread = [];
for (const lang of Object.keys(V.DUB)) {
  if (lang === 'zh' || !existsSync(join(lessonDir, `dub.${lang}.json`))) continue;
  try { dubbed[lang] = JSON.parse(read(join(lessonDir, `dub.${lang}.json`))); } catch (e) { unread.push(`dub.${lang}.json 读不出来（${e.message.slice(0, 60)}），这次没有带上${V.DUB[lang].name}的朗读文本`); continue; }
  texts[lang] = Object.fromEntries(lines.map(l => [l.key, String(dubbed[lang][l.key] || '').trim()]).filter(x => x[1]));
}
const spoken = l => (texts[dub] || {})[l.key] || '';

// 配音：只采用与当前语言和朗读文本一致的音频
const durations = {}, audio = {}, stale = [];
const manifestPath = join(buildDir, 'audio', 'manifest.json');
if (existsSync(manifestPath)) {
  const { lang = 'zh', lines: manifest = {} } = JSON.parse(read(manifestPath));
  for (const l of lines) {
    const m = manifest[l.key];
    if (!m) continue;
    if (lang !== dub || m.spoken !== spoken(l)) { stale.push(l.key); continue; }
    const mp3 = join(buildDir, 'audio', l.key + '.mp3');
    if (!existsSync(mp3)) continue;
    durations[l.key] = m.seconds;
    audio[l.key] = 'data:audio/mpeg;base64,' + readFileSync(mp3).toString('base64');
  }
}
const TL = V.buildTimeline(SCRIPT, durations, dub);

// 检查
const problems = [], notes = [], warns = [...unread];
const allSceneSrc = scenes.map(s => s.src).join('\n');
// 每句话带 show 的解说词，画面由一个通用画法照着画，场景和句子不会在画面代码里出现，下面两项不查
const declarative = SCRIPT.some(sc => sc.lines.some(l => l[2] && l[2].show));
if (!declarative) for (const sc of SCRIPT) {
  if (!new RegExp(`SCENES\\s*(?:\\.\\s*${sc.id}\\b|\\[\\s*['"]${sc.id}['"]\\s*\\])\\s*=`).test(allSceneSrc)) notes.push(`场景 ${sc.id} 还没有画面`);
}
for (const s of scenes) {
  // at('编号') / en('编号')：句子要有；at('编号', '几个字')：这句字幕里要有这几个字
  for (const m of s.src.matchAll(/\b(?:at|en)\(\s*'([^']+)'(?:\s*,\s*('(?:[^'\\]|\\.)*'))?/g)) {
    if (!TL.T[m[1]]) { problems.push(`${s.name} 引用了不存在的句子 ${m[1]}`); continue; }
    let part; try { part = m[2] && new Function('return ' + m[2])(); } catch { /* 不是一个完整的字面量 */ }
    if (part && V.share(TL.T[m[1]].text, part) < 0) problems.push(`${s.name}：句子 ${m[1]} 的字幕里没有“${part}”`);
  }
}
for (const lang of new Set([dub, ...Object.keys(dubbed)])) {
  if (lang === 'zh') continue;
  const file = `dub.${lang}.json`, missing = lines.filter(l => !(texts[lang] || {})[l.key]), orphans = Object.keys(dubbed[lang] || {}).filter(key => !TL.T[key]);
  if (missing.length === lines.length) notes.push(`还没有译文：配音前先写 ${file}`);
  else if (missing.length) notes.push(`${file} 里这些句子还没有译文：${missing.map(l => l.key).join(' ')}`);
  if (orphans.length) notes.push(`${file} 里这些编号在解说词中不存在：${orphans.join(' ')}`);
}
const voiced = Object.keys(audio).length, heard = lines.filter(spoken);
if (stale.length) notes.push(`这些句子嵌入的配音已过期（改过朗读文本或换了语言），在朗读器里播放时改为现场合成：${stale.join(' ')}`);
else if (voiced && voiced < lines.length) notes.push(`只嵌入了 ${voiced}/${lines.length} 句配音，其余在朗读器里播放时现场合成`);
// 没人说话的空当：一句说完到下一句开口。最长的十处从长到短列出来（不到 1 秒的句间停顿不算），隔着换幕的注明
const fades = Object.fromEntries(TL.scenes.map(s => [s.id, s.fadeIn > 0]));
const quiet = TL.cues.slice(0, -1).map((c, i) => ({ key: c.key, d: TL.cues[i + 1].s - c.e, act: TL.cues[i + 1].scene !== c.scene && fades[TL.cues[i + 1].scene] }))
  .filter(q => q.d > 1).sort((a, b) => b.d - a.d).slice(0, 10);
if (quiet.length) notes.push(`没人说话最长的几处：${quiet.map(q => `${q.key} 后 ${q.d.toFixed(1)} 秒${q.act ? '（换幕）' : ''}`).join('、')}。画面停着的把 gap、min 改短；画面在动的留着，最后回讲稿补一句话；故意停下来让观众想的不算`);

// 公式从四处收：字幕；场景用 V.need 声明的字符串；场景源码里写死的字符串字面量；每句选项里的字符串。
// 最后一项只在没有场景声明时才收：选项（show）怎么写由画它的场景说了算，里面可能有要先换成数的占位，声明过的以声明为准。
// 既没写死、也没声明的（运行时现拼的），播放时走后备排版
function literals(src) {
  const out = [];
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; }
    else if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i < 0) break; i += 2; }
    else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1; while (j < src.length && src[j] !== c && (c === '`' || src[j] !== '\n')) j += src[j] === '\\' ? 2 : 1;
      const lit = src.slice(i, j + 1), raw = c === '`' && src.slice(i - 10, i) === 'String.raw'; i = j + 1;
      if (lit.includes('$') && !(c === '`' && lit.includes('${'))) try { out.push(raw ? lit.slice(1, -1) : new Function('return ' + lit)()); } catch { /* 不是一个完整的字面量 */ }
    } else i++;
  }
  return out;
}
const formulas = new Map();     // 公式源码 → { where: 出现在哪些句子或场景文件, bad: 后备排版不认识的命令 }
const collect = (v, where) => {
  if (typeof v === 'string') { if (v.includes('$')) for (const p of V.math(v).parts) { const f = formulas.get(p.src) || formulas.set(p.src, { where: [], bad: p.bad }).get(p.src); if (!f.where.includes(where)) f.where.push(where); } }
  else if (v && typeof v === 'object') for (const k in v) collect(v[k], where);
};
for (const sc of SCRIPT) for (const [key, text, o] of sc.lines) { collect(text, key); if (!V.needs.length) collect(o, key); if (typeof text === 'string' && V.math(text).odd) warns.push(`${key} 的字幕里 $ 不成对，落单的那个会照原样显示`); }
for (const s of scenes) collect(literals(s.src), s.name);
for (const [name, list] of declared) collect(list, name);
if (unloaded.length) notes.push(`这些场景文件在打包时没能试加载，它们用 V.need 声明的公式没有收全，播放时由后备排版来画：${unloaded.join('、')}`);
const tex = prerender([...formulas.keys()], join(buildDir, 'tex'));
const short = (list, n = 6) => list.slice(0, n).join(' ') + (list.length > n ? ` 等 ${list.length} 处` : '');
for (const row of tex.rows) {
  const f = formulas.get(row.src), where = short(f.where);
  if (row.how === 'fallback' && !tex.why) warns.push(`公式 $${row.src}$（${where}）没有用 TeX 排，改用后备排版：${row.why}`);
  if (f.bad.length) (row.how === 'fallback' ? warns : notes).push(row.how === 'fallback'
    ? `公式 $${row.src}$（${where}）里有后备排版不认识的命令 ${[...new Set(f.bad)].join(' ')}，会照原名画出来`
    : `公式 $${row.src}$（${where}）里的 ${[...new Set(f.bad)].join(' ')} 后备排版不认识：画面由 TeX 排不受影响，导出的字幕和朗读文本里只能照原名写`);
}
const fell = tex.rows.filter(r => r.how === 'fallback').length;
if (tex.why && fell) notes.push(`${tex.why}，${fell} 条公式用后备排版`);

// 打包
const esc = s => String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const tag = src => `<script>\n${src.replace(/<\/script/g, '<\\/script')}\n</script>`;
const theme = LESSON.theme || 'anthropic';
const hook = process.env.LEARN_HOOK;                    // LEARN_HOOK：版面自查用，在引擎之后、场景之前插入的一段脚本
// 成品放哪、叫什么
const topic = dirname(lessonDir), lecture = basename(lessonDir) === 'film' && basename(dirname(topic)) === 'lessons';
const root = lecture ? dirname(dirname(topic)) : dirname(engineDir);
const title = LESSON.title || basename(lecture ? topic : lessonDir), film = relative(root, lessonDir).replace(/\\/g, '/');
const shelf = join(root, 'dist');
const product = lecture ? join(shelf, `${basename(topic)} ${title}`.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() + '.html') : join(buildDir, basename(lessonDir) + '.html');
const html = read(join(engineDir, 'template.html'))
  .replaceAll('<!--TITLE-->', esc(title))
  .replace('<!--FILM-->', esc(film))
  .replace('<!--EYEBROW-->', esc(LESSON.eyebrow))
  .replace('<!--SOURCE-->', esc(LESSON.source))
  .replace('<!--STYLE-->', () => `<style>\n${read(join(engineDir, 'player.css'))}</style>`)
  .replace('<!--SCRIPTS-->', () => [
    tag(engineSrc), tag(scriptSrc), tag(`V.setTheme(${JSON.stringify(theme)});`),
    ...(Object.keys(tex.table.f).length ? [tag(`V.tex(${JSON.stringify(tex.table)});`)] : []),
    ...(hook ? [tag(read(hook))] : []),
    ...libs.map(src => tag(src)),
    ...scenes.map(s => tag(s.src)),
    // SPOKEN：每种语言里每句配音要读的文本。没有嵌入配音的句子，朗读器播放时交给本机的配音服务照它现场合成
    tag(`const DURATIONS = ${JSON.stringify(durations)};\nconst AUDIO = ${JSON.stringify(audio)};\nconst SPOKEN = ${JSON.stringify(texts)};`),
    tag(read(join(engineDir, 'player.js'))),
  ].join('\n'));
const outFile = process.env.LEARN_OUT || product;   // LEARN_OUT：截图工具用，各写各的，互不覆盖
mkdirSync(buildDir, { recursive: true }); mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
// 标题改了，成品的文件名跟着变：成品目录里同一部成片留下的旧名字的那一份删掉，一讲只留一个文件
if (lecture && outFile === product) for (const f of readdirSync(shelf).filter(f => f.endsWith('.html') && join(shelf, f) !== product)) {
  const fd = openSync(join(shelf, f), 'r'), head = Buffer.alloc(2048); readSync(fd, head, 0, 2048, 0); closeSync(fd);
  if (head.toString('utf8').includes(`<meta name="film" content="${esc(film)}">`)) rmSync(join(shelf, f));
}

// 解说词清单（给 tts synth）和字幕。公式写成纯文本的近似；朗读文本和字幕不一样的句子另带 tts
writeFileSync(join(buildDir, 'narration.json'), JSON.stringify({ lang: dub, lines: heard.map(l => { const text = V.plain(l.text); return spoken(l) === text.trim() ? { key: l.key, text } : { key: l.key, text, tts: spoken(l) }; }) }, null, 1));
const stamp = t => { const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
writeFileSync(join(buildDir, 'captions.srt'), '﻿' + TL.cues.map((c, i) => `${i + 1}\n${stamp(c.s)} --> ${stamp(c.e)}\n${V.plain(c.show)}\n`).join('\n'));

const mm = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const others = Object.keys(texts).filter(lang => lang !== dub && Object.keys(texts[lang]).length);
console.log(`${outFile}  ${(html.length / 1024).toFixed(0)} KB`);
console.log(`${lines.length} 句，时长 ${mm(TL.duration)}，${voiced ? `嵌入${V.DUB[dub].name}配音 ${voiced} 句` : `配音由朗读器在播放时现场合成（时长按${V.DUB[dub].name}估算）`}，配色 ${theme}`);
if (others.length) console.log(`另带${others.map(lang => V.DUB[lang].name).join('、')}的朗读文本，朗读器换到那种语言的音色时改读它`);
if (tex.rows.length) console.log(`公式 ${tex.rows.length} 条：TeX 排 ${tex.rows.length - fell} 条${tex.ran ? `（这次新排 ${tex.ran} 条，用了 ${tex.seconds.toFixed(1)} 秒）` : tex.rows.length > fell ? '（都读自缓存）' : ''}，后备排版 ${fell} 条，嵌入 ${(JSON.stringify(tex.table).length / 1024).toFixed(0)} KB`);
for (const s of TL.scenes) console.log(`  ${mm(s.s).padStart(5)}  ${String(s.id).padEnd(12)} ${s.title || ''}`);
for (const n of notes) console.log('提示：' + n);
for (const w of warns) console.log('警告：' + w);
for (const p of problems) console.error('错误：' + p);
process.exit(problems.length ? 1 : 0);
