/**
 * `dsh-zhiyun-core-lecture-tools` 单测。
 *
 * 跑法（**不要**用 `node --test`，本机会 spawn EPERM）：
 *
 * ```bash
 * node tests/lecture-tools.test.mjs
 * ```
 *
 * # 测试的组织方式
 *
 * 每个 `describe` 对应一条**契约**，不是对应一个函数。理由：这四个工具的
 * 价值在"模型看到的文字"和"越界时的行为"，而不是内部函数结构。按契约测，
 * 重构内部时不至于把测试一起改掉（那等于把测试变成实现的复印件）。
 *
 * 其中「与上游逐字一致」那组刻意用**硬编码的期望字符串**（从 Python 真实现
 * 跑出来的基线里抄的），而不是从 `data/upstream.json` 里读回来比 ——
 * 后者只能证明"文件没被改过"，不能证明"文件当初就抄对了"。硬编码的那几行
 * 是唯一能挡住"重跑生成脚本把错的东西固化下来"的闸门。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createLectureTools,
  lectureToolSchemas,
  buildLectureIndex,
  lectureBlockText,
  pickLectureTools,
  LECTURE_TOOL_ORDER,
  UPSTREAM_DATA,
  buildToolListText,
  fallbackEmptyToolList,
  composePromptText,
  promptHintsFor,
  loadPromptHints,
  decorateSchema,
  normalizeRagSelectors,
  normalizeLimit,
  filterNames,
  renderManifestReport,
  runQuestionBank,
  createBankStore,
  renderEntry,
  renderCategories,
  truncate,
  pyRepr,
  reprString,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

/** 一份最小但覆盖全部块形态的讲义（definitions 里三种 kind 各一）。 */
function sampleLecture() {
  return {
    chapters: [
      {
        title: '第一章 力学',
        topics: [
          {
            title: '牛顿第二定律',
            blocks: [
              { kind: 'elaboration', text: '牛顿第二定律指出：物体的加速度与所受合外力成正比，与质量成反比，即 F = ma。' },
              { kind: 'definition', text: '惯性系：牛顿定律在其中成立的参考系。' },
              {
                kind: 'example',
                stem: '质量 2 kg 的物体受 10 N 水平恒力，求加速度。',
                solution: '由 F = ma 得 a = F/m = 5 m/s²。',
              },
            ],
          },
          {
            title: '动量守恒',
            // 第 2 块正文为空：用来验证「空块跳过但位置照占」。
            blocks: [
              { kind: 'elaboration', text: '封闭系统（合外力为零）总动量守恒。' },
              { kind: 'elaboration', text: '   ' },
              { kind: 'procedure', text: '步骤一：选取系统边界。步骤二：判断合外力是否为零。' },
            ],
          },
        ],
      },
      {
        // 没有 title 的章 / 知识点：验证 fallback 命名不影响 id。
        topics: [
          {
            blocks: [{ kind: 'elaboration', text: '库仑定律描述两个点电荷之间的静电力。' }],
          },
        ],
      },
    ],
  };
}

const LEARNING_HISTORY = [
  {
    id: 1,
    question: '牛顿第二定律 F=ma 中 a 表示什么？',
    user_answer: '加速度',
    correct_answer: '加速度',
    is_correct: true,
    bookmarked: true,
    categories: [{ name: '力学基础' }],
  },
  {
    id: 2,
    question: '动量守恒的成立条件是什么？',
    user_answer: '',
    correct_answer: '系统所受合外力为零',
    is_correct: false,
    categories: [],
  },
  {
    id: 3,
    question: '角动量守恒的判据？',
    user_answer: '合外力矩为零',
    correct_answer: '合外力矩为零',
    is_correct: true,
    categories: [{ name: '力学基础' }],
  },
];

function toolsOf(options = {}) {
  const tools = createLectureTools({ lecture: sampleLecture(), ...options });
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return { tools, byName };
}

async function call(tools, name, args, ctx) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `工具 ${name} 不存在`);
  return tool.handler(args ?? {}, ctx ?? {});
}

// ---------------------------------------------------------------------------
// 契约 1：导出形状
// ---------------------------------------------------------------------------

describe('createLectureTools 的导出契约', () => {
  test('导出四个工具，顺序与上游 compose_enabled_tools 的追加顺序一致', () => {
    const { tools } = toolsOf();
    assert.deepEqual(tools.map((tool) => tool.name), ['rag', 'kb_files', 'read_source', 'question_bank']);
    assert.deepEqual([...LECTURE_TOOL_ORDER], tools.map((tool) => tool.name));
  });

  test('每个工具都有 name / description / parameters / handler 四件套', () => {
    const { tools } = toolsOf();
    for (const tool of tools) {
      assert.equal(typeof tool.name, 'string');
      assert.ok(tool.name.length > 0);
      assert.equal(typeof tool.description, 'string');
      assert.ok(tool.description.length > 0, `${tool.name} 缺 description`);
      assert.equal(typeof tool.parameters, 'object');
      assert.equal(tool.parameters.type, 'object');
      assert.equal(typeof tool.parameters.properties, 'object');
      assert.equal(typeof tool.handler, 'function');
    }
  });

  test('handler 的两种返回形状', async () => {
    const { tools } = toolsOf();
    const ok = await call(tools, 'kb_files', {});
    assert.equal(ok.ok, true);
    assert.equal(typeof ok.result.content, 'string');
    assert.equal(ok.error, undefined);

    const bad = await call(tools, 'rag', { query: '' });
    assert.equal(bad.ok, false);
    assert.equal(typeof bad.error, 'string');
    assert.equal(bad.result, undefined);
  });

  test('工具定义每次都是新对象（就地打补丁不会污染下一轮）', () => {
    const a = toolsOf().tools;
    const b = toolsOf().tools;
    a[0].parameters.properties.query.patched = true;
    assert.equal(b[0].parameters.properties.query.patched, undefined);
  });

  test('pickLectureTools 按给定名字与顺序挑工具', () => {
    const { tools } = toolsOf();
    const picked = pickLectureTools(tools, ['read_source', 'rag', 'nope']);
    assert.deepEqual(picked.map((tool) => tool.name), ['read_source', 'rag']);
  });
});

