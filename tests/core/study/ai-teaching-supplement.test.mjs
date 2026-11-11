import test from 'node:test';
import assert from 'node:assert/strict';
import { supplementChapters, generateTeachingSupplement, buildSupplementPrompt } from '../../../packages/core/study/src/ai-teaching-supplement.js';

const lecture = { chapters: Array.from({ length: 3 }, (_, i) => ({ title: `章${i + 1}`, topics: [{ title: '运动', blocks: [{ text: '沿场分量保持不变。绕行一周前进的距离等于速度乘周期。' }] }] })) };
const baseSpeech = '这里已经概括讲了最重要的结论，但还没有解释推导。';
const scenes = lecture.chapters.map((ch, i) => ({ id: `s${i + 1}`, chapterId: `chapter-${i + 1}`, title: ch.title, content: { type: 'slide', canvas: { elements: [] } }, actions: [{ type: 'speech', text: baseSpeech }] }));
const explanation = '刚才我们知道它一边绕圈一边前进。先只看沿磁场方向，因为没有这个方向的磁场力，速度保持不变。再看一圈所需时间，沿场位移就是这个速度乘以周期。这里一定要用平行分量而不是总速度。';
const evidence = '因为没有这个方向的磁场力，速度保持不变';
const warning = { sourceIds: ['placeholder'], message: '来源周期与频率可能不互为倒数', resolution: '已在讲解中辨析', unresolved: false, severity: 'note' };

const mock = (hook = async () => {}) => async request => {
  const data = JSON.parse(request.prompt);
  await hook(request, data);
  if (request.stage === 'supplement-plan') return { baseCoverage: [], supplements: [{ id: 'g1', pageId: data.basePages[0]?.id ?? null, sourceIds: data.sourceUnits.map(u => u.id), title: '把中间一步讲清', goal: '解释沿场运动' }] };
  if (request.stage === 'supplement-write' || request.stage === 'supplement-repair') return {
    segments: data.gapPlan.supplements.map(g => ({ ...g, speech: explanation, teachingSteps: ['承接绕圈前进', '解释无沿场力', '区分总速度'] })),
    warnings: [{ ...warning, sourceIds: data.sourceUnits.map(u => u.id) }],
  };
  if (request.stage === 'supplement-audit') return { items: data.sourceUnits.map(u => ({
    sourceId: u.id, status: 'explained', evidence, evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: '解释而非提词',
  })), clarityIssues: [] };
  throw new Error(`unexpected stage ${request.stage}`);
};

test('source enumeration preserves sentence content and stable identities', () => {
  const chapters = supplementChapters(lecture, scenes);
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].units.length, 2);
  assert.equal(chapters[0].units.map(u => u.text).join(''), lecture.chapters[0].topics[0].blocks[0].text);
  assert.equal(chapters[1].pages[0].id, 's2');
});

test('additive generation is chapter parallel, ordered and never changes base', async () => {
  const before = JSON.stringify({ lecture, scenes });
  let active = 0, peak = 0;
  const result = await generateTeachingSupplement({ lecture, scenes, concurrency: 2, call: mock(async () => {
    active++; peak = Math.max(peak, active); await new Promise(resolve => setImmediate(resolve)); active--;
  }) });
  assert.equal(result.status, 'model_checked');
  assert.equal(result.counts.sourceUnits, 6);
  assert.equal(result.counts.modelExplained, 6);
  assert.equal(peak, 2);
  assert.deepEqual(result.chapters.map(c => c.id), ['chapter-1', 'chapter-2', 'chapter-3']);
  assert.equal(JSON.stringify({ lecture, scenes }), before);
});

test('plan omissions do not silently become complete coverage', async () => {
  const result = await generateTeachingSupplement({ lecture, scenes, call: async () => ({ baseCoverage: [], supplements: [] }) });
  assert.equal(result.status, 'needs_review');
  assert.equal(result.counts.failedChapters, 3);
  assert.equal(result.counts.modelExplained, 0);
  assert.equal(result.counts.missing, 6);
});

