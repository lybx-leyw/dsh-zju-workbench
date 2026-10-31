// 源：ref/OpenMAIC/lib/action/engine.ts:229-292,465-867（动作如何落到画布）
// 源：ref/OpenMAIC/lib/whiteboard/runtime/fold.ts:51-216（纯函数折叠）
/**
 * 舞台动作账本：**有序、可重放、纯函数折叠**。
 *
 * # 为什么是账本而不是状态快照
 *
 * 上游的舞台状态是十几个散在 zustand store 里的字段（画布效果、白板、播放
 * 游标……），回放靠把动作重新 `execute()` 一遍。那种做法的终态取决于**执行
 * 时序与浏览器环境**：同一批动作，一次在浏览器里跑、一次在 Node 里跑，结果
 * 可能不同，于是「重放」不可证。
 *
 * 这里改成一个动作日志 + 一个纯折叠函数：`foldRecords(records)` 只读记录，
 * 不碰时钟、不碰 DOM、不碰随机数，因此同一份账本在任何环境下的终态逐字节
 * 相同。宿主半边用它算 `ledger(runId).state`，浏览器半边用它算逐帧快照。
 *
 * # 与上游语义的对应
 *
 * 每个 `wb_*` 分支都是 `ActionEngine.executeWb*` 里「字段搬运」那一段的直译，
 * 包括容易漏的隐式行为：
 *   - 除 `wb_open` / `wb_close` 之外的任何 `wb_*` 都会**自动开门**（上游
 *     `ensureWhiteboardOpen`，`engine.ts:449-454`）；
 *   - `wb_draw_text` 的内容看起来像公式时，动作**被提升成** `wb_draw_latex`
 *     （`engine.ts:472-482`）；
 *   - `wb_clear` 在板上没有元素时什么都不做（`engine.ts:839-841`），
 *     `wb_edit_code` 找不到元素/行时静默返回（`engine.ts:760-810`）。
 *
 * # 一处刻意的偏离：代码行 id
 *
 * 上游新增代码行用 `L_${++counter}_${Date.now().toString(36)}`
 * （`engine.ts:127-131`）—— `Date.now()` 让重放不可复现。账本里改用
 * `L_${seq}_${行号}`：`seq` 是动作在账本里的序号，天然唯一且稳定。
 *
 * 源：ref/OpenMAIC/lib/action/engine.ts:229-292（dispatch 总表）
 * 源：ref/OpenMAIC/lib/action/engine.ts:465-867（白板各分支）
 * 源：ref/OpenMAIC/lib/action/engine.ts:77-125（latex 识别 / 代码行拆分）
 * 源：ref/OpenMAIC/lib/whiteboard/runtime/fold.ts:51-216（纯折叠）
 */

import {
  buildLineElement,
  buildShapeElement,
  createWhiteboard,
} from './geometry.js';

/**
 * 账本认得的全部动作类型：上游 `Action['type']` 的 21 个，加上舞台自己的
 * `scene_switch`（上游这是回调 `onSceneChange`，不是动作；账本要重放「切场景」
 * 这件事，只能把它落成一条记录）。
 */
export const STAGE_ACTION_TYPES = Object.freeze([
  'scene_switch',
  'spotlight',
  'laser',
  'speech',
  'play_video',
  'discussion',
  'wb_open',
  'wb_close',
  'wb_clear',
  'wb_delete',
  'wb_draw_text',
  'wb_draw_shape',
  'wb_draw_chart',
  'wb_draw_latex',
  'wb_draw_table',
  'wb_draw_line',
  'wb_draw_code',
  'wb_edit_code',
  'widget_highlight',
  'widget_setState',
  'widget_annotation',
  'widget_reveal',
]);

/**
 * 「舞台执行侧」真正落到画布上的动作：15 种。
 *
 * 剩下的 7 种（`speech` / `play_video` / `discussion` / `widget_*`）依赖音频、
 * `<video>`、智能体会话或 iframe `postMessage`，静态渲染既不能也不该执行它们；
 * 账本照样**记录**（否则动作流与上游对不上），折叠时标记为 `skipped:passthrough`。
 */