// ---------------------------------------------------------------------------
// 契约 2：description / parameters 与上游逐字一致
// ---------------------------------------------------------------------------

describe('description 与 parameters 逐字取自上游', () => {
  test('rag 的 description 逐字', () => {
    const { byName } = toolsOf();
    assert.equal(
      byName.get('rag').description,
      'Retrieve relevant passages from one of the knowledge bases the user attached to this turn. '
      + 'Call once per knowledge base you want to consult; the system runs them in parallel.',
    );
  });

  test('kb_files 的 description 逐字（含 em dash）', () => {
    const { byName } = toolsOf();
    assert.equal(
      byName.get('kb_files').description,
      'List the documents stored in one of the knowledge bases attached to this turn, with the total count. '
      + 'Use this — never rag — for questions about how many files a knowledge base holds, what its files are '
      + 'called, or whether a particular file is in it.',
    );
  });

  test('read_source 的 description 逐字', () => {
    const { byName } = toolsOf();
    assert.equal(
      byName.get('read_source').description,
      "Load the full text of one attached source by id. Use ONLY when the preview shown in the Attached "
      + "Sources manifest is insufficient to answer the user's question. The id must be copied verbatim "
      + 'from the manifest — do not invent ids. Do not call this on every source \'just in case\'.',
    );
  });

  test('question_bank 的 description 逐字（含 → 与反引号）', () => {
    const { byName } = toolsOf();
    const description = byName.get('question_bank').description;
    assert.ok(description.startsWith('Read, organise, and record the learner\'s question bank — the graded'));
    assert.ok(description.includes('Learning Space → Question Bank'));
    assert.ok(description.includes("action='overview' for counts + existing categories"));
    assert.ok(description.includes('the category is created if it does not exist'));
    assert.equal(description.length, 796);
  });

  test('参数名与 required 与上游一致（一个都不能改名）', () => {
    const { byName } = toolsOf();
    assert.deepEqual(
      Object.keys(byName.get('rag').parameters.properties),
      ['query', 'kb_name', 'source_path', 'asset_id', 'figure', 'page', 'region', 'source_hash', 'presentation'],
    );
    assert.deepEqual(byName.get('rag').parameters.required, ['query', 'kb_name']);
    assert.deepEqual(
      Object.keys(byName.get('kb_files').parameters.properties),
      ['kb_name', 'pattern', 'limit'],
    );
    assert.deepEqual(byName.get('kb_files').parameters.required, ['kb_name']);
    assert.deepEqual(Object.keys(byName.get('read_source').parameters.properties), ['source_id']);
    assert.deepEqual(byName.get('read_source').parameters.required, ['source_id']);
    assert.deepEqual(
      Object.keys(byName.get('question_bank').parameters.properties),
      ['action', 'question', 'user_answer', 'correct_answer', 'explanation', 'is_correct',
        'filter', 'category', 'search', 'entry_ids', 'bookmarked', 'limit'],
    );
    assert.deepEqual(byName.get('question_bank').parameters.required, ['action']);
  });

  test('细粒度约束没被抹掉：nullable / enum / minimum / minItems / items', () => {
    const { byName } = toolsOf();
    const rag = byName.get('rag').parameters.properties;
    // 上游 RAGTool 覆写 raw_parameters，把 presentation 的 type 改成 [T, null] 并追加 null
    assert.deepEqual(rag.presentation.type, ['string', 'null']);
    assert.deepEqual(rag.presentation.enum, ['inspect', 'teaching', 'reveal', null]);
    assert.deepEqual(rag.page.type, ['integer', 'null']);
    assert.equal(rag.page.minimum, 1);
    assert.deepEqual(rag.region.items, { type: 'number', minimum: 0, maximum: 1 });
    assert.equal(rag.region.minItems, 4);
    assert.equal(rag.region.maxItems, 4);

    const bank = byName.get('question_bank').parameters.properties;
    assert.deepEqual(bank.action.enum, ['overview', 'list', 'organize', 'unfile', 'bookmark', 'record']);
    assert.deepEqual(bank.filter.enum, ['all', 'wrong', 'bookmarked', 'uncategorized']);
    assert.deepEqual(bank.entry_ids.items, { type: 'integer' });
  });

  test('description 里没有会被 findInlineLabels 误判的字符', () => {
    // 模型的工具描述可能与协议正文混进同一段文字；行首的 ``TOOL`` / ``FINISH``
    // 会被 find_inline_labels 当成第二个协议标签，触发一轮协议违规重试。
    const { tools } = toolsOf();
    for (const tool of tools) {
      assert.ok(!/\{|\}/.test(tool.description), `${tool.name} 的 description 里有花括号`);
      assert.ok(!/\b(FINISH|TOOL|THINK)\b/.test(tool.description), `${tool.name} 的 description 里有协议标签`);
      assert.ok(!tool.description.includes('\n'), `${tool.name} 的 description 是多行的`);
      for (const [paramName, schema] of Object.entries(tool.parameters.properties)) {
        assert.ok(!/\b(FINISH|TOOL|THINK)\b/.test(schema.description ?? ''), `${tool.name}.${paramName} 有协议标签`);
      }
    }
  });

  test('数据文件里记录了它的来源与重新生成方式', () => {
    assert.ok(String(UPSTREAM_DATA._source).includes('vendor/deeptutor'));
    assert.ok(String(UPSTREAM_DATA._regenerate).includes('gen-lecture-tool-data.py'));
  });
});

