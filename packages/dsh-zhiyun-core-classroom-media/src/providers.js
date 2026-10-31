// 源：ref/OpenMAIC/lib/audio/constants.ts、lib/media/image-providers.ts:39-176、
//     lib/web-search/constants.ts:1-160、lib/web-fetch/registry.ts:1-31、lib/pdf/constants.ts:1-63
/**
 * 源：ref/OpenMAIC/lib/audio/constants.ts（TTS_PROVIDERS / ASR_PROVIDERS 的元数据）、
 *     ref/OpenMAIC/lib/media/image-providers.ts:39-176（IMAGE_PROVIDERS）、
 *     ref/OpenMAIC/lib/web-search/constants.ts:1-160（WEB_SEARCH_PROVIDERS）、
 *     ref/OpenMAIC/lib/web-fetch/registry.ts:1-31（WEB_FETCH_PROVIDERS）、
 *     ref/OpenMAIC/lib/pdf/constants.ts:1-63（PDF_PROVIDERS）
 *
 * 上游把这些元数据写死在 `lib/<能力>/constants.ts`，密钥则从 `lib/server/provider-config.ts`
 * 的 `resolve*ApiKey/BaseUrl` 读（YAML + 环境变量）。
 *
 * # 本仓的改法
 *
 * 上游的"密钥从哪来"整层换成宿主服务：**一律问 `ctx.zhiyunClassroomStudio.providers`**
 * （规范 §4 的 `providers.list()` / `providers.set()`）。本包不持久化、不读 YAML。
 *
 * 读 env 只作为**最后兜底**：桌面端还没有设置页时，用户把 key 放在环境变量里仍能跑通。
 * 每个 env 名字都写了注释说明它对应上游哪一个 `resolve*ApiKey`。
 */

/** TTS provider 元数据。source:lib/audio/constants.ts（TTS_PROVIDERS） */
export const TTS_PROVIDERS = Object.freeze({
  'openai-tts': {
    name: 'OpenAI TTS',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelId: 'gpt-4o-mini-tts',
    defaultVoice: 'alloy',
    formats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'],
    envKey: 'OPENAI_API_KEY',
  },
  'azure-tts': {
    name: 'Azure TTS',
    requiresApiKey: true,
    defaultBaseUrl: 'https://{region}.tts.speech.microsoft.com',
    defaultModelId: '',
    defaultVoice: 'zh-CN-XiaoxiaoNeural',
    formats: ['mp3', 'wav'],
    envKey: 'AZURE_SPEECH_KEY',
  },
  'glm-tts': {
    name: 'GLM TTS',
    requiresApiKey: true,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModelId: 'glm-tts',
    defaultVoice: 'tongtong',
    formats: ['wav'],
    envKey: 'GLM_API_KEY',
  },
  'qwen-tts': {
    name: 'Qwen TTS',
    requiresApiKey: true,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    defaultModelId: 'qwen3-tts-flash',
    defaultVoice: 'Cherry',
    formats: ['wav'],
    envKey: 'DASHSCOPE_API_KEY',
  },
  'voxcpm-tts': {
    name: 'VoxCPM2',
    requiresApiKey: false,
    defaultBaseUrl: '',
    defaultModelId: 'VoxCPM2',
    defaultVoice: 'default',
    formats: ['wav'],
    envKey: 'VOXCPM_API_KEY',
  },
  'doubao-tts': {
    name: 'Doubao TTS',
    requiresApiKey: true,
    defaultBaseUrl: 'https://openspeech.bytedance.com/api/v3/tts',
    defaultModelId: 'seed-tts-2.0',
    defaultVoice: 'zh_female_shuangkuaisisi_moon_bigtts',
    formats: ['mp3'],
    envKey: 'DOUBAO_TTS_API_KEY',
  },
  'elevenlabs-tts': {
    name: 'ElevenLabs',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.elevenlabs.io/v1',
    defaultModelId: 'eleven_multilingual_v2',
    defaultVoice: '21m00Tcm4TlvDq8ikWAM',
    formats: ['mp3', 'opus', 'pcm', 'wav'],
    envKey: 'ELEVENLABS_API_KEY',
  },
  'minimax-tts': {
    name: 'MiniMax TTS',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.minimaxi.com',
    defaultModelId: 'speech-2.8-hd',
    defaultVoice: 'male-qn-qingse',
    formats: ['mp3', 'wav', 'flac'],
    envKey: 'MINIMAX_API_KEY',
  },
  'google-tts': {
    name: 'Google Gemini TTS',
    requiresApiKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModelId: 'gemini-3-pro-tts',
    defaultVoice: 'Kore',
    formats: ['wav'],
    envKey: 'GEMINI_API_KEY',
  },
  'lemonade-tts': {
    name: 'Lemonade TTS',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:13305/v1',
    defaultModelId: 'kokoro-v1',
    defaultVoice: 'af_heart',
    formats: ['wav'],
    envKey: 'LEMONADE_API_KEY',
  },
  'browser-native-tts': {
    name: 'Browser Native',
    requiresApiKey: false,
    defaultBaseUrl: '',
    defaultModelId: '',
    defaultVoice: '',
    formats: [],
    clientOnly: true,
    envKey: null,
  },
});

