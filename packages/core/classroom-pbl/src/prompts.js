// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-core.ts:131-180（formatCourseContext / buildPlannerSystemPrompt）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-core.ts:188-244（buildScenarioDesignBlock）
// 源：ref/OpenMAIC/packages/@openmaic/generation/prompts-pbl/planner-single-call-system.md:1-143（planner 硬规则 / 自检 / 输出格式）
// 源：ref/OpenMAIC/lib/pbl/v2/agents/planner.ts:152-176（loop 的固定 user prompt）
// 源：ref/OpenMAIC/lib/pbl/v2/operations/runtime/eval-prompts.ts:62-121（任务评分 prompt：system + 证据分段）

/**
 * PBL 的 prompt 组装层（纯字符串，不发请求）。
 *
 * 上游把「设计规范」写在 markdown 里再由 loader 做 `{{var}}` 插值；本仓
 * 没有 prompts-pbl 目录，所以把规则原文搬成常量 —— 这样换宿主时
 * 提示词不会跟着文件系统布局漂。
 *
 * ⚠️ 这里的文本是**给模型看的**，保持英文/原文更利于跨模型稳定；
 * 项目内容语言由 `{{language}}` 槽位控制，不是由本文件的注释语言控制。
 */

/** 设计规则（planner-single-call-system.md 的 16 条，按搬运边界压缩表述）。 */
const PLANNER_RULES = `## Hard rules

1. **Content language — every text field.** Policy: **{{language}}**. A BCP-47 code → that language only; a nuanced instruction → follow it literally. Code samples / API names / well-known technical terms stay native.
2. **Stay on the actual topic.** Every field derives from the outline metadata; never swap in a different "common teaching project".
3. **Project, not lesson sequence.** The project has a named outcome; milestones feel like stages of doing it (clarify / gather / set up / decide / build / test / revise / present / reflect).
4. **Use the given proficiency tier** ({{proficiency}}). beginner → smaller concrete steps, more hints; intermediate → broader tasks; advanced → high-level tasks, fewer hints.
5. **Keep scope tight** — finishable in one sitting (~15-45 min).
6. **Instructor voice = warm coach, second person**, never a lecturer.
7. **Microtasks build on each other.** No floating, reorderable tasks.
8. **Reference the course context** as source material, not a checklist to copy.
9. **Hints and descriptions GUIDE, never SOLVE.** Never include the literal token the learner types: no method/function name, no operator, no syntax template, no ready-to-paste line, no control-flow scaffolding. State the goal and point at the concept.
10. **Leave the learner real choices.** Each milestone gives at least one genuine decision.
11. **Right-sized microtasks.** One substantive step each; never make "run it" / "print it" its own task; 2-4 per milestone.
12. **End with consolidation.** The last milestone closes the project on one nameable deliverable the learner sees working.
13. **Build phases, not lecture chapters.**
14. **Every task has a concrete, judgeable "done".** State what is produced/decided and what "done well" looks like on the right axis: Convergent (correct/works) · Gradable-open (reasoning quality + stated criteria) · Open-reflective (depth + a stated position).
15. **Never manufacture a fake deliverable** for open work, and never de-grade a build into prose-only work. Match delivery form: artifact / argument / performance.
16. **Text-only resource grounding.** No right-side briefing/resource tab/preloaded file/dataset. Inline any needed sample or material directly in visible text.`;

const SELF_CHECK = `## Silent self-check before output

1. Any hint/description with an exact method, operator, or near-copyable fragment → rewrite abstractly.
2. Any trivial mechanics-only microtask → merge into the substantive step.
3. Any open task that only says "write a report/summary" → rewrite as a decision/argument/analysis/plan with explicit strong-vs-weak criteria.
4. Any build task completable by prose alone → require building/testing/debugging the real artifact.
5. Any reference to missing material → inline that material immediately.`;

