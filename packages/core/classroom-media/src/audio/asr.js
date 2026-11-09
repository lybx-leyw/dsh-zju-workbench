// 源：ref/OpenMAIC/lib/audio/asr-providers.ts:169-665（transcribeAudio 与 6 个 provider 实现）
// 源：ref/OpenMAIC/lib/audio/wav-utils.ts:109-123（WAV-only provider 的上传格式归一）
//
// # 与上游的差别
//
// 上游 `openai-whisper` 走 Vercel AI SDK（`@ai-sdk/openai` + `experimental_transcribe`），
// 本仓**不新增 npm 依赖**，所以改写成直接 `POST /audio/transcriptions`（multipart）。
// 这正好等于上游自己的兜底分支 `transcribeCustomOpenAICompatibleASR`
// （asr-providers.ts:324-395）——官方端点与非 whisper 模型本来就走它，
// 差别只剩"SDK 的严格 schema 校验"，而那个校验在本包里由我们只读 `data.text` 替代。
//
// `normalizeASRUploadAudio` 的浏览器部分（AudioContext 解码）没搬：本包只服务服务端，
// 输入已经是 Buffer；WAV 判定保留（funasr / lemonade 只收 WAV）。

import { invalidInput, invalidResponse, notConfigured, unsupportedProvider, upstreamError } from '../errors.js';
import { ASR_PROVIDERS } from '../providers.js';

/** source:asr-providers.ts:292-306 */
function isWav(bytes) {
  return (
    bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WAVE'
  );
}

/** source:asr-providers.ts:308-311 */
function optionalBearer(apiKey) {
  const key = apiKey?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** Buffer → Blob（multipart 用）。source:asr-providers.ts:265-277 */
function toAudioBlob(buffer, defaultType) {
  if (buffer instanceof Blob) return buffer;
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw invalidInput('audio 必须是 Buffer / Uint8Array / Blob', 'file');
  }
  return new Blob([buffer], { type: isWav(Buffer.from(buffer)) ? 'audio/wav' : defaultType });
}

/** source:asr-providers.ts:217-263 —— WAV-only 的 OpenAI 兼容 multipart。 */
async function transcribeWavOpenAICompatibleASR(ctx, config, audioBuffer, providerId, providerName) {
  const baseUrl = (config.baseUrl || ASR_PROVIDERS[providerId].defaultBaseUrl || '').replace(/\/$/, '');
  const audioBlob = toAudioBlob(audioBuffer, '');
  if (!isWav(Buffer.from(audioBuffer instanceof Blob ? await audioBuffer.arrayBuffer() : audioBuffer))) {
    throw invalidInput(`${providerName} ASR 只支持 WAV 输入，请先把录音转成 WAV`, 'file');
  }

  const formData = new FormData();
  formData.set('file', audioBlob, 'audio.wav');
  formData.set('model', config.model || ASR_PROVIDERS[providerId].defaultModelId);
  formData.set('response_format', 'json');
  if (config.language && config.language !== 'auto') formData.set('language', config.language);

  const response = await ctx.fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    redirect: 'manual',
    headers: optionalBearer(config.apiKey),
    body: formData,
    ...(config.signal ? { signal: config.signal } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    // "audio is empty" / "too short" 是"没检测到语音"，不是失败。
    if (errorText.includes('audio is empty') || errorText.includes('too short')) return { text: '' };
    throw upstreamError(`${providerName} ASR`, response.status, errorText);
  }
  const data = await response.json();
  return { text: typeof data.text === 'string' ? data.text : '' };
}

/**
 * source:asr-providers.ts:324-395 —— 自定义 OpenAI 兼容 ASR。
 *
 * 只取 `data.text`：SiliconFlow 之类会多返回 `segments`/`duration`，
 * 上游就是因为 SDK 的严格 schema 会拒这些字段才特意绕开 SDK 的。
 */