/** ASR provider 元数据。source:lib/audio/constants.ts（ASR_PROVIDERS） */
export const ASR_PROVIDERS = Object.freeze({
  'openai-whisper': {
    name: 'OpenAI Whisper',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelId: 'whisper-1',
    envKey: 'OPENAI_API_KEY',
  },
  'browser-native': {
    name: 'Browser Native',
    requiresApiKey: false,
    defaultBaseUrl: '',
    defaultModelId: '',
    clientOnly: true,
    envKey: null,
  },
  'qwen-asr': {
    name: 'Qwen ASR',
    requiresApiKey: true,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    defaultModelId: 'qwen3-asr-flash',
    envKey: 'DASHSCOPE_API_KEY',
  },
  'funasr-asr': {
    name: 'FunASR',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:8000/v1',
    defaultModelId: 'sensevoice',
    envKey: 'FUNASR_API_KEY',
  },
  'lemonade-asr': {
    name: 'Lemonade ASR',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:13305/v1',
    defaultModelId: 'whisper-1',
    envKey: 'LEMONADE_API_KEY',
  },
  'azure-asr': {
    name: 'Azure STT',
    requiresApiKey: true,
    defaultBaseUrl: 'https://{region}.api.cognitive.microsoft.com',
    defaultModelId: '',
    envKey: 'AZURE_SPEECH_KEY',
  },
});

/** 图片生成 provider 元数据。source:lib/media/image-providers.ts:39-176 */
export const IMAGE_PROVIDERS = Object.freeze({
  seedream: {
    name: 'Seedream',
    requiresApiKey: true,
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com',
    defaultModelId: 'doubao-seedream-5-0-260128',
    envKey: 'ARK_API_KEY',
  },
  'openai-image': {
    name: 'OpenAI Image',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModelId: 'gpt-image-2',
    envKey: 'OPENAI_API_KEY',
  },
  'qwen-image': {
    name: 'Qwen Image',
    requiresApiKey: true,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    defaultModelId: 'qwen-image-3.0',
    envKey: 'DASHSCOPE_API_KEY',
  },
  'nano-banana': {
    name: 'Nano Banana (Gemini)',
    requiresApiKey: true,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModelId: 'gemini-2.5-flash-image',
    envKey: 'GEMINI_API_KEY',
  },
  'minimax-image': {
    name: 'MiniMax Image',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.minimaxi.com',
    defaultModelId: 'image-01',
    envKey: 'MINIMAX_API_KEY',
  },
  'grok-image': {
    name: 'Grok Image (xAI)',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModelId: 'grok-imagine-image',
    envKey: 'XAI_API_KEY',
  },
  'glm-image': {
    name: 'GLM Image (Zhipu)',
    requiresApiKey: true,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModelId: 'cogview-3-flash',
    envKey: 'GLM_API_KEY',
  },
  'comfyui-image': {
    name: 'ComfyUI',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:8188',
    defaultModelId: '',
    envKey: 'COMFYUI_API_KEY',
  },
  lemonade: {
    name: 'Lemonade',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:13305/v1',
    defaultModelId: 'Qwen-Image-GGUF',
    envKey: 'LEMONADE_API_KEY',
  },
  'openrouter-image': {
    name: 'OpenRouter Image',
    requiresApiKey: true,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModelId: 'google/gemini-3-pro-image',
    envKey: 'OPENROUTER_API_KEY',
  },
});

