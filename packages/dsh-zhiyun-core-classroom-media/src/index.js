// 源：无（宿主接缝）。上游没有"插件"这一层：`lib/audio|media|web-search|web-fetch|pdf`
// 由 `app/api/generate/tts|asr|…` 的 route 直接调用。这里的服务方法就是那些 route body
// 去掉 NextRequest/NextResponse 之后的形状（规范 §2 通道 2）。
/**
 * 智云 Pro「互动课堂」的**语音 / 媒体 / 检索**半边（L2 领域包）。
 *
 * 把 OpenMAIC 的 `lib/audio` `lib/media` `lib/media-parse` `lib/web-search`
 * `lib/web-fetch` `lib/pdf` 搬成一个 Cordis 插件，挂在 `ctx.zhiyunClassroomMedia`。
 *
 * ```
 * ctx.zhiyunClassroomMedia.tts(text, voice?)      // → { ok, bytes, format, durationSeconds }
 * ctx.zhiyunClassroomMedia.asr(file, opts?)       // → { ok, text }
 * ctx.zhiyunClassroomMedia.image(prompt, opts?)   // → { ok, url|base64, width, height }
 * ctx.zhiyunClassroomMedia.search(query, opts?)   // → { ok, answer, sources, query, responseTime }
 * ctx.zhiyunClassroomMedia.fetchPage(url, opts?)  // → { ok, title, markdown, finalUrl, truncated }
 * ctx.zhiyunClassroomMedia.parsePdf(buffer, opts?)// → { ok, text, images, metadata }
 * ctx.zhiyunClassroomMedia.timeline(clips, opts?) // → { ok, totalMs, segments, track }
 * ctx.zhiyunClassroomMedia.providers(capability)  // → 各 provider 的配置状态
 * ctx.zhiyunClassroomMedia.status()
 * ```
 *
 * # 三条硬约定
 *
 * 1. **`apply()` 永不因上游缺失而抛错**（照 `host-classroom` / `host-deeptutor`）：
 *    没注入 `zhiyunClassroomStudio` 时服务照样 provide，每个方法各自说明"为什么不可用"。
 * 2. **方法返回结果、不 throw**。课堂链路跑在渲染树里，一个 provider 没配不该炸页面
 *    （理由与 taxonomy 见 `errors.js` 头注）。内部工具函数仍用 throw，边界处统一转结果。
 * 3. **密钥与 baseURL 只从 `ctx.zhiyunClassroomStudio.providers` 拿**，其次 `config.providers`
 *    注入；`process.env` 只是桌面端的最后兜底，见 `providers.js` 的解析顺序。
 */

import { MediaError, fail, internal, invalidInput, notConfigured, ok } from './errors.js';
import { createProviderRegistry, WEB_FETCH_PRIORITY, WEB_SEARCH_PRIORITY, PDF_PROVIDERS } from './providers.js';
import { generateTTS } from './audio/tts.js';
import { transcribeAudio } from './audio/asr.js';
import { generateImage } from './media/image.js';
import { searchWeb } from './web/search.js';
import { fetchPage as fetchPageRaw } from './web/fetch.js';
import { parsePDF } from './pdf/parse.js';
import { buildTimeline, concatWav, renderNarrationTrack } from './audio/timeline.js';
import { measureAudioDuration } from './audio/duration.js';

export const name = 'zhiyun-classroom-media';

/**
 * 只硬依赖宿主半边。
 *
 * 注意：写进 `inject` 意味着本插件在 `host-classroom` 未装载时**不会激活** ——
 * 这是有意的：本包每个能力都要问 `providers`，宿主缺席时它没有可做的事。
 * 但 `apply()` 仍然不抛（见文件头第 1 条）：真到了这个状态，
 * `ctx.get('zhiyunClassroomMedia')` 的调用方拿到的是"每个方法都说未配置"的服务。
 */
export const inject = ['zhiyunClassroomStudio'];

