// 源：ref/OpenMAIC/lib/pbl/v2/agents/planner.ts:95-196（generatePBLV2Project：入口 / 循环预算 / 后置校验）
// 源：ref/OpenMAIC/lib/pbl/v2/agents/planner.ts:26-40,198-573（工具顺序与每步守卫）
// 源：ref/OpenMAIC/lib/pbl/v2/agents/planner-single-call.ts:477-578（单次调用的校验-重试-浇水流程）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-core.ts:143-180（system prompt 入参）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/planner-single-call.ts:155-301（结构校验 gap 口径）

/**
 * PBL v2 Planner（多阶段推理版）。
 *
 * 上游有两条路：
 *   1. agentic tool-calling loop（6 个工具、最多 80 步）；
 *   2. 单次结构化输出（一次 JSON + 最多一次定向重试）。
 *
 * 本包把 1 的**阶段语义**搬到「窄 llm」上：因为窄接口没有 tool-calling，
 * 工具顺序被固定成两段显式调用 ——
 *
 *   阶段 A（骨架）：projectInfo + instructorRole + milestones（标题/简报/判据/收尾）
 *   阶段 B（拆解）：逐里程碑产出 microtasks（可并发），每条带 hint 与「done」判据
 *
 * 这样既保留了 loop 的「先定骨架、再拆任务、最后过完成门」的推理次序，
 * 又把失败面收敛成「每段一次 JSON + 一次定向重试」，与单次路径同級。
 *
 * ⚠️ 模块顶层不建任何客户端；`llm` 只从调用参数进来（宿主 `config.llm`）。
 */

import { PblError } from './errors.js';
import { emptyProject, hydrateProject, buildPlan, totalMicrotasks } from './project.js';
import {
  buildPlannerSystemPrompt,
  buildSkeletonUserPrompt,
  buildMicrotaskSystemPrompt,
  buildMicrotaskUserPrompt,
} from './prompts.js';

export const MAX_PLANNER_STEPS = 80; // 上游循环预算，这里只作为并发/规模上限的注释性常量

const noop = () => {};

// ---------------------------------------------------------------------------
// brief 归一化
// ---------------------------------------------------------------------------

/**
 * 把任意形状的 brief 归一成上游 `PBLPlannerV2Input`。
 *
 * 接受三种常见写法：
 * - 纯字符串：`plan('做一个校园二手交易分析')`
 * - 扁平对象：`{ topic, description, skills, milestones }`
 * - 上游形状：`{ outline: { pblConfig }, courseContext }`
 */
export function normalizeBrief(brief) {
  if (typeof brief === 'string') {
    return wrapInput({
      projectTopic: brief,
      projectDescription: brief,
      targetSkills: [],
      issueCount: 4,
    });
  }
  const source = brief && typeof brief === 'object' ? brief : {};

  if (source.outline && typeof source.outline === 'object') {
    const outline = { ...source.outline };
    outline.pblConfig = {
      issueCount: 4,
      targetSkills: [],
      ...(outline.pblConfig ?? {}),
    };
    return {
      ...source,
      outline,
      courseContext: {
        languageDirective: '',
        allOutlines: [],
        ...(source.courseContext ?? {}),
      },
    };
  }

  const config = source.pblConfig ?? source;
  return wrapInput({
    projectTopic: config.projectTopic ?? config.topic ?? config.title ?? '',
    projectDescription:
      config.projectDescription ?? config.description ?? config.brief ?? config.projectTopic ?? '',
    targetSkills: config.targetSkills ?? config.skills ?? [],
    issueCount: config.issueCount ?? config.milestoneCount ?? config.stages ?? 4,
    scenarioRoleplay: config.scenarioRoleplay ?? source.scenarioRoleplay,
    scenarioBrief: config.scenarioBrief ?? source.scenarioBrief,
  }, source);
}

function wrapInput(config, source = {}) {
  const languageDirective =
    source.languageDirective ?? source.languageDirectiveText ?? '';
  const targetLanguage = source.language ?? source.targetLanguage ?? source.locale ?? '';
  return {
    outline: {
      id: source.id ?? 'outline_pbl',
      order: source.order ?? 0,
      type: 'pbl',
      title: config.projectTopic,
      description: config.projectDescription,
      teachingObjective: source.teachingObjective ?? '',
      keyPoints: source.keyPoints ?? [],
      pblConfig: {
        projectTopic: config.projectTopic ?? '',
        projectDescription: config.projectDescription ?? '',
        targetSkills: Array.isArray(config.targetSkills) ? config.targetSkills : [],
        issueCount: Number.isFinite(config.issueCount) ? config.issueCount : 4,
        ...(config.scenarioRoleplay ? { scenarioRoleplay: true } : {}),
        ...(config.scenarioBrief ? { scenarioBrief: config.scenarioBrief } : {}),
      },
    },
    courseContext: {
      allOutlines: Array.isArray(source.courseContext?.allOutlines) ? source.courseContext.allOutlines : [],
      languageDirective: source.courseContext?.languageDirective ?? languageDirective,
    },
    user: source.user ?? (source.bio || source.requirement
      ? { bio: source.bio, requirement: source.requirement }
      : undefined),
    targetLanguage,
  };
}