function formatCourseContext(input) {
  const lines = [];
  const outlines = Array.isArray(input?.courseContext?.allOutlines)
    ? input.courseContext.allOutlines
    : [];
  for (const outline of outlines) {
    const marker = outline?.id === input?.outline?.id ? ' ← this PBL scene' : '';
    lines.push(`- [${outline?.order ?? 0}] ${String(outline?.type ?? 'scene').toUpperCase()}: ${outline?.title ?? ''}${marker}`);
    if (outline?.description) lines.push(`    ${outline.description}`);
  }
  return lines.join('\n') || '(no other scenes in this course)';
}

function pblConfigOf(input) {
  return input?.outline?.pblConfig ?? {};
}

/** Planner system prompt（骨架阶段与拆解阶段共用同一份项目上下文）。 */
export function buildPlannerSystemPrompt(input, proficiency, contentLanguage, scenarioRoleplay) {
  const config = pblConfigOf(input);
  const tier = proficiency === '' || !proficiency ? 'intermediate' : proficiency;
  const scenarioDesign = buildScenarioDesignBlock(config, scenarioRoleplay);
  return [
    'You are the Planner of a Project-Based Learning (PBL) course module on the OpenMAIC platform.',
    '',
    'Your job: from the outline the platform has produced, autonomously design a complete, ready-to-run learning project. The student is not consulted during design.',
    '',
    '## What the platform gives you',
    '',
    `- **Project topic**: ${config.projectTopic ?? ''}`,
    `- **Project description (what students build)**: ${config.projectDescription ?? ''}`,
    `- **Target skills**: ${(config.targetSkills ?? []).join(', ')}`,
    `- **Suggested milestone count**: ${config.issueCount ?? 3}`,
    `- **Student proficiency tier**: ${tier}`,
    '',
    'Course context — every other scene in the course, in playback order:',
    '',
    formatCourseContext(input),
    '',
    'The ordinary PBL workspace is text-only: milestone/task roadmap + Instructor chat + a submission area. It does NOT provide a resource tab, preloaded file, or dataset.',
    '',
    PLANNER_RULES.replaceAll('{{language}}', contentLanguage).replaceAll('{{proficiency}}', tier),
    '',
    scenarioDesign,
    '',
    SELF_CHECK,
  ].filter((part) => part !== '').join('\n');
}

/**
 * SCENARIO ONLY. 角色扮演的设计说明块。普通项目返回 ''（提示词逐字不变）。
 * 原文见上游 `buildScenarioDesignBlock`。
 */
