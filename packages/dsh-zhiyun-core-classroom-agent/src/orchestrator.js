// 源：ref/OpenMAIC/lib/chat/pi/director-loop.ts:30-299（回合驱动与 done 事件）
/**
 * 编排门面：`plan(brief)` / `run(plan, opts)` / `cancel(runId)`。
 *
 * 这一层是**胶水**，不承担算法：场景序列来自 `scene.js`（大纲同形），发言序列来自
 * `scheduling.js`（上游 Routing Rules 的确定性落法），回合状态来自 `state-machine.js`
 * （director-loop 的状态搬运），动作校验来自 `actions.js`（classroom-actions 搬运），
 * 文本来自 `prompts.js`（prompts.ts 搬运）。
 *
 * # 副作用全走注入
 *
 * - `llm`：可选。没有就走确定性兜底（不发任何请求），`status().detail.llm` 写明。
 * - `studio`：宿主的 `ctx.zhiyunClassroomStudio`。只用它的 `status()` 与
 *   `runs.cancel()`，且两处都 try/catch —— 上游没搬完时本包照常可用（规范 §4）。
 * - 顶层没有任何 `new Client()` / `fetch` / `process.env` 读取。
 *
 * # 事件流
 *
 * 与上游同一套事件名（`agent_start` / `text_delta` / `action` / `agent_end` /
 * `cue_user` / `done`），`done.data` 的字段与 director-loop.ts:271-293 一致。
 * `agent_start.data` 额外带一个 `sceneId`（本包按场景推进，上游一次只处理一个
 * 当前场景，所以它在上游是隐含的；这里是显式化，不改变既有字段）。
 */

import { buildChildPrompt, buildChildTurnPrompt, buildUserPrompt, createVisibleSpeechDeltaSanitizer, sanitizeVisibleSpeech } from './prompts.js';
import { availableActionsFor, buildActionTools, createWhiteboardRuntimeState, normalizeActionItem } from './actions.js';
import { createDirectorRun } from './state-machine.js';
import { scheduleTurn } from './scheduling.js';
import { planScenes } from './scene.js';
import { resolveRoster } from './roles.js';
import { ClassroomAgentError, ERROR_KINDS } from './errors.js';

export const AGENT_PACKAGE_VERSION = '0.1.0';

// ==================== 事件通道 ====================

/**
 * 把「后台推进」变成 `AsyncIterable<event>`。
 *
 * 规范 §4 末条要求事件流用 AsyncIterable 而不是回调注册表（避免卸载泄漏）；
 * 同时 `cancel(runId)` 必须能在消费者还没开始迭代时就生效，所以这里用队列 +
 * 后台任务，而不是「迭代到一半才启动」的惰性生成器。
 */