// ---------------------------------------------------------------------------
// 契约 3：schema 生成
// ---------------------------------------------------------------------------

describe('lectureToolSchemas', () => {
  test('产出 OpenAI function schema 数组，name/description 原样', () => {
    const { tools } = toolsOf();
    const schemas = lectureToolSchemas(tools);
    assert.equal(schemas.length, 4);
    assert.deepEqual(schemas.map((schema) => schema.type), ['function', 'function', 'function', 'function']);
    assert.deepEqual(
      schemas.map((schema) => schema.function.name),
      ['rag', 'kb_files', 'read_source', 'question_bank'],
    );
    assert.equal(schemas[0].function.description, tools[0].description);
  });

  test('默认补 rag.query.minLength=1 与 parameters.additionalProperties=false', () => {
    const schemas = lectureToolSchemas(toolsOf().tools);
    const rag = schemas.find((schema) => schema.function.name === 'rag');
    assert.equal(rag.function.parameters.properties.query.minLength, 1);
    for (const schema of schemas) {
      assert.equal(schema.function.parameters.additionalProperties, false, `${schema.function.name} 缺 additionalProperties`);
    }
  });

  test('kbChoices / sourceIds 收窄 enum（上游 _build_llm_tool_schemas 的两处补丁）', () => {
    const schemas = lectureToolSchemas(toolsOf().tools, {
      kbChoices: ['lec-1'],
      sourceIds: ['t1-1', 't1-2'],
    });
    const rag = schemas.find((schema) => schema.function.name === 'rag');
    assert.deepEqual(rag.function.parameters.properties.kb_name.enum, ['lec-1']);
    const readSource = schemas.find((schema) => schema.function.name === 'read_source');
    assert.deepEqual(readSource.function.parameters.properties.source_id.enum, ['t1-1', 't1-2']);
  });

  test('不给 kbChoices 时不写 enum（不能凭空造一个空 enum）', () => {
    const schemas = lectureToolSchemas(toolsOf().tools);
    const rag = schemas.find((schema) => schema.function.name === 'rag');
    assert.equal(rag.function.parameters.properties.kb_name.enum, undefined);
  });

  test('schema 是深拷贝：改 schema 不会改到工具定义', () => {
    const { tools } = toolsOf();
    const schemas = lectureToolSchemas(tools);
    schemas[0].function.parameters.properties.query.description = 'tampered';
    assert.equal(tools[0].parameters.properties.query.description, 'Search query.');
  });

  test('已写过 minLength 的不被覆盖（setdefault 语义）', () => {
    const tool = {
      name: 'rag',
      description: 'x',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'q', minLength: 3 } },
        required: ['query'],
      },
    };
    const [schema] = lectureToolSchemas([tool]);
    assert.equal(schema.function.parameters.properties.query.minLength, 3);
  });

  test('坏条目跳过而不是抛错，且接受单个工具对象', () => {
    const schemas = lectureToolSchemas([null, { name: '' }, { name: 'a', parameters: [] }]);
    assert.deepEqual(schemas, []);
    const single = lectureToolSchemas({ name: 'x', description: 'y', parameters: { type: 'object', properties: {} } });
    assert.equal(single.length, 1);
    assert.deepEqual(lectureToolSchemas(undefined), []);
  });

  test('decorateSchema 对没有 properties 的 schema 也只补 additionalProperties', () => {
    const schema = decorateSchema({ function: { name: 'z', parameters: { type: 'object' } } });
    assert.equal(schema.function.parameters.additionalProperties, false);
  });
});

// ---------------------------------------------------------------------------
// 契约 4：按知识点取原文（read_source）
// ---------------------------------------------------------------------------

describe('read_source：按知识点 / 块取原文', () => {
  test('用 topic id 取到该知识点的完整正文（含例题的题干与解答）', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'read_source', { source_id: 't1-1' });
    assert.equal(result.ok, true);
    const text = result.result.content;
    assert.ok(text.includes('牛顿第二定律指出'));
    assert.ok(text.includes('惯性系'));
    // 例题：题干与解答都要在（只取 text 会丢解答）
    assert.ok(text.includes('质量 2 kg 的物体受 10 N 水平恒力'), '缺题干');
    assert.ok(text.includes('a = F/m = 5 m/s²'), '缺解答');
    // 顺序必须是讲义顺序
    assert.ok(text.indexOf('牛顿第二定律指出') < text.indexOf('惯性系'));
    assert.ok(text.indexOf('惯性系') < text.indexOf('质量 2 kg'));
  });

  test('来源粒度是知识点：章 id 与块 id 都不是合法来源', async () => {
    const { tools } = toolsOf();
    // 为什么刻意不是块/章粒度：见 buildLectureIndex 的文件头 —— sources 的粒度
    // 决定上游那条「唯一来源自动补 id」还能不能生效。块 id 仍然出现在 rag 的
    // metadata（trace / 高亮），但 read_source 读的是「一节」这个完整单元。
    for (const badId of ['b1-1-3', 'ch1']) {
      const result = await call(tools, 'read_source', { source_id: badId });
      assert.equal(result.ok, false, `${badId} 不该被 read_source 接受`);
      assert.ok(result.error.startsWith(`Error: unknown source_id '${badId}'.`));
    }
  });

  test('metadata 带 kind / title / char_count（trace 与 UI 用）', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'read_source', { source_id: 't1-1' });
    assert.equal(result.result.metadata.source_id, 't1-1');
    assert.equal(result.result.metadata.kind, 'topic');
    assert.equal(result.result.metadata.title, '牛顿第二定律');
    assert.equal(result.result.metadata.char_count, result.result.content.length);
  });

  test('编号规则：空正文块跳过但位置照占（与 learning-resource 的 id 对齐）', async () => {
    const index = buildLectureIndex(sampleLecture());
    // 动量守恒的第 2 块正文是空白，被跳过；第 3 块必须仍是 b1-2-3
    assert.deepEqual(index.blocks.map((block) => block.id).filter((id) => id.startsWith('b1-2')),
      ['b1-2-1', 'b1-2-3']);
    const topic = index.sources.get('t1-2');
    assert.deepEqual(topic.blockIds, ['b1-2-1', 'b1-2-3']);
    assert.ok(topic.text.includes('步骤一'));
    assert.ok(!topic.text.includes('  '), '正文里不该残留空白块');
    // 空块的位置被点名时要如实报未知 id（它在索引里确实不存在）
    const { tools } = toolsOf();
    const empty = await call(tools, 'read_source', { source_id: 'b1-2-2' });
    assert.equal(empty.ok, false);
  });

  test('没有 title 的章 / 知识点也能取，命名有兜底', async () => {
    const index = buildLectureIndex(sampleLecture());
    assert.ok(index.sources.has('t2-1'));
    assert.equal(index.sources.get('t2-1').text, '库仑定律描述两个点电荷之间的静电力。');
    assert.equal(index.outline[2].name, 'Chapter 2/Topic 2.1');
  });
});

