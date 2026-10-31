// 源：ref/OpenMAIC/lib/pbl/v2/agents/evaluator.ts:259-324（persistEvaluation：task 分支的字段归一）
// 源：ref/OpenMAIC/lib/pbl/v2/operations/runtime/eval-tail-parser.ts:55-73,140-246（尾 JSON 解析 / score / stars / 列表归一）
// 源：ref/OpenMAIC/lib/pbl/v2/operations/runtime/eval-prompts.ts:62-121（任务评分证据分段）
// 源：ref/OpenMAIC/lib/pbl/v2/operations/runtime/submission.ts:96-120（只评最新一次提交）

import { PblError } from './errors.js';
import { conceptTokens, trimmedPBLText } from './project.js';
import { inspectRubric } from './rubric.js';
import { buildTaskGradePrompt } from './prompts.js';

const noop = () => {};
const FENCED_RE = /```(?:json)?\s*([\s\S]*?)```/g;

/** 尾 JSON 解析：整段 / 围栏 / 尾部平衡对象，逐级降级。 */
export function parseEvaluationTail(text) {
  const source = String(text ?? '').trim();
  if (!source) return null;

  const candidates = [source];
  let match;
  const re = new RegExp(FENCED_RE.source, 'g');
  while ((match = re.exec(source)) !== null) candidates.push(match[1].trim());
  const balanced = trailingBalancedObject(source);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // 继续降级
    }
  }
  return null;
}

function trailingBalancedObject(text) {
  const end = text.lastIndexOf('}');
  if (end < 0) return null;
  let depth = 0;
  for (let i = end; i >= 0; i -= 1) {
    if (text[i] === '}') depth += 1;
    else if (text[i] === '{') {
      depth -= 1;
      if (depth === 0) return text.slice(i, end + 1);
    }
  }
  return null;
}

/** score → [0,100] 整数；接受 "80/100"。 */
export function normalizeScore(raw) {
  if (raw === null || raw === undefined) return null;
  let candidate;
  if (typeof raw === 'number') candidate = raw;
  else if (typeof raw === 'string') {
    const slash = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*\/\s*100\s*$/);
    if (slash) candidate = parseFloat(slash[1]);
    else {
      const plain = raw.trim();
      if (!/^-?\d+(?:\.\d+)?$/.test(plain)) return null;
      candidate = parseFloat(plain);
    }
  } else return null;
  if (!Number.isFinite(candidate)) return null;
  return Math.round(Math.max(0, Math.min(100, candidate)));
}

/** stars → [0,5] 的 0.5 步长；接受 "4.5/5"。 */
export function normalizeStars(raw) {
  if (raw === null || raw === undefined) return null;
  let candidate;
  if (typeof raw === 'number') candidate = raw;
  else if (typeof raw === 'string') {
    const slash = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*\/\s*5\s*$/);
    if (slash) candidate = parseFloat(slash[1]);
    else {
      const plain = raw.trim();
      if (!/^-?\d+(?:\.\d+)?$/.test(plain)) return null;
      candidate = parseFloat(plain);
    }
  } else return null;
  if (!Number.isFinite(candidate)) return null;
  return Math.round(Math.max(0, Math.min(5, candidate)) * 2) / 2;
}

export function normalizeStringList(raw, max = 6) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (!value) continue;
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeOptionalString(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value || null;
}

// ---------------------------------------------------------------------------
// 输入归一化
// ---------------------------------------------------------------------------

/** 提交物：字符串 / `{content}` / 上游 `PBLSubmission` 都能吃。 */
export function normalizeSubmission(submission) {
  if (typeof submission === 'string') return { content: submission };
  const source = submission && typeof submission === 'object' ? submission : {};
  return {
    microtaskId: source.microtaskId ?? null,
    milestoneId: source.milestoneId ?? null,
    kind: source.kind ?? 'text',
    content: trimmedPBLText(source.content ?? source.text ?? ''),
    filename: source.filename ?? null,
    summary: source.summary ?? null,
  };
}

/** 从 rubric 的阶段判据里定位「这次提交属于哪个里程碑 / 哪条任务」。 */
export function resolveTarget(rubric, submission) {
  const stages = Array.isArray(rubric?.stageCriteria) ? rubric.stageCriteria : [];
  if (submission.microtaskId) {
    for (const stage of stages) {
      const deliverable = stage.deliverables?.find((d) => d.microtaskId === submission.microtaskId);
      if (deliverable) {
        return {
          milestone: { ...stage },
          task: { ...deliverable, hints: deliverable.hints ?? [], description: deliverable.successWhen ?? '' },
        };
      }
    }
  }
  if (submission.milestoneId) {
    const stage = stages.find((s) => s.milestoneId === submission.milestoneId);
    if (stage?.deliverables?.length) {
      const deliverable = stage.deliverables[0];
      return {
        milestone: { ...stage },
        task: { ...deliverable, hints: deliverable.hints ?? [], description: deliverable.successWhen ?? '' },
      };
    }
  }
  // 无定位信息时退到第一个阶段：评分仍然可用（上游要求显式给 microtaskId，
  // 但本服务允许「只有一份提交」的简化调用）。
  const stage = stages[0];
  if (!stage?.deliverables?.length) return null;
  return {
    milestone: { ...stage },
    task: { ...stage.deliverables[0], hints: stage.deliverables[0].hints ?? [], description: stage.deliverables[0].successWhen ?? '' },
  };
}

