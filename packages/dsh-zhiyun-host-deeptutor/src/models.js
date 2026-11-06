/**
 * 模型桥：Python 侧反向请求 `llm.stream` / `llm.complete` / `quota.*` 的宿主实现。
 *
 * ## 这一层在整个插件里的位置
 *
 * Python 侧的 `python/llm_shim.py` 会把上游 `deeptutor.services.llm.complete`
 * / `.stream` 换成「经桥转发」的版本，于是上游整条出题/研究/讲解流水线用的
 * 都是**宿主自己的模型**（用户的 provider / key / 配额），而不是上游配置里的。
 * 转发的那一跳就落在这里：Python 发 `{"id":"s3","method":"llm.stream",...}`，
 * 我们调 `ctx.llm`，把结果聚合后作为响应回过去（契约 §3.2）。
 *
 * ## 怎么挂到桥上去（service / index 侧接线说明）
 *
 * `src/service.js` 只读取 `llmBridge.selection()` 拿运行快照；**反向请求的
 * 订阅是另一件事**，必须由装配方显式挂上，二选一：
 *
 * ```js
 * const llmBridge = createLlmBridge({ llm: () => ctx.llm, attachments: () => ctx.attachments, getSelection });
 * // ① 首选：attachTo 自己管订阅，返回幂等退订函数
 * const detach = llmBridge.attachTo(bridge);
 * // ② 等价写法：handleRequest 就是 bridge.onRequest 期望的 handler 形状
 * bridge.onRequest((method, params) => llmBridge.handleRequest(method, params));
 * ```
 *
 * `handleRequest` 对**不属于自己**的方法返回 `undefined`（不是抛错），这样桥的
 * handler 链能继续把 `quota.*` 交给别的订阅者；全链都不处理时 `PythonBridge`
 * 会按契约回 `-32601` 错误，Python 侧不会挂死。
 *
 * ## 不配模型不是崩溃
 *
 * `llm` / `attachments` 都是**惰性注入**（本插件可能先于 `dsh-llm` 加载，构造期
 * 取值会拿到 undefined 并永久钉死）。取不到时按契约 §7 的五态语义回
 * `E_DISABLED` / `E_CAPABILITY_UNAVAILABLE` —— 「没配模型 = 不可用」，而不是让
 * 一次出题跑成 `E_INTERNAL` 崩溃。
 */

import { randomUUID } from 'node:crypto';
import { CALLBACKS, DeepTutorError, NOTIFICATIONS } from './protocol.js';
import {withWireOptions} from './wire-options.js';

/** 上游调用未显式给 model 时，回落到 selection 里的一次调用最多等多久。 */
const DEFAULT_LLM_TIMEOUT_MS = 900_000;