// ---------------------------------------------------------------------------
// 契约 5：超出范围时的错误
// ---------------------------------------------------------------------------

describe('read_source：超出范围 / 非法 id 的错误语义', () => {
  test('未知 id → 报错并列出本次真实可用的 id', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'read_source', { source_id: 't9-9' });
    assert.equal(result.ok, false);
    assert.equal(
      result.error,
      "Error: unknown source_id 't9-9'. Valid ids for this turn: t1-1, t1-2, t2-1.",
    );
  });

  test('多个来源却没给 id → 明确要求 id，绝不默认取第一个', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'read_source', {});
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Error: source_id is required when multiple sources are available.');
  });

  test('只有一份来源时自动补 id（猜错的唯一答案就是它）', async () => {
    const tools = createLectureTools({
      lecture: { chapters: [{ title: 'C', topics: [{ title: 'T', blocks: [{ kind: 'elaboration', text: '唯一一段' }] }] }] },
    });
    const result = await call(tools, 'read_source', {});
    assert.equal(result.ok, true);
    assert.equal(result.result.content, '唯一一段');
  });

  test('讲义里没有任何正文 → 说明本轮没有来源', async () => {
    const tools = createLectureTools({ lecture: { chapters: [] } });
    const result = await call(tools, 'read_source', { source_id: 't1-1' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Error: no attached sources are available for this turn.');
  });

  test('id 是空串时按"没给"处理，不是按未知 id', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'read_source', { source_id: '   ' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Error: source_id is required when multiple sources are available.');
  });
});

// ---------------------------------------------------------------------------
// 契约 6：检索（rag）
// ---------------------------------------------------------------------------

describe('rag：讲义内检索', () => {
  test('命中返回带 [source-id] 的段落（提示词要求模型按这个格式引用）', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'rag', { query: '牛顿第二定律', kb_name: 'lec' });
    assert.equal(result.ok, true);
    assert.match(result.result.content, /^\[t1-1\]/);
    assert.ok(result.result.content.includes('牛顿第二定律指出'));
    assert.ok(result.result.content.includes('第一章 力学 · 牛顿第二定律'));
    assert.equal(result.result.metadata.provider, 'lecture-memory');
    // 引用 id 必须是 read_source 能读回去的那一套（知识点 id）
    // 同一知识点的多个块命中，引用 id 去重后只剩一个（一条引用指向整节）
    assert.deepEqual(result.result.metadata.source_ids, ['t1-1']);
    assert.ok(result.result.metadata.block_ids.every((id) => /^b\d+-\d+-\d+$/.test(id)));
    for (const id of result.result.metadata.source_ids) {
      const readBack = await call(tools, 'read_source', { source_id: id });
      assert.equal(readBack.ok, true, `引用 id ${id} 读不回去`);
    }
  });

  test('sources 行与上游 _rag_sources 同形（type / kb_name / source）', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'rag', { query: '库仑定律', kb_name: 'lec' });
    assert.equal(result.result.sources.length, 1);
    const [source] = result.result.sources;
    assert.equal(source.type, 'rag');
    assert.equal(source.kb_name, 'lec');
    assert.equal(source.source, 't2-1');
    assert.equal(source.topic_id, 't2-1');
    assert.deepEqual(source.block_ids, ['b2-1-1']);
  });

  test('中文二元组切词能让两字以上的词命中', async () => {
    const { tools } = toolsOf();
    for (const query of ['惯性系', '动量', '合外力', '加速度']) {
      const result = await call(tools, 'rag', { query, kb_name: 'lec' });
      assert.equal(result.ok, true, `${query} 检索失败`);
      assert.ok(result.result.metadata.hits > 0, `${query} 没有命中`);
    }
  });

  test('检索失败是"成功但没命中"，不是错误（与上游同一句话）', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'rag', { query: 'zzz-不存在-zzz', kb_name: 'lec' });
    assert.equal(result.ok, true);
    assert.equal(
      result.result.content,
      "No matching content was found in knowledge base 'lec'. The search completed successfully.",
    );
    assert.deepEqual(result.result.sources, []);
    assert.equal(result.result.metadata.hits, 0);
  });

  test('空 query / 空 kb_name 是参数错，不是空结果', async () => {
    const { tools } = toolsOf();
    const noQuery = await call(tools, 'rag', { query: '  ', kb_name: 'lec' });
    assert.equal(noQuery.ok, false);
    assert.equal(noQuery.error, 'RAG query must be a non-empty string.');

    const noKb = await call(tools, 'rag', { query: 'x', kb_name: '' });
    assert.equal(noKb.ok, false);
    assert.equal(noKb.error, 'RAG requires an explicit kb_name.');
  });

  test('knowledge.kbName 作为 kb_name 缺省值（上游 setdefault 语义）', async () => {
    const { tools } = toolsOf({ knowledge: { kbName: '力学讲义' } });
    const result = await call(tools, 'rag', { query: '动量' });
    assert.equal(result.ok, true);
    assert.equal(result.result.metadata.kb_name, '力学讲义');

    // 模型显式给了就覆盖缺省值
    const explicit = await call(tools, 'rag', { query: '动量', kb_name: '别处' });
    assert.equal(explicit.result.metadata.kb_name, '别处');
  });

  test('精确来源选择器：认参数但明确拒绝，并给出下一步（不静默忽略）', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'rag', { query: '图 3.2', kb_name: 'lec', page: 7, source_path: 'a.pdf' });
    assert.equal(result.ok, false);
    assert.equal(result.metadata.error_type, 'unsupported_by_lecture_source');
    assert.deepEqual(result.metadata.selectors, ['source_path', 'page']);
    assert.ok(result.error.includes('read_source'), '拒绝文案必须指出替代路径');
    assert.ok(result.error.includes('kb_files'));
  });

  test('region=[] 当作未提供（上游的旧客户端占位兼容）', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'rag', { query: '动量', kb_name: 'lec', region: [] });
    assert.equal(result.ok, true);
  });

  test('非法的 page / region 在选择器校验处就被拒（与上游同一句话）', async () => {
    const { tools } = toolsOf();
    const badPage = await call(tools, 'rag', { query: 'x', kb_name: 'lec', page: 0 });
    assert.equal(badPage.ok, false);
    assert.equal(
      badPage.error,
      'Invalid page 0: PDF pages are one-based. Resend with a page >= 1, or null to omit the page.',
    );
    assert.equal(badPage.metadata.error_type, 'invalid_selector');

    const badRegion = await call(tools, 'rag', { query: 'x', kb_name: 'lec', region: [0, 0, 1, 1.5] });
    assert.equal(badRegion.ok, false);
    assert.ok(badRegion.error.startsWith('Invalid region [0, 0, 1, 1.5]: a crop must be four finite numbers'));
  });

  test('命中按分数降序、同分按讲义顺序（结果必须可复现）', async () => {
    const { tools } = toolsOf();
    const first = await call(tools, 'rag', { query: '合外力', kb_name: 'lec' });
    const second = await call(tools, 'rag', { query: '合外力', kb_name: 'lec' });
    assert.deepEqual(first.result.metadata.source_ids, second.result.metadata.source_ids);
  });

  test('limit 收窄命中数', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'rag', { query: '的', kb_name: 'lec', limit: 1 });
    assert.equal(result.result.metadata.hits, 1);
  });
});

