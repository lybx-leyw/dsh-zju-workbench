// 源：ref/OpenMAIC/lib/server/generation/run/services.ts:1-160（模型槽 → provider/model 的解析）
// 源：ref/OpenMAIC/lib/server/provider-config.ts:706-740（getServerProviders 的返回值形状）
// 源：ref/OpenMAIC/app/api/server-providers/route.ts:16-38（providers 清单的 HTTP body）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/pipeline-types.ts:60-64（AICallFn 的签名）

import { ClassroomGenerateError } from './errors.js';

/**
 * LLM 解析：**provider 从宿主来，通道从注入来**。
 *
 * 上游浏览器端不持有 key：它把「用哪个模型」交给服务端的模型槽解析
 * （`resolveModelSlot`），自己只发 prompt。这里照同一分工：
 *
 *   1. `ctx.zhiyunClassroomStudio.providers.list()` → `{ httpStatus, body }`；
 *      `body.providers` 是 `Record<providerId, { models?: string[] }>`（L1 的降级
 *      实现返回 `{}`，也就是「一个都没配」）；
 *   2. 取第一个有模型清单的 provider（或用调用方指定的 `provider`/`model`）；
 *   3. 通道用注入的窄 llm（`config.llm`，形状与 core-classroom-agent / core-classroom-pbl
 *      的 `{ call }` 一致；也接受 `{ stream }`）。
 *
 * 解析不到就抛**带 code 的领域错误**，不返回半个可用对象：
 *   - 清单为空 / 读取失败 → `E_NO_LLM_PROVIDER`（让用户去设置页配模型）
 *   - 清单有、通道没有 → `E_NO_LLM_TRANSPORT`（让部署方注入 config.llm）
 *
 * 两条分开是因为处置完全不同：前者是用户问题，后者是部署问题。上游把两者
 * 都折成 400 `MODEL_NOT_CONFIGURED`，代价是运维得看日志才知道该动谁
 * （见 `ref/OpenMAIC/lib/server/generate-classroom-job.ts` 的 requiredModelRefusal）。
 */

export const DEFAULT_LANGUAGE_DIRECTIVE = 'Teach in the language that matches the user requirement.';

/**
 * @param {object} options
 * @param {object|null} options.studio `ctx.zhiyunClassroomStudio`（可为 null）
 * @param {object|null} [options.llm] 窄 llm：`{ call }` 或 `{ stream }`
 * @param {string} [options.provider] 指定 providerId
 * @param {string} [options.model] 指定 model
 * @returns {Promise<{providerId: string|null, model: string|null, call: Function}>}
 */
export async function resolveLlm({ studio = null, llm = null, provider, model } = {}) {
  if (!studio || typeof studio.providers?.list !== 'function') {
    throw new ClassroomGenerateError(
      'E_MISSING_SERVICE',
      '课堂生成需要 zhiyunClassroomStudio.providers（模型清单由宿主解析）',
      { service: 'zhiyunClassroomStudio' },
    );
  }

  let listed;
  try {
    listed = await studio.providers.list();
  } catch (error) {
    throw new ClassroomGenerateError(
      'E_NO_LLM_PROVIDER',
      `读取 provider 清单失败：${messageOf(error)}`,
      { service: 'zhiyunClassroomStudio.providers.list', cause: messageOf(error) },
    );
  }

  const body = listed && typeof listed === 'object' && 'body' in listed ? listed.body : listed;
  const providers = body && typeof body === 'object' && body.providers && typeof body.providers === 'object'
    ? body.providers
    : {};

  const picked = pickProvider(providers, { provider, model });
  if (!picked) {
    throw new ClassroomGenerateError(
      'E_NO_LLM_PROVIDER',
      '服务端没有配置任何对话模型 provider（providers.list() 为空）',
      { providers: Object.keys(providers) },
    );
  }

  const transport = normalizeTransport(llm);
  if (!transport) {
    throw new ClassroomGenerateError(
      'E_NO_LLM_TRANSPORT',
      `已解析到模型 ${picked.providerId}/${picked.model ?? '(默认)'}，但没有可用的 LLM 传输通道（请注入 config.llm）`,
      { providerId: picked.providerId, model: picked.model },
    );
  }

  return {
    providerId: picked.providerId,
    model: picked.model,
    /**
     * 窄调用。`stage` 让上层模型路由能按用途分流（与 core-classroom-agent 的
     * `callLlm({ stage: 'classroom-agent' })` 同一约定）。
     */
    async call(request = {}) {
      const payload = {
        ...request,
        provider: request.provider ?? picked.providerId,
        model: request.model ?? picked.model ?? undefined,
      };
      try {
        const text = await transport(payload);
        return typeof text === 'string' ? text : String(text ?? '');
      } catch (error) {
        if (error instanceof ClassroomGenerateError) throw error;
        throw new ClassroomGenerateError(
          'E_UPSTREAM_ERROR',
          `模型调用失败：${messageOf(error)}`,
          { stage: request.stage, providerId: picked.providerId, model: picked.model, cause: messageOf(error) },
        );
      }
    },
  };
}

/** 只认 `{ providers: { id: { models: [...] } } }`；没有 models 的条目排在后面但仍可选中。 */
function pickProvider(providers, { provider, model } = {}) {
  const ids = Object.keys(providers);
  if (ids.length === 0) return null;

  if (provider && providers[provider]) {
    return { providerId: provider, model: model ?? firstModel(providers[provider]) };
  }

  const sorted = ids.slice().sort();
  for (const id of sorted) {
    const candidate = firstModel(providers[id]);
    if (candidate) return { providerId: id, model: model ?? candidate };
  }

  // 有条目但没有模型清单：模型名交给传输层默认值（上游的 `defaultModel` 语义）。
  return { providerId: model ? sorted[0] : sorted[0], model: model ?? null };
}

function firstModel(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const models = Array.isArray(entry.models) ? entry.models : null;
  if (models && models.length > 0 && typeof models[0] === 'string') return models[0];
  if (typeof entry.defaultModel === 'string' && entry.defaultModel) return entry.defaultModel;
  if (typeof entry.model === 'string' && entry.model) return entry.model;
  return null;
}

/** 把注入的窄 llm 折成一个 `async (request) => string`；不认识的形状返回 null。 */
function normalizeTransport(llm) {
  if (!llm || typeof llm !== 'object') return null;

  if (typeof llm.call === 'function') {
    return async (request) => llm.call(request);
  }

  if (typeof llm.stream === 'function') {
    return async (request) => {
      const stream = await llm.stream(request);
      if (typeof stream === 'string') return stream;
      const parts = [];
      for await (const delta of stream) parts.push(String(delta ?? ''));
      return parts.join('');
    };
  }

  return null;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? '');
}
