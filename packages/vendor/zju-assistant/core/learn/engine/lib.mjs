// 把外部库做成单个浏览器文件，放进这一集的 lib/；打包时它们排在场景前面，场景里直接用全局名。
//   node engine/lib.mjs lessons/<主题>/film gsap three                 常用的两个，全局名是 gsap 和 THREE
//   node engine/lib.mjs lessons/<主题>/film <包名或入口文件>=<全局名>     别的库；或者自己写一个入口文件，把要用的东西 export 出来（比如 three 再带上几个 addons）
// gsap 和 three：仓库里装在引擎自带的 engine/vendor；dsh 插件不带，「课程讲解」打开时下载到插件的数据目录，位置在环境变量 LEARN_LIBS。
// 别的库装在这一集自己的 build/vendor 下：npm install --prefix lessons/<主题>/film/build/vendor <包名>
// 不往 engine/vendor 里装：引擎的目录是应用装着的地方，装在 C:\Program Files 下面写不进去，写得进去时升级也会把它整个换掉。
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const bundled = join(dirname(fileURLToPath(import.meta.url)), 'vendor', 'node_modules');
// 放 gsap 和 three 的地方，先看下载的那一份。
const shared = [process.env.LEARN_LIBS, bundled].filter(dir => dir && existsSync(dir));
const [film, ...wants] = process.argv.slice(2);
if (!film || !wants.length) { console.error('用法: node engine/lib.mjs lessons/<主题>/film gsap three [包名或入口文件=全局名 ...]'); process.exit(1); }
// 这一集的目录要已经在：目录给错了（比如当前目录不是讲解目录）时，不在别处新建一个。
if (!existsSync(resolve(film))) { console.error(`找不到这一集的目录：${resolve(film)}\n在讲解目录里运行，或者把这一集的目录写成完整路径。`); process.exit(1); }
const out = join(resolve(film), 'lib'), own = join(resolve(film), 'build', 'vendor', 'node_modules'), KNOWN = { three: 'THREE' };
const missing = name => `找不到 ${name}：它不随插件带，打开「课程讲解」时自动下载。请用户到插件页「课程讲解」的配置里看「动画库」下载好了没有，没下成就在那里点「安装」。`;
mkdirSync(out, { recursive: true });
const said = file => console.log(`${file}  ${(statSync(file).size / 1024).toFixed(0)} KB`);
// 仓库里用引擎自带的 esbuild；从 npm 装的 dsh 插件带的是 esbuild-wasm（没有安装脚本，插件页不用为它批准构建），用法一样，慢一点。
const require = createRequire(join(bundled, 'x.js'));
const esbuild = (() => { try { return require('esbuild'); } catch { return require('esbuild-wasm'); } })();
for (const want of wants) {
  const [what, name = KNOWN[what]] = want.split('=');
  if (what === 'gsap') {     // GSAP 自带浏览器版，全局名 gsap
    const from = shared.map(dir => join(dir, 'gsap', 'dist', 'gsap.min.js')).find(existsSync);
    if (!from) { console.error(missing('gsap')); process.exit(1); }
    const file = join(out, 'gsap.js'); copyFileSync(from, file); said(file); continue;
  }
  if (!name) { console.error(`${what}：要写成 ${what}=全局名`); process.exit(1); }
  if (what === 'three' && !shared.some(dir => existsSync(join(dir, 'three', 'package.json')))) { console.error(missing('three')); process.exit(1); }
  const file = join(out, basename(what).replace(/\.m?js$/, '') + '.js'), entry = existsSync(what);
  // 包先在这一集自己装的里面找，再找下载的和引擎自带的。
  esbuild.buildSync({
    ...(entry ? { entryPoints: [resolve(what)] } : { stdin: { contents: `export * from ${JSON.stringify(what)};`, resolveDir: shared[0] ?? own } }),
    bundle: true, format: 'iife', globalName: name, minify: true, target: 'es2020', legalComments: 'none', nodePaths: [own, ...shared], outfile: file, logLevel: 'warning',
  });
  said(file);
}
