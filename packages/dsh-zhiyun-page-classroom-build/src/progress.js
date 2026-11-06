/**
 * 「课堂生成」页的状态层：**所有状态转移都在这个文件里**。
 *
 * # 为什么单独一个文件
 *
 * 页面有三步（brief → 大纲 → 生成），其中第三步是**一条事件流**：宿主
 * `ctx.zhiyunClassroomStudio.generate(brief, opts)` 返回 `{ runId, events: AsyncIterable }`
 * （见 `docs/architecture/classroom-port.md` §4），事件一个个到达、场景一个个出现，
 * 用户还可能在中途取消或失败后重试。
 *
 * 如果把 `setState` 散在组件里，这些转移就只能靠点界面来验证；而事件流恰恰是
 * 最需要测的部分（乱序、迟到、空流、取消后迟到的 error）。所以这里全部写成纯函数：
 *
 *     reduce(state, event) -> state        // 事件流的一步
 *     reduceAll(events, state) -> state    // 整条流
 *
 * 组件只负责 `setState(prev => reduce(prev, event))`。
 *
 * # 状态形状（规范只要求这四个字段）
 *
 *     { phase, scenes, done, error }
 *
 * - `phase`：`idle`（还没开始）→ `running` → `done` / `failed` / `cancelled`；
 * - `scenes`：按**出现顺序**排列，每项 `{ id, type, title, status }`，
 *   `status` 是 `pending` / `running` / `done` / `failed` / `cancelled`；
 * - `done`：流是否已经终局（三种终局都为 true，页面据此收起「取消」）；
 * - `error`：`null` 或 `{ message, code }`。
 *
 * # 两条保守规则
 *
 * 1. **永不抛**。事件来自宿主，字段缺一半是常态；一律降级成可读状态，不能让
 *    一个坏事件把整页打白。未知事件原样返回（相同引用，省一次重渲染）。
 * 2. **终局不可逆**。取消或失败之后迟到的事件一律忽略；否则刚点完「取消」，
 *    一个在途的 `scene_done` 会把页面拉回 running，用户会以为没取消成功。
 */

export const PHASE = Object.freeze({
  idle: 'idle',
  running: 'running',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
});

export const SCENE_STATUS = Object.freeze({
  pending: 'pending',
  running: 'running',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
});

/** 规范 §1 判据里的四类场景，与 `core-classroom-agent/src/scene.js` 的 `SCENE_TYPES` 一致。 */
export const SCENE_TYPES = Object.freeze(['slide', 'quiz', 'interactive', 'pbl']);

export const SCENE_TYPE_LABELS = Object.freeze({
  slide: '讲授',
  quiz: '测验',
  interactive: '互动',
  pbl: '项目',
});

export const DEPTH_OPTIONS = Object.freeze([
  { value: 'intro', label: '入门', hint: '概念为主，少举例' },
  { value: 'standard', label: '进阶', hint: '概念 + 案例，默认' },
  { value: 'deep', label: '深入', hint: '加互动与方法边界' },
]);

export const DEFAULT_BRIEF = Object.freeze({
  topic: '',
  audience: '',
  depth: 'standard',
  attachment: null,
});

/**
 * 附件上传状态。
 *
 * 只有 `ready` 能进下一步：`uploading` 时还没有 `materialId`，硬进去等于
 * 「用户以为带了讲义，模型其实没看到」—— 这是最不该发生的一种静默错误。
 */
export const ATTACHMENT_STATUS = Object.freeze({
  uploading: 'uploading',
  ready: 'ready',
  failed: 'failed',
});

const ATTACHMENT_STATUS_SET = new Set(Object.values(ATTACHMENT_STATUS));

const TYPE_SET = new Set(SCENE_TYPES);
const TERMINAL_SCENE = new Set([
  SCENE_STATUS.done,
  SCENE_STATUS.failed,
  SCENE_STATUS.cancelled,
]);

