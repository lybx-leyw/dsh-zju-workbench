// dsh-zhiyun-core-classroom-pbl 的装配与契约测试。
//
// 覆盖任务书的三条验证：
//   1. 假 ctx apply 不抛，并 provide `zhiyunClassroomPbl`（含 provide 抛错的降级路径）；
//   2. 固定 brief + 假 llm → plan() 产出结构化项目（阶段数 / 交付物 / rubric 维度）；
//   3. rubric() 的维度数在普通项目与场景项目之间保持稳定（恒 12）。
//
// 另补两条搬运有没有走样的断言：
//   - 无 llm 时 grade() 必须显式降级（mode=local），不能假装打了分；
//   - briefing() 必须把 plan 的标题与交付物渲染进文本。
//
// 跑法：`node --test tests/classroom-pbl.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const PACKAGE_DIR = new URL('../packages/dsh-zhiyun-core-classroom-pbl/', import.meta.url);
const plugin = await import(pathToFileURL(join(PACKAGE_DIR.pathname, 'src', 'index.js')).href);
const BRIEF = JSON.parse(
  await readFile(new URL('../packages/dsh-zhiyun-core-classroom-pbl/fixtures/brief.json', import.meta.url), 'utf8'),
);

// ── 测试装置 ────────────────────────────────────────────────────────────────

