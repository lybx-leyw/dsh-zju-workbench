// 源：ref/OpenMAIC/lib/server/generation/run/engine.ts:501-760（逐场景 content → actions → narration）
// 源：ref/OpenMAIC/lib/server/generation/run/plan.ts:59-66（generationSteps：按大纲顺序逐场景）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/scene-generator.ts:232-320（generateSceneContent 的入参）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/scene-builder.ts:22-115（content → CompleteScene）
// 源：ref/OpenMAIC/lib/pbl/v2/agents/planner.ts:95-196（pbl 场景的项目内容由 Planner 产出）

import { ClassroomGenerateError, describeError } from '../errors.js';
import { tryParseJsonObject } from '../json.js';
import { buildScene, parseSceneResponse } from '../scene.js';
import { buildScenePrompt } from '../prompts.js';

/**
 * 第 2 段：大纲 → 逐场景内容（含口播）。
 *
 * 输入：`{ outlines, brief, llm, pbl, stageId }`；
 * 输出：`{ scenes, skipped }`（`skipped` 是失败但仍被记入的场景，带原因）。
 *
 * # 与上游的差别（本段是最大的那处）
 *
 * 上游把每个场景切成三个 step：`content` → `actions` → `narration`，三段落盘三次，
 * 并且 `narration` 那一步才把场景**追加进课堂文档**。本包按任务书把三段合成
 * 一次调用（`content` + 口播 `speech` 一起出），四个 phase 各自的 snapshot 是
 * 断点单位；课堂文档在 `finalize` 一次性成型。差别写进报告，不藏。
 *
 * # 场景 id 为什么由 order 派生
 *
 * 上游用 `nanoid()`（scene-builder.ts:33）。续跑要对同一个课堂 upsert，
 * 随机 id 会把同一页写成第二份；`scene-<order>` 是幂等的，代价是同一课堂
 * 不能同时跑两个生成（由 service 的 run 记录保证 —— 同一个 stageId 只允许一个活跃 run）。
 */
export async function produceScenes({ outlines, brief, llm, pbl, stageId, emit, phase = 'scenes', signal, now }) {
  const total = outlines.length;
  const scenes = [];
  const skipped = [];
  let previousSpeeches = [];

  for (let index = 0; index < outlines.length; index += 1) {
    if (signal?.aborted) throw new ClassroomGenerateError('E_CANCELLED', '生成已取消', { phase });

    const outline = outlines[index];
    const sceneId = sceneIdOf(outline, index);
    emit(phase, 'phase-progress', { index, total, step: 'content', sceneId, sceneType: outline.type });

    const produced = await produceScene({ outline, brief, llm, pbl, stageId, index, total, previousSpeeches, signal, now });
    if (!produced) {
      // 与上游并行模式的取舍一致：单场景内容失败**不终止整条管线**，
      // 记进 skipped 并继续 —— 页面拿到的是「这一页缺了」，不是「整堂课没了」。
      skipped.push({ index, outlineId: outline.id, reason: 'scene-content-unavailable' });
      emit(phase, 'phase-progress', { index, total, step: 'content', status: 'skipped', sceneId, sceneType: outline.type });
      continue;
    }

    scenes.push(produced.scene);
    previousSpeeches = produced.scene.actions
      .filter((action) => action.type === 'speech')
      .map((action) => action.text);

    emit(phase, 'scene-ready', {
      index,
      sceneId: produced.scene.id,
      outlineId: outline.id,
      type: produced.scene.type,
      order: produced.scene.order,
      title: produced.scene.title,
      source: produced.source,
    }, produced.scene.id);
  }

  return { scenes, skipped };
}

/** pbl 场景走 `zhiyunClassroomPbl`，其余走模型。 */
async function produceScene({ outline, brief, llm, pbl, stageId, index, total, previousSpeeches, signal, now }) {
  const sceneId = sceneIdOf(outline, index);

  if (outline.type === 'pbl') {
    const projectV2 = await buildPblProject({ outline, brief, pbl });
    const speech = await pblSpeech({ outline, brief, llm, signal });
    const scene = buildScene({
      outline,
      content: { type: 'pbl', projectV2 },
      speech,
      stageId,
      sceneId,
      now,
    });
    return scene ? { scene, source: 'pbl' } : null;
  }

  const { system, prompt } = buildScenePrompt(outline, {
    index,
    total,
    courseTitle: brief.topic,
    allTitles: undefined,
    previousSpeeches,
    languageDirective: brief.languageDirective,
  });

  let raw;
  try {
    raw = await llm.call({
      stage: 'scene',
      sceneType: outline.type,
      sceneId,
      system,
      prompt,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ClassroomGenerateError(
      'E_UPSTREAM_ERROR',
      `场景「${outline.title}」生成失败：${describeError(error).message}`,
      { phase: 'scenes', index, sceneId, cause: describeError(error).message },
    );
  }

  const parsed = parseSceneResponse(raw, outline, { sceneIndex: index, stageId });
  if (!parsed) return null;

  const scene = buildScene({
    outline,
    content: parsed.content,
    speech: parsed.speech,
    stageId,
    sceneId,
    now,
  });
  return scene ? { scene, source: 'llm' } : null;
}

/**
 * 场景 id：`scene-<order>`。order 从 1 起（上游 `outline.order = index + 1`）。
 * 没有 order 的显式大纲用下标兜底。
 */
function sceneIdOf(outline, index) {
  const order = Number(outline.order);
  const ordinal = Number.isFinite(order) && order > 0 ? order : index + 1;
  return `scene-${ordinal}`;
}

/**
 * PBL 项目内容：先 `pbl.plan`（走模型的多阶段 Planner），失败退回
 * `pbl.buildPlan(..., { strict: false })`（零模型的确定性装配）。
 *
 * 两条都失败只留一个空壳 `{}`：pbl 场景没有项目内容仍然能渲染成「项目占位」，
 * 比让整段 scenes 失败更接近上游（上游对 pbl 生成失败是 `PBLGenerationError` →
 * 该场景回退 slide，代价是整页内容丢失；这里保住页面，内容交给页面侧补）。
 */
async function buildPblProject({ outline, brief, pbl }) {
  const spec = {
    projectTopic: outline.title,
    projectDescription: outline.description || brief.projectBrief || brief.description || outline.title,
    targetSkills: outline.keyPoints ?? [],
    issueCount: 4,
  };

  if (pbl && typeof pbl.plan === 'function') {
    try {
      return await pbl.plan(spec);
    } catch {
      // 落到确定性装配
    }
  }
  if (pbl && typeof pbl.buildPlan === 'function') {
    try {
      return pbl.buildPlan({}, { strict: false });
    } catch {
      // 落到空壳
    }
  }
  return { scenario: null, milestones: [] };
}

/** pbl 的口播：一次小调用；失败就是没有口播（不阻塞场景）。 */
async function pblSpeech({ outline, brief, llm, signal }) {
  const { system, prompt } = buildScenePrompt(outline, { index: 0, total: 1, courseTitle: brief.topic });
  try {
    const raw = await llm.call({
      stage: 'scene',
      sceneType: 'pbl',
      system,
      prompt,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      signal,
    });
    const parsed = tryParseJsonObject(raw);
    return typeof parsed?.speech === 'string' ? parsed.speech.trim() : '';
  } catch {
    return '';
  }
}
