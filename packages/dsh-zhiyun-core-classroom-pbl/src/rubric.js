// 源：ref/OpenMAIC/eval/pbl-v2-planner/judge-prompt.md:20-70（12 个质量维度 + B1-B17 红线）
// 源：ref/OpenMAIC/eval/pbl-v2-planner/judge-prompt-scenario.md:35-70（场景版维度文案 + S1-S8 红线）
// 源：ref/OpenMAIC/eval/pbl-v2-planner/runner.ts:95-110,362-372（JUDGE_DIMENSIONS 与场景分流）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-core.ts:323-394（完成门 → rubric 的结构不变量）

import { deliverablesOf, plannerCompletionGaps, totalMicrotasks } from './project.js';

/**
 * 评分量规。
 *
 * 上游的量规以 markdown 提示词形式存在（judge-prompt.md / judge-prompt-scenario.md），
 * 由 runner 读文件、替换 `{{topic}}` 等槽位后发给评审模型。本包把**维度表**
 * 落成数据结构：12 个维度、每个 1-5 分，另附红线清单与按项目派生的
 * 阶段判据。
 *
 * 关键设计：**维度数与维度 key 恒定**（普通项目 12 个，场景项目也是同 12 个 key，
 * 只是判据文案换成场景版）。这样 `grade()` 的输出永远能对齐同一张表，
 * 不会因为项目形状变化而少一项。
 */

export const RUBRIC_VERSION = 'pbl-v2';

export const RUBRIC_SCALE = Object.freeze({ min: 1, max: 5 });

const DIMENSION_DEFS = [
  ['projectNotLecture', '项目而非讲授', 'Do stages feel like doing a project, not restating a course? (low: invisible lecture outline "learn concept A → operation B")'],
  ['taskEvaluability', '任务可判', 'Does each microtask carry a clear, judgeable "done" appropriate to its task nature? (low: vague "understand X" with no observable done-state)'],
  ['typeFit', '形态匹配', 'Do stages/tasks match the real shape of the domain on both axes — task nature and delivery form (artifact / argument / performance)?'],
  ['granularity', '粒度', 'Is the count/grain of stages and tasks sensible? (low: trivial micro-steps, or huge vague mega-tasks)'],
  ['coherence', '连贯性', 'Do tasks interlock and point at one named outcome? (low: floating, order-independent tasks)'],
  ['topicFidelity', '主题忠实', 'Does it stay strictly on the requested topic, no drift/substitution?'],
  ['singleConcreteOutcome', '单一终点', 'Is there one nameable final destination (a product, a defended position, a decision + rationale, a reflection, a performance)?'],
  ['difficultyProgressionAndFit', '难度递进', 'Does difficulty rise gradually and match the proficiency tier?'],
  ['learnerAgency', '学习者自主', 'Is there room for the learner to think and decide? (low: fill-in-the-blank, or a planted standard answer)'],
  ['authenticWorkflow', '真实工作流', 'Does the stage flow resemble a real practitioner\'s workflow?'],
  ['stageIntegrity', '阶段完整', 'Do stages have meaningful checkpoints, and do briefing/completionCriteria/debrief match the actual tasks inside?'],
  ['closureAndConsolidation', '收尾与整合', 'Does the project end on consolidating work (demo / test / reflection / a landed position)?'],
];

const SCENARIO_DIMENSION_CRITERIA = {
  projectNotLecture: 'Is the scenario LIVED, not lectured? Prep teaches the premise; roleplay stages are genuine in-character doing, not a disguised Q&A.',
  taskEvaluability: 'Does every roleplay beat carry a concrete, OBSERVABLE `successWhen` — a real in-scene action/decision the learner must say or do?',
  typeFit: 'Does each beat use the right delivery form for the situation (performance / decision / artifact)?',
  granularity: '2-4 meaningful beats per roleplay stage; each a substantive unit, not filler or a mega-beat.',
  coherence: 'Do the beats interlock into a dramatic arc (hook → rising stakes → turning point → resolution) and accumulate?',
  topicFidelity: 'Does it stay strictly on the requested scenario, no drift/substitution?',
  singleConcreteOutcome: 'Does the scenario resolve to ONE nameable endpoint that the wrapup reflects on?',
  difficultyProgressionAndFit: 'Do stakes/complexity rise across beats and match the proficiency tier (how much prep/hints scaffold)?',
  learnerAgency: 'Is the scenario FREE-FIRST (the learner always types their own response), never a planted "correct line"?',
  authenticWorkflow: 'Does the flow resemble how this real situation actually unfolds, so the skill transfers beyond the exercise?',
  stageIntegrity: 'Is the skeleton exactly prep → roleplay(s) → wrapup, with no spoilers and clean channel separation (narration / prep / hints / in-world character)?',
  closureAndConsolidation: 'Does wrapup land the arc with light, specific feedback grounded in the learner\'s actual performance?',
};

