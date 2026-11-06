/**
 * 请求契约 —— 上游 `runtime/request_contracts.py` 的 JS 对位。
 *
 * # 为什么要在这里重写 pydantic
 *
 * 上游用 pydantic 的 `model_config = ConfigDict(extra="forbid")`：客户端多传一个
 * 字段就直接 400。这条规则是**产品行为**，不是实现细节 —— 前端与 API 客户端
 * 靠它尽早发现自己拼错了字段名，而不是让那个字段安静地被忽略、然后表现为
 * "设置没生效"。
 *
 * 所以这里的校验器必须做到 pydantic 的三件事：
 * 1. 未知字段 → 拒绝（`extra="forbid"`）；
 * 2. 类型/边界 → 拒绝（`ge` / `le` / `min_length` / `max_length` / `Literal`）；
 * 3. 通过后 `model_dump(exclude_none=True)`：**不输出**没给的字段，
 *    让调用方看到的就是"用户真的设了什么"。
 *
 * # 出题链只关心一个
 *
 * `DeepQuestionRequestConfig`。其余能力的契约照搬，是因为
 * `CAPABILITY_REQUEST_SCHEMAS` 是对外公开的元数据（前端拿它渲染表单），
 * 少一个就少一个表单。
 */

import { CapabilityPrerequisiteError } from './capability.js';

/** 未知字段一律拒绝的"无选项"契约基类。 */
function emptyConfig(rawConfig) {
  const cleaned = cleanPublicConfig(rawConfig);
  const unknown = Object.keys(cleaned);
  if (unknown.length > 0) {
    throw new Error(`Invalid config: unexpected field(s) ${unknown.join(', ')}`);
  }
  return {};
}

function cleanPublicConfig(rawConfig) {
  if (rawConfig === null || rawConfig === undefined) return {};
  if (typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new CapabilityPrerequisiteError('Capability config must be an object.');
  }
  return { ...rawConfig };
}

function checkUnknownFields(cleaned, allowed, label) {
  const unknown = Object.keys(cleaned).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`Invalid ${label} config: ${unknown.join(', ')}: Unexpected field`);
  }
}

function fieldErrors(entries) {
  const details = entries.map(([loc, message]) => `${loc}: ${message}`).join('; ');
  return details;
}

function requireIntInRange(value, { loc, min, max }) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return [`${loc}: Input should be a valid integer`];
  }
  if (min !== undefined && value < min) return [`${loc}: Input should be greater than or equal to ${min}`];
  if (max !== undefined && value > max) return [`${loc}: Input should be less than or equal to ${max}`];
  return [];
}

function requireString(value, { loc, minLength, maxLength }) {
  if (typeof value !== 'string') return [`${loc}: Input should be a valid string`];
  if (minLength !== undefined && value.length < minLength) {
    return [`${loc}: String should have at least ${minLength} characters`];
  }
  if (maxLength !== undefined && value.length > maxLength) {
    return [`${loc}: String should have at most ${maxLength} characters`];
  }
  return [];
}

function requireLiteral(value, allowed, loc) {
  if (!allowed.includes(value)) {
    return [`${loc}: Input should be ${allowed.join(' or ')}`];
  }
  return [];
}

const RENDER_MODE_RE = /^[a-z][a-z0-9_.-]{1,63}$/;

/**
 * 出题请求契约。
 *
 * 字段与默认值逐字对应上游 `DeepQuestionRequestConfig`：
 * `mode:"custom"`、`topic:""`、`num_questions:1 (1..50)`、`difficulty:""`、
 * `question_types:[]`、`per_type_counts:{}`、`paper_path:""`、`max_questions:10 (1..100)`。
 *
 * `per_type_counts` 的总和约束**不在**这里校验：上游把它交给流水线
 * （`_normalize_per_type_counts` 会按允许类型过滤并重新分配），在这里拒绝会让
 * 前端"多选题型时暂时不同步"的中间态直接 400。
 */
export const DEEP_QUESTION_FIELDS = Object.freeze([
  'mode',
  'topic',
  'num_questions',
  'difficulty',
  'question_types',
  'per_type_counts',
  'paper_path',
  'max_questions',
]);

