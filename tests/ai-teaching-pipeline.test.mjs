/**
 * 「AI 教学」对接课堂生成管线的适配层。
 *
 * # 这条链的接缝在哪
 *
 *   学习页讲义（chapters/topics/blocks）
 *     → briefFromLecture()   提炼 brief
 *     → zhiyunClassroomGenerate.start/stream
 *     → run-done.outputs.scenes.scenes
 *     → pagesFromScenes()    转成渲染层能画的 {canvas, speech, title}
 *
 * 接缝上任何一处形状对不上，表现都是**空白页**而不是报错 ——
 * 所以每个转换都钉住，尤其是「canvas 必须原样带出」（渲染层就吃它）。
 *
 * 服务本身用桩（不连真实模型），其余每一步都是真的。
 *
 * 用法：node tests/ai-teaching-pipeline.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
  briefFromLecture,
  sourceFromLecture,
  pagesFromScenes,
  runGeneration,
  startGeneration,
  pollGeneration,
} = await import('../packages/dsh-zhiyun-core-study/src/ai-teaching-generate.js');

const LECTURE = {
  chapters: [
    {
      title: '第一章 概率论基础',
      topics: [
        { title: '1.1 古典概型', blocks: [{ kind: '讲解', text: '古典概型要求样本空间有限且等可能。' }] },
        { title: '1.2 条件概率', blocks: [{ text: '条件概率描述已知条件下的概率。' }] },
      ],
    },
  ],
};

/** 一个形状正确的 slide scene（与 core-classroom-generate 的产出对齐）。 */
const SLIDE_SCENE = {
  id: 'scene-1',
  type: 'slide',
  title: '导入',
  content: {
    type: 'slide',
    canvas: {
      id: 'canvas-1',
      viewportSize: 1000,
      viewportRatio: 0.5625,
      theme: { backgroundColor: '#fff' },
      elements: [
        { id: 'el-1', type: 'text', left: 80, top: 80, width: 840, height: 100, content: '<p>标题</p>' },
      ],
    },
  },
  actions: [{ id: 'a1', type: 'speech', text: '这是导入的口播稿。' }],
};

// ── brief ──────────────────────────────────────────────────────────

test('brief 的 requirement 必填（normalizeBrief 会拒空）', () => {
  const brief = briefFromLecture(LECTURE);
  assert.ok(typeof brief.requirement === 'string' && brief.requirement.length > 0);
  assert.equal(brief.topic, '1.1 古典概型');
  assert.ok(brief.goals.length > 0);
});

test('brief 不带互动与测验：这一节的目标只是把课讲完', () => {
  const brief = briefFromLecture(LECTURE);
  assert.equal(brief.interactive, false);
  assert.equal(brief.assess, false);
});

test('空讲义也给可用 brief，不抛错', () => {
  const brief = briefFromLecture({ chapters: [] });
  assert.ok(brief.topic);
  assert.ok(brief.requirement.length > 0);
});

// ── 源文本 ─────────────────────────────────────────────────────────

test('源文本保留 ## / ### 层次（outline prompt 靠它决定分页）', () => {
  const src = sourceFromLecture(LECTURE);
  assert.ok(src.includes('## 第一章'));
  assert.ok(src.includes('### 1.1 古典概型'));
});

test('超长讲义截断时每章都留开头', () => {
  const long = {
    chapters: Array.from({ length: 6 }, (_, ci) => ({
      title: `第 ${ci + 1} 章`,
      topics: [{ title: `知识点`, blocks: [{ text: '正文。'.repeat(500) }] }],
    })),
  };
  const out = sourceFromLecture(long, 3000);
  assert.ok(out.includes('第 6 章'), '截断不能砍掉后面的章节');
});

// ── pagesFromScenes ────────────────────────────────────────────────

test('只保留 slide 场景，canvas 原样带出', () => {
  const pages = pagesFromScenes([
    SLIDE_SCENE,
    { id: 'scene-2', type: 'quiz', title: '随堂测', content: { type: 'quiz', questions: [] }, actions: [] },
  ]);
  assert.equal(pages.length, 1, 'quiz 场景不该出现在课件里');
  assert.equal(pages[0].canvas.viewportSize, 1000);
  assert.equal(pages[0].canvas.elements.length, 1, 'canvas 是渲染层的输入，不能丢元素');
});

test('口播稿从 actions 里抽出来', () => {
  const pages = pagesFromScenes([SLIDE_SCENE]);
  assert.equal(pages[0].speech, '这是导入的口播稿。');
});

test('缺少 canvas 或标题的场景被跳过', () => {
  assert.equal(pagesFromScenes([{ content: { type: 'slide' } }]).length, 0);
  assert.deepEqual(pagesFromScenes(undefined), []);
  assert.deepEqual(pagesFromScenes([]), []);
});

