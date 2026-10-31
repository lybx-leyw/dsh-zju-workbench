// 源：ref/OpenMAIC/lib/chat/pi/tools/classroom-actions.ts:1-818
/**
 * 动作层：允许集过滤、参数归一化、运行时校验状态机、以及动作事件的产出。
 *
 * 源：ref/OpenMAIC/lib/chat/pi/tool-schemas.ts:13-22（getEffectiveActions）
 * 源：ref/OpenMAIC/lib/chat/pi/tools/classroom-actions.ts:1-818（逐块搬运）
 * 源：ref/OpenMAIC/lib/whiteboard/legacy-shape.ts:1-13（legacyShapeCompatibilityError）
 * 源：ref/OpenMAIC/lib/chat/structured-output.ts:66-99（旧格式 name/params 归一化）
 * 源：ref/OpenMAIC/packages/@openmaic/dsl/src/action.ts:264（SLIDE_ONLY_ACTIONS）
 *
 * ⚠️ 与上游的唯一差异：上游用 `typebox` 声明工具参数，本仓没有该依赖（且不许新增），
 *    这里改用等价的 **纯 JSON Schema 字面量**。字段/必填/enum 与上游逐条对应，
 *    只是不再有 `Static<>` 类型推导 —— 那是编译期的东西，运行期形状不变。
 *    `nanoid` 本仓已有，原样使用（动作 id 的生成行为与上游一致）。
 */

import { nanoid } from 'nanoid';
import { getActionsForRole } from './roles.js';
import { actionDurationMs } from './timing.js';

// ==================== 动作分区 ====================

/** 只在 slide 场景可用的动作（dsl/src/action.ts:264）。 */
export const SLIDE_ONLY_ACTIONS = Object.freeze(['spotlight', 'laser']);

/** 派发即返回、不等动画的动作。 */
export const FIRE_AND_FORGET_ACTIONS = Object.freeze(['spotlight', 'laser']);

/** 需要 await 完成的动作。 */
export const SYNC_ACTIONS = Object.freeze([
  'speech',
  'play_video',
  'wb_open',
  'wb_close',
  'wb_draw_text',
  'wb_draw_shape',
  'wb_draw_chart',
  'wb_draw_latex',
  'wb_draw_table',
  'wb_draw_line',
  'wb_draw_code',
  'wb_edit_code',
  'wb_clear',
  'wb_delete',
  'discussion',
  'widget_highlight',
  'widget_setState',
  'widget_annotation',
  'widget_reveal',
]);

// ==================== 参数 schema（纯 JSON Schema） ====================

const num = { type: 'number' };
const str = { type: 'string' };
const optNum = { type: 'number' };
const optStr = { type: 'string' };

/**
 * 与 classroom-actions.ts:11-181 的 TypeBox 声明逐字段对应。
 * `additionalProperties: false` 只在 wb_draw_shape 上出现过，保持原样。
 */
