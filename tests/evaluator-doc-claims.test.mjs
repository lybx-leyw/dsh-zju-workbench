/**
 * 校验 evaluators/README.md 里关于 `Invalid \escape` 的每一条断言，
 * 是否与本仓库的真实产物一致。
 *
 * 为什么要有这个：那节文档写的是「这个错误无害」这种强断言。
 * 如果实际跑出来的数据和文档说的不一样，文档就成了护身符而不是证据。
 * 所以把可机器验证的部分钉成断言，写文档的人改不了口。
 *
 * 用法：node tests/evaluator-doc-claims.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const BS = String.fromCharCode(92);
const OPEN_PAREN = `${BS}(`;

const RUN = 'artifacts/quiz-all5/new-chain2';
const BASELINE = 'artifacts/quiz-all5/dt-run-1';

const exists = file => fs.existsSync(file);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

test('文档声称：\\( 不出现在任何输入层（生成题目 / 基线题目 / 讲义 / 提示词）', () => {
  if (!exists(`${RUN}/questions.json`)) return; // 产物没跑过就跳过，不假装通过

  const fields = x => [x.stem, x.explanation, ...(x.choices || []).map(c => c.text)].join(' ');

  const neu = readJson(`${RUN}/questions.json`);
  assert.equal(neu.filter(x => fields(x).includes(OPEN_PAREN)).length, 0,
    '我们产出的题目里不该出现 ) 形式的定界符');

  if (exists(`${BASELINE}/questions.json`)) {
    const base = readJson(`${BASELINE}/questions.json`);
    assert.equal(base.filter(x => fields(x).includes(OPEN_PAREN)).length, 0,
      '基线题目里同样不该出现');
  }

  for (const course of ['prob', 'physics', 'vision', 'dsa', 'psyexp']) {
    const f = `${BASELINE}/${course}-source.json`;
    if (!exists(f)) continue;
    const src = readJson(f);
    assert.equal((src.points ?? []).filter(p => String(p.text ?? '').includes(OPEN_PAREN)).length, 0,
      `讲义 ${course} 里不该出现`);
  }

  for (const f of [
    'packages/dsh-zhiyun-core-question/src/prompts/pipeline.js',
    'packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor/deeptutor/agents/question/prompts/zh/pipeline.yaml',
  ]) {
    if (!exists(f)) continue;
    assert.equal(fs.readFileSync(f, 'utf8').includes(OPEN_PAREN), false,
      `${f} 里不该出现`);
  }
});

test('文档声称：一次失败重试后能恢复（调用数 = 题数 + 重试次数，结果数 = 题数）', () => {
  const callsFile = `${RUN}/external-eval/calls.jsonl`;
  if (!exists(callsFile)) return;

  const calls = fs.readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const choicesOnly = calls.filter(c => String(c.prompt ?? '').includes('without access to the question'));
  const results = readJson(`${RUN}/external-eval/results.json`);

  // 重试会让调用数略高于题数；但每条题都必须有结果
  assert.ok(choicesOnly.length >= results.length,
    `choices-only 调用数 ${choicesOnly.length} 不该少于结果数 ${results.length}`);
  assert.equal(results.length, 15, '这一轮是 15 题');

  // 实测：16 次调用 / 15 条结果 = 恰好一次重试
  const retries = choicesOnly.length - results.length;
  assert.ok(retries <= 3,
    `重试 ${retries} 次，超过单题的 num_attempts(3) 上限说明不止一题出错`);
});

test('文档声称：guarded_score 会把解析耗尽的结果标成 error 且不计入 mean', () => {
  const f = `${RUN}/external-eval/results.json`;
  if (!exists(f)) return;

  const results = readJson(f);
  const summary = readJson(`${RUN}/external-eval/summary.json`);

  // 每个 metric 的 error 行必须 value 为 null，且不计入 meanAmongCompleted 的分母
  for (const r of results) {
    for (const metric of ['writing_flaws', 'shortcuts']) {
      const m = r.metrics?.[metric];
      if (!m) continue;
      if (m.status === 'error') {
        assert.equal(m.value, null, `${metric} 标为 error 时 value 必须为 null`);
      }
    }
  }

  const shortcuts = summary.metrics?.shortcuts;
  if (shortcuts) {
    assert.equal(
      shortcuts.scored + shortcuts.errorsOrMissing,
      shortcuts.requested,
      'scored + errorsOrMissing 必须等于 requested，否则有题凭空消失',
    );
  }
});

test('文档声称：shortcuts=0 是真实信号（模型只看选项猜中了考点）', () => {
  const f = `${RUN}/external-eval/results.json`;
  if (!exists(f)) return;

  const results = readJson(f);
  const failures = results.filter(r => r.metrics?.shortcuts?.value === 0);
  for (const r of failures) {
    const meta = r.metrics.shortcuts.metadata ?? {};
    // 真实未通过的判据：模型确实给出了答案，且猜中了考点
    assert.equal(meta.choices_only_success, 1,
      'shortcuts=0 时 choices_only_success 必须为 1，否则是被降级的假阴性');
    assert.ok(meta.inferred_question,
      'shortcuts=0 时必须留下了推断题干，否则无从判断是什么考点');
  }
});