// ---------------------------------------------------------------------------
// 契约 7：清单（kb_files）
// ---------------------------------------------------------------------------

describe('kb_files：讲义清单', () => {
  test('列出知识点，带总数（英文默认）', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'kb_files', { kb_name: 'lec' });
    assert.equal(result.ok, true);
    assert.equal(
      result.result.content,
      'Knowledge base "lec": 3 documents.\n'
      + '1. 第一章 力学/牛顿第二定律\n'
      + '2. 第一章 力学/动量守恒\n'
      + '3. Chapter 2/Topic 2.1',
    );
    assert.equal(result.result.metadata.total, 3);
    assert.deepEqual(result.result.metadata.listed, ['t1-1', 't1-2', 't2-1']);
  });

  test('中文文案逐字对齐上游 manifest report', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'kb_files', { kb_name: 'lec' }, { language: 'zh' });
    assert.equal(
      result.result.content,
      '知识库「lec」共 3 个文档。\n'
      + '1. 第一章 力学/牛顿第二定律\n'
      + '2. 第一章 力学/动量守恒\n'
      + '3. Chapter 2/Topic 2.1',
    );
  });

  test('pattern 过滤：glob 与子串', async () => {
    const { tools } = toolsOf();
    const glob = await call(tools, 'kb_files', { kb_name: 'lec', pattern: '*牛顿*' });
    assert.ok(glob.result.content.includes('Matching "*牛顿*": 1.'));
    assert.equal(glob.result.metadata.matched, 1);

    const substring = await call(tools, 'kb_files', { kb_name: 'lec', pattern: '动量' });
    assert.ok(substring.result.content.includes('2. 第一章 力学/动量守恒') || substring.result.content.includes('1. 第一章 力学/动量守恒'));

    const noMatch = await call(tools, 'kb_files', { kb_name: 'lec', pattern: '不存在' });
    assert.ok(noMatch.result.content.includes('No document name matches "不存在".'));
  });

  test('limit 截断 + omitted 提示', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'kb_files', { kb_name: 'lec', limit: 1 });
    assert.equal(result.result.metadata.omitted, 2);
    assert.ok(result.result.content.includes('Showing the first 1; 2 more not listed'));
  });

  test('空讲义走上游的 empty 文案', async () => {
    const tools = createLectureTools({ lecture: { chapters: [] } });
    const result = await call(tools, 'kb_files', { kb_name: 'lec' });
    assert.equal(result.result.content, 'Knowledge base "lec" holds no documents.');
    assert.equal(result.result.metadata.total, 0);
  });

  test('limit 归一对齐上游 _kb_files_limit', () => {
    assert.equal(normalizeLimit(undefined), 200);
    assert.equal(normalizeLimit(0), 200);
    assert.equal(normalizeLimit(-3), 200);
    assert.equal(normalizeLimit('many'), 200);
    assert.equal(normalizeLimit('42.5'), 200); // Python int("42.5") 抛错 → 默认值
    assert.equal(normalizeLimit(' 42 '), 42);
    assert.equal(normalizeLimit(5000), 1000);
  });

  test('名字过滤对齐上游 _filter_names（含大小写不敏感的末段匹配）', () => {
    const names = ['a/Newton.pdf', 'b/newton.PDF', 'c/其它.txt'];
    assert.deepEqual(filterNames(names, '*.pdf'), ['a/Newton.pdf', 'b/newton.PDF']);
    assert.deepEqual(filterNames(names, 'NEWTON'), ['a/Newton.pdf', 'b/newton.PDF']);
    assert.deepEqual(filterNames(names, ''), names);
  });

  test('renderManifestReport 的 empty 分支（本地讲义没有"索引状态"可言）', () => {
    // 上游的 unavailable 分支是给磁盘/远端知识库用的；本地讲义没有那两种状态，
    // 只有「有知识点」与「没有知识点」。这里锁住空讲义走的是 empty 文案，
    // 而不是被误解成"读不到目录"。
    const text = renderManifestReport({ name: 'kb', total: 0, matched: 0, documents: [] });
    assert.equal(text, 'Knowledge base "kb" holds no documents.');
  });
});