/** 事件名兼容集。宿主契约只写了「AsyncIterable<event>」，没写 event 的形状，见 README。 */
const START_EVENTS = new Set([
  'run_start', 'run_started', 'start', 'started', 'begin',
  'generation_start', 'generation_started',
]);
const OUTLINE_EVENTS = new Set(['outline', 'outline_ready', 'plan', 'plan_ready']);
const SCENE_START_EVENTS = new Set(['scene', 'scene_start', 'scene_started', 'scene_begin']);
const SCENE_DONE_EVENTS = new Set([
  'scene_done', 'scene_end', 'scene_complete', 'scene_completed', 'scene_ready',
]);
const SCENE_ERROR_EVENTS = new Set(['scene_error', 'scene_failed']);
const DONE_EVENTS = new Set(['done', 'end', 'complete', 'completed', 'run_done', 'run_completed']);
const ERROR_EVENTS = new Set(['error', 'failed', 'run_error']);
const CANCEL_EVENTS = new Set(['cancel', 'cancelled', 'canceled', 'abort', 'aborted', 'run_cancelled']);
const RESET_EVENTS = new Set(['reset', 'restart', 'retry']);

/** 初始状态。每次返回**新数组**，避免调用方共享后误改。 */
export function initialState() {
  return { phase: PHASE.idle, scenes: [], done: false, error: null };
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function dataOf(event) {
  // `data`（上游 SSE 的 `data:` 段）与 `payload`（生成管线的字段）都认。
  // 只认 `data` 会让 payload 里的 `sceneId` / `title` 全部读不到，场景行永远无名。
  const source = event?.data ?? event?.payload;
  return source && typeof source === 'object' && source !== null ? source : {};
}

/**
 * 把一个场景相关事件读成 `{ id, title?, type? }`。
 *
 * 三层来源依次尝试：`data.scene`（嵌套对象）→ `data` 本身 → event 顶层。
 * 这是刻意宽松的：契约没定形状，宽容读法比要求宿主先改契约现实。
 */
function scenePatchOf(event, data, fallbackId) {
  const nested = data.scene && typeof data.scene === 'object' ? data.scene : null;
  const source = nested ?? data;
  const id = text(source.id)
    || text(source.sceneId)
    || text(data.sceneId)
    || text(event.sceneId)
    || fallbackId;
  const patch = { id };

  const title = text(source.title) || text(data.title) || text(event.title);
  if (title) patch.title = title;

  const type = text(source.type)
    || text(source.sceneType)
    || text(data.sceneType)
    || text(event.sceneType);
  if (type) patch.type = TYPE_SET.has(type) ? type : 'slide';

  return patch;
}

/** 事件里有没有指向某个具体场景的 id（没有时不能凭空造一个场景）。 */
function hasSceneId(event, data) {
  const nested = data.scene && typeof data.scene === 'object' ? data.scene : {};
  return Boolean(
    text(nested.id) || text(nested.sceneId)
    || text(data.id) || text(data.sceneId)
    || text(event.sceneId),
  );
}

/** 插入或更新一个场景。终局状态不被迟到事件拉回。 */
function putScene(scenes, patch, status) {
  const index = scenes.findIndex((scene) => scene.id === patch.id);
  if (index < 0) {
    return [...scenes, {
      title: patch.id,
      type: 'slide',
      ...patch,
      status,
    }];
  }

  const previous = scenes[index];
  if (TERMINAL_SCENE.has(previous.status) && previous.status !== status) return scenes;

  const merged = { ...previous, ...patch, status };
  if (merged.title === previous.title
    && merged.type === previous.type
    && merged.status === previous.status) {
    return scenes;
  }

  const next = scenes.slice();
  next[index] = merged;
  return next;
}

function settleRunning(scenes, status) {
  let changed = false;
  const next = scenes.map((scene) => {
    if (scene.status !== SCENE_STATUS.running) return scene;
    changed = true;
    return { ...scene, status };
  });
  return changed ? next : scenes;
}

function errorOf(event, data) {
  const nested = data.error && typeof data.error === 'object' ? data.error : null;
  const message = text(data.message)
    || text(event.message)
    || text(nested?.message)
    || (typeof data.error === 'string' ? text(data.error) : '')
    || '生成失败';
  const code = text(data.code)
    || text(data.kind)
    || text(nested?.code)
    || text(event.code)
    || 'GENERATE_FAILED';
  return { message, code };
}

/**
 * 事件流的一步。纯函数：不读时钟、不写日志、不改入参。
 *
 * @param {{phase: string, scenes: object[], done: boolean, error: object|null}} state
 * @param {object} event `{ type, data? }`，形状见 README「事件契约」。
 * @returns 同形状的新状态；事件不可识别时返回原引用。
 */
export function reduce(state, event) {
  const current = state ?? initialState();
  if (!event || typeof event !== 'object') return current;

  // 两套字段名都认：`type`（上游 SSE / 早期页面）与 `kind`（生成管线内部）。
  // 同时把 kebab-case 归一成 snake_case（`run-done` → `run_done`）——
  // 端到端测试踩过：只认 `type` 时整条链路是通的，但页面永远停在 idle。
  const raw = text(event.type) || text(event.kind);
  const type = raw.toLowerCase().replace(/-/g, '_');
  if (!type) return current;

  const data = dataOf(event);

  if (RESET_EVENTS.has(type)) return initialState();
  // 终局之后只接受 reset。取消后在途的 scene_done / error 不许把页面拉回去。
  if (current.done) return current;

  if (START_EVENTS.has(type)) {
    return { ...current, phase: PHASE.running, done: false };
  }

  if (OUTLINE_EVENTS.has(type)) {
    const list = Array.isArray(data.scenes) ? data.scenes
      : Array.isArray(event.scenes) ? event.scenes : null;
    if (list === null) return current;

    let scenes = current.scenes;
    list.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const patch = scenePatchOf({ type: 'outline' }, item, `scene-${index + 1}`);
      // 已经生成/在生成的场景不因为补发大纲而回退。
      if (scenes.some((scene) => scene.id === patch.id)) return;
      scenes = putScene(scenes, patch, SCENE_STATUS.pending);
    });

    return { ...current, phase: PHASE.running, scenes };
  }

  if (SCENE_START_EVENTS.has(type) || SCENE_DONE_EVENTS.has(type) || SCENE_ERROR_EVENTS.has(type)) {
    // 没有 id 的场景错误：只在当前正在跑的场景上落「失败」，不凭空造一个
    // `scene-N` 幽灵行。带 id 的按 id 更新（哪怕事件晚于该场景的终局）。
    if (SCENE_ERROR_EVENTS.has(type) && !hasSceneId(event, data)) {
      const scenes = settleRunning(current.scenes, SCENE_STATUS.failed);
      if (scenes === current.scenes) return current;
      return { ...current, phase: PHASE.running, scenes };
    }

    const patch = scenePatchOf(event, data, `scene-${current.scenes.length + 1}`);
    const status = SCENE_START_EVENTS.has(type) ? SCENE_STATUS.running
      : SCENE_DONE_EVENTS.has(type) ? SCENE_STATUS.done
        : SCENE_STATUS.failed;
    const scenes = putScene(current.scenes, patch, status);
    // 重复事件 / 终局后的迟到事件：场景没变、phase 也没变，返回原引用。
    if (scenes === current.scenes && current.phase === PHASE.running) return current;
    return { ...current, phase: PHASE.running, scenes };
  }

  if (DONE_EVENTS.has(type)) {
    // `stageId` 是「生成完的那一课」的 id：播放页/导出都按它取文档。
    // 只在 done 事件里带上，没有就保持原样（不写 `undefined` 键，免得快照比较抖动）。
    const stageId = text(data?.stageId ?? event?.payload?.stageId);
    return {
      phase: PHASE.done,
      scenes: settleRunning(current.scenes, SCENE_STATUS.done),
      done: true,
      error: null,
      ...(stageId ? { stageId } : {}),
    };
  }

  if (ERROR_EVENTS.has(type)) {
    const error = errorOf(event, data);
    // 取消在管线里是「一种 run-error」（`payload.cancelled = true`，code `E_CANCELLED`）。
    // 不把它从这里分出去，页面会把用户的主动取消画成一次失败 —— 文案与重试按钮都会错。
    const cancelled = event?.payload?.cancelled === true
      || data?.cancelled === true
      || error?.code === 'E_CANCELLED';
    return {
      phase: cancelled ? PHASE.cancelled : PHASE.failed,
      scenes: settleRunning(current.scenes, cancelled ? SCENE_STATUS.cancelled : SCENE_STATUS.failed),
      done: true,
      error: cancelled ? null : error,
    };
  }

  if (CANCEL_EVENTS.has(type)) {
    return {
      phase: PHASE.cancelled,
      scenes: settleRunning(current.scenes, SCENE_STATUS.cancelled),
      done: true,
      error: null,
    };
  }

  // 文本增量、心跳、agent 事件等与「生成了哪几个场景」无关，原样返回。
  return current;
}

