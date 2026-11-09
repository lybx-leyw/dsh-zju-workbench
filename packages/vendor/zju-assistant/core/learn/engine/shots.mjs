// 把指定句子的画面截下来，拼成总览图，用来检查画面。不需要预览服务，也不占用浏览器面板。
//   node engine/shots.mjs <这一集的目录> --scene <场景id>          一个场景的每一句
//   node engine/shots.mjs <这一集的目录> --keys k1,k2,k5 --cols 2   指定的几句，格子大一点
//   node engine/shots.mjs <这一集的目录> --scene <场景id> --mid     每句再加一帧说到一半时的样子
// 默认截的是每句"说完、下一句开始之前"的那一帧，也就是这一句的动画都做完之后的画面。
// --keys 里可以写 k3@mid（说到一半）或 k3@1.2（这句开始后 1.2 秒）。
// 先自动打包，再用本机 Edge 的无界面模式把总览页截下来。图存在 <这一集>/build/shots/ 下，每格上方标着句子编号和字幕。
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const engineDir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf('--' + name); return i < 0 ? undefined : args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true; };
const lessonDir = resolve(args[0] || '');
if (!args[0] || !existsSync(join(lessonDir, 'script.js')) || (!flag('scene') && !flag('keys') && !flag('all'))) {
  console.error('用法: node engine/shots.mjs <这一集的目录> --scene <场景id> | --keys k1,k2 | --all  [--mid] [--cols 1|2|3]');
  process.exit(2);
}

// 打包到自己专用的文件里：几个场景同时各查各的时，不会读到别人写了一半的成品
const outDir = join(lessonDir, 'build', 'shots');
mkdirSync(outDir, { recursive: true });
const bundle = join(outDir, `.build-${process.pid}.html`);
const built = spawnSync(process.execPath, [join(engineDir, 'build.mjs'), lessonDir], { encoding: 'utf8', env: { ...process.env, LEARN_OUT: bundle } });
const said = built.stdout.split('\n').filter(l => /^(提示|警告|错误)/.test(l));
process.stdout.write(said.join('\n') + (said.length || built.stderr ? '\n' : ''));
if (built.stderr) process.stderr.write(built.stderr);
if (!existsSync(bundle)) { console.error('打包没有成功，截不了'); process.exit(2); }

const { SCRIPT } = new Function(`${readFileSync(join(lessonDir, 'script.js'), 'utf8')}\nreturn { SCRIPT };`)();
let specs, tag;
if (flag('keys')) { specs = String(flag('keys')).split(',').map(s => s.trim()).filter(Boolean); tag = 'keys-' + specs.join('_').replace(/[^\w.-]/g, '-').slice(0, 60); }
else {
  const scenes = flag('all') ? SCRIPT : SCRIPT.filter(sc => sc.id === flag('scene'));
  if (!scenes.length) { console.error(`没有场景 ${flag('scene')}。可用：${SCRIPT.map(sc => sc.id).join(' ')}`); process.exit(2); }
  const keys = scenes.flatMap(sc => sc.lines.filter(l => l[1]).map(l => l[0]));
  specs = flag('mid') ? keys.flatMap(k => [k + '@mid', k]) : keys;
  tag = (flag('all') ? 'all' : String(flag('scene'))) + (flag('mid') ? '-mid' : '');   // 文件名带上截法，几种截法的图互不覆盖
}
const cols = Math.max(1, Math.min(3, Number(flag('cols')) || 3)), rows = cols === 1 ? 1 : cols === 2 ? 2 : 3;
const TW = 1920 / cols, TH = 1080 / cols, BAR = 44;

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].find(existsSync);
if (!edge) { console.error('找不到 Edge 或 Chrome'); process.exit(2); }