export const ACTION_PARAM_SCHEMAS = Object.freeze({
  spotlight: {
    type: 'object',
    properties: { elementId: str, dimOpacity: optNum },
    required: ['elementId'],
  },
  laser: {
    type: 'object',
    properties: { elementId: str, color: optStr },
    required: ['elementId'],
  },
  play_video: {
    type: 'object',
    properties: { elementId: str },
    required: ['elementId'],
  },
  wb_open: { type: 'object', properties: {} },
  wb_close: { type: 'object', properties: {} },
  wb_clear: { type: 'object', properties: {} },
  wb_delete: {
    type: 'object',
    properties: { elementId: str },
    required: ['elementId'],
  },
  wb_draw_text: {
    type: 'object',
    properties: {
      content: str,
      x: num,
      y: num,
      width: optNum,
      height: optNum,
      fontSize: optNum,
      color: optStr,
      elementId: optStr,
    },
    required: ['content', 'x', 'y'],
  },
  wb_draw_shape: {
    type: 'object',
    additionalProperties: false,
    properties: {
      shape: { type: 'string', enum: ['rectangle', 'circle', 'triangle'] },
      x: num,
      y: num,
      width: num,
      height: num,
      fillColor: optStr,
      elementId: optStr,
    },
    required: ['shape', 'x', 'y', 'width', 'height'],
  },
  wb_draw_chart: {
    type: 'object',
    properties: {
      chartType: {
        type: 'string',
        enum: ['bar', 'column', 'line', 'pie', 'ring', 'area', 'radar', 'scatter'],
      },
      x: num,
      y: num,
      width: num,
      height: num,
      data: {
        type: 'object',
        properties: {
          labels: { type: 'array', items: str },
          legends: { type: 'array', items: str },
          series: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
        },
        required: ['labels', 'legends', 'series'],
      },
      themeColors: { type: 'array', items: str },
      elementId: optStr,
    },
    required: ['chartType', 'x', 'y', 'width', 'height', 'data'],
  },
  wb_draw_latex: {
    type: 'object',
    properties: {
      latex: str,
      x: num,
      y: num,
      width: optNum,
      height: optNum,
      color: optStr,
      elementId: optStr,
    },
    required: ['latex', 'x', 'y'],
  },
  wb_draw_table: {
    type: 'object',
    properties: {
      x: num,
      y: num,
      width: num,
      height: num,
      data: { type: 'array', items: { type: 'array', items: str } },
      outline: {
        type: 'object',
        properties: { width: num, style: str, color: str },
        required: ['width', 'style', 'color'],
      },
      theme: {
        type: 'object',
        properties: { color: str },
        required: ['color'],
      },
      elementId: optStr,
    },
    required: ['x', 'y', 'width', 'height', 'data'],
  },
  wb_draw_line: {
    type: 'object',
    properties: {
      startX: num,
      startY: num,
      endX: num,
      endY: num,
      color: optStr,
      width: optNum,
      style: { type: 'string', enum: ['solid', 'dashed'] },
      points: { type: 'array', items: { type: 'string', enum: ['', 'arrow'] } },
      elementId: optStr,
    },
    required: ['startX', 'startY', 'endX', 'endY'],
  },
  wb_draw_code: {
    type: 'object',
    properties: {
      language: str,
      code: str,
      x: num,
      y: num,
      width: optNum,
      height: optNum,
      fileName: optStr,
      elementId: optStr,
    },
    required: ['language', 'code', 'x', 'y'],
  },
  wb_edit_code: {
    type: 'object',
    properties: {
      elementId: str,
      operation: {
        type: 'string',
        enum: ['insert_after', 'insert_before', 'delete_lines', 'replace_lines'],
      },
      lineId: optStr,
      lineIds: { type: 'array', items: str },
      content: optStr,
    },
    required: ['elementId', 'operation'],
  },
});

// ==================== 允许集 ====================

/**
 * Filter allowed actions by scene type.
 * Slide-only actions (spotlight, laser) are removed for non-slide scenes.
 * 源：ref/OpenMAIC/lib/chat/pi/tool-schemas.ts:13-22
 */
export function getEffectiveActions(allowedActions, sceneType) {
  if (!sceneType || sceneType === 'slide') return allowedActions;
  return allowedActions.filter((a) => !SLIDE_ONLY_ACTIONS.includes(a));
}

/** 源：ref/OpenMAIC/lib/whiteboard/legacy-shape.ts:1-13 */
export function legacyShapeCompatibilityError(params) {
  const shape = params && typeof params === 'object' && 'shape' in params ? params.shape : undefined;
  const extensions = ['rotate', 'path', 'viewBox', 'stroke', 'expectedLastSeq'];
  if (shape === 'custom' || extensions.some((key) => key in (params ?? {}))) {
    return 'Legacy wb_draw_shape does not support Native rotation/custom path/stroke parameters. Use the Native wb_draw_shape tool and RuntimeStore projection; do not send a Legacy action.';
  }
  if (shape !== 'rectangle' && shape !== 'circle' && shape !== 'triangle') {
    return 'Legacy wb_draw_shape requires shape rectangle|circle|triangle; unknown shapes cannot fall back to rectangles.';
  }
  return null;
}

// ==================== 白板运行时状态 ====================

/** 源：classroom-actions.ts:183-233 */
function getInitialWhiteboardElementCount(body) {
  const whiteboards = body.storeState.stage?.whiteboard;
  const latestWhiteboard = Array.isArray(whiteboards) ? whiteboards[whiteboards.length - 1] : null;
  const elements = latestWhiteboard?.elements;
  return Array.isArray(elements) ? elements.length : 0;
}

