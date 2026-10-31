/**
 * 题库题数只数在用的题，弃用的不计入。
 *
 * # 锁住的问题（2026-10-31）
 *
 * 同一屏上并存两个题数读数，口径不一致：
 *
 *   顶部导航「历史题库」 ← state.questions.length（原始数组，含已弃用）
 *   右侧统计「题目」     ← coverage.questions（后端已过滤 rejected）
 *
 * 真实数据是 53 道题里 44 道已弃用，于是界面显示「历史题库 53 / 题目 9」
 * —— 两个数字打架，用户不知道哪个算数。
 *
 * 弃用是用户主动做的决定，不该继续占据题量读数。所以统一成「只数在用的」。
 *
 * 注意：不能改 state.questions 本身 —— 历史题库页要用它分「在用 / 已弃用」两栏。
 *
 * 用法：node tests/question-count.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('.');
const load = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

const PAGE = 'packages/dsh-zhiyun-page-quiz/src/question-bank.jsx';
const pageSource = fs.readFileSync(path.resolve(PAGE), 'utf8');

test('导航角标只数在用的题（不取原始数组长度）', () => {
  // 取 tabs 定义那一整段（含它前面的 activeCount 计算）
  const idx = pageSource.indexOf('const tabs=');
  assert.ok(idx > 0, '找不到 tabs 定义');
  const seg = pageSource.slice(Math.max(0, idx - 600), idx + 120);
  assert.ok(
    !/String\(state\.questions\.length\)/.test(seg),
    '不能直接用 state.questions.length —— 那是含弃用题的原始数组',
  );
  assert.match(seg, /activeCount|status\s*!==\s*'rejected'/, '应当先过滤掉 rejected 再计数');
});

test('过滤表达式与后端 coverage 口径一致', () => {
  // 后端 coverageOf 用的是 q.status !== 'rejected'
  const backend = fs.readFileSync(path.resolve('packages/dsh-zhiyun-core-study/src/question-bank.js'), 'utf8');
  assert.match(backend, /filter\(q\s*=>\s*q\.status\s*!==\s*'rejected'\)/, '后端口径');
  assert.match(pageSource, /status\s*!==\s*'rejected'/, '前端口径必须相同');
});

test('state.questions 本身不过滤（历史页要靠它分两栏）', () => {
  const backend = fs.readFileSync(path.resolve('packages/dsh-zhiyun-core-study/src/question-bank.js'), 'utf8');
  // bank-load 返回的 questions 必须仍是全量
  const idx = backend.indexOf("if (method==='bank-load')");
  assert.ok(idx > 0);
  const seg = backend.slice(idx, idx + 260);
  assert.match(seg, /questions:bank\.questions/, 'bank-load 应返回全量，否则历史页看不到已弃用的题');
  assert.ok(
    !/questions:bank\.questions\.filter/.test(seg),
    '不要在数据源处过滤 —— 会让「已弃用」这一栏永远为空',
  );
});

test('真实数据校验：过滤后计数小于全量', async () => {
  const fsx = await import('node:fs');
  const raw = JSON.parse(fsx.readFileSync('.runtime/home/storages/zhiyun_knowledge.json', 'utf8'));
  const bank = Object.values(raw.tables?.question_banks ?? {})[0];
  if (!bank?.questions?.length) {
    console.log('# 跳过：本地题库为空');
    return;
  }
  const all = bank.questions.length;
  const active = bank.questions.filter(q => q.status !== 'rejected').length;
  assert.ok(active <= all, '过滤后不可能变多');
  console.log(`# 真实题库：全量 ${all} 道，在用 ${active} 道，弃用 ${all - active} 道`);
});

test('历史题库页仍然分别显示在用与弃用', () => {
  const src = fs.readFileSync(path.resolve('packages/dsh-zhiyun-page-quiz/src/question-history.jsx'), 'utf8');
  assert.match(src, /道在用/, '历史页要显示在用数');
  assert.match(src, /道已弃用/, '历史页要显示弃用数');
});
