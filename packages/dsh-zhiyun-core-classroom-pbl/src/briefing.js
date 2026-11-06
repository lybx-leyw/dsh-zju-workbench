// 源：ref/OpenMAIC/lib/pbl/v2/operations/runtime/eval-prompts.ts:405-503（场景 transcript / 场景证据分段的渲染口径）
// 源：ref/OpenMAIC/lib/pbl/v2/agents/planner.ts:390-456（里程碑 briefing / completionCriteria / debrief 的语义）
// 源：ref/OpenMAIC/lib/pbl/v2/operations/runtime/eval-prompts.ts:318-324（promptText 截断）
// 源：ref/OpenMAIC/packages/@openmaic/generation/prompts-pbl/planner-single-call-system.md:36-40（gains 的面向学习者措辞）

import { PBL_SIMULATOR_AGENT_ID, deliverablesOf, totalMicrotasks, trimmedPBLText } from './project.js';
import { buildRubric } from './rubric.js';

/**
 * 学习者可见的「项目简报」。
 *
 * 上游没有单独的 briefing 函数 —— 简报文本散在 Hero 页与 Instructor 的
 * 开场 briefing 里。本包把它收敛成一个**确定性**函数（零 LLM），
 * 这样同一份 plan 在任何宿主上都能渲染出同一段说明文字，
 * 也让页面包不必自己拼字段。
 */

const SCENARIO_TRANSCRIPT_BUDGET = 6000;

function promptText(value, maxLength = 700) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** 角色扮演 transcript：narration / 角色台词（按名）/ 学习者台词。 */
export function formatScenarioTranscript(plan) {
  const thread = (plan?.threads ?? []).find((t) => t.agentId === PBL_SIMULATOR_AGENT_ID);
  const messages = thread?.messages ?? [];
  if (messages.length === 0) return '(no role-play conversation recorded)';

  const nameOf = (characterId) =>
    plan?.scenario?.characters?.find((c) => c.id === characterId)?.name ?? 'Character';

  const lines = messages
    .map((message) => ({ message, content: trimmedPBLText(message?.content) }))
    .filter(({ content }) => content)
    .map(({ message, content }) => {
      if (message.roleType === 'system') return `[narration] ${content}`;
      if (message.roleType === 'user') return `Learner: ${content}`;
      if (message.roleType === 'simulator') return `${nameOf(message.characterId)}: ${content}`;
      return null;
    })
    .filter(Boolean);

  let text = lines.join('\n');
  if (text.length > SCENARIO_TRANSCRIPT_BUDGET) {
    text = `…(earlier exchanges trimmed)…\n${text.slice(text.length - SCENARIO_TRANSCRIPT_BUDGET)}`;
  }
  return text;
}

/**
 * @param {object} plan
 * @param {{includeRubric?:boolean}} [opts]
 * @returns {{title:string, text:string, sections:object, deliverables:object[], stages:object[]}}
 */
export function buildBriefing(plan, opts = {}) {
  if (!plan || !Array.isArray(plan.milestones)) {
    throw new TypeError('briefing(plan) 需要一个已装配的 PBL 项目（缺 milestones）');
  }
  const deliverables = deliverablesOf(plan);
  const stages = plan.milestones.map((milestone) => ({
    id: milestone.id,
    order: milestone.order,
    title: milestone.title,
    description: milestone.description ?? '',
    briefing: milestone.briefing ?? '',
    completionCriteria: milestone.completionCriteria ?? '',
    scenarioStage: milestone.scenarioStage ?? null,
    taskCount: milestone.microtasks.length,
    tasks: milestone.microtasks.map((task) => ({
      id: task.id,
      order: task.order,
      title: task.title,
      successWhen: task.successWhen ?? null,
      skillFocus: task.skillFocus ?? null,
    })),
  }));

  const gains = (plan.gains ?? []).map((gain) => `- ${gain}`).join('\n');
  const deliverableLines = deliverables
    .map((item, i) => `${i + 1}. ${item.title}（${item.milestoneTitle}）`)
    .join('\n');
  const stageLines = stages
    .map((stage, i) => [
      `### 阶段 ${i + 1}：${stage.title}`,
      stage.description,
      stage.briefing ? `开场：${promptText(stage.briefing, 400)}` : '',
      stage.completionCriteria ? `完成判据：${promptText(stage.completionCriteria, 240)}` : '',
      stage.tasks.length ? `任务：${stage.tasks.map((t) => t.title).join(' / ')}` : '',
    ].filter(Boolean).join('\n'))
    .join('\n\n');

  const scenario = plan.scenario
    ? [
      '## 场景设定',
      plan.scenario.setting,
      plan.scenario.goal ? `练习目标：${plan.scenario.goal}` : '',
      plan.scenario.rules ? `规则：${plan.scenario.rules}` : '',
      plan.scenario.learnerRole ? `你的身份：${plan.scenario.learnerRole}` : '',
      (plan.scenario.characters ?? []).length
        ? `对手：${plan.scenario.characters.map((c) => `${c.name}（${promptText(c.persona, 120)}）`).join('；')}`
        : '',
    ].filter(Boolean).join('\n')
    : '';

  let rubricDigest = '';
  if (opts.includeRubric) {
    const rubric = buildRubric(plan);
    rubricDigest = [
      '## 评分量规',
      `${rubric.dimensions.length} 个维度（1-5 分，合计 ${rubric.scoring.maxScore} 分，折算 100）：`,
      ...rubric.dimensions.map((d) => `- ${d.label}（${d.key}）`),
    ].join('\n');
  }

  const sections = {
    overview: [
      `# ${plan.title}`,
      plan.description,
      plan.learningObjective ? `学习目标：${plan.learningObjective}` : '',
    ].filter(Boolean).join('\n\n'),
    gains: gains ? `## 你将获得\n${gains}` : '',
    plan: [
      `## 交付物（${deliverables.length}）`,
      deliverableLines || '(none)',
    ].join('\n'),
    stages: `## 阶段计划（${stages.length} 阶段 / ${totalMicrotasks(plan)} 个任务）\n\n${stageLines}`,
    scenario,
    rubric: rubricDigest,
  };

  const text = [
    sections.overview,
    sections.gains,
    sections.scenario,
    sections.plan,
    sections.stages,
    sections.rubric,
  ].filter(Boolean).join('\n\n');

  return { title: plan.title, text, sections, deliverables, stages };
}
