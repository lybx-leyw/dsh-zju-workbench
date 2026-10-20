/**
 * 选中文本的即时翻译（本包自有的能力，不走上游）。
 *
 * # 为什么自己实现，而不是用上游的翻译
 *
 * 上游的 `-zh.pdf` / `-dual.pdf` 是**整篇**翻译（babeldoc 异步跑、产出新 PDF 文件），
 * 用户要的是「选中一句、悬停就出中文」。两者的粒度、触发时机、代价都不同：
 * 整篇翻译是分钟级批处理，选中翻译是毫秒级单句，套用整篇那条链路只会
 * 让每次悬停都去排队等一个整篇作业。
 *
 * # 为什么经窄 llm 接口
 *
 * 本仓的铁律：AI 调用一律走 `ctx.zhiyunParser.llm` 的窄接口
 * `{ call({stage, route, constant, variable, signal}), resolve(signal) }`，
 * 不直接碰宿主的 `ctx.llm`（它只有 `prepareCall / stream`，适配已由解析器包做过
 * 一遍，这里再写一份就是「同一件事两份实现，半年内无声漂开」）。
 *
 * # 三件事在这里收敛（都是「悬停翻译」这个形态特有的）
 *
 *   1. **去重**：鼠标在同一个句子上来回移动会触发很多次相同请求。
 *      同 key 的在飞请求共用一个 Promise，而不是各发一次（每次都是钱）。
 *   2. **缓存**：同一段文本第二次悬停应当**零延迟**出结果。用 LRU 而不是无界 Map ——
 *      无界缓存在长时间阅读里就是内存泄漏。
 *   3. **截断**：万一用户拖选了一整页，不能让一次悬停产生一笔巨额调用。
 *      超长一律截断并在返回值里如实标记（不静默丢弃，页面要能提示「仅翻译了前 N 字」）。
 */

import { PaperError } from './errors.js';

/** 送进模型的文本上限（字符）。整页拖选会轻易超过，截断比拒绝更可用。 */
export const SELECTION_MAX_CHARS = 1200;

const INSTRUCTION = [
  '你在做论文精读时的即时翻译，输出会被直接贴在选中文字旁边。',
  '把下面这段英文翻译成简体中文。',
  '要求：',
  '1. 只输出译文本身，不要解释、不要寒暄、不要加引号、不要重复原文。',
  '2. 专业术语用通行中译，首次出现时在括号里保留英文原词。',
  '3. 数学符号、变量名、公式、引用编号（如 [12]）保持原样。',
  '4. 若片段本身被截断（开头或结尾是省略号），只翻译看得见的部分，不要补全。',
  '5. 若输入不是英文（已经是中文、纯数字或纯符号），原样返回。',
].join('\n');

/**
 * 把窄 llm 接口抛出的错误收敛成本包的错误码。
 *
 * 为什么需要这一步：`HarnessLlm` 抛的是 `ParserError`，code 取值是它的语境
 * （`TRUNCATED` / `VISION_MODEL` / `EMPTY_RESPONSE` …）。这些词直接漏到 HTTP 面上，
 * 页面就得同时认识两套错误码。在这里翻译一次，边界之后只有 `PaperError`。
 *
 * 未知 code 一律 `LLM_FAILED`（502）而不是 `INTERNAL`（500）：调用模型失败是
 * **上游服务的问题，不是本插件的缺陷**，这个区别决定了用户该重试还是该报 bug。
 */
function normalizeLlmError(err, signal) {
  if (err instanceof PaperError) return err;
  if (signal?.aborted) return new PaperError('CANCELLED', '翻译请求已取消', { cause: err });

  const code = typeof err?.code === 'string' ? err.code : '';
  const message = err instanceof Error ? err.message : String(err);

  if (code === 'CANCELLED') return new PaperError('CANCELLED', message, { cause: err });
  if (code === 'TIMEOUT') return new PaperError('TIMEOUT', message, { cause: err });
  if (code === 'CONFIG' || code === 'NO_LLM' || code === 'VISION_MODEL') {
    return new PaperError('CONFIG', message, { cause: err });
  }
  if (code === 'EMPTY_RESPONSE') return new PaperError('EMPTY', message, { cause: err });
  return new PaperError('LLM_FAILED', message, { cause: err });
}

