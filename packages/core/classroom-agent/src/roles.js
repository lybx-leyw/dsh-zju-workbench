// 源：ref/OpenMAIC/lib/orchestration/registry/types.ts:9-95
/**
 * 角色 → 动作集、内置智能体目录、课堂载入时的角色选择。
 *
 * 源：ref/OpenMAIC/lib/orchestration/registry/types.ts:9-95
 * 源：ref/OpenMAIC/lib/orchestration/registry/built-in.ts:12-195
 * 源：ref/OpenMAIC/lib/orchestration/registry/agent-selection.ts:1-58
 *
 * 人设正文不在这里 —— 它们属于 prompt，放在 `src/prompts.js` 的
 * `BUILT_IN_PERSONAS`，这样「改措辞」只改一个文件，上游 diff 才读得动。
 */

import { BUILT_IN_PERSONAS } from './prompts.js';

// ==================== 动作集 ====================

/** 源：registry/types.ts:62-75 */
export const WHITEBOARD_ACTIONS = Object.freeze([
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
]);

/** 源：registry/types.ts:77 */
export const SLIDE_ACTIONS = Object.freeze(['spotlight', 'laser', 'play_video']);

/**
 * Maps agent roles to their allowed action sets.
 * Teachers get slide + whiteboard control; others get whiteboard only.
 *
 * 源：registry/types.ts:83-87
 */
export const ROLE_ACTIONS = Object.freeze({
  teacher: [...SLIDE_ACTIONS, ...WHITEBOARD_ACTIONS],
  assistant: [...WHITEBOARD_ACTIONS],
  student: [...WHITEBOARD_ACTIONS],
});

/** 源：registry/types.ts:89-95 */
export function getActionsForRole(role) {
  return ROLE_ACTIONS[role] || [...WHITEBOARD_ACTIONS];
}

/** 源：registry/types.ts:48-59 */
export function createAgentFromTemplate(template, id) {
  return {
    id,
    ...template,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDefault: false,
  };
}

// ==================== 内置智能体 ====================

/** 源：built-in.ts:12-157（persona 见 prompts.js） */
const CATALOGUE = {
  'default-1': {
    id: 'default-1',
    name: 'AI teacher',
    role: 'teacher',
    avatar: '/avatars/teacher.png',
    color: '#3b82f6',
    allowedActions: [...SLIDE_ACTIONS, ...WHITEBOARD_ACTIONS],
    priority: 10,
  },
  'default-2': {
    id: 'default-2',
    name: 'AI助教',
    role: 'assistant',
    avatar: '/avatars/assist.png',
    color: '#10b981',
    allowedActions: [...WHITEBOARD_ACTIONS],
    priority: 7,
  },
  'default-3': {
    id: 'default-3',
    name: '显眼包',
    role: 'student',
    avatar: '/avatars/clown.png',
    color: '#f59e0b',
    allowedActions: [...WHITEBOARD_ACTIONS],
    priority: 4,
  },
  'default-4': {
    id: 'default-4',
    name: '好奇宝宝',
    role: 'student',
    avatar: '/avatars/curious.png',
    color: '#ec4899',
    allowedActions: [...WHITEBOARD_ACTIONS],
    priority: 5,
  },
  'default-5': {
    id: 'default-5',
    name: '笔记员',
    role: 'student',
    avatar: '/avatars/note-taker.png',
    color: '#06b6d4',
    allowedActions: [...WHITEBOARD_ACTIONS],
    priority: 5,
  },
  'default-6': {
    id: 'default-6',
    name: '思考者',
    role: 'student',
    avatar: '/avatars/thinker.png',
    color: '#8b5cf6',
    allowedActions: [...WHITEBOARD_ACTIONS],
    priority: 6,
  },
};

/** 源：built-in.ts:164-171 */
export const BUILT_IN_AGENTS = Object.freeze(
  Object.assign(
    Object.create(null),
    Object.fromEntries(
      Object.entries(CATALOGUE).map(([id, agent]) => [
        id,
        Object.freeze({
          ...agent,
          persona: BUILT_IN_PERSONAS[id],
          isDefault: true,
          createdAt: agent.createdAt ?? new Date(0),
          updatedAt: agent.updatedAt ?? new Date(0),
        }),
      ]),
    ),
  ),
);

export function getBuiltInAgent(id) {
  return Object.hasOwn(BUILT_IN_AGENTS, id) ? BUILT_IN_AGENTS[id] : undefined;
}

/** 源：built-in.ts:178-182 */
export const BUILT_IN_AGENT_ID_PREFIX = 'default-';

export function isBuiltInAgentId(id) {
  return id.startsWith(BUILT_IN_AGENT_ID_PREFIX);
}

/** 源：built-in.ts:188-195 */
export function getDefaultAgents() {
  return Object.values(BUILT_IN_AGENTS).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    persona: a.persona,
  }));
}

// ==================== 载入时的角色选择 ====================

/** 源：agent-selection.ts:27-58 */
export function restoreAgentSelection(params) {
  const { persisted, persistedIsUserSet, generatedAgentIds, stageAgentIds, isPresetAgent } = params;

  if (persistedIsUserSet && persisted.selectedAgentIds.length > 0) {
    if (persisted.mode === 'auto') {
      const generated = new Set(generatedAgentIds);
      if (persisted.selectedAgentIds.every((id) => generated.has(id))) {
        return { selection: persisted, isUserSet: true };
      }
    } else if (persisted.selectedAgentIds.every(isPresetAgent)) {
      return { selection: persisted, isUserSet: true };
    }
  }

  if (generatedAgentIds.length > 0) {
    return { selection: { mode: 'auto', selectedAgentIds: generatedAgentIds }, isUserSet: false };
  }
  const cleanIds = stageAgentIds?.filter(isPresetAgent) ?? [];
  return {
    selection: {
      mode: 'preset',
      selectedAgentIds: cleanIds.length > 0 ? cleanIds : ['default-1', 'default-2', 'default-3'],
    },
    isUserSet: false,
  };
}

/**
 * brief → 花名册。显式 `brief.agents` 优先；否则走上游的「preset → 默认三件套」
 * 回退（`generatedAgentIds` 为空，因为本包不生成智能体）。
 */
export function resolveRoster(brief = {}) {
  const requested = Array.isArray(brief.agents)
    ? brief.agents.filter((id) => typeof id === 'string')
    : [];
  const { selection } = restoreAgentSelection({
    persisted: { mode: 'preset', selectedAgentIds: requested },
    persistedIsUserSet: requested.length > 0,
    generatedAgentIds: [],
    stageAgentIds: requested,
    isPresetAgent: (id) => Boolean(getBuiltInAgent(id)),
  });

  const agents = selection.selectedAgentIds
    .map((id) => getBuiltInAgent(id))
    .filter(Boolean)
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      persona: agent.persona,
      avatar: agent.avatar,
      color: agent.color,
      allowedActions: [...agent.allowedActions],
      priority: agent.priority,
    }));

  return { mode: selection.mode, selectedAgentIds: agents.map((a) => a.id), agents };
}