/**
 * 整条流。空流 = 初始状态（不是 `done`）——「没收到任何事件」与「正常结束」
 * 必须能分辨，否则页面会把一条断掉的连接画成「已完成」。
 *
 * @param {Iterable<object>} events
 * @param {object} [state]
 */
export function reduceAll(events, state = initialState()) {
  let next = state;
  if (events === null || events === undefined) return next;
  for (const event of events) next = reduce(next, event);
  return next;
}

// ==================== 大纲（第二步）的纯函数 ====================

/**
 * brief 正规化：只收认识的字段，深度落到三档之一。
 *
 * `attachment` 三个状态：`uploading`（正在传）/ `ready`（有 materialId，能进生成）
 * / `failed`（传失败，带 error 给人看）。`materialId` 是**唯一**能进 model 的东西 ——
 * 文件名与大小只用于回显，真正喂给模型的是后端按 id 取到的字节。
 */
export function normalizeBrief(brief) {
  const source = brief && typeof brief === 'object' ? brief : {};
  const depth = DEPTH_OPTIONS.some((item) => item.value === source.depth) ? source.depth : 'standard';
  const rawAttachment = source.attachment && typeof source.attachment === 'object' ? source.attachment : null;
  const materialId = rawAttachment ? text(rawAttachment.materialId) : '';
  return {
    topic: text(source.topic),
    audience: text(source.audience),
    depth,
    attachment: rawAttachment
      ? {
        name: text(rawAttachment.name),
        size: Number.isFinite(rawAttachment.size) ? rawAttachment.size : 0,
        type: text(rawAttachment.type) || 'application/pdf',
        materialId: materialId || null,
        status: ATTACHMENT_STATUS_SET.has(rawAttachment.status)
          ? rawAttachment.status
          : (materialId ? ATTACHMENT_STATUS.ready : ATTACHMENT_STATUS.uploading),
        error: text(rawAttachment.error) || null,
      }
      : null,
  };
}