export const PACKAGE_VERSION = '0.1.0';

/** 默认 provider 的挑选顺序（上游 `buildWebSearchFallbackOrder` 的固定化）。 */
const TTS_PRIORITY = [
  'openai-tts',
  'doubao-tts',
  'minimax-tts',
  'qwen-tts',
  'glm-tts',
  'elevenlabs-tts',
  'google-tts',
  'azure-tts',
  'voxcpm-tts',
  'lemonade-tts',
];
const ASR_PRIORITY = ['openai-whisper', 'qwen-asr', 'azure-asr', 'funasr-asr', 'lemonade-asr'];
const IMAGE_PRIORITY = [
  'seedream',
  'openai-image',
  'qwen-image',
  'nano-banana',
  'glm-image',
  'minimax-image',
  'grok-image',
  'openrouter-image',
  'comfyui-image',
  'lemonade',
];
const PDF_PRIORITY = ['unpdf', 'mineru', 'mineru-cloud', 'alidocmind'];

/**
 * 把 `tts(text, voice)` 的第二参归一。
 *
 * `voice` 允许是字符串（音色 id）、对象（含 provider/选项），或省略。
 * 字符串形态故意保留：规范里的签名就是 `tts(text, voice)`，别逼调用方改。
 */
function normalizeVoiceArg(voice) {
  if (voice === undefined || voice === null) return {};
  if (typeof voice === 'string') return { voice };
  if (typeof voice === 'object') return voice;
  throw invalidInput('voice 必须是字符串或对象', 'voice');
}

/**
 * @param {object} ctx Cordis 上下文
 * @param {object} [config]
 * @param {object} [config.providers] 直接注入的 provider 配置（优先级最高，测试/集成层用）
 * @param {Function} [config.fetch] 替换 fetch（测试注入假 fetch）
 * @param {object} [config.logger]
 * @returns {() => void} disposer
 */
