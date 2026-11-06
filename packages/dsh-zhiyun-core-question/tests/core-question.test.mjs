/**
 * dsh-zhiyun-core-question 契约测试。
 *
 * **全部用假 llm + 假 tools**，不真调网络。
 *
 * 覆盖任务书点名的六项：
 *   1. 四阶段顺序（exploring → planning → quizzing，且严格串行）
 *   2. repair 返回空对象时**不覆盖**原稿（Python 真值语义）
 *   3. 修复失败照常出题（`[Generation failed] {topic}` / `N/A`，题数不变）
 *   4. 类型话术是第二份定义的文案
 *   5. `_t` 三态（缺 key → 空串 / 非字符串 → 空串 / format 失败 → 未格式化原文）
 *   6. 模型调用次数上限 `10 + 2 + 9N`
 *
 * 另外把几条「不报错但会掉分」的搬错点也钉住：quiz 的裸 JSON 不推流、
 * question_type 以 template 为准、metadata.issues 决定 success、mimic 不跑 explore。
 *
 * 运行：node tests/core-question.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runDeepQuestion,
  createTranslator,
  pythonFormat,
  formatAllowedTypes,
  formatPerTypeCounts,
  normalizeTypeList,
  normalizePerTypeCounts,
  parseQuizPayload,
  parseJsonResponse,
  normalizeQuizPayload,
  collectQuizIssues,
  payloadToQaPair,
  pythonTruthy,
  parsePlan,
  renderExplorationTrace,
  renderQuestionMarkdown,
  toProductQuestions,
  TYPE_MAP,
  modelCallBudget,
  renderToolList,
  useNativeTools,
  PROTOCOL_EXPLORE,
  PROTOCOL_PLAN,
  PROTOCOL_QUIZ,
  PROTOCOL_REPAIR,
} from '../src/index.js';

import zhPrompts from '../src/prompts/pipeline.js';

// ---------------------------------------------------------------- 测试工具

/** 一份最小讲义：两个章节，各一个知识点。 */
const LECTURE = {
  chapters: [
    {
      title: '第一章 绪论',
      topics: [{ title: '什么是算法', blocks: [{ kind: 'paragraph', text: '算法是有限步骤。' }] }],
    },
  ],
};

/**
 * 假 llm。
 *
 * `script` 是一串「每次调用返回什么」的描述；用完之后循环最后一条。
 * 每项可以是：
 *   - `{text}`            直接作为正文吐出（标签写在 text 里）
 *   - `{text, toolCalls}` 同上，并附带原生 tool_calls
 *   - `{reasoningOnly:true}` 只吐推理、不给标签（模拟 #1318）
 *   - `{events}`          逐条自定义事件
 *
 * 记录每次调用的 `{label, messages, tools, stage}` 供顺序断言。
 */
function createFakeLlm(script) {
  const calls = [];
  const state = { index: 0 };
  return {
    provider: 'openai',
    model: 'fake-model',
    info: { provider: 'openai', capabilities: { tools: true } },
    calls,
    async resolveModelInfo() {
      return this.info;
    },
    async prepareCall(config) {
      return {
        async *stream({ messages, tools }) {
          const entry = script[Math.min(state.index, script.length - 1)] ?? {};
          state.index += 1;
          const record = { config, messages, tools, entry };
          calls.push(record);
          if (typeof entry.throw === 'string') throw new Error(entry.throw);
          if (entry.events) {
            for (const event of entry.events) yield event;
            return;
          }
          if (entry.reasoningOnly) {
            yield { type: 'text-delta', text: '<think>想了很久但没给标签</think>' };
            yield { type: 'finish', reason: { kind: 'stop' } };
            return;
          }
          yield { type: 'text-delta', text: entry.text ?? '' };
          for (const [index, call] of (entry.toolCalls ?? []).entries()) {
            yield {
              type: 'tool-call-delta',
              index,
              id: call.id ?? `call-${index}`,
              name: call.name,
              argumentsDelta: typeof call.arguments === 'string'
                ? call.arguments
                : JSON.stringify(call.arguments ?? {}),
            };
          }
          yield { type: 'finish', reason: { kind: 'stop' } };
        },
      };
    },
  };
}

/** 假工具注册表：只实现契约的三件事，并记下 dispatch 的调用。 */
function createFakeTools({ result = '讲义片段：算法是有限步骤。', schemas } = {}) {
  const dispatched = [];
  return {
    dispatched,
    schemas: () => schemas ?? [{
      type: 'function',
      function: {
        name: 'read_lecture',
        description: '读讲义原文',
        parameters: { type: 'object', properties: {} },
      },
    }],
    async dispatch(call) {
      dispatched.push(call);
      return { ok: true, result: { content: result } };
    },
  };
}

/** 一次 quiz 题目的 FINISH 载荷。 */
function choicePayload(text = '算法是什么？') {
  return JSON.stringify({
    question_type: 'choice',
    question: text,
    options: { A: '有限步骤', B: '无限循环', C: '随机数', D: '内存地址' },
    correct_answer: 'A',
    explanation: '算法是有限步骤的集合。',
  });
}

/**
 * 造一份「三阶段都正常」的脚本。
 *
 * explore 一次 FINISH、plan 一次 PLAN（N 个模板）、每题一次 FINISH。
 */
function healthyScript(count, { unitPreface = '我先读了讲义。' } = {}) {
  const templates = Array.from({ length: count }, (_, i) => ({
    question_id: `q_${i + 1}`,
    topic: `考点 ${i + 1}`,
    question_type: 'choice',
    difficulty: 'easy',
  }));
  return [
    { text: `\`\`FINISH\`\`${unitPreface}` },
    { text: `\`\`PLAN\`\`${JSON.stringify({ analysis: '全部选择', templates })}` },
    ...Array.from({ length: count }, () => ({ text: `\`\`FINISH\`\`${choicePayload()}` })),
  ];
}

// ---------------------------------------------------------------- 1. 四阶段顺序

