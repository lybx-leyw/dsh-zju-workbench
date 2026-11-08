// 源：ref/OpenMAIC/lib/agent/client/resolve-scene-outline.ts:1-37
/**
 * 场景大纲：`order/sceneId/type/title/description/keyPoints` 这一套是上游课程
 * 大纲的通用形状（director prompt、read_scene、生成管线都按它读）。
 *
 * 源：ref/OpenMAIC/lib/agent/client/resolve-scene-outline.ts:1-37（逐字搬运）
 * 源：ref/OpenMAIC/lib/chat/pi/prompts.ts:16-50（大纲文本化的字段顺序与截断）
 *
 * `planScenes` 是本移植的 `plan()` 契约胶水（上游没有这个函数 —— 上游的场景序列
 * 由 `@openmaic/generation` 产出，那不属于本包的搬运范围）。它只做「brief → 大纲
 * 序列」这一件事，字段与上面两个源文件保持同形，保证 `buildDirectorCourseOutline`
 * 拿到的东西和上游一致。
 */

import { ClassroomAgentError } from './errors.js';

/** 规范 §1 判据里的四类场景。 */
export const SCENE_TYPES = Object.freeze(['slide', 'quiz', 'interactive', 'pbl']);

/**
 * Resolve a scene's generation outline by stable identity (`outlineId`) rather
 * than by the mutable `order`.
 *
 * @param {{id: string, type: string, title: string, order: number, outlineId?: string}} scene
 * @param {Array<{id: string, type: string, title: string, description?: string, keyPoints?: string[], order: number}>} outlines
 */
export function resolveSceneOutline(scene, outlines) {
  const matched = scene.outlineId ? outlines.find((o) => o.id === scene.outlineId) : undefined;
  return (
    matched ?? {
      id: scene.id,
      type: scene.type,
      title: scene.title,
      description: '',
      keyPoints: [],
      order: scene.order,
    }
  );
}

function asText(value) {
  return typeof value === 'string' ? value : '';
}

function asKeyPoints(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim().length > 0);
}

/**
 * 把 brief 里显式给出的 `scenes` 正规化成大纲项（顺序按数组序，order 从 0 起）。
 * 未知 type 不静默改写成 slide —— 直接报错，免得下游拿错场景类型还画得出来。
 */
function normalizeExplicitScenes(scenes) {
  return scenes.map((scene, index) => {
    const type = asText(scene?.type) || 'slide';
    if (!SCENE_TYPES.includes(type)) {
      throw new ClassroomAgentError(
        'INVALID_PLAN',
        `未知场景类型 "${type}"（只认 ${SCENE_TYPES.join('/')}）`,
      );
    }
    return {
      id: asText(scene?.id) || `scene-${index + 1}`,
      type,
      title: asText(scene?.title) || `场景 ${index + 1}`,
      description: asText(scene?.description),
      keyPoints: asKeyPoints(scene?.keyPoints),
      order: index,
    };
  });
}

/**
 * brief → 场景序列（确定性、无 LLM）。
 *
 * 规则（与上游大纲的书写顺序一致：先讲、再练、最后综合）：
 *   1. 恒有一节导入 `slide`，keyPoints 取 brief.goals（上游 buildDirectorCourseOutline
 *      只取前 5 条 keyPoints，这里同样封顶 5）；
 *   2. 每个 goal 一节 `slide`；
 *   3. `brief.interactive === true` 时插一节 `interactive`（在测验之前）；
 *   4. `brief.assess !== false` 时以一节的 `quiz` 收尾；
 *   5. `brief.project === true` 时以 `pbl` 收尾（在 quiz 之后）。
 *
 * brief 显式给了 `scenes` 就整段采信，不再推导 —— 页面编辑器传来的就是它。
 */
export function planScenes(brief = {}) {
  if (Array.isArray(brief.scenes) && brief.scenes.length > 0) {
    return normalizeExplicitScenes(brief.scenes);
  }

  const topic = asText(brief.topic) || asText(brief.title) || '未命名课堂';
  const goals = asKeyPoints(brief.goals);
  const planned = [];

  const push = (type, title, description, keyPoints) => {
    planned.push({
      id: `scene-${planned.length + 1}`,
      type,
      title,
      description: asText(description),
      keyPoints: asKeyPoints(keyPoints),
      order: planned.length,
    });
  };

  push('slide', `导入：${topic}`, asText(brief.description), goals.slice(0, 5));

  goals.forEach((goal, index) => {
    push('slide', `${index + 1}. ${goal}`, goal, [goal]);
  });

  if (brief.interactive === true) {
    push('interactive', `互动：${topic}`, asText(brief.interactiveBrief), goals.slice(0, 3));
  }

  if (brief.assess !== false) {
    push('quiz', `随堂检测：${topic}`, '', goals.slice(0, 5));
  }

  if (brief.project === true) {
    push('pbl', `项目：${topic}`, asText(brief.projectBrief), goals.slice(0, 5));
  }

  return planned;
}