test('invented base quotes are rejected; screen-only formulas are not base evidence', async () => {
  for (const evidence of ['这是根本没有存在于Base里的伪造覆盖证据', baseSpeech]) {
    const result = await generateTeachingSupplement({ lecture, scenes, call: async request => {
      const d = JSON.parse(request.prompt);
      return { baseCoverage: d.sourceUnits.map(u => ({ sourceId: u.id, pageId: d.basePages[0].id, evidence })), supplements: [] };
    } });
    assert.equal(result.counts.failedChapters, 3, `不应接受这段所谓证据：${evidence}`);
  }
  const screenOnly = structuredClone(scenes);
  screenOnly[0].content.canvas.elements = [{ type: 'text', content: '<p>这是画布上的文字，导出后不一定显示</p>' }];
  const accepted = await generateTeachingSupplement({ lecture, scenes: screenOnly, call: async request => {
    const d = JSON.parse(request.prompt);
    return { baseCoverage: d.sourceUnits.map(u => ({ sourceId: u.id, pageId: d.basePages[0].id, evidence: '这是画布上的文字，导出后不一定显示' })), supplements: [] };
  } });
  assert.equal(accepted.counts.failedChapters, 3);
});

test('audit evidence must come from the object belonging to that source', async () => {
  const result = await generateTeachingSupplement({ lecture, scenes, maxRepairRounds: 0, call: async request => {
    const d = JSON.parse(request.prompt);
    if (request.stage !== 'supplement-audit') return mock()(request);
    // 借第一段的证据去给所有来源判 explained：必须被拒认。
    return { items: d.sourceUnits.map(u => ({ sourceId: u.id, status: 'explained', evidence: '不存在于任何讲解的伪证据',
      evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: '乱判' })), clarityIssues: [] };
  } });
  assert.equal(result.status, 'needs_review');
  assert.equal(result.counts.modelExplained, 0);
  assert.equal(result.counts.missing, 6);
});

test('other segment evidence cannot vouch for a source it does not cover', async () => {
  const two = { chapters: [{ title: '章', topics: [{ title: 't', blocks: [{ text: '第一句要讲清。第二句也要讲清。' }] }] }] };
  const oneScene = [{ id: 's1', chapterId: 'chapter-1', title: '章', content: { type: 'slide', canvas: { elements: [] } }, actions: [{ type: 'speech', text: baseSpeech }] }];
  const result = await generateTeachingSupplement({ lecture: two, scenes: oneScene, maxRepairRounds: 0, call: async request => {
    const d = JSON.parse(request.prompt);
    if (request.stage === 'supplement-plan') return { baseCoverage: [], supplements: [
      { id: 'g1', pageId: 's1', sourceIds: [d.sourceUnits[0].id], title: 'A', goal: 'A' },
      { id: 'g2', pageId: 's1', sourceIds: [d.sourceUnits[1].id], title: 'B', goal: 'B' },
    ] };
    if (request.stage === 'supplement-write') return { segments: [
      { id: 'g1', pageId: 's1', sourceIds: [d.sourceUnits[0].id], title: 'A', speech: explanation, teachingSteps: ['a', 'b'] },
      { id: 'g2', pageId: 's1', sourceIds: [d.sourceUnits[1].id], title: 'B', speech: '这一页只是把上一段的说法换个句子重复一遍，并没有解释第二句要求讲清的实质内容和来由。', teachingSteps: ['a', 'b'] },
    ], warnings: [] };
    return { items: [
      { sourceId: d.sourceUnits[0].id, status: 'explained', evidence, evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: 'ok' },
      { sourceId: d.sourceUnits[1].id, status: 'explained', evidence, evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: '借了别的段的证据' },
    ], clarityIssues: [] };
  } });
  assert.equal(result.status, 'needs_review');
  assert.equal(result.counts.modelExplained, 1);
  assert.equal(result.counts.missing, 1);
});