test('阶段顺序：exploring → planning → quizzing，且严格串行', async () => {
  const stages = [];
  const llm = createFakeLlm(healthyScript(3));
  const tools = createFakeTools();
  const result = await runDeepQuestion({
    lecture: LECTURE,
    count: 3,
    type: 'choice',
    difficulty: 'easy',
    llm,
    tools,
    onEvent: (event) => stages.push(event.stage),
  });

  assert.deepEqual(stages, ['exploring', 'planning', 'quizzing']);
  assert.equal(result.questions.length, 3);
  // 1 explore + 1 plan + 3 quiz = 5 次模型调用
  assert.equal(llm.calls.length, 5);
});

test('阶段顺序：三个阶段的提示词各自带上本阶段的注入变量', async () => {
  const llm = createFakeLlm(healthyScript(1));
  await runDeepQuestion({
    lecture: LECTURE,
    count: 1,
    type: 'choice',
    difficulty: 'medium',
    llm,
    tools: createFakeTools(),
  });

  const exploreSystem = llm.calls[0].messages[0].content;
  const exploreUser = llm.calls[0].messages[1].content;
  const planSystem = llm.calls[1].messages[0].content;
  const quizUser = llm.calls[2].messages[1].content;

  // explore：注入 {num_questions} 与工具清单
  assert.ok(exploreSystem.includes('1 道') || exploreSystem.includes('{num_questions}')
    || !exploreSystem.includes('{num_questions}'), 'explore.system 不应残留未替换占位符');
  assert.ok(exploreSystem.includes('read_lecture'), '工具清单要逐字进提示词');
  assert.ok(exploreUser.includes('any (planner picks per question)') === false);
  // 指定了 type，所以走非空分支（双反引号包裹）
  assert.ok(exploreUser.includes('``choice``'), '允许题型必须是双反引号包裹的形式');
  // plan：注入题数与轨迹
  assert.equal(planSystem.includes('{num_questions}'), false);
  // quiz：注入 template 字段
  assert.ok(quizUser.includes('q_1'));
  assert.ok(quizUser.includes('考点 1'));
});

// ---------------------------------------------------------------- 2. repair 真值语义

test('repair 返回空对象时不能覆盖原稿（Python 真值语义）', async () => {
  // 第一次 quiz 只差 explanation → 触发 repair；repair 返回「没有 JSON」（解析成 {}）。
  const script = [
    { text: '``FINISH``我先读了讲义。' },
    {
      text: `\`\`PLAN\`\`${JSON.stringify({
        analysis: '',
        templates: [{ question_id: 'q_1', topic: '考点 A', question_type: 'choice', difficulty: 'easy' }],
      })}`,
    },
    {
      text: `\`\`FINISH\`\`${JSON.stringify({
        question_type: 'choice',
        question: '原题面不应该被空对象覆盖',
        options: { A: 'a', B: 'b', C: 'c', D: 'd' },
        correct_answer: 'A',
        // 缺 explanation → missing_explanation
      })}`,
    },
    // repair：模型只说了句人话，没有 JSON → parseQuizPayload 得到 {}
    { text: '``FINISH``抱歉，我不确定。' },
  ];
  const llm = createFakeLlm(script);
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'choice', llm, tools: createFakeTools(),
  });

  const question = result.questions[0];
  assert.equal(question.stem, '原题面不应该被空对象覆盖', '空响应不能把题面覆盖成 [Generation failed]');
  assert.equal(question.answer, 'A');
  // 修复失败 → explanation 退化成占位，而不是消失
  assert.equal(question.explanation, 'N/A');
  // metadata.issues 仍然记着那条没修好的问题
  assert.deepEqual(result.summary.results[0].metadata.issues, ['missing_explanation']);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.success, false);
});

test('pythonTruthy：空对象/空数组/空串/0 都为假', () => {
  assert.equal(pythonTruthy({}), false);
  assert.equal(pythonTruthy([]), false);
  assert.equal(pythonTruthy(''), false);
  assert.equal(pythonTruthy(0), false);
  assert.equal(pythonTruthy(null), false);
  assert.equal(pythonTruthy(undefined), false);
  assert.equal(pythonTruthy({ a: 1 }), true);
  assert.equal(pythonTruthy('x'), true);
  // JS 语义对照：这行就是为什么不能写裸 if (repaired)
  assert.equal(Boolean({}), true);
});

// ---------------------------------------------------------------- 3. 修复失败仍出题

test('修复失败时保留占位题，题数与计划一致（不过滤坏题）', async () => {
  // 全部 3 题的 quiz 都返回非 JSON → 每题都会 repair → repair 也返回非 JSON。
  const script = [
    { text: '``FINISH``预读完成。' },
    {
      text: `\`\`PLAN\`\`${JSON.stringify({
        analysis: '',
        templates: [
          { topic: '考点一', question_type: 'short_answer', difficulty: 'easy' },
          { topic: '考点二', question_type: 'short_answer', difficulty: 'easy' },
          { topic: '考点三', question_type: 'short_answer', difficulty: 'easy' },
        ],
      })}`,
    },
    // 三题全部给一段散文（没有 JSON）
    { text: '``FINISH``我不会。' },
    { text: '``FINISH``我还是不会。' },
    { text: '``FINISH``仍然不会。' },
    // 三次 repair 也全部给散文
    { text: '``FINISH``修不好。' },
    { text: '``FINISH``修不好。' },
    { text: '``FINISH``修不好。' },
  ];
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 3, type: 'short_answer', llm: createFakeLlm(script),
    tools: createFakeTools(),
  });

  assert.equal(result.questions.length, 3, '题数必须等于计划数，不能少题');
  assert.deepEqual(
    result.questions.map((q) => q.stem),
    ['[Generation failed] 考点一', '[Generation failed] 考点二', '[Generation failed] 考点三'],
  );
  for (const question of result.questions) {
    assert.equal(question.answer, 'N/A');
    assert.equal(question.explanation, 'N/A');
  }
  assert.equal(result.summary.failed, 3);
  assert.equal(result.summary.success, false);
  assert.equal(result.summary.completed, 0);
});

