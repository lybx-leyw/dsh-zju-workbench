// 源：ref/OpenMAIC/lib/chat/pi/director-loop.ts:52-299
/**
 * 导演回合的状态机：谁已经说过、是否已经收尾、终局工具互斥、本轮台账与工具轨迹。
 *
 * 源：ref/OpenMAIC/lib/chat/pi/director-loop.ts:52-124（回合状态与三个判定）
 * 源：ref/OpenMAIC/lib/chat/pi/director-loop.ts:139-250（工具轨迹与「终止」条件）
 * 源：ref/OpenMAIC/lib/chat/pi/director-loop.ts:252-299（收尾与 done 事件的字段）
 * 源：ref/OpenMAIC/lib/chat/pi/send.ts:1-24（可中止的 send 包装）
 *
 * ⚠️ 上游这一回合的「心脏」是 pi-agent 的 `buildAgent(...).prompt()`，本仓没有
 *    `@earendil-works/pi-agent-core` 依赖（也不许新增）。所以本文件搬的是**状态**：
 *    哪些计数、哪些互斥、done 里带什么。真正的模型调用由 `orchestrator.js` 通过
 *    注入的 `llm` 完成，状态推进的时序与上游逐条对应 —— 这样替换掉 agent 内核时，
 *    判据（是否已收尾、能否再 cue）不会跟着漂。
 */



/** 源：send.ts:4-24 */
export function createAbortableSend(send, signal) {
  return async (event) => {
    signal.throwIfAborted();
    let onAbort;
    try {
      await new Promise((resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(send(event)).then(resolve, reject);
      });
      signal.throwIfAborted();
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  };
}

/** 源：director-loop.ts:26-28 */
function formatSceneEvidenceForDelegation(evidence) {
  return evidence.map((packet) => packet.content).join('\n\n');
}

/**
 * 源：director-loop.ts:52-124。
 *
 * @param {{agentConfigs: Array<{id: string, role: string}>, requestStartCurrentScene?: object}} options
 */
export function createDirectorRun(options) {
  const agentConfigs = options.agentConfigs ?? [];
  const requestStartCurrentScene = options.requestStartCurrentScene;

  const state = {
    totalAgents: 0,
    totalActions: 0,
    agentHadContent: false,
    userCued: false,
    sessionClosed: false,
    endReason: undefined,
    directorToolCalls: 0,
    pendingSceneEvidence: new Map(),
    directorToolTrace: [],
    agentResponses: [],
    whiteboardLedger: [],
  };

  const isTeachingSubstantiveTurn = (summary) => {
    const agent = agentConfigs.find((candidate) => candidate.id === summary.agentId);
    return (
      (agent?.role === 'teacher' || agent?.role === 'assistant') &&
      (summary.contentPreview.trim().length > 0 || summary.actionCount > 0)
    );
  };
  const hasTeachingSubstantiveTurn = () => state.agentResponses.some(isTeachingSubstantiveTurn);
  const hasVisibleAgentTurn = () =>
    state.agentResponses.some((summary) => summary.contentPreview.trim().length > 0);
  const hasAgentContent = () =>
    state.agentResponses.some(
      (summary) => summary.contentPreview.trim().length > 0 || summary.actionCount > 0,
    );

  return {
    state,
    requestStartCurrentScene,
    isTeachingSubstantiveTurn,
    hasTeachingSubstantiveTurn,
    hasVisibleAgentTurn,
    hasAgentContent,

    /** 源：director-loop.ts:111-118 */
    async cueUser(data, send) {
      if (state.userCued) return false;
      state.userCued = true;
      await send({ type: 'cue_user', data });
      return true;
    },

    /** 源：director-loop.ts:119-124 */
    closeSession(data) {
      if (state.sessionClosed || state.userCued) return false;
      state.sessionClosed = true;
      state.endReason = data.endReason;
      return true;
    },

    /** 源：director-loop.ts:151-159（onAgentDone） */
    onAgentDone(summary) {
      state.totalAgents += 1;
      if (summary.contentPreview || summary.actionCount > 0) state.agentHadContent = true;
      state.agentResponses.push(summary);
    },

    /** 源：director-loop.ts:156-159（onActionDone） */
    onActionDone(record) {
      state.totalActions += 1;
      if (record) state.whiteboardLedger.push(record);
    },

    /** 源：director-loop.ts:140-145（read_scene 证据暂存） */
    putSceneEvidence(evidence) {
      state.pendingSceneEvidence.set(evidence.details.sceneId, evidence);
    },

    /** 源：director-loop.ts:181-198 */
    takeSceneEvidence() {
      if (state.pendingSceneEvidence.size === 0) return undefined;
      const packets = [...state.pendingSceneEvidence.values()];
      state.pendingSceneEvidence.clear();
      return {
        content: formatSceneEvidenceForDelegation(packets),
        metadata: packets.map((packet) => ({
          sceneId: packet.details.sceneId,
          title: packet.details.title,
          sceneType: packet.details.sceneType,
          order: packet.details.order,
          revision: packet.details.revision,
          source: packet.details.source,
        })),
      };
    },

    /**
     * 源：director-loop.ts:223-249（afterToolCall）
     * @returns {{terminate?: true, isError?: true}|undefined}
     */
    recordToolCall({ toolName, args, isError: rawIsError, result }) {
      state.directorToolCalls += 1;
      const evidenceStatus =
        toolName === 'read_scene' ? result?.details?.status : undefined;
      const evidenceError = evidenceStatus !== undefined && evidenceStatus !== 'ok';
      const isError = Boolean(rawIsError) || evidenceError;
      const resultPreview = (result?.content ?? [])
        .map((content) => (content.type === 'text' ? content.text : '[image]'))
        .join('\n')
        .slice(0, 800);
      state.directorToolTrace.push({
        sequence: state.directorToolCalls,
        toolName,
        args,
        isError,
        resultPreview,
        details: result?.details,
      });
      const terminate = state.sessionClosed || state.userCued;
      if (!terminate && !evidenceError) return undefined;
      return {
        ...(terminate ? { terminate: true } : {}),
        ...(evidenceError ? { isError: true } : {}),
      };
    },

    /** 源：director-loop.ts:267-293（done 事件的内容） */
    donePayload(compactionTrace) {
      return {
        totalActions: state.totalActions,
        totalAgents: state.totalAgents,
        agentHadContent: state.agentHadContent,
        cueUserReceived: state.userCued,
        sessionClosed: state.sessionClosed,
        endReason: state.endReason,
        directorCompaction: compactionTrace,
        directorToolTrace: state.directorToolTrace,
        directorState: {
          turnCount: state.agentResponses.length,
          agentResponses: [...state.agentResponses],
          whiteboardLedger: state.whiteboardLedger,
        },
      };
    },
  };
}
