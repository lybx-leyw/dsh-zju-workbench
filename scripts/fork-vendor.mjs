/**
 * 从任意 vendor 目录的 sourcemap 里提取原始 TypeScript 源码。
 *
 * 用法：
 *   node scripts/fork-vendor.mjs --vendor <dir> --out <dir>
 *
 * 例：
 *   node scripts/fork-vendor.mjs \
 *     --vendor packages/dsh-zhiyun-classroom-dsl/vendor \
 *     --out .verify-scratch/recovered/dsl
 *
 * # 为什么要这个脚本
 *
 * classroom 系列的 4 个 vendor 内核（dsl / geometry / renderer / media）
 * 都是上游发布产物，但都带 `.js.map` 且启用 `sourcesContent` ——
 * 每份 map 里存着对应 `.ts` / `.tsx` 的完整原文。
 * 重构（把 vendor 变成真正的 src 模块）靠它把源码取回来，
 * 不需要重新 clone 上游。
 */
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = { vendor: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vendor') out.vendor = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

const { vendor, out } = parseArgs(process.argv.slice(2));
if (!vendor || !out) {
  console.error('用法: node scripts/fork-vendor.mjs --vendor <dir> --out <dir>');
  process.exit(2);
}

const root = process.cwd();
const vendorDir = path.isAbsolute(vendor) ? vendor : path.join(root, vendor);
const outDir = path.isAbsolute(out) ? out : path.join(root, out);

function findMaps(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findMaps(full, acc);
    else if (entry.name.endsWith('.js.map')) acc.push(full);
  }
  return acc;
}

const maps = findMaps(vendorDir);
const seen = new Map(); // rel -> content（同一文件出现在多份 map 时以先到为准）
let parseFailed = 0;

for (const mapFile of maps) {
  let map;
  try {
    map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  } catch {
    parseFailed += 1;
    continue;
  }
  const sources = map.sources ?? [];
  const contents = map.sourcesContent ?? [];

  for (let i = 0; i < sources.length; i++) {
    const content = contents[i];
    if (!content) continue;

    // sources 形如 '../src/foo/Bar.tsx' 或 '../../src/a.ts'
    const m = sources[i].match(/\/src\/(.+)$/) ?? sources[i].match(/^src\/(.+)$/);
    const rel = m ? m[1] : path.basename(sources[i]);
    if (!seen.has(rel)) seen.set(rel, content);
  }
}

for (const [rel, content] of seen) {
  const dest = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
}

const sorted = [...seen.keys()].sort();
console.log(`${vendor} -> ${out}`);
console.log(`  map 文件: ${maps.length} 个${parseFailed ? `（${parseFailed} 个解析失败）` : ''}`);
console.log(`  还原源文件: ${sorted.length} 个`);

const groups = new Map();
for (const rel of sorted) {
  const top = rel.includes('/') ? rel.split('/')[0] : '(根)';
  groups.set(top, (groups.get(top) ?? 0) + 1);
}
for (const [g, n] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(3)}  ${g}`);
}

if (sorted.length === 0) {
  console.error('  没有还原出任何源文件 —— 该 vendor 可能没开 sourcesContent');
  process.exit(1);
}
