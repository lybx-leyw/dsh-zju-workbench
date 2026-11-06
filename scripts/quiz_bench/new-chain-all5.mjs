/**
 * 新链 15 题质量对照：5 门课各 3 题，输入与 dt-run-1 基线完全一致。
 *
 * 逐门课串行跑，每门前打印进度。任一门失败不中断其它门，
 * 最后汇总产出数与占位题数——占位题会被评分器当真实题打低分，
 * 必须单独报出来，否则会把「生成失败」误读成「质量差」。
 *
 * 用法：node scripts/quiz_bench/new-chain-all5.mjs [outDir]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const outDir = process.argv[2] ?? 'artifacts/quiz-all5/new-chain';
const CASES = ['prob', 'physics', 'vision', 'dsa', 'psyexp'];
const COUNT = 3;

const runOne = code => new Promise(resolve => {
  const source = `artifacts/quiz-all5/dt-run-1/${code}-source.json`;
  const out = `${outDir}/${code}.json`;
  const child = spawn(process.execPath, [
    'scripts/quiz_bench/new-chain-quality.mjs', source, String(COUNT), out,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  child.on('exit', exitCode => {
    let done = null;
    for (const line of stdout.trim().split('\n')) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.event === 'done') done = parsed;
      } catch { /* 非 JSON 行忽略 */ }
    }
    resolve({ code, exitCode, done, stderr: stderr.slice(-600) });
  });
});

await fs.mkdir(outDir, { recursive: true });
const results = [];
for (const code of CASES) {
  process.stdout.write(`[${code}] 跑 ${COUNT} 题... `);
  const row = await runOne(code);
  results.push(row);
  if (row.done) {
    console.log(`产出 ${row.done.produced}/${COUNT}｜${row.done.elapsedMs}ms｜调用 ${row.done.usage?.modelCalls ?? '?'}｜占位 ${row.done.placeholders}`);
  } else {
    console.log(`失败（exit ${row.exitCode}）`);
    if (row.stderr) console.log('  ', row.stderr.replace(/\n/g, ' ').slice(0, 300));
  }
}

const totalProduced = results.reduce((n, r) => n + (r.done?.produced ?? 0), 0);
const totalPlaceholder = results.reduce((n, r) => n + (r.done?.placeholders ?? 0), 0);
const totalCalls = results.reduce((n, r) => n + (r.done?.usage?.modelCalls ?? 0), 0);

// 合并成一个 questions.json，供外部评分器一次评完
const merged = [];
for (const r of results) {
  if (!r.done) continue;
  try {
    const rows = JSON.parse(await fs.readFile(r.done.out, 'utf8'));
    for (const q of rows) merged.push({ ...q, course: r.code });
  } catch { /* 该门没产出就跳过 */ }
}
await fs.writeFile(path.join(outDir, 'questions.json'), JSON.stringify(merged, null, 2));

console.log('='.repeat(60));
console.log(JSON.stringify({
  produced: totalProduced,
  requested: CASES.length * COUNT,
  placeholders: totalPlaceholder,
  modelCalls: totalCalls,
  mergedOut: path.join(outDir, 'questions.json'),
  failed: results.filter(r => !r.done).map(r => r.code),
}, null, 2));
