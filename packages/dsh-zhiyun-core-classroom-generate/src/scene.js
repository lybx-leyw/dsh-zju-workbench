// 源：ref/OpenMAIC/packages/@openmaic/generation/src/scene-builder.ts:22-115（CompleteScene 的装配与默认主题）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/scene-generator.ts:232-320（内容 → content 的字段）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/scene-generator.ts:989-1110（quiz 选项/答案的归一）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/outline-generator.ts:144-186（大纲归一：id 补全、order=index+1）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/outline-generator.ts:208-236（applyOutlineFallbacks：缺配置的 interactive/pbl 降级为 slide）
// 源：ref/OpenMAIC/packages/@openmaic/dsl/src/action.ts:36-52（SpeechAction）

import { tryParseJson, tryParseJsonObject } from './json.js';

/** 规范 §1 判据里的四类场景。与 core-classroom-agent 的 `SCENE_TYPES` 同值（这里是本地常量，不跨包 import）。 */
export const SCENE_TYPES = Object.freeze(['slide', 'quiz', 'interactive', 'pbl']);

/** 上游 slide 的默认主题（scene-builder.ts:37-44，逐字）。 */
export const DEFAULT_SLIDE_THEME = Object.freeze({
  backgroundColor: '#ffffff',
  themeColors: ['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4'],
  fontColor: '#333333',
  fontName: 'Microsoft YaHei',
  outline: { color: '#d14424', width: 2, style: 'solid' },
  shadow: { h: 0, v: 0, blur: 10, color: '#000000' },
});

const VIEWPORT_SIZE = 1000;
const VIEWPORT_RATIO = 0.5625;
/** 画布宽（与 `prompts.js` 的 `SLIDE_CANVAS_WIDTH` 同值，这里用于元素宽度兜底）。 */
const SLIDE_WIDTH = VIEWPORT_SIZE;

// ==================== 大纲 ====================

/**
 * 解析大纲响应。接受三种上游形状（outline-generator.ts:154-178）：
 *   1. 裸数组；
 *   2. `{ outlines: [...] }`；
 *   3. `{ languageDirective, courseTitle, outlines: [...] }`。
 *
 * 归一规则逐条照上游：`id` 缺失补 `outline-<n>`、`order = index + 1`、
 * 未知 type 降级 slide（上游 `applyOutlineFallbacks` 对「缺配置的 interactive/pbl」
 * 也是降级 slide，这里对「完全不认识的 type」用同一条降级，免得下游拿到画不出来的类型）。
 *
 * @returns {{languageDirective: string, courseTitle?: string, outlines: object[]}|null}
 */
export function parseOutlineResponse(raw, { languageDirective } = {}) {
  const parsed = tryParseJson(raw);
  if (!parsed) return null;

  let rawOutlines = null;
  let directive = languageDirective ?? '';
  let courseTitle;

  if (Array.isArray(parsed)) {
    rawOutlines = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.outlines)) {
    rawOutlines = parsed.outlines;
    if (typeof parsed.languageDirective === 'string') directive = parsed.languageDirective.trim() || directive;
    const title = typeof parsed.courseTitle === 'string' ? parsed.courseTitle.trim() : '';
    courseTitle = title ? title.slice(0, 120) : undefined;
  } else {
    return null;
  }

  if (rawOutlines.length === 0) return null;

  const outlines = rawOutlines
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => normalizeOutline(item, index));

  if (outlines.length === 0) return null;
  return { languageDirective: directive, courseTitle, outlines };
}

export function normalizeOutline(raw = {}, index = 0) {
  const type = SCENE_TYPES.includes(raw.type) ? raw.type : 'slide';
  const keyPoints = Array.isArray(raw.keyPoints)
    ? raw.keyPoints.filter((point) => typeof point === 'string' && point.trim()).map((point) => point.trim())
    : [];

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `outline-${index + 1}`,
    type,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : `场景 ${index + 1}`,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    keyPoints,
    ...(typeof raw.teachingObjective === 'string' ? { teachingObjective: raw.teachingObjective } : {}),
    ...(Number.isFinite(Number(raw.estimatedDuration)) ? { estimatedDuration: Number(raw.estimatedDuration) } : {}),
    // 上游 order 从 1 起（outline-generator.ts:174）。
    order: index + 1,
    ...(raw.quizConfig && typeof raw.quizConfig === 'object' ? { quizConfig: raw.quizConfig } : {}),
    ...(raw.pblConfig && typeof raw.pblConfig === 'object' ? { pblConfig: raw.pblConfig } : {}),
    ...(Array.isArray(raw.mediaGenerations) ? { mediaGenerations: normalizeMediaRequests(raw.mediaGenerations) } : {}),
  };
}

/** 媒体请求照 `MediaGenerationRequest` 归一；没有 prompt 的项直接丢掉（生成不了）。 */
function normalizeMediaRequests(list) {
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const type = item.type === 'video' ? 'video' : item.type === 'image' ? 'image' : null;
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
    if (!type || !prompt) continue;
    out.push({
      type,
      prompt,
      elementId: typeof item.elementId === 'string' && item.elementId
        ? item.elementId
        : `media-${out.length + 1}`,
      ...(typeof item.aspectRatio === 'string' ? { aspectRatio: item.aspectRatio } : {}),
      ...(typeof item.style === 'string' ? { style: item.style } : {}),
    });
  }
  return out;
}

// ==================== 场景内容 ====================

