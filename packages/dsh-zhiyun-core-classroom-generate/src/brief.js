// 源：ref/OpenMAIC/lib/server/generation/run/input.ts:1-300（parseRunInput 的入参规则）
// 源：ref/OpenMAIC/lib/server/generate-classroom-job.ts:1-120（requirement 必填、材料可选）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/outline-types.ts:22-29（UserRequirements）

import { ClassroomGenerateError } from './errors.js';

/**
 * brief 归一化：把「用户随手写的那个东西」变成本管线认得的形状。
 *
 * 接受两种写法（与上游 `POST /api/generation-runs` 的 body 一致）：
 *   - 字符串：`'讲一下二叉树'` → `{ requirement }`；
 *   - 对象：`{ requirement | topic | title, goals?, interactive?, assess?, project?, scenes? }`。
 *
 * `requirement` 是**唯一必填**字段（上游 `startRefusal` 的第一条拒绝原因就是它）。
 * 其余字段与 `dsh-zhiyun-core-classroom-agent` 的 `planScenes(brief)` 同形 ——
 * 大纲兜底会原样把它交给那位同事，所以这里不能改名（改名等于两套 brief 契约）。
 *
 * @param {unknown} raw
 * @returns {object} 冻结后的 brief
 */
export function normalizeBrief(raw) {
  let source = raw;
  if (typeof source === 'string') source = { requirement: source };
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new ClassroomGenerateError('E_INVALID_INPUT', 'brief 必须是字符串或对象', { field: 'brief' });
  }

  const requirement = asText(source.requirement ?? source.topic ?? source.title);
  if (!requirement) {
    throw new ClassroomGenerateError('E_INVALID_INPUT', 'brief 缺少 requirement（或 topic / title）', {
      field: 'requirement',
    });
  }

  const topic = asText(source.topic ?? source.title) || requirement;

  return Object.freeze({
    requirement,
    topic,
    description: asText(source.description),
    goals: asStringList(source.goals),
    interactive: source.interactive === true,
    assess: source.assess !== false,
    project: source.project === true,
    projectBrief: asText(source.projectBrief),
    // `scenes` 给了就整段采信（agent.planScenes 的规则：显式大纲不再推导）。
    scenes: Array.isArray(source.scenes) ? source.scenes.map((scene) => ({ ...scene })) : undefined,
    courseId: asText(source.courseId) || undefined,
    materialIds: asStringList(source.materialIds),
    languageDirective: asText(source.languageDirective) || undefined,
    // 花名册/学习者画像：上游 `agents` / `learnerProfile` 两个字段，这里只透传。
    agents: source.agents && typeof source.agents === 'object' ? source.agents : undefined,
    learnerProfile: source.learnerProfile && typeof source.learnerProfile === 'object'
      ? source.learnerProfile
      : undefined,
  });
}

/**
 * stageId 会被当成目录名用（vault 的 `assertSegment`），所以在这里先挡一次：
 * 让「带斜杠的 id」以 `E_INVALID_INPUT` 失败，而不是落盘时抛一个 VaultPathError。
 */
export function assertStageId(stageId) {
  const id = asText(stageId);
  if (!id) throw new ClassroomGenerateError('E_INVALID_INPUT', 'stageId 不能为空', { field: 'stageId' });
  if (id.length > 160) {
    throw new ClassroomGenerateError('E_INVALID_INPUT', `stageId 过长（>160）：${id.slice(0, 24)}…`, {
      field: 'stageId',
    });
  }
  if (/[/\\\u0000]/.test(id)) {
    throw new ClassroomGenerateError('E_INVALID_INPUT', `stageId 不能包含路径分隔符：${id}`, {
      field: 'stageId',
    });
  }
  return id;
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}
