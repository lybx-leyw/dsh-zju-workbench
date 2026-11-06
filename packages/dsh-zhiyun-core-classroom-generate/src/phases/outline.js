// 源：ref/OpenMAIC/lib/server/generation/run/engine.ts:380-500（outline step：调用 → 解析 → 兜底）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/outline-generator.ts:119-186（generateSceneOutlinesFromRequirements）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/outline-generator.ts:208-236（applyOutlineFallbacks 的降级口径）
// 源：ref/OpenMAIC/lib/agent/client/resolve-scene-outline.ts:1-37（大纲项的通用形状）

import { ClassroomGenerateError, describeError } from '../errors.js';
import { applyOutlineFallbacks, parseOutlineResponse } from '../scene.js';
import { buildOutlinePrompt } from '../prompts.js';

/**
 * 第 1 段：brief → 场景大纲。
 *
 * 输入：`{ brief, llm, agent }`；输出：`{ outlines, languageDirective, courseTitle, source }`。
 *
 * # 两条来源，顺序与上游一致
 *
 * 1. **模型大纲**（上游 `generateSceneOutlinesFromRequirements`）：一次调用，JSON 解析；
 * 2. **确定性兜底**：模型调不通 / 回的不是大纲 JSON 时，改用
 *    `ctx.zhiyunClassroomAgent.plan(brief)` 的场景序列（那位同事的 `planScenes`
 *    本来就是「brief → 场景序列」的确定性落法）。
 *
 * 兜底不是「编数据」：上游浏览器端在 outline 流失败时同样退回到
 * 「按用户 requirement 推出的最小大纲」（`applyOutlineFallbacks` + preview 的
 * 骨架场景），而且**模型失败的原因会写进 `phase-progress`**，页面能看见。
 */
/**
 * 工程护栏（对齐上游 `steps/outline.ts`）。
 *
 * 这三个数字都不是随手定的，它们各自防一类真实事故：
 *
 * - `MAX_OUTLINE_SCENES = 100`（上游 `outline-schema.ts:20`）：
 *   模型陷入循环时会一直吐场景，没有上限就无限生成、无限计费。
 * - `MAX_OUTLINE_STREAM_BYTES = 512 KiB`（上游 `steps/outline.ts:61`）：
 *   正常大纲 JSON 只有几十 KB；超过这个量级基本可以断定是跑飞了，
 *   继续读只会把堆撑爆。
 * - `MAX_OUTLINE_RETRIES = 2`（上游 `steps/outline.ts:57`）：
 *   同模型重试 2 次后换回退模型再试 1 次。本仓没有 fallback 模型概念，
 *   但"同模型重试 2 次"这一半必须保留 —— 否则一次瞬时 429 就等于整堂课报废。
 */
export const MAX_OUTLINE_SCENES = 100;
export const MAX_OUTLINE_STREAM_BYTES = 512 * 1024;
export const MAX_OUTLINE_RETRIES = 2;

/** 取回退用的原始长度上限（防止把超大响应读进内存）。 */
function clampOutlineOutput(raw) {
  if (typeof raw !== 'string') return raw;
  if (Buffer.byteLength(raw, 'utf8') <= MAX_OUTLINE_STREAM_BYTES) return raw;
  // 截断到字节上限（按字符切，避免切坏多字节字符）。
  let out = raw;
  while (Buffer.byteLength(out, 'utf8') > MAX_OUTLINE_STREAM_BYTES) {
    out = out.slice(0, Math.floor(out.length * 0.9));
  }
  return out;
}