async function transcribeCustomOpenAICompatibleASR(ctx, config, audioBuffer) {
  const baseUrl = (config.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl) throw invalidInput('自定义 ASR 必须给 baseURL（例如 https://api.siliconflow.cn/v1）', 'baseUrl');
  if (!config.model?.trim()) {
    throw invalidInput('自定义 ASR 必须给 model ID（例如 FunAudioLLM/SenseVoiceSmall）', 'model');
  }

  const audioBlob = toAudioBlob(audioBuffer, 'audio/webm');
  const formData = new FormData();
  formData.set('file', audioBlob, isWav(Buffer.from(audioBuffer instanceof Blob ? await audioBuffer.arrayBuffer() : audioBuffer)) ? 'audio.wav' : 'audio.webm');
  formData.set('model', config.model);
  formData.set('response_format', 'json');
  if (config.language && config.language !== 'auto') formData.set('language', config.language);

  const response = await ctx.fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    redirect: 'manual',
    headers: optionalBearer(config.apiKey),
    body: formData,
    ...(config.signal ? { signal: config.signal } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    if (errorText.includes('audio is empty') || errorText.includes('too short')) return { text: '' };
    throw upstreamError('Custom ASR', response.status, errorText);
  }
  const data = await response.json();
  return { text: typeof data.text === 'string' ? data.text : '' };
}

/** source:asr-providers.ts:400-458 */
async function transcribeOpenAIWhisper(ctx, config, audioBuffer) {
  const modelId = config.model || ASR_PROVIDERS['openai-whisper'].defaultModelId;
  const baseUrl = config.baseUrl || ASR_PROVIDERS['openai-whisper'].defaultBaseUrl;
  const isOfficialEndpoint = baseUrl?.replace(/\/+$/, '') === ASR_PROVIDERS['openai-whisper'].defaultBaseUrl;
  // 上游：非官方端点或非已知模型 → 走宽容的 JSON 适配器。
  if (
    !isOfficialEndpoint
    || !['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'].includes(modelId)
  ) {
    return transcribeCustomOpenAICompatibleASR(ctx, { ...config, modelId, baseUrl }, audioBuffer);
  }
  // 官方端点：SDK 换成裸 multipart，行为等价（见文件头）。
  return transcribeCustomOpenAICompatibleASR(ctx, { ...config, modelId, baseUrl }, audioBuffer);
}

/** source:asr-providers.ts:463-554 */
async function transcribeQwenASR(ctx, config, audioBuffer) {
  const baseUrl = (config.baseUrl || ASR_PROVIDERS['qwen-asr'].defaultBaseUrl).replace(/\/$/, '');
  const bytes = audioBuffer instanceof Blob ? Buffer.from(await audioBuffer.arrayBuffer()) : Buffer.from(audioBuffer);
  const requestBody = {
    model: config.model || ASR_PROVIDERS['qwen-asr'].defaultModelId,
    input: {
      messages: [
        { role: 'user', content: [{ audio: `data:audio/wav;base64,${bytes.toString('base64')}` }] },
      ],
    },
  };
  if (config.language && config.language !== 'auto') {
    requestBody.parameters = { asr_options: { language: config.language } };
  }

  const response = await ctx.fetch(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
      'X-DashScope-Audio-Format': 'wav',
    },
    body: JSON.stringify(requestBody),
    ...(config.signal ? { signal: config.signal } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    if (errorText.includes('audio is empty') || errorText.includes('InvalidParameter')) return { text: '' };
    throw upstreamError('Qwen ASR', response.status, errorText);
  }

  const data = await response.json();
  if (!data.output?.choices || !Array.isArray(data.output.choices) || data.output.choices.length === 0) {
    throw invalidResponse('Qwen ASR', `响应里没有 choices：${JSON.stringify(data).slice(0, 300)}`);
  }
  const content = data.output.choices[0]?.message?.content;
  if (!Array.isArray(content) || content.length === 0) return { text: '' };
  return { text: content[0]?.text || '' };
}

/** source:asr-providers.ts:560-573 —— 区域域名与 api-version 归一。 */
function azureTranscriptionUrl(rawBaseUrl) {
  let endpoint = rawBaseUrl.replace(/\/+$/, '');
  if (/\.stt\.speech\.microsoft\.com$/i.test(endpoint)) {
    endpoint = endpoint.replace(/\.stt\.speech\.microsoft\.com$/i, '.api.cognitive.microsoft.com');
  }
  if (!/\/speechtotext\/transcriptions:transcribe/i.test(endpoint)) {
    endpoint = `${endpoint}/speechtotext/transcriptions:transcribe`;
  }
  const url = new URL(endpoint);
  if (!url.searchParams.get('api-version')) url.searchParams.set('api-version', '2025-10-15');
  return url;
}

