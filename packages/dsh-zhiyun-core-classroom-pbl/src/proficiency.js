// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/operations/kernel/proficiency.ts:73-105（阈值 / 默认档 / 权重上限）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/operations/kernel/proficiency.ts:160-174（scoreToTier）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/operations/kernel/proficiency.ts:233-253（大纲关键词信号）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/operations/kernel/proficiency.ts:339-430（显式自报 + 显式评估）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pbl/operations/kernel/proficiency.ts:600-703（信号聚合 + Planner 时初评）

/**
 * Planner 时的确定性「熟练度初评」。
 *
 * 上游这套是 893 行的自适应引擎（EWMA / 冷却 / 重定档），Planner 只用到
 * 其中的**静态批量**那一段：显式自报 > 大纲关键词 > 情景难度 > bio >
 * 既往正确率。本包照搬这一段（丢掉运行时的 EWMA 部分，那是 Instructor
 * 运行期的事，不在本包契约里）。
 *
 * 重要语义（与上游一致）：
 * - 学习者显式自报（「零基础」「我是进阶」）**锁死**档位，Planner 不得覆盖；
 * - 无任何证据时落到 `intermediate`（DEFAULT_TIER），不是 beginner。
 */

export const DEFAULT_TIER = 'intermediate';

export const TIER_BOUNDS = Object.freeze({
  enterAdvanced: 0.5,
  leaveAdvanced: 0.2,
  enterBeginner: -0.33,
  leaveBeginner: -0.2,
});