export function validateDeepQuestionRequestConfig(rawConfig) {
  const cleaned = cleanPublicConfig(rawConfig);
  const label = 'deep question';
  checkUnknownFields(cleaned, DEEP_QUESTION_FIELDS, label);

  const errors = [];
  const out = {};

  const mode = cleaned.mode ?? 'custom';
  const modeErrors = requireLiteral(mode, ['custom', 'mimic'], 'mode');
  if (modeErrors.length > 0) errors.push(...modeErrors);
  else out.mode = mode;

  const topic = cleaned.topic ?? '';
  const topicErrors = requireString(topic, { loc: 'topic' });
  if (topicErrors.length > 0) errors.push(...topicErrors);
  else out.topic = topic;

  const numQuestions = cleaned.num_questions ?? 1;
  const nqErrors = requireIntInRange(numQuestions, { loc: 'num_questions', min: 1, max: 50 });
  if (nqErrors.length > 0) errors.push(...nqErrors);
  else out.num_questions = numQuestions;

  const difficulty = cleaned.difficulty ?? '';
  const diffErrors = requireString(difficulty, { loc: 'difficulty' });
  if (diffErrors.length > 0) errors.push(...diffErrors);
  else out.difficulty = difficulty;

  const questionTypes = cleaned.question_types ?? [];
  if (!Array.isArray(questionTypes) || questionTypes.some((item) => typeof item !== 'string')) {
    errors.push('question_types: Input should be a valid list of strings');
  } else {
    out.question_types = [...questionTypes];
  }

  const perType = cleaned.per_type_counts ?? {};
  if (typeof perType !== 'object' || Array.isArray(perType)) {
    errors.push('per_type_counts: Input should be a valid dictionary');
  } else if (Object.values(perType).some((value) => !Number.isInteger(value))) {
    errors.push('per_type_counts: Input should be a valid dictionary of integers');
  } else {
    out.per_type_counts = { ...perType };
  }

  const paperPath = cleaned.paper_path ?? '';
  const paperErrors = requireString(paperPath, { loc: 'paper_path' });
  if (paperErrors.length > 0) errors.push(...paperErrors);
  else out.paper_path = paperPath;

  const maxQuestions = cleaned.max_questions ?? 10;
  const mqErrors = requireIntInRange(maxQuestions, { loc: 'max_questions', min: 1, max: 100 });
  if (mqErrors.length > 0) errors.push(...mqErrors);
  else out.max_questions = maxQuestions;

  if (errors.length > 0) {
    throw new Error(`Invalid ${label} config: ${fieldErrors(errors.map((message) => [message.split(':')[0], message.slice(message.indexOf(':') + 1).trim()]))}`);
  }
  return out;
}

export function validateVisualizeRequestConfig(rawConfig) {
  const cleaned = cleanPublicConfig(rawConfig);
  checkUnknownFields(cleaned, ['render_mode', 'quality', 'style_hint'], 'visualize');
  const errors = [];
  const out = {};

  const renderModeRaw = cleaned.render_mode ?? 'auto';
  if (typeof renderModeRaw !== 'string') {
    errors.push(['render_mode', 'Input should be a valid string']);
  } else {
    const normalized = renderModeRaw.trim().toLowerCase();
    if (normalized.length < 2 || normalized.length > 64) {
      errors.push(['render_mode', 'String should have at least 2 characters']);
    } else if (normalized !== 'auto' && !RENDER_MODE_RE.test(normalized)) {
      errors.push(['render_mode', "Value error, must be 'auto' or a valid visualizer id"]);
    } else {
      out.render_mode = normalized;
    }
  }

  const quality = cleaned.quality ?? 'medium';
  const qualityErrors = requireLiteral(quality, ['low', 'medium', 'high'], 'quality');
  if (qualityErrors.length > 0) errors.push(['quality', qualityErrors[0].split(': ').slice(1).join(': ')]);
  else out.quality = quality;

  const styleHint = cleaned.style_hint ?? '';
  const styleErrors = requireString(styleHint, { loc: 'style_hint', maxLength: 500 });
  if (styleErrors.length > 0) errors.push(['style_hint', styleErrors[0].split(': ').slice(1).join(': ')]);
  else out.style_hint = styleHint;

  if (errors.length > 0) throw new Error(`Invalid visualize config: ${fieldErrors(errors)}`);
  return out;
}