function getInitialWhiteboardElementIds(body) {
  const whiteboards = body.storeState.stage?.whiteboard;
  const latestWhiteboard = Array.isArray(whiteboards) ? whiteboards[whiteboards.length - 1] : null;
  const elements = latestWhiteboard?.elements;
  if (!Array.isArray(elements)) return new Set();

  return new Set(
    elements
      .map((element) =>
        element && typeof element === 'object' && 'id' in element
          ? String(element.id ?? '')
          : '',
      )
      .filter(Boolean),
  );
}

function getInitialWhiteboardCodeLineIds(body) {
  const whiteboards = body.storeState.stage?.whiteboard;
  const latestWhiteboard = Array.isArray(whiteboards) ? whiteboards[whiteboards.length - 1] : null;
  const elements = latestWhiteboard?.elements;
  if (!Array.isArray(elements)) return new Map();

  const result = new Map();
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    const candidate = element;
    if (candidate.type !== 'code' || typeof candidate.id !== 'string') continue;
    if (!Array.isArray(candidate.lines)) continue;
    const lineIds = candidate.lines
      .map((line) =>
        line && typeof line === 'object' && 'id' in line ? String(line.id ?? '') : '',
      )
      .filter(Boolean);
    result.set(candidate.id, new Set(lineIds));
  }
  return result;
}

function isWhiteboardDrawAction(name) {
  return name.startsWith('wb_draw_');
}

function isNonEmptyRectangularStringMatrix(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const columnCount = Array.isArray(value[0]) ? value[0].length : 0;
  return (
    columnCount > 0 &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.length === columnCount &&
        row.every((cell) => typeof cell === 'string'),
    )
  );
}

/** 源：classroom-actions.ts:249-265 */
export function createWhiteboardRuntimeState(body) {
  return {
    open: Boolean(body.storeState.whiteboardOpen),
    visibleElementCount: getInitialWhiteboardElementCount(body),
    knownElementIds: getInitialWhiteboardElementIds(body),
    codeLineIdsByElementId: getInitialWhiteboardCodeLineIds(body),
  };
}

/** 源：classroom-actions.ts:267-276 */
function findCurrentSlideElement(body, elementId) {
  const currentScene = body.storeState.currentSceneId
    ? body.storeState.scenes.find((scene) => scene.id === body.storeState.currentSceneId)
    : undefined;
  if (currentScene?.content.type !== 'slide') return null;
  return currentScene.content.canvas.elements.find((element) => element.id === elementId) ?? null;
}

// ==================== 动作工具 ====================

const TOOL_META = [
  ['spotlight', 'Spotlight slide element', 'Focus attention on one slide element by elementId.'],
  ['laser', 'Laser pointer', 'Point at one slide element by elementId.'],
  [
    'play_video',
    'Play slide video',
    'Start playback of a video element on the current slide by elementId.',
  ],
  ['wb_open', 'Open whiteboard', 'Open the classroom whiteboard.'],
  [
    'wb_draw_text',
    'Draw whiteboard text',
    'Draw concise text, equations, or key steps on the whiteboard.',
  ],
  [
    'wb_draw_shape',
    'Draw whiteboard shape',
    'Legacy preset-only shape drawing. Rotation, custom paths and strokes require the Native wb_draw_shape tool; never send those fields here.',
  ],
  [
    'wb_draw_chart',
    'Draw whiteboard chart',
    'Draw a chart on the whiteboard for data or comparisons.',
  ],
  [
    'wb_draw_latex',
    'Draw whiteboard LaTeX',
    'Draw a LaTeX formula on the whiteboard.',
  ],
  [
    'wb_draw_table',
    'Draw whiteboard table',
    'Draw a table on the whiteboard for structured data.',
  ],
  [
    'wb_draw_line',
    'Draw whiteboard line',
    'Draw a line or arrow on the whiteboard.',
  ],
  [
    'wb_draw_code',
    'Draw whiteboard code',
    'Draw a syntax-highlighted code block on the whiteboard.',
  ],
  [
    'wb_edit_code',
    'Edit whiteboard code',
    'Edit an existing code block on the whiteboard.',
  ],
  ['wb_clear', 'Clear whiteboard', 'Clear all elements from the classroom whiteboard.'],
  ['wb_delete', 'Delete whiteboard element', 'Delete one whiteboard element by elementId.'],
  ['wb_close', 'Close whiteboard', 'Close the whiteboard and return to the slide.'],
];

