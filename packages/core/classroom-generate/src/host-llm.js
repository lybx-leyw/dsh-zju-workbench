/**
 * 把宿主的 `ctx.llm`（`prepareCall` + `stream`）适配成课堂生成要的窄接口 `{ call }`。
 *
 * # 为什么需要这层
 *
 * 课堂生成最初只认 `zhiyunClassroomStudio.providers.list()` —— 那是从**上游
 * 浙大服务端**要「用哪个模型」的清单。这条路径有两个问题：
 *
 *   1. 它依赖课堂登录态。登录失效时（`providers.list()` 返回 `{}`），
 *      整个「AI 备课」就不可用 —— 哪怕本仓自己的 `ctx.llm` 完全正常。
 *   2. 析、讲义、出题三条链路都走 `ctx.llm`，只有课堂生成绕出去问别人，
 *      这本身就是不合理的耦合。
 *
 * 所以这里把宿主 llm 包成 `{ call }`，让课堂生成可以直接用本仓模型。
 *
 * # 两层签名不要搞混
 *
 * 宿主 llm 有两层，参数形状不同（`core-question-backend.js` 里踩过两次）：
 *
 *   顶层 LlmRuntime.prepareCall(config, signal)          ← config 是**对象**
 *     └─ adapter.prepareCall(provider, model, signal)    ← **位置参数**
 *
 * 这里用的是顶层，所以必须传对象。传位置参数会让 `config.provider` 变成
 * undefined，报 `no adapter registered for provider "undefined"`。
 */

/**
 * @param {object} llm 宿主 llm 服务
 * @returns {{ call: (request: object) => Promise<string> } | null}
 */
export function createHostLlmTransport(llm) {
  if (!llm || typeof llm.prepareCall !== 'function') return null;

  return {
    /**
     * @param {object} request
     * @param {string} [request.provider]
     * @param {string} [request.model]
     * @param {string} [request.system]   系统提示
     * @param {string} [request.prompt]   用户输入
     * @param {Array}  [request.messages] 完整消息（优先于 system/prompt）
     * @param {AbortSignal} [request.signal]
     * @returns {Promise<string>}
     */
    async call(request = {}) {
      const signal = request.signal;

      // ⚠️ 只把**有值**的 provider/model 传进去。
      //
      // 传 `{ provider: undefined }` 会让宿主的 registration() 去找名为
      // "undefined" 的 provider，报 `no adapter registered for provider "undefined"`
      // （core-question-backend.js 记过同一个坑）。
      // 不传这两个字段时，宿主会用它自己解析出的默认模型 —— 这正是我们要的：
      // 课堂生成不该替用户决定用哪个模型。
      const callConfig = {};
      if (request.provider) callConfig.provider = request.provider;
      if (request.model) callConfig.model = request.model;

      const prepared = await llm.prepareCall(callConfig, signal);

      const messages = Array.isArray(request.messages) && request.messages.length
        ? request.messages.map(toBlocks)
        : buildMessages(request);

      const parts = [];
      const seen = [];
      for await (const chunk of prepared.stream({
        ...(prepared.config ?? {}),
        messages,
        signal,
      })) {
        // 记账：只留类型，不打印内容（可能是大段文本）
        if (chunk?.type) seen.push(chunk.type);
        // 宿主 llm 的流式块是 `text-delta`（不是 `text`），正文在 `chunk.text`。
        // 完整列表：block-start / reasoning-delta / block-end /
        //           text-delta / usage / finish
        // 判断错类型会让 2838 个 chunk 里一个文本都收不到，
        // 上层只看到「模型返回 0 字符」，而原因在这里。
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
          parts.push(chunk.text);
        } else if (chunk?.type === 'text' && typeof chunk.text === 'string') {
          // 兼容非流式适配器（个别 provider 直接给整块 text）
          parts.push(chunk.text);
        }
        // finish 的 reason 不是 stop 时，说明输出被截断或模型异常退出。
        // 静默当成功会让上层拿到半截 JSON，最终表现成「解析不出页面」。
        //
        // ⚠️ `reason` 是**对象**不是字符串：`{ kind: 'stop' | 'tool-calls' | 'error' | 'aborted', failure?: { code, message } }`。
        // 早先写成 `chunk.reason !== 'stop'`，永远为真，报出
        // `模型没有正常结束（[object Object]）` —— 与 core-question-backend.js
        // 的 finishError 保持同一读法。
        else if (chunk?.type === 'finish') {
          const reason = chunk.reason;
          const kind = reason?.kind;
          if (reason && kind !== 'stop' && kind !== 'tool-calls') {
            const failure = reason.failure ?? {};
            const error = new Error(
              failure.message ?? `模型未正常结束：${kind ?? 'unknown'}`,
            );
            error.code = failure.code ?? (kind === 'aborted' ? 'CANCELLED' : 'E_UPSTREAM_ERROR');
            throw error;
          }
        }
      }
      if (!parts.length) {
        // 空产出必须有解释：是模型没回文本（只有 thinking/tool_use），
        // 还是 stream 一个 chunk 都没给。静默返回 '' 会让上层一路
        // 报「内容无法解析（模型返回 0 字符）」，而真正的原因在这里。
        throw Object.assign(
          new Error(`模型没有返回文本（收到 ${seen.length} 个 chunk${seen.length ? `：${[...new Set(seen)].join('/')}` : ''}）`),
          { code: 'E_UPSTREAM_ERROR', detail: { chunkTypes: [...new Set(seen)] } },
        );
      }
      return parts.join('');
    },
  };
}

/**
 * 把消息的 `content` 统一成**块数组**。
 *
 * 上层（`phases/outline.js` 等）习惯写 `{ role, content: '一段字符串' }`，
 * 那是 OpenAI 方言。宿主的 DeepSeek/Anthropic 适配器要求 content 是
 * `[{ type: 'text', text }]` —— 传字符串会在适配器内部做 `.some()` 时炸掉，
 * 最终被冒泡成 `DeepSeek Messages transport failed`（`core-question-backend.js`
 * 记过同一个坑）。
 *
 * 所以在进宿主之前统一转一次，上层不用关心方言差异。
 */
function toBlocks(message) {
  if (!message || typeof message !== 'object') return message;
  const { content } = message;
  if (typeof content === 'string') {
    return { ...message, content: [{ type: 'text', text: content }] };
  }
  if (Array.isArray(content)) return message;
  // content 缺失时给一个空块，避免宿主拿到 undefined 再炸一次
  return { ...message, content: [{ type: 'text', text: '' }] };
}

/**
 * 组装消息。
 *
 * Anthropic Messages 方言要求 `content` 是**块数组**，传字符串会让宿主的
 * `.some is not a function` 报错，最终被冒泡成 TRANSPORT 失败
 * （`core-question-backend.js` 里记过这个坑）。
 */
function buildMessages({ system, prompt, messages }) {
  if (Array.isArray(messages) && messages.length) return messages;

  const list = [];
  if (typeof system === 'string' && system.trim()) {
    list.push({ role: 'system', content: [{ type: 'text', text: system }] });
  }
  list.push({
    role: 'user',
    content: [{ type: 'text', text: String(prompt ?? '') }],
  });
  return list;
}