/**
 * 页面的 brief → `studio.generate` 的入参。
 *
 * 上游 `POST /api/generate-classroom` 必填的是 `requirement`（不是 `topic`）——
 * 这里用主题当需求正文，受众与深度写进 `description`，让模型知道「讲给谁、讲多深」。
 * 讲义走 `materialIds`（后端按 id 取字节再解析），**不把 PDF 正文塞进请求体**：
 * 上游明确拒绝 `pdfContent`，这里同口径。
 */
export function toGeneratePayload(brief, scenes = []) {
  const normalized = normalizeBrief(brief);
  const requirement = normalized.topic || '未命名课堂';
  const depthLabel = DEPTH_OPTIONS.find((option) => option.value === normalized.depth)?.label ?? normalized.depth;
  const description = [
    normalized.audience ? `受众：${normalized.audience}` : '',
    `深度：${depthLabel}`,
  ].filter((line) => line !== '').join('；');
  const materialIds = normalized.attachment?.materialId ? [normalized.attachment.materialId] : [];

  return {
    requirement,
    topic: requirement,
    description,
    scenes: Array.isArray(scenes) ? scenes : [],
    ...(materialIds.length > 0 ? { materialIds } : {}),
  };
}

/** 深度的三档对应的场景骨架（不含测验）。 */
function sectionsFor(depth, topic) {
  if (depth === 'intro') return [`导入：${topic}`, '核心概念'];
  if (depth === 'deep') {
    return [`导入：${topic}`, '核心概念', '案例拆解', '方法边界'];
  }
  return [`导入：${topic}`, '核心概念', '案例拆解'];
}

