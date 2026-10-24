// Shared OpenAI-compatible transport for the lecture and quiz benchmarks.
const scrub=(text,key)=>String(text??"").split(key||"\u0000").join("[REDACTED]").slice(0,1200);
export function openAiHost({ baseUrl, apiKey, model, visionModel, timeoutMs = 240000 }) {
  const endpoint = String(baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const calls = [];

  const toMessages = (messages) => messages.map((msg) => {
    const parts = [];
    for (const block of msg.content ?? []) {
      if (block.type === 'text') { parts.push({ type: 'text', text: block.text }); continue; }
      if (block.type === 'image') {
        const data = block.attachment?.data;
        const mediaType = block.attachment?.mediaType ?? 'image/jpeg';
        if (!data) continue;
        const b64 = Buffer.isBuffer(data) ? data.toString('base64') : String(data);
        parts.push({ type: 'image_url', image_url: { url: `data:${mediaType};base64,${b64}` } });
      }
    }
    // 纯文本用字符串形态（兼容面最广）；带图才用分段数组。
    const onlyText = parts.every((p) => p.type === 'text');
    return { role: msg.role, content: onlyText ? parts.map((p) => p.text).join('\n') : parts };
  });

  return {
    calls,
    async resolveModelInfo() {
      // 声明支持图片：用户既然填了视觉模型，基准就不做二次判断
      //（产品自己的 `VISION_MODEL` 预检要的正是这个声明）。
      return { inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'off' }] } };
    },
    async prepareCall(config, prepareSignal) {
      return {
        config,
        inputModalities: ['text', 'image'],
        stream: async function* run(options) {
          const hasImage = (options.messages ?? []).some((m) => (m.content ?? []).some((b) => b.type === 'image'));
          /* ★ 模型名**以用户填的为准**，不要用 `config.model`。
           *
           * 产品组装 route 时用的是宿主的 `agentDefaultModel`，而基准的桩回的是
           * `{ provider:'bench', model:'bench' }` —— 所以 `config.model` 是 `'bench'`，
           * 直接发给服务端会被判"模型不存在"。
           * 早先写的是 `visionModel || config.model`：只在用户留空时才回退，
           * 于是正常填了模型的情况反而把 `bench` 发了出去。这是实跑会直接失败的那个 bug。
           */
          const chosen = hasImage
            ? (visionModel || model)          // 视觉：优先专用视觉模型，否则用对话模型
            : (model || visionModel);         // 文本：优先对话模型
          if (!chosen) throw Object.assign(new Error('没有填模型名'), { code: 'NO_MODEL' });
          const body = { model: chosen, messages: toMessages(options.messages ?? []), stream: true };
          if (config.maxTokens != null) body.max_tokens = config.maxTokens;

          /* ★ **关掉思考模式**。
           *
           * DeepSeek 的思考模式**默认开启**、effort 默认 `high`。对本基准而言它是纯亏：
           *   · 转述一页课件 / 按答题卡打标 / 切块，都不需要推理；
           *   · 它会先吐一大段 `reasoning_content` 再给 `content` —— 慢好几倍、贵好几倍；
           *   · 多轮时还必须回传 `reasoning_content`，否则 400（本基准每阶段都是单轮，
           *     但一旦以后加了重试轮就会踩到）。
           *
           * OpenAI 格式的开关是 `thinking: {type:'disabled'}`，要放进请求体顶层
           *（Python SDK 里是 `extra_body`，即最终还是落在这个位置）。
           * 同时把 `reasoning_effort` 压到 `low` 作为双保险 —— 老版本网关可能不认
           * `thinking`，但都认 `reasoning_effort`。
           */
          body.thinking = { type: 'disabled' };
          body.reasoning_effort = 'low';

          calls.push({ model: chosen, vision: hasImage, at: Date.now() });

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: options.signal ?? prepareSignal,
          });
          if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw Object.assign(new Error(`模型接口 ${response.status}：${scrub(text, apiKey)}`),
              { code: 'LLM_HTTP', status: response.status });
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '', index = 0, finish = null, usage = null;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (payload === '[DONE]') continue;
              let chunk; try { chunk = JSON.parse(payload); } catch { continue; }
              if (chunk.usage) usage = chunk.usage;
              const choice = chunk.choices?.[0];
              if (!choice) continue;
              const delta = choice.delta?.content;
              if (delta) yield { type: 'text-delta', index, text: delta };
              if (choice.finish_reason) {
                finish = { kind: choice.finish_reason === 'stop' ? 'stop'
                  : choice.finish_reason === 'length' ? 'max-tokens' : choice.finish_reason };
              }
            }
          }
          if (usage) yield { type: 'usage', usage };
          yield { type: 'finish', reason: finish ?? { kind: 'unknown' } };
        },
      };
    },
  };
}