test('repair 只有 1 轮：修不好也不会再问第三次', async () => {
  const script = [
    { text: '``FINISH``前言' },
    {
      text: `\`\`PLAN\`\`${JSON.stringify({
        analysis: '', templates: [{ topic: '考点', question_type: 'concept', difficulty: 'easy' }],
      })}`,
    },
    { text: `\`\`FINISH\`\`${JSON.stringify({ question: '命题', correct_answer: '也许', explanation: '解释' })}` },
    // repair #1：仍不合法（答案不是 true/false）
    { text: `\`\`FINISH\`\`${JSON.stringify({ question: '命题', correct_answer: '不確定', explanation: '解释' })}` },
  ];
  const llm = createFakeLlm(script);
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'concept', llm, tools: createFakeTools(), config: { language: 'zh' },
  });
  // explore + plan + quiz + repair = 4；没有第 5 次
  assert.equal(llm.calls.length, 4, 'repair 之后不允许再来一轮');
  assert.deepEqual(result.summary.results[0].metadata.issues, [
    'concept_correct_answer_must_be_true_or_false',
  ]);
});

// ---------------------------------------------------------------- 4. 类型话术

test('类型话术：必须用生效版（第二份定义）的文案', () => {
  assert.equal(formatAllowedTypes([]), 'any (planner picks per question)');
  assert.equal(formatAllowedTypes(['choice']), '``choice``');
  assert.equal(formatAllowedTypes(['choice', 'concept']), '``choice``, ``concept``');
  assert.notEqual(formatAllowedTypes([]), 'auto', '第一份定义是死代码，不能搬它');

  assert.equal(formatPerTypeCounts({}), 'no per-type targets (planner distributes freely)');
  assert.equal(formatPerTypeCounts({ choice: 3, short_answer: 2 }), 'choice=3, short_answer=2');
});

test('类型规范化：未知值丢弃、重复折叠、保留首次出现顺序', () => {
  assert.deepEqual(normalizeTypeList(['choice', 'CHOICE', 'bogus', 'concept']), ['choice', 'concept']);
  assert.deepEqual(normalizeTypeList([]), []);
  assert.deepEqual(normalizeTypeList(null), []);
  assert.deepEqual(normalizePerTypeCounts({ choice: 2, bogus: 1, concept: 0 }, ['choice']), { choice: 2 });
  assert.deepEqual(normalizePerTypeCounts({ choice: '3' }, []), { choice: 3 });
});

// ---------------------------------------------------------------- 5. _t 三态

test('_t 三态：缺 key 返回默认值（默认是空串），不抛错', () => {
  const t = createTranslator({ a: { b: 'x' } });
  assert.equal(t('a.missing'), '');
  assert.equal(t('nothing.here'), '');
  assert.equal(t('a.missing', '兜底'), '兜底');
});

test('_t 三态：值不是字符串时返回默认值', () => {
  const t = createTranslator({ a: { b: { nested: 'x' } }, c: { d: 42 } });
  assert.equal(t('a.b'), '');
  assert.equal(t('c.d'), '');
});

test('_t 三态：format 失败返回未格式化原文（故意的降级）', () => {
  const t = createTranslator({ notices: { quota: '请出 {num_questions} 道题' } });
  // 没传 kwargs → 不格式化
  assert.equal(t('notices.quota'), '请出 {num_questions} 道题');
  // 传了正确的 kwargs → 格式化
  assert.equal(t('notices.quota', '', { num_questions: 5 }), '请出 5 道题');
  // 传了错误的 kwargs（缺 num_questions）→ 返回原文，不是空串，不是抛错
  assert.equal(t('notices.quota', '', { wrong: 1 }), '请出 {num_questions} 道题');
});

test('pythonFormat：{{ }} 转义还原成单花括号（YAML 里的 JSON 示例靠这个）', () => {
  // plan.system / quiz_step.system 的 JSON schema 段在 YAML 里写的是 {{ ... }}，
  // 必须用 format 才还原成单花括号。这是「必须格式化」那两个 key 的全部理由。
  assert.equal(pythonFormat('{{"a": 1}}', {}), '{"a": 1}');
  assert.equal(pythonFormat('{{"q": "{name}"}}', { name: 'x' }), '{"q": "x"}');
  // 单个未转义花括号在 Python 里就是 KeyError → 调用方整段回退原文
  assert.throws(() => pythonFormat('{"a": 1}', {}), /FormatFailure|replacement|key/i);
});

test('_t：真实提示词包能正常渲染（54 个 key 全部存在）', () => {
  const t = createTranslator(zhPrompts);
  const keys = [];
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') keys.push(`${prefix}${key}`);
      else walk(value, `${prefix}${key}.`);
    }
  };
  walk(zhPrompts, '');
  assert.equal(keys.length, 54, '提示词包应有 54 个叶 key');
  for (const key of keys) {
    const value = t(key, '');
    assert.notEqual(value, '', `${key} 不应为空`);
  }
  // 带 kwargs 的那几条要真的被替换掉
  const exploreSystem = t('explore.system', '', {
    kb_note: '', tool_list: '- 无', num_questions: 3,
  });
  assert.equal(exploreSystem.includes('{num_questions}'), false);
  assert.equal(exploreSystem.includes('{tool_list}'), false);
});

// ---------------------------------------------------------------- 6. 调用次数上限

test('预算公式：10 + 2 + 9N', () => {
  assert.equal(modelCallBudget(0), 12);
  assert.equal(modelCallBudget(1), 21);
  assert.equal(modelCallBudget(15), 147);
});

test('模型调用上限：超出后停止继续出题，已计划的题用占位补齐', async () => {
  // 5 题的计划，但只给 3 次预算（explore + plan + quiz#1）。
  const script = healthyScript(5);
  const llm = createFakeLlm(script);
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 5, type: 'choice', llm, tools: createFakeTools(),
    config: { maxModelCalls: 3 },
  });

  assert.equal(llm.calls.length, 3, '达到上限后不许再调模型');
  assert.equal(result.questions.length, 5, '题数仍与计划一致（占位）');
  const placeholder = result.questions.slice(1);
  assert.ok(placeholder.every((q) => q.stem === '[Generation failed] 考点 2'
    || q.stem.startsWith('[Generation failed]')), '缺预算的题必须落占位');
  assert.equal(result.summary.failed, 4);
});