// 每一格都是成品本身开在那一刻的样子（一个内嵌的页面），所以画在画布上的、场景自带的图层里的，都截得到。
// 时刻在这里按成品自己的算法排出来，写进每一格的网址（?t=秒）。
const html = readFileSync(bundle, 'utf8');
const { V, LESSON } = new Function(`${readFileSync(join(engineDir, 'engine.js'), 'utf8')}\n${readFileSync(join(lessonDir, 'script.js'), 'utf8')}\nreturn { V, LESSON: typeof LESSON === 'undefined' ? {} : LESSON };`)();
const durations = JSON.parse((/const DURATIONS = (\{.*?\});/.exec(html) || [0, '{}'])[1]);
const TL = V.buildTimeline(SCRIPT, durations, V.DUB[LESSON.dub] ? LESSON.dub : V.DUB_DEFAULT);
const when = spec => {
  const [key, mode] = spec.split('@'), i = TL.cues.findIndex(c => c.key === key);
  if (i < 0) return null;
  const c = TL.cues[i], nx = TL.cues[i + 1], sc = TL.scenes.find(s => s.id === c.scene);
  if (mode === 'mid') return (c.s + c.e) / 2;
  if (mode !== undefined) return c.s + Number(mode);
  return (nx && nx.scene === c.scene ? nx.s : sc.e - sc.fadeOut) - 0.03;
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// 浏览器的用户目录放在系统的临时目录里：它有几百个文件夹，浏览器退出后还会占一会儿，常常删不干净，不能留在这一集的目录下
const profile = join(tmpdir(), `learn-shots-${process.pid}`);
const tidy = () => { for (const f of [profile, ...readdirSync(outDir).filter(f => /^\.(build|sheet)-\d+/.test(f)).map(f => join(outDir, f))]) try { rmSync(f, { recursive: true, force: true }); } catch { /* 浏览器还占着 */ } };
process.on('exit', tidy);

const per = cols * rows, files = [];
for (let n = 0; n * per < specs.length; n++) {
  const list = specs.slice(n * per, (n + 1) * per), height = Math.ceil(list.length / cols) * (TH + BAR);
  const cells = list.map((spec, i) => {
    const t = when(spec), cue = TL.cues.find(c => c.key === spec.split('@')[0]), at = `left:${(i % cols) * TW}px;top:${Math.floor(i / cols) * (TH + BAR)}px`;
    return t === null ? `<div class="cell" style="${at}"><div class="bar" style="color:#b00">${esc(spec)}　没有这一句</div></div>`
      : `<div class="cell" style="${at}"><div class="bar">${esc(spec)}　${esc(V.plain(cue.show))}</div><div class="shot"><iframe src="${basename(bundle)}?bare=1&amp;t=${t.toFixed(3)}"></iframe></div></div>`;
  });
  const tmp = join(outDir, `.sheet-${process.pid}-${n}.html`), out = join(outDir, `${tag}-${String(n + 1).padStart(2, '0')}.png`);
  writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;overflow:hidden;font:20px "Microsoft YaHei UI","Microsoft YaHei",sans-serif}
.cell{position:absolute;width:${TW}px}.bar{height:${BAR}px;line-height:${BAR}px;padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.shot{width:${TW}px;height:${TH}px;overflow:hidden;box-shadow:inset 0 0 0 1px #bbb}
iframe{width:1920px;height:1080px;border:0;transform:scale(${1 / cols});transform-origin:0 0}
</style>${cells.join('\n')}`);
  rmSync(out, { force: true });
  // 用自己的用户目录：机器上开着 Edge 时，不这样新进程会把活儿交给已开的那个。即使这样它也可能立刻返回，图过一会儿才写好，所以等文件出现
  spawnSync(edge, ['--headless=new', '--disable-gpu', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=1920,${Math.max(1080, height)}`,
    '--virtual-time-budget=8000', `--user-data-dir=${profile}`, `--screenshot=${out}`, pathToFileURL(tmp).href], { encoding: 'utf8' });
  for (let i = 0; i < 150 && !existsSync(out); i++) nap(200);
  nap(300);
  if (existsSync(out)) { files.push(out); console.log(`${out}  （${list[0]} … ${list[list.length - 1]}，${list.length} 帧）`); }
  else console.error(`没截到：${list.join(' ')}`);
}
process.exit(files.length ? 0 : 1);