export const STAGE_EXECUTED_TYPES = Object.freeze([
  'scene_switch',
  'spotlight',
  'laser',
  'wb_open',
  'wb_close',
  'wb_clear',
  'wb_delete',
  'wb_draw_text',
  'wb_draw_shape',
  'wb_draw_chart',
  'wb_draw_latex',
  'wb_draw_table',
  'wb_draw_line',
  'wb_draw_code',
  'wb_edit_code',
]);

/** 记账但不执行的动作。 */
export const STAGE_PASSTHROUGH_TYPES = Object.freeze(
  STAGE_ACTION_TYPES.filter((type) => !STAGE_EXECUTED_TYPES.includes(type)),
);

const EXECUTED = new Set(STAGE_EXECUTED_TYPES);
const PASSTHROUGH = new Set(STAGE_PASSTHROUGH_TYPES);
const KNOWN = new Set(STAGE_ACTION_TYPES);

/**
 * @param {unknown} type
 * @returns {boolean}
 */
export function isStageActionType(type) {
  return typeof type === 'string' && KNOWN.has(type);
}

/**
 * @param {unknown} type
 * @returns {boolean}
 */
export function isExecutedActionType(type) {
  return typeof type === 'string' && EXECUTED.has(type);
}

/**
 * @param {unknown} type
 * @returns {boolean}
 */
export function isPassthroughActionType(type) {
  return typeof type === 'string' && PASSTHROUGH.has(type);
}

const COMMON_LATEX_COMMAND = /\\(?:alpha|beta|cdot|delta|dfrac|frac|gamma|infty|int|lambda|left|lim|mu|neq|omega|pi|pm|prod|rightarrow|right|sigma|sqrt|sum|text|tfrac|theta|times)\b/;

/**
 * 剥掉 `$$…$$` / `$…$` 分隔符。返回 `null` 表示「没有分隔符」。
 *
 * @param {string} content
 * @returns {string | null}
 */