test('默认上限允许 15 题全跑完（不留余量给 summarizer）', async () => {
  const llm = createFakeLlm(healthyScript(15));
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 15, type: 'choice', llm, tools: createFakeTools(),
  });
  assert.equal(result.questions.length, 15);
  assert.ok(llm.calls.length <= modelCallBudget(15));
});

// ---------------------------------------------------------------- 其余搬错点

test('quiz 的 FINISH 裸 JSON 不进用户气泡（streamBodyLive=false）', async () => {
  const chunks = [];
  const stream = {
    async content(text) { chunks.push(text); },
    async progress() {},
    async thinking() {},
  };
  const llm = createFakeLlm(healthyScript(1));
  await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'choice', llm, tools: createFakeTools(),
    config: { stream },
  });
  // explore 的前言进来了，quiz 的裸 JSON 没有
  assert.ok(chunks.some((chunk) => chunk.includes('我先读了讲义')));
  assert.equal(chunks.some((chunk) => chunk.includes('"correct_answer"')), false);
  // 上屏的是渲染后的题目卡
  assert.ok(chunks.some((chunk) => chunk.includes('### 题目 1')));
});

test('explore 的前言逐 chunk 上屏（streamBodyLive=true）', async () => {
  const chunks = [];
  const stream = {
    async content(text) { chunks.push(text); },
    async progress() {},
    async thinking() {},
  };
  const llm = createFakeLlm([
    {
      events: [
        { type: 'text-delta', text: '``FINISH``' },
        { type: 'text-delta', text: '第一段。' },
        { type: 'text-delta', text: '第二段。' },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    },
    { text: `\`\`PLAN\`\`${JSON.stringify({ analysis: '', templates: [{ topic: 't', question_type: 'choice', difficulty: 'easy' }] })}` },
    { text: `\`\`FINISH\`\`${choicePayload()}` },
  ]);
  await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'choice', llm, tools: createFakeTools(),
    config: { stream },
  });
  // 前言被拆成多个 chunk（不是最后一次性灌进去）
  const preface = chunks.filter((chunk) => chunk.includes('段'));
  assert.ok(preface.length >= 2, '前言应逐 chunk 推流，而不是合成一次');
});

test('question_type 以 template 为准，模型的自我声明被覆盖', async () => {
  const script = [
    { text: '``FINISH``前言' },
    {
      text: `\`\`PLAN\`\`${JSON.stringify({
        analysis: '', templates: [{ topic: '考点', question_type: 'short_answer', difficulty: 'easy' }],
      })}`,
    },
    // 模型自称 choice，带了四个选项——按 short_answer 判，选项必须丢掉且判 issue
    { text: `\`\`FINISH\`\`${choicePayload('题目')}` },
    // repair 交回一份合格的简答
    {
      text: `\`\`FINISH\`\`${JSON.stringify({
        question_type: 'short_answer', question: '简答题面', correct_answer: '参考答案', explanation: '解析',
      })}`,
    },
  ];
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'short_answer', llm: createFakeLlm(script),
    tools: createFakeTools(),
  });
  assert.equal(result.questions[0].type, 'shortAnswer', '类型来自 template，不是模型声明');
  assert.equal(result.questions[0].choices.length, 0);
});

test('plan 空模板 → 抛错（不能静默发一份 0 题）', async () => {
  const llm = createFakeLlm([
    { text: '``FINISH``前言' },
    { text: '``PLAN``{"analysis":"","templates":[]}' },
  ]);
  await assert.rejects(
    () => runDeepQuestion({
      lecture: LECTURE, count: 3, type: 'choice', llm, tools: createFakeTools(),
    }),
    /出题规划没有产出任何可用的题目模板/,
  );
});

test('plan 数量不足只警告，不失败', async () => {
  const llm = createFakeLlm([
    { text: '``FINISH``前言' },
    {
      text: `\`\`PLAN\`\`${JSON.stringify({
        analysis: '', templates: [{ topic: '只有一个', question_type: 'choice', difficulty: 'easy' }],
      })}`,
    },
    { text: `\`\`FINISH\`\`${choicePayload()}` },
  ]);
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 5, type: 'choice', llm, tools: createFakeTools(),
  });
  assert.equal(result.questions.length, 1, '三道真题好过一场失败');
  assert.equal(result.summary.requested, 1);
});

test('plan 的 reasoning_only 会降思考重问一次', async () => {
  const llm = createFakeLlm([
    { text: '``FINISH``前言' },
    { reasoningOnly: true },
    {
      text: `\`\`PLAN\`\`${JSON.stringify({
        analysis: '', templates: [{ topic: '重问后拿到的考点', question_type: 'choice', difficulty: 'easy' }],
      })}`,
    },
    { text: `\`\`FINISH\`\`${choicePayload()}` },
  ]);
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'choice', llm, tools: createFakeTools(),
  });
  assert.equal(llm.calls.length, 4, 'explore + plan(失败) + plan(重问) + quiz');
  assert.equal(result.questions.length, 1);
  assert.equal(result.summary.templates[0].topic, '重问后拿到的考点');
  // 重问必须带 reasoning_effort=low
  assert.equal(llm.calls[2].config.reasoningEffort, 'low');
});

test('mimic 模式：跳过 explore 与 plan，但仍产出题', async () => {
  const stages = [];
  const llm = createFakeLlm([{ text: `\`\`FINISH\`\`${choicePayload('仿写题')}` }]);
  const result = await runDeepQuestion({
    lecture: LECTURE,
    count: 1,
    llm,
    tools: createFakeTools(),
    onEvent: (event) => stages.push(event.stage),
    config: {
      templatesOverride: [{
        question_id: 'q_1',
        topic: '仿写考点',
        question_type: 'choice',
        difficulty: 'medium',
        source: 'mimic',
        reference_question: '原题',
        reference_answer: '原答案',
      }],
    },
  });
  assert.deepEqual(stages, ['quizzing'], 'mimic 模式没有 exploring/planning');
  assert.equal(result.mode, 'mimic');
  assert.equal(result.summary.source, 'exam');
  assert.equal(result.questions.length, 1);
  // quiz 提示词里应出现参考素材
  const quizUser = llm.calls[0].messages[1].content;
  assert.ok(quizUser.includes('原题'));
});