test('rejected base coverage is reopened so repair can actually补讲', async () => {
  const stages = [];
  const result = await generateTeachingSupplement({ lecture: { chapters: [lecture.chapters[0]] }, scenes: [{ ...scenes[0], chapterId: 'chapter-1' }], maxRepairRounds: 1, call: async request => {
    const d = JSON.parse(request.prompt);
    stages.push(request.stage);
    if (request.stage === 'supplement-plan') return { baseCoverage: d.sourceUnits.map(u => ({ sourceId: u.id, pageId: 's1', evidence: baseSpeech })), supplements: [] };
    if (request.stage === 'supplement-write' || request.stage === 'supplement-repair') return {
      segments: d.gapPlan.supplements.map(g => ({ ...g, speech: explanation, teachingSteps: ['a', 'b'] })), warnings: [] };
    if (request.stage === 'supplement-audit') {
      const reopened = d.gapPlan.supplements.length > 0;
      return { items: d.sourceUnits.map(u => ({ sourceId: u.id, status: reopened ? 'explained' : 'missing',
        evidence: reopened ? evidence : '', evidenceTarget: reopened ? { kind: 'supplement', id: 'gap-reopen-1' } : undefined, reason: reopened ? '补上了' : 'Base只是提了一句' })), clarityIssues: [] };
    }
    throw new Error('unexpected');
  } });
  assert.deepEqual(stages.filter(s => s === 'supplement-repair'), ['supplement-repair']);
  assert.equal(result.counts.modelExplained, 2);
  assert.equal(result.chapters[0].segments[0].id, 'gap-reopen-1');
});

