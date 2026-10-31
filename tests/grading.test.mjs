/**
 * 判分逻辑：客观题系统判、主观题模型判、解析始终展示。
 *
 * # 规则来源
 *
 * 用户要求：
 *   - 选择题、判断题直接系统判分
 *   - 填空题、简答题由 LLM 给一句简短评价
 *   - 解析始终展示
 *
 * # 为什么填空题保留精确匹配
 *
 * 填空题的标准答案是讲义原文里的词。学生写同义词、少个「的」、单位写法不同
 * 都会被纯字符串比较判错 —— 把会的人判成不会，比漏判更伤。
 * 所以：**精确命中直接给确定结论（快路径），不中才请模型裁决**。
 * 这既保证常见情况不花模型调用，又能救回近似答案。
 *
 * # 失败策略
 *
 * 模型不可用时不能抛错。作答记录必须写得进去，否则用户白做一遍。
 * 降级成 `grading: 'self'` + 中性文案，如实说明「未能自动评判」。
 *
 * 用法：node tests/grading.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAnswer,
  blankAnswersOf,
  needsModel,
  isObjective,
  matchExact,
  buildAttempt,
  fallbackComment,
  createJudgeLlm,
  judgeWithModel,
} from '../packages/dsh-zhiyun-core-study/src/grading.js';

// ── 题型分工 ────────────────────────────────────────────────────────

test('选择题与判断题归客观题，不请模型', () => {
  assert.equal(isObjective({ type: 'mcq' }), true);
  assert.equal(isObjective({ type: 'trueFalse' }), true);
  assert.equal(needsModel({ type: 'mcq' }), false);
  assert.equal(needsModel({ type: 'trueFalse' }), false);
});

test('填空题与简答题需要模型参与', () => {
  assert.equal(needsModel({ type: 'cloze' }), true);
  assert.equal(needsModel({ type: 'shortAnswer' }), true);
  assert.equal(isObjective({ type: 'cloze' }), false);
  assert.equal(isObjective({ type: 'shortAnswer' }), false);
});

// ── 精确匹配 ────────────────────────────────────────────────────────

test('选择题精确匹配选项字母', () => {
  const q = { type: 'mcq', answer: 'B', choices: [{ label: 'A' }, { label: 'B' }] };
  assert.equal(matchExact(q, 'B').matched, true);
  assert.equal(matchExact(q, 'b').matched, true, '大小写不敏感');
  assert.equal(matchExact(q, 'A').matched, false);
});

test('判断题精确匹配「正确 / 错误」', () => {
  const q = { type: 'trueFalse', answer: '正确' };
  assert.equal(matchExact(q, '正确').matched, true);
  assert.equal(matchExact(q, '错误').matched, false);
});

test('填空题从挖空标记取标准答案，多空用分号连接', () => {
  const q = { type: 'cloze', stem: '{{c1::原子性}}和{{c2::一致性}}', answer: '原子性;一致性' };
  assert.deepEqual(blankAnswersOf(q), ['原子性', '一致性']);
  assert.equal(matchExact(q, '原子性;一致性').matched, true);
  assert.equal(matchExact(q, '原子性；一致性').matched, true, '中文分号也算');
  assert.equal(matchExact(q, '原子性').matched, false, '少一个空不算命中');
});

test('挖空按 c 编号排序，不依赖出现顺序', () => {
  const q = { type: 'cloze', stem: '{{c2::乙}}与{{c1::甲}}' };
  assert.deepEqual(blankAnswersOf(q), ['甲', '乙'], 'c1 在前');
});

test('acceptedAnswers 里的同义写法也算命中', () => {
  const q = { type: 'cloze', stem: '{{c1::原子}}', answer: '原子', acceptedAnswers: ['原子性'] };
  assert.equal(matchExact(q, '原子性').matched, true);
});

test('归一化忽略空白与全半角差异', () => {
  assert.equal(normalizeAnswer('  原 子 性 '), normalizeAnswer('原子性'));
  assert.equal(normalizeAnswer('（1）'), normalizeAnswer('(1)'));
});

// ── 判分结果成型 ────────────────────────────────────────────────────

test('客观题：命中正确、未中错误，且不采纳模型结论', () => {
  const q = { type: 'mcq', answer: 'B' };
  // 即使模型说 partial，客观题也只认精确匹配 —— 避免同一答案两次判分不同
  const ok = buildAttempt({ question: q, response: 'B', matched: true, judged: { verdict: 'partial', comment: 'x' } });
  assert.equal(ok.verdict, 'correct');
  assert.equal(ok.grading, 'exact');

  const bad = buildAttempt({ question: q, response: 'A', matched: false, judged: { verdict: 'correct', comment: 'x' } });
  assert.equal(bad.verdict, 'incorrect');
  assert.equal(bad.grading, 'exact');
});

test('填空题精确命中：不必等模型，直接 exact', () => {
  const q = { type: 'cloze', stem: '{{c1::原子性}}' };
  const r = buildAttempt({ question: q, response: '原子性', matched: true, judged: null });
  assert.equal(r.verdict, 'correct');
  assert.equal(r.grading, 'exact');
  assert.match(r.comment, /一致/);
});

test('填空题近似答案：采纳模型结论', () => {
  const q = { type: 'cloze', stem: '{{c1::原子性}}' };
  const r = buildAttempt({ question: q, response: '原子', matched: false, judged: { verdict: 'correct', comment: '意思对，就是少了个「性」' } });
  assert.equal(r.verdict, 'correct');
  assert.equal(r.grading, 'llm');
  assert.match(r.comment, /意思对/);
});

test('简答题：采纳模型的一句话评价', () => {
  const q = { type: 'shortAnswer' };
  const r = buildAttempt({ question: q, response: '因为 ACID...', matched: false, judged: { verdict: 'partial', comment: '提到了原子性，漏了一致性' } });
  assert.equal(r.verdict, 'partial');
  assert.equal(r.grading, 'llm');
  assert.equal(r.comment, '提到了原子性，漏了一致性');
});

test('模型不可用时降级，不抛错也不假装判对错', () => {
  const q = { type: 'shortAnswer' };
  const r = buildAttempt({ question: q, response: '答案', matched: false, judged: null });
  assert.equal(r.grading, 'self', '如实标记为未能自动评判');
  assert.equal(r.verdict, 'partial', '中性结论，不判对也不判错');
  assert.ok(r.comment.length > 0, '仍要给一句可读的说明');
});

test('模型给了结论但没给文案时，用兜底文案补齐', () => {
  const q = { type: 'shortAnswer' };
  const r = buildAttempt({ question: q, response: 'x', matched: false, judged: { verdict: 'correct', comment: '' } });
  assert.equal(r.verdict, 'correct');
  assert.ok(r.comment.trim().length > 0, '文案不能为空');
});

test('兜底文案对正确答案说「一致」，对未命中不说死', () => {
  assert.match(fallbackComment({ type: 'cloze' }, true), /一致/);
  assert.ok(!/错误|不对/.test(fallbackComment({ type: 'shortAnswer' }, false)), '不替学生判死刑');
});

// ── 模型调用层 ──────────────────────────────────────────────────────

test('没有 pool 或路由时 createJudgeLlm 返回 null（调用方据此降级）', () => {
  assert.equal(createJudgeLlm(null, { provider: 'p' }), null);
  assert.equal(createJudgeLlm({ base: { llm: {} } }, { provider: 'p' }), null);
  assert.equal(createJudgeLlm({ base: { llm: { prepareCall() {} } } }, null), null);
});

test('createJudgeLlm 把字符串 content 转成块数组（宿主 Anthropic 方言）', async () => {
  let seen = null;
  const pool = {
    base: {
      llm: {
        async prepareCall(config) {
          seen = { config };
          return {
            config: { provider: config.provider, model: config.model },
            async *stream(options) {
              seen.options = options;
              yield { type: 'text-delta', text: 'ok' };
            },
          };
        },
      },
    },
  };
  const judge = createJudgeLlm(pool, { provider: 'deepseek-official', model: 'deepseek-flash' });
  assert.ok(judge, '应返回可用的 judge');
  const prepared = await judge.prepareCall({ messages: [{ role: 'user', content: '你好' }] });
  const chunks = [];
  for await (const c of prepared.stream({ messages: [{ role: 'user', content: '你好' }] })) chunks.push(c);
  assert.equal(chunks[0].text, 'ok');
  assert.equal(seen.config.provider, 'deepseek-official', 'provider 用注册表里的名字');
  assert.ok(Array.isArray(seen.options.messages[0].content), 'content 必须是块数组');
  assert.equal(seen.options.messages[0].content[0].type, 'text');
});

// ── 模型输出解析的鲁棒性（模型不可控，必须能容错）──────────────────

/** 造一个只会吐固定文本的假 llm。 */
const fakeLlm = text => ({
  async prepareCall() {
    return { config: {}, async *stream() { if (text) yield { type: 'text-delta', text }; } };
  },
});