export function buildScenarioDesignBlock(pblConfig, scenarioRoleplay) {
  if (!scenarioRoleplay) return '';
  const brief = typeof pblConfig?.scenarioBrief === 'string' ? pblConfig.scenarioBrief.trim() : '';
  return [
    '## SCENARIO MODE — role-play scenario (this project only)',
    '',
    'This PBL is a **role-play scenario**: the learner steps into a concrete situation and interacts in-character with a character played by a separate Simulator agent. You author the WHOLE scenario now; the runtime only produces the live dialogue. (a) the premise is given and concrete, introduced by the Instructor — never ask the learner to guess it; (b) every task serves the real learning goal.',
    '',
    brief ? `Scenario brief from the platform: ${brief}\n` : '',
    '### Step A — author the scenario (project meta, not a milestone)',
    '- `setting`: the concrete overall premise, in the project language.',
    '- `goal` (optional): what the learner is practising.',
    '- `rules` (required whenever the scenario has a defined rule-set — games / interviews / debates / structured negotiations): the concrete rules a newcomer needs to take part.',
    '- `learnerRole` (optional): the learner\'s own role/position.',
    '- `characters`: EXACTLY ONE character with `name`, `persona`, `situation` (visible up-front circumstance), plus recommended `boundaries` and optional `openingLine`.',
    '',
    '### Step B — fixed three-stage skeleton (milestones in this exact order)',
    '1. **prep** — first milestone. Briefing introduces the premise, the character\'s situation, the rules, and the learner\'s role. Exactly ONE light microtask (no assessment). Do NOT set `coreConcept`.',
    '2. **roleplay** — one or more middle milestones, split by round/phase. Design beats as a DRAMATIC ARC (hook → rising stakes → turning point → resolution). Every beat needs `successWhen` (the concrete, observable in-scene action), recommended `characterObjective` (private drive + any fact to be uncovered), `skillFocus`, optional `narration`, 1-2 learner-facing `hints`. Do NOT set `coreConcept`.',
    '3. **wrapup** — last milestone. Debrief holds light, encouraging feedback grounded in what the learner actually did. Exactly ONE light microtask. Do NOT set `coreConcept`.',
    '',
    '### Rules for scenario design',
    '- Never make a task that asks the learner to guess/invent the premise.',
    '- **No spoilers.** Learner-visible text (`setting` / `situation` / `persona` / prep `briefing` / beat `description` / `narration`) contains only what the learner knows at the outset; hidden causes go in that beat\'s private `characterObjective`.',
    '- The character is a pure in-world participant, NEVER a coach: no grading, no "explain your reasoning", no strategy hints, no "your turn".',
    '- Channel separation: rule teaching → prep Instructor; "it is your turn" → system `narration`; coaching → microtask `hints`.',
    '- 2-4 beats per roleplay stage is plenty.',
    '',
    '### Workflow for this project',
    '1. project info  2. scenario (setting + one character)  3. one instructor role  4. prep milestone + 1 task  5. roleplay milestone(s) + beats  6. wrapup milestone + 1 task  7. `sceneVisual` (caption + 2-4 emoji motifs + colours, based on ALL roleplay stages)',
  ].filter((line) => line !== null && line !== undefined).join('\n');
}

/** 阶段 A：只出骨架（projectInfo / instructorRole / milestones，不含微任务）。 */
export function buildSkeletonUserPrompt(scenarioRoleplay) {
  return [
    'Design the PROJECT SKELETON now. Output exactly one JSON object, no prose, no code fences.',
    '',
    'Include:',
    '- `projectInfo`: title, description, learningObjective, gains (3-5), proficiency',
    '- `instructorRole`: name, description, systemPrompt',
    `- \`milestones\`: ${scenarioRoleplay ? 'prep → roleplay(s) → wrapup' : '3-5 stages of real work'}, each with title, description, briefing, completionCriteria, debrief${scenarioRoleplay ? ', scenarioStage' : ''}${scenarioRoleplay ? '' : ', optional coreConcept (only the 1-2 core stages)'}`,
    scenarioRoleplay ? '- `scenario`: setting, goal?, rules?, learnerRole?, characters[1], sceneVisual' : '',
    '',
    'Do NOT include microtasks in this step — they are authored stage by stage afterwards.',
    'Do not include id/status/order/assignee/timestamps.',
    '',
    'Shape:',
    '{ "projectInfo": {...}, "instructorRole": {...}, "milestones": [{ "title": "", "description": "", "briefing": "", "completionCriteria": "", "debrief": "" }] }',
  ].filter(Boolean).join('\n');
}

/** 阶段 B：单阶段任务拆解。 */
export function buildMicrotaskSystemPrompt() {
  return [
    'You are the Planner of a Project-Based Learning (PBL) course module.',
    '',
    'You are decomposing ONE milestone into microtasks. Follow these rules exactly:',
    '- 2-4 microtasks per milestone; each is ONE substantive step producing or demonstrating something real.',
    '- Never make "run it" / "print it" its own microtask; fold display + a quick check into the producing step.',
    '- Hints and descriptions GUIDE, never SOLVE: no literal method name, operator, syntax template, or copyable line.',
    '- Every microtask states a concrete, judgeable "done" (convergent / gradable-open with stated criteria / open-reflective).',
    '- Hints: 1-3 short, learner-facing pointers; never the answer.',
    '- No reference to a right-side resource panel, attachment, or dataset that is not inlined in the text.',
    '- Write everything in the project content language.',
  ].join('\n');
}