function createEventChannel() {
  const queue = [];
  const waiters = [];
  let ended = false;
  let failure = null;

  const settle = () => {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (queue.length > 0) {
        waiter.resolve({ value: queue.shift(), done: false });
      } else if (failure) {
        waiter.reject(failure);
      } else if (ended) {
        waiter.resolve({ value: undefined, done: true });
      } else {
        waiters.unshift(waiter);
        break;
      }
    }
  };

  const iterator = {
    next() {
      if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
      if (failure) return Promise.reject(failure);
      if (ended) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
    return() {
      ended = true;
      settle();
      return Promise.resolve({ value: undefined, done: true });
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };

  return {
    iterator,
    push(event) {
      if (ended) return;
      queue.push(event);
      settle();
    },
    end() {
      ended = true;
      settle();
    },
    fail(error) {
      failure = error;
      ended = true;
      settle();
    },
  };
}

// ==================== 默认（离线）文本 ====================

/**
 * 没有注入 llm 时的确定性话术。**不生成教学内容**，只把场景大纲念出来，
 * 保证事件流有形状可验；真实讲解必须由注入的 llm 产出。
 */
function composeFallbackSpeech(agent, scene) {
  const point = scene.keyPoints?.[0];
  if (agent.role === 'teacher') {
    return point
      ? `我们看「${scene.title}」。这一节先抓住一点：${point}。`
      : `我们看「${scene.title}」，先把整体框架过一遍。`;
  }
  if (agent.role === 'assistant') {
    return point ? `我把「${scene.title}」换个说法：${point}。` : `我补充一下「${scene.title}」。`;
  }
  return `关于「${scene.title}」，我想确认一个小问题。`;
}

// ==================== storeState ====================

function sceneContent(scene) {
  if (scene.type === 'slide') {
    return { type: 'slide', canvas: { elements: [] } };
  }
  if (scene.type === 'quiz') return { type: 'quiz', questions: [] };
  return { type: scene.type };
}

/**
 * 用 plan 拼出上游 prompt 需要的 `storeState` 形状（stage / scenes / outlines /
 * currentSceneId / mode / whiteboardOpen）。字段名与 `chat/store-state.ts:1-26` 一致。
 */
export function buildStoreState(plan, scene) {
  return {
    stage: {
      id: plan.id,
      name: plan.brief?.topic ?? plan.brief?.title ?? plan.id,
      description: plan.brief?.description ?? '',
      whiteboard: [],
    },
    scenes: plan.scenes.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      order: item.order,
      outlineId: item.id,
      content: sceneContent(item),
    })),
    outlines: plan.scenes.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.description,
      keyPoints: item.keyPoints,
      order: item.order,
    })),
    currentSceneId: scene.id,
    mode: 'learning',
    whiteboardOpen: false,
  };
}

function buildBody(plan, scene, opts) {
  return {
    config: {
      sessionType: opts.sessionType ?? plan.brief?.sessionType ?? 'qa',
      triggerAgentId: opts.triggerAgentId,
      discussionPrompt: plan.brief?.discussionPrompt,
      discussionTopic: plan.brief?.discussionTopic,
    },
    storeState: opts.storeState ?? buildStoreState(plan, scene),
    directorState: opts.directorState,
    messages: opts.messages ?? [
      { role: 'user', parts: [{ type: 'text', text: plan.brief?.topic ?? plan.id }] },
    ],
    userProfile: opts.userProfile,
    piSessionBoundary: opts.piSessionBoundary,
  };
}

// ==================== 服务 ====================

/**
 * @param {object} options
 * @param {object} [options.studio] `ctx.zhiyunClassroomStudio`
 * @param {{ call?: Function, stream?: Function }} [options.llm] 窄 llm 接口
 * @param {object} [options.log]
 * @param {() => string} [options.newId]
 */