/**
 * 每个内建能力的校验器。
 *
 * 键的集合与上游 `CAPABILITY_CONFIG_MODELS` 一致；`audio_overview` /
 * `deep_research` / `math_animator` 在上游有各自的请求模型，但那条链路不在
 * 出题重构范围内，这里给它们"无选项"契约 —— 至少保证未知字段仍然被拒绝，
 * 而不会静默忽略。
 */
export const CAPABILITY_CONFIG_VALIDATORS = Object.freeze({
  audio_overview: (raw) => emptyConfig(raw),
  chat: (raw) => emptyConfig(raw),
  ask_questions: (raw) => emptyConfig(raw),
  deep_solve: (raw) => emptyConfig(raw),
  deep_question: validateDeepQuestionRequestConfig,
  deep_research: (raw) => emptyConfig(raw),
  math_animator: (raw) => emptyConfig(raw),
  visualize: validateVisualizeRequestConfig,
  mastery_path: (raw) => emptyConfig(raw),
  immersive_reading: (raw) => emptyConfig(raw),
  course_study: (raw) => emptyConfig(raw),
});

/** 每个能力对外的 JSON Schema（前端据此渲染表单）。 */
export const CAPABILITY_REQUEST_SCHEMAS = Object.freeze({
  audio_overview: { type: 'object', properties: {}, additionalProperties: false },
  chat: { type: 'object', properties: {}, additionalProperties: false },
  ask_questions: { type: 'object', properties: {}, additionalProperties: false },
  deep_solve: { type: 'object', properties: {}, additionalProperties: false },
  deep_question: {
    type: 'object',
    properties: {
      mode: { enum: ['custom', 'mimic'], default: 'custom', title: 'Mode', type: 'string' },
      topic: { default: '', title: 'Topic', type: 'string' },
      num_questions: {
        default: 1,
        maximum: 50,
        minimum: 1,
        title: 'Num Questions',
        type: 'integer',
      },
      difficulty: { default: '', title: 'Difficulty', type: 'string' },
      question_types: { items: { type: 'string' }, title: 'Question Types', type: 'array' },
      per_type_counts: {
        additionalProperties: { type: 'integer' },
        title: 'Per Type Counts',
        type: 'object',
      },
      paper_path: { default: '', title: 'Paper Path', type: 'string' },
      max_questions: {
        default: 10,
        maximum: 100,
        minimum: 1,
        title: 'Max Questions',
        type: 'integer',
      },
    },
    required: [],
    additionalProperties: false,
  },
  deep_research: { type: 'object', properties: {}, additionalProperties: false },
  math_animator: { type: 'object', properties: {}, additionalProperties: false },
  visualize: {
    type: 'object',
    properties: {
      render_mode: {
        default: 'auto',
        maxLength: 64,
        minLength: 2,
        title: 'Render Mode',
        type: 'string',
      },
      quality: { default: 'medium', enum: ['low', 'medium', 'high'], type: 'string' },
      style_hint: { default: '', maxLength: 500, type: 'string' },
    },
    required: [],
    additionalProperties: false,
  },
  mastery_path: { type: 'object', properties: {}, additionalProperties: false },
  immersive_reading: { type: 'object', properties: {}, additionalProperties: false },
  course_study: { type: 'object', properties: {}, additionalProperties: false },
});

/**
 * 校验任意能力的配置。
 *
 * 未知能力**不报错**，只清理后返回原样 —— 插件可以自定契约，
 * 而这一层是公共入口，不该替它拒绝。
 */
export function validateCapabilityConfig(capability, rawConfig) {
  const validator = CAPABILITY_CONFIG_VALIDATORS[capability];
  if (validator === undefined) return cleanPublicConfig(rawConfig);
  return validator(rawConfig);
}

export function getCapabilityRequestSchema(capability) {
  return { ...(CAPABILITY_REQUEST_SCHEMAS[capability] ?? {}) };
}

export { cleanPublicConfig };
