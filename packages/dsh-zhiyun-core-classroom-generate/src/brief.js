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
    outputFormat: source.outputFormat === 'html' ? 'html' : 'canvas',
    sourceText: typeof source.sourceText === 'string' ? source.sourceText : '',
    knowledgeTree: source.knowledgeTree ?? undefined,
    chapters: Array.isArray(source.chapters) ? source.chapters.map((chapter, index) => {
      if (!chapter || typeof chapter !== 'object' || typeof chapter.sourceText !== 'string' || !chapter.sourceText.trim()) {
        throw new ClassroomGenerateError('E_INVALID_INPUT', `章节 ${index + 1} 缺少 sourceText`, { field: 'chapters' });
      }
      return { id: asText(chapter.id) || `chapter-${index + 1}`, title: asText(chapter.title) || `第 ${index + 1} 章`, sourceText: chapter.sourceText, knowledgeTree: chapter.knowledgeTree };
    }) : undefined,
    // 章节并发：只保证「是正整数」，不设人为上限。
    // 真实上限由章节数决定（worker 数 = min(并发, 章节数)），所以「不限制」不会
    // 凭空开出多余 worker；写死 4 反而会让 10 章的课时白白串行。
    chapterConcurrency: chapterConcurrencyOf(source.chapterConcurrency),
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

/**
 * 章节并发的归一化：**只保底，不封顶**。
 *
 * 为什么去掉旧版的 `Math.min(4, ...)`：章节数是天然的并发上限
 * （`generateHtmlChapters` 起的是 `min(limit, chapters.length)` 个 worker），
 * 所以「不限制」并不会多开请求；而写死 4 会让 10 章的课时被迫串行，
 * 用户没有别的办法调快。真正的成本风险交给用户在界面上自己决定。
 *
 * 非法值（非数字、NaN、0、负数、小数）一律回默认 3 —— 静默按 1 跑会让
 * 用户以为配置没生效。
 *
 * @param {unknown} value brief 里的 `chapterConcurrency`
 * @returns {number} ≥1 的整数
 */
function chapterConcurrencyOf(value) {
  const DEFAULT = 3;
  if (value === undefined || value === null || value === '') return DEFAULT;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return DEFAULT;
  return Math.floor(number);
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}