// ---------------------------------------------------------------------------
// 契约 8：历史题查询（question_bank）
// ---------------------------------------------------------------------------

describe('question_bank：历史题查询（出题查重）', () => {
  test('overview：计数 + 分类（逐字对齐上游）', async () => {
    const { tools } = toolsOf({ history: LEARNING_HISTORY });
    const result = await call(tools, 'question_bank', { action: 'overview' });
    assert.equal(result.ok, true);
    assert.equal(
      result.result.content,
      'Question bank: 3 questions (1 answered wrong, 1 bookmarked, 1 not filed in any category).\n'
      + 'Categories: 力学基础 (2)\n\n'
      + "Next: `list` the entries you want (filter='wrong' or 'uncategorized'), "
      + 'then `organize` them into a category by name.',
    );
    assert.deepEqual(result.result.metadata.question_bank.stats, {
      total: 3, wrong: 1, unresolved: 1, bookmarked: 1, uncategorized: 1,
    });
  });

  test('没有历史题时说明题库为空（出题链据此跳过查重）', async () => {
    const { tools } = toolsOf();
    const result = await call(tools, 'question_bank', { action: 'overview' });
    assert.equal(result.ok, true);
    assert.equal(
      result.result.content,
      'The question bank is empty — the learner has not answered any quiz questions yet.',
    );
  });

  test('list：默认 all，带 id 与答题对照', async () => {
    const { tools } = toolsOf({ history: LEARNING_HISTORY });
    const result = await call(tools, 'question_bank', { action: 'list' });
    assert.equal(result.ok, true);
    const text = result.result.content;
    assert.ok(text.startsWith('Question bank — all (3 of 3):'));
    assert.ok(text.includes('- [1] ✓ ★ 牛顿第二定律 F=ma 中 a 表示什么？'));
    assert.ok(text.includes('    answered: 加速度 | correct: 加速度'));
    assert.ok(text.includes('    filed in: 力学基础'));
    assert.ok(text.includes('- [2] ✗ 动量守恒的成立条件是什么？'));
    assert.ok(text.includes('    answered: — | correct: 系统所受合外力为零'));
    assert.ok(text.includes('    filed in: (nothing yet)'));
    assert.deepEqual(result.result.metadata.question_bank.entry_ids, [1, 2, 3]);
  });

  test('list + filter=wrong 只给答错的题', async () => {
    const { tools } = toolsOf({ history: LEARNING_HISTORY });
    const result = await call(tools, 'question_bank', { action: 'list', filter: 'wrong' });
    assert.ok(result.result.content.startsWith('Question bank — wrong (1 of 1):'));
    assert.deepEqual(result.result.metadata.question_bank.entry_ids, [2]);
  });

  test('list + filter=uncategorized 是待整理的收件箱', async () => {
    const { tools } = toolsOf({ history: LEARNING_HISTORY });
    const result = await call(tools, 'question_bank', { action: 'list', filter: 'uncategorized' });
    assert.deepEqual(result.result.metadata.question_bank.entry_ids, [2]);
  });

  test('list + filter=bookmarked / category / search / limit', async () => {
    const { tools } = toolsOf({ history: LEARNING_HISTORY });
    const bookmarked = await call(tools, 'question_bank', { action: 'list', filter: 'bookmarked' });
    assert.deepEqual(bookmarked.result.metadata.question_bank.entry_ids, [1]);

    const category = await call(tools, 'question_bank', { action: 'list', category: '力学基础' });
    assert.deepEqual(category.result.metadata.question_bank.entry_ids, [1, 3]);

    const search = await call(tools, 'question_bank', { action: 'list', search: '动量' });
    assert.deepEqual(search.result.metadata.question_bank.entry_ids, [2, 3]);

    const limited = await call(tools, 'question_bank', { action: 'list', limit: 1 });
    assert.ok(limited.result.content.includes('... 2 more; raise `limit` or narrow with `search`.'));
  });

  test('list 的空结果与各错误分支文案逐字对齐上游', async () => {
    const { tools } = toolsOf({ history: [] });
    const empty = await call(tools, 'question_bank', { action: 'list' });
    assert.equal(empty.result.content, 'No question-bank entries match that filter.');

    const badFilter = await call(tools, 'question_bank', { action: 'list', filter: 'nope' });
    assert.equal(badFilter.ok, false);
    assert.equal(badFilter.error, "Unknown filter 'nope'. Use one of: all, wrong, bookmarked, uncategorized.");

    // 用带历史题的夹具：空题库的 Existing 列表里没有分类，措辞会不同
    const withHistory = toolsOf({ history: LEARNING_HISTORY }).tools;
    const badCategory = await call(withHistory, 'question_bank', { action: 'list', category: '不存在' });
    assert.equal(badCategory.ok, false);
    assert.equal(badCategory.error, "No category named '不存在'. Existing: 力学基础 (2).");

    const badAction = await call(tools, 'question_bank', { action: 'nope' });
    assert.equal(badAction.ok, false);
    assert.equal(
      badAction.error,
      "Unknown action 'nope'. Use one of: overview, list, organize, unfile, bookmark, record.",
    );
  });

  test('写动作如实拒绝：不假装成功，也不落盘', async () => {
    const { tools } = toolsOf({ history: LEARNING_HISTORY });
    for (const action of ['organize', 'unfile', 'bookmark', 'record']) {
      const result = await call(tools, 'question_bank', { action, entry_ids: [1], category: '新分类' });
      assert.equal(result.ok, false, `${action} 不该返回成功`);
      assert.ok(result.error.includes(action), `${action} 的拒绝文案要点名动作`);
      assert.ok(result.error.includes('read-only') || result.error.includes('只读'));
      // 不能出现上游的"用户立刻能看到"那句：那是在宣布一件没发生的事
      assert.ok(!result.error.includes('The learner sees this immediately'));
    }
  });

  test('接受与上游 store 同形的异步对象（集成层可直接塞 SQLite 适配器）', async () => {
    const store = {
      async list_notebook_entries(query) {
        return {
          items: [{ id: 7, question: '来自 store 的题', user_answer: 'x', correct_answer: 'y', is_correct: 0 }],
          total: 1,
        };
      },
      async question_bank_stats() {
        return { total: 1, wrong: 1, unresolved: 1, bookmarked: 0, uncategorized: 1 };
      },
      async list_categories() {
        return [];
      },
      async find_category_by_name() {
        return null;
      },
    };
    const { tools } = toolsOf({ history: store });
    const listed = await call(tools, 'question_bank', { action: 'list' });
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.result.metadata.question_bank.entry_ids, [7]);
  });

  test('store 缺方法时降级为空结果，不抛（题库坏了不能中断出题）', async () => {
    const { tools } = toolsOf({ history: {} });
    const result = await call(tools, 'question_bank', { action: 'overview' });
    assert.equal(result.ok, true);
    assert.ok(result.result.content.includes('empty'));
  });

  test('条目渲染：长题面截断，答题缺失用 em dash', () => {
    const line = renderEntry({
      id: 9,
      question: '长'.repeat(300),
      userAnswer: '',
      correctAnswer: '',
      isCorrect: false,
      bookmarked: false,
      categories: [],
    });
    assert.ok(line.startsWith('- [9] ✗ '));
    assert.ok(line.includes('…'));
    assert.ok(!line.includes('answered:'), '两边都空时不该输出 answered 行');
    assert.ok(line.includes('filed in: (nothing yet)'));
  });

  test('truncate / renderCategories 对齐上游', () => {
    assert.equal(truncate('a   b\n c', 10), 'a b c');
    assert.equal(truncate('abcdef', 4), 'abc…');
    assert.equal(renderCategories([]), '(no categories yet — `organize` creates one by name)');
    assert.equal(renderCategories([{ name: 'X', entry_count: 2 }]), 'X (2)');
  });

  test('createBankStore 归一 camelCase 与 snake_case 两种字段名', async () => {
    const store = createBankStore([
      { id: 1, stem: 'camel 题', userAnswer: 'u', correctAnswer: 'c', isCorrect: true, categories: ['字符串分类'] },
    ]);
    const listed = await store.listNotebookEntries({});
    assert.equal(listed.items[0].question, 'camel 题');
    assert.equal(listed.items[0].userAnswer, 'u');
    assert.equal(listed.items[0].isCorrect, true);
    assert.deepEqual(listed.items[0].categories, [{ name: '字符串分类' }]);
  });

  test('runQuestionBank 永不抛错（含坏 store）', async () => {
    const broken = {
      async question_bank_stats() {
        throw new Error('db gone');
      },
      async list_categories() {
        return [];
      },
      async find_category_by_name() {
        return null;
      },
      async list_notebook_entries() {
        throw new Error('db gone');
      },
    };
    // 方法存在却抛错 → 必须把错抛给调用方：吞掉会让 overview 显示"题库是空的"这种假事实
    const result = await runQuestionBank({ action: 'overview' }, createBankStore(broken), { language: 'en' });
    assert.equal(result.ok, false);
    assert.ok(result.error.startsWith('Question bank error: db gone'), result.error);
  });
});