const judge = async text => judgeWithModel({
  llm: fakeLlm(text),
  question: { type: 'shortAnswer', stem: '题目', answer: '标准' },
  response: '作答',
  expected: '标准',
});

test('模型输出标准 JSON 时直接采纳', async () => {
  const r = await judge('{"verdict":"correct","comment":"答对了"}');
  assert.equal(r.verdict, 'correct');
  assert.equal(r.comment, '答对了');
});

test('模型套了代码围栏也能解析', async () => {
  const r = await judge('```json\n{"verdict":"partial","comment":"漏了一点"}\n```');
  assert.equal(r.verdict, 'partial');
});

test('模型加了前后缀也能解析', async () => {
  const r = await judge('判断如下：{"verdict":"incorrect","comment":"答偏了"} 以上。');
  assert.equal(r.verdict, 'incorrect');
});

test('模型只给纯文本 → 返回 null 让调用方降级', async () => {
  assert.equal(await judge('学生回答基本正确'), null);
});

test('verdict 不在三档内 → 返回 null，不猜', async () => {
  assert.equal(await judge('{"verdict":"maybe","comment":"x"}'), null);
});

test('模型抛异常 → 返回 null，不把错误抛给答题侧', async () => {
  const broken = { async prepareCall() { throw Error('provider down'); } };
  const r = await judgeWithModel({ llm: broken, question: { type: 'shortAnswer', stem: 'x' }, response: 'y', expected: 'z' });
  assert.equal(r, null, '判分失败不能让作答写不进去');
});

test('comment 过长时截断，避免界面被灌满', async () => {
  const long = '很'.repeat(300);
  const r = await judge(`{"verdict":"correct","comment":"${long}"}`);
  assert.ok(r.comment.length <= 120, `实际 ${r.comment.length} 字`);
});