// ---------------------------------------------------------------------------
// 窄 llm 调用
// ---------------------------------------------------------------------------

/** 从 `llm.call` 的多种返回形状里取纯文本。 */
export function textOf(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  for (const key of ['text', 'content', 'raw', 'output']) {
    if (typeof result[key] === 'string') return result[key];
  }
  return '';
}

/** 宽容 JSON 解析：代码围栏 / 前后散文 / 尾部多余字符都容忍。 */
export function parseJsonResponse(text) {
  const source = String(text ?? '').trim();
  if (!source) return null;

  const candidates = [source];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/g;
  let match;
  while ((match = fenced.exec(source)) !== null) candidates.push(match[1].trim());

  const balanced = extractBalancedObject(source);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // 下一个候选
    }
  }
  return null;
}

function extractBalancedObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

async function callJson(llm, { stage, system, prompt, signal, log }) {
  let raw;
  try {
    raw = await llm.call({ stage, system, prompt, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    log.warn?.(`[${stage}] llm 调用失败`, error?.message ?? error);
    throw new PblError('LLM', `PBL ${stage} 阶段模型调用失败：${error?.message ?? error}`, { cause: error });
  }
  const parsed = parseJsonResponse(textOf(raw));
  if (!parsed) {
    throw new PblError('PARSE', `PBL ${stage} 阶段返回的不是 JSON 对象`, { raw: textOf(raw).slice(0, 400) });
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/** 骨架阶段的结构检查（对应 loop 里 set_project_info / add_role / add_milestone 的守卫）。 */
export function skeletonGaps(parsed, scenarioRoleplay) {
  const gaps = [];
  if (!parsed || typeof parsed !== 'object') return ['response was not a JSON object'];

  const info = parsed.projectInfo ?? {};
  if (!String(info.title ?? '').trim()) gaps.push('projectInfo.title is empty');
  if (!String(info.description ?? '').trim()) gaps.push('projectInfo.description is empty');
  if (!String(info.learningObjective ?? '').trim()) gaps.push('projectInfo.learningObjective is empty');
  const gains = Array.isArray(info.gains) ? info.gains.filter((g) => String(g ?? '').trim()) : [];
  if (gains.length < 3 || gains.length > 5) {
    gaps.push('projectInfo.gains must be a list of 3-5 non-empty learner-facing statements');
  }
  if (info.proficiency != null && !['beginner', 'intermediate', 'advanced'].includes(info.proficiency)) {
    gaps.push('projectInfo.proficiency must be beginner | intermediate | advanced');
  }
  if (!String(parsed.instructorRole?.name ?? '').trim()) gaps.push('instructorRole.name is empty');

  const milestones = Array.isArray(parsed.milestones) ? parsed.milestones : [];
  if (milestones.length === 0) gaps.push('milestones must be a non-empty array');
  milestones.forEach((milestone, i) => {
    const label = String(milestone?.title ?? '').trim() || `#${i + 1}`;
    if (!String(milestone?.title ?? '').trim()) gaps.push(`milestone ${label}: title is empty`);
    if (!String(milestone?.briefing ?? '').trim()) gaps.push(`milestone ${label}: briefing is empty`);
    if (!String(milestone?.completionCriteria ?? '').trim()) {
      gaps.push(`milestone ${label}: completionCriteria is empty`);
    }
    if (!String(milestone?.debrief ?? '').trim()) gaps.push(`milestone ${label}: debrief is empty`);
  });

  if (scenarioRoleplay) {
    const scenario = parsed.scenario;
    if (!scenario || typeof scenario !== 'object') {
      gaps.push('scenario block is missing (a role-play project must include a `scenario`)');
    } else {
      if (!String(scenario.setting ?? '').trim()) gaps.push('scenario.setting is empty');
      const characters = Array.isArray(scenario.characters) ? scenario.characters : [];
      if (characters.length === 0) gaps.push('scenario.characters must have at least one character');
      characters.forEach((c, i) => {
        if (!String(c?.name ?? '').trim() || !String(c?.persona ?? '').trim() || !String(c?.situation ?? '').trim()) {
          gaps.push(`scenario character #${i + 1} needs name, persona, and situation`);
        }
      });
      const visual = scenario.sceneVisual;
      const motifs = Array.isArray(visual?.motifs) ? visual.motifs.filter(Boolean) : [];
      if (!String(visual?.caption ?? '').trim() || motifs.length === 0) {
        gaps.push('scenario.sceneVisual needs a caption and at least one emoji motif');
      }
    }
    const stages = milestones.map((m) => m?.scenarioStage);
    if (milestones.length < 3) {
      gaps.push('scenario needs the three-stage skeleton: prep + ≥1 roleplay + wrapup (≥3 milestones)');
    }
    if (stages[0] !== 'prep') gaps.push('scenario: the FIRST milestone must have scenarioStage:"prep"');
    if (stages[stages.length - 1] !== 'wrapup') {
      gaps.push('scenario: the LAST milestone must have scenarioStage:"wrapup"');
    }
    if (!stages.includes('roleplay')) {
      gaps.push('scenario: needs at least one scenarioStage:"roleplay" milestone');
    }
  }

  return gaps;
}

/** 拆解阶段的结构检查（对应 loop 里 add_microtask 的守卫）。 */
export function microtaskGaps(parsed, milestone) {
  const gaps = [];
  const tasks = Array.isArray(parsed?.microtasks) ? parsed.microtasks : [];
  if (tasks.length === 0) gaps.push(`milestone "${milestone.title}" produced no microtasks`);
  if (tasks.length > 6) gaps.push(`milestone "${milestone.title}" produced ${tasks.length} microtasks (max 6)`);
  tasks.forEach((task, i) => {
    if (!String(task?.title ?? '').trim()) gaps.push(`microtask #${i + 1}: title is empty`);
    if (milestone.scenarioStage === 'roleplay' && !String(task?.successWhen ?? '').trim()) {
      gaps.push(`roleplay beat #${i + 1}: successWhen is required`);
    }
  });
  return gaps;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * @param {object|string} brief
 * @param {object} [opts]
 * @param {'staged'|'single'} [opts.strategy='staged'] 目前实现 staged；single 走同一骨架但跳过拆解并发
 * @param {number} [opts.concurrency=3] 里程碑拆解的并发度
 * @param {number} [opts.retries=1] 每段 JSON 的定向重试次数
 * @param {AbortSignal} [opts.signal]
 * @param {(event:object)=>void} [opts.onProgress] 事件形状与上游 PlannerV2ProgressEvent 同构
 * @param {object} deps
 * @param {{call:Function}} deps.llm 窄 llm（宿主注入）
 * @param {object} [deps.log]
 */
export async function planProject(brief, opts = {}, deps = {}) {
  const { llm, log = {} } = deps;
  const warn = log.warn ?? noop;
  const info = log.info ?? noop;
  const onProgress = opts.onProgress ?? noop;

  if (!llm || typeof llm.call !== 'function') {
    throw new PblError(
      'CONFIG',
      'PBL planner 需要注入窄 llm 接口（{ call({stage,system,prompt,signal}) }），见 config.llm',
    );
  }
  if (opts.signal?.aborted) throw new PblError('DISPOSED', 'PBL planner 已被取消');

  const input = normalizeBrief(brief);
  const pblConfig = input.outline.pblConfig;
  if (!String(pblConfig.projectTopic ?? '').trim()) {
    throw new PblError('CONFIG', 'brief 缺少项目主题（projectTopic / topic）');
  }
  const scenarioRoleplay = pblConfig.scenarioRoleplay === true;
  const retries = Math.max(0, Number(opts.retries ?? 1));
  const concurrency = Math.max(1, Number(opts.concurrency ?? 3));

  const project = emptyProject(input);
  const contentLanguage =
    project.languageDirective
    || project.language
    || 'Match the language of the outline content above.';
  const systemPrompt = buildPlannerSystemPrompt(
    input,
    project.proficiency,
    contentLanguage,
    scenarioRoleplay,
  );

  info(`PBL planner 启动：topic="${pblConfig.projectTopic}" tier=${project.proficiency} scenario=${scenarioRoleplay}`);

  // ── 阶段 A：骨架 ──────────────────────────────────────────────────────
  const skeletonPrompt = buildSkeletonUserPrompt(scenarioRoleplay);
  let skeleton = await callJson(llm, {
    stage: 'pbl-v2-skeleton',
    system: systemPrompt,
    prompt: skeletonPrompt,
    signal: opts.signal,
    log,
  });
  let gaps = skeletonGaps(skeleton, scenarioRoleplay);

  for (let attempt = 0; attempt < retries && gaps.length > 0; attempt += 1) {
    warn(`骨架阶段有 ${gaps.length} 个缺口，定向重试：${gaps.join('; ')}`);
    skeleton = await callJson(llm, {
      stage: 'pbl-v2-skeleton-retry',
      system: systemPrompt,
      prompt: retryPrompt(skeletonPrompt, gaps),
      signal: opts.signal,
      log,
    });
    gaps = skeletonGaps(skeleton, scenarioRoleplay);
  }
  if (gaps.length > 0) {
    throw new PblError('PLAN_INVALID', `PBL 骨架不合格：${gaps.join('; ')}`, {
      gaps,
      project,
    });
  }

  // 先把骨架浇成项目（微任务留空），拆解阶段用它做上下文。
  const draft = emptyProject(input);
  hydrateProject(draft, {
    ...skeleton,
    milestones: skeleton.milestones.map((milestone) => ({ ...milestone, microtasks: [] })),
  });
  onProgress({ kind: 'project_info', title: draft.title });
  if (draft.roles[0]) {
    onProgress({ kind: 'role', roleType: 'instructor', name: draft.roles[0].name });
  }

  // ── 阶段 B：逐里程碑拆解 ──────────────────────────────────────────────
  const taskSystemPrompt = buildMicrotaskSystemPrompt();
  const planned = await mapLimit(draft.milestones, concurrency, async (milestone) => {
    if (opts.signal?.aborted) throw new PblError('DISPOSED', 'PBL planner 已被取消');
    const prompt = buildMicrotaskUserPrompt(draft, milestone);
    let parsed = await callJson(llm, {
      stage: 'pbl-v2-microtasks',
      system: taskSystemPrompt,
      prompt,
      signal: opts.signal,
      log,
    });
    let localGaps = microtaskGaps(parsed, milestone);
    for (let attempt = 0; attempt < retries && localGaps.length > 0; attempt += 1) {
      warn(`里程碑「${milestone.title}」有 ${localGaps.length} 个缺口，定向重试`);
      parsed = await callJson(llm, {
        stage: 'pbl-v2-microtasks-retry',
        system: taskSystemPrompt,
        prompt: retryPrompt(prompt, localGaps),
        signal: opts.signal,
        log,
      });
      localGaps = microtaskGaps(parsed, milestone);
    }
    if (localGaps.length > 0) {
      throw new PblError('PLAN_INVALID', `里程碑「${milestone.title}」拆解不合格：${localGaps.join('; ')}`, {
        gaps: localGaps,
        project: draft,
      });
    }
    onProgress({ kind: 'milestone', title: milestone.title, index: milestone.order });
    for (const [i, task] of parsed.microtasks.entries()) {
      onProgress({ kind: 'microtask', milestoneTitle: milestone.title, title: task.title, index: i });
    }
    return parsed.microtasks;
  });

  // ── 装配 + 完成门 ────────────────────────────────────────────────────
  const finalSpec = {
    ...skeleton,
    milestones: skeleton.milestones.map((milestone, index) => ({
      ...milestone,
      microtasks: planned[index],
    })),
  };

  let result;
  try {
    result = buildPlan(finalSpec, { input, strict: true });
  } catch (error) {
    if (error instanceof PblError && error.kind === 'PLAN_INVALID') {
      throw new PblError('PLAN_INVALID', `PBL 装配后未过完成门：${error.detail.gaps.join('; ')}`, {
        gaps: error.detail.gaps,
        project: error.detail.project,
      });
    }
    throw error;
  }

  onProgress({
    kind: 'complete',
    milestoneCount: result.milestones.length,
    microtaskCount: totalMicrotasks(result),
  });
  info(`PBL planner 完成：${result.milestones.length} 阶段 / ${totalMicrotasks(result)} 任务`);

  return result;
}

function retryPrompt(prompt, gaps) {
  return `${prompt}\n\nYour previous output had these problems:\n${gaps
    .map((gap) => `- ${gap}`)
    .join('\n')}\n\nFix every one of them and output the corrected single JSON object.`;
}

/** 小并发池（上游 loop 串行，但拆解阶段彼此独立，并发不改变结果形状）。 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
