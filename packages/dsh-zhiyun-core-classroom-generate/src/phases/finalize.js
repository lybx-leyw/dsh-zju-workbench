// 源：ref/OpenMAIC/lib/server/generation/run/document.ts:53-84（createRunCourse：stage + scenes + outline 一起写）
// 源：ref/OpenMAIC/lib/server/generation/run/document.ts:154-187（completeRunCourse：generationComplete 一次置位）
// 源：ref/OpenMAIC/lib/persistence/stage-meta.ts:8-45（stage_meta 的字段口径）
// 源：ref/OpenMAIC/lib/document-store/persistence-types.ts:1-40（AppDocumentOutline）
// 源：ref/OpenMAIC/app/api/stages/route.ts:100-147（stage 文档的最小形状）

/**
 * 第 4 段：拼课堂文档并落盘。
 *
 * 输入：`{ outlines, scenes, mediaResults, brief, stageId, runId, vault }`；
 * 输出：`{ stageId, sceneCount, doc }`。
 *
 * # 与上游的差别
 *
 * 上游「第一页就绪时建文档，之后每页 append，最后置 `generationComplete`」
 * （document.ts 头注）。本包在 `finalize` **一次整份写入**：因为我们的断点单位
 * 是段（四段），逐页 append 会让「取消了但课堂里躺着三页」成为常态；
 * 而 vault 的 `classroom.save` 本身是「先写场景、再写 outline、最后写 meta」的
 * 顺序写，读者看到的永远是完整的旧文档或完整的新文档。
 *
 * 媒体资产在 `media` 段已经进了资产池（`vault.assets`），这里只把 assetId
 * 填回元素/口播动作 —— 上游 `placeHeldMedia` 的同一件事（media.ts:1107-1140）。
 */

export async function produceFinalize({ outlines, scenes, mediaResults, brief, stageId, runId, vault, emit, phase = 'finalize', skipped, now = () => Date.now() }) {
  const timestamp = now();
  const withMedia = applyMedia(scenes, mediaResults ?? []);

  // ── 残课不得标记为完成 ──
  //
  // 上游的做法：所有场景都跑完后，如果其中有失败的，run 停在该场景并置 `paused`
  // （`run/engine.ts:1788-1796`）—— 用户可以 Retry 那一页，而不是拿到一份残课。
  //
  // 本仓 scenes 段单页失败只记 `skipped` 继续（这是合理的并行取舍），但原先
  // `finalize` **无条件**写 `generationComplete: true`：9 页里失败 5 页，课堂照样
  // 被标成"生成完成"，用户以为课备好了。这里把完成标志条件化：
  // 只有「没有任何场景被跳过」才算真正完成；否则如实标 incomplete，
  // 并把缺失名单带出去，让调用方提示与重试。
  const skippedList = Array.isArray(skipped) ? skipped : [];
  const complete = skippedList.length === 0;

  emit(phase, 'phase-progress', {
    step: 'save',
    stageId,
    scenes: withMedia.length,
    skipped: skippedList.length,
    complete,
  });

  const doc = {
    id: stageId,
    stage: {
      id: stageId,
      name: brief.topic,
      description: brief.description ?? '',
      folderId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    scenes: withMedia,
    outline: {
      outlines,
      requirement: brief.requirement,
      languageDirective: brief.languageDirective ?? '',
      // ⚠️ 条件化：有场景缺失时不得声称完成（上游在首个失败场景 pause 而非报完成）。
      generationComplete: complete,
      // 上游用 `producer: 'server-job'` 标记「这份文档由后台任务产出，浏览器不要再往里写」。
      producer: 'server-job',
      producerRef: runId,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    stageMeta: {
      runId,
      courseId: brief.courseId ?? null,
      sceneCount: withMedia.length,
      generatedAt: timestamp,
      // 缺页清单：宿主据此提示「还有 N 页没生成」并提供重试入口。
      ...(complete
        ? {}
        : {
          incompleteScenes: skippedList.map((item) => ({
            index: item.index,
            title: item.title ?? '',
            reason: item.reason ?? '',
          })),
        }),
    },
  };

  const saved = await vault.classroom.save(stageId, doc);

  return {
    stageId,
    sceneCount: withMedia.length,
    doc,
    saved,
  };
}

/**
 * 把媒体结果填回场景：图片/视频按 `elementId` 命中元素，配音按 action id 命中口播。
 * 命不中就只挂到场景级的 `media` 表上（渲染侧仍能按 elementId 找到它）。
 */
export function applyMedia(scenes, results) {
  if (!Array.isArray(results) || results.length === 0) return scenes;

  const byElement = new Map();
  for (const result of results) byElement.set(result.elementId, result);

  return scenes.map((scene) => {
    const matched = results.filter((result) => result.sceneId === scene.id);
    if (matched.length === 0) return scene;

    const media = {};
    for (const result of matched) media[result.elementId] = result.assetId;

    const content = scene.content ?? {};
    let nextContent = content;

    if (content.type === 'slide' && Array.isArray(content.elements)) {
      nextContent = {
        ...content,
        elements: content.elements.map((element) => {
          const hit = byElement.get(element.id);
          return hit ? { ...element, assetId: hit.assetId, src: element.src ?? hit.assetId } : element;
        }),
      };
    }

    const actions = (scene.actions ?? []).map((action) => {
      if (action.type !== 'speech') return action;
      // `collectMediaItems` 给口播项的 elementId 就是 `${scene.id}-speech-1`（= action.id）。
      const hit = byElement.get(action.id);
      return hit ? { ...action, audioId: hit.assetId } : action;
    });

    return { ...scene, content: nextContent, actions, media };
  });
}