/**
 * 解析场景响应 → `{ content, speech }`。解析不出来给 null（调用方决定报错还是跳过）。
 *
 * 四类场景的 content 形状与上游 `buildCompleteScene` 的分支一一对应
 * （scene-builder.ts:36-112）：
 *   slide → `{ type:'slide', canvas }`、quiz → `{ type:'quiz', questions }`、
 *   interactive → `{ type:'interactive', url, html, widgetType }`、pbl → `{ type:'pbl', projectV2 }`
 * （pbl 的 projectV2 由 `zhiyunClassroomPbl` 产出，不走 LLM 解析，见 phases/scenes.js）。
 */
export function parseSceneResponse(raw, outline, { sceneIndex = 0, stageId = '' } = {}) {
  const parsed = tryParseJsonObject(raw);
  if (!parsed) return null;

  const speech = typeof parsed.speech === 'string' ? parsed.speech.trim() : '';

  if (outline.type === 'slide') {
    const elements = Array.isArray(parsed.elements) ? parsed.elements : [];
    const normalized = elements
      .filter((element) => element && typeof element === 'object' && typeof element.type === 'string')
      .map((element, index) => normalizeElement(element, sceneIndex, index));
    if (normalized.length === 0) return null;
    return {
      content: {
        type: 'slide',
        canvas: {
          id: `canvas-${sceneIndex + 1}`,
          viewportSize: VIEWPORT_SIZE,
          viewportRatio: VIEWPORT_RATIO,
          theme: { ...DEFAULT_SLIDE_THEME },
          elements: normalized,
          ...(parsed.background && typeof parsed.background === 'object' ? { background: parsed.background } : {}),
        },
      },
      speech,
    };
  }

  if (outline.type === 'quiz') {
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.filter((item) => item && typeof item === 'object').map(normalizeQuestion)
      : [];
    if (questions.length === 0) return null;
    return { content: { type: 'quiz', questions }, speech };
  }

  if (outline.type === 'interactive') {
    const html = typeof parsed.html === 'string' ? parsed.html.trim() : '';
    if (!html) return null;
    return {
      content: {
        type: 'interactive',
        url: '',
        html,
        widgetType: typeof parsed.widgetType === 'string' ? parsed.widgetType : 'custom',
      },
      speech,
    };
  }

  // pbl 的 content 不在 LLM 响应里（见 phases/scenes.js 的 produceScene）。
  if (parsed.projectV2 && typeof parsed.projectV2 === 'object') {
    return { content: { type: 'pbl', projectV2: parsed.projectV2 }, speech };
  }
  return null;
}

function normalizeElement(element, sceneIndex, index) {
  const left = numberOr(element.left, 0);
  const top = numberOr(element.top, 0);
  const width = numberOr(element.width, SLIDE_WIDTH - left);
  const height = numberOr(element.height, 80);
  return {
    ...element,
    id: typeof element.id === 'string' && element.id ? element.id : `s${sceneIndex + 1}-el-${index + 1}`,
    type: element.type,
    left,
    top,
    width: Math.max(1, width),
    height: Math.max(1, height),
    ...(element.type === 'text' && typeof element.content !== 'string' ? { content: '' } : {}),
  };
}

/**
 * 题目归一（scene-generator.ts:989-1110 的口径）：选项 id 缺失时按 a/b/c 补，
 * 答案只保留**真实存在的选项 id**（认不出来的答案留空，由评分侧按「未作答」处理，
 * 不在这里删题 —— 删题会让「题量」对不上大纲）。
 */
function normalizeQuestion(raw, index) {
  const type = ['single', 'multiple', 'text'].includes(raw.type) ? raw.type : 'single';
  const options = Array.isArray(raw.options)
    ? raw.options
      .filter((option) => option && (typeof option === 'string' || typeof option === 'object'))
      .map((option, optionIndex) => {
        if (typeof option === 'string') {
          return { id: String.fromCharCode(97 + optionIndex), text: option };
        }
        return {
          id: typeof option.id === 'string' && option.id ? option.id : String.fromCharCode(97 + optionIndex),
          text: typeof option.text === 'string' ? option.text : String(option.text ?? ''),
        };
      })
    : [];

  const ids = new Set(options.map((option) => option.id));
  const answerRaw = raw.answer ?? raw.correctAnswer ?? null;
  const answers = Array.isArray(answerRaw) ? answerRaw : answerRaw === null ? [] : [answerRaw];
  const answer = answers.map((value) => (ids.has(value) ? value : null)).filter(Boolean);

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `q-${index + 1}`,
    type,
    question: typeof raw.question === 'string' ? raw.question : String(raw.question ?? ''),
    options,
    answer: type === 'multiple' ? answer : (answer[0] ?? null),
    explanation: typeof raw.explanation === 'string' ? raw.explanation : '',
  };
}

// ==================== 场景装配 ====================

/**
 * 上游 `buildCompleteScene` 的等价实现。
 *
 * 唯一的语义改动：`sceneId` 由调用方给（本包用 `order` 派生，见 phases/scenes.js），
 * 不在这里 `nanoid()` —— 重跑/续跑必须**命中同一个场景**（upsert 幂等），
 * 随机 id 会让续跑把同一页写成两份。
 *
 * @returns {object|null} 内容与大纲类型对不上时返回 null（上游同行为）
 */
export function buildScene({ outline, content, speech, stageId, sceneId, now = () => Date.now() }) {
  if (!content || content.type !== outline.type) return null;
  const timestamps = { createdAt: now(), updatedAt: now() };

  const actions = typeof speech === 'string' && speech.trim()
    ? [{ id: `${sceneId}-speech-1`, type: 'speech', text: speech.trim() }]
    : [];

  return {
    id: sceneId,
    outlineId: outline.id,
    stageId,
    type: outline.type,
    title: outline.title,
    order: outline.order,
    content,
    actions,
    ...timestamps,
  };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