/** 宿主接受的图片媒体类型（`@deepseek-ai/dsh-attachment` 的 `ImageMediaType`）。 */
const IMAGE_MEDIA_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** 记日志用的最小 logger（调用方可能不传）。 */
function makeLogger(logger) {
  const noop = () => {};
  if (!logger || typeof logger !== 'object') return { warn: noop, info: noop, debug: noop, error: noop };
  return {
    warn: typeof logger.warn === 'function' ? logger.warn.bind(logger) : noop,
    info: typeof logger.info === 'function' ? logger.info.bind(logger) : noop,
    debug: typeof logger.debug === 'function' ? logger.debug.bind(logger) : noop,
    error: typeof logger.error === 'function' ? logger.error.bind(logger) : noop,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textOf(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : String(value);
}

/** 上游 `{input,output,total}` 或宿主 `TokenUsage` → 契约 §3.2 的 usage。 */
function toBridgeUsage(usage) {
  if (!isRecord(usage)) return { input: 0, output: 0, total: 0 };
  const input = Number(
    usage.input ?? usage.inputTokens ?? usage.prompt_tokens ?? 0,
  ) || 0;
  const output = Number(
    usage.output ?? usage.outputTokens ?? usage.completion_tokens ?? 0,
  ) || 0;
  const explicitTotal = Number(usage.total ?? usage.totalTokens ?? 0) || 0;
  // 宿主的计数字段是**互不重叠**的：inputTokens 不含缓存命中，所以「总输入」
  // 要把 cacheRead/cacheWrite 加回来，否则上报给 Python 的 total 会偏小。
  const cacheRead = Number(usage.cacheReadTokens ?? 0) || 0;
  const cacheWrite = Number(usage.cacheWriteTokens ?? 0) || 0;
  const total = explicitTotal || input + output + cacheRead + cacheWrite;
  return { input, output, total };
}

/**
 * 上游一条 content part → 宿主 `ContentBlock`。
 *
 * 图片部分需要 `attachment` 引用（宿主只认 durable ref，不认裸 base64）。已经
 * 是引用形态的直接透传；内联 base64 由调用方先经 `resolveInlineImages()` 换成
 * 引用后放进来。**换不掉的图片不静默丢弃**，降级成一行说明文字：模型看不到
 * 图时至少知道自己本该看到图，而不是把"没图"当成事实。
 */
function toContentBlock(part, images, key) {
  if (typeof part === 'string') return { type: 'text', text: part };
  if (!isRecord(part)) return { type: 'text', text: textOf(part) };
  const type = textOf(part.type);
  if (type === 'image' || type === 'image_url' || type === 'input_image') {
    const resolved = images?.get?.(key) ?? (isRecord(part.attachment) ? part.attachment : null);
    if (isRecord(resolved) && typeof resolved.attachmentId === 'string') {
      return { type: 'image', attachment: resolved };
    }
    const name = textOf(part.name || part?.image_url?.name || '') || '未命名图片';
    return { type: 'text', text: `[图片已省略：${name}（宿主没有可用的附件引用）]` };
  }
  if (type === 'file' && isRecord(part.attachment)) return { type: 'file', attachment: part.attachment };
  // 已渲染的文本块 / 未知块：上游偶尔会带 reasoning 等扩展 type，统一按文本透传，
  // 丢掉它们等于丢掉模型说过的话。
  return { type: 'text', text: textOf(part.text ?? part.content ?? '') };
}

/**
 * 上游 messages → 宿主 `RequestMessage[]`（契约 §13 声明的公开签名）。
 *
 * @param {Array<object>} messages - 上游 `{role, content}` 数组；`content` 可以是
 *   字符串、content part 数组，或 `{type:'text',text}` 单块。
 * @param {{provider?:string, model?:string, images?:Map<string,object>}} [options]
 *   `images` 是 `resolveInlineImages()` 的产物，键为 `"<messageIndex>:<partIndex>"`。
 * @returns {Array<object>} 宿主消息数组（system 角色转成 `system-prompt` 消息，
 *   由调用方提升到 `GenerateOptions.system`；见 `buildRequest()`）。
 */
export function toHostMessages(messages, { provider = 'zhiyun-deeptutor', model = 'upstream', images = null } = {}) {
  const out = [];
  const list = Array.isArray(messages) ? messages : [];
  for (const [messageIndex, message] of list.entries()) {
    if (!isRecord(message)) continue;
    const role = textOf(message.role || 'user') || 'user';
    const raw = message.content;
    const parts = Array.isArray(raw) ? raw : [raw];
    const content = [];
    for (const [partIndex, part] of parts.entries()) {
      if (part === null || part === undefined) continue;
      if (typeof part === 'string' && part === '') continue;
      content.push(toContentBlock(part, images, `${messageIndex}:${partIndex}`));
    }
    if(role==='assistant')for(const call of message.tool_calls??[]){
      if(!call?.id||!call?.function?.name)throw new DeepTutorError('E_PROTOCOL','工具调用历史缺少 ID 或函数名');
      content.push({type:'tool-call',id:call.id,name:call.function.name,arguments:typeof call.function.arguments==='string'?call.function.arguments:JSON.stringify(call.function.arguments??{})});
    }
    if (content.length === 0) content.push({ type: 'text', text: '' });

    if (role === 'system' || role === 'developer') {
      out.push({ id: randomUUID(), role: 'system', source: { kind: 'system-prompt' }, content });
      continue;
    }
    if (role === 'assistant') {
      // assistant 消息必须带 `source: {kind:'model', provider, model}`：宿主据此
      // 决定回放/投影策略，缺了它整条请求会被拒绝。
      out.push({ id: randomUUID(), role: 'assistant', source: { kind: 'model', provider, model }, content });
      continue;
    }
    if (role === 'tool') {
      const callId = textOf(message.callId || message.tool_call_id || message.id || '');
      out.push({ id: randomUUID(), role: 'tool', source: { kind: 'tool', callId }, content });
      continue;
    }
    // 用户消息走 `RequestUserInput`：**不允许**带 id / source（类型上是 never），
    // 带上就被宿主校验拒绝，所以这里刻意不构造它们。
    out.push({ role: 'user', content });
  }
  return out;
}

/** data URL → `{mediaType, data}`；认不出返回 null。 */
function parseDataUrl(url) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(textOf(url));
  if (!match) return null;
  const mediaType = match[1] || 'application/octet-stream';
  if (!IMAGE_MEDIA_TYPES.includes(mediaType)) return null;
  if (!match[2]) return null; // 只接受 base64 内联，URL 形式宿主不代下载
  try {
    return { mediaType, data: Buffer.from(match[3], 'base64') };
  } catch {
    return null;
  }
}

/**
 * 把上游消息里**内联 base64** 的图片提交到宿主附件服务，得到 durable 引用。
 *
 * 没有 `attachments` 服务时直接返回空 Map —— `toHostMessages` 会把这些图片降级成
 * 一行占位文字（且不静默），而不是抛错把整次模型调用废掉。
 *
 * @returns {Promise<Map<string, object>>} 键为 `"<messageIndex>:<partIndex>"`。
 */
async function resolveInlineImages(messages, attachments, logger) {
  const images = new Map();
  if (!attachments || typeof attachments.saveImage !== 'function') return images;
  const list = Array.isArray(messages) ? messages : [];
  for (const [messageIndex, message] of list.entries()) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const [partIndex, part] of message.content.entries()) {
      if (!isRecord(part)) continue;
      const type = textOf(part.type);
      if (type !== 'image' && type !== 'image_url' && type !== 'input_image') continue;
      let parsed = null;
      if (typeof part.data === 'string' && IMAGE_MEDIA_TYPES.includes(textOf(part.mediaType))) {
        parsed = { mediaType: textOf(part.mediaType), data: Buffer.from(part.data, 'base64') };
      } else {
        const url = part?.image_url?.url ?? part.url ?? part?.image_url ?? null;
        if (typeof url === 'string') parsed = parseDataUrl(url);
      }
      if (!parsed) continue;
      try {
        const ref = await attachments.saveImage({
          data: new Uint8Array(parsed.data),
          mediaType: parsed.mediaType,
          name: textOf(part.name || part?.image_url?.name || '') || undefined,
        });
        if (isRecord(ref)) images.set(`${messageIndex}:${partIndex}`, ref);
      } catch (error) {
        // 单张图片存不下（超限/格式不被接受）不该废掉整次调用：留给占位文字。
        logger.warn('提交上游图片到附件服务失败（该图将降级为占位文字）', error?.message ?? error);
      }
    }
  }
  return images;
}