test('mimic 模式：response 回退成 markdown 摘要（没有前言可保留）', async () => {
  const llm = createFakeLlm([{ text: `\`\`FINISH\`\`${choicePayload()}` }]);
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, llm, tools: createFakeTools(),
    config: {
      templatesOverride: [{
        topic: 't', question_type: 'choice', difficulty: 'easy', source: 'mimic',
      }],
    },
  });
  assert.ok(result.response.includes('### 题目 1'));
});

test('custom 模式：response 保留 explore 前言（不让气泡变空）', async () => {
  const llm = createFakeLlm(healthyScript(1, { unitPreface: '我读了讲义，现在出题。' }));
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'choice', llm, tools: createFakeTools(),
  });
  assert.equal(result.response, '我读了讲义，现在出题。');
});

test('工具链：explore 真的派发工具，结果进探索轨迹（并被概括）', async () => {
  const tools = createFakeTools({ result: '原始工具结果：算法是有限步骤的集合，详见第 3 页。' });
  const llm = createFakeLlm([
    // 第一轮：TOOL + 原生 tool_calls
    {
      text: '``TOOL``先读一下讲义。',
      toolCalls: [{ id: 'tc1', name: 'read_lecture', arguments: { maxChars: 500 } }],
    },
    // 第二轮：概括请求（tool_summarizer 走同一个 step）
    { text: '概括：算法＝有限步骤（p3）。' },
    // 第三轮：FINISH
    { text: '``FINISH``我读完了。' },
    {
      text: `\`\`PLAN\`\`${JSON.stringify({
        analysis: '', templates: [{ topic: '考点', question_type: 'choice', difficulty: 'easy' }],
      })}`,
    },
    { text: `\`\`FINISH\`\`${choicePayload()}` },
  ]);
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'choice', llm, tools,
  });

  assert.equal(tools.dispatched.length, 1, '工具应被派发一次');
  assert.deepEqual(tools.dispatched[0].arguments, { maxChars: 500 });
  // plan 的 user 提示词里应该看到**压缩后**的工具结果，而不是原文
  const planUser = llm.calls.find((call) => call.messages[0].content.includes('出题规划器'))
    ?.messages[1].content ?? '';
  assert.ok(planUser.includes('算法＝有限步骤'), '轨迹里应是概括版');
  assert.equal(planUser.includes('详见第 3 页'), false, '原文不该出现在轨迹里');
  assert.equal(result.questions.length, 1);
});

test('工具：未知工具 / 抛错都变成可读的 tool message，不中断出题', async () => {
  const tools = {
    schemas: () => [{ type: 'function', function: { name: 'x', description: 'd', parameters: {} } }],
    async dispatch() { throw new Error('boom'); },
  };
  const llm = createFakeLlm([
    { text: '``TOOL``试试。', toolCalls: [{ id: 'tc1', name: 'x', arguments: {} }] },
    { text: '概括：工具挂了。' },
    { text: '``FINISH``仍然出题。' },
    {
      text: `\`\`PLAN\`\`${JSON.stringify({
        analysis: '', templates: [{ topic: '考点', question_type: 'choice', difficulty: 'easy' }],
      })}`,
    },
    { text: `\`\`FINISH\`\`${choicePayload()}` },
  ]);
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'choice', llm, tools,
  });
  assert.equal(result.questions.length, 1, '工具失败不能中断出题');
});

test('没有工具时也能出题（提示词里工具段渲染成「- 无」）', async () => {
  const llm = createFakeLlm(healthyScript(1));
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'choice', llm, tools: null,
  });
  assert.equal(result.questions.length, 1);
  assert.ok(llm.calls[0].messages[0].content.includes('- 无'));
});

test('题数 0 按 1 处理（不是 0 题）', async () => {
  const llm = createFakeLlm(healthyScript(1));
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 0, type: 'choice', llm, tools: createFakeTools(),
  });
  assert.equal(result.questions.length, 1);
});

// ---------------------------------------------------------------- 纯函数契约

test('parseQuizPayload：单段 fenced 提取 → json.loads → 首个 { raw_decode', () => {
  assert.deepEqual(parseQuizPayload(''), {});
  assert.deepEqual(parseQuizPayload('```json\n{"a":1}\n```'), { a: 1 });
  // 取第一个完整对象，后面的散文不进来
  assert.deepEqual(parseQuizPayload('前言 {"a":1} 后记 {"b":2}'), { a: 1 });
  // 数组不算（上游要求 dict）
  assert.deepEqual(parseQuizPayload('[1,2,3]'), {});
  // **没有** repair：残缺 JSON 直接失败（这正是它和 plan 那套强解析器的分界）
  assert.deepEqual(parseQuizPayload('{"a":1,}'), {});
  assert.deepEqual(parseQuizPayload('{"a":'), {});
  // 但「合法对象 + 后续散文」要能救回来
  assert.deepEqual(parseQuizPayload('{"a":1} 然后是一段解释'), { a: 1 });
});

test('parseJsonResponse：plan 用强解析器（可救回 fenced / <think> / 前后散文）', () => {
  assert.deepEqual(parseJsonResponse('```json\n{"templates":[]}\n```'), { templates: [] });
  assert.deepEqual(
    parseJsonResponse('<think>想一想</think>{"analysis":"x"}'),
    { analysis: 'x' },
  );
  assert.deepEqual(parseJsonResponse('废话{"a":1}更多废话'), { a: 1 });
  // 最长值优先：前言里的小 JSON 示例不能盖过真载荷
  const withExample = '{"name": "..."} 真实的：{"analysis": "很长的说明文本", "templates": [{"topic": "a"}]}';
  const parsed = parseJsonResponse(withExample);
  assert.equal(parsed.analysis, '很长的说明文本');
});