/** 上游 WEIGHT_CAPS 中 Planner 时真正会用到的四项。 */
const WEIGHT_CAPS = Object.freeze({
  outline_keyword: 0.5,
  prior_scene_difficulty: 0.4,
  user_bio: 0.5,
  user_level_explicit: 1,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const nowIso = () => new Date().toISOString();

export function scoreToTier(score, currentTier) {
  const cur = currentTier === '' || !currentTier ? DEFAULT_TIER : currentTier;
  if (cur === 'beginner') {
    return score > TIER_BOUNDS.leaveBeginner ? 'intermediate' : 'beginner';
  }
  if (cur === 'advanced') {
    return score < TIER_BOUNDS.leaveAdvanced ? 'intermediate' : 'advanced';
  }
  if (score > TIER_BOUNDS.enterAdvanced) return 'advanced';
  if (score < TIER_BOUNDS.enterBeginner) return 'beginner';
  return 'intermediate';
}

/** 显式自报解析（多语言）。顺序即优先级：beginner → intermediate → advanced。 */
export function detectExplicitProficiency(text) {
  if (!text || !String(text).trim()) return null;
  const s = String(text).toLowerCase();
  if (
    /(零基础|0基础|小白|新手|初学|刚开始|完全不会|没有基础|没基础|最简单|从零开始|beginner|novice|newbie|from scratch|no background|just started)/i.test(
      s,
    )
  ) {
    return 'beginner';
  }
  if (
    /(中级|有基础|有一点基础|学过一点|会一点|了解基础|intermediate|some experience|basic familiarity)/i.test(
      s,
    )
  ) {
    return 'intermediate';
  }
  if (
    /(高级|进阶学习者|资深|专家|熟练掌握|很熟|advanced learner|expert|senior|experienced|proficient)/i.test(
      s,
    )
  ) {
    return 'advanced';
  }
  return null;
}

const BEGINNER_CUES = /(入门|基础|初识|认识|简单|试一试|hello world|入门级|零基础|新手|basics?|introductory|getting started)/gi;
const ADVANCED_CUES = /(进阶|高级|深入|原理|源码|优化|架构|并发|分布式|advanced|internals|optimization|architecture|concurrency)/gi;

/** 大纲关键词扫描：返回 {direction, weight, hits}；无命中返回 null。 */
export function scanKeywords(text) {
  const source = String(text ?? '');
  if (!source.trim()) return null;
  const beginnerHits = source.match(BEGINNER_CUES) ?? [];
  const advancedHits = source.match(ADVANCED_CUES) ?? [];
  const total = beginnerHits.length + advancedHits.length;
  if (total === 0) return null;
  const direction = (advancedHits.length - beginnerHits.length) / total;
  return {
    direction: clamp(direction, -1, 1),
    weight: Math.min(0.15 + 0.1 * total, WEIGHT_CAPS.outline_keyword),
    hits: [...new Set([...beginnerHits, ...advancedHits])].slice(0, 8),
  };
}

export function detectOutlineKeywords(outline) {
  const parts = [
    outline?.description,
    outline?.teachingObjective ?? '',
    (outline?.keyPoints ?? []).join(' '),
    outline?.pblConfig?.projectTopic ?? '',
    outline?.pblConfig?.projectDescription ?? '',
    (outline?.pblConfig?.targetSkills ?? []).join(' '),
  ];
  const text = parts.filter(Boolean).join(' ').trim();
  if (!text) return null;
  const scanned = scanKeywords(text);
  if (!scanned || scanned.weight === 0) return null;
  return {
    kind: 'outline_keyword',
    direction: scanned.direction,
    weight: scanned.weight,
    note: `Outline keywords: ${scanned.hits.join(', ')}`,
    ts: nowIso(),
  };
}

/** bio 里的经验年数 / 程度词。只保留能明确落档的两类，避免噪声。 */
export function analyzeBio(bio) {
  if (!bio || !String(bio).trim()) return null;
  const text = String(bio).trim();
  let direction = 0;
  let weight = 0;
  const hits = [];
  const yearMatch = text.match(/(\d+)\s*(?:年|years?)/i);
  if (yearMatch) {
    const years = Number(yearMatch[1]);
    if (Number.isFinite(years) && years > 0) {
      hits.push(`${years}y`);
      if (years >= 8) {
        direction += 0.8;
        weight += 0.3;
      } else if (years >= 3) {
        direction += 0.4;
        weight += 0.2;
      } else {
        direction -= 0.2;
        weight += 0.15;
      }
    }
  }
  if (/(多年|资深|专家|expert|senior|多年经验|十年)/i.test(text)) {
    direction += 0.6;
    weight += 0.25;
    hits.push('senior');
  }
  if (/(刚学|初学|新人|转行|beginner|new to|just started)/i.test(text)) {
    direction -= 0.5;
    weight += 0.25;
    hits.push('newcomer');
  }
  if (weight === 0) return null;
  return {
    kind: 'user_bio',
    direction: clamp(direction, -1, 1),
    weight: Math.min(weight, WEIGHT_CAPS.user_bio),
    note: `Bio cues: ${hits.join(', ')}`,
    ts: nowIso(),
  };
}

/** 既往 PPT / quiz 情景的难度线索：取前置场景描述里的关键词密度。 */
export function analyzePriorScenes(allOutlines, currentOutlineId) {
  const outlines = Array.isArray(allOutlines) ? allOutlines : [];
  const priorScenes = outlines.filter((o) => o?.id !== currentOutlineId && o?.type !== 'pbl');
  const me = outlines.find((o) => o?.id === currentOutlineId);
  const before = me && typeof me.order === 'number'
    ? priorScenes.filter((o) => typeof o.order === 'number' && o.order < me.order)
    : priorScenes;
  if (before.length === 0) return null;
  const text = before
    .map((o) => [o.title, o.description, (o.keyPoints ?? []).join(' ')].filter(Boolean).join(' '))
    .join(' ');
  const scanned = scanKeywords(text);
  if (!scanned) return null;
  return {
    kind: 'prior_scene_difficulty',
    direction: scanned.direction,
    weight: Math.min(0.2 + 0.05 * before.length, WEIGHT_CAPS.prior_scene_difficulty),
    note: `Prior ${before.length} scene(s) cues: ${scanned.hits.slice(0, 6).join(', ')}`,
    ts: nowIso(),
  };
}

export function explicitAssessment(tier, source = 'planner') {
  const direction = tier === 'advanced' ? 1 : tier === 'intermediate' ? 0 : -1;
  const signal = {
    kind: 'user_level_explicit',
    direction,
    weight: WEIGHT_CAPS.user_level_explicit,
    note: `explicit learner level: ${tier}`,
    ts: nowIso(),
  };
  return {
    tier,
    score: direction,
    confidence: 1,
    source,
    signals: [signal],
    lastUpdatedAt: signal.ts,
    transitions: [],
    dynamicSignalsSinceRetier: 0,
    turnsSinceRetier: 0,
  };
}

/** 无证据时的默认评估：intermediate + 低置信度。 */
export function emptyAssessment() {
  return {
    tier: DEFAULT_TIER,
    score: 0,
    confidence: 0,
    source: 'planner',
    signals: [],
    lastUpdatedAt: null,
    transitions: [],
    dynamicSignalsSinceRetier: 0,
    turnsSinceRetier: 0,
  };
}

/** 静态批量聚合：加权均值 × 收缩因子（K=0.7，与上游同表）。 */
export function aggregateSignals(signals, source = 'planner') {
  if (!signals || signals.length === 0) return { ...emptyAssessment(), source };
  const SHRINK_K = 0.7;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of signals) {
    weightedSum += s.direction * s.weight;
    weightTotal += s.weight;
  }
  const rawDirection = weightTotal === 0 ? 0 : weightedSum / weightTotal;
  const shrink = weightTotal / (weightTotal + SHRINK_K);
  const score = clamp(rawDirection * shrink, -1, 1);
  return {
    tier: scoreToTier(score, DEFAULT_TIER),
    score,
    confidence: clamp(shrink, 0, 1),
    source,
    signals: signals.slice(-20),
    lastUpdatedAt: signals[signals.length - 1]?.ts ?? nowIso(),
    transitions: [],
    dynamicSignalsSinceRetier: 0,
    turnsSinceRetier: 0,
  };
}

/**
 * Planner 时初评：与上游 `computeInitialAssessment` 的静态信号段一致。
 *
 * @param {{outline?:object, priorScenes?:object[], userBio?:string, userRequirement?:string}} input
 */
export function computeInitialAssessment(input = {}) {
  const explicit = detectExplicitProficiency(
    [input.userRequirement, input.userBio].filter(Boolean).join('\n'),
  );
  if (explicit) return explicitAssessment(explicit, input.source ?? 'planner');

  const signals = [];
  const outlineSignal = detectOutlineKeywords(input.outline);
  if (outlineSignal) signals.push(outlineSignal);
  const priorSceneSignal = analyzePriorScenes(input.priorScenes, input.outline?.id);
  if (priorSceneSignal) signals.push(priorSceneSignal);
  const bioSignal = analyzeBio(input.userBio);
  if (bioSignal) signals.push(bioSignal);
  return aggregateSignals(signals, input.source ?? 'planner');
}

/**
 * Planner 覆盖档位时，把 assessment 重新落到目标档（score/counters 同步）。
 * 上游见 `reseatAssessmentTier`；这里只保留 Planner 需要的部分。
 */
export function reseatAssessmentTier(assessment, tier) {
  const direction = tier === 'advanced' ? 1 : tier === 'intermediate' ? 0 : -1;
  return {
    ...assessment,
    tier,
    score: direction,
    signals: assessment?.signals ?? [],
  };
}