/** 最小 Cordis 假 ctx（同 tests/classroom-agent.test.mjs 的 stub 写法）。 */
function makeCtx({ services = {}, provideThrows = false } = {}) {
  const provided = new Map(Object.entries(services));
  const disposers = [];
  const logs = [];
  const ctx = {
    logger: {
      debug: (...args) => logs.push(['debug', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    get: (serviceName) => provided.get(serviceName),
    provide: (serviceName, value) => {
      if (provideThrows) throw new Error(`service ${serviceName} already registered`);
      provided.set(serviceName, value);
      return () => provided.delete(serviceName);
    },
    on: (event, handler) => {
      if (event === 'dispose') disposers.push(handler);
    },
  };
  return { ctx, provided, disposers, logs };
}

/** 宿主服务的形状（本包只读它的存在性，不调用方法）。 */
const STUDIO = { async status() { return { state: 'ready', version: '0.1.0', detail: {} }; } };

function skeleton(milestoneCount, language = '中文') {
  return {
    projectInfo: {
      title: '校园二手交易定价与推荐方案',
      description: `在 ${milestoneCount} 个阶段里完成样本清洗、定价策略与推荐理由，交付一份可被同学采纳的方案。`,
      learningObjective: '能用交易数据支撑一个可辩护的定价决策',
      gains: ['读懂交易数据里的供需信号', '写出可辩护的定价理由', '用取舍标准筛选推荐位'],
      proficiency: 'intermediate',
    },
    instructorRole: {
      name: '二手市场项目教练',
      description: `我是你的${language}项目教练，全程陪你把方案落地，随时可以问我。`,
      systemPrompt: 'You are a warm coach for this pricing project.',
    },
    milestones: Array.from({ length: milestoneCount }, (_, i) => ({
      title: `阶段${i + 1}：整理样本数据`,
      description: `第 ${i + 1} 阶段的具体工作。`,
      briefing: `欢迎来到阶段 ${i + 1}，我们先看看手头的样本。`,
      completionCriteria: '能说明样本覆盖了哪些商品类别。',
      debrief: `阶段 ${i + 1} 收尾，你已经拿到可用的样本。`,
      ...(i === 1 ? { coreConcept: '成本加成与锚定效应的差别' } : {}),
    })),
  };
}

/** 假 llm：按 stage 分流，不联网、不建客户端。 */
function makeFakeLlm({ milestoneCount = 4, tasksPerMilestone = 3 } = {}) {
  const calls = [];
  const llm = {
    calls,
    async call(request) {
      calls.push(request);
      if (String(request.stage).includes('skeleton')) {
        return JSON.stringify(skeleton(milestoneCount));
      }
      const matched = String(request.prompt).match(/Milestone \d+: (.+)/);
      const title = matched ? matched[1].trim() : '阶段';
      return JSON.stringify({
        microtasks: Array.from({ length: tasksPerMilestone }, (_, i) => ({
          title: `${title}·任务${i + 1}`,
          description: `产出第 ${i + 1} 份可检查的东西。`,
          hints: ['先看判据，再动手'],
        })),
      });
    },
  };
  return llm;
}

function scenarioSpec() {
  return {
    projectInfo: {
      title: '和室友谈一次晚归的边界',
      description: '在一次真实对话里练习表达需求、共情对方并达成约定。',
      learningObjective: '能在冲突对话里先共情再提出具体请求',
      gains: ['识别对方的情绪信号', '提出可执行的请求', '在分歧里保留关系'],
      proficiency: 'intermediate',
    },
    instructorRole: { name: '沟通练习教练', description: '陪你练完整场对话。' },
    scenario: {
      setting: '深夜宿舍，室友刚回来，气氛有点僵。',
      goal: '练习边界沟通',
      learnerRole: '你是提出请求的一方',
      characters: [{
        name: '室友小周',
        persona: '直脾气，压力大时话少',
        situation: '刚结束通宵赶稿，很累但没说出来',
      }],
      sceneVisual: { caption: '深夜宿舍的台灯', motifs: ['🌙', '🛏️'], bg1: '#1f2430', accent: '#8ab4f8' },
    },
    milestones: [
      {
        scenarioStage: 'prep', title: '了解背景', description: '听懂今晚发生了什么。',
        briefing: '今晚小周刚交完稿，你有一件事想和他商量。', completionCriteria: '确认准备好了。', debrief: '好，开始。',
        microtasks: [{ title: '了解背景，准备开始', description: '读一遍设定。' }],
      },
      {
        scenarioStage: 'roleplay', title: '开口', description: '把请求说出口。',
        briefing: '你决定现在开口。', completionCriteria: '完成了开场。', debrief: '这一轮结束。',
        microtasks: [{ title: '先共情再提请求', description: '对小周说一句共情的话，再提出你的请求。', successWhen: '说出共情回应，并提出一个具体请求' }],
      },
      {
        scenarioStage: 'wrapup', title: '收尾', description: '回看这次对话。',
        briefing: '聊完了。', completionCriteria: '听完反馈。', debrief: '你做到了先共情再提请求。',
        microtasks: [{ title: '听取反馈，收尾', description: '听完反馈。' }],
      },
    ],
  };
}

// ── 1. 装配 ────────────────────────────────────────────────────────────────

test('假 ctx apply 不抛，provide zhiyunClassroomPbl，dispose 后注销', () => {
  const { ctx, provided, disposers } = makeCtx({ services: { zhiyunClassroomStudio: STUDIO } });
  let dispose;
  assert.doesNotThrow(() => { dispose = plugin.apply(ctx); });
  const service = provided.get('zhiyunClassroomPbl');
  assert.ok(service);
  for (const method of ['plan', 'buildPlan', 'rubric', 'grade', 'briefing', 'status']) {
    assert.equal(typeof service[method], 'function', `缺少方法 ${method}`);
  }
  assert.equal(disposers.length, 1);
  dispose();
  assert.equal(provided.get('zhiyunClassroomPbl'), undefined);
});

test('studio 缺失 / provide 抛错都只降级，不抛', () => {
  const missing = makeCtx();
  assert.doesNotThrow(() => plugin.apply(missing.ctx));
  assert.ok(missing.provided.get('zhiyunClassroomPbl'));

  const conflict = makeCtx({ provideThrows: true });
  assert.doesNotThrow(() => plugin.apply(conflict.ctx));
  assert.equal(conflict.logs.filter(([level]) => level === 'error').length > 0, true);
});

// ── 2. plan() ──────────────────────────────────────────────────────────────

test('plan() 用固定 brief + 假 llm 产出结构化项目', async () => {
  const { ctx, provided } = makeCtx({ services: { zhiyunClassroomStudio: STUDIO } });
  plugin.apply(ctx, { llm: makeFakeLlm({ milestoneCount: 4, tasksPerMilestone: 3 }) });
  const service = provided.get('zhiyunClassroomPbl');

  const project = await service.plan(BRIEF);

  assert.equal(project.title, '校园二手交易定价与推荐方案');
  assert.equal(project.status, 'active');
  assert.equal(project.uiPhase, 'hero');
  assert.equal(project.milestones.length, 4, '阶段数应等于骨架给出的 4');
  assert.deepEqual(project.milestones.map((m) => m.order), [0, 1, 2, 3]);
  assert.equal(project.milestones[0].status, 'active');
  assert.equal(project.milestones[1].status, 'locked');
  for (const milestone of project.milestones) {
    assert.equal(milestone.microtasks.length, 3, '每条阶段 3 个任务');
  }
  assert.equal(project.roles.length, 1);
  assert.equal(project.roles[0].type, 'instructor');
  assert.equal(project.threads.length, 1, 'Instructor 线程应被 bootstrap');
  assert.ok(project.gains.length >= 3 && project.gains.length <= 5);
  assert.ok(project.milestones.some((m) => m.synthesisCheck), '应自动挂上 1-2 个综合检查');

  const deliverables = plugin.deliverablesOf(project);
  assert.equal(deliverables.length, 12, '交付物 = 4 阶段 × 3 任务');
  assert.equal(plugin.totalMicrotasks(project), 12);

  const rubric = service.rubric(project);
  assert.equal(rubric.kind, 'ordinary');
  assert.equal(rubric.dimensions.length, 12);
  assert.equal(rubric.stageCriteria.length, 4);
  assert.equal(rubric.summary.deliverableCount, 12);
  assert.equal(rubric.scoring.maxScore, 60);
  assert.deepEqual(rubric.invariants, [], '合格项目不应有 gap');
});

test('plan() 对不合法输出抛 PLAN_INVALID 且带 partial', async () => {
  const { ctx, provided } = makeCtx({ services: { zhiyunClassroomStudio: STUDIO } });
  const badLlm = { async call() { return JSON.stringify({ projectInfo: {}, milestones: [] }); } };
  plugin.apply(ctx, { llm: badLlm });
  const service = provided.get('zhiyunClassroomPbl');
  await assert.rejects(
    () => service.plan(BRIEF, { retries: 0 }),
    (error) => error.kind === 'PLAN_INVALID' && Array.isArray(error.detail.gaps),
  );
});

// ── 3. rubric() 稳定性 ─────────────────────────────────────────────────────

test('rubric() 维度数稳定：不同形状的普通项目恒 12 维且 key 一致', () => {
  const { ctx, provided } = makeCtx({ services: { zhiyunClassroomStudio: STUDIO } });
  plugin.apply(ctx);
  const service = provided.get('zhiyunClassroomPbl');

  const small = service.buildPlan({
    ...skeleton(3),
    milestones: skeleton(3).milestones.map((m) => ({
      ...m,
      microtasks: [{ title: '做一个决定', description: '写下你的选择与理由。' }],
    })),
  });
  const larger = service.buildPlan({
    ...skeleton(5),
    milestones: skeleton(5).milestones.map((m) => ({
      ...m,
      microtasks: [
        { title: '整理样本', description: '列出你能拿到的字段。' },
        { title: '做出判断', description: '写出判断与依据。' },
      ],
    })),
  });

  const first = service.rubric(small);
  const second = service.rubric(larger);

  assert.equal(first.dimensions.length, 12);
  assert.equal(second.dimensions.length, 12);
  assert.deepEqual(first.dimensions.map((d) => d.key), second.dimensions.map((d) => d.key));
  assert.deepEqual(first.dimensions.map((d) => d.key), [...plugin.RUBRIC_DIMENSION_KEYS]);
  assert.equal(first.summary.milestoneCount, 3);
  assert.equal(second.summary.milestoneCount, 5);
  assert.notEqual(first.summary.microtaskCount, second.summary.microtaskCount);
});

test('场景项目的 rubric 仍是 12 维，但走场景判据与场景红线', () => {
  const { ctx, provided } = makeCtx({ services: { zhiyunClassroomStudio: STUDIO } });
  plugin.apply(ctx);
  const service = provided.get('zhiyunClassroomPbl');

  const project = service.buildPlan(scenarioSpec());
  assert.equal(project.milestones.map((m) => m.scenarioStage).join(','), 'prep,roleplay,wrapup');
  assert.equal(project.threads.length, 2, '场景项目额外一条 simulator 线程');

  const rubric = service.rubric(project);
  assert.equal(rubric.kind, 'scenario');
  assert.equal(rubric.dimensions.length, 12);
  assert.ok(rubric.redLines.some((line) => line.code === 'S3'));
  assert.equal(rubric.stageCriteria[1].deliverables[0].successWhen, '说出共情回应，并提出一个具体请求');
});

// ── 4. 降级与简报 ──────────────────────────────────────────────────────────

test('grade() 无 llm 时显式降级（mode=local），不伪造维度分', async () => {
  const { ctx, provided } = makeCtx({ services: { zhiyunClassroomStudio: STUDIO } });
  plugin.apply(ctx);
  const service = provided.get('zhiyunClassroomPbl');

  const project = service.buildPlan({
    ...skeleton(3),
    milestones: skeleton(3).milestones.map((m) => ({
      ...m,
      microtasks: [{ title: '整理样本', description: '列出字段。', successWhen: '给出字段清单与来源' }],
    })),
  });
  const rubric = service.rubric(project);
  const result = await service.grade({ microtaskId: project.milestones[0].microtasks[0].id, content: '字段清单：商品名、成色、原价、期望价，来源是二手群。' }, rubric);

  assert.equal(result.mode, 'local');
  assert.equal(result.degraded, true);
  assert.equal(typeof result.score, 'number');
  assert.deepEqual(result.dimensions, []);
});

test('briefing() 渲染标题、交付物与阶段计划', () => {
  const { ctx, provided } = makeCtx({ services: { zhiyunClassroomStudio: STUDIO } });
  plugin.apply(ctx);
  const service = provided.get('zhiyunClassroomPbl');

  const project = service.buildPlan({
    ...skeleton(2),
    milestones: skeleton(2).milestones.map((m) => ({
      ...m,
      microtasks: [{ title: '整理样本', description: '列出字段。' }, { title: '做出判断', description: '写出依据。' }],
    })),
  });
  const briefing = service.briefing(project, { includeRubric: true });

  assert.ok(briefing.text.includes('校园二手交易定价与推荐方案'));
  assert.ok(briefing.text.includes('交付物（4）'));
  assert.ok(briefing.text.includes('阶段计划（2 阶段 / 4 个任务）'));
  assert.ok(briefing.text.includes('评分量规'));
  assert.equal(briefing.deliverables.length, 4);
  assert.equal(briefing.stages.length, 2);
});
