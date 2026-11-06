// 源：ref/OpenMAIC/packages/@openmaic/generation/src/scene-builder.ts:22-115（CompleteScene 的装配与默认主题）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/scene-generator.ts:232-320（内容 → content 的字段）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/scene-generator.ts:989-1110（quiz 选项/答案的归一）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/outline-generator.ts:144-186（大纲归一：id 补全、order=index+1）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/outline-generator.ts:208-236（applyOutlineFallbacks：缺配置的 interactive/pbl 降级为 slide）
// 源：ref/OpenMAIC/packages/@openmaic/dsl/src/action.ts:36-52（SpeechAction）

import { tryParseJson, tryParseJsonObject } from './json.js';
import {
  SLIDE_CANVAS_HEIGHT,
  SLIDE_CANVAS_WIDTH,
  SLIDE_MARGIN,
  TEXT_HEIGHT_TABLE,
  TEXT_INTERNAL_PADDING,
} from './prompts.js';

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
export function parseOutlineResponse(raw, { languageDirective, maxScenes } = {}) {
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

  // 场景数上限（上游 MAX_OUTLINE_SCENES = 100）：模型跑飞时会一直吐场景，
  // 没有上限就无限生成、无限计费。超出部分直接丢掉，保留前面有效的。
  const capped = Number.isFinite(maxScenes) && maxScenes > 0
    ? rawOutlines.slice(0, maxScenes)
    : rawOutlines;

  const outlines = capped
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => normalizeOutline(item, index));

  if (outlines.length === 0) return null;
  // id 唯一化：上游有 ensureUniqueOutlineId；这里顺带处理模型复用同一 id 的情况。
  const seenIds = new Set();
  const unique = outlines.map((outline) => {
    if (!seenIds.has(outline.id)) {
      seenIds.add(outline.id);
      return outline;
    }
    let suffix = 2;
    let candidate = `${outline.id}-${suffix}`;
    while (seenIds.has(candidate)) {
      suffix += 1;
      candidate = `${outline.id}-${suffix}`;
    }
    seenIds.add(candidate);
    return { ...outline, id: candidate };
  });
  return { languageDirective: directive, courseTitle, outlines: uniquifyMediaElementIds(unique) };
}

/**
 * 媒体占位符 id 全局唯一化（上游 `outline-media.ts:5-19` 的 `uniquifyMediaElementIds`）。
 *
 * # 为什么必须做
 *
 * 模型在多个场景里会重复写 `"elementId": "img_1"` —— prompt 示例本身就在教它这么写。
 * 但下游 `phases/media.js` 按 `elementId` 去重（同一占位符只生成一次图），于是
 * **第二个场景的配图会被当成重复项直接丢掉**，那页就永远缺图。
 *
 * 上游的做法是重写成 `gen_img_<随机>`/`gen_vid_<随机>`。这里用「场景序号 + 类型 + 序号」
 * 派生，保证：全局唯一、可复现（同一份大纲每次跑出同样的 id）、且能从 id 看出归属。
 */
export function uniquifyMediaElementIds(outlines) {
  const seen = new Set();
  return outlines.map((outline) => {
    const list = outline.mediaGenerations;
    if (!Array.isArray(list) || list.length === 0) return outline;

    const renamed = list.map((request, index) => {
      const original = typeof request.elementId === 'string' && request.elementId ? request.elementId : '';
      const prefix = request.type === 'video' ? 'gen_vid' : 'gen_img';
      // 原名没被占用就保留（可读性更好），被占用则派一个新 id。
      let candidate = original && !seen.has(original) ? original : `${prefix}_s${outline.order}_${index + 1}`;
      let suffix = 2;
      while (seen.has(candidate)) {
        candidate = `${prefix}_s${outline.order}_${index + 1}_${suffix}`;
        suffix += 1;
      }
      seen.add(candidate);
      return { ...request, elementId: candidate };
    });

    return { ...outline, mediaGenerations: renamed };
  });
}