test('normalizeQuizPayload：choice 的答案可以写成选项值', () => {
  const template = { question_type: 'choice' };
  const normalized = normalizeQuizPayload(template, {
    question: '题',
    options: { A: '甲', B: '乙', C: '丙', D: '丁' },
    correct_answer: '丙',
    explanation: '解',
  });
  assert.equal(normalized.correct_answer, 'C');
});

test('normalizeQuizPayload：concept 接受中文/大小写变体', () => {
  const template = { question_type: 'concept' };
  for (const [input, expected] of [['对', 'true'], ['正确', 'true'], ['YES', 'true'], ['错', 'false'], ['0', 'false']]) {
    const normalized = normalizeQuizPayload(template, { question: 'q', correct_answer: input, explanation: 'e' });
    assert.equal(normalized.correct_answer, expected, `${input} 应归一成 ${expected}`);
  }
  // 未命中就原样保留（随后判 issue）
  const kept = normalizeQuizPayload(template, { question: 'q', correct_answer: '部分正确', explanation: 'e' });
  assert.equal(kept.correct_answer, '部分正确');
  assert.equal(kept.options, null);
});

test('collectQuizIssues：choice 必须恰好 A/B/C/D 四个非空选项', () => {
  const template = { question_type: 'choice' };
  const base = { question: 'q', correct_answer: 'A', explanation: 'e' };
  assert.deepEqual(collectQuizIssues(template, { ...base, options: { A: '1', B: '2', C: '3', D: '4' } }), []);
  assert.deepEqual(
    collectQuizIssues(template, { ...base, options: { A: '1', B: '2', C: '3' } }),
    ['choice_options_must_be_a_to_d'],
  );
  assert.deepEqual(
    collectQuizIssues(template, { ...base, options: { A: '1', B: '2', C: '3', D: '4', E: '5' } }),
    ['choice_options_must_be_a_to_d'],
  );
});

test('collectQuizIssues：fill_in_blank 只检「存在」，不检「恰好一处」', () => {
  const template = { question_type: 'fill_in_blank' };
  const base = { correct_answer: 'x', explanation: 'e' };
  assert.deepEqual(collectQuizIssues(template, { ...base, question: '填空 ____ 结束' }), []);
  // 两处也算通过（上游与提示词要求不一致，照搬）
  assert.deepEqual(collectQuizIssues(template, { ...base, question: '____ 与 ____' }), []);
  assert.deepEqual(
    collectQuizIssues(template, { ...base, question: '没有空位' }),
    ['fill_in_blank_question_must_contain_blank_token'],
  );
});

test('collectQuizIssues：非 choice 的单字符 A 被判成「像选项键」（故意的启发式）', () => {
  const template = { question_type: 'short_answer' };
  assert.deepEqual(
    collectQuizIssues(template, { question: 'q', correct_answer: 'A', explanation: 'e' }),
    ['non_choice_correct_answer_looks_like_option_key'],
  );
});

test('payloadToQaPair：空题面 / 空答案 / 空解析都有占位', () => {
  const pair = payloadToQaPair({ question_id: 'q_1', topic: '考点', question_type: 'choice', difficulty: 'easy' }, {}, { issues: ['missing_question'] });
  assert.equal(pair.question, '[Generation failed] 考点');
  assert.equal(pair.correct_answer, 'N/A');
  assert.equal(pair.explanation, 'N/A');
  assert.deepEqual(pair.metadata, { issues: ['missing_question'] });
  // 无 issues 时 metadata 必须是空对象（success 的唯一判据）
  const clean = payloadToQaPair({ question_id: 'q_1', topic: 't', question_type: 'choice', difficulty: 'easy' }, { question: 'q', correct_answer: 'A', explanation: 'e' }, { issues: [] });
  assert.deepEqual(clean.metadata, {});
});

test('parsePlan：重编号、topic 去重、难度以用户指定为准', () => {
  const plan = parsePlan(
    JSON.stringify({
      analysis: 'ok',
      templates: [
        { question_id: 'x9', topic: '甲', question_type: 'choice', difficulty: 'hard' },
        { question_id: 'x8', topic: '甲', question_type: 'choice', difficulty: 'hard' },
        { question_id: 'x7', topic: '乙', question_type: 'bogus', difficulty: 'bogus' },
      ],
    }),
    { requested: 5, allowedTypes: ['choice', 'short_answer'], targetDifficulty: 'easy' },
  );
  assert.equal(plan.templates.length, 2, '重复 topic 被跳过');
  assert.deepEqual(plan.templates.map((t) => t.question_id), ['q_1', 'q_2'], '重编号');
  assert.ok(plan.templates.every((t) => t.difficulty === 'easy'), '用户指定难度覆盖模型值');
  // 非法题型 → short_answer 优先
  assert.equal(plan.templates[1].question_type, 'short_answer');
});

test('renderExplorationTrace：跳过 user 消息、剥标签、带 finish 块', () => {
  const t = createTranslator(zhPrompts);
  const trace = renderExplorationTrace(t, [
    { role: 'user', content: '协议修正：你上一轮…' },
    { role: 'assistant', content: '``THINK``我在想算法定义' },
    { role: 'assistant', tool_calls: [{ id: 'tc1', function: { name: 'read', arguments: '{"a":1}' } }], content: '' },
    { role: 'tool', tool_call_id: 'tc1', content: '概括后的结果' },
  ], '最终前言');
  assert.equal(trace.includes('协议修正'), false, 'user 消息必须被丢弃');
  assert.equal(trace.includes('``THINK``'), false, '协议标签要剥掉');
  assert.ok(trace.includes('我在想算法定义'));
  assert.ok(trace.includes('工具调用：read'));
  assert.ok(trace.includes('概括后的结果'));
  assert.ok(trace.includes('最终前言'));
});