export function createAgentService(options = {}) {
  const studio = options.studio ?? null;
  const llm = options.llm ?? null;
  const log = options.log ?? {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
  const newId = options.newId ?? (() => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  /** runId → 运行记录（只读快照给页面用）。 */
  const runs = new Map();

  const isAborted = (signal) => signal?.aborted === true;

  async function callLlm(request) {
    if (!llm) return null;
    if (typeof llm.call === 'function') {
      const text = await llm.call(request);
      return typeof text === 'string' ? text : String(text ?? '');
    }
    if (typeof llm.stream === 'function') {
      const parts = [];
      for await (const delta of await llm.stream(request)) parts.push(String(delta ?? ''));
      return parts.join('');
    }
    return null;
  }

  /**
   * 一个智能体的一个回合：产出 agent_start → (text_delta | action)* → agent_end。
   * 动作一律经过 `buildActionTools` 的校验状态机（与上游同一个守卫链）。
   */
  async function runAgentTurn({ plan, scene, agent, body, run, send, signal, whiteboardState, opts }) {
    const messageId = `msg-${run.state.agentResponses.length + 1}-${agent.id}`;
    await send({
      type: 'agent_start',
      data: {
        messageId,
        agentId: agent.id,
        agentName: agent.name,
        agentAvatar: agent.avatar,
        agentColor: agent.color,
        sceneId: scene.id,
      },
    });

    const availableActions = availableActionsFor(agent, scene.type, opts.enableWhiteboardTools !== false);
    const tools = buildActionTools({
      body,
      agent,
      messageId,
      send,
      onActionDone: (record) => run.onActionDone(record),
      abortSignal: signal,
      enableWhiteboardTools: opts.enableWhiteboardTools !== false,
      whiteboardState,
      authorizedSpotlightElementIds: opts.authorizedSpotlightElementIds,
    });

    let raw = null;
    if (!isAborted(signal)) {
      raw = await callLlm({
        stage: 'classroom-agent',
        agent: { id: agent.id, role: agent.role, name: agent.name },
        system: buildChildPrompt(body, agent, run.state.agentResponses, run.state.whiteboardLedger, availableActions),
        messages: [
          {
            role: 'user',
            content: buildChildTurnPrompt(
              opts.instruction ?? buildUserPrompt(body),
              agent.role,
              {},
            ),
          },
        ],
        signal,
        route: opts.route,
      });
    }

    // `raw === null` 表示没有注入 llm：走确定性话术（不发请求）。
    const text = raw === null ? composeFallbackSpeech(agent, scene) : raw;

    const parsed = parseAgentOutput(text);
    const sanitize = createVisibleSpeechDeltaSanitizer();
    let visible = '';
    let actionCount = 0;

    for (const item of parsed.ordered) {
      if (isAborted(signal)) break;
      if (item.type === 'text') {
        const chunk = parsed.textChunks[item.index] ?? '';
        const visibleDelta = sanitize(chunk);
        if (!visibleDelta) continue;
        visible += visibleDelta;
        await send({ type: 'text_delta', data: { content: visibleDelta, messageId } });
      } else {
        const action = parsed.actions[item.index];
        const tool = tools.find((candidate) => candidate.name === action.actionName);
        if (!tool) {
          run.recordToolCall({
            toolName: action.actionName,
            args: action.params,
            isError: true,
            result: {
              content: [{ type: 'text', text: `unknown action ${action.actionName}` }],
              details: { reason: 'unknown_action' },
            },
          });
          continue;
        }
        const result = await tool.execute(action.actionId, action.params);
        const verdict = run.recordToolCall({
          toolName: action.actionName,
          args: action.params,
          isError: Boolean(result?.isError),
          result,
        });
        if (result?.details?.skipped !== true) actionCount += 1;
        if (verdict?.terminate) break;
      }
    }

    await send({ type: 'agent_end', data: { messageId, agentId: agent.id } });
    run.onAgentDone({
      agentId: agent.id,
      agentName: agent.name,
      contentPreview: sanitizeVisibleSpeech(visible).slice(0, 300),
      actionCount,
    });
  }

  async function executeRun({ plan, opts, record, channel }) {
    const signal = record.controller.signal;
    const send = async (event) => {
      if (isAborted(signal)) return;
      channel.push(event);
    };

    try {
      const run = createDirectorRun({ agentConfigs: plan.agents });
      const whiteboardState = createWhiteboardRuntimeState(buildBody(plan, plan.scenes[0], opts));

      for (const scene of plan.scenes) {
        if (isAborted(signal)) break;
        const body = buildBody(plan, scene, opts);
        const speakers = scheduleTurn({
          agents: plan.agents,
          sessionType: opts.sessionType ?? plan.brief?.sessionType,
          sceneType: scene.type,
          triggerAgentId: opts.triggerAgentId,
          spokenAgentIds: [],
        });

        for (const agent of speakers) {
          if (isAborted(signal)) break;
          await runAgentTurn({
            plan,
            scene,
            agent,
            body,
            run,
            send,
            signal,
            whiteboardState,
            opts,
          });
        }
      }

      // 源：director-loop.ts:267-269 —— 本轮有内容就 cue 一次，让用户继续。
      if (!isAborted(signal) && !run.state.sessionClosed && !run.state.userCued && run.hasAgentContent()) {
        await run.cueUser(
          { fromAgentId: run.state.agentResponses.at(-1)?.agentId },
          send,
        );
      }

      if (!isAborted(signal)) {
        await send({ type: 'done', data: run.donePayload(record.compaction ?? null) });
      }
      record.status = isAborted(signal) ? 'cancelled' : 'done';
    } catch (error) {
      if (isAborted(signal)) {
        record.status = 'cancelled';
      } else {
        record.status = 'failed';
        record.error = error instanceof Error ? error.message : String(error);
        log.error('课堂编排失败', record.error);
        // 事件流也要把失败交出去 —— 静默结束会让页面以为"课上完了"。
        channel.push({ type: 'error', data: { message: record.error } });
      }
    } finally {
      record.endedAt = Date.now();
      channel.end();
    }
  }

  const service = {
    /**
     * brief → 计划。确定性、无 IO（除了 `studio.classroom.load` 的只读增强，
     * 且失败即忽略）。
     *
     * @param {object} brief
     * @returns {Promise<{id: string, version: string, brief: object, scenes: object[], roster: object, agents: object[], createdAt: string}>}
     */
    async plan(brief = {}) {
      const roster = resolveRoster(brief);
      const scenes = planScenes(brief);
      const plan = {
        id: brief.courseId ?? `plan-${Date.now().toString(36)}`,
        version: AGENT_PACKAGE_VERSION,
        brief,
        scenes,
        roster: { mode: roster.mode, selectedAgentIds: roster.selectedAgentIds },
        agents: roster.agents,
        createdAt: new Date().toISOString(),
      };

      // 宿主有真课堂就补一次只读快照（失败不影响计划本身 —— 规范 §4）。
      if (studio && typeof brief.courseId === 'string') {
        try {
          const loaded = await studio.classroom?.load?.(brief.courseId);
          if (loaded?.scenes?.length) plan.storeState = loaded;
        } catch (error) {
          log.debug?.('课堂快照不可用，plan 使用推导大纲', error?.message ?? error);
        }
      }

      return plan;
    },

    /**
     * 按计划跑一遍，返回 `{ runId, events }`；对象本身也可直接 `for await`。
     *
     * @param {object} plan `plan()` 的返回值
     * @param {object} [opts]
     * @param {AbortSignal} [opts.signal] 外部中止（与 `cancel(runId)` 等效）
     * @returns {{runId: string, events: AsyncIterable<object>, [Symbol.asyncIterator]: Function}}
     */
    run(plan, opts = {}) {
      if (!plan || !Array.isArray(plan.scenes) || plan.scenes.length === 0) {
        throw new ClassroomAgentError(ERROR_KINDS.INVALID_PLAN, 'run() 需要一个含 scenes 的计划');
      }
      if (!Array.isArray(plan.agents) || plan.agents.length === 0) {
        throw new ClassroomAgentError(ERROR_KINDS.INVALID_PLAN, 'run() 需要花名册（plan.agents 为空）');
      }

      const runId = opts.runId ?? newId();
      const controller = new AbortController();
      if (opts.signal) {
        if (opts.signal.aborted) controller.abort(opts.signal.reason);
        else opts.signal.addEventListener('abort', () => controller.abort(opts.signal.reason), { once: true });
      }

      const channel = createEventChannel();
      const record = {
        runId,
        planId: plan.id,
        status: 'running',
        startedAt: Date.now(),
        endedAt: null,
        error: null,
        controller,
        events: channel.iterator,
      };
      runs.set(runId, record);

      // 立即开跑（而不是等消费者第一次 next）：`cancel(runId)` 才能在迭代前生效。
      queueMicrotask(() => {
        executeRun({ plan, opts, record, channel });
      });

      return {
        runId,
        events: channel.iterator,
        [Symbol.asyncIterator]() {
          return channel.iterator;
        },
      };
    },

    /**
     * 取消一次运行。返回是否真的发生了状态变化（未知 runId → false）。
     */
    async cancel(runId) {
      const record = runs.get(runId);
      if (!record) return false;
      if (record.status !== 'running') return false;
      record.controller.abort(new ClassroomAgentError(ERROR_KINDS.ABORTED, `run ${runId} 已取消`));
      record.status = 'cancelled';
      record.endedAt = Date.now();
      // 宿主侧的 run 也取消（尽力而为）。
      try {
        await studio?.runs?.cancel?.(runId);
      } catch (error) {
        log.warn?.('宿主侧取消失败（已忽略）', error?.message ?? error);
      }
      return true;
    },

    runs: {
      get(runId) {
        const record = runs.get(runId);
        if (!record) return null;
        return {
          runId: record.runId,
          planId: record.planId,
          status: record.status,
          startedAt: record.startedAt,
          endedAt: record.endedAt,
          error: record.error,
        };
      },
      list() {
        return [...runs.values()].map((record) => ({
          runId: record.runId,
          planId: record.planId,
          status: record.status,
        }));
      },
    },

    /**
     * 自描述状态。`apply()` 永不因上游缺失抛错（规范 §4），缺什么写在这里。
     */
    async status() {
      let studioState = 'missing';
      let studioDetail;
      if (studio) {
        try {
          const result = await studio.status?.();
          studioState = result?.state ?? 'unknown';
          studioDetail = result?.detail;
        } catch (error) {
          studioState = 'degraded';
          studioDetail = { error: error?.message ?? String(error) };
        }
      }
      return {
        state: studioState === 'missing' ? 'degraded' : 'ready',
        version: AGENT_PACKAGE_VERSION,
        detail: {
          studio: studioState,
          studioDetail,
          llm: llm ? (typeof llm.call === 'function' ? 'injected' : 'stream') : 'fallback',
          runs: runs.size,
          implemented: {
            plan: true,
            run: true,
            cancel: true,
            directorPrompt: true,
            childPrompt: true,
            actionNormalization: true,
          },
        },
      };
    },
  };

  return service;
}

/**
 * 解析智能体输出。上游是**流式** `parseStructuredChunk`（partial-json + jsonrepair），
 * 本包拿到的是一次性完整文本（`llm.call` 的约定），所以这里做「整段解析」：
 * 先按 `[` 截断前缀，再 JSON.parse；失败就整段当自然语言（与上游 finalizeParser
 * 的「纯文本可显示、结构化残渣抑制」同一判断）。
 *
 * 源：ref/OpenMAIC/lib/chat/structured-output.ts:120-365（语义等价，非流式简化）
 */
export function parseAgentOutput(raw) {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  const result = { textChunks: [], actions: [], ordered: [] };
  const start = text.indexOf('[');
  const candidate = start === -1 ? text : text.slice(start);

  const accept = (items) => {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (item.type === 'text') {
        const content = item.content || '';
        if (!content) continue;
        result.textChunks.push(content);
        result.ordered.push({ type: 'text', index: result.textChunks.length - 1 });
      } else if (item.type === 'action') {
        result.actions.push(normalizeActionItem(item));
        result.ordered.push({ type: 'action', index: result.actions.length - 1 });
      }
    }
    return result;
  };

  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) return accept(parsed);
    if (parsed && typeof parsed === 'object' && 'type' in parsed) return accept([parsed]);
  } catch {
    // 落到下面的纯文本分支
  }

  // 纯自然语言（或结构化残渣）：只保留能安全展示的部分。
  const visible = looksLikeStructuredResidue(candidate) ? '' : text.trim();
  if (visible) {
    result.textChunks.push(visible);
    result.ordered.push({ type: 'text', index: 0 });
  }
  return result;
}

/** 与上游 `looksLikeStructuredFragment` 同一签名（structured-output.ts:248-266）。 */
function looksLikeStructuredResidue(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const hasSchemaKey =
    /^"?type"?\s*:\s*"(text|action)"/.test(trimmed) ||
    /^"(content|name|params|action_id)"\s*:/.test(trimmed);
  if (hasSchemaKey) return true;
  return /^[[{]\s*([[{"\]}]|$)/.test(trimmed);
}