const TOOL_BY_NAME = Object.freeze(Object.fromEntries(TOOL_META.map(([n, l, d]) => [n, { label: l, description: d }])));

/**
 * 源：classroom-actions.ts:278-818。
 *
 * 返回的是「工具描述」（name/label/description/parameters/execute），不直接调 LLM ——
 * 工具由集成层交给模型；`execute` 只把动作归一化成事件并发给 `opts.send`。
 */
export function buildActionTools(opts) {
  const currentScene = opts.body.storeState.currentSceneId
    ? opts.body.storeState.scenes.find((scene) => scene.id === opts.body.storeState.currentSceneId)
    : undefined;
  const slideOnlyPiActions = currentScene?.type === 'slide' ? ['play_video'] : [];
  const allowWhiteboardMutations = opts.enableWhiteboardTools;
  const piActionAllowlist = allowWhiteboardMutations
    ? [
        'spotlight',
        'laser',
        ...slideOnlyPiActions,
        'wb_open',
        'wb_close',
        'wb_draw_text',
        'wb_draw_shape',
        'wb_draw_chart',
        'wb_draw_latex',
        'wb_draw_table',
        'wb_draw_line',
        'wb_draw_code',
        'wb_edit_code',
        'wb_clear',
        'wb_delete',
      ]
    : ['spotlight', 'laser', ...slideOnlyPiActions];
  const effectiveActions = new Set(
    getEffectiveActions(opts.agent.allowedActions, currentScene?.type).filter((name) =>
      piActionAllowlist.includes(name),
    ),
  );
  const whiteboardState = opts.whiteboardState ?? createWhiteboardRuntimeState(opts.body);

  const makeActionTool = (name) => {
    const meta = TOOL_BY_NAME[name];
    return {
      name,
      label: meta.label,
      description: meta.description,
      parameters: ACTION_PARAM_SCHEMAS[name],
      executionMode: 'sequential',
      execute: async (_toolCallId, params) => {
        if (name === 'wb_draw_shape') {
          const error = legacyShapeCompatibilityError(params);
          if (error)
            return {
              content: [{ type: 'text', text: error }],
              details: { skipped: true, reason: 'unsupported_legacy_shape' },
              isError: true,
            };
        }
        if (
          name === 'spotlight' &&
          opts.authorizedSpotlightElementIds &&
          !opts.authorizedSpotlightElementIds.has(params.elementId)
        ) {
          return {
            content: [
              {
                type: 'text',
                text: 'Action spotlight skipped because the element is not authorized by request-scoped evidence.',
              },
            ],
            details: {
              skipped: true,
              reason: 'spotlight_element_not_authorized',
              actionName: name,
              elementId: params.elementId,
            },
          };
        }
        if (name === 'wb_open' && whiteboardState.open) {
          return {
            content: [
              {
                type: 'text',
                text: 'Action wb_open skipped because the whiteboard is already open.',
              },
            ],
            details: { skipped: true, reason: 'whiteboard_already_open', actionName: name },
          };
        }

        if (
          (name === 'wb_clear' || name === 'wb_delete') &&
          whiteboardState.visibleElementCount === 0
        ) {
          return {
            content: [
              {
                type: 'text',
                text: `Action ${name} skipped because the whiteboard has no visible elements.`,
              },
            ],
            details: { skipped: true, reason: 'whiteboard_empty', actionName: name },
          };
        }

        if (name === 'play_video') {
          const elementId = params.elementId;
          const slideElement = findCurrentSlideElement(opts.body, elementId);
          if (!slideElement) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Action play_video skipped because slide element "${elementId}" was not found.`,
                },
              ],
              details: {
                skipped: true,
                reason: 'slide_element_not_found',
                actionName: name,
                elementId,
              },
            };
          }
          if (slideElement.type !== 'video') {
            return {
              content: [
                {
                  type: 'text',
                  text: `Action play_video skipped because slide element "${elementId}" is not a video.`,
                },
              ],
              details: {
                skipped: true,
                reason: 'slide_element_not_video',
                actionName: name,
                elementId,
                elementType: slideElement.type,
              },
            };
          }
        }

        const actionParams = params;

        if (isWhiteboardDrawAction(name) && !actionParams.elementId) {
          actionParams.elementId = nanoid();
        }

        if (name === 'wb_draw_table' && !isNonEmptyRectangularStringMatrix(actionParams.data)) {
          return {
            content: [
              {
                type: 'text',
                text: 'Action wb_draw_table skipped because data must be a non-empty rectangular string matrix.',
              },
            ],
            details: {
              skipped: true,
              reason: 'whiteboard_invalid_table',
              actionName: name,
            },
          };
        }

        if (isWhiteboardDrawAction(name)) {
          const elementId = actionParams.elementId;
          if (
            typeof elementId === 'string' &&
            elementId &&
            whiteboardState.knownElementIds.has(elementId)
          ) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Action ${name} skipped because whiteboard element id "${elementId}" already exists.`,
                },
              ],
              details: {
                skipped: true,
                reason: 'whiteboard_element_id_conflict',
                actionName: name,
                elementId,
              },
            };
          }
        }

        if (name === 'wb_delete') {
          const elementId = String(actionParams.elementId ?? '');
          if (!whiteboardState.knownElementIds.has(elementId)) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Action wb_delete skipped because whiteboard element "${elementId}" was not found.`,
                },
              ],
              details: {
                skipped: true,
                reason: 'whiteboard_element_not_found',
                actionName: name,
                elementId,
              },
            };
          }
        }

        if (name === 'wb_edit_code') {
          const elementId = String(actionParams.elementId ?? '');
          const knownLineIds = whiteboardState.codeLineIdsByElementId.get(elementId);
          if (!knownLineIds) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Action wb_edit_code skipped because code element "${elementId}" was not found.`,
                },
              ],
              details: {
                skipped: true,
                reason: 'whiteboard_code_element_not_found',
                actionName: name,
                elementId,
              },
            };
          }

          const operation = actionParams.operation;
          const targetLineIds =
            operation === 'insert_after' || operation === 'insert_before'
              ? [String(actionParams.lineId ?? '')]
              : Array.isArray(actionParams.lineIds)
                ? actionParams.lineIds.map(String)
                : [];
          const missingLineId = targetLineIds.find((lineId) => !knownLineIds.has(lineId));
          if (missingLineId) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Action wb_edit_code skipped because line "${missingLineId}" was not found in code element "${elementId}".`,
                },
              ],
              details: {
                skipped: true,
                reason: 'whiteboard_code_line_not_found',
                actionName: name,
                elementId,
                lineId: missingLineId,
              },
            };
          }
        }

        if (name === 'wb_draw_code') {
          actionParams.lineIds = String(actionParams.code ?? '')
            .split('\n')
            .map((_line, index) => `L${index + 1}`);
        }
        if (name === 'wb_edit_code') {
          const operation = actionParams.operation;
          if (
            operation === 'insert_after' ||
            operation === 'insert_before' ||
            operation === 'replace_lines'
          ) {
            const contentLineCount = String(actionParams.content ?? '').split('\n').length;
            const replacedLineIds =
              operation === 'replace_lines' && Array.isArray(actionParams.lineIds)
                ? actionParams.lineIds.map(String)
                : [];
            actionParams.newLineIds = Array.from(
              { length: contentLineCount },
              (_unused, index) => replacedLineIds[index] ?? nanoid(),
            );
          }
        }

        opts.abortSignal?.throwIfAborted();
        const actionId = nanoid();
        const delivery = opts.send({
          type: 'action',
          data: {
            actionId,
            actionName: name,
            params: actionParams,
            agentId: opts.agent.id,
            messageId: opts.messageId,
          },
        });
        let sendCompleted = false;
        try {
          await delivery;
          sendCompleted = true;
        } finally {
          if (sendCompleted || opts.abortSignal?.aborted) {
            if (name === 'wb_open') whiteboardState.open = true;
            if (name === 'wb_close') whiteboardState.open = false;
            if (name === 'wb_clear') {
              whiteboardState.open = true;
              whiteboardState.visibleElementCount = 0;
              whiteboardState.knownElementIds.clear();
              whiteboardState.codeLineIdsByElementId.clear();
            }
            if (isWhiteboardDrawAction(name)) {
              whiteboardState.open = true;
              whiteboardState.visibleElementCount += 1;
              const elementId = actionParams.elementId;
              if (typeof elementId === 'string' && elementId) {
                whiteboardState.knownElementIds.add(elementId);
                if (name === 'wb_draw_code') {
                  whiteboardState.codeLineIdsByElementId.set(
                    elementId,
                    new Set(actionParams.lineIds ?? []),
                  );
                }
              }
            }
            if (name === 'wb_delete') {
              whiteboardState.open = true;
              const elementId = String(actionParams.elementId);
              whiteboardState.knownElementIds.delete(elementId);
              whiteboardState.visibleElementCount = Math.max(
                whiteboardState.visibleElementCount - 1,
                0,
              );
              whiteboardState.codeLineIdsByElementId.delete(elementId);
            }
            if (name === 'wb_edit_code') {
              const elementId = String(actionParams.elementId);
              const lineIds = whiteboardState.codeLineIdsByElementId.get(elementId);
              const operation = actionParams.operation;
              if (lineIds && (operation === 'delete_lines' || operation === 'replace_lines')) {
                const targetLineIds = actionParams.lineIds ?? [];
                targetLineIds.forEach((lineId) => lineIds.delete(lineId));
                if (operation === 'replace_lines') {
                  (actionParams.newLineIds ?? []).forEach((lineId) => lineIds.add(lineId));
                }
              } else if (lineIds && (operation === 'insert_after' || operation === 'insert_before')) {
                (actionParams.newLineIds ?? []).forEach((lineId) => lineIds.add(lineId));
              }
            }
            opts.onActionDone(
              name.startsWith('wb_')
                ? {
                    actionName: name,
                    agentId: opts.agent.id,
                    agentName: opts.agent.name,
                    params: actionParams,
                  }
                : undefined,
            );
          }
        }
        return {
          content: [{ type: 'text', text: `Action ${name} was sent to the client.` }],
          details: { actionId, actionName: name, params },
        };
      },
    };
  };

  const tools = [];
  const order = [
    'spotlight',
    'laser',
    'play_video',
    'wb_open',
    'wb_draw_text',
    'wb_draw_shape',
    'wb_draw_chart',
    'wb_draw_latex',
    'wb_draw_table',
    'wb_draw_line',
    'wb_draw_code',
    'wb_edit_code',
    'wb_clear',
    'wb_delete',
    'wb_close',
  ];
  for (const name of order) {
    if (effectiveActions.has(name)) tools.push(makeActionTool(name));
  }
  return tools;
}

// ==================== 结构化输出 → 动作归一化 ====================

/**
 * 把一段 `{type:'action'}` 列表项归一化成动作事件内容。
 * 兼容新格式（`name`/`params`）与旧格式（`tool_name`/`parameters`）。
 * 源：ref/OpenMAIC/lib/chat/structured-output.ts:66-99
 */
export function normalizeActionItem(item) {
  return {
    actionId:
      (item.action_id) || `action-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    actionName: (item.name || item.tool_name),
    params: (item.params || item.parameters || {}),
  };
}

/**
 * 动作 → 播放时长提示。页面/导出器靠它排时间轴，数值来自 `timing.js`
 * （= choreography/timing.ts + action/engine.ts 的 delay 调用点）。
 */
export function describeAction(actionName, params, whiteboard) {
  return {
    actionName,
    kind: FIRE_AND_FORGET_ACTIONS.includes(actionName) ? 'fire-and-forget' : 'sync',
    durationMs: actionDurationMs(actionName, params, whiteboard),
  };
}

/** 某个角色在本场景真正可用的动作集（供 prompt 的 action 描述使用）。 */
export function availableActionsFor(agent, sceneType, enableWhiteboardTools = true) {
  const effective = getEffectiveActions(agent.allowedActions ?? getActionsForRole(agent.role), sceneType);
  if (enableWhiteboardTools) return effective;
  return effective.filter((name) => !name.startsWith('wb_'));
}