/** 联网检索 provider 元数据。source:lib/web-search/constants.ts:16-145 */
export const WEB_SEARCH_PROVIDERS = Object.freeze({
  tavily: { name: 'Tavily', requiresApiKey: true, defaultBaseUrl: 'https://api.tavily.com', envKey: 'TAVILY_API_KEY' },
  exa: { name: 'Exa', requiresApiKey: true, defaultBaseUrl: 'https://api.exa.ai', envKey: 'EXA_API_KEY' },
  firecrawl: {
    name: 'Firecrawl',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.firecrawl.dev',
    envKey: 'FIRECRAWL_API_KEY',
  },
  bocha: { name: 'Bocha', requiresApiKey: true, defaultBaseUrl: 'https://api.bocha.cn', envKey: 'BOCHA_API_KEY' },
  brave: { name: 'Brave Search', requiresApiKey: false, defaultBaseUrl: 'https://search.brave.com', envKey: 'BRAVE_API_KEY' },
  baidu: {
    name: 'Baidu',
    requiresApiKey: true,
    defaultBaseUrl: 'https://qianfan.baidubce.com',
    envKey: 'BAIDU_QIANFAN_API_KEY',
  },
  claude: { name: 'Claude', requiresApiKey: true, defaultBaseUrl: 'https://api.anthropic.com/v1', envKey: 'ANTHROPIC_API_KEY' },
  kimi: { name: 'Kimi', requiresApiKey: true, defaultBaseUrl: 'https://api.moonshot.cn/v1', envKey: 'MOONSHOT_API_KEY' },
  minimax: { name: 'MiniMax', requiresApiKey: true, defaultBaseUrl: 'https://api.minimaxi.com', envKey: 'MINIMAX_API_KEY' },
  doubao: {
    name: 'Doubao',
    requiresApiKey: true,
    defaultBaseUrl: 'https://open.feedcoopapi.com',
    envKey: 'DOUBAO_SEARCH_API_KEY',
  },
  searxng: {
    name: 'SearXNG',
    requiresApiKey: false,
    requiresBaseUrl: true,
    defaultBaseUrl: '',
    envKey: null,
  },
  deepseek: { name: 'DeepSeek', requiresApiKey: true, defaultBaseUrl: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY' },
});

/** 检索顺序：上游 `buildWebSearchFallbackOrder` 的"谁配了用谁"，在这里退化为固定优先级。 */
export const WEB_SEARCH_PRIORITY = Object.freeze([
  'tavily',
  'bocha',
  'doubao',
  'kimi',
  'deepseek',
  'minimax',
  'exa',
  'firecrawl',
  'brave',
  'baidu',
  'searxng',
  'claude',
]);

/** 网页抓取 provider 元数据。source:lib/web-fetch/registry.ts:8-16 */
export const WEB_FETCH_PROVIDERS = Object.freeze({
  builtin: {
    name: 'Built-in reader',
    requiresApiKey: false,
    defaultBaseUrl: '',
    envKey: null,
    // 内置读取器不需要任何凭证，也不打第三方：永远可用。
    alwaysAvailable: true,
  },
  kimi: { name: 'Kimi', requiresApiKey: true, defaultBaseUrl: 'https://api.moonshot.cn/v1', envKey: 'MOONSHOT_API_KEY' },
  deepseek: { name: 'DeepSeek', requiresApiKey: true, defaultBaseUrl: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY' },
  firecrawl: {
    name: 'Firecrawl',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.firecrawl.dev',
    envKey: 'FIRECRAWL_API_KEY',
  },
});

export const WEB_FETCH_PRIORITY = Object.freeze(['kimi', 'deepseek', 'firecrawl', 'builtin']);

/** PDF 解析 provider 元数据。source:lib/pdf/constants.ts:14-47 */
export const PDF_PROVIDERS = Object.freeze({
  unpdf: {
    name: 'unpdf',
    requiresApiKey: false,
    defaultBaseUrl: '',
    envKey: null,
    // 本地解析器：可用性取决于依赖是否安装，由调用时动态 import 判定。
    alwaysAvailable: true,
  },
  mineru: { name: 'MinerU', requiresApiKey: false, defaultBaseUrl: 'http://localhost:8080', envKey: 'MINERU_API_KEY' },
  'mineru-cloud': {
    name: 'MinerU (Cloud)',
    requiresApiKey: true,
    defaultBaseUrl: 'https://mineru.net/api/v4',
    envKey: 'MINERU_CLOUD_API_KEY',
  },
  alidocmind: {
    name: 'AliDocMind',
    requiresApiKey: true,
    defaultBaseUrl: 'https://docmind-api.cn-hangzhou.aliyuncs.com',
    envKey: 'ALIDOCMIND_ACCESS_KEY_ID',
    requiresCredentials: true,
  },
});

/** capability → 元数据表。服务层的 `providers()` 与解析器共用这一份。 */
export const PROVIDER_TABLES = Object.freeze({
  tts: TTS_PROVIDERS,
  asr: ASR_PROVIDERS,
  image: IMAGE_PROVIDERS,
  search: WEB_SEARCH_PROVIDERS,
  fetch: WEB_FETCH_PROVIDERS,
  pdf: PDF_PROVIDERS,
});

/** 从宿主 `providers.list()` 的 body 里，各能力段叫什么。 */
const STUDIO_SECTION = Object.freeze({
  tts: 'tts',
  asr: 'asr',
  image: 'image',
  search: 'webSearch',
  fetch: 'webSearch',
  pdf: 'pdf',
});

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * 一个上游 provider 条目 → 本包认识的 `{ apiKey, baseUrl, model, ... }`。
 *
 * 宿主字段名不固定（`apiKey` / `api_key` / `key` / `credentials.apiKey`），
 * 全收是因为 `providers.set` 的落库形状还没定，而读错字段的后果是"看起来配了其实没配"。
 */
function normalizeEntry(entry, meta) {
  if (!entry || typeof entry !== 'object') return null;
  const credentials = entry.credentials && typeof entry.credentials === 'object' ? entry.credentials : {};
  return {
    apiKey: pickString(entry.apiKey, entry.api_key, entry.key, entry.token, credentials.apiKey, credentials.api_key),
    accessKeyId: pickString(entry.accessKeyId, entry.access_key_id, credentials.accessKeyId),
    accessKeySecret: pickString(entry.accessKeySecret, entry.access_key_secret, credentials.accessKeySecret),
    baseUrl: pickString(entry.baseUrl, entry.base_url, entry.url, entry.endpoint),
    model: pickString(entry.model, entry.modelId, entry.model_id) ?? meta?.defaultModelId,
    voice: pickString(entry.voice, entry.defaultVoice),
    disabled: entry.disabled === true,
    models: Array.isArray(entry.models) ? entry.models : undefined,
  };
}

/**
 * provider 解析器。
 *
 * 解析顺序（第一个有值的胜）：
 *   1. `config.providers[capability][id]` —— 集成层/测试注入，最高优先级；
 *   2. `ctx.zhiyunClassroomStudio.providers.list()` —— 宿主配置（规范 §4）；
 *   3. `process.env[meta.envKey]` —— **最后兜底**，仅为了桌面端在设置页落地前可用。
 *
 * 第 3 条是有意的例外，所以它只提供 key/baseURL，不提供 `disabled` 之类的语义。
 */
export function createProviderRegistry({ studio, config = {}, log } = {}) {
  const injected = config.providers && typeof config.providers === 'object' ? config.providers : {};

  /** 读宿主清单。宿主没有服务、`list()` 抛错、形状不对 —— 一律当作"没配"，不抛。 */
  async function studioSnapshot() {
    if (!studio || typeof studio.providers?.list !== 'function') return null;
    try {
      const result = await studio.providers.list();
      const body = result?.body && typeof result.body === 'object' ? result.body : result;
      return body && typeof body === 'object' ? body : null;
    } catch (error) {
      log?.warn?.('读取宿主 providers.list() 失败，按未配置处理', error?.message ?? error);
      return null;
    }
  }

  function envFallback(meta) {
    if (!meta?.envKey) return {};
    // 最后兜底：上游 `lib/server/provider-config.ts` 的 resolve*ApiKey 在 YAML 缺失时
    // 也是读同名 env（例如 OPENAI_API_KEY）。这里保留同一条退路，仅为桌面端过渡。
    const raw = process.env[meta.envKey];
    if (typeof raw !== 'string' || !raw.trim()) return {};
    return { apiKey: raw.trim(), fromEnv: true };
  }

  async function resolve(capability, providerId) {
    const table = PROVIDER_TABLES[capability];
    if (!table) throw new Error(`未知能力段：${capability}`);
    const meta = table[providerId];
    if (!meta) return null;

    const injectedEntry = normalizeEntry(injected[capability]?.[providerId], meta);
    const snapshot = await studioSnapshot();
    const section = snapshot?.[STUDIO_SECTION[capability]];
    const studioEntry = normalizeEntry(section?.[providerId], meta);
    const env = envFallback(meta);

    const merged = {
      capability,
      id: providerId,
      meta,
      apiKey: injectedEntry?.apiKey ?? studioEntry?.apiKey ?? env.apiKey,
      accessKeyId: injectedEntry?.accessKeyId ?? studioEntry?.accessKeyId,
      accessKeySecret: injectedEntry?.accessKeySecret ?? studioEntry?.accessKeySecret,
      // `https://{region}...` 这类占位地址宁可当作"没配"：发出去必然 ENOTFOUND。
      baseUrl:
        injectedEntry?.baseUrl
        ?? studioEntry?.baseUrl
        ?? (meta.defaultBaseUrl && !meta.defaultBaseUrl.includes('{') ? meta.defaultBaseUrl : undefined),
      // defaultBaseUrl 只是文档占位；"用户真的给了 baseURL"才允许把无 key 的自建服务当成可用。
      baseUrlExplicit: Boolean(injectedEntry?.baseUrl ?? studioEntry?.baseUrl),
      model: injectedEntry?.model ?? studioEntry?.model ?? meta.defaultModelId ?? undefined,
      voice: injectedEntry?.voice ?? studioEntry?.voice ?? meta.defaultVoice ?? undefined,
      disabled: injectedEntry?.disabled === true || studioEntry?.disabled === true,
      models: injectedEntry?.models ?? studioEntry?.models,
      fromEnv: Boolean(env.fromEnv),
    };
    return merged;
  }

  /**
   * 某个 provider 是否可用。
   *
   * 三条判定：
   * - `alwaysAvailable`（builtin reader / unpdf）不看任何凭证；
   * - 要 key 的看 key（AliDocMind 看 AK/SK 对）；
   * - 不要 key 的自建服务（VoxCPM、SearXNG、ComfyUI、自建 MinerU）必须**真的**给了
   *   baseURL。`meta.defaultBaseUrl` 不参与判定：它只是文档里的示例地址，
   *   把它当成"已配置"会让默认选择落到一个没跑起来的服务上。
   */
  async function isUsable(capability, providerId) {
    const resolved = await resolve(capability, providerId);
    if (!resolved) return false;
    const { meta } = resolved;
    if (resolved.disabled || meta.clientOnly) return false;
    if (meta.alwaysAvailable) return true;

    const hasKey = Boolean(resolved.apiKey)
      || (meta.requiresCredentials && Boolean(resolved.accessKeyId && resolved.accessKeySecret));
    if (meta.requiresApiKey) return hasKey;
    if (meta.requiresBaseUrl) return resolved.baseUrlExplicit;
    return resolved.baseUrlExplicit;
  }

  /**
   * 按优先级挑第一个可用者。
   *
   * `configuredOnly` 会跳过 `alwaysAvailable` 的兜底 provider（builtin / unpdf）：
   * 默认选择要先落到"用户真的配了"的那个上，否则配了 MinerU Cloud 也会被本地 unpdf
   * 抢走 —— 而本地 unpdf 可能根本没装依赖。
   */
  async function firstUsable(capability, order, { configuredOnly = false } = {}) {
    for (const id of order) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await isUsable(capability, id))) continue;
      if (configuredOnly) {
        // eslint-disable-next-line no-await-in-loop
        const resolved = await resolve(capability, id);
        if (resolved?.meta?.alwaysAvailable) continue;
      }
      return id;
    }
    return null;
  }

  async function list(capability) {
    const table = PROVIDER_TABLES[capability];
    if (!table) return [];
    const out = [];
    for (const [id, meta] of Object.entries(table)) {
      // eslint-disable-next-line no-await-in-loop
      out.push({
        id,
        name: meta.name,
        requiresApiKey: meta.requiresApiKey === true,
        clientOnly: meta.clientOnly === true,
        defaultBaseUrl: meta.defaultBaseUrl || null,
        models: meta.defaultModelId ? [meta.defaultModelId] : [],
        configured: await isUsable(capability, id),
      });
    }
    return out;
  }

  return { resolve, isUsable, firstUsable, list, snapshot: studioSnapshot };
}