export async function produceOutline({
  brief, llm, agent, materialText = '', emit, phase = 'outline', signal, options,
}) {
  const { system, prompt } = buildOutlinePrompt(brief, { materialText });

  let failure = null;
  let parsed = null;

  for (let attempt = 0; attempt <= MAX_OUTLINE_RETRIES && !parsed; attempt += 1) {
    if (signal?.aborted) throw new Error('aborted');
    if (attempt > 0) {
      emit(phase, 'phase-progress', {
        step: 'llm',
        status: 'retry',
        attempt,
        maxAttempts: MAX_OUTLINE_RETRIES + 1,
        previousError: failure?.message,
      });
    }
    try {
      const raw = await llm.call({
        stage: 'outline',
        system,
        prompt,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        signal,
      });
      parsed = parseOutlineResponse(clampOutlineOutput(raw), {
        languageDirective: brief.languageDirective,
        maxScenes: MAX_OUTLINE_SCENES,
      });
      if (!parsed) failure = { code: 'E_BAD_OUTPUT', message: '模型没有回可解析的大纲 JSON' };
    } catch (error) {
      if (signal?.aborted) throw error;
      failure = describeError(error, 'E_UPSTREAM_ERROR');
      // 配额耗尽等"重试没用"的失败不再空转。
      if (failure.code === 'E_QUOTA' || failure.code === 'E_AUTH') break;
    }
  }

  if (parsed) {
    // 缺配置的 interactive / pbl 在这里就降级成 slide（上游 applyOutlineFallbacks）。
    // 不降级的话，它会一路跑到 scenes 阶段才因为"产出对不上类型"而失败，
    // 表现出来是"某一页莫名消失"，而根因其实在大纲。
    // pbl 是否可用由 pbl 服务是否存在决定（scenes 段会走 ctx.zhiyunClassroomPbl）。
    const { outlines, fallbacks } = applyOutlineFallbacks(parsed.outlines, {
      hasPblService: options?.hasPblService !== false,
    });
    if (fallbacks.length > 0) {
      emit(phase, 'phase-progress', { step: 'fallback-outline', status: 'degraded', fallbacks });
    }
    emit(phase, 'phase-progress', {
      step: 'llm',
      status: 'ok',
      providerId: llm.providerId,
      model: llm.model,
      outlines: outlines.length,
    });
    return {
      outlines,
      languageDirective: parsed.languageDirective || brief.languageDirective || '',
      courseTitle: parsed.courseTitle,
      source: 'llm',
      outlineFallbacks: fallbacks,
    };
  }

  emit(phase, 'phase-progress', {
    step: 'llm',
    status: 'failed',
    providerId: llm.providerId,
    model: llm.model,
    code: failure.code,
    message: failure.message,
  });

  if (brief.strictChapter) throw new ClassroomGenerateError('E_CHAPTER_FAILED', `章节大纲生成失败：${failure.message}`, { phase, cause: failure });
  const fallback = await outlineFromAgent({ brief, agent });
  emit(phase, 'phase-progress', {
    step: 'fallback',
    status: 'ok',
    source: fallback.source,
    outlines: fallback.outlines.length,
  });
  return fallback;
}

/**
 * 确定性兜底：优先 `agent.plan(brief)`（场景类型/数量由它决定），
 * agent 也不可用时用 brief 自身推出的最小大纲（导入 + 每目标一页 + 检测/项目）。
 */
async function outlineFromAgent({ brief, agent }) {
  if (agent && typeof agent.plan === 'function') {
    const plan = await agent.plan(brief);
    const scenes = Array.isArray(plan?.scenes) ? plan.scenes : [];
    if (scenes.length > 0) {
      return {
        outlines: scenes.map((scene, index) => ({
          id: typeof scene.id === 'string' && scene.id ? scene.id : `outline-${index + 1}`,
          type: scene.type,
          title: scene.title,
          description: scene.description ?? '',
          keyPoints: Array.isArray(scene.keyPoints) ? scene.keyPoints : [],
          order: index + 1,
        })),
        languageDirective: brief.languageDirective ?? '',
        courseTitle: brief.topic,
        source: 'agent-plan',
      };
    }
  }
  return {
    outlines: minimalOutlines(brief),
    languageDirective: brief.languageDirective ?? '',
    courseTitle: brief.topic,
    source: 'brief',
  };
}

/** 最后一道兜底（与 core-classroom-agent 的 `planScenes` 同序：导入 → 目标 → 互动 → 检测 → 项目）。 */
function minimalOutlines(brief) {
  const outlines = [];
  const push = (type, title, description, keyPoints) => {
    outlines.push({
      id: `outline-${outlines.length + 1}`,
      type,
      title,
      description,
      keyPoints,
      order: outlines.length + 1,
    });
  };

  push('slide', `导入：${brief.topic}`, brief.description, brief.goals.slice(0, 5));
  brief.goals.forEach((goal, index) => push('slide', `${index + 1}. ${goal}`, goal, [goal]));
  if (brief.interactive) push('interactive', `互动：${brief.topic}`, brief.description, brief.goals.slice(0, 3));
  if (brief.assess) push('quiz', `随堂检测：${brief.topic}`, '', brief.goals.slice(0, 5));
  if (brief.project) push('pbl', `项目：${brief.topic}`, brief.projectBrief, brief.goals.slice(0, 5));
  return outlines;
}
