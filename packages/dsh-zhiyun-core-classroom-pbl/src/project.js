// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-core.ts:20-38（SCENARIO_SCHEMA_VERSION / 进度事件形状）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-core.ts:61-125（emptyProject）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-core.ts:262-317（newId / instructorProjectAnchor / applyPlannerProficiency）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-core.ts:323-394（plannerCompletionGaps 完成门）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-core.ts:400-487（normalizeSynthesisChecks）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-single-call.ts:303-462（hydrateProject：id / status / order / thread 装配）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/operations/kernel/progress.ts:75-120,328-400（normalizeProjectRuntime / normalizeScenario）
// 源：ref/OpenMAIC/packages/@openmaic/dsl/src/pbl.ts:18-149（PBLProject 持久化契约）

/**
 * PBL 项目的**确定性装配层**：空壳 → 浇水（hydrate）→ 运行时归一化 → 完成门。
 *
 * 这一层一次 LLM 调用都不发。上游把它拆在 `planner-core.ts` /
 * `planner-single-call.ts` / `operations/kernel/progress.ts` 三个文件里，
 * 本包合并成一个模块，因为三者共用同一份 `project` 可变对象，
 * 拆开只会让「谁在什么时候改了 status」更难查。
 *
 * 关键不变量（渲染器与 Instructor 运行期都依赖）：
 * - 第一个里程碑 `active`，其余 `locked`；
 * - 每个里程碑至少一条微任务，否则完成门不放行；
 * - Instructor 线程固定一条，场景项目额外一条 simulator 线程；
 * - 场景骨架固定 prep → roleplay(s) → wrapup。
 */

import { PblError } from './errors.js';
import { computeInitialAssessment, reseatAssessmentTier } from './proficiency.js';

export const SCENARIO_SCHEMA_VERSION = 1;

/** 带 `synthesisCheck` 的阶段硬上限（上游 MAX_SYNTHESIS_STAGES=2）。 */
export const MAX_SYNTHESIS_STAGES = 2;

/** 场景项目里模拟器线程的合成 agent id（不是 roles[] 记录）。 */
export const PBL_SIMULATOR_AGENT_ID = 'simulator';

export const STAGE_KINDS = Object.freeze(['prep', 'roleplay', 'wrapup']);
export const PROFICIENCY_TIERS = Object.freeze(['beginner', 'intermediate', 'advanced']);

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

export function newId(prefix) {
  // 上游同款：12 个十六进制字符，不引 nanoid。
  return `${prefix}_${Math.random().toString(16).slice(2, 8)}${Math.random().toString(16).slice(2, 8)}`;
}

/** LLM JSON 没有运行时类型保证：非字符串一律变 ''，绝不让 `.trim()` 抛。 */
export function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** 非数组 → []；非字符串条目丢弃；去空、去重保序。 */
export function toStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(toText).filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

const PBL_TEXT_LIMIT = 20000;

export function trimmedPBLText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > PBL_TEXT_LIMIT ? text.slice(0, PBL_TEXT_LIMIT) : text;
}

// ---------------------------------------------------------------------------
// 空壳
// ---------------------------------------------------------------------------

/**
 * 构造一个「设计态」项目空壳。预算是零：全部字段在这里一次成型，
 * 之后所有工具/阶段只往里填。
 *
 * @param {object} input `{ outline, courseContext, user, targetLanguage }`
 */