// ---------------------------------------------------------------------------
// 本地降级评分（无 llm 时）
// ---------------------------------------------------------------------------

/**
 * 确定性降级：用「交付物判据的词覆盖」做一次诚实但粗糙的自查。
 * 明确标 `mode:'local'`，且不给维度分 —— 12 个维度是**定性判断**，
 * 用词覆盖去伪造成 1-5 分比不给更糟。
 */
export function localGrade(submission, rubric, target) {
  const content = submission.content ?? '';
  const tokens = conceptTokens(content);
  const deliverables = target?.milestone?.deliverables ?? [];
  let hits = 0;
  const missing = [];
  for (const deliverable of deliverables) {
    const ref = conceptTokens(`${deliverable.title} ${deliverable.successWhen ?? ''} ${deliverable.done ?? ''}`);
    const covered = [...ref].some((token) => tokens.has(token));
    if (covered) hits += 1;
    else missing.push(deliverable.title);
  }
  const coverage = deliverables.length === 0 ? 0 : hits / deliverables.length;
  const score = content.trim() ? Math.round(coverage * 100) : 0;
  const dimensionCount = (rubric?.dimensions ?? []).length;

  return {
    mode: 'local',
    degraded: true,
    kind: 'task',
    microtaskId: submission.microtaskId ?? null,
    score,
    stars: null,
    feedback: content.trim()
      ? `未接入评审模型：按交付物覆盖度给出 ${score}/100 的结构性自查，${dimensionCount} 个质量维度未评分。`
      : '提交内容为空，无法评分。',
    strengths: coverage > 0 ? [`覆盖了 ${hits}/${deliverables.length} 个交付物要点`] : [],
    improvements: missing.slice(0, 4).map((title) => `补齐：${title}`),
    dimensions: [],
  };
}

// ---------------------------------------------------------------------------
// 评分
// ---------------------------------------------------------------------------

/**
 * 按量规评一份提交物。
 *
 * @param {object|string} submission 上游 `PBLSubmission` 形状 / `{content}` / 纯文本
 * @param {object} rubric `rubric(plan)` 的产物
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {object} deps `{ llm?, log? }`
 */
export async function gradeSubmission(submission, rubric, opts = {}, deps = {}) {
  const { llm, log = {} } = deps;
  const warn = log.warn ?? noop;

  const problems = inspectRubric(rubric);
  if (problems.length > 0) {
    throw new PblError('RUBRIC', `量规不合格：${problems.join('; ')}`, { problems });
  }
  if (opts.signal?.aborted) throw new PblError('DISPOSED', '评分已被取消');

  const normalized = normalizeSubmission(submission);
  const target = resolveTarget(rubric, normalized);
  if (!target) {
    throw new PblError('GRADE', 'rubric 里没有可对齐的里程碑 / 任务', { rubric });
  }

  if (!llm || typeof llm.call !== 'function') {
    warn('未注入 llm，评分降级为本地结构自查（mode=local）');
    return localGrade(normalized, rubric, target);
  }

  const project = {
    title: rubric.project?.title ?? '',
    description: rubric.project?.description ?? '',
    language: rubric.project?.language ?? '',
    languageDirective: rubric.project?.languageDirective ?? '',
    proficiency: rubric.project?.proficiency ?? '',
  };
  const { system, user } = buildTaskGradePrompt(project, target.milestone, target.task, normalized, rubric);

  let raw;
  try {
    raw = await llm.call({ stage: 'pbl-v2-evaluator-task', system, prompt: user, signal: opts.signal });
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    throw new PblError('LLM', `评分模型调用失败：${error?.message ?? error}`, { cause: error });
  }

  const text = typeof raw === 'string' ? raw : raw?.text ?? raw?.content ?? '';
  const tail = parseEvaluationTail(text) ?? {};

  const dimensionScores = Array.isArray(tail.dimensions)
    ? tail.dimensions
      .filter((d) => d && typeof d.key === 'string')
      .map((d) => {
        const score = Number(d.score);
        return {
          key: d.key,
          score: Number.isFinite(score) ? Math.max(rubric.scale.min, Math.min(rubric.scale.max, score)) : null,
          note: typeof d.note === 'string' ? d.note : '',
        };
      })
    : [];

  const derivedFromDimensions = dimensionScores.length
    ? Math.round(
      (dimensionScores.reduce((sum, d) => sum + (d.score ?? rubric.scale.min), 0)
        / (dimensionScores.length * rubric.scale.max)) * 100,
    )
    : null;

  return {
    mode: 'llm',
    degraded: false,
    kind: 'task',
    microtaskId: normalized.microtaskId ?? target.task.microtaskId ?? null,
    milestoneId: target.milestone.milestoneId ?? null,
    score: normalizeScore(tail.score) ?? derivedFromDimensions,
    stars: normalizeStars(tail.stars),
    feedback: normalizeOptionalString(tail.feedback) ?? String(text ?? '').trim(),
    strengths: normalizeStringList(tail.strengths, 4),
    improvements: normalizeStringList(tail.improvements, 4),
    dimensions: dimensionScores,
  };
}
