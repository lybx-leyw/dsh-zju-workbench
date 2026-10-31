/**
 * 角色/发言调度。上游把「谁先说」交给导演模型（prompt 的 Routing Rules），
 * 本文件把那九条规则写成**确定性**的选人逻辑，用于两种场合：
 *
 *   1. 没有注入 `llm` 时（离线、测试、以及宿主 status 还是 degraded）的兜底；
 *   2. 注入 `llm` 时做**校验**——模型选出来的人不合规则就拒绝，而不是盲从。
 *
 * 规则原文见 `src/prompts.js` 的 `buildDirectorPrompt`（源 prompts.ts:118-129），
 * 这里逐条落成可执行判断，并在注释上标号，改措辞时不会两边漂。
 */

/** 源：prompts.ts:97（"Prefer 1-2 classroom agents"） */
export const MAX_AGENTS_PER_TURN = 2;

/** 学生只在讨论/项目场景发言（源：prompts.ts:125-126，学生不得抢首发解释）。 */
const STUDENT_SCENES = new Set(['discussion', 'pbl']);

function byPriorityDesc(a, b) {
  return (b.priority ?? 0) - (a.priority ?? 0);
}

/**
 * 规则 1/5/6：首发必须是 teacher；没有 teacher 才退到 assistant；
 * 学生永远不首发（除讨论模式下的 initiator，由调用方显式指定）。
 *
 * @param {Array<{id:string, role:string, priority:number}>} agents
 */
export function selectFirstSpeaker(agents, { sessionType, triggerAgentId } = {}) {
  // 规则 1（讨论模式）：initiator 先开口，但它必须是花名册里的人。
  if (sessionType === 'discussion' && triggerAgentId) {
    const initiator = agents.find((agent) => agent.id === triggerAgentId);
    if (initiator) return initiator;
  }

  // 规则 5/6：teacher 优先。
  const teachers = agents.filter((agent) => agent.role === 'teacher').sort(byPriorityDesc);
  if (teachers.length > 0) return teachers[0];

  // 规则 6 的 fallback：teacher 不在时由助教顶首发。
  const assistants = agents.filter((agent) => agent.role === 'assistant').sort(byPriorityDesc);
  return assistants[0] ?? null;
}

/**
 * 规则 2/3/4/8：选一个与上一位**角色不同**、且本轮还没说过的人。
 * 学生只有在该场景允许时才可能被选中。
 */
export function selectNextSpeaker(agents, { spokenAgentIds = [], lastRole, sessionType, sceneType } = {}) {
  const spoken = new Set(spokenAgentIds);
  // 规则 2：不重复本轮已发言的人。
  const candidates = agents.filter((agent) => !spoken.has(agent.id));
  // 规则 3：不连续派同角色。
  const roleDiverse = lastRole ? candidates.filter((agent) => agent.role !== lastRole) : candidates;

  const pool = roleDiverse.length > 0 ? roleDiverse : candidates;
  const studentsAllowed = STUDENT_SCENES.has(sessionType) || STUDENT_SCENES.has(sceneType);

  // 规则 4：学生只补充「提问 / 挑战 / 例子」，排在教师与助教之后。
  const ordered = [
    ...pool.filter((agent) => agent.role === 'teacher'),
    ...pool.filter((agent) => agent.role === 'assistant'),
    ...(studentsAllowed ? pool.filter((agent) => agent.role === 'student') : []),
  ].sort((a, b) => {
    const roleRank = (agent) => (agent.role === 'teacher' ? 0 : agent.role === 'assistant' ? 1 : 2);
    return roleRank(a) - roleRank(b) || byPriorityDesc(a, b);
  });

  return ordered[0] ?? null;
}

/**
 * 一个回合的发言序列（不含终局工具）。
 *
 * @param {object} input
 * @param {Array<{id:string, role:string, priority:number}>} input.agents
 * @param {string} [input.sessionType]
 * @param {string} [input.sceneType]
 * @param {string} [input.triggerAgentId]
 * @param {string[]} [input.spokenAgentIds] 跨回合已经说过的人（用于 done 的 turnCount）
 * @returns {Array<object>} 至多 MAX_AGENTS_PER_TURN 个
 */
export function scheduleTurn(input) {
  const { agents = [], sessionType, sceneType, triggerAgentId } = input;
  const spokenAgentIds = [...(input.spokenAgentIds ?? [])];
  const sequence = [];

  let next = selectFirstSpeaker(agents, { sessionType, triggerAgentId });
  while (next && sequence.length < MAX_AGENTS_PER_TURN) {
    sequence.push(next);
    spokenAgentIds.push(next.id);
    const lastRole = next.role;
    next = selectNextSpeaker(agents, {
      spokenAgentIds,
      lastRole,
      sessionType,
      sceneType,
    });
  }

  return sequence;
}

/**
 * 校验一个（可能来自模型的）发言序列是否违反规则。
 * 返回违反的规则说明数组；空数组表示通过。
 */
export function validateSchedule(agents, agentIds, { sessionType, sceneType } = {}) {
  const problems = [];
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  let lastRole;

  agentIds.forEach((id, index) => {
    const agent = byId.get(id);
    if (!agent) {
      problems.push(`规则 7：${id} 不在花名册里`);
      return;
    }
    if (index === 0 && agent.role === 'student' && sessionType !== 'discussion') {
      problems.push('规则 5/6：学生不得首发实质解释');
    }
    if (agent.role === 'student' && !(STUDENT_SCENES.has(sessionType) || STUDENT_SCENES.has(sceneType))) {
      problems.push(`规则 4：场景 ${sceneType ?? '(none)'} 不允许学生发言`);
    }
    if (lastRole && agent.role === lastRole) {
      problems.push(`规则 3：连续两位同角色（${agent.role}）`);
    }
    lastRole = agent.role;
  });

  if (new Set(agentIds).size !== agentIds.length) {
    problems.push('规则 2：本轮重复派了同一个智能体');
  }
  if (agentIds.length > MAX_AGENTS_PER_TURN) {
    problems.push(`规则 8：单回合超过 ${MAX_AGENTS_PER_TURN} 位`);
  }

  return problems;
}