// ---------------------------------------------------------------------------
// 契约 9：提示词 hint（{tool_list} 的内容）
// ---------------------------------------------------------------------------

describe('提示词 hint 与工具清单渲染', () => {
  test('四个工具都有中英两套 hint', () => {
    for (const name of LECTURE_TOOL_ORDER) {
      for (const language of ['en', 'zh']) {
        const hint = loadPromptHints(name, language);
        assert.ok(hint.short_description.length > 0, `${name}/${language} 缺 short_description`);
        assert.ok(hint.phase.length > 0, `${name}/${language} 缺 phase`);
      }
    }
  });

  test('list_with_usage 的格式与上游逐字一致（四空格缩进、反引号包裹名字）', () => {
    const text = buildToolListText(['read_source'], 'en');
    assert.equal(
      text,
      '- `read_source` — Load the full text of an attached source (notebook record, book pages, history session, '
      + 'question-bank entry, document attachment) by its manifest id.\n'
      + '    When to use: Call ONLY when the preview shown in the "Attached Sources" manifest is not enough to '
      + "answer the user's question. Do not re-fetch sources whose preview already covers the question.\n"
      + '    Input: {"source_id": "the exact id from the manifest (e.g. nb-... / bk-... / hs-... / qb-... / at-...)"}.',
    );
  });

  test('中文 hint 用中文标签（适用场景 / 参数格式）', () => {
    const text = buildToolListText(['kb_files'], 'zh');
    assert.match(text, /^- `kb_files` — /);
    assert.ok(text.includes('    适用场景: '));
    assert.ok(text.includes('    参数格式: '));
  });

  test('顺序跟着 names 走（提示词里的清单顺序 = schema 顺序）', () => {
    const text = buildToolListText(['question_bank', 'rag'], 'en');
    assert.ok(text.indexOf('`question_bank`') < text.indexOf('`rag`'));
  });

  test('五种格式都能渲染；未知格式抛错而不是静默降级', () => {
    const hints = promptHintsFor(['rag'], 'en');
    for (const format of ['list', 'list_with_usage', 'table', 'aliases', 'phased']) {
      const text = composePromptText(hints, { format, language: 'en' });
      assert.equal(typeof text, 'string');
      assert.ok(text.length > 0, `${format} 渲染成空串`);
    }
    assert.throws(() => composePromptText(hints, { format: 'nope' }), /Unsupported prompt format: nope/);
  });

  test('list 格式只有一行 description', () => {
    assert.equal(composePromptText(promptHintsFor(['read_source'], 'en'), { format: 'list' }),
      '- read_source: Load the full text of an attached source (notebook record, book pages, history session, '
      + 'question-bank entry, document attachment) by its manifest id.');
  });

  test('空清单的兜底文案', () => {
    assert.equal(fallbackEmptyToolList('en'), '- none');
    assert.equal(fallbackEmptyToolList('zh'), '- 无');
  });
});