const ORDINARY_RED_LINES = [
  ['B1', 'forward dependency: a task needs the output of a later task'],
  ['B2', 'prerequisite gap: a task assumes knowledge/material no prior task provided'],
  ['B3', 'floating task: tasks can be reordered freely, no accumulation'],
  ['B4', 'task containment/nesting: one task already contains another\'s work'],
  ['B5', 'mega-task: one task bundles several unrelated sub-goals'],
  ['B6', 'trivial fragmentation: a small action split into too many micro-steps'],
  ['B7', 'redundant stage: multiple stages do the same thing, or exist only as filler'],
  ['B8', 'no terminal outcome: stages never converge on any nameable endpoint'],
  ['B9', 'invisible lecture: pure "learn → review" with no real doing'],
  ['B10', 'stage-script inconsistency: stage briefing/completionCriteria contradicts its inner tasks'],
  ['B11', 'topic substitution: requested topic replaced by a generic teaching project'],
  ['B12', 'shape mismatch: non-coding project forced into coding/a quiz, or a performance task flattened into writing'],
  ['B13', 'answer leak: the task statement or a hint hands the full answer'],
  ['B14', 'false binary for open work: a multi-solution task forced into one choice then overruled'],
  ['B15', 'task-shape mislabel (either axis), or a gradable-open task with no stated criteria'],
  ['B16', 'scope explosion: too many stages to finish in one focused sitting (≈15-45 min)'],
  ['B17', 'manufactured fake outcome: forcing a fake tangible deliverable onto open-ended work'],
];

const SCENARIO_RED_LINES = [
  ['B1', 'forward dependency: a beat needs the result of a later beat'],
  ['B2', 'prerequisite gap: a beat assumes context no prior stage/prep established'],
  ['B3', 'floating beat: beats can be reordered freely, no arc'],
  ['B5', 'mega-beat: one beat bundles several unrelated in-scene goals'],
  ['B6', 'trivial fragmentation: a single exchange split into too many micro-beats'],
  ['B7', 'redundant stage: roleplay stages that do the same thing or are pure filler'],
  ['B8', 'no terminal outcome: the scenario never converges on any nameable endpoint'],
  ['B9', 'invisible lecture: "beats" are really a Q&A / concept review'],
  ['B11', 'topic substitution: requested scenario replaced by a generic teaching scenario'],
  ['B16', 'scope explosion: too many stages/beats to finish in one focused sitting'],
  ['S1', 'wrong skeleton: not exactly prep → roleplay(s) → wrapup, or `coreConcept` set on a scenario stage'],
  ['S2', 'prep gates or guesses: prep has a do-before-advance task or asks the learner to guess the premise'],
  ['S3', 'missing/empty beat success: a roleplay beat lacks an observable `successWhen`'],
  ['S4', 'spoiler: a learner-visible field reveals a fact meant to be uncovered later'],
  ['S5', 'character-as-coach / channel bleed: a character coaches, grades, or narrates meta content'],
  ['S6', 'missing rules: a rule-based scenario omits the concrete rules for prep'],
  ['S7', 'flattened performance: a live exchange forced into a written artifact or quiz'],
  ['S8', 'false branching / overruled agency: a planted correct line overrides the learner'],
];

export function dimensionsFor(plan) {
  const scenario = !!plan?.scenario;
  return DIMENSION_DEFS.map(([key, label, criterion]) => ({
    key,
    label,
    criterion: scenario ? SCENARIO_DIMENSION_CRITERIA[key] ?? criterion : criterion,
    scale: { ...RUBRIC_SCALE },
    weight: 1,
  }));
}

