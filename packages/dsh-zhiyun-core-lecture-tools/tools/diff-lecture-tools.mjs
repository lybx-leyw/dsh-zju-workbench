/**
 * JS 输出 vs Python 上游基线逐字比对。**这是"文案没漂"的机械证明**，进 CI 更好。
 *
 * 用法（包根）：
 *   python tools/gen-lecture-baseline.py && node tools/diff-lecture-tools.mjs
 * 期望输出 `ALL MATCH`。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
import { renderManifestReport } from '../src/kb-files.js';
import { runQuestionBank, createBankStore } from '../src/question-bank.js';
import { createReadSourceHandler } from '../src/read-source.js';

const baseline = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'tests/fixtures/lecture-tool-baseline.json'), 'utf8'));

const ENTRIES = [
  { id: 1, question: '牛顿第二定律 F=ma 中 a 表示什么？', userAnswer: '加速度', correctAnswer: '加速度', isCorrect: true, bookmarked: true, categories: [{ name: '力学基础' }], createdAt: 1 },
  { id: 2, question: '动量守恒的成立条件是什么？' + '长'.repeat(200), userAnswer: '', correctAnswer: '系统所受合外力为零', isCorrect: false, bookmarked: false, categories: [], createdAt: 2 },
  { id: 3, question: '角动量守恒的判据？', userAnswer: '合外力矩为零', correctAnswer: '合外力矩为零', isCorrect: true, bookmarked: false, categories: [{ name: '力学基础' }], createdAt: 3 },
];

const store = createBankStore(ENTRIES);
const empty = createBankStore([]);
const qbCases = {
  overview: [{ action: 'overview' }, store],
  overview_empty: [{ action: 'overview' }, empty],
  list_all: [{ action: 'list' }, store],
  list_wrong: [{ action: 'list', filter: 'wrong' }, store],
  list_uncategorized: [{ action: 'list', filter: 'uncategorized' }, store],
  list_bookmarked: [{ action: 'list', filter: 'bookmarked' }, store],
  list_category: [{ action: 'list', category: '力学基础' }, store],
  list_search: [{ action: 'list', search: '动量' }, store],
  list_limit: [{ action: 'list', limit: 1 }, store],
  list_bad_filter: [{ action: 'list', filter: 'nope' }, store],
  list_missing_category: [{ action: 'list', category: '不存在' }, store],
  bad_action: [{ action: 'nope' }, store],
};

let fails = 0;
for (const [label, [args, s]] of Object.entries(qbCases)) {
  const got = await runQuestionBank(args, s, { language: 'en' });
  const want = baseline.questionBank[label];
  const gotText = got.ok ? got.text : got.error;
  const wantText = want.ok ? want.text : want.error;
  if (got.ok !== want.ok || gotText !== wantText) {
    fails += 1;
    console.log(`MISMATCH questionBank.${label}`);
    console.log('  want:', JSON.stringify(wantText?.slice(0, 200)));
    console.log('  got :', JSON.stringify(gotText?.slice(0, 200)));
  }
}

const docs = [
  { name: '第一章 力学/牛顿第二定律', size: 0 },
  { name: '第一章 力学/动量守恒', size: 0 },
  { name: '第二章 电磁学/库仑定律', size: 1234 },
];
const kbCases = {};
for (const language of ['en', 'zh']) {
  const base = { name: 'lecture' };
  kbCases[`all_${language}`] = [{ ...base, total: 3, matched: 3, documents: docs }, { language }];
  kbCases[`pattern_${language}`] = [{ ...base, total: 3, matched: 1, documents: [docs[2]], pattern: '库仑*' }, { language }];
  kbCases[`no_match_${language}`] = [{ ...base, total: 3, matched: 0, documents: [], pattern: '不存在' }, { language }];
  kbCases[`omitted_${language}`] = [{ ...base, total: 3, matched: 3, documents: [docs[0]] }, { language }];
  kbCases[`empty_${language}`] = [{ ...base, total: 0, matched: 0, documents: [] }, { language }];
}
for (const [label, [manifest, opts]] of Object.entries(kbCases)) {
  const got = renderManifestReport(manifest, opts);
  const want = baseline.kbFiles[label];
  if (got !== want) {
    fails += 1;
    console.log(`MISMATCH kbFiles.${label}`);
    console.log('  want:', JSON.stringify(want));
    console.log('  got :', JSON.stringify(got));
  }
}

const readCases = {
  single_auto_id: [{ sources: new Map([['at-1', { text: '只有一份来源的正文', kind: 'block', title: 'x' }]]) }, {}],
  multiple_missing_id: [{ sources: new Map([['t1-1', { text: '第一份' }], ['t1-2', { text: '第二份' }]]) }, {}],
  unknown_id: [{ sources: new Map([['t1-1', { text: '第一份' }], ['t1-2', { text: '第二份' }]]) }, { source_id: 't9-9' }],
  no_sources: [{ sources: new Map() }, {}],
  hit: [{ sources: new Map([['t1-1', { text: '第一份' }], ['t1-2', { text: '第二份' }]]) }, { source_id: 't1-2' }],
};
for (const [label, [opts, args]] of Object.entries(readCases)) {
  const handler = createReadSourceHandler(opts);
  const got = await handler(args);
  const want = baseline.readSource[label];
  const gotText = got.ok ? got.result.content : got.error;
  if (got.ok !== want.success || gotText !== want.content) {
    fails += 1;
    console.log(`MISMATCH readSource.${label}`);
    console.log('  want:', JSON.stringify(want.content));
    console.log('  got :', JSON.stringify(gotText));
  }
}

console.log(fails === 0 ? 'ALL MATCH' : `${fails} mismatches`);