export function buildMicrotaskUserPrompt(project, milestone) {
  const tasks = milestone.microtasks ?? [];
  return [
    `Project: ${project.title}`,
    `Project description: ${project.description}`,
    project.learningObjective ? `Learning objective: ${project.learningObjective}` : '',
    `Proficiency: ${project.proficiency === '' ? 'intermediate' : project.proficiency}`,
    '',
    `Milestone ${milestone.order + 1}: ${milestone.title}`,
    `Milestone description: ${milestone.description ?? ''}`,
    `Milestone briefing: ${milestone.briefing ?? ''}`,
    `Completion criteria: ${milestone.completionCriteria ?? ''}`,
    `Debrief: ${milestone.debrief ?? ''}`,
    milestone.synthesisCheck?.coreConcept ? `Core concept: ${milestone.synthesisCheck.coreConcept}` : '',
    milestone.scenarioStage ? `Scenario stage: ${milestone.scenarioStage}` : '',
    tasks.length ? `(Existing microtasks, for context: ${tasks.map((t) => t.title).join(' / ')})` : '',
    '',
    'Output exactly one JSON object, no prose, no code fences:',
    '{ "microtasks": [{ "title": "", "description": "", "hints": [""] }] }',
    milestone.scenarioStage === 'roleplay'
      ? 'Roleplay milestone: EVERY microtask additionally needs "successWhen" (concrete observable in-scene action), plus recommended "characterObjective", "skillFocus", optional "narration".'
      : '',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// 评分（任务级）
// ---------------------------------------------------------------------------

/**
 * 任务评分的 {system, user}。证据分段照上游 `buildTaskEvalPrompt`：
 * 项目 / 阶段 / 刚完成的任务 / 后续任务（排除边界）/ 提示 / 提交物。
 * 与上游的区别：这里把 rubric 维度一并塞进 system，因为本包的
 * `grade()` 契约就是「submission × rubric」。
 */
export function buildTaskGradePrompt(project, milestone, task, submission, rubric) {
  const language = project.languageDirective || project.language || 'en-US';
  const dimensions = (rubric?.dimensions ?? [])
    .map((d) => `- ${d.key} (${d.scale.min}-${d.scale.max}): ${d.criterion}`)
    .join('\n');

  const system = [
    'You are the Evaluator of a PBL project. Grade ONLY the latest submission against the rubric.',
    '',
    `Language policy: ${language}. Write feedback in that language.`,
    '',
    '## Rubric dimensions',
    dimensions || '- (no dimensions supplied)',
    '',
    '## Output — exactly one JSON object, no prose outside it',
    '{ "feedback": string, "strengths": [string], "improvements": [string], "score": 0-100, "dimensions": [{ "key": string, "score": number, "note": string }] }',
    '',
    'Grade the latest submission only. Earlier drafts are context, not evidence to re-score.',
    'Do not mention later tasks as missing work, and never leak the answer in the feedback.',
  ].join('\n');

  const sections = [
    `## Project\n${project.title}\n\n${project.description}`,
    `## Milestone\n${milestone.title} — ${milestone.description ?? ''}`.trim(),
    `## Microtask just completed\n${task.title}\n${task.description ?? ''}`.trim(),
  ];

  const later = milestone.microtasks
    .filter((t) => t.id !== task.id && (t.order ?? 0) > (task.order ?? 0))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (later.length) {
    sections.push([
      '## Later microtasks in this milestone — exclusion boundary',
      'Listed only so you DO NOT grade this submission against them.',
      ...later.map((t) => `- ${t.title}${t.description ? ` — ${t.description}` : ''}`),
    ].join('\n'));
  }
  if (task.hints?.length) {
    sections.push('## Hints that were given\n' + task.hints.map((h) => `- ${h}`).join('\n'));
  }
  if (submission?.content) {
    sections.push([
      '## What the learner produced in the latest submission',
      submission.filename ? `(file: ${submission.filename})` : '',
      submission.content,
    ].filter(Boolean).join('\n'));
  }

  return { system, user: sections.join('\n\n') };
}