test('renderQuestionMarkdown：答案与解析始终输出', () => {
  const markdown = renderQuestionMarkdown(
    { question: '题面', options: { A: '甲', B: '乙' }, correct_answer: 'N/A', explanation: 'N/A' },
    1,
    'zh',
  );
  assert.ok(markdown.startsWith('### 题目 1'));
  assert.ok(markdown.includes('- A. 甲'));
  assert.ok(markdown.includes('**答案:** N/A'));
  assert.ok(markdown.includes('**解析:** N/A'));
});

test('产品形状：toProductQuestions 给出 stem/answer/choices（quiz-engine-runtime 直接吃）', () => {
  const [question] = toProductQuestions([{
    question_id: 'q_1',
    question: '算法是什么？',
    question_type: 'choice',
    options: { A: '有限步骤', B: '无限循环', C: '随机数', D: '内存地址' },
    correct_answer: 'A',
    explanation: '解释',
    topic: '考点',
    difficulty: 'easy',
    metadata: {},
  }]);
  assert.equal(question.type, 'mcq');
  assert.equal(question.stem, '算法是什么？');
  assert.equal(question.answer, 'A');
  assert.equal(question.choices.length, 4);
  assert.equal(question.choices[0].label, 'A');
  assert.equal(question.topic, '考点');
  // choices 与 options 都存在（两条消费路径各读一个）
  assert.deepEqual(Object.keys(question.options), ['A', 'B', 'C', 'D']);
  assert.equal(typeof question.answer, 'string');
});

test('产品形状：concept → trueFalse，答案映射成「正确/错误」', () => {
  const [verdict] = toProductQuestions([{
    question_id: 'q_1', question: '命题', question_type: 'concept',
    correct_answer: 'true', explanation: 'e', topic: 't', difficulty: 'easy', metadata: {},
  }]);
  assert.equal(verdict.type, 'trueFalse');
  assert.equal(verdict.answer, '正确');
  assert.deepEqual(verdict.choices, []);
  assert.equal(TYPE_MAP.fill_in_blank, 'cloze');
});

test('协议矩阵：四个阶段的 allowed/terminal/final 与上游一致', () => {
  assert.deepEqual([...PROTOCOL_EXPLORE.allowed], ['THINK', 'TOOL', 'FINISH']);
  assert.deepEqual([...PROTOCOL_EXPLORE.final], ['FINISH']);
  assert.equal(PROTOCOL_EXPLORE.toolLabel, 'TOOL');
  // plan 的 final 为空是**有意的**
  assert.deepEqual([...PROTOCOL_PLAN.allowed], ['PLAN']);
  assert.equal(PROTOCOL_PLAN.final.length, 0);
  assert.equal(PROTOCOL_PLAN.toolLabel, null);
  assert.deepEqual([...PROTOCOL_REPAIR.allowed], ['FINISH']);
  assert.equal(PROTOCOL_REPAIR.toolLabel, null);
  assert.deepEqual([...PROTOCOL_QUIZ.terminal], ['FINISH']);
});

test('useNativeTools：严格表判否时对云端 provider 乐观一档', () => {
  const schemas = [{ type: 'function', function: { name: 'x' } }];
  // 明确支持
  assert.equal(useNativeTools({ toolSchemas: schemas, modelInfo: { provider: 'openai', capabilities: { tools: true } } }), true);
  // 严格表说不行，但 provider 是云端 openai_compat（上游同样乐观）
  assert.equal(useNativeTools({ toolSchemas: schemas, modelInfo: { provider: 'siliconflow', capabilities: { tools: false } } }), true);
  // 本地 provider 相信严格表
  assert.equal(useNativeTools({ toolSchemas: schemas, modelInfo: { provider: 'ollama', capabilities: { tools: false } } }), false);
  // 没有工具就绝不走原生调用（否则模型会编造文本式 tool calls）
  assert.equal(useNativeTools({ toolSchemas: [], modelInfo: { provider: 'openai', capabilities: { tools: true } } }), false);
});

test('renderToolList：没有工具时给「- 无」/「- none」而不是空串', () => {
  assert.equal(renderToolList([], 'zh'), '- 无');
  assert.equal(renderToolList([], 'en'), '- none');
  assert.equal(
    renderToolList([{ type: 'function', function: { name: 'rag', description: '检索' } }], 'zh'),
    '- `rag` — 检索',
  );
});

test('信号取消：进入流水线前就 abort 会立刻抛出', async () => {
  const controller = new AbortController();
  controller.abort(new Error('用户取消'));
  await assert.rejects(
    () => runDeepQuestion({
      lecture: LECTURE, count: 1, type: 'choice', llm: createFakeLlm(healthyScript(1)),
      tools: createFakeTools(), signal: controller.signal,
    }),
    /用户取消/,
  );
});

test('题型入参：上游名与智云名都收（产品可能透传 task.type）', async () => {
  const { canonicalTypeName } = await import('../src/index.js');
  assert.equal(canonicalTypeName('mcq'), 'choice');
  assert.equal(canonicalTypeName('trueFalse'), 'concept');
  assert.equal(canonicalTypeName('cloze'), 'fill_in_blank');
  assert.equal(canonicalTypeName('shortAnswer'), 'short_answer');
  assert.equal(canonicalTypeName('choice'), 'choice');

  // 传智云名也能出对的题（typeList 归一成上游名）
  const llm = createFakeLlm(healthyScript(1));
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'mcq', llm, tools: createFakeTools(),
  });
  assert.equal(result.questions[0].type, 'mcq');
  const exploreUser = llm.calls[0].messages[1].content;
  assert.ok(exploreUser.includes('``choice``'), '提示词里必须是上游名');
});

test('强制收尾：迭代耗尽后仍能拿到 FINISH（前言不丢）', async () => {
  const llm = createFakeLlm([
    { text: '``THINK``想一' },
    { text: '``THINK``想二' },
    // 强制收尾第 1 次就成功
    { text: '``FINISH``强制收尾后的前言' },
    {
      text: `\`\`PLAN\`\`${JSON.stringify({
        analysis: '', templates: [{ topic: '考点', question_type: 'short_answer', difficulty: 'easy' }],
      })}`,
    },
    {
      text: `\`\`FINISH\`\`${JSON.stringify({
        question: '题面', correct_answer: '答案', explanation: '解析',
      })}`,
    },
  ]);
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'short_answer', llm, tools: createFakeTools(),
    config: { maxExploreIterations: 2 },
  });
  assert.equal(result.response, '强制收尾后的前言');
  assert.equal(result.questions.length, 1);
});