export function apply(ctx, config = {}) {
  const log = config.logger ?? {
    debug: (...args) => ctx?.logger?.debug?.('[zhiyun-classroom-media]', ...args),
    info: (...args) => ctx?.logger?.info?.('[zhiyun-classroom-media]', ...args),
    warn: (...args) => ctx?.logger?.warn?.('[zhiyun-classroom-media]', ...args),
    error: (...args) => ctx?.logger?.error?.('[zhiyun-classroom-media]', ...args),
  };

  // 宿主服务的取用**推迟到方法调用时**：apply 阶段 `ctx.zhiyunClassroomStudio` 可能还没
  // provide（Cordis 的加载顺序不保证），此刻取一次就永久绑死一个 undefined。
  const getStudio = () => {
    try {
      return ctx?.zhiyunClassroomStudio ?? ctx?.get?.('zhiyunClassroomStudio') ?? null;
    } catch {
      return null;
    }
  };

  let registry = null;
  const getRegistry = () => {
    if (!registry) {
      registry = createProviderRegistry({ studio: getStudio(), config, log });
    }
    return registry;
  };

  /** 注入的 fetch 优先（测试用它断言 URL）；否则用全局 fetch，**调用时**才查。 */
  const fetchImpl = (input, init) => {
    const injected = config.fetch;
    if (typeof injected === 'function') return injected(input, init);
    return fetch(input, init);
  };

  /**
   * 解析一个能力要用的 provider。
   *
   * @param {'tts'|'asr'|'image'|'search'|'fetch'|'pdf'} capability
   * @param {string|undefined} explicitId
   * @param {readonly string[]} priority
   */
  async function pickProvider(capability, explicitId, priority) {
    const reg = getRegistry();
    const studio = getStudio();
    if (!studio && !config.providers) {
      throw notConfigured(
        capability,
        explicitId,
        '宿主服务 zhiyunClassroomStudio 未装载，且没有注入 config.providers',
      );
    }

    if (explicitId) {
      const resolved = await reg.resolve(capability, explicitId);
      if (!resolved) {
        throw new MediaError('E_UNSUPPORTED_PROVIDER', `${capability} 没有名为「${explicitId}」的 provider`, {
          capability,
          provider: explicitId,
        });
      }
      if (!(await reg.isUsable(capability, explicitId))) {
        throw notConfigured(capability, explicitId);
      }
      return resolved;
    }

    // 先挑"用户真的配了"的；一个都没有时才退到 alwaysAvailable 的本地兜底
    // （builtin reader / unpdf），这样配了 MinerU Cloud 不会被本地 unpdf 抢走。
    const fallbackId =
      (await reg.firstUsable(capability, priority, { configuredOnly: true }))
      ?? (await reg.firstUsable(capability, priority));
    if (!fallbackId) {
      throw notConfigured(capability, undefined, `没有任何 ${capability} provider 被配置`);
    }
    return reg.resolve(capability, fallbackId);
  }

  /**
   * `parsePdf` 的内部实现。
   *
   * 抽成局部函数而不是 `this.parsePdf`：服务方法被解构调用时（`const { fetchPage } = media`）
   * `this` 就没了，而"抓 PDF 页"这条路径必然会走到它。
   */
  const runParsePdf = async (buffer, options = {}) => {
    const provider = await pickProvider('pdf', options.providerId, PDF_PRIORITY);
    const result = await parsePDF(
      { fetch: fetchImpl },
      {
        providerId: provider.id,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        accessKeyId: provider.accessKeyId,
        accessKeySecret: provider.accessKeySecret,
        textOnly: options.textOnly,
        signal: options.signal,
      },
      buffer,
      { fileName: options.fileName, mimeType: options.mimeType },
    );
    return ok({ provider: provider.id, ...result });
  };

  const service = {
    // ── 语音合成 ────────────────────────────────────────────────────────────
    /**
     * @param {string} text
     * @param {string|object} [voice] 音色 id，或 `{ providerId, voice, speed, format, ... }`
     */
    async tts(text, voice) {
      try {
        if (typeof text !== 'string' || !text.trim()) throw invalidInput('tts(text) 需要非空文本', 'text');
        const opts = normalizeVoiceArg(voice);
        const provider = await pickProvider('tts', opts.providerId, TTS_PRIORITY);
        const signal = opts.signal;

        const result = await generateTTS(
          { fetch: fetchImpl },
          {
            providerId: provider.id,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            model: opts.model ?? provider.model,
            voice: opts.voice ?? provider.voice ?? provider.meta.defaultVoice,
            speed: opts.speed,
            format: opts.format,
            providerOptions: opts.providerOptions,
            signal,
          },
          text,
        );

        return ok({
          provider: provider.id,
          voice: opts.voice ?? provider.voice ?? null,
          format: result.format,
          // 二进制一律 Buffer（规范：不用 Node stream）。
          bytes: result.audio,
          durationSeconds: measureAudioDuration(result.audio, result.format),
          fromEnv: provider.fromEnv === true,
        });
      } catch (error) {
        return fail(error);
      }
    },

    // ── 语音识别 ────────────────────────────────────────────────────────────
    /** @param {Buffer|Uint8Array} file @param {{providerId?:string, language?:string, model?:string}} [options] */
    async asr(file, options = {}) {
      try {
        if (!file) throw invalidInput('asr(file) 需要音频 Buffer', 'file');
        const provider = await pickProvider('asr', options.providerId, ASR_PRIORITY);
        const result = await transcribeAudio(
          { fetch: fetchImpl },
          {
            providerId: provider.id,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            model: options.model ?? provider.model,
            language: options.language,
            signal: options.signal,
          },
          file,
        );
        return ok({ provider: provider.id, text: result.text });
      } catch (error) {
        return fail(error);
      }
    },

    // ── 图片生成 ────────────────────────────────────────────────────────────
    /** @param {string} prompt @param {{providerId?:string, width?:number, height?:number, aspectRatio?:string}} [options] */
    async image(prompt, options = {}) {
      try {
        if (typeof prompt !== 'string' || !prompt.trim()) throw invalidInput('image(prompt) 需要非空提示词', 'prompt');
        const provider = await pickProvider('image', options.providerId, IMAGE_PRIORITY);
        const result = await generateImage(
          { fetch: fetchImpl },
          {
            providerId: provider.id,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            model: options.model ?? provider.model,
            providerOptions: options.providerOptions,
          },
          {
            prompt,
            width: options.width,
            height: options.height,
            aspectRatio: options.aspectRatio,
            negativePrompt: options.negativePrompt,
            signal: options.signal,
          },
        );
        return ok({ provider: provider.id, ...result });
      } catch (error) {
        return fail(error);
      }
    },

    // ── 联网检索 ────────────────────────────────────────────────────────────
    /** @param {string} query @param {{providerId?:string, maxResults?:number, subSources?:object}} [options] */
    async search(query, options = {}) {
      try {
        const provider = await pickProvider('search', options.providerId, WEB_SEARCH_PRIORITY);
        const result = await searchWeb(
          { fetch: fetchImpl },
          {
            providerId: provider.id,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            model: options.model ?? provider.model,
            maxResults: options.maxResults,
            subSources: options.subSources,
            signal: options.signal,
          },
          query,
        );
        return ok({ provider: provider.id, ...result });
      } catch (error) {
        return fail(error);
      }
    },

    // ── 网页抓取 ────────────────────────────────────────────────────────────
    /** @param {string} url @param {{providerId?:string, maxBytes?:number, minChars?:number}} [options] */
    async fetchPage(url, options = {}) {
      try {
        if (typeof url !== 'string' || !url.trim()) throw invalidInput('fetchPage(url) 需要 URL', 'url');
        const provider = await pickProvider('fetch', options.providerId, WEB_FETCH_PRIORITY);
        const result = await fetchPageRaw(
          { fetch: fetchImpl },
          { providerId: provider.id, apiKey: provider.apiKey, baseUrl: provider.baseUrl },
          url,
          {
            maxBytes: options.maxBytes,
            minChars: options.minChars,
            blockedMarkers: options.blockedMarkers,
            bodyTimeoutMs: options.bodyTimeoutMs,
            signal: options.signal,
            // PDF 页直接复用本包的解析入口（上游也是把 PDF 委派给 document service）。
            extractPdf: async (bytes) => {
              const pdf = await runParsePdf(bytes, { ...options, signal: options.signal });
              if (!pdf.ok) throw new MediaError(pdf.code, pdf.message, pdf.detail);
              return { title: pdf.metadata?.fileName ?? '', text: pdf.text, truncated: false };
            },
          },
        );
        return ok({ provider: provider.id, ...result });
      } catch (error) {
        return fail(error);
      }
    },

    // ── PDF 解析 ────────────────────────────────────────────────────────────
    /** @param {Buffer} buffer @param {{providerId?:string, fileName?:string, textOnly?:boolean}} [options] */
    async parsePdf(buffer, options = {}) {
      try {
        return await runParsePdf(buffer, options);
      } catch (error) {
        return fail(error);
      }
    },

    // ── 音频拼接与时间轴 ────────────────────────────────────────────────────
    /** 纯函数，不碰网络：给导出链路用。 */
    timeline(clips, options = {}) {
      try {
        return ok(renderNarrationTrack(clips, options));
      } catch (error) {
        return fail(error);
      }
    },

    concatAudio(clips) {
      try {
        return ok(concatWav(clips));
      } catch (error) {
        return fail(error);
      }
    },

    measure(bytes, format) {
      try {
        return ok({ durationSeconds: measureAudioDuration(bytes, format) });
      } catch (error) {
        return fail(error);
      }
    },

    /** 时间轴排布（不含拼接），单独给需要"只要表"的调用方。 */
    segment(clips, options = {}) {
      try {
        return ok(buildTimeline(clips, options));
      } catch (error) {
        return fail(error);
      }
    },

    // ── 自检 ────────────────────────────────────────────────────────────────
    /**
     * provider 清单。`capability` 省略时返回全部六段。
     *
     * 返回的是**本包眼里的可用性**（key/baseUrl 齐不齐），不是上游 `/api/server-providers`
     * 的信封 —— 那个在宿主包里，别在这里复制一份。
     */
    async providers(capability) {
      try {
        const reg = getRegistry();
        if (capability) return ok({ capability, providers: await reg.list(capability) });
        const [tts, asr, image, search, fetchList, pdf] = await Promise.all([
          reg.list('tts'),
          reg.list('asr'),
          reg.list('image'),
          reg.list('search'),
          reg.list('fetch'),
          reg.list('pdf'),
        ]);
        return ok({ tts, asr, image, search, fetch: fetchList, pdf });
      } catch (error) {
        return fail(error);
      }
    },

    /** 服务自检。**永不抛**（页面第一次调的就是它）。 */
    async status() {
      const detail = { version: PACKAGE_VERSION, capabilities: [] };
      try {
        const studio = getStudio();
        detail.studio = studio ? 'ready' : 'missing';
        const reg = getRegistry();
        for (const capability of ['tts', 'asr', 'image', 'search', 'fetch', 'pdf']) {
          // eslint-disable-next-line no-await-in-loop
          const list = await reg.list(capability);
          detail.capabilities.push({
            capability,
            configured: list.filter((entry) => entry.configured).map((entry) => entry.id),
            total: list.length,
          });
        }
        const anyConfigured = detail.capabilities.some((entry) => entry.configured.length > 0);
        // "没有宿主也没有注入"才是 degraded；只靠 `config.providers` 跑起来是正常形态（测试/集成层）。
        const wired = Boolean(studio) || Boolean(config.providers);
        return {
          state: !wired ? 'degraded' : anyConfigured ? 'ready' : 'partial',
          version: PACKAGE_VERSION,
          detail,
        };
      } catch (error) {
        return {
          state: 'degraded',
          version: PACKAGE_VERSION,
          detail: { ...detail, error: error instanceof Error ? error.message : String(error) },
        };
      }
    },

    /** 供集成层直接取内部实现（例如导出链路要自己编排 fetch 序列）。 */
    internals: { PDF_PROVIDERS, WEB_FETCH_PRIORITY, WEB_SEARCH_PRIORITY },
  };

  // apply() 里唯一可能抛的地方：provide。抛了就降级 —— 工作台还活着，媒体能力这次不可用。
  let removeService = () => {};
  try {
    removeService = ctx.provide('zhiyunClassroomMedia', service) ?? (() => {});
  } catch (error) {
    log.error('zhiyunClassroomMedia 注册失败（服务名可能已被占用），媒体能力本次不可用', error?.message ?? error);
  }

  try {
    ctx.on?.('dispose', () => {
      try {
        removeService();
      } catch (error) {
        log.warn('卸载时注销 zhiyunClassroomMedia 失败', error?.message ?? error);
      }
    });
  } catch (error) {
    log.warn('注册 dispose 钩子失败（已忽略）', error?.message ?? error);
  }

  try {
    log.info(`课堂媒体层就绪：studio=${getStudio() ? 'ready' : 'missing'}，version=${PACKAGE_VERSION}`);
  } catch {
    // 日志打不出来不该影响装载（测试桩的 logger 可能只有一部分方法）。
  }

  return () => {
    try {
      removeService();
    } catch (error) {
      log.warn('卸载课堂媒体层时出错', error?.message ?? error);
    }
  };
}

export { MediaError, ERROR_CODES } from './errors.js';
export { createProviderRegistry, PROVIDER_TABLES } from './providers.js';
export { internal };