/** 缓存键要含模型：换了模型，同一句话的译文就变了，不能拿旧条目冒充新结果。 */
function cacheKey(model, text) {
  return `${model ?? ''}\u0000${text}`;
}

/**
 * @param options.llm - 窄 llm 接口（`ctx.zhiyunParser.llm`）。缺 `call` 即抛 CONFIG。
 * @param options.cacheLimit - 缓存条数上限，默认 300。
 * @param options.maxChars - 单次送模型的最大字符数，默认 `SELECTION_MAX_CHARS`。
 */
export function createSelectionTranslator({ llm, cacheLimit = 300, maxChars = SELECTION_MAX_CHARS } = {}) {
  if (!llm || typeof llm.call !== 'function') {
    throw new PaperError('CONFIG', '选中翻译需要窄 llm 接口（{ call({stage,route,constant,variable,signal}) }）；'
      + '宿主侧由 zhiyunParser 提供，也可用 config.llm 直接给出');
  }

  // 路由**延迟解析**：模型没配好时插件仍要能激活（阅读器、文献库都不需要模型），
  // 只有真的悬停翻译时才报错。这与 dsh-zhiyun-core-lecture 的取舍一致。
  let route;
  let resolving = null;
  const resolveRoute = async (signal) => {
    if (route !== undefined) return route;
    if (typeof llm.resolve !== 'function') return undefined;
    resolving ??= llm.resolve(signal)
      .then((routes) => { route = routes?.text ?? routes?.vision; return route; })
      .finally(() => { resolving = null; });
    return resolving;
  };

  const cache = new Map();   // key -> 译文；Map 的插入序天然给出 LRU
  const inflight = new Map(); // key -> Promise

  const remember = (key, translation) => {
    cache.delete(key);
    cache.set(key, translation);
    while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
  };

  const stats = { hits: 0, misses: 0, joined: 0, truncated: 0 };

  /**
   * 翻译一段选中文本。
   *
   * @returns `{ translation, model, cached, truncated }`。
   *   `cached` 区分「命中缓存」与「这次真花了钱」，`truncated` 如实标记截断。
   */
  async function translate(rawText, { signal } = {}) {
    const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
    if (trimmed.length === 0) throw new PaperError('INPUT', '没有选中任何文字');

    const truncated = trimmed.length > maxChars;
    const text = truncated ? trimmed.slice(0, maxChars) : trimmed;
    if (truncated) stats.truncated += 1;

    const resolved = await resolveRoute(signal);
    const model = resolved?.model ?? null;
    const key = cacheKey(model, text);

    const hit = cache.get(key);
    if (hit !== undefined) {
      stats.hits += 1;
      remember(key, hit); // 刷新 LRU 位置
      return { translation: hit, model, cached: true, truncated };
    }

    const pending = inflight.get(key);
    if (pending !== undefined) {
      stats.joined += 1;
      const translation = await pending;
      return { translation, model, cached: true, truncated };
    }

    stats.misses += 1;
    const task = (async () => {
      let response;
      try {
        response = await llm.call({
          stage: 'translate',
          route: resolved,
          constant: INSTRUCTION,
          variable: text,
          signal,
        });
      } catch (err) {
        throw normalizeLlmError(err, signal);
      }
      const translation = typeof response?.text === 'string' ? response.text.trim() : '';
      if (translation.length === 0) throw new PaperError('EMPTY', '模型返回了空译文');
      remember(key, translation);
      return translation;
    })();
    inflight.set(key, task);
    try {
      return { translation: await task, model, cached: false, truncated };
    } finally {
      // 失败的请求不进缓存，但必须从在飞表里摘掉，否则后续悬停会永远复用那个
      // 已 reject 的 Promise —— 表现为「这句子再也翻不出来了」。
      inflight.delete(key);
    }
  }

  return {
    translate,
    get size() { return cache.size; },
    get stats() { return { ...stats, size: cache.size, inflight: inflight.size }; },
    clear() { cache.clear(); },
  };
}
