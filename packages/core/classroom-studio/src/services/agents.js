/**
 * `GET/POST /api/agents`（源文件:app/api/agents/route.ts:1-48）。
 *
 * 上游 body 原样保留：
 *
 * - GET：无持久层 → 纯文本 404；有 → owner 的内置 agent（`readOnly: true`）+ 自定义 agent；
 * - POST：`{ agent }` 建自定义 agent；id 已存在 409 `AGENT_EXISTS`，内置 id 403
 *   `BUILT_IN_AGENT_READ_ONLY`；成功 201 `{ agent }`。
 *
 * 依赖面（`lib/server/agents/*`、`lib/orchestration/registry/wire`）是 `pg` + 代码里的
 * 内置 agent 清单，本包没有；所以它们是**注入端口** `deps.agents`：
 *
 * ```js
 * deps.agents = {
 *   list(ownerId)                  -> Agent[]            // 内置 + 自定义
 *   create(ownerId, agent)         -> stored             // 已存在/内置 id 抛 AgentWriteError
 *   view(agent)                    -> AgentView
 *   customConfig(stored)           -> agent（原样给 view）
 *   parseBody(body)                -> { ok, agent } | { ok:false, code, message }
 *   writeError(error)              -> { code, status } | null
 *   isBuiltIn(id)                  -> boolean
 * }
 * ```
 *
 * 未注入时的降级（**记在 ROUTES.md**）：`list` 读 vault 的 kv（`agents/<id>`），
 * `create` 写 kv；`view` 恒等；没有内置 agent。也就是说「没装 L2 注册表」时
 * 只有自定义 agent 可见，而不是编一份内置清单 —— 编出来的 id 会让生成链路去
 * 找一个不存在的 agent。
 */

import { jsonError, jsonResponse, plainResponse, serviceOf, withOwner, NOT_FOUND } from './support.js';

/** 上游 `customAgentSchema` 的必填面（`id` + `name`；其余由 schema 判）。 */
function defaultParseBody(body) {
  const agent = body && typeof body === 'object' ? body.agent : undefined;
  if (!agent || typeof agent !== 'object') {
    return { ok: false, code: 'INVALID_REQUEST', message: 'Expected { agent }' };
  }
  if (typeof agent.id !== 'string' || !agent.id.trim()) {
    return { ok: false, code: 'INVALID_REQUEST', message: 'agent.id is required' };
  }
  if (typeof agent.name !== 'string' || !agent.name.trim()) {
    return { ok: false, code: 'INVALID_REQUEST', message: 'agent.name is required' };
  }
  return { ok: true, agent };
}

/** 未注入时的最小端口：vault kv 存自定义 agent（单机可用，语义与上游同：owner 分区）。 */
function vaultBackedAgents(deps) {
  const kv = () => serviceOf(deps, 'vault').kv;
  return {
    isBuiltIn: () => false,
    view: (agent) => agent,
    customConfig: (stored) => stored,
    parseBody: defaultParseBody,
    writeError: (error) => {
      if (error?.kind === 'duplicate' || error?.code === 'E_CONFLICT') {
        return { code: 'AGENT_EXISTS', status: 409 };
      }
      return null;
    },
    async list() {
      const keys = await kv().keys('agents/');
      const agents = [];
      for (const key of keys) {
        // eslint-disable-next-line no-await-in-loop
        const value = await kv().get(key);
        if (value) agents.push(value);
      }
      return agents;
    },
    async create(ownerId, agent) {
      const key = `agents/${agent.id}`;
      const existing = await kv().get(key);
      if (existing) {
        const error = new Error('agent exists');
        error.kind = 'duplicate';
        throw error;
      }
      await kv().set(key, agent);
      return agent;
    },
  };
}

/**
 * @param {object} deps 见 `src/services/support.js`
 * @param {object} [deps.agents] 注入端口（见文件头）
 * @param {(ownerId: string) => string} [deps.ownerKey] 展示用的 userKey；默认就是 ownerId
 */
export function createAgentsService(deps) {
  const agents = () => deps.agents ?? vaultBackedAgents(deps);
  const isConfigured = () => {
    if (typeof deps.persistenceConfigured === 'function') return Boolean(deps.persistenceConfigured());
    return Boolean(serviceOf(deps, 'vault'));
  };

  return {
    /** 源文件:agents/route.ts:23-29（GET）。 */
    async list(request) {
      if (!isConfigured()) return plainResponse(404, NOT_FOUND);
      return withOwner(deps, request, async ({ ownerId, headers }) => {
        const list = await agents().list(ownerId);
        return jsonResponse({ agents: list.map((agent) => agents().view(agent)) }, 200, headers);
      });
    },

    /** 源文件:agents/route.ts:31-48（POST）。 */
    async create(request, body) {
      if (!isConfigured()) return plainResponse(404, NOT_FOUND);
      return withOwner(deps, request, async ({ ownerId, headers }) => {
        const port = agents();
        const parsed = await port.parseBody(body);
        if (!parsed.ok) {
          // 上游 `agentsJsonError`：`{ error: { code, message } }`（不是 apiError 信封）。
          return jsonError(parsed.status ?? 400, parsed.code ?? 'INVALID_REQUEST', parsed.message, headers);
        }
        if (parsed.agent.id && port.isBuiltIn(parsed.agent.id)) {
          return jsonError(403, 'BUILT_IN_AGENT_READ_ONLY', 'built-in agents cannot be changed or deleted', headers);
        }
        try {
          const stored = await port.create(ownerId, parsed.agent);
          return jsonResponse({ agent: port.view(port.customConfig(stored)) }, 201, headers);
        } catch (error) {
          const refused = port.writeError(error);
          if (refused) {
            return jsonError(
              refused.status ?? 400,
              refused.code,
              refused.message ?? error?.message ?? refused.code,
              headers,
            );
          }
          throw error;
        }
      });
    },
  };
}
