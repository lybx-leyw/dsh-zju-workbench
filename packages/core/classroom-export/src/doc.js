/**
 * 输入归一：`classroom` 参数 → { stage, scenes, assets } 与画布比例。
 *
 * 源：ref/OpenMAIC/lib/export/use-export-pptx.ts:1418-1425（viewport → 两组比例）
 *     ref/OpenMAIC/lib/export/use-export-pptx.ts:557-560（版式判定）
 *     ref/OpenMAIC/lib/export/standalone-html/build-standalone-html.ts:633-650
 *
 * 方法签名按规范 §4 是 `export.pptx(id)` —— 宿主侧拿 id，业务侧拿文档。本包两种都
 * 接受：字符串或 `{ id }` 走 `ctx.zhiyunClassroomStudio.classroom.load(id)`；已经是
 * `{ stage, scenes }` 的文档直接用（页面包手上常常就有，省一次往返）。
 */

/** 源：use-export-pptx.ts:1421-1422 */
export function ratiosFor(viewportSize = 1000, viewportRatio = 0.5625) {
  return {
    viewportSize,
    viewportRatio,
    ratioPx2Inch: 96 * (viewportSize / 960),
    ratioPx2Pt: (96 / 72) * (viewportSize / 960),
  };
}

/** 第一张幻灯片的画布尺寸就是整份课件的尺寸（源：useCanvasStore 的全局 viewport）。 */
export function viewportOf(scenes) {
  const slide = (scenes ?? []).find((scene) => scene.content?.type === 'slide');
  const canvas = slide?.content?.canvas;
  return {
    viewportSize: canvas?.viewportSize ?? 1000,
    viewportRatio: canvas?.viewportRatio ?? 0.5625,
  };
}

/**
 * @param {{ classroom?: {load(id:string): any} }} studio
 * @param {object|string} input
 * @returns {Promise<{stage: object, scenes: object[], assets: any, id?: string, source: string}>}
 */
export async function resolveClassroom(studio, input) {
  if (typeof input === 'string') {
    return { ...(await loadById(studio, input)), source: 'studio' };
  }
  if (!input || typeof input !== 'object') {
    throw Object.assign(new Error('课堂导出需要一个课堂文档（或课堂 id）'), { code: 'E_INPUT' });
  }
  if (Array.isArray(input.scenes)) {
    return {
      stage: input.stage ?? {},
      scenes: input.scenes,
      assets: input.assets,
      id: input.stage?.id ?? input.id,
      source: 'document',
    };
  }
  if (input.id) {
    return { ...(await loadById(studio, input.id)), source: 'studio' };
  }
  throw Object.assign(new Error('课堂文档缺少 scenes；传 id 才能从宿主加载'), { code: 'E_INPUT' });
}

async function loadById(studio, id) {
  const loader = studio?.classroom?.load;
  if (typeof loader !== 'function') {
    throw Object.assign(new Error('zhiyunClassroomStudio.classroom.load 不可用'), {
      code: 'E_NO_STUDIO',
    });
  }
  const document = await loader.call(studio.classroom, id);
  if (!document || !Array.isArray(document.scenes)) {
    throw Object.assign(new Error(`课堂 ${id} 没有可导出的场景`), { code: 'E_NOT_FOUND' });
  }
  return {
    stage: document.stage ?? document.meta ?? { id },
    scenes: document.scenes,
    assets: document.assets,
    id,
  };
}

/** 从课堂文档里取"第一张幻灯片之前的顺序"用的场景列表（源：scenes 已按 order 存）。 */
export function slidesOf(scenes) {
  return (scenes ?? []).filter((scene) => scene.content?.type === 'slide');
}