/** source:asr-providers.ts:580-587 —— 导出给设置页的"这条 route 会打到哪个 URL"。 */
export function asrRequestUrl(providerId, baseUrl) {
  if (providerId !== 'azure-asr' || !baseUrl || baseUrl.includes('{region}')) return baseUrl;
  try {
    return azureTranscriptionUrl(baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

/** source:asr-providers.ts:593-665 */
async function transcribeAzureASR(ctx, config, audioBuffer) {
  const rawBaseUrl = config.baseUrl || ASR_PROVIDERS['azure-asr'].defaultBaseUrl;
  if (!rawBaseUrl || rawBaseUrl.includes('{region}')) {
    throw invalidInput('Azure STT 的 baseURL 必须填真实区域', 'baseUrl');
  }
  const url = azureTranscriptionUrl(rawBaseUrl);
  const audioBlob = toAudioBlob(audioBuffer, 'audio/webm');

  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  const localeMap = {
    en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', de: 'de-DE', fr: 'fr-FR',
    es: 'es-ES', it: 'it-IT', pt: 'pt-BR', ru: 'ru-RU', ar: 'ar-SA', hi: 'hi-IN',
  };
  if (config.language && config.language !== 'auto') {
    formData.append('definition', JSON.stringify({ locales: [localeMap[config.language] || config.language] }));
  }

  const response = await ctx.fetch(url.toString(), {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Ocp-Apim-Subscription-Key': config.apiKey },
    body: formData,
    ...(config.signal ? { signal: config.signal } : {}),
  });

  if (!response.ok) throw upstreamError('Azure STT', response.status, await response.text().catch(() => ''));

  const data = await response.json();
  const combinedText = data.combinedPhrases?.map((p) => p.text || '').filter(Boolean).join(' ');
  const phraseText = data.phrases?.map((p) => p.text || '').filter(Boolean).join(' ');
  return { text: combinedText || phraseText || '' };
}

/**
 * 转写一段音频。
 *
 * source:asr-providers.ts:169-210 —— 分支顺序与校验条件逐条保留。
 *
 * @param {{fetch: Function}} ctx
 * @param {object} config `{ providerId, apiKey, baseUrl, model, language, signal }`
 * @param {Buffer|Uint8Array|Blob} audioBuffer
 * @returns {Promise<{text: string}>}
 */
export async function transcribeAudio(ctx, config, audioBuffer) {
  const meta = ASR_PROVIDERS[config.providerId];
  if (!meta && !String(config.providerId || '').startsWith('custom-asr-')) {
    throw unsupportedProvider('ASR', config.providerId, Object.keys(ASR_PROVIDERS));
  }
  if (meta?.requiresApiKey && !config.apiKey) throw notConfigured('ASR', config.providerId);

  switch (config.providerId) {
    case 'openai-whisper':
      return transcribeOpenAIWhisper(ctx, config, audioBuffer);
    case 'browser-native':
      // source:asr-providers.ts:184-185
      throw unsupportedProvider('ASR', 'browser-native', Object.keys(ASR_PROVIDERS));
    case 'qwen-asr':
      return transcribeQwenASR(ctx, config, audioBuffer);
    case 'azure-asr':
      return transcribeAzureASR(ctx, config, audioBuffer);
    case 'funasr-asr':
      return transcribeWavOpenAICompatibleASR(ctx, config, audioBuffer, 'funasr-asr', 'FunASR');
    case 'lemonade-asr':
      return transcribeWavOpenAICompatibleASR(ctx, config, audioBuffer, 'lemonade-asr', 'Lemonade');
    default:
      if (String(config.providerId).startsWith('custom-asr-')) {
        return transcribeCustomOpenAICompatibleASR(ctx, config, audioBuffer);
      }
      throw unsupportedProvider('ASR', config.providerId, Object.keys(ASR_PROVIDERS));
  }
}