test('whitespace and ellipsis differences in quotes still count as evidence', async () => {
  const lecture2 = { chapters: [{ title: '章', topics: [{ title: 't', blocks: [{ text: '沿场分量保持不变。绕行一周前进的距离等于速度乘周期。' }] }] }] };
  const scenes2 = [{ ...scenes[0], chapterId: 'chapter-1' }];
  const result = await generateTeachingSupplement({ lecture: lecture2, scenes: scenes2, maxRepairRounds: 0, call: async request => {
    const d = JSON.parse(request.prompt);
    if (request.stage === 'supplement-plan') return { baseCoverage: [], supplements: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', goal: 'g' }] };
    if (request.stage === 'supplement-write') return { segments: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', speech: explanation, teachingSteps: ['a'] }], warnings: [] };
    // 引用时吃了空格、并用省略号截断：仍是真实引用。
    return { items: d.sourceUnits.map(u => ({ sourceId: u.id, status: 'explained',
      evidence: '先只看沿磁场方向，因为没有这个方向的磁场力，速度保持不变……再看一圈所需时间',
      evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: 'ok' })), clarityIssues: [] };
  } });
  assert.equal(result.counts.modelExplained, 2);
  assert.equal(result.status, 'model_checked');
});

test('reworded or invented evidence is still rejected', async () => {
  const result = await generateTeachingSupplement({ lecture: { chapters: [lecture.chapters[0]] }, scenes: [{ ...scenes[0], chapterId: 'chapter-1' }], maxRepairRounds: 0, call: async request => {
    const d = JSON.parse(request.prompt);
    if (request.stage === 'supplement-plan') return { baseCoverage: [], supplements: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', goal: 'g' }] };
    if (request.stage === 'supplement-write') return { segments: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', speech: explanation, teachingSteps: ['a'] }], warnings: [] };
    return { items: d.sourceUnits.map(u => ({ sourceId: u.id, status: 'explained',
      evidence: '因为没有磁场力所以平行速度一直不变然后乘周期就是螺距',
      evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: '改写冒充引用' })), clarityIssues: [] };
  } });
  assert.equal(result.counts.modelExplained, 0);
});

test('paraphrased evidence is accepted but marked fuzzy, exact quotes marked exact', async () => {
  const result = await generateTeachingSupplement({ lecture: { chapters: [lecture.chapters[0]] }, scenes: [{ ...scenes[0], chapterId: 'chapter-1' }], maxRepairRounds: 0, call: async request => {
    const d = JSON.parse(request.prompt);
    if (request.stage === 'supplement-plan') return { baseCoverage: [], supplements: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', goal: 'g' }] };
    if (request.stage === 'supplement-write') return { segments: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', speech: explanation, teachingSteps: ['a'] }], warnings: [] };
    const [first, second] = d.sourceUnits;
    return { items: [
      { sourceId: first.id, status: 'explained', evidence: '先只看沿磁场方向，因为没有这个方向的磁场力，速度保持不变。再看一圈所需时间，沿场位移就是这个速度乘以周期',
        evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: '基本逐字' },
      // 轻度改写：语义在同一段里但不是逐字——必须标成 fuzzy 而不是 exact。
      { sourceId: second.id, status: 'explained', evidence: '先只看沿磁场方向，因为那个方向没有磁场力，速度保持不变。再看一圈所需时间，沿场位移就等于速度乘以周期',
        evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: '改写归纳' },
    ], clarityIssues: [] };
  } });
  assert.equal(result.status, 'model_checked');
  const matches = result.chapters[0].audit.items.map(i => i.evidenceMatch);
  assert.equal(matches[0], 'exact');
  assert.equal(matches[1], 'fuzzy');
});

test('partial repair responses keep already-written segments instead of failing the chapter', async () => {
  const result = await generateTeachingSupplement({ lecture, scenes, maxRepairRounds: 1, call: async request => {
    const d = JSON.parse(request.prompt);
    const all = d.sourceUnits.map(u => u.id);
    if (request.stage === 'supplement-plan') return { baseCoverage: [], supplements: [{ id: 'g1', pageId: d.basePages[0]?.id ?? null, sourceIds: all, title: 'g', goal: 'g' }] };
    if (request.stage === 'supplement-write') return { segments: [{ id: 'g1', pageId: d.basePages[0]?.id ?? null, sourceIds: all, title: 'g', speech: explanation, teachingSteps: ['a'] }], warnings: [] };
    if (request.stage === 'supplement-repair') return { segments: [], warnings: [] };
    return { items: d.sourceUnits.map(u => ({ sourceId: u.id, status: 'risk', evidence: '', evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: '还有问题' })), clarityIssues: [] };
  } });
  assert.equal(result.counts.failedChapters, 0);
  assert.equal(result.chapters[0].segments[0].speech, explanation);
  assert.equal(result.status, 'needs_review');
});

test('a repair that writes no usable speech fails loudly instead of passing as partial', async () => {
  const result = await generateTeachingSupplement({ lecture: { chapters: [lecture.chapters[0]] }, scenes: [{ ...scenes[0], chapterId: 'chapter-1' }], maxRepairRounds: 1, call: async request => {
    const d = JSON.parse(request.prompt);
    const all = d.sourceUnits.map(u => u.id);
    if (request.stage === 'supplement-plan') return { baseCoverage: all.map(id => ({ sourceId: id, pageId: 's1', evidence: baseSpeech })), supplements: [] };
    if (request.stage === 'supplement-write') return { segments: [], warnings: [] };
    if (request.stage === 'supplement-repair') return { segments: [{ id: 'gap-reopen-1', pageId: 's1', sourceIds: all, title: 'g', speech: '   ' }], warnings: [] };
    return { items: d.sourceUnits.map(u => ({ sourceId: u.id, status: 'missing', evidence: '', reason: 'Base没讲清' })), clarityIssues: [] };
  } });
  // 计划要求补讲、却一段都没写出来：不能静默算成 needs_review，必须明确失败。
  assert.equal(result.counts.failedChapters, 1);
  assert.equal(result.counts.supplementSegments, 0);
  assert.equal(result.status, 'needs_review');
});

test('missing teachingSteps is tolerated because it is metadata, not speech', async () => {
  const result = await generateTeachingSupplement({ lecture: { chapters: [lecture.chapters[0]] }, scenes: [{ ...scenes[0], chapterId: 'chapter-1' }], maxRepairRounds: 0, call: async request => {
    const d = JSON.parse(request.prompt);
    if (request.stage === 'supplement-plan') return { baseCoverage: [], supplements: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', goal: '解释沿场运动' }] };
    if (request.stage === 'supplement-write') return { segments: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', speech: explanation }], warnings: [] };
    return { items: d.sourceUnits.map(u => ({ sourceId: u.id, status: 'explained', evidence, evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: 'ok' })), clarityIssues: [] };
  } });
  assert.equal(result.counts.failedChapters, 0);
  assert.ok(result.chapters[0].segments[0].teachingSteps.length >= 1);
  assert.equal(result.status, 'model_checked');
});

test('missing warning severity defaults conservatively and blocks checked status', async () => {
  const result = await generateTeachingSupplement({ lecture: { chapters: [lecture.chapters[0]] }, scenes: [{ ...scenes[0], chapterId: 'chapter-1' }], maxRepairRounds: 0, call: async request => {
    const d = JSON.parse(request.prompt);
    if (request.stage === 'supplement-plan') return { baseCoverage: [], supplements: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', goal: 'g' }] };
    if (request.stage === 'supplement-write') return { segments: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', speech: explanation, teachingSteps: ['a', 'b'] }],
      warnings: [{ sourceIds: [d.sourceUnits[0].id], message: '来源可能有矛盾', resolution: '先按待核验处理' }] };
    return { items: d.sourceUnits.map(u => ({ sourceId: u.id, status: 'explained', evidence, evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: 'ok' })), clarityIssues: [] };
  } });
  // 没写 unresolved/severity 不能默认成“已解决”。
  assert.equal(result.chapters[0].warnings[0].unresolved, true);
  assert.equal(result.chapters[0].warnings[0].severity, 'important');
  assert.equal(result.status, 'needs_review');
});

test('unresolved important warnings block the "checked" status', async () => {
  const result = await generateTeachingSupplement({ lecture: { chapters: [lecture.chapters[0]] }, scenes: [{ ...scenes[0], chapterId: 'chapter-1' }], maxRepairRounds: 0, call: async request => {
    const d = JSON.parse(request.prompt);
    if (request.stage === 'supplement-plan') return { baseCoverage: [], supplements: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', goal: 'g' }] };
    if (request.stage === 'supplement-write') return { segments: [{ id: 'g1', pageId: 's1', sourceIds: d.sourceUnits.map(u => u.id), title: 'g', speech: explanation, teachingSteps: ['a', 'b'] }],
      warnings: [{ sourceIds: [d.sourceUnits[0].id], message: '周期与频率不一致', resolution: '尚未确认应取哪一个', unresolved: true, severity: 'important' }] };
    return { items: d.sourceUnits.map(u => ({ sourceId: u.id, status: 'explained', evidence, evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: 'ok' })), clarityIssues: [] };
  } });
  assert.equal(result.status, 'needs_review');
  assert.equal(result.chapters[0].openWarnings.length, 1);
});

test('audit evidence must occur in actual speech; unresolved remains needs_review', async () => {
  const baseCall = mock();
  const result = await generateTeachingSupplement({ lecture, scenes, maxRepairRounds: 0, call: async request => {
    if (request.stage !== 'supplement-audit') return baseCall(request);
    const d = JSON.parse(request.prompt);
    return { items: d.sourceUnits.map(u => ({ sourceId: u.id, status: 'explained', evidence: '不存在于任何讲解的伪证据',
      evidenceTarget: { kind: 'supplement', id: 'g1' }, reason: '乱判' })), clarityIssues: [] };
  } });
  assert.equal(result.status, 'needs_review');
  assert.equal(result.counts.modelExplained, 0);
  assert.equal(result.counts.missing, 6);
});

test('abort settles even when the model channel ignores the signal', async () => {
  const controller = new AbortController();
  let saved = 0;
  const pending = generateTeachingSupplement({ lecture, scenes, signal: controller.signal, maxRepairRounds: 0,
    call: () => new Promise(() => {}), onCheckpoint: () => { saved++; } });
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  await assert.rejects(pending, /abort|Aborted/i);
  assert.equal(saved, 0);
});

test('abort prevents checkpointing and empty chapter text is refused', async () => {
  await assert.rejects(generateTeachingSupplement({ lecture: { chapters: [{ title: 'empty', topics: [] }] }, scenes, call: mock() }), /正文/);
  const controller = new AbortController();
  let saved = 0;
  await assert.rejects(generateTeachingSupplement({ lecture, scenes, signal: controller.signal,
    call: async () => { controller.abort(); return {}; }, onCheckpoint: () => { saved++; } }), /abort/i);
  assert.equal(saved, 0);
});

test('prompts separate evidence from teaching and ban nonexistent visual cues', () => {
  const p = buildSupplementPrompt('write', supplementChapters(lecture, scenes)[0]);
  assert.match(p.system, /单一教师独白/);
  assert.match(p.system, /没有新PPT/);
  assert.match(p.system, /不得说/);
  assert.match(p.system, /LaTeX/);
  assert.match(p.system, /中间步骤/);
  const plan = buildSupplementPrompt('plan', supplementChapters(lecture, scenes)[0]);
  assert.match(plan.system, /screenText/);
  assert.match(plan.system, /不能单独当作/);
});