/**
 * 缺配置的场景降级为 slide（上游 `outline-generator.ts:208-235` 的 `applyOutlineFallbacks`）。
 *
 * # 为什么必须在生成前降级
 *
 * 模型有时会给 `type: "interactive"` 却不给 `widgetType`/`widgetOutline`，
 * 或给 `type: "pbl"` 却不给 `pblConfig`。上游在这里就把它降级成 slide；
 * 本仓原先不做，于是一路跑到 `phases/scenes.js` 才因为"产出对不上类型"而失败 ——
 * 表现出来是「某一页莫名消失」，而真实原因在大纲阶段就已经确定了。
 *
 * 降级而不是丢弃：保住这一页的教学内容，只是换个更简单的载体。
 *
 * @param {object[]} outlines
 * @param {{hasPblService?: boolean}} [options] 没有 pbl 服务时 pbl 必须降级
 * @returns {{outlines: object[], fallbacks: object[]}} `fallbacks` 供调用方记录
 */
export function applyOutlineFallbacks(outlines, options = {}) {
  const fallbacks = [];
  const hasPblService = options.hasPblService !== false;

  const next = outlines.map((outline) => {
    if (outline.type === 'interactive') {
      const hasWidgetConfig = Boolean(outline.widgetType && outline.widgetOutline);
      if (!hasWidgetConfig) {
        fallbacks.push({
          outlineId: outline.id,
          title: outline.title,
          from: 'interactive',
          to: 'slide',
          reason: 'missing widgetType/widgetOutline',
        });
        return { ...outline, type: 'slide' };
      }
      return outline;
    }

    if (outline.type === 'pbl') {
      if (!outline.pblConfig || !hasPblService) {
        fallbacks.push({
          outlineId: outline.id,
          title: outline.title,
          from: 'pbl',
          to: 'slide',
          reason: outline.pblConfig ? 'no pbl service' : 'missing pblConfig',
        });
        return { ...outline, type: 'slide' };
      }
      return outline;
    }

    return outline;
  });

  return { outlines: next, fallbacks };
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
    // 确定性几何纠正：模型给的 height 常常撑不住内容，或元素相互压住。
    // 这里在落盘前修正，`issues` 交给调用方记录（便于观察模型听话程度）。
    const geometry = reconcileSlideGeometry(normalized);
    return {
      content: {
        type: 'slide',
        canvas: {
          id: `canvas-${sceneIndex + 1}`,
          viewportSize: VIEWPORT_SIZE,
          viewportRatio: VIEWPORT_RATIO,
          theme: { ...DEFAULT_SLIDE_THEME },
          elements: geometry.elements,
          ...(parsed.background && typeof parsed.background === 'object' ? { background: parsed.background } : {}),
        },
      },
      speech,
      geometryIssues: geometry.issues,
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

  // 字段名与上游 quiz-content 模板对齐（`analysis` / `points` / `commentPrompt`），
  // 同时兼容早期的 `explanation`，避免旧 checkpoint 里的题目丢掉解析。
  const analysis = typeof raw.analysis === 'string'
    ? raw.analysis
    : typeof raw.explanation === 'string' ? raw.explanation : '';
  const pointsRaw = Number(raw.points);
  const points = Number.isFinite(pointsRaw) && pointsRaw > 0 ? pointsRaw : 10;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `q-${index + 1}`,
    type,
    question: typeof raw.question === 'string' ? raw.question : String(raw.question ?? ''),
    options,
    answer: type === 'multiple' ? answer : (answer[0] ?? null),
    // 上游字段名是 `analysis`；课堂渲染侧读的是 `explanation`。
    // 两个都写，既不丢上游语义，也不破坏现有渲染。
    analysis,
    explanation: analysis,
    // 判分（本地精确比对与 /api/quiz-grade）都按 points 计算得分，
    // 缺省会退到默认值，所以这里必须显式落到题目上。
    points,
    ...(typeof raw.commentPrompt === 'string' && raw.commentPrompt.trim()
      ? { commentPrompt: raw.commentPrompt.trim() }
      : {}),
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
export function buildScene({ outline, content, speech, actions, stageId, sceneId, now = () => Date.now() }) {
  if (!content || content.type !== outline.type) return null;
  const timestamps = { createdAt: now(), updatedAt: now() };

  // 动作序列优先用 actions 段产出的完整列表（spotlight/laser/play_video/discussion/
  // widget_* 与 speech 交织）。只有 actions 段**什么都没产出**时，才退回
  // 「content 阶段那一条 speech」—— 与上游的确定性默认动作同义。
  //
  // ⚠️ 回退必须只在完全为空时发生：若 actions 段产出了 3 条 text，塞回
  // content 的那条 speech 会造成旁白重复。
  const provided = Array.isArray(actions) ? actions.filter((action) => action && action.type) : [];
  const fallbackSpeech = typeof speech === 'string' && speech.trim()
    ? [{ id: `${sceneId}-speech-1`, type: 'speech', text: speech.trim() }]
    : [];
  const finalActions = provided.length > 0 ? provided : fallbackSpeech;

  return {
    id: sceneId,
    outlineId: outline.id,
    stageId,
    type: outline.type,
    title: outline.title,
    order: outline.order,
    content,
    actions: finalActions,
    ...timestamps,
  };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// ==================== 幻灯片几何自检 ====================
//
// # 为什么要有这一节
//
// prompt 已经要求模型查表给 height、遵守边距、禁止重叠（见 `prompts.js` 的
// slide 模板），但**提示词是软约束**：模型仍会给出 40px 高却装了 3 行 24px 文字的
// 文本框。导出层 `deck.js` 会把 height 原样写成 PowerPoint 形状高度，并用
// `autoFit: true` 在框内缩字 —— 框不会长大，于是字被压在过小的区域里，
// 视觉上就是**与下方元素重叠**。
//
// 所以这里补一层确定性纠正：模型输出不可信，能算出正确值的就直接算出来，
// 不能算的（重叠）就按"整体下移"重新排版。这一层不需要模型配合。

/** 从 content 的 HTML 里抽取字号与文本量，用于算真实所需高度。 */
export function measureTextContent(html) {
  const source = typeof html === 'string' ? html : '';
  const paragraphs = source
    .replace(/<br\s*\/?>/gi, '</p><p>')
    .split(/<\/p>/i)
    .map((chunk) => chunk.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim())
    .filter((text) => text.length > 0);
  const plain = paragraphs.join('') || source.replace(/<[^>]*>/g, '').trim();

  // 字号：优先取行内 style 的 font-size；退回顶层 fontSize（prompt 已要求别这么写，
  // 但真出现时按它算总比按默认值算准）；都没有就用 18。
  const styleSizes = [...source.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/gi)]
    .map((match) => Number(match[1]))
    .filter((size) => Number.isFinite(size) && size > 0);
  const inlineSize = styleSizes.length ? Math.max(...styleSizes) : 0;
  // ⚠️ 顶层 fontSize 字段导出层根本不读（deck.js 只认行内 style），
  // 所以这里也不按它算 —— 保持"估算"与"实际渲染"同一个口径。
  const fontSize = inlineSize || 18;

  return {
    fontSize,
    paragraphCount: Math.max(1, paragraphs.length),
    charCount: [...plain].length,
  };
}

/**
 * 按上游 Rule 1/2 估算文本所需行数。
 *
 * 口径说明（决定"绝不会误报"这件事）：
 * - 每行容量用 `(width - 20) / fontSize`（上游 Rule 1）
 * - 只有**真的折行**时才多给行数；单行内容不该被算成 2 行
 * - 上游的 `+0.8` 安全余量用在**折行情况下**的向上取整，而不是无条件加一整行 ——
 *   否则任何单行标题都会被判成"高度不足"，自检会把整页所有元素都抬高，
 *   那反而制造重叠。
 */
export function estimateTextLines(measure, width) {
  const usable = Math.max(1, width - TEXT_INTERNAL_PADDING * 2);
  const perLine = Math.max(1, usable / measure.fontSize);
  // 每段各自的折行数，再求和；不足一段按一段算。
  const rawLines = Math.max(1, Math.ceil(measure.charCount / perLine));
  const lines = Math.max(measure.paragraphCount, rawLines);
  // 折行（>1 行）时给 1 行余量，单行不动 —— 宁可少报，不要误伤。
  return lines > 1 ? lines + 1 : 1;
}

/** 查表取高度；超出表范围时按最后一档 + 每行按字号 1.5 倍外推。 */
export function heightFor(fontSize, lines) {
  const sizes = Object.keys(TEXT_HEIGHT_TABLE).map(Number).sort((a, b) => a - b);
  // 取表里 ≥ 请求字号的最近一档（宁可框大一点，也不要挤）。
  const size = sizes.find((candidate) => candidate >= fontSize) ?? sizes[sizes.length - 1];
  const row = TEXT_HEIGHT_TABLE[size];
  if (lines <= row.length) return row[Math.max(0, lines - 1)];
  const step = size * 1.5;
  return Math.round(row[row.length - 1] + (lines - row.length) * step);
}

/** 两个矩形的交集面积。 */
function overlapArea(a, b) {
  const width = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const height = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/** b 是否完整落在 a 里（允许 1px 误差）。 */
function contains(a, b) {
  const e = 1;
  return b.left >= a.left - e
    && b.top >= a.top - e
    && b.left + b.width <= a.left + a.width + e
    && b.top + b.height <= a.top + a.height + e;
}

/**
 * 对一页的元素做确定性几何纠正，返回 `{ elements, issues }`。
 *
 * 处理顺序（与上游 prompt 的规则编号对应）：
 * 1. 文本 height 不足 → 按查表抬高（Rule 2）
 * 2. 越界 / 破边距 → 夹回画布内（Margins）
 * 3. 非嵌套重叠 → 把**下方**元素整体下移，直到不再相交（Rule 6）
 * 4. 元素仍超出画布底部 → 缩小字号重排一次；再不行就丢弃该元素（宁可少一块，不要叠）
 *
 * `issues` 用于把纠正记录下来（调用方可打进事件流排查）
 */
export function reconcileSlideGeometry(elements) {
  const issues = [];
  if (!Array.isArray(elements) || elements.length === 0) return { elements: [], issues };

  const maxRight = SLIDE_CANVAS_WIDTH - SLIDE_MARGIN;
  const maxBottom = SLIDE_CANVAS_HEIGHT - SLIDE_MARGIN;

  // ── 1. 文本高度按内容量抬高 ──
  let working = elements.map((element) => {
    if (element.type !== 'text') return { ...element };
    const measure = measureTextContent(element.content);
    const lines = estimateTextLines(measure, element.width);
    const needed = heightFor(measure.fontSize, lines);
    if (element.height + 1 < needed) {
      issues.push({
        code: 'TEXT_HEIGHT_RAISED',
        id: element.id,
        from: element.height,
        to: needed,
        fontSize: measure.fontSize,
        lines,
      });
      return { ...element, height: needed };
    }
    return { ...element };
  });

  // ── 2. 夹回画布与边距 ──
  working = working.map((element) => {
    const next = { ...element };
    if (next.width > SLIDE_CANVAS_WIDTH - SLIDE_MARGIN * 2) {
      next.width = SLIDE_CANVAS_WIDTH - SLIDE_MARGIN * 2;
      issues.push({ code: 'WIDTH_CLAMPED', id: next.id, to: next.width });
    }
    if (next.left < SLIDE_MARGIN) {
      issues.push({ code: 'LEFT_CLAMPED', id: next.id, from: next.left, to: SLIDE_MARGIN });
      next.left = SLIDE_MARGIN;
    }
    if (next.left + next.width > maxRight) {
      const to = Math.max(SLIDE_MARGIN, maxRight - next.width);
      issues.push({ code: 'LEFT_PULLED_LEFT', id: next.id, from: next.left, to });
      next.left = to;
    }
    if (next.top < SLIDE_MARGIN) {
      issues.push({ code: 'TOP_CLAMPED', id: next.id, from: next.top, to: SLIDE_MARGIN });
      next.top = SLIDE_MARGIN;
    }
    return next;
  });

  // ── 3+4. 重叠消解 + 最小间距 + 并排保持 ──
  //
  // 三件事按顺序做，顺序不能反：
  //   (a) 同行归组：top 接近且**水平分离**的元素是同一条横排（三栏、图标+文字），
  //       它们之间只需保证水平间距，不能因为"矩形相交"就把其中一栏往下推。
  //   (b) 横向溢出：同一行的元素加起来超过可用宽度时，**等分收窄**并重排，
  //       而不是把多出来的推到下一行 —— 后者会毁掉并排语义。
  //   (c) 纵向落位：跨行的元素按"上→下"逐个落位，且相邻之间留 MIN_GAP。
  //
  // 曾经只做 (c)，于是三栏布局会被推成一竖列（诊断用例 C），
  // 而元素紧贴（间距 0）完全不管（诊断用例 B）—— 后者正是"看起来对齐糟糕"的来源。

  const MIN_GAP = 16;

  const dropped = new Set();

  // 先识别**有意嵌套**：被非文本容器（shape/image）完整包含的较小元素，
  // 跟着容器走，不单独排位。
  //
  // ⚠️ 外层必须是容器。曾经只判矩形包含，结果「两个等宽文本块、一个略高」
  // 被误判成嵌套 —— 副标题就这么"藏"进了标题里，重叠检测整段失效。
  // 文字压文字永远不是有意设计。
  const nestedInto = new Map();
  for (let j = 0; j < working.length; j += 1) {
    for (let i = 0; i < working.length; i += 1) {
      if (i === j) continue;
      const outer = working[i];
      const inner = working[j];
      if (outer.type === 'text') continue; // 文本不能当容器
      const outerArea = outer.width * outer.height;
      const innerArea = inner.width * inner.height;
      if (innerArea >= outerArea) continue;
      if (contains(outer, inner)) {
        nestedInto.set(inner.id, { outerId: outer.id, dx: inner.left - outer.left, dy: inner.top - outer.top });
        break;
      }
    }
  }

  // ── (a) 同行归组 ──
  //
  // 判据：纵向有重叠（top 区间相交），且**不是**一个包住另一个。
  // 这类元素在视觉上是"并排"，必须只调水平、不调垂直。
  const independentAll = working.filter((element) => !nestedInto.has(element.id));

  /** 两个元素是否属于同一条横排。 */
  const sameRow = (a, b) => {
    // 纵向必须先有足够重叠，否则是两个上下堆叠的块，不是并排。
    const overlapTop = Math.max(a.top, b.top);
    const overlapBottom = Math.min(a.top + a.height, b.top + b.height);
    const overlap = overlapBottom - overlapTop;
    if (overlap <= 0) return false;
    const shorter = Math.min(a.height, b.height);
    if (overlap < shorter * 0.5) return false;

    const horizontal = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);

    // 情形 1：水平方向**已经分开**（含留了间距）。
    // 这是最典型的并排（两栏、三栏）；即使两栏 top 差几像素，也该归为同一行
    // 并把基线对齐 —— 这正是"看起来没对齐"的常见来源。
    if (horizontal <= 0) return true;

    // 情形 2：水平有重叠但**不多** —— 仍可能是并排（元素略宽、互相啃了一点），
    // 归为同一行后由行内重排解决。
    const narrower = Math.min(a.width, b.width);
    if (horizontal <= narrower * 0.5) return true;

    // 情形 3：几乎完全重合 → 不是并排，是复制粘贴错误。按上下拆开处理。
    return false;
  };

  // 用并查集把同排元素归组。
  const parent = new Map(independentAll.map((element) => [element.id, element.id]));
  const findRoot = (id) => {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current);
    return current;
  };
  const union = (a, b) => {
    const ra = findRoot(a);
    const rb = findRoot(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (let i = 0; i < independentAll.length; i += 1) {
    for (let j = i + 1; j < independentAll.length; j += 1) {
      if (sameRow(independentAll[i], independentAll[j])) union(independentAll[i].id, independentAll[j].id);
    }
  }
  const rowGroups = new Map();
  for (const element of independentAll) {
    const root = findRoot(element.id);
    if (!rowGroups.has(root)) rowGroups.set(root, []);
    rowGroups.get(root).push(element);
  }

  // ── (b) 横向溢出 → 等分收窄重排 ──
  for (const group of rowGroups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.left - b.left);

    const available = maxRight - SLIDE_MARGIN;
    const totalWidth = group.reduce((sum, element) => sum + element.width, 0);
    const totalGap = MIN_GAP * (group.length - 1);

    if (totalWidth + totalGap <= available) {
      // 放得下：只对齐 top（同一行的基线要一致），并保证水平间距。
      const rowTop = Math.min(...group.map((element) => element.top));
      let cursor = SLIDE_MARGIN;
      for (const element of group) {
        if (element.top !== rowTop) {
          issues.push({ code: 'ROW_TOP_ALIGNED', id: element.id, from: element.top, to: rowTop });
          element.top = rowTop;
        }
        if (Math.abs(element.left - cursor) > 1) {
          issues.push({ code: 'ROW_GAP_FIXED', id: element.id, from: element.left, to: cursor });
          element.left = cursor;
        }
        cursor += element.width + MIN_GAP;
      }
      continue;
    }

    // 放不下：等分收窄，保持并排（绝不把一栏推到下一行）。
    const count = group.length;
    const each = Math.floor((available - totalGap) / count);
    if (each < 60) {
      // 太窄了，收窄也放不下有意义的内容 —— 改为纵向排列（此时推下是对的）。
      issues.push({ code: 'ROW_TOO_NARROW', size: count, each });
      continue;
    }
    const rowTop = Math.min(...group.map((element) => element.top));
    let cursor = SLIDE_MARGIN;
    for (const element of group) {
      if (element.width !== each) {
        issues.push({ code: 'ROW_WIDTH_EQUALIZED', id: element.id, from: element.width, to: each });
        element.width = each;
      }
      element.left = cursor;
      element.top = rowTop;
      cursor += each + MIN_GAP;
    }
  }

  // ── (c) 纵向落位（含最小间距） ──
  //
  // 按 group 整体落位：同排元素作为一个整体，与其它行之间保证 MIN_GAP。
  // 这样并排关系不会被破坏，行与行之间也不会挤在一起。
  const groups = [...rowGroups.values()];
  groups.sort((a, b) => Math.min(...a.map((e) => e.top)) - Math.min(...b.map((e) => e.top)));

  const placedRows = []; // { top, bottom, left, right }
  for (const group of groups) {
    const groupTop = Math.min(...group.map((element) => element.top));
    const groupBottom = Math.max(...group.map((element) => element.top + element.height));
    const groupHeight = groupBottom - groupTop;
    const groupLeft = Math.min(...group.map((element) => element.left));
    const groupRight = Math.max(...group.map((element) => element.left + element.width));

    let top = groupTop;
    for (let guard = 0; guard < placedRows.length + 4; guard += 1) {
      // 找纵向相交（考虑最小间距）且横向也相交的已落位行
      const hit = placedRows.find((other) => {
        const horizontal = Math.min(groupRight, other.right) - Math.max(groupLeft, other.left);
        if (horizontal <= 0) return false;
        // 间距不足也算撞上
        return top < other.bottom + MIN_GAP && top + groupHeight > other.top - MIN_GAP;
      });
      if (!hit) break;
      const nextTop = hit.bottom + MIN_GAP;
      top = nextTop > top ? nextTop : top + MIN_GAP;
    }

    const delta = top - groupTop;
    if (Math.abs(delta) > 0.5) {
      for (const element of group) {
        element.top += delta;
        if (group.length === 1) {
          issues.push({ code: 'OVERLAP_RESOLVED', id: element.id, from: groupTop, to: top });
        }
      }
      if (group.length > 1) {
        issues.push({ code: 'ROW_PUSHED_DOWN', ids: group.map((e) => e.id), from: groupTop, to: top });
      }
    }

    // 底部兜底：放不下就缩字号（文本）或丢弃。
    if (top + groupHeight > maxBottom) {
      for (const element of group) {
        if (element.type !== 'text') {
          dropped.add(element.id);
          issues.push({ code: 'ELEMENT_DROPPED', id: element.id, reason: 'no room at bottom' });
          continue;
        }
        const measure = measureTextContent(element.content);
        let smaller = measure.fontSize;
        let shrunk = element.height;
        let placed = false;
        for (let attempt = 0; attempt < 8 && !placed; attempt += 1) {
          smaller = Math.max(12, Math.floor(smaller * 0.85));
          shrunk = heightFor(smaller, estimateTextLines({ ...measure, fontSize: smaller }, element.width));
          const candidate = maxBottom - shrunk;
          const collides = placedRows.some((other) => {
            const horizontal = Math.min(element.left + element.width, other.right) - Math.max(element.left, other.left);
            if (horizontal <= 0) return false;
            return candidate < other.bottom + MIN_GAP && candidate + shrunk > other.top - MIN_GAP;
          });
          if (candidate >= SLIDE_MARGIN && !collides) {
            element.top = candidate;
            element.height = shrunk;
            element.content = /font-size\s*:/i.test(element.content)
              ? element.content.replace(/font-size\s*:\s*\d+(?:\.\d+)?\s*px/gi, `font-size: ${smaller}px`)
              : `<p style="font-size: ${smaller}px;">${String(element.content).replace(/<[^>]*>/g, '')}</p>`;
            issues.push({ code: 'TEXT_SHRUNK', id: element.id, to: smaller });
            placed = true;
          }
        }
        if (!placed) {
          dropped.add(element.id);
          issues.push({ code: 'ELEMENT_DROPPED', id: element.id, reason: 'no room even after shrinking' });
        }
      }
    }

    const finalElements = group.filter((element) => !dropped.has(element.id));
    if (finalElements.length > 0) {
      placedRows.push({
        top: Math.min(...finalElements.map((e) => e.top)),
        bottom: Math.max(...finalElements.map((e) => e.top + e.height)),
        left: Math.min(...finalElements.map((e) => e.left)),
        right: Math.max(...finalElements.map((e) => e.left + e.width)),
      });
    }
  }

  // 嵌套元素跟着容器平移（容器被推下时子元素一起走，保持相对位置）。
  for (const element of working) {
    const link = nestedInto.get(element.id);
    if (!link) continue;
    const outer = working.find((candidate) => candidate.id === link.outerId);
    if (!outer || dropped.has(outer.id)) {
      dropped.add(element.id);
      continue;
    }
    element.left = outer.left + link.dx;
    element.top = outer.top + link.dy;
  }

  const kept = working.filter((element) => !dropped.has(element.id));
  return { elements: kept, issues };
}