/** 从宿主消息里把 system 文本挑出来，作为 `GenerateOptions.system` 单发。 */
function splitSystem(messages) {
  const system = [];
  const rest = [];
  for (const message of messages) {
    if (message?.role === 'system') {
      const text = (message.content ?? [])
        .filter((block) => block?.type === 'text')
        .map((block) => textOf(block.text))
        .join('\n');
      if (text) system.push(text);
      continue;
    }
    rest.push(message);
  }
  return { system: system.join('\n\n'), messages: rest };
}

/** 上游 `tools`（OpenAI 形状）→ 宿主 `ToolSchema[]`；无法识别的条目丢弃并记日志。 */
function toToolSchemas(tools, logger) {
  if (!Array.isArray(tools)) return undefined;
  const out = [];
  for (const tool of tools) {
    const fn = isRecord(tool) && isRecord(tool.function) ? tool.function : tool;
    if (!isRecord(fn) || !fn.name) {
      logger.warn('上游 tools 条目无法识别（已忽略该条）', { sample: JSON.stringify(tool).slice(0, 200) });
      continue;
    }
    out.push({
      name: textOf(fn.name),
      description: textOf(fn.description),
      parameters: isRecord(fn.parameters) ? fn.parameters : { type: 'object', properties: {} },
    });
  }
  return out.length ? out : undefined;
}