export function getDelimitedLatex(content) {
  const trimmed = String(content ?? '').trim();
  if (trimmed.length > 4 && trimmed.startsWith('$$') && trimmed.endsWith('$$')) {
    return trimmed.slice(2, -2).trim();
  }
  if (
    trimmed.length > 2
    && trimmed.startsWith('$')
    && trimmed.endsWith('$')
    && !trimmed.startsWith('$$')
    && !trimmed.endsWith('$$')
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return null;
}

/**
 * 判断一段白板文本其实是公式（上游 `getLikelyLatexMath`，逐条规则照搬）。
 *
 * @param {string} content
 * @returns {string | null} 命中则返回 latex 正文
 */
export function getLikelyLatexMath(content) {
  const trimmed = String(content ?? '').trim();
  if (!trimmed || trimmed.startsWith('<')) return null;

  const delimited = getDelimitedLatex(trimmed);
  if (delimited !== null) return delimited;
  if (/^[A-Za-z]:\\/.test(trimmed)) return null;
  if (COMMON_LATEX_COMMAND.test(trimmed) || /[_^]\{/.test(trimmed)) return trimmed;

  const commands = trimmed.match(/\\[A-Za-z]+/g) ?? [];
  if (commands.length === 0) return null;
  if (commands.length === 1) {
    return /\\[A-Za-z]+\s*\{[^{}]*\}/.test(trimmed) ? trimmed : null;
  }
  if (!/[=+\-*/^_{}]/.test(trimmed)) return null;

  const commandCharacters = commands.reduce((total, command) => total + command.length, 0);
  return commandCharacters / trimmed.length >= 0.15 ? trimmed : null;
}

/**
 * 账本折叠出的舞台状态。字段全部是 JSON 可序列化的平凡值，
 * 因此「重放得到的终态」可以直接深比较。
 *
 * @returns {object}
 */
export function emptyStageState() {
  return {
    /** 当前场景 id；`null` 表示还没切过场景。 */
    sceneId: null,
    /** 访问过的场景 id，按首次进入顺序。 */
    sceneTrail: [],
    whiteboard: { ...createWhiteboard(), open: false },
    effects: {
      /** @type {{elementId: string|null, dimOpacity: number} | null} */
      spotlight: null,
      /** @type {{elementId: string|null, color: string} | null} */
      laser: null,
    },
    /** 真正落到画布上的动作条数。 */
    applied: 0,
    /** 记账但因依赖浏览器/音频/iframe 而未执行的动作条数。 */
    skipped: 0,
    /** 逐条动作的执行结果，形如 `{seq, type, outcome}`。 */
    events: [],
    /** 折叠过程中被吞下的错误（`outcome: 'skipped:error'` 对应的原因）。 */
    errors: [],
  };
}

/**
 * 深冻结（折叠结果是共享只读快照，调用方不该改它）。
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

/**
 * 元素的 id：动作给了就用，没给就用 `el_<seq>`。
 * 上游给空串，由 store 现场生成随机 id —— 那是重放不可复现的第二个来源。
 *
 * @param {object} action
 * @param {{seq: number}} record
 * @returns {string}
 */
function elementId(action, record) {
  return typeof action.elementId === 'string' && action.elementId.length > 0
    ? action.elementId
    : `el_${record.seq}`;
}

/**
 * 隐式开板：除 `wb_open` / `wb_close` 外的 `wb_*` 都会先开门。
 *
 * @param {object} state 正在构建的下一个状态
 * @param {object} action
 * @returns {void}
 */
function ensureWhiteboardOpen(state, action) {
  if (action.type === 'wb_open' || action.type === 'wb_close') return;
  if (action.type.startsWith('wb_')) state.whiteboard.open = true;
}

/**
 * 向当前板追加元素；同 id 已存在时跳过（上游 `element_added` 折叠会抛
 * `ELEMENT_ALREADY_EXISTS`，账本选择「跳过并记账」，否则一条脏记录会让整场
 * 重放失败）。
 *
 * @param {object} state
 * @param {object} element
 * @returns {string} outcome
 */
function pushElement(state, element) {
  if (state.whiteboard.elements.some((candidate) => candidate.id === element.id)) {
    return 'skipped:duplicate-element';
  }
  state.whiteboard.elements.push(element);
  return 'applied';
}

const DEFAULT_CHART_COLORS = Object.freeze(['#5b9bd5', '#ed7d31', '#a5a5a5', '#ffc000', '#4472c4']);

/**
 * 代码行编辑：`insert_after` / `insert_before` / `delete_lines` / `replace_lines`。
 * 语义逐条对齐 `executeWbEditCode`，只把行 id 的来源换成 `seq`（见文件头）。
 *
 * @param {object[]} lines 现有行
 * @param {object} action
 * @param {number} seq
 * @returns {{lines: object[], outcome: string}}
 */
function editCodeLines(lines, action, seq) {
  const content = typeof action.content === 'string' && action.content.length > 0
    ? action.content.split('\n')
    : [];
  const supplied = Array.isArray(action.newLineIds) && action.newLineIds.length === content.length
    ? action.newLineIds
    : content.map((_line, index) => `L_${seq}_${index + 1}`);

  switch (action.operation) {
    case 'insert_after': {
      const index = lines.findIndex((line) => line.id === action.lineId);
      if (index === -1) return { lines, outcome: 'skipped:missing-line' };
      const introduced = content.map((text, i) => ({ id: supplied[i], content: text }));
      const next = [...lines];
      next.splice(index + 1, 0, ...introduced);
      return { lines: next, outcome: 'applied' };
    }
    case 'insert_before': {
      const index = lines.findIndex((line) => line.id === action.lineId);
      if (index === -1) return { lines, outcome: 'skipped:missing-line' };
      const introduced = content.map((text, i) => ({ id: supplied[i], content: text }));
      const next = [...lines];
      next.splice(index, 0, ...introduced);
      return { lines: next, outcome: 'applied' };
    }
    case 'delete_lines': {
      if (!Array.isArray(action.lineIds) || action.lineIds.length === 0) {
        return { lines, outcome: 'skipped:empty' };
      }
      const drop = new Set(action.lineIds);
      return { lines: lines.filter((line) => !drop.has(line.id)), outcome: 'applied' };
    }
    case 'replace_lines': {
      if (!Array.isArray(action.lineIds) || action.lineIds.length === 0) {
        return { lines, outcome: 'skipped:empty' };
      }
      const drop = new Set(action.lineIds);
      const first = lines.findIndex((line) => drop.has(line.id));
      if (first === -1) return { lines, outcome: 'skipped:missing-line' };
      const kept = lines.filter((line) => !drop.has(line.id));
      // 复用被替换行的 id，多出来的新行用新 id —— 与上游 `replace_lines` 一致。
      const introduced = content.map((text, i) => ({
        id: i < action.lineIds.length ? action.lineIds[i] : supplied[i],
        content: text,
      }));
      const next = [...kept];
      next.splice(first, 0, ...introduced);
      return { lines: next, outcome: 'applied' };
    }
    default:
      return { lines, outcome: 'skipped:unknown-operation' };
  }
}

/**
 * 把**一条**已校验的动作落到状态上（原地改传入的状态，调用方负责先克隆）。
 *
 * @param {object} state 可变状态
 * @param {object} action 动作负载
 * @param {{seq: number}} record 账本记录（需要 seq 派生稳定 id）
 * @returns {string} outcome
 */
function applyAction(state, action, record) {
  const type = action.type;

  if (PASSTHROUGH.has(type)) return 'skipped:passthrough';
  if (!EXECUTED.has(type)) return 'skipped:unknown';

  if (type === 'scene_switch') {
    const sceneId = typeof action.sceneId === 'string' ? action.sceneId : null;
    state.sceneId = sceneId;
    if (sceneId !== null && state.sceneTrail[state.sceneTrail.length - 1] !== sceneId) {
      state.sceneTrail.push(sceneId);
    }
    // 上游在场景边界调 `clearEffects()`（playback/engine.ts:579-585）。
    state.effects.spotlight = null;
    state.effects.laser = null;
    return 'applied:scene';
  }

  if (type === 'spotlight') {
    state.effects.spotlight = {
      elementId: typeof action.elementId === 'string' ? action.elementId : null,
      dimOpacity: Number.isFinite(Number(action.dimOpacity)) ? Number(action.dimOpacity) : 0.5,
    };
    return 'applied:effect';
  }

  if (type === 'laser') {
    state.effects.laser = {
      elementId: typeof action.elementId === 'string' ? action.elementId : null,
      color: typeof action.color === 'string' ? action.color : '#ff0000',
    };
    return 'applied:effect';
  }

  if (type.startsWith('wb_')) ensureWhiteboardOpen(state, action);

  if (type === 'wb_open') {
    state.whiteboard.open = true;
    return 'applied';
  }

  if (type === 'wb_close') {
    state.whiteboard.open = false;
    return 'applied';
  }

  if (type === 'wb_clear') {
    if (state.whiteboard.elements.length === 0) return 'skipped:empty';
    state.whiteboard.elements = [];
    return 'applied';
  }

  if (type === 'wb_delete') {
    const index = state.whiteboard.elements.findIndex((el) => el.id === action.elementId);
    if (index === -1) return 'skipped:missing-element';
    state.whiteboard.elements.splice(index, 1);
    return 'applied';
  }

  if (type === 'wb_edit_code') {
    const index = state.whiteboard.elements.findIndex((el) => el.id === action.elementId);
    if (index === -1) return 'skipped:missing-element';
    const element = state.whiteboard.elements[index];
    if (element.type !== 'code') return 'skipped:not-code';
    const edited = editCodeLines(element.lines, action, record.seq);
    if (edited.outcome !== 'applied') return edited.outcome;
    state.whiteboard.elements[index] = { ...element, lines: edited.lines };
    return 'applied:edit';
  }

  const id = elementId(action, record);

  if (type === 'wb_draw_text') {
    const content = typeof action.content === 'string' ? action.content : '';
    if (!content) return 'skipped:empty';
    const latex = getLikelyLatexMath(content);
    if (latex !== null) {
      return pushElement(state, {
        id,
        type: 'latex',
        left: Number(action.x) || 0,
        top: Number(action.y) || 0,
        width: Number.isFinite(Number(action.width)) ? Number(action.width) : 400,
        height: Number.isFinite(Number(action.height)) ? Number(action.height) : 80,
        rotate: 0,
        latex,
        color: typeof action.color === 'string' ? action.color : '#000000',
        fixedRatio: true,
      });
    }
    const fontSize = Number.isFinite(Number(action.fontSize)) ? Number(action.fontSize) : 18;
    const html = content.startsWith('<')
      ? content
      : `<p style="font-size: ${fontSize}px;">${content}</p>`;
    return pushElement(state, {
      id,
      type: 'text',
      content: html,
      left: Number(action.x) || 0,
      top: Number(action.y) || 0,
      width: Number.isFinite(Number(action.width)) ? Number(action.width) : 400,
      height: Number.isFinite(Number(action.height)) ? Number(action.height) : 100,
      rotate: 0,
      defaultFontName: 'Microsoft YaHei',
      defaultColor: typeof action.color === 'string' ? action.color : '#333333',
    });
  }

  if (type === 'wb_draw_shape') {
    return pushElement(state, buildShapeElement({ id, action }));
  }

  if (type === 'wb_draw_chart') {
    return pushElement(state, {
      id,
      type: 'chart',
      left: Number(action.x) || 0,
      top: Number(action.y) || 0,
      width: Number(action.width) || 400,
      height: Number(action.height) || 300,
      rotate: 0,
      chartType: action.chartType ?? 'bar',
      data: action.data ?? [],
      themeColors: Array.isArray(action.themeColors) && action.themeColors.length > 0
        ? [...action.themeColors]
        : [...DEFAULT_CHART_COLORS],
    });
  }

  if (type === 'wb_draw_latex') {
    return pushElement(state, {
      id,
      type: 'latex',
      left: Number(action.x) || 0,
      top: Number(action.y) || 0,
      width: Number.isFinite(Number(action.width)) ? Number(action.width) : 400,
      height: Number.isFinite(Number(action.height)) ? Number(action.height) : 80,
      rotate: 0,
      latex: typeof action.latex === 'string' ? action.latex : '',
      color: typeof action.color === 'string' ? action.color : '#000000',
      fixedRatio: true,
    });
  }

  if (type === 'wb_draw_table') {
    const data = Array.isArray(action.data) ? action.data : [];
    const rows = data.length;
    const cols = rows > 0 && Array.isArray(data[0]) ? data[0].length : 0;
    if (rows === 0 || cols === 0) return 'skipped:empty';
    let cellId = 0;
    const tableData = data.map((row) => (Array.isArray(row) ? row : []).map((text) => ({
      id: `cell_${cellId++}`,
      colspan: 1,
      rowspan: 1,
      text,
    })));
    return pushElement(state, {
      id,
      type: 'table',
      left: Number(action.x) || 0,
      top: Number(action.y) || 0,
      width: Number(action.width) || 600,
      height: Number(action.height) || 300,
      rotate: 0,
      colWidths: Array(cols).fill(1 / cols),
      cellMinHeight: 36,
      data: tableData,
      outline: action.outline ?? { width: 2, style: 'solid', color: '#eeece1' },
      theme: action.theme
        ? {
          color: action.theme.color,
          rowHeader: true,
          rowFooter: false,
          colHeader: false,
          colFooter: false,
        }
        : undefined,
    });
  }

  if (type === 'wb_draw_line') {
    return pushElement(state, buildLineElement({ id, action }));
  }

  if (type === 'wb_draw_code') {
    const code = typeof action.code === 'string' ? action.code : '';
    let lines = code.split('\n').map((content, index) => ({ id: `L${index + 1}`, content }));
    if (Array.isArray(action.lineIds) && action.lineIds.length === lines.length) {
      lines = lines.map((line, index) => ({ ...line, id: action.lineIds[index] }));
    }
    return pushElement(state, {
      id,
      type: 'code',
      language: action.language ?? 'text',
      lines,
      fileName: action.fileName,
      showLineNumbers: true,
      fontSize: 14,
      left: Number(action.x) || 0,
      top: Number(action.y) || 0,
      width: Number.isFinite(Number(action.width)) ? Number(action.width) : 500,
      height: Number.isFinite(Number(action.height)) ? Number(action.height) : 300,
      rotate: 0,
    });
  }

  return 'skipped:unknown';
}

/**
 * 克隆一份状态（arrays / 元素也复制，避免记录间共享引用）。
 *
 * @param {object} state
 * @returns {object}
 */
function cloneState(state) {
  return {
    sceneId: state.sceneId,
    sceneTrail: [...state.sceneTrail],
    whiteboard: {
      ...state.whiteboard,
      elements: state.whiteboard.elements.map((element) => ({ ...element })),
    },
    effects: { ...state.effects },
    applied: state.applied,
    skipped: state.skipped,
    events: [...state.events],
    errors: [...(state.errors ?? [])],
  };
}

/**
 * 折叠一条记录，返回**新**状态（不修改入参）。
 *
 * 这是宿主 `ledger()` 与客户端逐帧重放共用的唯一入口：两边算出的状态必须逐
 * 字段相同，否则「账本能重放」就是一句空话。
 *
 * @param {object} state 前一条记录之后的状态
 * @param {{seq: number, payload: object}} record
 * @returns {object}
 */
export function applyRecord(state, record) {
  const next = cloneState(state);
  const action = record && typeof record.payload === 'object' && record.payload !== null
    ? record.payload
    : {};
  let outcome;
  try {
    outcome = applyAction(next, action, { seq: Number(record?.seq) || 0 });
  } catch (error) {
    // 一条坏记录不该让整场重放崩掉：记成 skipped，把原因留在 detail 上。
    outcome = 'skipped:error';
    next.errors = [...(next.errors ?? []), { seq: record?.seq ?? null, code: error?.code ?? null, message: error?.message ?? String(error) }];
  }
  next.events.push({ seq: record?.seq ?? null, type: action.type ?? null, outcome });
  if (outcome.startsWith('applied')) next.applied += 1;
  else next.skipped += 1;
  return next;
}

/**
 * 写入账本**之前**的负载校验：只查「不合法就一定会让画布状态坏掉」的那几种。
 *
 * 目前只有形状：白名单 + 路径几何 + 尺寸（上游在 `execute()` 一开始就拦，
 * `engine.ts:229-232`）。校验放在这里而不是折叠里，是因为账本一旦落库就不该
 * 出现「折叠时才发现这条记录画不出来」的情况。
 *
 * @param {object} action
 * @returns {void}
 * @throws {StageActionError}
 */
export function assertActionPayload(action) {
  if (action.type === 'wb_draw_shape') {
    // 只借它的校验：返回值丢弃，错了会抛 `E_LEGACY_SHAPE` / `E_SHAPE_GEOMETRY`。
    buildShapeElement({ id: 'probe', action });
  }
}

/**
 * 从零开始重放一整本账。
 *
 * @param {Array<{seq: number, payload: object}>} records 按 seq 升序的记录
 * @returns {object} 终态
 */
export function foldRecords(records) {
  const list = Array.isArray(records) ? records : [];
  let state = emptyStageState();
  for (const record of list) state = applyRecord(state, record);
  return state;
}