// ---------------------------------------------------------------------------
// 契约 10：与 learning-resource 的 id 对齐（跨包不变量）
// ---------------------------------------------------------------------------

describe('与 dsh-zhiyun-core-learning-resource 的 id 约定一致', () => {
  test('章 / 知识点 / 块 id 形状与 fromLecture() 相同', () => {
    const index = buildLectureIndex(sampleLecture());
    assert.deepEqual(index.chapters.map((chapter) => chapter.id), ['ch1', 'ch2']);
    assert.deepEqual(index.chapters[0].topics.map((topic) => topic.id), ['t1-1', 't1-2']);
    assert.deepEqual(index.chapters[0].topics[0].blocks.map((block) => block.id), ['b1-1-1', 'b1-1-2', 'b1-1-3']);
  });

  test('lectureBlockText 与 learning-resource 同口径（例题 = stem + solution）', () => {
    assert.equal(
      lectureBlockText({ kind: 'example', stem: '题干', solution: '解答', text: '被忽略的 text' }),
      '题干\n\n解答',
    );
    assert.equal(lectureBlockText({ kind: 'elaboration', text: '  正文  ' }), '正文');
    assert.equal(lectureBlockText({ kind: 'elaboration' }), '');
    assert.equal(lectureBlockText({ kind: 'elaboration', displayText: '备用字段' }), '备用字段');
    assert.equal(lectureBlockText(null), '');
  });

  test('旧讲义只有 passages 时也能建索引（填充失败不等于知识点是空的）', () => {
    const index = buildLectureIndex({
      chapters: [{ title: 'C', topics: [{ title: 'T', passages: [{ text: '段落一' }, { text: '段落二' }] }] }],
    });
    assert.equal(index.sources.get('t1-1').text, '段落一\n\n段落二');
    assert.deepEqual(index.sources.get('t1-1').blockIds, ['b1-1-1', 'b1-1-2']);
  });

  test('counts 与 outline 一致', () => {
    const index = buildLectureIndex(sampleLecture());
    assert.deepEqual(index.counts.chapters, 2);
    assert.deepEqual(index.counts.topics, 3);
    assert.equal(index.counts.blocks, index.blocks.length);
    assert.equal(index.outline.length, 3);
  });
});

// ---------------------------------------------------------------------------
// 契约 11：Python repr 对齐
// ---------------------------------------------------------------------------

describe('pyRepr：错误文案里的引用形式', () => {
  test('字符串默认单引号（不是 JSON 的双引号）', () => {
    assert.equal(reprString('nope'), "'nope'");
  });

  test('含单引号时改用双引号', () => {
    assert.equal(reprString("it's"), '"it\'s"');
  });

  test('含双引号时保持单引号并转义', () => {
    assert.equal(reprString('say "hi"'), '\'say "hi"\'');
  });

  test('布尔与 null 用 Python 字面量', () => {
    assert.equal(pyRepr(true), 'True');
    assert.equal(pyRepr(false), 'False');
    assert.equal(pyRepr(null), 'None');
  });

  test('数组与对象', () => {
    assert.equal(pyRepr([0, 0, 1, true]), '[0, 0, 1, True]');
    assert.equal(pyRepr(['0', '0']), "['0', '0']");
    assert.equal(pyRepr({ a: 1 }), "{'a': 1}");
  });
});

// ---------------------------------------------------------------------------
// 契约 12：Cordis 插件壳
// ---------------------------------------------------------------------------

test('语言经 createLectureTools 的 language 选项生效（无插件壳，与 core-tool 同约定）', async () => {
  const module = await import('../src/index.js');
  // 同层的 core-tool / core-llm 都不是 Cordis 插件；本包沿用同一约定。
  assert.equal(module.apply, undefined);
  assert.equal(module.name, 'zhiyun-lecture-tools');

  const zh = module.createLectureTools({ lecture: sampleLecture(), language: 'zh' });
  const en = module.createLectureTools({ lecture: sampleLecture(), language: 'en' });
  const zhText = (await zh[1].handler({ kb_name: 'lec' }, {})).result.content;
  const enText = (await en[1].handler({ kb_name: 'lec' }, {})).result.content;
  assert.ok(zhText.startsWith('知识库「lec」'));
  assert.ok(enText.startsWith('Knowledge base "lec"'));
  // ctx 上的 language 覆盖构造时的缺省值
  const overridden = (await en[1].handler({ kb_name: 'lec' }, { language: 'zh' })).result.content;
  assert.ok(overridden.startsWith('知识库「lec」'));
});