// ── runGeneration ──────────────────────────────────────────────────

/**
 * 生成服务的桩。
 *
 * 注意 `get(runId)` 必须实现：scenes 从 run 快照取，不从 `run-done` 事件取
 * （事件只有摘要，见 ai-teaching-generate.js 里那段注释）。
 * 只挂 start/stream 的桩会让「取 scenes」这一步永远拿到空。
 */
function stubGenerate(events, run = { status: 'done', scenes: [SLIDE_SCENE], skipped: [] }) {
  return {
    async start() { return { runId: 'run-1' }; },
    async *stream() { for (const e of events) yield e; },
    async get() { return run; },
  };
}

const DONE = { kind: 'run-done', outputs: { scenes: { scenes: [SLIDE_SCENE], skipped: [] } } };

test('从 run-done 的 outputs 里取 scenes 并转成页', async () => {
  const out = await runGeneration({ generate: stubGenerate([{ kind: 'scene-ready' }, DONE]), brief: {} });
  assert.equal(out.pages.length, 1);
  assert.equal(out.runId, 'run-1');
});

test('run-error 抛错并保留原因', async () => {
  // 事件形状是 `{ kind, payload }` —— 错误信息在 payload 里，不在顶层。
  // 按 `event.message` 读会永远取不到，最后落成兜底文案（曾经就是「生成失败」）。
  await assert.rejects(
    () => runGeneration({
      generate: stubGenerate([{ kind: 'run-error', payload: { error: { message: '模型超时' } } }]),
      brief: {},
    }),
    (e) => e.message === '模型超时',
  );
});

test('缺 run-done 时报错（不能把半截产物当成品）', async () => {
  await assert.rejects(
    () => runGeneration({ generate: stubGenerate([{ kind: 'scene-ready' }]), brief: {} }),
  );
});

test('服务缺席报 NOT_WIRED', async () => {
  await assert.rejects(
    () => runGeneration({ generate: null, brief: {} }),
    (e) => e.code === 'NOT_WIRED',
  );
});

test('产出零页报 EMPTY', async () => {
  // scenes 从 `get(runId)` 的快照读（事件只有摘要），所以桩要让快照返回空。
  await assert.rejects(
    () => runGeneration({
      generate: stubGenerate([{ kind: 'run-done', payload: { sceneCount: 0 } }], { status: 'done', scenes: [], skipped: [] }),
      brief: {},
    }),
    (e) => e.code === 'EMPTY',
  );
});


// ── 两段式：start + poll ───────────────────────────────────────────

test('start 立刻返回 runId，不等模型', async () => {
  let started = false;
  const generate = {
    async start() { started = true; return { runId: 'run-9' }; },
    async stream() { throw new Error('不该在这里等 stream'); },
    async get() { return null; },
  };
  const out = await startGeneration({ generate, brief: {} });
  assert.equal(out.runId, 'run-9');
  assert.ok(started);
});

test('start 传 provider/model（否则内部会报 provider undefined）', async () => {
  let opts = null;
  const generate = { async start(brief, o) { opts = o; return { runId: 'r' }; } };
  await startGeneration({ generate, brief: {}, provider: 'deepseek-official', model: 'deepseek-flash' });
  assert.equal(opts.provider, 'deepseek-official');
  assert.equal(opts.model, 'deepseek-flash');
});

test('poll：running 时给出已备页数与当前阶段', async () => {
  const generate = {
    async get() { return { status: 'running', scenes: [{}, {}], readyScenes: 5, phase: 'scenes', phases: [] }; },
  };
  const r = await pollGeneration({ generate, runId: 'r' });
  assert.equal(r.status, 'running');
  assert.equal(r.ready, 5, '要用 readyScenes —— scenes 是整批产出，中途看不见');
  assert.equal(r.phase, 'scenes');
});

test('poll：done 时返回可渲染的页', async () => {
  const generate = {
    async get() { return { status: 'done', scenes: [SLIDE_SCENE], skipped: [] }; },
  };
  const r = await pollGeneration({ generate, runId: 'r' });
  assert.equal(r.status, 'done');
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].canvas.elements.length, 1);
});

test('poll：failed 时抛真实原因', async () => {
  const generate = {
    async get() { return { status: 'failed', error: { message: '模型额度用完' } }; },
  };
  await assert.rejects(
    () => pollGeneration({ generate, runId: 'r' }),
    (e) => e.message === '模型额度用完',
  );
});

test('poll：done 但零页时报 EMPTY', async () => {
  const generate = {
    async get() { return { status: 'done', scenes: [], skipped: [{ message: '解析失败' }] }; },
  };
  await assert.rejects(
    () => pollGeneration({ generate, runId: 'r' }),
    (e) => e.code === 'EMPTY' && e.message.includes('解析失败'),
  );
});