export function emptyProject(input = {}) {
  const now = nowIso();
  const outline = input.outline ?? {};
  const assessment = computeInitialAssessment({
    outline,
    priorScenes: input.courseContext?.allOutlines ?? [],
    userBio: input.user?.bio,
    userRequirement: input.user?.requirement,
    source: 'planner',
  });
  const languageDirective = toText(input.courseContext?.languageDirective) || undefined;

  return {
    uiPhase: 'hero',
    title: '',
    description: '',
    learningObjective: '',
    gains: [],
    proficiency: assessment.tier,
    proficiencyAssessment: assessment,
    language: toText(input.targetLanguage),
    languageDirective,
    tags: [],
    status: 'designing',
    roles: [],
    milestones: [],
    submissions: [],
    evaluations: [],
    threads: [],
    engagementEvents: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Instructor 锚点 / 档位
// ---------------------------------------------------------------------------

/** Instructor 的 system prompt 里那段「你正在带哪个项目」的锚点。 */
export function instructorProjectAnchor(project) {
  return [
    'You are the Instructor for THIS PBL project.',
    `Project title: ${project.title}`,
    `Project description: ${project.description}`,
    project.learningObjective ? `Learning objective: ${project.learningObjective}` : '',
    'If the learner asks what project they are doing, answer directly from this information, in the project content language. Never say you do not know the project, and never ask them what project they want to do unless the project title and description are empty.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 把 Planner 选的档位落到项目上。
 * 学习者显式自报时**锁死**该档（上游同款语义）。
 */
export function applyPlannerProficiency(project, proficiency) {
  const assessment = project.proficiencyAssessment;
  const explicitTierLocked = assessment?.signals?.[0]?.kind === 'user_level_explicit';
  const next = PROFICIENCY_TIERS.includes(proficiency) ? proficiency : 'intermediate';
  const effective = explicitTierLocked && assessment ? assessment.tier : next;
  if (assessment && assessment.tier !== effective) {
    project.proficiencyAssessment = reseatAssessmentTier(assessment, effective);
  }
  project.proficiency = effective;
}

// ---------------------------------------------------------------------------
// 浇水：LLM 输出 → 完整项目
// ---------------------------------------------------------------------------

/**
 * @param {object} project emptyProject 的产物
 * @param {object} parsed LLM/程序化输出的项目规格（见 buildPlan 的文档）
 */
export function hydrateProject(project, parsed = {}) {
  const info = parsed.projectInfo ?? {};
  const isScenario = !!parsed.scenario;

  project.title = toText(info.title);
  project.description = toText(info.description);
  project.learningObjective = toText(info.learningObjective) || undefined;
  project.gains = toStringList(info.gains);
  project.tags = toStringList(parsed.tags);
  if (toText(parsed.language)) project.language = toText(parsed.language);
  if (toText(parsed.languageDirective)) project.languageDirective = toText(parsed.languageDirective);
  applyPlannerProficiency(
    project,
    info.proficiency ?? (project.proficiency === '' ? 'intermediate' : project.proficiency),
  );

  const llmRole = parsed.instructorRole ?? {};
  const anchoredSystemPrompt = [toText(llmRole.systemPrompt), instructorProjectAnchor(project)]
    .filter(Boolean)
    .join('\n\n');
  project.roles = [{
    id: newId('role'),
    type: 'instructor',
    name: toText(llmRole.name),
    description: toText(llmRole.description) || undefined,
    systemPrompt: anchoredSystemPrompt,
  }];

  project.milestones = (Array.isArray(parsed.milestones) ? parsed.milestones : []).map(
    (m, index) => {
      const microtasks = (Array.isArray(m?.microtasks) ? m.microtasks : []).map((t, j) => {
        const task = {
          id: newId('mt'),
          title: toText(t?.title),
          description: toText(t?.description) || undefined,
          status: 'todo',
          assignee: 'user',
          hints: toStringList(t?.hints),
          order: j,
        };
        for (const field of [
          'successWhen',
          'characterObjective',
          'skillFocus',
          'learnerBrief',
          'narration',
          'completionCriteria',
        ]) {
          const value = toText(t?.[field]);
          if (value) task[field] = value;
        }
        return task;
      });

      const coreConcept = toText(m?.coreConcept);
      const scenarioStage = STAGE_KINDS.includes(m?.scenarioStage) ? m.scenarioStage : undefined;
      return {
        id: newId('ms'),
        title: toText(m?.title),
        description: toText(m?.description) || undefined,
        status: index === 0 ? 'active' : 'locked',
        order: index,
        microtasks,
        briefing: toText(m?.briefing),
        completionCriteria: toText(m?.completionCriteria),
        debrief: toText(m?.debrief),
        // 场景阶段不挂 synthesisCheck（收尾阶段本身就是反思位）——即使 LLM 漏了也挡掉。
        ...(coreConcept && !isScenario ? { synthesisCheck: { coreConcept } } : {}),
        ...(scenarioStage ? { scenarioStage } : {}),
      };
    },
  );

  if (parsed.scenario) {
    project.scenario = hydrateScenario(parsed.scenario);
    project.schemaVersion = SCENARIO_SCHEMA_VERSION;
  }

  const instructor = project.roles.find((r) => r.type === 'instructor');
  if (instructor && !project.threads.some((t) => t.agentId === instructor.id)) {
    project.threads.push({ agentId: instructor.id, messages: [] });
  }
  project.status = 'active';
  project.uiPhase = 'hero';
  project.updatedAt = nowIso();
  return project;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function hydrateScenario(raw = {}) {
  const characters = (Array.isArray(raw.characters) ? raw.characters : [])
    .filter((c) => toText(c?.name) && toText(c?.persona))
    .map((c) => ({
      id: newId('char'),
      name: toText(c.name),
      persona: toText(c.persona),
      ...(toText(c.situation) ? { situation: toText(c.situation) } : {}),
      ...(toText(c.boundaries) ? { boundaries: toText(c.boundaries) } : {}),
      ...(toText(c.openingLine) ? { openingLine: toText(c.openingLine) } : {}),
    }))
    // 硬约束：本版本只出声一个对手（runtime 只读 characters[0]）。
    .slice(0, 1);

  const scenario = { setting: toText(raw.setting), characters };
  if (toText(raw.goal)) scenario.goal = toText(raw.goal);
  if (toText(raw.rules)) scenario.rules = toText(raw.rules);
  if (toText(raw.learnerRole)) scenario.learnerRole = toText(raw.learnerRole);

  const visual = raw.sceneVisual;
  if (visual && (toText(visual.caption) || toStringList(visual.motifs).length > 0)) {
    const sceneVisual = {
      caption: toText(visual.caption),
      motifs: toStringList(visual.motifs).slice(0, 4),
    };
    for (const key of ['bg1', 'bg2', 'accent']) {
      const value = typeof visual[key] === 'string' ? visual[key].trim() : '';
      if (HEX_RE.test(value)) sceneVisual[key] = value;
    }
    scenario.sceneVisual = sceneVisual;
  }
  return scenario;
}

/**
 * **程序化建项目**：不调 LLM，把一份规格浇水成合规 `PBLProject`。
 *
 * `spec` 与 `plan()` 内部消费的 LLM 输出同形（这样「模型产出的东西」和
 * 「人手写的 fixture」走同一条装配路径，不会出现两套 hydration）：
 *
 * ```js
 * {
 *   projectInfo: { title, description, learningObjective, gains, proficiency },
 *   instructorRole: { name, description, systemPrompt },
 *   milestones: [{
 *     title, description, briefing, completionCriteria, debrief, coreConcept?,
 *     scenarioStage?, microtasks: [{ title, description, hints, successWhen?, ... }],
 *   }],
 *   scenario?: { setting, goal, rules, learnerRole, characters, sceneVisual },
 *   language?, languageDirective?, tags?
 * }
 * ```
 *
 * @param {object} spec
 * @param {object} [opts]
 * @param {boolean} [opts.strict=true] 不过完成门时抛 `PLAN_INVALID`
 * @param {object} [opts.input] 原始 brief（决定语言默认值 / 熟练度信号）
 */
export function buildPlan(spec = {}, opts = {}) {
  const project = emptyProject(opts.input ?? {});
  hydrateProject(project, spec);
  normalizeProjectRuntime(project);
  normalizeSynthesisChecks(project);
  normalizeScenario(project);

  const scenarioRoleplay = !!project.scenario;
  const gaps = plannerCompletionGaps(project, { scenarioRoleplay });
  if (opts.strict !== false && gaps.length > 0) {
    throw new PblError(
      'PLAN_INVALID',
      `PBL 项目未过完成门：${gaps.join('; ')}`,
      { gaps, project },
    );
  }
  return project;
}

// ---------------------------------------------------------------------------
// 运行时归一化
// ---------------------------------------------------------------------------

/** 保证「一条 Instructor 线程、一个 active 里程碑、一条可做微任务」。 */
export function normalizeProjectRuntime(project) {
  let changed = false;
  if (normalizeScenario(project)) changed = true;

  const instructor = project.roles.find((r) => r.type === 'instructor');
  if (instructor && !project.threads.some((t) => t.agentId === instructor.id)) {
    project.threads.push({ agentId: instructor.id, messages: [] });
    changed = true;
  }
  if (project.scenario && !project.threads.some((t) => t.agentId === PBL_SIMULATOR_AGENT_ID)) {
    project.threads.push({ agentId: PBL_SIMULATOR_AGENT_ID, messages: [] });
    changed = true;
  }

  if (project.status !== 'completed' && project.milestones.length > 0) {
    let active = project.milestones.find((m) => m.status === 'active');
    if (!active) {
      active = project.milestones.find((m) => m.status !== 'completed')
        ?? project.milestones[project.milestones.length - 1];
      if (active && active.status !== 'active') {
        active.status = 'active';
        changed = true;
      }
    }
    for (const milestone of project.milestones) {
      if (milestone !== active && milestone.status !== 'completed') {
        milestone.status = 'locked';
      }
    }
    const current = active?.microtasks.find(
      (t) => t.status === 'todo' || t.status === 'in_progress',
    );
    if (current && current.status === 'todo' && !active.microtasks.some((t) => t.status === 'in_progress')) {
      current.status = 'in_progress';
      changed = true;
    }
  }

  if (changed) project.updatedAt = nowIso();
  return changed;
}

/**
 * 场景一致性修复（幂等、对普通项目是 no-op）：
 * - 没有 cast 却带 `scenarioStage` → 清掉孤儿标记；
 * - cast 结构坏了 → 丢 `scenario` 与 `schemaVersion`，退回普通项目；
 * - cast 合法但没有 roleplay 阶段 → 同样退回普通项目；
 * - 阶段缺省 → 按位置补 prep / roleplay / wrapup。
 */
export function normalizeScenario(project) {
  let changed = false;
  const staged = project.milestones.filter((m) => m.scenarioStage !== undefined);

  if (!project.scenario) {
    for (const milestone of staged) {
      delete milestone.scenarioStage;
      changed = true;
    }
    if (changed) project.updatedAt = nowIso();
    return changed;
  }

  const scenario = project.scenario;
  const validChars = (scenario.characters ?? []).filter(
    (c) => c && trimmedPBLText(c.name) && trimmedPBLText(c.persona),
  );
  if (validChars.length !== (scenario.characters?.length ?? 0)) {
    scenario.characters = validChars;
    changed = true;
  }
  for (const character of scenario.characters ?? []) {
    if (!character.id) {
      character.id = newId('char');
      changed = true;
    }
  }

  const degrade = () => {
    delete project.scenario;
    delete project.schemaVersion;
    for (const milestone of staged) delete milestone.scenarioStage;
    changed = true;
  };

  if ((scenario.characters ?? []).length === 0) {
    degrade();
    if (changed) project.updatedAt = nowIso();
    return changed;
  }

  const all = project.milestones;
  all.forEach((milestone, index) => {
    if (STAGE_KINDS.includes(milestone.scenarioStage)) return;
    milestone.scenarioStage = index === 0 ? 'prep' : index === all.length - 1 ? 'wrapup' : 'roleplay';
    changed = true;
  });

  if (!all.some((m) => m.scenarioStage === 'roleplay')) {
    degrade();
  }

  if (changed) project.updatedAt = nowIso();
  return changed;
}

// ---------------------------------------------------------------------------
// 综合检查（synthesisCheck）归一化
// ---------------------------------------------------------------------------

/** 语言无关的浅层词袋：拉丁词（≥2）+ 中文二元组。 */
export function conceptTokens(text) {
  const out = new Set();
  const lower = String(text ?? '').toLowerCase();
  for (const word of lower.match(/[a-z0-9]{2,}/g) ?? []) out.add(word);
  const cjk = lower.match(/[\u4e00-\u9fff]/g) ?? [];
  for (let i = 0; i + 1 < cjk.length; i += 1) out.add(cjk[i] + cjk[i + 1]);
  return out;
}

export function overlapScore(text, refTokens) {
  if (!refTokens || refTokens.size === 0) return 0;
  const tokens = conceptTokens(text);
  let score = 0;
  for (const token of refTokens) if (tokens.has(token)) score += 1;
  return score;
}

/**
 * 确定性地把「1-2 个核心阶段带 synthesisCheck」落成代码：
 * 多了按相关度砍到 2，一个都没有就自动挑一个最贴学习目标的阶段。
 */
export function normalizeSynthesisChecks(project) {
  // 场景项目不挂（收尾阶段承担反思），与上游一致。
  if (project.scenario) return;
  if (project.milestones.length === 0) return;

  const refTokens = conceptTokens(
    `${project.learningObjective ?? ''} ${project.title} ${project.description}`,
  );
  const flagged = project.milestones.filter((m) => m.synthesisCheck);

  if (flagged.length > MAX_SYNTHESIS_STAGES) {
    const ranked = flagged
      .map((m) => ({
        m,
        score: overlapScore(
          `${m.title} ${m.description ?? ''} ${m.synthesisCheck?.coreConcept ?? ''}`,
          refTokens,
        ),
      }))
      .sort((a, b) => b.score - a.score || a.m.order - b.m.order);
    for (const { m } of ranked.slice(MAX_SYNTHESIS_STAGES)) delete m.synthesisCheck;
    return;
  }

  if (flagged.length === 0) {
    const ordered = project.milestones.slice().sort((a, b) => a.order - b.order);
    const ranked = ordered
      .map((m) => ({ m, score: overlapScore(`${m.title} ${m.description ?? ''}`, refTokens) }))
      .sort((a, b) => b.score - a.score || a.m.order - b.m.order);
    let pick = ranked[0]?.m;
    // 全零重叠时避开首尾（通常是脚手架 / 收尾），取中位。
    if ((!pick || ranked[0].score === 0) && ordered.length >= 3) {
      pick = ordered[Math.floor(ordered.length / 2)];
    }
    if (pick) {
      const coreConcept = (
        trimmedPBLText(project.learningObjective)
        || trimmedPBLText(pick.description)
        || trimmedPBLText(pick.title)
      ).slice(0, 120);
      pick.synthesisCheck = { coreConcept };
    }
  }
}

// ---------------------------------------------------------------------------
// 完成门
// ---------------------------------------------------------------------------

function ordinaryPBLTextOnlyGaps(project) {
  const gaps = [];
  for (const milestone of project.milestones) {
    if ((milestone.documents ?? []).length > 0) {
      gaps.push(
        `ordinary PBL milestone "${milestone.title}" has hidden documents; inline any required primer, sample data, or starter content in visible milestone/microtask text instead`,
      );
    }
  }
  return gaps;
}

/**
 * 完成门：返回人话 gap 列表，空数组 = 合格。
 * 上游在 agentic loop 的 `mark_design_complete` 里用它拒收半成品；
 * 本包在每次装配后用它做最后一道闸。
 */
export function plannerCompletionGaps(project, opts = {}) {
  const errors = [];
  if (!project.title) errors.push('title is empty');
  if (!project.description) errors.push('description is empty');
  if (!project.roles.some((r) => r.type === 'instructor')) errors.push('no Instructor role');
  if (project.milestones.length === 0) errors.push('no milestones');
  for (const milestone of project.milestones) {
    if (milestone.microtasks.length === 0) {
      errors.push(`milestone "${milestone.title}" has no microtasks`);
    }
  }

  if (!opts.scenarioRoleplay) {
    errors.push(...ordinaryPBLTextOnlyGaps(project));
    return errors;
  }

  if (!project.scenario) {
    errors.push('scenario project but set_scenario was never called');
  } else {
    const characters = project.scenario.characters ?? [];
    if (characters.length === 0) {
      errors.push('scenario has no characters (set_scenario needs at least one character)');
    } else {
      characters.forEach((c, i) => {
        if (!trimmedPBLText(c?.name) || !trimmedPBLText(c?.persona) || !trimmedPBLText(c?.situation)) {
          errors.push(`scenario character #${i + 1} is missing name, persona, or situation`);
        }
      });
    }
  }

  const stages = project.milestones.map((m) => m.scenarioStage);
  const roleplayCount = stages.filter((s) => s === 'roleplay').length;
  if (project.milestones.length < 3) {
    errors.push(
      'scenario project needs the three-stage skeleton: a prep stage, at least one roleplay stage, and a wrapup stage',
    );
  }
  if (stages[0] !== 'prep') errors.push('scenario project: the FIRST milestone must be scenarioStage:"prep"');
  if (stages[stages.length - 1] !== 'wrapup') {
    errors.push('scenario project: the LAST milestone must be scenarioStage:"wrapup"');
  }
  if (roleplayCount === 0) {
    errors.push('scenario project: needs at least one scenarioStage:"roleplay" milestone');
  }

  const visual = project.scenario?.sceneVisual;
  if (!trimmedPBLText(visual?.caption) || (visual?.motifs?.length ?? 0) === 0) {
    errors.push(
      'scenario project: call set_scene_visual once (a project-wide caption + 2–4 fitting emoji motifs + colours) AFTER authoring the roleplay stages',
    );
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 读取辅助
// ---------------------------------------------------------------------------

export function totalMicrotasks(project) {
  return project.milestones.reduce((sum, m) => sum + m.microtasks.length, 0);
}

/** 交付物 = 每条微任务要求学习者产出的东西（标题 + 完成判据）。 */
export function deliverablesOf(project) {
  const items = [];
  for (const milestone of project.milestones) {
    for (const task of milestone.microtasks) {
      items.push({
        milestoneId: milestone.id,
        milestoneTitle: milestone.title,
        microtaskId: task.id,
        title: task.title,
        successWhen: task.successWhen ?? null,
        completionCriteria: task.completionCriteria ?? milestone.completionCriteria ?? null,
      });
    }
  }
  return items;
}

export function currentMilestone(project) {
  return project.milestones.find((m) => m.status === 'active');
}

export function currentMicrotask(project) {
  const milestone = currentMilestone(project);
  if (!milestone) return undefined;
  const microtask = milestone.microtasks.find(
    (t) => t.status === 'todo' || t.status === 'in_progress',
  );
  return microtask ? { milestone, microtask } : undefined;
}

export function findMilestoneAndTask(project, milestoneId, microtaskId) {
  const milestone = project.milestones.find((m) => m.id === milestoneId);
  if (!milestone) return null;
  const microtask = milestone.microtasks.find((t) => t.id === microtaskId);
  if (!microtask) return null;
  return { milestone, microtask };
}