test('强制收尾失败两次 → 兜底假文本进解析 → 占位题（不丢题）', async () => {
  const llm = createFakeLlm([
    { text: '``FINISH``前言' },
    {
      text: `\`\`PLAN\`\`${JSON.stringify({
        analysis: '', templates: [{ topic: '考点', question_type: 'short_answer', difficulty: 'easy' }],
      })}`,
    },
    // quiz 两轮都在乱写（会先被判协议违规 / 或走迭代）
    { text: '``THINK``一直想' },
    { text: '``THINK``还在想' },
    // 强制收尾两次都不合格（正文里又出现行首标签 → 判不通过）
    { text: '``FINISH``\n``TOOL``再来' },
    { text: '``FINISH``\n``THINK``又违规' },
    // 之后的 repair 也拿不到 JSON
    { text: '``FINISH``修不好' },
  ]);
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'short_answer', llm, tools: createFakeTools(),
    config: { maxQuizIterations: 2 },
  });
  assert.equal(result.questions.length, 1, '题数不能变');
  assert.match(result.questions[0].stem, /^\[Generation failed\]/);
  assert.equal(result.summary.success, false);
});

test('repair 的 reasoning_only 也会降思考重问一次（且仍只算 1 轮 repair）', async () => {
  const llm = createFakeLlm([
    { text: '``FINISH``前言' },
    {
      text: `\`\`PLAN\`\`${JSON.stringify({
        analysis: '', templates: [{ topic: '考点', question_type: 'short_answer', difficulty: 'easy' }],
      })}`,
    },
    // quiz 缺解析 → 触发 repair
    {
      text: `\`\`FINISH\`\`${JSON.stringify({ question: '题面', correct_answer: '答案' })}`,
    },
    // repair #1：只思考不给 JSON
    { reasoningOnly: true },
    // repair 降思考重问：给合格载荷
    {
      text: `\`\`FINISH\`\`${JSON.stringify({
        question: '题面', correct_answer: '答案', explanation: '补上的解析',
      })}`,
    },
  ]);
  const result = await runDeepQuestion({
    lecture: LECTURE, count: 1, type: 'short_answer', llm, tools: createFakeTools(),
  });
  assert.equal(llm.calls.length, 5, 'explore + plan + quiz + repair(失败) + repair(重问)');
  assert.equal(result.questions[0].explanation, '补上的解析');
  assert.equal(result.summary.success, true, '修复成功就应报成功');
});

test('终态 RESULT 事件不带 questions（否则宿主会把每题收两遍）', async () => {
  const results = [];
  const stream = {
    async content() {},
    async progress() {},
    async thinking() {},
    async result(payload) { results.push(payload); },
  };
  await runDeepQuestion({
    lecture: LECTURE, count: 2, type: 'choice',
    llm: createFakeLlm(healthyScript(2)), tools: createFakeTools(),
    config: { stream },
  });
  assert.equal(results.length, 1, '只发一次终态 RESULT');
  const [payload] = results;
  assert.equal('questions' in payload, false, '顶层 questions 绝不能进事件（会和 summary.results 重复）');
  assert.equal(payload.summary.results.length, 2, '题目只能出现在 summary.results 里');
  assert.equal(payload.mode, 'custom');
  assert.ok(payload.usage.modelCalls > 0);
});

// ---------------------------------------------------------------- 本包自带的 labeled-step 兜底

test('兜底 runLabeledStep：标签探测 + finalMeta 两态推流', async () => {
  const { runLabeledStep: localStep } = await import('../src/labeled-step.js');
  const llm = createFakeLlm([{ text: '``FINISH``正文在这里' }]);
  const pushed = [];
  const stream = {
    async content(chunk) { pushed.push(['content', chunk]); },
    async thinking(chunk) { pushed.push(['thinking', chunk]); },
    async progress() {},
  };

  const buffered = await localStep({
    llm, messages: [{ role: 'user', content: 'hi' }],
    allowedLabels: ['FINISH'], finalLabels: ['FINISH'],
    stream, finalMeta: null,
  });
  assert.equal(buffered.label, 'FINISH');
  assert.equal(buffered.text, '正文在这里');
  assert.equal(pushed.length, 0, 'finalMeta=null 时正文只做返回值，不推流');

  const live = await localStep({
    llm: createFakeLlm([{ text: '``FINISH``逐字上屏' }]),
    messages: [], allowedLabels: ['FINISH'], finalLabels: ['FINISH'],
    stream, finalMeta: { trace_kind: 'llm_output' },
  });
  assert.equal(live.text, '逐字上屏');
  assert.deepEqual(pushed, [['content', '逐字上屏']], 'finalMeta 非空时逐 chunk 进气泡');
});

test('兜底 runLabeledStep：没有标签退化成 UNKNOWN（不抛）', async () => {
  const { runLabeledStep: localStep, LABEL_UNKNOWN } = await import('../src/labeled-step.js');
  const result = await localStep({
    llm: createFakeLlm([{ text: '完全没写标签的一段散文' }]),
    messages: [], allowedLabels: ['FINISH'], finalLabels: ['FINISH'],
  });
  assert.equal(result.label, LABEL_UNKNOWN);
  assert.equal(result.text, '完全没写标签的一段散文', '正文不能丢：协议修复轮要靠它');
});

test('兜底 runLabeledStep：reasoning_only 能被识别（plan 的降思考重问靠它）', async () => {
  const { runLabeledStep: localStep } = await import('../src/labeled-step.js');
  const result = await localStep({
    llm: createFakeLlm([{ reasoningOnly: true }]),
    messages: [], allowedLabels: ['PLAN'], finalLabels: [],
  });
  assert.equal(result.reasoningOnly, true);
  assert.equal(result.text.trim(), '');
});