export function redLinesFor(plan) {
  const list = plan?.scenario ? SCENARIO_RED_LINES : ORDINARY_RED_LINES;
  return list.map(([code, text]) => ({ code, text }));
}

/**
 * 从项目派生「阶段判据」：每个里程碑的交付物、完成判据、场景要求。
 * 这是 rubric 里**随项目变化**的那一半；维度那一半恒定。
 */
export function stageCriteriaFor(plan) {
  return (plan?.milestones ?? []).map((milestone) => ({
    milestoneId: milestone.id,
    title: milestone.title,
    order: milestone.order,
    scenarioStage: milestone.scenarioStage ?? null,
    completionCriteria: milestone.completionCriteria ?? '',
    coreConcept: milestone.synthesisCheck?.coreConcept ?? null,
    deliverables: (milestone.microtasks ?? []).map((task) => ({
      microtaskId: task.id,
      title: task.title,
      successWhen: task.successWhen ?? null,
      done: task.completionCriteria ?? milestone.completionCriteria ?? '',
      hints: task.hints ?? [],
    })),
  }));
}

/**
 * 生成量规。
 *
 * @param {object} plan `plan()` / `buildPlan()` 的产物
 * @returns {{
 *   version: string,
 *   kind: 'ordinary'|'scenario',
 *   scale: {min:number,max:number},
 *   dimensions: Array<{key:string,label:string,criterion:string,scale:object,weight:number}>,
 *   redLines: Array<{code:string,text:string}>,
 *   stageCriteria: Array<object>,
 *   scoring: {maxScore:number, normalizedTo:number, aggregation:string},
 *   invariants: string[],
 *   summary: {milestoneCount:number, microtaskCount:number, deliverableCount:number}
 * }}
 */
export function buildRubric(plan) {
  if (!plan || !Array.isArray(plan.milestones)) {
    throw new TypeError('rubric(plan) 需要一个已装配的 PBL 项目（缺 milestones）');
  }
  const dimensions = dimensionsFor(plan);
  const maxScore = dimensions.reduce((sum, d) => sum + d.scale.max, 0);
  const stageCriteria = stageCriteriaFor(plan);
  const deliverables = deliverablesOf(plan);

  return {
    version: RUBRIC_VERSION,
    kind: plan.scenario ? 'scenario' : 'ordinary',
    scale: { ...RUBRIC_SCALE },
    // 量规自带项目摘要：`grade()` 只拿 rubric 也能拼出评分上下文。
    project: {
      title: plan.title ?? '',
      description: plan.description ?? '',
      learningObjective: plan.learningObjective ?? '',
      proficiency: plan.proficiency ?? '',
      language: plan.language ?? '',
      languageDirective: plan.languageDirective ?? '',
    },
    dimensions,
    redLines: redLinesFor(plan),
    stageCriteria,
    scoring: {
      maxScore,
      normalizedTo: 100,
      aggregation: 'weighted-mean(dimensions) / maxScore × 100',
    },
    // 结构不变量直接复用完成门：rubric 拿到手就能自查项目是否可评。
    invariants: plannerCompletionGaps(plan, { scenarioRoleplay: !!plan.scenario }),
    summary: {
      milestoneCount: plan.milestones.length,
      microtaskCount: totalMicrotasks(plan),
      deliverableCount: deliverables.length,
    },
  };
}

/** 量规自查：维度是否完整、key 是否重复。供 grade()/集成层调用。 */
export function inspectRubric(rubric) {
  const problems = [];
  if (!rubric || typeof rubric !== 'object') return ['rubric is not an object'];
  if (rubric.version !== RUBRIC_VERSION) problems.push(`rubric.version !== ${RUBRIC_VERSION}`);
  const dimensions = Array.isArray(rubric.dimensions) ? rubric.dimensions : [];
  if (dimensions.length !== DIMENSION_DEFS.length) {
    problems.push(`rubric.dimensions.length !== ${DIMENSION_DEFS.length}`);
  }
  const seen = new Set();
  for (const dimension of dimensions) {
    if (!dimension?.key) problems.push('dimension without key');
    else if (seen.has(dimension.key)) problems.push(`duplicate dimension key: ${dimension.key}`);
    else seen.add(dimension.key);
  }
  return problems;
}

export const RUBRIC_DIMENSION_KEYS = Object.freeze(DIMENSION_DEFS.map(([key]) => key));