/**
 * brief → 初始大纲。确定性、无 LLM、无时钟，测试可以直接比对。
 *
 * 形状与 `core-classroom-agent/src/scene.js` 的 `planScenes` 对齐（`id/type/title`），
 * 但这里**不生成内容**，只给用户一个可编辑的骨架；第二步允许增删、改类型、拖序。
 */
export function createOutline(brief) {
  const normalized = normalizeBrief(brief);
  const topic = normalized.topic || '未命名课堂';
  const scenes = sectionsFor(normalized.depth, topic).map((title, index) => ({
    id: `scene-${index + 1}`,
    type: 'slide',
    title,
  }));

  if (normalized.depth === 'deep') {
    scenes.push({
      id: `scene-${scenes.length + 1}`,
      type: 'interactive',
      title: `互动：${topic}`,
    });
  }

  scenes.push({
    id: `scene-${scenes.length + 1}`,
    type: 'quiz',
    title: `随堂检测：${topic}`,
  });
  return scenes;
}

/** 把任意来源的大纲正规化成 `{ id, type, title }`，未知类型落回 slide。 */
export function normalizeOutline(scenes) {
  if (!Array.isArray(scenes)) return [];
  return scenes.map((scene, index) => {
    const source = scene && typeof scene === 'object' ? scene : {};
    return {
      id: text(source.id) || `scene-${index + 1}`,
      type: TYPE_SET.has(source.type) ? source.type : 'slide',
      title: text(source.title) || `场景 ${index + 1}`,
    };
  });
}

function nextSceneId(scenes) {
  let max = 0;
  for (const scene of scenes) {
    const match = /^scene-(\d+)$/.exec(scene.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `scene-${max + 1}`;
}

export function addOutlineScene(scenes, type = 'slide') {
  const list = Array.isArray(scenes) ? scenes : [];
  return [...list, {
    id: nextSceneId(list),
    type: TYPE_SET.has(type) ? type : 'slide',
    title: `场景 ${list.length + 1}`,
  }];
}

export function updateOutlineScene(scenes, id, patch) {
  if (!Array.isArray(scenes)) return [];
  const source = patch && typeof patch === 'object' ? patch : {};
  return scenes.map((scene) => {
    if (scene.id !== id) return scene;
    const next = { ...scene };
    if (typeof source.title === 'string') next.title = source.title;
    if (TYPE_SET.has(source.type)) next.type = source.type;
    return next;
  });
}

export function removeOutlineScene(scenes, id) {
  if (!Array.isArray(scenes)) return [];
  return scenes.filter((scene) => scene.id !== id);
}

/**
 * 拖序。越界或原地不动时返回原数组（相同引用），组件不会白重渲染。
 */
export function moveOutlineScene(scenes, from, to) {
  if (!Array.isArray(scenes)) return [];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return scenes;
  if (from < 0 || from >= scenes.length || to < 0 || to >= scenes.length) return scenes;
  if (from === to) return scenes;
  const next = scenes.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 第二步是否可前进：至少一个场景，且每个都有非空标题。 */
export function outlineReady(scenes) {
  return Array.isArray(scenes)
    && scenes.length > 0
    && scenes.every((scene) => text(scene?.title).length > 0);
}

/** 第一步是否可前进：主题必填。 */
/** 能不能进下一步：主题非空，且附件（若有）不在上传中/失败状态。 */
export function briefReady(brief) {
  if (text(brief?.topic).length === 0) return false;
  const attachment = brief?.attachment;
  if (attachment && typeof attachment === 'object') {
    const status = attachment.status;
    if (status && status !== ATTACHMENT_STATUS.ready) return false;
  }
  return true;
}

/** 给进度条用的计数（页面只读，不参与状态转移）。 */
export function summarize(state) {
  const scenes = Array.isArray(state?.scenes) ? state.scenes : [];
  return {
    total: scenes.length,
    done: scenes.filter((scene) => scene.status === SCENE_STATUS.done).length,
    failed: scenes.filter((scene) => scene.status === SCENE_STATUS.failed).length,
    running: scenes.filter((scene) => scene.status === SCENE_STATUS.running).length,
  };
}
