/**
 * 新链（core-question）质量对照：用与 vendor 基线**完全相同的输入**跑一遍。
 *
 * 为什么必须同输入：基线来自 dt-run-1，它用的是 nativeQuizContract 生成的
 * lecture + input + config。如果新链自己换一套讲义切法或提示词，
 * 分数差异就分不清是「实现更好」还是「题目更容易」。
 *
 * 所以这里：
 *   - 读同一个 source.json（points 与基线一致）
 *   - 调同一个 nativeQuizContract（生成同样的 input 与 config）
 *   - 走新链 runDeepQuestion
 *   - 产出 --out 下的 questions.json，结构与基线一致，可直接送外部评分器
 *
 * 用法：
 *   node scripts/quiz_bench/new-chain-quality.mjs <source.json> <count> <out.json>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceFile, countArg, outFile] = process.argv.slice(2);
if (!sourceFile || !outFile) {
  throw new Error('用法：node scripts/quiz_bench/new-chain-quality.mjs <source.json> <count> <out.json>');
}
const count = Number(countArg ?? 3);
const root = process.cwd();
const load = rel => import(pathToFileURL(path.join(root, rel)).href);

const { runDeepQuestion } = await load('packages/dsh-zhiyun-core-question/src/index.js');
const { createLlmClient } = await load('packages/dsh-zhiyun-core-llm/src/index.js');
const { wireLabelClassifier } = await load('packages/dsh-zhiyun-core-llm/src/index.js');
const { bindLabelClassifier } = await load('packages/dsh-zhiyun-core-tool/src/loop.js');
const { createLectureTools } = await load('packages/dsh-zhiyun-core-lecture-tools/src/index.js');
const { createToolRegistry } = await load('packages/dsh-zhiyun-core-tool/src/index.js');
const { nativeQuizContract } = await load('packages/dsh-zhiyun-core-study/src/deeptutor-quiz.js');

// 标签识别统一到 core-llm 那一份，避免两份实现漂移导致协议死循环
wireLabelClassifier(bindLabelClassifier);

const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
const points = source.points ?? [];
if (!points.length) throw new Error('source.json 里没有 points');

const envText = await fs.readFile(path.join(root, '.env'), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).flatMap(line => {
  const i = line.indexOf('=');
  return i > 0 ? [[line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]] : [];
}));

// 与基线同构：同一个 contract 函数、同样的参数
const contract = nativeQuizContract({
  title: source.title,
  points,
  count,
  type: 'mcq',
  strategy: 'understand',
  difficulty: 'basic',
});

const llm = createLlmClient({
  provider: 'deepseek',
  model: env.ModelName,
  baseUrl: env.BaseURL,
  apiKey: env.APIkey,
});

const registry = createToolRegistry();
for (const tool of createLectureTools({ lecture: contract.lecture })) registry.register(tool);

console.log(JSON.stringify({
  event: 'start',
  source: sourceFile,
  title: source.title,
  points: points.length,
  count,
}, null, 0));

const started = Date.now();
const result = await runDeepQuestion({
  lecture: contract.lecture,
  count,
  type: 'choice',
  difficulty: 'easy',
  llm,
  tools: registry,
  onEvent: e => console.log(JSON.stringify({ event: 'stage', stage: e.stage, at: Date.now() - started })),
  config: {
    language: 'zh',
    // 与 contract 一致：题型与难度都从 contract 取，保证同口径
    questionTypes: ['choice'],
    // ⚠️ 不能传 contract.input：那只是「依据所选讲义」的任务指令，不含讲义正文/知识点，
    // 模型会因此瞎编通用逻辑题（2026-10-30 实测：vision 出成生物题、psyexp 出成考场规定）。
    // 必须让 core-question 用它自己的 buildUserMessage(lecture)，那里会列出全部知识点，
    // 工具也能据此读到讲义原文。
    budgets: contract.config,
  },
});

const elapsed = Date.now() - started;

// 转成与基线 questions.json 同构的形状，供外部评分器直接消费
const questions = (result.questions ?? []).map((q, i) => ({
  type: q.type === 'choice' ? 'mcq' : q.type,
  stem: q.stem,
  choices: Array.isArray(q.choices) && q.choices.length
    ? q.choices
    : Object.entries(q.options ?? {}).map(([label, text]) => ({ label, text })),
  answer: q.answer,
  explanation: q.explanation ?? '',
  topic: q.topic ?? '',
  difficulty: q.difficulty ?? 'easy',
  source: 'core-question',
  index: i + 1,
}));

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, JSON.stringify(questions, null, 2));

console.log(JSON.stringify({
  event: 'done',
  out: outFile,
  requested: count,
  produced: questions.length,
  elapsedMs: elapsed,
  usage: result.usage ?? null,
  /** 占位题数：修复失败仍出题的产物，评分器会当真实题打低分 */
  placeholders: questions.filter(q => q.answer === 'N/A' || String(q.stem).includes('[Generation failed]')).length,
}, null, 0));
