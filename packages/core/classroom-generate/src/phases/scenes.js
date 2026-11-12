// 源：ref/OpenMAIC/lib/server/generation/run/engine.ts:501-760（逐场景 content → actions → narration）
// 源：ref/OpenMAIC/lib/server/generation/run/plan.ts:59-66（generationSteps：按大纲顺序逐场景）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/scene-generator.ts:232-320（generateSceneContent 的入参）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/scene-builder.ts:22-115（content → CompleteScene）
// 源：ref/OpenMAIC/lib/pbl/v2/agents/planner.ts:95-196（pbl 场景的项目内容由 Planner 产出）

import { ClassroomGenerateError, describeError } from '../errors.js';
import { tryParseJsonObject } from '../json.js';
import { parseSceneActions } from '../actions.js';
import { buildScene, parseSceneResponse } from '../scene.js';
import { buildActionsPrompt, buildScenePrompt } from '../prompts.js';

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

    // 单场景失败不终止整条管线（与上游并行模式的取舍一致），但**必须留下原因**。
    //
    // 原实现把异常整个吞成了 `reason: 'scene-content-unavailable'`，于是
    // 「9 个场景全跳过」这种全线失败在调用方看来只是一句「产出为空」，
    // 真实原因（模型没配？JSON 解析不出？某页超长？）一个字都没有 ——
    // 排查时只能靠猜。这里把 message 与 code 记进 skipped。
    let produced = null;
    let skipReason = null;
    try {
      produced = await produceScene({ outline, brief, llm, pbl, stageId, index, total, previousSpeeches, signal, now });
    } catch (error) {
      if (signal?.aborted) throw error;
      const described = describeError(error);
      skipReason = {
        index,
        outlineId: outline.id,
        title: outline.title,
        reason: described.code ?? 'scene-content-unavailable',
        message: described.message ?? String(error),
      };
    }

    if (!produced) {
      skipped.push(skipReason ?? { index, outlineId: outline.id, reason: 'scene-content-unavailable' });
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

/** pbl 场景走 `zwClassroomPbl`，其余走模型。 */
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
    sourceText: brief.sourceText,
    knowledgeTree: brief.knowledgeTree,
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
  if (!parsed) {
    // 解析失败**不是异常**，所以之前悄悄返回 null，上层只能看到「跳过」。
    // 这里是全线失败时最重要的信息：模型到底回了什么。
    // 抛出去让 produceScenes 记进 skipped（带 message），不要静默。
    throw new ClassroomGenerateError(
      'E_UPSTREAM_ERROR',
      `场景「${outline.title}」的内容无法解析（模型返回 ${String(raw ?? '').length} 字符）`,
      {
        phase: 'scenes', index, sceneId, sceneType: outline.type,
        // 只留开头，避免把整段模型输出塞进错误体
        rawHead: String(raw ?? '').slice(0, 400),
      },
    );
  }

  // ── 第二次调用：actions 段（上游的 content → actions 两步）──
  //
  // 为什么必须分开：上游把「画面上有什么」与「怎么讲」切成两次调用。
  // 合在一起时，模型在同一口气里既要设计版面、又要组织讲解，结果是
  //   - 只有一条 speech（没有聚焦、没有节拍）
  //   - quiz 场景里容易在发卷前泄题（它刚写完 answer/analysis）
  // 拆开后，actions 段能**看到 content 的元素清单**，才能产出合法的 elementId。
  const actions = await produceActions({
    outline, content: parsed.content, sceneId, index, total, brief, previousSpeeches, llm, signal,
  });

  const scene = buildScene({
    outline,
    content: parsed.content,
    speech: parsed.speech,
    actions,
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
 * actions 段：给已生成的 content 编排教学动作。
 *
 * 对应上游 `generateSceneActions`（`scene-generator.ts`）这一步。
 *
 * # 失败策略：降级而不是整页报废
 *
 * 上游在 actions 模板不可用时会用 `generateDefaultSlideActions` 之类的**确定性默认动作**
 * 兜底，而不是让整页失败 —— 因为页面内容已经生成好了，不能因为"怎么讲"没安排好就全丢。
 * 这里照办：actions 调用或解析失败 → 退化成"一条 speech = content 阶段给的 speech"。
 *
 * @returns {Promise<object[]>} 动作列表（永不为 null；最差是空数组）
 */
async function produceActions({ outline, content, sceneId, index, total, brief, previousSpeeches, llm, signal }) {
  const elementIds = Array.isArray(content?.canvas?.elements)
    ? content.canvas.elements.map((element) => element.id)
    : [];

  const { system, prompt } = buildActionsPrompt(outline, content, {
    index,
    total,
    languageDirective: brief.languageDirective,
    courseContext: previousSpeeches?.length
      ? `上一页讲的是：${previousSpeeches.join(' ').slice(-150)}`
      : undefined,
  });

  let raw;
  try {
    raw = await llm.call({
      stage: 'scene-actions',
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
    // 旁白编排失败不该毁掉整页：返回空数组，调用方会退回单条 speech。
    return [];
  }

  const parsed = parseSceneActions(raw, { sceneId, sceneType: outline.type, elementIds });
  if (!parsed) return [];
  return parsed.actions;
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
  const { system, prompt } = buildScenePrompt(outline, { index: 0, total: 1, courseTitle: brief.topic, sourceText: brief.sourceText, knowledgeTree: brief.knowledgeTree });
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
