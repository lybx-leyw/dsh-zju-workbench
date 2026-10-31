/**
 * 把还原出来的 TypeScript 源码转成我们的纯 JS 模块。
 *
 * # 三步
 *
 * 1. **TS → JS**：用 esbuild 的 transform（不打包，逐文件转）。
 *    我们仓库是纯 JS、没有 TS 构建链，所以转换发生在**一次性迁移时**，
 *    产物是可直接 import 的 `.js`，之后不再依赖 esbuild。
 *
 * 2. **剥离 Next.js 指令**：`'use client'` 是 RSC 的边界标注，
 *    我们不是 Next.js，留着它会被 esbuild 当普通字符串保留，
 *    徒增噪音。24 个文件里有。
 *
 * 3. **改 import 路径**：
 *      `.tsx` / `.ts` 扩展名 → `.js`
 *      `@openmaic/dsl`      → `dsh-zhiyun-classroom-dsl`
 *      `@openmaic/geometry` → `dsh-zhiyun-classroom-geometry`
 *    后两条是把上游 npm 包名换成仓库里的包名。
 *
 * # 为什么不用 esbuild 的 bundle 模式
 *
 * bundle 会把 48 个文件压成一个 —— 那正是我们现在 vendor 的状态
 * （14 MB 单文件），重构的意义就是要拆开。所以逐文件 transform，
 * 保留模块结构。
 *
 * 用法：
 *   node scripts/fork-ts-sources.mjs --in <dir> --out <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

function parseArgs(argv) {
  const out = { in: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') out.in = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.in || !args.out) {
  console.error('用法: node scripts/fork-ts-sources.mjs --in <dir> --out <dir>');
  process.exit(2);
}

const root = process.cwd();
const inDir = path.isAbsolute(args.in) ? args.in : path.join(root, args.in);
const outDir = path.isAbsolute(args.out) ? args.out : path.join(root, args.out);

/** 递归找 .ts / .tsx。 */
function findTs(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findTs(full, acc);
    else if (/\.tsx?$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/**
 * 把上游 npm 包名换成仓库内的包名。
 *
 * `@openmaic/dsl` / `@openmaic/geometry` 我们已经 vendor 成独立包，
 * 重构后它们也是本仓的模块 —— 引用必须换成包名，否则构建时找不到。
 */
const PACKAGE_REWRITE = [
  [/from\s+['"]@openmaic\/dsl['"]/g, "from 'dsh-zhiyun-classroom-dsl'"],
  [/from\s+['"]@openmaic\/geometry['"]/g, "from 'dsh-zhiyun-classroom-geometry'"],
  [/from\s+['"]@openmaic\/renderer['"]/g, "from 'dsh-zhiyun-classroom-renderer'"],
];

const files = findTs(inDir);
let converted = 0;
const failures = [];

for (const file of files) {
  const rel = path.relative(inDir, file);
  const outRel = rel.replace(/\.tsx?$/, '.js');
  const dest = path.join(outDir, outRel);

  let source = fs.readFileSync(file, 'utf8');

  // 1) 剥 Next.js 指令
  source = source.replace(/^\s*['"]use client['"];?\s*\n/, '');

  // 2) 改包名
  for (const [re, to] of PACKAGE_REWRITE) source = source.replace(re, to);

  // 3) TS → JS
  let js;
  try {
    const result = await esbuild.transform(source, {
      loader: rel.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'esm',
      target: 'es2022',
      jsx: 'automatic',
      // 不做类型检查（我们没装 tsc），只做语法降级与类型擦除
      sourcefile: rel,
    });
    js = result.code;
  } catch (error) {
    failures.push(`${rel}: ${error.message}`);
    continue;
  }

  // 4) 相对 import 补 .js 扩展名（ESM 在浏览器/Node 下都要求显式扩展名）
  js = js.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (m, pre, spec, post) => {
    if (/\.(js|json|css)$/.test(spec)) return m;
    return `${pre}${spec}.js${post}`;
  });

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, js);
  converted += 1;
}

console.log(`${inDir} -> ${outDir}`);
console.log(`  源文件: ${files.length} 个`);
console.log(`  已转换: ${converted} 个`);
if (failures.length) {
  console.log(`  失败: ${failures.length} 个`);
  for (const f of failures.slice(0, 10)) console.log(`    ${f}`);
  process.exit(1);
}