/**
 * 创建模型桥。
 *
 * @param {object} [options]
 * @param {Function|object} [options.llm] - `ctx.llm`，或返回它的惰性函数
 * @param {Function|object} [options.attachments] - `ctx.attachments`，或惰性函数
 * @param {Function} [options.selection] - 直接给快照函数（契约 §13 的老签名）
 * @param {Function} [options.getSelection] - 同上，`index.js` 用的是这个名字
 * @param {Function|object} [options.quota] - 可选的配额服务
 * @param {object} [options.logger]
 * @param {number} [options.timeoutMs]
 * @returns {{ handleRequest: Function, selection: Function, attachTo: Function,
 *             onRequest: Function, onNotification: Function, dispose: Function, info: Function }}
 */
export function createLlmBridge({
  llm = null,
  attachments = null,
  selection = null,
  getSelection = null,
  quota = null,
  logger = null,
  timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
} = {}) {
  const log = makeLogger(logger);
  const activeRequests=new Map();
  const slots=new Map();
  const runLimits=new Map();
  const runDispatch=new Map();
  const cancelledRuns=new Set();
  const waiters=new Set();
  const notify=()=>{for(const wake of [...waiters])wake();};
  async function acquire(route,params,signal){
    const key=route.provider;
    const configured=runLimits.get(params.runId)?.find(row=>row.provider===route.provider&&row.model===route.model);
    const limit=configured?.workers??1;
    while((slots.get(key)??0)>=limit){
      signal.throwIfAborted();
      await new Promise((resolve,reject)=>{const finish=()=>{waiters.delete(wake);signal.removeEventListener('abort',abort);resolve();},wake=()=>finish(),abort=()=>{waiters.delete(wake);reject(signal.reason);};waiters.add(wake);signal.addEventListener('abort',abort,{once:true});});
    }
    signal.throwIfAborted();slots.set(key,(slots.get(key)??0)+1);
    let lease;
    try{lease=await take(quota)?.acquire?.({...params,provider:route.provider,model:route.model,signal});if(lease?.granted===false)throw new DeepTutorError('E_QUOTA','模型配额尚不可用');}
    catch(error){slots.set(key,slots.get(key)-1);notify();throw error;}
    return async()=>{try{await take(quota)?.release?.({...params,provider:route.provider,model:route.model,lease});}finally{slots.set(key,Math.max(0,(slots.get(key)??1)-1));notify();}};
  }
  const readSelection = typeof getSelection === 'function' ? getSelection
    : typeof selection === 'function' ? selection
      : () => null;

  /** 惰性取服务：构造期拿到 undefined 不代表以后拿不到（加载顺序不定）。 */
  const take = (candidate) => {
    try {
      const value = typeof candidate === 'function' ? candidate() : candidate;
      return value ?? null;
    } catch (error) {
      log.warn('读取宿主服务时出错（按未配置处理）', error?.message ?? error);
      return null;
    }
  };

  let disposed = false;
  const disposers = new Set();

  /** 运行快照：`null` = 未配置（不是错误）。**方法形态**，service.js 就这么读。 */
  function selection_() {
    if (disposed) return null;
    try {
      const snapshot = readSelection();
      return isRecord(snapshot) ? snapshot : null;
    } catch (error) {
      log.warn('读取模型选择快照失败（按未配置处理）', error?.message ?? error);
      return null;
    }
  }

  function requireLlm() {
    const service = take(llm);
    if (!service) {
      throw new DeepTutorError('E_DISABLED', '宿主模型服务（ctx.llm）不可用：模型调用无法进行', {
        service: 'llm',
      });
    }
    if (typeof service.resolveModelInfo !== 'function' || typeof service.prepareCall !== 'function') {
      throw new DeepTutorError('E_DISABLED', '宿主模型服务缺少 resolveModelInfo/prepareCall，无法发起调用', {
        service: 'llm',
        methods: Object.keys(service).filter((key) => typeof service[key] === 'function').slice(0, 20),
      });
    }
    return service;
  }

  /** 组装一次请求的 call config：显式参数优先，其次 selection，最后模型自身的适配默认。 */
  async function resolveRoute(service, params, signal) {
    const workers = runLimits.get(params.runId);
    const snapshot = workers?.find(row=>(!params.model||row.model===params.model)&&(!params.provider||row.provider===params.provider)) ?? workers?.[0] ?? selection_() ?? {};
    const provider = textOf(params.provider || snapshot.provider || '');
    const model = textOf(params.model || snapshot.model || '');
    if (!provider || !model) {
      throw new DeepTutorError(
        'E_CAPABILITY_UNAVAILABLE',
        '没有可用的模型：请在宿主设置里选择 provider 与 model（上游请求未指定，运行快照也为空）',
        { provider: provider || null, model: model || null },
      );
    }
    let info = null;
    try {
      info = await service.resolveModelInfo(provider, model, signal);
    } catch (error) {
      throw new DeepTutorError('E_CAPABILITY_UNAVAILABLE', `宿主不认识模型 ${provider}/${model}`, {
        provider,
        model,
        error: error?.message ?? String(error),
      });
    }
    const config = { provider, model };
    const effort = params.reasoningEffort ?? snapshot.reasoningEffort ?? null;
    if (effort !== null && effort !== undefined && effort !== '') config.reasoningEffort = effort;
    else {
      // 上游没提推理档位时不继承会话的档位：出题这类长输出任务用默认档更稳。
      const disabled = info?.reasoning?.efforts?.find((item) => ['none', 'off', 'disabled'].includes(item?.id));
      if (disabled) config.reasoningEffort = disabled.id;
    }
    const temperature = params.temperature ?? snapshot.temperature ?? null;
    if (Number.isFinite(Number(temperature)) && temperature !== null) config.temperature = Number(temperature);
    const maxTokens = params.maxTokens ?? params.max_tokens ?? snapshot.maxTokens ?? snapshot.max_tokens ?? null;
    if (Number.isFinite(Number(maxTokens)) && maxTokens !== null) config.maxTokens = Number(maxTokens);
    if (Array.isArray(params.stop)) config.stop = params.stop.map(textOf);
    return { config, provider, model };
  }

  /** 把宿主 chunk 流聚合成契约 §3.2 的返回形状。 */
  async function streamOnce(service, route, params, { signal } = {}) {
    const prepared = await service.prepareCall(route.config, signal);
    const messages = params.__messages ?? [];
    const tools = params.__tools;
    const options = {
      ...prepared.config,
      messages,
      signal,
    };
    if (params.__system) options.system = params.__system;
    if (tools) options.tools = tools;

    const blocks = new Map();
    const toolCalls = new Map();
    let usage = { input: 0, output: 0, total: 0 };
    let finish = null;

    for await (const chunk of prepared.stream(options)) {
      if (disposed) throw new DeepTutorError('E_CANCELLED', '模型桥已释放，调用中止');
      if (!isRecord(chunk)) continue;
      switch (chunk.type) {
        case 'text-delta':
          blocks.set(chunk.index, (blocks.get(chunk.index) ?? '') + textOf(chunk.text));
          break;
        case 'reasoning-delta':
          // 推理内容不当正文返回（上游会把整段当答案拼进题目），但也不丢：
          // 记在 reasoning 字段里，Python 侧可以只用于进度展示。
          blocks.set(`r${chunk.index}`, (blocks.get(`r${chunk.index}`) ?? '') + textOf(chunk.text));
          break;
        case 'tool-call-delta': {
          const key = chunk.index ?? chunk.id ?? toolCalls.size;
          const entry = toolCalls.get(key) ?? { id: textOf(chunk.id), name: '', arguments: '' };
          if (chunk.name) entry.name = textOf(chunk.name);
          entry.arguments += textOf(chunk.argumentsDelta);
          toolCalls.set(key, entry);
          break;
        }
        case 'block-end': {
          const block = chunk.block;
          if (isRecord(block) && block.type === 'text') blocks.set(chunk.index, textOf(block.text));
          if (isRecord(block) && block.type === 'tool-call') {
            // block-end 带的是**已拼好**的块：以它为准，覆盖 delta 阶段的半截 JSON。
            const key = chunk.index ?? block.id ?? toolCalls.size;
            toolCalls.set(key, {
              id: textOf(block.id),
              name: textOf(block.name),
              arguments: textOf(block.arguments),
            });
          }
          break;
        }
        case 'usage':
          usage = toBridgeUsage(chunk.usage);
          break;
        case 'finish':
          finish = chunk.reason ?? null;
          break;
        default:
          log.debug('宿主流出现未识别的 chunk（已忽略）', { type: chunk?.type });
      }
    }

    const kind = textOf(finish?.kind);
    if (kind === 'aborted') {
      throw new DeepTutorError('E_CANCELLED', '宿主模型调用被取消', { reason: finish?.kind });
    }
    if (kind === 'error') {
      const failure = isRecord(finish?.failure) ? finish.failure : {};
      throw new DeepTutorError(
        'E_UPSTREAM_ERROR',
        textOf(failure.message) || '宿主模型调用失败',
        { code: failure.code ?? null, kind: kind || null },
      );
    }

    const text = [...blocks.entries()]
      .filter(([key]) => !String(key).startsWith('r'))
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, value]) => value)
      .join('');
    const reasoning = [...blocks.entries()]
      .filter(([key]) => String(key).startsWith('r'))
      .sort((a, b) => Number(String(a[0]).slice(1)) - Number(String(b[0]).slice(1)))
      .map(([, value]) => value)
      .join('');

    return {
      content: text,
      reasoning: reasoning || undefined,
      // 工具调用**不得静默丢弃**（契约 §13）：宿主侧给全量，Python 侧自己决定用不用。
      toolCalls: [...toolCalls.values()].filter((call) => call.name || call.arguments),
      usage,
      finishReason: kind || 'stop',
      model: route.model,
      provider: route.provider,
    };
  }

  /** `llm.stream` / `llm.complete` 的公共实现：准备消息 → 调宿主 → 聚合。 */
  async function callModel(params, { signal } = {}) {
    const dispatch=runDispatch.get(params.runId);
    if(dispatch&&!params.__dispatched)return dispatch(route=>callModel({...params,provider:route.provider,model:route.model,__dispatched:true},{signal}),signal);
    const service = requireLlm();
    const route = await resolveRoute(service, params, signal);
    // 注意命名：别写成 `const attachments = take(attachments)` —— 那会命中暂时性死区，
    // 抛「Cannot access 'attachments' before initialization」，且只在有图片消息时才暴露。
    const attachmentService = take(attachments);
    const images = await resolveInlineImages(params.messages, attachmentService, log);
    const hostMessages = toHostMessages(params.messages, {
      provider: route.provider,
      model: route.model,
      images,
    });
    const { system, messages } = splitSystem(hostMessages);
    if (messages.length === 0) {
      throw new DeepTutorError('E_PROTOCOL', 'llm 请求里没有任何可用消息', { provider: route.provider });
    }
    const release=await acquire(route,params,signal);
    try{return await withWireOptions(params,()=>streamOnce(service, route, {
      ...params,
      __messages: messages,
      __system: system,
      __tools: toToolSchemas(params.tools, log),
    }, { signal }));}finally{await release();}
  }

  /** 配额桥：没有配额服务时按"永不受限"答复，而不是让上游出题卡死。 */
  async function handleQuota(method, params) {
    const service = take(quota);
    if (method === CALLBACKS.quotaAcquire) {
      if (!service || typeof service.acquire !== 'function') return { granted: true, waitMs: 0 };
      const result = await service.acquire(params);
      return { granted: result?.granted !== false, waitMs: Number(result?.waitMs ?? 0) || 0 };
    }
    if (method === CALLBACKS.quotaRelease) {
      if (service && typeof service.release === 'function') await service.release(params);
      return {};
    }
    return undefined;
  }

  /**
   * 桥的反向请求处理器：`(method, params) => Promise<result> | undefined`。
   *
   * 返回 `undefined` 表示「这个方法不归我管」，让桥继续问下一个订阅者；
   * 真正失败时抛 `DeepTutorError`，桥会把它转成 `{error:{code,data:{kind}}}`。
   */
  async function handleRequest(method, params) {
    if (disposed) return undefined;
    const name = textOf(method);
    if (name === CALLBACKS.quotaAcquire || name === CALLBACKS.quotaRelease) {
      return handleQuota(name, isRecord(params) ? params : {});
    }
    if (name !== CALLBACKS.llmStream && name !== CALLBACKS.llmComplete) return undefined;

    const input = isRecord(params) ? params : {};
    const timeout = Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : Number(timeoutMs) || DEFAULT_LLM_TIMEOUT_MS;
    const controller = new AbortController();
    if(cancelledRuns.has(input.runId))throw new DeepTutorError('E_CANCELLED','该运行已取消');
    const requestId=randomUUID();activeRequests.set(requestId,{runId:input.runId,controller});
    const timer = setTimeout(() => controller.abort(new Error(`模型调用超过 ${timeout}ms`)), timeout);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      const result = await callModel(input, { signal: controller.signal });
      // 非流式入口只需要正文：契约里两者返回形状相同，差别只是调用方怎么读。
      log.debug('模型桥完成一次调用', {
        method: name,
        provider: result.provider,
        model: result.model,
        finishReason: result.finishReason,
        toolCalls: result.toolCalls.length,
      });
      return result;
    } catch (error) {
      if(cancelledRuns.has(input.runId)||disposed)throw new DeepTutorError('E_CANCELLED','运行已取消，模型调用已停止');
      if (controller.signal.aborted && !(error instanceof DeepTutorError)) {
        throw new DeepTutorError('E_TIMEOUT', `模型调用超过 ${timeout}ms 未完成`, { method: name });
      }
      throw error instanceof DeepTutorError
        ? error
        : new DeepTutorError('E_UPSTREAM_ERROR', `模型桥调用失败：${error?.message ?? error}`, {
          method: name,
          error: error?.code ?? null,
        });
    } finally {
      clearTimeout(timer);
      activeRequests.delete(requestId);
    }
  }

  /** 把本方订阅挂到 `PythonBridge` 上；返回幂等退订函数。 */
  function attachTo(bridge) {
    if (!bridge || typeof bridge.onRequest !== 'function') {
      throw new DeepTutorError('E_INTERNAL', 'attachTo 需要 PythonBridge 实例（缺少 onRequest）');
    }
    const off = bridge.onRequest((method, params) => handleRequest(method, params));
    const disposeEntry = () => {
      try {
        off?.();
      } catch {
        /* 退订失败无影响 */
      }
    };
    disposers.add(disposeEntry);
    return () => {
      disposers.delete(disposeEntry);
      disposeEntry();
    };
  }

  /**
   * 订阅桥的通知（`llm.delta` 目前只是进度展示）；返回幂等退订函数。
   * 与 `attachTo` 分开是因为通知是可选的：不订阅也不会丢结果。
   */
  function onNotification(bridge, handler) {
    if (!bridge || typeof bridge.onNotification !== 'function' || typeof handler !== 'function') {
      return () => {};
    }
    return bridge.onNotification((method, params) => {
      if (method === NOTIFICATIONS.llmDelta) {
        try {
          handler(params);
        } catch (error) {
          log.warn('处理 llm.delta 通知时出错（已忽略）', error?.message ?? error);
        }
      }
    });
  }

  function info() {
    const snapshot = selection_();
    return {
      configured: Boolean(snapshot?.provider && snapshot?.model),
      provider: snapshot?.provider ?? null,
      model: snapshot?.model ?? null,
      mode: 'host',
      available: Boolean(take(llm)),
      attachments: Boolean(take(attachments)),
      disposed,
    };
  }

  async function dispose() {
    disposed = true;
    for(const {controller} of activeRequests.values())controller.abort(new DeepTutorError('E_CANCELLED','模型桥已关闭'));
    notify();
    for (const disposer of [...disposers]) {
      try {
        disposer();
      } catch {
        /* 忽略 */
      }
    }
    disposers.clear();
    runDispatch.clear();runLimits.clear();cancelledRuns.clear();
  }

  return {
    // 契约 §13 的两种接线形态都给：`selection` 是 service.js 读的快照，`handleRequest` 是
    // bridge.onRequest 期望的 handler。
    selection: selection_,
    handleRequest,
    onRequest: handleRequest,
    attachTo,
    onNotification,
    info,
    registerRun(runId,workers=[],dispatch=null){cancelledRuns.delete(runId);runLimits.set(runId,workers.map(row=>({...row})));if(dispatch)runDispatch.set(runId,dispatch);},
    cancelRun(runId){cancelledRuns.add(runId);for(const request of activeRequests.values())if(request.runId===runId)request.controller.abort(new DeepTutorError('E_CANCELLED','运行已取消'));notify();},
    finishRun(runId){runLimits.delete(runId);runDispatch.delete(runId);},
    dispose,
  };
}

export default { createLlmBridge, toHostMessages };
